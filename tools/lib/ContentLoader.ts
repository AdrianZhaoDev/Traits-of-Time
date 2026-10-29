import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { ContentBundle, Manifest } from '../../assets/scripts/core/types/content.generated.js';
import { validateContent, type ValidationIssue } from '../../assets/scripts/core/content/ContentValidator.js';
import { bundleLocation, pointerToken } from '../../assets/scripts/core/content/Validation.js';
import { freezeContent } from '../../assets/scripts/core/content/ContentRegistry.js';
import { sha256 } from './canonical.js';

export const CONTENT_FILE_KEYS = ['rules', 'era', 'regions', 'castes', 'traits', 'cards', 'pools', 'events', 'chains', 'achievements', 'deaths'] as const;

export interface LoadedContent {
  bundle: ContentBundle;
  fingerprint: string;
}

export class ContentLoadError extends Error {
  readonly code: ValidationIssue['code'];
  constructor(readonly issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.file}${issue.path}: [${issue.code}] ${issue.message}`).join('\n'));
    this.name = 'ContentLoadError';
    this.code = issues[0]?.code ?? 'SCHEMA_INVALID';
  }
}

let validators: Promise<{ manifest: ValidateFunction<Manifest>; bundle: ValidateFunction<ContentBundle> }> | undefined;

function trustedValidators() {
  validators ??= (async () => {
    const schema = JSON.parse(await readFile(new URL('../../assets/resources/data/content.schema.json', import.meta.url), 'utf8'));
    const ajv = new Ajv({ strict: true, allErrors: true, validateFormats: true });
    const bundle = ajv.compile<ContentBundle>(schema);
    const manifest = ajv.compile<Manifest>({ $schema: schema.$schema, $ref: '#/definitions/Manifest', definitions: schema.definitions });
    return { manifest, bundle };
  })();
  return validators;
}

function schemaIssues(errors: ErrorObject[] | null | undefined, manifestOnly = false, files?: Manifest['files']): ValidationIssue[] {
  return (errors ?? []).map((error) => {
    let pointer = error.instancePath;
    if (error.keyword === 'required') pointer += `/${pointerToken(String(error.params.missingProperty))}`;
    if (error.keyword === 'additionalProperties') pointer += `/${pointerToken(String(error.params.additionalProperty))}`;
    const location = manifestOnly ? { file: 'manifest.json', path: pointer } : bundleLocation(pointer);
    const key = location.file.slice(0, -5) as keyof Manifest['files'];
    return {
      ...location,
      file: files && Object.hasOwn(files, key) ? files[key] : location.file,
      code: 'SCHEMA_INVALID',
      message: error.message ?? '内容不符合可信 JSON Schema。',
    };
  });
}

function safeRelativePath(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !win32.isAbsolute(path) && !/^[a-z][a-z\d+.-]*:/i.test(path)
    && !path.includes('\\') && !path.includes('\0') && !path.split('/').includes('..');
}

function inside(root: string, path: string): boolean {
  const remainder = relative(root, path);
  return remainder !== '' && remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

async function readJson(path: string, file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new ContentLoadError([{ file, path: '', code: 'CONTENT_READ_FAILED', message: `读取内容失败：${error instanceof Error ? error.message : String(error)}` }]);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ContentLoadError([{ file, path: '', code: 'JSON_PARSE', message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` }]);
  }
}

async function resolveFile(root: string, file: string, manifestPointer: string): Promise<string> {
  if (!safeRelativePath(file)) throw new ContentLoadError([{ file: 'manifest.json', path: manifestPointer, code: 'CONTENT_PATH_INVALID', message: '文件路径必须是包内相对路径，不能包含父目录、绝对路径或远程 URL。' }]);
  let actual: string;
  try {
    actual = await realpath(resolve(root, file));
  } catch (error) {
    throw new ContentLoadError([{ file, path: '', code: 'CONTENT_READ_FAILED', message: `无法读取内容文件路径：${error instanceof Error ? error.message : String(error)}` }]);
  }
  if (!inside(root, actual)) throw new ContentLoadError([{ file: 'manifest.json', path: manifestPointer, code: 'CONTENT_PATH_INVALID', message: '真实文件路径逃逸内容包目录。' }]);
  return actual;
}

/** Manifest-first, complete-package load. No package-provided schema or partial import is trusted. */
export async function loadContent(directory: string): Promise<LoadedContent> {
  let root: string;
  try {
    root = await realpath(directory);
  } catch (error) {
    throw new ContentLoadError([{ file: 'manifest.json', path: '', code: 'CONTENT_READ_FAILED', message: `无法读取内容包：${error instanceof Error ? error.message : String(error)}` }]);
  }
  const validate = await trustedValidators();
  const manifestPath = await resolveFile(root, 'manifest.json', '');
  const manifest = await readJson(manifestPath, 'manifest.json');
  if (!validate.manifest(manifest)) throw new ContentLoadError(schemaIssues(validate.manifest.errors, true));
  const assembled: Record<string, unknown> = { manifest };
  const issues: ValidationIssue[] = [];
  for (const key of CONTENT_FILE_KEYS) {
    const file = manifest.files[key];
    try {
      const path = await resolveFile(root, file, `/files/${key}`);
      assembled[key] = await readJson(path, file);
    } catch (error) {
      if (!(error instanceof ContentLoadError)) throw error;
      issues.push(...error.issues);
    }
  }
  if (issues.length > 0) throw new ContentLoadError(issues);
  if (!validate.bundle(assembled)) throw new ContentLoadError(schemaIssues(validate.bundle.errors, false, manifest.files));
  const result = validateContent(assembled);
  if (!result.ok) {
    throw new ContentLoadError(result.issues.map((issue) => {
      const key = issue.file.slice(0, -5) as keyof Manifest['files'];
      return { ...issue, file: Object.hasOwn(manifest.files, key) ? manifest.files[key] : issue.file };
    }));
  }
  const fingerprint = sha256(assembled);
  return { bundle: freezeContent(assembled), fingerprint };
}
