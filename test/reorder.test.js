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
const spotify = 'https://open.spotify.com/';
const amazon = 'https://www.amazon.co.uk/';

test('a bookmark moves into another folder, at the position it was dropped', () => {
  const moved = moveBookmark(FILE, {
    url: cssGradient,
    to: { parentPath: ['Music', 'Listen'], index: 0 },
  });

  assert.equal(
    moved.markdown,
    lines(
      '## Development',
      '',
      '### Guides',
      '* [Tania Rascia](https://www.taniarascia.com/)',
      '## Music',
      '',
      '### Production',
      '* [OneMotion](https://www.onemotion.com/chord-player/)',
      '### Listen',
      '* [CSS Gradient](https://cssgradient.io/)',
      '* [Spotify](https://open.spotify.com/)',
      '',
      '# Piracy',
      '* [FreeMediaHeckYeah](https://fmhy.net/)',
      '## Shopping',
      '',
      '* [Amazon](https://www.amazon.co.uk/)',
      '',
    ),
  );
  assert.equal(moved.groupId, 'Music/Listen');
});

test('a bookmark reorders downwards within its folder', () => {
  const moved = moveBookmark(FILE, {
    url: cssGradient,
    to: { parentPath: ['Development', 'Guides'], index: 1 },
  });

  assert.equal(order(moved.markdown).slice(0, 2).join(), 'Tania Rascia,CSS Gradient');
  assert.equal(levelOf(moved.markdown, 'Guides'), 3);
});

test('a bookmark reorders upwards within its folder', () => {
  const moved = moveBookmark(FILE, {
    url: 'https://www.taniarascia.com/',
    to: { parentPath: ['Development'], index: 0 },
  });

  assert.equal(order(moved.markdown).slice(0, 2).join(), 'Tania Rascia,CSS Gradient');
});

test('a bookmark dropped past the last one lands at the end of that folder', () => {
  const moved = moveBookmark(FILE, {
    url: cssGradient,
    to: { parentPath: ['Music', 'Listen'], index: 1 },
  });

  assert.match(moved.markdown, /\* \[Spotify\][^\n]*\n\* \[CSS Gradient\]/);
});

test('a bookmark can be dropped above every heading', () => {
  const moved = moveBookmark(FILE, { url: spotify, to: { parentPath: [], index: 0 } });

  assert.equal(order(moved.markdown)[0], 'Spotify');
  assert.deepEqual(allBookmarks(parseBookmarkTree(moved.markdown))[0], {
    name: 'Spotify',
    url: spotify,
  });
});

test('a folder reorders among its siblings', () => {
  const moved = moveGroup(FILE, { path: ['Music'], to: { parentPath: [], index: 0 } });

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
});

test('a folder moved into another one takes its whole block down a level', () => {
  const moved = moveGroup(FILE, {
    path: ['Music'],
    to: { parentPath: ['Development'], index: 1 },
  });

  assert.equal(levelOf(moved.markdown, 'Music'), 3);
  assert.equal(levelOf(moved.markdown, 'Production'), 4);
  assert.equal(levelOf(moved.markdown, 'Listen'), 4);
  assert.match(moved.markdown, /### Music\n\n#### Production/);
});

test('a folder moved out to the top level takes the shallowest level going', () => {
  const moved = moveGroup(FILE, { path: ['Piracy', 'Shopping'], to: { parentPath: [], index: 0 } });

  assert.equal(levelOf(moved.markdown, 'Shopping'), 2);
  assert.deepEqual(levelOf(moved.markdown, 'Piracy'), 1);
  assert.equal(folderIds(moved.markdown)[0], 'Shopping');
});

test('a folder dropped inside a folder two levels down lands at its level', () => {
  const moved = moveGroup(FILE, {
    path: ['Piracy'],
    to: { parentPath: ['Development', 'Guides'], index: 0 },
  });

  assert.equal(levelOf(moved.markdown, 'Piracy'), 4);
  assert.equal(levelOf(moved.markdown, 'Shopping'), 5);
});

test('a folder cannot be dropped inside itself or its own descendants', () => {
  assert.throws(
    () => moveGroup(FILE, { path: ['Music'], to: { parentPath: ['Music'], index: 0 } }),
    /cannot go inside itself/,
  );
  assert.throws(
    () => moveGroup(FILE, { path: ['Music'], to: { parentPath: ['Music', 'Listen'], index: 0 } }),
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
        to: { parentPath: ['Top', 'Parent', 'Sibling'], index: 0 },
      }),
    /nest deeper/,
  );
});

test('a move that changes nothing leaves the note exactly as it was', () => {
  const moved = moveGroup(FILE, { path: ['Development', 'Guides'], to: { parentPath: ['Development'], index: 1 } });

  assert.equal(moved.markdown, FILE);
  assert.equal(
    moveBookmark(FILE, { url: cssGradient, to: { parentPath: ['Development'], index: 0 } }).markdown,
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
  ).split('\n');
  const moved = moveGroup(note.join('\n'), { path: ['Notes'], to: { parentPath: ['Music'], index: 0 } });

  assert.match(moved.markdown, /\n# not a heading\n/);
  assert.equal(levelOf(moved.markdown, 'Notes'), 3);
});

test('a bookmark that is not in the note cannot be moved', () => {
  assert.throws(() => moveBookmark(FILE, { url: 'https://nowhere.test/', to: { parentPath: [], index: 0 } }), /not in the note/);
  assert.throws(() => moveGroup(FILE, { path: ['Nowhere'], to: { parentPath: [], index: 0 } }), /no “Nowhere” folder/);
});

const stack = (specs) =>
  specs.map((spec, position) => ({
    ...spec,
    top: position * 20,
    bottom: position * 20 + 20,
  }));

const DRAWN = stack([
  { kind: 'group', depth: 0, path: ['Development'], open: true, ownBookmarks: 1 },
  { kind: 'bookmark', depth: 1 },
  { kind: 'group', depth: 1, path: ['Development', 'Guides'], open: true, ownBookmarks: 1 },
  { kind: 'bookmark', depth: 2 },
  { kind: 'group', depth: 0, path: ['Music'], open: false, ownBookmarks: 1 },
  { kind: 'bookmark', depth: 1 },
]);

const drop = (pointer) => {
  const target = resolveDrop(DRAWN, { x: 0, listLeft: 0, indent: 14, draggedPath: [], ...pointer });
  return target && { parentPath: target.parentPath, index: target.index, depth: target.depth };
};

test('a bookmark dropped between two rows joins the folder above them', () => {
  assert.deepEqual(drop({ kind: 'bookmark', y: 25 }), {
    parentPath: ['Development'],
    index: 0,
    depth: 1,
  });
  assert.deepEqual(drop({ kind: 'bookmark', y: 45 }), {
    parentPath: ['Development'],
    index: 1,
    depth: 1,
  });
});

test('a bookmark dropped above the first folder goes above every heading', () => {
  assert.deepEqual(drop({ kind: 'bookmark', y: 5 }), { parentPath: [], index: 0, depth: 0 });
});

test('a bookmark dropped onto a closed folder lands at the end of its items', () => {
  assert.deepEqual(drop({ kind: 'bookmark', y: 105 }), {
    parentPath: ['Music'],
    index: 1,
    depth: 1,
  });
});

test('a folder dropped among folders only counts folders', () => {
  assert.deepEqual(drop({ kind: 'group', y: 45, x: 16 }), {
    parentPath: ['Development'],
    index: 0,
    depth: 1,
  });
  assert.deepEqual(drop({ kind: 'group', y: 55, x: 16 }), {
    parentPath: ['Development'],
    index: 1,
    depth: 1,
  });
  assert.deepEqual(drop({ kind: 'group', y: 65 }), { parentPath: [], index: 1, depth: 0 });
});

test('the horizontal position decides the depth, one level below the row above at most', () => {
  assert.equal(drop({ kind: 'group', y: 65, x: 0 }).depth, 0);
  assert.equal(drop({ kind: 'group', y: 65, x: 16 }).depth, 1);
  assert.equal(drop({ kind: 'group', y: 65, x: 60 }).depth, 2);
  assert.equal(drop({ kind: 'group', y: 45, x: 60 }).depth, 1);
  assert.equal(drop({ kind: 'group', y: 55, x: 60 }).depth, 2);
});

test('a folder cannot be dropped into itself', () => {
  assert.equal(drop({ kind: 'group', y: 45, x: 16, draggedPath: ['Development'] }), null);
  assert.equal(drop({ kind: 'group', y: 25, x: 16, draggedPath: ['Development'] }), null);
  assert.notEqual(drop({ kind: 'group', y: 65, x: 0, draggedPath: ['Development'] }), null);
});

test('a target says which row the dragged one would be drawn above', () => {
  const target = resolveDrop(DRAWN, { kind: 'bookmark', x: 0, y: 25, listLeft: 0, indent: 14 });

  assert.equal(target.placeBefore, DRAWN[1]);
  assert.equal(
    resolveDrop(DRAWN, { kind: 'bookmark', x: 0, y: 1000, listLeft: 0, indent: 14 }).placeBefore,
    null,
  );
});
