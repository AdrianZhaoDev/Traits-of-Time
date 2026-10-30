import { describe, expect, it } from 'vitest';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { conditionContext, evaluateCondition } from '../../assets/scripts/core/engine/ConditionEvaluator.js';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';
import { templateDirectory } from '../helpers/content.js';

type Success = Extract<CommandResult, { ok: true }>;
function ok(result: CommandResult): Success {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}
function choose(engine: GameEngine, result: Success, id: string): Success {
  if (result.pending?.kind !== 'option') throw new Error(`Expected choice ${id}`);
  expect(result.pending.options.find(option => option.id === id)?.available, id).toBe(true);
  return ok(engine.resolveOption(`choice:${result.state.revision}`, result.pending.event_instance_id, id));
}
function settle(engine: GameEngine, result: Success): Success {
  while (result.pending?.kind === 'stage') {
    const pending = result.pending;
    result = ok(engine.resolveStage(`roll:${result.state.revision}`, pending.event_instance_id, pending.stage_id));
    expect(result.logs.some(entry => entry.type === 'dice')).toBe(true);
  }
  return result;
}
// Control selection and demographics, never authored conditions, effects or dice.
function scenario(source: ContentBundle, ids: string[], settings: {
  year?: number; age?: number; wealth?: number; intelligence?: number;
  physique?: number; prestige?: number; region?: string; caste?: string;
} = {}): ContentBundle {
  const bundle = structuredClone(source);
  bundle.events = ids.map(id => {
    const event = bundle.events.find(item => item.id === id);
    if (!event) throw new Error(`Missing native event ${id}`);
    if (event.trigger.kind === 'random' || event.trigger.kind === 'opening') event.trigger.trigger_probability = 1;
    return event;
  });
  const year = settings.year ?? 1630;
  const age = settings.age ?? 30;
  bundle.era.start_year = year;
  bundle.rules.opening.year_min = year;
  bundle.rules.opening.year_max = year;
  bundle.rules.attributes.base = 0;
  bundle.rules.age_bands = [{ id: 'scenario', min: age, max: age, weight: 1, modifiers: {
    wealth: settings.wealth ?? 6, intelligence: settings.intelligence ?? 6,
    physique: settings.physique ?? 6, prestige: settings.prestige ?? 3, luck: 5,
  } }];
  bundle.rules.lifespan = { min: 90, max: 90, min_remaining_years: 3 };
  bundle.rules.events.per_year = 1;
  for (const item of [...bundle.regions, ...bundle.castes, ...bundle.era.backgrounds]) {
    item.modifiers = {};
    item.flags = [];
  }
  for (const region of bundle.regions) region.weight = region.id === (settings.region ?? 'R_JIANGNAN') ? 1 : 0;
  for (const caste of bundle.castes) caste.weight = caste.id === (settings.caste ?? 'C_GENTRY') ? 1 : 0;
  return bundle;
}
const directionUsed = 'F_LIFE_DIRECTION_TURN_USED';

describe('native opening access', () => {
  it('offers two genuinely distinct affordable directions across age, caste and region', async () => {
    const source = (await loadContent(templateDirectory)).bundle;
    const openings = source.events.filter(event => event.trigger.kind === 'opening').map(event => event.id);
    for (const age of [5, 17, 18, 55, 70]) for (const caste of source.castes) for (const region of source.regions) {
      const bundle = scenario(source, openings, { age, wealth: 0, caste: caste.id, region: region.id });
      const engine = new GameEngine(bundle, '2'.repeat(64));
      const initial = ok(engine.initGame({ seed: 3 }));
      if (initial.pending?.kind !== 'option') throw new Error(`Missing opening: ${age}/${caste.id}/${region.id}`);
      const legal = initial.pending.options.filter(option => option.available);
      expect(legal.length).toBeGreaterThanOrEqual(2);
      const directions = new Set<string>();
      for (const option of legal) {
        const branch = new GameEngine(bundle, '2'.repeat(64));
        branch.restoreSave(structuredClone(engine.exportSave()));
        const result = settle(branch, choose(branch, initial, option.id));
        expect(result.state.status).not.toBe('ENDED');
        expect(result.state.player.chains.length).toBeLessThanOrEqual(1);
        expect(result.state.player.attributes.wealth).toBeGreaterThanOrEqual(0);
        directions.add(JSON.stringify({ chains: result.state.player.chains.map(chain => chain.chain_id), flags: result.state.player.flags, identity: result.state.player.identity_id }));
      }
      expect(directions.size).toBeGreaterThanOrEqual(2);
    }
  });
});

it('consumes the one global career pivot on every available path before any dice', async () => {
  const source = (await loadContent(templateDirectory)).bundle;
  const pivots = source.events.filter(event => event.trigger.kind === 'random' && event.interaction === 'choice' && event.options.some(option => option.outcome.effects.some(effect => effect.type === 'chain_start')));
  expect(pivots.length).toBeGreaterThan(0);
  for (const event of pivots) {
    let exercised = false;
    for (const age of [15, 30, 60]) for (const caste of source.castes) for (const service of [false, true]) {
      const bundle = scenario(source, [event.id], { age, caste: caste.id });
      if (service) for (const background of bundle.era.backgrounds) background.flags.push('F_LIFE_ROUTE_SERVICE');
      const engine = new GameEngine(bundle, '3'.repeat(64));
      const initial = ok(engine.initGame({ seed: 1 }));
      if (initial.pending?.kind !== 'option') continue;
      exercised = true;
      for (const option of initial.pending.options.filter(option => option.available)) {
        const branch = new GameEngine(bundle, '3'.repeat(64));
        branch.restoreSave(structuredClone(engine.exportSave()));
        const selected = choose(branch, initial, option.id);
        expect(selected.state.player.flags, `${event.id}/${option.id}`).toContain(directionUsed);
        const context = conditionContext(selected.state.player, selected.state.timeline);
        for (const pivot of pivots) expect(evaluateCondition(pivot.condition, context), pivot.id).toBe(false);
        let result = settle(branch, selected);
        for (const chain of result.state.player.chains.filter(chain => chain.status === 'active')) result = ok(branch.abandonChain(`abandon:${chain.instance_id}`, chain.instance_id));
        for (let year = 0; year < 5; year++) {
          result = settle(branch, ok(branch.nextYear(`after-pivot:${year}`)));
          expect(result.pending).toBeNull();
          expect(result.state.player.chains.length).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(exercised, event.id).toBe(true);
  }
});

it('keeps entry age, wealth, capability and military eligibility boundaries', async () => {
  const source = (await loadContent(templateDirectory)).bundle;
  for (const age of [17, 18, 55, 70]) for (const wealth of [0, 1, 2, 3]) {
    for (const [id, eligible] of [
      ['E_START_IMPERIAL_EXAM', age >= 18 && wealth >= 1],
      ['E_START_MARITIME_TRADE', age >= 18 && wealth >= 3],
      ['E_START_EPIDEMIC_HEALING', age >= 18],
      ['E_START_MILITARY_MERIT', age >= 18],
    ] as const) {
      const bundle = scenario(source, [id], { year: 1650, age, wealth, caste: 'C_SOLDIER' });
      const engine = new GameEngine(bundle, '4'.repeat(64));
      const result = ok(engine.initGame({ seed: 1 }));
      expect(result.state.timeline).toBe('fictional');
      const event = bundle.events[0]!;
      expect(evaluateCondition(event.condition, conditionContext(result.state.player, result.state.timeline)), `${id}/${age}/${wealth}`).toBe(eligible);
      expect(result.pending?.kind === 'option').toBe(eligible);
    }
  }
  for (const intelligence of [3, 4]) for (const id of ['E_START_IMPERIAL_EXAM', 'E_START_MILITARY_MERIT', 'E_START_MARITIME_TRADE']) {
    const bundle = scenario(source, [id], { intelligence, caste: 'C_REFUGEE', region: 'R_SHANBEI' });
    const result = ok(new GameEngine(bundle, '4'.repeat(64)).initGame({ seed: 1 }));
    expect(result.pending?.kind === 'option', id).toBe(id === 'E_START_IMPERIAL_EXAM' && intelligence === 4);
  }
});

it('advances every career without intermediate confirmation, retains learning on exit and never demotes at its final', async () => {
  const source = (await loadContent(templateDirectory)).bundle;
  const ranks = new Map(source.era.identities.map(identity => [identity.id, identity.rank]));
  for (const chain of source.chains) {
    const entry = source.events.find(event => event.trigger.kind === 'random' && event.interaction === 'choice' && event.options.some(option => option.outcome.effects.some(effect => effect.type === 'chain_start' && effect.id === chain.id)))
      ?? source.events.find(event => event.interaction === 'choice' && event.options.some(option => option.outcome.effects.some(effect => effect.type === 'chain_start' && effect.id === chain.id)));
    if (entry?.interaction !== 'choice') throw new Error(`Missing entry ${chain.id}`);
    const option = entry.options.find(option => option.outcome.effects.some(effect => effect.type === 'chain_start' && effect.id === chain.id))!;
    const bundle = scenario(source, [entry.id, ...chain.nodes.map(node => node.event_id)], { age: chain.id === 'CH_MENTOR' ? 60 : entry.id === 'E_SOC_YOUTH_APPRENTICE' ? 15 : 30, caste: 'C_SOLDIER' });
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 96 && outcomes.size < 2; seed++) {
      const engine = new GameEngine(bundle, '5'.repeat(64));
      let result = settle(engine, choose(engine, ok(engine.initGame({ seed })), option.id));
      const start = result.state.player.calendar_year;
      for (let index = 0; index < chain.nodes.length && result.state.player.chains[0]?.status === 'active'; index++) {
        while (result.state.player.calendar_year < start + chain.nodes[index]!.after_years) result = ok(engine.nextYear(`year:${result.state.revision}`));
        if (index < chain.nodes.length - 1) {
          expect(result.pending?.kind).not.toBe('option');
          result = settle(engine, result);
          expect(result.pending).toBeNull();
          if (index === 0 && result.state.player.chains[0]?.status === 'active') {
            const abandoned = new GameEngine(bundle, '5'.repeat(64));
            abandoned.restoreSave(structuredClone(engine.exportSave()));
            const earned = result.state.player.attributes;
            const exit = ok(abandoned.abandonChain('exit', result.state.player.chains[0].instance_id));
            expect(exit.state.player.attributes).toEqual(earned);
            expect(exit.state.player.chains[0]?.status).toBe('interrupted');
          }
        } else {
          if (result.pending?.kind === 'option') {
            const event = bundle.events.find(event => event.id === result.pending!.event_id);
            if (event?.interaction !== 'choice') throw new Error('Missing final');
            const legal = result.pending.options.filter(option => option.available);
            expect(legal.length).toBeGreaterThanOrEqual(2);
            for (const identity of source.era.identities.filter(identity => identity.rank >= 3)) {
              const player = { ...result.state.player, identity_id: identity.id };
              const context = conditionContext(player, result.state.timeline);
              const alternatives = event.options.filter(option => evaluateCondition(option.condition, context));
              expect(alternatives.length, `${event.id}/${identity.id}`).toBeGreaterThanOrEqual(2);
              for (const alternative of alternatives) {
                const stage = event.stages?.find(stage => stage.id === alternative.outcome.next_stage_id);
                const effects = [...alternative.outcome.effects, ...(stage?.success.effects ?? []), ...(stage?.failure.effects ?? [])];
                for (const effect of effects) if (effect.type === 'identity_set') expect(ranks.get(effect.id)!).toBeGreaterThanOrEqual(identity.rank);
              }
            }
            const durableRoutes = new Set<string>();
            for (const action of legal) {
              const branch = new GameEngine(bundle, '5'.repeat(64));
              branch.restoreSave(structuredClone(engine.exportSave()));
              const final = settle(branch, choose(branch, result, action.id));
              if (action.id === 'finish') {
                const dice = final.logs.filter(entry => entry.type === 'dice');
                expect(dice).toHaveLength(1);
                const success = dice[0]!.data.success;
                expect(final.state.player.chains[0]?.status).toBe(success ? 'completed' : 'interrupted');
                expect(final.state.player.identity_id).toBe(result.state.player.identity_id);
                for (const effect of chain.completion.effects) if (effect.type === 'flag_add') {
                  expect(final.state.player.flags.includes(effect.id)).toBe(success);
                }
                if (!success) expect(final.state.player.achievements).toEqual(result.state.player.achievements);
              }
              expect(ranks.get(final.state.player.identity_id)!).toBeGreaterThanOrEqual(ranks.get(result.state.player.identity_id)!);
              const context = conditionContext(final.state.player, final.state.timeline);
              const readers = source.events.filter(event => event.id.startsWith('E_LIFE_ROUTE_') && evaluateCondition(event.condition, context));
              if (readers.length > 0) durableRoutes.add(readers.map(event => event.id).sort().join(','));
            }
            expect(durableRoutes.size).toBeGreaterThanOrEqual(2);
            const checked = event.options.find(option => option.outcome.next_stage_id !== null && legal.some(item => item.id === option.id));
            result = choose(engine, result, checked?.id ?? legal[0]!.id);
          }
          result = settle(engine, result);
        }
      }
      const status = result.state.player.chains[0]!.status;
      expect(['completed', 'interrupted']).toContain(status);
      outcomes.add(status);
      for (const effect of chain.completion.effects) if (effect.type === 'flag_add') expect(result.state.player.flags.includes(effect.id)).toBe(status === 'completed');
    }
    expect([...outcomes].sort(), chain.id).toEqual(['completed', 'interrupted']);
  }
});

it('prepays maritime costs once and never asks for a second payment mid-voyage', async () => {
  const source = (await loadContent(templateDirectory)).bundle;
  const chain = source.chains.find(chain => chain.id === 'CHAIN_MARITIME_TRADE')!;
  for (const wealth of [2, 3]) {
    const bundle = scenario(source, ['E_START_MARITIME_TRADE', ...chain.nodes.map(node => node.event_id)], { wealth });
    const engine = new GameEngine(bundle, '6'.repeat(64));
    let result = ok(engine.initGame({ seed: 1 }));
    if (wealth === 2) {
      expect(result.pending).toBeNull();
      expect(result.state.player.chains).toEqual([]);
      expect(result.state.player.attributes.wealth).toBe(wealth);
      continue;
    }
    if (result.pending?.kind !== 'option') throw new Error('Missing maritime offer');
    expect(result.pending.options.find(option => option.id === 'start')?.available).toBe(true);
    result = choose(engine, result, 'start');
    expect(result.state.player.attributes.wealth).toBe(0);
    for (let year = 0; year < chain.nodes.length - 1; year++) {
      result = ok(engine.nextYear(`voyage:${year}`));
      expect(result.pending?.kind).not.toBe('option');
      result = settle(engine, result);
      expect(result.state.player.attributes.wealth).toBe(0);
    }
  }
});

it('routes poor and rich economic encounters without an option pause or forced rich spending', async () => {
  const source = (await loadContent(templateDirectory)).bundle;
  for (const wealth of [0, 1, 2, 5, 6]) {
    const bundle = scenario(source, ['E_SOC_POOR_WORK', 'E_SOC_RICH_GRAIN'], { wealth });
    const engine = new GameEngine(bundle, '7'.repeat(64));
    const initial = ok(engine.initGame({ seed: 1 }));
    expect(initial.pending?.kind).not.toBe('option');
    const result = settle(engine, initial);
    const encountered = engine.exportSave().payload.logs.filter(entry => entry.type === 'event').map(entry => entry.source_id);
    expect(encountered).toEqual(wealth <= 1 ? ['E_SOC_POOR_WORK'] : wealth >= 6 ? ['E_SOC_RICH_GRAIN'] : []);
    if (wealth >= 2) expect(result.state.player.attributes.wealth).toBe(wealth);
    expect(result.pending).toBeNull();
  }
});

it('interrupts only the local workshop after automatic fire resolution and retains learned skills', async () => {
  const source = (await loadContent(templateDirectory)).bundle;
  const chain = source.chains.find(chain => chain.id === 'CHAIN_FIREARMS_RESEARCH')!;
  for (const region of ['R_CAPITAL', 'R_JIANGNAN']) {
    const bundle = scenario(source, ['E_START_FIREARMS_RESEARCH', ...chain.nodes.map(node => node.event_id), 'E_HIST_1635_CAPITAL_FIRE'], { year: 1633, region });
    const engine = new GameEngine(bundle, '8'.repeat(64));
    choose(engine, ok(engine.initGame({ seed: 2 })), 'start');
    const learned = settle(engine, ok(engine.nextYear('1634'))).state.player.attributes;
    const result = settle(engine, ok(engine.nextYear('1635')));
    expect(result.pending).toBeNull();
    expect(result.state.player.chains[0]?.status).toBe(region === 'R_CAPITAL' ? 'interrupted' : 'active');
    expect(result.state.player.flags.includes('F_ERA_WORKSHOP_LOST')).toBe(region === 'R_CAPITAL');
    expect(result.state.player.attributes.intelligence).toBeGreaterThanOrEqual(learned.intelligence);
    expect(result.state.player.attributes.physique).toBeGreaterThanOrEqual(learned.physique);
    expect(engine.exportSave().payload.logs.filter(entry => entry.type === 'option')).toHaveLength(1);
  }
});

it('has no hidden chain starts or choices outside opening, one pivot, finals and one history turn', async () => {
  const source = (await loadContent(templateDirectory)).bundle;
  const finals = new Set(source.chains.map(chain => chain.nodes[chain.nodes.length - 1]!.event_id));
  for (const event of source.events) {
    for (const stage of event.stages ?? []) for (const outcome of [stage.success, stage.failure]) expect(outcome.effects.some(effect => effect.type === 'chain_start'), event.id).toBe(false);
    if (event.interaction === 'automatic') {
      expect(event.outcome.effects.some(effect => effect.type === 'chain_start'), event.id).toBe(false);
      expect(event.trigger.kind, event.id).not.toBe('opening');
      continue;
    }
    for (const option of event.options) {
      const starts = option.outcome.effects.filter(effect => effect.type === 'chain_start');
      expect(starts.length, event.id).toBeLessThanOrEqual(1);
      if (starts.length > 0) expect(['opening', 'random']).toContain(event.trigger.kind);
      if (event.trigger.kind === 'random') expect(option.outcome.effects).toContainEqual({ type: 'flag_add', id: directionUsed });
      if (event.trigger.kind === 'historical') expect(option.outcome.effects).toContainEqual({ type: 'flag_add', id: 'F_LIFE_HISTORICAL_TURN_USED' });
    }
    if (event.trigger.kind === 'chain') expect(finals.has(event.id), event.id).toBe(true);
    else expect(['opening', 'random', 'historical']).toContain(event.trigger.kind);
  }
});
