// Chrome's MV3 APIs return promises when they are called as members and no callback is given.
// Calling one detached from its owner (`const get = chrome.storage.local.get`) throws
// "Illegal invocation", so every call here keeps its receiver.
//
// What makes this file Chrome's, rather than Firefox's twin, is the favicon: Chrome keeps a
// favicon for every page it has seen and serves it from `_favicon/`, so nothing is ever cached.

const FAVICON_SIZE = 32;

const declaredOrigins = () => chrome.runtime.getManifest().host_permissions ?? [];

export function createChromePort() {
  return {
    name: 'chrome',

    async getActiveTab() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return null;
      return { url: tab.url ?? '', title: tab.title ?? '' };
    },

    async loadSettings() {
      return (await chrome.storage.local.get('settings')).settings ?? {};
    },

    async saveSettings(settings) {
      await chrome.storage.local.set({ settings });
    },

    async openUrl(url) {
      await chrome.tabs.create({ url });
    },

    async requestHostAccess() {
      const origins = declaredOrigins();
      if (await chrome.permissions.contains({ origins })) return true;
      return chrome.permissions.request({ origins });
    },

    /**
     * Chrome's own favicon cache, read through the extension: pages it has not seen answer with
     * Chrome's generic icon, and nothing here touches the network.
     *
     * @param {string} url
     * @returns {Promise<string>}
     */
    async faviconUrl(url) {
      // No leading slash: getURL('…') concatenates, so '/_favicon/' would ask for '//_favicon/'.
      const icon = new URL(chrome.runtime.getURL('_favicon/'));
      icon.searchParams.set('pageUrl', url);
      icon.searchParams.set('size', String(FAVICON_SIZE));
      return icon.toString();
    },

    /** Nothing to capture: the browser's favicon store already holds every icon it has. */
    async rememberFavicons() {},
  };
}
