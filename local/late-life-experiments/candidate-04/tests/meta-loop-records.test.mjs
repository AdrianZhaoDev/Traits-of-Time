import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { LifetimeRecords } from '../src/game/presentation/LifetimeRecords.ts';
import { collectionProgress } from '../src/game/presentation/CollectionProgress.ts';
import { ACHIEVEMENT_HINTS } from '../src/game/presentation/AchievementHints.ts';

const content = await loadContent();
const V1 = 'time-travel.lifetime-records.v1';
const V2 = 'time-travel.lifetime-records.v2';

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
    this.gets = [];
    this.writes = [];
    this.failGet = null;
    this.failSet = false;
  }
  getItem(key) {
    this.gets.push(key);
    if (key === this.failGet) throw new Error('read failed');
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.writes.push([key, value]);
    if (this.failSet) throw new Error('write failed');
    this.values.set(key, value);
  }
}

const report = (overrides = {}) => ({
  end_age: 61, years_played: 33, achievements: [content.achievements[0].id],
  primary_achievement_id: content.achievements[1].id, death_id: content.deaths[0].id,
  ...overrides,
});
const snapshot = records => records.snapshot();

function catalog(achievementIds, deathIds) {
  return { achievements: achievementIds.map(id => ({ id })), deaths: deathIds.map(id => ({ id })) };
}

test('v1 migrates lazily, deduplicates lives and achievements, and awards one consumable inheritance', () => {
  const [first, second, third] = content.achievements.map(item => item.id);
  const death = content.deaths[0].id;
  const oldRows = [
    { id: 'old', age: 58, years: 30, achievements: [first, first, 'A_UNKNOWN'], oldExtra: true },
    { id: 'old', age: 99, years: 80, achievements: [second] },
  ];
  const rawV1 = JSON.stringify(oldRows);
  const storage = new MemoryStorage([[V1, rawV1]]);
  let records = new LifetimeRecords(storage);
  assert.equal(storage.writes.length, 0, 'reading or migration must not write');
  assert.deepEqual(snapshot(records), {
    completed: 1, longest: 58, years: 30, achievements: new Set([first, 'A_UNKNOWN']),
    deaths: new Set(), unknownDeaths: 1, inheritanceAvailable: true, inheritancePending: false, warning: '',
  });
  assert.equal(collectionProgress(content, snapshot(records)).achievements.collected, 1);
  assert.equal(collectionProgress(content, snapshot(records)).deaths.collected, 0);

  records.record('new', report({ achievements: [first, second, second], primary_achievement_id: third, death_id: death }));
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0][0], V2);
  assert.deepEqual(JSON.parse(storage.values.get(V2)), {
    version: 3,
    records: [
      { id: 'old', age: 58, years: 30, achievements: [first, 'A_UNKNOWN'], death_id: null },
      { id: 'new', age: 61, years: 33, achievements: [first, second, third], death_id: death },
    ],
    inheritanceRewardId: 'life:new',
    inheritanceClaim: null,
  });
  assert.equal(storage.values.get(V1), rawV1);
  assert.deepEqual(snapshot(records).deaths, new Set([death]));
  assert.equal(snapshot(records).unknownDeaths, 1);
  assert.equal(collectionProgress(content, snapshot(records)).achievements.collected, 3);

  records.record('new', report({ achievements: ['different'], death_id: 'different' }));
  assert.equal(storage.writes.length, 1, 'duplicate report must not write');
  assert.equal(snapshot(records).completed, 2);
  records.reserveInheritance('next-life');
  records.reserveInheritance('next-life');
  assert.equal(storage.writes.length, 2, 'duplicate reservation must not write');
  records.reconcileInheritance('next-life', true);
  records.reconcileInheritance('next-life', true);
  assert.equal(storage.writes.length, 3, 'duplicate reconciliation must not write');
  records.record('new', report());
  assert.equal(snapshot(records).inheritanceAvailable, false, 'duplicate report cannot grant another inheritance');
  assert.equal(storage.writes.length, 3);

  records = new LifetimeRecords(storage);
  assert.equal(snapshot(records).inheritanceAvailable, false);
  records.record('later', report({ primary_achievement_id: null }));
  assert.equal(snapshot(records).inheritanceAvailable, true);
  records.record('later-again', report());
  assert.equal(snapshot(records).inheritanceAvailable, true, 'completions do not accumulate a balance');
  records.reserveInheritance('another-life');
  records.reconcileInheritance('another-life', true);
  assert.throws(() => records.reserveInheritance('third-life'), { code: 'SAVE_FAILED' });
  assert.equal(new LifetimeRecords(storage).snapshot().inheritanceAvailable, false);
  assert.equal(storage.values.get(V1), rawV1, 'v1 is never rewritten or deleted');
});

test('empty legacy records grant nothing; an empty valid v2 takes precedence over v1', () => {
  const emptyLegacy = new MemoryStorage([[V1, '[]']]);
  const noHistory = new LifetimeRecords(emptyLegacy);
  assert.equal(snapshot(noHistory).inheritanceAvailable, false);
  assert.throws(() => noHistory.reserveInheritance('new-life'), { code: 'SAVE_FAILED' });
  assert.equal(emptyLegacy.writes.length, 0);

  const rawV2 = JSON.stringify({ version: 2, records: [], inheritanceAvailable: false });
  const storage = new MemoryStorage([
    [V1, JSON.stringify([{ id: 'old', age: 40, years: 10, achievements: ['A_OLD'] }])],
    [V2, rawV2],
  ]);
  const records = new LifetimeRecords(storage);
  assert.deepEqual(storage.gets, [V2]);
  assert.equal(snapshot(records).completed, 0);
  assert.equal(snapshot(records).inheritanceAvailable, false);
  assert.equal(snapshot(records).warning, '');
  assert.equal(storage.values.get(V2), rawV2);
  assert.equal(storage.writes.length, 0);
});

test('a v2 reward without a recorded source gets a stable legacy identity', () => {
  const storage = new MemoryStorage([[V2, JSON.stringify({ version: 2, records: [], inheritanceAvailable: true })]]);
  const first = new LifetimeRecords(storage);
  first.reserveInheritance('target');
  assert.deepEqual(JSON.parse(storage.values.get(V2)).inheritanceClaim,
    { rewardId: 'legacy:v2', lifeId: 'target', state: 'pending' });
  const restarted = new LifetimeRecords(storage);
  restarted.reconcileInheritance('target', false);
  assert.deepEqual(JSON.parse(storage.values.get(V2)).inheritanceClaim,
    { rewardId: 'legacy:v2', lifeId: 'target', state: 'consumed' });
  assert.equal(snapshot(new LifetimeRecords(storage)).inheritanceAvailable, false);
});

test('migration persists a source-bound claim without rewriting the legacy key', () => {
  const rawV1 = JSON.stringify([{ id: 'old', age: 0, years: 0, achievements: [] }]);
  const storage = new MemoryStorage([[V1, rawV1]]);
  const records = new LifetimeRecords(storage);
  records.reserveInheritance('new-life');
  assert.deepEqual(JSON.parse(storage.values.get(V2)), {
    version: 3, records: [{ id: 'old', age: 0, years: 0, achievements: [], death_id: null }],
    inheritanceRewardId: 'life:old', inheritanceClaim: { rewardId: 'life:old', lifeId: 'new-life', state: 'pending' },
  });
  records.reconcileInheritance('new-life', true);
  assert.equal(storage.values.get(V1), rawV1);
  assert.equal(new LifetimeRecords(storage).snapshot().inheritanceAvailable, false);
});

test('v2 validation rejects malformed data without falling back to v1 or overwriting it', () => {
  const validRow = { id: 'life', age: 30, years: 12, achievements: ['A_ONE'], death_id: 'D_ONE' };
  const envelope = records => ({ version: 2, records, inheritanceAvailable: false });
  const cases = [
    '', ' ', '{', 'null', '[]',
    JSON.stringify({ version: 3, records: [], inheritanceAvailable: false }),
    JSON.stringify({ version: 2, records: [] }),
    JSON.stringify({ version: 2, records: [], inheritanceAvailable: false, extra: 1 }),
    JSON.stringify({ version: 2, records: [], inheritanceAvailable: 'false' }),
    JSON.stringify({ version: 2, records: null, inheritanceAvailable: false }),
    JSON.stringify(envelope([{ ...validRow, extra: 1 }])),
    JSON.stringify(envelope([{ id: 'life', age: 30, years: 12, achievements: ['A_ONE'] }])),
    JSON.stringify(envelope([{ ...validRow, id: null }])),
    JSON.stringify(envelope([{ ...validRow, age: -1 }])),
    JSON.stringify(envelope([{ ...validRow, age: 1.5 }])),
    JSON.stringify(envelope([{ ...validRow, years: -1 }])),
    JSON.stringify(envelope([{ ...validRow, achievements: ['A_ONE', 7] }])),
    JSON.stringify(envelope([{ ...validRow, achievements: null }])),
    JSON.stringify(envelope([{ ...validRow, death_id: '' }])),
    JSON.stringify(envelope([{ ...validRow, death_id: 3 }])),
    JSON.stringify(envelope([validRow, { ...validRow, death_id: null }])),
  ];
  const rawV1 = JSON.stringify([{ id: 'old', age: 99, years: 50, achievements: ['A_OLD'] }]);
  for (const invalid of cases) {
    const storage = new MemoryStorage([[V1, rawV1], [V2, invalid]]);
    const records = new LifetimeRecords(storage);
    assert.deepEqual(storage.gets, [V2], `must not read v1 after invalid v2: ${invalid}`);
    assert.equal(snapshot(records).completed, 0);
    assert.equal(snapshot(records).inheritanceAvailable, false);
    assert.match(snapshot(records).warning, /本机记录与传承.*读取失败.*原数据未覆盖/);
    assert.throws(() => records.record('new', report()), { code: 'SAVE_FAILED' });
    assert.throws(() => records.reserveInheritance('new-life'), { code: 'SAVE_FAILED' });
    assert.equal(storage.writes.length, 0);
    assert.equal(storage.values.get(V2), invalid);
    assert.equal(storage.values.get(V1), rawV1);
  }
});

test('legacy validation accepts its old shape but protects malformed legacy data', () => {
  const valid = { id: '', age: 0, years: 0, achievements: ['', 'A_UNKNOWN'], extra: 'allowed' };
  const storage = new MemoryStorage([[V1, JSON.stringify([valid])]]);
  const records = new LifetimeRecords(storage);
  assert.deepEqual(snapshot(records).achievements, new Set(['', 'A_UNKNOWN']));
  assert.equal(snapshot(records).inheritanceAvailable, true);

  for (const invalid of ['', '{}', JSON.stringify([{ ...valid, years: 1.1 }]), JSON.stringify([{ ...valid, achievements: [null] }])]) {
    const broken = new MemoryStorage([[V1, invalid]]);
    const page = new LifetimeRecords(broken);
    assert.match(snapshot(page).warning, /读取失败.*原数据未覆盖/);
    assert.throws(() => page.record('new', report()), { code: 'SAVE_FAILED' });
    assert.throws(() => page.reserveInheritance('new-life'), { code: 'SAVE_FAILED' });
    assert.equal(broken.writes.length, 0);
    assert.equal(broken.values.get(V1), invalid);
    assert.equal(broken.values.has(V2), false);
  }
});

test('read exceptions protect original data and block uncertain changes', () => {
  for (const failedKey of [V2, V1]) {
    const old = JSON.stringify([{ id: 'old', age: 50, years: 20, achievements: [] }]);
    const storage = new MemoryStorage([[V1, old]]);
    storage.failGet = failedKey;
    const records = new LifetimeRecords(storage);
    assert.match(snapshot(records).warning, /本机记录与传承.*读取失败.*原数据未覆盖/);
    assert.throws(() => records.record('new', report()), { code: 'SAVE_FAILED' });
    assert.throws(() => records.reserveInheritance('new-life'), { code: 'SAVE_FAILED' });
    assert.equal(storage.writes.length, 0);
    assert.equal(storage.values.get(V1), old);
    assert.equal(storage.values.has(V2), false);
  }
});

test('an unconfirmed completed record blocks further writes until reloaded and re-recorded', () => {
  for (const written of [false, true]) {
    const storage = new MemoryStorage();
    const records = new LifetimeRecords(storage);
    const set = storage.setItem.bind(storage);
    storage.setItem = (key, value) => { if (written) set(key, value); throw new Error('quota'); };
    assert.throws(() => records.record('first', report()), { code: 'SAVE_FAILED' });
    assert.match(snapshot(records).warning, /写入无法确认/);
    assert.throws(() => records.record('second', report()), { code: 'SAVE_FAILED' });
    storage.setItem = set;
    records.reload();
    records.record('first', report());
    assert.equal(snapshot(records).completed, 1);
    assert.equal(snapshot(records).inheritanceAvailable, true);
    assert.equal(snapshot(new LifetimeRecords(storage)).completed, 1);
  }
});

test('reservation and consumption recover both sides of uncertain writes', () => {
  for (const phase of ['reserve', 'commit']) for (const written of [false, true]) {
    const storage = new MemoryStorage();
    const records = new LifetimeRecords(storage);
    records.record('source', report());
    if (phase === 'commit') records.reserveInheritance('target');
    const set = storage.setItem.bind(storage);
    storage.setItem = (key, value) => { if (written) set(key, value); throw new Error('quota'); };
    assert.throws(() => phase === 'reserve' ? records.reserveInheritance('target') : records.reconcileInheritance('target', true), { code: 'SAVE_FAILED' });
    assert.throws(() => records.reconcileInheritance('target', true), { code: 'SAVE_FAILED' });
    storage.setItem = set;
    const restarted = new LifetimeRecords(storage);
    if (phase === 'reserve') {
      // No current life was written yet, so a durable reservation can safely be released.
      restarted.reconcileInheritance(null, true);
      assert.equal(snapshot(restarted).inheritanceAvailable, true);
      restarted.reserveInheritance('target');
    }
    // The current-life write succeeded, including when the commit itself threw afterward.
    restarted.reconcileInheritance('target', true);
    restarted.reconcileInheritance('target', true);
    assert.equal(snapshot(restarted).inheritanceAvailable, false);
    assert.throws(() => restarted.reserveInheritance('different-target'), { code: 'SAVE_FAILED' });
    assert.equal(snapshot(new LifetimeRecords(storage)).inheritanceAvailable, false);
  }
});

test('a pending claim is released only when absence is certain and is bound to its source', () => {
  const storage = new MemoryStorage();
  let records = new LifetimeRecords(storage);
  records.record('source', report());
  records.reserveInheritance('target');
  assert.throws(() => records.reserveInheritance('other'), { code: 'SAVE_FAILED' });
  assert.throws(() => records.record('completed', report()), { code: 'SAVE_FAILED' });
  records = new LifetimeRecords(storage);
  assert.throws(() => records.reconcileInheritance('older-fallback', false), { code: 'SAVE_FAILED', reason: 'INHERITANCE_UNCERTAIN' });
  assert.deepEqual(JSON.parse(storage.values.get(V2)).inheritanceClaim,
    { rewardId: 'life:source', lifeId: 'target', state: 'pending' });
  records.reconcileInheritance('older-fallback', true);
  assert.equal(snapshot(records).inheritanceAvailable, true);
  records.reserveInheritance('target-2');
  records.reconcileInheritance('target-2', false);
  records.record('target-2', report());
  records.record('target-2', report());
  assert.equal(snapshot(records).completed, 2);
  assert.equal(snapshot(records).inheritanceAvailable, true);
  assert.equal(JSON.parse(storage.values.get(V2)).inheritanceRewardId, 'life:target-2');
});

test('explicit forfeiture consumes only a pending claim and never touches a later reward', () => {
  const storage = new MemoryStorage();
  const records = new LifetimeRecords(storage);
  records.record('source', report());
  assert.equal(records.forfeitPendingInheritance(), false);
  assert.equal(snapshot(records).inheritanceAvailable, true);
  records.reserveInheritance('lost-life');
  assert.equal(snapshot(records).inheritancePending, true);
  const count = storage.writes.length;
  assert.equal(records.forfeitPendingInheritance(), true);
  assert.equal(storage.writes.length, count + 1);
  assert.deepEqual(JSON.parse(storage.values.get(V2)).inheritanceClaim,
    { rewardId: 'life:source', lifeId: 'lost-life', state: 'consumed' });
  assert.equal(snapshot(records).inheritancePending, false);
  assert.equal(snapshot(records).inheritanceAvailable, false);
  assert.equal(records.forfeitPendingInheritance(), false);
  assert.equal(storage.writes.length, count + 1, 'duplicate confirmation must not write');
  records.record('later', report());
  assert.equal(records.forfeitPendingInheritance(), false);
  assert.equal(snapshot(records).inheritanceAvailable, true, 'forfeiture must not consume the later completion');
  assert.equal(snapshot(new LifetimeRecords(storage)).completed, 2);
});

test('forfeiture write failures remain blocked until an authoritative reload', () => {
  for (const written of [false, true]) {
    const storage = new MemoryStorage();
    const records = new LifetimeRecords(storage);
    records.record('source', report());
    records.reserveInheritance('lost-life');
    const set = storage.setItem.bind(storage);
    storage.setItem = (key, value) => { if (written) set(key, value); throw new Error('quota'); };
    assert.throws(() => records.forfeitPendingInheritance(), { code: 'SAVE_FAILED' });
    assert.throws(() => records.forfeitPendingInheritance(), { code: 'SAVE_FAILED' });
    storage.setItem = set;
    const restarted = new LifetimeRecords(storage);
    assert.equal(snapshot(restarted).inheritancePending, !written);
    assert.equal(restarted.forfeitPendingInheritance(), !written);
    assert.equal(restarted.forfeitPendingInheritance(), false);
    assert.equal(snapshot(restarted).inheritanceAvailable, false);
    assert.equal(snapshot(new LifetimeRecords(storage)).completed, 1);
    assert.deepEqual(JSON.parse(storage.values.get(V2)).inheritanceClaim,
      { rewardId: 'life:source', lifeId: 'lost-life', state: 'consumed' });
  }
});

test('forfeiture readback mismatch stops until the stored claim is reread', () => {
  const storage = new MemoryStorage();
  const records = new LifetimeRecords(storage);
  records.record('source', report());
  records.reserveInheritance('lost-life');
  const before = storage.values.get(V2);
  const get = storage.getItem.bind(storage);
  let stale = true;
  storage.getItem = key => key === V2 && stale ? before : get(key);
  assert.throws(() => records.forfeitPendingInheritance(), { code: 'SAVE_FAILED' });
  stale = false;
  records.reload();
  assert.equal(records.forfeitPendingInheritance(), false);
  assert.equal(snapshot(records).inheritancePending, false);
  assert.equal(snapshot(records).inheritanceAvailable, false);
});

test('an unreadable record key never advertises a stale pending claim', () => {
  const storage = new MemoryStorage();
  const records = new LifetimeRecords(storage);
  records.record('source', report());
  records.reserveInheritance('target');
  assert.equal(snapshot(records).inheritancePending, true);
  storage.failGet = V2;
  assert.throws(() => records.reload(), { code: 'SAVE_FAILED' });
  assert.equal(snapshot(records).inheritancePending, false);
  assert.throws(() => records.forfeitPendingInheritance(), { code: 'SAVE_FAILED' });
  storage.failGet = null;
  records.reload();
  assert.equal(snapshot(records).inheritancePending, true);
});

test('readback mismatch is a failure even when setItem returned successfully', () => {
  const storage = new MemoryStorage();
  const records = new LifetimeRecords(storage);
  records.record('source', report());
  const before = storage.values.get(V2);
  const get = storage.getItem.bind(storage);
  let stale = true;
  storage.getItem = key => key === V2 && stale ? before : get(key);
  assert.throws(() => records.reserveInheritance('target'), { code: 'SAVE_FAILED' });
  stale = false;
  records.reload();
  records.reconcileInheritance(null, true);
  assert.equal(snapshot(records).inheritanceAvailable, true);
});

test('malformed v3 claims cannot be overwritten or misinterpreted as available', () => {
  for (const inheritanceClaim of [
    { rewardId: 'wrong', lifeId: 'target', state: 'pending' },
    { rewardId: 'life:source', lifeId: 'target', state: 'consumed' },
    { rewardId: 'life:source', lifeId: '', state: 'pending' },
    { rewardId: 'life:source', lifeId: 'target', state: 'pending', extra: true },
  ]) {
    const raw = JSON.stringify({ version: 3, records: [], inheritanceRewardId: 'life:source', inheritanceClaim });
    const storage = new MemoryStorage([[V2, raw]]);
    const records = new LifetimeRecords(storage);
    assert.match(snapshot(records).warning, /读取失败/);
    assert.throws(() => records.reserveInheritance('another'), { code: 'SAVE_FAILED' });
    assert.equal(storage.values.get(V2), raw);
  }
});

test('progress counts only known IDs, floors to one decimal and weights totals by catalog size', () => {
  const storage = new MemoryStorage();
  const records = new LifetimeRecords(storage);
  const small = catalog(['a1', 'a2'], ['d1', 'd2']);
  records.record('one', report({ achievements: ['a1', 'a1', 'unknown-a'], primary_achievement_id: 'a1', death_id: 'd1' }));
  records.record('two', report({ achievements: ['a1'], primary_achievement_id: null, death_id: 'unknown-d' }));
  assert.deepEqual(collectionProgress(small, snapshot(records)), {
    achievements: { collected: 1, total: 2, percent: 50 },
    deaths: { collected: 1, total: 2, percent: 50 },
    total: { collected: 2, total: 4, percent: 50 },
  });
  records.record('two', report({ achievements: ['a2'], death_id: 'd2' }));
  assert.equal(collectionProgress(small, snapshot(records)).total.collected, 2);
  records.record('three', report({ achievements: ['a2'], primary_achievement_id: null, death_id: 'd2' }));
  assert.deepEqual(collectionProgress(small, snapshot(records)).total, { collected: 4, total: 4, percent: 100 });
  assert.deepEqual(collectionProgress(catalog([], []), snapshot(records)), {
    achievements: { collected: 0, total: 0, percent: 0 },
    deaths: { collected: 0, total: 0, percent: 0 },
    total: { collected: 0, total: 0, percent: 0 },
  });
  const weighted = collectionProgress(catalog(['a1', 'a3', 'a4'], ['d3', 'd4', 'd5']), snapshot(records));
  assert.equal(weighted.achievements.percent, 33.3);
  assert.equal(weighted.deaths.percent, 0);
  assert.equal(weighted.total.percent, 16.6);
  const unequal = collectionProgress(catalog(['a1', 'a3', 'a4'], ['d3']), snapshot(records));
  assert.equal(unequal.total.percent, 25);
});

test('production achievement hints cover exactly the catalog and contain no internal IDs', () => {
  const ids = content.achievements.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, 'production achievement IDs must be unique');
  assert.deepEqual(Object.keys(ACHIEVEMENT_HINTS).sort(), [...ids].sort());
  for (const id of ids) {
    const hint = ACHIEVEMENT_HINTS[id];
    assert.equal(typeof hint, 'string', id);
    assert.ok(hint.trim().length > 0, id);
    assert.doesNotMatch(hint, /\b(?:A|F|E|CH|CHAIN|CARD|I)_[A-Za-z0-9_]+\b/, id);
  }
});

test('valid v2 preserves unknown IDs and explicitly unknown deaths across writes', () => {
  const unknown = { id: 'history', age: 24, years: 4, achievements: ['RETIRED_ACHIEVEMENT'], death_id: null };
  const unknownDeath = { id: 'history-2', age: 28, years: 8, achievements: [], death_id: 'RETIRED_DEATH' };
  const storage = new MemoryStorage([[V2, JSON.stringify({ version: 2, records: [unknown, unknownDeath], inheritanceAvailable: true })]]);
  const records = new LifetimeRecords(storage);
  assert.equal(snapshot(records).warning, '');
  assert.equal(snapshot(records).unknownDeaths, 1);
  assert.deepEqual(snapshot(records).deaths, new Set(['RETIRED_DEATH']));
  assert.equal(snapshot(records).inheritanceAvailable, true);
  assert.equal(collectionProgress(content, snapshot(records)).total.collected, 0);
  records.reserveInheritance('next');
  records.reconcileInheritance('next', true);
  assert.deepEqual(JSON.parse(storage.values.get(V2)).records, [unknown, unknownDeath]);
  const restored = snapshot(new LifetimeRecords(storage));
  assert.deepEqual(restored.achievements, new Set(['RETIRED_ACHIEVEMENT']));
  assert.deepEqual(restored.deaths, new Set(['RETIRED_DEATH']));
  assert.equal(restored.unknownDeaths, 1);
  assert.equal(restored.inheritanceAvailable, false);
});
