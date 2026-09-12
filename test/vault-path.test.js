import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVaultPath } from '../src/core/vault-path.js';

const VAULT = {
  '': ['Bookmarks/', 'bookmarks.md'],
  Bookmarks: ['Archive/', 'ReadLater.md', 'Weblinks.md'],
};

const listDirectory = async (directory) => VAULT[directory] ?? null;
const resolve = (filePath) => resolveVaultPath(filePath, listDirectory);

test('a path that matches the vault exactly is used as it is', async () => {
  assert.deepEqual(await resolve('Bookmarks/Weblinks.md'), {
    resolvedPath: 'Bookmarks/Weblinks.md',
    problem: null,
  });
  assert.deepEqual(await resolve('bookmarks.md'), {
    resolvedPath: 'bookmarks.md',
    problem: null,
  });
});

test('a file that does not exist yet is left for the first save to create', async () => {
  assert.deepEqual(await resolve('Bookmarks/New.md'), {
    resolvedPath: 'Bookmarks/New.md',
    problem: null,
  });
  assert.deepEqual(await resolve('Fresh/deep/New.md'), {
    resolvedPath: 'Fresh/deep/New.md',
    problem: null,
  });
});

test('a folder is refused, with a suggestion inside it', async () => {
  const root = await resolve('Bookmarks');
  assert.equal(root.resolvedPath, null);
  assert.match(root.problem, /“Bookmarks” is a folder in your vault, not a note/);
  assert.match(root.problem, /“Bookmarks\/bookmarks.md”/);

  const nested = await resolve('Bookmarks/Archive');
  assert.equal(nested.resolvedPath, null);
  assert.match(nested.problem, /“Bookmarks\/Archive” is a folder/);
});

test('a path spelled differently from the vault is corrected and reported', async () => {
  const misCasedFolder = await resolve('bookmarks/weblinks.md');
  assert.equal(misCasedFolder.resolvedPath, 'Bookmarks/Weblinks.md');
  assert.match(
    misCasedFolder.problem,
    /Your vault has “Bookmarks\/Weblinks\.md”, not “bookmarks\/weblinks\.md”/,
  );

  const misCasedFile = await resolve('Bookmarks/readlater.md');
  assert.equal(misCasedFile.resolvedPath, 'Bookmarks/ReadLater.md');
  assert.match(misCasedFile.problem, /Your vault has “Bookmarks\/ReadLater\.md”/);
});

test('a folder spelled differently is still reported as a folder', async () => {
  const { resolvedPath, problem } = await resolve('bookmarks');
  assert.equal(resolvedPath, null);
  assert.match(problem, /“Bookmarks” is a folder in your vault/);
});

test('stray segments are removed and reported', async () => {
  const { resolvedPath, problem } = await resolve('./Bookmarks//Weblinks.md');
  assert.equal(resolvedPath, 'Bookmarks/Weblinks.md');
  assert.match(problem, /points to “Bookmarks\/Weblinks\.md”/);
});

test('paths that are not vault-relative are refused', async () => {
  for (const filePath of ['../x.md', '..', '', '/', '/etc/hosts']) {
    const { resolvedPath, problem } = await resolve(filePath);
    assert.equal(resolvedPath, null, filePath);
    assert.match(problem, /is not a vault-relative path/, filePath);
  }
});

test('a file used as a folder is refused', async () => {
  const { resolvedPath, problem } = await resolve('bookmarks.md/nested.md');
  assert.equal(resolvedPath, null);
  assert.match(problem, /“bookmarks.md” is a file, so nothing can live inside it/);
});

test('a missing parent folder needs no correction', async () => {
  assert.deepEqual(await resolve('Archive/New.md'), {
    resolvedPath: 'Archive/New.md',
    problem: null,
  });
});
