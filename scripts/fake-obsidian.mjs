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

// The shape of a real read later note: no front matter, `*` bullets, and headings that are
// still empty — the read mark is what the extension adds to it.
const readLater = [
  '## Development',
  '',
  '* [YouTube](https://www.youtube.com/watch?v=Ilg3gGewQ5U) - What is backpropagation doing?',
  '',
  '## Career',
  '',
  '* [Reddit](https://www.reddit.com/r/AskReddit/comments/3vxb2e) - READ THIS IF UNDECIDED',
  '',
  '## Music',
  '',
  '* [YouTube](https://www.youtube.com/watch?v=CXoaV6rv00o) - 3 sweet chord progressions',
  '## Study',
  '## Reading',
  '',
];

const server = await startFakeObsidian({
  apiKey,
  port: Number(options.port ?? 27123),
  files: {
    'bookmarks.md': '# Bookmarks\n\n- [Existing](https://existing.test)\n',
    'Bookmarks/Weblinks.md': headers.join('\n'),
    'Bookmarks/ReadLater.md': readLater.join('\n'),
  },
});

console.log(`fake Obsidian listening on ${server.url}`);
console.log(`  API key: ${apiKey}`);
console.log('  vault:   bookmarks.md (flat), Bookmarks/Weblinks.md (## and ### folders,');
console.log('           plus an "# Piracy" h1) and Bookmarks/ReadLater.md (no front matter yet)');
console.log('           set the bookmark file to "Bookmarks" to see the folder error');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
