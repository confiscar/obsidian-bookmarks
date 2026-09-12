import { resolveVaultPath } from './vault-path.js';

export class FileStoreError extends Error {
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

export function createFileStore({ getSettings }) {
  const authorization = () => {
    const { apiKey } = getSettings();
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  };

  const fileEndpoint = (vaultPath) => {
    const { apiBase } = getSettings();
    return `${apiBase}/vault/${vaultPath.split('/').map(encodeURIComponent).join('/')}`;
  };

  const directoryEndpoint = (vaultPath) => {
    const { apiBase } = getSettings();
    const encoded = vaultPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return `${apiBase}/vault/${encoded}${vaultPath ? '/' : ''}`;
  };

  async function errorReason(response) {
    const body = (await response.text().catch(() => '')).trim();
    const { message, errorCode } = parseJson(body) ?? {};

    if (message && errorCode) return `${message} (errorCode ${errorCode})`;
    if (message || errorCode) return message || `errorCode ${errorCode}`;
    return body.length > 200 ? `${body.slice(0, 200)}…` : body;
  }

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

    async appendLine(line) {
      const { resolvedPath, problem } = await locateFile();
      if (!resolvedPath) throw new FileStoreError(problem);

      await sendRequest(fileEndpoint(resolvedPath), {
        method: 'POST',
        headers: { ...authorization(), 'Content-Type': 'text/markdown' },
        body: line.endsWith('\n') ? line : `${line}\n`,
      });
    },

    async findTargetProblem() {
      return (await locateFile()).problem;
    },
  };
}
