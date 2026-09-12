import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createFileStore, FileStoreError } from '../src/core/obsidian-file-store.js';
import { startFakeObsidian } from './helpers/fake-obsidian-server.mjs';

async function storeFor(server, overrides = {}) {
  const settings = {
    apiBase: server.url,
    apiKey: 'test-key',
    filePath: 'bookmarks.md',
    ...overrides,
  };
  return createFileStore({ getSettings: () => settings });
}

test('readText treats a missing file as empty', async (t) => {
  const server = await startFakeObsidian();
  t.after(() => server.close());
  const store = await storeFor(server);

  assert.equal(await store.readText(), '');
  assert.equal(server.requests.at(-1).path, '/vault/bookmarks.md');
});

test('readText returns file contents and authenticates', async (t) => {
  const server = await startFakeObsidian({ files: { 'bookmarks.md': '- [A](https://a.test)\n' } });
  t.after(() => server.close());
  const store = await storeFor(server);

  assert.equal(await store.readText(), '- [A](https://a.test)\n');
  assert.equal(server.requests.at(-1).authorization, 'Bearer test-key');
});

test('writeText stores the whole note, creating it when it does not exist', async (t) => {
  const server = await startFakeObsidian();
  t.after(() => server.close());
  const store = await storeFor(server);

  await store.writeText('## Music\n\n* [A](https://a.test)\n');

  assert.equal(await store.readText(), '## Music\n\n* [A](https://a.test)\n');
  const write = server.requests.filter((request) => request.method === 'PUT').at(-1);
  assert.equal(write.path, '/vault/bookmarks.md');
  assert.equal(write.contentType, 'text/markdown');
});

test('writeText replaces what the note already held', async (t) => {
  const server = await startFakeObsidian({ files: { 'bookmarks.md': 'stale\n' } });
  t.after(() => server.close());
  const store = await storeFor(server);

  await store.writeText('fresh\n');
  assert.equal(await store.readText(), 'fresh\n');
});

test('nested file paths are percent-encoded per segment', async (t) => {
  const server = await startFakeObsidian({ files: { 'notes/reading list.md': 'x' } });
  t.after(() => server.close());
  const store = await storeFor(server, { filePath: 'notes/reading list.md' });

  assert.equal(await store.readText(), 'x');
  assert.equal(
    server.requests.filter((request) => request.method === 'GET').at(-1).path,
    '/vault/notes/reading list.md',
  );
});

test('a folder target is refused instead of read as an empty list', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());
  const store = await storeFor(server, { filePath: 'Bookmarks' });

  const error = await store.readText().catch((caught) => caught);
  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /“Bookmarks” is a folder in your vault/);
  assert.match(await store.findTargetProblem(), /is a folder in your vault/);
});

test('writing to a folder is refused before anything is sent', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': 'x' } });
  t.after(() => server.close());
  const store = await storeFor(server, { filePath: 'Bookmarks' });

  const error = await store.writeText('- [A](https://a.test)\n').catch((caught) => caught);
  assert.ok(error instanceof FileStoreError);
  assert.deepEqual(
    server.requests.filter((request) => request.method === 'PUT'),
    [],
  );
});

test('a differently-spelled path still reads and saves the real note', async (t) => {
  const server = await startFakeObsidian({ files: { 'Bookmarks/Weblinks.md': '# Weblinks\n' } });
  t.after(() => server.close());
  const store = await storeFor(server, { filePath: 'bookmarks/weblinks.md' });

  assert.match(await store.findTargetProblem(), /Your vault has “Bookmarks\/Weblinks\.md”/);
  await store.writeText('# Weblinks\n* [A](https://a.test)\n');

  const write = server.requests.filter((request) => request.method === 'PUT').at(-1);
  assert.equal(write.path, '/vault/Bookmarks/Weblinks.md');
  assert.equal(server.vault.get('Bookmarks/Weblinks.md'), '# Weblinks\n* [A](https://a.test)\n');
  assert.equal(server.vault.size, 1);
  assert.equal(await store.readText(), '# Weblinks\n* [A](https://a.test)\n');
});

test('a 500 from the plugin is surfaced with its own message', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"files":[]}');
      return;
    }
    res
      .writeHead(500, { 'Content-Type': 'application/json' })
      .end('{"message":"File already exists.","errorCode":50000}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const store = createFileStore({
    getSettings: () => ({ apiBase: `http://127.0.0.1:${port}`, apiKey: 'k', filePath: 'x.md' }),
  });

  const error = await store.writeText('- [A](https://a.test)\n').catch((caught) => caught);
  assert.match(
    error.message,
    /Obsidian returned 500 Internal Server Error: File already exists\. \(errorCode 50000\)/,
  );
});

test('a non-JSON error body is still reported', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('kaboom');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const store = createFileStore({
    getSettings: () => ({ apiBase: `http://127.0.0.1:${port}`, apiKey: 'k', filePath: 'x.md' }),
  });

  const error = await store.readText().catch((caught) => caught);
  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /Obsidian returned 500 Internal Server Error: kaboom/);
});

test('a rejected API key explains what to do', async (t) => {
  const server = await startFakeObsidian();
  t.after(() => server.close());
  const store = await storeFor(server, { apiKey: 'wrong' });

  const error = await store.readText().catch((caught) => caught);
  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /API key/);
});

test('an unreachable Obsidian explains what to do', async (t) => {
  const server = await startFakeObsidian();
  const { url } = server;
  await server.close();

  const store = await storeFor({ url });
  const error = await store.readText().catch((caught) => caught);

  assert.ok(error instanceof FileStoreError);
  assert.match(error.message, /Can't reach Obsidian at http:\/\/127\.0\.0\.1:\d+/);
});

test('ping reports whether the REST API is up', async (t) => {
  const server = await startFakeObsidian();
  t.after(() => server.close());
  const store = await storeFor(server);

  assert.equal(await store.ping(), true);
  assert.equal(server.requests.at(-1).path, '/');
});
