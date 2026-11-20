import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { updateLateLife } from '../src/game/core/engine/LateLife.ts';
import { validateContent } from '../src/game/core/content/ContentValidator.ts';
import { scenario, successful } from './family-harness.mjs';

const content = await loadContent();
const has = id => ({ op: 'has', collection: 'flags', id });
const outcome = (effects = []) => ({ text: '实际结果', effects, next_stage_id: null });
const follow = (id, group, earliest, latest, extra = {}) => ({
  id, text: id, interaction: 'automatic',
  trigger: { kind: 'follow_up', group_id: group, after_group: null, earliest, latest, priority: 1, ...extra },
  outcome: outcome([{ type: 'flag_add', id: `${id}_DONE` }]),
});
const random = (id, condition, effects = []) => ({
  id, text: id, condition, interaction: 'automatic',
  trigger: { kind: 'random', weight: 1, priority: id === 'ENABLE' ? 10 : 0, trigger_probability: 1, cooldown_years: 0, max_occurrences: id === 'ENABLE' ? 1 : null, rare: false },
  outcome: outcome(effects),
});
const eventIds = result => result.logs.filter(log => log.type === 'event').map(log => log.source_id);
const groupLog = (result, group) => result.logs.find(log => log.type === 'follow_up' && log.data.group_id === group);

function playerAtEntry(overrides = {}) {
  const player = structuredClone(scenario(content, []).before);
  player.calendar_year = player.start_year + 9;
  player.age = player.start_age + 9;
  player.identity_id = 'I_WORKER';
  player.flags = [];
  player.chains = [];
  Object.assign(player.attributes, { wealth: 3, prestige: 20, physique: 8 }, overrides.attributes);
  if (overrides.identity_id) player.identity_id = overrides.identity_id;
  if (overrides.flags) player.flags = overrides.flags;
  if (overrides.chains) player.chains = overrides.chains;
  return player;
}
function update(player, logs = []) {
  updateLateLife(content, player, { timeline: 'fictional' }, data => logs.push(data));
  return player.late_life.route_id;
}
function nextTestYear(player, logs) { player.age++; player.calendar_year++; return update(player, logs); }

test('entry routes use real identity, independent wealth, accomplishments and frailty', () => {
  assert.equal(update(playerAtEntry({ attributes: { wealth: 6, prestige: 20 } })), 'prosperous_free');
  assert.equal(update(playerAtEntry({ attributes: { wealth: 6 }, identity_id: 'I_MILITARY_OFFICER' })), 'prosperous_power');
  assert.equal(update(playerAtEntry({ attributes: { wealth: 0 }, identity_id: 'I_CLAN_ELDER' })), 'respected');
  assert.equal(update(playerAtEntry({ attributes: { wealth: 0, prestige: 20 } })), 'struggling');
  assert.equal(update(playerAtEntry({ attributes: { wealth: 0, physique: 2 } })), 'hardship');
  assert.equal(update(playerAtEntry({ attributes: { wealth: 0 }, chains: [{ chain_id: 'CHAIN_EPIDEMIC_HEALING', status: 'completed' }] })), 'struggling');
  assert.equal(update(playerAtEntry({ attributes: { wealth: 0 }, flags: ['F_MOD_CORN_SUCCESS'] })), 'poor_renowned');
  assert.equal(update(playerAtEntry({ attributes: { wealth: 0 }, identity_id: 'I_JUREN' })), 'poor_renowned');
  const young = playerAtEntry();
  young.start_age = 3; young.age = 12;
  assert.equal(update(young), 'ordinary');
  assert.equal(young.late_life.phase, 'realization');
});

test('route retention withstands small losses, cancels transient changes and confirms sustained ones', () => {
  const player = playerAtEntry({ attributes: { wealth: 6 } });
  player.flags.push('EARLY_CREDIT');
  player.achievements.push('EARLY_ACHIEVEMENT');
  player.chains.push({ chain_id: 'CHAIN_EPIDEMIC_HEALING', status: 'completed' });
  const logs = [];
  assert.equal(update(player, logs), 'prosperous_free');
  player.attributes.wealth = 4;
  for (let i = 0; i < 4; i++) assert.equal(nextTestYear(player, logs), 'prosperous_free');
  player.attributes.wealth = 3;
  assert.equal(nextTestYear(player, logs), 'prosperous_free');
  assert.equal(nextTestYear(player, logs), 'prosperous_free');
  player.attributes.wealth = 4;
  assert.equal(nextTestYear(player, logs), 'prosperous_free');
  assert.equal(player.late_life.candidate_route_id, null);
  player.attributes.wealth = 3;
  assert.equal(nextTestYear(player, logs), 'prosperous_free');
  assert.equal(nextTestYear(player, logs), 'prosperous_free');
  assert.equal(nextTestYear(player, logs), 'ordinary');
  assert.ok(logs.some(log => log.action === 'candidate_cancelled'));
  assert.ok(player.flags.includes('EARLY_CREDIT'));
  assert.ok(player.achievements.includes('EARLY_ACHIEVEMENT'));
  assert.ok(player.chains.some(chain => chain.chain_id === 'CHAIN_EPIDEMIC_HEALING' && chain.status === 'completed'));
  assert.ok(logs.some(log => log.action === 'changed' && log.previous_route_id === 'prosperous_free' && log.reason === 'CONFIRMED'));
});

test('follow-up choice waits for eligibility, survives restore, and anchors its next real year', () => {
  const choice = {
    id: 'CHOICE', text: '决定事业', condition: has('READY_FOR_CHOICE'), interaction: 'choice',
    trigger: { kind: 'follow_up', group_id: 'A', after_group: null, earliest: 0, latest: 3, priority: 10 },
    options: [
      { id: 'a', text: '继续', unavailable_text: '不可用', risk: 'safe', outcome: outcome([{ type: 'flag_add', id: 'CHOSE_A' }]) },
      { id: 'b', text: '转向', unavailable_text: '不可用', risk: 'normal', outcome: outcome([{ type: 'flag_add', id: 'CHOSE_B' }]) },
    ],
  };
  const fallback = follow('FALLBACK', 'A', 0, 3, { priority: 0, fallback: true });
  const second = follow('SECOND', 'B', 1, 2, { after_group: 'A' });
  const enable = random('ENABLE', { op: 'compare', field: 'years_elapsed', comparator: 'gte', value: 10 }, [{ type: 'flag_add', id: 'READY_FOR_CHOICE' }]);
  const daily = random('DAILY', undefined);
  const { engine, start } = scenario(content, [choice, fallback, second, enable, daily], { age: 25, wealth: 7 });
  start();
  let result;
  for (let year = 1; year <= 9; year++) result = successful(engine.nextYear(`year:${year}`));
  assert.equal(groupLog(result, 'A').data.status, 'no_candidate');
  assert.equal(groupLog(result, 'A').data.candidates.find(item => item.event_id === 'FALLBACK').reason, 'BEFORE_FALLBACK');
  result = successful(engine.nextYear('year:10'));
  assert.ok(eventIds(result).includes('ENABLE'));
  result = successful(engine.nextYear('year:11'));
  assert.equal(result.pending.kind, 'option');
  assert.equal(result.pending.event_id, 'CHOICE');
  assert.equal(groupLog(result, 'A').data.status, 'selected');
  assert.equal(result.state.player.late_life.phase, 'realization');
  const saved = engine.exportSave();
  const refused = engine.nextYear('no-timeout');
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'INVALID_STATE');
  assert.deepEqual(engine.exportSave(), saved);
  const restored = engine.createReplayEngine();
  assert.throws(() => restored.restoreSave({ ...saved, rules_implementation_version: 3 }), { code: 'RULES_MISMATCH' });
  assert.throws(() => restored.restoreSave({ ...saved, save_version: 5, rules_implementation_version: 3 }), { code: 'SAVE_VERSION_MISMATCH' });
  const forged = structuredClone(saved);
  forged.payload.run.follow_up_groups.A += 1;
  assert.throws(() => restored.restoreSave(forged), { code: 'SAVE_INVALID' });
  restored.restoreSave(saved);
  assert.deepEqual(restored.exportSave(), saved);
  const pending = result.pending;
  const original = successful(engine.resolveOption('choose', pending.event_instance_id, 'b'));
  const replayed = successful(restored.resolveOption('choose', pending.event_instance_id, 'b'));
  assert.deepEqual(replayed, original);
  assert.ok(original.state.player.flags.includes('CHOSE_B'));
  assert.ok(!original.state.player.flags.includes('CHOSE_A'));
  const next = successful(restored.nextYear('year:12'));
  assert.deepEqual(eventIds(next).slice(0, 2), ['SECOND', 'DAILY']);
  assert.equal(groupLog(next, 'B').data.anchor_year, saved.payload.player.calendar_year);
  assert.equal(restored.exportSave().payload.run.follow_up_groups.B, next.state.player.calendar_year);
});

test('ineligible choice does not consume its automatic fallback before the deadline', () => {
  const unavailable = follow('UNAVAILABLE', 'FALLBACK_GROUP', 0, 2, { priority: 10 });
  unavailable.condition = has('NEVER');
  const fallback = follow('SAFE_FALLBACK', 'FALLBACK_GROUP', 0, 2, { priority: 0, fallback: true });
  const { engine, start } = scenario(content, [unavailable, fallback, random('DAILY', undefined)], { age: 25 });
  start();
  let result;
  for (let year = 1; year <= 10; year++) result = successful(engine.nextYear(`fallback:${year}`));
  assert.equal(groupLog(result, 'FALLBACK_GROUP').data.status, 'no_candidate');
  assert.ok(!Object.hasOwn(engine.exportSave().payload.run.follow_up_groups, 'FALLBACK_GROUP'));
  result = successful(engine.nextYear('fallback:11'));
  assert.deepEqual(eventIds(result).slice(0, 2), ['SAFE_FALLBACK', 'DAILY']);
  assert.equal(groupLog(result, 'FALLBACK_GROUP').data.latest_year, result.state.player.calendar_year);
  assert.equal(engine.exportSave().payload.run.follow_up_groups.FALLBACK_GROUP, result.state.player.calendar_year);
  result = successful(engine.nextYear('fallback:12'));
  assert.ok(!eventIds(result).includes('SAFE_FALLBACK'));
});

test('overlapping deadlines obey the annual cap and expose the deferred late fulfillment', () => {
  const first = follow('A_FIRST', 'FIRST', 0, 0);
  const alternative = follow('A_ALT', 'FIRST', 0, 0, { priority: 0 });
  const second = follow('B_SECOND', 'SECOND', 0, 0);
  const { engine, start } = scenario(content, [first, alternative, second, random('DAILY', undefined)], { age: 25 });
  start();
  let result;
  for (let year = 1; year <= 9; year++) result = successful(engine.nextYear(`overlap:${year}`));
  assert.deepEqual(eventIds(result).slice(0, 2), ['A_FIRST', 'DAILY']);
  assert.equal(groupLog(result, 'FIRST').data.candidates.find(candidate => candidate.event_id === 'A_ALT').reason, 'LOWER_PRIORITY');
  assert.equal(groupLog(result, 'SECOND').data.status, 'deferred');
  result = successful(engine.nextYear('overlap:10'));
  assert.deepEqual(eventIds(result).slice(0, 2), ['B_SECOND', 'DAILY']);
  assert.equal(groupLog(result, 'SECOND').data.status, 'selected');
  assert.ok(groupLog(result, 'SECOND').data.latest_year < result.state.player.calendar_year);
});

test('automatic follow-up checks resume from a saved stage with identical seeded dice', () => {
  const dice = follow('DICE', 'DICE_GROUP', 0, 2);
  dice.outcome = { text: '进入检定', effects: [], next_stage_id: 'roll' };
  dice.stages = [{ id: 'roll', text: '按经历检定', check: { attribute: 'intelligence', dc: 10, modifier: 0 },
    success: outcome([{ type: 'flag_add', id: 'DICE_SUCCESS' }]), failure: outcome([{ type: 'flag_add', id: 'DICE_FAILURE' }]) }];
  const { engine, start } = scenario(content, [dice, random('DAILY', undefined)], { age: 25 });
  start();
  let result;
  for (let year = 1; year <= 9; year++) result = successful(engine.nextYear(`dice-year:${year}`));
  assert.equal(result.pending.kind, 'stage');
  assert.equal(result.pending.event_id, 'DICE');
  const restored = engine.createReplayEngine();
  restored.restoreSave(engine.exportSave());
  const pending = result.pending;
  const original = successful(engine.resolveStage('roll', pending.event_instance_id, pending.stage_id));
  const replayed = successful(restored.resolveStage('roll', pending.event_instance_id, pending.stage_id));
  assert.deepEqual(replayed, original);
  assert.ok(original.logs.some(log => log.type === 'dice'));
  assert.ok(eventIds(original).includes('DAILY'));
});

test('an unsatisfied deadline is diagnosed and never silently marked fulfilled', () => {
  const blocked = follow('BLOCKED', 'BLOCKED_GROUP', 0, 0);
  blocked.condition = has('NEVER');
  const { engine, start } = scenario(content, [blocked], { age: 25 });
  start();
  let result;
  for (let year = 1; year <= 10; year++) result = successful(engine.nextYear(`blocked:${year}`));
  const diagnostic = groupLog(result, 'BLOCKED_GROUP').data;
  assert.equal(diagnostic.status, 'overdue');
  assert.equal(diagnostic.candidates[0].reason, 'CONDITION_NOT_MET');
  assert.equal(diagnostic.selected_event_id, null);
  assert.ok(!Object.hasOwn(engine.exportSave().payload.run.follow_up_groups, 'BLOCKED_GROUP'));
});

test('invalid follow-up windows, missing anchors and cycles are content errors', () => {
  const bundle = structuredClone(content);
  bundle.events.push(follow('BAD_WINDOW', 'BAD', 3, 2, { after_group: 'MISSING' }));
  bundle.events.push(follow('CYCLE_A', 'CYCLE_A', 0, 1, { after_group: 'CYCLE_B' }));
  bundle.events.push(follow('CYCLE_B', 'CYCLE_B', 0, 1, { after_group: 'CYCLE_A' }));
  const issues = validateContent(bundle).issues;
  assert.ok(issues.some(issue => issue.code === 'INVALID_COMBINATION' && issue.message.includes('最早年份')));
  assert.ok(issues.some(issue => issue.code === 'MISSING_REFERENCE' && issue.message.includes('MISSING')));
  assert.ok(issues.some(issue => issue.code === 'INVALID_GRAPH' && issue.message.includes('循环')));
});
