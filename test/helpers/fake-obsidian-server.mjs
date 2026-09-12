/**
 * A tiny stand-in for the Obsidian Local REST API, for tests and local dev.
 *
 * Implements only what the extension uses:
 *   GET  /            → 200 (status, no auth)
 *   GET  /vault/{p}   → note text, or 404
 *   POST /vault/{p}   → append to the note, creating it if needed
 */

import http from 'node:http';

/**
 * @param {object} [options]
 * @param {string} [options.apiKey]
 * @param {Record<string, string>} [options.files] initial vault contents
 * @param {number} [options.port] 0 = pick a free port
 */
export async function startFakeObsidian({ apiKey = 'test-key', files = {}, port: listenPort = 0 } = {}) {
  /** @type {Map<string, string>} */
  const vault = new Map(Object.entries(files));
  /** @type {{ method: string, path: string, authorization?: string, body?: string }[]} */
  const requests = [];

  const server = http.createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);

      if (path === '/') {
        requests.push({ method: req.method, path });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
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
        res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"message":"Unauthorized"}');
        return;
      }

      const name = path.slice('/vault/'.length);
      if (req.method === 'GET') {
        if (!vault.has(name)) {
          res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"message":"Not found"}');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/markdown' }).end(vault.get(name));
        return;
      }
      if (req.method === 'POST') {
        vault.set(name, (vault.get(name) ?? '') + body);
        res.writeHead(204).end();
        return;
      }
      res.writeHead(405).end();
    } catch (error) {
      res.writeHead(500).end(String(error));
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
