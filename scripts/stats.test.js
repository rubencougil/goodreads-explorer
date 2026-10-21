const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..', 'public');
const context = vm.createContext({
  window: {},
  URL,
  AbortSignal,
  fetch: () => new Promise(() => {}),
  document: { querySelector: () => ({ addEventListener() {}, setAttribute() {}, removeAttribute() {} }) }
});
vm.runInContext(fs.readFileSync(path.join(root, 'static-data.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'stats.js'), 'utf8'), context);

test('statistics group reading dates by UTC, consistently with library filters', () => {
  assert.equal(vm.runInContext('toYear("2025-12-31T23:30:00-02:00")', context), 2026);
  assert.equal(vm.runInContext('toMonthKey("2025-12-31T23:30:00-02:00")', context), '2026-01');
  assert.equal(vm.runInContext('toYear("")', context), null);
  assert.equal(vm.runInContext('toMonthKey("invalid")', context), null);
});

test('monthly timeline includes months with no reads and handles year boundaries', () => {
  const entries = vm.runInContext('recentMonths(new Map([["2025-12", 2], ["2026-02", 3]]))', context);
  assert.deepEqual(Array.from(entries, (entry) => entry.value), [2, 0, 3]);
  assert.match(entries[0].label, /dic.*2025/);
  assert.match(entries[1].label, /ene.*2026/);
});

test('monthly timeline is bounded to twelve consecutive months ending at the latest reading', () => {
  const entries = vm.runInContext('recentMonths(new Map([["2020-01", 2], ["2026-02", 3]]))', context);
  assert.equal(entries.length, 12);
  assert.equal(entries[0].value, 0);
  assert.match(entries[0].label, /mar.*2025/);
  assert.equal(entries[11].value, 3);
  assert.equal(vm.runInContext('recentMonths(new Map()).length', context), 0);
  assert.equal(vm.runInContext('recentMonths(new Map([["2026-01", 1]])).length', context), 1);
});
