import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';

const content = await loadContent();
const budget = 'F_LIFE_HISTORICAL_TURN_USED';
const progress = [
  'CORN_TRIAL', 'CORN_STORE', 'CORN_RELIEF', 'CORN_FAST_INVENTORY', 'CORN_FAST_DISTRIBUTE', 'CORN_FAST_ESCORT',
  'HEALER_NODE_1', 'HEALER_NODE_2', 'HEALER_NODE_3', 'HEALER_FAST_1', 'HEALER_FAST_2', 'HEALER_FAST_3',
  'FLASHLIGHT_EVIDENCE', 'FLASHLIGHT_PATROL', 'FLASHLIGHT_ESCORT', 'FLASHLIGHT_FAST_FRAUD', 'FLASHLIGHT_FAST_ROTA', 'FLASHLIGHT_FAST_EXIT',
].map(id => `E_MOD_${id}`);
function* nodes(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value;
  for (const child of Object.values(value)) yield* nodes(child);
}
function blocksUsed(condition, flag = budget) {
  if (!condition) return false;
  if (condition.op === 'not') return condition.condition.op === 'has' && condition.condition.collection === 'flags' && condition.condition.id === flag;
  if (condition.op === 'all') return condition.conditions.some(child => blocksUsed(child, flag));
  if (condition.op === 'any') return condition.conditions.length > 0 && condition.conditions.every(child => blocksUsed(child, flag));
  return false;
}

test('all eighteen modern progress nodes are automatic and never consume the major choice quota', () => {
  for (const id of progress) {
    const event = content.events.find(e => e.id === id);
    assert.ok(event, id);
    assert.equal(event.interaction, 'automatic', id);
    assert.ok(event.outcome, id);
    for (const node of nodes(event)) {
      assert.ok(!(node.type === 'flag_add' && node.id === budget), id);
      assert.notEqual(node.type, 'death', `${id}: automatic progress must not force migrated lethal risks`);
      assert.ok(!(node.type === 'flag_add' && node.id === 'F_MOD_HEALER_COURSE_USED'), `${id}: medicine cannot be spent automatically`);
      assert.ok(!(node.type === 'flag_remove' && node.id === 'F_MOD_HEALER_COURSE_AVAILABLE'), `${id}: medicine cannot be spent automatically`);
    }
  }
});

test('every modern breakthrough option consumes the same historical quota before any stage', () => {
  for (const family of ['CORN', 'HEALER', 'FLASHLIGHT']) {
    const id = `E_MOD_${family}_BREAKTHROUGH`;
    const event = content.events.find(e => e.id === id);
    assert.ok(event, id);
    assert.equal(event.interaction, 'choice');
    assert.ok(blocksUsed(event.condition), `${id}: every admission path must exclude spent quota`);
    assert.ok(event.options.length >= 2);
    for (const option of event.options) {
      assert.ok(option.outcome.effects.some(e => e.type === 'flag_add' && e.id === budget), `${id}/${option.id}: quota must be consumed before stage resolution`);
    }
  }
  for (const event of content.events) for (const node of nodes(event)) {
    assert.ok(!(node.type === 'flag_remove' && node.id === budget), `${event.id}: shared historical quota cannot reset`);
  }
});

test('medicine exhaustion is reachable only beneath an explicit healer choice', () => {
  let spendOptions = 0;
  for (const event of content.events.filter(e => e.id.startsWith('E_MOD_HEALER_'))) {
    const spends = [...nodes(event)].some(node => node.type === 'flag_add' && node.id === 'F_MOD_HEALER_COURSE_USED');
    if (!spends) continue;
    assert.equal(event.interaction, 'choice', event.id);
    assert.equal(event.id, 'E_MOD_HEALER_BREAKTHROUGH');
    for (const option of event.options) {
      const reachable = new Set();
      function visit(outcome) {
        if (outcome.effects.some(e => e.type === 'flag_add' && e.id === 'F_MOD_HEALER_COURSE_USED')) spendOptions++;
        if (!outcome.next_stage_id || reachable.has(outcome.next_stage_id)) return;
        reachable.add(outcome.next_stage_id);
        const stage = event.stages.find(s => s.id === outcome.next_stage_id);
        assert.ok(stage);
        visit(stage.success); visit(stage.failure);
        if (stage.critical_success) visit(stage.critical_success);
      }
      visit(option.outcome);
    }
  }
  assert.ok(spendOptions > 0, 'medicine expenditure must not become dead configuration');
});

test('all random and historical choices structurally spend a shared budget; chain choices occur only at endpoints', () => {
  for (const event of content.events.filter(e => e.interaction === 'choice')) {
    if (event.trigger.kind === 'random' || event.trigger.kind === 'historical') {
      const flags = ['F_LIFE_DIRECTION_TURN_USED', 'F_LIFE_HISTORICAL_TURN_USED'].filter(flag => blocksUsed(event.condition, flag));
      assert.ok(flags.length, `${event.id}: no exclusive budget admission gate`);
      for (const option of event.options) assert.ok(flags.some(flag => option.outcome.effects.some(effect => effect.type === 'flag_add' && effect.id === flag)), `${event.id}/${option.id}: quota not spent before routing`);
    }
    if (event.trigger.kind === 'chain') {
      const owners = content.chains.filter(chain => chain.nodes.some(node => node.event_id === event.id));
      assert.ok(owners.length, `${event.id}: orphan chain decision`);
      for (const chain of owners) assert.equal(chain.nodes.at(-1).event_id, event.id, `${event.id}: intermediate chain menu`);
    }
  }
});
