import type { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';

export function initializeWithCard(engine: GameEngine, options: { seed: number }): CommandResult {
  const initialized = engine.initGame(options);
  if (!initialized.ok) return initialized;
  if (initialized.pending?.kind !== 'card' || !initialized.pending.cards[0]) throw new Error('Expected opening card offers');
  return engine.selectCard('select-opening-card', initialized.pending.cards[0]);
}
