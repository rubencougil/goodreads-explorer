const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');

const publicDir = path.join(__dirname, '..', 'public');
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
let browser;
let server;
let baseUrl;
const fixture = {
  profile: { displayName: '<img src=x onerror="window.injected=true">' },
  library: {
    lastSyncedAt: '2026-02-01T00:00:00Z',
    books: Array.from({ length: 53 }, (_, index) => ({
      title: index === 0 ? '<img src=x onerror="window.injected=true">' : `Book ${index}`,
      author: 'Writer',
      rating: index === 0 ? null : 4,
      averageRating: 4.2,
      pages: 200,
      year: '2000',
      dateRead: index % 2 ? '2026-02-01' : '2025-12-01',
      exclusiveShelf: index === 0 ? 'currently-reading' : 'read',
      bookshelves: ['fiction'],
      url: index === 0 ? 'javascript:alert(1)' : 'https://www.goodreads.com/book/show/123',
      authorUrl: 'javascript:alert(1)',
      coverUrl: ''
    }))
  }
};

before(async () => {
  server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${publicDir}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const content = await readFile(file);
      response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream' }).end(content);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

async function createPage(t, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, timezoneId: 'Pacific/Honolulu' });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'No uncaught browser errors'));
  await page.route('**/data/library.json', (route) => route.fulfill({ json: fixture }));
  return page;
}

for (const [name, viewport, pageSize] of [
  ['mobile', { width: 390, height: 844 }, 12],
  ['desktop', { width: 1440, height: 1000 }, 24]
]) {
  test(`${name}: filters, batch loading, literal titles and safe links`, async (t) => {
    const page = await createPage(t, viewport);
    await page.goto(baseUrl);
    await page.locator('.book-card:not(.is-skeleton)').first().waitFor();
    assert.equal(await page.locator('.book-card').count(), pageSize);
    const card = page.locator('.book-card').filter({ hasText: '<img src=x' });
    assert.equal(await card.locator('.book-title').textContent(), fixture.library.books[0].title);
    assert.equal(await card.locator('.book-title img').count(), 0);
    assert.equal(await card.locator('.your-rating').textContent(), 'Tu nota: Sin nota');
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await card.locator('.book-cover-link').getAttribute('aria-label'), `Ver ${fixture.library.books[0].title} en Goodreads`);
    if (name === 'mobile') {
      const search = await page.locator('#search-input').boundingBox();
      const results = await page.locator('#results').boundingBox();
      assert.ok(search.y < results.y && search.y < viewport.height, 'Search precedes results and is visible');
      await page.locator('#filters-toggle').click();
      assert.equal(await page.locator('#filters-toggle').getAttribute('aria-expanded'), 'true');
    }
    await page.locator('#search-input').fill('no match');
    await page.locator('#empty-state').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#load-more').isVisible(), false);
    await page.locator('#search-input').fill('');
    await page.locator('#read-year-filter').selectOption('2025');
    assert.equal(await page.locator('#results-meta').textContent(), '27 de 53 libros');
    await page.locator('#read-year-filter').selectOption('all');
    await page.evaluate(() => loadObserver?.disconnect());
    await page.locator('#load-more-button').dispatchEvent('click');
    assert.equal(await page.locator('.book-card').count(), pageSize * 2);
    assert.equal(await page.locator('#results').getAttribute('aria-busy'), null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
}

test('statistics include empty months, UTC years, and accessible keyboard tooltips', async (t) => {
  const page = await createPage(t);
  await page.goto(`${baseUrl}/stats.html`);
  await page.locator('.timeline-hitbox').first().waitFor();
  assert.equal(await page.locator('#stats-books').textContent(), '53');
  assert.equal(await page.locator('.timeline-hitbox').count(), 3);
  assert.equal(await page.locator('.timeline-hitbox').nth(1).getAttribute('data-value'), '0');
  assert.match(await page.locator('#year-list').textContent(), /2026/);
  const point = page.locator('.timeline-hitbox').first();
  assert.match(await point.getAttribute('aria-label'), /2025: 27 libros/);
  await point.focus();
  await page.locator('.timeline-tooltip').waitFor({ state: 'visible' });
  await point.press('Escape');
  assert.equal(await page.locator('.timeline-tooltip').isVisible(), false);
  const panels = await page.locator('.stats-grid > .panel').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  assert.ok(panels[2].y >= panels[1].bottom, 'Statistics stack vertically on mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('automatic scrolling appends books without replacing the existing cards', async (t) => {
  const page = await createPage(t);
  await page.goto(baseUrl);
  await page.locator('.book-card:not(.is-skeleton)').first().waitFor();
  await page.locator('.book-card').first().evaluate((node) => { node.dataset.original = 'true'; });
  await page.locator('#load-more').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length >= 24);
  assert.equal(await page.locator('.book-card').first().getAttribute('data-original'), 'true');
});

test('the best reading year is computed across the full history, not just the visible twelve years', async (t) => {
  const page = await createPage(t);
  const books = Array.from({ length: 33 }, (_, index) => ({
    ...fixture.library.books[1],
    dateRead: `${index < 20 ? 2000 : 2001 + index}-01-01`
  }));
  await page.route('**/data/library.json', (route) => route.fulfill({ json: { library: { books } } }));
  await page.goto(`${baseUrl}/stats.html`);
  const bestYear = page.locator('.summary-chip').filter({ hasText: 'Año más lector' });
  await bestYear.waitFor();
  assert.match(await bestYear.textContent(), /2000 · 20/);
  assert.equal(await page.locator('#year-list .bar-row').count(), 12);
});

test('all pages fit narrow phone, tablet and desktop widths', async (t) => {
  const page = await createPage(t);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const pathname of ['/', '/stats.html', '/sync.html']) {
      await page.goto(`${baseUrl}${pathname}`);
      await page.waitForFunction(() => {
        const results = document.querySelector('#results');
        return results ? results.getAttribute('aria-busy') === null
          : document.querySelector('#stats-books')?.textContent === '53'
            || document.querySelector('#sync-summary')?.getAttribute('aria-busy') === null;
      });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
        `${pathname} must not overflow at ${width}px`);
    }
  }
});

test('an empty library is not treated as a loading failure on any page', async (t) => {
  const page = await createPage(t);
  await page.route('**/data/library.json', (route) => route.fulfill({ json: { library: { books: [] } } }));
  await page.goto(baseUrl);
  await page.locator('#empty-state').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#error-state').isVisible(), false);
  await page.goto(`${baseUrl}/stats.html`);
  await page.waitForFunction(() => document.querySelector('#stats-books').textContent === '0');
  assert.equal(await page.locator('.timeline-hitbox').count(), 0);
  assert.equal(await page.locator('#retry-button').isVisible(), false);
  await page.goto(`${baseUrl}/sync.html`);
  await page.waitForFunction(() => document.querySelector('#sync-summary').getAttribute('aria-busy') === null);
  assert.match(await page.locator('#sync-summary').textContent(), /Libros0/);
  assert.equal(await page.locator('#retry-button').isVisible(), false);
});

test('delayed data does not cause large mobile layout shifts', async (t) => {
  const page = await createPage(t, { width: 412, height: 823 });
  await page.addInitScript(() => {
    window.layoutShiftScore = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.layoutShiftScore += entry.value;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.route('**/data/library.json', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ json: { ...fixture, profile: { displayName: 'Mi biblioteca' } } });
  });
  for (const pathname of ['/', '/stats.html', '/sync.html']) {
    await page.goto(`${baseUrl}${pathname}`);
    await page.waitForFunction(() => {
      const target = document.querySelector('#results, #summary-chips, #sync-summary');
      return target.getAttribute('aria-busy') === null;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(() => window.layoutShiftScore < 0.1), `${pathname} must remain stable while loading`);
  }
});

for (const pathname of ['/', '/stats.html', '/sync.html']) {
  test(`${pathname}: failed and malformed data expose a recoverable error`, async (t) => {
    const page = await createPage(t);
    let mode = 'http-error';
    await page.route('**/data/library.json', (route) => {
      if (mode === 'http-error') {
        return route.fulfill({ status: 503, body: 'Unavailable' });
      }
      return route.fulfill({ json: mode === 'malformed' ? { library: {} } : fixture });
    });
    await page.goto(`${baseUrl}${pathname}`);
    await page.locator('#retry-button').waitFor({ state: 'visible' });
    mode = 'malformed';
    await page.locator('#retry-button').click();
    await page.getByText(/Los datos de la biblioteca no son válidos/).waitFor();
    mode = 'valid';
    await page.locator('#retry-button').click();
    await page.locator('#retry-button').waitFor({ state: 'hidden' });
    if (pathname === '/sync.html') {
      await page.waitForFunction(() => document.querySelector('#sync-summary').getAttribute('aria-busy') === null);
    }
    const success = pathname === '/' ? '.book-card:not(.is-skeleton)' : pathname === '/stats.html' ? '.summary-chip' : '#sync-summary .stack-item';
    await page.locator(success).first().waitFor();
    assert.equal(await page.evaluate(() => window.injected), undefined);
    if (pathname === '/sync.html') {
      assert.match(await page.locator('#sync-summary').textContent(), /<img src=x/);
      assert.equal(await page.locator('#sync-summary img').count(), 0);
    }
  });
}

test('failed resized covers retry the original and remain named when both requests fail', async (t) => {
  const page = await createPage(t);
  const original = 'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1i/123.jpg';
  const requests = [];
  await page.route('**/data/library.json', (route) => route.fulfill({
    json: { library: { books: [{ ...fixture.library.books[1], coverUrl: original }] } }
  }));
  await page.route('https://m.media-amazon.com/**', (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(baseUrl);
  await page.locator('.book-cover-fallback').waitFor({ state: 'visible' });
  assert.ok(requests.some((url) => /\._SX\d+_\.jpg$/.test(url)));
  assert.ok(requests.includes(original));
  assert.match(await page.locator('.book-cover-link').getAttribute('aria-label'), /Book 1/);
  assert.equal(await page.locator('.book-cover').isVisible(), false);
});
