import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { conditionContext, evaluateCondition } from '../src/game/core/engine/ConditionEvaluator.ts';
import { scenario, eligible, resolveAutomatic, successful } from './family-harness.mjs';

const content = await loadContent();
const event = id => {
  const found = content.events.find(entry => entry.id === id);
  assert.ok(found, id);
  return found;
};

test('legacy child growth needs a living child with a provable minimum age', () => {
  const growth = event('E_LIFE_CHILD_SUCCESS');
  const flags = ['F_LIFE_HAS_CHILD', 'F_FAM_CHILD_1', 'F_FAM_CHILD_1_BIRTH_27_39'];
  const player = scenario(content, [growth], { age: 45, flags }).before;
  assert.equal(eligible(growth, player), false, 'a child born as late as age 39 may only be six');
  assert.equal(eligible(growth, { ...player, age: 46 }), true, 'the youngest possible child is now seven');
  assert.equal(eligible(growth, { ...player, age: 46, flags: [...flags, 'F_FAM_CHILD_1_DEAD'] }), false);
  assert.equal(eligible(growth, { ...player, age: 46, flags: ['F_LIFE_HAS_CHILD', 'F_FAM_CHILD_1'] }), false);
});

test('legacy grandchild play requires a recorded birth and a conservative age threshold', () => {
  const play = event('E_LIFE_SENIOR_GRANDCHILD');
  const player = scenario(content, [play], { age: 54, flags: ['F_FAM_GRANDCHILD'] }).before;
  for (const [birthFlag, tooYoung, oldEnough] of [
    ['F_FAM_CHILD_GRANDCHILD_BIRTH_LE50', 54, 55],
    ['F_FAM_CHILD_GRANDCHILD_BIRTH_51_60', 64, 65],
  ]) {
    const flags = ['F_FAM_GRANDCHILD', birthFlag];
    assert.equal(eligible(play, { ...player, age: tooYoung, flags }), false, birthFlag);
    assert.equal(eligible(play, { ...player, age: oldEnough, flags }), true, birthFlag);
  }
  assert.equal(eligible(play, { ...player, age: 67 }), false, 'a late-born grandchild may still be four');
  assert.equal(eligible(play, { ...player, age: 68 }), true, 'all recorded grandchild births are at least five');
  assert.equal(eligible(play, { ...player, age: 68, flags: [] }), false, 'age alone is not a birth');
});

test('independent breakthrough work waits for adulthood without consuming the ready milestone', () => {
  for (const [id, card, ready] of [
    ['E_MOD_GLUE_CRAFT_CHALLENGE', 'CARD_MODERN_GLUE', 'F_MOD_GLUE_READY'],
    ['E_MOD_CALCULATOR_BREAKTHROUGH', 'CARD_MODERN_CALCULATOR', 'F_MOD_CALCULATOR_READY'],
    ['E_MOD_LIGHTER_BREAKTHROUGH', 'CARD_MODERN_LIGHTER', 'F_MOD_LIGHTER_READY'],
  ]) {
    const breakthrough = event(id);
    const player = { ...scenario(content, [breakthrough], { age: 17, flags: [ready] }).before, cards: [card] };
    assert.equal(eligible(breakthrough, player), false, id);
    assert.equal(eligible(breakthrough, { ...player, age: 18 }), true, id);
    assert.ok(player.flags.includes(ready));
  }
});
test('dangerous solo pursuits require adulthood without blocking collaborative alternatives', () => {
  for (const [id, card, flags, riskyId, safeId] of [
    ['E_MOD_CORN_BREAKTHROUGH', 'CARD_MODERN_CORN', ['F_MOD_CORN_TRIAL'], 'corn_trial_risk', 'corn_safe'],
    ['E_MOD_FLASHLIGHT_BREAKTHROUGH', 'CARD_MODERN_FLASHLIGHT', ['F_MOD_FLASHLIGHT_MAIN_DONE', 'F_MOD_FLASHLIGHT_EVIDENCE'], 'flashlight_robbery', 'flashlight_break_safe'],
  ]) {
    const source = event(id);
    const player = { ...scenario(content, [source], { age: 17, flags }).before, cards: [card] };
    const risky = source.options.find(option => option.id === riskyId);
    const safe = source.options.find(option => option.id === safeId);
    assert.ok(risky && safe, id);
    const accepts = (option, state) => evaluateCondition(option.condition, conditionContext(state, 'historical'));
    assert.equal(accepts(risky, player), false, `${id} excludes minors from solo danger`);
    assert.equal(accepts(safe, player), true, `${id} leaves an appropriate alternative`);
    assert.equal(accepts(risky, { ...player, age: 18 }), true, `${id} remains available to adults`);
  }
});


test('independent workshop repair work is not offered before adulthood', () => {
  const workshop = event('E_CHAIN_3');
  const repair = workshop.options.find(option => option.id === 'finish');
  assert.ok(repair);
  const player = scenario(content, [workshop], { age: 17 }).before;
  assert.equal(eligible(repair, player), false);
  assert.equal(eligible(repair, { ...player, age: 18 }), true);
});

function workshopDecision(age, seed) {
  const run = scenario(content, [event('E_CHAIN_1'), event('E_CHAIN_3')], {
    age, seed, intelligence: 5, wealth: 8, active_chains: ['CH_WORKSHOP'],
  });
  resolveAutomatic(run.engine, run.start(), `opening:${seed}`);
  resolveAutomatic(run.engine, successful(run.engine.nextYear(`first-year:${seed}`)), `first-stage:${seed}`);
  const result = successful(run.engine.nextYear(`second-year:${seed}`));
  assert.equal(result.pending?.kind, 'option');
  assert.equal(result.pending.event_id, 'E_CHAIN_3');
  return { engine: run.engine, pending: result.pending, before: result.state.player };
}

function chooseWorkshop(fixture, optionId) {
  const selected = fixture.pending.options.find(option => option.id === optionId);
  assert.ok(selected?.available, `${optionId} should be available at age ${fixture.before.age}`);
  return successful(fixture.engine.resolveOption(`choose:${optionId}`, fixture.pending.event_instance_id, optionId));
}

function completeWorkshopStage(fixture, result, stageId) {
  assert.equal(result.pending?.kind, 'stage');
  assert.equal(result.pending.stage_id, stageId);
  const finished = successful(fixture.engine.resolveStage(`roll:${stageId}`, result.pending.event_instance_id, stageId));
  const logs = fixture.engine.exportSave().payload.logs;
  const roll = logs.find(log => log.type === 'dice' && log.source_id === 'E_CHAIN_3' && log.data.stage_id === stageId);
  assert.ok(roll, `${stageId}: real dice result must be logged`);
  assert.equal(logs.filter(log => log.type === 'option' && log.source_id === 'E_CHAIN_3').length, 1);
  return { player: finished.state.player, success: roll.data.success };
}

function workshopStatus(player) {
  const chain = player.chains.find(entry => entry.chain_id === 'CH_WORKSHOP');
  assert.ok(chain);
  return chain.status;
}

test('youth workshop review uses one choice and real dice for both completion and failure', () => {
  const observed = new Set();
  for (let seed = 0; seed < 128 && observed.size < 2; seed++) {
    const fixture = workshopDecision(11, seed);
    assert.equal(fixture.before.age, 13);
    for (const id of ['qualify', 'finish', 'withdraw']) {
      assert.equal(fixture.pending.options.find(option => option.id === id)?.available, false, id);
    }
    assert.equal(fixture.pending.options.find(option => option.id === 'young_withdraw')?.available, true);
    const result = chooseWorkshop(fixture, 'young_review');
    const { player, success } = completeWorkshopStage(fixture, result, 'young_review');
    observed.add(success ? 'success' : 'failure');
    assert.equal(player.identity_id, fixture.before.identity_id, 'a minor never receives an artisan identity');
    assert.equal(player.flags.includes('F_LIFE_ROUTE_LIVELIHOOD'), false);
    assert.equal(player.flags.includes('F_LIFE_ROUTE_SERVICE'), false);
    const artisan = content.achievements.find(item => item.id === 'A_LIFE_ARTISAN');
    assert.ok(artisan);
    assert.equal(eligible(artisan, player), false);
    if (success) {
      assert.equal(workshopStatus(player), 'completed');
      assert.equal(player.attributes.prestige, fixture.before.attributes.prestige + 1);
      assert.ok(player.flags.includes('workshop_complete'));
      assert.equal(player.flags.includes('F_WORKSHOP_ABORT'), false);
      assert.ok(player.achievements.includes('A_PROJECT'));
      assert.ok(player.achievements.includes('A_CAREER_WORKSHOP'));
    } else {
      assert.equal(workshopStatus(player), 'interrupted');
      assert.ok(player.flags.includes('F_WORKSHOP_ABORT'));
      assert.equal(player.flags.includes('workshop_complete'), false);
      assert.equal(player.achievements.includes('A_PROJECT'), false);
      assert.equal(player.achievements.includes('A_CAREER_WORKSHOP'), false);
    }
  }
  assert.deepEqual([...observed].sort(), ['failure', 'success']);
});

test('youth workshop withdrawal interrupts without completion, occupation or achievement', () => {
  const fixture = workshopDecision(11, 0);
  const result = chooseWorkshop(fixture, 'young_withdraw');
  assert.equal(result.pending, null);
  const player = result.state.player;
  assert.equal(player.identity_id, fixture.before.identity_id);
  assert.equal(workshopStatus(player), 'interrupted');
  assert.ok(player.flags.includes('F_WORKSHOP_ABORT'));
  for (const flag of ['workshop_complete', 'F_LIFE_ROUTE_LIVELIHOOD', 'F_LIFE_ROUTE_SERVICE']) {
    assert.equal(player.flags.includes(flag), false, flag);
  }
  for (const id of ['A_PROJECT', 'A_CAREER_WORKSHOP']) assert.equal(player.achievements.includes(id), false, id);
  const logs = fixture.engine.exportSave().payload.logs;
  assert.equal(logs.filter(log => log.type === 'option' && log.source_id === 'E_CHAIN_3').length, 1);
  assert.equal(logs.some(log => log.type === 'dice' && log.source_id === 'E_CHAIN_3'), false);
});

test('adult workshop options retain artisan, independent repair and mentoring outcomes', () => {
  for (const [option, stage] of [['qualify', 'promote'], ['finish', 'regular']]) {
    let succeeded = false;
    for (let seed = 0; seed < 128 && !succeeded; seed++) {
      const fixture = workshopDecision(16, seed);
      assert.equal(fixture.before.age, 18);
      for (const id of ['qualify', 'finish', 'withdraw']) {
        assert.equal(fixture.pending.options.find(item => item.id === id)?.available, true, id);
      }
      for (const id of ['young_review', 'young_withdraw']) {
        assert.equal(fixture.pending.options.find(item => item.id === id)?.available, false, id);
      }
      const { player, success } = completeWorkshopStage(fixture, chooseWorkshop(fixture, option), stage);
      if (!success) {
        assert.equal(workshopStatus(player), 'interrupted');
        assert.equal(player.flags.includes('workshop_complete'), false);
        continue;
      }
      succeeded = true;
      assert.equal(workshopStatus(player), 'completed');
      assert.ok(player.flags.includes('workshop_complete'));
      assert.ok(player.achievements.includes('A_PROJECT'));
      assert.ok(player.achievements.includes('A_CAREER_WORKSHOP'));
      assert.equal(player.attributes.prestige, fixture.before.attributes.prestige + 1);
      const artisan = content.achievements.find(item => item.id === 'A_LIFE_ARTISAN');
      assert.ok(artisan);
      assert.equal(eligible(artisan, player), option === 'qualify');
      if (option === 'qualify') assert.equal(player.identity_id, 'I_ARTISAN');
      else {
        assert.equal(player.identity_id, fixture.before.identity_id);
        assert.ok(player.flags.includes('F_LIFE_ROUTE_LIVELIHOOD'));
      }
    }
    assert.ok(succeeded, `${option} must have an actual successful adult outcome`);
  }
  const fixture = workshopDecision(16, 0);
  const withdrawn = chooseWorkshop(fixture, 'withdraw');
  assert.equal(withdrawn.pending, null);
  assert.equal(workshopStatus(withdrawn.state.player), 'interrupted');
  assert.ok(withdrawn.state.player.flags.includes('F_LIFE_ROUTE_SERVICE'));
  assert.ok(withdrawn.state.player.flags.includes('F_WORKSHOP_ABORT'));
  assert.equal(withdrawn.state.player.flags.includes('workshop_complete'), false);
  assert.equal(withdrawn.state.player.achievements.includes('A_PROJECT'), false);
});
