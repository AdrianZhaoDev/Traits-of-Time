import { DomainError } from './DomainError.js';
import type { RandomSource } from './RandomSource.js';

export function sampleWeighted<T>(items: readonly T[], weight: (item: T) => number, rng: RandomSource): T {
  let total = 0;
  let last: T | undefined;
  for (const item of items) {
    const value = weight(item);
    if (!Number.isFinite(value) || value < 0) throw new DomainError('INVALID_DISTRIBUTION');
    total += value;
    if (value > 0) last = item;
  }
  if (!Number.isFinite(total) || total <= 0) throw new DomainError('INVALID_DISTRIBUTION');
  const selected = rng.nextUint32() / 0x100000000 * total;
  let cumulative = 0;
  for (const item of items) {
    cumulative += weight(item);
    if (selected < cumulative) return item;
  }
  return last as T;
}

export function probabilityPasses(probability: number, rng: RandomSource): boolean {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new DomainError('INVALID_PROBABILITY');
  if (probability === 0) return false;
  if (probability === 1) return true;
  return rng.nextUint32() / 0x100000000 < probability;
}
