import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { ContentBundle, Manifest } from '../../assets/scripts/core/types/content.generated.js';
import type { ValidationIssue } from '../../assets/scripts/core/content/ContentValidator.js';
import { bundleLocation, pointerToken } from '../../assets/scripts/core/content/Validation.js';
import { ContentLoadError, loadContentPackage, type LoadedContent } from '../../assets/scripts/application/ContentPackage.js';
import { sha256 } from './canonical.js';


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

/** Local filesystem and Node HTTPS adapter; the schema always comes from this installation. */
export async function loadContent(source: string): Promise<LoadedContent> {
  const remote = /^https?:/i.test(source);
  let readText: (file: string, pointer: string) => Promise<string>;
  if (remote) {
    const root = httpsContentRoot(source);
    readText = async (file, pointer) => {
      const url = remoteFile(root, file, pointer);
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return response.text();
    };
  } else {
    let root: string;
    try { root = await realpath(source); }
    catch (error) {
      throw new ContentLoadError([{ file: 'manifest.json', path: '', code: 'CONTENT_READ_FAILED', message: `无法读取内容包：${error instanceof Error ? error.message : String(error)}` }]);
    }
    readText = async (file, pointer) => readFile(await resolveFile(root, file, pointer), 'utf8');
  }
  const validate = await trustedValidators();
  return loadContentPackage({
    readText,
    validateManifest(value) {
      if (!validate.manifest(value)) throw new ContentLoadError(schemaIssues(validate.manifest.errors, true));
      return value;
    },
    validateBundle(value, files) {
      if (!validate.bundle(value)) throw new ContentLoadError(schemaIssues(validate.bundle.errors, false, files));
      return value;
    },
    fingerprint: sha256,
  });
}

function invalidRemotePath(pointer: string): never {
  throw new ContentLoadError([{ file: 'manifest.json', path: pointer, code: 'CONTENT_PATH_INVALID', message: 'HTTPS 内容必须使用无凭据、查询或片段的目录 URL；文件必须是包内安全相对路径。' }]);
}

export function httpsContentRoot(source: string): URL {
  let url: URL;
  try { url = new URL(source); } catch { return invalidRemotePath(''); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[\s\\?#]/.test(source)) invalidRemotePath('');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function remoteFile(root: URL, file: string, pointer: string): URL {
  // Reject encoded separators/dot segments too: server decoding must never widen this boundary.
  if (!safeRelativePath(file) || /[%?#\s]/.test(file) || file.split('/').some(part => part === '' || part === '.')) invalidRemotePath(pointer);
  const url = new URL(file, root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) invalidRemotePath(pointer);
  return url;
}
