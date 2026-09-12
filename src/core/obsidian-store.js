/**
 * File store backed by the Obsidian Local REST API plugin.
 *
 * Platform-agnostic: plain `fetch`, no browser APIs. The extension talks to
 * Obsidian on loopback and Obsidian is the only writer of the vault file, so
 * Obsidian's own editor/sync state can never be clobbered by us.
 *
 * Endpoints used (see the plugin's OpenAPI spec):
 *   GET  /            → status, no auth
 *   GET  /vault/{p}   → note content, 404 when it does not exist yet
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
   * Perform a request, translating transport/auth failures into messages that
   * tell the user what to do next.
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

    if (response.status === 401 || response.status === 403) {
      throw new FileStoreError(
        'Obsidian rejected the API key. Re-copy it from Obsidian → Settings → Local REST API.',
      );
    }
    if (response.status === 404) return { status: 404, response };
    if (!response.ok) {
      throw new FileStoreError(`Obsidian returned ${response.status} ${response.statusText}.`);
    }
    return { status: response.status, response };
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
      const { status, response } = await request(vaultUrl(), { headers: headers() });
      if (status === 404) return '';
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
  };
}
