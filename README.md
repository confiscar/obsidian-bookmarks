# Obsidian bookmarks

A small browser extension that keeps your bookmarks in a markdown file inside an Obsidian vault.

- **★ Save bookmark** — prefills the page name, URL and folder, lets you edit all three, and writes one line into the note.
- **Bookmark list** — your headings as folders, closed by default, with **Open all** / **Close all**. Click a bookmark to open it.
- **Pinned** — a pin on every entry writes that bookmark into the note's front matter, holding it at the top of the list.
- **Edit and delete** — every entry also carries a pencil and a waste basket: edit rewrites the name, URL and folder, delete removes the line.
- **⚙ Settings** — a page of its own (back button returns to the list) for choosing the file and how to reach Obsidian.

Works in Chrome (and Chromium: Edge, Brave, …) and Firefox from one codebase.

## How it works

The extension does not touch your filesystem. It talks to the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin over `127.0.0.1`, which means **Obsidian is the only writer of the vault file** — your open editor, Obsidian Sync, and other tooling never get clobbered by the extension writing behind Obsidian's back.

Putting a bookmark in a folder means the note is read, the new lines are placed in it, and the result is written back — the read happens immediately before the write, so the only gap is one round trip over loopback.

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
| Bookmark file (vault-relative) | e.g. `bookmarks.md`, or `Bookmarks/Weblinks.md` |

The path is resolved against your vault's real contents when you save settings. If it is spelled differently from the vault (case, `./`, doubled slashes) the extension says so and uses the correct path anyway; a folder, or a path that escapes the vault (`/`, `..`), is refused with an explanation. The first save creates the note if it does not exist yet.

**Test connection** checks that Obsidian is answering before you save anything.

On Firefox, host permissions are opt-in: if the list stays empty, click **Request local access** and accept the prompt (it can also be granted later in `about:addons` → Permissions → *Access your data for 127.0.0.1*).

## Usage

1. Browse to a page.
2. Click the toolbar icon, then **★ Save bookmark**.
3. Adjust the name, URL and folder, then press **Save**.

The folder field lists every folder already in the file and defaults to `Unsorted`. Type a name that does not exist yet — or a path such as `Music/Djing` — and the headings it needs are written along with the bookmark. The list refreshes, and the note only ever gains the lines it needs:

```md
## Music

### Production
* [Chord player](https://chords.test/player)
```

Anything else already in the file — headings, notes, tags, other links — is left untouched. Only the trailing newline and the new line are ever added.

### What the list shows

Every `[name](http://…)` or `[name](https://…)` link in the file: images (`![alt](…)`), wikilinks (`[[…]]`), and non-http links (`mailto:`, `file:`, …) are ignored. Links above the first heading are listed at the top. Names are un-escaped on read and escaped on write, so a name containing `]` round-trips. Nothing is deduplicated and nothing is deleted.

### Folders

Headings are folders, nested by their level and shown as their path — `Music/Production`. Each header carries the number of bookmarks it holds, subfolders included, so a closed folder still says how much is inside it.

Opening the popup opens **Pinned and nothing else**; every folder is closed until you open it, or press **Open all**. **Open all** / **Close all** act on the whole tree, and opening a folder opens everything inside it too, which is why a closed root comes back with its subfolders expanded. A folder that appears *while you are looking* — one a save just created — arrives open, so you can see what landed in it.

The **root level is the level your file opens with**. A note that starts at `##` has `##` top-level folders and `###` children; a note that opens with a title (`# My links`) treats that title as the top-level folder with the `##` sections inside it. New top-level folders are written at that same level.

A new top-level folder goes at the end of the file — unless a *shallower* heading is still open there (a stray `# Piracy` in a `##` file, say), in which case it is written above that heading so it stays top level instead of being swallowed by it.

Insertion details worth knowing, because they are visible in the file:

- Folders you type are matched case-insensitively (`music/production` finds `Music/Production`) and the note keeps the file's own spelling.
- A bookmark goes at the end of its folder's own list, **above** that folder's subfolders.
- A newly created subfolder is appended **after** the subfolders already there.
- New items reuse the bullet character the file already uses, `*` or `-`.
- Headings and links inside fenced code blocks are ignored.

### Pinned

The pin at the end of each entry toggles that bookmark in the note's front matter: an outline pin means it is not pinned, a filled one means it is. Pinned bookmarks are held at the **top of the list**, above the folders, so they are reachable without opening the folder they live in:

```
Pinned  2
  OneMotion      onemotion.com
  Amazon         amazon.co.uk

  Development    2
  ...
```

The pinned rows are the same rows as the ones in the tree, so unpinning either copy removes the line and the two views can never disagree. The section appears once something is pinned and is **open by default** — it is the one thing the popup unfolds for you — and it folds like a folder: click **Pinned** to collapse it, and **Open all** / **Close all** cover it along with everything else.

The pin is an inline SVG rather than an emoji, so it takes the theme's colour and needs no font: outline when unpinned, filled when pinned. It is the `pin`/`pin-fill` pair from [Bootstrap Icons](https://github.com/twbs/icons) (MIT) — see [THIRD-PARTY.md](THIRD-PARTY.md).

### Editing and deleting

Every row's actions are **pin**, **pencil**, **waste basket**, in that order.

- **Edit** opens the same form, filled with the bookmark's name, URL and folder, and the button becomes **Update**. Saving rewrites the bookmark **where it stands** when the folder is unchanged — same line, same place in the file — and moves it when you point it at another folder. Leaving the folder empty keeps a bookmark where it is; a bookmark that only exists in the front matter gets a line in the folder you type. If the URL changes, its pin follows it.
- **Delete** asks first, in a panel that names the bookmark and says what goes with it — *Removes its line from Music/Production. Its pin goes too.* Cancel is focused, so a stray Enter can't delete anything. Confirming removes the line and takes the pin with it, so a deleted bookmark can't linger at the top of the list. Deleting a bookmark that is no longer in the note just clears its pin.

Both act on the URL, which is how a bookmark is identified everywhere else: deleting a URL that appears in two folders removes both lines.

Entries are one line per pin, in the order they were added:

```md
---
pinned:
  - '[Chord player](https://chords.test/player)'
  - '[Spotify](https://open.spotify.com/)'
---
```

Each entry is single-quoted because front matter is YAML: an unquoted `[name](url)` opens a flow sequence, so the trailing `(url)` makes the property unreadable in Obsidian.

- Clicking a solid pin removes that URL's line. When the last pin goes the `pinned:` key goes with it, and if the block then holds nothing else — because the extension created it — the whole `---` block is removed too, leaving the note exactly as it was.
- URLs are compared in normalized form, so `https://a.test` and `https://a.test/` are the same bookmark, while the line that gets written keeps the spelling the note itself uses.
- Front matter is skipped when the note is read, so a pinned bookmark never appears twice in the list.
- Hand edits are respected: items under `pinned:` that are not links are left alone (and keep the key alive), and an inline value like `pinned: ["[…]"]` is refused with an explanation rather than rewritten. `pinned: []` is filled in as an ordinary block list.

## Development

```sh
npm test          # unit tests: parsing/escaping, and the REST store against a fake server
npm run build     # → dist/chrome, dist/firefox
```

To work without Obsidian running (or without touching your vault), start the bundled fake of the plugin:

```sh
node scripts/fake-obsidian.mjs --port=27123 --key=test-key
```

It implements the endpoints the extension uses and keeps the "vault" in memory: a flat `bookmarks.md`, plus `Bookmarks/Weblinks.md` seeded with `##` and `###` folders, `*` bullets and an `# Piracy` outlier — close enough to a real note to exercise folders, creation and insertion. Point the extension at it with API base `http://127.0.0.1:27123` and API key `test-key`, and set the bookmark file to `Bookmarks/Weblinks.md`.

It mirrors the real plugin's awkward corners on purpose: a folder is listed as `{"files":[…]}` with directories suffixed `/`, and a write aimed at a folder answers exactly what Obsidian answers — `500 {"message":"File already exists.","errorCode":50001}`.

### Layout

```
src/
  manifest.json           MV3 manifest (Firefox-only keys stripped at build time)
  popup/                  the popup: entrypoint, markup, styles, and its controller
    index.html            main view (save + list) and settings view
    index.css
    index.js              picks a platform port, starts the controller
    controller.js         state machine + the save/settings flows
    bookmark-list.js      renders the pinned section and the folder tree
    icons.js              the pin, pencil and waste basket glyphs, from Bootstrap Icons (MIT)
  core/                   browser-agnostic domain logic
    bookmarks.js          markdown links ⇄ bookmarks, URL normalization
    bookmark-tree.js      headings ⇄ folder tree, and placing a bookmark in one
    front-matter.js       the pinned list in the note's YAML front matter
    settings.js           defaults, normalization, problems
    vault-path.js         resolves a typed path against the vault's real folders
    obsidian-file-store.js  read/append a note over the Local REST API
  platform/               the only browser-specific code
    chrome.js             callback APIs → promises
    firefox.js            already promise-based, so nearly a passthrough
scripts/                  build + a fake Obsidian for local development
test/                     node:test suites + the fake REST server
```

The rule the folders encode: `core/` and `popup/` never mention `chrome.*` or `browser.*`; `platform/` never contains product logic. The popup loads an adapter and hands it to the controller, which only knows the methods below.

### Adding another browser

Implement these five methods and select the adapter in `src/popup/index.js`:

| Method | Contract |
| --- | --- |
| `getActiveTab()` | `{ url, title }` for the tab the popup opened from, or null |
| `loadSettings()` / `saveSettings(settings)` | persist the settings object |
| `openUrl(url)` | open a bookmark in a new tab |
| `requestHostAccess()` | ensure the extension may call `127.0.0.1`, prompting if needed; resolves a boolean |

`test/platform-adapters.test.js` pins both adapters to that contract, so a new one can be checked the same way.

## Troubleshooting

**"Can't reach Obsidian at …"** — Obsidian is not running, the plugin is disabled, or the HTTP server is off. Try **Test connection** in settings.

**"Obsidian rejected the API key"** — re-copy the key from the plugin settings.

**Firefox: the list never loads** — the host permission was not granted; use **Request local access** or check `about:addons` → Permissions.

**Nothing is written to the vault** — the file path is relative to the vault root (no leading `/`) and must end in `.md` to show up as a note in Obsidian. It must be a **note, not a folder**: pointing it at a folder (easy to do when your vault has a `Bookmarks/` folder) is reported when you save settings, and nothing is written.

**"File already exists." from Obsidian** — the configured path is not the one Obsidian's index has, so the write looks up nothing and then collides with the file that is really there. Reads still work, because they go through the filesystem (case-insensitive on macOS/Windows) while Obsidian's index is case-sensitive. The extension resolves the path against your vault's listings before every read and write and reports the difference when you save settings — e.g. *Your vault has "Bookmarks/Weblinks.md", not "bookmarks/weblinks.md"*. If a save still fails, Obsidian logs the full stack for every 500 it returns: `Cmd+Opt+I` in Obsidian → Console.

**A different machine or port** — the manifest only allows `http://127.0.0.1/*` and `https://127.0.0.1/*`. Anything else needs editing `host_permissions` in `src/manifest.json` and rebuilding.

**Security** — the API key is stored unencrypted in the extension's local browser storage, and the REST API is reachable by anything on your machine that has the key. Both are local-only concerns; treat the key like a password.

## Limits of this version

- Once confirmed, deleting is immediate and there is no undo in the popup: the note keeps the last state you saw, and a vault under git keeps the rest.
- Pinned bookmarks are also still in their folder; the order inside each folder is unchanged.
- Folders come from headings; markdown stops at six levels, so a deeper path is refused rather than flattened.
- The whole file is re-read (and every link re-parsed) on each refresh — fine for a few thousand lines.
- No duplicate detection, and no conflict handling beyond "Obsidian is the only writer".
- Requires Obsidian to be running; closing it makes the list empty and saves fail.
