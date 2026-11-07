import type { PendingDecision } from '../../assets/scripts/core/types/schema.js';
import { DomainError } from '../../assets/scripts/core/engine/DomainError.js';
import { Mulberry32, uniformInt } from '../../assets/scripts/core/engine/RandomSource.js';
import { sha256 } from './canonical.js';

/** Derive an independent choice stream from the saved event identity, never the game's dice RNG. */
export function chooseAutomaticOption(pending: Extract<PendingDecision, { kind: 'option' }>): string {
  const options = pending.options.filter(option => option.available);
  if (options.length === 0) throw new DomainError('NO_AVAILABLE_OPTION', '当前事件没有可用选项，自动运行已停止');
  const seed = Number.parseInt(sha256({ purpose: 'play-auto-choice-v1', event_instance_id: pending.event_instance_id }).slice(0, 8), 16);
  return options[uniformInt(0, options.length - 1, new Mulberry32(seed))].id;
}

/** Use a separate deterministic stream so resuming never changes the offered-card choice. */
export function chooseAutomaticCard(pending: Extract<PendingDecision, { kind: 'card' }>, runSeed: number): string {
  if (pending.cards.length === 0) throw new DomainError('NO_AVAILABLE_CARD', '当前没有可用家当，自动运行已停止');
  const seed = Number.parseInt(sha256({ purpose: 'play-auto-card-v1', seed: runSeed, cards: pending.cards }).slice(0, 8), 16);
  return pending.cards[uniformInt(0, pending.cards.length - 1, new Mulberry32(seed))]!;
}
