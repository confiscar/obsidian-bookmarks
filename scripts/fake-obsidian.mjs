/**
 * Run the fake Obsidian REST API for local development, so the extension can be
 * exercised without Obsidian installed.
 *
 *   node scripts/fake-obsidian.mjs --port=27123 --key=test-key --file=bookmarks.md
 */

import { startFakeObsidian } from '../test/helpers/fake-obsidian-server.mjs';

const options = Object.fromEntries(
  process.argv.slice(2).flatMap((argument) => {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    return match ? [[match[1], match[2]]] : [];
  }),
);

const apiKey = options.key ?? 'test-key';
const file = options.file ?? 'bookmarks.md';

const server = await startFakeObsidian({
  apiKey,
  port: Number(options.port ?? 27123),
  files: { [file]: '# Bookmarks\n\n- [Existing](https://existing.test)\n' },
});

console.log(`fake Obsidian listening on ${server.url}`);
console.log(`  API key: ${apiKey}`);
console.log(`  file:    ${file}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
