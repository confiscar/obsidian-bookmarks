import { formatBookmarkLink, normalizeUrl, parseBookmarks } from './bookmarks.js';

/** @typedef {{ name: string, url: string }} Bookmark */

const FENCE = '---';
const KEY = 'pinned';
const KEY_LINE = /^pinned\s*:\s*(.*)$/;
const LIST_ITEM = /^\s*-\s*(.+)$/;
const EMPTY_LIST = '[]';

/**
 * Front matter only counts when the note opens with it, which is also what Obsidian requires.
 * @param {string} markdown
 * @returns {{ start: number, end: number } | null} inclusive line indices of the two `---` fences
 */
export function frontMatterRange(markdown) {
  const lines = String(markdown ?? '').split('\n');
  if (lines[0]?.trim() !== FENCE) return null;

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === FENCE) return { start: 0, end: index };
  }
  return null;
}

/**
 * @param {string} markdown
 * @returns {{
 *   range: { start: number, end: number } | null,
 *   keyLine: number | null,
 *   inline: string | null,
 *   listLines: number[],
 *   entries: { line: number, name: string, url: string }[],
 * }} where `inline` is whatever followed `pinned:` on its own line, `listLines` is every item
 * under the key and `entries` only the ones that hold a markdown link
 */
export function readPinned(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const range = frontMatterRange(markdown);
  if (!range) return { range: null, keyLine: null, inline: null, listLines: [], entries: [] };

  const entries = [];
  const listLines = [];
  let keyLine = null;
  let inline = null;
  let collecting = false;

  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = lines[index];
    const key = KEY_LINE.exec(line);
    if (key) {
      keyLine = index;
      inline = key[1].trim() || null;
      collecting = !inline;
      continue;
    }
    if (!collecting) continue;

    const item = LIST_ITEM.exec(line);
    if (!item) {
      if (line.trim()) collecting = false;
      continue;
    }
    listLines.push(index);
    const [bookmark] = parseBookmarks(item[1]);
    if (bookmark) entries.push({ line: index, ...bookmark });
  }

  return { range, keyLine, inline, listLines, entries };
}

/** @param {string} url @returns {string} the form used to store and compare pinned URLs */
export function pinnedKey(url) {
  return normalizeUrl(url) ?? String(url);
}

/**
 * Adds the bookmark to the note's front matter, or removes it when it is already there.
 *
 * @param {string} markdown entire note
 * @param {Bookmark} bookmark
 * @returns {{ markdown: string, pinned: boolean }} the updated note and the state it now holds
 */
export function togglePinned(markdown, bookmark) {
  const text = String(markdown ?? '');
  const state = readPinned(text);
  const key = pinnedKey(bookmark.url);
  const matches = state.entries.filter((entry) => pinnedKey(entry.url) === key);

  if (!matches.length) {
    if (state.inline && state.inline !== EMPTY_LIST) {
      throw new Error(
        `The “${KEY}” value in this note's front matter has to be a list on its own lines before it can be edited.`,
      );
    }
    return { markdown: withEntry(text, state, bookmark), pinned: true };
  }

  const lines = text.split('\n');
  for (const entry of [...matches].sort((a, b) => b.line - a.line)) lines.splice(entry.line, 1);

  const kept = readPinned(lines.join('\n'));
  if (kept.keyLine !== null && !kept.listLines.length) lines.splice(kept.keyLine, 1);

  return { markdown: withoutEmptiedBlock(lines), pinned: false };
}

/**
 * @param {string} text
 * @param {ReturnType<typeof readPinned>} state
 * @param {Bookmark} bookmark
 * @returns {string} the note with the bookmark added to the front matter list
 */
function withEntry(text, state, bookmark) {
  const lines = text.split('\n');
  const entry = `  - ${yamlString(formatBookmarkLink(bookmark))}`;

  if (!state.range) {
    lines.unshift(FENCE, `${KEY}:`, entry, FENCE, '');
    return lines.join('\n');
  }

  if (state.keyLine === null) {
    lines.splice(state.range.end, 0, `${KEY}:`, entry);
    return lines.join('\n');
  }

  if (state.inline) {
    lines[state.keyLine] = `${KEY}:`;
    lines.splice(state.keyLine + 1, 0, entry);
    return lines.join('\n');
  }

  const lastEntry = state.entries.at(-1)?.line ?? state.keyLine;
  lines.splice(lastEntry + 1, 0, entry);
  return lines.join('\n');
}

/**
 * @param {string[]} lines the note, with pinned lines already gone
 * @returns {string} the note, minus a front matter block that no longer holds anything
 */
function withoutEmptiedBlock(lines) {
  const { range, keyLine } = readPinned(lines.join('\n'));
  if (!range || keyLine !== null) return lines.join('\n');

  const body = lines.slice(range.start + 1, range.end);
  if (body.some((line) => line.trim())) return lines.join('\n');

  lines.splice(range.end, 1);
  lines.splice(range.start, 1);
  if (lines[0]?.trim() === '') lines.shift();
  return lines.join('\n');
}

/**
 * @param {string} value
 * @returns {string} the value as a YAML single-quoted scalar, which leaves the markdown
 * untouched — an unquoted `[name](url)` is parsed as a flow sequence and breaks the front matter.
 */
function yamlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
