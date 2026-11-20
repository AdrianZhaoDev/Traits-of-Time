import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { previewCheck, resolveCheck } from '../src/game/core/engine/DiceResolver.ts';
import { validateContent } from '../src/game/core/content/ContentValidator.ts';
import { validateStructure } from '../src/game/core/content/SchemaValidator.ts';

const content = await loadContent();
const rules = content.rules.check;
const check = (overrides = {}) => ({ attribute: 'intelligence', dc: 24, modifier: 1, ...overrides });
function roll(raw, stageCheck, attribute, luck, bonus = 0, checkRules = rules) {
  let draws = 0;
  const rng = { nextUint32() { draws++; return raw - 1; } };
  const result = resolveCheck(stageCheck, attribute, checkRules, luck, rng, bonus);
  assert.equal(draws, 1);
  assert.equal(result.raw, raw);
  return result;
}

test('dynamic raw gate yields the approved success rates and only applies when configured', () => {
  const gated = check({ raw_minimum: 10 });
  for (const [attribute, minimum, probability] of [
    [12, 10, 0.50], [15, 9, 0.60], [18, 7, 0.70], [20, 6, 0.75],
  ]) {
    const preview = previewCheck(gated, attribute, rules, 0);
    assert.equal(preview.effective_raw_minimum, minimum);
    assert.equal(preview.success_probability, probability);
  }
  for (const [attribute, minimum] of [[0, 10], [13, 10], [14, 9], [16, 8], [17, 8], [19, 7], [40, 6]]) {
    assert.equal(previewCheck(gated, attribute, rules, 0).effective_raw_minimum, minimum);
  }
  assert.equal(previewCheck(check(), 20, rules, 0).effective_raw_minimum, null);
  assert.equal(previewCheck(check({ raw_minimum: 7 }), 20, rules, 0).effective_raw_minimum, 6);
  for (const minimum of [1, 2, 5]) {
    assert.equal(previewCheck(check({ raw_minimum: minimum }), 0, rules, 0).effective_raw_minimum, minimum);
    assert.equal(previewCheck(check({ raw_minimum: minimum }), 20, rules, 0).effective_raw_minimum, minimum);
  }
});

test('luck thresholds are independent of both modifier caps and affect actual rolls', () => {
  const limited = check({ dc: 13, modifier: 3 });
  for (const [luck, expected] of [[0, 0], [9, 0], [10, 1], [14, 1], [15, 1], [19, 1], [20, 2]]) {
    const preview = previewCheck(limited, 0, rules, luck, 5);
    assert.equal(preview.modifier_before, 8);
    assert.equal(preview.modifier_after, 3);
    assert.equal(preview.luck_value, luck);
    assert.equal(preview.luck_bonus, expected);
  }
  assert.equal(roll(8, limited, 0, 19, 5).success, false);
  assert.equal(roll(8, limited, 0, 20, 5).success, true);
  const negative = check({ dc: 7, modifier: -3 });
  assert.equal(roll(8, negative, 0, 19, -5).success, false);
  const result = roll(8, negative, 0, 20, -5);
  assert.equal(result.modifier_before, -8);
  assert.equal(result.modifier_after, -3);
  assert.equal(result.luck_bonus, 2);
  assert.equal(result.success, true);
});

test('natural 1 and 20 take precedence; 19 is critical only after a normal success with enough luck', () => {
  const easy = check({ dc: -100 });
  const impossible = check({ dc: 100, raw_minimum: 20 });
  assert.deepEqual([roll(1, easy, 20, 20).success, roll(1, easy, 20, 20).critical_success], [false, false]);
  assert.deepEqual([roll(20, impossible, 0, 0).success, roll(20, impossible, 0, 0).critical_success], [true, true]);
  assert.deepEqual([roll(19, easy, 0, 14).success, roll(19, easy, 0, 14).critical_success], [true, false]);
  assert.deepEqual([roll(19, easy, 0, 15).success, roll(19, easy, 0, 15).critical_success], [true, true]);
  const failsDc = roll(19, check({ dc: 30, modifier: 0 }), 0, 20);
  assert.equal(failsDc.success, false);
  assert.equal(failsDc.critical_success, false);
  const failsGate = roll(19, check({ dc: -100, raw_minimum: 20 }), 12, 20);
  assert.equal(failsGate.success, false);
  assert.equal(failsGate.critical_success, false);
  assert.equal(previewCheck(easy, 0, rules, 14).critical_probability, 0.05);
  assert.equal(previewCheck(easy, 0, rules, 15).critical_probability, 0.10);
  assert.equal(previewCheck(impossible, 0, rules, 20).critical_probability, 0.05);
  assert.equal(previewCheck(check({ dc: -100, raw_minimum: 20 }), 12, rules, 20).critical_probability, 0.05);
});

test('preview probabilities agree with all twenty individually resolved outcomes', () => {
  for (const stageCheck of [check(), check({ raw_minimum: 5 }), check({ raw_minimum: 10 }), check({ dc: 50, raw_minimum: 20 })]) {
    for (const attribute of [0, 12, 14, 18, 20]) for (const luck of [0, 9, 10, 14, 15, 19, 20]) for (const bonus of [-5, 0, 5]) {
      const preview = previewCheck(stageCheck, attribute, rules, luck, bonus);
      let successes = 0;
      let criticals = 0;
      for (let raw = 1; raw <= 20; raw++) {
        const result = roll(raw, stageCheck, attribute, luck, bonus);
        assert.equal(result.luck_value, luck);
        assert.equal(result.luck_bonus, preview.luck_bonus);
        assert.equal(result.modifier_before, preview.modifier_before);
        assert.equal(result.modifier_after, preview.modifier_after);
        assert.equal(result.effective_raw_minimum, preview.effective_raw_minimum);
        assert.equal(result.success_probability, preview.success_probability);
        assert.equal(result.critical_probability, preview.critical_probability);
        assert.ok(!result.critical_success || result.success);
        successes += Number(result.success);
        criticals += Number(result.critical_success);
      }
      assert.equal(preview.success_probability, successes / 20);
      assert.equal(preview.critical_probability, criticals / 20);
    }
  }
});

test('increasing the strategy attribute never reduces success chance across gate types', () => {
  for (const rawMinimum of [undefined, 1, 5, 6, 10, 20]) for (const luck of [0, 10, 15, 20]) for (const dc of [12, 24, 35]) {
    const stageCheck = check({ dc, ...(rawMinimum === undefined ? {} : { raw_minimum: rawMinimum }) });
    let previous = 0;
    for (let attribute = 0; attribute <= 20; attribute++) {
      const chance = previewCheck(stageCheck, attribute, rules, luck).success_probability;
      assert.ok(chance >= previous, `gate ${rawMinimum}, luck ${luck}, DC ${dc}, attribute ${attribute}`);
      previous = chance;
    }
  }
});

test('dynamic and luck mechanics honor configured rule parameters', () => {
  const custom = { ...rules, dynamic_raw_minimum: { attribute_base: 8, attribute_step: 4, floor: 2 },
    luck_bonus_thresholds: [3, 9, 15], critical_luck_minimum: 7, critical_luck_raw: 18 };
  const stageCheck = check({ dc: 20, raw_minimum: 10 });
  const preview = previewCheck(stageCheck, 12, custom, 9);
  assert.equal(preview.effective_raw_minimum, 9);
  assert.equal(preview.luck_bonus, 2);
  assert.equal(roll(18, stageCheck, 12, 9, 0, custom).critical_success, true);
  assert.equal(roll(19, stageCheck, 12, 9, 0, custom).critical_success, false);
  assert.equal(roll(20, stageCheck, 0, 0, 0, custom).critical_success, true);
});

test('schema and semantic validation reject malformed dynamic and luck settings', () => {
  const fixture = () => ({ ...content, rules: structuredClone(content.rules), events: [], chains: [], achievements: [] });
  assert.deepEqual(validateStructure(fixture()), []);
  const cases = [
    [r => { r.dynamic_raw_minimum.attribute_step = 0; }, '/check/dynamic_raw_minimum/attribute_step', 'INVALID_COMBINATION'],
    [r => { r.dynamic_raw_minimum.attribute_step = -1; }, '/check/dynamic_raw_minimum/attribute_step', 'SCHEMA_INVALID'],
    [r => { r.dynamic_raw_minimum.floor = 0; }, '/check/dynamic_raw_minimum/floor', 'SCHEMA_INVALID'],
    [r => { r.dynamic_raw_minimum.floor = 21; }, '/check/dynamic_raw_minimum/floor', 'SCHEMA_INVALID'],
    [r => { r.luck_bonus_thresholds = []; }, '/check/luck_bonus_thresholds', 'SCHEMA_INVALID'],
    [r => { r.luck_bonus_thresholds = [10, 10]; }, '/check/luck_bonus_thresholds', 'INVALID_COMBINATION'],
    [r => { r.luck_bonus_thresholds = [20, 10]; }, '/check/luck_bonus_thresholds', 'INVALID_COMBINATION'],
    [r => { r.critical_luck_raw = 1; }, '/check/critical_luck_raw', 'SCHEMA_INVALID'],
    [r => { r.critical_luck_raw = 20; }, '/check/critical_luck_raw', 'SCHEMA_INVALID'],
    [r => { delete r.critical_luck_minimum; }, '/check/critical_luck_minimum', 'SCHEMA_INVALID'],
  ];
  for (const [mutate, path, code] of cases) {
    const changed = fixture();
    mutate(changed.rules.check);
    const result = validateContent(changed);
    assert.equal(result.ok, false, path);
    assert.ok(result.issues.some(issue => issue.file === 'rules.json' && issue.path === path && issue.code === code), JSON.stringify(result.issues));
  }
});
