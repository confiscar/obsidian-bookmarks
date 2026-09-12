/**
 * A tiny stand-in for the Obsidian Local REST API, for tests and local dev.
 *
 * Implements only what the extension uses, but models directories the way the
 * real plugin does:
 *   GET  /            → 200 (status, no auth)
 *   GET  /vault/{p}   → note text, a `{files: […]}` listing for a folder
 *                       (directories listed with a trailing slash), or 404
 *   POST /vault/{p}   → append to the note, creating it if needed; 500
 *                       "File already exists." when `p` is a folder, which is
 *                       what Obsidian's vault.create() throws for a TFolder
 */

import http from 'node:http';

/**
 * @param {object} [options]
 * @param {string} [options.apiKey]
 * @param {Record<string, string>} [options.files] initial vault files, by vault-relative path
 * @param {string[]} [options.dirs] extra empty directories
 * @param {number} [options.port] 0 = pick a free port
 */
export async function startFakeObsidian({
  apiKey = 'test-key',
  files = {},
  dirs = [],
  port: listenPort = 0,
} = {}) {
  const vault = new Map(Object.entries(files));
  const directories = new Set(dirs);

  const isDirectory = (path) =>
    path === '' ||
    directories.has(path) ||
    [...vault.keys()].some((key) => key.startsWith(`${path}/`));

  const listDirectory = (path) => {
    const prefix = path ? `${path}/` : '';
    const entries = new Set();

    for (const key of vault.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const cut = rest.indexOf('/');
      entries.add(cut === -1 ? rest : `${rest.slice(0, cut)}/`);
    }
    for (const dir of directories) {
      if (!dir.startsWith(prefix) || dir === path) continue;
      const rest = dir.slice(prefix.length);
      if (rest && !rest.includes('/')) entries.add(`${rest}/`);
    }
    return [...entries].sort();
  };

  /** @type {{ method: string, path: string, authorization?: string, body?: string }[]} */
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const json = (status, payload) =>
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));

    try {
      const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);

      if (path === '/') {
        requests.push({ method: req.method, path });
        json(200, { status: 'OK' });
        return;
      }
      if (!path.startsWith('/vault/')) {
        res.writeHead(404).end();
        return;
      }

      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({
        method: req.method,
        path,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        body,
      });

      if (req.headers.authorization !== `Bearer ${apiKey}`) {
        json(401, { message: 'Unauthorized', errorCode: 40101 });
        return;
      }

      const name = path.slice('/vault/'.length).replace(/\/$/, '');

      if (req.method === 'GET') {
        if (isDirectory(name)) {
          if (name && listDirectory(name).length === 0) {
            json(404, { message: 'Directory is empty', errorCode: 40401 });
            return;
          }
          json(200, { files: listDirectory(name) });
          return;
        }
        if (!vault.has(name)) {
          json(404, { message: 'Not found', errorCode: 40400 });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/markdown' }).end(vault.get(name));
        return;
      }

      if (req.method === 'POST') {
        if (name === '') {
          // The real plugin rejects a path with a trailing slash for writes.
          json(405, { message: 'Request method is valid only for files', errorCode: 40510 });
          return;
        }
        if (isDirectory(name)) {
          // A TFolder already occupies this path, so vault.create() refuses.
          json(500, { message: 'File already exists.', errorCode: 50001 });
          return;
        }
        vault.set(name, (vault.get(name) ?? '') + body);
        res.writeHead(204).end();
        return;
      }

      res.writeHead(405).end();
    } catch (error) {
      json(500, { message: String(error), errorCode: 50000 });
    }
  });

  await new Promise((resolve) => server.listen(listenPort, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    vault,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
