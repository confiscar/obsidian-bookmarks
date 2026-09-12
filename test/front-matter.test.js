import assert from 'node:assert/strict';
import test from 'node:test';

import { urlKey } from '../src/core/bookmarks.js';
import { frontMatterRange, moveMarked, readMarked, toggleMarked } from '../src/core/front-matter.js';

const NOTE = ['## Music', '', '* [OneMotion](https://www.onemotion.com/chord-player/)', ''].join('\n');
const chord = { name: 'Chord player', url: 'https://chords.test/player' };
const entry = "  - '[Chord player](https://chords.test/player)'";

const PIN = 'pinned';
const READ = 'read';

const lines = (...values) => values.join('\n');
const pin = (note, bookmark) => toggleMarked(note, PIN, bookmark);
const pins = (note) => readMarked(note, PIN).entries;

test('front matter counts only when the note opens with it', () => {
  assert.deepEqual(frontMatterRange(lines('---', 'title: x', '---', '')), { start: 0, end: 2 });
  assert.equal(frontMatterRange(lines('', '---', 'title: x', '---')), null);
  assert.equal(frontMatterRange(lines('---', 'title: x')), null);
  assert.equal(frontMatterRange(NOTE), null);
});

test('a note without the key reads as having nothing marked', () => {
  assert.deepEqual(readMarked(NOTE, READ), {
    range: null,
    keyLine: null,
    inline: null,
    listLines: [],
    entries: [],
  });
  assert.deepEqual(readMarked(lines('---', 'title: x', '---', ''), READ).entries, []);
});

test('the first pin brings its own front matter block', () => {
  const result = pin(NOTE, chord);

  assert.equal(result.marked, true);
  assert.equal(result.markdown, lines('---', 'pinned:', entry, '---', '', ...NOTE.split('\n')));
});

test('clicking again removes the block it created, leaving the note as it was', () => {
  const added = pin(NOTE, chord).markdown;
  const removed = pin(added, chord);

  assert.equal(removed.marked, false);
  assert.equal(removed.markdown, NOTE);
  assert.deepEqual(pins(removed.markdown), []);
});

test('existing front matter keeps its other keys, in place', () => {
  const note = lines('---', 'title: Weblinks', 'tags:', '  - links', '---', '', '## Music', '');
  const updated = pin(note, chord).markdown;

  assert.equal(
    updated,
    lines('---', 'title: Weblinks', 'tags:', '  - links', 'pinned:', entry, '---', '', '## Music', ''),
  );
});

test('marks accumulate in the order they were added', () => {
  const spotify = { name: 'Spotify', url: 'https://open.spotify.com/' };
  const once = pin(NOTE, chord).markdown;
  const twice = pin(once, spotify).markdown;

  assert.deepEqual(pins(twice).map((e) => e.name), ['Chord player', 'Spotify']);
  assert.equal(
    twice,
    lines('---', 'pinned:', entry, "  - '[Spotify](https://open.spotify.com/)'", '---', '', ...NOTE.split('\n')),
  );
});

test('removing one leaves the others and the key behind', () => {
  const spotify = { name: 'Spotify', url: 'https://open.spotify.com/' };
  const both = pin(pin(NOTE, chord).markdown, spotify).markdown;
  const without = pin(both, chord);

  assert.equal(without.marked, false);
  assert.deepEqual(pins(without.markdown).map((e) => e.name), ['Spotify']);
  assert.ok(without.markdown.includes('pinned:'));
});

test('other front matter survives the last mark leaving', () => {
  const note = lines('---', 'title: Weblinks', '---', '', '## Music', '');
  const added = pin(note, chord).markdown;
  const removed = pin(added, chord).markdown;

  assert.equal(removed, note);
});

test('two keys keep their own lists in the same note', () => {
  const note = lines('---', 'read:', entry, '---', '', ...NOTE.split('\n'));
  const both = toggleMarked(note, PIN, chord).markdown;

  assert.equal(
    both,
    lines('---', 'read:', entry, 'pinned:', entry, '---', '', ...NOTE.split('\n')),
  );
  assert.deepEqual(readMarked(both, READ).entries.map((e) => e.name), ['Chord player']);
  assert.deepEqual(readMarked(both, PIN).entries.map((e) => e.name), ['Chord player']);

  const readOnly = toggleMarked(both, READ, chord);
  assert.equal(readOnly.marked, false);
  assert.equal(readOnly.markdown, lines('---', 'pinned:', entry, '---', '', ...NOTE.split('\n')));
});

test('a mark is stored as the note spells its URL, and matched by its normalized form', () => {
  const bare = { name: 'A', url: 'https://a.test' };
  const added = pin(NOTE, bare).markdown;

  assert.equal(pins(added)[0].url, 'https://a.test');
  assert.equal(urlKey('https://a.test'), 'https://a.test/');
  assert.equal(pin(added, { name: 'A', url: 'https://a.test/' }).marked, false);
});

test('an empty inline list is rewritten into a list on its own lines', () => {
  const note = lines('---', 'pinned: []', '---', '', '## Music', '');
  const updated = pin(note, chord).markdown;

  assert.equal(updated, lines('---', 'pinned:', entry, '---', '', '## Music', ''));
});

test('a hand-written inline list is refused rather than mangled', () => {
  const note = lines('---', 'pinned: ["[A](https://a.test/)"]', '---', '', '## Music', '');

  assert.throws(() => pin(note, chord), /list on its own lines/);
});

test('a key that is not a plain front matter key is refused', () => {
  assert.throws(() => readMarked(NOTE, 'read later'), /front matter key/);
  assert.throws(() => toggleMarked(NOTE, 'yaml: x', chord), /front matter key/);
  assert.throws(
    () => toggleMarked(lines('---', 'title: x', '---', ''), 'Read', chord),
    /front matter key/,
  );
});

test('items that are not links are left alone', () => {
  const note = lines('---', 'pinned:', "  - 'just a note'", "  - '[Real](https://real.test/)'", '---', '');
  const removed = pin(note, { name: 'Real', url: 'https://real.test/' }).markdown;

  assert.equal(removed, lines('---', 'pinned:', "  - 'just a note'", '---', ''));
});

test('names with quotes and apostrophes survive the file', () => {
  const awkward = { name: `Dave's "best" song`, url: 'https://music.test/a b' };
  const added = pin(NOTE, awkward).markdown;
  const line = added.split('\n')[2];

  assert.equal(line, "  - '[Dave''s \"best\" song](https://music.test/a%20b)'");
  assert.deepEqual(pins(added).map((e) => e.url), ['https://music.test/a%20b']);
});

const THREE = lines(
  '---',
  'pinned:',
  "  - '[A](https://a.test/)'",
  "  - 'just a note'",
  "  - '[B](https://b.test/)'",
  "  - '[C](https://c.test/)'",
  'title: Weblinks',
  '---',
  '',
  '## Music',
  '',
);

test('a mark moves up and down the list, around the items that are not links', () => {
  const down = moveMarked(THREE, PIN, 'https://a.test/', 'https://c.test/').markdown;

  assert.equal(
    down,
    lines(
      '---',
      'pinned:',
      "  - 'just a note'",
      "  - '[B](https://b.test/)'",
      "  - '[A](https://a.test/)'",
      "  - '[C](https://c.test/)'",
      'title: Weblinks',
      '---',
      '',
      '## Music',
      '',
    ),
  );
  assert.deepEqual(
    readMarked(down, PIN).entries.map((entry) => entry.name),
    ['B', 'A', 'C'],
  );

  const up = moveMarked(down, PIN, 'https://c.test/', 'https://b.test/').markdown;
  assert.deepEqual(readMarked(up, PIN).entries.map((entry) => entry.name), ['C', 'B', 'A']);
  assert.ok(up.includes("  - 'just a note'"));
});

test('a mark sent to the end lands last, and one that is already there changes nothing', () => {
  const last = moveMarked(THREE, PIN, 'https://a.test/', null).markdown;

  assert.deepEqual(readMarked(last, PIN).entries.map((entry) => entry.name), ['B', 'C', 'A']);
  assert.equal(moveMarked(last, PIN, 'https://a.test/', null).markdown, last);
  assert.equal(moveMarked(THREE, PIN, 'https://a.test/', 'https://b.test/').markdown, THREE);
  assert.deepEqual(
    readMarked(moveMarked(THREE, PIN, 'https://b.test/', 'https://a.test/').markdown, PIN).entries.map(
      (entry) => entry.name,
    ),
    ['B', 'A', 'C'],
  );
});

test('a mark that is not in the list cannot be moved, and neither can one under a bad key', () => {
  assert.throws(() => moveMarked(THREE, PIN, 'https://nowhere.test/', null), /no pinned mark/);
  assert.throws(() => moveMarked(THREE, 'Read', 'https://a.test/', null), /front matter key/);
});

test('a mark dragged onto its own place leaves the note, hand-written items and all, alone', () => {
  assert.equal(moveMarked(THREE, PIN, 'https://a.test/', 'https://a.test/').markdown, THREE);
  assert.equal(moveMarked(THREE, PIN, 'https://a.test/', 'https://b.test/').markdown, THREE);

  const twice = moveMarked(THREE, PIN, 'https://c.test/', 'https://b.test/').markdown;
  assert.equal(moveMarked(twice, PIN, 'https://c.test/', 'https://b.test/').markdown, twice);
});
