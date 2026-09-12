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

test('a folder target is refused instead of read as an empty list', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'Bookmarks' });

  const error = await store.readText().catch((caught) => caught);
  assert.match(error.message, /“Bookmarks” is a folder in your vault/);
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
  assert.match(problem, /“Bookmarks” is a folder/);
  assert.match(problem, /“Bookmarks\/bookmarks.md”/);
});

test('checkTarget catches an empty folder too', async (t) => {
  const server = await startFakeObsidian({ dirs: ['Archive'] });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'archive' });

  assert.match(await store.checkTarget(), /“Archive” is a folder/);
});

test('checkTarget reports a folder spelled with different case as a folder', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'bookmarks' });

  assert.match(await store.checkTarget(), /“Bookmarks” is a folder/);
});

test('checkTarget corrects a file whose spelling differs from the vault', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());

  // Read succeeds (the OS is case-insensitive) but Obsidian's index is not, so
  // this is the exact shape of a save that fails with "File already exists."
  const wrongFile = await withStore(server, { filePath: 'Bookmarks/weblinks.md' });
  assert.match(await wrongFile.store.checkTarget(), /Your vault has “Bookmarks\/Weblinks\.md”, not “Bookmarks\/weblinks\.md”/);

  const wrongFolder = await withStore(server, { filePath: 'bookmarks/Weblinks.md' });
  assert.match(await wrongFolder.store.checkTarget(), /Your vault has “Bookmarks\/Weblinks\.md”/);
});

test('checkTarget rejects paths that escape the vault', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());

  for (const filePath of ['../x.md', '..', '/../etc/hosts']) {
    const { store } = await withStore(server, { filePath });
    assert.match(await store.checkTarget(), /not a vault-relative path/, filePath);
  }
});

test('a path with stray segments is normalized', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());

  for (const filePath of ['./Bookmarks/Weblinks.md', 'Bookmarks//Weblinks.md']) {
    const { store } = await withStore(server, { filePath });
    assert.match(await store.checkTarget(), /points to “Bookmarks\/Weblinks\.md”/, filePath);
  }
});

test('a differently-spelled path still reads and saves the real note', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': '# Weblinks\n' } });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'bookmarks/weblinks.md' });

  assert.match(await store.checkTarget(), /Your vault has “Bookmarks\/Weblinks\.md”/);

  await store.appendLine('- [A](https://a.test)');

  const write = server.requests.filter((request) => request.method === 'POST').at(-1);
  assert.equal(write.path, '/vault/Bookmarks/Weblinks.md');
  assert.equal(server.vault.get('Bookmarks/Weblinks.md'), '# Weblinks\n- [A](https://a.test)\n');
  assert.equal(server.vault.size, 1, 'no second file was created');
  assert.equal(await store.readText(), '# Weblinks\n- [A](https://a.test)\n');
});

test('appending to a folder is refused before anything is written', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());
  const { store } = await withStore(server, { filePath: 'Bookmarks' });

  const error = await store.appendLine('- [A](https://a.test)').catch((caught) => caught);
  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /is a folder in your vault/);
  assert.deepEqual(
    server.requests.filter((request) => request.method === 'POST'),
    [],
  );
});

test('a 500 from the plugin is surfaced with its own message', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"files":[]}');
      return;
    }
    res
      .writeHead(500, { 'Content-Type': 'application/json' })
      .end('{"message":"File already exists.","errorCode":50000}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const store = createObsidianStore({
    getSettings: () => ({ apiBase: `http://127.0.0.1:${port}`, apiKey: 'k', filePath: 'x.md' }),
  });

  const error = await store.appendLine('- [A](https://a.test)').catch((caught) => caught);
  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /Obsidian returned 500 Internal Server Error: File already exists\. \(errorCode 50000\)/);
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
