import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { conditionContext, evaluateCondition } from '../src/game/core/engine/ConditionEvaluator.ts';
import { successful } from './family-harness.mjs';

const content = await loadContent();
const quota = 'F_LIFE_HISTORICAL_TURN_USED';
const cards = { CORN: 'CARD_MODERN_CORN', HEALER: 'CARD_MODERN_ANTIBIOTIC', FLASHLIGHT: 'CARD_MODERN_FLASHLIGHT' };
function start(family, year, seed = 1, spent = false) {
  const bundle = structuredClone(content);
  // Keep the selected production arc intact, removing unrelated competition only.
  bundle.events = bundle.events.filter(e => e.id.startsWith(`E_MOD_${family}_`));
  bundle.rules.age_bands = [{ id: 'adult', min: 30, max: 30, weight: 1, modifiers: {} }];
  bundle.rules.opening.year_min = bundle.rules.opening.year_max = year;
  bundle.rules.lifespan = { min: 100, max: 100, min_remaining_years: 1 };
  bundle.era.age_transitions = [];
  for (const source of [...bundle.castes, ...bundle.regions]) { source.flags = []; source.modifiers = {}; }
  for (const source of bundle.era.backgrounds) {
    source.flags = spent ? [quota] : [];
    source.modifiers = { intelligence: 7, prestige: 7, wealth: 7, physique: 0 };
  }
  bundle.pools.find(pool => pool.id === bundle.rules.opening.pool_id).entries = [{ card_id: cards[family], weight: 1 }];
  const engine = new GameEngine(bundle, `budget:${family}:${year}`);
  successful(engine.initGame({ seed }));
  successful(engine.selectCard('card', cards[family]));
  let command = 0;
  while (!engine.current().pending || engine.current().pending.kind === 'stage') {
    assert.ok(command < 60, `${family}/${year}: breakthrough never became available`);
    const pending = engine.current().pending;
    if (pending?.kind === 'stage') successful(engine.resolveStage(`progress:${command++}`, pending.event_instance_id, pending.stage_id));
    else {
      if (spent && engine.current().state.player.calendar_year >= (year >= 1643 ? 1644 : 1640)) break;
      successful(engine.nextYear(`year:${command++}`));
    }
  }
  return engine;
}
function settle(engine, prefix) {
  for (let index = 0; engine.current().pending?.kind === 'stage'; index++) {
    assert.ok(index < 20);
    const pending = engine.current().pending;
    successful(engine.resolveStage(`${prefix}:${index}`, pending.event_instance_id, pending.stage_id));
  }
}
function* objects(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value;
  for (const child of Object.values(value)) yield* objects(child);
}

for (const family of Object.keys(cards)) for (const year of [1634, 1643, 1644]) {
  test(`${family}/${year}: real normal or fast progression reaches exactly one explicit breakthrough`, () => {
    const engine = start(family, year);
    const pending = engine.current().pending;
    assert.equal(pending.kind, 'option');
    assert.equal(pending.event_id, `E_MOD_${family}_BREAKTHROUGH`);
    const payload = engine.exportSave().payload;
    assert.equal(payload.logs.filter(log => log.type === 'option').length, 0);
    const progressed = payload.logs.filter(log => log.type === 'event' && (year >= 1643 ? log.source_id.includes('_FAST_') : content.events.find(event => event.id === log.source_id)?.trigger.kind === 'chain'));
    assert.equal(progressed.length, 3);
    if (year >= 1643) assert.equal(payload.logs.filter(log => log.type === 'event' && content.events.find(event => event.id === log.source_id)?.trigger.kind === 'chain').length, 0, 'fast opening must not also award normal chain growth');
    assert.equal(payload.logs.some(log => log.type === 'death'), false);
    if (family === 'HEALER') {
      assert.ok(payload.player.flags.includes('F_MOD_HEALER_COURSE_AVAILABLE'));
      assert.equal(payload.player.flags.includes('F_MOD_HEALER_COURSE_USED'), false);
    }
    for (const option of pending.options.filter(option => option.available)) {
      const branch = engine.createReplayEngine();
      branch.restoreSave(engine.exportSave());
      const before = branch.current().state.player.attributes;
      const result = successful(branch.resolveOption(`choose:${option.id}`, pending.event_instance_id, option.id));
      assert.ok(result.state.player.flags.includes(quota), `${option.id}: quota must precede dice`);
      if (family === 'HEALER' && option.id === 'use_course') {
        assert.ok(result.state.player.flags.includes('F_MOD_HEALER_COURSE_USED'));
        assert.equal(result.state.player.flags.includes('F_MOD_HEALER_COURSE_AVAILABLE'), false);
        assert.deepEqual(result.state.player.attributes, before, 'automatic growth must not be paid twice when handing over medicine');
      }
      const context = conditionContext(result.state.player, result.state.timeline);
      for (const other of content.events.filter(e => e.interaction === 'choice' && [...objects(e.condition)].some(node => node.id === quota))) {
        assert.equal(evaluateCondition(other.condition, context), false, `${option.id} must exclude ${other.id}`);
      }
      settle(branch, `choice-stage:${option.id}`);
      assert.equal(branch.exportSave().payload.logs.filter(log => log.type === 'option').length, 1);
    }
    const blocked = start(family, year, 1, true);
    assert.notEqual(blocked.current().pending?.kind, 'option');
    assert.equal(blocked.exportSave().payload.logs.filter(log => log.type === 'option').length, 0);
  });
}

for (const family of Object.keys(cards)) test(`${family}: migrated lethal outcomes remain reachable only after an explicit choice`, () => {
  const event = content.events.find(e => e.id === `E_MOD_${family}_BREAKTHROUGH`);
  const required = new Set([...objects(event)].filter(node => node.type === 'death').map(node => node.id));
  assert.ok(required.size > 0);
  const observed = new Set();
  for (let seed = 0; seed < 100 && observed.size < required.size; seed++) {
    const engine = start(family, 1634, seed);
    const pending = engine.current().pending;
    for (const option of pending.options.filter(option => option.available)) {
      const branch = engine.createReplayEngine();
      branch.restoreSave(engine.exportSave());
      successful(branch.resolveOption(`danger:${option.id}`, pending.event_instance_id, option.id));
      settle(branch, `danger-stage:${option.id}`);
      const logs = branch.exportSave().payload.logs;
      for (const death of logs.filter(log => log.type === 'death')) {
        observed.add(death.data.death_id);
        assert.ok(logs.find(log => log.type === 'option').seq < death.seq);
      }
    }
  }
  assert.deepEqual([...observed].sort(), [...required].sort());
});
