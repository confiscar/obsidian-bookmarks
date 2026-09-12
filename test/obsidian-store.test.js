import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createObsidianStore, FileStoreError } from '../src/core/obsidian-store.js';
import { startFakeObsidian } from './helpers/fake-obsidian-server.mjs';

async function withStore(server, overrides = {}) {
  const settings = {
    apiBase: server.url,
    apiKey: 'test-key',
    filePath: 'bookmarks.md',
    ...overrides,
  };
  return { settings, store: createObsidianStore({ getSettings: () => settings }) };
}

test('readText treats a missing file as empty', async (t) => {
  const server = await startFakeObsidian();
  t.after(() => server.close());
  const { store } = await withStore(server);

  assert.equal(await store.readText(), '');
  assert.equal(server.requests.at(-1).path, '/vault/bookmarks.md');
});

test('readText returns file contents and authenticates', async (t) => {
  const server = await startFakeObsidian({ files: { 'bookmarks.md': '- [A](https://a.test)\n' } });
  t.after(() => server.close());
  const { store } = await withStore(server);

  assert.equal(await store.readText(), '- [A](https://a.test)\n');
  assert.equal(server.requests.at(-1).authorization, 'Bearer test-key');
});

test('appendLine creates the file, then appends without losing content', async (t) => {
  const server = await startFakeObsidian();
  t.after(() => server.close());
  const { store } = await withStore(server);

  await store.appendLine('- [A](https://a.test)');
  await store.appendLine('- [B](https://b.test)');

  assert.equal(await store.readText(), '- [A](https://a.test)\n- [B](https://b.test)\n');
  const write = server.requests.filter((request) => request.method === 'POST').at(-1);
  assert.equal(write.method, 'POST');
  assert.equal(write.contentType, 'text/markdown');
  assert.ok(write.body.endsWith('\n'));
});

test('nested file paths are percent-encoded per segment', async (t) => {
  const server = await startFakeObsidian({ files: { 'notes/reading list.md': 'x' } });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'notes/reading list.md' });

  assert.equal(await store.readText(), 'x');
  assert.equal(server.requests.at(-1).path, '/vault/notes/reading list.md');
});

test('readText ignores a folder listing', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'Bookmarks' });

  assert.equal(await store.readText(), '');
});

test('checkTarget accepts a file that exists, and one that does not yet', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());

  const existing = await withStore(server, { filePath: 'Bookmarks/Weblinks.md' });
  assert.equal(await existing.store.checkTarget(), null);

  const future = await withStore(server, { filePath: 'Bookmarks/New.md' });
  assert.equal(await future.store.checkTarget(), null);

  const nowhere = await withStore(server, { filePath: 'Nope/deep/New.md' });
  assert.equal(await nowhere.store.checkTarget(), null);
});

test('checkTarget names the folder when the target is one', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'Bookmarks' });

  const problem = await store.checkTarget();
  assert.match(problem, /“Bookmarks\/” is a folder/);
  assert.match(problem, /“Bookmarks\/bookmarks.md”/);
});

test('checkTarget catches an empty folder too', async (t) => {
  const server = await startFakeObsidian({ dirs: ['Archive'] });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'archive' });

  assert.match(await store.checkTarget(), /“Archive\/” is a folder/);
});

test('appending to a folder surfaces the plugin message instead of a bare 500', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'Bookmarks' });

  const error = await store.appendLine('- [A](https://a.test)').catch((caught) => caught);
  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /Obsidian returned 500/);
  assert.match(error.message, /File already exists\./);
  assert.match(error.message, /errorCode 50001/);
});

test('a non-JSON error body is still reported', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('kaboom');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const store = createObsidianStore({
    getSettings: () => ({ apiBase: `http://127.0.0.1:${port}`, apiKey: 'k', filePath: 'x.md' }),
  });

  const error = await store.readText().catch((caught) => caught);
  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /Obsidian returned 500 Internal Server Error: kaboom/);
});

test('a rejected API key explains what to do', async (t) => {
  const server = await startFakeObsidian();
  t.after(() => server.close());
  const { store } = await withStore(server, { apiKey: 'wrong' });

  const error = await store.readText().catch((caught) => caught);
  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /API key/);
});

test('an unreachable Obsidian explains what to do', async (t) => {
  const server = await startFakeObsidian();
  const { url } = server;
  await server.close(); // that port is now closed for business

  const { store } = await withStore({ url });
  const error = await store.readText().catch((caught) => caught);

  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /Can't reach Obsidian at http:\/\/127\.0\.0\.1:\d+/);
});

test('ping reports whether the REST API is up', async (t) => {
  const server = await startFakeObsidian();
  t.after(() => server.close());
  const { store } = await withStore(server);

  assert.equal(await store.ping(), true);
  assert.equal(server.requests.at(-1).path, '/');
});
