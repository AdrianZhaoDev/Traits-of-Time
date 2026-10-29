import { readFile, open } from 'node:fs/promises';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { GachaEngine } from '../../assets/scripts/core/engine/GachaEngine.js';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated.js';
import { recordCommand, validateReplayCommands, type ReplayCommand } from '../../assets/scripts/application/ReplayCommands.js';
import { sha256 } from './canonical.js';

export interface Replay {
  replay_version: 1; kind: 'life' | 'gacha'; content_id: string; content_version: string;
  content_fingerprint: string; seed: number; commands: ReplayCommand[]; expected_final_hash: string | null;
}
const failure = (code: string, message: string, command_index?: number): Error => Object.assign(new Error(message), { code, ...(command_index === undefined ? {} : { command_index }) });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, names: string[]): boolean => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const digest = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function buildReplay(engine: GameEngine | GachaEngine, commands: readonly ReplayCommand[]): Replay {
  const save = engine.exportSave();
  return { replay_version: 1, kind: save.kind, content_id: save.content_id, content_version: save.content_version,
    content_fingerprint: save.content_fingerprint, seed: save.kind === 'life' ? save.payload.run.seed : save.payload.seed,
    commands: structuredClone([...commands]), expected_final_hash: sha256(save) };
}
/** Diagnostic trace for a rejected initialization: there is deliberately no engine state to hash. */
export function buildInitializationFailureReplay(content: ContentBundle, fingerprint: string, seed: number, command: ReplayCommand): Replay {
  const value: Replay = {
    replay_version: 1, kind: 'life', content_id: content.manifest.content_id,
    content_version: content.manifest.content_version, content_fingerprint: fingerprint,
    seed, commands: [structuredClone(command)], expected_final_hash: null,
  };
  validateReplay(value);
  return value;
}
export function validateReplay(value: unknown): asserts value is Replay {
  if (!object(value) || !exact(value, ['replay_version', 'kind', 'content_id', 'content_version', 'content_fingerprint', 'seed', 'commands', 'expected_final_hash']) ||
      value.replay_version !== 1 || (value.kind !== 'life' && value.kind !== 'gacha') || !text(value.content_id) || !text(value.content_version) || !text(value.content_fingerprint) ||
      !Number.isInteger(value.seed) || Number(value.seed) < 0 || Number(value.seed) > 0xffffffff || !(value.expected_final_hash === null || digest(value.expected_final_hash))) throw failure('REPLAY_INVALID', 'Invalid replay envelope');
  validateReplayCommands(value.commands, value.kind);
  if (value.kind === 'life' && (value.commands[0] as Extract<ReplayCommand, { api: 'initGame' }>).args.seed !== value.seed) throw failure('REPLAY_INVALID', 'Initialization seed differs from replay seed');
  const failedInitialization = value.kind === 'life' && value.commands.length === 1 && value.commands[0].api === 'initGame' && value.commands[0].error_code !== undefined;
  if ((value.expected_final_hash === null) !== failedInitialization) throw failure('REPLAY_INVALID', 'Only a terminal failed initialization can have no final state hash');
}
export function replay(content: ContentBundle, fingerprint: string, value: unknown): { ok: true; kind: 'life' | 'gacha'; final_hash: string | null } {
  validateReplay(value);
  if (value.content_id !== content.manifest.content_id || value.content_version !== content.manifest.content_version || value.content_fingerprint !== fingerprint) throw failure('CONTENT_MISMATCH', 'Replay content identity, version or fingerprint differs');
  const engine = value.kind === 'life' ? new GameEngine(content, fingerprint) : new GachaEngine(content, fingerprint, value.seed);
  for (const [index, command] of value.commands.entries()) {
    const actual = recordCommand(engine, command, sha256);
    if (actual.command.expected_result_hash !== command.expected_result_hash || actual.command.error_code !== command.error_code) throw failure('REPLAY_DIVERGED', `Replay diverged at command ${index} (${command.commandId})`, index);
  }
  if (value.expected_final_hash === null) return { ok: true, kind: 'life', final_hash: null };
  const final_hash = sha256(engine.exportSave());
  if (final_hash !== value.expected_final_hash) throw failure('REPLAY_DIVERGED', 'Replay final state differs', value.commands.length);
  return { ok: true, kind: value.kind, final_hash };
}
export async function readReplay(file: string): Promise<Replay> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  validateReplay(value);
  return value;
}
export async function writeReplay(file: string, value: Replay): Promise<void> {
  validateReplay(value);
  const handle = await open(file, 'wx');
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
}
