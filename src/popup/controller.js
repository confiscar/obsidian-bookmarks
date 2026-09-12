import { normalizeUrl, siteKey, urlKey } from '../core/bookmarks.js';
import {
  allBookmarks,
  allGroupIds,
  filterBookmarks,
  findBookmarkPath,
  groupIds,
  insertBookmark,
  parseBookmarkTree,
  removeBookmark,
  updateBookmark,
} from '../core/bookmark-tree.js';
import { readMarked, toggleMarked } from '../core/front-matter.js';
import { DEFAULT_SETTINGS, findSettingsProblems, normalizeSettings } from '../core/settings.js';
import { renderBookmarkList } from './bookmark-list.js';
import { bookIcon, clockIcon } from './icons.js';

const PIN_KEY = 'pinned';
const READ_KEY = 'read';

/**
 * @typedef {object} PlatformPort
 * @property {() => Promise<{ url: string, title: string } | null>} getActiveTab the tab the popup was
 *   opened from, or null when the browser will not tell us
 * @property {() => Promise<{ apiBase?: string, apiKey?: string, filePath?: string, readLaterPath?: string }>} loadSettings
 * @property {(settings: { apiBase: string, apiKey: string, filePath: string, readLaterPath: string }) => Promise<void>} saveSettings
 * @property {(url: string) => Promise<void>} openUrl open a bookmark in a new tab
 * @property {() => Promise<boolean>} requestHostAccess ensure the loopback API may be called,
 *   prompting if the browser requires it
 * @property {(url: string) => Promise<string | null>} faviconUrl a renderable icon for that
 *   page, or null when the browser has none to offer
 * @property {() => Promise<void>} rememberFavicons capture whatever the browser can offer for
 *   the pages the user has open right now, for the browsers that cannot look them up later
 */

/**
 * @typedef {object} FileStore
 * @property {() => Promise<string>} readText contents of the bookmark note; '' when it does not exist
 * @property {(text: string) => Promise<void>} writeText store the full note, creating it if needed
 * @property {() => Promise<string | null>} findTargetProblem null when the configured note is usable
 */

const DEFAULT_GROUP = 'Unsorted';

/**
 * @param {object} options
 * @param {PlatformPort} options.port browser APIs; implemented in `platform/`
 * @param {(getSettings: () => { apiBase: string, apiKey: string, filePath: string }) => FileStore} options.createStore
 *   builds the store around a live getter, so it always sees the current settings
 * @param {Document} [options.document] the document to render into, injectable for tests
 */
export function createController({ port, createStore, document: doc = globalThis.document }) {
  const state = {
    settings: { ...DEFAULT_SETTINGS },
    tree: parseBookmarkTree(''),
    pinned: [],
    pinnedOpen: true,
    collapsed: new Set(),
    icons: new Map(),
    readLater: { tree: parseBookmarkTree(''), read: new Set() },
    view: 'bookmarks',
    editing: null,
    pendingDelete: null,
    status: null,
  };
  const store = createStore(() => state.settings);
  // The read later note is a second note of the same shape, so it is the same store pointed at
  // another path in the vault. Nothing else about it is special.
  const readLaterStore = createStore(() => ({
    ...state.settings,
    filePath: state.settings.readLaterPath,
  }));
  let ui;

  const hasReadLater = () => Boolean(state.settings.readLaterPath);
  const currentStore = () => (state.view === 'readLater' ? readLaterStore : store);
  const currentTree = () => (state.view === 'readLater' ? state.readLater.tree : state.tree);
  const currentMarkKey = () => (state.view === 'readLater' ? READ_KEY : PIN_KEY);
  const visibleGroups = () =>
    state.view === 'readLater' ? readLaterSections().groups : state.tree.groups;

  const info = (text) => ({ kind: 'info', text });
  const failure = (text) => ({ kind: 'error', text });

  /** @param {{ kind: 'info' | 'error', text: string } | null} status */
  const setStatus = (status) => {
    state.status = status;
    render();
  };

  /** @param {boolean} busy disables every action button while work is in flight */
  const setBusy = (busy) => {
    for (const button of ui.actionButtons) button.disabled = busy;
  };

  /** @param {'bookmarks' | 'readLater' | 'bookmarkForm' | 'settings'} view */
  function showView(view) {
    const isSettings = view === 'settings';
    ui.mainView.hidden = isSettings;
    ui.settingsView.hidden = !isSettings;
    ui.bookmarkForm.hidden = view !== 'bookmarkForm';
    ui.saveBookmark.setAttribute('aria-expanded', String(view === 'bookmarkForm'));
    ui.openSettings.classList.toggle('active', isSettings);
    if (view === 'bookmarkForm') ui.name.focus();
    if (view === 'bookmarks' || view === 'readLater') state.view = view;
    render();
  }

  function render() {
    for (const element of [ui.status, ui.settingsStatus]) {
      element.hidden = !state.status;
      element.textContent = state.status?.text ?? '';
      element.dataset.kind = state.status?.kind ?? '';
    }

    const showingReadLater = state.view === 'readLater';
    const readLater = hasReadLater();
    const readLaterTitle = showingReadLater ? 'Back to bookmarks' : 'Read later';

    ui.readLaterButton.hidden = !readLater;
    ui.readLaterView.hidden = !readLater;
    ui.readLaterView.classList.toggle('active', showingReadLater);
    ui.readLaterView.setAttribute('aria-pressed', String(showingReadLater));
    ui.readLaterView.title = readLaterTitle;
    ui.readLaterView.setAttribute('aria-label', readLaterTitle);

    const sections = showingReadLater ? readLaterSections() : null;

    renderBookmarkList({
      document: doc,
      container: ui.list,
      tree: sections ?? state.tree,
      collapsed: state.collapsed,
      pinned: showingReadLater ? [] : state.pinned,
      pinnedOpen: state.pinnedOpen,
      icons: state.icons,
      rowAction: showingReadLater ? 'read' : 'pin',
      read: state.readLater.read,
      onOpenBookmark: (url) => port.openUrl(url),
      onToggleGroup: toggleGroup,
      onTogglePinned: togglePinnedEntry,
      onToggleRead: toggleReadEntry,
      onEditBookmark: openEditForm,
      onDeleteBookmark: askToDelete,
      onTogglePinnedSection: () => {
        state.pinnedOpen = !state.pinnedOpen;
        render();
      },
    });

    const visible = sections ?? state.tree;
    const isEmpty = !visible.loose.length && !visible.groups.length;
    ui.emptyList.textContent = showingReadLater
      ? 'Nothing saved for later yet.'
      : 'No bookmarks found yet.';
    ui.emptyList.hidden = !isEmpty || state.status?.kind === 'error';
    ui.listTools.hidden = !visible.groups.length;
    renderDeletePanel();

    const folderIds = allGroupIds(currentTree().groups);
    ui.groupOptions.replaceChildren(
      ...folderIds.map((id) => {
        const option = doc.createElement('option');
        option.value = id;
        return option;
      }),
    );
    if (!folderIds.includes(ui.group.value)) ui.group.dataset.unknown = 'true';
    else delete ui.group.dataset.unknown;
  }

  /** @param {import('../core/bookmark-tree.js').Group} group */
  function toggleGroup(group) {
    const ids = groupIds(group);
    const closing = !state.collapsed.has(group.id);
    for (const id of ids) {
      if (closing) state.collapsed.add(id);
      else state.collapsed.delete(id);
    }
    render();
  }

  /**
   * Re-reads both notes; throws so each caller can decide what to report.
   * @returns {Promise<void>}
   */
  async function reload() {
    setBusy(true);
    try {
      const markdown = await store.readText();
      state.tree = parseBookmarkTree(markdown);
      state.pinned = readMarked(markdown, PIN_KEY).entries.map(({ name, url }) => ({ name, url }));

      if (hasReadLater()) {
        const readLater = await readLaterStore.readText();
        state.readLater.tree = parseBookmarkTree(readLater);
        state.readLater.read = new Set(
          readMarked(readLater, READ_KEY).entries.map((entry) => urlKey(entry.url)),
        );
      }
      state.icons = await loadIcons();
    } catch (error) {
      state.tree = parseBookmarkTree('');
      state.pinned = [];
      state.icons = new Map();
      throw error;
    } finally {
      setBusy(false);
      render();
    }
  }

  /**
   * The read later note as two sections: what is still waiting, and what has been read. Each
   * keeps the folders it sits in, and folders with nothing in them drop out.
   * @returns {import('../core/bookmark-tree.js').BookmarkTree}
   */
  function readLaterSections() {
    const { tree, read } = state.readLater;
    const isRead = (bookmark) => read.has(urlKey(bookmark.url));
    const unread = filterBookmarks(tree, (bookmark) => !isRead(bookmark));
    const done = filterBookmarks(tree, isRead);

    if (!allBookmarks(unread).length && !allBookmarks(done).length) {
      return { rootLevel: tree.rootLevel, listMarker: tree.listMarker, loose: [], groups: [] };
    }

    // Both notes hold folders of the same names, so the read later ones are keyed apart from
    // the bookmark ones: opening or closing Music in one view leaves the other alone.
    const keyed = (groups) =>
      groups.map((group) => ({ ...group, id: `read:${group.id}`, children: keyed(group.children) }));

    const section = (name, part) => ({
      name,
      level: 2,
      path: [name],
      id: `read:${name.toLowerCase()}`,
      headingLine: -1,
      bookmarks: part.loose,
      children: keyed(part.groups),
    });

    return {
      rootLevel: tree.rootLevel ?? 2,
      listMarker: tree.listMarker,
      loose: [],
      groups: [section('Unread', unread), section('Read', done)],
    };
  }

  /**
   * One lookup per site the list shows. Browsers that keep no favicon cache are asked to
   * capture the icons of the pages that are open first, which is the only chance they get.
   * @returns {Promise<Map<string, string | null>>}
   */
  async function loadIcons() {
    await port.rememberFavicons().catch(() => {});

    const shown = hasReadLater()
      ? [...allBookmarks(state.tree), ...allBookmarks(state.readLater.tree), ...state.pinned]
      : [...allBookmarks(state.tree), ...state.pinned];

    const icons = new Map();
    for (const bookmark of shown) {
      const key = siteKey(bookmark.url);
      if (icons.has(key)) continue;
      icons.set(key, await port.faviconUrl(bookmark.url).catch(() => null));
    }
    return icons;
  }

  /** @param {{ name: string, url: string }} bookmark */
  async function togglePinnedEntry(bookmark) {
    setBusy(true);
    try {
      const { markdown, marked } = toggleMarked(await store.readText(), PIN_KEY, bookmark);
      await store.writeText(markdown);
      if (marked) state.pinnedOpen = true;
      await reload();
      setStatus(info(marked ? `Pinned “${bookmark.name}”.` : `Unpinned “${bookmark.name}”.`));
    } catch (error) {
      setStatus(failure(error.message));
    } finally {
      setBusy(false);
    }
  }

  /** @param {{ name: string, url: string }} bookmark */
  async function toggleReadEntry(bookmark) {
    setBusy(true);
    try {
      const { markdown, marked } = toggleMarked(
        await readLaterStore.readText(),
        READ_KEY,
        bookmark,
      );
      await readLaterStore.writeText(markdown);
      await reload();
      setStatus(
        info(marked ? `Marked “${bookmark.name}” as read.` : `Marked “${bookmark.name}” as unread.`),
      );
    } catch (error) {
      setStatus(failure(error.message));
    } finally {
      setBusy(false);
    }
  }

  /**
   * @param {'bookmarks' | 'readLater'} view which note the form will write to; the folder it
   *   offers and the mark it keeps with the URL both follow from this
   */
  async function openBookmarkForm(view) {
    const tab = await port.getActiveTab().catch(() => null);
    state.editing = null;
    state.pendingDelete = null;
    state.view = view;
    ui.confirmBookmark.textContent = view === 'readLater' ? 'Save for later' : 'Save';
    ui.name.value = (tab?.title ?? '').trim();
    ui.url.value = normalizeUrl(tab?.url) ? tab.url : '';
    ui.group.value = DEFAULT_GROUP;
    setStatus(null);
    showView('bookmarkForm');
    ui.name.select();
  }

  /** @param {{ name: string, url: string }} bookmark */
  function openEditForm(bookmark) {
    state.editing = bookmark;
    state.pendingDelete = null;
    ui.confirmBookmark.textContent = 'Update';
    ui.name.value = bookmark.name;
    ui.url.value = bookmark.url;
    ui.group.value = (findBookmarkPath(currentTree(), bookmark.url) ?? []).join('/');
    setStatus(null);
    showView('bookmarkForm');
    ui.name.select();
  }

  function closeBookmarkForm() {
    const back = state.view === 'readLater' ? 'readLater' : 'bookmarks';
    state.editing = null;
    ui.confirmBookmark.textContent = 'Save';
    ui.name.value = '';
    ui.url.value = '';
    ui.group.value = DEFAULT_GROUP;
    setStatus(null);
    showView(back);
  }

  async function saveBookmark() {
    const url = normalizeUrl(ui.url.value);
    if (!url) {
      setStatus(failure('That is not a valid http(s) URL.'));
      return;
    }
    const typedFolder = ui.group.value.trim();
    const editing = state.editing;
    if (!typedFolder && !editing) {
      setStatus(failure('Choose a folder, or type a new one.'));
      return;
    }

    const name = ui.name.value.trim() || url;
    const note = currentStore();
    const folder = typedFolder || (findBookmarkPath(currentTree(), editing.url) ?? []).join('/');

    let groupId;
    try {
      const markdown = await note.readText();
      const updated = editing
        ? updateBookmark(markdown, { url: editing.url, bookmark: { name, url }, path: folder })
        : insertBookmark(markdown, { path: folder, bookmark: { name, url } });

      await note.writeText(movedMark(updated.markdown, editing, { name, url }));
      groupId = updated.groupId;
      await reload();
    } catch (error) {
      setStatus(failure(error.message));
      return;
    }

    closeBookmarkForm();
    setStatus(info(editing ? `Updated “${name}” in ${groupId}.` : `Saved “${name}” to ${groupId}.`));
  }

  /**
   * @param {string} markdown
   * @param {string} url
   * @param {string} key front matter key the mark lives under
   * @returns {boolean} whether that URL is marked in the note's front matter
   */
  function isMarked(markdown, url, key) {
    return readMarked(markdown, key).entries.some(
      (entry) => urlKey(entry.url) === urlKey(url),
    );
  }

  /**
   * Keeps a bookmark's mark with the bookmark when its URL changes: a pinned bookmark stays
   * pinned, a read one stays read.
   *
   * @param {string} markdown
   * @param {{ name: string, url: string } | null} editing
   * @param {{ name: string, url: string }} bookmark
   * @returns {string} the note, with the mark moved if there was one
   */
  function movedMark(markdown, editing, bookmark) {
    const key = currentMarkKey();
    if (!editing || urlKey(editing.url) === urlKey(bookmark.url)) return markdown;
    if (!isMarked(markdown, editing.url, key)) return markdown;

    const unmarked = toggleMarked(markdown, key, editing).markdown;
    return toggleMarked(unmarked, key, bookmark).markdown;
  }

  /** Fills the panel that asks before deleting, so the row keeps its buttons. */
  function renderDeletePanel() {
    const bookmark = state.pendingDelete;
    ui.deletePanel.hidden = !bookmark;
    if (!bookmark) return;

    const readingLater = state.view === 'readLater';
    const folder = (findBookmarkPath(currentTree(), bookmark.url) ?? []).join('/');
    const marked = readingLater
      ? state.readLater.read.has(urlKey(bookmark.url))
      : state.pinned.some((entry) => urlKey(entry.url) === urlKey(bookmark.url));

    ui.deleteName.textContent = bookmark.name;
    ui.deleteDetail.textContent = [
      folder ? `Removes its line from ${folder}.` : 'Removes its line from the note.',
      marked ? (readingLater ? 'Its read mark goes too.' : 'Its pin goes too.') : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** @param {{ name: string, url: string }} bookmark */
  function askToDelete(bookmark) {
    state.pendingDelete = bookmark;
    setStatus(null);
    ui.cancelDelete.focus();
  }

  function cancelDelete() {
    state.pendingDelete = null;
    render();
  }

  async function confirmDelete() {
    const bookmark = state.pendingDelete;
    if (!bookmark) return;

    setBusy(true);
    try {
      const note = currentStore();
      const key = currentMarkKey();
      const markdown = await note.readText();
      const { markdown: withoutLine, removed } = removeBookmark(markdown, bookmark.url);
      const marked = isMarked(withoutLine, bookmark.url, key);
      const next = marked ? toggleMarked(withoutLine, key, bookmark).markdown : withoutLine;

      if (removed || marked) await note.writeText(next);
      state.pendingDelete = null;
      await reload();
      setStatus(
        info(
          removed || marked
            ? `Deleted “${bookmark.name}”.`
            : `“${bookmark.name}” is no longer in the note.`,
        ),
      );
    } catch (error) {
      setStatus(failure(error.message));
    } finally {
      setBusy(false);
    }
  }

  function openSettings() {
    state.pendingDelete = null;
    ui.apiBase.value = state.settings.apiBase;
    ui.apiKey.value = state.settings.apiKey;
    ui.filePath.value = state.settings.filePath;
    ui.readLaterPath.value = state.settings.readLaterPath;
    setStatus(null);
    showView('settings');
  }

  function closeSettings() {
    setStatus(null);
    showView('bookmarks');
  }

  async function saveSettings() {
    const hadReadLater = hasReadLater();
    const settings = normalizeSettings({
      apiBase: ui.apiBase.value,
      apiKey: ui.apiKey.value,
      filePath: ui.filePath.value,
      readLaterPath: ui.readLaterPath.value,
    });
    const problems = findSettingsProblems(settings);

    state.settings = settings;
    if (!hadReadLater && hasReadLater()) state.collapsed.add('read:read');
    try {
      await port.saveSettings(settings);
    } catch (error) {
      setStatus(failure(`Could not save settings: ${error.message}`));
      return;
    }

    showView('bookmarks');
    try {
      await reload();
    } catch (error) {
      setStatus(failure(error.message));
      return;
    }

    if (problems.length) setStatus(failure(problems.join(' ')));
    else {
      const note = hasReadLater() ? readLaterStore : store;
      const targetProblem = await note.findTargetProblem().catch((error) => error.message);
      setStatus(targetProblem ? failure(targetProblem) : info('Settings saved.'));
    }
  }

  async function testConnection() {
    setBusy(true);
    try {
      await store.ping();
      setStatus(info('Obsidian answered.'));
    } catch (error) {
      setStatus(failure(error.message));
    } finally {
      setBusy(false);
    }
  }

  async function requestLocalAccess() {
    try {
      const granted = await port.requestHostAccess();
      setStatus(
        granted
          ? info('Local network access granted.')
          : failure('Access was not granted — bookmarks cannot be loaded.'),
      );
    } catch (error) {
      setStatus(failure(error.message));
    }
  }

  return {
    async init() {
      const element = (id) => doc.getElementById(id);
      ui = {
        mainView: element('main-view'),
        settingsView: element('settings-view'),
        status: element('status'),
        settingsStatus: element('settings-status'),
        emptyList: element('empty-list'),
        listTools: element('list-tools'),
        list: element('bookmark-list'),
        saveBookmark: element('save-bookmark'),
        openSettings: element('open-settings'),
        bookmarkForm: element('bookmark-form'),
        confirmBookmark: element('confirm-bookmark'),
        cancelBookmark: element('cancel-bookmark'),
        name: element('bookmark-name'),
        url: element('bookmark-url'),
        group: element('bookmark-group'),
        groupOptions: element('group-options'),
        expandAll: element('expand-all'),
        collapseAll: element('collapse-all'),
        backToBookmarks: element('back-to-bookmarks'),
        settingsForm: element('settings-form'),
        saveSettings: element('save-settings'),
        deletePanel: element('delete-panel'),
        deleteName: element('delete-name'),
        deleteDetail: element('delete-detail'),
        confirmDelete: element('confirm-delete'),
        cancelDelete: element('cancel-delete'),
        apiBase: element('api-base'),
        apiKey: element('api-key'),
        filePath: element('file-path'),
        readLaterPath: element('read-later-path'),
        readLaterButton: element('read-later'),
        readLaterView: element('read-later-view'),
        testConnection: element('test-connection'),
        requestLocalAccess: element('request-local-access'),
      };
      ui.actionButtons = [
        ui.saveBookmark,
        ui.readLaterButton,
        ui.confirmBookmark,
        ui.saveSettings,
        ui.testConnection,
        ui.requestLocalAccess,
        ui.confirmDelete,
      ];
      ui.readLaterButton.prepend(clockIcon(doc, { size: 13 }));
      ui.readLaterView.prepend(bookIcon(doc, { size: 15 }));

      ui.saveBookmark.addEventListener('click', () => {
        if (ui.bookmarkForm.hidden) openBookmarkForm('bookmarks');
        else showView('bookmarks');
      });
      ui.bookmarkForm.addEventListener('submit', (event) => {
        event.preventDefault();
        saveBookmark();
      });
      ui.cancelBookmark.addEventListener('click', closeBookmarkForm);
      ui.confirmDelete.addEventListener('click', confirmDelete);
      ui.cancelDelete.addEventListener('click', cancelDelete);
      ui.readLaterButton.addEventListener('click', () => openBookmarkForm('readLater'));
      ui.readLaterView.addEventListener('click', () =>
        showView(state.view === 'readLater' ? 'bookmarks' : 'readLater'),
      );
      ui.expandAll.addEventListener('click', () => {
        state.collapsed.clear();
        state.pinnedOpen = true;
        render();
      });
      ui.collapseAll.addEventListener('click', () => {
        state.collapsed = new Set(allGroupIds(visibleGroups()));
        if (state.view !== 'readLater') state.pinnedOpen = false;
        render();
      });
      ui.openSettings.addEventListener('click', openSettings);
      ui.backToBookmarks.addEventListener('click', closeSettings);
      ui.settingsForm.addEventListener('submit', (event) => {
        event.preventDefault();
        saveSettings();
      });
      ui.testConnection.addEventListener('click', testConnection);
      ui.requestLocalAccess.addEventListener('click', requestLocalAccess);

      showView('bookmarks');
      state.settings = normalizeSettings(await port.loadSettings());

      try {
        await reload();
      } catch (error) {
        setStatus(failure(error.message));
        return;
      }

      // Opening the popup shows the pins and nothing else; folders are opened by hand, or all
      // at once with Open all. Folders that appear later — from a save, say — open as they did.
      state.collapsed = new Set(allGroupIds(state.tree.groups));
      state.collapsed.add('read:read');

      const problems = findSettingsProblems(state.settings);
      if (problems.length) setStatus(info(problems.join(' ')));
      else render();
    },
  };
}
