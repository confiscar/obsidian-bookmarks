import { createFileStore } from '../core/obsidian-file-store.js';
import { createChromePort } from '../platform/chrome.js';
import { createFirefoxPort } from '../platform/firefox.js';
import { createController } from './controller.js';

// Chrome defines `browser` as an alias for `chrome`, so which namespaces exist cannot tell the
// two apart. The build is what knows: it strips `browser_specific_settings` for Chrome.
function runsInFirefox() {
  return Boolean(chrome.runtime.getManifest().browser_specific_settings);
}

createController({
  port: runsInFirefox() ? createFirefoxPort() : createChromePort(),
  createStore: (getSettings) => createFileStore({ getSettings }),
}).init();
