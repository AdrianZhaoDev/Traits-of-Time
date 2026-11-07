import { expect } from 'vitest';
import type { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';

export function startWithCard(engine: GameEngine, options: Parameters<GameEngine['initGame']>[0]): Extract<CommandResult, { ok: true }> {
  const initial = engine.initGame(options);
  if (!initial.ok) throw new Error(initial.error.message);
  expect(initial.state.status).toBe('AWAITING_CARD');
  expect(initial.state.player.cards).toEqual([]);
  if (initial.pending?.kind !== 'card') throw new Error('Missing card offer');
  const card = initial.pending.cards[0];
  if (!card) throw new Error('Empty card offer');
  const selected = engine.selectCard('content:select-card', card);
  if (!selected.ok) throw new Error(selected.error.message);
  expect(selected.state.player.cards).toEqual([card]);
  return selected;
}
