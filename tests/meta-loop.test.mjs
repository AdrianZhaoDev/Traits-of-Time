import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/controller.ts';
import { GameSession } from '../src/game/application/GameSession.ts';
import { GameViewBuilder } from '../src/view.ts';
import { ACHIEVEMENT_CATALOG, DEATH_CATALOG } from '../src/game/presentation/CollectionCatalog.ts';

const KEY = 'time-travel.lifetime-records.v2';
function storage(reward = false) {
  const data = new Map(reward ? [[KEY, JSON.stringify({ version: 2, records: [], inheritanceAvailable: true })]] : []);
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function cardBonus(controller) {
  const pool = controller.bundle.pools.find(item => item.id === controller.bundle.rules.opening.pool_id);
  return { kind: 'extra_card', card_id: pool.entries.find(entry => entry.weight > 0).card_id };
}
function builder(controller) {
  const context = { save() {}, restore() {}, measureText: text => ({ width: [...text].length * 24 }) };
  return new GameViewBuilder(controller, {}, { context, getViewport: () => ({ width: 360 }), asset: path => path }, () => {}, () => {});
}
const overlay = (view, controller) => view.overlay(controller.snapshot, 1334, 0, 0);
async function pendingWithDamagedTarget() {
  const port = storage();
  const original = new GameController(port);
  await original.start(1);
  port.data.set(KEY, JSON.stringify({ version: 2, records: [], inheritanceAvailable: true }));
  const c = new GameController(port);
  await c.start(2);
  await c.confirmRestart();
  c.selectInheritance({ kind: 'attribute', attribute: 'luck' });
  const set = port.setItem;
  let captured;
  port.setItem = (key, value) => {
    if (key.startsWith('time-travel.current-life.') && !captured) {
      captured = [key, value];
      set(key, '{damaged');
      throw new Error('interrupted write');
    }
    set(key, value);
  };
  await c.confirmInheritance();
  assert.ok(captured);
  assert.equal(c.snapshot.saveBlocked, true);
  port.setItem = set;
  return { port, captured };
}
async function finish(controller) {
  if (controller.snapshot.screen === 'identity') {
    controller.revealCards();
    await controller.selectCard(controller.snapshot.view.pending.cards[0]);
    await controller.confirmCard();
  }
  for (let i = 0; i < 600 && controller.snapshot.view.status !== 'ENDED'; i++) {
    const pending = controller.snapshot.view.pending;
    if (pending?.kind === 'option') await controller.choose(pending.options.find(option => option.available).id);
    else if (pending?.kind === 'stage') await controller.resolveStage();
    else await controller.advance();
  }
  assert.equal(controller.snapshot.view.status, 'ENDED');
}

test('inheritance selection is cancellable, validated, consumed once and survives durable resume', async t => {
  const port = storage(true);
  const c = new GameController(port);
  const v = builder(c);
  await c.start(1);
  assert.equal(c.snapshot.overlay, 'inheritance');
  assert.equal(c.snapshot.view, null);
  assert.equal(c.snapshot.selectedInheritance, null);
  let scene = overlay(v, c);
  assert.equal(scene.actions.filter(action => action.id.startsWith('inheritance_')).length, 5);
  assert.equal(scene.actions.find(action => action.id === 'confirmInheritance').disabled, true);
  await c.confirmInheritance();
  assert.equal(c.snapshot.view, null);
  c.selectInheritance({ kind: 'attribute', attribute: 'invalid' });
  assert.equal(c.snapshot.selectedInheritance, null);
  c.close();
  assert.equal(c.snapshot.records.inheritanceAvailable, true);
  assert.equal(c.snapshot.overlay, null);
  await c.start(1);
  c.selectInheritance({ kind: 'attribute', attribute: 'wealth' });
  const original = GameSession.prototype.initialize;
  GameSession.prototype.initialize = async () => { throw new Error('initialization failed'); };
  try { await c.confirmInheritance(); } finally { GameSession.prototype.initialize = original; }
  assert.equal(c.snapshot.saveBlocked, true);
  c.retryStorage();
  assert.equal(c.snapshot.records.inheritanceAvailable, true);
  assert.equal(c.snapshot.view, null);
  await c.start(1);
  c.selectInheritance({ kind: 'attribute', attribute: 'wealth' });
  await Promise.all([c.confirmInheritance(), c.confirmInheritance()]);
  assert.equal(c.snapshot.screen, 'identity');
  assert.equal(c.snapshot.records.inheritanceAvailable, false);
  const baseline = new GameController(storage());
  await baseline.start(1);
  assert.equal(c.snapshot.view.player.attributes.wealth, Math.min(c.bundle.rules.attributes.max, baseline.snapshot.view.player.attributes.wealth + 1));
  const resumed = new GameController(port);
  assert.equal(resumed.snapshot.records.inheritanceAvailable, false);
  resumed.continueLife();
  assert.deepEqual(resumed.snapshot.activeInheritance, { kind: 'attribute', attribute: 'wealth' });
  assert.deepEqual(resumed.snapshot.view.player.attributes, c.snapshot.view.player.attributes);
  c.home();
  assert.equal(c.snapshot.records.completed, 0);
  assert.equal(c.snapshot.records.inheritanceAvailable, false);
});

test('completed lives collect once, retain report navigation, and reward both restart paths', async t => {
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => timeout(fn, ms === 220 ? 0 : ms, ...args));
  const port = storage();
  const c = new GameController(port);
  await c.start(1);
  await finish(c);
  assert.equal(c.snapshot.records.completed, 1);
  assert.equal(c.snapshot.records.inheritanceAvailable, true);
  const isCurrentDeath = DEATH_CATALOG[c.snapshot.ending.death_id]?.status === 'current';
  assert.deepEqual(c.snapshot.newCollection.deaths, isCurrentDeath ? [c.snapshot.ending.death_id] : []);
  assert.equal(c.snapshot.collection.deaths.collected, isCurrentDeath ? 1 : 0);
  assert.equal(c.snapshot.records.deaths.has(c.snapshot.ending.death_id), true);
  const collected = c.snapshot.collection;
  c.open('achievements');
  c.close();
  assert.equal(c.snapshot.overlay, 'ending');
  c.close();
  c.open('ending');
  assert.deepEqual(c.snapshot.collection, collected);
  assert.equal(c.snapshot.records.completed, 1);
  await c.start(2);
  assert.equal(c.snapshot.overlay, 'restart');
  await c.confirmRestart();
  assert.equal(c.snapshot.overlay, 'inheritance');
  c.close();
  assert.equal(c.snapshot.view.status, 'ENDED');
  c.home();
  await c.start(2);
  await c.confirmRestart();
  assert.equal(c.snapshot.overlay, 'inheritance');
  const bonus = { kind: 'attribute', attribute: 'luck' };
  c.selectInheritance(bonus);
  await c.confirmInheritance();
  assert.equal(c.snapshot.view.pending.cards.length, Math.min(3, c.bundle.pools.find(item => item.id === c.bundle.rules.opening.pool_id).entries.filter(entry => entry.weight > 0).length));
  assert.deepEqual(c.snapshot.activeInheritance, bonus);
  assert.equal(c.snapshot.records.inheritanceAvailable, false);
  c.revealCards();
  const v = builder(c);
  assert.equal(overlay(v, c).actions.find(action => action.id === 'confirmCard').disabled, true);
  c.close();
  assert.equal(c.snapshot.overlay, 'cards');
  await c.selectCard(c.snapshot.view.pending.cards[0]);
  const selected = c.snapshot.selectedCardId;
  await c.confirmCard();
  assert.deepEqual(c.snapshot.view.player.cards, [selected]);
  await finish(c);
  assert.equal(c.snapshot.records.completed, 2);
  assert.equal(c.snapshot.records.inheritanceAvailable, true);
  const restored = new GameController(port);
  restored.continueLife();
  assert.equal(restored.snapshot.records.completed, 2);
  assert.equal(restored.snapshot.records.inheritanceAvailable, true);
  assert.deepEqual(restored.snapshot.newCollection, { achievements: [], deaths: [] });
});

test('read-only view shows a completed life without reconciling or writing its pending claim', async t => {
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => timeout(fn, ms === 220 ? 0 : ms, ...args));
  const port = storage();
  const writer = new GameController(port);
  await writer.start(1);
  await finish(writer);
  const report = structuredClone(writer.snapshot.ending);
  await writer.start(2);
  await writer.confirmRestart();
  writer.selectInheritance({ kind: 'attribute', attribute: 'luck' });
  const set = port.setItem;
  port.setItem = (key, value) => {
    if (key.startsWith('time-travel.current-life.')) throw new Error('interrupted new life');
    set(key, value);
  };
  await writer.confirmInheritance();
  assert.equal(writer.snapshot.saveBlocked, true);
  assert.equal(JSON.parse(port.data.get(KEY)).inheritanceClaim.state, 'pending');
  const before = new Map(port.data);
  let writes = 0;
  port.setItem = (key, value) => { writes++; set(key, value); };
  const readOnly = new GameController(port, '另一个页面正在使用存档，本页面只读。');
  assert.equal(readOnly.snapshot.readOnlyReason, '另一个页面正在使用存档，本页面只读。');
  assert.equal(readOnly.snapshot.records.inheritancePending, true);
  readOnly.continueLife();
  assert.equal(readOnly.snapshot.view.status, 'ENDED');
  assert.deepEqual(readOnly.snapshot.ending, report);
  assert.equal(readOnly.snapshot.records.inheritancePending, true);
  assert.equal(readOnly.snapshot.overlay, 'ending');
  await readOnly.start(3);
  await readOnly.advance();
  readOnly.openForfeitInheritance();
  readOnly.confirmForfeitInheritance();
  readOnly.retryStorage();
  readOnly.continueLife();
  assert.equal(readOnly.snapshot.view.status, 'ENDED');
  assert.equal(readOnly.snapshot.records.inheritancePending, true);
  assert.equal(writes, 0);
  assert.deepEqual(port.data, before);
});

test('read-only mode does not resume an unfinished life or start a new one', async () => {
  const port = storage();
  const writer = new GameController(port);
  await writer.start(1);
  const before = new Map(port.data);
  let writes = 0;
  const set = port.setItem;
  port.setItem = (key, value) => { writes++; set(key, value); };
  const readOnly = new GameController(port, '本页面只读。');
  readOnly.continueLife();
  assert.equal(readOnly.snapshot.view, null);
  assert.match(readOnly.snapshot.notice, /没有可查看的已完成人生/);
  await readOnly.start(2);
  assert.equal(readOnly.snapshot.view, null);
  assert.equal(writes, 0);
  assert.deepEqual(port.data, before);
});

test('codex separates current entries from historical records and conceals uncollected commentary', () => {
  const port = storage();
  const c = new GameController(port);
  const v = builder(c);
  c.open('achievements');
  let scene = overlay(v, c);
  assert.ok(scene.scrollIds.includes('panel_achievements_achievements'));
  const currentAchievements = c.bundle.achievements.filter(item => ACHIEVEMENT_CATALOG[item.id]?.status === 'current');
  const otherAchievements = c.bundle.achievements.filter(item => ACHIEVEMENT_CATALOG[item.id]?.status !== 'current');
  assert.ok(currentAchievements.length && otherAchievements.length);
  for (const achievement of currentAchievements) {
    assert.ok(scene.text.includes(achievement.name));
    assert.ok(!scene.text.includes(achievement.text));
    const hint = ACHIEVEMENT_CATALOG[achievement.id]?.hint;
    if (hint) assert.ok(scene.text.includes(hint));
  }
  for (const achievement of otherAchievements) {
    if (!currentAchievements.some(item => item.name === achievement.name)) assert.ok(!scene.text.includes(achievement.name));
  }
  scene.actions.find(action => action.id === 'codex_deaths').invoke();
  scene = overlay(v, c);
  assert.ok(scene.scrollIds.includes('panel_achievements_deaths'));
  const currentDeaths = c.bundle.deaths.filter(item => DEATH_CATALOG[item.id]?.status === 'current');
  const otherDeaths = c.bundle.deaths.filter(item => DEATH_CATALOG[item.id]?.status !== 'current');
  assert.ok(currentDeaths.length && otherDeaths.length);
  for (const death of currentDeaths) {
    assert.ok(scene.text.includes(death.name));
    assert.ok(!scene.text.includes(death.text));
  }
  for (const death of otherDeaths) {
    if (!currentDeaths.some(item => item.name === death.name)) assert.ok(!scene.text.includes(death.name));
  }
  const achievement = currentAchievements[0], death = currentDeaths[0];
  const historicalAchievement = otherAchievements.find(item => ACHIEVEMENT_CATALOG[item.id]?.status === 'unavailable');
  const historicalDeath = otherDeaths.find(item => DEATH_CATALOG[item.id]?.status === 'unavailable');
  assert.ok(historicalAchievement && historicalDeath);
  port.data.set(KEY, JSON.stringify({ version: 2, inheritanceAvailable: true, records: [
    { id: 'finished', age: 70, years: 40, achievements: [achievement.id], death_id: death.id },
    { id: 'history', age: 71, years: 41, achievements: [historicalAchievement.id, 'OLD_UNKNOWN_ACHIEVEMENT'], death_id: historicalDeath.id },
    { id: 'unknown', age: 72, years: 42, achievements: [], death_id: 'OLD_UNKNOWN_DEATH' },
  ] }));
  const collected = new GameController(port), collectedView = builder(collected);
  collected.open('achievements');
  scene = overlay(collectedView, collected);
  assert.ok(scene.text.some(text => text.includes(achievement.text)));
  scene.actions.find(action => action.id === 'codex_scope_history').invoke();
  scene = overlay(collectedView, collected);
  assert.ok(scene.text.includes(historicalAchievement.name));
  assert.ok(scene.text.some(text => text.includes('OLD_UNKNOWN_ACHIEVEMENT')));
  assert.ok(scene.scrollIds.includes('panel_achievements_achievements'));
  scene.actions.find(action => action.id === 'codex_deaths').invoke();
  scene = overlay(collectedView, collected);
  assert.ok(scene.scrollIds.includes('panel_achievements_deaths'));
  assert.ok(scene.text.includes(historicalDeath.name));
  assert.ok(scene.text.some(text => text.includes('OLD_UNKNOWN_DEATH')));
  scene.actions.find(action => action.id === 'codex_scope_current').invoke();
  scene = overlay(collectedView, collected);
  assert.ok(scene.text.includes(death.text));
});

test('failed current-life persistence blocks play and safely releases the reservation on retry', async () => {
  const port = storage(true);
  const c = new GameController(port);
  const set = port.setItem;
  port.setItem = (key, value) => {
    if (key.startsWith('time-travel.current-life.')) throw new Error('quota');
    set(key, value);
  };
  await c.start(1);
  c.selectInheritance({ kind: 'attribute', attribute: 'luck' });
  await c.confirmInheritance();
  assert.equal(c.snapshot.saveBlocked, true);
  assert.equal(c.snapshot.overlay, 'saveFailure');
  assert.equal(c.snapshot.view, null);
  port.setItem = set;
  c.retryStorage();
  assert.equal(c.snapshot.saveBlocked, false);
  assert.equal(c.snapshot.records.inheritanceAvailable, true);
});

test('inherited candidate can be freely replaced and the consumed reward stays consumed after reload', async () => {
  const port = storage(true);
  const c = new GameController(port);
  await c.start(4);
  const bonus = cardBonus(c);
  // A pre-update screen had already selected this value in the same session.
  c.selectedInheritance = bonus;
  c.continueLegacyInheritance();
  await c.confirmInheritance();
  c.revealCards();
  assert.ok(c.snapshot.view.pending.cards.includes(bonus.card_id));
  const pool = c.bundle.pools.find(item => item.id === c.bundle.rules.opening.pool_id);
  const replacement = pool.entries.find(entry => entry.weight > 0 && !c.snapshot.view.pending.cards.includes(entry.card_id)).card_id;
  c.openCardPool(bonus.card_id);
  assert.equal(c.snapshot.overlay, 'cardPool');
  await c.replaceCardOffer(replacement);
  assert.equal(c.snapshot.view.pending.cards.length, 3);
  assert.equal(new Set(c.snapshot.view.pending.cards).size, 3);
  assert.ok(c.snapshot.view.pending.cards.includes(replacement));
  assert.ok(!c.snapshot.view.pending.cards.includes(bonus.card_id));
  assert.equal(c.snapshot.records.inheritanceAvailable, false);
  const resumed = new GameController(port);
  resumed.continueLife();
  assert.deepEqual(resumed.snapshot.view.pending.cards, c.snapshot.view.pending.cards);
  assert.equal(resumed.snapshot.records.inheritanceAvailable, false);
  assert.deepEqual(resumed.snapshot.activeInheritance, bonus);
});

test('an unreadable records key blocks starting until it can be read again', async () => {
  const port = storage(true);
  const original = port.data.get(KEY);
  const get = port.getItem;
  port.getItem = key => {
    if (key === KEY) throw new Error('storage permission denied');
    return get(key);
  };
  const controller = new GameController(port);
  assert.equal(controller.snapshot.saveBlocked, true);
  assert.equal(controller.snapshot.overlay, 'saveFailure');
  await controller.start(1);
  assert.equal(controller.snapshot.view, null);
  assert.equal(port.data.get(KEY), original);
  port.getItem = get;
  controller.retryStorage();
  assert.equal(controller.snapshot.saveBlocked, false);
  assert.equal(controller.snapshot.records.inheritanceAvailable, true);
  await controller.start(1);
  assert.equal(controller.snapshot.overlay, 'inheritance');
});

test('every claim write boundary survives restart without duplicated or silently lost inheritance', async () => {
  for (const phase of ['reserve', 'life', 'commit']) for (const written of [false, true]) {
    const port = storage(true);
    const c = new GameController(port);
    const set = port.setItem;
    let injected = false;
    port.setItem = (key, value) => {
      const claim = key === KEY ? JSON.parse(value).inheritanceClaim : null;
      const matches = phase === 'life' ? key.startsWith('time-travel.current-life.')
        : key === KEY && claim?.state === (phase === 'reserve' ? 'pending' : 'consumed');
      if (matches && !injected) {
        injected = true;
        if (written) set(key, value);
        throw new Error(`injected ${phase} failure`);
      }
      set(key, value);
    };
    await c.start(7);
    const bonus = { kind: 'attribute', attribute: 'luck' };
    c.selectInheritance(bonus);
    await Promise.all([c.confirmInheritance(), c.confirmInheritance()]);
    assert.equal(injected, true, `${phase} must be reached`);
    assert.equal(c.snapshot.saveBlocked, true, `${phase} must stop play`);
    assert.equal(c.snapshot.overlay, 'saveFailure');

    port.setItem = set;
    const resumed = new GameController(port);
    const savedLife = phase === 'commit' || (phase === 'life' && written);
    if (savedLife) {
      resumed.continueLife();
      assert.equal(resumed.snapshot.screen, 'identity');
      assert.deepEqual(resumed.snapshot.activeInheritance, bonus);
      assert.ok(resumed.snapshot.view.pending.cards.length <= 3);
      assert.equal(resumed.snapshot.records.inheritanceAvailable, false);
    } else {
      assert.equal(resumed.snapshot.records.inheritanceAvailable, true);
      await resumed.start(7);
      assert.equal(resumed.snapshot.overlay, 'inheritance');
      resumed.selectInheritance(bonus);
      await Promise.all([resumed.confirmInheritance(), resumed.confirmInheritance()]);
      assert.equal(resumed.snapshot.screen, 'identity');
      assert.ok(resumed.snapshot.view.pending.cards.length <= 3);
      assert.equal(resumed.snapshot.records.inheritanceAvailable, false);
    }
    const durable = JSON.parse(port.data.get(KEY));
    assert.equal(durable.inheritanceClaim.state, 'consumed');
    assert.equal(durable.inheritanceRewardId, null);
    const restartedAgain = new GameController(port);
    restartedAgain.continueLife();
    assert.equal(restartedAgain.snapshot.records.inheritanceAvailable, false);
    restartedAgain.home();
    await restartedAgain.start(8);
    assert.equal(restartedAgain.snapshot.overlay, 'restart');
    await restartedAgain.confirmRestart();
    assert.notEqual(restartedAgain.snapshot.overlay, 'inheritance', 'same reward cannot be claimed a second time');
  }
});

test('a damaged new slot cannot make a fallback life release an uncertain claim', async () => {
  const { port, captured } = await pendingWithDamagedTarget();
  const uncertain = new GameController(port);
  uncertain.retryStorage();
  assert.equal(uncertain.snapshot.saveBlocked, true);
  assert.equal(JSON.parse(port.data.get(KEY)).inheritanceClaim.state, 'pending');
  port.setItem(...captured);
  uncertain.retryStorage();
  assert.equal(uncertain.snapshot.saveBlocked, false);
  assert.equal(uncertain.snapshot.records.inheritanceAvailable, false);
  assert.deepEqual(uncertain.snapshot.activeInheritance, { kind: 'attribute', attribute: 'luck' });
});

test('abandoning an uncertain claim requires confirmation and preserves both life slots', async () => {
  const { port } = await pendingWithDamagedTarget();
  const slotBytes = () => [...port.data].filter(([key]) => key.startsWith('time-travel.current-life.'));
  const before = slotBytes();
  const c = new GameController(port);
  assert.equal(c.snapshot.overlay, 'saveFailure');
  assert.equal(c.snapshot.records.inheritancePending, true);
  c.openForfeitInheritance();
  assert.equal(c.snapshot.overlay, 'forfeitInheritance');
  c.close();
  assert.equal(c.snapshot.overlay, 'saveFailure');
  assert.equal(c.snapshot.records.inheritancePending, true);
  assert.deepEqual(slotBytes(), before);
  c.openForfeitInheritance();
  await c.confirmForfeitInheritance();
  assert.equal(c.snapshot.saveBlocked, false);
  assert.equal(c.snapshot.records.inheritancePending, false);
  assert.equal(c.snapshot.records.inheritanceAvailable, false);
  assert.equal(c.snapshot.screen, 'identity');
  assert.equal(c.snapshot.activeInheritance, null);
  assert.deepEqual(slotBytes(), before, 'forfeiture must not overwrite either life slot');
  const savedClaim = JSON.parse(port.data.get(KEY)).inheritanceClaim;
  assert.equal(savedClaim.state, 'consumed');
  await c.confirmForfeitInheritance();
  assert.deepEqual(JSON.parse(port.data.get(KEY)).inheritanceClaim, savedClaim);
  const restarted = new GameController(port);
  restarted.continueLife();
  assert.equal(restarted.snapshot.screen, 'identity');
  assert.equal(restarted.snapshot.records.inheritanceAvailable, false);
  await restarted.start(3);
  assert.equal(restarted.snapshot.overlay, 'restart', 'overwriting a life still needs its own confirmation');
  await restarted.confirmRestart();
  assert.notEqual(restarted.snapshot.overlay, 'inheritance');
});

test('forfeiture write failures recover before or after the durable write without changing life slots', async () => {
  for (const written of [false, true]) {
    const { port } = await pendingWithDamagedTarget();
    const slotBytes = () => [...port.data].filter(([key]) => key.startsWith('time-travel.current-life.'));
    const before = slotBytes();
    const c = new GameController(port);
    c.openForfeitInheritance();
    const set = port.setItem;
    let injected = false;
    port.setItem = (key, value) => {
      if (key === KEY && JSON.parse(value).inheritanceClaim?.state === 'consumed' && !injected) {
        injected = true;
        if (written) set(key, value);
        throw new Error('injected forfeit write failure');
      }
      set(key, value);
    };
    await c.confirmForfeitInheritance();
    assert.equal(injected, true);
    assert.equal(c.snapshot.saveBlocked, true);
    assert.equal(c.snapshot.overlay, 'saveFailure');
    assert.deepEqual(slotBytes(), before);
    port.setItem = set;
    c.retryStorage();
    if (!written) {
      assert.equal(c.snapshot.saveBlocked, true);
      assert.equal(c.snapshot.records.inheritancePending, true);
      c.openForfeitInheritance();
      await c.confirmForfeitInheritance();
    }
    assert.equal(c.snapshot.saveBlocked, false);
    assert.equal(c.snapshot.records.inheritancePending, false);
    assert.equal(c.snapshot.records.inheritanceAvailable, false);
    assert.equal(JSON.parse(port.data.get(KEY)).inheritanceClaim.state, 'consumed');
    assert.deepEqual(slotBytes(), before);
  }
});

test('a target repaired during forfeit confirmation is normally reconciled instead', async () => {
  const { port, captured } = await pendingWithDamagedTarget();
  const c = new GameController(port);
  c.openForfeitInheritance();
  assert.equal(c.snapshot.overlay, 'forfeitInheritance');
  port.setItem(...captured);
  await c.confirmForfeitInheritance();
  assert.equal(c.snapshot.saveBlocked, false);
  assert.equal(c.snapshot.records.inheritancePending, false);
  assert.equal(c.snapshot.records.inheritanceAvailable, false);
  assert.deepEqual(c.snapshot.activeInheritance, { kind: 'attribute', attribute: 'luck' });
});

test('a repaired target with a failed normal commit stays blocked instead of being forfeited', async () => {
  const { port, captured } = await pendingWithDamagedTarget();
  const c = new GameController(port);
  c.openForfeitInheritance();
  port.setItem(...captured);
  const set = port.setItem;
  let attempts = 0;
  port.setItem = (key, value) => {
    if (key === KEY && JSON.parse(value).inheritanceClaim?.state === 'consumed') {
      attempts++;
      throw new Error('commit not written');
    }
    set(key, value);
  };
  await c.confirmForfeitInheritance();
  assert.equal(attempts, 1);
  assert.equal(c.snapshot.saveBlocked, true);
  assert.equal(JSON.parse(port.data.get(KEY)).inheritanceClaim.state, 'pending');
  port.setItem = set;
  c.retryStorage();
  assert.equal(c.snapshot.saveBlocked, false);
  assert.equal(c.snapshot.records.inheritanceAvailable, false);
  assert.deepEqual(c.snapshot.activeInheritance, { kind: 'attribute', attribute: 'luck' });
});

test('a claim proven absent during confirmation is released instead of forfeited', async () => {
  const { port, captured } = await pendingWithDamagedTarget();
  const c = new GameController(port);
  c.openForfeitInheritance();
  assert.equal(c.snapshot.overlay, 'forfeitInheritance');
  port.data.delete(captured[0]);
  await c.confirmForfeitInheritance();
  assert.equal(c.snapshot.saveBlocked, false);
  assert.equal(c.snapshot.records.inheritancePending, false);
  assert.equal(c.snapshot.records.inheritanceAvailable, true);
  assert.equal(JSON.parse(port.data.get(KEY)).inheritanceClaim, null);
  await c.start(3);
  assert.equal(c.snapshot.overlay, 'restart');
  await c.confirmRestart();
  assert.equal(c.snapshot.overlay, 'inheritance');
});

test('settlement failure recovers the saved ending and awards its next reward exactly once', async t => {
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => timeout(fn, ms === 220 ? 0 : ms, ...args));
  for (const written of [false, true]) {
    const port = storage();
    const c = new GameController(port);
    const set = port.setItem;
    let injected = false;
    port.setItem = (key, value) => {
      if (key === KEY && !injected && JSON.parse(value).records.length > 0) {
        injected = true;
        if (written) set(key, value);
        throw new Error('settlement interrupted');
      }
      set(key, value);
    };
    await c.start(1);
    c.revealCards();
    await c.selectCard(c.snapshot.view.pending.cards[0]);
    await c.confirmCard();
    for (let i = 0; i < 600 && !c.snapshot.saveBlocked; i++) {
      const pending = c.snapshot.view?.pending;
      if (pending?.kind === 'option') await c.choose(pending.options.find(option => option.available).id);
      else if (pending?.kind === 'stage') await c.resolveStage();
      else await c.advance();
    }
    assert.equal(injected, true);
    assert.equal(c.snapshot.saveBlocked, true);
    port.setItem = set;
    const resumed = new GameController(port);
    if (!written) {
      // Reopening straight into restart must settle the saved ending first.
      await resumed.start(2);
      assert.equal(resumed.snapshot.overlay, 'restart');
      assert.equal(resumed.snapshot.records.completed, 1);
      assert.equal(resumed.snapshot.records.inheritanceAvailable, true);
      await resumed.confirmRestart();
      assert.equal(resumed.snapshot.overlay, 'inheritance');
      resumed.selectInheritance({ kind: 'attribute', attribute: 'luck' });
      await resumed.confirmInheritance();
      assert.equal(resumed.snapshot.records.inheritanceAvailable, false);
      const replayed = new GameController(port);
      replayed.continueLife();
      assert.equal(replayed.snapshot.records.completed, 1);
      assert.equal(replayed.snapshot.records.inheritanceAvailable, false);
    } else {
      resumed.continueLife();
      assert.equal(resumed.snapshot.view.status, 'ENDED');
      assert.equal(resumed.snapshot.records.completed, 1);
      assert.equal(resumed.snapshot.records.inheritanceAvailable, true);
      const replayed = new GameController(port);
      replayed.continueLife();
      assert.equal(replayed.snapshot.records.completed, 1);
      assert.equal(replayed.snapshot.records.inheritanceAvailable, true);
    }
  }
});
