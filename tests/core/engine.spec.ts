import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { Mulberry32, uniformInt } from '../../assets/scripts/core/engine/RandomSource.js';
import { validateContent } from '../../assets/scripts/core/content/ContentValidator.js';
import type { ContentBundle, Effect, Event, Outcome, Stage } from '../../assets/scripts/core/types/content.generated.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';
import { loadTemplate } from '../helpers/content.js';

type Result = CommandResult;
type Success = Extract<CommandResult, { ok: true }>;
const fingerprint = 'c'.repeat(64);

function success(result: Result): Success {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

function error(result: Result, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`Expected ${code}, received success`);
  expect(result.error.code).toBe(code);
}

function outcome(effects: Effect[] = [], next: string | null = null): Outcome {
  return { text: 'The configured result is applied.', effects, next_stage_id: next };
}

function opening(effects: Effect[] = [], next: string | null = null): Event {
  return {
    id: 'E_TEST_OPEN', text: 'Choose a beginning.', trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
    interaction: 'choice', options: [{ id: 'start', text: 'Begin', risk: 'normal', unavailable_text: 'Not available', outcome: outcome(effects, next) }],
  };
}

function random(id: string, effects: Effect[], options: { probability?: number; cooldown?: number; max?: number | null; rare?: boolean } = {}): Event {
  return {
    id, text: `Random event ${id}`, interaction: 'automatic', outcome: outcome(effects),
    trigger: {
      kind: 'random', weight: 1, trigger_probability: options.probability ?? 1,
      cooldown_years: options.cooldown ?? 0, max_occurrences: options.max ?? null, rare: options.rare ?? false,
    },
  };
}

function history(id: string, year: number, effects: Effect[], priority = 0): Event {
  return { id, text: `History ${id}`, trigger: { kind: 'historical', year, priority }, interaction: 'automatic', outcome: outcome(effects) };
}

function stage(id: string, next: string | null = null): Stage {
  return {
    id, text: `Confirm ${id}`, check: { attribute: 'intelligence', dc: 14, modifier: 2 },
    success: outcome([{ type: 'attribute_add', attribute: 'wealth', amount: 1 }], next),
    failure: outcome([{ type: 'attribute_add', attribute: 'wealth', amount: -1 }], next),
  };
}

async function quietContent(): Promise<ContentBundle> {
  const bundle = await loadTemplate();
  bundle.rules.age_bands = [{ id: 'fixed', min: 9, max: 9, weight: 1, modifiers: {} }];
  bundle.rules.lifespan = { min: 80, max: 80, min_remaining_years: 3 };
  bundle.rules.opening.trait_count = 0;
  bundle.rules.events = { per_year: 0, choice_budget_min: 0, choice_budget_max: 0 };
  for (const region of bundle.regions) {
    region.weight = region.id === 'R_JIANGNAN' ? 1 : 0;
    region.modifiers = {};
    region.flags = [];
  }
  for (const caste of bundle.castes) {
    caste.weight = caste.id === 'C_SOLDIER' ? 1 : 0;
    caste.modifiers = {};
    caste.flags = [];
  }
  for (const background of bundle.era.backgrounds) {
    background.modifiers = {};
    background.flags = [];
  }
  bundle.events = [];
  bundle.chains = [];
  bundle.achievements = [];
  return bundle;
}

function engineFor(bundle: ContentBundle, contentFingerprint = fingerprint): GameEngine {
  expect(validateContent(bundle)).toEqual({ ok: true, issues: [] });
  return new GameEngine(bundle, contentFingerprint);
}

function choose(engine: GameEngine, result: Result, commandId = 'choose', optionId = 'start'): Success {
  const pending = success(result).pending;
  if (pending?.kind !== 'option') throw new Error('Expected a pending option');
  return success(engine.resolveOption(commandId, pending.event_instance_id, optionId));
}

function roll(engine: GameEngine, result: Result, commandId: string): Success {
  const pending = success(result).pending;
  if (pending?.kind !== 'stage') throw new Error('Expected a pending stage');
  return success(engine.resolveStage(commandId, pending.event_instance_id, pending.stage_id));
}

function addTestChain(bundle: ContentBundle): void {
  bundle.events.push({ id: 'E_NODE', text: 'Node', trigger: { kind: 'chain' }, interaction: 'automatic', outcome: outcome() });
  bundle.chains.push({
    id: 'CH_TEST', name: 'Test chain', priority: 0, interrupt_text: 'Interrupted',
    nodes: [{ after_years: 1, event_id: 'E_NODE' }], completion: outcome([{ type: 'flag_add', id: 'chain_completed' }]),
  });
}

describe('GameEngine: data-driven deterministic openings', () => {
  it.each([0, 1640, 0xffffffff])('has identical initialization and saved RNG for seed %i', async (seed) => {
    const bundle = await quietContent();
    bundle.rules.opening.trait_count = 2;
    const first = engineFor(bundle);
    const second = engineFor(bundle);
    expect(first.initGame({ seed })).toEqual(second.initGame({ seed }));
    expect(first.exportSave()).toEqual(second.exportSave());
    expect(first.exportSave().payload.run.run_id).toBe(`life:${fingerprint}:${seed}`);
  });

  const combinations = [
    ['child', 9], ['youth', 15], ['adult', 35], ['senior', 60],
  ].flatMap(([band, age]) => ['R_SHANBEI', 'R_CAPITAL', 'R_JIANGNAN'].flatMap((region) =>
    ['C_REFUGEE', 'C_SOLDIER', 'C_GENTRY'].map((caste) => ({ band: String(band), age: Number(age), region, caste }))));

  it.each(combinations)('opens $band / $region / $caste using its own valid biography', async ({ band, age, region, caste }) => {
    const bundle = await loadTemplate();
    const ageBand = bundle.rules.age_bands.find((item) => item.id === band)!;
    bundle.rules.age_bands = [{ ...ageBand, min: age, max: age, weight: 1 }];
    for (const item of bundle.regions) item.weight = item.id === region ? 1 : 0;
    for (const item of bundle.castes) item.weight = item.id === caste ? 1 : 0;
    bundle.events = [];
    bundle.chains = [];
    bundle.achievements = [];
    const engine = engineFor(bundle);
    const result = success(engine.initGame({ seed: 1640 }));
    const player = result.state.player;
    const identity = age <= 10 ? 'I_DEPENDENT' : ({ C_REFUGEE: 'I_REFUGEE', C_SOLDIER: 'I_WORKER', C_GENTRY: 'I_HOUSEHOLD' } as const)[caste as 'C_REFUGEE' | 'C_SOLDIER' | 'C_GENTRY'];
    expect(player).toMatchObject({ start_age: age, age, start_year: 1640, calendar_year: 1640, region_id: region, caste_id: caste, identity_id: identity, highest_identity_id: identity });
    expect(player.traits).toHaveLength(2);
    expect(new Set(player.traits).size).toBe(2);
    expect(player.max_lifespan).toBeGreaterThanOrEqual(age + bundle.rules.lifespan.min_remaining_years);
    expect(player.max_lifespan).toBeGreaterThanOrEqual(bundle.rules.lifespan.min);
    expect(player.max_lifespan).toBeLessThanOrEqual(bundle.rules.lifespan.max);
    expect(player.flags.includes('dependent')).toBe(age <= 10);
    expect(player.flags.includes('debt')).toBe(age >= 11 && caste === 'C_REFUGEE');
    expect(result.state.status).toBe('READY');
    expect(result.pending).toBeNull();
  });

  it('sums all initial modifiers before one clamp and unions source flags', async () => {
    const bundle = await quietContent();
    bundle.rules.age_bands[0]!.modifiers = { physique: -20, wealth: 20, intelligence: 2 };
    const region = bundle.regions.find((item) => item.weight > 0)!;
    region.modifiers = { physique: 20, wealth: -10, intelligence: 3 };
    region.flags = ['shared', 'region'];
    const caste = bundle.castes.find((item) => item.weight > 0)!;
    caste.modifiers = { wealth: -10, intelligence: -1 };
    caste.flags = ['shared', 'caste'];
    for (const background of bundle.era.backgrounds) {
      background.modifiers = { wealth: 1, intelligence: 1 };
      background.flags = ['shared', 'background'];
    }
    bundle.rules.opening.trait_count = 1;
    for (const trait of bundle.traits) trait.weight = 0;
    Object.assign(bundle.traits[0]!, { weight: 1, modifiers: { wealth: -1, intelligence: -4, prestige: 99, luck: -99 }, flags: ['shared', 'trait'] });
    const result = success(engineFor(bundle).initGame({ seed: 0 }));
    expect(result.state.player.attributes).toEqual({ physique: 3, intelligence: 4, wealth: 3, prestige: 10, luck: 0 });
    expect([...result.state.player.flags].sort()).toEqual(['background', 'caste', 'region', 'shared', 'trait']);
    expect(result.state.player.traits).toEqual([bundle.traits[0]!.id]);
  });

  it('changes equipped trait count by configuration alone', async () => {
    const bundle = await quietContent();
    bundle.rules.opening.trait_count = 1;
    expect(success(engineFor(bundle).initGame({ seed: 1640 })).state.player.traits).toHaveLength(1);
    bundle.rules.opening.trait_count = 0;
    expect(success(engineFor(bundle).initGame({ seed: 1640 })).state.player.traits).toEqual([]);
  });

  it('restricts lifespan to the valid remaining-years intersection', async () => {
    const bundle = await quietContent();
    bundle.rules.lifespan = { min: 9, max: 12, min_remaining_years: 3 };
    expect(success(engineFor(bundle).initGame({ seed: 0 })).state.player.max_lifespan).toBe(12);
  });

  it('does not initialize an existing run twice', async () => {
    const engine = engineFor(await quietContent());
    success(engine.initGame({ seed: 0 }));
    const before = structuredClone(engine.exportSave());
    error(engine.initGame({ seed: 1 }), 'ALREADY_INITIALIZED');
    expect(engine.exportSave()).toEqual(before);
  });

  it('does not leak mutable view collections or attribute objects', async () => {
    const engine = engineFor(await quietContent());
    const result = success(engine.initGame({ seed: 1 }));
    const before = structuredClone(engine.exportSave());
    Reflect.set(result.state.player.flags, String(result.state.player.flags.length), 'injected');
    Reflect.set(result.state.player.attributes, 'wealth', 999);
    expect(engine.exportSave()).toEqual(before);
  });
});

describe('GameEngine: options, explicit stages and atomic commands', () => {
  it('requires one confirmation per stage, never rolls while displaying, and deduplicates committed commands', async () => {
    const bundle = await quietContent();
    const event = opening([{ type: 'attribute_add', attribute: 'wealth', amount: -1 }], 'S1');
    event.stages = [stage('S1', 'S2'), stage('S2')];
    bundle.events = [event];
    const engine = engineFor(bundle);
    const initial = success(engine.initGame({ seed: 1640 }));
    expect(initial.state.status).toBe('AWAITING_OPTION');
    const beforeOption = structuredClone(engine.exportSave());
    error(engine.nextYear('too-early'), 'INVALID_STATE');
    error(engine.resolveOption('wrong-instance', 'missing-instance', 'start'), 'STALE_DECISION');
    expect(engine.exportSave()).toEqual(beforeOption);
    const firstStage = choose(engine, initial, 'choose');
    expect(firstStage.pending).toMatchObject({ kind: 'stage', stage_id: 'S1' });
    expect(firstStage.state.status).toBe('AWAITING_STAGE');
    expect(firstStage.state.player.attributes.wealth).toBe(2);
    expect(engine.exportSave().payload.run.prng).toEqual(beforeOption.payload.run.prng);
    expect(engine.exportSave().payload.run.dice_results).toHaveLength(0);
    const beforeStage = structuredClone(engine.exportSave());
    const pending = firstStage.pending!;
    error(engine.resolveStage('wrong-stage', pending.event_instance_id, 'S2'), 'STALE_DECISION');
    error(engine.nextYear('still-pending'), 'INVALID_STATE');
    expect(engine.exportSave()).toEqual(beforeStage);
    const secondStage = roll(engine, firstStage, 'roll1');
    expect(secondStage.pending).toMatchObject({ kind: 'stage', stage_id: 'S2' });
    expect(secondStage.state.player.calendar_year).toBe(1640);
    expect(engine.exportSave().payload.run.dice_results).toHaveLength(1);
    const afterFirst = structuredClone(engine.exportSave());
    expect(engine.resolveStage('roll1', pending.event_instance_id, 'S1')).toEqual(secondStage);
    error(engine.resolveStage('roll1', pending.event_instance_id, 'S2'), 'COMMAND_ID_CONFLICT');
    error(engine.resolveStage('stale-new-id', pending.event_instance_id, 'S1'), 'STALE_DECISION');
    expect(engine.exportSave()).toEqual(afterFirst);
    const ready = roll(engine, secondStage, 'roll2');
    expect(ready.pending).toBeNull();
    expect(ready.state.status).toBe('READY');
    expect(ready.state.player.calendar_year).toBe(1640);
    expect(engine.exportSave().payload.run.dice_results).toHaveLength(2);
    const afterSecond = structuredClone(engine.exportSave());
    const originalOption = initial.pending!;
    expect(engine.resolveOption('choose', originalOption.event_instance_id, 'start')).toEqual(firstStage);
    expect(engine.exportSave()).toEqual(afterSecond);
  });

  it('restores a pending stage and retains both the next die and prior command receipt', async () => {
    const bundle = await quietContent();
    const event = opening([], 'S1');
    event.stages = [stage('S1', 'S2'), stage('S2')];
    bundle.events = [event];
    const uninterrupted = engineFor(bundle);
    const first = choose(uninterrupted, uninterrupted.initGame({ seed: 73 }));
    const second = roll(uninterrupted, first, 'roll1');
    const saved = JSON.parse(JSON.stringify(uninterrupted.exportSave()));
    const restored = engineFor(bundle);
    restored.restoreSave(saved);
    const firstPending = first.pending!;
    expect(restored.resolveStage('roll1', firstPending.event_instance_id, 'S1')).toEqual(second);
    expect(restored.exportSave()).toEqual(saved);
    expect(roll(restored, second, 'roll2')).toEqual(roll(uninterrupted, second, 'roll2'));
    expect(restored.exportSave()).toEqual(uninterrupted.exportSave());
  });

  it('rolls back RNG, resources, revision and logs when a staged outcome exceeds chain capacity', async () => {
    const bundle = await quietContent();
    addTestChain(bundle);
    bundle.rules.chains.max_active = 2;
    const event = opening([{ type: 'chain_start', id: 'CH_TEST' }, { type: 'chain_start', id: 'CH_TEST' }], 'S1');
    const impossible = outcome([{ type: 'attribute_add', attribute: 'wealth', amount: -1 }, { type: 'chain_start', id: 'CH_TEST' }]);
    event.stages = [{ ...stage('S1'), success: impossible, failure: structuredClone(impossible) }];
    bundle.events.push(event);
    const engine = engineFor(bundle);
    const awaiting = choose(engine, engine.initGame({ seed: 1640 }));
    expect(awaiting.pending).toMatchObject({ kind: 'stage', stage_id: 'S1' });
    const before = structuredClone(engine.exportSave());
    const pending = awaiting.pending!;
    error(engine.resolveStage('roll', pending.event_instance_id, 'S1'), 'OUTCOME_NOT_APPLICABLE');
    expect(engine.exportSave()).toEqual(before);
    error(engine.resolveStage('roll', pending.event_instance_id, 'S1'), 'OUTCOME_NOT_APPLICABLE');
    expect(engine.exportSave()).toEqual(before);
  });

  it('reports locked options and refuses their effects without consuming a command', async () => {
    const bundle = await quietContent();
    const event = opening();
    if (event.interaction !== 'choice') throw new Error('Expected a choice fixture');
    event.options.push({
      id: 'locked', text: 'Requires a trait', risk: 'high', unavailable_text: 'You lack the required trait.',
      condition: { op: 'has', collection: 'traits', id: 'T_DOCTOR_BOOK' },
      outcome: outcome([{ type: 'attribute_add', attribute: 'wealth', amount: 5 }]),
    });
    bundle.events = [event];
    const engine = engineFor(bundle);
    const initial = success(engine.initGame({ seed: 0 }));
    const pending = initial.pending;
    if (pending?.kind !== 'option') throw new Error('Expected options');
    expect(pending.options.find((item) => item.id === 'locked')).toMatchObject({ available: false, reason: 'You lack the required trait.' });
    expect(pending.options.find((item) => item.id === 'start')).toMatchObject({ available: true });
    const before = structuredClone(engine.exportSave());
    error(engine.resolveOption('selection', pending.event_instance_id, 'locked'), 'OPTION_UNAVAILABLE');
    expect(engine.exportSave()).toEqual(before);
    expect(success(engine.resolveOption('selection', pending.event_instance_id, 'start')).state.status).toBe('READY');
  });

  it('applies each attribute effect in order with immediate clamping, not one final clamp', async () => {
    const bundle = await quietContent();
    bundle.events = [opening([
      { type: 'attribute_add', attribute: 'wealth', amount: 100 }, { type: 'attribute_add', attribute: 'wealth', amount: -2 },
      { type: 'attribute_add', attribute: 'physique', amount: -100 }, { type: 'attribute_add', attribute: 'physique', amount: 2 },
      { type: 'attribute_add', attribute: 'intelligence', amount: 2 }, { type: 'attribute_add', attribute: 'prestige', amount: -2 },
      { type: 'attribute_add', attribute: 'luck', amount: 1 },
    ])];
    const engine = engineFor(bundle);
    const result = choose(engine, engine.initGame({ seed: 0 }));
    expect(result.state.player.attributes).toEqual({ physique: 2, intelligence: 5, wealth: 8, prestige: 1, luck: 4 });
  });
});

describe('GameEngine: configured random scheduling and yearly causality', () => {
  it('never gates in p=0, always gates in p=1, and endpoints consume no probability draws', async () => {
    const absent = await quietContent();
    absent.rules.events.per_year = 1;
    const disabled = structuredClone(absent);
    disabled.events = [random('E_DISABLED', [{ type: 'flag_add', id: 'impossible' }], { probability: 0 })];
    const active = structuredClone(absent);
    active.events = [random('E_ACTIVE', [{ type: 'attribute_add', attribute: 'wealth', amount: 1 }])];
    const baseline = engineFor(absent);
    const zero = engineFor(disabled);
    const one = engineFor(active);
    success(baseline.initGame({ seed: 1640 }));
    const zeroStart = success(zero.initGame({ seed: 1640 }));
    expect(success(one.initGame({ seed: 1640 })).state.player.attributes.wealth).toBe(4);
    expect(zero.exportSave().payload.run.prng).toEqual(baseline.exportSave().payload.run.prng);
    expect(one.exportSave().payload.run.prng.draws).toBe(baseline.exportSave().payload.run.prng.draws + 1);
    expect(zeroStart.logs.some((entry) => entry.message === disabled.era.fallback_text)).toBe(true);
    for (let year = 1; year <= 3; year++) {
      success(baseline.nextYear(`year-${year}`));
      const noEvent = success(zero.nextYear(`year-${year}`));
      const event = success(one.nextYear(`year-${year}`));
      expect(noEvent.state.player.flags).not.toContain('impossible');
      expect(event.state.player.attributes.wealth).toBe(4 + year);
      expect(zero.exportSave().payload.run.prng).toEqual(baseline.exportSave().payload.run.prng);
      expect(one.exportSave().payload.run.prng.draws).toBe(baseline.exportSave().payload.run.prng.draws + year + 1);
    }
    expect(one.exportSave().payload.run.event_counts.E_ACTIVE).toBe(4);
  });

  it('uses cooldown k=1 to allow Y, Y+2 and Y+4, with a real occurrence cap', async () => {
    const bundle = await quietContent();
    bundle.rules.events.per_year = 1;
    bundle.events = [random('E_COOL', [{ type: 'attribute_add', attribute: 'wealth', amount: 1 }], { cooldown: 1, max: 3 })];
    const engine = engineFor(bundle);
    expect(success(engine.initGame({ seed: 1 })).state.player.attributes.wealth).toBe(4);
    const expected = [4, 5, 5, 6, 6, 6];
    for (let index = 0; index < expected.length; index++) {
      expect(success(engine.nextYear(`year-${index}`)).state.player.attributes.wealth).toBe(expected[index]);
    }
    expect(engine.exportSave().payload.run.event_counts.E_COOL).toBe(3);
  });

  it('deducts each random choice at selection, stops at budget, and still executes automatic events', async () => {
    const bundle = await quietContent();
    bundle.rules.events = { per_year: 4, choice_budget_min: 2, choice_budget_max: 2 };
    const choices = ['A', 'B', 'C'].map((id) => {
      const event = opening([{ type: 'flag_add', id: `chosen_${id}` }]);
      event.id = `E_CHOICE_${id}`;
      event.trigger = { kind: 'random', weight: 1, trigger_probability: 1, cooldown_years: 0, max_occurrences: null, rare: false };
      return event;
    });
    bundle.events = [...choices, random('E_AUTO', [{ type: 'attribute_add', attribute: 'prestige', amount: 1 }])];
    const engine = engineFor(bundle);
    let result = success(engine.initGame({ seed: 1640 }));
    const seen = new Set<string>();
    for (let index = 0; index < 2; index++) {
      if (result.pending?.kind !== 'option') throw new Error('Expected both budgeted choices');
      seen.add(result.pending.event_id);
      result = choose(engine, result, `choice-${index}`);
    }
    expect(seen.size).toBe(2);
    expect(result.pending).toBeNull();
    expect(result.state.status).toBe('READY');
    expect(result.state.player.attributes.prestige).toBe(4);
    expect(engine.exportSave().payload.run.remaining_choice_budget).toBe(0);
    for (let year = 1; year <= 3; year++) {
      result = success(engine.nextYear(`year-${year}`));
      expect(result.pending).toBeNull();
      expect(result.state.player.attributes.prestige).toBe(4 + year);
    }
    expect(result.state.player.flags.filter((flag) => flag.startsWith('chosen_'))).toHaveLength(2);
  });

  it('does not spend random choice quota on an opening decision', async () => {
    const bundle = await quietContent();
    bundle.rules.events = { per_year: 1, choice_budget_min: 0, choice_budget_max: 0 };
    const randomChoice = opening([{ type: 'flag_add', id: 'random_choice' }]);
    randomChoice.id = 'E_RANDOM_CHOICE';
    randomChoice.trigger = { kind: 'random', weight: 1, trigger_probability: 1, cooldown_years: 0, max_occurrences: null, rare: false };
    bundle.events = [opening(), randomChoice];
    const engine = engineFor(bundle);
    const initial = success(engine.initGame({ seed: 0 }));
    expect(initial.pending).toMatchObject({ event_id: 'E_TEST_OPEN' });
    expect(choose(engine, initial).pending).toBeNull();
    expect(engine.exportSave().payload.run.remaining_choice_budget).toBe(0);
    expect(engine.exportSave().payload.player.flags).not.toContain('random_choice');
  });

  it('does not deadlock or consume quota when every option is condition-locked', async () => {
    const bundle = await quietContent();
    bundle.rules.events = { per_year: 2, choice_budget_min: 2, choice_budget_max: 2 };
    const locked = opening();
    locked.trigger = { kind: 'random', weight: 1, trigger_probability: 1, cooldown_years: 0, max_occurrences: null, rare: false };
    if (locked.interaction !== 'choice') throw new Error('Expected choice fixture');
    locked.options[0]!.condition = { op: 'compare', field: 'wealth', comparator: 'gt', value: 10 };
    bundle.events = [locked];
    const engine = engineFor(bundle);
    const result = success(engine.initGame({ seed: 0 }));
    expect(result).toMatchObject({ state: { status: 'READY' }, pending: null });
    expect(engine.exportSave().payload.run.remaining_choice_budget).toBe(2);
    expect(engine.exportSave().payload.run.event_counts[locked.id] ?? 0).toBe(0);
    expect(success(engine.nextYear('next')).state.player.calendar_year).toBe(1641);
  });

  it('rechecks queued conditions without replacement draws, resource refunds or phantom executions', async () => {
    const bundle = await quietContent();
    bundle.rules.events = { per_year: 2, choice_budget_min: 2, choice_budget_max: 2 };
    for (const background of bundle.era.backgrounds) background.flags = ['eligible'];
    bundle.events = ['E_FIRST', 'E_SECOND'].map((id) => {
      const event = opening([{ type: 'flag_remove', id: 'eligible' }]);
      event.id = id;
      event.trigger = { kind: 'random', weight: 1, trigger_probability: 1, cooldown_years: 0, max_occurrences: null, rare: false };
      event.condition = { op: 'has', collection: 'flags', id: 'eligible' };
      return event;
    });
    const engine = engineFor(bundle);
    const initial = success(engine.initGame({ seed: 1640 }));
    const afterSelection = structuredClone(engine.exportSave().payload.run.prng);
    const completed = choose(engine, initial);
    expect(completed).toMatchObject({ state: { status: 'READY' }, pending: null });
    expect(completed.state.player.flags).not.toContain('eligible');
    expect(engine.exportSave().payload.run.remaining_choice_budget).toBe(0);
    expect(engine.exportSave().payload.run.prng).toEqual(afterSelection);
    expect(Object.values(engine.exportSave().payload.run.event_counts).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(engine.exportSave().payload.logs.some((entry) => entry.type === 'skip')).toBe(true);
  });

  it('lets luck modify rare weights only, using the configured attribute range', async () => {
    for (const luck of [-10, 0, 10]) {
      const bundle = await quietContent();
      bundle.rules.attributes = { min: -10, max: 10, base: 0 };
      bundle.rules.luck = { factor_min: 0, factor_max: 2 };
      bundle.rules.events.per_year = 1;
      for (const background of bundle.era.backgrounds) background.modifiers = { luck };
      const ordinary = random('E_A_ORDINARY', [{ type: 'flag_add', id: 'ordinary' }]);
      const rare = random('E_B_RARE', [{ type: 'flag_add', id: 'rare' }], { rare: true });
      const nextYearOnly = { op: 'compare' as const, field: 'calendar_year' as const, comparator: 'gte' as const, value: 1641 };
      ordinary.condition = nextYearOnly;
      rare.condition = nextYearOnly;
      bundle.events = [rare, ordinary];
      for (const seed of [0, 1, 2, 73, 1640, 0xffffffff]) {
        const engine = engineFor(bundle);
        success(engine.initGame({ seed }));
        const before = engine.exportSave().payload.run.prng;
        const preview = Mulberry32.restore(before);
        const rareWeight = (luck + 10) / 10;
        const expected = preview.nextUint32() / 0x100000000 * (1 + rareWeight) < 1 ? 'ordinary' : 'rare';
        const result = success(engine.nextYear('year'));
        expect(result.state.player.flags).toContain(expected);
        expect(result.state.player.flags).not.toContain(expected === 'rare' ? 'ordinary' : 'rare');
        expect(engine.exportSave().payload.run.prng).toEqual(preview.exportState());
      }
    }
  });

  it('applies annual injury once even when an event pauses for multiple confirmations', async () => {
    const bundle = await quietContent();
    const enter = opening([{ type: 'injury_add', id: 'INJ_SEVERE' }]);
    const annualChoice = opening([], 'S1');
    annualChoice.id = 'E_ANNUAL';
    annualChoice.trigger = { kind: 'historical', year: 1641, priority: 0 };
    annualChoice.stages = [stage('S1', 'S2'), stage('S2')];
    bundle.events = [enter, annualChoice];
    const engine = engineFor(bundle);
    expect(choose(engine, engine.initGame({ seed: 0 })).state.player.attributes.physique).toBe(3);
    const annual = success(engine.nextYear('1641'));
    expect(annual.state.player.attributes.physique).toBe(2);
    const first = choose(engine, annual, 'annual-choice');
    const second = roll(engine, first, 'roll1');
    const ready = roll(engine, second, 'roll2');
    expect(ready.state.player).toMatchObject({ age: 10, calendar_year: 1641, attributes: { physique: 2 } });
    expect(success(engine.nextYear('1642')).state.player.attributes.physique).toBe(1);
    expect(success(engine.nextYear('1643')).state.status).toBe('READY');
    expect(engine.exportSave().payload.player.attributes.physique).toBe(0);
  });

  it('rolls back the entire year when an automatic result cannot be applied', async () => {
    const bundle = await quietContent();
    addTestChain(bundle);
    bundle.rules.chains.max_active = 1;
    bundle.events.push(opening([{ type: 'chain_start', id: 'CH_TEST' }]));
    bundle.chains[0]!.nodes[0]!.after_years = 2;
    bundle.events.push(history('E_TOO_MANY', 1641, [
      { type: 'attribute_add', attribute: 'wealth', amount: -1 }, { type: 'chain_start', id: 'CH_TEST' },
    ]));
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    const before = structuredClone(engine.exportSave());
    error(engine.nextYear('bad-year'), 'OUTCOME_NOT_APPLICABLE');
    expect(engine.exportSave()).toEqual(before);
  });
});

describe('GameEngine: history boundaries, stable ordering and restoration', () => {
  it('processes start-year history and orders by priority descending then ID ascending', async () => {
    const bundle = await quietContent();
    bundle.events = [
      history('E_B', 1640, [{ type: 'attribute_add', attribute: 'wealth', amount: -2 }]),
      history('E_HIGH', 1640, [{ type: 'attribute_add', attribute: 'wealth', amount: 100 }], 5),
      history('E_A', 1640, [{ type: 'attribute_add', attribute: 'wealth', amount: -100 }]),
    ];
    const engine = engineFor(bundle);
    const result = success(engine.initGame({ seed: 0 }));
    expect(result.state.player.attributes.wealth).toBe(0);
    expect(result.logs.filter((entry) => entry.type === 'event').map((entry) => entry.source_id)).toEqual(['E_HIGH', 'E_A', 'E_B']);
    const saved = JSON.parse(JSON.stringify(engine.exportSave()));
    const restored = engineFor(bundle);
    restored.restoreSave(saved);
    expect(restored.exportSave()).toEqual(saved);
    expect(success(restored.nextYear('1641')).logs.some((entry) => entry.type === 'event')).toBe(false);
  });

  it('switches after 1644 even when no history condition matches, and switches only once', async () => {
    const bundle = await quietContent();
    const unmatched = history('E_CAPITAL', 1644, [{ type: 'flag_add', id: 'capital_history' }]);
    unmatched.condition = { op: 'is', field: 'region_id', value: 'R_CAPITAL' };
    bundle.events = [unmatched];
    const engine = engineFor(bundle);
    success(engine.initGame({ seed: 0 }));
    for (const year of [1641, 1642, 1643]) expect(success(engine.nextYear(String(year))).state.timeline).toBe('historical');
    const boundary = success(engine.nextYear('1644'));
    expect(boundary.state.timeline).toBe('fictional');
    expect(boundary.state.player.calendar_year).toBe(1644);
    expect(boundary.state.player.flags).not.toContain('capital_history');
    expect(engine.exportSave().payload.run.processed_history).toContain('E_CAPITAL');
    const restored = engineFor(bundle);
    restored.restoreSave(JSON.parse(JSON.stringify(engine.exportSave())));
    const following = success(restored.nextYear('1645'));
    expect(following.state.timeline).toBe('fictional');
    expect(following.state.player.calendar_year - bundle.era.historical_end_year).toBe(1);
    expect(restored.exportSave().payload.logs.filter((entry) => entry.type === 'history_switch')).toHaveLength(1);
  });

  it('does not switch before the last historical decision and its stage finish', async () => {
    const bundle = await quietContent();
    bundle.era.start_year = 1644;
    const event = opening([], 'S1');
    event.trigger = { kind: 'historical', year: 1644, priority: 0 };
    event.stages = [stage('S1')];
    bundle.events = [event];
    const engine = engineFor(bundle);
    const initial = success(engine.initGame({ seed: 0 }));
    expect(initial.state.timeline).toBe('historical');
    const awaiting = choose(engine, initial);
    expect(awaiting.state.timeline).toBe('historical');
    const finished = roll(engine, awaiting, 'last-stage');
    expect(finished).toMatchObject({ state: { timeline: 'fictional', status: 'READY' }, pending: null });
    expect(finished.state.player.calendar_year).toBe(1644);
    expect(finished.logs.filter((entry) => entry.type === 'history_switch')).toHaveLength(1);
  });

  it('rechecks history conditions after each earlier outcome without rerunning skipped events', async () => {
    const bundle = await quietContent();
    const stale = history('E_STALE', 1640, [{ type: 'flag_add', id: 'must_not_happen' }]);
    stale.condition = { op: 'is', field: 'region_id', value: 'R_JIANGNAN' };
    bundle.events = [stale, history('E_MOVE', 1640, [{ type: 'region_set', id: 'R_CAPITAL' }], 10)];
    const engine = engineFor(bundle);
    const result = success(engine.initGame({ seed: 0 }));
    expect(result.state.player.region_id).toBe('R_CAPITAL');
    expect(result.state.player.flags).not.toContain('must_not_happen');
    expect(engine.exportSave().payload.run.processed_history).toContain('E_STALE');
    expect(result.logs.some((entry) => entry.type === 'skip' && entry.source_id === 'E_STALE')).toBe(true);
  });
});

describe('GameEngine: effects, achievements and highest identity', () => {
  it('adds/removes flags and injuries as sets, changes region, and applies injury only while present', async () => {
    const bundle = await quietContent();
    bundle.events = [
      opening([{ type: 'flag_add', id: 'custom' }, { type: 'injury_add', id: 'INJ_SEVERE' }, { type: 'region_set', id: 'R_CAPITAL' }]),
      history('E_ADD_AGAIN', 1640, [{ type: 'flag_add', id: 'custom' }, { type: 'injury_add', id: 'INJ_SEVERE' }]),
      history('E_CLEAR', 1641, [{ type: 'flag_remove', id: 'custom' }, { type: 'injury_remove', id: 'INJ_SEVERE' }]),
    ];
    const engine = engineFor(bundle);
    const initial = choose(engine, engine.initGame({ seed: 0 }));
    expect(initial.state.player.flags.filter((id) => id === 'custom')).toHaveLength(1);
    expect(initial.state.player.injuries).toEqual(['INJ_SEVERE']);
    expect(initial.state.player.region_id).toBe('R_CAPITAL');
    expect(initial.state.player.attributes.physique).toBe(3);
    const removed = success(engine.nextYear('1641'));
    expect(removed.state.player.attributes.physique).toBe(2);
    expect(removed.state.player.flags).not.toContain('custom');
    expect(removed.state.player.injuries).toEqual([]);
    expect(success(engine.nextYear('1642')).state.player.attributes.physique).toBe(2);
  });

  it('applies annual injuries in ID order, with the same per-effect clamping rules', async () => {
    const bundle = await quietContent();
    bundle.era.injuries = [
      { id: 'INJ_Z', name: 'Last', annual_effects: [{ type: 'attribute_add', attribute: 'wealth', amount: -2 }] },
      { id: 'INJ_A', name: 'First', annual_effects: [{ type: 'attribute_add', attribute: 'wealth', amount: 100 }] },
    ];
    bundle.events = [opening([{ type: 'injury_add', id: 'INJ_Z' }, { type: 'injury_add', id: 'INJ_A' }])];
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    expect(success(engine.nextYear('1641')).state.player.attributes.wealth).toBe(8);
  });

  it('retains the highest ranked identity and previously earned achievements after a downgrade', async () => {
    const bundle = await quietContent();
    bundle.era.identities.push({ id: 'I_EQUAL', name: 'Equal rank', rank: 3 });
    bundle.achievements = [
      { id: 'A_INITIAL', name: 'Initial', text: 'Present on initialization', priority: 0, retirable: false,
        condition: { op: 'compare', field: 'age', comparator: 'eq', value: 9 } },
      { id: 'A_PROMOTED', name: 'Promotion', text: 'Earned as an artisan', priority: 2, retirable: true,
        condition: { op: 'is', field: 'identity_id', value: 'I_ARTISAN' } },
      { id: 'A_UNLOCKED', name: 'Explicit', text: 'Explicit ending unlock', priority: 1, retirable: false,
        condition: { op: 'compare', field: 'wealth', comparator: 'gt', value: 10 } },
    ];
    bundle.events = [
      opening([{ type: 'identity_set', id: 'I_ARTISAN' }, { type: 'ending_unlock', id: 'A_UNLOCKED' }]),
      history('E_EQUAL', 1641, [{ type: 'identity_set', id: 'I_EQUAL' }]),
      history('E_LOWER', 1642, [{ type: 'identity_set', id: 'I_REFUGEE' }]),
    ];
    const engine = engineFor(bundle);
    const initial = success(engine.initGame({ seed: 0 }));
    expect(initial.state.player.achievements).toContain('A_INITIAL');
    const promoted = choose(engine, initial);
    expect(promoted.state.player).toMatchObject({ identity_id: 'I_ARTISAN', highest_identity_id: 'I_ARTISAN' });
    expect([...promoted.state.player.achievements].sort()).toEqual(['A_INITIAL', 'A_PROMOTED', 'A_UNLOCKED']);
    const tied = success(engine.nextYear('1641'));
    expect(tied.state.player).toMatchObject({ identity_id: 'I_EQUAL', highest_identity_id: 'I_ARTISAN' });
    const lower = success(engine.nextYear('1642'));
    expect(lower.state.player).toMatchObject({ identity_id: 'I_REFUGEE', highest_identity_id: 'I_ARTISAN' });
    expect([...lower.state.player.achievements].sort()).toEqual(['A_INITIAL', 'A_PROMOTED', 'A_UNLOCKED']);
    expect(success(engine.retire('retire')).state.status).toBe('ENDED');
    expect(engine.generateEndingReport()).toMatchObject({
      end_reason: 'retired', death_id: null, primary_achievement_id: 'A_PROMOTED', highest_identity_id: 'I_ARTISAN', years_played: 2,
    });
  });

  it('refuses retirement without an attained retirable achievement and while awaiting input', async () => {
    const bundle = await quietContent();
    bundle.achievements = [{
      id: 'A_NOT_RETIRABLE', name: 'Reached', text: 'Not a retirement route', priority: 1, retirable: false,
      condition: { op: 'compare', field: 'age', comparator: 'gte', value: 0 },
    }];
    const engine = engineFor(bundle);
    success(engine.initGame({ seed: 0 }));
    const before = structuredClone(engine.exportSave());
    error(engine.retire('retire'), 'RETIRE_UNAVAILABLE');
    expect(engine.exportSave()).toEqual(before);
    bundle.achievements[0]!.retirable = true;
    bundle.events = [opening()];
    const pendingEngine = engineFor(bundle);
    success(pendingEngine.initGame({ seed: 0 }));
    const beforePending = structuredClone(pendingEngine.exportSave());
    error(pendingEngine.retire('pending-retire'), 'RETIRE_UNAVAILABLE');
    expect(pendingEngine.exportSave()).toEqual(beforePending);
  });

  it('selects the highest-priority ending, breaking ties by code-unit ID instead of array order', async () => {
    const bundle = await quietContent();
    bundle.achievements = [
      ['A_z', 10], ['A_LOW', 1], ['A_a', 10], ['A_B', 10],
    ].map(([id, priority]) => ({
      id: String(id), name: String(id), text: 'Achieved at initialization', priority: Number(priority), retirable: true,
      condition: { op: 'compare' as const, field: 'age' as const, comparator: 'gte' as const, value: 0 },
    }));
    const engine = engineFor(bundle);
    success(engine.initGame({ seed: 0 }));
    const result = success(engine.retire('finish'));
    expect(result.state.status).toBe('ENDED');
    expect(engine.generateEndingReport().primary_achievement_id).toBe('A_B');
    const before = structuredClone(engine.exportSave());
    expect(engine.retire('finish')).toEqual(result);
    expect(engine.exportSave()).toEqual(before);
  });
});

describe('GameEngine: death, lifespan and read-only ending reports', () => {
  it('ends on opening death without advancing age or executing start-year history', async () => {
    const bundle = await quietContent();
    bundle.events = [
      { id: 'E_DEATH', text: 'Opening accident', trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
        interaction: 'automatic', outcome: outcome([{ type: 'death', id: 'D_OPENING' }]) },
      history('E_MUST_NOT_RUN', 1640, [{ type: 'flag_add', id: 'after_death' }]),
    ];
    const engine = engineFor(bundle);
    const result = success(engine.initGame({ seed: 0 }));
    expect(result).toMatchObject({ state: { status: 'ENDED', player: { age: 9, calendar_year: 1640 } }, pending: null });
    expect(result.state.player.flags).not.toContain('after_death');
    expect(engine.exportSave().payload.run.queue).toEqual([]);
    expect(engine.exportSave().payload.run.active_event).toBeNull();
    expect(engine.generateEndingReport()).toMatchObject({
      content_id: bundle.manifest.content_id, content_version: bundle.manifest.content_version,
      content_fingerprint: fingerprint, seed: 0, years_played: 0, end_reason: 'death', death_id: 'D_OPENING', primary_achievement_id: null,
    });
    expect(engine.exportSave().payload.logs.filter((entry) => entry.type === 'death')).toHaveLength(1);
    expect(engine.exportSave().payload.logs.filter((entry) => entry.type === 'ending')).toHaveLength(1);
  });

  it('stops the queue immediately after death, including pending future stages', async () => {
    const bundle = await quietContent();
    const decision = opening([], 'S1');
    const fatal = outcome([{ type: 'attribute_add', attribute: 'wealth', amount: -1 }, { type: 'death', id: 'D_CRISIS' }]);
    decision.stages = [{ ...stage('S1'), success: fatal, failure: structuredClone(fatal) }];
    bundle.events = [decision, history('E_AFTER', 1640, [{ type: 'flag_add', id: 'after_death' }])];
    const engine = engineFor(bundle);
    const awaiting = choose(engine, engine.initGame({ seed: 0 }));
    const ended = roll(engine, awaiting, 'fatal-roll');
    expect(ended).toMatchObject({ state: { status: 'ENDED', player: { attributes: { wealth: 2 } } }, pending: null });
    expect(ended.state.player.flags).not.toContain('after_death');
    expect(engine.exportSave().payload.run.queue).toEqual([]);
    expect(engine.generateEndingReport().death_id).toBe('D_CRISIS');
  });

  it('checks lifespan before annual injury, chains, history and random work', async () => {
    const bundle = await quietContent();
    bundle.rules.lifespan = { min: 12, max: 12, min_remaining_years: 3 };
    bundle.era.injuries = [{
      id: 'INJ_SEVERE', name: 'Annual injury', annual_effects: [{ type: 'attribute_add', attribute: 'wealth', amount: -1 }],
    }];
    bundle.events = [opening([{ type: 'injury_add', id: 'INJ_SEVERE' }]), history('E_AT_DEATH', 1643, [{ type: 'flag_add', id: 'too_late' }])];
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    expect(success(engine.nextYear('1641')).state.player.attributes.wealth).toBe(2);
    expect(success(engine.nextYear('1642')).state.player.attributes.wealth).toBe(1);
    const terminal = success(engine.nextYear('1643'));
    expect(terminal.state).toMatchObject({ status: 'ENDED', player: { age: 12, calendar_year: 1643, attributes: { wealth: 1 } } });
    expect(terminal.state.player.flags).not.toContain('too_late');
    expect(engine.generateEndingReport()).toMatchObject({ years_played: 3, end_reason: 'death', death_id: 'D_OLD_AGE' });
  });

  it('allows an explicit annual death effect, independent of physique reaching zero', async () => {
    const bundle = await quietContent();
    bundle.era.injuries = [{ id: 'INJ_SEVERE', name: 'Fatal annual condition', annual_effects: [{ type: 'death', id: 'D_CRISIS' }] }];
    bundle.events = [opening([{ type: 'injury_add', id: 'INJ_SEVERE' }])];
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    const terminal = success(engine.nextYear('1641'));
    expect(terminal.state).toMatchObject({ status: 'ENDED', player: { attributes: { physique: 3 } } });
    expect(engine.generateEndingReport()).toMatchObject({ years_played: 1, death_id: 'D_CRISIS' });
  });

  it('rejects reports before ending and makes repeat reports independent read-only values', async () => {
    const bundle = await quietContent();
    bundle.rules.lifespan = { min: 12, max: 12, min_remaining_years: 3 };
    const engine = engineFor(bundle);
    success(engine.initGame({ seed: 1640 }));
    const initial = structuredClone(engine.exportSave());
    expect(() => engine.generateEndingReport()).toThrowError(expect.objectContaining({ code: 'RUN_NOT_ENDED' }));
    expect(engine.exportSave()).toEqual(initial);
    for (const year of [1641, 1642, 1643]) success(engine.nextYear(String(year)));
    const before = structuredClone(engine.exportSave());
    const report = engine.generateEndingReport();
    expect(engine.generateEndingReport()).toEqual(report);
    Reflect.set(report, 'death_id', 'D_OPENING');
    expect(engine.generateEndingReport().death_id).toBe('D_OLD_AGE');
    error(engine.nextYear('after-end'), 'INVALID_STATE');
    expect(engine.exportSave()).toEqual(before);
  });

  it('rejects restored saves for different content without changing the current run', async () => {
    const bundle = await quietContent();
    const engine = engineFor(bundle);
    success(engine.initGame({ seed: 0 }));
    const other = engineFor(bundle, 'd'.repeat(64));
    success(other.initGame({ seed: 1 }));
    const before = structuredClone(other.exportSave());
    expect(() => other.restoreSave(engine.exportSave())).toThrowError(expect.objectContaining({ code: 'CONTENT_MISMATCH' }));
    expect(other.exportSave()).toEqual(before);
  });
});

describe('GameEngine: integrated dice and branch routing', () => {
  it('combines equipped trait modifiers with the current stage only and logs the actual die', async () => {
    const bundle = await quietContent();
    bundle.rules.opening.trait_count = 2;
    for (const trait of bundle.traits) {
      trait.weight = 0;
      trait.modifiers = {};
      trait.check_modifiers = {};
    }
    bundle.traits[0]!.weight = 1;
    bundle.traits[0]!.modifiers = { intelligence: 1 };
    bundle.traits[0]!.check_modifiers = { intelligence: 4 };
    bundle.traits[1]!.weight = 1;
    bundle.traits[1]!.check_modifiers = { intelligence: 5 };
    const event = opening([], 'S1');
    event.stages = [{
      id: 'S1', text: 'Trait-modified check', check: { attribute: 'intelligence', dc: 14, modifier: -2 },
      success: outcome([{ type: 'flag_add', id: 'passed' }]), failure: outcome([{ type: 'flag_add', id: 'failed' }]),
    }];
    bundle.events = [event];
    const engine = engineFor(bundle);
    const awaiting = choose(engine, engine.initGame({ seed: 1640 }));
    const before = engine.exportSave().payload.run.prng;
    const preview = Mulberry32.restore(before);
    const raw = uniformInt(1, 20, preview);
    const passed = raw === 20 || (raw !== 1 && raw + 4 + 3 >= 14);
    const result = roll(engine, awaiting, 'check');
    expect(result.state.player.flags).toContain(passed ? 'passed' : 'failed');
    expect(result.state.player.flags).not.toContain(passed ? 'failed' : 'passed');
    expect(engine.exportSave().payload.run.dice_results).toEqual([expect.objectContaining({
      raw, attribute_value: 4, modifier_before: 7, modifier_after: 3, dc: 14, success: passed, success_probability: 14 / 20,
    })]);
    expect(result.logs.filter((entry) => entry.type === 'dice')).toHaveLength(1);
    expect(engine.exportSave().payload.run.prng).toEqual(preview.exportState());
  });

  it('chooses success and failure stages from real seed streams, not automatic background rolls', async () => {
    const bundle = await quietContent();
    const event = opening([], 'S1');
    event.stages = [
      { id: 'S1', text: 'Branch check', check: { attribute: 'intelligence', dc: 14, modifier: 0 },
        success: outcome([{ type: 'flag_add', id: 'passed' }], 'S2'), failure: outcome([{ type: 'flag_add', id: 'failed' }]) },
      stage('S2'),
    ];
    bundle.events = [event];
    const reached = new Set<boolean>();
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1640, 0xffffffff]) {
      const engine = engineFor(bundle);
      const awaiting = choose(engine, engine.initGame({ seed }));
      const preview = Mulberry32.restore(engine.exportSave().payload.run.prng);
      const raw = uniformInt(1, 20, preview);
      const passed = raw === 20 || (raw !== 1 && raw + 3 >= 14);
      reached.add(passed);
      const result = roll(engine, awaiting, 'roll');
      if (passed) {
        expect(result.pending).toMatchObject({ kind: 'stage', stage_id: 'S2' });
        expect(result.state.status).toBe('AWAITING_STAGE');
      } else {
        expect(result.pending).toBeNull();
        expect(result.state.status).toBe('READY');
      }
      expect(result.state.player.flags).toContain(passed ? 'passed' : 'failed');
      expect(engine.exportSave().payload.run.dice_results).toHaveLength(1);
      expect(engine.exportSave().payload.run.prng).toEqual(preview.exportState());
    }
    expect([...reached].sort()).toEqual([false, true]);
  });

  it('does not let luck change D20 values, modifiers, DC or check probability', async () => {
    const bundle = await quietContent();
    const event = opening([], 'S1');
    event.stages = [stage('S1')];
    bundle.events = [event];
    const lucky = structuredClone(bundle);
    for (const background of bundle.era.backgrounds) background.modifiers = { luck: -100 };
    for (const background of lucky.era.backgrounds) background.modifiers = { luck: 100 };
    const low = engineFor(bundle);
    const high = engineFor(lucky);
    roll(low, choose(low, low.initGame({ seed: 1640 })), 'roll');
    roll(high, choose(high, high.initGame({ seed: 1640 })), 'roll');
    expect(low.exportSave().payload.player.attributes.luck).toBe(0);
    expect(high.exportSave().payload.player.attributes.luck).toBe(10);
    expect(low.exportSave().payload.run.dice_results).toEqual(high.exportSave().payload.run.dice_results);
    expect(low.exportSave().payload.run.prng).toEqual(high.exportSave().payload.run.prng);
  });
});

describe('GameEngine: explainable candidates and declarative opening filtering', () => {
  it('records eligibility, probability gates, rare effective weights and conditional probabilities', async () => {
    const bundle = await quietContent();
    bundle.rules.events.per_year = 1;
    bundle.rules.luck = { factor_min: 0, factor_max: 2 };
    for (const background of bundle.era.backgrounds) background.modifiers = { luck: 7 };
    const ordinary = random('E_A', [{ type: 'flag_add', id: 'ordinary' }]);
    const rare = random('E_B', [{ type: 'flag_add', id: 'rare' }], { rare: true });
    const closedGate = random('E_C', [{ type: 'flag_add', id: 'gate_closed' }], { probability: 0 });
    const zeroWeight = random('E_D', [{ type: 'flag_add', id: 'zero_weight' }]);
    const denied = random('E_E', [{ type: 'flag_add', id: 'denied' }]);
    if (ordinary.trigger.kind !== 'random' || rare.trigger.kind !== 'random' || zeroWeight.trigger.kind !== 'random') throw new Error('Expected random fixtures');
    ordinary.trigger.weight = 2;
    rare.trigger.weight = 3;
    zeroWeight.trigger.weight = 0;
    denied.condition = { op: 'compare', field: 'wealth', comparator: 'gt', value: 10 };
    bundle.events = [denied, zeroWeight, closedGate, rare, ordinary];
    const engine = engineFor(bundle);
    const result = success(engine.initGame({ seed: 1640 }));
    const selected = result.state.player.flags.includes('ordinary') ? 'E_A' : 'E_B';
    expect(result.logs).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'draw', data: expect.objectContaining({
        selected_event_id: selected,
        candidates: expect.arrayContaining([
          expect.objectContaining({ event_id: 'E_A', eligible: true, reason: null, gate_passed: true, effective_weight: 2, conditional_probability: 1 / 4 }),
          expect.objectContaining({ event_id: 'E_B', eligible: true, reason: null, gate_passed: true, effective_weight: 6, conditional_probability: 3 / 4 }),
          expect.objectContaining({ event_id: 'E_C', gate_passed: false }),
          expect.objectContaining({ event_id: 'E_D', eligible: false, reason: expect.any(String), gate_passed: null }),
          expect.objectContaining({ event_id: 'E_E', eligible: false, reason: expect.any(String), gate_passed: null }),
        ]),
      }),
    })]));
    expect(result.state.player.flags).not.toContain('gate_closed');
    expect(result.state.player.flags).not.toContain('zero_weight');
    expect(result.state.player.flags).not.toContain('denied');
    const logs = engine.exportSave().payload.logs;
    expect(logs.every((entry, index) => index === 0 || entry.seq === logs[index - 1]!.seq + 1)).toBe(true);
    expect(new Set(logs.map((entry) => entry.seq)).size).toBe(logs.length);
  });

  it('sorts random candidates by code units independently of authored event order', async () => {
    const bundle = await quietContent();
    bundle.rules.events.per_year = 1;
    bundle.events = ['E_z', 'E_a', 'E_B'].map((id) => random(id, [{ type: 'flag_add', id }]));
    const reversed = structuredClone(bundle);
    reversed.events.reverse();
    const left = engineFor(bundle);
    const right = engineFor(reversed);
    expect(left.initGame({ seed: 1640 })).toEqual(right.initGame({ seed: 1640 }));
    for (const year of ['1641', '1642', '1643']) expect(left.nextYear(year)).toEqual(right.nextYear(year));
    expect(left.exportSave()).toEqual(right.exportSave());
  });

  it('never executes a second random event after the first selected event kills the player', async () => {
    const bundle = await quietContent();
    bundle.rules.events.per_year = 2;
    bundle.events = ['E_A', 'E_B'].map((id) => random(id, [{ type: 'death', id: 'D_CRISIS' }]));
    const engine = engineFor(bundle);
    const result = success(engine.initGame({ seed: 1640 }));
    expect(result.state.status).toBe('ENDED');
    expect(result.logs.filter((entry) => entry.type === 'event')).toHaveLength(1);
    expect(result.logs.filter((entry) => entry.type === 'death')).toHaveLength(1);
    expect(engine.exportSave().payload.run.queue).toEqual([]);
    expect(Object.values(engine.exportSave().payload.run.event_counts).reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it('filters invalid positive-weight region/caste pairs using biography conditions before sampling', async () => {
    const bundle = await quietContent();
    for (const region of bundle.regions) region.weight = 1;
    for (const caste of bundle.castes) caste.weight = 1;
    const onlyBackground = structuredClone(bundle.era.backgrounds[0]!);
    onlyBackground.condition = { op: 'all', conditions: [
      { op: 'compare', field: 'age', comparator: 'eq', value: 9 },
      { op: 'is', field: 'region_id', value: 'R_CAPITAL' },
      { op: 'is', field: 'caste_id', value: 'C_GENTRY' },
    ] };
    onlyBackground.identity_id = 'I_DEPENDENT';
    onlyBackground.flags = ['only_valid_biography'];
    bundle.era.backgrounds = [onlyBackground];
    for (const seed of [0, 1, 2, 1640, 0xffffffff]) {
      const result = success(engineFor(bundle).initGame({ seed }));
      expect(result.state.player).toMatchObject({ region_id: 'R_CAPITAL', caste_id: 'C_GENTRY', identity_id: 'I_DEPENDENT' });
      expect(result.state.player.flags).toContain('only_valid_biography');
    }
  });

  it('sorts each randomized opening collection rather than taking authored array order', async () => {
    const bundle = await loadTemplate();
    bundle.events = [];
    bundle.chains = [];
    bundle.achievements = [];
    const reversed = structuredClone(bundle);
    reversed.rules.age_bands.reverse();
    reversed.regions.reverse();
    reversed.castes.reverse();
    reversed.era.backgrounds.reverse();
    reversed.traits.reverse();
    for (const seed of [0, 1, 1640, 0xffffffff]) {
      const left = engineFor(bundle);
      const right = engineFor(reversed);
      expect(left.initGame({ seed })).toEqual(right.initGame({ seed }));
      expect(left.exportSave()).toEqual(right.exportSave());
    }
  });
});

describe('GameEngine: weighted opening pairs and finite public snapshots', () => {
  it('weights legal region/caste pairs by their product, not by biography weight or count', async () => {
    const bundle = await quietContent();
    for (const region of bundle.regions) region.weight = region.id === 'R_CAPITAL' ? 1 : region.id === 'R_JIANGNAN' ? 2 : 0;
    for (const caste of bundle.castes) caste.weight = caste.id === 'C_GENTRY' ? 1 : caste.id === 'C_SOLDIER' ? 3 : 0;
    for (const background of bundle.era.backgrounds) background.weight = background.id.includes('GENTRY') ? 100 : 1;
    const pairs = [
      { region_id: 'R_CAPITAL', caste_id: 'C_GENTRY', end: 1 },
      { region_id: 'R_CAPITAL', caste_id: 'C_SOLDIER', end: 4 },
      { region_id: 'R_JIANGNAN', caste_id: 'C_GENTRY', end: 6 },
      { region_id: 'R_JIANGNAN', caste_id: 'C_SOLDIER', end: 12 },
    ];
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1640, 0xffffffff]) {
      const preview = new Mulberry32(seed);
      preview.nextUint32(); // A singleton weighted age band still consumes one sample.
      preview.nextUint32(); // The singleton inclusive age interval also consumes one sample.
      const point = preview.nextUint32() / 0x100000000 * 12;
      const expected = pairs.find((pair) => point < pair.end)!;
      const result = success(engineFor(bundle).initGame({ seed }));
      expect(result.state.player.region_id).toBe(expected.region_id);
      expect(result.state.player.caste_id).toBe(expected.caste_id);
    }
  });

  it('keeps command receipts finite and excludes save internals from public views', async () => {
    const bundle = await quietContent();
    const engine = engineFor(bundle);
    const initial = success(engine.initGame({ seed: 0 }));
    for (const key of ['payload', 'run', 'logs', 'processed_commands', 'prng', 'engine', 'cursor']) {
      expect(initial.state).not.toHaveProperty(key);
    }
    for (let year = 1; year <= 8; year++) success(engine.nextYear(`early-${year}`));
    const firstLength = JSON.stringify(engine.exportSave()).length;
    for (let year = 9; year <= 16; year++) success(engine.nextYear(`late-${year}`));
    const secondLength = JSON.stringify(engine.exportSave()).length;
    expect(secondLength).toBeLessThan(firstLength * 3);
  });
});
