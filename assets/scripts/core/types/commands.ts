import type { GameView, LogEntry, PendingDecision } from './schema.js';
export type CommandResult =
  | { ok: true; state: Readonly<GameView>; logs: readonly LogEntry[]; pending: PendingDecision | null }
  | { ok: false; error: { code: string; message: string }; state: Readonly<GameView> };
