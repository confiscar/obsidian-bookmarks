/**
 * Firefox implementation of the platform port.
 *
 * Firefox's `browser.*` APIs already return promises and reject with real
 * errors, so this adapter is a thin translation and nothing more. The one
 * behavioural difference worth knowing: Firefox makes manifest `host_permissions`
 * opt-in, so `requestHostAccess()` may actually show the user a prompt.
 */

/** @returns {import('../core/ports.js').PlatformPort} */
export function createFirefoxPort() {
  return {
    name: 'firefox',

    async getActiveTab() {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab) return null;
      return { url: tab.url ?? '', title: tab.title ?? '' };
    },

    async loadSettings() {
      const stored = await browser.storage.local.get('settings');
      return stored?.settings ?? {};
    },

    async saveSettings(settings) {
      await browser.storage.local.set({ settings });
    },

    async openUrl(url) {
      await browser.tabs.create({ url });
    },

    async requestHostAccess() {
      const origins = ['http://127.0.0.1/*', 'https://127.0.0.1/*'];
      if (await browser.permissions.contains({ origins })) return true;
      return browser.permissions.request({ origins });
    },
  };
}
