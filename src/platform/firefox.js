const declaredOrigins = () => browser.runtime.getManifest().host_permissions ?? [];

export function createFirefoxPort() {
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
  };
}
