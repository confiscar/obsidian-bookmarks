import { createFileStore } from '../core/obsidian-file-store.js';
import { createChromePort } from '../platform/chrome.js';
import { createFirefoxPort } from '../platform/firefox.js';
import { createController } from './controller.js';

function builtForFirefox() {
  return Boolean(chrome.runtime.getManifest().browser_specific_settings);
}

createController({
  port: builtForFirefox() ? createFirefoxPort() : createChromePort(),
  createStore: (getSettings) => createFileStore({ getSettings }),
}).init();
