import { siteKey, urlKey } from '../core/bookmarks.js';
import { checkIcon, deleteIcon, editIcon, globeIcon, pinIcon } from './icons.js';

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
 * @param {object} options
 * @param {Document} options.document
 * @param {HTMLElement} options.container the list element to fill
 * @param {import('../core/bookmark-tree.js').BookmarkTree} options.tree
 * @param {Set<string>} options.collapsed ids of the folders the user closed
 * @param {Bookmark[]} options.pinned entries read from the note's front matter, in file order
 * @param {boolean} options.pinnedOpen whether the pinned section is expanded
 * @param {Map<string, string | null>} options.icons site icons, keyed by site
 * @param {'pin' | 'read'} [options.rowAction] what the first button on a row does: pin the
 *   bookmark, or mark it read — the read later note uses the second
 * @param {Set<string>} [options.read] keys of the bookmarks already marked read
 * @param {(url: string) => void} options.onOpenBookmark
 * @param {(group: import('../core/bookmark-tree.js').Group) => void} options.onToggleGroup
 * @param {(bookmark: Bookmark) => void} options.onTogglePinned
 * @param {(bookmark: Bookmark) => void} options.onToggleRead
 * @param {(bookmark: Bookmark) => void} options.onEditBookmark
 * @param {(bookmark: Bookmark) => void} options.onDeleteBookmark
 * @param {() => void} options.onTogglePinnedSection
 * @returns {{ rows: object[] }} every row that stands for something in the note, so a drag layer
 *   can tell what it is holding
 */
export function renderBookmarkList({
  document: doc,
  container,
  tree,
  collapsed,
  pinned,
  pinnedOpen,
  icons,
  rowAction = 'pin',
  read = new Set(),
  onOpenBookmark,
  onToggleGroup,
  onTogglePinned,
  onToggleRead,
  onEditBookmark,
  onDeleteBookmark,
  onTogglePinnedSection,
}) {
  const pinnedKeys = new Set(pinned.map((bookmark) => urlKey(bookmark.url)));
  const elements = [];
  const draggable = [];

  if (pinned.length) elements.push(...pinnedRows());
  for (const bookmark of tree.loose) {
    const element = bookmarkRow(bookmark, 0);
    elements.push(element);
    draggable.push({
      element,
      kind: 'bookmark',
      depth: 0,
      url: bookmark.url,
      name: bookmark.name,
      parentPath: [],
    });
  }
  for (const group of tree.groups) elements.push(...groupRows(group, 0));

  container.replaceChildren(...elements);
  return { rows: draggable };

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

    const rows = [header];
    for (const bookmark of pinned) {
      const element = bookmarkRow(bookmark, 1);
      draggable.push({ element, kind: 'pin', depth: 1, url: bookmark.url, name: bookmark.name });
      rows.push(element);
    }
    return rows;
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
    draggable.push({
      element: header,
      kind: 'group',
      depth,
      path: group.path,
      section: group.section === true,
    });

    if (!open) return [header];

    const rows = [header];
    for (const bookmark of group.bookmarks) {
      const element = bookmarkRow(bookmark, depth + 1);
      draggable.push({
        element,
        kind: 'bookmark',
        depth: depth + 1,
        url: bookmark.url,
        name: bookmark.name,
        parentPath: group.path,
      });
      rows.push(element);
    }
    for (const child of group.children) rows.push(...groupRows(child, depth + 1));
    return rows;
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
    link.draggable = false;
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

    const marked =
      rowAction === 'read'
        ? read.has(urlKey(bookmark.url))
        : pinnedKeys.has(urlKey(bookmark.url));

    const actions = doc.createElement('div');
    actions.className = 'row-actions';
    actions.append(
      rowAction === 'read'
        ? actionButton({
            className: 'read',
            title: marked ? 'Mark as unread' : 'Mark as read',
            pressed: marked,
            icon: checkIcon(doc, { filled: marked }),
            onClick: () => onToggleRead(bookmark),
          })
        : actionButton({
            className: 'pin',
            title: marked ? 'Unpin this bookmark' : 'Pin this bookmark',
            pressed: marked,
            icon: pinIcon(doc, { filled: marked }),
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
