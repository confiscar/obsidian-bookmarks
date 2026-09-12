import { favouriteKey } from '../core/front-matter.js';

/** @typedef {{ name: string, url: string }} Bookmark */

/** @param {string} url @returns {string} the host, or '' when the URL cannot be parsed */
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** @param {import('../core/bookmark-tree.js').Group} group @returns {number} links in this folder and below */
function countBookmarks(group) {
  return (
    group.bookmarks.length +
    group.children.reduce((total, child) => total + countBookmarks(child), 0)
  );
}

/**
 * Renders the pinned favourites, the bookmarks that sit above any heading, then the folder tree.
 * Folders are open unless their id is in `collapsed`; nesting is drawn with the `--depth`
 * custom property.
 *
 * @param {object} options
 * @param {Document} options.document
 * @param {HTMLElement} options.container the list element to fill
 * @param {import('../core/bookmark-tree.js').BookmarkTree} options.tree
 * @param {Set<string>} options.collapsed ids of the folders the user closed
 * @param {Bookmark[]} options.favourites entries read from the note's front matter, in file order
 * @param {boolean} options.favouritesOpen whether the pinned section is expanded
 * @param {(url: string) => void} options.onOpenBookmark
 * @param {(group: import('../core/bookmark-tree.js').Group) => void} options.onToggleGroup
 * @param {(bookmark: Bookmark) => void} options.onToggleFavourite
 * @param {() => void} options.onToggleFavouritesSection
 */
export function renderBookmarkList({
  document: doc,
  container,
  tree,
  collapsed,
  favourites,
  favouritesOpen,
  onOpenBookmark,
  onToggleGroup,
  onToggleFavourite,
  onToggleFavouritesSection,
}) {
  const favouriteKeys = new Set(favourites.map((bookmark) => favouriteKey(bookmark.url)));
  const rows = [];

  if (favourites.length) rows.push(...favouritesRows());
  for (const bookmark of tree.loose) rows.push(bookmarkRow(bookmark, 0));
  for (const group of tree.groups) rows.push(...groupRows(group, 0));

  container.replaceChildren(...rows);

  function favouritesRows() {
    const header = sectionRow({
      name: '★ Favourites',
      count: favourites.length,
      depth: 0,
      className: 'group favourites',
      open: favouritesOpen,
      onToggle: onToggleFavouritesSection,
    });

    if (!favouritesOpen) return [header];
    return [header, ...favourites.map((bookmark) => bookmarkRow(bookmark, 1))];
  }

  function groupRows(group, depth) {
    const open = !collapsed.has(group.id);
    const header = sectionRow({
      name: group.name,
      count: countBookmarks(group),
      depth,
      className: 'group',
      open,
      onToggle: () => onToggleGroup(group),
    });

    if (!open) return [header];
    return [
      header,
      ...group.bookmarks.map((bookmark) => bookmarkRow(bookmark, depth + 1)),
      ...group.children.flatMap((child) => groupRows(child, depth + 1)),
    ];
  }

  /**
   * @param {object} options
   * @param {string} options.name
   * @param {number} options.count
   * @param {number} options.depth
   * @param {string} options.className
   * @param {boolean} options.open
   * @param {() => void} options.onToggle
   */
  function sectionRow({ name, count, depth, className, open, onToggle }) {
    const row = doc.createElement('li');
    row.className = className;
    row.style.setProperty('--depth', String(depth));

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'group-toggle';
    toggle.textContent = name;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.addEventListener('click', onToggle);

    const countNode = doc.createElement('span');
    countNode.className = 'count';
    countNode.textContent = String(count);

    row.append(toggle, countNode);
    return row;
  }

  /** @param {Bookmark} bookmark */
  function bookmarkRow(bookmark, depth) {
    const row = doc.createElement('li');
    row.className = 'bookmark';
    row.style.setProperty('--depth', String(depth));

    const link = doc.createElement('a');
    link.href = bookmark.url;
    link.rel = 'noreferrer';
    link.textContent = bookmark.name;
    link.title = bookmark.url;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      onOpenBookmark(bookmark.url);
    });

    const host = doc.createElement('span');
    host.className = 'host';
    host.textContent = hostnameOf(bookmark.url);

    const text = doc.createElement('div');
    text.className = 'bookmark-text';
    text.append(link, host);

    const isFavourite = favouriteKeys.has(favouriteKey(bookmark.url));
    const star = doc.createElement('button');
    star.type = 'button';
    star.className = 'favourite';
    star.textContent = isFavourite ? '★' : '☆';
    star.title = isFavourite ? 'Remove from favourites' : 'Add to favourites';
    star.setAttribute('aria-pressed', String(isFavourite));
    star.addEventListener('click', () => onToggleFavourite(bookmark));

    row.append(text, star);
    return row;
  }
}
