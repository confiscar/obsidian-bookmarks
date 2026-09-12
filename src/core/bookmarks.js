// Markdown links only: never images (![alt](url)), never non-http schemes.
const MARKDOWN_HTTP_LINK = /(?<!!)\[((?:[^[\]\n\\]|\\.)*)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g;

const PERCENT_ENCODE = (char) =>
  `%${char.codePointAt(0).toString(16).toUpperCase().padStart(2, '0')}`;

const unescapeName = (text) => text.replace(/\\([[\]\\])/g, '$1');

export function parseBookmarks(markdown) {
  if (typeof markdown !== 'string') return [];

  const bookmarks = [];
  for (const match of markdown.matchAll(MARKDOWN_HTTP_LINK)) {
    const name = unescapeName(match[1].trim());
    bookmarks.push({ name: name || match[2], url: match[2] });
  }
  return bookmarks;
}

export function escapeName(name) {
  return String(name).replace(/\s+/g, ' ').trim().replace(/([[\]\\])/g, '\\$1');
}

export function escapeUrl(url) {
  return String(url).replace(/[\s()<>]/g, PERCENT_ENCODE);
}

export function formatBookmark({ name, url }) {
  return `- [${escapeName(name)}](${escapeUrl(url)})`;
}

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

export function appendBookmark(markdown, bookmark) {
  const existing = typeof markdown === 'string' ? markdown : '';
  const line = formatBookmark(bookmark);
  if (!existing.trim()) return `${line}\n`;
  return `${existing.replace(/\s+$/, '')}\n${line}\n`;
}
