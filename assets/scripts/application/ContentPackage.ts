import type { ContentBundle, Manifest } from '../core/types/content.generated.js';
import { validateContent, type ValidationIssue } from '../core/content/ContentValidator.js';
import { freezeContent } from '../core/content/ContentRegistry.js';

const CONTENT_FILE_KEYS = ['rules', 'era', 'regions', 'castes', 'traits', 'cards', 'pools', 'events', 'chains', 'achievements', 'deaths'] as const;

export interface LoadedContent {
  bundle: ContentBundle;
  fingerprint: string;
}

export class ContentLoadError extends Error {
  readonly code: ValidationIssue['code'];
  constructor(readonly issues: ValidationIssue[]) {
    super(issues.map(issue => `${issue.file}${issue.path}: [${issue.code}] ${issue.message}`).join('\n'));
    this.name = 'ContentLoadError';
    this.code = issues[0]?.code ?? 'SCHEMA_INVALID';
  }
}

/** Host-owned ports: readers enforce package containment; validators use a trusted schema. */
export interface ContentPackagePorts {
  readText(file: string, manifestPointer: string): Promise<string>;
  validateManifest(value: unknown): Manifest;
  validateBundle(value: unknown, files: Manifest['files']): ContentBundle;
  fingerprint(bundle: ContentBundle): string;
}

async function readJson(ports: ContentPackagePorts, file: string, pointer: string): Promise<unknown> {
  let text: string;
  try { text = await ports.readText(file, pointer); }
  catch (error) {
    if (error instanceof ContentLoadError) throw error;
    throw new ContentLoadError([{ file, path: '', code: 'CONTENT_READ_FAILED', message: `读取内容失败：${error instanceof Error ? error.message : String(error)}` }]);
  }
  try { return JSON.parse(text) as unknown; }
  catch (error) {
    throw new ContentLoadError([{ file, path: '', code: 'JSON_PARSE', message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` }]);
  }
}

/** Publish only a fully validated, frozen snapshot. No transport, storage or Node dependency. */
export async function loadContentPackage(ports: ContentPackagePorts): Promise<LoadedContent> {
  const manifest = ports.validateManifest(await readJson(ports, 'manifest.json', ''));
  const assembled: Record<string, unknown> = { manifest };
  const issues: ValidationIssue[] = [];
  for (const key of CONTENT_FILE_KEYS) {
    const file = manifest.files[key];
    try { assembled[key] = await readJson(ports, file, `/files/${key}`); }
    catch (error) {
      if (!(error instanceof ContentLoadError)) throw error;
      issues.push(...error.issues);
    }
  }
  if (issues.length > 0) throw new ContentLoadError(issues);
  const bundle = ports.validateBundle(assembled, manifest.files);
  const result = validateContent(bundle);
  if (!result.ok) {
    throw new ContentLoadError(result.issues.map(issue => {
      const key = issue.file.slice(0, -5) as keyof Manifest['files'];
      return { ...issue, file: Object.hasOwn(manifest.files, key) ? manifest.files[key] : issue.file };
    }));
  }
  const fingerprint = ports.fingerprint(bundle);
  return { bundle: freezeContent(bundle), fingerprint };
}
