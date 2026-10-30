import { GameEngine } from '../core/engine/GameEngine.js';
import { GachaEngine, type DrawResult } from '../core/engine/GachaEngine.js';
import type { CommandResult } from '../core/types/commands.js';
export type ReplayAction =
  | { api: 'initGame'; commandId: string; args: { seed: number } }
  | { api: 'nextYear'; commandId: string; args: Record<string, never> }
  | { api: 'resolveOption'; commandId: string; args: { eventInstanceId: string; optionId: string } }
  | { api: 'resolveStage'; commandId: string; args: { eventInstanceId: string; stageId: string } }
  | { api: 'abandonChain'; commandId: string; args: { chainInstanceId: string } }
  | { api: 'draw'; commandId: string; args: { poolId: string; count: number } };
export type ReplayCommand = ReplayAction & { expected_result_hash: string; error_code?: string };
export type ReplayResult = CommandResult | DrawResult | { ok: false; error: { code: string; message: string } };
type Engine = GameEngine | GachaEngine;
const failure = (code: string, message: string, command_index?: number): Error => Object.assign(new Error(message), { code, ...(command_index === undefined ? {} : { command_index }) });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, names: string[]): boolean => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const digest = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function validateReplayCommands(value: unknown, kind: 'life' | 'gacha'): asserts value is ReplayCommand[] {
  if (!Array.isArray(value)) throw failure('REPLAY_INVALID', 'Replay commands must be an array');
  for (const command of value) {
    if (!object(command) || !exact(command, ['api', 'commandId', 'args', 'expected_result_hash', ...(Object.hasOwn(command, 'error_code') ? ['error_code'] : [])]) ||
        !text(command.commandId) || !digest(command.expected_result_hash) || (Object.hasOwn(command, 'error_code') && !text(command.error_code)) || !object(command.args)) {
      throw failure('REPLAY_INVALID', 'Invalid replay command');
    }
    const args = command.args;
    let valid = false;
    switch (command.api) {
      case 'initGame': valid = kind === 'life' && exact(args, ['seed']) && Number.isInteger(args.seed) && Number(args.seed) >= 0 && Number(args.seed) <= 0xffffffff; break;
      case 'nextYear': valid = kind === 'life' && exact(args, []); break;
      case 'resolveOption': valid = kind === 'life' && exact(args, ['eventInstanceId', 'optionId']) && typeof args.eventInstanceId === 'string' && typeof args.optionId === 'string'; break;
      case 'resolveStage': valid = kind === 'life' && exact(args, ['eventInstanceId', 'stageId']) && typeof args.eventInstanceId === 'string' && typeof args.stageId === 'string'; break;
      case 'abandonChain': valid = kind === 'life' && exact(args, ['chainInstanceId']) && typeof args.chainInstanceId === 'string'; break;
      case 'draw': valid = kind === 'gacha' && exact(args, ['poolId', 'count']) && typeof args.poolId === 'string' && typeof args.count === 'number' && Number.isFinite(args.count); break;
    }
    if (!valid) throw failure('REPLAY_INVALID', 'Invalid replay API or arguments');
  }
  if (kind === 'life' && (value.length === 0 || value[0].api !== 'initGame' || (value[0].error_code !== undefined && value.length !== 1))) throw failure('REPLAY_INVALID', 'Life replay must begin with initialization; failed initialization must be terminal');
}

export function executeCommand(engine: Engine, action: ReplayAction): ReplayResult {
  try {
    if (action.api === 'draw' && engine instanceof GachaEngine) return engine.draw(action.commandId, action.args.poolId, action.args.count);
    if (engine instanceof GameEngine) switch (action.api) {
      case 'initGame': return engine.initGame({ seed: action.args.seed });
      case 'nextYear': return engine.nextYear(action.commandId);
      case 'resolveOption': return engine.resolveOption(action.commandId, action.args.eventInstanceId, action.args.optionId);
      case 'resolveStage': return engine.resolveStage(action.commandId, action.args.eventInstanceId, action.args.stageId);
      case 'abandonChain': return engine.abandonChain(action.commandId, action.args.chainInstanceId);
    }
    throw failure('REPLAY_INVALID', 'API does not match engine kind');
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return { ok: false, error: { code: error.code, message: error.message } };
    throw error;
  }
}
export function recordCommand(engine: Engine, action: ReplayAction, hash: (value: unknown) => string): { result: ReplayResult; command: ReplayCommand } {
  const result = executeCommand(engine, action);
  const error_code = 'ok' in result && !result.ok ? result.error.code : undefined;
  const command = { api: action.api, commandId: action.commandId, args: structuredClone(action.args), expected_result_hash: hash(result), ...(error_code === undefined ? {} : { error_code }) } as ReplayCommand;
  return { result, command };
}
