import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { previewCheck, resolveCheck } from '../src/game/core/engine/DiceResolver.ts';
import { evaluateAchievements } from '../src/game/core/engine/EndingEvaluator.ts';
import { optionDetails } from '../src/presenters.ts';
import { successful } from './family-harness.mjs';

const content = await loadContent();
const events = new Map(content.events.map(event => [event.id, event]));

// Remove unrelated competition, but retain the production condition, option and stage graph.
function fixture(eventId, card, { age = 30, seed = 1, flags = [], attributes = {}, year = 1642, opening = true } = {}) {
  const bundle = structuredClone(content);
  const event = structuredClone(events.get(eventId));
  assert.ok(event, eventId);
  if (opening) event.trigger = { kind: 'opening', weight: 1, trigger_probability: 1 };
  bundle.events = [event];
  bundle.rules.age_bands = [{ id: 'fixture', min: age, max: age, weight: 1, modifiers: {} }];
  bundle.rules.opening.year_min = bundle.rules.opening.year_max = year;
  bundle.rules.lifespan = { min: 105, max: 105, min_remaining_years: 1 };
  bundle.era.age_transitions = [];
  for (const source of [...bundle.castes, ...bundle.regions]) { source.flags = []; source.modifiers = {}; }
  for (const background of bundle.era.backgrounds) {
    background.flags = [...flags];
    const values = { physique: 12, intelligence: 12, prestige: 8, wealth: 8, luck: 3, ...attributes };
    background.modifiers = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value - bundle.rules.attributes.base]));
  }
  bundle.pools.find(pool => pool.id === bundle.rules.opening.pool_id).entries = [{ card_id: card, weight: 1 }];
  const engine = new GameEngine(bundle, 'casual-regression');
  successful(engine.initGame({ seed }));
  const start = successful(engine.selectCard('select', card));
  return { engine, event, bundle, start };
}

function choose(run, id) {
  const pending = run.engine.current().pending;
  assert.equal(pending?.kind, 'option');
  assert.equal(pending.options.find(option => option.id === id)?.available, true, id);
  return successful(run.engine.resolveOption('choose', pending.event_instance_id, id));
}

function resolve(run) {
  const pending = run.engine.current().pending;
  assert.equal(pending?.kind, 'stage');
  return successful(run.engine.resolveStage('resolve', pending.event_instance_id, pending.stage_id));
}

test('the six relic checks expose the intended real D20 probabilities without hidden raw gates', () => {
  const cases = [
    ['E_MOD_CORN_BREAKTHROUGH', 'promote', 12, 3, 0.7],
    ['E_MOD_CORN_BREAKTHROUGH', 'promote_late', 12, 3, 0.7],
    ['E_MOD_HEALER_BREAKTHROUGH', 'S_SPREAD', 12, 3, 0.7],
    ...['break_intelligence', 'break_physique', 'late_intelligence', 'late_physique'].map(id => ['E_MOD_FLASHLIGHT_BREAKTHROUGH', id, 12, 3, 0.8]),
    ['E_MOD_CALCULATOR_BREAKTHROUGH', 'breakthrough', 12, 3, 0.7],
    ['E_MOD_SWISS_BOOK', 'review', 12, 3, 0.8],
    ['E_MOD_GLUE_CRAFT_CHALLENGE', 'glue_craft_test', 12, 3, 0.8],
    ['E_MOD_LIGHTER_BREAKTHROUGH', 'breakthrough', 14, 10, 0.85],
    ['E_MOD_LIGHTER_BREAKTHROUGH', 'breakthrough', 12, 3, 0.7],
  ];
  for (const [eventId, stageId, attribute, luck, expected] of cases) {
    const stage = events.get(eventId).stages.find(item => item.id === stageId);
    assert.ok(stage, `${eventId}/${stageId}`);
    const preview = previewCheck(stage.check, attribute, content.rules.check, luck, 1);
    assert.equal(preview.success_probability, expected, `${eventId}/${stageId}`);
    assert.equal(preview.effective_raw_minimum, null, `${eventId}/${stageId}`);
    const roll = raw => resolveCheck(stage.check, attribute, content.rules.check, luck, { nextUint32: () => raw - 1 }, 1);
    assert.equal(roll(1).success, false);
    assert.equal(roll(20).success, true);
  }
});

test('relaxed entry gates still require the actual route, preparation and available fuel', () => {
  const cases = [
    { event: 'E_MOD_CALCULATOR_BREAKTHROUGH', card: 'CARD_MODERN_CALCULATOR', flags: ['F_MOD_CALCULATOR_READY', 'F_MOD_CALCULATOR_ROUTE', 'F_MOD_CALCULATOR_STEP_1', 'F_MOD_CALCULATOR_DONE'], missing: 'F_MOD_CALCULATOR_STEP_1', attributes: { intelligence: 12, prestige: 8 } },
    { event: 'E_MOD_GLUE_CRAFT_CHALLENGE', card: 'CARD_MODERN_GLUE', flags: ['F_MOD_GLUE_READY', 'F_MOD_GLUE_ARTISAN_PROOF', 'F_MOD_GLUE_STEP_1', 'F_MOD_GLUE_DONE'], missing: 'F_MOD_GLUE_STEP_1', attributes: { physique: 8, intelligence: 12 } },
    { event: 'E_MOD_LIGHTER_BREAKTHROUGH', card: 'CARD_MODERN_LIGHTER', flags: ['F_MOD_LIGHTER_READY', 'F_MOD_LIGHTER_MILITARY_RELAY', 'F_MOD_LIGHTER_STEP_1', 'F_MOD_LIGHTER_DONE', 'F_MOD_LIGHTER_FIRE_TENDED'], missing: 'F_MOD_LIGHTER_FIRE_TENDED', attributes: { physique: 12, luck: 3 } },
  ];
  for (const item of cases) {
    const status = flags => fixture(item.event, item.card, { flags, attributes: item.attributes }).start.pending?.options.find(option => option.id === 'breakthrough');
    assert.equal(status(item.flags)?.available, true, item.event);
    assert.equal(status(item.flags.filter(flag => flag !== item.missing))?.available, false, `${item.event}: missing preparation`);
    if (item.event === 'E_MOD_LIGHTER_BREAKTHROUGH') assert.equal(status([...item.flags, 'F_MOD_LIGHTER_FUEL_EMPTY'])?.available, false, 'spent fuel');
  }
});

const risks = [
  { event: 'E_MOD_CORN_BREAKTHROUGH', card: 'CARD_MODERN_CORN', option: 'corn_trial_risk', flags: ['F_MOD_CORN_READY', 'F_MOD_CORN_PRACTICE', 'F_MOD_CORN_TRIAL'], death: 'D_MOD_CORN_THEFT' },
  { event: 'E_MOD_FLASHLIGHT_BREAKTHROUGH', card: 'CARD_MODERN_FLASHLIGHT', option: 'flashlight_robbery', flags: ['F_MOD_FLASHLIGHT_READY', 'F_MOD_FLASHLIGHT_MAIN_DONE', 'F_MOD_FLASHLIGHT_EVIDENCE'], death: 'D_MOD_FLASHLIGHT_ROBBERY' },
];

for (const item of risks) {
  test(`${item.option}: independent danger requires adulthood, warns before choice, and has real success and failure outcomes`, () => {
    for (const age of [3, 17, 18, 65]) {
      const run = fixture(item.event, item.card, { age, flags: item.flags });
      const pending = run.start.pending;
      assert.equal(pending?.kind, 'option');
      const option = pending.options.find(entry => entry.id === item.option);
      assert.equal(option?.available, age >= 18, `age ${age}`);
      assert.ok(pending.options.some(entry => entry.available && entry.id !== item.option), `age ${age} needs another path`);
      const definition = run.event.options.find(entry => entry.id === item.option);
      assert.match(optionDetails(run.bundle, run.event, definition, option).join('\n'), /可能丧命/);
      assert.equal(option.risk, 'high');
    }
    const seen = new Set();
    for (let seed = 0; seed < 60 && seen.size < 2; seed++) {
      const run = fixture(item.event, item.card, { age: 18, seed, flags: item.flags });
      const before = run.start.state.player.attributes.prestige;
      choose(run, item.option);
      const result = resolve(run);
      const dice = result.logs.find(log => log.type === 'dice');
      assert.ok(dice);
      seen.add(dice.data.success);
      if (dice.data.success) {
        assert.notEqual(result.state.status, 'ENDED');
        assert.equal(result.state.player.attributes.prestige, before + 2);
      } else {
        assert.equal(result.state.status, 'ENDED');
        assert.equal(run.engine.exportSave().payload.run.death, item.death);
      }
    }
    assert.deepEqual(seen, new Set([true, false]));
  });
}

test('failed historical flashlight checks cost reputation without killing or recording the retired death', () => {
  const item = risks[1];
  for (const option of ['flashlight_break_brain', 'flashlight_break_body']) {
    let failure;
    for (let seed = 0; seed < 60 && !failure; seed++) {
      const run = fixture(item.event, item.card, { seed, flags: item.flags });
      const pending = run.start.pending.options.find(entry => entry.id === option);
      assert.equal(pending.risk, 'normal');
      const before = run.start.state.player.attributes.prestige;
      choose(run, option);
      const result = resolve(run);
      if (!result.logs.find(log => log.type === 'dice').data.success) failure = { result, before };
    }
    assert.ok(failure, option);
    assert.notEqual(failure.result.state.status, 'ENDED');
    assert.equal(failure.result.state.player.attributes.prestige, failure.before - 1);
    assert.equal(failure.result.state.player.flags.includes('F_MOD_FLASHLIGHT_DEATH_MISSTEP'), false);
  }
});

test('young players retain a real local care choice without automatically giving away medicine', () => {
  for (const age of [3, 17]) {
    const run = fixture('E_MOD_HEALER_BREAKTHROUGH', 'CARD_MODERN_ANTIBIOTIC', {
      age, flags: ['F_MOD_HEALER_READY', 'F_MOD_HEALER_COURSE_AVAILABLE'],
    });
    const pending = run.start.pending;
    assert.equal(pending?.kind, 'option');
    assert.equal(pending.options.find(option => option.id === 'safe')?.available, true);
    assert.equal(pending.options.find(option => option.id === 'use_course')?.available, true);
    const result = choose(run, 'safe');
    assert.ok(result.state.player.flags.includes('F_MOD_HEALER_LOCAL'));
    assert.ok(result.state.player.flags.includes('F_MOD_HEALER_COURSE_AVAILABLE'));
    assert.equal(result.state.player.flags.includes('F_MOD_HEALER_COURSE_USED'), false);
    assert.ok(result.state.player.achievements.includes('A_MOD_HEALER_LOCAL_HELP'));
  }
});

test('ordinary calculator blackout failure leaves the player alive with only a small reputation loss', () => {
  let failure;
  for (let seed = 0; seed < 60 && !failure; seed++) {
    const run = fixture('E_MOD_CALCULATOR_MISUSE', 'CARD_MODERN_CALCULATOR', { seed, attributes: { intelligence: 4 } });
    const before = run.start.state.player;
    const result = resolve(run);
    if (!result.logs.find(log => log.type === 'dice').data.success) failure = { before, result };
  }
  assert.ok(failure);
  const { before, result } = failure;
  assert.notEqual(result.state.status, 'ENDED');
  assert.equal(result.state.player.attributes.prestige, before.attributes.prestige - 1);
  assert.deepEqual(result.state.player.cards, before.cards);
  assert.deepEqual(result.state.player.injuries, before.injuries);
  assert.equal(result.state.player.flags.includes('F_MOD_CALCULATOR_DEATH_MISUSE'), false);
  assert.equal(result.state.player.achievements.includes('A_MOD_CALCULATOR_UPSIDE_DOWN'), false);
});

test('a failed lighter warming accident stops the broken lighter instead of killing the player', () => {
  let failure;
  for (let seed = 0; seed < 60 && !failure; seed++) {
    const run = fixture('E_MOD_LIGHTER_MISUSE', 'CARD_MODERN_LIGHTER', { seed, attributes: { intelligence: 4 } });
    const before = run.start.state.player.attributes.physique;
    const result = resolve(run);
    if (!result.logs.find(log => log.type === 'dice').data.success) failure = { before, result };
  }
  assert.ok(failure);
  assert.notEqual(failure.result.state.status, 'ENDED');
  assert.equal(failure.result.state.player.attributes.physique, failure.before - 1);
  assert.ok(failure.result.state.player.flags.includes('F_MOD_LIGHTER_FUEL_EMPTY'));
  assert.equal(failure.result.state.player.flags.includes('F_MOD_LIGHTER_DEATH_FIRE'), false);
});

test('new achievements require their own real milestone and never follow from a retired award alone', () => {
  const cases = [
    ['A_MOD_CORN_LOCAL_HELP', 'A_MOD_CORN_DEATH_RUMOUR', 'CARD_MODERN_CORN', 'F_MOD_CORN_MODEST'],
    ['A_MOD_CORN_TRY_AGAIN', 'A_MOD_CORN_DEATH_HUNGER', 'CARD_MODERN_CORN', 'F_MOD_CORN_SETBACK'],
    ['A_MOD_HEALER_LOCAL_HELP', 'A_MOD_HEALER_DEATH_DELAY', 'CARD_MODERN_ANTIBIOTIC', 'F_MOD_HEALER_LOCAL'],
    ['A_MOD_HEALER_COURSE_HANDOFF', 'A_MOD_HEALER_DEATH_ROBBERY', 'CARD_MODERN_ANTIBIOTIC', 'F_MOD_HEALER_COURSE_USED'],
    ['A_MOD_FLASHLIGHT_FIRST_LIGHT', 'A_MOD_FLASHLIGHT_DEATH_CLAIMS', 'CARD_MODERN_FLASHLIGHT', 'F_MOD_FLASHLIGHT_OPEN'],
    ['A_MOD_FLASHLIGHT_PASS_NOTES', 'A_MOD_FLASHLIGHT_DEATH_MISSTEP', 'CARD_MODERN_FLASHLIGHT', 'F_MOD_FLASHLIGHT_BREAK_SAFE'],
  ];
  const engine = new GameEngine(content, 'achievement-fixture');
  const initialized = successful(engine.initGame({ seed: 1 }));
  const initialRun = engine.exportSave().payload.run;
  for (const [id, oldId, card, flag] of cases) {
    const achievement = content.achievements.find(entry => entry.id === id);
    assert.ok(achievement, id);
    const bundle = { ...content, achievements: [achievement] };
    const player = structuredClone(initialized.state.player);
    player.cards = [card]; player.flags = []; player.achievements = [oldId];
    evaluateAchievements(bundle, player, initialRun, () => {});
    assert.equal(player.achievements.includes(id), false, `${id}: old award alone`);
    player.cards = []; player.flags = [flag];
    evaluateAchievements(bundle, player, initialRun, () => {});
    assert.equal(player.achievements.includes(id), false, `${id}: missing card`);
    player.cards = [card];
    evaluateAchievements(bundle, player, initialRun, () => {});
    assert.equal(player.achievements.includes(id), true, `${id}: real milestone`);
    assert.equal(player.achievements.includes(oldId), true, `${id}: old award preserved`);
  }
});

test('the temple story stays in the chronology once, even beyond its former cooldown', () => {
  const run = fixture('E_LIFE_FICT_CLAN_TEMPLE', 'CARD_MODERN_CORN', { age: 40, year: 1646, opening: false });
  assert.notEqual(run.start.state.status, 'ENDED');
  for (let year = 0; year < 15; year++) successful(run.engine.nextYear(`year:${year}`));
  const entries = run.engine.exportSave().payload.logs.filter(log => log.type === 'event' && log.source_id === 'E_LIFE_FICT_CLAN_TEMPLE');
  assert.equal(entries.length, 1);
});
