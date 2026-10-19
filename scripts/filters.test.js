const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const fixtures = [
  { title: 'Older finish', dateRead: '2025-12-31', dateAdded: '2026-01-01', year: '2000', rating: 3 },
  { title: 'New finish', dateRead: '2026-01-01', dateAdded: '2025-01-01', year: '2000', rating: 5 },
  { title: 'Other publication', dateRead: '2026-06-01', year: '1990', rating: 4 },
  { title: 'Unknown finish', dateRead: '', dateAdded: '2026-01-01', year: '2000', rating: 5 },
  { title: 'Invalid finish', dateRead: 'invalid', dateAdded: '2026-01-01', year: '2000', rating: 5 }
].map((book) => ({ author: 'Writer', exclusiveShelf: 'read', bookshelves: [], ...book }));

function createApp() {
  const controls = new Map();
  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: false }) },
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

test('changing read year resets pagination and rerenders', () => {
  const app = createApp();
  vm.runInContext('currentPage = 3; render = () => { globalThis.rendered = true; }; installEvents();', app.context);
  app.controls.get('#read-year-filter').events.input();
  assert.equal(vm.runInContext('currentPage', app.context), 1);
  assert.equal(app.context.rendered, true);
});
