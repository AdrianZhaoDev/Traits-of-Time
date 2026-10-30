import { describe, expect, it } from 'vitest';
import { Mulberry32, uniformInt, type RandomSource } from '../../assets/scripts/core/engine/RandomSource.js';
import { probabilityPasses, sampleWeighted } from '../../assets/scripts/core/engine/WeightedSampler.js';
import { resolveCheck } from '../../assets/scripts/core/engine/DiceResolver.js';
import { evaluateCondition, type ConditionContext } from '../../assets/scripts/core/engine/ConditionEvaluator.js';
import type { Condition } from '../../assets/scripts/core/types/content.generated.js';

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

// Independent unsigned BigInt arithmetic is the oracle for the specified bitwise algorithm.
function referenceSequence(seed: number, count: number): number[] {
  const mask = 0xffffffffn;
  let state = BigInt(seed);
  return Array.from({ length: count }, () => {
    state = (state + 0x6d2b79f5n) & mask;
    let value = ((state ^ (state >> 15n)) * (state | 1n)) & mask;
    value = (value ^ ((value + (((value ^ (value >> 7n)) * (value | 61n)) & mask)) & mask)) & mask;
    return Number((value ^ (value >> 14n)) & mask);
  });
}

describe('Mulberry32: fixed unsigned algorithm and restored cursor', () => {
  it.each([0, 1, 1640, 0xffffffff])('implements the specified sequence for seed %i', (seed) => {
    const rng = new Mulberry32(seed);
    expect(rng.exportState()).toEqual({ algorithm: 'mulberry32-v1', state: seed, draws: 0 });
    expect(Array.from({ length: 64 }, () => rng.nextUint32())).toEqual(referenceSequence(seed, 64));
    expect(rng.exportState()).toEqual({
      algorithm: 'mulberry32-v1', state: Number((BigInt(seed) + 64n * 0x6d2b79f5n) & 0xffffffffn), draws: 64,
    });
  });

  it('continues byte-for-byte after JSON export/restore', () => {
    const rng = new Mulberry32(0);
    for (let draw = 0; draw < 7; draw++) rng.nextUint32();
    const saved = JSON.parse(JSON.stringify(rng.exportState()));
    const restored = Mulberry32.restore(saved);
    expect(restored.exportState()).toEqual(saved);
    expect(Array.from({ length: 40 }, () => restored.nextUint32())).toEqual(Array.from({ length: 40 }, () => rng.nextUint32()));
    expect(restored.exportState()).toEqual(rng.exportState());
  });

  it.each([-1, 0x100000000, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid seed %s', (seed) => {
    expect(() => new Mulberry32(seed)).toThrow();
  });

  it('does not expose a mutable PRNG state object', () => {
    const rng = new Mulberry32(7);
    const snapshot = rng.exportState();
    snapshot.state = 123;
    snapshot.draws = 123;
    expect(rng.exportState()).toEqual({ algorithm: 'mulberry32-v1', state: 7, draws: 0 });
  });
});

describe('uniformInt: unbiased inclusive integer intervals', () => {
  it('rejects the uneven uint32 tail rather than taking biased modulo', () => {
    const rng = new SequenceRandom([0xffffffff, 0xfffffffc, 4]);
    expect(uniformInt(10, 15, rng)).toBe(14);
    expect(rng.exportState().draws).toBe(3);
  });

  it('accepts the largest allowed sample below the rejection threshold', () => {
    const rng = new SequenceRandom([0xfffffffb]);
    expect(uniformInt(10, 15, rng)).toBe(15);
    expect(rng.exportState().draws).toBe(1);
  });

  it('handles singletons, negative endpoints and the full uint32 span', () => {
    const rng = new SequenceRandom([0xffffffff, 0, 5, 0xffffffff]);
    expect(uniformInt(9, 9, rng)).toBe(9);
    expect(uniformInt(-3, 2, rng)).toBe(-3);
    expect(uniformInt(-3, 2, rng)).toBe(2);
    expect(uniformInt(0, 0xffffffff, rng)).toBe(0xffffffff);
    expect(rng.exportState().draws).toBe(4);
  });

  it.each([[1, 0], [0, 0x100000000], [0.5, 1], [0, Number.NaN], [0, Number.POSITIVE_INFINITY]])(
    'rejects invalid interval [%s, %s] without drawing', (min, max) => {
      const rng = new SequenceRandom([]);
      expect(() => uniformInt(min, max, rng)).toThrow();
      expect(rng.exportState().draws).toBe(0);
    },
  );
});

describe('sampleWeighted: exact cumulative boundaries', () => {
  const entries = [{ id: 'A', weight: 3 }, { id: 'B', weight: 1 }, { id: 'Z', weight: 0 }];

  it.each([[0, 'A'], [0xbfffffff, 'A'], [0xc0000000, 'B'], [0xffffffff, 'B']] as const)(
    'maps uint32 %i to %s with a strict upper boundary', (sample, expected) => {
      const rng = new SequenceRandom([sample]);
      expect(sampleWeighted(entries, (entry) => entry.weight, rng).id).toBe(expected);
      expect(rng.exportState().draws).toBe(1);
    },
  );

  it('ignores leading/trailing zero weights but still consumes a draw for one positive candidate', () => {
    const entries = [{ id: 'A', weight: 0 }, { id: 'B', weight: 0.5 }, { id: 'Z', weight: 0 }];
    const rng = new SequenceRandom([0, 0xffffffff]);
    expect(sampleWeighted(entries, (entry) => entry.weight, rng)).toBe(entries[1]);
    expect(sampleWeighted(entries, (entry) => entry.weight, rng)).toBe(entries[1]);
    expect(rng.exportState().draws).toBe(2);
  });

  it.each([[], [0], [-1, 2], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.MAX_VALUE, Number.MAX_VALUE]].map((weights) => ({ weights })))(
    'rejects an invalid distribution $weights before consuming RNG', ({ weights }) => {
      const rng = new SequenceRandom([]);
      expect(() => sampleWeighted(weights, (weight) => weight, rng)).toThrow();
      expect(rng.exportState().draws).toBe(0);
    },
  );
});

describe('resolveCheck: explicit D20 resolution', () => {
  const limits = { modifier_min: -3, modifier_max: 3 };
  const check = { attribute: 'intelligence' as const, dc: 14, modifier: 0 };

  it('enumerates exactly 13/20 successes for attribute 4, modifier 2 and DC14', () => {
    const results = Array.from({ length: 20 }, (_, index) => {
      const rng = new SequenceRandom([index]);
      const result = resolveCheck({ ...check, modifier: 2 }, 4, limits, rng);
      expect(result).toEqual({
        raw: index + 1, attribute_value: 4, modifier_before: 2, modifier_after: 2,
        dc: 14, success: index >= 7, success_probability: 13 / 20,
      });
      expect(rng.exportState().draws).toBe(1);
      return result;
    });
    expect(results.filter((result) => result.success)).toHaveLength(13);
  });

  it('makes natural 1 fail even when the numerical total would pass', () => {
    expect(resolveCheck({ ...check, dc: -100, modifier: 20 }, 10, limits, new SequenceRandom([0])))
      .toMatchObject({ raw: 1, success: false, success_probability: 19 / 20 });
  });

  it('makes natural 20 succeed even when the numerical total would fail', () => {
    expect(resolveCheck({ ...check, dc: 100, modifier: -20 }, 0, limits, new SequenceRandom([19])))
      .toMatchObject({ raw: 20, success: true, success_probability: 1 / 20 });
  });

  it.each([[9, 3], [-9, -3], [-1, -1]])(
    'clamps stage modifier %i to %i', (before, after) => {
      const result = resolveCheck({ ...check, modifier: before }, 4, limits, new SequenceRandom([9]));
      expect(result).toMatchObject({ raw: 10, attribute_value: 4, modifier_before: before, modifier_after: after, dc: 14 });
    },
  );

  it('uses the unbiased integer sampler for D20 rather than a float or biased modulo', () => {
    const rng = new SequenceRandom([0xffffffff, 19]);
    expect(resolveCheck({ ...check, modifier: 2 }, 4, limits, rng).raw).toBe(20);
    expect(rng.exportState().draws).toBe(2);
  });
});

describe('probability gates: exact boundary and deterministic endpoints', () => {
  it('does not consume RNG for probability zero or one', () => {
    const rng = new SequenceRandom([]);
    expect(probabilityPasses(0, rng)).toBe(false);
    expect(probabilityPasses(1, rng)).toBe(true);
    expect(rng.exportState().draws).toBe(0);
  });

  it.each([[0x7fffffff, true], [0x80000000, false], [0xffffffff, false]] as const)(
    'uses u < p, so uint32 %i has outcome %s at p=.5', (sample, expected) => {
      const rng = new SequenceRandom([sample]);
      expect(probabilityPasses(0.5, rng)).toBe(expected);
      expect(rng.exportState().draws).toBe(1);
    },
  );
});

describe('evaluateCondition: restricted declarative operators', () => {
  const state: ConditionContext = {
    age: 9, calendar_year: 1640, physique: 2, intelligence: 4, wealth: 3, prestige: 1, luck: 5,
    region_id: 'R_JIANGNAN', caste_id: 'C_SOLDIER', identity_id: 'I_DEPENDENT', timeline: 'historical',
    cards: ['CARD_COMMON'], flags: ['dependent'], injuries: ['INJ_SEVERE'], completed_chains: ['CH_WORKSHOP'], active_chains: ['CH_ACTIVE'],
  };

  it('treats an omitted condition as true and never changes the context', () => {
    const before = structuredClone(state);
    expect(evaluateCondition(undefined, state)).toBe(true);
    expect(state).toEqual(before);
  });

  it.each(['age', 'calendar_year', 'physique', 'intelligence', 'wealth', 'prestige', 'luck'] as const)(
    'compares the named numeric field %s', (field) => {
      expect(evaluateCondition({ op: 'compare', field, comparator: 'eq', value: state[field] }, state)).toBe(true);
      expect(evaluateCondition({ op: 'compare', field, comparator: 'eq', value: state[field] + 1 }, state)).toBe(false);
    },
  );

  it.each([
    ['eq', 9, true], ['eq', 8, false], ['ne', 9, false], ['ne', 8, true],
    ['lt', 9, false], ['lt', 10, true], ['lte', 9, true], ['lte', 8, false],
    ['gt', 9, false], ['gt', 8, true], ['gte', 9, true], ['gte', 10, false],
  ] as const)('evaluates 9 %s %i as %s', (comparator, value, expected) => {
    expect(evaluateCondition({ op: 'compare', field: 'age', comparator, value }, state)).toBe(expected);
  });

  it.each([
    ['cards', 'CARD_COMMON'], ['flags', 'dependent'], ['injuries', 'INJ_SEVERE'], ['completed_chains', 'CH_WORKSHOP'], ['active_chains', 'CH_ACTIVE'],
  ] as const)('checks membership in %s', (collection, id) => {
    expect(evaluateCondition({ op: 'has', collection, id }, state)).toBe(true);
    expect(evaluateCondition({ op: 'has', collection, id: 'missing' }, state)).toBe(false);
  });

  it.each([
    ['region_id', 'R_JIANGNAN', 'R_CAPITAL'], ['caste_id', 'C_SOLDIER', 'C_GENTRY'],
    ['identity_id', 'I_DEPENDENT', 'I_ARTISAN'], ['timeline', 'historical', 'fictional'],
  ] as const)('checks exact string equality for %s', (field, value, absent) => {
    expect(evaluateCondition({ op: 'is', field, value } as Condition, state)).toBe(true);
    expect(evaluateCondition({ op: 'is', field, value: absent } as Condition, state)).toBe(false);
  });

  it('composes all, any and not recursively without changing atomic semantics', () => {
    const yes: Condition = { op: 'has', collection: 'flags', id: 'dependent' };
    const no: Condition = { op: 'has', collection: 'flags', id: 'missing' };
    expect(evaluateCondition({ op: 'all', conditions: [yes, { op: 'not', condition: no }] }, state)).toBe(true);
    expect(evaluateCondition({ op: 'all', conditions: [yes, no] }, state)).toBe(false);
    expect(evaluateCondition({ op: 'any', conditions: [no, yes] }, state)).toBe(true);
    expect(evaluateCondition({ op: 'any', conditions: [no, { op: 'not', condition: yes }] }, state)).toBe(false);
    expect(evaluateCondition({ op: 'not', condition: { op: 'any', conditions: [no, no] } }, state)).toBe(true);
  });
});
