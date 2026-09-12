import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeName, formatBookmark, normalizeUrl, parseBookmarks } from '../src/core/bookmarks.js';

test('parseBookmarks pulls links out in file order', () => {
  const markdown = [
    '# Bookmarks',
    '',
    '- [Sibling](https://example.com)',
    '- [Another](http://other.test/a?b=1)',
  ].join('\n');

  assert.deepEqual(parseBookmarks(markdown), [
    { name: 'Sibling', url: 'https://example.com' },
    { name: 'Another', url: 'http://other.test/a?b=1' },
  ]);
});

test('parseBookmarks skips images, wikilinks and non-http links', () => {
  const markdown = [
    '![shot](https://example.com/shot.png)',
    '[[Some note]]',
    '- [Mail](mailto:me@example.com)',
    '- [Local](/etc/hosts)',
    '- [Real](https://real.test)',
  ].join('\n');

  assert.deepEqual(parseBookmarks(markdown), [{ name: 'Real', url: 'https://real.test' }]);
});

test('parseBookmarks falls back to the URL when the name is empty', () => {
  assert.deepEqual(parseBookmarks('- [](https://bare.test)'), [
    { name: 'https://bare.test', url: 'https://bare.test' },
  ]);
});

test('parseBookmarks tolerates junk input', () => {
  assert.deepEqual(parseBookmarks(''), []);
  assert.deepEqual(parseBookmarks(undefined), []);
});

test('escapeName keeps list syntax intact', () => {
  assert.equal(escapeName('  Broken ] name\nhere '), 'Broken \\] name here');
});

test('formatBookmark escapes characters that would break the link', () => {
  assert.equal(
    formatBookmark({ name: 'Wiki (disambiguation)', url: 'https://en.test/wiki/Foo_(bar)' }),
    '- [Wiki (disambiguation)](https://en.test/wiki/Foo_%28bar%29)',
  );
});

test('formatBookmark respects the bullet the file already uses', () => {
  assert.equal(
    formatBookmark({ name: 'Example', url: 'https://example.com' }, '*'),
    '* [Example](https://example.com)',
  );
});

test('formatting then parsing round-trips a bookmark, with the URL percent-encoded', () => {
  const bookmark = { name: 'A ] tricky (one)', url: 'https://example.com/a_(b)' };
  const line = formatBookmark(bookmark);

  assert.deepEqual(parseBookmarks(line), [
    { name: 'A ] tricky (one)', url: 'https://example.com/a_%28b%29' },
  ]);
});

test('normalizeUrl adds a scheme, keeps it when present, rejects the rest', () => {
  assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
  assert.equal(normalizeUrl(' http://example.com '), 'http://example.com/');
  assert.equal(normalizeUrl('https://example.com/a b'), 'https://example.com/a%20b');
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl('   '), null);
  assert.equal(normalizeUrl('not a url'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('ftp://example.com'), null);
});
