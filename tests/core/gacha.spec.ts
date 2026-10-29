import { describe, expect, it } from 'vitest';
import { GachaEngine, drawFromPool } from '../../assets/scripts/core/engine/GachaEngine.js';
import type { RandomSource } from '../../assets/scripts/core/engine/RandomSource.js';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated.js';
import { validateContent } from '../../assets/scripts/core/content/ContentValidator.js';
import { loadTemplate } from '../helpers/content.js';

type Pool = ContentBundle['pools'][number];
const fingerprint = 'a'.repeat(64);

class SequenceRandom implements RandomSource {
  private cursor = 0;
  constructor(private readonly values: readonly number[]) {}
  nextUint32(): number {
    const value = this.values[this.cursor++];
    if (value === undefined) throw new Error('Unexpected random draw');
    return value;
  }
  exportState() {
    return { algorithm: 'mulberry32-v1' as const, state: 0, draws: this.cursor };
  }
}

function pool(overrides: Partial<Pool> = {}): Pool {
  return {
    id: 'pity', name: 'Three-draw guarantee', replacement: true,
    entries: [{ card_id: 'A', weight: 3 }, { card_id: 'B', weight: 1 }, { card_id: 'Z', weight: 0 }],
    hard_pity: { after: 3, target_card_ids: ['B', 'Z'] },
    ...overrides,
  };
}

async function content(): Promise<ContentBundle> {
  const bundle = await loadTemplate();
  bundle.cards = ['A', 'B', 'Z'].map((id) => ({
    id, name: id, description: `Card ${id}`, rarity: id === 'A' ? 'ordinary' : 'special', tags: [],
  }));
  bundle.pools = [pool(), pool({ id: 'other' }), pool({ id: 'plain', hard_pity: null }),
    pool({ id: 'unique', replacement: false, hard_pity: null }),
    pool({ id: 'always', hard_pity: { after: 1, target_card_ids: ['B', 'Z'] } })];
  bundle.rules.opening.pool_id = 'plain';
  bundle.events = [];
  bundle.chains = [];
  bundle.achievements = [];
  expect(validateContent(bundle)).toEqual({ ok: true, issues: [] });
  return bundle;
}

function expectCode(operation: () => unknown, code: string): void {
  expect(operation).toThrowError(expect.objectContaining({ code }));
}

describe('drawFromPool: conditional probabilities and exact hard-pity boundary', () => {
  it('misses twice then forces the third draw, excluding zero-weight targets', () => {
    const rng = new SequenceRandom([0, 0, 0]);
    let misses = 0;
    const items = Array.from({ length: 3 }, () => {
      const item = drawFromPool(pool(), misses, rng);
      misses = item.pity_after;
      return item;
    });
    expect(items).toEqual([
      { card_id: 'A', forced_pity: false, pity_before: 0, pity_after: 1, conditional_probability: 0.75 },
      { card_id: 'A', forced_pity: false, pity_before: 1, pity_after: 2, conditional_probability: 0.75 },
      { card_id: 'B', forced_pity: true, pity_before: 2, pity_after: 0, conditional_probability: 1 },
    ]);
    expect(rng.exportState().draws).toBe(3);
  });

  it('resets misses on a natural target hit, including the exact cumulative boundary', () => {
    const item = drawFromPool(pool(), 1, new SequenceRandom([0xc0000000]));
    expect(item).toEqual({ card_id: 'B', forced_pity: false, pity_before: 1, pity_after: 0, conditional_probability: 0.25 });
  });

  it('makes after=1 a real target-only draw on every call', () => {
    const rng = new SequenceRandom([0, 0xffffffff]);
    const guaranteed = pool({ hard_pity: { after: 1, target_card_ids: ['B', 'Z'] } });
    for (let index = 0; index < 2; index++) {
      expect(drawFromPool(guaranteed, 0, rng)).toEqual({
        card_id: 'B', forced_pity: true, pity_before: 0, pity_after: 0, conditional_probability: 1,
      });
    }
    expect(rng.exportState().draws).toBe(2);
  });

  it('renormalizes among several positive-weight pity targets, not all pool entries', () => {
    const configured = pool({
      entries: [{ card_id: 'A', weight: 20 }, { card_id: 'B', weight: 3 }, { card_id: 'Z', weight: 1 }],
    });
    expect(drawFromPool(configured, 2, new SequenceRandom([0xc0000000]))).toEqual({
      card_id: 'Z', forced_pity: true, pity_before: 2, pity_after: 0, conditional_probability: 0.25,
    });
  });

  it('keeps misses at zero for a pool without pity', () => {
    expect(drawFromPool(pool({ hard_pity: null }), 0, new SequenceRandom([0]))).toEqual({
      card_id: 'A', forced_pity: false, pity_before: 0, pity_after: 0, conditional_probability: 0.75,
    });
  });
});

describe('GachaEngine: real batches, independent streams and receipts', () => {
  it.each([0, 1640, 0xffffffff])('reproduces seed %i including revision and fingerprint', async (seed) => {
    const bundle = await content();
    const left = new GachaEngine(bundle, fingerprint, seed);
    const right = new GachaEngine(bundle, fingerprint, seed);
    const result = left.draw('batch', 'pity', 10);
    expect(result).toEqual(right.draw('batch', 'pity', 10));
    expect(result).toMatchObject({ pool_id: 'pity', seed, revision: 1, content_fingerprint: fingerprint });
    expect(result.items.map((item) => item.draw_index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.items.every((item) => item.card_id !== 'Z')).toBe(true);
    expect(result.items.every((item) => item.rarity === (item.card_id === 'A' ? 'ordinary' : 'special'))).toBe(true);
    expect(left.exportSave()).toEqual(right.exportSave());
  });

  it('continues the same cards, pity and RNG after 1 + save/restore + 9 as after 10', async () => {
    const bundle = await content();
    const whole = new GachaEngine(bundle, fingerprint, 1640);
    const split = new GachaEngine(bundle, fingerprint, 1640);
    const ten = whole.draw('ten', 'pity', 10);
    const first = split.draw('one', 'pity', 1);
    const restored = new GachaEngine(bundle, fingerprint, 99);
    restored.restoreSave(JSON.parse(JSON.stringify(split.exportSave())));
    const rest = restored.draw('nine', 'pity', 9);
    expect([...first.items, ...rest.items]).toEqual(ten.items);
    expect(restored.exportSave().payload.pools.pity).toEqual(whole.exportSave().payload.pools.pity);
    expect(restored.draw('continuation', 'pity', 20).items).toEqual(whole.draw('continuation', 'pity', 20).items);
  });

  it('does not consume or reset another pool stream', async () => {
    const bundle = await content();
    const control = new GachaEngine(bundle, fingerprint, 73);
    const interleaved = new GachaEngine(bundle, fingerprint, 73);
    const first = interleaved.draw('a1', 'pity', 2);
    const other = interleaved.draw('b1', 'other', 2);
    expect(other.items).toEqual(first.items);
    expect(first.items).toEqual(control.draw('a1', 'pity', 2).items);
    interleaved.draw('b2', 'other', 70);
    expect(interleaved.draw('a2', 'pity', 30).items).toEqual(control.draw('a2', 'pity', 30).items);
  });

  it('returns the original receipt after later commands and after restore, without changing any save state', async () => {
    const bundle = await content();
    const engine = new GachaEngine(bundle, fingerprint, 1640);
    const original = structuredClone(engine.draw('same', 'pity', 10));
    engine.draw('later', 'other', 5);
    const before = structuredClone(engine.exportSave());
    expect(engine.draw('same', 'pity', 10)).toEqual(original);
    expect(engine.exportSave()).toEqual(before);
    const restored = new GachaEngine(bundle, fingerprint, 0);
    restored.restoreSave(JSON.parse(JSON.stringify(before)));
    expect(restored.draw('same', 'pity', 10)).toEqual(original);
    expect(restored.exportSave()).toEqual(before);
  });

  it('reserves command IDs globally, including across different pools', async () => {
    const engine = new GachaEngine(await content(), fingerprint, 3);
    engine.draw('used', 'pity', 1);
    const before = structuredClone(engine.exportSave());
    expectCode(() => engine.draw('used', 'pity', 2), 'COMMAND_ID_CONFLICT');
    expectCode(() => engine.draw('used', 'other', 1), 'COMMAND_ID_CONFLICT');
    expect(engine.exportSave()).toEqual(before);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects count %s atomically and does not reserve a failed command ID', async (count) => {
      const bundle = await content();
      const engine = new GachaEngine(bundle, fingerprint, 42);
      const control = new GachaEngine(bundle, fingerprint, 42);
      const before = structuredClone(engine.exportSave());
      expectCode(() => engine.draw('retry', 'pity', count), 'INVALID_COUNT');
      expect(engine.exportSave()).toEqual(before);
      expect(engine.draw('retry', 'pity', 2)).toEqual(control.draw('retry', 'pity', 2));
    },
  );

  it('rejects unknown pools without changing a previously used pool', async () => {
    const engine = new GachaEngine(await content(), fingerprint, 4);
    engine.draw('first', 'pity', 2);
    const before = structuredClone(engine.exportSave());
    expectCode(() => engine.draw('bad', 'missing', 1), 'POOL_NOT_FOUND');
    expect(engine.exportSave()).toEqual(before);
  });

  it('rejects a changed content fingerprint without overwriting the live engine', async () => {
    const bundle = await content();
    const original = new GachaEngine(bundle, fingerprint, 8);
    original.draw('one', 'pity', 2);
    const other = new GachaEngine(bundle, 'b'.repeat(64), 8);
    const before = structuredClone(other.exportSave());
    expectCode(() => other.restoreSave(original.exportSave()), 'CONTENT_MISMATCH');
    expect(other.exportSave()).toEqual(before);
  });

  it('sorts card IDs by code units rather than relying on authored entry order', async () => {
    const bundle = await content();
    const reordered = structuredClone(bundle);
    for (const configured of reordered.pools) configured.entries.reverse();
    expect(new GachaEngine(bundle, fingerprint, 19).draw('draw', 'pity', 30).items)
      .toEqual(new GachaEngine(reordered, fingerprint, 19).draw('draw', 'pity', 30).items);
  });
});

describe('GachaEngine: per-command sampling without replacement', () => {
  it('returns each positive-weight card once, with the second probability equal to one', async () => {
    const engine = new GachaEngine(await content(), fingerprint, 1640);
    const first = engine.draw('first', 'unique', 2);
    expect(first.items.map((item) => item.card_id).sort()).toEqual(['A', 'B']);
    expect(first.items[0]!.conditional_probability).toBe(first.items[0]!.card_id === 'A' ? 0.75 : 0.25);
    expect(first.items[1]!.conditional_probability).toBe(1);
    expect(first.items.every((item) => item.pity_before === 0 && item.pity_after === 0 && !item.forced_pity)).toBe(true);
    const second = engine.draw('second', 'unique', 2);
    expect(second.items.map((item) => item.card_id).sort()).toEqual(['A', 'B']);
    expect(second.items.map((item) => item.draw_index)).toEqual([3, 4]);
  });

  it('rejects an oversized batch before drawing any card, preserving stream and receipt state', async () => {
    const bundle = await content();
    const engine = new GachaEngine(bundle, fingerprint, 11);
    const control = new GachaEngine(bundle, fingerprint, 11);
    const before = structuredClone(engine.exportSave());
    expectCode(() => engine.draw('batch', 'unique', 3), 'INSUFFICIENT_CANDIDATES');
    expect(engine.exportSave()).toEqual(before);
    expect(engine.draw('batch', 'unique', 2)).toEqual(control.draw('batch', 'unique', 2));
  });
});

describe('GachaEngine: complete batches and detached saved receipts', () => {
  it('executes sequential pity transitions without hidden extra awards', async () => {
    const engine = new GachaEngine(await content(), fingerprint, 1640);
    const result = engine.draw('hundred', 'pity', 100);
    expect(result.items).toHaveLength(100);
    let misses = 0;
    for (const item of result.items) {
      expect(item.pity_before).toBe(misses);
      expect(item.forced_pity).toBe(misses + 1 >= 3);
      if (item.forced_pity) {
        expect(item.card_id).toBe('B');
        expect(item.conditional_probability).toBe(1);
      } else {
        expect(item.conditional_probability).toBe(item.card_id === 'A' ? 0.75 : 0.25);
      }
      misses = item.card_id === 'B' ? 0 : misses + 1;
      expect(item.pity_after).toBe(misses);
      expect(misses).toBeLessThan(3);
    }
    expect(engine.exportSave().payload.pools.pity).toMatchObject({ misses, total_draws: 100, rng: { draws: 100 } });
    expect(engine.draw('next', 'pity', 1).items[0]!.draw_index).toBe(101);
  });

  it('does not let callers mutate returned cards, receipts, or exported pool cursors', async () => {
    const engine = new GachaEngine(await content(), fingerprint, 1640);
    const result = engine.draw('draw', 'pity', 2);
    const receipt = structuredClone(result);
    const before = structuredClone(engine.exportSave());
    Reflect.set(result.items[0]!, 'card_id', 'Z');
    const detachedSave = engine.exportSave();
    Reflect.set(detachedSave.payload.pools.pity!, 'misses', 500);
    expect(engine.draw('draw', 'pity', 2)).toEqual(receipt);
    expect(engine.exportSave()).toEqual(before);
  });
});
