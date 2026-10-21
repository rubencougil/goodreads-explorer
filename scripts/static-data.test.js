const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'static-data.js'), 'utf8');

function createData(fetch, payload) {
  const context = vm.createContext({
    window: { __GOODREADS_LIBRARY__: payload },
    fetch,
    AbortSignal,
    URL
  });
  vm.runInContext(source, context);
  return context.window.GoodreadsData;
}

test('loads and validates the shared library with a bounded request', async () => {
  const payload = { library: { books: [] } };
  const data = createData(async (url, options) => {
    assert.equal(url, 'data/library.json');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => payload };
  });
  assert.equal(await data.loadLibrary(), payload);
});

test('rejects failed requests, invalid JSON and malformed libraries rather than showing empty success', async () => {
  const failed = createData(async () => ({ ok: false }));
  await assert.rejects(failed.loadLibrary(), /No se pudo cargar/);
  const invalidJson = createData(async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } }));
  await assert.rejects(invalidJson.loadLibrary(), /Invalid JSON/);
  for (const payload of [{}, { library: {} }, { library: { books: [null] } }, { library: { books: [[]] } }]) {
    const data = createData(() => { throw new Error('Unexpected fetch'); }, payload);
    await assert.rejects(data.loadLibrary(), /no son válidos/);
  }
});

test('keeps valid embedded payload support without a second request', async () => {
  const payload = { library: { books: [{ title: 'Example' }] } };
  const data = createData(() => { throw new Error('Unexpected fetch'); }, payload);
  assert.equal(await data.loadLibrary(), payload);
});

test('request timeouts expose a localized retry message', async () => {
  const data = createData(async () => {
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';
    throw error;
  });
  await assert.rejects(data.loadLibrary(), /ha tardado demasiado/);
});

test('numeric and date parsing distinguish absent, invalid and valid values', () => {
  const data = createData();
  for (const value of [null, undefined, '', ' ', 'not a number', Infinity]) {
    assert.equal(data.numberOrNull(value), null);
  }
  assert.equal(data.numberOrNull(0), 0);
  assert.equal(data.numberOrNull('4.25'), 4.25);
  assert.equal(data.parseDate(''), null);
  assert.equal(data.parseDate('invalid'), null);
  assert.equal(data.parseDate('2026-01-01').toISOString(), '2026-01-01T00:00:00.000Z');
});
