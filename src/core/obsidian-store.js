/**
 * File store backed by the Obsidian Local REST API plugin.
 *
 * Platform-agnostic: plain `fetch`, no browser APIs. The extension talks to
 * Obsidian on loopback and Obsidian is the only writer of the vault file, so
 * Obsidian's own editor/sync state can never be clobbered by us.
 *
 * Endpoints used (see the plugin's OpenAPI spec):
 *   GET  /            → status, no auth
 *   GET  /vault/{p}   → note content (JSON listing when `p` is a folder), 404 when absent
 *   POST /vault/{p}   → append to end of note, creating it when missing
 */

export class FileStoreError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'FileStoreError';
  }
}

/**
 * @param {object} options
 * @param {() => import('./settings.js').Settings} options.getSettings
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createObsidianStore({ getSettings, fetchImpl }) {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  const vaultUrl = () => {
    const { apiBase, filePath } = getSettings();
    const path = filePath.split('/').map(encodeURIComponent).join('/');
    return `${apiBase}/vault/${path}`;
  };

  const headers = (extra = {}) => {
    const { apiKey } = getSettings();
    return apiKey ? { Authorization: `Bearer ${apiKey}`, ...extra } : extra;
  };

  /**
   * The plugin answers errors with `{"message": …, "errorCode": …}` — the only
   * place that says *why* a write failed, so never drop it.
   * @param {Response} response
   */
  async function reason(response) {
    const body = await response.text().catch(() => '');
    const trimmed = body.trim();
    if (!trimmed) return '';

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.message && parsed?.errorCode) return `${parsed.message} (errorCode ${parsed.errorCode})`;
      if (parsed?.message) return parsed.message;
      if (parsed?.errorCode) return `errorCode ${parsed.errorCode}`;
    } catch {
      // Not JSON — fall through to the raw body.
    }
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  }

  /**
   * Perform a request. Resolves for success and for 404 (callers decide whether
   * a missing file matters); throws a readable error for everything else.
   * @param {string} url
   * @param {RequestInit} [init]
   */
  async function request(url, init = {}) {
    let response;
    try {
      response = await doFetch(url, init);
    } catch (cause) {
      const { apiBase } = getSettings();
      throw new FileStoreError(
        `Can't reach Obsidian at ${apiBase}. Is Obsidian running with the Local REST API plugin enabled?`,
        { cause },
      );
    }

    if (response.ok || response.status === 404) return response;

    const why = await reason(response);
    const suffix = why ? `: ${why}` : '.';
    if (response.status === 401 || response.status === 403) {
      throw new FileStoreError(
        `Obsidian rejected the API key${suffix} Re-copy it from Obsidian → Settings → Local REST API.`,
      );
    }
    throw new FileStoreError(
      `Obsidian returned ${response.status} ${response.statusText}${suffix}`,
    );
  }

  return {
    /** Is the REST API reachable at all? The root route needs no API key. */
    async ping() {
      const { apiBase } = getSettings();
      await request(`${apiBase}/`, { headers: headers() });
      return true;
    },

    /**
     * Read the bookmark file. A missing file is not an error — it is an empty
     * file that the first save will create.
     * @returns {Promise<string>}
     */
    async readText() {
      const response = await request(vaultUrl(), { headers: headers() });
      if (response.status === 404) return '';
      // A folder answers with a JSON listing; there is nothing to parse.
      if ((response.headers.get('Content-Type') ?? '').includes('application/json')) return '';
      return response.text();
    },

    /**
     * Append one line to the end of the bookmark file, creating it if needed.
     * @param {string} line
     */
    async appendLine(line) {
      const body = line.endsWith('\n') ? line : `${line}\n`;
      await request(vaultUrl(), {
        method: 'POST',
        headers: headers({ 'Content-Type': 'text/markdown' }),
        body,
      });
    },

    /**
     * Catch the configuration mistake that produces an inscrutable failure:
     * pointing "bookmark file" at a folder. Obsidian then refuses the write with
     * "File already exists." because a `TFolder` is already living at that path.
     *
     * Asks the *parent* for its listing, which reports directories with a
     * trailing slash — the direct approach would miss an empty folder, since the
     * plugin answers 404 for one.
     * @returns {Promise<string | null>} what is wrong, or null when the target is usable
     */
    async checkTarget() {
      const { apiBase, filePath } = getSettings();
      const cutoff = filePath.lastIndexOf('/');
      const parent = cutoff === -1 ? '' : filePath.slice(0, cutoff);
      const leaf = filePath.slice(cutoff + 1);
      if (!leaf) return null;

      const encodedParent = parent
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
      const url = `${apiBase}/vault/${encodedParent}${parent ? '/' : ''}`;

      const response = await request(url, { headers: headers() });
      if (response.status === 404) return null; // parent not created yet either
      const listing = await response.json().catch(() => null);
      if (!Array.isArray(listing?.files)) return null;

      const folder = listing.files.find(
        (entry) =>
          typeof entry === 'string' &&
          entry.endsWith('/') &&
          entry.slice(0, -1).toLowerCase() === leaf.toLowerCase(),
      );
      if (!folder) return null;

      return `“${folder}” is a folder in your vault, not a note. Point the bookmark file at a file inside it, e.g. “${filePath}/bookmarks.md”.`;
    },
  };
}
