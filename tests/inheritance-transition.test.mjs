import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/controller.ts';
import { buildHome } from '../src/home.ts';
import { Ui } from '../src/ui.ts';
import { GameViewBuilder } from '../src/view.ts';
import { CurrentLifeStore } from '../src/game/application/CurrentLifeStore.ts';
import { GameSession } from '../src/game/application/GameSession.ts';
import { getNativeMingEndContent } from '../src/game/application/StaticContentLoader.ts';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { sha256Json } from '../src/game/core/persistence/JsonDigest.ts';
import { LifetimeRecords } from '../src/game/presentation/LifetimeRecords.ts';
import { ACHIEVEMENT_CATALOG, DEATH_CATALOG } from '../src/game/presentation/CollectionCatalog.ts';

const RECORDS = 'time-travel.lifetime-records.v2';
const SLOTS = ['time-travel.current-life.a.v1', 'time-travel.current-life.b.v1'];
const { bundle, fingerprint } = getNativeMingEndContent();
const attributes = ['physique', 'intelligence', 'wealth', 'prestige', 'luck'];
const pool = bundle.pools.find(item => item.id === bundle.rules.opening.pool_id);
const legacyBonus = { kind: 'extra_card', card_id: pool.entries.find(entry => entry.weight > 0).card_id };

function storage(reward = false) {
  const data = new Map(reward ? [[RECORDS, JSON.stringify({ version: 2, records: [], inheritanceAvailable: true })]] : []);
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function claim(port, lifeId) {
  port.data.set(RECORDS, JSON.stringify({ version: 3, records: [], inheritanceRewardId: 'legacy:v2',
    inheritanceClaim: { rewardId: 'legacy:v2', lifeId, state: 'pending' } }));
}
function slotBytes(port) { return SLOTS.map(key => port.data.get(key) ?? null); }
async function saveLife(port, lifeId, seed, inheritance) {
  const store = new CurrentLifeStore(port);
  store.read(() => {});
  const session = new GameSession(new GameEngine(bundle, fingerprint), {
    hash: sha256Json,
    persist: async save => store.write(save, lifeId),
    load: async () => null,
  });
  const result = await session.initialize(seed, inheritance);
  assert.equal(result.ok, true);
  return session.exportSave();
}

test('only five attributes can be newly selected; each is capped and consumed once', async () => {
  for (const attribute of attributes) {
    const port = storage(true);
    const c = new GameController(port);
    await c.start(12);
    assert.equal(c.snapshot.selectedInheritance, null);
    assert.equal(c.snapshot.legacyInheritanceChoice, null);
    c.continueLegacyInheritance();
    c.selectInheritance(legacyBonus);
    assert.equal(c.snapshot.selectedInheritance, null);
    c.selectInheritance({ kind: 'attribute', attribute });
    await Promise.all([c.confirmInheritance(), c.confirmInheritance()]);
    const baseline = new GameEngine(bundle, fingerprint).initGame({ seed: 12 });
    assert.equal(baseline.ok, true);
    const expected = { ...baseline.state.player.attributes,
      [attribute]: Math.min(bundle.rules.attributes.max, baseline.state.player.attributes[attribute] + 1) };
    assert.deepEqual(structuredClone(c.snapshot.view.player.attributes), expected);
    assert.deepEqual(c.snapshot.activeInheritance, { kind: 'attribute', attribute });
    assert.equal(c.snapshot.records.inheritanceAvailable, false);
    const resumed = new GameController(port);
    resumed.continueLife();
    assert.deepEqual(structuredClone(resumed.snapshot.view.player.attributes), expected);
    assert.equal(resumed.snapshot.records.inheritanceAvailable, false);
    resumed.home();
    await resumed.start(13);
    await resumed.confirmRestart();
    assert.notEqual(resumed.snapshot.overlay, 'inheritance');
    assert.equal(resumed.snapshot.activeInheritance, null);
  }
});

test('a same-session legacy choice requires an explicit decision and survives cancellation', async () => {
  const port = storage(true);
  const c = new GameController(port);
  await c.start(21);
  // Simulate the in-memory selection left by the previous screen before a live update.
  c.selectedInheritance = { ...legacyBonus };
  assert.equal(c.snapshot.legacyInheritanceChoice, 'pending');
  await c.confirmInheritance();
  assert.equal(c.snapshot.overlay, 'inheritance');
  c.selectInheritance({ kind: 'attribute', attribute: 'luck' });
  assert.deepEqual(c.snapshot.selectedInheritance, legacyBonus);
  const context = { save() {}, restore() {}, measureText: text => ({ width: [...text].length * 24 }) };
  const view = new GameViewBuilder(c, {}, { storage: port, context, getViewport: () => ({ width: 360 }), asset: path => path }, () => {}, () => {});
  let scene = view.overlay(c.snapshot, 1334, 0, 0);
  assert.equal(scene.actions.find(action => action.id === 'confirmInheritance').disabled, true);
  assert.ok(scene.actions.some(action => action.id === 'continueLegacyInheritance'));
  assert.ok(scene.actions.some(action => action.id === 'changeLegacyInheritance'));
  c.close();
  assert.equal(c.snapshot.records.inheritanceAvailable, true);
  c.home();
  await c.start(21);
  assert.deepEqual(c.snapshot.selectedInheritance, legacyBonus);
  assert.equal(c.snapshot.legacyInheritanceChoice, 'pending');
  scene = view.overlay(c.snapshot, 1334, 0, 0);
  scene.actions.find(action => action.id === 'continueLegacyInheritance').invoke();
  assert.equal(c.snapshot.legacyInheritanceChoice, 'continue');
  scene = view.overlay(c.snapshot, 1334, 0, 0);
  assert.equal(scene.actions.find(action => action.id === 'confirmInheritance').disabled, false);
  scene.actions.find(action => action.id === 'changeLegacyInheritance').invoke();
  assert.equal(c.snapshot.selectedInheritance, null);
  assert.equal(c.snapshot.legacyInheritanceChoice, null);
  c.selectInheritance({ kind: 'attribute', attribute: 'luck' });
  await c.confirmInheritance();
  assert.deepEqual(c.snapshot.activeInheritance, { kind: 'attribute', attribute: 'luck' });
});

test('a failed old-choice start retains its in-memory choice when absence is proven', async () => {
  const port = storage(true);
  const c = new GameController(port);
  await c.start(22);
  c.selectedInheritance = { ...legacyBonus };
  c.continueLegacyInheritance();
  const set = port.setItem;
  port.setItem = (key, value) => {
    if (SLOTS.includes(key)) throw new Error('write interrupted before saving');
    set(key, value);
  };
  await c.confirmInheritance();
  assert.equal(c.snapshot.saveBlocked, true);
  port.setItem = set;
  c.retryStorage();
  assert.equal(c.snapshot.records.inheritanceAvailable, true);
  assert.deepEqual(c.snapshot.selectedInheritance, legacyBonus);
  assert.equal(c.snapshot.legacyInheritanceChoice, 'pending');
  await c.start(22);
  assert.equal(c.snapshot.legacyInheritanceChoice, 'pending');
  c.continueLegacyInheritance();
  assert.equal(c.snapshot.legacyInheritanceChoice, 'continue');
  await c.confirmInheritance();
  assert.deepEqual(c.snapshot.activeInheritance, legacyBonus);
});

test('a matching stored legacy life is consumed once without changing slots, replay or attributes', async () => {
  const port = storage();
  const original = await saveLife(port, 'legacy-life', 31, legacyBonus);
  claim(port, 'legacy-life');
  const slots = slotBytes(port);
  const c = new GameController(port);
  assert.equal(c.snapshot.records.inheritanceAvailable, false);
  assert.equal(JSON.parse(port.data.get(RECORDS)).inheritanceClaim.state, 'consumed');
  assert.deepEqual(slotBytes(port), slots);
  c.continueLife();
  assert.deepEqual(c.snapshot.activeInheritance, legacyBonus);
  assert.ok(c.snapshot.view.pending.cards.includes(legacyBonus.card_id));
  assert.ok(c.snapshot.view.pending.cards.length <= 3);
  const baseline = new GameEngine(bundle, fingerprint).initGame({ seed: 31 });
  assert.deepEqual(c.snapshot.view.player.attributes, baseline.state.player.attributes);
  assert.deepEqual(original.replay_commands[0].args.inheritance, legacyBonus);
  assert.deepEqual(slotBytes(port), slots);
  c.revealCards();
  const replacement = pool.entries.find(entry => entry.weight > 0 && !c.snapshot.view.pending.cards.includes(entry.card_id)).card_id;
  c.openCardPool(legacyBonus.card_id);
  await c.replaceCardOffer(replacement);
  assert.ok(c.snapshot.view.pending.cards.includes(replacement));
  assert.ok(!c.snapshot.view.pending.cards.includes(legacyBonus.card_id));
  const resumed = new GameController(port);
  resumed.continueLife();
  assert.deepEqual(resumed.snapshot.activeInheritance, legacyBonus);
  assert.deepEqual(resumed.snapshot.view.pending.cards, c.snapshot.view.pending.cards);
  assert.equal(resumed.snapshot.records.inheritanceAvailable, false);
});

test('a matching older slot is recognized without replacing the newer current life', async () => {
  const port = storage();
  await saveLife(port, 'older-target', 41, legacyBonus);
  const latest = await saveLife(port, 'newer-life', 42);
  claim(port, 'older-target');
  const slots = slotBytes(port);
  const c = new GameController(port);
  assert.equal(c.snapshot.saveBlocked, false);
  assert.equal(c.snapshot.records.inheritanceAvailable, false);
  assert.equal(JSON.parse(port.data.get(RECORDS)).inheritanceClaim.state, 'consumed');
  assert.deepEqual(slotBytes(port), slots);
  c.continueLife();
  assert.equal(c.snapshot.activeInheritance, null);
  assert.deepEqual(c.snapshot.view.player.attributes, latest.engine.payload.player.attributes);
  assert.deepEqual(slotBytes(port), slots);
});

test('an absent claim is released only when both slots are known, without inventing an old selection', async () => {
  for (const occupied of [false, true]) {
    const port = storage();
    if (occupied) {
      await saveLife(port, 'unrelated-1', 51);
      await saveLife(port, 'unrelated-2', 52);
    }
    claim(port, 'never-saved');
    const slots = slotBytes(port);
    const c = new GameController(port);
    assert.equal(c.snapshot.saveBlocked, false);
    assert.equal(c.snapshot.records.inheritanceAvailable, true);
    assert.equal(c.snapshot.selectedInheritance, null);
    assert.equal(JSON.parse(port.data.get(RECORDS)).inheritanceClaim, null);
    assert.deepEqual(slotBytes(port), slots);
    await c.start(53);
    if (occupied) await c.confirmRestart();
    assert.equal(c.snapshot.overlay, 'inheritance');
    assert.equal(c.snapshot.selectedInheritance, null);
    assert.equal(c.snapshot.legacyInheritanceChoice, null);
  }
});

test('any damaged, incompatible, unavailable or ambiguous slot blocks pending claims', async () => {
  for (const problem of ['damaged', 'incompatible', 'unavailable', 'equal-generation']) {
    const port = storage();
    const first = await saveLife(port, 'older-target', 61, legacyBonus);
    const second = await saveLife(port, 'other-life', 62);
    const original = slotBytes(port);
    if (problem === 'damaged') port.data.set(SLOTS[1], '{damaged');
    if (problem === 'incompatible') port.data.set(SLOTS[0], JSON.stringify({ format: 99, generation: 1 }));
    if (problem === 'equal-generation') {
      const envelope = (lifeId, session) => {
        const body = { format: 1, generation: 1, life_id: lifeId, session };
        return JSON.stringify({ ...body, checksum: sha256Json(body) });
      };
      port.data.set(SLOTS[0], envelope('older-target', first));
      port.data.set(SLOTS[1], envelope('other-life', second));
    }
    claim(port, 'older-target');
    const before = slotBytes(port), recordBefore = port.data.get(RECORDS);
    const get = port.getItem;
    if (problem === 'unavailable') port.getItem = key => {
      if (key === SLOTS[1]) throw new Error('slot unavailable');
      return get(key);
    };
    const c = new GameController(port);
    assert.equal(c.snapshot.saveBlocked, true, problem);
    assert.equal(c.snapshot.records.inheritancePending, true, problem);
    assert.equal(port.data.get(RECORDS), recordBefore, problem);
    assert.deepEqual(slotBytes(port), before, problem);
    port.getItem = get;
    port.data.set(SLOTS[0], original[0]);
    port.data.set(SLOTS[1], original[1]);
    c.retryStorage();
    assert.equal(c.snapshot.saveBlocked, false, problem);
    assert.equal(c.snapshot.records.inheritanceAvailable, false, problem);
    assert.equal(JSON.parse(port.data.get(RECORDS)).inheritanceClaim.state, 'consumed', problem);
    assert.deepEqual(slotBytes(port), original, problem);
  }
});

test('snapshot logs are exactly the persisted chronology after play and restore', async () => {
  const port = storage();
  const c = new GameController(port);
  assert.deepEqual(c.snapshot.logs, []);
  await c.start(71);
  c.revealCards();
  await c.selectCard(c.snapshot.view.pending.cards[0]);
  await c.confirmCard();
  const stored = new CurrentLifeStore(port).read(() => {});
  assert.equal(stored.status, 'ready');
  assert.ok(stored.save.engine.payload.logs.length > 0);
  assert.deepEqual(structuredClone(c.snapshot.logs), structuredClone(stored.save.engine.payload.logs));
  const resumed = new GameController(port);
  assert.deepEqual(resumed.snapshot.logs, []);
  resumed.continueLife();
  assert.deepEqual(structuredClone(resumed.snapshot.logs), structuredClone(stored.save.engine.payload.logs));
  resumed.home();
  assert.deepEqual(resumed.snapshot.logs, []);
});

test('new collection includes current catalog entries only while records retain history', () => {
  const port = storage();
  const c = new GameController(port);
  const current = bundle.achievements.find(item => ACHIEVEMENT_CATALOG[item.id]?.status === 'current');
  const historic = bundle.achievements.find(item => ACHIEVEMENT_CATALOG[item.id]?.status !== 'current');
  const historicDeath = bundle.deaths.find(item => DEATH_CATALOG[item.id]?.status !== 'current');
  assert.ok(current && historic && historicDeath);
  c.lifeId = 'finished';
  c.recordEnding({ end_age: 70, years_played: 30, achievements: [current.id, historic.id, 'A_UNKNOWN'],
    primary_achievement_id: null, death_id: historicDeath.id });
  assert.deepEqual(c.snapshot.newCollection, { achievements: [current.id], deaths: [] });
  assert.ok(c.snapshot.records.achievements.has(historic.id));
  assert.ok(c.snapshot.records.achievements.has('A_UNKNOWN'));
  assert.ok(c.snapshot.records.deaths.has(historicDeath.id));
});

test('home reports an empty current catalog without a percentage or zero denominator', () => {
  const c = new GameController(storage(true));
  const empty = { collected: 0, total: 0, percent: 0 };
  const snapshot = { ...c.snapshot, collection: { achievements: empty, deaths: empty, total: empty } };
  const ui = new Ui(360);
  buildHome(ui, snapshot, 1334, c);
  const progress = ui.texts.find(text => text.includes('图鉴收集'));
  assert.ok(progress.includes('暂无可收集条目'));
  assert.ok(!progress.includes('0/0'));
  assert.ok(!progress.includes('%'));
  assert.ok(ui.texts.some(text => text.includes('属性 +1')));
});

test('pending claim identity is hidden after a records read failure until reloaded', () => {
  const port = storage();
  claim(port, 'pending-life');
  const records = new LifetimeRecords(port);
  assert.equal(records.pendingInheritanceLifeId, 'pending-life');
  const get = port.getItem;
  port.getItem = () => { throw new Error('records unavailable'); };
  assert.throws(() => records.reload(), { code: 'SAVE_FAILED' });
  assert.equal(records.pendingInheritanceLifeId, null);
  port.getItem = get;
  records.reload();
  assert.equal(records.pendingInheritanceLifeId, 'pending-life');
});

test('unreadable or unconfirmed records never advertise an available reward', () => {
  const port = storage(true);
  const records = new LifetimeRecords(port);
  assert.equal(records.snapshot().inheritanceAvailable, true);
  const get = port.getItem;
  port.getItem = () => { throw new Error('records unavailable'); };
  assert.throws(() => records.reload(), { code: 'SAVE_FAILED' });
  assert.equal(records.snapshot().inheritanceAvailable, false);
  port.getItem = get;
  records.reload();
  assert.equal(records.snapshot().inheritanceAvailable, true);
  const unconfirmedPort = storage();
  const unconfirmed = new LifetimeRecords(unconfirmedPort);
  unconfirmedPort.setItem = () => { throw new Error('write unconfirmed'); };
  assert.throws(() => unconfirmed.record('life', { end_age: 60, years_played: 30, achievements: [],
    primary_achievement_id: null, death_id: 'D_TEST' }), { code: 'SAVE_FAILED' });
  assert.equal(unconfirmed.snapshot().inheritanceAvailable, false);
});
