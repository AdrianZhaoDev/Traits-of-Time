import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { conditionContext, evaluateCondition } from '../src/game/core/engine/ConditionEvaluator.ts';
import { scheduleWeightedEvents } from '../src/game/core/engine/EventScheduler.ts';
import { Mulberry32 } from '../src/game/core/engine/RandomSource.ts';

export function successful(result) {
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result;
}

// Isolate competition, not conditions/effects/stages: production events are copied unchanged.
export function scenario(content, events, { age = 25, flags = [], wealth = 8, prestige = 8, physique = 8, intelligence = 8, active_chains = [], seed = 1 } = {}) {
  const bundle = structuredClone(content);
  bundle.events = structuredClone(events);
  if (active_chains.length) bundle.events.unshift({
    id: 'E_TEST_CAREER_SETUP', title: '测试事业前提', text: '测试事业前提', interaction: 'automatic',
    trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
    outcome: { text: '初始化已授权事业', effects: active_chains.map(id => ({ type: 'chain_start', id })), next_stage_id: null },
  });
  bundle.era.age_transitions = [];
  bundle.rules.age_bands = [{ id: 'scenario', min: age, max: age, weight: 1, modifiers: {} }];
  bundle.rules.opening.year_min = bundle.rules.opening.year_max = 1700;
  bundle.rules.lifespan = { min: 105, max: 105, min_remaining_years: 1 };
  for (const source of [...bundle.regions, ...bundle.castes]) { source.modifiers = {}; source.flags = []; }
  for (const background of bundle.era.backgrounds) {
    background.flags = [...flags];
    background.modifiers = Object.fromEntries(Object.entries({ wealth, prestige, physique, intelligence, luck: 10 }).map(([key, value]) => [key, value - bundle.rules.attributes.base]));
  }
  const engine = new GameEngine(bundle, 'family-scenario');
  const init = successful(engine.initGame({ seed }));
  const before = engine.current().state.player;
  return { engine, before, start: () => successful(engine.selectCard('card', init.pending.cards[0])) };
}

export function eligible(event, player) {
  return evaluateCondition(event.condition, conditionContext(player, 'fictional'));
}

export function resolveAutomatic(engine, result, prefix = 'stage') {
  let count = 0;
  while (result.pending?.kind === 'stage') {
    assert.ok(count < 20, 'stage graph did not terminate');
    const pending = result.pending;
    result = successful(engine.resolveStage(`${prefix}:${count++}`, pending.event_instance_id, pending.stage_id));
  }
  assert.notEqual(result.pending?.kind, 'option', 'family event requested a choice');
  return result;
}

export function drawInProduction(content, player, run, seed) {
  const logs = [];
  const queue = scheduleWeightedEvents(content, player, run, 'random', new Mulberry32(seed),
    event => event.interaction === 'automatic' || event.options.some(option => evaluateCondition(option.condition, conditionContext(player, run.timeline))),
    (candidates, selected) => logs.push({ candidates, selected }));
  return { queue, logs };
}
