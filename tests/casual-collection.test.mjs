import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { LifetimeRecords } from '../src/game/presentation/LifetimeRecords.ts';
import { collectionProgress, HISTORICAL_COLLECTION } from '../src/game/presentation/CollectionProgress.ts';
import { ACHIEVEMENT_CATALOG } from '../src/game/presentation/CollectionCatalog.ts';

const content = await loadContent();
const recordsKey = 'time-travel.lifetime-records.v2';
const previous = ['A_MOD_CORN_DEATH_RUMOUR', 'A_MOD_CORN_DEATH_HUNGER', 'A_MOD_HEALER_DEATH_DELAY', 'A_MOD_HEALER_DEATH_ROBBERY', 'A_MOD_FLASHLIGHT_DEATH_CLAIMS', 'A_MOD_FLASHLIGHT_DEATH_MISSTEP'];
const replacements = ['A_MOD_CORN_LOCAL_HELP', 'A_MOD_CORN_TRY_AGAIN', 'A_MOD_HEALER_LOCAL_HELP', 'A_MOD_HEALER_COURSE_HANDOFF', 'A_MOD_FLASHLIGHT_FIRST_LIGHT', 'A_MOD_FLASHLIGHT_PASS_NOTES'];

function storage(lives) {
  const data = new Map([[recordsKey, JSON.stringify({ version: 2, records: lives, inheritanceAvailable: false })]]);
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function* nodes(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value;
  for (const child of Object.values(value)) yield* nodes(child);
}

test('historic awards and deaths remain in durable records without increasing current progress or granting replacements', () => {
  const lives = [{ id: 'legacy', age: 55, years: 20, achievements: [...previous, 'A_NATIVE_BOWL_CONGEE', 'UNKNOWN_OLD_AWARD'], death_id: 'D_MOD_FLASHLIGHT_MISSTEP' }];
  const port = storage(lives);
  const records = new LifetimeRecords(port);
  const snapshot = records.snapshot();
  assert.deepEqual(snapshot.achievements, new Set(lives[0].achievements));
  assert.deepEqual(snapshot.deaths, new Set([lives[0].death_id]));
  assert.ok(replacements.every(id => !snapshot.achievements.has(id)));
  const progress = collectionProgress(content, snapshot);
  assert.equal(progress.achievements.collected, 0);
  assert.equal(progress.deaths.collected, 0);
  assert.deepEqual(JSON.parse(port.data.get(recordsKey)).records, lives);
});

test('retired modern deaths have no live event effects while the two voluntary dangers remain', () => {
  const retired = ['D_MOD_CORN_RUMOUR', 'D_MOD_CORN_HUNGER', 'D_MOD_HEALER_DELAY', 'D_MOD_HEALER_ROBBERY', 'D_MOD_FLASHLIGHT_CLAIMS', 'D_MOD_FLASHLIGHT_MISSTEP', 'D_MOD_CALCULATOR_HERESY_FIRE', 'D_MOD_LIGHTER_GAS_BURST'];
  const deaths = content.events.flatMap(event => [...nodes(event)].filter(node => node.type === 'death').map(node => node.id));
  for (const id of retired) {
    assert.equal(HISTORICAL_COLLECTION.deaths[id], true, id);
    assert.equal(deaths.includes(id), false, `${id} still has a death path`);
  }
  for (const id of ['D_MOD_CORN_THEFT', 'D_MOD_FLASHLIGHT_ROBBERY', 'D_MOD_CALCULATOR_AUDIT_BRIDGE']) {
    assert.notEqual(HISTORICAL_COLLECTION.deaths[id], true, id);
    assert.ok(deaths.includes(id), `${id} lost its live source`);
  }
});

test('each available modern relic retains ten current achievements with its original rarity distribution', () => {
  for (const card of ['CORN', 'ANTIBIOTIC', 'FLASHLIGHT', 'CALCULATOR', 'GLUE', 'LIGHTER']) {
    const id = `CARD_MODERN_${card}`;
    const achievements = content.achievements.filter(item => ACHIEVEMENT_CATALOG[item.id]?.status === 'current'
      && [...nodes(item.condition)].some(node => node.op === 'has' && node.collection === 'cards' && node.id === id));
    assert.equal(achievements.length, 10, id);
    assert.deepEqual([
      achievements.filter(item => item.priority >= 20 && item.priority <= 29).length,
      achievements.filter(item => item.priority >= 30 && item.priority <= 49).length,
      achievements.filter(item => item.priority >= 60 && item.priority <= 79).length,
      achievements.filter(item => item.priority >= 80 && item.priority <= 95).length,
    ], [3, 3, 3, 1], id);
  }
});
