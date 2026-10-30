import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { conditionContext, evaluateCondition } from '../../assets/scripts/core/engine/ConditionEvaluator.js';
import type { Chain, Condition, ContentBundle, Effect, Event } from '../../assets/scripts/core/types/content.generated.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';
import { mixedArchiveDirectory, templateDirectory } from '../helpers/content.js';

type Success = Extract<CommandResult, { ok: true }>;
const namespace = (id: string, owner: string) => id.toLowerCase().includes(`_${owner}_`);
function ok(result: CommandResult): Success {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}
function has(condition: Condition | undefined, collection: 'cards' | 'flags', id?: string): boolean {
  if (!condition) return false;
  if (condition.op === 'all' || condition.op === 'any') return condition.conditions.some(child => has(child, collection, id));
  return condition.op === 'has' && condition.collection === collection && (id === undefined || condition.id === id);
}
function choose(engine: GameEngine, result: Success, id: string): Success {
  if (result.pending?.kind !== 'option') throw new Error('Expected option decision');
  return ok(engine.resolveOption(`choose:${result.state.revision}`, result.pending.event_instance_id, id));
}
function roll(engine: GameEngine, result: Success): Success {
  if (result.pending?.kind !== 'stage') throw new Error('Expected stage decision');
  const next = ok(engine.resolveStage(`roll:${result.state.revision}`, result.pending.event_instance_id, result.pending.stage_id));
  const dice = next.logs.filter(entry => entry.type === 'dice');
  expect(dice).toHaveLength(1);
  expect(dice[0]!.data.raw).toBeGreaterThanOrEqual(1);
  expect(dice[0]!.data.raw).toBeLessThanOrEqual(20);
  return next;
}
function passed(result: Success): boolean {
  const dice = result.logs.find(entry => entry.type === 'dice');
  if (!dice || dice.type !== 'dice') throw new Error('Missing real D20 result');
  return dice.data.success;
}

// Only opening inputs and event selection are controlled. Authored event triggers,
// conditions, options, stages, DCs, effects, achievements and chains stay intact.
function controlled(source: ContentBundle, events: Event[], year = source.era.start_year): ContentBundle {
  const bundle = structuredClone(source);
  bundle.events = structuredClone(events);
  bundle.era.start_year = year;
  bundle.rules.age_bands = [{ id: 'test-adult', min: 20, max: 20, weight: 1, modifiers: {} }];
  bundle.rules.lifespan = { min: 80, max: 80, min_remaining_years: 3 };
  bundle.rules.opening.year_min = year;
  bundle.rules.opening.year_max = year;
  bundle.rules.events = { per_year: 1, automatic_ratio: 0.6 };
  for (const item of [...bundle.regions, ...bundle.castes, ...bundle.era.backgrounds]) {
    item.modifiers = {};
    item.flags = [];
  }
  // Select authored region/caste prerequisites without rewriting event conditions.
  const prerequisites = (condition: Condition | undefined): void => {
    if (!condition) return;
    if (condition.op === 'all') {
      for (const child of condition.conditions) prerequisites(child);
    } else if (condition.op === 'is' && condition.field === 'region_id') {
      for (const region of bundle.regions) region.weight = region.id === condition.value ? 1 : 0;
    } else if (condition.op === 'is' && condition.field === 'caste_id') {
      for (const caste of bundle.castes) caste.weight = caste.id === condition.value ? 1 : 0;
    }
  };
  for (const event of events) prerequisites(event.condition);
  return bundle;
}
function atEvent(source: ContentBundle, event: Event, seed: number, requiredCard?: Condition, companions: Event[] = []) {
  const year = event.trigger.kind === 'historical' ? event.trigger.year : source.era.start_year;
  const bundle = controlled(source, [event, ...companions], year);
  const cardGate = (condition: Condition | undefined): string | undefined => {
    if (condition?.op === 'has' && condition.collection === 'cards') return condition.id;
    if (condition?.op === 'all' || condition?.op === 'any') return condition.conditions.map(cardGate).find(Boolean);
    return undefined;
  };
  const card = cardGate(requiredCard) ?? cardGate(event.condition);
  if (card) {
    const pool = bundle.pools.find(item => item.id === bundle.rules.opening.pool_id)!;
    for (const entry of pool.entries) entry.weight = entry.card_id === card ? 1 : 0;
  }
  const engine = new GameEngine(bundle, 'b'.repeat(64));
  const result = ok(engine.initGame({ seed }));
  return { engine, result, bundle };
}
async function production() {
  // Deliberately bypass loadTemplate: that helper owns the original mechanism fixture.
  return (await loadContent(templateDirectory)).bundle;
}
async function archivedMixed() {
  const directory = await mkdtemp(join(tmpdir(), 'ming-end-mixed-current-schema-'));
  try {
    await cp(mixedArchiveDirectory, directory, { recursive: true });
    const manifestPath = join(directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ContentBundle['manifest'];
    manifest.schema_version = 3;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const achievementsPath = join(directory, manifest.files.achievements);
    const achievements = JSON.parse(await readFile(achievementsPath, 'utf8')) as Array<Record<string, unknown>>;
    for (const achievement of achievements) delete achievement.retirable;
    await writeFile(achievementsPath, JSON.stringify(achievements));
    return (await loadContent(directory)).bundle;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it('loads and initializes the native package without modern references or an archive pool', async () => {
  const source = await production();
  expect(JSON.stringify(source)).not.toMatch(/CARD_MOD_|POOL_MODERN_|CH_LIGHTER_|E_LG_|A_LIGHTER_|I_FIRE_OFFICER|I_STREET_MAGICIAN/);
  const pool = source.pools.find(item => item.id === source.rules.opening.pool_id);
  expect(pool).toBeDefined();
  expect(pool!.entries.length).toBeGreaterThan(0);
  expect(pool!.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBeGreaterThan(0);
  for (let seed = 0; seed < 16; seed++) {
    const engine = new GameEngine(source, '1'.repeat(64));
    const result = ok(engine.initGame({ seed }));
    expect(result.state.player.cards).toHaveLength(1);
    expect(source.cards.some(card => card.id === result.state.player.cards[0])).toBe(true);
    expect(pool!.entries.some(entry => entry.card_id === result.state.player.cards[0] && entry.weight > 0)).toBe(true);
  }
});

describe('production ming_end: automatic minor encounters', () => {
  it.each(['E_HIST_1641_LUOYANG', 'E_LIFE_Y_BORROW_GRAIN', 'E_LIFE_Y_CARAVAN_GUARD'])('resolves %s without options, with both real outcomes and identical save replay', async id => {
    const source = structuredClone(await production());
    source.rules.attributes.base = 5;
    const event = source.events.find(event => event.id === id)!;
    if (event.interaction !== 'automatic') throw new Error('Minor encounter must be automatic');
    const seen = new Set<boolean>();
    for (let seed = 0; seed < 128 && seen.size < 2; seed++) {
      const { engine, result, bundle } = atEvent(source, event, seed);
      if (!result.pending) continue;
      expect(result.pending).toMatchObject({ kind: 'stage', event_id: id });
      if (result.pending.kind !== 'stage') throw new Error('Minor encounter paused for options');
      const pending = result.pending;
      const stage = event.stages!.find(stage => stage.id === pending.stage_id)!;
      const restored = new GameEngine(bundle, 'b'.repeat(64));
      restored.restoreSave(JSON.parse(JSON.stringify(engine.exportSave())));
      const command = `roll:${result.state.revision}`;
      const next = roll(engine, result);
      expect(restored.resolveStage(command, pending.event_instance_id, pending.stage_id)).toEqual(next);
      expect(restored.exportSave()).toEqual(engine.exportSave());
      const success = passed(next);
      seen.add(success);
      const expected = structuredClone(result.state.player.attributes);
      for (const effect of (success ? stage.success : stage.failure).effects) {
        if (effect.type === 'attribute_add') expected[effect.attribute] = Math.max(bundle.rules.attributes.min, Math.min(bundle.rules.attributes.max, expected[effect.attribute] + effect.amount));
      }
      expect(next.state.player.attributes).toEqual(expected);
      expect(next.pending).toBeNull();
      expect(next.state.status).not.toBe('ENDED');
      expect(next.state.player.chains).toEqual(result.state.player.chains);
      expect(next.state.player.identity_id).toBe(result.state.player.identity_id);
      expect(engine.exportSave().payload.logs.some(entry => entry.type === 'option')).toBe(false);
    }
    expect([...seen].sort()).toEqual([false, true]);
  });

  it('uses actual capability and preserves natural one and twenty', async () => {
    const low = structuredClone(await production());
    low.rules.attributes.base = 2;
    const high = structuredClone(low);
    high.rules.attributes.base = 10;
    const event = low.events.find(item => item.id === 'E_HIST_1641_LUOYANG')!;
    const seen = new Set<string>();
    for (let seed = 0; seed < 512 && seen.size < 3; seed++) {
      const weak = atEvent(low, event, seed);
      const strong = atEvent(high, event, seed);
      const weakRoll = roll(weak.engine, weak.result);
      const strongRoll = roll(strong.engine, strong.result);
      const a = weak.engine.exportSave().payload.run.dice_results[0]!;
      const b = strong.engine.exportSave().payload.run.dice_results[0]!;
      const check = event.stages![0]!.check;
      expect(a.raw).toBe(b.raw);
      expect(a.attribute_value).toBe(2);
      expect(b.attribute_value).toBe(10);
      expect(passed(weakRoll)).toBe(a.raw === 20 || (a.raw !== 1 && a.raw + 2 + check.modifier >= check.dc));
      expect(passed(strongRoll)).toBe(b.raw === 20 || (b.raw !== 1 && b.raw + 10 + check.modifier >= check.dc));
      if (a.raw === 1) seen.add('natural-one');
      if (a.raw === 20) seen.add('natural-twenty');
      if (!passed(weakRoll) && passed(strongRoll)) seen.add('capability-matters');
    }
    expect([...seen].sort()).toEqual(['capability-matters', 'natural-one', 'natural-twenty']);
  });
});

describe('production ming_end: GPT event consequences through GameEngine', () => {
  it('requires two real D20 successes for the unique micro-operation achievement', async () => {
    const bundle = await production();
    const candidates = bundle.events.filter(event => namespace(event.id, 'gpt') && event.interaction === 'automatic' && event.stages?.some(stage => stage.success.next_stage_id !== null));
    expect(candidates.length).toBeGreaterThan(0);
    for (const event of candidates) {
    const firstStages = event.stages!.filter(stage => stage.success.next_stage_id !== null);
    expect(firstStages, event.id).toHaveLength(1);
    const first = firstStages[0]!;
    const second = event.stages!.find(stage => stage.id === first.success.next_stage_id)!;
    const seen = new Set<string>();
    let rewarded: string[] = [];
    const failedAchievements: string[][] = [];
    for (let seed = 0; seed < 2048 && seen.size < 3; seed++) {
      const { engine, result } = atEvent(bundle, event, seed);
      if (!result.pending) continue;
      expect(result.pending.kind).toBe('stage');
      const initial = result.state.player.achievements;
      const one = roll(engine, result);
      expect(one.state.player.achievements).toEqual(initial);
      if (!passed(one)) {
        expect(one.pending).toBeNull();
        failedAchievements.push(one.state.player.achievements);
        seen.add('first-failure');
        continue;
      }
      expect(one.pending).toMatchObject({ kind: 'stage', stage_id: second.id });
      const two = roll(engine, one);
      expect(engine.exportSave().payload.run.dice_results).toHaveLength(2);
      if (passed(two)) {
        rewarded = two.state.player.achievements.filter(id => !initial.includes(id));
        expect(rewarded.length).toBeGreaterThan(0);
        expect(rewarded.some(id => namespace(id, 'gpt'))).toBe(true);
        seen.add('both-success');
      } else {
        expect(two.state.player.achievements).toEqual(initial);
        failedAchievements.push(two.state.player.achievements);
        seen.add('second-failure');
      }
    }
    expect([...seen].sort()).toEqual(['both-success', 'first-failure', 'second-failure']);
    for (const achievements of failedAchievements) for (const id of rewarded) expect(achievements).not.toContain(id);
    }
  });
});

function chainScenario(source: ContentBundle, chain: Chain, histories: Event[]) {
  if (histories.some(history => history.trigger.kind !== 'historical')) throw new Error('Expected historical events');
  const opening = source.events.find(event => event.id === `E_${chain.id.slice(3)}_start`);
  if (!opening) throw new Error(`Missing native starter for ${chain.id}`);
  const nodes = chain.nodes.map(node => {
    const event = source.events.find(item => item.id === node.event_id);
    if (!event) throw new Error(`Missing chain node ${node.event_id}`);
    return event;
  });
  const bundle = controlled(source, [opening, ...nodes, ...histories]);
  for (const caste of bundle.castes) caste.weight = caste.id === 'C_SOLDIER' ? 1 : 0;
  bundle.rules.events.per_year = 1;
  return bundle;
}

describe('production ming_end: GM chains and historical consequences', () => {
  it('earns mutually exclusive automatic history only through completed real three-year work', async () => {
    const source = await production();
    const chains = source.chains.filter(chain => namespace(chain.id, 'gm'));
    expect(chains).toHaveLength(3);
    for (const chain of chains) {
      expect(chain.nodes.map(node => node.after_years)).toEqual([1, 2, 3]);
      const done = chain.completion.effects.find((effect): effect is Extract<Effect, { type: 'flag_add' | 'flag_remove' }> => effect.type === 'flag_add')!;
      const historyId = chain.id === 'CH_gm_water' ? 'E_gm_history_plague' : chain.id === 'CH_gm_fort' ? 'E_gm_history_rebels' : 'E_gm_history_pass';
      const histories = source.events.filter(event => event.id === historyId || event.id === `${historyId}_earned`);
      expect(histories, chain.id).toHaveLength(2);
      expect(histories.every(event => event.interaction === 'automatic')).toBe(true);
      const special = histories.find(event => event.interaction === 'automatic' && event.outcome.effects.some(effect => effect.type === 'attribute_add' && effect.attribute === 'prestige' && effect.amount === 2))!;
      const ordinary = histories.find(event => event.id !== special.id)!;
      if (special.trigger.kind !== 'historical') throw new Error('Missing historical date');
      const historyYear = special.trigger.year;
      const absentBundle = controlled(source, histories, historyYear);
      const absent = new GameEngine(absentBundle, 'c'.repeat(64));
      const initial = ok(absent.initGame({ seed: 0 }));
      expect(initial.pending).toBeNull();
      expect(initial.logs.filter(entry => entry.type === 'event').map(entry => entry.source_id)).toEqual([ordinary.id]);
      expect(initial.state.player.flags).not.toContain('F_gm_history_saved');
      expect(initial.state.player.achievements).not.toContain('A_gm_history');

      const bundle = chainScenario(source, chain, histories);
      const starter = bundle.events.find(event => event.interaction === 'choice' && event.options.some(option => option.outcome.effects.some(effect => effect.type === 'chain_start' && effect.id === chain.id)));
      if (starter?.interaction !== 'choice') throw new Error('Missing historical career entry');
      const startOption = starter.options.find(option => option.outcome.effects.some(effect => effect.type === 'chain_start' && effect.id === chain.id))!.id;
      const abandoned = new GameEngine(bundle, 'c'.repeat(64));
      let abandonedResult = choose(abandoned, ok(abandoned.initGame({ seed: 0 })), startOption);
      abandonedResult = ok(abandoned.nextYear('learn'));
      while (abandonedResult.pending?.kind === 'stage') abandonedResult = roll(abandoned, abandonedResult);
      const earned = structuredClone(abandonedResult.state.player.attributes);
      abandonedResult = ok(abandoned.abandonChain('leave', abandonedResult.state.player.chains[0]!.instance_id));
      expect(abandonedResult.state.player.attributes).toEqual(earned);
      expect(abandonedResult.state.player.flags).not.toContain(done.id);
      while (abandonedResult.state.player.calendar_year < historyYear) abandonedResult = ok(abandoned.nextYear(`abandoned:${abandonedResult.state.player.calendar_year}`));
      expect(abandonedResult.pending).toBeNull();
      expect(abandonedResult.state.player.attributes).toEqual(earned);
      expect(abandoned.exportSave().payload.logs.filter(entry => entry.type === 'event' && histories.some(event => event.id === entry.source_id)).map(entry => entry.source_id)).toEqual([ordinary.id]);
      const seen = new Set<string>();
      for (let seed = 0; seed < 2048 && seen.size < 2; seed++) {
        const engine = new GameEngine(bundle, 'c'.repeat(64));
        let result = choose(engine, ok(engine.initGame({ seed })), startOption);
        const startYear = result.state.player.calendar_year;
        for (let index = 0; index < 3; index++) {
          result = ok(engine.nextYear(`year:${index}`));
          expect(result.state.player.calendar_year).toBe(startYear + index + 1);
          expect(result.logs.some(entry => entry.type === 'event' && entry.source_id === chain.nodes[index]!.event_id)).toBe(true);
          expect(result.state.player.flags).not.toContain(done.id);
          if (index < 2) {
            expect(result.pending?.kind).toBe('stage');
            result = roll(engine, result);
            expect(result.pending).toBeNull();
            expect(result.logs.some(entry => entry.type === 'option')).toBe(false);
          } else {
            if (result.pending?.kind === 'option') result = choose(engine, result, 'qualify');
            expect(result.pending?.kind).toBe('stage');
            result = roll(engine, result);
          }
        }
        const success = result.state.player.chains[0]!.status === 'completed';
        expect(result.state.player.chains[0]).toMatchObject({ status: success ? 'completed' : 'interrupted', next_due_year: null });
        expect(result.state.player.flags.includes(done.id)).toBe(success);
        expect(engine.exportSave().payload.run.dice_results.some(dice => dice.success === success)).toBe(true);
        const prestige = result.state.player.attributes.prestige;
        while (result.state.player.calendar_year < historyYear) result = ok(engine.nextYear(`history:${result.state.player.calendar_year}`));
        expect(result.pending).toBeNull();
        const historyLogs = engine.exportSave().payload.logs.filter(entry => entry.type === 'event' && histories.some(event => event.id === entry.source_id));
        expect(historyLogs.map(entry => entry.source_id)).toEqual([success ? special.id : ordinary.id]);
        expect(result.state.player.attributes.prestige).toBe(Math.min(bundle.rules.attributes.max, prestige + (success ? 2 : 0)));
        if (chain.id === 'CH_gm_arms') {
          expect(result.state.player.flags.includes('F_gm_history_saved')).toBe(success);
          expect(result.state.player.achievements.includes('A_gm_history')).toBe(success);
        }
        seen.add(success ? 'success' : 'failure');
      }
      expect([...seen].sort(), chain.id).toEqual(['failure', 'success']);
    }
  });
});

describe('production ming_end: actual encounter mix and save continuation', () => {
  it.each(['normal', 'cautious', 'risky', 'development'] as const)('limits every completed %s life to one through five choices', async strategy => {
    const bundle = await production();
    const registry = new Map(bundle.events.map(event => [event.id, event]));
    let automatic = 0;
    let total = 0;
    let choicesSeen = 0;
    let optionLogs = 0;
    for (let seed = 0; seed < 6; seed++) {
      const demographic = structuredClone(bundle);
      const age = [6, 30, 70][seed % 3]!;
      demographic.rules.age_bands = [{ id: 'lifetime-sample', min: age, max: age, weight: 1, modifiers: {} }];
      for (const [index, region] of demographic.regions.entries()) region.weight = index === seed % demographic.regions.length ? 1 : 0;
      for (const [index, caste] of demographic.castes.entries()) caste.weight = index === seed % demographic.castes.length ? 1 : 0;
      const engine = new GameEngine(demographic, 'd'.repeat(64));
      let result = ok(engine.initGame({ seed }));
      expect(result.state.player.cards).toHaveLength(1);
      let commands = 0;
      let lifetimeChoices = 0;
      while (result.state.status !== 'ENDED' && commands < 2048) {
        commands++;
        if (result.pending?.kind === 'option') {
          choicesSeen++;
          lifetimeChoices++;
          const available = result.pending.options.filter(option => option.available);
          expect(available.length, result.pending.event_id).toBeGreaterThan(0);
          const event = registry.get(result.pending.event_id);
          if (event?.interaction !== 'choice') throw new Error('Missing production choice');
          const legal = event.options.filter(option => available.some(item => item.id === option.id));
          const preferred = strategy === 'development'
            ? legal.find(option => option.outcome.effects.some(effect => effect.type === 'chain_start'))
            : strategy === 'normal' ? legal[0]
              : legal.find(option => option.risk === (strategy === 'cautious' ? 'safe' : 'high'));
          result = choose(engine, result, preferred?.id ?? legal[0]!.id);
        } else if (result.pending?.kind === 'stage') {
          result = roll(engine, result);
        } else {
          result = ok(engine.nextYear(`year:${result.state.revision}`));
        }
      }
      expect(result.state.status, `Unfinished production seed ${seed}`).toBe('ENDED');
      expect(lifetimeChoices, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(lifetimeChoices, `seed ${seed}`).toBeLessThanOrEqual(5);
      expect(result.state.player.chains.length, `seed ${seed}`).toBeLessThanOrEqual(2);
      const save = engine.exportSave();
      const encountered = save.payload.logs.filter(entry => entry.type === 'event');
      expect(encountered.length).toBe(Object.values(save.payload.run.event_counts).reduce((sum, count) => sum + count, 0));
      optionLogs += save.payload.logs.filter(entry => entry.type === 'option').length;
      for (const entry of encountered) {
        const event = registry.get(entry.source_id);
        expect(event).toBeDefined();
        total++;
        if (event!.interaction === 'automatic') automatic++;
      }
    }
    expect(optionLogs).toBe(choicesSeen);
    expect(optionLogs).toBe(total - automatic);
    // Stages are real dice, not user choices; no encounter-ratio quota applies.
  });

  it('restores real production decisions and stages with identical future dice and command receipts', async () => {
    const bundle = await production();
    const seen = new Set<string>();
    for (let seed = 0; seed < 256 && seen.size < 2; seed++) {
      const engine = new GameEngine(bundle, 'e'.repeat(64));
      let result = ok(engine.initGame({ seed }));
      for (let step = 0; step < 256 && result.state.status !== 'ENDED' && seen.size < 2; step++) {
        if (!result.pending) {
          result = ok(engine.nextYear(`year:${result.state.revision}`));
          continue;
        }
        const pending = result.pending;
        const restored = new GameEngine(bundle, 'e'.repeat(64));
        restored.restoreSave(JSON.parse(JSON.stringify(engine.exportSave())));
        expect(restored.current()).toEqual(engine.current());
        const command = `resume:${result.state.revision}`;
        if (pending.kind === 'option') {
          const event = bundle.events.find(item => item.id === pending.event_id);
          if (event?.interaction !== 'choice') throw new Error('Missing production choice');
          const legal = event.options.filter(option => pending.options.some(item => item.id === option.id && item.available));
          expect(legal.length).toBeGreaterThan(0);
          const option = legal.find(item => item.outcome.next_stage_id !== null) ?? legal[0]!;
          result = ok(engine.resolveOption(command, pending.event_instance_id, option.id));
          expect(restored.resolveOption(command, pending.event_instance_id, option.id)).toEqual(result);
          expect(restored.resolveOption(command, pending.event_instance_id, option.id)).toEqual(result);
        } else {
          result = ok(engine.resolveStage(command, pending.event_instance_id, pending.stage_id));
          expect(restored.resolveStage(command, pending.event_instance_id, pending.stage_id)).toEqual(result);
          expect(restored.resolveStage(command, pending.event_instance_id, pending.stage_id)).toEqual(result);
          expect(result.logs.some(entry => entry.type === 'dice')).toBe(true);
        }
        expect(restored.exportSave()).toEqual(engine.exportSave());
        seen.add(pending.kind);
      }
    }
    expect([...seen].sort()).toEqual(['option', 'stage']);
  });
});

describe('archived mixed ming_end: twelve modern physical cards', () => {
  it('gates both reactions by the actual card, retains normal paths, and grants only one success or setback', async () => {
    const source = await archivedMixed();
    const cards = source.cards.filter(card => card.id.startsWith('CARD_MOD_'));
    expect(cards).toHaveLength(12);
    for (const card of cards) {
      const suffix = card.id.slice('CARD_MOD_'.length);
      const reactions = ['HISTORY', 'LIFE'].map(kind => {
        const event = source.events.find(item => item.id === `E_MOD_${suffix}_${kind}`);
        if (event?.interaction !== 'choice') throw new Error(`Missing reaction for ${card.id}: ${kind}`);
        return event;
      });
      const history = reactions[0]!;
      const seen = new Set<string>();
      for (let seed = 0; seed < 512 && seen.size < 2; seed++) {
        const { engine, result, bundle } = atEvent(source, history, seed, undefined, [reactions[1]!]);
        if (result.pending?.kind !== 'option' || result.pending.event_id !== history.id) continue;
        expect(result.state.player.cards).toEqual([card.id]);
        const initialContext = conditionContext(result.state.player, result.state.timeline);
        for (const reaction of reactions) {
          expect(has(reaction.condition, 'cards', card.id), reaction.id).toBe(true);
          expect(evaluateCondition(reaction.condition, { ...initialContext, cards: [] })).toBe(false);
          const normal = reaction.options.find(option => !option.condition && option.risk === 'safe');
          expect(normal, reaction.id).toBeDefined();
        }
        const normal = history.options.find(option => !option.condition && option.risk === 'safe')!;
        const safeEngine = new GameEngine(bundle, 'b'.repeat(64));
        safeEngine.restoreSave(JSON.parse(JSON.stringify(engine.exportSave())));
        const safe = choose(safeEngine, result, normal.id);
        expect(safe.state.status).not.toBe('ENDED');
        expect(safe.state.player.flags).not.toContain(`F_MOD_${suffix}_SUCCESS`);
        expect(safe.state.player.flags).not.toContain(`F_MOD_${suffix}_SETBACK`);
        expect(safe.pending).toMatchObject({ kind: 'option', event_id: reactions[1]!.id });
        const companionSafe = reactions[1]!.options.find(option => !option.condition && option.risk === 'safe')!;
        const safeFinished = choose(safeEngine, safe, companionSafe.id);
        expect(safeFinished.state.status).toBe('READY');
        expect(safeFinished.state.player.achievements.filter(id => id.startsWith(`A_MOD_${suffix}_`))).toEqual([]);
        const item = history.options.find(option => option.outcome.next_stage_id !== null);
        expect(item).toBeDefined();
        expect(result.pending.options.find(option => option.id === item!.id)?.available).toBe(true);
        let resolved = choose(engine, result, item!.id);
        expect(resolved.pending?.kind).toBe('stage');
        let rolls = 0;
        while (resolved.pending?.kind === 'stage' && rolls < 8) {
          resolved = roll(engine, resolved);
          rolls++;
        }
        expect(resolved.pending?.kind).not.toBe('stage');
        expect(rolls).toBeGreaterThan(0);
        const outcomes = ['SUCCESS', 'SETBACK'].filter(outcome => resolved.state.player.flags.includes(`F_MOD_${suffix}_${outcome}`));
        expect(outcomes).toHaveLength(1);
        const outcome = outcomes[0]!;
        if (suffix === 'LIGHTER' && outcome === 'SETBACK') {
          expect(resolved.state.player.flags).toContain('F_LIGHTER_EMPTY');
        }
        expect(resolved.state.player.achievements).toContain(`A_MOD_${suffix}_${outcome}`);
        expect(resolved.state.player.achievements.filter(id => id.startsWith(`A_MOD_${suffix}_`))).toHaveLength(1);
        expect(resolved.state.player.cards).toEqual([card.id]);
        const context = conditionContext(resolved.state.player, resolved.state.timeline);
        for (const reaction of reactions) {
          const attempt = reaction.options.find(option => option.outcome.next_stage_id !== null)!;
          expect(evaluateCondition(attempt.condition, context), `${reaction.id}: ${outcome} must block a second reward`).toBe(false);
          const fallback = reaction.options.find(option => !option.condition && option.risk === 'safe')!;
          expect(evaluateCondition(fallback.condition, context)).toBe(true);
        }
        expect(resolved.state.status).toBe('READY');
        expect(engine.exportSave().payload.run.event_counts[reactions[1]!.id] ?? 0).toBe(0);
        const followingYear = ok(engine.nextYear(`after-reaction:${resolved.state.revision}`));
        expect(followingYear.pending).toBeNull();
        expect(engine.exportSave().payload.run.event_counts[reactions[1]!.id] ?? 0).toBe(0);
        expect(followingYear.state.player.achievements.filter(id => id.startsWith(`A_MOD_${suffix}_`))).toEqual([`A_MOD_${suffix}_${outcome}`]);
        expect(followingYear.state.status).toBe('READY');
        let finalYear = followingYear;
        for (let years = 0; years < 100 && finalYear.state.status !== 'ENDED'; years++) {
          finalYear = ok(engine.nextYear(`until-death:${finalYear.state.revision}`));
        }
        expect(finalYear.state.status).toBe('ENDED');
        expect(finalYear.state.player.achievements).toContain(`A_MOD_${suffix}_${outcome}`);
        expect(engine.generateEndingReport()).toMatchObject({ end_reason: 'death', death_id: expect.any(String) });
        seen.add(outcome);
      }
      expect([...seen].sort(), card.id).toEqual(['SETBACK', 'SUCCESS']);
    }
  });
});

describe('production ming_end: age, possessions and court chronology', () => {
  it('in the archive resolves the long-flame gamble before interrupting its active court chain', async () => {
    const source = await archivedMixed();
    const chain = source.chains.find(item => item.id === 'CH_LIGHTER_ABSURD')!;
    const opening = source.events.find(item => item.id === 'E_LG_CROSSROAD')!;
    const nodes = chain.nodes.map(node => source.events.find(item => item.id === node.event_id)!);
    const seen = new Set<boolean>();
    for (let seed = 0; seed < 256 && seen.size < 2; seed++) {
      const { engine, result } = atEvent(source, opening, seed, undefined, nodes);
      if (result.pending?.kind !== 'option' || result.pending.event_id !== opening.id) continue;
      let next = choose(engine, result, 'opt_lg_absurd');
      next = ok(engine.nextYear(`court:${next.state.revision}`));
      expect(next.pending).toMatchObject({ kind: 'option', event_id: 'E_LG_ABSURD_1' });
      next = choose(engine, next, 'opt_burn_long');
      expect(next.pending).toMatchObject({ kind: 'stage', stage_id: 'S_LG_EXPOSED' });
      expect(next.state.player.flags).not.toContain('F_LIGHTER_EXPOSED');
      next = roll(engine, next);
      const success = passed(next);
      seen.add(success);
      if (success) {
        expect(next.state.status).not.toBe('ENDED');
        next = ok(engine.nextYear(`coronation:${next.state.revision}`));
        expect(next.state.player.flags).toContain('F_LIGHTER_ABSURD_DONE');
      } else {
        expect(next.state.player.flags).toContain('F_LIGHTER_EXPOSED');
        expect(engine.generateEndingReport()).toMatchObject({ death_id: 'D_LIGHTER_EXPOSED' });
      }
    }
    expect(seen.size).toBe(2);
  });

  it('never schedules childhood life events for elders or adult life events for children', async () => {
    const source = await production();
    for (const age of [5, 70]) {
      const events = source.events.filter(event => /^E_LIFE_[CYMS]_/.test(event.id));
      const bundle = controlled(source, events);
      bundle.rules.age_bands = [{ id: 'fixed-age', min: age, max: age, weight: 1, modifiers: {} }];
      for (let seed = 0; seed < 32; seed++) {
        const engine = new GameEngine(bundle, 'a'.repeat(64));
        const result = ok(engine.initGame({ seed }));
        for (const entry of engine.exportSave().payload.logs.filter(log => log.type === 'event')) {
          expect(entry.source_id.startsWith(age === 5 ? 'E_LIFE_C_' : 'E_LIFE_S_')).toBe(true);
        }
        if (result.pending?.kind === 'option') expect(result.pending.options.some(option => option.available)).toBe(true);
      }
    }
  });

  it('in the archive blocks court starts after 1641 while retaining ordinary lighter livelihoods', async () => {
    const source = await archivedMixed();
    const event = source.events.find(item => item.id === 'E_LG_CROSSROAD')!;
    for (const year of [1642, 1644, 1650]) {
      const bundle = structuredClone(source);
      bundle.era.start_year = year;
      let encountered = false;
      for (let seed = 0; seed < 64 && !encountered; seed++) {
        const { result } = atEvent(bundle, event, seed);
        if (result.pending?.kind !== 'option') continue;
        for (const id of ['opt_lg_legend', 'opt_lg_absurd']) expect(result.pending.options.find(option => option.id === id)?.available).toBe(false);
        for (const id of ['opt_lg_peace', 'opt_lg_comedy']) expect(result.pending.options.find(option => option.id === id)?.available).toBe(true);
        encountered = true;
      }
      expect(encountered).toBe(true);
    }
  });
});

describe('production ming_end: possession and historical access', () => {
  it('in the archive finishes sale and final performance rewards before disabling further lighter use', async () => {
    const source = await archivedMixed();
    const crossroad = source.events.find(event => event.id === 'E_LG_CROSSROAD')!;
    for (const [option, chainId, flag, done] of [
      ['opt_lg_peace', 'CH_LIGHTER_PEACE', 'F_LIGHTER_SOLD', 'F_LIGHTER_PEACEFUL_DONE'],
      ['opt_lg_comedy', 'CH_LIGHTER_COMEDY', 'F_LIGHTER_EMPTY', 'F_LIGHTER_COMEDY_DONE'],
      ['opt_lg_gang', '', 'F_LIGHTER_LOST', ''],
    ]) {
      const chain = source.chains.find(item => item.id === chainId);
      const nodes = chain?.nodes.map(node => source.events.find(event => event.id === node.event_id)!) ?? [];
      let exercised = false;
      for (let seed = 0; seed < 256 && !exercised; seed++) {
        const { engine, result } = atEvent(source, crossroad, seed, undefined, nodes);
        if (result.pending?.kind !== 'option') continue;
        let next = choose(engine, result, option!);
        if (next.pending?.kind === 'stage') {
          next = roll(engine, next);
          if (!passed(next)) continue;
        } else next = ok(engine.nextYear(`finish:${next.state.revision}`));
        expect(next.state.player.flags).toContain(flag);
        if (done) expect(next.state.player.flags).toContain(done);
        expect(next.state.player.cards).toContain('CARD_MOD_LIGHTER');
        const context = conditionContext(next.state.player, next.state.timeline);
        for (const event of source.events) {
          if (has(event.condition, 'cards', 'CARD_MOD_LIGHTER')) expect(evaluateCondition(event.condition, context), event.id).toBe(false);
          if (event.interaction === 'choice') for (const action of event.options) {
            if (has(action.condition, 'cards', 'CARD_MOD_LIGHTER')) expect(evaluateCondition(action.condition, context), `${event.id}/${action.id}`).toBe(false);
          }
        }
        exercised = true;
      }
      expect(exercised, option).toBe(true);
    }
  });

  it('lets children evacuate but never take a military command', async () => {
    const source = await production();
    const event = source.events.find(event => event.id === 'E_HIST_1645_YANGZHOU_FATE')!;
    const bundle = controlled(source, [event], 1645);
    bundle.rules.age_bands = [{ id: 'child', min: 6, max: 6, weight: 1, modifiers: {} }];
    const engine = new GameEngine(bundle, 'c'.repeat(64));
    const result = ok(engine.initGame({ seed: 3 }));
    expect(result.pending).toMatchObject({ kind: 'option', event_id: event.id });
    if (result.pending?.kind !== 'option') throw new Error('Missing evacuation choice');
    expect(result.pending.options.filter(option => option.available).length).toBeGreaterThanOrEqual(2);
    const next = choose(engine, result, 'leave_early');
    expect(next.state.player.identity_id).not.toBe('I_MILITARY_OFFICER');
    expect(next.state.status).not.toBe('ENDED');
  });

  it('places local preparation between the fall and the pass battle in the capital year', async () => {
    const source = await production();
    const ids = ['E_HISTORY_1644', 'E_HIST_1644_JASHEN_FALL', 'E_gm_history_pass', 'E_HIST_1644_SHANHAI_PASS'];
    const events = ids.map(id => source.events.find(event => event.id === id)!);
    const engine = new GameEngine(controlled(source, events, 1644), 'f'.repeat(64));
    const next = ok(engine.initGame({ seed: 1 }));
    expect(next.pending).toBeNull();
    expect(engine.exportSave().payload.logs.some(entry => entry.type === 'option')).toBe(false);
    expect(next.state.player.region_id).toBe('R_CAPITAL');
    const encountered = engine.exportSave().payload.logs.filter(entry => entry.type === 'event').map(entry => entry.source_id);
    expect(encountered).toEqual(ids);
  });

  it('encounters the Nanjing court before the Yangzhou siege and subsequent haircut order', async () => {
    const source = await production();
    const ids = ['E_HIST_1645_NANJING_COURT', 'E_HIST_1645_YANGZHOU_FATE', 'E_HIST_1645_HAIRCUT'];
    const events = ids.map(id => source.events.find(event => event.id === id)!);
    const engine = new GameEngine(controlled(source, events, 1645), '6'.repeat(64));
    let result = ok(engine.initGame({ seed: 1 }));
    expect(result.state.player.region_id).toBe('R_JIANGNAN');
    expect(result.state.player.age).toBe(20);
    expect(result.logs.some(entry => entry.type === 'event' && entry.source_id === ids[0])).toBe(true);
    expect(result.pending).toMatchObject({ kind: 'option', event_id: ids[1] });
    result = choose(engine, result, 'leave_early');
    expect(result.state.player.flags).toContain('F_LIFE_HISTORICAL_TURN_USED');
    expect(result.pending).toMatchObject({ kind: 'stage', event_id: ids[2] });
    result = roll(engine, result);
    expect(engine.exportSave().payload.logs.filter(entry => entry.type === 'option')).toHaveLength(1);
    expect(result.pending).toBeNull();
    expect(result.state.timeline).toBe('fictional');
    expect(result.state.player.flags).toContain('F_ERA_DISPLACED');
    const encountered = engine.exportSave().payload.logs.filter(entry => entry.type === 'event').map(entry => entry.source_id);
    expect(encountered).toEqual(ids);
  });
});


it('grows production dependents through youth and each adult livelihood without demoting a promotion', async () => {
  const source = await production();
  for (const [caste, adult] of [['C_REFUGEE', 'I_REFUGEE'], ['C_SOLDIER', 'I_WORKER'], ['C_GENTRY', 'I_HOUSEHOLD']] as const) {
    for (const age of [10, 13, 17]) {
      const bundle = controlled(source, []);
      bundle.era.backgrounds = structuredClone(source.era.backgrounds);
      bundle.rules.events.per_year = 0;
      bundle.rules.age_bands = [{ id: 'growth', min: age, max: age, weight: 1, modifiers: {} }];
      for (const entry of bundle.castes) entry.weight = entry.id === caste ? 1 : 0;
      const engine = new GameEngine(bundle, '9'.repeat(64));
      let result = ok(engine.initGame({ seed: 4 }));
      expect(result.state.player.identity_id).toBe(age === 10 ? 'I_DEPENDENT' : 'I_YOUTH');
      expect(result.state.player.flags).toContain('dependent');
      result = ok(engine.nextYear('grow'));
      expect(result.state.player.identity_id).toBe(age === 17 ? adult : 'I_YOUTH');
      expect(result.state.player.flags.includes('dependent')).toBe(age !== 17);
    }
  }
  const promoted: Event = {
    id: 'E_TEST_PROMOTION', interaction: 'automatic', text: 'Earlier earned role',
    trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
    outcome: { text: 'Retain the earned role', effects: [{ type: 'identity_set', id: 'I_ARTISAN' }], next_stage_id: null },
  };
  const bundle = controlled(source, [promoted]);
  bundle.era.backgrounds = structuredClone(source.era.backgrounds);
  bundle.rules.age_bands = [{ id: 'youth', min: 17, max: 17, weight: 1, modifiers: {} }];
  const engine = new GameEngine(bundle, '8'.repeat(64));
  ok(engine.initGame({ seed: 4 }));
  const adult = ok(engine.nextYear('adult'));
  expect(adult.state.player.identity_id).toBe('I_ARTISAN');
  expect(adult.state.player.flags).not.toContain('dependent');
});

it('awards the reachable longevity milestone at eighty, including the final lifespan year', async () => {
  const source = await production();
  const bundle = controlled(source, []);
  bundle.rules.age_bands = [{ id: 'elder', min: 79, max: 79, weight: 1, modifiers: {} }];
  bundle.rules.lifespan = { min: 80, max: 80, min_remaining_years: 1 };
  const engine = new GameEngine(bundle, '7'.repeat(64));
  const before = ok(engine.initGame({ seed: 4 }));
  expect(before.state.player.achievements).not.toContain('A_OLD_FOSSIL');
  const after = ok(engine.nextYear('eighty'));
  expect(after.state.status).toBe('ENDED');
  expect(after.state.player.achievements).toContain('A_OLD_FOSSIL');
  expect(engine.generateEndingReport()).toMatchObject({
    primary_achievement_id: 'A_LIFE_CENTURY_TURMOIL',
    milestone_achievement_ids: expect.arrayContaining(['A_OLD_FOSSIL']),
  });
});

it('in the archive suppresses queued and future lighter encounters after a real modern fuel setback', async () => {
  const source = await archivedMixed();
  const history = source.events.find(event => event.id === 'E_MOD_LIGHTER_HISTORY')!;
  const companions = source.events.filter(event => ['E_LG_CROSSROAD', 'E_LG_TEMPLE_NIGHT', 'E_MOD_LIGHTER_LIFE'].includes(event.id));
  let depleted = false;
  for (let seed = 0; seed < 256 && !depleted; seed++) {
    const { engine, result } = atEvent(source, history, seed, undefined, companions);
    if (result.pending?.kind !== 'option' || result.pending.event_id !== history.id) continue;
    const next = roll(engine, choose(engine, result, 'use_relic'));
    if (passed(next)) continue;
    expect(next.state.player.flags).toContain('F_MOD_LIGHTER_SETBACK');
    expect(next.state.player.flags).toContain('F_LIGHTER_EMPTY');
    expect(next.pending).toBeNull();
    const following = ok(engine.nextYear('after-empty'));
    expect(following.pending).toBeNull();
    for (const event of companions) expect(engine.exportSave().payload.run.event_counts[event.id] ?? 0).toBe(0);
    depleted = true;
  }
  expect(depleted).toBe(true);
});

it('consumes the historical turn on both Yangzhou routes and unlocks distinct later livelihoods', async () => {
  const source = await production();
  const ids = ['E_HIST_1645_YANGZHOU_FATE', 'E_HIST_YANGZHOU_COUNTRY_FOLLOW', 'E_HIST_YANGZHOU_NEIGHBORS_FOLLOW'];
  const events = ids.map(id => source.events.find(event => event.id === id)!);
  for (const [option, follow] of [['leave_early', ids[1]], ['stay_without_food', ids[2]]] as const) {
    const bundle = controlled(source, events, 1645);
    const seen = new Set<string>();
    for (let seed = 0; seed < 128 && seen.size < (option === 'leave_early' ? 1 : 3); seed++) {
      const engine = new GameEngine(bundle, 'a'.repeat(64));
      let result = choose(engine, ok(engine.initGame({ seed })), option);
      expect(result.state.player.flags).toContain('F_LIFE_HISTORICAL_TURN_USED');
      const context = conditionContext(result.state.player, result.state.timeline);
      for (const event of source.events.filter(event => event.trigger.kind === 'historical' && event.interaction === 'choice')) expect(evaluateCondition(event.condition, context)).toBe(false);
      while (result.pending?.kind === 'stage') result = roll(engine, result);
      const dice = engine.exportSave().payload.run.dice_results;
      if (result.state.status === 'ENDED') {
        expect(dice).toHaveLength(2);
        expect(dice.every(die => !die.success)).toBe(true);
        expect(result.state.player.flags).not.toContain('F_HIST_YANGZHOU_NEIGHBORS');
        expect(engine.generateEndingReport()).toMatchObject({ end_reason: 'death', death_id: 'D_CRISIS' });
        seen.add('death');
        continue;
      }
      seen.add(dice.length === 2 ? 'escape' : 'survive');
      const next = ok(engine.nextYear('rebuild'));
      expect(next.pending).toBeNull();
      expect(next.logs.filter(entry => entry.type === 'event').map(entry => entry.source_id)).toEqual([follow]);
      if (option === 'leave_early') {
        expect(next.state.player.attributes.wealth).toBe(Math.min(bundle.rules.attributes.max, result.state.player.attributes.wealth + 1));
      } else {
        expect(next.state.player.attributes.physique).toBe(Math.min(bundle.rules.attributes.max, result.state.player.attributes.physique + 1));
        expect(next.state.player.attributes.prestige).toBe(Math.min(bundle.rules.attributes.max, result.state.player.attributes.prestige + 1));
      }
    }
    expect([...seen].sort()).toEqual(option === 'leave_early' ? ['survive'] : ['death', 'escape', 'survive']);
  }
});
