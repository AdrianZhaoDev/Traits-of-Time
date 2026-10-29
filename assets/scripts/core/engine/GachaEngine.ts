import type { ContentBundle, Pool } from '../types/content.generated.js';
import { createContentRegistry, type ContentRegistry } from '../content/ContentRegistry.js';
import { DomainError } from './DomainError.js';
import { cloneData } from './cloneData.js';
import { Mulberry32, type RandomSource, type RandomState } from './RandomSource.js';
import { sampleWeighted } from './WeightedSampler.js';
import { decodeGachaSave, encodeGachaSave, equalData } from '../persistence/SaveCodec.js';

export interface DrawItem {
  card_id: string;
  rarity: string;
  draw_index: number;
  forced_pity: boolean;
  pity_before: number;
  pity_after: number;
  conditional_probability: number;
}
export interface DrawResult {
  items: DrawItem[];
  pool_id: string;
  seed: number;
  revision: number;
  content_fingerprint: string;
}
export interface GachaPoolState { misses: number; total_draws: number; rng: RandomState }
export interface GachaReceipt { parameters: { poolId: string; count: number }; result: DrawResult }
export interface GachaSave {
  save_version: 1;
  kind: 'gacha';
  content_id: string;
  content_version: string;
  content_fingerprint: string;
  revision: number;
  payload: { seed: number; pools: Record<string, GachaPoolState>; processed_commands: Record<string, GachaReceipt> };
}

export function drawFromPool(pool: Pool, misses: number, rng: RandomSource): Omit<DrawItem, 'draw_index' | 'rarity'> {
  if (!Number.isSafeInteger(misses) || misses < 0 || (pool.hard_pity ? misses >= pool.hard_pity.after : misses !== 0)) {
    throw new DomainError('INVALID_PITY');
  }
  const pity = pool.hard_pity;
  const forced = pity !== null && misses + 1 >= pity.after;
  const targets = new Set(pity?.target_card_ids ?? []);
  const entries = pool.entries.filter((entry) => !forced || targets.has(entry.card_id))
    .sort((a, b) => a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0);
  const selected = sampleWeighted(entries, (entry) => entry.weight, rng);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return {
    card_id: selected.card_id, forced_pity: forced, pity_before: misses,
    pity_after: pity === null || targets.has(selected.card_id) ? 0 : misses + 1,
    conditional_probability: selected.weight / total,
  };
}


export class GachaEngine {
  private readonly content: ContentBundle;
  private readonly registry: ContentRegistry;
  private seed: number;
  private revision = 0;
  private pools = new Map<string, GachaPoolState>();
  private receipts = new Map<string, GachaReceipt>();

  constructor(content: ContentBundle, private readonly fingerprint: string, seed: number) {
    new Mulberry32(seed);
    this.seed = seed;
    this.content = cloneData(content);
    this.registry = createContentRegistry(this.content);
  }

  draw(commandId: string, poolId: string, count: number): DrawResult {
    if (typeof commandId !== 'string' || commandId.length === 0) throw new DomainError('INVALID_COMMAND_ID');
    const receipt = this.receipts.get(commandId);
    if (receipt) {
      if (receipt.parameters.poolId !== poolId || receipt.parameters.count !== count) throw new DomainError('COMMAND_ID_CONFLICT');
      return cloneData(receipt.result);
    }
    const pool = this.registry.pools.get(poolId);
    if (!pool) throw new DomainError('POOL_NOT_FOUND');
    if (!Number.isSafeInteger(count) || count < 1) throw new DomainError('INVALID_COUNT');
    const positiveCount = pool.entries.filter((entry) => entry.weight > 0).length;
    if (positiveCount === 0 || (!pool.replacement && count > positiveCount)) throw new DomainError('INSUFFICIENT_CANDIDATES');
    const previous = this.pools.get(poolId);
    const total = previous?.total_draws ?? 0;
    if (!Number.isSafeInteger(total + count) || this.revision === Number.MAX_SAFE_INTEGER) throw new DomainError('INVALID_COUNT');
    const rng = previous ? Mulberry32.restore(previous.rng) : new Mulberry32(this.seed);
    let misses = previous?.misses ?? 0;
    let currentPool = pool;
    const items: DrawItem[] = [];
    for (let index = 0; index < count; index++) {
      const item = drawFromPool(currentPool, misses, rng);
      const card = this.registry.cards.get(item.card_id);
      if (!card) throw new DomainError('INSUFFICIENT_CANDIDATES', 'Pool card is missing');
      items.push({ ...item, rarity: card.rarity, draw_index: total + index + 1 });
      misses = item.pity_after;
      if (!pool.replacement) currentPool = { ...pool, entries: currentPool.entries.filter((entry) => entry.card_id !== item.card_id) };
    }
    const result: DrawResult = { items, pool_id: poolId, seed: this.seed, revision: this.revision + 1, content_fingerprint: this.fingerprint };
    this.pools.set(poolId, { misses, total_draws: total + count, rng: rng.exportState() });
    this.receipts.set(commandId, { parameters: { poolId, count }, result });
    this.revision++;
    return cloneData(result);
  }

  exportSave(): GachaSave {
    return encodeGachaSave(this.content, this.fingerprint, this.revision, {
      seed: this.seed, pools: Object.fromEntries(this.pools), processed_commands: Object.fromEntries(this.receipts),
    });
  }

  restoreSave(save: GachaSave): void {
    const input = decodeGachaSave(save, this.content, this.fingerprint);
    try {
      const payload = input.payload;
      const replay = new GachaEngine(this.content, this.fingerprint, payload.seed as number);
      const receipts = Object.entries(payload.processed_commands);
      // Re-execution verifies receipts, probabilities, counters and every PRNG bit together;
      // accepting merely well-typed cursors would permit impossible saved states.
      receipts.sort((a, b) => a[1].result.revision - b[1].result.revision);
      for (let index = 0; index < receipts.length; index++) {
        const [id, receipt] = receipts[index];
        if (receipt.result.revision !== index + 1 || !equalData(replay.draw(id, receipt.parameters.poolId, receipt.parameters.count), receipt.result)) {
          throw new DomainError('SAVE_INVALID');
        }
      }
      if (!equalData(replay.exportSave(), input)) throw new DomainError('SAVE_INVALID');
      this.seed = replay.seed;
      this.revision = replay.revision;
      this.pools = replay.pools;
      this.receipts = replay.receipts;
    } catch {
      throw new DomainError('SAVE_INVALID', 'Invalid or inconsistent gacha save');
    }
  }
}
