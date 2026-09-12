const folderMessage = (real) =>
  `“${real}” is a folder in your vault, not a note. Point the bookmark file at a file inside it, e.g. “${real}/bookmarks.md”.`;

const spellingMessage = (real, typed) =>
  `Your vault has “${real}”, not “${typed}”. Obsidian's index is case-sensitive, so a differently-spelled path reads fine but fails to save with “File already exists.” — change the bookmark file to “${real}”.`;

const notRelativeMessage = (typed) =>
  `“${typed}” is not a vault-relative path. Drop any leading “/” or “..”, and use “bookmarks.md” for a note in the vault root or “Bookmarks/Weblinks.md” for one in a folder.`;

const insideFileMessage = (real) => `“${real}” is a file, so nothing can live inside it.`;

/** @param {string} filePath exactly as the user typed it */
/** @param {(directory: string) => Promise<string[] | null>} listDirectory null when the folder is absent */
export async function resolveVaultPath(filePath, listDirectory) {
  const segments = filePath.split('/').filter((segment) => segment && segment !== '.');
  if (!segments.length || filePath.startsWith('/') || segments.includes('..')) {
    return { resolvedPath: null, problem: notRelativeMessage(filePath) };
  }

  const normalized = segments.join('/');
  let problem = normalized === filePath ? null : `“${filePath}” points to “${normalized}”.`;

  const canonical = [];
  for (const [index, segment] of segments.entries()) {
    const listing = await listDirectory(canonical.join('/'));
    if (listing === null) {
      return { resolvedPath: canonical.concat(segments.slice(index)).join('/'), problem };
    }

    const isLast = index === segments.length - 1;
    const rest = segments.slice(index + 1);
    const spelled = (name) => canonical.concat(name, rest).join('/');
    const exactFolder = listing.includes(`${segment}/`);
    const exactFile = listing.includes(segment);
    const nearMiss =
      exactFolder || exactFile
        ? undefined
        : listing.find((entry) => entry.replace(/\/$/, '').toLowerCase() === segment.toLowerCase());

    if (nearMiss) {
      const name = nearMiss.replace(/\/$/, '');
      if (nearMiss.endsWith('/')) {
        if (isLast) return { resolvedPath: null, problem: folderMessage(spelled(name)) };
        problem ??= spellingMessage(spelled(name), filePath);
        canonical.push(name);
        continue;
      }
      return { resolvedPath: spelled(name), problem: spellingMessage(spelled(name), filePath) };
    }

    if (exactFolder) {
      if (isLast) return { resolvedPath: null, problem: folderMessage(canonical.concat(segment).join('/')) };
      canonical.push(segment);
      continue;
    }

    if (exactFile) {
      const real = canonical.concat(segment).join('/');
      if (!isLast) return { resolvedPath: null, problem: insideFileMessage(real) };
      return { resolvedPath: real, problem };
    }

    return { resolvedPath: canonical.concat(segment, rest).join('/'), problem };
  }

  return { resolvedPath: canonical.join('/'), problem };
}
