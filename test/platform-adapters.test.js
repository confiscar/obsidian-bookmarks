/**
 * The platform ports are the only browser-specific code, so they get pinned
 * here against fake `chrome`/`browser` globals. This is what the core relies on
 * and what the Chrome build cannot exercise for Firefox.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createChromePort } from '../src/platform/chrome.js';
import { createFirefoxPort } from '../src/platform/firefox.js';

/** @param {object} [options] */
function fakeChrome({ tabs = [{ url: 'https://x.test', title: 'X' }], stored = {}, hasAccess = true, grantsAccess = true } = {}) {
  const calls = [];
  return {
    calls,
    runtime: { lastError: null },
    tabs: {
      query(options, callback) {
        calls.push(['tabs.query', options]);
        callback(tabs);
      },
      create(props, callback) {
        calls.push(['tabs.create', props]);
        callback({ id: 7 });
      },
    },
    storage: {
      local: {
        get(key, callback) {
          calls.push(['storage.get', key]);
          callback(stored);
        },
        set(value, callback) {
          calls.push(['storage.set', value]);
          callback();
        },
      },
    },
    permissions: {
      contains(permissions, callback) {
        calls.push(['permissions.contains', permissions]);
        callback(hasAccess);
      },
      request(permissions, callback) {
        calls.push(['permissions.request', permissions]);
        callback(grantsAccess);
      },
    },
  };
}

/** @param {object} [options] */
function fakeBrowser({ tabs = [{ url: 'https://y.test', title: 'Y' }], stored = {}, hasAccess = true, grantsAccess = true } = {}) {
  const calls = [];
  return {
    calls,
    tabs: {
      async query(options) {
        calls.push(['tabs.query', options]);
        return tabs;
      },
      async create(props) {
        calls.push(['tabs.create', props]);
        return { id: 8 };
      },
    },
    storage: {
      local: {
        async get(key) {
          calls.push(['storage.get', key]);
          return stored;
        },
        async set(value) {
          calls.push(['storage.set', value]);
        },
      },
    },
    permissions: {
      async contains(permissions) {
        calls.push(['permissions.contains', permissions]);
        return hasAccess;
      },
      async request(permissions) {
        calls.push(['permissions.request', permissions]);
        return grantsAccess;
      },
    },
  };
}

test('chrome: active tab query asks for the current window and maps the result', async (t) => {
  const chrome = fakeChrome();
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  const tab = await createChromePort().getActiveTab();

  assert.deepEqual(tab, { url: 'https://x.test', title: 'X' });
  assert.deepEqual(chrome.calls[0], ['tabs.query', { active: true, currentWindow: true }]);
});

test('chrome: no active tab is null, not a crash', async (t) => {
  globalThis.chrome = fakeChrome({ tabs: [] });
  t.after(() => delete globalThis.chrome);

  assert.equal(await createChromePort().getActiveTab(), null);
});

test('chrome: runtime.lastError becomes a rejection', async (t) => {
  const chrome = fakeChrome();
  chrome.tabs.query = (options, callback) => {
    chrome.runtime.lastError = { message: 'Tabs cannot be queried right now' };
    callback([]);
    chrome.runtime.lastError = null;
  };
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  await assert.rejects(() => createChromePort().getActiveTab(), /cannot be queried/);
});

test('chrome: settings round-trip through storage.local', async (t) => {
  const chrome = fakeChrome({ stored: { settings: { apiKey: 'k' } } });
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  const port = createChromePort();
  assert.deepEqual(await port.loadSettings(), { apiKey: 'k' });
  await port.saveSettings({ apiKey: 'other' });

  assert.deepEqual(chrome.calls.at(-1), ['storage.set', { settings: { apiKey: 'other' } }]);
});

test('chrome: missing settings are an empty object', async (t) => {
  globalThis.chrome = fakeChrome({ stored: {} });
  t.after(() => delete globalThis.chrome);

  assert.deepEqual(await createChromePort().loadSettings(), {});
});

test('chrome: existing host access skips the prompt', async (t) => {
  const chrome = fakeChrome({ hasAccess: true });
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  assert.equal(await createChromePort().requestHostAccess(), true);
  assert.deepEqual(
    chrome.calls.map(([name]) => name),
    ['permissions.contains'],
  );
});

test('chrome: missing host access asks for it', async (t) => {
  const chrome = fakeChrome({ hasAccess: false, grantsAccess: false });
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  assert.equal(await createChromePort().requestHostAccess(), false);
  assert.deepEqual(
    chrome.calls.map(([name]) => name),
    ['permissions.contains', 'permissions.request'],
  );
  assert.deepEqual(chrome.calls[1][1].origins, ['http://127.0.0.1/*', 'https://127.0.0.1/*']);
});

test('chrome: openUrl opens a new tab', async (t) => {
  const chrome = fakeChrome();
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  await createChromePort().openUrl('https://open.test');
  assert.deepEqual(chrome.calls.at(-1), ['tabs.create', { url: 'https://open.test' }]);
});

test('firefox: the same contract over promise-based APIs', async (t) => {
  const browser = fakeBrowser();
  globalThis.browser = browser;
  t.after(() => delete globalThis.browser);

  const port = createFirefoxPort();

  assert.equal(port.name, 'firefox');
  assert.deepEqual(await port.getActiveTab(), { url: 'https://y.test', title: 'Y' });
  assert.deepEqual(await port.loadSettings(), {});
  await port.saveSettings({ filePath: 'x.md' });
  await port.openUrl('https://open.test');
  assert.equal(await port.requestHostAccess(), true);

  assert.deepEqual(browser.calls, [
    ['tabs.query', { active: true, currentWindow: true }],
    ['storage.get', 'settings'],
    ['storage.set', { settings: { filePath: 'x.md' } }],
    ['tabs.create', { url: 'https://open.test' }],
    ['permissions.contains', { origins: ['http://127.0.0.1/*', 'https://127.0.0.1/*'] }],
  ]);
});

test('firefox: a declined host access prompt is reported as false', async (t) => {
  globalThis.browser = fakeBrowser({ hasAccess: false, grantsAccess: false });
  t.after(() => delete globalThis.browser);

  assert.equal(await createFirefoxPort().requestHostAccess(), false);
});
