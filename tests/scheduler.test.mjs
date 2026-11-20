import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { scenario, drawInProduction } from './family-harness.mjs';
import { scheduleWeightedEvents } from '../src/game/core/engine/EventScheduler.ts';
import { Mulberry32 } from '../src/game/core/engine/RandomSource.ts';

const production = await loadContent();
function event(id, priority = 0) {
  return { id, title: id, text: id, interaction: 'automatic', outcome: { text: id, effects: [], next_stage_id: null },
    trigger: { kind: 'random', weight: 1, priority, trigger_probability: 1, cooldown_years: 2, max_occurrences: 1, rare: false } };
}
function initialized() {
  const run = scenario(production, []);
  run.start();
  return run.engine.exportSave().payload;
}

test('priority filters lower-priority events before weighted sampling', () => {
  const content = structuredClone(production);
  content.events = [event('E_TEST_LOW'), event('E_TEST_HIGH', 1)];
  content.events[0].trigger.weight = 100000;
  const { player, run } = initialized();
  for (let seed = 0; seed < 20; seed++) {
    const draw = drawInProduction(content, player, run, seed);
    assert.deepEqual(draw.queue.map(x => x.event_id), ['E_TEST_HIGH']);
    assert.equal(draw.logs[0].candidates.find(x => x.event_id === 'E_TEST_LOW').reason, 'LOWER_PRIORITY');
  }
});

test('scheduler rejects exhausted occurrences, inclusive cooldown, and impossible probability', () => {
  const content = structuredClone(production);
  content.events = [event('E_TEST_MAX'), event('E_TEST_COOLDOWN'), event('E_TEST_NEVER')];
  content.events[2].trigger.trigger_probability = 0;
  const { player, run } = initialized();
  run.event_counts.E_TEST_MAX = 1;
  run.cooldowns.E_TEST_COOLDOWN = player.calendar_year;
  const draw = drawInProduction(content, player, run, 1);
  assert.deepEqual(draw.queue, []);
  const candidates = draw.logs[0].candidates;
  assert.equal(candidates.find(x => x.event_id === 'E_TEST_MAX').reason, 'MAX_OCCURRENCES');
  assert.equal(candidates.find(x => x.event_id === 'E_TEST_COOLDOWN').reason, 'COOLDOWN');
  assert.equal(candidates.find(x => x.event_id === 'E_TEST_NEVER').gate_passed, false);
  player.calendar_year++;
  assert.deepEqual(drawInProduction(content, player, run, 1).queue.map(x => x.event_id), ['E_TEST_COOLDOWN']);
});

test('family annual draw respects the original one-event random budget', () => {
  const content = structuredClone(production);
  content.events = [event('E_TEST_A'), event('E_TEST_B'), event('E_TEST_C')];
  const { player, run } = initialized();
  assert.equal(content.rules.events.per_year, 1);
  const queue = scheduleWeightedEvents(content, player, run, 'random', new Mulberry32(3), () => true, () => {});
  assert.equal(queue.length, 1);
});
