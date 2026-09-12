import { startFakeObsidian } from '../test/helpers/fake-obsidian-server.mjs';

const options = Object.fromEntries(
  process.argv.slice(2).flatMap((argument) => {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    return match ? [[match[1], match[2]]] : [];
  }),
);

const apiKey = options.key ?? 'test-key';

const headers = [
  '## Development',
  '',
  '* [CSS Gradient](https://cssgradient.io/)',
  '### Guides',
  '* [Tania Rascia](https://www.taniarascia.com/)',
  '## Music',
  '',
  '### Production',
  '* [OneMotion](https://www.onemotion.com/chord-player/)',
  '### Listen',
  '* [Spotify](https://open.spotify.com/)',
  '',
  '# Piracy',
  '* [FreeMediaHeckYeah](https://fmhy.net/)',
  '## Shopping',
  '',
  '* [Amazon](https://www.amazon.co.uk/)',
  '',
];

const server = await startFakeObsidian({
  apiKey,
  port: Number(options.port ?? 27123),
  files: {
    'bookmarks.md': '# Bookmarks\n\n- [Existing](https://existing.test)\n',
    'Bookmarks/Weblinks.md': headers.join('\n'),
    'Bookmarks/ReadLater.md': '# Read later\n',
  },
});

console.log(`fake Obsidian listening on ${server.url}`);
console.log(`  API key: ${apiKey}`);
console.log('  vault:   bookmarks.md (flat), Bookmarks/Weblinks.md (## and ### folders,');
console.log('           plus an "# Piracy" h1 and Bookmarks/ReadLater.md empty)');
console.log('           set the bookmark file to "Bookmarks" to see the folder error');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
