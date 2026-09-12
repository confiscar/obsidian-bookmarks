import { formatBookmark, parseBookmarks, urlKey } from './bookmarks.js';
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
 * @param {string} markdown
 * @returns {boolean[]} whether each line holds note content
 */
function contentLines(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const fenced = fencedLines(lines);
  const frontMatter = frontMatterRange(markdown);

  return lines.map(
    (_, index) =>
      !fenced[index] && !(frontMatter && index >= frontMatter.start && index <= frontMatter.end),
  );
}

/**
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
  const content = contentLines(text);
  const loose = [];
  const groups = [];
  const stack = [];
  const markers = [];
  let rootLevel = null;

  lines.forEach((line, index) => {
    if (!content[index]) return;

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
 * @param {BookmarkTree} tree
 * @returns {Bookmark[]} every bookmark in the note, loose ones first
 */
export function allBookmarks(tree) {
  const collect = (groups) =>
    groups.flatMap((group) => [...group.bookmarks, ...collect(group.children)]);
  return [...tree.loose, ...collect(tree.groups)];
}

/**
 * @param {BookmarkTree} tree
 * @param {(bookmark: Bookmark) => boolean} keep
 * @returns {BookmarkTree} a tree of its own; the groups are new objects, so nothing is shared
 */
export function filterBookmarks(tree, keep) {
  const keepGroups = (groups) =>
    groups.flatMap((group) => {
      const children = keepGroups(group.children);
      const bookmarks = group.bookmarks.filter(keep);
      if (!bookmarks.length && !children.length) return [];

      const path = [...group.path];
      return [
        { ...group, path, id: path.join('/'), bookmarks, children },
      ];
    });

  return { ...tree, loose: tree.loose.filter(keep), groups: keepGroups(tree.groups) };
}

/**
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
  const content = contentLines(text);
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
    insertAtRegionEnd(lines, content, group.headingLine, Infinity, item);
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

  if (group) insertAtRegionEnd(lines, content, group.headingLine, group.level, block.join('\n'));
  else insertAtRegionEnd(lines, content, -1, level - 1, block.join('\n'));

  return { markdown: lines.join('\n'), groupId: (group?.path ?? []).concat(missing).join('/') };
}

/**
 * @param {string} markdown entire note
 * @param {string} url
 * @returns {number | null} index of the first line outside a code fence that links to that URL
 */
export function findBookmarkLine(markdown, url) {
  const text = String(markdown ?? '');
  const lines = text.split('\n');
  const content = contentLines(text);
  const wanted = urlKey(url);

  for (const [index, line] of lines.entries()) {
    if (!content[index]) continue;
    if (parseBookmarks(line).some((bookmark) => urlKey(bookmark.url) === wanted)) return index;
  }
  return null;
}

/**
 * @param {BookmarkTree} tree
 * @param {string} url
 * @returns {string[] | null} folder the bookmark sits in — `[]` for one above every heading —
 *   or null when the note does not hold it
 */
export function findBookmarkPath(tree, url) {
  const wanted = urlKey(url);
  if (tree.loose.some((bookmark) => urlKey(bookmark.url) === wanted)) return [];

  const search = (groups) => {
    for (const group of groups) {
      if (group.bookmarks.some((bookmark) => urlKey(bookmark.url) === wanted)) return group.path;
      const nested = search(group.children);
      if (nested) return nested;
    }
    return null;
  };
  return search(tree.groups);
}

/**
 * @param {string} markdown entire note
 * @param {string} url
 * @returns {{ markdown: string, removed: boolean }} the note without the lines that link to it
 */
export function removeBookmark(markdown, url) {
  const text = String(markdown ?? '');
  const lines = text.split('\n');
  const content = contentLines(text);
  const wanted = urlKey(url);

  const kept = lines.filter(
    (line, index) =>
      !content[index] ||
      !parseBookmarks(line).some((bookmark) => urlKey(bookmark.url) === wanted),
  );
  return { markdown: kept.join('\n'), removed: kept.length !== lines.length };
}

/**
 * @param {string} markdown entire note
 * @param {{ url: string, bookmark: Bookmark, path: string | string[] }} change `url` finds the
 *   bookmark being edited; `bookmark` is what it becomes
 * @returns {{ markdown: string, groupId: string }} the updated note and the folder it ended in
 */
export function updateBookmark(markdown, { url, bookmark, path }) {
  const text = String(markdown ?? '');
  const target = normalizePath(path);
  const tree = parseBookmarkTree(text);
  const line = findBookmarkLine(text, url);
  const content = contentLines(text);
  const current = findBookmarkPath(tree, url);

  const samePath =
    current !== null &&
    current.length === target.length &&
    current.every((name, index) => sameName(name, target[index]));

  const alreadyInPlace = line !== null && samePath && content[line];
  if (alreadyInPlace) {
    const lines = text.split('\n');
    lines[line] = formatBookmark(bookmark, tree.listMarker);
    return { markdown: lines.join('\n'), groupId: current.join('/') };
  }

  const { markdown: withoutOld } = removeBookmark(text, url);
  const inserted = insertBookmark(withoutOld, { path: target, bookmark });
  return { markdown: inserted.markdown, groupId: inserted.groupId };
}

/**
 * @param {string[]} lines mutated in place
 * @param {boolean[]} content which lines hold note content
 * @param {number} startLine heading the region belongs to, or -1 for the whole file
 * @param {number} boundLevel the first heading at or above this level ends the region
 * @param {string} text inserted as the region's last content
 */
function insertAtRegionEnd(lines, content, startLine, boundLevel, text) {
  let end = lines.length;

  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (!content[index]) continue;
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
