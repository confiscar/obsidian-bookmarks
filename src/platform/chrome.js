/**
 * Chrome implementation of the platform port.
 *
 * Chrome exposes callbacks (`chrome.tabs.query(opts, cb)`) with errors parked on
 * `chrome.runtime.lastError`, so this layer mostly promisifies. Firefox's
 * already-promise-based APIs make `firefox.js` noticeably thinner — that
 * asymmetry is the whole point of keeping these adapters separate.
 */

/** @returns {Promise<any>} */
function promisify(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

/** @returns {import('../core/ports.js').PlatformPort} */
export function createChromePort() {
  return {
    name: 'chrome',

    async getActiveTab() {
      const [tab] = await promisify(chrome.tabs.query, { active: true, currentWindow: true });
      if (!tab) return null;
      // `url`/`title` are absent unless the extension holds host or activeTab
      // permission for that tab.
      return { url: tab.url ?? '', title: tab.title ?? '' };
    },

    async loadSettings() {
      const stored = await promisify(chrome.storage.local.get, 'settings');
      return stored?.settings ?? {};
    },

    async saveSettings(settings) {
      await promisify(chrome.storage.local.set, { settings });
    },

    async openUrl(url) {
      await promisify(chrome.tabs.create, { url });
    },

    async requestHostAccess() {
      const origins = ['http://127.0.0.1/*', 'https://127.0.0.1/*'];
      if (await promisify(chrome.permissions.contains, { origins })) return true;
      return Boolean(await promisify(chrome.permissions.request, { origins }));
    },
  };
}
