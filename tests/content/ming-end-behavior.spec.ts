import { describe, expect, it } from 'vitest';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { conditionContext, evaluateCondition } from '../../assets/scripts/core/engine/ConditionEvaluator.js';
import type { Chain, ChoiceEvent, Condition, ContentBundle, Effect, Event } from '../../assets/scripts/core/types/content.generated.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';
import { templateDirectory } from '../helpers/content.js';

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
function choices(bundle: ContentBundle, owner: string): ChoiceEvent[] {
  return bundle.events.filter((event): event is ChoiceEvent => namespace(event.id, owner) && event.interaction === 'choice');
}

describe('production ming_end: GPT event consequences through GameEngine', () => {
  it('rejects unmet ordinary capability gates atomically and executes safe fallbacks', async () => {
    const bundle = structuredClone(await production());
    bundle.rules.attributes.base = 2;
    const events = choices(bundle, 'gpt');
    expect(events).toHaveLength(6);
    const gatedEvents = events.filter(event => event.options.some(option => option.condition));
    expect(gatedEvents).toHaveLength(6);
    for (const event of gatedEvents) {
      let exercised = false;
      for (let seed = 0; seed < 512 && !exercised; seed++) {
        const { engine, result } = atEvent(bundle, event, seed);
        if (result.pending?.kind !== 'option' || result.pending.event_id !== event.id) continue;
        expect(result.state.player.cards).toHaveLength(1);
        const gated = event.options.filter(item => item.condition);
        if (gated.some(option => result.pending?.kind === 'option' && result.pending.options.find(item => item.id === option.id)?.available)) continue;
        for (const option of gated) {
          expect(result.pending.options.find(item => item.id === option.id)?.available).toBe(false);
          const before = engine.exportSave();
          expect(engine.resolveOption(`forbidden:${option.id}`, result.pending.event_instance_id, option.id))
            .toMatchObject({ ok: false, error: { code: 'OPTION_UNAVAILABLE' } });
          expect(engine.exportSave()).toEqual(before);
        }
        const fallback = event.options.find(option => !option.condition && option.risk === 'safe');
        expect(fallback, event.id).toBeDefined();
        expect(result.pending.options.find(item => item.id === fallback!.id)?.available).toBe(true);
        const selected = choose(engine, result, fallback!.id);
        expect(selected.logs.some(entry => entry.type === 'option' && entry.data.option_id === fallback!.id)).toBe(true);
        expect(selected.state.status).not.toBe('ENDED');
        exercised = true;
      }
      expect(exercised, `No scheduled capability-gated event: ${event.id}`).toBe(true);
    }
  });

  it('kills the player on each trap first-stage failure, rather than merely displaying death text', async () => {
    const bundle = await production();
    const traps = choices(bundle, 'gpt');
    expect(traps).toHaveLength(6);
    for (const event of traps) {
      const options = event.options.filter(item => event.stages?.find(stage => stage.id === item.outcome.next_stage_id)
        ?.failure.effects.some(effect => effect.type === 'death'));
      expect(options.length, event.id).toBeGreaterThan(0);
      for (const option of options) {
      const first = event.stages!.find(stage => stage.id === option!.outcome.next_stage_id)!;
      const death = first.failure.effects.find(effect => effect.type === 'death')!;
      let exercised = false;
      for (let seed = 0; seed < 512 && !exercised; seed++) {
        const { engine, result } = atEvent(bundle, event, seed, option.condition);
        if (result.pending?.kind !== 'option' || !result.pending.options.find(item => item.id === option!.id)?.available) continue;
        const entered = choose(engine, result, option!.id);
        expect(entered.pending).toMatchObject({ kind: 'stage', stage_id: first.id });
        const resolved = roll(engine, entered);
        if (passed(resolved)) continue;
        expect(resolved.state.status).toBe('ENDED');
        expect(resolved.pending).toBeNull();
        expect(engine.generateEndingReport()).toMatchObject({ end_reason: 'death', death_id: death.id });
        exercised = true;
      }
      expect(exercised, `No first-stage failure: ${event.id}`).toBe(true);
      }
    }
  });

  it('requires two real D20 successes for the unique micro-operation achievement', async () => {
    const bundle = await production();
    const candidates = choices(bundle, 'gpt').filter(event => event.stages?.some(stage => stage.success.next_stage_id !== null));
    expect(candidates).toHaveLength(6);
    for (const event of candidates) {
    const firstStages = event.stages!.filter(stage => stage.success.next_stage_id !== null);
    expect(firstStages, event.id).toHaveLength(1);
    const first = firstStages[0]!;
    const second = event.stages!.find(stage => stage.id === first.success.next_stage_id)!;
    const option = event.options.find(item => item.outcome.next_stage_id === first.id)!;
    expect(option).toBeDefined();
    const seen = new Set<string>();
    let rewarded: string[] = [];
    const failedAchievements: string[][] = [];
    for (let seed = 0; seed < 2048 && seen.size < 3; seed++) {
      const { engine, result } = atEvent(bundle, event, seed, option.condition);
      if (result.pending?.kind !== 'option' || !result.pending.options.find(item => item.id === option.id)?.available) continue;
      const initial = result.state.player.achievements;
      const entered = choose(engine, result, option.id);
      expect(entered.state.player.achievements).toEqual(initial);
      const one = roll(engine, entered);
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

function chainScenario(source: ContentBundle, chain: Chain, history: ChoiceEvent) {
  if (history.trigger.kind !== 'historical') throw new Error('Expected historical event');
  const opening: Event = {
    id: 'E_TEST_CHAIN_START', text: 'Controlled chain opening', interaction: 'automatic',
    trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
    outcome: { text: 'Start the authored chain', effects: [{ type: 'chain_start', id: chain.id }], next_stage_id: null },
  };
  const nodes = chain.nodes.map(node => {
    const event = source.events.find(item => item.id === node.event_id);
    if (!event) throw new Error(`Missing chain node ${node.event_id}`);
    return event;
  });
  const bundle = controlled(source, [opening, ...nodes, history]);
  bundle.rules.events.per_year = 0;
  return bundle;
}

describe('production ming_end: GM chains and historical consequences', () => {
  it('advances all three chains across three real years; aborts never earn completion or historical access', async () => {
    const source = await production();
    const chains = source.chains.filter(chain => namespace(chain.id, 'gm'));
    expect(chains).toHaveLength(3);
    for (const chain of chains) {
      expect(chain.nodes.map(node => node.after_years)).toEqual([1, 2, 3]);
      const completionFlags = chain.completion.effects.filter((effect): effect is Extract<Effect, { type: 'flag_add' | 'flag_remove' }> => effect.type === 'flag_add');
      const history = choices(source, 'gm').find(event => event.trigger.kind === 'historical'
        && event.options.some(option => completionFlags.some(flag => has(option.condition, 'flags', flag.id))));
      expect(history, `Missing historical consumer for ${chain.id}`).toBeDefined();
      if (history?.trigger.kind !== 'historical') throw new Error('Missing historical year');
      const historyYear = history.trigger.year;
      const special = history!.options.find(option => completionFlags.some(flag => has(option.condition, 'flags', flag.id)))!;
      const done = completionFlags.find(flag => has(special.condition, 'flags', flag.id))!;

      const absent = atEvent(source, history!, 0);
      expect(absent.result.pending).toMatchObject({ kind: 'option', event_id: history!.id });
      if (absent.result.pending?.kind !== 'option') throw new Error('Missing historical decision');
      expect(absent.result.pending.options.find(option => option.id === special.id)?.available).toBe(false);
      const before = absent.engine.exportSave();
      expect(absent.engine.resolveOption('unearned-history', absent.result.pending.event_instance_id, special.id))
        .toMatchObject({ ok: false, error: { code: 'OPTION_UNAVAILABLE' } });
      expect(absent.engine.exportSave()).toEqual(before);

      const bundle = chainScenario(source, chain, history!);
      const seen = new Set<string>();
      for (let seed = 0; seed < 2048 && seen.size < 2; seed++) {
        const engine = new GameEngine(bundle, 'c'.repeat(64));
        let result = ok(engine.initGame({ seed }));
        const startYear = result.state.player.calendar_year;
        expect(result.state.player.chains).toEqual([expect.objectContaining({ chain_id: chain.id, status: 'active', node_index: 0 })]);
        expect(result.state.player.flags).not.toContain(done.id);
        let interrupted = false;
        for (let index = 0; index < 3; index++) {
          result = ok(engine.nextYear(`year:${index}`));
          expect(result.state.player.calendar_year).toBe(startYear + index + 1);
          expect(result.state.player.age).toBe(21 + index);
          expect(result.pending).toMatchObject({ event_id: chain.nodes[index]!.event_id });
          expect(result.state.player.flags).not.toContain(done.id);
          if (result.pending?.kind === 'option') {
            const eventId = result.pending.event_id;
            const event = bundle.events.find(item => item.id === eventId);
            if (event?.interaction !== 'choice') throw new Error('Missing authored chain choice');
            const attempt = event.options.find(option => option.risk === 'normal' && option.outcome.next_stage_id !== null);
            expect(attempt, event.id).toBeDefined();
            result = choose(engine, result, attempt!.id);
          }
          expect(result.pending?.kind).toBe('stage');
          while (result.pending?.kind === 'stage') result = roll(engine, result);
          const instance = result.state.player.chains[0]!;
          if (instance.status === 'interrupted') {
            expect(result.state.player.flags).not.toContain(done.id);
            expect(instance.next_due_year).toBeNull();
            expect(engine.exportSave().payload.run.dice_results.some(dice => !dice.success)).toBe(true);
            // Continue to the historical date: abort must remain permanent.
            while (result.state.player.calendar_year < historyYear) {
              result = ok(engine.nextYear(`after-abort:${result.state.player.calendar_year}`));
              expect(result.state.player.flags).not.toContain(done.id);
            }
            expect(result.pending).toMatchObject({ kind: 'option', event_id: history!.id });
            if (result.pending?.kind !== 'option') throw new Error('Missing history after abort');
            expect(result.pending.options.find(option => option.id === special.id)?.available).toBe(false);
            seen.add('failure');
            interrupted = true;
            break;
          }
          expect(instance).toMatchObject({ node_index: index + 1, status: index === 2 ? 'completed' : 'active' });
          if (index < 2) {
            expect(result.pending).toBeNull();
            expect(result.state.player.flags).not.toContain(done.id);
          }
        }
        if (interrupted) continue;
        expect(engine.exportSave().payload.run.dice_results.every(dice => dice.success)).toBe(true);
        expect(result.state.player.flags).toContain(done.id);
        while (result.state.player.calendar_year < historyYear) {
          result = ok(engine.nextYear(`after-completion:${result.state.player.calendar_year}`));
          expect(result.state.player.flags).toContain(done.id);
        }
        expect(result.pending).toMatchObject({ kind: 'option', event_id: history!.id });
        if (result.pending?.kind !== 'option') throw new Error('Missing earned historical decision');
        expect(result.pending.options.find(option => option.id === special.id)?.available).toBe(true);
        const selected = choose(engine, result, special.id);
        expect(selected.logs.some(entry => entry.type === 'option' && entry.data.option_id === special.id)).toBe(true);
        seen.add('success');
      }
      expect([...seen].sort(), chain.id).toEqual(['failure', 'success']);
    }
  });
});

describe('production ming_end: actual encounter mix and save continuation', () => {
  it('encounters 50–70% automatic events across varied lives and always offers a legal continuation', async () => {
    const bundle = await production();
    const registry = new Map(bundle.events.map(event => [event.id, event]));
    let automatic = 0;
    let total = 0;
    let choicesSeen = 0;
    for (let seed = 0; seed < 64; seed++) {
      const engine = new GameEngine(bundle, 'd'.repeat(64));
      let result = ok(engine.initGame({ seed }));
      expect(result.state.player.cards).toHaveLength(1);
      let commands = 0;
      while (result.state.status !== 'ENDED' && commands < 2048) {
        commands++;
        if (result.pending?.kind === 'option') {
          choicesSeen++;
          const available = result.pending.options.filter(option => option.available);
          expect(available.length, result.pending.event_id).toBeGreaterThan(0);
          const event = registry.get(result.pending.event_id);
          if (event?.interaction !== 'choice') throw new Error('Missing production choice');
          const safe = event.options.find(option => option.risk === 'safe' && available.some(item => item.id === option.id));
          result = choose(engine, result, safe?.id ?? available[0]!.id);
        } else if (result.pending?.kind === 'stage') {
          result = roll(engine, result);
        } else {
          result = ok(engine.nextYear(`year:${result.state.revision}`));
        }
      }
      expect(result.state.status, `Unfinished production seed ${seed}`).toBe('ENDED');
      const save = engine.exportSave();
      const encountered = save.payload.logs.filter(entry => entry.type === 'event');
      expect(encountered.length).toBe(Object.values(save.payload.run.event_counts).reduce((sum, count) => sum + count, 0));
      for (const entry of encountered) {
        const event = registry.get(entry.source_id);
        expect(event).toBeDefined();
        total++;
        if (event!.interaction === 'automatic') automatic++;
      }
    }
    expect(choicesSeen).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(100);
    expect(automatic / total).toBeGreaterThanOrEqual(0.5);
    expect(automatic / total).toBeLessThanOrEqual(0.7);
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

describe('production ming_end: twelve modern physical cards', () => {
  it('gates both reactions by the actual card, retains normal paths, and grants only one success or setback', async () => {
    const source = await production();
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
        ok(engine.retire(`retire:${resolved.state.revision}`));
        expect(engine.generateEndingReport()).toMatchObject({ end_reason: 'retired', primary_achievement_id: `A_MOD_${suffix}_${outcome}` });
        seen.add(outcome);
      }
      expect([...seen].sort(), card.id).toEqual(['SETBACK', 'SUCCESS']);
    }
  });
});
