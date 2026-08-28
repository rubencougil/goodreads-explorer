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
const OUTPUT_PATH = path.join(ROOT_DIR, 'public', 'data', 'library.json');

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

function findLatestExportCsv() {
  if (!fs.existsSync(DEFAULT_DOWNLOAD_DIR)) {
    return '';
  }

  const entries = fs
    .readdirSync(DEFAULT_DOWNLOAD_DIR)
    .filter((name) => /^goodreads-library-.*\.csv$/i.test(name))
    .map((name) => {
      const filePath = path.join(DEFAULT_DOWNLOAD_DIR, name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return entries[0]?.filePath || '';
}

function readCachedLibraryBooks() {
  const payload = readJson(OUTPUT_PATH, null);
  const books = Array.isArray(payload?.library?.books) ? payload.library.books : [];

  return books.reduce((map, book) => {
    const bookId = String(book?.bookId || '').trim();
    if (bookId) {
      map.set(bookId, book);
    }
    return map;
  }, new Map());
}

function normalizeSearchTitle(title) {
  return String(title || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[“”"']/g, '')
    .split(/\s*[:–—-]\s*/)[0]
    .split(/\s*\.\s*/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchQueries(book) {
  const title = String(book?.title || '').trim();
  const author = String(book?.author || '').trim();
  const authorLast = author.split(/\s+/).filter(Boolean).pop() || '';
  const coreTitle = normalizeSearchTitle(title);
  const shortTitle = coreTitle.split(/\s+/).slice(0, 6).join(' ').trim();
  const mediumTitle = coreTitle.split(/\s+/).slice(0, 8).join(' ').trim();

  const queries = [
    [title, author],
    [coreTitle, author],
    [coreTitle, authorLast],
    [shortTitle, author],
    [shortTitle, authorLast],
    [mediumTitle, author],
    [mediumTitle, authorLast],
    [coreTitle],
    [shortTitle],
    [mediumTitle]
  ]
    .map((parts) => parts.filter(Boolean).join(' ').trim())
    .filter(Boolean);

  return [...new Set(queries)].map((query) => buildBookSearchUrl({ title: query, author: '' }));
}

function mergeCachedEnrichment(book, cachedBook) {
  if (!cachedBook) {
    return book;
  }

  return {
    ...book,
    averageRating: Number.isFinite(Number(book.averageRating)) && Number(book.averageRating) > 0
      ? book.averageRating
      : cachedBook.averageRating,
    authorUrl: String(book.authorUrl || '').trim() ? book.authorUrl : String(cachedBook.authorUrl || '').trim(),
    coverUrl: String(book.coverUrl || '').trim() ? book.coverUrl : String(cachedBook.coverUrl || '').trim(),
    url: String(book.url || '').trim() ? book.url : String(cachedBook.url || '').trim()
  };
}

function needsEnrichment(book) {
  return !String(book.coverUrl || '').trim() ||
    !String(book.authorUrl || '').trim() ||
    !Number.isFinite(Number(book.averageRating)) ||
    Number(book.averageRating) <= 0;
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

function upgradeGoodreadsCoverUrl(url) {
  const text = String(url || '').trim();
  if (!text || !/gr-assets\.com|goodreads\.com/i.test(text)) {
    return text;
  }

  if (/_SX50_SY75_/i.test(text)) {
    return text.replace(/_SX50_SY75_/i, '_SX318_SY475_');
  }

  if (/_SY75_/i.test(text)) {
    return text.replace(/_SY75_/i, '_SY318_');
  }

  if (/_SX50_/i.test(text)) {
    return text.replace(/_SX50_/i, '_SX318_');
  }

  if (/_SX/i.test(text)) {
    return text.replace(/_SX\d+_/i, '_SX318_');
  }

  return text;
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

function extractSearchResultBlock(html, bookId) {
  const text = String(html || '');
  const anchor = String(bookId || '').trim();

  if (anchor) {
    const anchorIndex = text.indexOf(`id="${anchor}"`);
    if (anchorIndex !== -1) {
      const start = text.lastIndexOf('<tr', anchorIndex);
      const end = text.indexOf('</tr>', anchorIndex);
      if (start !== -1 && end !== -1) {
        return text.slice(start, end + 5);
      }
    }
  }

  const firstRowMatch = text.match(/<tr[^>]*itemscope[^>]*itemtype="http:\/\/schema\.org\/Book"[^>]*>[\s\S]*?<\/tr>/i);
  return firstRowMatch ? firstRowMatch[0] : text;
}

function parseSearchResultMetadata(html, bookId) {
  const block = extractSearchResultBlock(html, bookId);
  const blocks = extractJsonLdBlocks(block);
  let averageRating = null;
  let coverUrl = '';
  let authorUrl = '';
  let bookUrl = '';

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
          coverUrl = upgradeGoodreadsCoverUrl(image);
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
    const imageMatch =
      block.match(/<img[^>]+class="[^"]*bookCover[^"]*"[^>]+src="([^"]+)"/i) ||
      block.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*bookCover[^"]*"/i);
    coverUrl = imageMatch ? decodeHtml(imageMatch[1]) : '';
    coverUrl = upgradeGoodreadsCoverUrl(coverUrl);
  }

  if (averageRating === null) {
    const ratingMatch = block.match(/([0-9.]+)\s+avg rating/i);
    averageRating = ratingMatch ? parseNumber(ratingMatch[1]) : null;
  }

  if (!authorUrl) {
    const authorMatch =
      block.match(/<a class="authorName"[^>]+href="([^"]+)"/i) ||
      block.match(/https:\/\/www\.goodreads\.com\/author\/show\/[0-9]+[^"' <]*/i);
    authorUrl = authorMatch ? decodeHtml(authorMatch[1] || authorMatch[0]) : '';
  }

  if (!bookUrl) {
    const bookMatch = block.match(/<a class="bookTitle"[^>]+href="([^"]+)"/i);
    bookUrl = bookMatch ? decodeHtml(bookMatch[1]) : '';
  }

  return {
    averageRating,
    coverUrl,
    authorUrl,
    bookUrl
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
  const targets = books.filter(needsEnrichment);

  if (!targets.length) {
    onProgress?.('No hay portadas o metadatos de Goodreads pendientes de enriquecer.');
    return books;
  }

  const enrichedTargets = await mapWithConcurrency(targets, ENRICH_CONCURRENCY, async (book, index) => {
    const urls = buildSearchQueries(book);

    if (!urls.length) {
      return book;
    }

    if ((index + 1) % 20 === 1) {
      onProgress?.(`Enriqueciendo portadas y nota Goodreads (${index + 1}/${books.length})...`);
    }

    try {
      let nextBook = book;

      for (const url of urls) {
        const { statusCode, body } = await fetchText(url);
        if (statusCode < 200 || statusCode >= 300 || !body) {
          continue;
        }

        const metadata = parseSearchResultMetadata(body, book.bookId);
        const updated = {
          ...nextBook,
          averageRating: metadata.averageRating !== null ? metadata.averageRating : nextBook.averageRating,
          coverUrl: metadata.coverUrl || nextBook.coverUrl || '',
          authorUrl: metadata.authorUrl || nextBook.authorUrl || '',
          url: metadata.bookUrl || nextBook.url || ''
        };

        const pickedCover = Boolean(metadata.coverUrl);
        const pickedRating = metadata.averageRating !== null;
        const pickedAuthor = Boolean(metadata.authorUrl);
        const pickedBookUrl = Boolean(metadata.bookUrl);
        nextBook = updated;

        if (pickedRating) {
          resolvedRatings += 1;
        }
        if (pickedCover) {
          resolvedCovers += 1;
        }

        if ((pickedCover && pickedRating) || (pickedCover && pickedAuthor && pickedBookUrl)) {
          break;
        }
      }

      return nextBook;
    } catch (error) {
      return book;
    }
  });

  const enrichedById = new Map(
    enrichedTargets.map((book) => [String(book.bookId || '').trim(), book])
  );

  const enriched = books.map((book) => {
    const bookId = String(book.bookId || '').trim();
    return enrichedById.get(bookId) || book;
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
      onProgress?.('Goodreads needs a fresh login and headless mode cannot complete it. Reusing the latest CSV export if available.');
      return false;
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
      return true;
    }

    await sleep(800);
  }

  if (isHeadless) {
    onProgress?.('Goodreads export control did not appear in time. Reusing the latest CSV export if available.');
    return false;
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

  if (await exportButton.isVisible().catch(() => false)) {
    onProgress?.('Requesting Goodreads export file...');
    await exportButton.click();
  } else if (await readyExportLink.first().isVisible().catch(() => false)) {
    onProgress?.('Found an already-prepared Goodreads export file.');
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
  const headlessEnv = String(process.env.GOODREADS_HEADLESS || '').trim().toLowerCase();
  const isHeadless =
    process.env.CI === 'true' ||
    headlessEnv === '' ||
    headlessEnv === 'true' ||
    headlessEnv === '1' ||
    headlessEnv === 'yes';
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
    const readyForExport = await waitUntilLoggedIn(page, onProgress, isHeadless);

    let csvPath = '';
    if (readyForExport) {
      const download = await triggerExportDownload(page, onProgress);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      csvPath = path.join(DEFAULT_DOWNLOAD_DIR, `goodreads-library-${timestamp}.csv`);
      await download.saveAs(csvPath);
    } else {
      csvPath = findLatestExportCsv();
      if (!csvPath) {
        throw new Error('No local Goodreads CSV export is available to reuse.');
      }
      onProgress?.(`Reusing existing CSV export at ${path.relative(ROOT_DIR, csvPath)}.`);
    }

    const csvText = fs.readFileSync(csvPath, 'utf8');
    const books = parseLibraryCsv(csvText);
    const cachedBooks = readCachedLibraryBooks();
    const hydratedBooks = books.map((book) => mergeCachedEnrichment(book, cachedBooks.get(String(book.bookId || '').trim())));
    const lastSyncedAt = new Date().toISOString();

    onProgress(`Parsed ${books.length} books from Goodreads export.`);
    const enrichedBooks = await enrichBooks(hydratedBooks, onProgress);

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
