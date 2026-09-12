import assert from 'node:assert/strict';
import test from 'node:test';

import { createChromePort } from '../src/platform/chrome.js';
import { createFirefoxPort } from '../src/platform/firefox.js';

const HOST_PERMISSIONS = ['http://127.0.0.1/*', 'https://127.0.0.1/*'];

/**
 * @param {object} [options]
 * @param {string} [options.fails] message a `tabs.query` call should reject with
 */
function fakeChrome({ tabs = [{ url: 'https://x.test', title: 'X' }], stored = {}, hasAccess = true, grantsAccess = true, fails } = {}) {
  const calls = [];
  return {
    calls,
    runtime: {
      getManifest: () => ({ host_permissions: HOST_PERMISSIONS }),
      getURL: (path) => {
        calls.push(['runtime.getURL', path]);
        // Chrome concatenates rather than resolving, so a leading slash would be doubled.
        return `chrome-extension://fakeid/${path}`;
      },
    },
    tabs: {
      async query(options) {
        calls.push(['tabs.query', options]);
        if (fails) throw new Error(fails);
        return tabs;
      },
      async create(props) {
        calls.push(['tabs.create', props]);
        return { id: 7 };
      },
    },
    storage: {
      local: {
        async get(key) {
          calls.push(['storage.get', key]);
          return { [key]: stored[key] };
        },
        async set(value) {
          calls.push(['storage.set', value]);
          Object.assign(stored, value);
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

function fakeBrowser({ tabs = [{ url: 'https://y.test', title: 'Y' }], stored = {}, hasAccess = true, grantsAccess = true } = {}) {
  const calls = [];
  const data = { ...stored };
  return {
    calls,
    data,
    runtime: { getManifest: () => ({ host_permissions: HOST_PERMISSIONS }) },
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
          return { [key]: data[key] };
        },
        async set(value) {
          calls.push(['storage.set', value]);
          Object.assign(data, value);
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

test('chrome: a failed call rejects', async (t) => {
  globalThis.chrome = fakeChrome({ fails: 'Tabs cannot be queried right now' });
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

test('chrome: missing host access asks for the declared origins', async (t) => {
  const chrome = fakeChrome({ hasAccess: false, grantsAccess: false });
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  assert.equal(await createChromePort().requestHostAccess(), false);
  assert.deepEqual(
    chrome.calls.map(([name]) => name),
    ['permissions.contains', 'permissions.request'],
  );
  assert.deepEqual(chrome.calls[1][1].origins, HOST_PERMISSIONS);
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
    ['permissions.contains', { origins: HOST_PERMISSIONS }],
  ]);
});

test('firefox: a declined host access prompt is reported as false', async (t) => {
  globalThis.browser = fakeBrowser({ hasAccess: false, grantsAccess: false });
  t.after(() => delete globalThis.browser);

  assert.equal(await createFirefoxPort().requestHostAccess(), false);
});

test('chrome: a favicon request is a URL into the browser cache, not a network call', async (t) => {
  const chrome = fakeChrome();
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  const icon = await createChromePort().faviconUrl('https://a.test/deep/page');

  assert.equal(icon, 'chrome-extension://fakeid/_favicon/?pageUrl=https%3A%2F%2Fa.test%2Fdeep%2Fpage&size=32');
  assert.deepEqual(chrome.calls, [['runtime.getURL', '_favicon/']]);
});

test('chrome: nothing needs capturing, so it writes no cache', async (t) => {
  const chrome = fakeChrome();
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  await createChromePort().rememberFavicons();

  assert.deepEqual(chrome.calls, []);
});

test('firefox: an icon is only known once a page has been seen', async (t) => {
  const browser = fakeBrowser();
  globalThis.browser = browser;
  t.after(() => delete globalThis.browser);

  const port = createFirefoxPort();
  assert.equal(await port.faviconUrl('https://a.test/'), null);

  browser.data.tabs = [];
  await port.rememberFavicons();
  assert.equal(await port.faviconUrl('https://a.test/'), null);
});

test('firefox: the icon of the tab the popup opened from is captured by site', async (t) => {
  const browser = fakeBrowser({
    tabs: [{ url: 'https://a.test/deep/page', title: 'A', favIconUrl: 'data:image/png;base64,AAAA' }],
  });
  globalThis.browser = browser;
  t.after(() => delete globalThis.browser);

  const port = createFirefoxPort();
  await port.rememberFavicons();

  assert.equal(await port.faviconUrl('https://a.test/other/page'), 'data:image/png;base64,AAAA');
  assert.equal(await port.faviconUrl('https://other.test/'), null);
  assert.deepEqual(browser.data.favicons, { 'https://a.test': 'data:image/png;base64,AAAA' });
});

test('firefox: an icon URL that would need the page is not cached', async (t) => {
  const browser = fakeBrowser({
    tabs: [{ url: 'https://a.test/', title: 'A', favIconUrl: 'https://a.test/favicon.ico' }],
  });
  globalThis.browser = browser;
  t.after(() => delete globalThis.browser);

  const port = createFirefoxPort();
  await port.rememberFavicons();

  assert.equal(await port.faviconUrl('https://a.test/'), null);
  assert.equal(browser.data.favicons, undefined);
});

test('firefox: the icon cache is capped, oldest first', async (t) => {
  const browser = fakeBrowser({
    tabs: [{ url: 'https://c.test/', title: 'C', favIconUrl: 'data:image/png;base64,CCCC' }],
    stored: {
      favicons: {
        'https://a.test': 'data:image/png;base64,AAAA',
        'https://b.test': 'data:image/png;base64,BBBB',
      },
    },
  });
  globalThis.browser = browser;
  t.after(() => delete globalThis.browser);

  const port = createFirefoxPort({ faviconLimit: 2 });
  await port.rememberFavicons();

  assert.deepEqual(Object.keys(browser.data.favicons), ['https://b.test', 'https://c.test']);
  assert.equal(await port.faviconUrl('https://a.test/'), null);
});
