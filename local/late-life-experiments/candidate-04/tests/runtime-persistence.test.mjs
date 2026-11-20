import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { GameSession } from '../src/game/application/GameSession.ts';
import { CurrentLifeStore } from '../src/game/application/CurrentLifeStore.ts';
import { sha256Json } from '../src/game/core/persistence/JsonDigest.ts';
import { GameController } from '../src/controller.ts';
import { LifetimeRecords } from '../src/game/presentation/LifetimeRecords.ts';
import { optionDetails } from '../src/presenters.ts';
import { acquireWebSessionLock } from '../src/platform.ts';

const content = await loadContent();
const slots = ['time-travel.current-life.a.v1', 'time-travel.current-life.b.v1'];
class Storage {
  values = new Map();
  failWrites = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error('quota');
    this.values.set(key, value);
  }
}
function sessionFor(bundle, persist = async () => {}, load = async () => null) {
  return new GameSession(new GameEngine(bundle, 'test-fingerprint'), { hash: sha256Json, persist, load });
}
function validate(bundle, save) {
  sessionFor(bundle).restoreSave(save);
}
function openingPool(bundle) {
  return bundle.pools.find(pool => pool.id === bundle.rules.opening.pool_id).entries.filter(entry => entry.weight > 0).map(entry => entry.card_id);
}
function assertOk(result) {
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result;
}

test('replacement is a legal, idempotent, deterministic engine command, not a story choice', () => {
  const engine = new GameEngine(content, 'test-fingerprint');
  const initial = assertOk(engine.initGame({ seed: 99 }));
  const before = engine.exportSave();
  const offers = initial.pending.cards;
  const replacement = openingPool(content).find(id => !offers.includes(id));
  assert.ok(replacement);
  const result = assertOk(engine.replaceCardOffer('replace:1', offers[0], replacement));
  assert.deepEqual(result.pending.cards, [replacement, ...offers.slice(1)]);
  assert.deepEqual(result.logs, []);
  assert.deepEqual(engine.exportSave().payload.run.prng, before.payload.run.prng);
  assert.deepEqual(engine.replaceCardOffer('replace:1', offers[0], replacement), result);
  assert.equal(engine.replaceCardOffer('replace:1', replacement, offers[0]).error.code, 'COMMAND_ID_CONFLICT');
  assert.equal(engine.replaceCardOffer('duplicate', replacement, offers[1]).error.code, 'CARD_UNAVAILABLE');
  assert.equal(engine.replaceCardOffer('invalid', replacement, 'NOT_IN_OPENING_POOL').error.code, 'CARD_UNAVAILABLE');
  assertOk(engine.replaceCardOffer('replace:2', replacement, offers[0]));
  const saved = engine.exportSave();
  const restored = new GameEngine(content, 'test-fingerprint');
  restored.restoreSave(saved);
  assert.deepEqual(restored.exportSave(), saved);
  assertOk(restored.selectCard('select', offers[0]));
  assert.equal(restored.replaceCardOffer('too-late', offers[0], replacement).error.code, 'INVALID_STATE');
});

test('directed inheritance occupies one of at most three unique offers and all remain replaceable', async () => {
  const session = sessionFor(content);
  const desired = openingPool(content)[0];
  const opening = assertOk(await session.initialize(43, { kind: 'extra_card', card_id: desired }));
  assert.ok(opening.pending.cards.length <= 3);
  assert.equal(opening.pending.cards.filter(id => id === desired).length, 1);
  assert.equal(new Set(opening.pending.cards).size, opening.pending.cards.length);
  const replacement = openingPool(content).find(id => !opening.pending.cards.includes(id));
  const changed = assertOk(await session.command({ type: 'replaceCardOffer', previousCardId: desired, cardId: replacement }));
  assert.ok(!changed.pending.cards.includes(desired));
  const restored = sessionFor(content);
  restored.restoreSave(session.exportSave());
  assert.deepEqual(restored.current().pending.cards, changed.pending.cards);
  assert.equal(new Set(restored.current().pending.cards).size, restored.current().pending.cards.length);
});

test('card drafts restore without locking and legacy cursors remain readable', async () => {
  const session = sessionFor(content);
  const opening = assertOk(await session.initialize(44));
  const before = session.exportSave();
  const selected = opening.pending.cards[0];
  await session.selectCardOffer(selected);
  const save = session.exportSave();
  assert.deepEqual(save.engine, before.engine);
  assert.deepEqual(save.replay_commands, before.replay_commands);
  assert.equal(save.cursor.selected_card_id, selected);
  const restored = sessionFor(content);
  restored.restoreSave(save);
  assert.equal(restored.exportSave().cursor.selected_card_id, selected);
  assert.equal(restored.current().pending.kind, 'card');
  assert.deepEqual(restored.current().state.player.cards, []);
  const legacy = structuredClone(save);
  delete legacy.cursor.selected_card_id;
  restored.restoreSave(legacy);
  assert.equal(restored.exportSave().cursor.selected_card_id, null);
  const invalid = structuredClone(save);
  invalid.cursor.selected_card_id = 'NOT_AN_OFFER';
  assert.throws(() => restored.restoreSave(invalid), { code: 'SAVE_INVALID' });
});

test('both platform slots survive restart, fall back after corruption, and retain incompatible generations', async () => {
  const storage = new Storage();
  const store = new CurrentLifeStore(storage);
  assert.equal(store.read(save => validate(content, save)).status, 'empty');
  const session = sessionFor(content, async save => store.write(save, 'life-1'));
  const initial = assertOk(await session.initialize(11));
  const replacement = openingPool(content).find(id => !initial.pending.cards.includes(id));
  assertOk(await session.command({ type: 'replaceCardOffer', previousCardId: initial.pending.cards[0], cardId: replacement }));
  const originalA = storage.getItem(slots[0]);
  const originalB = storage.getItem(slots[1]);
  const restarted = new CurrentLifeStore(storage);
  const latest = restarted.read(save => validate(content, save));
  assert.equal(latest.status, 'ready');
  assert.equal(latest.save.engine.payload.run.card_offers[0], replacement);
  storage.setItem(slots[1], '{broken');
  const fallback = new CurrentLifeStore(storage).read(save => validate(content, save));
  assert.equal(fallback.status, 'ready');
  assert.equal(fallback.recovered, true);
  assert.deepEqual(fallback.save.engine.payload.run.card_offers, initial.pending.cards);
  storage.setItem(slots[1], originalB);
  const oldFormatBody = { format: 1, generation: 2, life_id: 'life-1', session: structuredClone(latest.save) };
  oldFormatBody.session.engine.rules_implementation_version += 1;
  storage.setItem(slots[1], JSON.stringify({ ...oldFormatBody, checksum: sha256Json(oldFormatBody) }));
  const versions = new CurrentLifeStore(storage);
  assert.equal(versions.read(save => validate(content, save)).status, 'incompatible');
  assert.equal(storage.getItem(slots[0]), originalA);
  assert.throws(() => versions.write(fallback.save, 'life-2'), { code: 'SAVE_FAILED' });
  versions.write(fallback.save, 'life-2', true);
  const afterConsent = new CurrentLifeStore(storage).read(save => validate(content, save));
  assert.equal(afterConsent.status, 'ready');
  assert.equal(afterConsent.lifeId, 'life-2');
});

test('a failed write stops the session and can be explicitly restored without losing the prior offer', async () => {
  const storage = new Storage();
  const store = new CurrentLifeStore(storage);
  store.read(save => validate(content, save));
  const load = async () => {
    const result = store.read(save => validate(content, save));
    return result.status === 'ready' ? result.save : null;
  };
  const session = sessionFor(content, async save => store.write(save, 'life-1'), load);
  const initial = assertOk(await session.initialize(21));
  const replacement = openingPool(content).find(id => !initial.pending.cards.includes(id));
  storage.failWrites = true;
  await assert.rejects(session.command({ type: 'replaceCardOffer', previousCardId: initial.pending.cards[0], cardId: replacement }), { code: 'SAVE_FAILED' });
  assert.deepEqual(session.current().pending.cards, initial.pending.cards);
  storage.failWrites = false;
  const saved = await load();
  const resumed = sessionFor(content, async value => store.write(value, 'life-1'), load);
  resumed.restoreSave(saved);
  assert.equal(resumed.exportSave().cursor.authorized, false);
  assert.deepEqual(resumed.current().pending.cards, initial.pending.cards);
  assertOk(await resumed.command({ type: 'replaceCardOffer', previousCardId: initial.pending.cards[0], cardId: replacement }));
});

test('controller reloads replaced offers, pauses, and asks before overwriting', async () => {
  const storage = new Storage();
  const first = new GameController(storage);
  await first.start(34);
  first.revealCards();
  const offers = first.snapshot.view.pending.cards;
  const replacement = openingPool(first.bundle).find(id => !offers.includes(id));
  first.openCardPool(offers[0]);
  await first.replaceCardOffer(replacement);
  const before = first.snapshot.view;
  const next = new GameController(storage);
  assert.equal(next.snapshot.saveStatus, 'ready');
  next.continueLife();
  assert.deepEqual(next.snapshot.view, before);
  assert.equal(next.snapshot.overlay, 'cards');
  assert.equal(next.snapshot.selectedCardId, replacement);
  assert.deepEqual(next.snapshot.view.player.cards, []);
  const manual = next.snapshot.view.pending.cards.find(id => id !== replacement);
  await next.selectCard(manual);
  const refreshed = new GameController(storage);
  refreshed.continueLife();
  assert.equal(refreshed.snapshot.selectedCardId, manual);
  assert.equal(refreshed.snapshot.view.pending.kind, 'card');
  assert.deepEqual(refreshed.snapshot.view.player.cards, []);
  next.home();
  const existing = slots.map(key => storage.getItem(key));
  await next.start(35);
  assert.equal(next.snapshot.overlay, 'restart');
  assert.deepEqual(slots.map(key => storage.getItem(key)), existing);
  next.close();
  assert.deepEqual(slots.map(key => storage.getItem(key)), existing);
});

function stagedBundle(withCritical) {
  const bundle = structuredClone(content);
  bundle.chains = [];
  bundle.achievements = [];
  bundle.era.age_transitions = [];
  for (const source of [...bundle.regions, ...bundle.castes]) { source.modifiers = {}; source.flags = []; }
  for (const background of bundle.era.backgrounds) {
    background.modifiers = { intelligence: 15, luck: 11 };
    background.flags = [];
  }
  bundle.rules.age_bands = [{ id: 'test-adult', min: 25, max: 25, weight: 1, modifiers: {} }];
  const outcome = flag => ({ text: flag, effects: [{ type: 'flag_add', id: flag }], next_stage_id: null });
  bundle.events = [{ id: 'E_TEST_LUCK', text: 'test', interaction: 'choice',
    trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
    options: [{ id: 'O_TEST', text: 'test', risk: 'normal', outcome: { text: 'test', effects: [{ type: 'attribute_add', attribute: 'luck', amount: 1 }], next_stage_id: 'S_TEST' } }],
    stages: [{ id: 'S_TEST', text: 'test', check: { attribute: 'intelligence', dc: 10, modifier: 0, raw_minimum: 10 },
      success: outcome('F_SUCCESS'), failure: outcome('F_FAILURE'), ...(withCritical ? { critical_success: outcome('F_CRITICAL') } : {}) }] }];
  return bundle;
}

test('pending previews use projected luck and a successful 19 chooses critical only when that branch exists', async () => {
  const critical = stagedBundle(true);
  let selectedSeed;
  for (let seed = 0; seed < 200 && selectedSeed === undefined; seed++) {
    const session = sessionFor(critical);
    const initialized = assertOk(await session.initialize(seed));
    const opening = assertOk(await session.command({ type: 'selectCard', cardId: initialized.pending.cards[0] }));
    const option = opening.pending.options[0];
    assert.equal(opening.state.player.attributes.luck, 14);
    assert.equal(option.checks[0].luck_value, 15);
    assert.ok(optionDetails(critical, critical.events[0], critical.events[0].options[0], option).some(line => line.includes('特殊大成功率')));
    assert.equal(option.checks[0].effective_raw_minimum, 7);
    assert.equal(option.checks[0].critical_probability, 0.1);
    const choice = assertOk(await session.command({ type: 'choose', optionId: option.id }));
    const beforeStage = session.exportSave();
    const restored = sessionFor(critical);
    restored.restoreSave(beforeStage);
    assert.equal(restored.current().pending.kind, 'stage');
    assert.equal(restored.exportSave().cursor.authorized, false);
    const result = assertOk(await restored.command({ type: 'stage' }));
    const die = result.logs.find(log => log.type === 'dice').data;
    assert.equal(die.luck_value, choice.pending.check.luck_value);
    assert.equal(die.success_probability, choice.pending.check.success_probability);
    if (die.raw === 19) {
      selectedSeed = seed;
      assert.equal(die.critical_success, true);
      assert.ok(result.state.player.flags.includes('F_CRITICAL'));
    }
  }
  assert.notEqual(selectedSeed, undefined);
  const ordinaryBundle = stagedBundle(false);
  const ordinary = sessionFor(ordinaryBundle);
  const initialized = assertOk(await ordinary.initialize(selectedSeed));
  const opening = assertOk(await ordinary.command({ type: 'selectCard', cardId: initialized.pending.cards[0] }));
  assert.equal(optionDetails(ordinaryBundle, ordinaryBundle.events[0], ordinaryBundle.events[0].options[0], opening.pending.options[0]).some(line => line.includes('特殊大成功率')), false);
  assertOk(await ordinary.command({ type: 'choose', optionId: opening.pending.options[0].id }));
  const result = assertOk(await ordinary.command({ type: 'stage' }));
  assert.equal(result.logs.find(log => log.type === 'dice').data.raw, 19);
  assert.ok(result.state.player.flags.includes('F_SUCCESS'));
  assert.equal(result.state.player.flags.includes('F_CRITICAL'), false);
});

test('controller blocks after a failed write and retry restores the last durable offer paused', async () => {
  const storage = new Storage();
  const controller = new GameController(storage);
  await controller.start(51);
  controller.revealCards();
  const original = [...controller.snapshot.view.pending.cards];
  const replacement = openingPool(controller.bundle).find(id => !original.includes(id));
  controller.openCardPool(original[0]);
  storage.failWrites = true;
  await controller.replaceCardOffer(replacement);
  assert.equal(controller.snapshot.saveBlocked, true);
  assert.equal(controller.snapshot.overlay, 'saveFailure');
  controller.home();
  assert.equal(controller.snapshot.saveBlocked, true);
  assert.equal(controller.snapshot.overlay, 'saveFailure');
  storage.failWrites = false;
  controller.retryStorage();
  assert.equal(controller.snapshot.saveBlocked, false);
  assert.equal(controller.snapshot.overlay, 'cards');
  assert.deepEqual(controller.snapshot.view.pending.cards, original);
});

test('draft selection write failures stop play and recover only the durable selection', async () => {
  for (const written of [false, true]) {
    const storage = new Storage();
    const controller = new GameController(storage);
    await controller.start(52);
    controller.revealCards();
    const [first, second] = controller.snapshot.view.pending.cards;
    await controller.selectCard(first);
    const set = storage.setItem.bind(storage);
    let failed = false;
    storage.setItem = (key, value) => {
      if (!failed && key.startsWith('time-travel.current-life.')) {
        failed = true;
        if (written) set(key, value);
        throw new Error('draft write failed');
      }
      set(key, value);
    };
    await controller.selectCard(second);
    assert.equal(controller.snapshot.saveBlocked, true);
    assert.equal(controller.snapshot.overlay, 'saveFailure');
    storage.setItem = set;
    controller.retryStorage();
    assert.equal(controller.snapshot.selectedCardId, written ? second : first);
    assert.equal(controller.snapshot.view.pending.kind, 'card');
    assert.deepEqual(controller.snapshot.view.player.cards, []);
  }
});

test('a pending stage and death report restore paused, and the report is recorded only once', async () => {
  const bundle = stagedBundle(false);
  const death = { text: '终局', effects: [{ type: 'death', id: bundle.era.old_age_death_id }], next_stage_id: null };
  bundle.events[0].stages[0].success = death;
  bundle.events[0].stages[0].failure = death;
  let durable = null;
  const session = sessionFor(bundle, async save => { durable = structuredClone(save); });
  const initial = assertOk(await session.initialize(17));
  const option = assertOk(await session.command({ type: 'selectCard', cardId: initial.pending.cards[0] }));
  const pendingOption = sessionFor(bundle);
  pendingOption.restoreSave(durable);
  assert.equal(pendingOption.current().pending.kind, 'option');
  assertOk(await session.command({ type: 'choose', optionId: option.pending.options[0].id }));
  const stageSave = durable;
  await session.advanceToDecision('automatic', { shouldStop: () => false });
  assert.equal(session.current().state.status, 'ENDED');
  const ended = durable;
  const restoredStage = sessionFor(bundle);
  restoredStage.restoreSave(stageSave);
  assert.equal(restoredStage.current().pending.kind, 'stage');
  assert.equal(restoredStage.exportSave().cursor.authorized, false);
  const restoredEnd = sessionFor(bundle);
  restoredEnd.restoreSave(ended);
  assert.equal(restoredEnd.current().state.status, 'ENDED');
  assert.equal(restoredEnd.exportSave().cursor.authorized, false);
  const storage = new Storage();
  const report = ended.engine.payload.run.ending;
  new LifetimeRecords(storage).record('persistent-life-id', report);
  new LifetimeRecords(storage).record('persistent-life-id', report);
  assert.equal(new LifetimeRecords(storage).snapshot().completed, 1);
});

test('saved automatic advancement authorization is revoked on restore', async () => {
  const bundle = stagedBundle(false);
  let durable = null;
  const session = sessionFor(bundle, async save => { durable = structuredClone(save); });
  const initial = assertOk(await session.initialize(18));
  const option = assertOk(await session.command({ type: 'selectCard', cardId: initial.pending.cards[0] }));
  assertOk(await session.command({ type: 'choose', optionId: option.pending.options[0].id }));
  await assert.rejects(session.advanceToDecision('automatic', {
    onResult: () => { throw new Error('interrupt after persistence'); },
  }), /interrupt after persistence/);
  assert.equal(durable.cursor.authorized, true);
  const restored = sessionFor(bundle);
  restored.restoreSave(durable);
  assert.equal(restored.exportSave().cursor.authorized, false);
  assert.equal(restored.current().state.revision, durable.engine.revision);
});

test('Web session ownership admits one writer and leaves other pages read-only', async () => {
  const locks = {
    active: false,
    request(name, options, callback) {
      assert.equal(name, 'time-travel.life-writer');
      assert.equal(options.ifAvailable, true);
      if (this.active) return Promise.resolve(callback(null));
      this.active = true;
      this.held = Promise.resolve(callback({ name })).finally(() => { this.active = false; });
      return this.held;
    },
  };
  const owner = await acquireWebSessionLock(locks);
  assert.equal(owner.reason, null);
  const second = await acquireWebSessionLock(locks);
  assert.equal(second.release, null);
  assert.match(second.reason, /另一个页面/);
  const unsupported = await acquireWebSessionLock(undefined);
  assert.equal(unsupported.release, null);
  assert.match(unsupported.reason, /HTTPS|localhost/);
  owner.release();
  await locks.held;
  const next = await acquireWebSessionLock(locks);
  assert.equal(next.reason, null);
  next.release();
  await locks.held;
});

test('a read-only controller never writes current-life or completion records', async () => {
  const storage = new Storage();
  const owner = new GameController(storage);
  await owner.start(71);
  const before = [...storage.values.entries()];
  const readOnly = new GameController(storage, '只读测试');
  await readOnly.start(72);
  readOnly.continueLife();
  readOnly.retryStorage();
  readOnly.open('achievements');
  readOnly.close();
  readOnly.home();
  assert.equal(readOnly.snapshot.readOnlyReason, '只读测试');
  assert.equal(readOnly.snapshot.screen, 'home');
  assert.deepEqual([...storage.values.entries()], before);
});
