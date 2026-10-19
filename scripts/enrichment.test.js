const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { test } = require('node:test');
const { enrichBooks, validateLibraryBooks } = require('../sync-goodreads');

const book = {
  bookId: '123',
  title: 'Example',
  author: 'Writer',
  url: 'https://www.goodreads.com/book/show/123',
  coverUrl: '',
  authorUrl: '',
  averageRating: 0
};
const metadata = {
  '@type': 'Book',
  image: 'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1i/123.jpg',
  author: [{ url: 'https://www.goodreads.com/author/show/456' }],
  aggregateRating: { ratingValue: 4.2 }
};
const html = `<script type="application/ld+json">${JSON.stringify(metadata)}</script>`;

function mockRequests(t, respond) {
  const urls = [];
  t.mock.method(https, 'get', (url, options, callback) => {
    assert.equal(options.headers['User-Agent'], 'Mozilla/5.0');
    urls.push(url);
    const req = new EventEmitter();
    req.setTimeout = (ms, handler) => {
      req.timeout = handler;
      assert.equal(ms, 20_000);
    };
    req.destroy = (error) => req.emit('error', error);
    process.nextTick(() => {
      const result = respond(url, urls.length);
      if (result.timeout) {
        req.timeout();
        return;
      }
      if (result.error) {
        req.emit('error', result.error);
        return;
      }
      const res = new EventEmitter();
      res.statusCode = result.status ?? 200;
      res.headers = result.location ? { location: result.location } : {};
      res.resume = () => {};
      callback(res);
      res.emit('data', result.body ?? '');
      res.emit('end');
    });
    return req;
  });
  return urls;
}

test('enriches from the exact book page before search and preserves reading data', async (t) => {
  const urls = mockRequests(t, () => ({ body: html }));
  const input = { ...book, rating: 4.5, exclusiveShelf: 'read', dateRead: '2026-10-18' };
  const [result] = await enrichBooks([input]);
  assert.deepEqual(urls, [book.url]);
  assert.deepEqual(result, {
    ...input,
    coverUrl: metadata.image,
    authorUrl: metadata.author[0].url,
    averageRating: 4.2
  });
});

test('does not refetch already cached metadata', async (t) => {
  const urls = mockRequests(t, () => { throw new Error('Unexpected request'); });
  const cached = { ...book, coverUrl: metadata.image, authorUrl: metadata.author[0].url, averageRating: 4.2 };
  assert.deepEqual(await enrichBooks([cached]), [cached]);
  assert.deepEqual(urls, []);
});

test('falls back to search after a failed book request', async (t) => {
  const urls = mockRequests(t, (url, count) =>
    count === 1 ? { error: new Error('Connection failed') } : { body: html });
  const [result] = await enrichBooks([book]);
  assert.equal(result.coverUrl, metadata.image);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /\/search\?/);
});

test('follows relative redirects to metadata', async (t) => {
  const urls = mockRequests(t, (url, count) =>
    count === 1 ? { status: 302, location: '/book/show/123-example' } : { body: html });
  const [result] = await enrichBooks([book]);
  assert.equal(result.coverUrl, metadata.image);
  assert.equal(urls[1], 'https://www.goodreads.com/book/show/123-example');
});

test('reports self-redirects instead of silently publishing missing covers', async (t) => {
  const urls = mockRequests(t, (url) => ({ status: 302, location: url }));
  const messages = [];
  const [result] = await enrichBooks([book], (message) => messages.push(message));
  assert.deepEqual(result, book);
  assert.ok(urls.length < 12);
  assert.ok(messages.some((message) => /WARNING:.*Example.*repeated Goodreads redirect/.test(message)));
});

test('bounds redirect chains and reports exhausted redirects', async (t) => {
  const urls = mockRequests(t, (url, count) => ({ status: 302, location: `/redirect/${count}` }));
  const messages = [];
  await enrichBooks([book], (message) => messages.push(message));
  assert.ok(urls.length <= 4 * 11);
  assert.ok(messages.some((message) => /WARNING:.*repeated Goodreads redirect/.test(message)));
});

test('times out a failed request and continues with search', async (t) => {
  mockRequests(t, (url, count) => count === 1 ? { timeout: true } : { body: html });
  const [result] = await enrichBooks([book]);
  assert.equal(result.coverUrl, metadata.image);
});

test('falls back after a malformed redirect instead of crashing', async (t) => {
  mockRequests(t, (url, count) =>
    count === 1 ? { status: 302, location: 'https://[' } : { body: html });
  const [result] = await enrichBooks([book]);
  assert.equal(result.coverUrl, metadata.image);
});

test('reports HTTP failures and missing cover integrity warnings', async (t) => {
  mockRequests(t, () => ({ status: 503 }));
  const messages = [];
  const [result] = await enrichBooks([book], (message) => messages.push(message));
  assert.ok(messages.some((message) => /WARNING:.*HTTP 503/.test(message)));
  assert.equal(validateLibraryBooks([result]).counts.missingCover, 1);
  assert.equal(validateLibraryBooks([{ ...book, coverUrl: metadata.image }]).counts.missingCover, 0);
});
