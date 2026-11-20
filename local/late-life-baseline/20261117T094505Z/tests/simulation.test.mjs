import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { chooseOption, longestGap, percentile, simulateLife } from '../tools/simulate.ts';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { Mulberry32, uniformInt } from '../src/game/core/engine/RandomSource.ts';
import { conditionContext, evaluateCondition } from '../src/game/core/engine/ConditionEvaluator.ts';

const content = await loadContent();
const outcome = effects => ({ text: '', effects, next_stage_id: null });
const definition = { id: 'E_STRATEGY', interaction: 'choice', trigger: { kind: 'random' }, options: [
  { id: 'z', outcome: outcome([]) },
  { id: 'a', outcome: outcome([{ type: 'chain_start', id: 'CH' }]) },
  { id: 'hidden', outcome: outcome([{ type: 'chain_start', id: 'CH' }]) },
] };
const pending = { kind: 'option', event_id: 'E_STRATEGY', event_instance_id: 'one', options: [
  { id: 'z', available: true, risk: 'high' },
  { id: 'a', available: true, risk: 'safe' },
  { id: 'hidden', available: false, risk: 'high' },
] };

test('strategies use only available options with deterministic ties and independent random index', () => {
  assert.equal(chooseOption(pending, definition, 'normal', () => 1).id, 'z');
  assert.equal(chooseOption(pending, definition, 'cautious', () => { throw Error('unexpected random draw'); }).id, 'a');
  assert.equal(chooseOption(pending, definition, 'risky', () => { throw Error('unexpected random draw'); }).id, 'z');
  assert.equal(chooseOption(pending, definition, 'career', () => { throw Error('unexpected random draw'); }).id, 'a');
});

test('gap and nearest-rank summaries count exposed years without duplication', () => {
  assert.equal(longestGap([10, 11, 11, 12, 13, 14], [11, 14]), 2);
  assert.equal(longestGap([], []), 0);
  assert.equal(percentile([9, 1, 3, 5], 0.5), 3);
  assert.equal(percentile([], 0.9), null);
});

const setups = [
  { event: 'E_MOD_CORN_BREAKTHROUGH', card: 'CARD_MODERN_CORN', flags: ['F_MOD_CORN_READY', 'F_MOD_CORN_PRACTICE', 'F_MOD_CORN_TRIAL', 'F_MOD_CORN_STORE', 'F_MOD_CORN_RELIEF'], advance: ['corn_late_promote'], dangerous: ['corn_promote', 'corn_trial_risk', 'corn_store_risk', 'corn_relief_risk'] },
  { event: 'E_MOD_HEALER_BREAKTHROUGH', card: 'CARD_MODERN_ANTIBIOTIC', flags: ['F_MOD_HEALER_READY', 'F_MOD_HEALER_BOUNDARY', 'F_MOD_HEALER_COURSE_AVAILABLE', 'F_MOD_HEALER_RELIEF'], advance: ['spread'], dangerous: ['delay', 'showoff'] },
  { event: 'E_MOD_FLASHLIGHT_BREAKTHROUGH', card: 'CARD_MODERN_FLASHLIGHT', flags: ['F_MOD_FLASHLIGHT_READY', 'F_MOD_FLASHLIGHT_MAIN_DONE', 'F_MOD_FLASHLIGHT_EVIDENCE', 'F_MOD_FLASHLIGHT_PATROL', 'F_MOD_FLASHLIGHT_ESCORT'], advance: ['flashlight_late_brain', 'flashlight_late_body'], dangerous: ['flashlight_break_brain', 'flashlight_break_body', 'flashlight_robbery', 'flashlight_claims', 'flashlight_misstep'] },
];

test('fictional late breakthroughs retain earned gates, shared budget and nonfatal advancement', () => {
  for (const setup of setups) {
    const event = content.events.find(item => item.id === setup.event);
    assert.ok(event && event.interaction === 'choice');
    const engine = new GameEngine(content, 'late-fixture');
    const initial = engine.initGame({ seed: 27 });
    assert.equal(initial.ok, true);
    const player = structuredClone(initial.state.player);
    player.calendar_year = 1660;
    player.cards = [setup.card];
    player.flags = [...setup.flags];
    Object.assign(player.attributes, { intelligence: 14, physique: 14, prestige: 10 });
    const fictional = conditionContext(player, 'fictional');
    assert.equal(evaluateCondition(event.condition, fictional), true, setup.event);
    for (const id of setup.advance) {
      const option = event.options.find(item => item.id === id);
      assert.ok(option, id);
      assert.equal(evaluateCondition(option.condition, fictional), true, id);
      assert.ok(option.outcome.effects.some(effect => effect.type === 'flag_add' && effect.id === 'F_LIFE_HISTORICAL_TURN_USED'));
      const stage = event.stages.find(item => item.id === option.outcome.next_stage_id);
      assert.ok(stage, id);
      for (const result of [stage.success, stage.failure, stage.critical_success].filter(Boolean)) {
        assert.ok(!result.effects.some(effect => effect.type === 'death'), id);
        assert.ok(!result.effects.some(effect => effect.type === 'attribute_add' && ['wealth', 'physique'].includes(effect.attribute) && effect.amount < 0), id);
      }
    }
    for (const id of setup.dangerous) {
      const option = event.options.find(item => item.id === id);
      assert.ok(option, id);
      assert.equal(evaluateCondition(option.condition, fictional), false, id);
      assert.equal(evaluateCondition(option.condition, conditionContext(player, 'historical')), true, `${id} historical`);
    }
    player.flags.push('F_LIFE_HISTORICAL_TURN_USED');
    assert.equal(evaluateCondition(event.condition, conditionContext(player, 'fictional')), false, `${setup.event} spent slot`);
  }
});

test('earned handoffs use relative elapsed years, completed or fast-track work, and no lethal outcomes', () => {
  const cases = [
    { event: 'E_MOD_CORN_LATE_HANDOFF', card: 'CARD_MODERN_CORN', chain: 'CHAIN_MOD_CORN_KING', fast: ['F_MOD_CORN_FAST_TWO', 'F_MOD_CORN_ESCORT'], abort: 'F_MOD_CORN_ABORT' },
    { event: 'E_MOD_HEALER_LATE_HANDOFF', card: 'CARD_MODERN_ANTIBIOTIC', chain: 'CHAIN_MOD_HEALER_SAGE', fast: ['F_MOD_HEALER_FAST_DONE'], abort: 'F_MOD_HEALER_ABORT' },
    { event: 'E_MOD_FLASHLIGHT_LATE_HANDOFF', card: 'CARD_MODERN_FLASHLIGHT', chain: 'CHAIN_MOD_FLASHLIGHT_DETECTIVE', fast: ['F_MOD_FLASHLIGHT_FAST_DONE'], abort: 'F_MOD_FLASHLIGHT_ABORT' },
  ];
  const engine = new GameEngine(content, 'handoff-fixture');
  const initialized = engine.initGame({ seed: 1 });
  assert.equal(initialized.ok, true);
  for (const item of cases) for (const startYear of [1628, 1639, 1645]) {
    const event = content.events.find(entry => entry.id === item.event);
    assert.ok(event && event.interaction === 'automatic');
    assert.equal(event.trigger.max_occurrences, 1);
    const player = structuredClone(initialized.state.player);
    player.cards = [item.card];
    player.start_year = startYear;
    player.calendar_year = startYear + 8;
    player.chains = [{ chain_id: item.chain, instance_id: 'fixture', status: 'completed', started_year: startYear, node_index: 3, next_due_year: null, interruption_reason: null }];
    assert.equal(conditionContext(player, 'fictional').years_elapsed, 8);
    assert.equal(evaluateCondition(event.condition, conditionContext(player, 'fictional')), false, item.event);
    player.calendar_year++;
    assert.equal(conditionContext(player, 'fictional').years_elapsed, 9);
    assert.equal(evaluateCondition(event.condition, conditionContext(player, 'fictional')), true, item.event);
    player.chains = [];
    assert.equal(evaluateCondition(event.condition, conditionContext(player, 'fictional')), false, `${item.event} unearned`);
    player.flags = [...item.fast];
    assert.equal(evaluateCondition(event.condition, conditionContext(player, 'fictional')), true, `${item.event} fast track`);
    player.flags.push(item.abort);
    assert.equal(evaluateCondition(event.condition, conditionContext(player, 'fictional')), false, `${item.event} withdrawn`);
    const stage = event.stages.find(entry => entry.id === event.outcome.next_stage_id);
    assert.ok(stage);
    for (const outcome of [event.outcome, stage.success, stage.failure, stage.critical_success].filter(Boolean)) {
      assert.ok(!outcome.effects.some(effect => effect.type === 'death'));
      assert.ok(!outcome.effects.some(effect => effect.type === 'attribute_add' && ['wealth', 'physique'].includes(effect.attribute) && effect.amount < 0));
    }
  }
});

test('natural opening seed 27 can carry earned corn development into fictional years', () => {
  const life = simulateLife(content, GameEngine, Mulberry32, uniformInt, 'normal', 27);
  assert.equal(life.card, 'CARD_MODERN_CORN');
  assert.equal(life.start_year, 1645);
  assert.ok(life.choices.some(choice => choice.event_id === 'E_MOD_CORN_BREAKTHROUGH' && choice.year >= 1645));
  assert.ok(life.choices.length >= 1 && life.choices.length <= 5);
});
