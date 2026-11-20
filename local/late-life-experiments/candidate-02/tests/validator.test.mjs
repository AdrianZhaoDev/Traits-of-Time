import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { validateContent } from '../src/game/core/content/ContentValidator.ts';
import { evaluateCondition } from '../src/game/core/engine/ConditionEvaluator.ts';
const content = await loadContent();

test('validator rejects unknown event fields rather than silently accepting dead configuration', () => {
  const changed = structuredClone(content);
  changed.events[0].effects = [];
  const result = validateContent(changed);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(x => x.file === 'events.json'));
});

test('validator rejects a dangling death reference', () => {
  const changed = structuredClone(content);
  const event = changed.events.find(x => x.interaction === 'automatic');
  event.outcome = { text: '回归验证', effects: [{ type: 'death', id: 'D_TEST_DOES_NOT_EXIST' }], next_stage_id: null };
  const result = validateContent(changed);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(x => x.code === 'MISSING_REFERENCE' && x.message.includes('D_TEST_DOES_NOT_EXIST')));
});

test('validator rejects a dangling local D20 stage and duplicate event ID', () => {
  const changed = structuredClone(content);
  const event = changed.events.find(x => x.interaction === 'automatic');
  event.outcome.next_stage_id = 'STAGE_TEST_DOES_NOT_EXIST';
  changed.events.push(structuredClone(event));
  const result = validateContent(changed);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(x => x.code === 'DUPLICATE_ID'));
  assert.ok(result.issues.some(x => x.code === 'MISSING_REFERENCE'));
});

test('condition combinations distinguish history flags from current family state', () => {
  const state = { age: 40, wealth: 6, flags: ['F_FAM_WIDOWED'], cards: [], injuries: [], active_chains: [], completed_chains: [] };
  const condition = { op: 'all', conditions: [
    { op: 'has', collection: 'flags', id: 'F_FAM_WIDOWED' },
    { op: 'not', condition: { op: 'has', collection: 'flags', id: 'F_FAM_MARRIED' } },
    { op: 'any', conditions: [{ op: 'compare', field: 'wealth', comparator: 'gte', value: 6 }, { op: 'compare', field: 'age', comparator: 'gte', value: 55 }] },
  ] };
  assert.equal(evaluateCondition(condition, state), true);
  assert.equal(evaluateCondition(condition, { ...state, flags: [...state.flags, 'F_FAM_MARRIED'] }), false);
  assert.equal(evaluateCondition(condition, { ...state, wealth: 5 }), false);
  assert.equal(evaluateCondition(condition, { ...state, wealth: 5, age: 55 }), true);
});
