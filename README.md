# Obsidian bookmarks

<img src="assets/icon-source.png" alt="Obsidian bookmarks" width="180" />

A browser extension that keeps your bookmarks in a markdown file in your Obsidian vault: save the page you are on, and browse what you saved.

**It only works with the Obsidian app running** — the vault open, the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin enabled, and that plugin's HTTP server on. That is how the extension reads and writes the note: close Obsidian and the list is empty and saves fail.

- **★ Save bookmark** — prefills the page name, URL and folder, and writes one line into the note.
- **Bookmark list** — your headings as folders, closed by default, with **Open all** / **Close all**.
- **Pinned** — a pin writes the bookmark into the note's front matter, holding it at the top of the list.
- **Read later** — an optional second note: a clock button saves the page into it, a book button opens it, and the list splits into **Unread** and **Read**.
- **Favicons**, **edit** and **delete** on every entry.

One codebase, for Chrome (and Chromium: Edge, Brave, …) and Firefox.

## Requirements

- **Obsidian**, running, with the vault you want to write into open.
- The **Local REST API** community plugin, with its **HTTP server enabled** (Settings → Local REST API → *Enable HTTP server*, port `27123`) — the HTTPS server on 27124 works too, with a self-signed certificate to trust.
- The **API key** that plugin shows you.
- Only on Firefox: permission to reach `127.0.0.1`, asked for the first time you save settings.

## Install

1. In Obsidian: enable the plugin, enable the HTTP server, copy the API key.
2. Build the extension — no dependencies, no network:

   ```sh
   npm run build
   ```

3. Load it:
   - **Chrome / Edge / Brave** — `chrome://extensions`, turn on **Developer mode**, **Load unpacked**, pick `dist/chrome`.
   - **Firefox** — `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on…**, pick `dist/firefox/manifest.json`. That lasts until Firefox restarts; a permanent install has to be signed (`web-ext sign`, or unlisted on AMO).
4. Click the toolbar icon, then **⚙**: API base `http://127.0.0.1:27123`, the API key, and the bookmark file — `Bookmarks/Weblinks.md`, say. **Test connection** checks Obsidian answers.

The path is resolved against the vault's real contents when you save: a different spelling (case, `./`, doubled slashes) is corrected and reported, a folder or a path escaping the vault is refused, and the note is created on the first save.

## Usage

**Saving.** Browse to a page, click the icon, **★ Save bookmark**, adjust the name, URL and folder, then **Save**. The folder field lists the folders the note already has and defaults to `Unsorted`; type a new one — or a path like `Music/Djing` — and the headings it needs are written with it. Everything else in the file is left untouched.

**Folders** are the note's headings, nested by level and shown as their path (`Music/Production`), each with a count of what is inside, subfolders included. Opening the popup opens the pins and nothing else: folders are closed until you open one or press **Open all**. The root level is whatever level your file opens with — a `##` file gets `##` top-level folders. New top-level folders go at the end of the file, above any shallower heading there so they stay top level; a bookmark goes at the end of its folder's own list, above that folder's subfolders. New items reuse the bullet character the file uses, and headings and links inside code fences are ignored.

**Pinned.** The pin on a row toggles that bookmark in the note's front matter; the section sits at the top of the list and is the one thing the popup unfolds for you.

```md
---
pinned:
  - '[Chord player](https://chords.test/player)'
---
```

The quotes are required, because front matter is YAML and an unquoted `[name](url)` is a flow sequence. URLs are matched in normalized form, so `https://a.test` and `https://a.test/` are one bookmark, while the line keeps the note's own spelling. Removing the last pin removes the key, and the `---` block with it if the extension was what created the block. Items under `pinned:` that are not links are left alone, and an inline `pinned: […]` is refused with an explanation rather than rewritten.

**Read later.** Set a **read later file** in settings and two buttons appear. The **clock** under **★ Save bookmark** opens the same form scoped to that note — the button reads **Save for later**, and the folder field offers that note's headings — so the page is filed wherever you pick. The **book** in the header, left of **⚙**, opens the read later list, and fills in with the read later colour while you are looking at it. Left empty, neither button appears.

That list splits the note into **Unread** and **Read**: sections that fold like folders, unread open and read closed. The first action on a row is a tick instead of a pin, and clicking it moves the entry between the two — the state is a `read:` list in that note's front matter, the same shape as `pinned:`, so renaming a read entry keeps it read and deleting it takes its mark along.

**Favicons.** Chrome keeps an icon for every page it has seen and serves it to extensions from `_favicon/`, so its icons cover your browsing history and nothing is downloaded (that is what the `favicon` permission is for; the Firefox build drops it). Firefox has no such API, so the extension caches the icon of the page you are on when the popup opens — only `data:` icons, keyed by site, 200 sites — which means Firefox shows icons for sites visited since it was installed. Where there is nothing to show, a globe holds the row's alignment.

**Editing and deleting.** Every row carries a pin (or a tick), a pencil and a waste basket. Edit rewrites the bookmark where it stands, or moves it when you change the folder; if the URL changes, its pin — or its read mark — follows it. Delete asks first, naming what goes with it; because a bookmark is identified by its URL, deleting one that appears twice removes both lines.

## How it works

The extension never touches your filesystem. It talks to the Local REST API over `127.0.0.1`, which means **Obsidian is the only writer of the vault file** — your open editor, Obsidian Sync and other tooling never get clobbered by the extension writing behind Obsidian's back.

```
popup ──fetch──▶ Obsidian Local REST API (127.0.0.1:27123) ──▶ vault/Bookmarks/Weblinks.md
```

Each change reads the note immediately before writing it back, so the only gap is one round trip over loopback, and only the lines that need to change do.

## Troubleshooting

- **"Can't reach Obsidian at …"** — Obsidian is not running, the plugin is disabled, or the HTTP server is off. Try **Test connection** in settings.
- **"Obsidian rejected the API key"** — re-copy the key from the plugin's settings.
- **"File already exists."** — the configured path is not the one Obsidian's index has, so reads work but the write collides. The extension resolves the path against the vault before every read and write and reports the difference when you save settings. Obsidian logs the full stack for every 500 it returns: `Cmd+Opt+I` → Console.
- **Firefox: the list never loads** — the host permission was not granted. Use **Request local access**, or `about:addons` → Permissions.
- **A different machine or port** — the manifest only allows `127.0.0.1`. Anything else needs `host_permissions` in `src/manifest.json` and a rebuild.

**Security** — the API key sits unencrypted in the browser's extension storage, and the REST API is reachable by anything on your machine holding that key. Treat it like a password.

## Development

```sh
npm test          # node --test: link parsing and escaping, the REST store against a fake server
npm run build     # → dist/chrome, dist/firefox

# a plugin-less fake of the vault, kept in memory, for working without Obsidian running
node scripts/fake-obsidian.mjs --port=27123 --key=test-key
```

`src/core/` is browser-agnostic domain logic, `src/popup/` is the popup and its controller, and `src/platform/` is the only place `chrome.*` or `browser.*` appears — one file per browser, handing the controller an adapter whose methods are listed on the `PlatformPort` typedef. Chrome's MV3 methods throw *Illegal invocation* when called detached from their owner, so the Chrome adapter always keeps its receiver.

`src/icons/` is scaled from `assets/icon-source.png`: trimmed to the artwork, then centred in a square with a tenth of the canvas left as margin.

```sh
for size in 16 32 48 128; do
  inner=$(( size * 9 / 10 ))
  magick assets/icon-source.png -trim +repage -resize ${inner}x${inner} \
    -background none -gravity center -extent ${size}x${size} -strip src/icons/icon-${size}.png
done
```

The glyphs in `src/popup/icons.js` are [Bootstrap Icons](https://github.com/twbs/icons) (MIT) — see [THIRD-PARTY.md](THIRD-PARTY.md), which the build copies into each `dist/` folder beside them.

## Limits

- Deleting is immediate and there is no undo in the popup: the note keeps the last state you saw, and a vault under git keeps the rest.
- Pinned and read entries also stay in their folders, in file order.
- The whole note is re-read and every link re-parsed on each refresh — fine for a few thousand lines.
- No duplicate detection, and no conflict handling beyond "Obsidian is the only writer".
- On Firefox, icons only cover sites you have visited with the extension installed.
- Folders come from headings, and markdown stops at six levels: a deeper path is refused rather than flattened.
