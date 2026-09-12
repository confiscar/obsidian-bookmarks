import assert from 'node:assert/strict';
import test from 'node:test';

import { urlKey } from '../src/core/bookmarks.js';
import { frontMatterRange, readPinned, togglePinned } from '../src/core/front-matter.js';

const NOTE = ['## Music', '', '* [OneMotion](https://www.onemotion.com/chord-player/)', ''].join('\n');
const chord = { name: 'Chord player', url: 'https://chords.test/player' };
const entry = "  - '[Chord player](https://chords.test/player)'";

const lines = (...values) => values.join('\n');

test('front matter counts only when the note opens with it', () => {
  assert.deepEqual(frontMatterRange(lines('---', 'title: x', '---', '')), { start: 0, end: 2 });
  assert.equal(frontMatterRange(lines('', '---', 'title: x', '---')), null);
  assert.equal(frontMatterRange(lines('---', 'title: x')), null);
  assert.equal(frontMatterRange(NOTE), null);
});

test('the first pin brings its own front matter block', () => {
  const result = togglePinned(NOTE, chord);

  assert.equal(result.pinned, true);
  assert.equal(
    result.markdown,
    lines('---', 'pinned:', entry, '---', '', ...NOTE.split('\n')),
  );
});

test('clicking again removes the block it created, leaving the note as it was', () => {
  const added = togglePinned(NOTE, chord).markdown;
  const removed = togglePinned(added, chord);

  assert.equal(removed.pinned, false);
  assert.equal(removed.markdown, NOTE);
  assert.deepEqual(readPinned(removed.markdown).entries, []);
});

test('existing front matter keeps its other keys, in place', () => {
  const note = lines('---', 'title: Weblinks', 'tags:', '  - links', '---', '', '## Music', '');
  const updated = togglePinned(note, chord).markdown;

  assert.equal(
    updated,
    lines('---', 'title: Weblinks', 'tags:', '  - links', 'pinned:', entry, '---', '', '## Music', ''),
  );
});

test('pins accumulate in the order they were added', () => {
  const spotify = { name: 'Spotify', url: 'https://open.spotify.com/' };
  const once = togglePinned(NOTE, chord).markdown;
  const twice = togglePinned(once, spotify).markdown;

  assert.deepEqual(readPinned(twice).entries.map((e) => e.name), ['Chord player', 'Spotify']);
  assert.equal(
    twice,
    lines('---', 'pinned:', entry, "  - '[Spotify](https://open.spotify.com/)'", '---', '', ...NOTE.split('\n')),
  );
});

test('unpinning one leaves the others and the key behind', () => {
  const spotify = { name: 'Spotify', url: 'https://open.spotify.com/' };
  const both = togglePinned(togglePinned(NOTE, chord).markdown, spotify).markdown;
  const without = togglePinned(both, chord);

  assert.equal(without.pinned, false);
  assert.deepEqual(readPinned(without.markdown).entries.map((e) => e.name), ['Spotify']);
  assert.ok(without.markdown.includes('pinned:'));
});

test('other front matter survives the last pin leaving', () => {
  const note = lines('---', 'title: Weblinks', '---', '', '## Music', '');
  const added = togglePinned(note, chord).markdown;
  const removed = togglePinned(added, chord).markdown;

  assert.equal(removed, note);
});

test('a pin is stored as the note spells its URL, and matched by its normalized form', () => {
  const bare = { name: 'A', url: 'https://a.test' };
  const added = togglePinned(NOTE, bare).markdown;

  assert.equal(readPinned(added).entries[0].url, 'https://a.test');
  assert.equal(urlKey('https://a.test'), 'https://a.test/');
  assert.equal(togglePinned(added, { name: 'A', url: 'https://a.test/' }).pinned, false);
});

test('an empty inline list is rewritten into a list on its own lines', () => {
  const note = lines('---', 'pinned: []', '---', '', '## Music', '');
  const updated = togglePinned(note, chord).markdown;

  assert.equal(updated, lines('---', 'pinned:', entry, '---', '', '## Music', ''));
});

test('a hand-written inline list is refused rather than mangled', () => {
  const note = lines('---', 'pinned: ["[A](https://a.test/)"]', '---', '', '## Music', '');

  assert.throws(() => togglePinned(note, chord), /list on its own lines/);
});

test('items that are not links are left alone', () => {
  const note = lines('---', 'pinned:', "  - 'just a note'", "  - '[Real](https://real.test/)'", '---', '');
  const removed = togglePinned(note, { name: 'Real', url: 'https://real.test/' }).markdown;

  assert.equal(removed, lines('---', 'pinned:', "  - 'just a note'", '---', ''));
});

test('names with quotes and apostrophes survive the file', () => {
  const awkward = { name: `Dave's "best" song`, url: 'https://music.test/a b' };
  const added = togglePinned(NOTE, awkward).markdown;
  const line = added.split('\n')[2];

  assert.equal(line, "  - '[Dave''s \"best\" song](https://music.test/a%20b)'");
  assert.deepEqual(readPinned(added).entries.map((e) => e.url), ['https://music.test/a%20b']);
});
