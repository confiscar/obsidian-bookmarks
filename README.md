# Obsidian bookmarks

A small browser extension that keeps your bookmarks in a markdown file inside an Obsidian vault.

- **★ Save bookmark** — prefills the page name and URL, lets you edit both, appends one line to your file.
- **Bookmark list** — every markdown link in the file, rendered under the button, refreshed after each save. Click to open.
- **⚙ Settings** — a page of its own (back button returns to the list) for choosing the file and how to reach Obsidian.

Works in Chrome (and Chromium: Edge, Brave, …) and Firefox from one codebase.

## How it works

The extension does not touch your filesystem. It talks to the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin over `127.0.0.1`, which means **Obsidian is the only writer of the vault file** — your open editor, Obsidian Sync, and other tooling never get clobbered by the extension writing behind Obsidian's back.

```
popup ──fetch──▶ Obsidian Local REST API (127.0.0.1:27123) ──▶ vault/bookmarks.md
```

No native messaging host, no background daemon, nothing to keep running except Obsidian itself.

## Requirements

- [Obsidian](https://obsidian.md) with the vault you want to write into.
- The **Local REST API** community plugin (`coddingtonbear/obsidian-local-rest-api`).
- Obsidian running with that vault open, and the plugin's **plain HTTP server enabled on port 27123** (Settings → Local REST API → *Enable HTTP server*). The HTTPS server on 27124 works too, but uses a self-signed certificate you would have to trust.

## Install

### 1. Obsidian side

1. Settings → Community plugins → Browse → install **Local REST API**, then enable it.
2. Settings → Local REST API → enable the HTTP server (port `27123`).
3. Copy the **API key** shown on that page.

### 2. Build the extension

```sh
npm run build
```

No dependencies, no network access — it just copies `src/` into `dist/chrome` and `dist/firefox` and drops the Firefox-only manifest key from the Chrome build.

### 3. Load it

**Chrome / Edge / Brave** — go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the repo's `dist/chrome` folder.

**Firefox** — go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and select `dist/firefox/manifest.json`. A temporary add-on disappears when Firefox restarts; for a permanent install the extension must be signed (`web-ext sign`, or publish it as unlisted on AMO).

### 4. Configure

Click the extension icon, then **⚙** (the **←** button returns to your bookmarks):

| Field | Value |
| --- | --- |
| Obsidian API base | `http://127.0.0.1:27123` |
| API key | the key from step 1 |
| Bookmark file (vault-relative) | e.g. `bookmarks.md`, or `Notes/bookmarks.md` |

The file is created on the first save if it does not exist. **Test connection** checks that Obsidian is answering before you save anything.

On Firefox, host permissions are opt-in: if the list stays empty, click **Request local access** and accept the prompt (it can also be granted later in `about:addons` → Permissions → *Access your data for 127.0.0.1*).

## Usage

1. Browse to a page.
2. Click the toolbar icon, then **★ Save bookmark**.
3. Adjust the name and URL if you want, and press **Save**.

The line is appended to your file and the list below refreshes:

```md
# Bookmarks

- [Some article](https://example.com/article)
- [Another one](https://other.test/)
```

Anything else already in the file — headings, notes, tags, other links — is left untouched. Only the trailing newline and the new line are ever added.

### What the list shows

Every `[name](http://…)` or `[name](https://…)` link in the file, in file order: images (`![alt](…)`), wikilinks (`[[…]]`), and non-http links (`mailto:`, `file:`, …) are ignored. Names are un-escaped on read and escaped on write, so a name containing `]` round-trips. Nothing is deduplicated and nothing is deleted.

## Development

```sh
npm test          # unit tests: parsing/escaping, and the REST store against a fake server
npm run build     # → dist/chrome, dist/firefox
```

To work without Obsidian running (or without touching your vault), start the bundled fake of the plugin:

```sh
node scripts/fake-obsidian.mjs --port=27123 --key=test-key
```

It implements the three endpoints the extension uses, keeps the "vault" in memory, and seeds a small vault — `bookmarks.md`, plus a `Bookmarks/` folder holding `Weblinks.md` and `ReadLater.md` — so you can exercise both a good target and the folder mistake. Point the extension at it with API base `http://127.0.0.1:27123` and API key `test-key`.

### Layout

```
src/
  manifest.json        MV3 manifest (Firefox-only keys stripped at build time)
  popup.html/.css/.js  the popup; popup.js only picks a platform port and starts the core
  core/                browser-agnostic logic — no chrome.*/browser.* anywhere
    bookmarks.js       parse/format/normalize markdown links (pure)
    settings.js        defaults + validation (pure)
    obsidian-store.js  FileStore over the Local REST API (plain fetch)
    controller.js      popup state machine + DOM rendering
    ports.js           the two interfaces, as documentation
  platform/            one adapter per browser, nothing else
    chrome.js          callback APIs → promises
    firefox.js         already promise-based, so nearly a passthrough
test/                  node:test suites + the fake REST server
```

### Adding another browser

Implement the five-method `PlatformPort` from `src/core/ports.js` (`getActiveTab`, `loadSettings`, `saveSettings`, `openUrl`, `requestHostAccess`) and select it in `src/popup.js`. The core needs no changes — it never sees a browser API, only the port and the `FileStore`.

## Troubleshooting

**"Can't reach Obsidian at …"** — Obsidian is not running, the plugin is disabled, or the HTTP server is off. Try **Test connection** in settings.

**"Obsidian rejected the API key"** — re-copy the key from the plugin settings.

**Firefox: the list never loads** — the host permission was not granted; use **Request local access** or check `about:addons` → Permissions.

**Nothing is written to the vault** — the file path is relative to the vault root (no leading `/`) and must end in `.md` to show up as a note in Obsidian. It must be a **note, not a folder**: pointing it at a folder (easy to do when your vault has a `Bookmarks/` folder) makes Obsidian refuse the write with `File already exists.`, which the extension reports when you save settings.

**A write still fails** — the extension now includes Obsidian's own explanation and error code in the message. Obsidian logs the full stack for every 500 it returns: `Cmd+Opt+I` in Obsidian → Console.

**A different machine or port** — the manifest only allows `http://127.0.0.1/*` and `https://127.0.0.1/*`. Anything else needs editing `host_permissions` in `src/manifest.json` and rebuilding.

**Security** — the API key is stored unencrypted in the extension's local browser storage, and the REST API is reachable by anything on your machine that has the key. Both are local-only concerns; treat the key like a password.

## Limits of this version

- Appends only: no editing, deleting, reordering, folders or tags yet.
- The whole file is re-read (and every link re-parsed) on each refresh — fine for a few thousand lines.
- No duplicate detection, and no conflict handling beyond "Obsidian is the only writer".
- Requires Obsidian to be running; closing it makes the list empty and saves fail.
