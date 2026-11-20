import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { evaluateCondition, conditionContext } from '../src/game/core/engine/ConditionEvaluator.ts';
import { validateContent } from '../src/game/core/content/ContentValidator.ts';

const production = await loadContent();
const outcome = (effects) => ({ text: '回归结果', effects, next_stage_id: null });
const flag = id => ({ type: 'flag_add', id });
const has = id => ({ op: 'has', collection: 'flags', id });
function fixture(events, flags = []) {
  const c = structuredClone(production);
  c.events = events;
  c.chains = [];
  c.achievements = [];
  c.rules.age_bands = [{ id: 'adult', min: 25, max: 25, weight: 1, modifiers: {} }];
  c.rules.opening.year_min = c.rules.opening.year_max = 1700;
  c.rules.lifespan = { min: 70, max: 70, min_remaining_years: 3 };
  c.era.age_transitions = [];
  for (const b of c.era.backgrounds) b.flags = [...flags];
  for (const entry of [...c.castes, ...c.regions]) entry.flags = [];
  return c;
}
function automatic(id, condition, effects) {
  return { id, title: id, text: id, condition, interaction: 'automatic',
    trigger: { kind: 'random', weight: 1, priority: 0, trigger_probability: 1, cooldown_years: 0, max_occurrences: 1, rare: false }, outcome: outcome(effects) };
}
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result.error)); return result; }
function begin(content, seed = 1) {
  const engine = new GameEngine(content, 'regression');
  const initialized = ok(engine.initGame({ seed }));
  return { engine, result: ok(engine.selectCard('card', initialized.pending.cards[0])) };
}

test('production schema and semantic references', () => {
  const result = validateContent(production);
  assert.deepEqual(result.issues, []);
});

test('automatic scheduler executes marriage, bereavement, remarriage without choices', () => {
  const married = 'F_TEST_MARRIED', widowed = 'F_TEST_WIDOWED', remarried = 'F_TEST_REMARRIED';
  const events = [
    automatic('E_TEST_MARRY', { op: 'all', conditions: [{ op: 'not', condition: has(married) }, { op: 'not', condition: has(widowed) }] }, [flag(married)]),
    automatic('E_TEST_WIDOW', has(married), [{ type: 'flag_remove', id: married }, flag(widowed)]),
    automatic('E_TEST_REMARRY', { op: 'all', conditions: [has(widowed), { op: 'not', condition: has(married) }] }, [flag(married), flag(remarried)]),
  ];
  const { engine, result } = begin(fixture(events));
  assert.deepEqual(result.state.player.flags, [married]);
  const bereaved = ok(engine.nextYear('year1'));
  assert.deepEqual(bereaved.state.player.flags, [widowed]);
  assert.equal(evaluateCondition(events[0].condition, conditionContext(bereaved.state.player, 'fictional')), false);
  const renewed = ok(engine.nextYear('year2'));
  assert.deepEqual(new Set(renewed.state.player.flags), new Set([married, widowed, remarried]));
  assert.equal(renewed.pending, null);
  assert.equal(engine.exportSave().payload.logs.filter(x => x.type === 'option').length, 0);
  assert.equal(engine.exportSave().payload.logs.filter(x => x.type === 'event').length, 3);
});

test('automatic D20 stages use real seeded rolls and branch effects; natural 1/20 are respected', () => {
  const event = automatic('E_TEST_DICE', undefined, []);
  event.outcome.next_stage_id = 'S_TEST';
  event.stages = [{ id: 'S_TEST', text: '检定', check: { attribute: 'intelligence', dc: 14, modifier: 0 },
    success: outcome([flag('F_SUCCESS')]), failure: outcome([flag('F_FAILURE')]), critical_success: outcome([flag('F_CRITICAL')]) }];
  const seen = new Set();
  for (let seed = 0; seed < 300 && seen.size < 4; seed++) {
    const { engine, result } = begin(fixture([event]), seed);
    assert.equal(result.pending.kind, 'stage');
    const p = result.pending;
    const resolved = ok(engine.resolveStage('roll', p.event_instance_id, p.stage_id));
    const dice = resolved.logs.find(x => x.type === 'dice').data;
    const expected = dice.raw === 20 ? 'F_CRITICAL' : dice.success ? 'F_SUCCESS' : 'F_FAILURE';
    assert.deepEqual(resolved.state.player.flags, [expected]);
    if (dice.raw === 1) { assert.equal(dice.success, false); seen.add('natural1'); }
    if (dice.raw === 20) { assert.equal(dice.success, true); seen.add('natural20'); }
    seen.add(dice.success ? 'success' : 'failure');
    assert.equal(resolved.logs.some(x => x.type === 'option'), false);
    assert.equal(resolved.state.status, 'READY');
  }
  assert.deepEqual(seen, new Set(['natural1', 'natural20', 'success', 'failure']));
});

test('automatic death ends once, preserves final state, rejects future years', () => {
  const id = production.era.old_age_death_id;
  const { engine, result } = begin(fixture([automatic('E_TEST_DEATH', undefined, [{ type: 'death', id }])]));
  assert.equal(result.state.status, 'ENDED');
  assert.equal(result.logs.filter(x => x.type === 'death').length, 1);
  assert.equal(engine.generateEndingReport().death_id, id);
  assert.equal(engine.nextYear('after-death').ok, false);
  assert.equal(engine.current().state.player.age, 25);
});

test('complete production lives retain one-to-five successful major choices across deterministic strategies', (t) => {
  const samples = [];
  const violations = [];
  for (const strategy of ['normal', 'cautious', 'risky', 'career']) for (let seed = 0; seed < 100; seed++) {
    const { engine } = begin(production, seed);
    let commands = 0;
    while (engine.current().state.status !== 'ENDED') {
      assert.ok(commands < 600, `non-terminating seed=${seed}, strategy=${strategy}`);
      const { pending } = engine.current();
      const id = `step:${commands++}`;
      if (pending?.kind === 'option') {
        const available = pending.options.filter(x => x.available);
        assert.ok(available.length);
        const ranked = strategy === 'cautious' || strategy === 'risky'
          ? [...available].sort((a, b) => ({ safe: 0, normal: 1, high: 2 }[a.risk]) - ({ safe: 0, normal: 1, high: 2 }[b.risk])) : available;
        const definition = production.events.find(event => event.id === pending.event_id);
        const career = available.find(option => definition?.interaction === 'choice' && definition.options.find(o => o.id === option.id)?.outcome.effects.some(effect => effect.type === 'chain_start'));
        const option = strategy === 'risky' ? ranked.at(-1) : strategy === 'career' ? career ?? ranked[0] : ranked[0];
        ok(engine.resolveOption(id, pending.event_instance_id, option.id));
      } else if (pending?.kind === 'stage') ok(engine.resolveStage(id, pending.event_instance_id, pending.stage_id));
      else ok(engine.nextYear(id));
    }
    const logs = engine.exportSave().payload.logs;
    const choices = logs.filter(x => x.type === 'option');
    if (choices.length < 1 || choices.length > 5) violations.push({ seed, strategy, choices: choices.map(log => ({ id: log.source_id, age: log.age, option: log.data.option_id })) });
    assert.equal(choices.filter(x => x.source_id.startsWith('E_FAM_')).length, 0);
    assert.equal(logs.filter(x => x.type === 'death').length, 1);
    samples.push({ strategy, seed, choices: choices.length, startAge: engine.generateEndingReport().start_age,
      endAge: engine.generateEndingReport().end_age, death: engine.generateEndingReport().death_id,
      familyEvents: logs.filter(x => x.type === 'event' && x.source_id.startsWith('E_FAM_')).length });
  }
  for (const strategy of ['normal', 'cautious', 'risky', 'career']) {
    const group = samples.filter(x => x.strategy === strategy);
    const counts = group.map(x => x.choices).sort((a, b) => a - b);
    t.diagnostic(JSON.stringify({ strategy, lives: group.length, choicesMin: counts[0], choicesMax: counts.at(-1),
      choicesP50: counts[49], choicesP90: counts[89], earlyDeathsBefore40: group.filter(x => x.endAge < 40).length,
      familyEvents: group.reduce((sum, x) => sum + x.familyEvents, 0),
      deaths: Object.fromEntries([...new Set(group.map(x => x.death))].map(id => [id, group.filter(x => x.death === id).length])) }));
  }
  assert.deepEqual(violations, [], JSON.stringify(violations));
});
