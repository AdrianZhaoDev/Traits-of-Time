import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { scenario, eligible, resolveAutomatic, drawInProduction } from './family-harness.mjs';
import { evaluateCondition } from '../src/game/core/engine/ConditionEvaluator.ts';

const content = await loadContent();
const family = content.events.filter(x => x.id.startsWith('E_FAM_'));

// Generate satisfying condition states from the actual boolean tree, including NOT.
// These are targeted fixtures, not claims that all flags are reachable in a random life.
function alternatives(condition, negated = false) {
  if (!condition) return [[]];
  if (condition.op === 'not') return alternatives(condition.condition, !negated);
  if (condition.op === 'all' || condition.op === 'any') {
    const conjunction = (condition.op === 'all') !== negated;
    const children = condition.conditions.map(c => alternatives(c, negated));
    return conjunction ? children.reduce((states, choices) => states.flatMap(s => choices.map(c => [...s, ...c])), [[]]) : children.flat();
  }
  return [[{ condition, negated }]];
}
function witness(event) {
  for (const terms of alternatives(event.condition)) {
    const state = { age: 30, calendar_year: 1700, start_year: 1700, wealth: 8, prestige: 8, physique: 8, intelligence: 8, luck: 10,
      flags: [], cards: [], injuries: [], active_chains: [], completed_chains: [], timeline: 'fictional', region_id: content.regions[0].id, caste_id: content.castes[0].id, identity_id: content.era.identities[0].id };
    for (const { condition: c, negated } of terms) if (c.op === 'has' && !negated) state[c.collection].push(c.id);
    let possible = true;
    for (const field of ['age', 'wealth', 'prestige', 'physique', 'intelligence', 'luck']) {
      const constraints = terms.filter(t => t.condition.op === 'compare' && t.condition.field === field);
      const min = field === 'age' ? 3 : 0, max = field === 'age' ? 104 : 20;
      const values = Array.from({ length: max - min + 1 }, (_, i) => i + min);
      const value = values.find(value => constraints.every(({ condition, negated }) => evaluateCondition(condition, { ...state, [field]: value }) !== negated));
      if (value === undefined) { possible = false; break; }
      if (constraints.length) state[field] = value;
    }
    if (possible && evaluateCondition(event.condition, state)) return state;
  }
  throw new Error(`No bounded condition witness for ${event.id}`);
}

for (const event of family) test(`production family event executes through real scheduler: ${event.id}`, () => {
  const state = witness(event);
  let executed = false;
  for (let seed = 0; seed < 300 && !executed; seed++) {
    const run = scenario(content, [event], { ...state, seed });
    if (!state.active_chains.length) assert.equal(eligible(event, run.before), true, `${event.id}: initializer differs from witness`);
    let result = run.start();
    result = resolveAutomatic(run.engine, result);
    const logs = run.engine.exportSave().payload.logs;
    if (!logs.some(x => x.type === 'event' && x.source_id === event.id)) continue;
    executed = true;
    assert.equal(logs.some(x => x.type === 'option'), false);
    assert.equal(logs.filter(x => x.type === 'event' && x.source_id === event.id).length, 1);
    assert.equal(logs.some(x => x.type === 'effects' && x.source_id === event.id), true);
    for (const value of Object.values(result.state.player.attributes)) assert.ok(value >= 0 && value <= 20);
    if (result.state.status === 'ENDED') assert.equal(logs.filter(x => x.type === 'death').length, 1);
  }
  assert.ok(executed, `${event.id}: never selected in isolated real scheduler`);
});

test('poor and wealthy family content remains selectable against the full production random pool', () => {
  assert.ok(family.length);
  for (const wealth of [0, 1, 6, 12, 20]) {
    const run = scenario(content, [], { age: 25, wealth, prestige: 0 });
    run.start();
    const saved = run.engine.exportSave().payload;
    // A start-direction turn is already used, so exclusive career-entry priorities do not mask ordinary life.
    saved.player.flags.push('F_LIFE_DIRECTION_TURN_USED', 'F_LIFE_HISTORICAL_TURN_USED');
    const selected = new Set();
    for (let seed = 0; seed < 500; seed++) {
      const draw = drawInProduction(content, saved.player, saved.run, seed);
      assert.ok(draw.queue.length <= content.rules.events.per_year);
      for (const entry of draw.queue) if (entry.event_id.startsWith('E_FAM_')) selected.add(entry.event_id);
    }
    assert.ok(selected.size > 0, `wealth=${wealth}: family content never selected in full production pool`);
  }
});
