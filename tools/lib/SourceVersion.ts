import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

async function sourceFiles(directory: string, root: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute, root));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(relative(root, absolute).split('\\').join('/'));
  }
  return files;
}

async function simulationSourceFiles(): Promise<string[]> {
  const [toolFiles, coreFiles, applicationFiles] = await Promise.all([
    sourceFiles(join(repoRoot, 'tools/lib'), repoRoot),
    sourceFiles(join(repoRoot, 'assets/scripts/core'), repoRoot),
    sourceFiles(join(repoRoot, 'assets/scripts/application'), repoRoot),
  ]);
  return ['tools/simulate.ts', ...toolFiles, ...coreFiles, ...applicationFiles].sort();
}

/** Stable hash of executable simulation source; generated reports and production data are excluded. */
export async function simulationSourceVersion(): Promise<{ algorithm: 'sha256'; digest: string; coverage: string; files: string[] }> {
  const files = await simulationSourceFiles();
  const hash = createHash('sha256');
  for (const path of files) {
    const bytes = await readFile(join(repoRoot, path));
    hash.update(path);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return { algorithm: 'sha256', digest: hash.digest('hex'), coverage: 'lexicographically ordered tools/lib/**/*.ts, tools/simulate.ts, assets/scripts/core/**/*.ts, and assets/scripts/application/**/*.ts; excludes production JSON/data, UI, generated reports, and runtime state', files };
}
