import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { validateContent } from '../../assets/scripts/core/content/ContentValidator.js';
import type { Chain, Condition, ContentBundle, Effect, Event, Outcome, Stage } from '../../assets/scripts/core/types/content.generated.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';
import { loadTemplate } from '../helpers/content.js';

type Success = Extract<CommandResult, { ok: true }>;
const fingerprint = 'e'.repeat(64);

function success(result: CommandResult): Success {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

function error(result: CommandResult, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`Expected ${code}`);
  expect(result.error.code).toBe(code);
}

function outcome(effects: Effect[] = [], next: string | null = null): Outcome {
  return { text: 'The chain result is applied.', effects, next_stage_id: next };
}

function choice(id: string, effects: Effect[], trigger: Event['trigger'], next: string | null = null): Event {
  return {
    id, text: id, trigger, interaction: 'choice',
    options: [{ id: 'start', text: 'Continue', risk: 'normal', unavailable_text: 'Cannot proceed', outcome: outcome(effects, next) }],
  };
}

function automatic(id: string, effects: Effect[], trigger: Event['trigger']): Event {
  return { id, text: id, trigger, interaction: 'automatic', outcome: outcome(effects) };
}

async function chainContent(): Promise<ContentBundle> {
  const bundle = await loadTemplate();
  bundle.rules.age_bands = [{ id: 'fixed', min: 9, max: 9, weight: 1, modifiers: {} }];
  bundle.rules.lifespan = { min: 80, max: 80, min_remaining_years: 3 };
  bundle.rules.events = { per_year: 0, automatic_ratio: 0.6 };
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
    background.flags = [];
    background.modifiers = {};
  }
  bundle.events = bundle.events.filter((event) => event.trigger.kind === 'chain');
  bundle.events.push(choice('E_START', [{ type: 'attribute_add', attribute: 'wealth', amount: -1 }, { type: 'chain_start', id: 'CH_WORKSHOP' }],
    { kind: 'opening', weight: 1, trigger_probability: 1 }));
  return bundle;
}

function engineFor(bundle: ContentBundle): GameEngine {
  expect(validateContent(bundle)).toEqual({ ok: true, issues: [] });
  return new GameEngine(bundle, fingerprint);
}

function choose(engine: GameEngine, result: CommandResult, commandId = 'start', optionId = 'start'): Success {
  const pending = success(result).pending;
  if (pending?.kind !== 'option') throw new Error('Expected a pending option');
  return success(engine.resolveOption(commandId, pending.event_instance_id, optionId));
}

function roll(engine: GameEngine, result: CommandResult, commandId: string): Success {
  const pending = success(result).pending;
  if (pending?.kind !== 'stage') throw new Error('Expected a pending stage');
  return success(engine.resolveStage(commandId, pending.event_instance_id, pending.stage_id));
}

function configureOpening(bundle: ContentBundle, effects: Effect[]): void {
  const event = bundle.events.find((item) => item.id === 'E_START');
  if (!event || event.interaction !== 'choice') throw new Error('Missing opening fixture');
  event.options[0]!.outcome = outcome(effects);
}

function eventById(bundle: ContentBundle, id: string): Event {
  const event = bundle.events.find((item) => item.id === id);
  if (!event) throw new Error(`Missing event ${id}`);
  return event;
}

function automaticOutcome(bundle: ContentBundle, id: string): Outcome {
  const event = eventById(bundle, id);
  if (event.interaction !== 'automatic') throw new Error(`Expected automatic event ${id}`);
  return event.outcome;
}

describe('chains: real years, saved cursors and exactly-once completion', () => {
  it('starts at 1640/9 and advances one node at 1641/10, 1642/11 and 1643/12', async () => {
    const bundle = await chainContent();
    const engine = engineFor(bundle);
    const started = choose(engine, engine.initGame({ seed: 1640 }));
    expect(started.state.player).toMatchObject({ age: 9, calendar_year: 1640, attributes: { intelligence: 3, wealth: 2, prestige: 3 } });
    expect(started.state.player.chains).toHaveLength(1);
    expect(started.state.player.chains[0]).toMatchObject({ chain_id: 'CH_WORKSHOP', started_year: 1640, next_due_year: 1641, node_index: 0, status: 'active' });
    expect(started.state.player.flags).not.toContain('workshop_complete');
    const first = success(engine.nextYear('1641'));
    expect(first.state.player).toMatchObject({ age: 10, calendar_year: 1641, attributes: { intelligence: 4, wealth: 2, prestige: 3 } });
    expect(first.state.player.chains[0]).toMatchObject({ next_due_year: 1642, node_index: 1, status: 'active' });
    const second = success(engine.nextYear('1642'));
    expect(second.state.player).toMatchObject({ age: 11, calendar_year: 1642, attributes: { intelligence: 4, wealth: 3, prestige: 3 } });
    expect(second.state.player.chains[0]).toMatchObject({ next_due_year: 1643, node_index: 2, status: 'active' });
    const final = success(engine.nextYear('1643'));
    expect(final.state.player).toMatchObject({ age: 12, calendar_year: 1643, identity_id: 'I_ARTISAN', highest_identity_id: 'I_ARTISAN', attributes: { intelligence: 4, wealth: 3, prestige: 4 } });
    expect(final.state.player.chains[0]).toMatchObject({ status: 'completed', next_due_year: null });
    expect(final.state.player.flags).toContain('workshop_complete');
    expect(final.state.player.achievements).toContain('A_PROJECT');
    const before = structuredClone(engine.exportSave());
    expect(engine.nextYear('1643')).toEqual(final);
    expect(engine.exportSave()).toEqual(before);
    const next = success(engine.nextYear('1644'));
    expect(next.state.player.attributes).toEqual(final.state.player.attributes);
    expect(next.state.player.flags.filter((flag) => flag === 'workshop_complete')).toHaveLength(1);
    expect(success(engine.retire('retire')).state.status).toBe('ENDED');
    expect(engine.generateEndingReport()).toMatchObject({ end_reason: 'retired', primary_achievement_id: 'A_PROJECT', years_played: 4 });
  });

  it('restores the unfinished chain and its exact receipts without rescheduling or rewarding twice', async () => {
    const bundle = await chainContent();
    const control = engineFor(bundle);
    choose(control, control.initGame({ seed: 1640 }));
    const first = success(control.nextYear('1641'));
    const saved = JSON.parse(JSON.stringify(control.exportSave()));
    const resumed = engineFor(bundle);
    resumed.restoreSave(saved);
    expect(resumed.nextYear('1641')).toEqual(first);
    expect(resumed.exportSave()).toEqual(saved);
    for (const year of ['1642', '1643', '1644']) expect(resumed.nextYear(year)).toEqual(control.nextYear(year));
    expect(resumed.exportSave()).toEqual(control.exportSave());
    expect(resumed.exportSave().payload.player.chains.filter((chain) => chain.status === 'completed')).toHaveLength(1);
    const final = JSON.parse(JSON.stringify(resumed.exportSave()));
    const again = engineFor(bundle);
    again.restoreSave(final);
    expect(again.exportSave()).toEqual(final);
    expect(again.nextYear('1644')).toEqual(control.nextYear('1644'));
    expect(again.exportSave()).toEqual(final);
  });

  it('waits for each explicit node stage before advancing the node cursor or granting completion', async () => {
    const bundle = await chainContent();
    bundle.chains[0]!.nodes = [{ after_years: 1, event_id: 'E_CHAIN_1' }];
    const first = choice('E_CHAIN_1', [], { kind: 'chain' }, 'S1');
    const makeStage = (id: string, next: string | null): Stage => ({
      id, text: id, check: { attribute: 'intelligence', dc: 14, modifier: 0 },
      success: outcome([{ type: 'attribute_add', attribute: 'intelligence', amount: 1 }], next),
      failure: outcome([{ type: 'attribute_add', attribute: 'intelligence', amount: 1 }], next),
    });
    first.stages = [makeStage('S1', 'S2'), makeStage('S2', null)];
    bundle.events = bundle.events.map((event) => event.id === first.id ? first : event);
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    const decision = success(engine.nextYear('1641'));
    expect(decision.pending).toMatchObject({ kind: 'option', event_id: 'E_CHAIN_1' });
    expect(decision.state.player.chains[0]).toMatchObject({ node_index: 0, status: 'active' });
    const firstStage = choose(engine, decision, 'node-choice');
    expect(firstStage.pending).toMatchObject({ kind: 'stage', stage_id: 'S1' });
    expect(firstStage.state.player.flags).not.toContain('workshop_complete');
    const secondStage = roll(engine, firstStage, 'roll1');
    expect(secondStage.pending).toMatchObject({ kind: 'stage', stage_id: 'S2' });
    expect(secondStage.state.player.chains[0]).toMatchObject({ node_index: 0, status: 'active' });
    expect(secondStage.state.player.attributes.intelligence).toBe(4);
    const complete = roll(engine, secondStage, 'roll2');
    expect(complete.pending).toBeNull();
    expect(complete.state.player).toMatchObject({ age: 10, calendar_year: 1641, attributes: { intelligence: 5 } });
    expect(complete.state.player.chains[0]).toMatchObject({ status: 'completed' });
    expect(complete.state.player.flags).toContain('workshop_complete');
  });
});

describe('chains: capacity preview and atomic resource effects', () => {
  it('allows distinct instances of one chain but locks a third before charging its cost', async () => {
    const bundle = await chainContent();
    configureOpening(bundle, [{ type: 'chain_start', id: 'CH_WORKSHOP' }, { type: 'chain_start', id: 'CH_WORKSHOP' }]);
    const third = choice('E_THIRD', [{ type: 'attribute_add', attribute: 'wealth', amount: -2 }, { type: 'chain_start', id: 'CH_WORKSHOP' }],
      { kind: 'historical', year: 1640, priority: 0 });
    if (third.interaction !== 'choice') throw new Error('Expected choice fixture');
    third.options.push({ id: 'wait', text: 'Wait', unavailable_text: 'Unavailable', risk: 'safe', outcome: outcome() });
    bundle.events.push(third);
    const engine = engineFor(bundle);
    const pending = choose(engine, engine.initGame({ seed: 0 }));
    expect(pending.state.player.chains).toHaveLength(2);
    expect(new Set(pending.state.player.chains.map((chain) => chain.instance_id)).size).toBe(2);
    if (pending.pending?.kind !== 'option') throw new Error('Expected third-chain choice');
    const locked = pending.pending.options.find((option) => option.id === 'start');
    expect(locked?.available).toBe(false);
    expect(locked?.reason).toEqual(expect.any(String));
    expect(locked?.reason).not.toBe('');
    expect(pending.pending.options.find((option) => option.id === 'wait')?.available).toBe(true);
    const before = structuredClone(engine.exportSave());
    error(engine.resolveOption('third', pending.pending.event_instance_id, 'start'), 'OPTION_UNAVAILABLE');
    expect(engine.exportSave()).toEqual(before);
    expect(choose(engine, pending, 'wait', 'wait').state.player.attributes.wealth).toBe(3);
  });

  it('uses capacity released by an earlier interrupting effect in the same atomic outcome', async () => {
    const bundle = await chainContent();
    bundle.rules.chains.max_active = 1;
    bundle.chains[0]!.interrupt_condition = { op: 'has', collection: 'flags', id: 'release_capacity' };
    const replacement: Chain = structuredClone(bundle.chains[0]!);
    replacement.id = 'CH_REPLACEMENT';
    delete replacement.interrupt_condition;
    replacement.completion = outcome([{ type: 'flag_add', id: 'replacement_complete' }]);
    bundle.chains.push(replacement);
    bundle.events.push(choice('E_REPLACE', [
      { type: 'attribute_add', attribute: 'wealth', amount: -1 },
      { type: 'flag_add', id: 'release_capacity' },
      { type: 'chain_start', id: 'CH_REPLACEMENT' },
    ], { kind: 'historical', year: 1640, priority: 0 }));
    const engine = engineFor(bundle);
    const replacementChoice = choose(engine, engine.initGame({ seed: 0 }));
    if (replacementChoice.pending?.kind !== 'option') throw new Error('Expected replacement choice');
    expect(replacementChoice.pending.options[0]!.available).toBe(true);
    const result = choose(engine, replacementChoice, 'replace');
    expect(result.state.player.attributes.wealth).toBe(1);
    expect(result.state.player.chains.map((chain) => [chain.chain_id, chain.status])).toEqual([
      ['CH_WORKSHOP', 'interrupted'], ['CH_REPLACEMENT', 'active'],
    ]);
  });

  it('immediately checks a newly registered chain against already-present interruption conditions', async () => {
    const bundle = await chainContent();
    configureOpening(bundle, [{ type: 'injury_add', id: 'INJ_SEVERE' }, { type: 'chain_start', id: 'CH_WORKSHOP' }]);
    const engine = engineFor(bundle);
    const started = choose(engine, engine.initGame({ seed: 0 }));
    expect(started.state.player.chains[0]).toMatchObject({ status: 'interrupted', next_due_year: null });
    expect(started.state.player.flags).not.toContain('workshop_complete');
    for (const year of [1641, 1642, 1643]) success(engine.nextYear(String(year)));
    expect(engine.exportSave().payload.player.attributes.intelligence).toBe(3);
    expect(engine.exportSave().payload.player.flags).not.toContain('workshop_complete');
  });
});

describe('chains: interruption on every relevant change', () => {
  const changes: { name: string; condition: Condition; effect: Effect }[] = [
    { name: 'attribute', condition: { op: 'compare', field: 'wealth', comparator: 'lte', value: 0 }, effect: { type: 'attribute_add', attribute: 'wealth', amount: -10 } },
    { name: 'flag', condition: { op: 'has', collection: 'flags', id: 'stop' }, effect: { type: 'flag_add', id: 'stop' } },
    { name: 'injury', condition: { op: 'has', collection: 'injuries', id: 'INJ_SEVERE' }, effect: { type: 'injury_add', id: 'INJ_SEVERE' } },
    { name: 'region', condition: { op: 'is', field: 'region_id', value: 'R_CAPITAL' }, effect: { type: 'region_set', id: 'R_CAPITAL' } },
    { name: 'identity', condition: { op: 'is', field: 'identity_id', value: 'I_REFUGEE' }, effect: { type: 'identity_set', id: 'I_REFUGEE' } },
    { name: 'flag removal', condition: { op: 'not', condition: { op: 'has', collection: 'flags', id: 'support' } }, effect: { type: 'flag_remove', id: 'support' } },
    { name: 'injury removal', condition: { op: 'not', condition: { op: 'has', collection: 'injuries', id: 'INJ_SEVERE' } }, effect: { type: 'injury_remove', id: 'INJ_SEVERE' } },
  ];

  it.each(changes)('interrupts after $name changes, without refunding committed cost', async ({ condition, effect }) => {
    const bundle = await chainContent();
    bundle.chains[0]!.interrupt_condition = condition;
    if (effect.type === 'flag_remove') for (const background of bundle.era.backgrounds) background.flags.push(effect.id);
    if (effect.type === 'injury_remove') configureOpening(bundle, [
      { type: 'attribute_add', attribute: 'wealth', amount: -1 },
      { type: 'injury_add', id: effect.id },
      { type: 'chain_start', id: 'CH_WORKSHOP' },
    ]);
    bundle.events.push(automatic('E_INTERRUPT', [effect], { kind: 'historical', year: 1640, priority: 0 }));
    const engine = engineFor(bundle);
    const initial = choose(engine, engine.initGame({ seed: 0 }));
    expect(initial.state.player.chains[0]).toMatchObject({ status: 'interrupted', next_due_year: null });
    expect(initial.state.player.chains[0]!.interruption_reason).toEqual(expect.any(String));
    expect(initial.state.player.attributes.wealth).toBe(effect.type === 'attribute_add' ? 0 : 2);
    for (const year of [1641, 1642, 1643]) success(engine.nextYear(String(year)));
    expect(engine.exportSave().payload.player.flags).not.toContain('workshop_complete');
    expect(engine.exportSave().payload.player.attributes.intelligence).toBe(3);
  });

  it('keeps the full current outcome but suppresses its next stage and final reward after interruption', async () => {
    const bundle = await chainContent();
    const last = eventById(bundle, 'E_CHAIN_3');
    if (last.interaction !== 'automatic') throw new Error('Expected automatic last node');
    last.outcome = outcome([
      { type: 'injury_add', id: 'INJ_SEVERE' }, { type: 'attribute_add', attribute: 'prestige', amount: 2 },
    ], 'S_FORBIDDEN');
    last.stages = [{
      id: 'S_FORBIDDEN', text: 'Must never enter', check: { attribute: 'intelligence', dc: 1, modifier: 0 },
      success: outcome([{ type: 'flag_add', id: 'bad_stage' }]), failure: outcome([{ type: 'flag_add', id: 'bad_stage' }]),
    }];
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    success(engine.nextYear('1641'));
    success(engine.nextYear('1642'));
    const final = success(engine.nextYear('1643'));
    expect(final).toMatchObject({ state: { status: 'READY' }, pending: null });
    expect(final.state.player.attributes.prestige).toBe(5);
    expect(final.state.player.injuries).toContain('INJ_SEVERE');
    expect(final.state.player.chains[0]).toMatchObject({ status: 'interrupted' });
    expect(final.state.player.flags).not.toContain('workshop_complete');
    expect(final.state.player.flags).not.toContain('bad_stage');
    expect(final.state.player.identity_id).toBe('I_DEPENDENT');
    expect(final.state.player.achievements).not.toContain('A_PROJECT');
    expect(engine.exportSave().payload.run.dice_results).toHaveLength(0);
  });

  it('records NO_AVAILABLE_OPTION and interrupts a locked chain node instead of leaving an impossible decision', async () => {
    const bundle = await chainContent();
    const locked = choice('E_CHAIN_1', [{ type: 'attribute_add', attribute: 'wealth', amount: 2 }], { kind: 'chain' });
    if (locked.interaction !== 'choice') throw new Error('Expected choice fixture');
    locked.options[0]!.condition = { op: 'compare', field: 'wealth', comparator: 'gt', value: 10 };
    bundle.events = bundle.events.map((event) => event.id === locked.id ? locked : event);
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    const first = success(engine.nextYear('1641'));
    expect(first).toMatchObject({ state: { status: 'READY' }, pending: null });
    expect(first.state.player.chains[0]).toMatchObject({ status: 'interrupted', interruption_reason: 'NO_AVAILABLE_OPTION' });
    expect(first.state.player.attributes.wealth).toBe(2);
    for (const year of [1642, 1643]) success(engine.nextYear(String(year)));
    expect(engine.exportSave().payload.player.flags).not.toContain('workshop_complete');
  });

  it('does not complete or grant rewards when a last-node outcome causes death', async () => {
    const bundle = await chainContent();
    automaticOutcome(bundle, 'E_CHAIN_3').effects = [{ type: 'death', id: 'D_CRISIS' }];
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    success(engine.nextYear('1641'));
    success(engine.nextYear('1642'));
    const final = success(engine.nextYear('1643'));
    expect(final.state.status).toBe('ENDED');
    expect(final.state.player.chains[0]!.status).not.toBe('completed');
    expect(final.state.player.flags).not.toContain('workshop_complete');
    expect(final.state.player.achievements).not.toContain('A_PROJECT');
    expect(engine.generateEndingReport()).toMatchObject({ death_id: 'D_CRISIS', primary_achievement_id: null, years_played: 3 });
  });
});

describe('chains: stable queue ordering and same-year effects', () => {
  it('orders same-due chains by descending priority, before history and random phases', async () => {
    const bundle = await chainContent();
    const base = bundle.chains[0]!;
    delete base.interrupt_condition;
    base.id = 'CH_LOW';
    base.priority = 0;
    base.nodes = [{ after_years: 1, event_id: 'E_LOW' }];
    base.completion = outcome([{ type: 'attribute_add', attribute: 'wealth', amount: -2 }]);
    const high: Chain = { ...structuredClone(base), id: 'CH_HIGH', priority: 10, nodes: [{ after_years: 1, event_id: 'E_HIGH' }], completion: outcome([{ type: 'attribute_add', attribute: 'wealth', amount: 100 }]) };
    bundle.chains.push(high);
    bundle.achievements = [];
    bundle.events = [
      automatic('E_LOW', [], { kind: 'chain' }), automatic('E_HIGH', [], { kind: 'chain' }),
      choice('E_START', [{ type: 'chain_start', id: 'CH_LOW' }, { type: 'chain_start', id: 'CH_HIGH' }], { kind: 'opening', weight: 1, trigger_probability: 1 }),
      automatic('E_HISTORY', [{ type: 'flag_add', id: 'history_after_chains' }], { kind: 'historical', year: 1641, priority: 0 }),
    ];
    bundle.events[3]!.condition = { op: 'all', conditions: [
      { op: 'has', collection: 'completed_chains', id: 'CH_HIGH' }, { op: 'has', collection: 'completed_chains', id: 'CH_LOW' },
    ] };
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    const result = success(engine.nextYear('1641'));
    expect(result.state.player.attributes.wealth).toBe(8);
    expect(result.state.player.flags).toContain('history_after_chains');
    expect(result.logs.filter((entry) => entry.type === 'event').map((entry) => entry.source_id)).toEqual(['E_HIGH', 'E_LOW', 'E_HISTORY']);
  });

  it('breaks equal due-year/priority ties by stable instance ID, not content array order', async () => {
    const bundle = await chainContent();
    const first = structuredClone(bundle.chains[0]!);
    delete first.interrupt_condition;
    first.id = 'CH_Z_FIRST';
    first.nodes = [{ after_years: 1, event_id: 'E_FIRST' }];
    first.completion = outcome([{ type: 'attribute_add', attribute: 'wealth', amount: 100 }]);
    const second = structuredClone(first);
    second.id = 'CH_A_SECOND';
    second.nodes = [{ after_years: 1, event_id: 'E_SECOND' }];
    second.completion = outcome([{ type: 'attribute_add', attribute: 'wealth', amount: -2 }]);
    bundle.chains = [second, first];
    bundle.achievements = [];
    bundle.events = [
      automatic('E_FIRST', [], { kind: 'chain' }), automatic('E_SECOND', [], { kind: 'chain' }),
      choice('E_START', [{ type: 'chain_start', id: first.id }, { type: 'chain_start', id: second.id }], { kind: 'opening', weight: 1, trigger_probability: 1 }),
    ];
    const engine = engineFor(bundle);
    const start = choose(engine, engine.initGame({ seed: 0 }));
    const ordered = [...start.state.player.chains].sort((left, right) => left.instance_id < right.instance_id ? -1 : left.instance_id > right.instance_id ? 1 : 0);
    const result = success(engine.nextYear('1641'));
    const expectedWealth = ordered[0]!.chain_id === first.id ? 8 : 10;
    expect(result.state.player.attributes.wealth).toBe(expectedWealth);
    const expectedEvents = ordered.map((chain) => chain.chain_id === first.id ? 'E_FIRST' : 'E_SECOND');
    expect(result.logs.filter((entry) => entry.type === 'event').map((entry) => entry.source_id)).toEqual(expectedEvents);
  });

  it('runs vital interruption before due nodes and skips a queued chain interrupted by an earlier chain', async () => {
    const bundle = await chainContent();
    bundle.rules.chains.max_active = 2;
    const first = bundle.chains[0]!;
    first.priority = 10;
    first.nodes = [{ after_years: 1, event_id: 'E_CHAIN_1' }];
    delete first.interrupt_condition;
    first.completion = outcome([{ type: 'flag_add', id: 'interrupt_other' }]);
    const other = structuredClone(first);
    other.id = 'CH_OTHER';
    other.priority = 0;
    other.nodes = [{ after_years: 1, event_id: 'E_CHAIN_2' }];
    other.interrupt_condition = { op: 'has', collection: 'flags', id: 'interrupt_other' };
    other.completion = outcome([{ type: 'flag_add', id: 'bad_completion' }]);
    bundle.chains.push(other);
    bundle.achievements = [];
    configureOpening(bundle, [{ type: 'chain_start', id: 'CH_WORKSHOP' }, { type: 'chain_start', id: 'CH_OTHER' }]);
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    const result = success(engine.nextYear('1641'));
    expect(result.state.player.attributes).toMatchObject({ intelligence: 4, wealth: 3 });
    expect(result.state.player.chains.map((chain) => chain.status)).toEqual(['completed', 'interrupted']);
    expect(result.state.player.flags).not.toContain('bad_completion');
    expect(result.logs.filter((entry) => entry.type === 'event').map((entry) => entry.source_id)).toEqual(['E_CHAIN_1']);
  });
});

describe('chains: completion and vital-phase boundaries', () => {
  it('marks the instance completed before completion effects can match its interrupt condition', async () => {
    const bundle = await chainContent();
    bundle.chains[0]!.interrupt_condition = { op: 'has', collection: 'flags', id: 'workshop_complete' };
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    for (const year of [1641, 1642]) success(engine.nextYear(String(year)));
    const final = success(engine.nextYear('1643'));
    expect(final.state.player.chains[0]).toMatchObject({ status: 'completed', next_due_year: null, interruption_reason: null });
    expect(final.state.player.flags).toContain('workshop_complete');
    expect(final.state.player.achievements).toContain('A_PROJECT');
    expect(final.state.player.identity_id).toBe('I_ARTISAN');
  });

  it('applies a vital attribute change and interrupts before executing an already-due node', async () => {
    const bundle = await chainContent();
    bundle.chains[0]!.interrupt_condition = { op: 'compare', field: 'physique', comparator: 'lte', value: 2 };
    configureOpening(bundle, [
      { type: 'attribute_add', attribute: 'wealth', amount: -1 },
      { type: 'injury_add', id: 'INJ_SEVERE' },
      { type: 'chain_start', id: 'CH_WORKSHOP' },
    ]);
    const engine = engineFor(bundle);
    const started = choose(engine, engine.initGame({ seed: 0 }));
    expect(started.state.player.chains[0]!.status).toBe('active');
    expect(started.state.player.attributes.physique).toBe(3);
    const next = success(engine.nextYear('1641'));
    expect(next.state.player.attributes).toMatchObject({ physique: 2, intelligence: 3, wealth: 2 });
    expect(next.state.player.chains[0]!.status).toBe('interrupted');
    expect(next.logs.some((entry) => entry.type === 'event' && entry.source_id === 'E_CHAIN_1')).toBe(false);
    expect(next.state.player.flags).not.toContain('workshop_complete');
  });

  it('checks lifespan before a final due chain node and never grants its completion reward', async () => {
    const bundle = await chainContent();
    bundle.rules.lifespan = { min: 12, max: 12, min_remaining_years: 3 };
    const engine = engineFor(bundle);
    choose(engine, engine.initGame({ seed: 0 }));
    success(engine.nextYear('1641'));
    success(engine.nextYear('1642'));
    const final = success(engine.nextYear('1643'));
    expect(final.state.status).toBe('ENDED');
    expect(final.state.player.chains[0]!.status).not.toBe('completed');
    expect(final.state.player.attributes.prestige).toBe(3);
    expect(final.state.player.flags).not.toContain('workshop_complete');
    expect(engine.generateEndingReport()).toMatchObject({ death_id: 'D_OLD_AGE', years_played: 3, primary_achievement_id: null });
  });
});
