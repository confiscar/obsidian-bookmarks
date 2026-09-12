export const DEFAULT_SETTINGS = Object.freeze({
  apiBase: 'http://127.0.0.1:27123',
  apiKey: '',
  filePath: 'bookmarks.md',
});

export function normalizeSettings(raw = {}) {
  const apiBase = String(raw.apiBase ?? '').trim() || DEFAULT_SETTINGS.apiBase;
  const filePath = String(raw.filePath ?? '').trim() || DEFAULT_SETTINGS.filePath;

  return {
    apiBase: apiBase.replace(/\/+$/, ''),
    apiKey: String(raw.apiKey ?? '').trim(),
    filePath,
  };
}

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
