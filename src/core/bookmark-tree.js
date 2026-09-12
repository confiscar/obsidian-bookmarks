import { formatBookmark, parseBookmarks } from './bookmarks.js';
import { frontMatterRange } from './front-matter.js';

/** @typedef {{ name: string, url: string }} Bookmark */

/**
 * @typedef {object} Group
 * @property {string} name heading text, e.g. `Production`
 * @property {number} level number of `#`s on the heading line
 * @property {string[]} path heading names from the root down to this one
 * @property {string} id `path` joined with `/`, used for display and as the expansion key
 * @property {number} headingLine 0-based index of the heading line in the file
 * @property {Bookmark[]} bookmarks links directly beneath this heading
 * @property {Group[]} children headings nested deeper
 */

/**
 * @typedef {object} BookmarkTree
 * @property {number | null} rootLevel the level this file uses for its top-level folders: the
 *   level it opens with. Null when the file has no headings at all.
 * @property {string} listMarker bullet character the file's existing bookmarks use, e.g. `*`
 * @property {Bookmark[]} loose bookmarks sitting above the first heading
 * @property {Group[]} groups
 */

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const LIST_ITEM = /^\s*([-*+])\s+\[/;
const DEFAULT_ROOT_LEVEL = 2;
const DEEPEST_LEVEL = 6;

/**
 * @param {string[]} lines
 * @returns {boolean[]} whether each line is a fence marker or sits inside a fenced code block
 */
function fencedLines(lines) {
  const fenced = [];
  let open = null;

  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fence && (!open || open === fence[1])) open = open ? null : fence[1];
    fenced.push(Boolean(open) || Boolean(fence));
  }
  return fenced;
}

/** @param {string} a @param {string} b */
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * Accepts `'Music/Production'` or `['Music', 'Production']`, and tolerates stray `#`, padding
 * and empty segments so that a typed value can be handed over as-is.
 * @param {string | string[]} path
 * @returns {string[]} heading names, outermost first
 */
export function normalizePath(path) {
  const segments = Array.isArray(path) ? path : String(path ?? '').split('/');
  return segments
    .flatMap((segment) => String(segment ?? '').split('/'))
    .map((segment) => segment.trim().replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * @param {string} markdown entire note
 * @returns {BookmarkTree}
 */
export function parseBookmarkTree(markdown) {
  const text = String(markdown ?? '');
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  const frontMatter = frontMatterRange(text);
  const loose = [];
  const groups = [];
  const stack = [];
  const markers = [];
  let rootLevel = null;

  lines.forEach((line, index) => {
    if (fenced[index]) return;
    if (frontMatter && index >= frontMatter.start && index <= frontMatter.end) return;

    const marker = LIST_ITEM.exec(line);
    if (marker) markers.push(marker[1]);

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (rootLevel === null) rootLevel = level;

      const group = { name: heading[2], level, headingLine: index, bookmarks: [], children: [] };
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      (parent ? parent.children : groups).push(group);
      stack.push(group);
      return;
    }

    const current = stack[stack.length - 1];
    for (const bookmark of parseBookmarks(line)) {
      (current ? current.bookmarks : loose).push(bookmark);
    }
  });

  const namePaths = (siblings, parentPath) => {
    for (const group of siblings) {
      group.path = [...parentPath, group.name];
      group.id = group.path.join('/');
      namePaths(group.children, group.path);
    }
  };
  namePaths(groups, []);

  return { rootLevel, listMarker: mostCommon(markers) ?? '-', loose, groups };
}

/** @param {string[]} values @returns {string | null} */
function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let best = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best?.value ?? null;
}

/**
 * @param {Group} group
 * @returns {string[]} this group's id followed by every descendant's, deepest last
 */
export function groupIds(group) {
  return [group.id, ...group.children.flatMap(groupIds)];
}

/** @param {Group[]} groups @returns {string[]} */
export function allGroupIds(groups) {
  return groups.flatMap(groupIds);
}

/**
 * Places a bookmark in a folder, appending whatever headings that folder still needs.
 * Everything already in the note is left alone.
 *
 * @param {string} markdown entire note
 * @param {{ path: string | string[], bookmark: Bookmark }} target folder — existing or not
 * @returns {{ markdown: string, groupId: string }} the updated note and the folder it went into
 */
export function insertBookmark(markdown, { path, bookmark }) {
  const names = normalizePath(path);
  if (!names.length) throw new Error('A folder is required to save a bookmark.');

  const text = String(markdown ?? '');
  const tree = parseBookmarkTree(text);
  const lines = text.split('\n');
  const item = formatBookmark(bookmark, tree.listMarker);

  let group = null;
  let siblings = tree.groups;
  let missingAt = names.length;

  for (const [index, name] of names.entries()) {
    const found = siblings.find((candidate) => sameName(candidate.name, name));
    if (!found) {
      missingAt = index;
      break;
    }
    group = found;
    siblings = found.children;
  }

  if (missingAt === names.length) {
    insertAtRegionEnd(lines, group.headingLine, Infinity, item);
    return { markdown: lines.join('\n'), groupId: group.id };
  }

  const level = group ? group.level + 1 : tree.rootLevel ?? DEFAULT_ROOT_LEVEL;
  const missing = names.slice(missingAt);
  if (level + missing.length - 1 > DEEPEST_LEVEL) {
    throw new Error(`“${names.join('/')}” nests deeper than markdown's ${DEEPEST_LEVEL} heading levels.`);
  }

  const block = missing.flatMap((name, offset) => [
    ...(offset ? [''] : []),
    `${'#'.repeat(level + offset)} ${name}`,
  ]);
  block.push('', item, '');

  if (group) insertAtRegionEnd(lines, group.headingLine, group.level, block.join('\n'));
  else insertAtRegionEnd(lines, -1, level - 1, block.join('\n'));

  return { markdown: lines.join('\n'), groupId: (group?.path ?? []).concat(missing).join('/') };
}

/**
 * Inserts text at the end of a region: everything after `startLine` up to the first heading
 * that outranks `boundLevel`. That boundary is what keeps a new folder out of the section it
 * would otherwise be swallowed by, and what keeps a folder's own items above its subfolders.
 *
 * @param {string[]} lines mutated in place
 * @param {number} startLine heading the region belongs to, or -1 for the whole file
 * @param {number} boundLevel the first heading at or above this level ends the region
 * @param {string} text inserted as the region's last content
 */
function insertAtRegionEnd(lines, startLine, boundLevel, text) {
  const fenced = fencedLines(lines);
  let end = lines.length;

  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (fenced[index]) continue;
    const heading = HEADING.exec(lines[index]);
    if (heading && heading[1].length <= boundLevel) {
      end = index;
      break;
    }
  }

  let at = end;
  while (at > startLine + 1 && lines[at - 1].trim() === '') at -= 1;

  const insertion = text.split('\n');
  if (insertion[insertion.length - 1] === '' && lines[at]?.trim() === '') insertion.pop();
  lines.splice(at, 0, ...insertion);
}
