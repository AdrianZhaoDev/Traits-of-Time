import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACHIEVEMENT_CATALOG, DEATH_CATALOG } from '../src/game/presentation/CollectionCatalog.ts';
import { collectionProgress, formatCollectionProgress, HISTORICAL_COLLECTION } from '../src/game/presentation/CollectionProgress.ts';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { sha256Json } from '../src/game/core/persistence/JsonDigest.ts';
import { loadContent } from '../tools/content-io.mjs';

const bundle = (achievements, deaths) => ({
  achievements: achievements.map(id => ({ id })),
  deaths: deaths.map(id => ({ id })),
});
const records = (achievements = [], deaths = []) => ({
  achievements: new Set(achievements),
  deaths: new Set(deaths),
});
const readContent = name => JSON.parse(readFileSync(new URL(`../assets/resources/data/ming_end/${name}.json`, import.meta.url), 'utf8'));

test('every production ID has an explicit, evidenced catalog entry', () => {
  const cards = new Set(readContent('cards').map(card => card.id));
  for (const [name, catalog] of [['achievements', ACHIEVEMENT_CATALOG], ['deaths', DEATH_CATALOG]]) {
    const ids = readContent(name).map(item => item.id);
    assert.deepEqual(new Set(Object.keys(catalog)), new Set(ids));
    for (const id of ids) {
      const entry = catalog[id];
      assert.ok(['current', 'unavailable', 'unverified'].includes(entry.status), id);
      assert.ok(entry.evidence.trim(), id);
      assert.ok(Array.isArray(entry.cardIds), id);
      for (const cardId of entry.cardIds) assert.ok(cards.has(cardId), `${id}: ${cardId}`);
      if (entry.hint !== undefined) {
        assert.equal(entry.status, 'current', id);
        assert.ok(entry.hint.trim(), id);
      }
    }
  }
});

test('progress counts only current IDs in both numerator and denominator', () => {
  const content = bundle(
    ['A_MOD_GLUE_FINGER_BOND', 'A_MOD_CORN_SENIOR', 'A_NATIVE_BOOK_PETITION', 'A_PROJECT', 'A_UNKNOWN_OLD'],
    ['D_EPIDEMIC', 'D_BANDIT', 'D_NAT_BOOK_ARCHIVE_CART', 'D_EXPLOSION', 'D_UNKNOWN_OLD'],
  );
  const snapshot = records(
    ['A_MOD_GLUE_FINGER_BOND', 'A_NATIVE_BOOK_PETITION', 'A_PROJECT', 'A_UNKNOWN_OLD'],
    ['D_EPIDEMIC', 'D_NAT_BOOK_ARCHIVE_CART', 'D_EXPLOSION', 'D_UNKNOWN_OLD'],
  );
  assert.equal(ACHIEVEMENT_CATALOG.A_PROJECT.status, 'unverified');
  assert.equal(DEATH_CATALOG.D_EXPLOSION.status, 'unverified');
  assert.deepEqual(collectionProgress(content, snapshot), {
    achievements: { collected: 1, total: 2, percent: 50 },
    deaths: { collected: 1, total: 2, percent: 50 },
    total: { collected: 2, total: 4, percent: 50 },
  });
  assert.ok(snapshot.achievements.has('A_UNKNOWN_OLD'));
  assert.ok(snapshot.deaths.has('D_UNKNOWN_OLD'));
});

test('no current IDs means zero percent and the empty-catalog wording', () => {
  const content = bundle(['A_NATIVE_BOOK_PETITION', 'A_PROJECT', 'A_UNKNOWN_OLD'], ['D_EXPLOSION', 'D_UNKNOWN_OLD']);
  const progress = collectionProgress(content, records(['A_PROJECT', 'A_UNKNOWN_OLD'], ['D_EXPLOSION']));
  assert.deepEqual(progress.total, { collected: 0, total: 0, percent: 0 });
  assert.equal(formatCollectionProgress('图鉴收集', progress.total), '图鉴收集 暂无可收集条目');
});

test('legacy unavailable lookup is derived from the catalog, not from missing proof', () => {
  assert.equal(HISTORICAL_COLLECTION.achievements.A_NATIVE_BOOK_PETITION, true);
  assert.equal(HISTORICAL_COLLECTION.deaths.D_NAT_BOOK_ARCHIVE_CART, true);
  assert.equal(HISTORICAL_COLLECTION.achievements.A_PROJECT, undefined);
  assert.equal(HISTORICAL_COLLECTION.deaths.D_OLD_AGE, undefined);
  for (const [name, catalog] of [['achievements', ACHIEVEMENT_CATALOG], ['deaths', DEATH_CATALOG]]) {
    for (const [id, entry] of Object.entries(catalog)) {
      assert.equal(HISTORICAL_COLLECTION[name][id] === true, entry.status === 'unavailable', id);
    }
  }
});

test('a witnessed production life collects old age and the matching life achievements', async () => {
  const content = await loadContent();
  const engine = new GameEngine(content, sha256Json(content));
  const choices = {
    E_MOD_GLUE_MAGISTRATE_BOOTS: 'invest', E_MOD_SWISS_MUSKET: 'steady',
    E_MOD_SWISS_BOOK: 'safe', E_MOD_GLUE_CRAFT_CHALLENGE: 'safe',
  };
  const used = [];
  let result = engine.initGame({ seed: 3394728019 });
  assert.equal(result.ok, true);
  result = engine.selectCard('card', 'CARD_MODERN_GLUE');
  let step = 0;
  while (result.ok && result.state.status !== 'ENDED') {
    assert.ok(step < 200, 'the witnessed life must terminate');
    const pending = result.pending;
    const id = `witness:${step++}`;
    if (pending?.kind === 'option') {
      const choice = choices[pending.event_id];
      assert.ok(choice, `unexpected decision ${pending.event_id}`);
      used.push(pending.event_id);
      result = engine.resolveOption(id, pending.event_instance_id, choice);
    } else if (pending?.kind === 'stage') {
      result = engine.resolveStage(id, pending.event_instance_id, pending.stage_id);
    } else {
      result = engine.nextYear(id);
    }
    assert.equal(result.ok, true, JSON.stringify(result.error));
  }
  const report = engine.exportSave().payload.run.ending;
  assert.deepEqual(used, Object.keys(choices));
  assert.equal(report.death_id, 'D_OLD_AGE');
  assert.equal(report.primary_achievement_id, 'A_LIFE_CENTURY_TURMOIL');
  assert.ok(report.milestone_achievement_ids.includes('A_OLD_FOSSIL'));
  const progress = collectionProgress(bundle(['A_LIFE_CENTURY_TURMOIL', 'A_OLD_FOSSIL'], ['D_OLD_AGE']),
    records([report.primary_achievement_id, ...report.milestone_achievement_ids], [report.death_id]));
  assert.deepEqual(progress.total, { collected: 3, total: 3, percent: 100 });
});
