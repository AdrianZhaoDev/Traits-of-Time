import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256 } from './canonical.js';
import { decodeGameSave, decodeGachaSave, keys, record, validateJson } from '../../assets/scripts/core/persistence/SaveCodec.js';
import { validateReplayCommands } from '../../assets/scripts/application/ReplayCommands.js';

export class StateStoreError extends Error {
  constructor(public readonly code: 'SAVE_CORRUPT' | 'STATE_CONFLICT' | 'SAVE_FAILED' | 'STATE_LOCKED', message: string) { super(message); this.name = 'StateStoreError'; }
}
interface Slot { revision: number; payload: unknown; checksum: string; name: string }
const names = ['slot-a.json', 'slot-b.json'] as const;
const hasCode = (error: unknown, code: string): boolean => record(error) && error.code === code;

/** Generic JSON is supported. Recognizable engine/session envelopes additionally undergo
 * content-independent validation; content identity and reachable-state checks belong to restoreSave.
 * In particular a different content fingerprint is not grounds to roll back to an older slot.
 */
function validatePayload(value: unknown): void {
  validateJson(value);
  if (!record(value)) return;
  if (Object.hasOwn(value, 'save_version') || Object.hasOwn(value, 'kind') && Object.hasOwn(value, 'content_fingerprint')) {
    if (value.kind === 'life') decodeGameSave(value);
    else if (value.kind === 'gacha') decodeGachaSave(value);
    else throw new Error('Unknown save kind');
  } else if (record(value.engine) && Object.hasOwn(value.engine, 'save_version')) {
    if (!keys(value, ['engine', 'cursor', 'replay_commands']) || !record(value.cursor) || !Array.isArray(value.replay_commands)) throw new Error('Invalid session');
    decodeGameSave(value.engine);
    const c = value.cursor;
    if (!keys(c, ['parent_command_id', 'next_child_index', 'authorized', 'pause_reason', 'input_sequence']) ||
        !(c.parent_command_id === null || typeof c.parent_command_id === 'string' && c.parent_command_id.length > 0) ||
        !Number.isSafeInteger(c.next_child_index) || (c.next_child_index as number) < 0 ||
        !Number.isSafeInteger(c.input_sequence) || (c.input_sequence as number) < 0 || typeof c.authorized !== 'boolean' ||
        !(c.pause_reason === null || typeof c.pause_reason === 'string')) throw new Error('Invalid session cursor');
    validateReplayCommands(value.replay_commands, 'life');
    if (value.replay_commands[0].error_code !== undefined) throw new Error('Session initialization must have succeeded');
  }
}
async function latest(directory: string): Promise<Slot | null> {
  const slots: Slot[] = [];
  let existing = 0;
  for (const name of names) {
    let bytes: string;
    try { bytes = await readFile(join(directory, name), 'utf8'); }
    catch (error) {
      if (hasCode(error, 'ENOENT')) continue;
      throw new StateStoreError('SAVE_FAILED', `Cannot read ${join(directory, name)}: ${String(error)}`);
    }
    existing++;
    try {
      const value: unknown = JSON.parse(bytes);
      if (!record(value) || !keys(value, ['revision', 'payload', 'checksum']) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || typeof value.checksum !== 'string' || value.checksum !== sha256(value.payload)) continue;
      validatePayload(value.payload);
      slots.push({ revision: value.revision as number, payload: value.payload, checksum: value.checksum, name });
    } catch { /* Keep invalid files intact; only a valid peer can recover them. */ }
  }
  if (!slots.length) {
    if (existing) throw new StateStoreError('SAVE_CORRUPT', `No valid state slot in ${directory}; files retained`);
    return null;
  }
  slots.sort((a, b) => b.revision - a.revision);
  if (slots.length === 2 && slots[0].revision === slots[1].revision && canonicalJson(slots[0].payload) !== canonicalJson(slots[1].payload)) throw new StateStoreError('STATE_CONFLICT', `Conflicting state revision ${slots[0].revision} in ${directory}`);
  return slots[0];
}
export async function load<T>(directory: string): Promise<T | null> {
  const slot = await latest(directory);
  return slot ? slot.payload as T : null;
}
export async function save<T>(directory: string, value: T): Promise<void> {
  let temporary: string | undefined;
  try {
    validatePayload(value);
    const canonical = canonicalJson(value);
    const payload: unknown = JSON.parse(canonical);
    const checksum = sha256(payload);
    const current = await latest(directory);
    if (current && canonicalJson(current.payload) === canonical) return;
    const revision = (current?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) throw new StateStoreError('SAVE_FAILED', 'State revision exhausted');
    await mkdir(directory, { recursive: true });
    const name = current?.name === names[0] ? names[1] : names[0];
    temporary = join(directory, `${name}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ revision, payload, checksum }), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, join(directory, name));
    temporary = undefined;
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (error) {
    if (error instanceof StateStoreError) throw error;
    throw new StateStoreError('SAVE_FAILED', `Cannot save state in ${directory}: ${String(error)}`);
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
  }
}
/** Caller holds this lock for the entire load/command/save lifetime, not only the write. */
export async function acquireStateLock(directory: string): Promise<() => Promise<void>> {
  const path = join(directory, 'state.lock');
  await mkdir(directory, { recursive: true });
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if (hasCode(error, 'EEXIST')) throw new StateStoreError('STATE_LOCKED', `State is locked at ${path}; remove only after confirming its owning process has exited`);
    throw new StateStoreError('SAVE_FAILED', `Cannot acquire ${path}: ${String(error)}`);
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid }), 'utf8'); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(path); throw new StateStoreError('SAVE_FAILED', `Cannot initialize ${path}: ${String(error)}`); }
  let released = false;
  return async () => {
    if (released) return;
    await handle.close();
    await unlink(path);
    released = true;
  };
}
