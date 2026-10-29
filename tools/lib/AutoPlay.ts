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
