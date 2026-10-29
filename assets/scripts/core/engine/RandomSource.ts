import { DomainError } from './DomainError.js';

export interface RandomState { algorithm: 'mulberry32-v1'; state: number; draws: number }
export interface RandomSource { nextUint32(): number; exportState(): RandomState }
const RANGE = 0x100000000;

export class Mulberry32 implements RandomSource {
  private state: number;
  private draws = 0;
  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed >= RANGE) throw new DomainError('INVALID_SEED');
    this.state = seed;
  }
  static restore(value: RandomState): Mulberry32 {
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 3 ||
        value.algorithm !== 'mulberry32-v1' || !Number.isInteger(value.state) || value.state < 0 || value.state >= RANGE ||
        !Number.isSafeInteger(value.draws) || value.draws < 0) throw new DomainError('SAVE_INVALID', 'Invalid PRNG state');
    const rng = new Mulberry32(value.state);
    rng.draws = value.draws;
    return rng;
  }
  nextUint32(): number {
    if (this.draws === Number.MAX_SAFE_INTEGER) throw new DomainError('RNG_EXHAUSTED');
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    this.draws++;
    return (t ^ (t >>> 14)) >>> 0;
  }
  exportState(): RandomState { return { algorithm: 'mulberry32-v1', state: this.state, draws: this.draws }; }
}

export function uniformInt(min: number, max: number, rng: RandomSource): number {
  const span = max - min + 1;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || span < 1 || span > RANGE) {
    throw new DomainError('INVALID_INTERVAL');
  }
  const limit = Math.floor(RANGE / span) * span;
  let value: number;
  do { value = rng.nextUint32(); } while (value >= limit);
  return min + value % span;
}
