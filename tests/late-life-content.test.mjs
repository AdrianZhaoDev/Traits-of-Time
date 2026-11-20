import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadContent } from '../tools/content-io.mjs';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { Mulberry32, uniformInt } from '../src/game/core/engine/RandomSource.ts';
import { chooseOption, simulateLife } from '../tools/simulate.ts';
import { updateLateLife } from '../src/game/core/engine/LateLife.ts';
import { scheduleFollowUps } from '../src/game/core/engine/EventScheduler.ts';

const content = await loadContent();
const cards = content.pools.find(pool => pool.id === content.rules.opening.pool_id).entries.filter(entry => entry.weight > 0).map(entry => entry.card_id);

for (const card of cards) test(`${card}: complete life keeps explicit choices and annual causal evidence`, () => {
  const life = simulateLife(content, GameEngine, Mulberry32, uniformInt, 'career', 27, card);
  assert.equal(life.card, card);
  assert.ok(life.choices.length >= 1 && life.choices.length <= 5);
  const years = life.evidence.year_states.map(row => row.year);
  for (let index = 1; index < years.length; index++) assert.equal(years[index] - years[index - 1], 1, 'no merged or skipped years');
  const events = life.evidence.commands.flatMap(command => command.logs).filter(log => log.type === 'event');
  assert.equal(new Set(events.map(log => log.data.event_instance_id)).size, events.length);
  for (const choice of life.choices) assert.ok(events.some(log => log.data.event_instance_id === choice.instance_id));
  if (life.reached_year_10) assert.equal(life.evidence.year_10_state.calendar_year - life.start_year, 9);
});

function* objects(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value;
  for (const child of Object.values(value)) yield* objects(child);
}

test('scheduled late-life continuations cannot introduce forced death or lifespan reduction', () => {
  const continuations = content.events.filter(event => event.trigger.kind === 'follow_up');
  assert.ok(continuations.length > 0, 'production continuations must exist');
  for (const event of continuations.filter(event => event.interaction === 'automatic')) {
    for (const node of objects(event)) {
      assert.notEqual(node.type, 'death', event.id);
      assert.ok(!(node.type === 'lifespan_add' && node.amount < 0), event.id);
    }
  }
});

for (const age of [3, 30, 65]) test(`age ${age}: late-life recovery repeats neither effects nor choices`, () => {
  const bundle = structuredClone(content);
  if (age !== 3) bundle.rules.age_bands = [{ id: 'target', min: age, max: age, weight: 1, modifiers: {} }];
  // Age three uses a production-mortality trajectory that reaches the tenth year.
  if (age !== 3) bundle.rules.lifespan = { min: 110, max: 110, min_remaining_years: 1 };
  const engine = new GameEngine(bundle, `recovery:${age}`);
  const ok = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result; };
  const seed = age === 3 ? 364 : 27;
  const strategyRandom = new Mulberry32((seed ^ 0xa511e9b3) >>> 0);
  let result = ok(engine.initGame({ seed }));
  assert.equal(result.state.player.start_age, age);
  result = ok(engine.selectCard('card', result.pending.cards[0]));
  let counter = 0;
  let restoredAtLateLife = false;
  while (result.state.status !== 'ENDED' && counter < 300) {
    const pending = result.pending;
    const id = `advance:${counter++}`;
    const optionId = pending?.kind === 'option'
      ? age === 3
        ? chooseOption(pending, bundle.events.find(event => event.id === pending.event_id), 'normal', length => uniformInt(0, length - 1, strategyRandom)).id
        : pending.options.find(option => option.available).id
      : null;
    const apply = target => pending?.kind === 'option'
      ? target.resolveOption(id, pending.event_instance_id, optionId)
      : pending?.kind === 'stage'
        ? target.resolveStage(id, pending.event_instance_id, pending.stage_id)
        : target.nextYear(id);
    const saved = engine.exportSave();
    const restored = new GameEngine(bundle, `recovery:${age}`);
    restored.restoreSave(saved);
    result = ok(apply(engine));
    assert.deepEqual(ok(apply(restored)), result);
    const after = restored.exportSave();
    assert.deepEqual(ok(apply(restored)), result, 'same command receipt is replayed');
    assert.deepEqual(restored.exportSave(), after, 'duplicate command cannot reapply effects');
    if (result.state.player.calendar_year - result.state.player.start_year >= 9) restoredAtLateLife = true;
    if (restoredAtLateLife && result.state.player.calendar_year - result.state.player.start_year >= 18) break;
  }
  assert.ok(restoredAtLateLife, 'fixture must exercise late-life recovery');
  assert.ok(engine.exportSave().payload.logs.filter(log => log.type === 'option').length <= 5);
});

const routeCases = [
  { name: 'wealth with power', wealth: 8, prestige: 10, physique: 8, identity: 'I_CLAN_ELDER', route: 'prosperous_power' },
  { name: 'wealth without power', wealth: 8, prestige: 3, physique: 8, identity: 'I_HOUSEHOLD', route: 'prosperous_free' },
  { name: 'power without wealth', wealth: 2, prestige: 10, physique: 8, identity: 'I_CLAN_ELDER', route: 'respected' },
  { name: 'poor with earned renown', wealth: 0, prestige: 12, physique: 8, identity: 'I_HOUSEHOLD', flags: ['F_JN_POET_FAMOUS'], route: 'poor_renowned' },
  { name: 'failed unemployed', wealth: 0, prestige: 1, physique: 8, identity: 'I_REFUGEE', route: 'struggling' },
  { name: 'frail and poor', wealth: 0, prestige: 1, physique: 1, identity: 'I_REFUGEE', route: 'hardship' },
  { name: 'ordinary means', wealth: 3, prestige: 3, physique: 8, identity: 'I_HOUSEHOLD', route: 'ordinary' },
];
for (const scenario of routeCases) test(`route consumer: ${scenario.name}`, () => {
  const engine = new GameEngine(content, 'route-fixture');
  const initialized = engine.initGame({ seed: 27 });
  assert.equal(initialized.ok, true);
  const saved = engine.exportSave();
  const { player, run } = saved.payload;
  player.calendar_year = player.start_year + 9;
  player.age = 39;
  player.identity_id = scenario.identity;
  player.flags = scenario.flags ?? [];
  player.chains = [];
  Object.assign(player.attributes, { wealth: scenario.wealth, prestige: scenario.prestige, physique: scenario.physique });
  const logs = [];
  updateLateLife(content, player, run, data => logs.push(data));
  assert.equal(player.late_life.route_id, scenario.route);
  assert.equal(logs.filter(log => log.action === 'entered').length, 1);
  const earned = structuredClone({ flags: player.flags, chains: player.chains, achievements: player.achievements });
  player.calendar_year++;
  updateLateLife(content, player, run, data => logs.push(data));
  assert.equal(player.late_life.route_id, scenario.route);
  assert.equal(logs.filter(log => log.action === 'entered').length, 1);
  assert.deepEqual({ flags: player.flags, chains: player.chains, achievements: player.achievements }, earned);
});

test('wealth fluctuations retain route while sustained loss changes it without erasing achievements', () => {
  const engine = new GameEngine(content, 'hysteresis');
  assert.equal(engine.initGame({ seed: 27 }).ok, true);
  const { player, run } = engine.exportSave().payload;
  player.calendar_year = player.start_year + 9;
  player.identity_id = 'I_HOUSEHOLD';
  player.chains = [];
  player.flags = ['F_FAM_LIFE_EARLY_FRIEND'];
  Object.assign(player.attributes, { wealth: 8, physique: 8, prestige: 3 });
  const earned = structuredClone({ flags: player.flags, achievements: player.achievements });
  const logs = [];
  const advance = wealth => { player.calendar_year++; player.age++; player.attributes.wealth = wealth; updateLateLife(content, player, run, data => logs.push(data)); };
  updateLateLife(content, player, run, data => logs.push(data));
  for (const wealth of [5, 6, 4, 5]) { advance(wealth); assert.equal(player.late_life.route_id, 'prosperous_free'); }
  advance(0); advance(0);
  assert.equal(player.late_life.route_id, 'prosperous_free');
  advance(0);
  assert.equal(player.late_life.route_id, 'struggling');
  assert.equal(logs.filter(log => log.action === 'changed').length, 1);
  assert.deepEqual({ flags: player.flags, achievements: player.achievements }, earned);
});

test('past friendship opens its follow-up without making isolation a moral failure', () => {
  const engine = new GameEngine(content, 'friendship');
  assert.equal(engine.initGame({ seed: 27 }).ok, true);
  const { player, run } = engine.exportSave().payload;
  player.calendar_year = player.start_year + 12;
  player.flags = ['F_FAM_LIFE_EARLY_FRIEND'];
  player.chains = [];
  player.cards = [];
  run.follow_up_groups = { LL_FATE: player.start_year + 9 };
  updateLateLife(content, player, run, () => {});
  const withFriend = scheduleFollowUps(content, player, run, event => event.interaction === 'automatic', () => {});
  assert.ok(withFriend.some(entry => entry.event_id === 'E_LL_ITEM_FRIEND'));
  player.flags = [];
  const isolated = scheduleFollowUps(content, player, run, event => event.interaction === 'automatic', () => {});
  assert.ok(!isolated.some(entry => entry.event_id === 'E_LL_ITEM_FRIEND'));
  player.calendar_year += 2;
  const fallback = scheduleFollowUps(content, player, run, event => event.interaction === 'automatic', () => {});
  assert.ok(fallback.length > 0, 'isolation still has an ordinary continuation at deadline');
});

test('interrupted careers retain earned work and ordinary coverage across a long annual timeline', () => {
  const engine = new GameEngine(content, 'interrupted-long-life');
  assert.equal(engine.initGame({ seed: 27 }).ok, true);
  const { player, run } = engine.exportSave().payload;
  player.identity_id = 'I_HOUSEHOLD';
  player.flags = ['F_MOD_CORN_ABORT', 'F_MOD_CORN_PRACTICE'];
  player.cards = ['CARD_MODERN_CORN'];
  player.chains = [{ chain_id: 'CHAIN_MOD_CORN_KING', instance_id: 'interrupted-work', started_year: player.start_year, next_due_year: null, node_index: 1, status: 'interrupted', interruption_reason: 'fixture interruption' }];
  Object.assign(player.attributes, { wealth: 3, prestige: 3, physique: 8 });
  const earned = structuredClone({ flags: player.flags, chains: player.chains, achievements: player.achievements });
  const stages = new Set();
  for (let elapsed = 8; elapsed <= 60; elapsed++) {
    player.calendar_year = player.start_year + elapsed;
    player.age = 3 + elapsed;
    updateLateLife(content, player, run, () => {});
    if (elapsed === 8) assert.equal(player.late_life.route_id, null);
    else {
      assert.equal(player.late_life.route_id, 'ordinary');
      stages.add(player.late_life.phase);
    }
    assert.deepEqual({ flags: player.flags, chains: player.chains, achievements: player.achievements }, earned);
    if (player.age < content.rules.late_life.settlement_age) assert.notEqual(player.late_life.phase, 'settlement');
  }
  assert.deepEqual([...stages], ['realization', 'expansion', 'settlement']);
});

test('causal reporting maps real production prerequisites and downstream events', () => {
  const mappings = JSON.parse(readFileSync(new URL('../tools/late-life-causal-mapping.json', import.meta.url), 'utf8'));
  const events = new Map(content.events.map(event => [event.id, event]));
  for (const mapping of mappings) {
    const event = events.get(mapping.event_id);
    assert.ok(event, mapping.event_id);
    const established = [...objects(event)].filter(node => node.type === 'flag_add').map(node => node.id);
    assert.ok(mapping.consequence_event_ids.length > 0);
    for (const id of mapping.consequence_event_ids) {
      const consequence = events.get(id);
      assert.ok(consequence, id);
      assert.ok([...objects(consequence.condition)].some(node => node.op === 'has' && node.collection === 'flags' && established.includes(node.id)), `${id} must consume an established prerequisite`);
    }
  }
});
