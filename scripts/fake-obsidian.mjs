/**
 * Run the fake Obsidian REST API for local development, so the extension can be
 * exercised without Obsidian installed.
 *
 *   node scripts/fake-obsidian.mjs --port=27123 --key=test-key
 */

import { startFakeObsidian } from '../test/helpers/fake-obsidian-server.mjs';

const options = Object.fromEntries(
  process.argv.slice(2).flatMap((argument) => {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    return match ? [[match[1], match[2]]] : [];
  }),
);

const apiKey = options.key ?? 'test-key';

// A vault shaped like a real one: a note at the root, and a folder that is a
// plausible-looking-but-wrong target for the "bookmark file" setting.
const server = await startFakeObsidian({
  apiKey,
  port: Number(options.port ?? 27123),
  files: {
    'bookmarks.md': '# Bookmarks\n\n- [Existing](https://existing.test)\n',
    'Bookmarks/Weblinks.md': '# Weblinks\n\n- [Queued](https://queued.test)\n',
    'Bookmarks/ReadLater.md': '# Read later\n',
    'Bookmarks/export_bookmarks.py': '',
  },
});

console.log(`fake Obsidian listening on ${server.url}`);
console.log(`  API key: ${apiKey}`);
console.log('  vault:   bookmarks.md, Bookmarks/Weblinks.md, Bookmarks/ReadLater.md');
console.log('           (point the extension at "Bookmarks" to see the folder error)');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
