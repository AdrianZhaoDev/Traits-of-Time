import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'assets/resources/pixel/ming_end');
const manifest = JSON.parse(await readFile(join(source, 'asset-manifest.json'), 'utf8'));
const assets = await Promise.all(manifest.assets.map(async (asset) => ({
  ...asset,
  sheet: JSON.parse(await readFile(join(source, asset.metadata), 'utf8')),
  image: `data:image/png;base64,${(await readFile(join(source, asset.png))).toString('base64')}`,
})));
const licenses = await Promise.all(['pixelfx.MIT.txt', 'pixelfx.NOTICE.md'].map((file) =>
  readFile(join(source, 'licenses', file), 'utf8')));
const payload = JSON.stringify({ assets, licenses, source: manifest.source }).replaceAll('<', '\\u003c');
const template = await readFile(new URL('./preview-pixelfx.html', import.meta.url), 'utf8');
const html = template.replace('/*__PIXELFX_DATA__*/', () => payload);
const destination = join(root, 'output/pixelfx/preview.html');
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html);
console.log(`Offline preview: ${destination}\n${assets.length} embedded PNG atlases; ${Buffer.byteLength(html)} bytes; no network requests required.`);
