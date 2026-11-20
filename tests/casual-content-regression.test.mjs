import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { successful } from './family-harness.mjs';

const content = await loadContent();

// Isolate the production breakthrough from competing events; its gates and outcomes remain unchanged.
function corn(seed) {
  const bundle = structuredClone(content);
  const event = bundle.events.find(item => item.id === 'E_MOD_CORN_BREAKTHROUGH');
  event.trigger = { kind: 'opening', weight: 1, trigger_probability: 1 };
  bundle.events = [event];
  bundle.rules.age_bands = [{ id: 'adult', min: 30, max: 30, weight: 1, modifiers: {} }];
  bundle.rules.opening.year_min = bundle.rules.opening.year_max = 1642;
  bundle.rules.lifespan = { min: 105, max: 105, min_remaining_years: 1 };
  bundle.era.age_transitions = [];
  for (const source of [...bundle.castes, ...bundle.regions]) { source.flags = []; source.modifiers = {}; }
  for (const background of bundle.era.backgrounds) {
    background.flags = ['F_MOD_CORN_READY', 'F_MOD_CORN_PRACTICE', 'F_MOD_CORN_TRIAL'];
    background.modifiers = { intelligence: 9, prestige: 5, wealth: 5 };
  }
  bundle.pools.find(pool => pool.id === bundle.rules.opening.pool_id).entries = [{ card_id: 'CARD_MODERN_CORN', weight: 1 }];
  const engine = new GameEngine(bundle, 'casual-corn-regression');
  successful(engine.initGame({ seed }));
  const start = successful(engine.selectCard('card', 'CARD_MODERN_CORN'));
  assert.equal(start.pending?.kind, 'option');
  return { engine, start };
}

function takeOption(run, optionId) {
  const pending = run.engine.current().pending;
  assert.equal(pending.options.find(option => option.id === optionId)?.available, true);
  const selected = successful(run.engine.resolveOption('choice', pending.event_instance_id, optionId));
  assert.equal(selected.pending?.kind, 'stage');
  return successful(run.engine.resolveStage('check', selected.pending.event_instance_id, selected.pending.stage_id));
}

test('failed corn promotion stays playable, costs only one wealth and reputation, and records the actual setback', () => {
  let failure;
  for (let seed = 0; seed < 60 && !failure; seed++) {
    const run = corn(seed);
    const result = takeOption(run, 'corn_promote');
    if (!result.logs.find(log => log.type === 'dice').data.success) failure = { before: run.start.state.player, result };
  }
  assert.ok(failure, 'the deterministic seeds must exercise promotion failure');
  const { before, result } = failure;
  assert.notEqual(result.state.status, 'ENDED');
  assert.equal(result.state.player.attributes.wealth, before.attributes.wealth - 1);
  assert.equal(result.state.player.attributes.prestige, before.attributes.prestige - 1);
  assert.ok(result.state.player.flags.includes('F_MOD_CORN_SETBACK'));
  assert.ok(result.state.player.achievements.includes('A_MOD_CORN_TRY_AGAIN'));
});

test('successful voluntary corn delivery gains reputation without deducting wealth', () => {
  let success;
  for (let seed = 0; seed < 60 && !success; seed++) {
    const run = corn(seed);
    const result = takeOption(run, 'corn_trial_risk');
    if (result.logs.find(log => log.type === 'dice').data.success) success = { before: run.start.state.player, result };
  }
  assert.ok(success, 'the deterministic seeds must exercise delivery success');
  const { before, result } = success;
  assert.notEqual(result.state.status, 'ENDED');
  assert.equal(result.state.player.attributes.prestige, before.attributes.prestige + 2);
  assert.equal(result.state.player.attributes.wealth, before.attributes.wealth);
  assert.equal(result.state.player.flags.includes('F_MOD_CORN_DEATH_THEFT'), false);
});
