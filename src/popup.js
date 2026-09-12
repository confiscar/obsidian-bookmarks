/**
 * Entry point: pick the port for this browser, give the core a store, start.
 */

import { createController } from './core/controller.js';
import { createObsidianStore } from './core/obsidian-store.js';
import { createChromePort } from './platform/chrome.js';
import { createFirefoxPort } from './platform/firefox.js';

// Firefox defines `browser`; Chrome does not. Anything else about the host is
// hidden behind the port.
const isFirefox = typeof globalThis.browser !== 'undefined' && Boolean(globalThis.browser?.runtime?.id);
const port = isFirefox ? createFirefoxPort() : createChromePort();

createController({
  port,
  createStore: (getSettings) => createObsidianStore({ getSettings }),
}).init();
