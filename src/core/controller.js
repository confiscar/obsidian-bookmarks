/**
 * Popup behaviour and rendering. Knows about the DOM and about the two ports it
 * is handed (`port` = platform APIs, `store` = file storage), nothing else — no
 * `chrome.*`/`browser.*`, no transport details.
 */

import { formatBookmark, normalizeUrl, parseBookmarks } from './bookmarks.js';
import { DEFAULT_SETTINGS, normalizeSettings, validateSettings } from './settings.js';

/**
 * @param {object} options
 * @param {import('./ports.js').PlatformPort} options.port
 * @param {(getSettings: () => import('./settings.js').Settings) => import('./ports.js').FileStore} options.createStore
 * @param {Document} [options.document]
 */
export function createController({ port, createStore, document: doc = globalThis.document }) {
  const state = {
    settings: { ...DEFAULT_SETTINGS },
    bookmarks: [],
    status: null, // { kind: 'info' | 'error', text: string }
  };
  const store = createStore(() => state.settings);
  /** @type {Record<string, HTMLElement>} */
  let ui;

  const setStatus = (status) => {
    state.status = status;
    render();
  };

  const setBusy = (busy) => {
    for (const button of [ui.star, ui.save, ui.settingsSave, ui.testConnection, ui.grantAccess]) {
      button.disabled = busy;
    }
  };

  /**
   * `save` is a panel on the main page; `settings` is a page of its own, with a
   * back button, so the two are not the same kind of thing.
   * @param {'list' | 'save' | 'settings'} view
   */
  function setView(view) {
    const settings = view === 'settings';
    ui.mainView.hidden = settings;
    ui.settingsView.hidden = !settings;
    ui.saveForm.hidden = view !== 'save';
    ui.star.setAttribute('aria-expanded', String(view === 'save'));
    ui.settingsToggle.classList.toggle('active', settings);
    if (view === 'save') ui.name.focus();
  }

  function render() {
    // One status, shown on whichever page is open.
    for (const node of [ui.status, ui.settingsStatus]) {
      node.hidden = !state.status;
      node.textContent = state.status?.text ?? '';
      node.dataset.kind = state.status?.kind ?? '';
    }

    ui.list.replaceChildren(...state.bookmarks.map(renderItem));
    // An error already explains the empty list; don't also claim there is none.
    ui.empty.hidden = state.bookmarks.length > 0 || state.status?.kind === 'error';
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

    const host = doc.createElement('span');
    host.className = 'host';
    host.textContent = hostOf(bookmark.url);

    item.append(link, host);
    return item;
  }

  /** @param {string} url */
  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  /**
   * Re-read the file. Never throws: the error message is returned so callers can
   * pair it with the status line they want to show.
   * @returns {Promise<string | null>} error message, or null on success
   */
  async function refresh() {
    setBusy(true);
    try {
      state.bookmarks = parseBookmarks(await store.readText());
      return null;
    } catch (error) {
      state.bookmarks = [];
      return error.message;
    } finally {
      setBusy(false);
      render();
    }
  }

  async function openSaveForm() {
    const tab = await port.getActiveTab().catch(() => null);
    ui.name.value = (tab?.title ?? '').trim();
    // Only offer a URL we could actually save (chrome://, about:, the popup’s
    // own page and friends can't be bookmarked).
    ui.url.value = normalizeUrl(tab?.url) ? tab.url : '';
    setStatus(null);
    setView('save');
    ui.name.select();
  }

  async function saveBookmark() {
    const url = normalizeUrl(ui.url.value);
    if (!url) {
      setStatus({ kind: 'error', text: 'That is not a valid http(s) URL.' });
      return;
    }
    const name = ui.name.value.trim() || url;

    setBusy(true);
    try {
      await store.appendLine(formatBookmark({ name, url }));
    } catch (error) {
      setStatus({ kind: 'error', text: error.message });
      setBusy(false);
      return;
    }
    setBusy(false);

    setView('list');
    ui.name.value = '';
    ui.url.value = '';
    const failure = await refresh();
    setStatus(failure ? { kind: 'error', text: failure } : { kind: 'info', text: `Saved “${name}”.` });
  }

  function openSettings() {
    ui.apiBase.value = state.settings.apiBase;
    ui.apiKey.value = state.settings.apiKey;
    ui.filePath.value = state.settings.filePath;
    setStatus(null);
    setView('settings');
  }

  function closeSettings() {
    setStatus(null);
    setView('list');
  }

  async function saveSettings() {
    const next = normalizeSettings({
      apiBase: ui.apiBase.value,
      apiKey: ui.apiKey.value,
      filePath: ui.filePath.value,
    });
    const problems = validateSettings(next);

    state.settings = next;
    try {
      await port.saveSettings(next);
    } catch (error) {
      setStatus({ kind: 'error', text: `Could not save settings: ${error.message}` });
      return;
    }

    setView('list');
    const failure = await refresh();
    const targetProblem =
      failure || problems.length
        ? null
        : await store.checkTarget().catch((error) => error.message);

    if (failure) setStatus({ kind: 'error', text: failure });
    else if (problems.length) setStatus({ kind: 'error', text: problems.join(' ') });
    else if (targetProblem) setStatus({ kind: 'error', text: targetProblem });
    else setStatus({ kind: 'info', text: 'Settings saved.' });
  }

  async function testConnection() {
    setBusy(true);
    try {
      await store.ping();
      setStatus({ kind: 'info', text: 'Obsidian answered.' });
    } catch (error) {
      setStatus({ kind: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function grantAccess() {
    try {
      const granted = await port.requestHostAccess();
      setStatus({
        kind: granted ? 'info' : 'error',
        text: granted
          ? 'Local network access granted.'
          : 'Access was not granted — bookmarks cannot be loaded.',
      });
    } catch (error) {
      setStatus({ kind: 'error', text: error.message });
    }
  }

  return {
    async init() {
      ui = {
        mainView: doc.getElementById('main-view'),
        settingsView: doc.getElementById('settings-view'),
        star: doc.getElementById('star'),
        settingsToggle: doc.getElementById('settings-toggle'),
        settingsBack: doc.getElementById('settings-back'),
        settingsStatus: doc.getElementById('settings-status'),
        saveForm: doc.getElementById('save-form'),
        name: doc.getElementById('name'),
        url: doc.getElementById('url'),
        save: doc.getElementById('save'),
        saveCancel: doc.getElementById('save-cancel'),
        settingsForm: doc.getElementById('settings-form'),
        apiBase: doc.getElementById('api-base'),
        apiKey: doc.getElementById('api-key'),
        filePath: doc.getElementById('file-path'),
        settingsSave: doc.getElementById('settings-save'),
        testConnection: doc.getElementById('test-connection'),
        grantAccess: doc.getElementById('grant-access'),
        status: doc.getElementById('status'),
        empty: doc.getElementById('empty'),
        list: doc.getElementById('list'),
      };

      ui.star.addEventListener('click', () => {
        if (ui.saveForm.hidden) openSaveForm();
        else setView('list');
      });
      ui.saveForm.addEventListener('submit', (event) => {
        event.preventDefault();
        saveBookmark();
      });
      ui.saveCancel.addEventListener('click', () => {
        setStatus(null);
        setView('list');
      });
      ui.settingsToggle.addEventListener('click', openSettings);
      ui.settingsForm.addEventListener('submit', (event) => {
        event.preventDefault();
        saveSettings();
      });
      ui.settingsBack.addEventListener('click', closeSettings);
      ui.testConnection.addEventListener('click', testConnection);
      ui.grantAccess.addEventListener('click', grantAccess);

      setView('list');

      state.settings = normalizeSettings(await port.loadSettings());
      const failure = await refresh();
      const problems = validateSettings(state.settings);
      if (failure) setStatus({ kind: 'error', text: failure });
      else if (problems.length) setStatus({ kind: 'info', text: problems.join(' ') });
      else render();
    },
  };
}
