import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

export async function loadContent(directory = 'assets/resources/data/ming_end') {
  const root = resolve(directory);
  const read = async (file) => JSON.parse(await readFile(resolve(root, file), 'utf8'));
  const manifest = await read('manifest.json');
  const bundle = { manifest };
  for (const key of ['rules', 'era', 'regions', 'castes', 'cards', 'pools', 'events', 'chains', 'achievements', 'deaths']) {
    const file = manifest.files?.[key];
    if (typeof file !== 'string') throw new Error(`Missing manifest.files.${key}`);
    const path = relative(root, resolve(root, file));
    if (path.startsWith('..') || isAbsolute(path)) throw new Error(`Content file escapes directory: ${file}`);
    bundle[key] = await read(file);
  }
  return bundle;
}
