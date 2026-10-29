import { parseArgs } from 'node:util';
import { realpath, lstat } from 'node:fs/promises';
import { resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { acquireStateLock } from './FileStateStore.js';
import { httpsContentRoot } from './ContentLoader.js';

export const DEFAULT_CONTENT = 'assets/resources/data/ming_end';
export const DEFAULT_SEED = 1640;
export class ArgumentError extends Error {
  constructor(message: string, public readonly code = 'INVALID_ARGUMENT') { super(message); }
}
export type CliValues = Record<string, string | boolean | undefined>;
export function parseCli(options: Record<string, { type: 'string' | 'boolean'; default?: string | boolean }>, args = process.argv.slice(2)): CliValues {
  try {
    const parsed = parseArgs({ args, options, strict: true, allowPositionals: false, tokens: true });
    const seen = new Set<string>();
    for (const token of parsed.tokens) if (token.kind === 'option') {
      if (seen.has(token.name)) throw new ArgumentError(`参数 --${token.name} 不得重复`);
      seen.add(token.name);
    }
    return parsed.values;
  } catch (error) { throw error instanceof ArgumentError ? error : new ArgumentError(error instanceof Error ? error.message : String(error)); }
}
export function requiredString(values: CliValues, key: string): string {
  const value = values[key];
  if (typeof value !== 'string' || value.length === 0) throw new ArgumentError(`必须提供非空 --${key}`);
  return value;
}
export function integerArg(value: string | boolean | undefined, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)
    throw new ArgumentError(`--${name} 必须为 ${min} 到 ${max} 的整数`);
  return Number(value);
}
async function resolvedDestination(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // A dangling symlink must not be treated as a missing directory.
    try { await lstat(absolute); throw new ArgumentError(`目标包含无法解析的符号链接：${absolute}`); }
    catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return resolve(await resolvedDestination(parent), basename(absolute));
  }
}
export async function assertDestinationOutsideContent(contentDirectory: string, destination: string): Promise<void> {
  // Remote packages have no local directory that a state or replay file could overwrite.
  if (/^https?:/i.test(contentDirectory)) { httpsContentRoot(contentDirectory); return; }
  const root = await realpath(contentDirectory);
  const target = await resolvedDestination(destination);
  const rel = relative(root, target);
  if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)))
    throw new ArgumentError(`输出目标不得位于内容包内：${destination}`, 'CONTENT_PATH_INVALID');
}
export function errorDetails(error: unknown): { code: string; message: string; [key: string]: unknown } {
  const source = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {};
  return { ...source, code: typeof source.code === 'string' ? source.code : 'RUNTIME_ERROR', message: error instanceof Error ? error.message : String(error) };
}
export async function runCli(action: () => Promise<void>): Promise<void> {
  try { await action(); }
  catch (error) {
    const detail = errorDetails(error);
    process.stderr.write(process.argv.includes('--json') ? `${JSON.stringify({ error: detail })}\n` : `错误 [${detail.code}] ${detail.message}\n`);
    process.exitCode = error instanceof ArgumentError ? 2 : 1;
  }
}
/** Signals wait for the active command's atomic persistence before releasing the lock. */
export async function withStateLock<T>(directory: string, action: (interrupted: () => boolean) => Promise<T>, wake?: () => void): Promise<T> {
  const release = await acquireStateLock(directory);
  let signal: NodeJS.Signals | undefined;
  const interrupt = (received: NodeJS.Signals) => { signal = received; wake?.(); };
  const int = () => interrupt('SIGINT');
  const term = () => interrupt('SIGTERM');
  process.on('SIGINT', int); process.on('SIGTERM', term);
  try { return await action(() => signal !== undefined); }
  finally {
    try { await release(); }
    finally {
      process.off('SIGINT', int); process.off('SIGTERM', term);
      if (signal) process.exitCode = signal === 'SIGINT' ? 130 : 143;
    }
  }
}
export function checkSeed(explicit: boolean, requested: number, saved: number): void {
  if (explicit && requested !== saved) throw Object.assign(new Error(`指定种子 ${requested} 与存档种子 ${saved} 不同；请使用新的 state 目录`), { code: 'SEED_MISMATCH' });
}
