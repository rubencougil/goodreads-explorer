const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('playwright');
const { parse } = require('csv-parse/sync');

const ROOT_DIR = __dirname;
const IMPORT_EXPORT_URL = 'https://www.goodreads.com/review/import';
const SIGN_IN_URL_FRAGMENT = '/user/sign_in';
const DEFAULT_PROFILE_DIR = path.join(ROOT_DIR, '.playwright', 'goodreads-profile');
const DEFAULT_DOWNLOAD_DIR = path.join(ROOT_DIR, 'data');
const LOGIN_WAIT_MS = 10 * 60 * 1000;
const EXPORT_WAIT_MS = 4 * 60 * 1000;
const ENRICH_CONCURRENCY = 6;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function normalizeConfig(inputConfig = {}) {
  const fromFile = readJson(path.join(ROOT_DIR, 'config.json'), {});
  const config = inputConfig.goodreads ? inputConfig : fromFile;
  const source = config.goodreads || {};

  return {
    displayName: String(source.displayName || 'My Goodreads').trim() || 'My Goodreads',
    publicDisplayName: String(source.publicDisplayName || 'Mi biblioteca').trim() || 'Mi biblioteca',
    profileUrl: String(source.profileUrl || '').trim(),
    profileDir: path.resolve(ROOT_DIR, String(source.profileDir || DEFAULT_PROFILE_DIR))
  };
}

function parseNumber(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^="/, '')
    .replace(/"$/, '')
    .replace(/,/g, '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const direct = new Date(text);
  if (Number.isNaN(direct.getTime())) {
    return text;
  }

  return direct.toISOString().slice(0, 10);
}

function splitShelves(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRowKeys(record) {
  const normalized = {};

  Object.entries(record || {}).forEach(([key, value]) => {
    normalized[String(key || '').trim()] = typeof value === 'string' ? value.trim() : value;
  });

  return normalized;
}

function buildBookUrl(bookId) {
  const id = String(bookId || '').trim();
  return id ? `https://www.goodreads.com/book/show/${id}` : '';
}

function buildBookSearchUrl({ title, author }) {
  const query = [title, author].filter(Boolean).join(' ').trim();
  return query
    ? `https://www.goodreads.com/search?q=${encodeURIComponent(query)}&search_type=books`
    : '';
}

function normalizeRecord(record) {
  const row = normalizeRowKeys(record);
  const bookId = String(row['Book Id'] || row['Book ID'] || '').trim();
  const title = String(row.Title || '').trim();
  const author = String(row.Author || '').trim();
  const year =
    String(row['Original Publication Year'] || row['Year Published'] || '').trim();
  const rating = parseNumber(row['My Rating']);
  const averageRating = parseNumber(row['Average Rating']);
  const pages = parseNumber(row['Number of Pages']);
  const bookshelves = splitShelves(row.Bookshelves);
  const exclusiveShelf = String(row['Exclusive Shelf'] || row.Shelves || '').trim();
  const readCount = parseNumber(row['Read Count']);
  const ownedCopies = parseNumber(row['Owned Copies']);

  return {
    bookId,
    title,
    sortTitle: title.toLocaleLowerCase('en'),
    author,
    rating,
    averageRating,
    year,
    pages,
    bookshelves,
    exclusiveShelf,
    dateRead: parseDate(row['Date Read']),
    dateAdded: parseDate(row['Date Added']),
    isbn: String(row.ISBN || '').trim(),
    isbn13: String(row.ISBN13 || '').trim(),
    publisher: String(row.Publisher || '').trim(),
    binding: String(row.Binding || '').trim(),
    myReview: String(row['My Review'] || '').trim(),
    privateNotes: String(row['Private Notes'] || '').trim(),
    spoiler: String(row.Spoiler || '').trim(),
    readCount,
    ownedCopies,
    url: buildBookUrl(bookId),
    coverUrl: '',
    authorUrl: '',
    searchUrl: buildBookSearchUrl({ title, author })
  };
}

function decodeHtmlEntity(entity) {
  const map = {
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&lt;': '<',
    '&gt;': '>'
  };
  return map[entity] || entity;
}

function decodeHtml(value) {
  return String(value || '').replace(/&(amp|quot|#39|apos|lt|gt);/g, (match) => decodeHtmlEntity(match));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body
          });
        });
      }
    );

    req.on('error', reject);
  });
}

function extractJsonLdBlocks(html) {
  return [...String(html || '').matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter(Boolean);
}

function parseBookPageMetadata(html) {
  const blocks = extractJsonLdBlocks(html);
  let averageRating = null;
  let coverUrl = '';
  let authorUrl = '';

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block.trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];

      for (const node of nodes) {
        const image = typeof node?.image === 'string' ? node.image : '';
        const ratingValue = parseNumber(node?.aggregateRating?.ratingValue);
        const authorNode = Array.isArray(node?.author) ? node.author[0] : node?.author;
        const authorLink = typeof authorNode?.url === 'string' ? authorNode.url : '';

        if (image && !coverUrl) {
          coverUrl = image;
        }

        if (ratingValue !== null && averageRating === null) {
          averageRating = ratingValue;
        }

        if (authorLink && !authorUrl) {
          authorUrl = authorLink;
        }
      }
    } catch (error) {
      // Ignore malformed JSON-LD blocks and keep probing.
    }
  }

  if (!coverUrl) {
    const imageMatch = String(html || '').match(/"image"\s*:\s*"([^"]+)"/i);
    coverUrl = imageMatch ? decodeHtml(imageMatch[1]) : '';
  }

  if (averageRating === null) {
    const ratingMatch =
      String(html || '').match(/"ratingValue"\s*:\s*"([^"]+)"/i) ||
      String(html || '').match(/averageRating["':\s>]+([0-9.]+)/i);
    averageRating = ratingMatch ? parseNumber(ratingMatch[1]) : null;
  }

  if (!authorUrl) {
    const authorMatch = String(html || '').match(
      /https:\/\/www\.goodreads\.com\/author\/show\/[0-9]+[^"' <]*/i
    );
    authorUrl = authorMatch ? authorMatch[0] : '';
  }

  return {
    averageRating,
    coverUrl,
    authorUrl
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function enrichBooks(books, onProgress) {
  let resolvedRatings = 0;
  let resolvedCovers = 0;

  const enriched = await mapWithConcurrency(books, ENRICH_CONCURRENCY, async (book, index) => {
    const url = String(book?.url || '').trim();

    if (!url) {
      return book;
    }

    if ((index + 1) % 20 === 1) {
      onProgress?.(`Enriqueciendo portadas y nota Goodreads (${index + 1}/${books.length})...`);
    }

    try {
      const { statusCode, body } = await fetchText(url);
      if (statusCode < 200 || statusCode >= 300 || !body) {
        return book;
      }

      const metadata = parseBookPageMetadata(body);
      if (metadata.averageRating !== null) {
        resolvedRatings += 1;
      }
      if (metadata.coverUrl) {
        resolvedCovers += 1;
      }

      return {
        ...book,
        averageRating: metadata.averageRating !== null ? metadata.averageRating : book.averageRating,
        coverUrl: metadata.coverUrl || book.coverUrl || '',
        authorUrl: metadata.authorUrl || book.authorUrl || ''
      };
    } catch (error) {
      return book;
    }
  });

  onProgress?.(`Enriquecidos ${resolvedCovers} portadas y ${resolvedRatings} notas Goodreads.`);
  return enriched;
}

function parseLibraryCsv(csvText) {
  const rows = parse(csvText, {
    bom: true,
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true
  });

  return rows
    .map(normalizeRecord)
    .filter((book) => book.title);
}

async function waitUntilLoggedIn(page, onProgress, isHeadless) {
  const signInForm = page.locator(
    'form[action*="sign_in"], input[name="email"], input[type="password"]'
  );
  const exportButton = page.getByRole('button', { name: /export library/i });
  const exportLink = page.getByRole('link', { name: /export library/i });

  if (await signInForm.first().isVisible().catch(() => false)) {
    if (isHeadless) {
      throw new Error(
        'Goodreads is asking for login, but the browser is running headless. Run the sync locally without GOODREADS_HEADLESS=true so you can sign in once and save the session.'
      );
    }

    onProgress?.(
      'Goodreads login required. Sign in in the opened browser window; the sync will continue automatically.'
    );

    await page.waitForFunction(
      ({ signInUrlFragment }) => !window.location.pathname.includes(signInUrlFragment),
      { timeout: LOGIN_WAIT_MS },
      { signInUrlFragment: SIGN_IN_URL_FRAGMENT }
    );

    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.goto(IMPORT_EXPORT_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    const buttonVisible = await exportButton.isVisible().catch(() => false);
    const linkVisible = await exportLink.isVisible().catch(() => false);

    if (buttonVisible || linkVisible) {
      return;
    }

    await sleep(800);
  }

  throw new Error('Could not find the Goodreads export control after login.');
}

async function waitForDownloadLink(page) {
  const exportLink = page.locator('a[href*="/review_porter/export/"][href$=".csv"]');

  const startedAt = Date.now();
  while (Date.now() - startedAt < EXPORT_WAIT_MS) {
    if (await exportLink.first().isVisible().catch(() => false)) {
      return exportLink.first();
    }

    await sleep(1500);
  }

  throw new Error('Goodreads did not surface the real library export link in time.');
}

async function triggerExportDownload(page, onProgress) {
  const exportButton = page.getByRole('button', { name: /export library/i });
  const readyExportLink = page.locator('a[href*="/review_porter/export/"][href$=".csv"]');

  if (await readyExportLink.first().isVisible().catch(() => false)) {
    onProgress?.('Found an already-prepared Goodreads export file.');
  } else if (await exportButton.isVisible().catch(() => false)) {
    onProgress?.('Requesting Goodreads export file...');
    await exportButton.click();
  } else {
    throw new Error('Could not find the Goodreads export control.');
  }

  const link = await waitForDownloadLink(page);
  onProgress?.('Downloading Goodreads CSV export...');

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    link.click()
  ]);

  return download;
}

async function syncGoodreads(options = {}) {
  const config = normalizeConfig(options.config || {});
  const isHeadless = process.env.GOODREADS_HEADLESS === 'true' || process.env.CI === 'true';
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  fs.mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(config.profileDir, { recursive: true });

  onProgress(
    `Launching Chromium with persistent profile at ${path.relative(ROOT_DIR, config.profileDir)}...`
  );

  const context = await chromium.launchPersistentContext(config.profileDir, {
    headless: isHeadless,
    acceptDownloads: true,
    viewport: { width: 1440, height: 980 }
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    onProgress('Opening Goodreads import/export page...');
    await page.goto(IMPORT_EXPORT_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
    await waitUntilLoggedIn(page, onProgress, isHeadless);

    const download = await triggerExportDownload(page, onProgress);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const csvPath = path.join(DEFAULT_DOWNLOAD_DIR, `goodreads-library-${timestamp}.csv`);
    await download.saveAs(csvPath);

    const csvText = fs.readFileSync(csvPath, 'utf8');
    const books = parseLibraryCsv(csvText);
    const lastSyncedAt = new Date().toISOString();

    onProgress(`Parsed ${books.length} books from Goodreads export.`);
    const enrichedBooks = await enrichBooks(books, onProgress);

    return {
      profile: {
        displayName: config.publicDisplayName || config.displayName
      },
      rawCsvPath: csvPath,
      count: enrichedBooks.length,
      lastSyncedAt,
      books: enrichedBooks
    };
  } finally {
    await context.close();
  }
}

module.exports = {
  parseLibraryCsv,
  syncGoodreads
};
