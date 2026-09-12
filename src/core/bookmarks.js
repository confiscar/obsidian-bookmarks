/**
 * Bookmark parsing/formatting. Pure functions, zero browser or network access.
 *
 * A bookmark is `{ name, url }`. On disk it is a single markdown list item:
 *
 *     - [Name](https://example.com)
 */

// `[name](url)`, but not an image (`![alt](url)`) and only http(s) targets.
// The name may contain backslash escapes (`\]`), which formatBookmark emits.
const LINK_PATTERN = /(?<!!)\[((?:[^[\]\n\\]|\\.)*)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g;

/**
 * Extract every markdown link from a document, in file order.
 * @param {string} markdown
 * @returns {{ name: string, url: string }[]}
 */
export function parseBookmarks(markdown) {
  if (typeof markdown !== 'string') return [];

  const bookmarks = [];
  for (const match of markdown.matchAll(LINK_PATTERN)) {
    // Undo escapeName() so format → parse is a round trip.
    const name = match[1].trim().replace(/\\([[\]\\])/g, '$1');
    bookmarks.push({ name: name || match[2], url: match[2] });
  }
  return bookmarks;
}

/**
 * Escape a display name so it cannot terminate the markdown link text.
 * @param {string} name
 */
export function escapeName(name) {
  return String(name).replace(/\s+/g, ' ').trim().replace(/([[\]\\])/g, '\\$1');
}

/**
 * Percent-encode the characters that would otherwise end the markdown link target.
 * @param {string} url
 */
export function escapeUrl(url) {
  // encodeURIComponent leaves () untouched, so encode by code point instead.
  return String(url).replace(
    /[\s()<>]/g,
    (char) => `%${char.codePointAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

/**
 * Render a bookmark as a markdown list item.
 * @param {{ name: string, url: string }} bookmark
 */
export function formatBookmark({ name, url }) {
  return `- [${escapeName(name)}](${escapeUrl(url)})`;
}

/**
 * Turn user input into a canonical http(s) URL, or null when it is not one.
 * Bare hosts get `https://`; other schemes (mailto:, javascript:, …) are rejected.
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.href;
}

/**
 * Append a bookmark to the end of a document, adding only the newline(s) needed.
 * @param {string} markdown existing file content ('' when the file does not exist yet)
 * @param {{ name: string, url: string }} bookmark
 */
export function appendBookmark(markdown, bookmark) {
  const existing = typeof markdown === 'string' ? markdown : '';
  const line = formatBookmark(bookmark);
  if (!existing.trim()) return `${line}\n`;
  return `${existing.replace(/\s+$/, '')}\n${line}\n`;
}
