import { siteKey } from '../core/bookmarks.js';

const FAVICON_KEY = 'favicons';
const FAVICON_LIMIT = 200;

/**
 * @param {object} [options]
 * @param {number} [options.faviconLimit] how many site icons to keep
 */
export function createFirefoxPort({ faviconLimit = FAVICON_LIMIT } = {}) {
  /** @type {Record<string, string> | null} */
  let icons = null;

  const loadIcons = async () => {
    if (icons) return icons;
    const stored = await browser.storage.local.get(FAVICON_KEY);
    icons = stored?.[FAVICON_KEY] ?? {};
    return icons;
  };

  return {
    name: 'firefox',

    async getActiveTab() {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab) return null;
      return { url: tab.url ?? '', title: tab.title ?? '' };
    },

    async loadSettings() {
      return (await browser.storage.local.get('settings'))?.settings ?? {};
    },

    async saveSettings(settings) {
      await browser.storage.local.set({ settings });
    },

    async openUrl(url) {
      await browser.tabs.create({ url });
    },

    async requestHostAccess() {
      const origins = declaredOrigins();
      if (await browser.permissions.contains({ origins })) return true;
      return browser.permissions.request({ origins });
    },

    /**
     * @param {string} url
     * @returns {Promise<string | null>}
     */
    async faviconUrl(url) {
      return (await loadIcons())[siteKey(url)] ?? null;
    },

    async rememberFavicons() {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const icon = tab?.favIconUrl;
      if (!tab?.url || !icon?.startsWith('data:')) return;

      const cached = await loadIcons();
      const key = siteKey(tab.url);
      if (cached[key] === icon) return;

      const next = { ...cached, [key]: icon };
      for (const stale of Object.keys(next).slice(0, -faviconLimit)) delete next[stale];

      icons = next;
      await browser.storage.local.set({ [FAVICON_KEY]: next });
    },
  };
}

const declaredOrigins = () => browser.runtime.getManifest().host_permissions ?? [];
