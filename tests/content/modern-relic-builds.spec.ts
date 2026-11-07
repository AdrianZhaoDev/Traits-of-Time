import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { conditionContext, evaluateCondition } from '../../assets/scripts/core/engine/ConditionEvaluator.js';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';
import type { LogEntry } from '../../assets/scripts/core/types/schema.js';
import { useLegacyRelicPool } from '../helpers/content.js';

type Success = Extract<CommandResult, { ok: true }>;
const fingerprint = 'a'.repeat(64);
let routeContent: ContentBundle;
beforeAll(async () => {
  routeContent = structuredClone((await loadContent('assets/resources/data/ming_end')).bundle);
  // Keep the established real-D20 route seeds independent of the production offer pool.
  useLegacyRelicPool(routeContent);
});

const choices: Record<string, string> = {
  E_MOD_CORN_TRIAL: 'corn_invest', E_MOD_CORN_STORE: 'corn_invest', E_MOD_CORN_RELIEF: 'corn_invest',
  E_MOD_CORN_FAST_INVENTORY: 'corn_invest', E_MOD_CORN_FAST_DISTRIBUTE: 'corn_invest', E_MOD_CORN_FAST_ESCORT: 'corn_invest',
  E_MOD_CORN_BREAKTHROUGH: 'corn_promote',
  E_MOD_HEALER_NODE_2: 'train', E_MOD_HEALER_NODE_3: 'organize', E_MOD_HEALER_FAST_1: 'organize',
  E_MOD_HEALER_FAST_2: 'organize', E_MOD_HEALER_FAST_3: 'organize', E_MOD_HEALER_BREAKTHROUGH: 'spread',
  E_MOD_FLASHLIGHT_EVIDENCE: 'flashlight_study', E_MOD_FLASHLIGHT_PATROL: 'flashlight_rota',
  E_MOD_FLASHLIGHT_ESCORT: 'flashlight_escort', E_MOD_FLASHLIGHT_FAST_FRAUD: 'flashlight_fast_fraud_invest',
  E_MOD_FLASHLIGHT_FAST_ROTA: 'flashlight_fast_rota_invest', E_MOD_FLASHLIGHT_FAST_EXIT: 'flashlight_fast_exit_invest',
  E_MOD_FLASHLIGHT_BREAKTHROUGH: 'flashlight_break_brain',
};
function ok(result: CommandResult): Success {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}
function start(bundle: ContentBundle, seed: number, card: string) {
  const engine = new GameEngine(bundle, fingerprint);
  const initial = ok(engine.initGame({ seed }));
  if (initial.pending?.kind !== 'card' || !initial.pending.cards.includes(card)) throw new Error(`Card ${card} not offered for seed ${seed}`);
  return { engine, result: ok(engine.selectCard('select', card)) };
}
function step(engine: GameEngine, result: Success, sequence: number, preferred: Record<string, string>): Success {
  const pending = result.pending;
  if (pending?.kind === 'option') {
    const desired = preferred[pending.event_id] ?? choices[pending.event_id];
    const option = pending.options.find(item => item.available && item.id === desired)
      ?? pending.options.find(item => item.available && item.risk === 'safe')
      ?? pending.options.find(item => item.available);
    if (!option) throw new Error(`No available option for ${pending.event_id}`);
    return ok(engine.resolveOption(`step:${sequence}`, pending.event_instance_id, option.id));
  }
  if (pending?.kind === 'stage') return ok(engine.resolveStage(`step:${sequence}`, pending.event_instance_id, pending.stage_id));
  if (result.state.status === 'READY') return ok(engine.nextYear(`step:${sequence}`));
  throw new Error(`Unexpected state ${result.state.status}`);
}
function play(bundle: ContentBundle, seed: number, card: string, endYear: number,
  preferred: Record<string, string> = {}, stopAtDice?: string) {
  const initial = start(bundle, seed, card);
  let result = initial.result;
  const logs: LogEntry[] = [];
  for (let sequence = 0; sequence < 200; sequence++) {
    logs.push(...result.logs);
    if ((stopAtDice && result.logs.some(log => log.type === 'dice' && log.source_id === stopAtDice)) ||
        result.state.status === 'ENDED' || (result.state.status === 'READY' && result.state.player.calendar_year >= endYear)) {
      return { engine: initial.engine, result, logs };
    }
    result = step(initial.engine, result, sequence, preferred);
  }
  throw new Error('Scenario did not settle');
}
function seek(bundle: ContentBundle, seed: number, card: string, event: string) {
  const initial = start(bundle, seed, card);
  let result = initial.result;
  for (let sequence = 0; sequence < 200; sequence++) {
    if (result.pending?.kind === 'option' && result.pending.event_id === event) return { engine: initial.engine, result };
    if (result.state.status === 'ENDED') break;
    result = step(initial.engine, result, sequence, {});
  }
  throw new Error(`Did not reach ${event}`);
}

const builds = [
  { card: 'CARD_MODERN_CORN', chain: 'CHAIN_MOD_CORN_KING', prefix: 'E_MOD_CORN_OPEN_', fast: ['E_MOD_CORN_FAST_INVENTORY', 'E_MOD_CORN_FAST_DISTRIBUTE', 'E_MOD_CORN_FAST_ESCORT'], seeds: [107, 406, 163, 305] },
  { card: 'CARD_MODERN_ANTIBIOTIC', chain: 'CHAIN_MOD_HEALER_SAGE', prefix: 'E_MOD_HEALER_OPEN_', fast: ['E_MOD_HEALER_FAST_1', 'E_MOD_HEALER_FAST_2', 'E_MOD_HEALER_FAST_3'], seeds: [13, 6, 166, 39] },
  { card: 'CARD_MODERN_FLASHLIGHT', chain: 'CHAIN_MOD_FLASHLIGHT_DETECTIVE', prefix: 'E_MOD_FLASHLIGHT_OPEN_', fast: ['E_MOD_FLASHLIGHT_FAST_FRAUD', 'E_MOD_FLASHLIGHT_FAST_ROTA', 'E_MOD_FLASHLIGHT_FAST_EXIT'], seeds: [5, 20, 17, 27] },
] as const;

describe('production relic stories with an explicit route-selection fixture', () => {
  it.each(builds)('starts exactly one age-appropriate story for $card at each boundary', ({ card, chain, prefix }) => {
    for (const [age, suffix] of [[3, 'CHILD'], [10, 'CHILD'], [11, 'YOUTH'], [20, 'YOUTH'], [21, 'ADULT'], [45, 'ADULT'], [46, 'ELDER'], [65, 'ELDER']] as const) {
      const bundle = structuredClone(routeContent);
      bundle.rules.age_bands = [{ id: 'boundary', min: age, max: age, weight: 1, modifiers: {} }];
      bundle.rules.lifespan = { min: 90, max: 90, min_remaining_years: 3 };
      bundle.rules.opening.year_min = 1630;
      bundle.rules.opening.year_max = 1630;
      const pool = bundle.pools.find(item => item.id === bundle.rules.opening.pool_id)!;
      for (const entry of pool.entries) entry.weight = entry.card_id === card ? 1 : 0;
      const { result } = start(bundle, 1, card);
      const actual = result.logs.filter(log => log.type === 'event' && log.source_id.startsWith(prefix)).map(log => log.source_id);
      const expectedSuffix = card === 'CARD_MODERN_CORN' && suffix === 'ELDER' ? 'SENIOR' : suffix;
      expect(actual).toEqual([prefix + expectedSuffix]);
      expect(result.state.player.chains.filter(item => item.chain_id === chain && item.status === 'active')).toHaveLength(1);
      expect(result.state.player.cards).toEqual([card]);
    }
  });

  it.each([
    ['CARD_MODERN_CORN', 168, ['E_MOD_CORN_TRIAL', 'E_MOD_CORN_STORE', 'E_MOD_CORN_RELIEF']],
    ['CARD_MODERN_ANTIBIOTIC', 214, ['E_MOD_HEALER_NODE_1', 'E_MOD_HEALER_NODE_2', 'E_MOD_HEALER_NODE_3']],
    ['CARD_MODERN_FLASHLIGHT', 234, ['E_MOD_FLASHLIGHT_EVIDENCE', 'E_MOD_FLASHLIGHT_PATROL', 'E_MOD_FLASHLIGHT_ESCORT']],
  ])('runs the %s chain in relative years 1, 3 and 6 from 1628', (card, seed, nodes) => {
    const run = play(routeContent, seed, card, 1635);
    const startYear = run.result.state.player.start_year;
    expect(startYear).toBe(1628);
    const events = run.logs.filter(log => log.type === 'event' && nodes.includes(log.source_id));
    expect(events.map(log => [log.source_id, log.calendar_year - startYear]))
      .toEqual(nodes.map((id, index) => [id, [1, 3, 6][index]]));
  });

  it.each(builds)('runs only the appropriate late-start sequence for $card', ({ card, fast, seeds }) => {
    [1642, 1643, 1644, 1645].forEach((year, index) => {
      const run = play(routeContent, seeds[index]!, card, 1645);
      expect(run.result.state.player.start_year).toBe(year);
      const events = run.logs.filter(log => log.type === 'event' && fast.includes(log.source_id as never)).map(log => log.source_id);
      expect(events).toEqual(year === 1643 || year === 1644 ? [...fast] : []);
    });
  });

  it.each([
    ['CARD_MODERN_CORN', 37, 'E_MOD_CORN_TRIAL', 'corn_risk', 'D_MOD_CORN_THEFT', 'A_MOD_CORN_DEATH_THEFT'],
    ['CARD_MODERN_ANTIBIOTIC', 13, 'E_MOD_HEALER_NODE_1', 'delay', 'D_MOD_HEALER_DELAY', 'A_MOD_HEALER_DEATH_DELAY'],
    ['CARD_MODERN_FLASHLIGHT', 5, 'E_MOD_FLASHLIGHT_EVIDENCE', 'flashlight_robbery', 'D_MOD_FLASHLIGHT_ROBBERY', 'A_MOD_FLASHLIGHT_DEATH_ROBBERY'],
  ])('unlocks the earned death achievement for %s', (card, seed, event, option, death, achievement) => {
    const run = play(routeContent, seed, card, 1655, { [event]: option }, event);
    const dice = run.logs.find(log => log.type === 'dice' && log.source_id === event);
    expect(dice?.type === 'dice' && dice.data.success).toBe(false);
    expect(run.result.state.status).toBe('ENDED');
    expect(run.logs.some(log => log.type === 'death' && log.source_id === death)).toBe(true);
    expect(run.result.state.player.achievements).toContain(achievement);
  });

  it.each([
    ['CARD_MODERN_CORN', 208, 'E_MOD_CORN_BREAKTHROUGH', 'A_MOD_CORN_LEGACY'],
    ['CARD_MODERN_ANTIBIOTIC', 99, 'E_MOD_HEALER_BREAKTHROUGH', 'A_MOD_HEALER_LEGACY'],
    ['CARD_MODERN_FLASHLIGHT', 63, 'E_MOD_FLASHLIGHT_BREAKTHROUGH', 'A_MOD_FLASHLIGHT_BREAK_CRITICAL'],
  ])('awards the natural-20 breakthrough for %s', (card, seed, event, achievement) => {
    const run = play(routeContent, seed, card, 1655, {}, event);
    const dice = run.logs.find(log => log.type === 'dice' && log.source_id === event);
    expect(dice?.type === 'dice' && dice.data).toMatchObject({ raw: 20, success: true });
    expect(run.result.state.player.achievements).toContain(achievement);
  });

  it('uses the flashlight bonus in both preview and roll, without leaking across tags, and replays the roll', () => {
    const card = 'CARD_MODERN_FLASHLIGHT';
    const event = 'E_MOD_FLASHLIGHT_EVIDENCE';
    const withoutBonus = structuredClone(routeContent);
    delete withoutBonus.cards.find(item => item.id === card)!.check_bonus;
    const wrongTag = structuredClone(routeContent);
    wrongTag.cards.find(item => item.id === card)!.check_bonus!.tag = 'farming';
    const withPassive = seek(routeContent, 7, card, event);
    const without = seek(withoutBonus, 7, card, event);
    const other = seek(wrongTag, 7, card, event);
    const preview = (result: Success) => {
      if (result.pending?.kind !== 'option') throw new Error('Expected option');
      const check = result.pending.options.find(item => item.id === 'flashlight_check')?.checks[0];
      if (!check) throw new Error('Missing flashlight check');
      return check;
    };
    const boosted = preview(withPassive.result);
    expect(boosted.modifier_after).toBe(preview(without.result).modifier_after + 1);
    expect(preview(other.result).modifier_after).toBe(preview(without.result).modifier_after);
    const pending = withPassive.result.pending!;
    if (pending.kind !== 'option') throw new Error('Expected option');
    const chosen = ok(withPassive.engine.resolveOption('choose:passive', pending.event_instance_id, 'flashlight_check'));
    if (chosen.pending?.kind !== 'stage') throw new Error('Expected stage');
    const restored = new GameEngine(routeContent, fingerprint);
    restored.restoreSave(JSON.parse(JSON.stringify(withPassive.engine.exportSave())));
    const result = ok(withPassive.engine.resolveStage('roll:passive', chosen.pending.event_instance_id, chosen.pending.stage_id));
    expect(restored.resolveStage('roll:passive', chosen.pending.event_instance_id, chosen.pending.stage_id)).toEqual(result);
    const dice = result.logs.find(log => log.type === 'dice');
    expect(dice?.type === 'dice' && dice.data).toMatchObject({ modifier_after: boosted.modifier_after, success_probability: boosted.success_probability });
  });

  it('previews the check after the selected option changes intelligence', () => {
    const { engine, result } = seek(routeContent, 12, 'CARD_MODERN_ANTIBIOTIC', 'E_MOD_HEALER_NODE_2');
    const pending = result.pending;
    if (pending?.kind !== 'option') throw new Error('Expected option');
    const check = pending.options.find(item => item.id === 'train')?.checks[0];
    expect(check?.attribute_value).toBe(result.state.player.attributes.intelligence + 3);
    const chosen = ok(engine.resolveOption('choose:training', pending.event_instance_id, 'train'));
    if (chosen.pending?.kind !== 'stage') throw new Error('Expected stage');
    expect(chosen.pending.check).toEqual(check);
    const rolled = ok(engine.resolveStage('roll:training', chosen.pending.event_instance_id, chosen.pending.stage_id));
    const dice = rolled.logs.find(log => log.type === 'dice');
    expect(dice?.type === 'dice' && dice.data).toMatchObject({ attribute_value: check!.attribute_value, success_probability: check!.success_probability });
  });

  it('enforces the authored 11/12 ability boundary and retains a safe fallback', () => {
    const { result } = start(routeContent, 208, 'CARD_MODERN_CORN');
    const base = conditionContext(result.state.player, 'historical');
    const cases = [
      ['E_MOD_CORN_BREAKTHROUGH', 'corn_promote', 'F_MOD_CORN_PRACTICE', 'intelligence'],
      ['E_MOD_HEALER_BREAKTHROUGH', 'spread', 'F_MOD_HEALER_READY', 'intelligence'],
      ['E_MOD_FLASHLIGHT_BREAKTHROUGH', 'flashlight_break_body', 'F_MOD_FLASHLIGHT_READY', 'physique'],
    ] as const;
    for (const [eventId, optionId, flag, attribute] of cases) {
      const event = routeContent.events.find(item => item.id === eventId)!;
      if (event.interaction !== 'choice') throw new Error('Expected breakthrough choice');
      const option = event.options.find(item => item.id === optionId)!;
      const card = builds.find(item => eventId.includes(item.prefix.split('_OPEN_')[0]!))?.card
        ?? (eventId.includes('HEALER') ? 'CARD_MODERN_ANTIBIOTIC' : eventId.includes('FLASHLIGHT') ? 'CARD_MODERN_FLASHLIGHT' : 'CARD_MODERN_CORN');
      const context = { ...base, cards: [card], flags: [flag], calendar_year: 1644, prestige: 8, intelligence: 0, physique: 0, [attribute]: 11 };
      expect(evaluateCondition(option.condition, context)).toBe(false);
      expect(evaluateCondition(option.condition, { ...context, [attribute]: 12 })).toBe(true);
      expect(event.options.some(item => item.risk === 'safe' && evaluateCondition(item.condition, context))).toBe(true);
    }
  });
});
