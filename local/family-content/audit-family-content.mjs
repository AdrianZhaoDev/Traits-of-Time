import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadContent } from '../../tools/content-io.mjs';
import { sha256Json } from '../../src/game/core/persistence/JsonDigest.ts';
import { isDeepStrictEqual } from 'node:util';

// Optional parent-authored authorization: { reason, files: { events: { ID: reason } } }.
let authorization = { reason: '', files: {} };
try {
  authorization = JSON.parse(await readFile('local/family-content/budget-exceptions.json', 'utf8'));
  assert.ok(authorization.reason && authorization.files, 'Exception authorization must explain its scope');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
function differences(before, after, path = '') {
  if (isDeepStrictEqual(before, after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) {
    return [{ path, before: before === undefined ? { absent: true } : before, after: after === undefined ? { absent: true } : after }];
  }
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => differences(before[key], after[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`));
}
function* objects(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value;
  for (const child of Object.values(value)) yield* objects(child);
}

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--content')) throw new Error('Usage: audit-family-content.mjs [--content directory]');
const content = await loadContent(args[1]);
const report = { fingerprint: sha256Json(content), authorization: authorization.reason || null, arrays: {}, addedChoices: 0, eventFields: [] };
for (const key of ['events', 'chains', 'achievements', 'deaths']) {
  const baseline = JSON.parse(await readFile(`local/family-content/baseline/${key}.json`, 'utf8'));
  const prefix = content[key].slice(0, baseline.length);
  assert.equal(prefix.length, baseline.length, `${key}: baseline entries removed`);
  const exceptions = authorization.files[key] ?? {};
  const changed = [];
  const unchangedBefore = [], unchangedAfter = [];
  for (let index = 0; index < baseline.length; index++) {
    const before = baseline[index], after = prefix[index];
    assert.equal(after.id, before.id, `${key}: baseline ID/order changed at ${index}`);
    if (isDeepStrictEqual(before, after)) {
      unchangedBefore.push(before); unchangedAfter.push(after);
      continue;
    }
    assert.ok(typeof exceptions[before.id] === 'string' && exceptions[before.id].length, `${key}: unauthorized baseline change ${before.id}`);
    changed.push({ id: before.id, index, reason: exceptions[before.id], differences: differences(before, after) });
  }
  for (const id of Object.keys(exceptions)) assert.ok(changed.some(item => item.id === id), `${key}: stale exception ${id}`);
  assert.deepEqual(unchangedAfter, unchangedBefore, `${key}: non-exempt baseline changed`);
  const additions = content[key].slice(baseline.length);
  report.arrays[key] = { baseline: baseline.length, production: content[key].length, added: additions.length,
    baselineHash: sha256Json(baseline), prefixHash: sha256Json(prefix), ids: additions.map(x => x.id),
    unchangedCount: unchangedBefore.length, unchangedBaselineHash: sha256Json(unchangedBefore), unchangedProductionHash: sha256Json(unchangedAfter), changed };
  if (key === 'events') {
    const modern = /^(E_MOD_(CORN|HEALER|FLASHLIGHT)_)/;
    const oldNodes = [...objects(baseline.filter(event => modern.test(event.id)))];
    const newNodes = [...objects(content.events.filter(event => modern.test(event.id)))];
    const consequences = node => node.type === 'death' || node.type === 'ending_unlock' || node.type === 'flag_add';
    const producerKeys = new Set(newNodes.filter(consequences).map(node => `${node.type}:${node.id}`));
    const retained = [...new Set(oldNodes.filter(consequences).map(node => `${node.type}:${node.id}`))];
    for (const key of retained) assert.ok(producerKeys.has(key), `Budget migration removed consequence producer ${key}`);
    report.retainedModernConsequences = retained;
    report.addedChoices = additions.filter(e => e.interaction === 'choice').length;
    report.eventFields = additions.map(e => ({ id: e.id, fields: Object.keys(e), trigger: e.trigger,
      condition: e.condition, outcome: e.outcome, stages: e.stages ?? [] }));
  }
}
assert.equal(report.addedChoices, 0);
console.log(JSON.stringify(report, null, 2));
