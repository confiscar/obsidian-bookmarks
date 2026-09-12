import assert from 'node:assert/strict';
import test from 'node:test';

import { favouriteKey, frontMatterRange, readFavourites, toggleFavourite } from '../src/core/front-matter.js';

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

test('the first favourite brings its own front matter block', () => {
  const result = toggleFavourite(NOTE, chord);

  assert.equal(result.favourite, true);
  assert.equal(
    result.markdown,
    lines('---', 'favourites:', entry, '---', '', ...NOTE.split('\n')),
  );
});

test('clicking again removes the block it created, leaving the note as it was', () => {
  const added = toggleFavourite(NOTE, chord).markdown;
  const removed = toggleFavourite(added, chord);

  assert.equal(removed.favourite, false);
  assert.equal(removed.markdown, NOTE);
  assert.deepEqual(readFavourites(removed.markdown).entries, []);
});

test('existing front matter keeps its other keys, in place', () => {
  const note = lines('---', 'title: Weblinks', 'tags:', '  - links', '---', '', '## Music', '');
  const updated = toggleFavourite(note, chord).markdown;

  assert.equal(
    updated,
    lines('---', 'title: Weblinks', 'tags:', '  - links', 'favourites:', entry, '---', '', '## Music', ''),
  );
});

test('favourites accumulate in the order they were added', () => {
  const spotify = { name: 'Spotify', url: 'https://open.spotify.com/' };
  const once = toggleFavourite(NOTE, chord).markdown;
  const twice = toggleFavourite(once, spotify).markdown;

  assert.deepEqual(readFavourites(twice).entries.map((e) => e.name), ['Chord player', 'Spotify']);
  assert.equal(
    twice,
    lines('---', 'favourites:', entry, "  - '[Spotify](https://open.spotify.com/)'", '---', '', ...NOTE.split('\n')),
  );
});

test('removing one favourite leaves the others and the key behind', () => {
  const spotify = { name: 'Spotify', url: 'https://open.spotify.com/' };
  const both = toggleFavourite(toggleFavourite(NOTE, chord).markdown, spotify).markdown;
  const without = toggleFavourite(both, chord);

  assert.equal(without.favourite, false);
  assert.deepEqual(readFavourites(without.markdown).entries.map((e) => e.name), ['Spotify']);
  assert.ok(without.markdown.includes('favourites:'));
});

test('other front matter survives the last favourite leaving', () => {
  const note = lines('---', 'title: Weblinks', '---', '', '## Music', '');
  const added = toggleFavourite(note, chord).markdown;
  const removed = toggleFavourite(added, chord).markdown;

  assert.equal(removed, note);
});

test('a favourite is stored as the note spells its URL, and matched by its normalized form', () => {
  const bare = { name: 'A', url: 'https://a.test' };
  const added = toggleFavourite(NOTE, bare).markdown;

  assert.equal(readFavourites(added).entries[0].url, 'https://a.test');
  assert.equal(favouriteKey('https://a.test'), 'https://a.test/');
  assert.equal(toggleFavourite(added, { name: 'A', url: 'https://a.test/' }).favourite, false);
});

test('an empty inline list is rewritten into a list on its own lines', () => {
  const note = lines('---', 'favourites: []', '---', '', '## Music', '');
  const updated = toggleFavourite(note, chord).markdown;

  assert.equal(updated, lines('---', 'favourites:', entry, '---', '', '## Music', ''));
});

test('a hand-written inline list is refused rather than mangled', () => {
  const note = lines('---', 'favourites: ["[A](https://a.test/)"]', '---', '', '## Music', '');

  assert.throws(() => toggleFavourite(note, chord), /list on its own lines/);
});

test('items that are not links are left alone', () => {
  const note = lines('---', 'favourites:', "  - 'just a note'", "  - '[Real](https://real.test/)'", '---', '');
  const removed = toggleFavourite(note, { name: 'Real', url: 'https://real.test/' }).markdown;

  assert.equal(removed, lines('---', 'favourites:', "  - 'just a note'", '---', ''));
});

test('names with quotes and apostrophes survive the file', () => {
  const awkward = { name: `Dave's "best" song`, url: 'https://music.test/a b' };
  const added = toggleFavourite(NOTE, awkward).markdown;
  const line = added.split('\n')[2];

  assert.equal(line, "  - '[Dave''s \"best\" song](https://music.test/a%20b)'");
  assert.deepEqual(readFavourites(added).entries.map((e) => e.url), ['https://music.test/a%20b']);
});
