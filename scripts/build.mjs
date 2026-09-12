import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'src');
const distDir = join(root, 'dist');
const manifestKeysToStrip = { chrome: ['browser_specific_settings'], firefox: [] };

for (const [browser, keys] of Object.entries(manifestKeysToStrip)) {
  const outputDir = join(distDir, browser);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(sourceDir, outputDir, { recursive: true });

  const manifestPath = join(outputDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const key of keys) delete manifest[key];

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${browser}: ${outputDir}`);
}
