import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { scenario } from './family-harness.mjs';

const content = await loadContent();
const death = { id: 'E_TEST_FINAL', title: '测试终局', text: '测试终局', interaction: 'automatic',
  trigger: { kind: 'random', priority: 0, weight: 1, trigger_probability: 1, cooldown_years: 0, max_occurrences: 1, rare: false },
  outcome: { text: '测试终局', effects: [{ type: 'death', id: content.era.old_age_death_id }], next_stage_id: null } };

test('heirless ending checks current children, not only a historical heirless flag', () => {
  const without = scenario(content, [death], { age: 70, wealth: 10, flags: ['F_FAM_HEIRLESS'] });
  without.start();
  assert.equal(without.engine.generateEndingReport().primary_achievement_id, 'A_FAM_HEIRLESS');
  for (const child of ['F_FAM_CHILD_1', 'F_LIFE_HAS_CHILD']) {
    const withChild = scenario(content, [death], { age: 70, wealth: 10, flags: ['F_FAM_HEIRLESS', child] });
    withChild.start();
    assert.notEqual(withChild.engine.generateEndingReport().primary_achievement_id, 'A_FAM_HEIRLESS');
  }
});

test('family milestones do not end a life, while life-category awards wait until death', () => {
  const run = scenario(content, [], { age: 60, flags: ['F_FAM_MARRIED', 'F_FAM_WIDOWED', 'F_FAM_REMARRIED', 'F_FAM_CHILD_SUCCESS'] });
  const result = run.start();
  assert.equal(result.state.status, 'READY');
  assert.ok(result.state.player.achievements.includes('A_FAM_REMARRIED'));
  assert.ok(result.state.player.achievements.includes('A_FAM_CHILD_WELL_TAUGHT'));
  assert.equal(result.state.player.achievements.includes('A_FAM_LIFE_TOGETHER'), false);
  assert.throws(() => run.engine.generateEndingReport());
});
