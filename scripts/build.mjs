import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'src');
const distDir = join(root, 'dist');

const adaptManifest = {
  chrome(manifest) {
    delete manifest.browser_specific_settings;
  },
  firefox(manifest) {
    // The `favicon` permission is Chromium-only; Firefox would not recognise it.
    manifest.permissions = manifest.permissions.filter((name) => name !== 'favicon');
  },
};

for (const [browser, adapt] of Object.entries(adaptManifest)) {
  const outputDir = join(distDir, browser);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(sourceDir, outputDir, { recursive: true });

  const manifestPath = join(outputDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  adapt(manifest);

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${browser}: ${outputDir}`);
}
