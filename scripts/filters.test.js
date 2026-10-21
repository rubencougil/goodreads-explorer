const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'static-data.js'), 'utf8');
const fixtures = [
  { title: 'Older finish', dateRead: '2025-12-31', dateAdded: '2026-01-01', year: '2000', rating: 3 },
  { title: 'New finish', dateRead: '2026-01-01', dateAdded: '2025-01-01', year: '2000', rating: 5 },
  { title: 'Other publication', dateRead: '2026-06-01', year: '1990', rating: 4 },
  { title: 'Unknown finish', dateRead: '', dateAdded: '2026-01-01', year: '2000', rating: 5 },
  { title: 'Invalid finish', dateRead: 'invalid', dateAdded: '2026-01-01', year: '2000', rating: 5 }
].map((book) => ({ author: 'Writer', exclusiveShelf: 'read', bookshelves: [], ...book }));

function createApp({ mobile = false } = {}) {
  const controls = new Map();
  const context = vm.createContext({
    URL,
    AbortSignal,
    console,
    window: { matchMedia: () => ({ matches: mobile }) },
    fetch: () => new Promise(() => {}),
    document: {
      querySelector: (selector) => {
        if (!controls.has(selector)) {
          controls.set(selector, {
            value: selector === '#search-input' ? '' : selector === '#rating-filter' ? '0' : 'all',
            events: {},
            setAttribute() {},
            appendChild() {},
            addEventListener(name, handler) { this.events[name] = handler; }
          });
        }
        return controls.get(selector);
      },
      createElement: () => ({ setAttribute() {} }),
      createDocumentFragment: () => ({ appendChild() {} })
    }
  });
  vm.runInContext(dataSource, context);
  vm.runInContext(source, context);
  vm.runInContext(`books = ${JSON.stringify(fixtures)};`, context);
  return {
    context,
    controls,
    titles: () => Array.from(vm.runInContext('applyFilters()', context), (book) => book.title).sort()
  };
}

test('read year uses finish dates, not publication or added dates', () => {
  const app = createApp();
  app.controls.get('#read-year-filter').value = '2026';
  assert.deepEqual(app.titles(), ['New finish', 'Other publication']);
  app.controls.get('#read-year-filter').value = '2025';
  assert.deepEqual(app.titles(), ['Older finish']);
});

test('all read years retains books with missing or invalid finish dates', () => {
  const app = createApp();
  assert.equal(app.titles().length, fixtures.length);
  app.controls.get('#read-year-filter').value = '2024';
  assert.deepEqual(app.titles(), []);
});

test('read year combines with publication year, rating and search', () => {
  const app = createApp();
  app.controls.get('#read-year-filter').value = '2026';
  app.controls.get('#year-filter').value = '2000';
  app.controls.get('#rating-filter').value = '5';
  app.controls.get('#search-input').value = 'new';
  assert.deepEqual(app.titles(), ['New finish']);
  app.controls.get('#status-filter').value = 'to-read';
  assert.deepEqual(app.titles(), []);
});

test('reading year uses UTC at the year boundary', () => {
  const app = createApp();
  assert.equal(vm.runInContext('readingYear({ dateRead: "2026-01-01" })', app.context), '2026');
  assert.equal(vm.runInContext('readingYear({ dateRead: "" })', app.context), '');
});

test('missing numeric metadata stays unknown instead of becoming zero', () => {
  const app = createApp();
  const book = vm.runInContext('normalizeBook({ rating: null, averageRating: "", pages: undefined })', app.context);
  assert.equal(book.rating, null);
  assert.equal(book.averageRating, null);
  assert.equal(book.pages, null);
  assert.equal(vm.runInContext('formatRating(normalizeBook({}).rating)', app.context), 'Sin nota');
  assert.equal(vm.runInContext('normalizeBook({ rating: 0 }).rating', app.context), null);
  assert.equal(vm.runInContext('normalizeBook({ rating: "4.5" }).rating', app.context), 4.5);
});

test('cover variants resize original and height-constrained Goodreads images by width', () => {
  const app = createApp();
  for (const suffix of ['', '._SY475_', '._SX200_', '._SX200_SY300_']) {
    const url = `https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1i/123${suffix}.jpg`;
    assert.equal(vm.runInContext(`buildGoodreadsCoverVariant(${JSON.stringify(url)}, 318)`, app.context),
      'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1i/123._SX318_.jpg');
  }
  assert.equal(vm.runInContext('buildGoodreadsCoverVariant("https://example.com/goodreads.com/cover.jpg", 318)', app.context), '');
});

test('book links accept only absolute HTTP or HTTPS URLs', () => {
  const app = createApp();
  for (const value of ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'invalid']) {
    assert.equal(vm.runInContext(`normalizeBook({ url: ${JSON.stringify(value)} }).url`, app.context), '');
  }
  assert.equal(vm.runInContext('normalizeBook({ url: "https://www.goodreads.com/book/show/123" }).url', app.context),
    'https://www.goodreads.com/book/show/123');
});

test('changing read year rerenders the filtered list', () => {
  const app = createApp();
  vm.runInContext('render = () => { globalThis.rendered = true; }; installEvents();', app.context);
  app.controls.get('#read-year-filter').events.input();
  assert.equal(app.context.rendered, true);
});

function prepareBatches(app) {
  const records = Array.from({ length: 53 }, (_, index) => ({
    ...fixtures[index % fixtures.length],
    title: `Book ${String(index).padStart(2, '0')}`
  }));
  vm.runInContext(`
    books = ${JSON.stringify(records)};
    globalThis.batches = [];
    renderBooks = (records, startIndex) => batches.push({ count: records.length, startIndex });
    installEvents();
    render();
  `, app.context);
}

test('appends desktop batches without rerendering previous records and stops at the end', () => {
  const app = createApp();
  vm.runInContext('installInfiniteScroll();', app.context);
  prepareBatches(app);
  const button = app.controls.get('#load-more-button');
  assert.equal(vm.runInContext('renderedCount', app.context), 24);
  button.events.click();
  assert.equal(vm.runInContext('renderedCount', app.context), 48);
  button.events.click();
  button.events.click();
  assert.deepEqual(Array.from(app.context.batches, (batch) => [batch.count, batch.startIndex]), [
    [24, 0], [24, 24], [5, 48]
  ]);
  assert.equal(button.hidden, true);
  assert.equal(app.controls.get('#load-status').textContent, '53 de 53 libros mostrados');
});

test('uses smaller batches on mobile', () => {
  const app = createApp({ mobile: true });
  prepareBatches(app);
  assert.equal(vm.runInContext('renderedCount', app.context), 12);
  app.controls.get('#load-more-button').events.click();
  assert.equal(vm.runInContext('renderedCount', app.context), 24);
});

test('filters and sorting restart the batch cursor and empty results hide loading controls', () => {
  const app = createApp();
  prepareBatches(app);
  app.controls.get('#load-more-button').events.click();
  app.controls.get('#sort-by').value = 'title-asc';
  app.controls.get('#sort-by').events.input();
  assert.equal(vm.runInContext('renderedCount', app.context), 24);
  app.controls.get('#read-year-filter').value = '2025';
  app.controls.get('#read-year-filter').events.input();
  assert.equal(vm.runInContext('renderedCount', app.context), 11);
  assert.equal(app.controls.get('#load-more-button').hidden, true);
  app.controls.get('#search-input').value = 'no such book';
  app.controls.get('#search-input').events.input();
  assert.equal(vm.runInContext('renderedCount', app.context), 0);
  assert.equal(app.controls.get('#empty-state').hidden, false);
  assert.equal(app.controls.get('#load-more').hidden, true);
});

test('intersection loading observes only while there are more results and resets on filtering', () => {
  const app = createApp();
  vm.runInContext(`
    globalThis.observed = false;
    globalThis.disconnects = 0;
    globalThis.IntersectionObserver = class {
      constructor(callback) { globalThis.intersect = callback; }
      observe() { observed = true; }
      unobserve() { observed = false; }
      disconnect() { observed = false; disconnects += 1; }
    };
    installInfiniteScroll();
  `, app.context);
  prepareBatches(app);
  vm.runInContext('intersect([{ isIntersecting: false }]);', app.context);
  assert.equal(vm.runInContext('renderedCount', app.context), 24);
  vm.runInContext('intersect([{ isIntersecting: true }]);', app.context);
  assert.equal(vm.runInContext('renderedCount', app.context), 48);
  assert.equal(app.context.observed, true);
  vm.runInContext('intersect([{ isIntersecting: true }]);', app.context);
  assert.equal(app.context.observed, false);
  app.controls.get('#read-year-filter').value = '2026';
  app.controls.get('#read-year-filter').events.input();
  assert.ok(app.context.disconnects >= 2);
  assert.equal(app.context.observed, false);
});
