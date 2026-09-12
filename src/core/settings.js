/**
 * @typedef {object} Settings
 * @property {string} apiBase origin of the Local REST API, e.g. `http://127.0.0.1:27123`
 * @property {string} apiKey bearer token copied from the plugin's settings
 * @property {string} filePath bookmark note, relative to the vault root
 * @property {string} readLaterPath read later note, relative to the vault root; '' turns the
 *   read later feature off entirely
 */

export const DEFAULT_SETTINGS = Object.freeze({
  apiBase: 'http://127.0.0.1:27123',
  apiKey: '',
  filePath: 'bookmarks.md',
  readLaterPath: '',
});

/**
 * @param {Partial<Settings>} [raw] whatever came out of browser storage or the settings form
 * @returns {Settings} usable settings, filled in from the defaults where needed
 */
export function normalizeSettings(raw = {}) {
  const apiBase = String(raw.apiBase ?? '').trim() || DEFAULT_SETTINGS.apiBase;
  const filePath = String(raw.filePath ?? '').trim() || DEFAULT_SETTINGS.filePath;

  return {
    apiBase: apiBase.replace(/\/+$/, ''),
    apiKey: String(raw.apiKey ?? '').trim(),
    filePath,
    readLaterPath: String(raw.readLaterPath ?? '').trim(),
  };
}

/**
 * @param {Settings} settings
 * @returns {string[]} human-readable problems, empty when the settings are usable as they are
 */
export function findSettingsProblems(settings) {
  const problems = [];

  if (!/^https?:\/\/\S+$/i.test(settings.apiBase)) {
    problems.push('Obsidian API base must be an http(s) URL.');
  }
  if (!settings.filePath) {
    problems.push('Bookmark file path is required.');
  }
  if (!settings.apiKey) {
    problems.push('API key is required — copy it from Obsidian → Settings → Local REST API.');
  }
  return problems;
}
