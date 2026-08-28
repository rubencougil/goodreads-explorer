const fs = require('fs');
const path = require('path');
const { syncGoodreads, validateLibraryBooks } = require('../sync-goodreads');

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'data');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'library.json');
const OUTPUT_SCRIPT_PATH = path.join(OUTPUT_DIR, 'library.js');
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

function writeScript(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `window.__GOODREADS_LIBRARY__ = ${JSON.stringify(payload, null, 2)};\n`, 'utf8');
}

function printValidationReport(validation) {
  const categories = Array.isArray(validation?.categories) ? validation.categories : [];
  if (!categories.length) {
    return;
  }

  console.log('\nData integrity check:');
  categories.forEach((category) => {
    const severityLabel = category.severity === 'warning' ? 'warning' : 'info';
    console.log(`- [${severityLabel}] ${category.title}: ${category.count}`);

    if (category.count > 0) {
      category.samples.forEach((sample) => {
        const bits = [
          sample.title,
          sample.exclusiveShelf ? `shelf=${sample.exclusiveShelf}` : '',
          sample.dateRead ? `dateRead=${sample.dateRead}` : '',
          sample.dateAdded ? `dateAdded=${sample.dateAdded}` : '',
          sample.rating !== undefined ? `rating=${sample.rating}` : ''
        ].filter(Boolean);
        console.log(`  - ${bits.join(' | ')}`);
      });
    }
  });

  const warningCount = Number(validation?.counts?.warningCount || 0);
  const infoCount = Number(validation?.counts?.infoCount || 0);
  console.log(`- Totals: ${warningCount} warnings, ${infoCount} info items`);

  if (warningCount > 0) {
    console.log('- Suggested fixes:');
    console.log('  - Fill missing dateRead for read books or keep dateAdded as fallback order.');
    console.log('  - Normalize currently-reading books that already have dateRead.');
    console.log('  - Re-run the enrichment step only for books missing rating or extra metadata.');
  }
}

function printRepairSummary(repairStats) {
  const restoredDateRead = Number(repairStats?.restoredDateRead || 0);
  const restoredRating = Number(repairStats?.restoredRating || 0);
  const repairedCurrentlyReading = Number(repairStats?.repairedCurrentlyReading || 0);

  if (!restoredDateRead && !restoredRating && !repairedCurrentlyReading) {
    return;
  }

  console.log('\nAuto-repair summary:');
  console.log(`- Restored dateRead: ${restoredDateRead}`);
  console.log(`- Restored rating: ${restoredRating}`);
  console.log(`- Normalized currently-reading conflicts: ${repairedCurrentlyReading}`);
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
  const validation = validateLibraryBooks(result.books);

  const payload = {
    generatedAt: new Date().toISOString(),
    profile: {
      displayName: String(result?.profile?.displayName || 'Mi Goodreads').trim() || 'Mi Goodreads'
    },
    library: {
      count: result.count,
      lastSyncedAt: result.lastSyncedAt,
      books: result.books.map(sanitizeBook),
      validation,
      repairStats: result.repairStats || null
    }
  };

  writeJson(OUTPUT_PATH, payload);
  writeScript(OUTPUT_SCRIPT_PATH, payload);

  console.log('\nStatic data updated:');
  console.log(`- ${path.relative(ROOT_DIR, OUTPUT_PATH)}`);
  console.log(`- ${path.relative(ROOT_DIR, OUTPUT_SCRIPT_PATH)}`);
  console.log(`- ${path.relative(ROOT_DIR, result.rawCsvPath)}`);
  console.log(`- Books: ${result.count}`);
  printRepairSummary(result.repairStats);
  printValidationReport(validation);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
