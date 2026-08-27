const fs = require('fs');
const path = require('path');
const { syncGoodreads } = require('../sync-goodreads');

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'data');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'library.json');
const PUBLIC_BOOK_FIELDS = [
  'bookId',
  'title',
  'sortTitle',
  'author',
  'authorUrl',
  'rating',
  'averageRating',
  'year',
  'pages',
  'bookshelves',
  'exclusiveShelf',
  'dateRead',
  'dateAdded',
  'url',
  'coverUrl',
  'searchUrl'
];

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function sanitizeBook(book) {
  return PUBLIC_BOOK_FIELDS.reduce((accumulator, field) => {
    if (Object.hasOwn(book || {}, field)) {
      accumulator[field] = book[field];
    }
    return accumulator;
  }, {});
}

async function main() {
  const result = await syncGoodreads({
    onProgress(message) {
      console.log(message);
    }
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    profile: {
      displayName: String(result?.profile?.displayName || 'Mi Goodreads').trim() || 'Mi Goodreads'
    },
    library: {
      count: result.count,
      lastSyncedAt: result.lastSyncedAt,
      books: result.books.map(sanitizeBook)
    }
  };

  writeJson(OUTPUT_PATH, payload);

  console.log('\nStatic data updated:');
  console.log(`- ${path.relative(ROOT_DIR, OUTPUT_PATH)}`);
  console.log(`- ${path.relative(ROOT_DIR, result.rawCsvPath)}`);
  console.log(`- Books: ${result.count}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
