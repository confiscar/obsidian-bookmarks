import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allGroupIds,
  insertBookmark,
  normalizePath,
  parseBookmarkTree,
} from '../src/core/bookmark-tree.js';

const FILE = [
  '## Development',
  '',
  '* [CSS Gradient](https://cssgradient.io/)',
  '### Guides',
  '* [Tania Rascia](https://www.taniarascia.com/)',
  '## Music',
  '',
  '### Production',
  '* [OneMotion](https://www.onemotion.com/chord-player/)',
  '### Listen',
  '* [Spotify](https://open.spotify.com/)',
  '',
  '# Piracy',
  '* [FreeMediaHeckYeah](https://fmhy.net/)',
  '## Shopping',
  '',
  '* [Amazon](https://www.amazon.co.uk/)',
  '',
].join('\n');

const item = { name: 'New one', url: 'https://new.test/' };
const names = (groups) => groups.map((group) => group.name);
const flatten = (groups) => groups.flatMap((group) => [group, ...flatten(group.children)]);
const find = (groups, id) =>
  flatten(groups).find((group) => group.id.toLowerCase() === id.toLowerCase());
const inserted = (path) => {
  const result = insertBookmark(FILE, { path, bookmark: item });
  return { ...result, groups: parseBookmarkTree(result.markdown).groups };
};

test('headings become folders, nested by their level', () => {
  const tree = parseBookmarkTree(FILE);

  assert.deepEqual(names(tree.groups), ['Development', 'Music', 'Piracy']);
  assert.deepEqual(names(tree.groups[0].children), ['Guides']);
  assert.deepEqual(names(tree.groups[1].children), ['Production', 'Listen']);
  assert.deepEqual(names(tree.groups[2].children), ['Shopping']);
});

test('the level the file opens with is the root level', () => {
  assert.equal(parseBookmarkTree(FILE).rootLevel, 2);
  assert.equal(parseBookmarkTree('# Title\n\n## A\n\n## B').rootLevel, 1);
  assert.equal(parseBookmarkTree('# One\n\n# Two').rootLevel, 1);
  assert.equal(parseBookmarkTree('nothing but [A](https://a.test)').rootLevel, null);
});

test('a shallower heading later in the file keeps its own section', () => {
  const piracy = parseBookmarkTree(FILE).groups[2];

  assert.equal(piracy.name, 'Piracy');
  assert.equal(piracy.level, 1);
  assert.deepEqual(piracy.bookmarks.map((b) => b.name), ['FreeMediaHeckYeah']);
  assert.deepEqual(names(piracy.children), ['Shopping']);
});

test('links land in the folder above them, and loose ones stay loose', () => {
  const tree = parseBookmarkTree(FILE);

  assert.deepEqual(tree.loose, []);
  assert.deepEqual(tree.groups[0].bookmarks.map((b) => b.name), ['CSS Gradient']);
  assert.deepEqual(tree.groups[1].children[0].bookmarks.map((b) => b.name), ['OneMotion']);

  const withPreamble = parseBookmarkTree(`* [Top](https://top.test)\n\n${FILE}`);
  assert.deepEqual(withPreamble.loose.map((b) => b.name), ['Top']);
});

test('folder ids are the path, and descendants can be listed', () => {
  const tree = parseBookmarkTree(FILE);

  assert.equal(tree.groups[1].id, 'Music');
  assert.equal(tree.groups[1].children[0].id, 'Music/Production');
  assert.deepEqual(allGroupIds(tree.groups), [
    'Development',
    'Development/Guides',
    'Music',
    'Music/Production',
    'Music/Listen',
    'Piracy',
    'Piracy/Shopping',
  ]);
});

test('front matter is not read as headings or bookmarks', () => {
  const note = [
    '---',
    'favourites:',
    "  - '[A](https://a.test/)'",
    'title: ## Nope',
    '---',
    '',
    '## Real',
    '',
    '* [B](https://b.test)',
  ].join('\n');
  const tree = parseBookmarkTree(note);

  assert.deepEqual(names(tree.groups), ['Real']);
  assert.deepEqual(tree.loose, []);
  assert.deepEqual(tree.groups[0].bookmarks.map((b) => b.name), ['B']);
  assert.equal(tree.rootLevel, 2);
  assert.equal(tree.listMarker, '*');
});

test('headings and links inside a fenced block are ignored', () => {
  const tree = parseBookmarkTree(
    ['## Real', '', '```', '## Fake', '* [Nope](https://nope.test)', '```', ''].join('\n'),
  );

  assert.deepEqual(names(tree.groups), ['Real']);
  assert.deepEqual(tree.groups[0].bookmarks, []);
});

test("the file's own bullet marker is reused", () => {
  assert.equal(parseBookmarkTree(FILE).listMarker, '*');
  assert.equal(parseBookmarkTree('- [A](https://a.test)').listMarker, '-');
  assert.equal(parseBookmarkTree('## Empty').listMarker, '-');
});

test('a bookmark goes to the end of the folder it was dropped in', () => {
  const { markdown, groups } = inserted('Music/Production');

  assert.ok(
    markdown.includes('* [OneMotion](https://www.onemotion.com/chord-player/)\n* [New one](https://new.test/)\n### Listen'),
  );
  assert.deepEqual(find(groups, 'Music/Production').bookmarks.map((b) => b.name), [
    'OneMotion',
    'New one',
  ]);
});

test('a folder with subfolders keeps its own items above them', () => {
  const { markdown, groups } = inserted('Music');

  assert.ok(markdown.includes('## Music\n* [New one](https://new.test/)\n\n### Production'));
  assert.deepEqual(find(groups, 'Music').bookmarks.map((b) => b.name), ['New one']);
});

test('a missing folder is created at the root level, above a shallower heading', () => {
  const { markdown, groupId } = insertBookmark(FILE, { path: 'Unsorted', bookmark: item });
  const groups = parseBookmarkTree(markdown).groups;

  assert.equal(groupId, 'Unsorted');
  assert.ok(markdown.includes('## Unsorted\n\n* [New one](https://new.test/)\n'));
  assert.ok(markdown.indexOf('## Unsorted') < markdown.indexOf('# Piracy'));
  assert.equal(find(groups, 'Unsorted').level, 2);
  assert.deepEqual(names(groups), ['Development', 'Music', 'Unsorted', 'Piracy']);
});

test('a missing nested folder creates every heading it needs', () => {
  const { markdown, groupId } = insertBookmark(FILE, { path: 'Unsorted/Unsorted 2', bookmark: item });
  const groups = parseBookmarkTree(markdown).groups;

  assert.equal(groupId, 'Unsorted/Unsorted 2');
  assert.ok(markdown.includes('## Unsorted\n\n### Unsorted 2\n\n* [New one](https://new.test/)\n'));
  assert.equal(find(groups, 'Unsorted/Unsorted 2').level, 3);
  assert.deepEqual(names(find(groups, 'Unsorted').children), ['Unsorted 2']);
});

test('a missing subfolder is appended after the subfolders already there', () => {
  const { markdown, groups } = inserted('Music/Djing');
  const music = find(groups, 'Music');

  assert.deepEqual(names(music.children), ['Production', 'Listen', 'Djing']);
  assert.equal(music.children[2].level, 3);
  assert.ok(markdown.indexOf('### Djing') < markdown.indexOf('# Piracy'));
});

test('a file that opens with an h1 title creates h1 folders', () => {
  const titled = '# Title\n\n## A\n\n* [A](https://a.test)\n';
  const { markdown, groupId } = insertBookmark(titled, { path: 'Unsorted', bookmark: item });

  assert.equal(groupId, 'Unsorted');
  assert.ok(markdown.endsWith('# Unsorted\n\n* [New one](https://new.test/)\n'));
  assert.deepEqual(names(parseBookmarkTree(markdown).groups), ['Title', 'Unsorted']);
});

test('folder lookup ignores case, and the stored path keeps the file spelling', () => {
  const { markdown, groupId } = inserted('music/production');

  assert.equal(groupId, 'Music/Production');
  assert.ok(markdown.includes('* [New one](https://new.test/)\n### Listen'));
});

test('a typed path is normalized before use', () => {
  assert.deepEqual(normalizePath('  ## Music /  production '), ['Music', 'production']);
  assert.deepEqual(normalizePath(['Unsorted', '', 'Unsorted 2']), ['Unsorted', 'Unsorted 2']);
  assert.deepEqual(normalizePath('Music//Listen'), ['Music', 'Listen']);

  assert.equal(insertBookmark(FILE, { path: ' ## Music / listen ', bookmark: item }).groupId, 'Music/Listen');
});

test('nothing already in the file is lost', () => {
  const original = FILE.split('\n');
  const updated = insertBookmark(FILE, { path: 'Unsorted/New', bookmark: item }).markdown.split('\n');

  let matched = 0;
  for (const line of updated) if (line === original[matched]) matched += 1;
  assert.equal(matched, original.length);
});

test('a folder is required, and markdown cannot nest past h6', () => {
  assert.throws(() => insertBookmark(FILE, { path: '   ', bookmark: item }), /folder is required/);
  assert.throws(
    () => insertBookmark(FILE, { path: 'A/B/C/D/E/F', bookmark: item }),
    /deeper than markdown's 6 heading levels/,
  );
});
