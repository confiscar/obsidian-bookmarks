import { siteKey, urlKey } from '../core/bookmarks.js';
import { deleteIcon, editIcon, globeIcon, pinIcon } from './icons.js';

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
 * Renders the pinned bookmarks, then the bookmarks that sit above any heading, then the folder
 * tree. Folders are open unless their id is in `collapsed`; nesting is drawn with the `--depth`
 * custom property.
 *
 * @param {object} options
 * @param {Document} options.document
 * @param {HTMLElement} options.container the list element to fill
 * @param {import('../core/bookmark-tree.js').BookmarkTree} options.tree
 * @param {Set<string>} options.collapsed ids of the folders the user closed
 * @param {Bookmark[]} options.pinned entries read from the note's front matter, in file order
 * @param {boolean} options.pinnedOpen whether the pinned section is expanded
 * @param {Map<string, string | null>} options.icons site icons, keyed by site
 * @param {(url: string) => void} options.onOpenBookmark
 * @param {(group: import('../core/bookmark-tree.js').Group) => void} options.onToggleGroup
 * @param {(bookmark: Bookmark) => void} options.onTogglePinned
 * @param {(bookmark: Bookmark) => void} options.onEditBookmark
 * @param {(bookmark: Bookmark) => void} options.onDeleteBookmark
 * @param {() => void} options.onTogglePinnedSection
 */
export function renderBookmarkList({
  document: doc,
  container,
  tree,
  collapsed,
  pinned,
  pinnedOpen,
  icons,
  onOpenBookmark,
  onToggleGroup,
  onTogglePinned,
  onEditBookmark,
  onDeleteBookmark,
  onTogglePinnedSection,
}) {
  const pinnedKeys = new Set(pinned.map((bookmark) => urlKey(bookmark.url)));
  const rows = [];

  if (pinned.length) rows.push(...pinnedRows());
  for (const bookmark of tree.loose) rows.push(bookmarkRow(bookmark, 0));
  for (const group of tree.groups) rows.push(...groupRows(group, 0));

  container.replaceChildren(...rows);

  function pinnedRows() {
    const header = sectionRow({
      name: 'Pinned',
      icon: pinIcon(doc, { filled: true, size: 10 }),
      count: pinned.length,
      depth: 0,
      className: 'group pinned',
      open: pinnedOpen,
      onToggle: onTogglePinnedSection,
    });

    if (!pinnedOpen) return [header];
    return [header, ...pinned.map((bookmark) => bookmarkRow(bookmark, 1))];
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
   * @param {SVGElement} [options.icon]
   */
  function sectionRow({ name, count, depth, className, open, onToggle, icon }) {
    const row = doc.createElement('li');
    row.className = className;
    row.style.setProperty('--depth', String(depth));

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'group-toggle';
    if (icon) toggle.append(icon);
    toggle.append(name);
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

    const isPinned = pinnedKeys.has(urlKey(bookmark.url));
    const actions = doc.createElement('div');
    actions.className = 'row-actions';
    actions.append(
      actionButton({
        className: 'pin',
        title: isPinned ? 'Unpin this bookmark' : 'Pin this bookmark',
        pressed: isPinned,
        icon: pinIcon(doc, { filled: isPinned }),
        onClick: () => onTogglePinned(bookmark),
      }),
      actionButton({
        className: 'edit',
        title: 'Edit this bookmark',
        icon: editIcon(doc),
        onClick: () => onEditBookmark(bookmark),
      }),
      actionButton({
        className: 'delete',
        title: 'Delete this bookmark',
        icon: deleteIcon(doc, { size: 13 }),
        onClick: () => onDeleteBookmark(bookmark),
      }),
    );

    row.append(faviconSlot(bookmark), text, actions);
    return row;
  }

  /** @param {Bookmark} bookmark @returns {HTMLElement} a fixed slot, so rows stay aligned */
  function faviconSlot(bookmark) {
    const slot = doc.createElement('div');
    slot.className = 'favicon';

    const source = icons.get(siteKey(bookmark.url));
    if (!source) {
      slot.append(globeIcon(doc));
      return slot;
    }

    const image = doc.createElement('img');
    image.src = source;
    image.alt = '';
    image.addEventListener('error', () => slot.replaceChildren(globeIcon(doc)));
    slot.append(image);
    return slot;
  }

  /**
   * @param {object} options
   * @param {string} options.className
   * @param {string} options.title used as the accessible name too
   * @param {SVGElement} options.icon
   * @param {() => void} options.onClick
   * @param {boolean} [options.pressed] present for toggles
   */
  function actionButton({ className, title, icon, onClick, pressed }) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    button.setAttribute('aria-label', title);
    if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
    button.append(icon);
    button.addEventListener('click', onClick);
    return button;
  }
}
