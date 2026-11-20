import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { loadContent } from '../tools/content-io.mjs';
import { CurrentLifeStore } from '../src/game/application/CurrentLifeStore.ts';
import { compressLife, decompressLife, MAX_LIFE_JSON_BYTES } from '../src/game/application/LifeCompression.ts';
import { deduplicateLife, restoreDeduplicatedLife } from '../src/game/application/LifeDeduplication.ts';
import { decodeUtf8, encodeUtf8 } from '../src/game/application/LifeUtf8.ts';
import { GameSession } from '../src/game/application/GameSession.ts';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { sha256Json } from '../src/game/core/persistence/JsonDigest.ts';

const slots = ['time-travel.current-life.a.v1', 'time-travel.current-life.b.v1'];
const content = await loadContent();
const ports = { hash: sha256Json, persist: async () => {}, load: async () => null };
// The storage contract is JSON data: parsing turns null-prototype records into plain objects.
const jsonData = value => JSON.parse(JSON.stringify(value));
const sessionFor = () => new GameSession(new GameEngine(content, 'compression-test'), ports);
const validate = save => sessionFor().restoreSave(save);

class QuotaStorage {
  values = new Map();
  failWrites = false;
  failReadback = false;
  lastWritten = null;
  constructor(totalLimit = Infinity, keyLimit = Infinity, encoding = 'utf8') {
    Object.assign(this, { totalLimit, keyLimit, encoding });
  }
  getItem(key) {
    const value = this.values.get(key) ?? null;
    return this.failReadback && key === this.lastWritten && value !== null ? value.slice(0, -1) : value;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error('quota');
    const size = text => Buffer.byteLength(text, this.encoding);
    const others = [...this.values].filter(([oldKey]) => oldKey !== key)
      .reduce((total, [oldKey, oldValue]) => total + size(oldKey) + size(oldValue), 0);
    if (size(value) > this.keyLimit || others + size(key) + size(value) > this.totalLimit) throw new Error('quota');
    this.values.set(key, value);
    this.lastWritten = key;
  }
}

function signed(body) {
  return JSON.stringify({ ...body, checksum: sha256Json(body) });
}
function rewrite(raw, changes) {
  const { checksum: _checksum, ...body } = JSON.parse(raw);
  return signed({ ...body, ...changes });
}
async function realSave() {
  const session = sessionFor();
  const initial = await session.initialize(29);
  assert.equal(initial.ok, true);
  assert.equal(initial.pending.kind, 'card');
  const selected = await session.command({ type: 'selectCard', cardId: initial.pending.cards[0] });
  assert.equal(selected.ok, true);
  return session.exportSave();
}
function withTwoSlots(save) {
  const storage = new QuotaStorage();
  const store = new CurrentLifeStore(storage);
  assert.equal(store.read(validate).status, 'empty');
  store.write(save, 'first');
  store.write(save, 'second');
  return { storage, store };
}

test('codec preserves full JSON and works without Buffer, TextEncoder, TextDecoder or streams', async () => {
  const value = { emoji: '😀', han: '传承家当', unpaired: '\ud800\udfff\udc00', strings: ['', '"\\\n'], nested: [{ n: -3.5 }, null, true] };
  const encoded = compressLife(value);
  assert.deepEqual(decompressLife(encoded.data, encoded.decoded_bytes), value);
  const source = `import { compressLife, decompressLife } from './src/game/application/LifeCompression.ts';
    const original = ${JSON.stringify(value)};
    const encoded = compressLife(original);
    globalThis.output = JSON.stringify(decompressLife(encoded.data, encoded.decoded_bytes));`;
  const bundled = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'js' },
    bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent' });
  const sandbox = { Buffer: undefined, TextEncoder: undefined, TextDecoder: undefined, CompressionStream: undefined, DecompressionStream: undefined };
  vm.runInNewContext(bundled.outputFiles[0].text, sandbox, { timeout: 5000 });
  assert.deepEqual(JSON.parse(sandbox.output), value);
});

test('portable UTF-8 handles Unicode boundaries and rejects malformed byte sequences', () => {
  for (const text of ['\u0000\u007f\u0080\u07ff\u0800\uffff', '😀𐀀􏿿', '\ud800X\udc00']) {
    const encoded = encodeUtf8(text);
    assert.deepEqual([...encoded], [...Buffer.from(text, 'utf8')]);
    assert.equal(decodeUtf8(encoded), Buffer.from(text, 'utf8').toString('utf8'));
  }
  for (const bytes of [[0x80], [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x9f, 0x98], [0xc2, 0x20]]) {
    assert.throws(() => decodeUtf8(Uint8Array.from(bytes)));
  }
});

test('deduplication recreates independent JSON objects and rejects forged expansion graphs', () => {
  const original = { a: { items: [1, '传承'] }, b: { items: [1, '传承'] } };
  const encoded = compressLife(original);
  const restored = decompressLife(encoded.data, encoded.decoded_bytes);
  assert.deepEqual(restored, original);
  assert.notEqual(restored.a, restored.b);
  assert.notEqual(restored.a.items, restored.b.items);
  restored.a.items[0] = 9;
  assert.equal(restored.b.items[0], 1);
  const special = Object.create(null);
  special.__proto__ = { value: 7 };
  special.constructor = { prototype: { polluted: true } };
  const specialEncoded = compressLife(special);
  const decodedSpecial = decompressLife(specialEncoded.data, specialEncoded.decoded_bytes);
  assert.deepEqual(decodedSpecial, jsonData(special));
  assert.equal(Object.getPrototypeOf(decodedSpecial), Object.prototype);
  assert.equal(Object.hasOwn(decodedSpecial, '__proto__'), true);
  assert.equal(Object.hasOwn(decodedSpecial, 'constructor'), true);
  assert.equal(({}).polluted, undefined);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => deduplicateLife(cycle, 100));
  assert.throws(() => deduplicateLife({ bad: undefined }, 100));
  assert.throws(() => deduplicateLife({ text: '123456' }, 10));
  assert.throws(() => restoreDeduplicatedLife([[0], [[0, [0]]]], MAX_LIFE_JSON_BYTES));
  assert.throws(() => restoreDeduplicatedLife([[0], [[1, 'a', 1, 'a', 2]]], MAX_LIFE_JSON_BYTES));
  const nodes = [[0]];
  for (let i = 1; i < 26; i++) nodes.push([0, [i - 1], [i - 1]]);
  assert.throws(() => restoreDeduplicatedLife([[nodes.length - 1], nodes], MAX_LIFE_JSON_BYTES));
});

test('compressed inherited offers retain the full replay and idempotent command history', async () => {
  const desired = content.pools.find(pool => pool.id === content.rules.opening.pool_id).entries.find(entry => entry.weight > 0).card_id;
  const session = sessionFor();
  const opening = await session.initialize(43, { kind: 'extra_card', card_id: desired });
  assert.equal(opening.ok, true);
  assert.ok(opening.pending.cards.length <= 3);
  assert.equal(opening.pending.cards.filter(id => id === desired).length, 1);
  const replacement = content.pools.find(pool => pool.id === content.rules.opening.pool_id).entries
    .find(entry => entry.weight > 0 && !opening.pending.cards.includes(entry.card_id)).card_id;
  const result = await session.command({ type: 'replaceCardOffer', previousCardId: desired, cardId: replacement });
  assert.equal(result.ok, true);
  const original = session.exportSave();
  const { storage } = withTwoSlots(original);
  const loaded = new CurrentLifeStore(storage).read(validate);
  assert.equal(loaded.status, 'ready');
  assert.deepEqual(loaded.save, jsonData(original));
  const engine = new GameEngine(content, 'compression-test');
  engine.restoreSave(loaded.save.engine);
  const recorded = loaded.save.replay_commands.at(-1);
  assert.equal(recorded.api, 'replaceCardOffer');
  const replayed = engine.replaceCardOffer(recorded.commandId, recorded.args.previousCardId, recorded.args.cardId);
  assert.equal(sha256Json(replayed), recorded.expected_result_hash);
  assert.deepEqual(jsonData(engine.exportSave()), jsonData(original.engine));
});

test('legacy v1 restores, next write uses v2, and the legacy slot remains a recoverable backup', async () => {
  const save = await realSave();
  const storage = new QuotaStorage();
  const legacy = signed({ format: 1, generation: 1, life_id: 'legacy', session: save });
  storage.setItem(slots[0], legacy);
  const store = new CurrentLifeStore(storage);
  assert.deepEqual(store.read(validate), { status: 'ready', save: jsonData(save), lifeId: 'legacy', recovered: false });
  store.write(save, 'compressed');
  assert.equal(storage.getItem(slots[0]), legacy);
  const envelope = JSON.parse(storage.getItem(slots[1]));
  assert.equal(envelope.format, 2);
  assert.equal(envelope.encoding, 'dedupe-deflate-base64');
  const restart = new CurrentLifeStore(storage).read(validate);
  assert.equal(restart.status, 'ready');
  assert.deepEqual(restart.save, jsonData(save));
  assert.equal(restart.lifeId, 'compressed');
  storage.setItem(slots[1], '{broken');
  const fallback = new CurrentLifeStore(storage).read(validate);
  assert.equal(fallback.status, 'ready');
  assert.deepEqual(fallback.save, jsonData(save));
  assert.equal(fallback.lifeId, 'legacy');
  assert.equal(fallback.recovered, true);
});

test('checksum, invalid base64, truncated data and length violations fall back to the other slot', async () => {
  const save = await realSave();
  const { storage } = withTwoSlots(save);
  const newest = storage.getItem(slots[1]);
  const envelope = JSON.parse(newest);
  const corruptions = [
    JSON.stringify({ ...envelope, data: `!${envelope.data.slice(1)}` }), // checksum mismatch
    rewrite(newest, { data: '@@@@' }), // checksum matches but encoding is invalid
    rewrite(newest, { data: envelope.data.slice(0, -4) }), // valid base64, truncated DEFLATE
    rewrite(newest, { decoded_bytes: envelope.decoded_bytes - 1 }),
    rewrite(newest, { decoded_bytes: envelope.decoded_bytes + 1 }),
    rewrite(newest, { decoded_bytes: MAX_LIFE_JSON_BYTES + 1 }),
    rewrite(newest, { encoding: 'unknown' }),
  ];
  for (const corrupted of corruptions) {
    storage.setItem(slots[1], corrupted);
    const read = new CurrentLifeStore(storage).read(validate);
    assert.equal(read.status, 'ready');
    assert.equal(read.lifeId, 'first');
    assert.equal(read.recovered, true);
    assert.deepEqual(read.save, jsonData(save));
  }
  const bomb = compressLife({ long: 'x'.repeat(1024 * 1024) });
  storage.setItem(slots[1], signed({ format: 2, generation: 2, life_id: 'bomb', encoding: 'dedupe-deflate-base64', ...bomb, decoded_bytes: 8 }));
  const read = new CurrentLifeStore(storage).read(validate);
  assert.equal(read.status, 'ready');
  assert.equal(read.lifeId, 'first');
  assert.equal(read.recovered, true);
});

test('two damaged slots require explicit consent before replacement', async () => {
  const save = await realSave();
  const { storage } = withTwoSlots(save);
  storage.setItem(slots[0], '{bad');
  storage.setItem(slots[1], '{bad');
  const store = new CurrentLifeStore(storage);
  assert.equal(store.read(validate).status, 'damaged');
  assert.throws(() => store.write(save, 'new'), { code: 'SAVE_FAILED' });
  store.write(save, 'new', true);
  assert.equal(new CurrentLifeStore(storage).read(validate).lifeId, 'new');
});

test('v2 still enforces strict replay and refuses incompatible newer versions without consent', async () => {
  const save = await realSave();
  const { storage } = withTwoSlots(save);
  const raw = storage.getItem(slots[1]);
  const changed = structuredClone(save);
  changed.replay_commands[0].expected_result_hash = '0'.repeat(64);
  storage.setItem(slots[1], rewrite(raw, compressLife(changed)));
  const fallback = new CurrentLifeStore(storage).read(validate);
  assert.equal(fallback.status, 'ready');
  assert.equal(fallback.lifeId, 'first');
  assert.equal(fallback.recovered, true);
  const incompatible = structuredClone(save);
  incompatible.engine.rules_implementation_version += 1;
  storage.setItem(slots[1], rewrite(raw, compressLife(incompatible)));
  const store = new CurrentLifeStore(storage);
  assert.equal(store.read(validate).status, 'incompatible');
  assert.throws(() => store.write(save, 'replacement'), { code: 'SAVE_FAILED' });
  store.write(save, 'replacement', true);
  assert.equal(new CurrentLifeStore(storage).read(validate).lifeId, 'replacement');
  storage.setItem(slots[1], JSON.stringify({ format: 3, generation: 9 }));
  const future = new CurrentLifeStore(storage);
  assert.equal(future.read(validate).status, 'incompatible');
  assert.throws(() => future.write(save, 'future'), { code: 'SAVE_FAILED' });
});

test('simulated wx and browser quotas retain the active slot on write or readback failure', async () => {
  const save = await realSave();
  for (const storage of [new QuotaStorage(10 * 1024 * 1024, 1024 * 1024, 'utf8'),
    new QuotaStorage(10 * 1024 * 1024, 1024 * 1024, 'utf16le'),
    new QuotaStorage(5 * 1024 * 1024, Infinity, 'utf16le')]) {
    const store = new CurrentLifeStore(storage);
    assert.equal(store.read(validate).status, 'empty');
    store.write(save, 'first');
    store.write(save, 'second');
    const active = storage.getItem(slots[1]);
    const keyLimit = storage.keyLimit;
    storage.keyLimit = 10;
    assert.throws(() => store.write(save, 'over-quota'), { code: 'SAVE_FAILED' });
    storage.keyLimit = keyLimit;
    assert.equal(storage.getItem(slots[1]), active);
    storage.failWrites = true;
    assert.throws(() => store.write(save, 'failed'), { code: 'SAVE_FAILED' });
    storage.failWrites = false;
    assert.equal(storage.getItem(slots[1]), active);
    assert.equal(new CurrentLifeStore(storage).read(validate).lifeId, 'second');
    storage.failReadback = true;
    assert.throws(() => store.write(save, 'unconfirmed'), { code: 'SAVE_FAILED' });
    storage.failReadback = false;
    assert.equal(storage.getItem(slots[1]), active);
  }
});

test('unreadable storage remains unavailable and cannot be overwritten', async () => {
  const save = await realSave();
  const store = new CurrentLifeStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  assert.equal(store.read(validate).status, 'unavailable');
  assert.throws(() => store.write(save, 'life'), { code: 'SAVE_FAILED' });
});
