import { formatBookmark, parseBookmarks, urlKey } from './bookmarks.js';
import {
  DEFAULT_ROOT_LEVEL,
  DEEPEST_LEVEL,
  allBookmarks,
  contentLineMask,
  findBookmarkPath,
  headingLevel,
  normalizePath,
  parseBookmarkTree,
  regionEnd,
  removeBookmark,
} from './bookmark-tree.js';

/** @typedef {{ name: string, url: string }} Bookmark */
/** @typedef {import('./bookmark-tree.js').Group} Group */
/** @typedef {import('./bookmark-tree.js').BookmarkTree} BookmarkTree */

/**
 * @typedef {object} DropRow
 * @property {'group' | 'bookmark'} kind
 * @property {number} top
 * @property {number} bottom
 * @property {number} depth 0 for a top-level folder, one more for each level of nesting
 * @property {string[]} [path] folders: which folder the row is
 * @property {number} [ownBookmarks] folders: how many items sit directly under it
 * @property {boolean} [open] folders: whether its contents are on screen
 */

/**
 * @typedef {object} DropTarget
 * @property {string[]} parentPath the folder the row lands in, `[]` for the top level
 * @property {number} index where among that folder's own items, or children
 * @property {number} depth the depth the row is drawn at once it is there
 * @property {DropRow | null} placeBefore the row the dragged one would be drawn above, null for
 *   the end of the list
 */

/**
 * Where a dragged row would land. The vertical position picks the gap and the horizontal one
 * picks the depth, which is how a tree reads: right to go inside the row above, left to come
 * back out to the top level.
 *
 * @param {DropRow[]} rows the rows on screen, in the order they are drawn
 * @param {{
 *   kind: 'group' | 'bookmark',
 *   x: number,
 *   y: number,
 *   listLeft: number,
 *   indent: number,
 *   draggedPath?: string[],
 * }} pointer
 * @returns {DropTarget | null} null where that drop is not allowed
 */
export function resolveDrop(rows, { kind, x, y, listLeft, indent, draggedPath = [] }) {
  const candidates = kind === 'group' ? rows.filter((row) => row.kind === 'group') : rows;
  if (!candidates.length) return null;

  const gap = candidates.findIndex((row) => y < (row.top + row.bottom) / 2);
  const before = gap === -1 ? candidates.length : gap;

  return kind === 'group'
    ? folderTarget(candidates, before, x - listLeft - 2, indent, draggedPath)
    : bookmarkTarget(candidates, before);
}

/**
 * @param {DropRow[]} rows the rows on screen
 * @param {number} before how many of them sit above the pointer
 * @returns {DropTarget}
 */
function bookmarkTarget(rows, before) {
  const placeBefore = rows[before] ?? null;
  const ownerAt = rows.slice(0, before).findLastIndex((row) => row.kind === 'group');
  if (ownerAt === -1) {
    return { parentPath: [], index: countBetween(rows, 0, before, 'bookmark'), depth: 0, placeBefore };
  }

  const owner = rows[ownerAt];
  const index = owner.open
    ? countBetween(rows, ownerAt + 1, before, 'bookmark')
    : (owner.ownBookmarks ?? 0);

  return { parentPath: owner.path, index, depth: owner.depth + 1, placeBefore };
}

/**
 * @param {DropRow[]} rows the folder rows, which are the only ones a folder can land among
 * @param {number} before how many of them sit above the pointer
 * @param {number} offset the pointer's distance from the list's own left edge
 * @param {number} indent width of one level of nesting
 * @param {string[]} draggedPath
 * @returns {DropTarget | null}
 */
function folderTarget(rows, before, offset, indent, draggedPath) {
  const previous = rows[before - 1] ?? null;
  const depth = Math.max(0, Math.min(Math.round(offset / indent), (previous?.depth ?? -1) + 1));

  const parentAt = lastShallower(rows, before, depth);
  const parentPath = parentAt === -1 ? [] : rows[parentAt].path;
  if (isInside(parentPath, draggedPath)) return null;

  return {
    parentPath,
    index: countBetween(rows, parentAt + 1, before, 'group', depth),
    depth,
    placeBefore: rows[before] ?? null,
  };
}

/**
 * @param {DropRow[]} rows
 * @param {number} end
 * @param {number} depth
 * @returns {number} the last row above `end` that holds something at a shallower depth
 */
function lastShallower(rows, end, depth) {
  for (let index = end - 1; index >= 0; index -= 1) {
    if (rows[index].depth < depth) return index;
  }
  return -1;
}

/**
 * @param {DropRow[]} rows
 * @param {number} start
 * @param {number} end
 * @param {'group' | 'bookmark'} kind
 * @param {number} [depth]
 * @returns {number} rows of that kind, and depth, between the two positions
 */
function countBetween(rows, start, end, kind, depth) {
  return rows
    .slice(Math.max(start, 0), end)
    .filter((row) => row.kind === kind && (depth === undefined || row.depth === depth)).length;
}

/**
 * @param {string[]} path
 * @param {string[]} base
 * @returns {boolean} whether `path` is `base`, or sits inside it
 */
function isInside(path, base) {
  return (
    base.length > 0 && base.length <= path.length && base.every((name, at) => path[at] === name)
  );
}

/**
 * @param {BookmarkTree} tree
 * @param {string[]} path
 * @returns {Group | null} the folder at that path, `null` for the top level or a folder gone
 */
function groupAtPath(tree, path) {
  let siblings = tree.groups;
  let found = null;

  for (const name of path) {
    found = siblings.find((group) => group.name === name) ?? null;
    if (!found) return null;
    siblings = found.children;
  }
  return found;
}

/**
 * @param {BookmarkTree} tree
 * @param {string[]} path
 * @returns {Bookmark[]} the items sitting directly in that folder, or above every heading
 */
function itemsOf(tree, path) {
  return path.length ? (groupAtPath(tree, path)?.bookmarks ?? []) : tree.loose;
}

/**
 * @param {BookmarkTree} tree
 * @param {string[]} path
 * @returns {Group[]} the folders directly inside that one, or the top-level folders
 */
function childrenOf(tree, path) {
  return path.length ? (groupAtPath(tree, path)?.children ?? []) : tree.groups;
}

/**
 * @param {number} index the position asked for
 * @param {string[]} fromPath where the entry is now
 * @param {number} fromIndex where it sits among that folder's own contents
 * @param {string[]} toPath where it is going
 * @returns {number} that position, as it reads once the entry has been taken out first
 */
function shiftIndex(index, fromPath, fromIndex, toPath) {
  const sameFolder = fromPath.join('/') === toPath.join('/');
  return sameFolder && fromIndex !== -1 && fromIndex < index ? index - 1 : index;
}

/**
 * @param {string[]} lines
 * @param {boolean[]} isContent
 * @param {Group | null} owner the folder the item goes into, `null` for above every heading
 * @param {number} index
 * @returns {number} the line an item goes on to become the index-th item of that folder
 */
function itemLine(lines, isContent, owner, index) {
  const start = owner ? owner.headingLine : -1;
  const end = firstHeadingLine(lines, isContent, start + 1);
  const items = [];

  for (let line = start + 1; line < end; line += 1) {
    if (isContent[line] && parseBookmarks(lines[line]).length) items.push(line);
  }
  return index < items.length ? items[index] : (items.at(-1) ?? end - 1) + 1;
}

/**
 * @param {string[]} lines
 * @param {boolean[]} isContent
 * @param {number} from
 * @returns {number} the first heading line at or after `from`, or the end of the file
 */
function firstHeadingLine(lines, isContent, from = 0) {
  for (let line = Math.max(from, 0); line < lines.length; line += 1) {
    if (isContent[line] && headingLevel(lines[line]) !== null) return line;
  }
  return lines.length;
}

/**
 * @param {string[]} lines
 * @param {boolean[]} isContent
 * @param {BookmarkTree} tree
 * @param {string[]} parentPath the folder the block goes into, `[]` for the top level
 * @param {number} index
 * @returns {number} the line a folder block goes on to become the index-th child of that folder
 */
function childLine(lines, isContent, tree, parentPath, index) {
  const children = childrenOf(tree, parentPath);
  if (index < children.length) return children[index].headingLine;

  const parent = parentPath.length ? groupAtPath(tree, parentPath) : null;
  return parent ? regionEnd(lines, isContent, parent.headingLine, parent.level) : lines.length;
}

/**
 * @param {string} line
 * @param {number} delta
 * @returns {string} the line with its heading moved by that many levels
 */
function shiftedHeading(line, delta) {
  const level = headingLevel(line);
  return level === null ? line : line.replace(/^#{1,6}/, '#'.repeat(level + delta));
}

/**
 * @param {string} markdown
 * @param {{ url: string, to: { parentPath: string[], index: number } }} change `url` finds the
 *   bookmark being moved; `to` is where `resolveDrop` said it goes
 * @returns {{ markdown: string, groupId: string }}
 */
export function moveBookmark(markdown, { url, to }) {
  const text = String(markdown ?? '');
  const tree = parseBookmarkTree(text);
  const bookmark = allBookmarks(tree).find((entry) => urlKey(entry.url) === urlKey(url));
  if (!bookmark) throw new Error('That bookmark is not in the note.');

  const from = findBookmarkPath(tree, url) ?? [];
  const fromIndex = itemsOf(tree, from).findIndex((entry) => urlKey(entry.url) === urlKey(url));
  const target = normalizePath(to.parentPath);

  const { markdown: without } = removeBookmark(text, url);
  const after = parseBookmarkTree(without);
  const owner = target.length ? groupAtPath(after, target) : null;
  if (target.length && !owner) throw new Error(`The note has no “${target.join('/')}” folder.`);

  const lines = without.split('\n');
  const isContent = contentLineMask(without);
  const index = shiftIndex(to.index, from, fromIndex, target);
  const item = formatBookmark(bookmark, after.listMarker);

  lines.splice(itemLine(lines, isContent, owner, index), 0, item);
  return { markdown: lines.join('\n'), groupId: owner?.id ?? '' };
}

/**
 * @param {string} markdown
 * @param {{ path: string | string[], to: { parentPath: string[], index: number } }} change
 *   `path` finds the folder being moved, with everything under it; `to` is where `resolveDrop`
 *   said it goes
 * @returns {{ markdown: string, path: string[], level: number }}
 */
export function moveGroup(markdown, { path, to }) {
  const text = String(markdown ?? '');
  const tree = parseBookmarkTree(text);
  const from = normalizePath(path);
  const group = from.length ? groupAtPath(tree, from) : null;
  if (!group) throw new Error(`The note has no “${from.join('/')}” folder.`);

  const parentPath = normalizePath(to.parentPath);
  if (isInside(parentPath, from)) throw new Error(`“${group.name}” cannot go inside itself.`);

  const lines = text.split('\n');
  const isContent = contentLineMask(text);
  const end = regionEnd(lines, isContent, group.headingLine, group.level);
  const block = lines.slice(group.headingLine, end);

  const parent = parentPath.length ? groupAtPath(tree, parentPath) : null;
  if (parentPath.length && !parent) throw new Error(`The note has no “${parentPath.join('/')}” folder.`);

  const level = parent ? parent.level + 1 : (tree.rootLevel ?? DEFAULT_ROOT_LEVEL);
  const delta = level - group.level;
  const deepest = block.reduce(
    (deepest, line, offset) =>
      isContent[group.headingLine + offset]
        ? Math.max(deepest, headingLevel(line) ?? 0)
        : deepest,
    group.level,
  );
  if (deepest + delta > DEEPEST_LEVEL) {
    throw new Error(`“${group.name}” would nest deeper than markdown's ${DEEPEST_LEVEL} heading levels.`);
  }

  const siblings = from.slice(0, -1);
  const fromIndex = childrenOf(tree, siblings).findIndex((child) => child.name === group.name);

  lines.splice(group.headingLine, block.length);
  const without = lines.join('\n');
  const after = parseBookmarkTree(without);
  if (parentPath.length && !groupAtPath(after, parentPath)) {
    throw new Error(`The note has no “${parentPath.join('/')}” folder.`);
  }

  const index = shiftIndex(to.index, siblings, fromIndex, parentPath);
  const at = childLine(lines, contentLineMask(without), after, parentPath, index);
  const moved =
    delta === 0
      ? block
      : block.map((line, offset) =>
          isContent[group.headingLine + offset] ? shiftedHeading(line, delta) : line,
        );

  lines.splice(at, 0, ...moved);
  return { markdown: lines.join('\n'), path: [...parentPath, group.name], level };
}
