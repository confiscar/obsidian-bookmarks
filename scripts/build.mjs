/**
 * Produce loadable extensions in dist/.
 *
 * The only genuine manifest divergence between the browsers is
 * `browser_specific_settings`, which Firefox requires (stable add-on ID) and
 * Chrome does not know. Chrome also cannot use MV3 `background.service_worker`
 * while Firefox cannot use it at all — this extension needs no background page,
 * so that difference never comes up here.
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

for (const browser of ['chrome', 'firefox']) {
  const out = join(dist, browser);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(src, out, { recursive: true });

  const manifestPath = join(out, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (browser === 'chrome') delete manifest.browser_specific_settings;

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${browser}: ${out}`);
}
