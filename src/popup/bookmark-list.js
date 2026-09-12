import { favouriteKey } from '../core/front-matter.js';

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
 * Renders the bookmarks that sit above any heading, then the folder tree. Folders are open
 * unless their id is in `collapsed`; nesting is drawn with the `--depth` custom property.
 *
 * @param {object} options
 * @param {Document} options.document
 * @param {HTMLElement} options.container the list element to fill
 * @param {import('../core/bookmark-tree.js').BookmarkTree} options.tree
 * @param {Set<string>} options.collapsed ids of the folders the user closed
 * @param {Set<string>} options.favourites keys of the URLs already listed in the front matter
 * @param {(url: string) => void} options.onOpenBookmark
 * @param {(group: import('../core/bookmark-tree.js').Group) => void} options.onToggleGroup
 * @param {(bookmark: { name: string, url: string }) => void} options.onToggleFavourite
 */
export function renderBookmarkList({
  document: doc,
  container,
  tree,
  collapsed,
  favourites,
  onOpenBookmark,
  onToggleGroup,
  onToggleFavourite,
}) {
  const rows = [];

  for (const bookmark of tree.loose) rows.push(bookmarkRow(bookmark, 0));
  for (const group of tree.groups) rows.push(...groupRows(group, 0));

  container.replaceChildren(...rows);

  /** @param {{ name: string, url: string }} bookmark */
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

    const isFavourite = favourites.has(favouriteKey(bookmark.url));
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

  function groupRows(group, depth) {
    const open = !collapsed.has(group.id);

    const row = doc.createElement('li');
    row.className = 'group';
    row.style.setProperty('--depth', String(depth));

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'group-toggle';
    toggle.textContent = group.name;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.addEventListener('click', () => onToggleGroup(group));

    const count = doc.createElement('span');
    count.className = 'count';
    count.textContent = String(countBookmarks(group));

    row.append(toggle, count);
    if (!open) return [row];

    return [
      row,
      ...group.bookmarks.map((bookmark) => bookmarkRow(bookmark, depth + 1)),
      ...group.children.flatMap((child) => groupRows(child, depth + 1)),
    ];
  }
}
