import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/content-io.mjs';
import { sha256Json } from '../src/game/core/persistence/JsonDigest.ts';
import { getNativeMingEndContent } from '../src/game/application/StaticContentLoader.ts';

const content = await loadContent();
export function* objects(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value;
  for (const child of Object.values(value)) yield* objects(child);
}
const family = content.events.filter(e => e.id.startsWith('E_FAM_'));

test('new family top-level IDs do not collide anywhere in production; stages are event-local', () => {
  assert.ok(family.length > 0, 'family production merge is missing');
  const all = [...Object.values(content).filter(Array.isArray).flat(), ...content.era.identities, ...content.era.backgrounds, ...content.era.injuries];
  for (const item of all.filter(x => /^[EAD]_FAM_/.test(x.id))) {
    assert.equal(all.filter(x => x.id === item.id).length, 1, item.id);
  }
  for (const event of family) {
    const ids = (event.stages ?? []).map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, event.id);
    for (const node of objects(event)) if (node.next_stage_id != null) assert.ok(ids.includes(node.next_stage_id), `${event.id}: ${node.next_stage_id}`);
  }
});

test('family additions add zero choices, career starts, or consumed choice-budget flags', () => {
  assert.ok(family.length);
  for (const event of family) {
    assert.equal(event.interaction, 'automatic', event.id);
    assert.equal(event.trigger.kind, 'random', event.id);
    assert.ok(event.trigger.priority <= 1, event.id);
    assert.ok(event.outcome, event.id);
    for (const node of objects(event)) {
      assert.notEqual(node.type, 'chain_start', event.id);
      assert.ok(!['F_LIFE_DIRECTION_TURN_USED', 'F_LIFE_HISTORICAL_TURN_USED'].includes(node.id), event.id);
    }
  }
});

test('only newly introduced family flag reads require production producers', () => {
  const producers = new Set([...objects(content)].filter(x => x.type === 'flag_add').map(x => x.id));
  for (const entry of [...content.regions, ...content.castes, ...content.era.backgrounds]) for (const flag of entry.flags) producers.add(flag);
  const additions = [...family, ...content.achievements.filter(x => x.id.startsWith('A_FAM_'))];
  for (const item of additions) for (const node of objects(item)) {
    if (node.op === 'has' && node.collection === 'flags' && node.id.startsWith('F_FAM_')) {
      assert.ok(producers.has(node.id), `${item.id}: missing producer ${node.id}`);
    }
  }
});

test('family fields use the approved vocabulary and no forbidden wording', () => {
  const ops = new Set(['all', 'any', 'not', 'compare', 'has', 'is']);
  const effects = new Set(['flag_add', 'flag_remove', 'attribute_add', 'chain_start', 'identity_set', 'death', 'ending_unlock']);
  const fields = new Set(['age', 'calendar_year', 'start_year', 'intelligence', 'wealth', 'physique', 'prestige', 'luck']);
  for (const event of family) {
    for (const key of ['id', 'title', 'text', 'condition', 'trigger', 'interaction', 'outcome']) assert.ok(Object.hasOwn(event, key), `${event.id}.${key}`);
    for (const key of ['kind', 'weight', 'priority', 'trigger_probability', 'cooldown_years', 'max_occurrences', 'rare']) assert.ok(Object.hasOwn(event.trigger, key), `${event.id}.trigger.${key}`);
    for (const node of objects(event)) {
      if (node.op) assert.ok(ops.has(node.op), `${event.id}: ${node.op}`);
      if (node.op === 'compare') assert.ok(fields.has(node.field), `${event.id}: ${node.field}`);
      if (node.type) assert.ok(effects.has(node.type), `${event.id}: ${node.type}`);
    }
  }
  const additions = [...family, ...content.achievements.filter(x => x.id.startsWith('A_FAM_')), ...content.deaths.filter(x => x.id.startsWith('D_FAM_'))];
  for (const item of additions) assert.doesNotMatch(JSON.stringify(item), /起义|造反|称帝|妖道|血祭|鞑子|蛮子|领盒饭|销户/);
});

test('all added deaths are connected to real production events', () => {
  const referenced = new Set([...objects(content.events)].filter(x => x.type === 'death').map(x => x.id));
  for (const death of content.deaths.filter(x => x.id.startsWith('D_FAM_'))) assert.ok(referenced.has(death.id), death.id);
});

test('native loader fingerprint equals canonical SHA256 of the complete bundle', () => {
  const native = getNativeMingEndContent();
  assert.deepEqual(native.bundle, content);
  assert.equal(native.fingerprint, sha256Json(content));
});
