import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { scenario, eligible, resolveAutomatic } from './family-harness.mjs';

import { successful } from './family-harness.mjs';
const content = await loadContent();
const family = content.events.filter(x => x.id.startsWith('E_FAM_'));
function* nodes(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value;
  for (const child of Object.values(value)) yield* nodes(child);
}
const adds = (event, id) => [...nodes(event)].some(x => x.type === 'flag_add' && x.id === id);
const reads = (event, id) => [...nodes(event.condition)].some(x => x.op === 'has' && x.id === id);
function executeOne(events, state, predicate) {
  for (let seed = 0; seed < 300; seed++) {
    const run = scenario(content, events, { ...state, seed });
    const result = resolveAutomatic(run.engine, run.start());
    if (predicate(result.state.player, run.engine.exportSave().payload.logs)) return { ...run, result };
  }
  assert.fail(`No scheduled outcome for ${events.map(x => x.id).join(',')}`);
}

test('new initial marriages block old marriage entries; old marriages have an automatic adoption route', () => {
  const initial = family.filter(e => /^E_FAM_MAR_(MATCH|SIMPLE_MATCH|BETROTHAL_|WEDDING_)/.test(e.id));
  assert.ok(initial.length);
  for (const wealth of Array.from({ length: 21 }, (_, i) => i)) {
    let married;
    for (let seed = 0; seed < 40 && !married; seed++) {
      const run = scenario(content, initial, { age: 25, wealth, prestige: 0, seed });
      let result = resolveAutomatic(run.engine, run.start());
      for (let year = 0; year < 30 && !result.state.player.flags.includes('F_FAM_MARRIED'); year++) {
        result = resolveAutomatic(run.engine, successful(run.engine.nextYear(`marry:${year}`)), `marry-stage:${year}`);
      }
      if (result.state.player.flags.includes('F_FAM_MARRIED')) married = { result, logs: run.engine.exportSave().payload.logs };
    }
    assert.ok(married, `wealth=${wealth}: marriage sequence unreachable`);
    const { result, logs } = married;
    if (wealth <= 1) assert.ok(logs.some(log => log.type === 'event' && log.source_id === 'E_FAM_MAR_BETROTHAL_SHORT'));
    if (wealth <= 1) assert.ok(logs.some(log => log.type === 'event' && log.source_id === 'E_FAM_MAR_SIMPLE_MATCH'));
    assert.ok(result.state.player.flags.includes('F_LIFE_MARRIED'));
    for (const old of content.events.filter(e => /^E_LIFE_MARRIAGE_/.test(e.id))) assert.equal(eligible(old, result.state.player), false);
  }
  const adoption = family.filter(e => adds(e, 'F_FAM_MARRIED') && reads(e, 'F_LIFE_MARRIED'));
  assert.ok(adoption.length);
  const { result } = executeOne(adoption, { age: 30, flags: ['F_LIFE_MARRIED'] }, player => player.flags.includes('F_FAM_MARRIED'));
  assert.ok(result.state.player.flags.includes('F_LIFE_MARRIED'));
});

test('actual family widowhood removes current marriage and remarriage preserves bereavement history', () => {
  const widowhood = family.filter(e => adds(e, 'F_FAM_WIDOWED'));
  const widowed = executeOne(widowhood, { age: 60, flags: ['F_FAM_MARRIED', 'F_LIFE_MARRIED', 'F_FAM_HIGH_MARRIAGE', 'F_FAM_MAR_HIGH_RISK'] }, player => player.flags.includes('F_FAM_WIDOWED'));
  assert.equal(widowed.result.state.player.flags.includes('F_FAM_MARRIED'), false);
  assert.equal(widowed.result.state.player.flags.includes('F_LIFE_MARRIED'), false);
  const remarriage = family.filter(e => adds(e, 'F_FAM_REMARRIED'));
  assert.ok(remarriage.length);
  const renewed = executeOne(remarriage, { age: 60, flags: widowed.result.state.player.flags }, player => player.flags.includes('F_FAM_REMARRIED'));
  assert.ok(renewed.result.state.player.flags.includes('F_FAM_MARRIED'));
  assert.ok(renewed.result.state.player.flags.includes('F_FAM_WIDOWED'));
  for (const event of family.filter(e => ['E_FAM_MAR_HIGH_RISK', 'E_FAM_WEALTH_HIGH_MARRIAGE_PRESSURE'].includes(e.id))) {
    assert.equal(eligible(event, renewed.result.state.player), false, event.id);
  }
});

test('legacy children are adopted without another birth and conservatively excluded from early adulthood', () => {
  const adoption = family.filter(e => adds(e, 'F_FAM_CHILD_1_BIRTH_LEGACY'));
  assert.ok(adoption.length);
  const adopted = executeOne(adoption, { age: 40, flags: ['F_LIFE_MARRIED', 'F_FAM_MARRIED', 'F_LIFE_HAS_CHILD'] }, player => player.flags.includes('F_FAM_CHILD_1_BIRTH_LEGACY'));
  assert.ok(adopted.result.state.player.flags.includes('F_FAM_CHILD_1'));
  assert.equal(adopted.result.state.player.flags.includes('F_FAM_CHILD_1_BOY'), false);
  assert.equal(adopted.result.state.player.flags.includes('F_FAM_CHILD_1_GIRL'), false);
  const firstBirths = family.filter(e => adds(e, 'F_FAM_CHILD_1') && !adds(e, 'F_FAM_CHILD_1_BIRTH_LEGACY'));
  assert.ok(firstBirths.length);
  for (const e of firstBirths) assert.equal(eligible(e, adopted.result.state.player), false, e.id);
  for (const e of family.filter(e => adds(e, 'F_FAM_CHILD_MARRIED'))) {
    assert.equal(eligible(e, { ...adopted.result.state.player, age: 57 }), false, e.id);
  }
});

test('new first birth synchronizes legacy state and cannot produce an adult in the following year', () => {
  const births = family.filter(e => adds(e, 'F_FAM_CHILD_1') && !adds(e, 'F_FAM_CHILD_1_BIRTH_LEGACY'));
  assert.ok(births.length);
  for (const age of [26, 39]) {
    const born = executeOne(births, { age, flags: ['F_FAM_MARRIED', 'F_LIFE_MARRIED'] }, player => player.flags.includes('F_FAM_CHILD_1'));
    const player = born.result.state.player;
    assert.ok(player.flags.includes('F_LIFE_HAS_CHILD'));
    for (const old of content.events.filter(e => ['E_LIFE_CHILD_BIRTH', 'E_LIFE_CHILD_DAUGHTER'].includes(e.id))) assert.equal(eligible(old, player), false);
    for (const e of family.filter(e => adds(e, 'F_FAM_CHILD_MARRIED') || adds(e, 'F_FAM_GRANDCHILD'))) assert.equal(eligible(e, { ...player, age: age + 1 }), false, e.id);
  }
});

test('child deaths retain birth milestones and block repeated death and live-child marriage', () => {
  const bereavements = family.filter(e => adds(e, 'F_FAM_CHILD_BEREAVED'));
  assert.ok(bereavements.length);
  for (let child = 1; child <= 3; child++) {
    const deathFlag = `F_FAM_CHILD_${child}_DEAD`;
    const events = bereavements.filter(e => adds(e, deathFlag));
    if (!events.length) continue;
    const flags = ['F_FAM_MARRIED', 'F_LIFE_MARRIED', 'F_LIFE_HAS_CHILD', `F_FAM_CHILD_${child}`, `F_FAM_CHILD_${child}_BIRTH_18_26`];
    const died = executeOne(events, { age: 65, flags }, player => player.flags.includes(deathFlag));
    assert.ok(died.result.state.player.flags.includes(`F_FAM_CHILD_${child}`));
    for (const e of events) assert.equal(eligible(e, died.result.state.player), false, e.id);
    if (child === 1) for (const e of family.filter(e => adds(e, 'F_FAM_CHILD_MARRIED'))) assert.equal(eligible(e, died.result.state.player), false, e.id);
  }
});

test('age seventy and two births alone never award five living generations', () => {
  const events = family.filter(e => adds(e, 'F_FAM_FIVE_GENERATIONS'));
  assert.ok(events.length);
  const run = scenario(content, events, { age: 70, flags: ['F_FAM_MARRIED', 'F_FAM_CHILD_1', 'F_FAM_CHILD_2'] });
  for (const event of events) assert.equal(eligible(event, run.before), false, event.id);
  const result = resolveAutomatic(run.engine, run.start());
  assert.equal(result.state.player.flags.includes('F_FAM_FIVE_GENERATIONS'), false);
});

test('estate division needs living adult children and the appropriate wealth tier', () => {
  const events = family.filter(e => adds(e, 'F_FAM_ESTATE_SETTLED'));
  assert.ok(events.length);
  const flags = ['F_FAM_CHILD_1', 'F_FAM_CHILD_2', 'F_FAM_CHILD_1_BIRTH_27_39', 'F_FAM_CHILD_2_BIRTH_27_39'];
  const young = scenario(content, events, { age: 56, flags, wealth: 15 });
  for (const event of events) assert.equal(eligible(event, young.before), false, event.id);
  const divided = executeOne(events, { age: 57, flags, wealth: 15 }, player => player.flags.includes('F_FAM_ESTATE_SETTLED'));
  assert.ok(divided.result.state.player.attributes.wealth <= 15);
  for (const event of events) assert.equal(eligible(event, { ...divided.before, flags: [...flags, 'F_FAM_CHILD_2_DEAD'] }), false, event.id);
  const poor = scenario(content, events, { age: 60, flags, wealth: 0, prestige: 0 });
  for (const event of events) assert.equal(eligible(event, poor.before), false, event.id);
});

test('five generations require actual sequential births across a single engine lifetime', () => {
  const ids = ['E_FAM_CHILD_FIRST_BOY_EARLY_PLAIN', 'E_FAM_CHILD_SECOND_GIRL_EARLY_WIFE', 'E_FAM_CHILD_MARRIAGE',
    'E_FAM_CHILD_GRANDCHILD_EARLY', 'E_FAM_CHILD_GREAT_GRANDCHILD_EARLY', 'E_FAM_CHILD_FIVE_GENERATIONS'];
  const events = ids.map(id => { const event = family.find(e => e.id === id); assert.ok(event, id); return event; });
  const run = scenario(content, events, { age: 18, wealth: 2, flags: ['F_FAM_MARRIED', 'F_LIFE_MARRIED'] });
  let result = resolveAutomatic(run.engine, run.start());
  while (result.state.player.age < 104 && !result.state.player.flags.includes('F_FAM_FIVE_GENERATIONS')) {
    const age = result.state.player.age;
    result = resolveAutomatic(run.engine, successful(run.engine.nextYear(`generation:${age}`)), `generation-stage:${age}`);
  }
  assert.ok(result.state.player.flags.includes('F_FAM_FIVE_GENERATIONS'));
  assert.ok(result.state.player.achievements.includes('A_FAM_FIVE_GENERATIONS'));
  const eventsLog = run.engine.exportSave().payload.logs.filter(x => x.type === 'event');
  const ages = ids.map(id => { const log = eventsLog.find(x => x.source_id === id); assert.ok(log, id); return log.age; });
  assert.ok(ages[2] - ages[0] >= 18, `child marriage ages=${ages}`);
  assert.ok(ages[3] > ages[2], `grandchild follows marriage ages=${ages}`);
  assert.ok(ages[4] - ages[3] >= 18, `grandchild adulthood ages=${ages}`);
  assert.ok(ages[5] - ages[4] >= 18, `great-grandchild adulthood ages=${ages}`);
  assert.ok(ages[5] >= 93 && ages[5] < 105);
});

test('grandchild companionship requires a real birth and supports a late-born infant', () => {
  const birth = family.find(e => e.id === 'E_FAM_CHILD_GRANDCHILD_LATE');
  const enjoy = family.find(e => e.id === 'E_FAM_CHILD_ENJOY_GRANDCHILD');
  assert.ok(birth && enjoy);
  const run = scenario(content, [birth, enjoy], { age: 63, flags: ['F_FAM_CHILD_1', 'F_FAM_CHILD_2', 'F_FAM_CHILD_MARRIED'] });
  assert.equal(eligible(enjoy, run.before), false);
  let result = resolveAutomatic(run.engine, run.start());
  assert.ok(result.state.player.flags.includes('F_FAM_GRANDCHILD'));
  result = resolveAutomatic(run.engine, successful(run.engine.nextYear('grandchild:64')));
  assert.ok(result.state.player.flags.includes('F_FAM_CHILD_GRANDCHILD_ENJOYED'));
});

test('infant loss never invents a surviving birth milestone or kills an existing child', () => {
  const event = family.find(e => e.id === 'E_FAM_CHILD_INFANT_LOSS');
  assert.ok(event);
  const loss = executeOne([event], { age: 25, flags: ['F_FAM_MARRIED'] }, (_player, logs) => logs.some(log => log.type === 'event' && log.source_id === event.id));
  for (let child = 1; child <= 3; child++) {
    assert.equal(loss.result.state.player.flags.includes(`F_FAM_CHILD_${child}`), false);
    assert.equal(loss.result.state.player.flags.includes(`F_FAM_CHILD_${child}_DEAD`), false);
  }
  assert.equal(loss.result.state.status, 'READY');
});
