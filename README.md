# Obsidian bookmarks

<img src="assets/icon-source.png" alt="Obsidian bookmarks" width="180" />

A browser extension that keeps your bookmarks in a markdown file in your Obsidian vault: save the page you are on, and browse what you saved.

**The extension only works with the Obsidian app + the REST API plugin running**

## Requirements

- **Obsidian**, running, with the vault you want to write into open.
- The **Local REST API** community plugin, with its **HTTP server enabled** (Settings → Local REST API → *Enable HTTP server*, port `27123`) — the HTTPS server on 27124 works too, with a self-signed certificate to trust.
- The **API key** that plugin shows you.

## Install

1. In Obsidian: enable the REST API plugin, enable the HTTP server, copy the API key.
2. Build the extension — no dependencies, no network:

   ```sh
   npm run build
   ```

3. Load it:
   - **Chrome / Edge / Brave** — `chrome://extensions`, turn on **Developer mode**, **Load unpacked**, pick `dist/chrome`.
   - **Firefox** — `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on…**, pick `dist/firefox/manifest.json`. That lasts until Firefox restarts; a permanent install has to be signed (`web-ext sign`, or unlisted on AMO).
4. Click the toolbar icon, then **⚙**: API base `http://127.0.0.1:27123`, the API key, and the bookmark file — `Bookmarks/Weblinks.md`, say. **Test connection** checks Obsidian answers.

## Usage

The extension saves bookmarks to a local markdown file in an Obsidian vault.

You can save bookmarks into groups. These groups are represented as folder paths in the extension, but are translated to markdown headings in the markdown file.

E.g. the group `Music/Production/Samples` would be transformed into a link under the headings:
```
# Music
## Production
### Samples
```

You can also pin bookmarks! Pin data is transformed into mark down front matter.

You can also reorder by dragging a row. Which gap it lands in is where you hold it, and how deep it goes is how far right you drag — so a bookmark dragged right joins the folder above it, and a folder dragged left comes back out to the top level. A folder lands among folders only, and brings everything under it, every heading in that block gaining or losing a level to match; a bookmark lands wherever you drop it in that folder's own list.

Pinned rows drag among themselves, in the front matter list they come from, and the read later view's rows drag the same way — moving an entry into another folder there, without changing whether it is read. A drag that would not change the order leaves the file exactly as it was.

## Troubleshooting

- **"Can't reach Obsidian at …"** — Obsidian is not running, the plugin is disabled, or the HTTP server is off. Try **Test connection** in settings.
- **"Obsidian rejected the API key"** — re-copy the key from the plugin's settings.
- **"File already exists."** — the configured path is not the one Obsidian's index has, so reads work but the write collides. The extension resolves the path against the vault before every read and write and reports the difference when you save settings. Obsidian logs the full stack for every 500 it returns: `Cmd+Opt+I` → Console.
- **Firefox: the list never loads** — the host permission was not granted. Use **Request local access**, or `about:addons` → Permissions.
- **A different machine or port** — the manifest only allows `127.0.0.1`. Anything else needs `host_permissions` in `src/manifest.json` and a rebuild.

**Security** — the API key sits unencrypted in the browser's extension storage, and the REST API is reachable by anything on your machine holding that key. Treat it like a password.

## Development

```sh
npm test # Run unit tests
npm run build # Builds /dist folder
node scripts/fake-obsidian.mjs --port=27123 --key=test-key # Emulates obsidian for testing
```