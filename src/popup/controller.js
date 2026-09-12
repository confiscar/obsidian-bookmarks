import { normalizeUrl, urlKey } from '../core/bookmarks.js';
import {
  allGroupIds,
  findBookmarkPath,
  groupIds,
  insertBookmark,
  parseBookmarkTree,
  removeBookmark,
  updateBookmark,
} from '../core/bookmark-tree.js';
import { readPinned, togglePinned } from '../core/front-matter.js';
import { DEFAULT_SETTINGS, findSettingsProblems, normalizeSettings } from '../core/settings.js';
import { renderBookmarkList } from './bookmark-list.js';

/**
 * @typedef {object} PlatformPort
 * @property {() => Promise<{ url: string, title: string } | null>} getActiveTab the tab the popup was
 *   opened from, or null when the browser will not tell us
 * @property {() => Promise<{ apiBase?: string, apiKey?: string, filePath?: string }>} loadSettings
 * @property {(settings: { apiBase: string, apiKey: string, filePath: string }) => Promise<void>} saveSettings
 * @property {(url: string) => Promise<void>} openUrl open a bookmark in a new tab
 * @property {() => Promise<boolean>} requestHostAccess ensure the loopback API may be called,
 *   prompting if the browser requires it
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
    editing: null,
    status: null,
  };
  const store = createStore(() => state.settings);
  let ui;

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

  /** @param {'bookmarks' | 'bookmarkForm' | 'settings'} view */
  function showView(view) {
    const isSettings = view === 'settings';
    ui.mainView.hidden = isSettings;
    ui.settingsView.hidden = !isSettings;
    ui.bookmarkForm.hidden = view !== 'bookmarkForm';
    ui.saveBookmark.setAttribute('aria-expanded', String(view === 'bookmarkForm'));
    ui.openSettings.classList.toggle('active', isSettings);
    if (view === 'bookmarkForm') ui.name.focus();
  }

  function render() {
    for (const element of [ui.status, ui.settingsStatus]) {
      element.hidden = !state.status;
      element.textContent = state.status?.text ?? '';
      element.dataset.kind = state.status?.kind ?? '';
    }

    renderBookmarkList({
      document: doc,
      container: ui.list,
      tree: state.tree,
      collapsed: state.collapsed,
      pinned: state.pinned,
      pinnedOpen: state.pinnedOpen,
      onOpenBookmark: (url) => port.openUrl(url),
      onToggleGroup: toggleGroup,
      onTogglePinned: togglePinnedEntry,
      onEditBookmark: openEditForm,
      onDeleteBookmark: deleteBookmark,
      onTogglePinnedSection: () => {
        state.pinnedOpen = !state.pinnedOpen;
        render();
      },
    });

    const isEmpty = !state.tree.loose.length && !state.tree.groups.length;
    ui.emptyList.hidden = !isEmpty || state.status?.kind === 'error';
    ui.listTools.hidden = !state.tree.groups.length;

    const folderIds = allGroupIds(state.tree.groups);
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

  /** Re-reads the note; throws so each caller can decide what to report. */
  async function reloadBookmarks() {
    setBusy(true);
    try {
      const markdown = await store.readText();
      state.tree = parseBookmarkTree(markdown);
      state.pinned = readPinned(markdown).entries.map(({ name, url }) => ({ name, url }));
    } catch (error) {
      state.tree = parseBookmarkTree('');
      state.pinned = [];
      throw error;
    } finally {
      setBusy(false);
      render();
    }
  }

  /** @param {{ name: string, url: string }} bookmark */
  async function togglePinnedEntry(bookmark) {
    setBusy(true);
    try {
      const { markdown, pinned } = togglePinned(await store.readText(), bookmark);
      await store.writeText(markdown);
      if (pinned) state.pinnedOpen = true;
      await reloadBookmarks();
      setStatus(info(pinned ? `Pinned “${bookmark.name}”.` : `Unpinned “${bookmark.name}”.`));
    } catch (error) {
      setStatus(failure(error.message));
    } finally {
      setBusy(false);
    }
  }

  async function openBookmarkForm() {
    const tab = await port.getActiveTab().catch(() => null);
    state.editing = null;
    ui.confirmBookmark.textContent = 'Save';
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
    ui.confirmBookmark.textContent = 'Update';
    ui.name.value = bookmark.name;
    ui.url.value = bookmark.url;
    ui.group.value = (findBookmarkPath(state.tree, bookmark.url) ?? []).join('/');
    setStatus(null);
    showView('bookmarkForm');
    ui.name.select();
  }

  function closeBookmarkForm() {
    state.editing = null;
    ui.confirmBookmark.textContent = 'Save';
    ui.name.value = '';
    ui.url.value = '';
    ui.group.value = DEFAULT_GROUP;
    setStatus(null);
    showView('bookmarks');
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
    const folder = typedFolder || (findBookmarkPath(state.tree, editing.url) ?? []).join('/');

    let groupId;
    try {
      const markdown = await store.readText();
      const updated = editing
        ? updateBookmark(markdown, { url: editing.url, bookmark: { name, url }, path: folder })
        : insertBookmark(markdown, { path: folder, bookmark: { name, url } });

      await store.writeText(movedPin(updated.markdown, editing, { name, url }));
      groupId = updated.groupId;
      await reloadBookmarks();
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
   * @returns {boolean} whether that URL is in the note's front matter
   */
  function isPinned(markdown, url) {
    return readPinned(markdown).entries.some((entry) => urlKey(entry.url) === urlKey(url));
  }

  /**
   * Keeps a bookmark's pin with the bookmark when its URL changes.
   * @param {string} markdown
   * @param {{ name: string, url: string } | null} editing
   * @param {{ name: string, url: string }} bookmark
   * @returns {string} the note, with the pin moved if there was one
   */
  function movedPin(markdown, editing, bookmark) {
    if (!editing || urlKey(editing.url) === urlKey(bookmark.url)) return markdown;
    if (!isPinned(markdown, editing.url)) return markdown;

    const unpinned = togglePinned(markdown, editing).markdown;
    return togglePinned(unpinned, bookmark).markdown;
  }

  /** @param {{ name: string, url: string }} bookmark */
  async function deleteBookmark(bookmark) {
    setBusy(true);
    try {
      const markdown = await store.readText();
      const { markdown: withoutLine, removed } = removeBookmark(markdown, bookmark.url);
      const unpin = isPinned(withoutLine, bookmark.url);
      const next = unpin ? togglePinned(withoutLine, bookmark).markdown : withoutLine;

      if (removed || unpin) await store.writeText(next);
      await reloadBookmarks();
      setStatus(
        info(
          removed || unpin
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
    ui.apiBase.value = state.settings.apiBase;
    ui.apiKey.value = state.settings.apiKey;
    ui.filePath.value = state.settings.filePath;
    setStatus(null);
    showView('settings');
  }

  function closeSettings() {
    setStatus(null);
    showView('bookmarks');
  }

  async function saveSettings() {
    const settings = normalizeSettings({
      apiBase: ui.apiBase.value,
      apiKey: ui.apiKey.value,
      filePath: ui.filePath.value,
    });
    const problems = findSettingsProblems(settings);

    state.settings = settings;
    try {
      await port.saveSettings(settings);
    } catch (error) {
      setStatus(failure(`Could not save settings: ${error.message}`));
      return;
    }

    showView('bookmarks');
    try {
      await reloadBookmarks();
    } catch (error) {
      setStatus(failure(error.message));
      return;
    }

    if (problems.length) setStatus(failure(problems.join(' ')));
    else {
      const targetProblem = await store.findTargetProblem().catch((error) => error.message);
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
        apiBase: element('api-base'),
        apiKey: element('api-key'),
        filePath: element('file-path'),
        testConnection: element('test-connection'),
        requestLocalAccess: element('request-local-access'),
      };
      ui.actionButtons = [
        ui.saveBookmark,
        ui.confirmBookmark,
        ui.saveSettings,
        ui.testConnection,
        ui.requestLocalAccess,
      ];

      ui.saveBookmark.addEventListener('click', () => {
        if (ui.bookmarkForm.hidden) openBookmarkForm();
        else showView('bookmarks');
      });
      ui.bookmarkForm.addEventListener('submit', (event) => {
        event.preventDefault();
        saveBookmark();
      });
      ui.cancelBookmark.addEventListener('click', closeBookmarkForm);
      ui.expandAll.addEventListener('click', () => {
        state.collapsed.clear();
        state.pinnedOpen = true;
        render();
      });
      ui.collapseAll.addEventListener('click', () => {
        state.collapsed = new Set(allGroupIds(state.tree.groups));
        state.pinnedOpen = false;
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
        await reloadBookmarks();
      } catch (error) {
        setStatus(failure(error.message));
        return;
      }

      const problems = findSettingsProblems(state.settings);
      if (problems.length) setStatus(info(problems.join(' ')));
      else render();
    },
  };
}
