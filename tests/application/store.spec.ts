import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { GachaEngine } from '../../assets/scripts/core/engine/GachaEngine.js';
import type { GachaSave } from '../../assets/scripts/core/engine/GachaEngine.js';
import type { GameSave } from '../../assets/scripts/core/types/schema.js';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated.js';
import { acquireStateLock, load, save } from '../../tools/lib/FileStateStore.js';
import { sha256 } from '../../tools/lib/canonical.js';
import { loadTemplate } from '../helpers/content.js';

type Slot<T = unknown> = { revision: number; payload: T; checksum: string };
const slotNames = ['slot-a.json', 'slot-b.json'] as const;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'configurable-core-store-'));
  directories.push(value);
  return value;
}

async function slots<T>(root: string): Promise<Array<Slot<T> & { name: string }>> {
  const names = (await readdir(root)).filter((name) => slotNames.some((slot) => slot === name));
  return Promise.all(names.map(async (name) => ({
    ...JSON.parse(await readFile(join(root, name), 'utf8')) as Slot<T>, name,
  })));
}

async function slotBytes(root: string): Promise<Record<string, string>> {
  const names = (await readdir(root)).filter((name) => slotNames.some((slot) => slot === name));
  return Object.fromEntries(await Promise.all(names.map(async (name) => [
    name, await readFile(join(root, name), 'utf8'),
  ])));
}

async function writeSlot(root: string, name: string, revision: number, payload: unknown): Promise<void> {
  await writeFile(join(root, name), JSON.stringify({ revision, payload, checksum: sha256(payload) }));
}

async function quietLife(): Promise<{ engine: GameEngine; bundle: ContentBundle; fingerprint: string }> {
  const bundle = await loadTemplate();
  bundle.events = bundle.events.filter((event) => event.id === 'E_OPEN_SAFE');
  bundle.chains = [];
  bundle.achievements = [];
  bundle.rules.events = { per_year: 0, automatic_ratio: 0.6 };
  const fingerprint = sha256(bundle);
  const engine = new GameEngine(bundle, fingerprint);
  expect(engine.initGame({ seed: 1640 }).ok).toBe(true);
  return { engine, bundle, fingerprint };
}

describe('FileStateStore: real checksummed double slots', () => {
  it('returns null only when both slots are absent, including an absent state directory', async () => {
    const root = await directory();
    expect(await load(root)).toBeNull();
    expect(await load(join(root, 'not-created'))).toBeNull();
  });

  it('alternates slots with its own revision even when the engine revision is unchanged', async () => {
    const root = join(await directory(), 'nested', 'state');
    const initial = { engine: { revision: 9 }, cursor: { input_sequence: 0 } };
    await save(root, initial);
    const first = await slots<typeof initial>(root);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ revision: 1, payload: initial });
    expect(first[0].checksum).toBe(createHash('sha256')
      .update('{"cursor":{"input_sequence":0},"engine":{"revision":9}}').digest('hex'));
    expect(Object.keys(JSON.parse(await readFile(join(root, first[0].name), 'utf8'))).sort())
      .toEqual(['checksum', 'payload', 'revision']);

    const second = { ...initial, cursor: { input_sequence: 1 } };
    await save(root, second);
    expect((await slots(root)).map((slot) => slot.revision).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(await load(root)).toEqual(second);

    const third = { ...initial, cursor: { input_sequence: 2 } };
    await save(root, third);
    expect((await slots(root)).map((slot) => slot.revision).sort((a, b) => a - b)).toEqual([2, 3]);
    expect(await load(root)).toEqual(third);
    expect((await readdir(root)).sort()).toEqual([...slotNames]);
  });

  it.each([false, true])('loads the highest valid revision regardless of slot ordering (reverse=%s)', async (reverse) => {
    const root = await directory();
    await writeSlot(root, slotNames[Number(reverse)], 7, { command: 'newest' });
    await writeSlot(root, slotNames[Number(!reverse)], 4, { command: 'older' });
    expect(await load(root)).toEqual({ command: 'newest' });
  });

  it('does not rewrite or increment revisions for canonically identical data', async () => {
    const root = await directory();
    await save(root, { b: { z: 2, a: 1 }, a: [{ y: 2, x: 1 }] });
    const names = await readdir(root);
    const oldTime = new Date('2001-01-01T00:00:00.000Z');
    for (const name of names) await utimes(join(root, name), oldTime, oldTime);
    const snapshot = async () => Promise.all(names.map(async (name) => {
      const metadata = await stat(join(root, name), { bigint: true });
      return {
        name, bytes: await readFile(join(root, name), 'utf8'),
        inode: metadata.ino, modified: metadata.mtimeNs, changed: metadata.ctimeNs, size: metadata.size,
      };
    }));
    const before = await snapshot();
    await save(root, { a: [{ x: 1, y: 2 }], b: { a: 1, z: 2 } });
    expect(await snapshot()).toEqual(before);
    expect(await readdir(root)).toEqual(names);
  });

  const corruptions: Array<{ name: string; bytes: (slot: Slot) => string }> = [
    { name: 'truncated JSON', bytes: () => '{"revision":2,"payload":' },
    { name: 'changed payload with an old checksum', bytes: (slot) => JSON.stringify({ ...slot, payload: { value: 'tampered' } }) },
    { name: 'incorrect checksum', bytes: (slot) => JSON.stringify({ ...slot, checksum: '0'.repeat(64) }) },
    { name: 'missing checksum', bytes: (slot) => JSON.stringify({ revision: slot.revision, payload: slot.payload }) },
    { name: 'negative revision', bytes: (slot) => JSON.stringify({ ...slot, revision: -1 }) },
    { name: 'fractional revision', bytes: (slot) => JSON.stringify({ ...slot, revision: 1.5 }) },
    { name: 'unsafe revision', bytes: (slot) => JSON.stringify({ ...slot, revision: Number.MAX_SAFE_INTEGER + 1 }) },
  ];

  it.each(corruptions)('recovers the older valid slot after $name, without deleting evidence', async ({ bytes }) => {
    const root = await directory();
    const older = { value: 'first' };
    await save(root, older);
    await save(root, { value: 'second' });
    const newest = (await slots(root)).sort((a, b) => b.revision - a.revision)[0];
    await writeFile(join(root, newest.name), bytes({ revision: newest.revision, payload: newest.payload, checksum: newest.checksum }));
    const before = await slotBytes(root);
    expect(await load(root)).toEqual(older);
    expect(await slotBytes(root)).toEqual(before);
  });

  it('does not treat a lone corrupt slot as a new save', async () => {
    const root = await directory();
    await writeFile(join(root, 'slot-b.json'), 'not JSON');
    const before = await slotBytes(root);
    await expect(load(root)).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
    expect(await slotBytes(root)).toEqual(before);
  });

  it('rejects two corrupt slots on load and save, retaining both original files', async () => {
    const root = await directory();
    await writeFile(join(root, 'slot-a.json'), '{');
    await writeFile(join(root, 'slot-b.json'), '{"revision":2,"payload":{},"checksum":"wrong"}');
    const before = await slotBytes(root);
    await expect(load(root)).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
    await expect(save(root, { replacement: true })).rejects.toMatchObject({ code: 'SAVE_CORRUPT' });
    expect(await slotBytes(root)).toEqual(before);
  });

  it('rejects different valid payloads at the same revision rather than choosing a slot', async () => {
    const root = await directory();
    await writeSlot(root, 'slot-a.json', 4, { command: 'left' });
    await writeSlot(root, 'slot-b.json', 4, { command: 'right' });
    const before = await slotBytes(root);
    await expect(load(root)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(save(root, { replacement: true })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await slotBytes(root)).toEqual(before);
  });

  it('accepts canonically equal payloads at the same revision', async () => {
    const root = await directory();
    await writeSlot(root, 'slot-a.json', 4, { a: 1, b: [2, 3] });
    await writeSlot(root, 'slot-b.json', 4, { b: [2, 3], a: 1 });
    expect(await load(root)).toEqual({ a: 1, b: [2, 3] });
    await save(root, { a: 1, b: [3, 2] });
    expect(await load(root)).toEqual({ a: 1, b: [3, 2] });
    expect((await slots(root)).map((slot) => slot.revision).sort((a, b) => a - b)).toEqual([4, 5]);
  });

  it('restores a real gacha receipt without another draw after a process-equivalent reload', async () => {
    const root = await directory();
    const bundle = await loadTemplate();
    const fingerprint = sha256(bundle);
    const original = new GachaEngine(bundle, fingerprint, 1640);
    const first = original.draw('saved-ten', 'POOL_PITY', 10);
    await save(root, original.exportSave());
    const loaded = await load<GachaSave>(root);
    expect(loaded).not.toBeNull();
    expect(loaded).toMatchObject({ save_version: 1, kind: 'gacha' });
    const restored = new GachaEngine(bundle, fingerprint, 0);
    restored.restoreSave(loaded!);
    const before = restored.exportSave();
    expect(restored.draw('saved-ten', 'POOL_PITY', 10)).toEqual(first);
    expect(restored.exportSave()).toEqual(before);
    expect(restored.draw('next', 'POOL_PITY', 1)).toEqual(original.draw('next', 'POOL_PITY', 1));
  });

  it('does not fall back to an older matching-content slot when the newest valid save belongs to another bundle', async () => {
    const root = await directory();
    const bundle = await loadTemplate();
    const original = new GachaEngine(bundle, sha256(bundle), 1640);
    original.draw('old-content', 'POOL_PITY', 1);
    await save(root, original.exportSave());
    const changedBundle = structuredClone(bundle);
    changedBundle.manifest.content_version = '0.2.0';
    const changed = new GachaEngine(changedBundle, sha256(changedBundle), 1640);
    changed.draw('new-content', 'POOL_PITY', 2);
    await save(root, changed.exportSave());
    const filesBefore = await slotBytes(root);
    const engineBefore = original.exportSave();
    const loaded = await load<GachaSave>(root);
    expect(loaded).toEqual(changed.exportSave());
    expect(() => original.restoreSave(loaded!)).toThrowError(expect.objectContaining({ code: 'CONTENT_MISMATCH' }));
    expect(original.exportSave()).toEqual(engineBefore);
    expect(await slotBytes(root)).toEqual(filesBefore);
  });
});

describe('acquireStateLock: exclusive ownership without stealing', () => {
  it('creates a missing directory, refuses another writer, and allows acquisition after release', async () => {
    const root = join(await directory(), 'new-state');
    const release = await acquireStateLock(root);
    try {
      const names = await readdir(root);
      expect(names).toHaveLength(1);
      const before = await readFile(join(root, names[0]), 'utf8');
      await expect(acquireStateLock(root)).rejects.toMatchObject({ code: 'STATE_LOCKED' });
      expect(await readdir(root)).toEqual(names);
      expect(await readFile(join(root, names[0]), 'utf8')).toBe(before);
      await save(root, { owner: 'first' });
    } finally {
      await release();
    }
    const releaseNext = await acquireStateLock(root);
    try {
      expect(await load(root)).toEqual({ owner: 'first' });
    } finally {
      await releaseNext();
    }
    expect((await readdir(root)).filter((name) => !slotNames.some((slot) => slot === name))).toEqual([]);
  });

  it('gives exactly one simultaneous contender ownership of the real lock file', async () => {
    const root = await directory();
    const attempts = await Promise.allSettled([acquireStateLock(root), acquireStateLock(root)]);
    const owners = attempts.filter((result): result is PromiseFulfilledResult<() => Promise<void>> => result.status === 'fulfilled');
    try {
      expect(owners).toHaveLength(1);
      const rejected = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ code: 'STATE_LOCKED' });
    } finally {
      await Promise.all(owners.map((owner) => owner.value()));
    }
  });
});

describe('SaveCodec through GameEngine.restoreSave', () => {
  it('round-trips a pending real decision and its receipt through JSON and real storage', async () => {
    const root = await directory();
    const { engine, bundle, fingerprint } = await quietLife();
    const original = engine.exportSave();
    expect(original.kind).toBe('life');
    expect(original.save_version).toBe(2);
    expect(original.payload.player.cards).toHaveLength(1);
    expect(Array.isArray(original.payload.player.flags)).toBe(true);
    expect(Array.isArray(original.payload.player.injuries)).toBe(true);
    await save(root, JSON.parse(JSON.stringify(original)) as GameSave);
    const restored = new GameEngine(bundle, fingerprint);
    restored.restoreSave((await load<GameSave>(root))!);
    expect(restored.exportSave()).toEqual(original);
    expect(restored.current()).toEqual(engine.current());
    const pending = restored.current().pending;
    expect(pending?.kind).toBe('option');
    if (pending?.kind !== 'option') throw new Error('Fixture must pause at its opening choice');
    const option = pending.options.find((item) => item.available);
    if (!option) throw new Error('Fixture must have an available opening option');
    expect(restored.resolveOption('continue', pending.event_instance_id, option.id))
      .toEqual(engine.resolveOption('continue', pending.event_instance_id, option.id));
    expect(restored.exportSave()).toEqual(engine.exportSave());
  });

  const invalid: Array<{ name: string; corrupt: (value: GameSave) => void }> = [
    { name: 'legacy life save version', corrupt: (value) => { Object.assign(value, { save_version: 1 }); } },
    { name: 'unknown save version', corrupt: (value) => { Object.assign(value, { save_version: 3 }); } },
    { name: 'wrong kind', corrupt: (value) => { Object.assign(value, { kind: 'gacha' }); } },
    { name: 'missing payload', corrupt: (value) => { Reflect.deleteProperty(value, 'payload'); } },
    { name: 'unknown envelope field', corrupt: (value) => { Object.assign(value, { unexpected: true }); } },
    { name: 'negative revision', corrupt: (value) => { Object.assign(value, { revision: -1 }); } },
    { name: 'fractional revision', corrupt: (value) => { Object.assign(value, { revision: 1.5 }); } },
    { name: 'unknown PRNG algorithm', corrupt: (value) => { Object.assign(value.payload.run.prng, { algorithm: 'future-rng' }); } },
    { name: 'out-of-range PRNG state', corrupt: (value) => { Object.assign(value.payload.run.prng, { state: 0x100000000 }); } },
    { name: 'negative PRNG cursor', corrupt: (value) => { Object.assign(value.payload.run.prng, { draws: -1 }); } },
    { name: 'fractional PRNG cursor', corrupt: (value) => { Object.assign(value.payload.run.prng, { draws: 0.5 }); } },
    { name: 'unsafe PRNG cursor', corrupt: (value) => { Object.assign(value.payload.run.prng, { draws: Number.MAX_SAFE_INTEGER + 1 }); } },
    { name: 'invalid seed', corrupt: (value) => { Object.assign(value.payload.run, { seed: -1 }); } },
    { name: 'unknown status', corrupt: (value) => { Object.assign(value.payload.run, { status: 'DEATH_PENDING' }); } },
    { name: 'unknown timeline', corrupt: (value) => { Object.assign(value.payload.run, { timeline: 'unknown' }); } },
    { name: 'unknown year phase', corrupt: (value) => { Object.assign(value.payload.run, { year_phase: 'unknown' }); } },
    { name: 'queue cursor past the queue', corrupt: (value) => { Object.assign(value.payload.run, { queue_cursor: value.payload.run.queue.length + 1 }); } },
    { name: 'negative event counter', corrupt: (value) => { Object.assign(value.payload.run, { event_counter: -1 }); } },
    { name: 'fractional chain counter', corrupt: (value) => { Object.assign(value.payload.run, { chain_counter: 0.5 }); } },
    { name: 'nonintegral age', corrupt: (value) => { Object.assign(value.payload.player, { age: 9.5 }); } },
    { name: 'unknown region', corrupt: (value) => { Object.assign(value.payload.player, { region_id: 'NO_REGION' }); } },
    { name: 'unknown caste', corrupt: (value) => { Object.assign(value.payload.player, { caste_id: 'NO_CASTE' }); } },
    { name: 'unknown identity', corrupt: (value) => { Object.assign(value.payload.player, { identity_id: 'NO_IDENTITY' }); } },
    { name: 'unknown equipped card', corrupt: (value) => { Object.assign(value.payload.player, { cards: ['NO_CARD'] }); } },
    { name: 'zero equipped cards', corrupt: (value) => { value.payload.player.cards = []; } },
    { name: 'multiple equipped cards', corrupt: (value) => { value.payload.player.cards = ['CARD_COMMON', 'CARD_RARE']; } },
    { name: 'duplicate equipped card', corrupt: (value) => { value.payload.player.cards.push(value.payload.player.cards[0]!); } },
    { name: 'unknown injury', corrupt: (value) => { Object.assign(value.payload.player, { injuries: ['NO_INJURY'] }); } },
    { name: 'nonfinite attribute', corrupt: (value) => { Object.assign(value.payload.player.attributes, { wealth: Number.NaN }); } },
    { name: 'out-of-range attribute', corrupt: (value) => { Object.assign(value.payload.player.attributes, { wealth: 11 }); } },
  ];

  it.each(invalid)('rejects $name atomically with SAVE_INVALID', async ({ corrupt }) => {
    const { engine } = await quietLife();
    const before = engine.exportSave();
    const invalidSave = structuredClone(before);
    corrupt(invalidSave);
    expect(() => engine.restoreSave(invalidSave)).toThrowError(expect.objectContaining({ code: 'SAVE_INVALID' }));
    expect(engine.exportSave()).toEqual(before);
  });

  it.each([
    ['content_id', 'another-bundle'],
    ['content_version', '99.0.0'],
    ['content_fingerprint', 'f'.repeat(64)],
  ])('rejects a mismatched %s without replacing the current run', async (field, value) => {
    const { engine } = await quietLife();
    const before = engine.exportSave();
    const invalidSave = structuredClone(before);
    Object.assign(invalidSave, { [field]: value });
    expect(() => engine.restoreSave(invalidSave)).toThrowError(expect.objectContaining({ code: 'CONTENT_MISMATCH' }));
    expect(engine.exportSave()).toEqual(before);
  });
});

describe('SaveCodec through GachaEngine.restoreSave', () => {
  const poolState = (value: GachaSave) => value.payload.pools.POOL_PITY;
  const invalid: Array<{ name: string; corrupt: (value: GachaSave) => void }> = [
    { name: 'unknown save version', corrupt: (value) => { Object.assign(value, { save_version: 2 }); } },
    { name: 'wrong kind', corrupt: (value) => { Object.assign(value, { kind: 'life' }); } },
    { name: 'unknown envelope field', corrupt: (value) => { Object.assign(value, { unexpected: true }); } },
    { name: 'unsafe revision', corrupt: (value) => { Object.assign(value, { revision: Number.MAX_SAFE_INTEGER + 1 }); } },
    { name: 'out-of-range seed', corrupt: (value) => { Object.assign(value.payload, { seed: 0x100000000 }); } },
    { name: 'unknown pool reference', corrupt: (value) => { Object.assign(value.payload.pools, { NO_POOL: poolState(value) }); } },
    { name: 'unknown PRNG algorithm', corrupt: (value) => { Object.assign(poolState(value).rng, { algorithm: 'future-rng' }); } },
    { name: 'negative PRNG state', corrupt: (value) => { Object.assign(poolState(value).rng, { state: -1 }); } },
    { name: 'unsafe PRNG cursor', corrupt: (value) => { Object.assign(poolState(value).rng, { draws: Number.MAX_SAFE_INTEGER + 1 }); } },
    { name: 'negative misses', corrupt: (value) => { Object.assign(poolState(value), { misses: -1 }); } },
    { name: 'misses beyond hard pity', corrupt: (value) => { Object.assign(poolState(value), { misses: 10 }); } },
    { name: 'negative total draws', corrupt: (value) => { Object.assign(poolState(value), { total_draws: -1 }); } },
    { name: 'fractional total draws', corrupt: (value) => { Object.assign(poolState(value), { total_draws: 0.5 }); } },
    { name: 'unknown receipt card', corrupt: (value) => { Object.assign(value.payload.processed_commands.first.result.items[0], { card_id: 'NO_CARD' }); } },
    { name: 'unknown receipt pool', corrupt: (value) => { Object.assign(value.payload.processed_commands.first.parameters, { poolId: 'NO_POOL' }); } },
    { name: 'impossible receipt probability', corrupt: (value) => { Object.assign(value.payload.processed_commands.first.result.items[0], { conditional_probability: 2 }); } },
  ];

  it.each(invalid)('rejects $name atomically with SAVE_INVALID', async ({ corrupt }) => {
    const bundle = await loadTemplate();
    const engine = new GachaEngine(bundle, sha256(bundle), 1640);
    engine.draw('first', 'POOL_PITY', 3);
    const before = engine.exportSave();
    const invalidSave = structuredClone(before);
    corrupt(invalidSave);
    expect(() => engine.restoreSave(invalidSave)).toThrowError(expect.objectContaining({ code: 'SAVE_INVALID' }));
    expect(engine.exportSave()).toEqual(before);
  });

  it.each([
    ['content_id', 'another-bundle'],
    ['content_version', '99.0.0'],
    ['content_fingerprint', 'f'.repeat(64)],
  ])('rejects a mismatched %s without clearing pools or receipts', async (field, value) => {
    const bundle = await loadTemplate();
    const engine = new GachaEngine(bundle, sha256(bundle), 1640);
    engine.draw('first', 'POOL_PITY', 3);
    const before = engine.exportSave();
    const invalidSave = structuredClone(before);
    Object.assign(invalidSave, { [field]: value });
    expect(() => engine.restoreSave(invalidSave)).toThrowError(expect.objectContaining({ code: 'CONTENT_MISMATCH' }));
    expect(engine.exportSave()).toEqual(before);
  });
});
