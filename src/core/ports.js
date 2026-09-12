/**
 * The two boundaries the core is written against. Documentation only — nothing
 * here is imported at runtime.
 */

/**
 * Everything the core needs from the host browser. `platform/chrome.js` and
 * `platform/firefox.js` each implement this; the core cannot tell them apart.
 *
 * @typedef {object} PlatformPort
 * @property {'chrome' | 'firefox'} name
 * @property {() => Promise<{ url: string, title: string } | null>} getActiveTab
 *   The tab the popup was opened from, or null when it is not readable.
 * @property {() => Promise<Partial<import('./settings.js').Settings>>} loadSettings
 * @property {(settings: import('./settings.js').Settings) => Promise<void>} saveSettings
 * @property {(url: string) => Promise<void>} openUrl  Open in a new tab.
 * @property {() => Promise<boolean>} requestHostAccess
 *   Make sure the extension may talk to the local Obsidian API, prompting if
 *   the browser requires it. Resolves true when access is available.
 */

/**
 * Where bookmarks live.
 *
 * @typedef {object} FileStore
 * @property {() => Promise<string>} readText   File contents; '' when absent.
 * @property {(line: string) => Promise<void>} appendLine  Append one line.
 */
