import { formatBookmark, normalizeUrl, parseBookmarks } from '../core/bookmarks.js';
import { DEFAULT_SETTINGS, findSettingsProblems, normalizeSettings } from '../core/settings.js';

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
 * @property {(line: string) => Promise<void>} appendLine add one line, creating the note if needed
 * @property {() => Promise<string | null>} findTargetProblem null when the configured note is usable
 */

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
    bookmarks: [],
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

  /** @param {'bookmarks' | 'newBookmark' | 'settings'} view */
  function showView(view) {
    const isSettings = view === 'settings';
    ui.mainView.hidden = isSettings;
    ui.settingsView.hidden = !isSettings;
    ui.bookmarkForm.hidden = view !== 'newBookmark';
    ui.saveBookmark.setAttribute('aria-expanded', String(view === 'newBookmark'));
    ui.openSettings.classList.toggle('active', isSettings);
    if (view === 'newBookmark') ui.name.focus();
  }

  function render() {
    for (const element of [ui.status, ui.settingsStatus]) {
      element.hidden = !state.status;
      element.textContent = state.status?.text ?? '';
      element.dataset.kind = state.status?.kind ?? '';
    }

    ui.list.replaceChildren(...state.bookmarks.map(renderItem));
    ui.emptyList.hidden = state.bookmarks.length > 0 || state.status?.kind === 'error';
  }

  /** @param {{ name: string, url: string }} bookmark */
  function renderItem(bookmark) {
    const item = doc.createElement('li');

    const link = doc.createElement('a');
    link.href = bookmark.url;
    link.rel = 'noreferrer';
    link.textContent = bookmark.name;
    link.title = bookmark.url;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      port.openUrl(bookmark.url);
    });

    const hostname = doc.createElement('span');
    hostname.className = 'host';
    hostname.textContent = hostnameOf(bookmark.url);

    item.append(link, hostname);
    return item;
  }

  /**
   * @param {string} url
   * @returns {string} the host, or '' when the URL cannot be parsed
   */
  function hostnameOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  /** Re-reads the note; throws so each caller can decide what to report. */
  async function reloadBookmarks() {
    setBusy(true);
    try {
      state.bookmarks = parseBookmarks(await store.readText());
    } catch (error) {
      state.bookmarks = [];
      throw error;
    } finally {
      setBusy(false);
      render();
    }
  }

  async function openBookmarkForm() {
    const tab = await port.getActiveTab().catch(() => null);
    ui.name.value = (tab?.title ?? '').trim();
    ui.url.value = normalizeUrl(tab?.url) ? tab.url : '';
    setStatus(null);
    showView('newBookmark');
    ui.name.select();
  }

  async function saveBookmark() {
    const url = normalizeUrl(ui.url.value);
    if (!url) {
      setStatus(failure('That is not a valid http(s) URL.'));
      return;
    }
    const name = ui.name.value.trim() || url;

    try {
      await store.appendLine(formatBookmark({ name, url }));
      await reloadBookmarks();
    } catch (error) {
      setStatus(failure(error.message));
      return;
    }

    showView('bookmarks');
    ui.name.value = '';
    ui.url.value = '';
    setStatus(info(`Saved “${name}”.`));
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
        list: element('bookmark-list'),
        saveBookmark: element('save-bookmark'),
        openSettings: element('open-settings'),
        bookmarkForm: element('bookmark-form'),
        confirmBookmark: element('confirm-bookmark'),
        cancelBookmark: element('cancel-bookmark'),
        name: element('bookmark-name'),
        url: element('bookmark-url'),
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
      ui.cancelBookmark.addEventListener('click', () => {
        setStatus(null);
        showView('bookmarks');
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
