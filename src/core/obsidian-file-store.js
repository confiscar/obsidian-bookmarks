import { resolveVaultPath } from './vault-path.js';

export class FileStoreError extends Error {
  /**
   * @param {string} message shown to the user as-is
   * @param {ErrorOptions} [options] carries `cause` when a fetch failure is being wrapped
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'FileStoreError';
  }
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * @param {() => { apiBase: string, apiKey: string, filePath: string }} getSettings read on every call,
 *   so the store follows settings changes without being rebuilt
 * @returns {{
 *   ping: () => Promise<boolean>,
 *   readText: () => Promise<string>,
 *   appendLine: (line: string) => Promise<void>,
 *   findTargetProblem: () => Promise<string | null>,
 * }}
 */
export function createFileStore({ getSettings }) {
  const authorization = () => {
    const { apiKey } = getSettings();
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  };

  /** @param {string} vaultPath vault-relative path of a note, already resolved */
  const fileEndpoint = (vaultPath) => {
    const { apiBase } = getSettings();
    return `${apiBase}/vault/${vaultPath.split('/').map(encodeURIComponent).join('/')}`;
  };

  /** @param {string} vaultPath vault-relative folder, `''` for the vault root */
  const directoryEndpoint = (vaultPath) => {
    const { apiBase } = getSettings();
    const encoded = vaultPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return `${apiBase}/vault/${encoded}${vaultPath ? '/' : ''}`;
  };

  /**
   * @param {Response} response a failed response
   * @returns {Promise<string>} the plugin's own explanation, or '' when it sent none
   */
  async function errorReason(response) {
    const body = (await response.text().catch(() => '')).trim();
    const { message, errorCode } = parseJson(body) ?? {};

    if (message && errorCode) return `${message} (errorCode ${errorCode})`;
    if (message || errorCode) return message || `errorCode ${errorCode}`;
    return body.length > 200 ? `${body.slice(0, 200)}…` : body;
  }

  /**
   * @param {string} url
   * @param {RequestInit} [init]
   * @returns {Promise<Response>} success and 404 resolve; anything else throws FileStoreError
   */
  async function sendRequest(url, init = {}) {
    let response;
    try {
      response = await globalThis.fetch(url, init);
    } catch (cause) {
      const { apiBase } = getSettings();
      throw new FileStoreError(
        `Can't reach Obsidian at ${apiBase}. Is Obsidian running with the Local REST API plugin enabled?`,
        { cause },
      );
    }

    if (response.ok || response.status === 404) return response;

    const reason = await errorReason(response);
    const detail = reason ? `: ${reason}` : '.';
    if (response.status === 401 || response.status === 403) {
      throw new FileStoreError(
        `Obsidian rejected the API key${detail} Re-copy it from Obsidian → Settings → Local REST API.`,
      );
    }
    throw new FileStoreError(
      `Obsidian returned ${response.status} ${response.statusText}${detail}`,
    );
  }

  /**
   * @param {string} vaultPath vault-relative folder, `''` for the vault root
   * @returns {Promise<string[] | null>} null when the folder does not exist
   */
  async function listDirectory(vaultPath) {
    const response = await sendRequest(directoryEndpoint(vaultPath), { headers: authorization() });
    if (response.status === 404) return null;

    const { files } = parseJson(await response.text()) ?? {};
    return Array.isArray(files) ? files.map(String) : null;
  }

  const locateFile = () => resolveVaultPath(getSettings().filePath, listDirectory);

  return {
    async ping() {
      const { apiBase } = getSettings();
      await sendRequest(`${apiBase}/`, { headers: authorization() });
      return true;
    },

    async readText() {
      const { resolvedPath, problem } = await locateFile();
      if (!resolvedPath) throw new FileStoreError(problem);

      const response = await sendRequest(fileEndpoint(resolvedPath), { headers: authorization() });
      if (response.status === 404) return '';

      const isFolderListing = (response.headers.get('Content-Type') ?? '').includes('application/json');
      return isFolderListing ? '' : response.text();
    },

    /** @param {string} line one markdown list item; a trailing newline is optional */
    async appendLine(line) {
      const { resolvedPath, problem } = await locateFile();
      if (!resolvedPath) throw new FileStoreError(problem);

      await sendRequest(fileEndpoint(resolvedPath), {
        method: 'POST',
        headers: { ...authorization(), 'Content-Type': 'text/markdown' },
        body: line.endsWith('\n') ? line : `${line}\n`,
      });
    },

    /** @returns {Promise<string | null>} null when the target is usable as configured */
    async findTargetProblem() {
      return (await locateFile()).problem;
    },
  };
}
