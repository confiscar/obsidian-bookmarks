import assert from 'node:assert/strict';
import test from 'node:test';

import { allBookmarks, allGroupIds, parseBookmarkTree } from '../src/core/bookmark-tree.js';
import { moveBookmark, moveGroup, resolveDrop } from '../src/core/reorder.js';

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

const lines = (...values) => values.join('\n');

const flatten = (groups) => groups.flatMap((group) => [group, ...flatten(group.children)]);
const folderIds = (markdown) => allGroupIds(parseBookmarkTree(markdown).groups);
const order = (markdown) => allBookmarks(parseBookmarkTree(markdown)).map(({ name }) => name);
const levelOf = (markdown, name) =>
  flatten(parseBookmarkTree(markdown).groups).find((group) => group.name === name)?.level ?? null;

const cssGradient = 'https://cssgradient.io/';
const tania = 'https://www.taniarascia.com/';
const spotify = 'https://open.spotify.com/';

test('a bookmark dropped above another one goes just above it, in that folder', () => {
  const moved = moveBookmark(FILE, {
    url: spotify,
    to: { parentPath: ['Music', 'Listen'], before: null },
  });

  assert.match(moved.markdown, /### Listen\n\* \[Spotify\]/);
  assert.equal(moved.groupId, 'Music/Listen');

  const above = moveBookmark(FILE, {
    url: spotify,
    to: { parentPath: ['Development'], before: cssGradient },
  });

  assert.deepEqual(order(above.markdown).slice(0, 3), ['Spotify', 'CSS Gradient', 'Tania Rascia']);
  assert.equal(above.groupId, 'Development');
  assert.equal(levelOf(above.markdown, 'Guides'), 3);
});

test('a bookmark reorders downwards within its own folder', () => {
  const moved = moveBookmark(FILE, {
    url: tania,
    to: { parentPath: ['Music', 'Listen'], before: null },
  });

  assert.deepEqual(order(moved.markdown).slice(0, 3), ['CSS Gradient', 'OneMotion', 'Spotify']);
  assert.equal(levelOf(moved.markdown, 'Listen'), 3);
  assert.match(moved.markdown, /### Listen\n\* \[Spotify\][^\n]*\n\* \[Tania Rascia\]/);
});

test('a bookmark sent to the top level lands above every heading', () => {
  const moved = moveBookmark(FILE, { url: spotify, to: { parentPath: [], before: null } });

  assert.equal(order(moved.markdown)[0], 'Spotify');
  assert.deepEqual(allBookmarks(parseBookmarkTree(moved.markdown))[0], {
    name: 'Spotify',
    url: spotify,
  });
});

test('a folder dropped above another one takes its place among its siblings', () => {
  const moved = moveGroup(FILE, { path: ['Music'], to: { parentPath: [], before: ['Development'] } });

  assert.deepEqual(folderIds(moved.markdown), [
    'Music',
    'Music/Production',
    'Music/Listen',
    'Development',
    'Development/Guides',
    'Piracy',
    'Piracy/Shopping',
  ]);
  assert.equal(levelOf(moved.markdown, 'Music'), 2);
  assert.equal(moved.markdown.split('\n').length, FILE.split('\n').length);
  assert.match(moved.markdown, /^## Music/);
});

test('a folder moved into another one takes its whole block down a level', () => {
  const moved = moveGroup(FILE, {
    path: ['Music'],
    to: { parentPath: ['Development'], before: null },
  });

  assert.equal(levelOf(moved.markdown, 'Music'), 3);
  assert.equal(levelOf(moved.markdown, 'Production'), 4);
  assert.equal(levelOf(moved.markdown, 'Listen'), 4);
  assert.match(moved.markdown, /### Music\n\n#### Production/);
});

test('a folder moved out to the top level takes the shallowest level going', () => {
  const moved = moveGroup(FILE, {
    path: ['Piracy', 'Shopping'],
    to: { parentPath: [], before: null },
  });

  assert.equal(levelOf(moved.markdown, 'Shopping'), 2);
  assert.equal(levelOf(moved.markdown, 'Piracy'), 1);
  assert.ok(folderIds(moved.markdown).includes('Shopping'));
  assert.ok(!folderIds(moved.markdown).includes('Piracy/Shopping'));
  assert.match(moved.markdown, /## Shopping[\s\S]*# Piracy/);
});

test('a folder dropped inside a folder two levels down lands at its level', () => {
  const moved = moveGroup(FILE, {
    path: ['Piracy'],
    to: { parentPath: ['Development', 'Guides'], before: null },
  });

  assert.equal(levelOf(moved.markdown, 'Piracy'), 4);
  assert.equal(levelOf(moved.markdown, 'Shopping'), 5);
});

test('a folder cannot be dropped inside itself or its own descendants', () => {
  assert.throws(
    () => moveGroup(FILE, { path: ['Music'], to: { parentPath: ['Music'], before: null } }),
    /cannot go inside itself/,
  );
  assert.throws(
    () => moveGroup(FILE, { path: ['Music'], to: { parentPath: ['Music', 'Listen'], before: null } }),
    /cannot go inside itself/,
  );
});

test('a folder that would nest past the sixth level is refused', () => {
  const note = lines(
    '## Top',
    '### Parent',
    '#### Sibling',
    '* [Amazon](https://www.amazon.co.uk/)',
    '#### Moving',
    '##### Deeper',
    '###### Deepest',
    '* [Spotify](https://open.spotify.com/)',
    '',
  );

  assert.throws(
    () =>
      moveGroup(note, {
        path: ['Top', 'Parent', 'Moving'],
        to: { parentPath: ['Top', 'Parent', 'Sibling'], before: null },
      }),
    /nest deeper/,
  );
});

test('a move that changes nothing leaves the note exactly as it was', () => {
  assert.equal(
    moveGroup(FILE, { path: ['Development', 'Guides'], to: { parentPath: ['Development'], before: null } })
      .markdown,
    FILE,
  );
  assert.equal(
    moveBookmark(FILE, { url: cssGradient, to: { parentPath: ['Development'], before: null } }).markdown,
    FILE,
  );
  assert.equal(
    moveBookmark(FILE, { url: cssGradient, to: { parentPath: ['Development'], before: cssGradient } })
      .markdown,
    FILE,
  );
  assert.equal(
    moveGroup(FILE, { path: ['Music'], to: { parentPath: [], before: ['Music'] } }).markdown,
    FILE,
  );
});

test('headings inside a code fence keep their level when the block moves', () => {
  const note = lines(
    '## Notes',
    '',
    '```',
    '# not a heading',
    '```',
    '',
    '## Music',
    '* [Spotify](https://open.spotify.com/)',
    '',
  );
  const moved = moveGroup(note, { path: ['Notes'], to: { parentPath: ['Music'], before: null } });

  assert.match(moved.markdown, /\n# not a heading\n/);
  assert.equal(levelOf(moved.markdown, 'Notes'), 3);
});

test('an entry that is not in the note cannot be moved', () => {
  assert.throws(
    () => moveBookmark(FILE, { url: 'https://nowhere.test/', to: { parentPath: [], before: null } }),
    /not in the note/,
  );
  assert.throws(
    () => moveGroup(FILE, { path: ['Nowhere'], to: { parentPath: [], before: null } }),
    /no “Nowhere” folder/,
  );
  assert.throws(
    () => moveBookmark(FILE, { url: spotify, to: { parentPath: ['Nowhere'], before: null } }),
    /no “Nowhere” folder/,
  );
});

const stack = (specs) =>
  specs.map((spec, position) => ({ ...spec, top: position * 20, bottom: position * 20 + 20 }));

const DRAWN = stack([
  { kind: 'group', depth: 0, path: ['Development'] },
  { kind: 'bookmark', depth: 1, url: cssGradient, parentPath: ['Development'] },
  { kind: 'group', depth: 1, path: ['Development', 'Guides'] },
  { kind: 'bookmark', depth: 2, url: tania, parentPath: ['Development', 'Guides'] },
  { kind: 'group', depth: 0, path: ['Music'] },
  { kind: 'bookmark', depth: 1, url: spotify, parentPath: ['Music'] },
]);

const drop = (pointer) =>
  resolveDrop(DRAWN, { x: 0, listLeft: 0, indent: 14, draggedPath: [], ...pointer });

const where = (target) =>
  target && {
    parentPath: target.parentPath,
    depth: target.depth,
    before: target.placeBefore ? (target.placeBefore.url ?? target.placeBefore.path) : null,
  };

test('a bookmark dropped between two rows joins the folder above them', () => {
  assert.deepEqual(where(drop({ kind: 'bookmark', y: 25 })), {
    parentPath: ['Development'],
    depth: 1,
    before: cssGradient,
  });
  assert.deepEqual(where(drop({ kind: 'bookmark', y: 45 })), {
    parentPath: ['Development'],
    depth: 1,
    before: ['Development', 'Guides'],
  });
  assert.deepEqual(where(drop({ kind: 'bookmark', y: 5 })), {
    parentPath: [],
    depth: 0,
    before: ['Development'],
  });
  assert.deepEqual(where(drop({ kind: 'bookmark', y: 500 })), {
    parentPath: ['Music'],
    depth: 1,
    before: null,
  });
});

test('a folder dropped among folders only counts folders', () => {
  assert.deepEqual(where(drop({ kind: 'group', y: 45, x: 16 })), {
    parentPath: ['Development'],
    depth: 1,
    before: ['Development', 'Guides'],
  });
  assert.deepEqual(where(drop({ kind: 'group', y: 55, x: 16 })), {
    parentPath: ['Development'],
    depth: 1,
    before: ['Music'],
  });
  assert.deepEqual(where(drop({ kind: 'group', y: 65 })), {
    parentPath: [],
    depth: 0,
    before: ['Music'],
  });
});

test('the horizontal position decides the depth, one level below the row above at most', () => {
  assert.equal(drop({ kind: 'group', y: 65, x: 0 }).depth, 0);
  assert.equal(drop({ kind: 'group', y: 65, x: 16 }).depth, 1);
  assert.equal(drop({ kind: 'group', y: 65, x: 60 }).depth, 2);
  assert.equal(drop({ kind: 'group', y: 45, x: 60 }).depth, 1);
});

test('a folder cannot be dropped into itself', () => {
  assert.equal(drop({ kind: 'group', y: 45, x: 16, draggedPath: ['Development'] }), null);
  assert.equal(drop({ kind: 'group', y: 25, x: 16, draggedPath: ['Development'] }), null);
  assert.notEqual(drop({ kind: 'group', y: 65, x: 0, draggedPath: ['Development'] }), null);
});

const SECTIONS = stack([
  { kind: 'group', depth: 0, path: ['Unread'], section: true },
  { kind: 'group', depth: 0, path: ['Development'] },
  { kind: 'bookmark', depth: 1, url: cssGradient, parentPath: ['Development'] },
  { kind: 'group', depth: 0, path: ['Read'], section: true },
]);

test('the read later sections are not folders, so nothing lands in one', () => {
  assert.equal(
    resolveDrop(SECTIONS, { kind: 'bookmark', x: 0, y: 25, listLeft: 0, indent: 14 }),
    null,
  );
  assert.deepEqual(
    where(resolveDrop(SECTIONS, { kind: 'bookmark', x: 0, y: 45, listLeft: 0, indent: 14 })),
    { parentPath: ['Development'], depth: 1, before: cssGradient },
  );
  assert.deepEqual(
    resolveDrop(SECTIONS, { kind: 'group', x: 8, y: 65, listLeft: 0, indent: 14 }).placeBefore,
    null,
  );
});

const PINS = stack([
  { kind: 'pin', depth: 1, url: cssGradient, name: 'CSS Gradient' },
  { kind: 'pin', depth: 1, url: spotify, name: 'Spotify' },
  { kind: 'group', depth: 0, path: ['Development'] },
]);

test('pinned rows reorder among themselves, and refuse a drop past them', () => {
  const toTop = resolveDrop(PINS, { kind: 'pin', x: 0, y: 5, listLeft: 0, indent: 14 });
  assert.deepEqual(where(toTop), { parentPath: [], depth: 1, before: cssGradient });

  const toEnd = resolveDrop(PINS, { kind: 'pin', x: 0, y: 35, listLeft: 0, indent: 14 });
  assert.deepEqual(where(toEnd), { parentPath: [], depth: 1, before: null });

  assert.equal(resolveDrop(PINS, { kind: 'pin', x: 0, y: 60, listLeft: 0, indent: 14 }), null);
});
