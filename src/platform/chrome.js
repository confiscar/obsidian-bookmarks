const FAVICON_SIZE = 32;
const FAVICON_PATH = '_favicon/';

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
     * @param {string} url
     * @returns {Promise<string>}
     */
    async faviconUrl(url) {
      const icon = new URL(chrome.runtime.getURL(FAVICON_PATH));
      icon.searchParams.set('pageUrl', url);
      icon.searchParams.set('size', String(FAVICON_SIZE));
      return icon.toString();
    },

    async rememberFavicons() {},
  };
}
