import { formatBookmark, parseBookmarks, urlKey } from './bookmarks.js';
import {
  DEFAULT_ROOT_LEVEL,
  DEEPEST_LEVEL,
  allBookmarks,
  allGroupIds,
  contentLineMask,
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
 * @property {'group' | 'bookmark' | 'pin'} kind
 * @property {number} top
 * @property {number} bottom
 * @property {number} depth 0 for a top-level folder, one more for each level of nesting
 * @property {string[]} [path] folders: which folder the row is
 * @property {boolean} [section] folders: a heading the note does not have, so nothing lands in it
 * @property {string} [url] bookmarks and pins
 * @property {string} [name] bookmarks and pins
 * @property {string[]} [parentPath] bookmarks: the folder holding it, `[]` above every heading
 */

/**
 * @typedef {object} DropTarget
 * @property {string[]} parentPath the folder the row lands in, `[]` for the top level
 * @property {number} depth the depth the row is drawn at once it is there
 * @property {DropRow | null} placeBefore the row the dragged one goes above, null for the end
 */

/**
 * Where a dragged row would land. The vertical position picks the gap and the horizontal one
 * picks the depth, which is how a tree reads: right to go inside the row above, left to come
 * back out to the top level.
 *
 * Where it lands is named by the row below the gap rather than counted, because what is on
 * screen is not always the whole note: the read later view shows two halves of one file, and a
 * folder's children only appear in the half that holds them. Counting the rows between them
 * would count the wrong ones.
 *
 * @param {DropRow[]} rows the rows on screen, in the order they are drawn
 * @param {{
 *   kind: 'group' | 'bookmark' | 'pin',
 *   x: number,
 *   y: number,
 *   listLeft: number,
 *   indent: number,
 *   draggedPath?: string[],
 * }} pointer
 * @returns {DropTarget | null} null where that drop is not allowed
 */
export function resolveDrop(rows, { kind, x, y, listLeft, indent, draggedPath = [] }) {
  const folders =
    kind === 'group' ? rows.filter((row) => row.kind === 'group' && row.section !== true) : rows;
  const candidates = kind === 'pin' ? rows.filter((row) => row.kind === 'pin') : folders;
  if (!candidates.length) return null;

  const gap = candidates.findIndex((row) => y < (row.top + row.bottom) / 2);
  const before = gap === -1 ? candidates.length : gap;

  if (kind === 'pin') return pinnedTarget(candidates, before, y);
  if (kind === 'group') {
    return folderTarget(folders, before, x - listLeft - 2, indent, draggedPath);
  }
  return bookmarkTarget(candidates, before);
}

/**
 * @param {DropRow[]} rows every row on screen
 * @param {number} before how many of them sit above the pointer
 * @returns {DropTarget | null}
 */
function bookmarkTarget(rows, before) {
  const owner = rows.slice(0, before).findLast((row) => row.kind === 'group');
  if (owner?.section) return null;

  return {
    parentPath: owner?.path ?? [],
    depth: (owner?.depth ?? -1) + 1,
    placeBefore: rows[before] ?? null,
  };
}

/**
 * @param {DropRow[]} rows the pinned rows, in the order the front matter lists them
 * @param {number} before how many of them sit above the pointer
 * @param {number} y
 * @returns {DropTarget | null} null below the pinned rows, which are not the note's own order
 */
function pinnedTarget(rows, before, y) {
  if (y > rows.at(-1).bottom) return null;

  return { parentPath: [], depth: rows[0].depth, placeBefore: rows[before] ?? null };
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

  return { parentPath, depth, placeBefore: rows[before] ?? null };
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
 * @param {string[]} path
 * @param {string[]} base
 * @returns {boolean} whether `path` is `base`, or sits inside it
 */
function isInside(path, base) {
  return base.length > 0 && base.length <= path.length && base.every((name, at) => path[at] === name);
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
 * @returns {Group[]} the folders directly inside that one, or the top-level folders
 */
function childrenOf(tree, path) {
  return path.length ? (groupAtPath(tree, path)?.children ?? []) : tree.groups;
}

/**
 * @param {string[]} lines
 * @param {boolean[]} isContent
 * @param {number} from
 * @returns {number} the first heading line at or after `from`, or the end of the file
 */
function firstHeadingLine(lines, isContent, from) {
  for (let line = Math.max(from, 0); line < lines.length; line += 1) {
    if (isContent[line] && headingLevel(lines[line]) !== null) return line;
  }
  return lines.length;
}

/**
 * @param {string[]} lines
 * @param {boolean[]} isContent
 * @param {Group | null} owner the folder the item goes into, `null` for above every heading
 * @param {string | null} before the URL of the item it goes above, null for last
 * @returns {number} the line an item goes on to sit in that place
 */
function itemLine(lines, isContent, owner, before) {
  const start = owner ? owner.headingLine : -1;
  const end = firstHeadingLine(lines, isContent, start + 1);
  const wanted = before === null ? null : urlKey(before);
  const items = [];

  for (let line = start + 1; line < end; line += 1) {
    if (!isContent[line]) continue;

    const bookmarks = parseBookmarks(lines[line]);
    if (!bookmarks.length) continue;
    if (wanted !== null && bookmarks.some((entry) => urlKey(entry.url) === wanted)) return line;
    items.push(line);
  }
  return (items.at(-1) ?? end - 1) + 1;
}

/**
 * @param {string[]} lines
 * @param {boolean[]} isContent
 * @param {BookmarkTree} tree
 * @param {string[]} parentPath the folder the block goes into, `[]` for the top level
 * @param {string[] | null} before the path of the folder it goes above, null for last
 * @param {number} level the level the block will have, which is what keeps a top-level folder
 *   out of the reach of a shallower heading further down the file
 * @returns {number} the line a folder block goes on to sit in that place
 */
function childLine(lines, isContent, tree, parentPath, before, level) {
  const children = childrenOf(tree, parentPath);
  if (before !== null) {
    const wanted = before.join('/');
    const target = children.find((child) => child.path.join('/') === wanted);
    if (target) return target.headingLine;
  }

  const parent = parentPath.length ? groupAtPath(tree, parentPath) : null;
  return regionEnd(
    lines,
    isContent,
    parent ? parent.headingLine : -1,
    parent ? parent.level : level - 1,
  );
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
 * @returns {string} the bookmarks in the order the note holds them
 */
function bookmarkOrder(markdown) {
  return allBookmarks(parseBookmarkTree(markdown))
    .map((entry) => urlKey(entry.url))
    .join('\n');
}

/**
 * @param {string} markdown
 * @returns {string} the folders in the order the note holds them
 */
function folderOrder(markdown) {
  return allGroupIds(parseBookmarkTree(markdown).groups).join('\n');
}

/**
 * @param {string} markdown
 * @param {{ url: string, to: { parentPath: string[], before: string | null } }} change `url`
 *   finds the bookmark being moved; `before` is the URL of the item it goes above, or null
 * @returns {{ markdown: string, groupId: string }}
 */
export function moveBookmark(markdown, { url, to }) {
  const text = String(markdown ?? '');
  const tree = parseBookmarkTree(text);
  const bookmark = allBookmarks(tree).find((entry) => urlKey(entry.url) === urlKey(url));
  if (!bookmark) throw new Error('That bookmark is not in the note.');
  if (to.before !== null && urlKey(to.before) === urlKey(url)) return { markdown: text, groupId: '' };

  const parentPath = normalizePath(to.parentPath);
  const { markdown: without } = removeBookmark(text, url);
  const after = parseBookmarkTree(without);
  const owner = parentPath.length ? groupAtPath(after, parentPath) : null;
  if (parentPath.length && !owner) throw new Error(`The note has no “${parentPath.join('/')}” folder.`);

  const lines = without.split('\n');
  const isContent = contentLineMask(without);
  const item = formatBookmark(bookmark, after.listMarker);

  lines.splice(itemLine(lines, isContent, owner, to.before), 0, item);
  const next = lines.join('\n');

  return {
    markdown: bookmarkOrder(next) === bookmarkOrder(text) ? text : next,
    groupId: owner?.id ?? '',
  };
}

/**
 * @param {string} markdown
 * @param {{ path: string | string[], to: { parentPath: string[], before: string[] | null } }}
 *   change `path` finds the folder being moved, with everything under it; `before` is the path
 *   of the folder it goes above, or null
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

  const before = to.before === null ? null : normalizePath(to.before);
  if (before !== null && before.join('/') === from.join('/')) {
    return { markdown: text, path: from, level: group.level };
  }

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

  lines.splice(group.headingLine, block.length);
  const without = lines.join('\n');
  const after = parseBookmarkTree(without);
  if (parentPath.length && !groupAtPath(after, parentPath)) {
    throw new Error(`The note has no “${parentPath.join('/')}” folder.`);
  }

  const at = childLine(lines, contentLineMask(without), after, parentPath, before, level);
  const moved =
    delta === 0
      ? block
      : block.map((line, offset) =>
          isContent[group.headingLine + offset] ? shiftedHeading(line, delta) : line,
        );

  lines.splice(at, 0, ...moved);
  const next = lines.join('\n');

  return {
    markdown: folderOrder(next) === folderOrder(text) ? text : next,
    path: [...parentPath, group.name],
    level,
  };
}
