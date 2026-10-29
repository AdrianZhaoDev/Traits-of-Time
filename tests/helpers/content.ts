import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated.js';

export const templateDirectory = fileURLToPath(new URL('../../assets/resources/data/ming_end/', import.meta.url));
const fixtureDirectory = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Read the test-owned original sample; production-package tests use loadContent directly. */
export async function loadTemplate(): Promise<ContentBundle> {
  const manifest = JSON.parse(await readFile(join(fixtureDirectory, 'manifest.json'), 'utf8')) as ContentBundle['manifest'];
  const parts = await Promise.all(Object.entries(manifest.files).map(async ([key, file]) =>
    [key, JSON.parse(await readFile(join(fixtureDirectory, file), 'utf8'))] as const));
  return { manifest, ...Object.fromEntries(parts) } as ContentBundle;
}

/** Write all manifest-listed files, including nested fixture file paths. */
export async function writeContent(directory: string, bundle: ContentBundle): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(bundle.manifest, null, 2) + '\n');
  for (const [key, file] of Object.entries(bundle.manifest.files)) {
    const destination = join(directory, file);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(bundle[key as keyof ContentBundle], null, 2) + '\n');
  }
}

export async function createContentFixture(mutate?: (bundle: ContentBundle) => void): Promise<{
  directory: string;
  bundle: ContentBundle;
  cleanup: () => Promise<void>;
}> {
  const bundle = await loadTemplate();
  mutate?.(bundle);
  const directory = await mkdtemp(join(tmpdir(), 'configurable-core-content-'));
  try {
    await writeContent(directory, bundle);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return { directory, bundle, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
