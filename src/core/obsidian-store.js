/**
 * File store backed by the Obsidian Local REST API plugin.
 *
 * Platform-agnostic: plain `fetch`, no browser APIs. The extension talks to
 * Obsidian on loopback and Obsidian is the only writer of the vault file, so
 * Obsidian's own editor/sync state can never be clobbered by us.
 *
 * Endpoints used (see the plugin's OpenAPI spec):
 *   GET  /            → status, no auth
 *   GET  /vault/{p}   → note content, a `{files: […]}` listing for a folder, or 404
 *   POST /vault/{p}   → append to end of note, creating it when missing
 *
 * Before reading or writing, the configured path is resolved against the vault's
 * real listings. That matters because Obsidian reads through a filesystem
 * adapter (case-insensitive on macOS and Windows) but writes through a
 * case-sensitive index: a path spelled differently from the vault reads fine and
 * then fails to save with "File already exists." Resolving first means the
 * extension writes to the note the user meant.
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

  const folderProblem = (real) =>
    `“${real}” is a folder in your vault, not a note. Point the bookmark file at a file inside it, e.g. “${real}/bookmarks.md”.`;
  const mismatchProblem = (real, typed) =>
    `Your vault has “${real}”, not “${typed}”. Obsidian's index is case-sensitive, so a differently-spelled path reads fine but fails to save with “File already exists.” — change the bookmark file to “${real}”.`;

  const headers = (extra = {}) => {
    const { apiKey } = getSettings();
    return apiKey ? { Authorization: `Bearer ${apiKey}`, ...extra } : extra;
  };

  /**
   * @param {string} path vault-relative file path
   */
  const fileUrl = (path) => {
    const { apiBase } = getSettings();
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${apiBase}/vault/${encoded}`;
  };

  /**
   * @param {string} path vault-relative directory path ('' for the vault root)
   * @returns {string} always ends in `/`
   */
  const directoryUrl = (path) => {
    const { apiBase } = getSettings();
    const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return `${apiBase}/vault/${encoded}${path ? '/' : ''}`;
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

  /**
   * Files and `folder/` entries of a vault directory, or null when the directory
   * does not exist.
   * @param {string} path vault-relative directory path ('' for the vault root)
   * @returns {Promise<string[] | null>}
   */
  async function listDirectory(path) {
    const response = await request(directoryUrl(path), { headers: headers() });
    if (response.status === 404) return null;

    const listing = await response.json().catch(() => null);
    return Array.isArray(listing?.files) ? listing.files.map(String) : null;
  }

  /**
   * Resolve the configured path against the vault, one directory at a time.
   *
   * `path` is what reads and writes should use — null when the target cannot be
   * used at all. `problem` explains any difference from what the user typed, and
   * is null when the configured path is exactly right (including when the file
   * simply does not exist yet: the first save creates it).
   *
   * @returns {Promise<{ path: string | null, problem: string | null }>}
   */
  async function resolveTarget() {
    const { filePath } = getSettings();
    const segments = filePath.split('/').filter((segment) => segment && segment !== '.');

    if (!segments.length || segments.includes('..')) {
      return {
        path: null,
        problem: `“${filePath}” is not a vault-relative path. Use “bookmarks.md” for a note in the vault root, or “Bookmarks/Weblinks.md” for one in a folder.`,
      };
    }

    const normalized = segments.join('/');
    let problem =
      normalized === filePath ? null : `“${filePath}” points to “${normalized}”.`;

    /** @type {string[]} */
    const canonical = [];
    for (const [index, segment] of segments.entries()) {
      const listing = await listDirectory(canonical.join('/'));
      // The folder does not exist yet — the save will create the whole tail.
      if (listing === null) return { path: canonical.concat(segments.slice(index)).join('/'), problem };

      const isLast = index === segments.length - 1;
      const rest = segments.slice(index + 1);
      const exactFolder = listing.includes(`${segment}/`);
      const exactFile = listing.includes(segment);
      const nearMiss =
        exactFolder || exactFile
          ? undefined
          : listing.find((entry) => entry.replace(/\/$/, '').toLowerCase() === segment.toLowerCase());

      if (nearMiss) {
        const name = nearMiss.replace(/\/$/, '');
        const real = canonical.concat(name, rest).join('/');
        if (nearMiss.endsWith('/')) {
          if (isLast) return { path: null, problem: folderProblem(real) };
          problem ??= mismatchProblem(real, filePath);
          canonical.push(name);
          continue;
        }
        return { path: real, problem: mismatchProblem(real, filePath) };
      }

      if (exactFolder) {
        if (isLast) return { path: null, problem: folderProblem(canonical.concat(segment).join('/')) };
        canonical.push(segment);
        continue;
      }
      if (exactFile) {
        const real = canonical.concat(segment).join('/');
        if (!isLast) return { path: null, problem: `“${real}” is a file, so nothing can live inside it.` };
        return { path: real, problem };
      }
      return { path: canonical.concat(segment, rest).join('/'), problem };
    }

    return { path: canonical.join('/'), problem };
  }

  /** @param {string} path */
  async function readResolved(path) {
    const response = await request(fileUrl(path), { headers: headers() });
    if (response.status === 404) return '';
    // A folder answers with a JSON listing; there is nothing to parse.
    if ((response.headers.get('Content-Type') ?? '').includes('application/json')) return '';
    return response.text();
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
      const { path, problem } = await resolveTarget();
      if (!path) throw new FileStoreError(problem);
      return readResolved(path);
    },

    /**
     * Append one line to the end of the bookmark file, creating it if needed.
     * @param {string} line
     */
    async appendLine(line) {
      const { path, problem } = await resolveTarget();
      if (!path) throw new FileStoreError(problem);

      const body = line.endsWith('\n') ? line : `${line}\n`;
      await request(fileUrl(path), {
        method: 'POST',
        headers: headers({ 'Content-Type': 'text/markdown' }),
        body,
      });
    },

    /**
     * Describe anything unusable about the configured target, or null when it is
     * fine. Shown when settings are saved, so a bad path is caught before the
     * user tries to bookmark something.
     * @returns {Promise<string | null>}
     */
    async checkTarget() {
      return (await resolveTarget()).problem;
    },
  };
}
