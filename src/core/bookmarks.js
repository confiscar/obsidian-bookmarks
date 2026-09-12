/** @typedef {{ name: string, url: string }} Bookmark */

// Markdown links only: never images (![alt](url)), never non-http schemes.
const MARKDOWN_HTTP_LINK = /(?<!!)\[((?:[^[\]\n\\]|\\.)*)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g;

/** @param {string} char one character of a URL, matched by escapeUrl's class */
const PERCENT_ENCODE = (char) =>
  `%${char.codePointAt(0).toString(16).toUpperCase().padStart(2, '0')}`;

/** @param {string} text link text straight out of the file, escape characters included */
const unescapeName = (text) => text.replace(/\\([[\]\\])/g, '$1');

/**
 * @param {string} markdown contents of the whole note
 * @returns {Bookmark[]} every bookmark in the note, in file order
 */
export function parseBookmarks(markdown) {
  if (typeof markdown !== 'string') return [];

  const bookmarks = [];
  for (const match of markdown.matchAll(MARKDOWN_HTTP_LINK)) {
    const name = unescapeName(match[1].trim());
    bookmarks.push({ name: name || match[2], url: match[2] });
  }
  return bookmarks;
}

/** @param {string} name display text, as the user typed it */
export function escapeName(name) {
  return String(name).replace(/\s+/g, ' ').trim().replace(/([[\]\\])/g, '\\$1');
}

/** @param {string} url */
export function escapeUrl(url) {
  return String(url).replace(/[\s()<>]/g, PERCENT_ENCODE);
}

/**
 * @param {Bookmark} bookmark
 * @returns {string} the bookmark as a bare markdown link, for front matter and other prose
 */
export function formatBookmarkLink({ name, url }) {
  return `[${escapeName(name)}](${escapeUrl(url)})`;
}

/**
 * @param {Bookmark} bookmark
 * @param {string} [marker] bullet character, so new items match the ones already in the file
 * @returns {string} the bookmark as a markdown list item
 */
export function formatBookmark({ name, url }, marker = '-') {
  return `${marker} ${formatBookmarkLink({ name, url })}`;
}

/**
 * @param {string} url
 * @returns {string} the form used to compare and to store URLs, so `https://a.test` and
 * `https://a.test/` are the same bookmark everywhere
 */
export function urlKey(url) {
  return normalizeUrl(url) ?? String(url);
}

/**
 * Favicons belong to a site, not a page, so an icon cached for one page of a site answers for
 * the rest of it.
 *
 * @param {string} url
 * @returns {string} the site a URL belongs to, or the URL itself when it does not parse
 */
export function siteKey(url) {
  try {
    return new URL(url).origin;
  } catch {
    return String(url);
  }
}

/**
 * @param {string} input whatever the user typed, with or without a scheme
 * @returns {string | null} canonical http(s) URL, or null when the input is not one
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
