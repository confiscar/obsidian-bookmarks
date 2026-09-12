import { formatBookmarkLink, parseBookmarks, urlKey } from './bookmarks.js';

/** @typedef {{ name: string, url: string }} Bookmark */

const FENCE = '---';
const LIST_ITEM = /^\s*-\s*(.+)$/;
const EMPTY_LIST = '[]';
const VALID_KEY = /^[a-z][a-z0-9_-]*$/;

/**
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

/** @param {string} key */
function assertKey(key) {
  if (!VALID_KEY.test(key)) throw new Error(`“${key}” is not a front matter key.`);
}

/** @param {string} key @returns {RegExp} */
function keyLine(key) {
  assertKey(key);
  return new RegExp(`^${key}\\s*:\\s*(.*)$`);
}

/**
 * @param {string} markdown
 * @param {string} key front matter key, e.g. `pinned`
 * @returns {{
 *   range: { start: number, end: number } | null,
 *   keyLine: number | null,
 *   inline: string | null,
 *   listLines: number[],
 *   entries: { line: number, name: string, url: string }[],
 * }} where `inline` is whatever followed the key on its own line, `listLines` is every item
 * under the key and `entries` only the ones that hold a markdown link
 */
export function readMarked(markdown, key) {
  assertKey(key);

  const lines = String(markdown ?? '').split('\n');
  const range = frontMatterRange(markdown);
  if (!range) return { range: null, keyLine: null, inline: null, listLines: [], entries: [] };

  const pattern = keyLine(key);
  const entries = [];
  const listLines = [];
  let keyLineIndex = null;
  let inline = null;
  let collecting = false;

  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = lines[index];
    const match = pattern.exec(line);
    if (match) {
      keyLineIndex = index;
      inline = match[1].trim() || null;
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

  return { range, keyLine: keyLineIndex, inline, listLines, entries };
}

/**
 * @param {string} markdown entire note
 * @param {string} key front matter key, e.g. `read`
 * @param {Bookmark} bookmark
 * @returns {{ markdown: string, marked: boolean }} the updated note and the state it now holds
 */
export function toggleMarked(markdown, key, bookmark) {
  assertKey(key);

  const text = String(markdown ?? '');
  const state = readMarked(text, key);
  const wanted = urlKey(bookmark.url);
  const matches = state.entries.filter((entry) => urlKey(entry.url) === wanted);

  if (!matches.length) {
    if (state.inline && state.inline !== EMPTY_LIST) {
      throw new Error(
        `The “${key}” value in this note's front matter has to be a list on its own lines before it can be edited.`,
      );
    }
    return { markdown: withEntry(text, key, state, bookmark), marked: true };
  }

  const lines = text.split('\n');
  for (const entry of [...matches].sort((a, b) => b.line - a.line)) lines.splice(entry.line, 1);

  const kept = readMarked(lines.join('\n'), key);
  if (kept.keyLine !== null && !kept.listLines.length) lines.splice(kept.keyLine, 1);

  return { markdown: withoutEmptiedBlock(lines, key), marked: false };
}

/**
 * @param {string} text
 * @param {string} key
 * @param {ReturnType<typeof readMarked>} state
 * @param {Bookmark} bookmark
 * @returns {string} the note with the bookmark added to the front matter list
 */
function withEntry(text, key, state, bookmark) {
  const lines = text.split('\n');
  const entry = `  - ${yamlString(formatBookmarkLink(bookmark))}`;

  if (!state.range) {
    lines.unshift(FENCE, `${key}:`, entry, FENCE, '');
    return lines.join('\n');
  }

  if (state.keyLine === null) {
    lines.splice(state.range.end, 0, `${key}:`, entry);
    return lines.join('\n');
  }

  if (state.inline) {
    lines[state.keyLine] = `${key}:`;
    lines.splice(state.keyLine + 1, 0, entry);
    return lines.join('\n');
  }

  const lastEntry = state.entries.at(-1)?.line ?? state.keyLine;
  lines.splice(lastEntry + 1, 0, entry);
  return lines.join('\n');
}

/**
 * @param {string[]} lines the note, with marked lines already gone
 * @param {string} key
 * @returns {string} the note, minus a front matter block that no longer holds anything
 */
function withoutEmptiedBlock(lines, key) {
  const { range, keyLine: line } = readMarked(lines.join('\n'), key);
  if (!range || line !== null) return lines.join('\n');

  const body = lines.slice(range.start + 1, range.end);
  if (body.some((entry) => entry.trim())) return lines.join('\n');

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
/**
 * Moves one mark to another place in the list — the order the pinned rows above the folders are
 * shown in.
 *
 * @param {string} markdown
 * @param {string} key front matter key, e.g. `pinned`
 * @param {string} url the mark to move
 * @param {string | null} before the URL of the mark it goes above, null to go last
 * @returns {{ markdown: string }}
 */
export function moveMarked(markdown, key, url, before) {
  const text = String(markdown ?? '');
  const state = readMarked(text, key);
  const wanted = urlKey(url);
  const from = state.entries.findIndex((entry) => urlKey(entry.url) === wanted);
  if (from === -1) throw new Error(`“${url}” has no ${key} mark to move.`);
  if (before !== null && urlKey(before) === wanted) return { markdown: text };

  const order = state.entries.map((entry) => urlKey(entry.url)).join('\n');
  const lines = text.split('\n');
  const [moved] = lines.splice(state.entries[from].line, 1);
  const rest = readMarked(lines.join('\n'), key);
  const target = before === null ? null : rest.entries.find((entry) => urlKey(entry.url) === urlKey(before));
  const at = target ? target.line : (rest.entries.at(-1)?.line ?? rest.keyLine ?? 0) + 1;

  lines.splice(at, 0, moved);
  const next = lines.join('\n');

  return readMarked(next, key).entries.map((entry) => urlKey(entry.url)).join('\n') === order
    ? { markdown: text }
    : { markdown: next };
}
