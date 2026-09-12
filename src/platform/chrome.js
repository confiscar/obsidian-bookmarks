function callChromeApi(method, ...args) {
  return new Promise((resolve, reject) => {
    method(...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

const declaredOrigins = () => chrome.runtime.getManifest().host_permissions ?? [];

export function createChromePort() {
  return {
    name: 'chrome',

    async getActiveTab() {
      const [tab] = await callChromeApi(chrome.tabs.query, { active: true, currentWindow: true });
      if (!tab) return null;
      return { url: tab.url ?? '', title: tab.title ?? '' };
    },

    async loadSettings() {
      return (await callChromeApi(chrome.storage.local.get, 'settings'))?.settings ?? {};
    },

    async saveSettings(settings) {
      await callChromeApi(chrome.storage.local.set, { settings });
    },

    async openUrl(url) {
      await callChromeApi(chrome.tabs.create, { url });
    },

    async requestHostAccess() {
      const origins = declaredOrigins();
      if (await callChromeApi(chrome.permissions.contains, { origins })) return true;
      return Boolean(await callChromeApi(chrome.permissions.request, { origins }));
    },
  };
}
