import { setImmediate as nextTurn } from 'node:timers/promises';
import type { GameEngine } from '../core/engine/GameEngine.js';
import type { CommandResult } from '../core/types/commands.js';
import type { GameSave, GameView, PendingDecision } from '../core/types/schema.js';
import { recordCommand, validateReplayCommands, type ReplayAction, type ReplayCommand } from './ReplayCommands.js';

export interface SessionSave {
  engine: GameSave;
  cursor: { parent_command_id: string | null; next_child_index: number; authorized: boolean; pause_reason: string | null; input_sequence: number };
  replay_commands: ReplayCommand[];
}
export interface SessionPorts {
  persist(save: SessionSave): Promise<void>;
  load(): Promise<SessionSave | null>;
  hash(value: unknown): string;
}
export type SessionAction = { type: 'next' } | { type: 'choose'; optionId: string } | { type: 'stage' } | { type: 'abandon'; chainInstanceId: string };
export interface AdvanceOptions {
  shouldStop?: () => boolean;
  onResult?: (result: CommandResult) => void | Promise<void>;
}
const failure = (code: string, message: string): Error => Object.assign(new Error(message), { code });

/** Session authorization is transient; only committed commands advance a durable cursor. */
export class GameSession {
  private cursor: SessionSave['cursor'] = { parent_command_id: null, next_child_index: 0, authorized: false, pause_reason: null, input_sequence: 0 };
  private commands: ReplayCommand[] = [];
  private busy = false;
  private uncertain = false;
  constructor(private readonly engine: GameEngine, private readonly ports: SessionPorts) {}

  current(): { state: GameView; pending: PendingDecision | null } { return this.engine.current(); }
  exportSave(): SessionSave {
    return { engine: this.engine.exportSave(), cursor: { ...this.cursor }, replay_commands: structuredClone(this.commands) };
  }
  restoreSave(save: SessionSave): void {
    if (this.busy) throw failure('SESSION_BUSY', 'A session command is still being persisted');
    this.adopt(save);
    this.uncertain = false;
  }
  private adopt(save: SessionSave): void {
    if (!save || typeof save !== 'object' || Array.isArray(save) || Object.keys(save).length !== 3 || !Object.hasOwn(save, 'engine') || !Object.hasOwn(save, 'cursor') || !Object.hasOwn(save, 'replay_commands')) throw failure('SAVE_INVALID', 'Invalid session envelope');
    const cursor = save.cursor;
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || Object.keys(cursor).length !== 5 ||
        !['parent_command_id', 'next_child_index', 'authorized', 'pause_reason', 'input_sequence'].every(key => Object.hasOwn(cursor, key)) ||
        !(cursor.parent_command_id === null || (typeof cursor.parent_command_id === 'string' && cursor.parent_command_id.length > 0)) ||
        !Number.isSafeInteger(cursor.next_child_index) || cursor.next_child_index < 0 || !Number.isSafeInteger(cursor.input_sequence) || cursor.input_sequence < 0 ||
        typeof cursor.authorized !== 'boolean' || !(cursor.pause_reason === null || typeof cursor.pause_reason === 'string') ||
        (cursor.parent_command_id === null && (cursor.next_child_index !== 0 || cursor.authorized))) throw failure('SAVE_INVALID', 'Invalid session cursor');
    try { validateReplayCommands(save.replay_commands, 'life'); } catch { throw failure('SAVE_INVALID', 'Invalid session replay commands'); }
    const initial = save.replay_commands[0];
    if (initial.api !== 'initGame' || initial.error_code !== undefined || initial.args.seed !== save.engine?.payload?.run?.seed) throw failure('SAVE_INVALID', 'Replay initialization differs from saved seed or never committed');
    for (const command of save.replay_commands) {
      if (/^life-input:\d+$/.test(command.commandId) && Number(command.commandId.slice(11)) >= cursor.input_sequence) throw failure('SAVE_INVALID', 'Input cursor would reuse a recorded command');
    }
    if (cursor.parent_command_id !== null) {
      const prefix = `${cursor.parent_command_id}:`;
      for (const command of save.replay_commands) {
        if (command.commandId.startsWith(prefix) && /^\d+$/.test(command.commandId.slice(prefix.length)) && Number(command.commandId.slice(prefix.length)) >= cursor.next_child_index) throw failure('SAVE_INVALID', 'Child cursor would reuse a recorded command');
      }
    }
    // Engine restore is atomic; no session fields change until its full validation succeeds.
    this.engine.restoreSave(save.engine);
    this.cursor = { ...cursor, authorized: false };
    this.commands = structuredClone(save.replay_commands);
  }
  private async exclusive(operation: () => Promise<CommandResult>): Promise<CommandResult> {
    if (this.uncertain) throw failure('SAVE_FAILED', 'Persistence outcome is unknown; reload the state directory before continuing');
    if (this.busy) throw failure('SESSION_BUSY', 'A session command is still being persisted');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  private snapshot(): SessionSave | null {
    return this.commands.length === 0 ? null : this.exportSave();
  }
  private async persist(before: SessionSave | null): Promise<void> {
    const attempted = this.exportSave();
    try { await this.ports.persist(attempted); }
    catch (cause) {
      try {
        const durable = await this.ports.load();
        if (durable !== null) this.adopt(durable);
        else if (before !== null) this.adopt(before);
        else this.uncertain = true;
      } catch { this.uncertain = true; }
      this.cursor.authorized = false;
      throw Object.assign(failure('SAVE_FAILED', 'Could not reliably persist the command; automatic advancement stopped'), { cause });
    }
  }
  private execute(action: ReplayAction): CommandResult {
    const recorded = recordCommand(this.engine, action, this.ports.hash);
    if (!('ok' in recorded.result) || !('state' in recorded.result)) throw failure('SESSION_INVALID', 'Life command did not return a game state');
    this.commands.push(recorded.command);
    return recorded.result;
  }
  async initialize(seed: number): Promise<CommandResult> {
    return this.exclusive(async () => {
      const before = this.snapshot();
      const result = this.execute({ api: 'initGame', commandId: 'init', args: { seed } });
      this.cursor.authorized = false;
      this.cursor.pause_reason = result.ok ? result.pending?.kind ?? (result.state.status === 'ENDED' ? 'ended' : 'ready') : 'error';
      await this.persist(before);
      return result;
    });
  }
  async command(action: SessionAction): Promise<CommandResult> {
    return this.exclusive(async () => {
      const before = this.exportSave();
      if (this.cursor.input_sequence === Number.MAX_SAFE_INTEGER) throw failure('INVALID_COMMAND_ID', 'Input sequence exhausted');
      const commandId = `life-input:${this.cursor.input_sequence++}`;
      const pending = this.engine.current().pending;
      let actual: ReplayAction;
      switch (action.type) {
        case 'next': actual = { api: 'nextYear', commandId, args: {} }; break;
        case 'abandon': actual = { api: 'abandonChain', commandId, args: { chainInstanceId: action.chainInstanceId } }; break;
        case 'choose': actual = { api: 'resolveOption', commandId, args: { eventInstanceId: pending?.event_instance_id ?? '', optionId: action.optionId } }; break;
        case 'stage': actual = { api: 'resolveStage', commandId, args: { eventInstanceId: pending?.event_instance_id ?? '', stageId: pending?.kind === 'stage' ? pending.stage_id : '' } }; break;
      }
      const result = this.execute(actual);
      this.cursor.authorized = false;
      this.cursor.pause_reason = result.ok ? result.pending?.kind ?? (result.state.status === 'ENDED' ? 'ended' : 'ready') : 'error';
      await this.persist(before);
      return result;
    });
  }
  async advanceToDecision(commandId: string, options: AdvanceOptions = {}): Promise<CommandResult> {
    return this.exclusive(async () => {
      if (typeof commandId !== 'string' || commandId.length === 0) throw failure('INVALID_COMMAND_ID', 'Automatic advancement requires a command ID');
      for (;;) {
        const current = this.engine.current();
        if (current.pending?.kind === 'option' || current.state.status === 'ENDED' || options.shouldStop?.()) {
          this.cursor.authorized = false;
          return { ok: true, ...current, logs: [] };
        }
        const before = this.exportSave();
        if (this.cursor.parent_command_id !== commandId) {
          this.cursor.parent_command_id = commandId;
          // A previously used parent may be authorized again, never recycle its child IDs.
          const prefix = `${commandId}:`;
          this.cursor.next_child_index = this.commands.reduce((next, command) => command.commandId.startsWith(prefix) && /^\d+$/.test(command.commandId.slice(prefix.length)) ? Math.max(next, Number(command.commandId.slice(prefix.length)) + 1) : next, 0);
        }
        if (!Number.isSafeInteger(this.cursor.next_child_index) || this.cursor.next_child_index === Number.MAX_SAFE_INTEGER) throw failure('INVALID_COMMAND_ID', 'Child sequence exhausted');
        const childId = `${commandId}:${this.cursor.next_child_index++}`;
        const pending = current.pending;
        const result = this.execute(pending?.kind === 'stage'
          ? { api: 'resolveStage', commandId: childId, args: { eventInstanceId: pending.event_instance_id, stageId: pending.stage_id } }
          : { api: 'nextYear', commandId: childId, args: {} });
        let reason: string | null = null;
        if (!result.ok) reason = 'error';
        else if (result.pending?.kind === 'option') reason = 'option';
        else if (result.state.status === 'ENDED') reason = 'ended';
        this.cursor.authorized = reason === null;
        this.cursor.pause_reason = reason;
        await this.persist(before);
        await options.onResult?.(result);
        if (reason !== null) return result;
        await nextTurn();
      }
    });
  }
}
