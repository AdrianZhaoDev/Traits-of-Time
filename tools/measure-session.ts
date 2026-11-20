import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { loadContent } from './content-io.mjs';
import { chooseOption } from './simulate';
import { GameSession } from '../src/game/application/GameSession';
import { CurrentLifeStore, type LifeStoragePort } from '../src/game/application/CurrentLifeStore';
import { compressLife, decompressLife } from '../src/game/application/LifeCompression';
import { GameEngine } from '../src/game/core/engine/GameEngine';
import { Mulberry32, uniformInt } from '../src/game/core/engine/RandomSource';
import { sha256Json } from '../src/game/core/persistence/JsonDigest';
import type { ContentBundle } from '../src/game/core/types/content.generated';
import type { CommandResult } from '../src/game/core/types/commands';

const seed = Number(process.argv[2] ?? 27);
const output = resolve(process.argv[3] ?? `local/simulation/session-${seed}.json`);
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Expected a uint32 seed');
const content = await loadContent() as ContentBundle;
const fingerprint = sha256Json(content);
const ports = { hash: sha256Json, persist: async () => {}, load: async () => null };
const session = new GameSession(new GameEngine(content, fingerprint), ports);
const random = new Mulberry32((seed ^ 0xa511e9b3) >>> 0);
const snapshots: Record<string, unknown>[] = [];
const seen = new Set<string>();
function ok(result: CommandResult) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

// These are conservative in-memory quota models, not measurements of a real wx host or browser.
// The 1 MB/key figure comes from Tencent Cloud's mini-program API as a conservative
// proxy; its mini-game guide states 10 MB total. MDN describes about 5 MiB localStorage
// per origin. Actual WeChat and browser accounting and availability can differ.
// https://intl.cloud.tencent.com/zh/document/product/1219/57698
// https://www-sg.tencentcloud.com/zh/document/product/1219/68068
// https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
class QuotaStorage implements LifeStoragePort {
  readonly values = new Map<string, string>();
  constructor(private readonly totalLimit = Infinity, private readonly keyLimit = Infinity,
    private readonly encoding: 'utf8' | 'utf16le' = 'utf8') {}
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    const bytes = (text: string) => Buffer.byteLength(text, this.encoding);
    if (bytes(value) > this.keyLimit) throw new Error('Simulated per-key quota exceeded');
    let total = bytes(key) + bytes(value);
    for (const [existingKey, existingValue] of this.values) {
      if (existingKey !== key) total += bytes(existingKey) + bytes(existingValue);
    }
    if (total > this.totalLimit) throw new Error('Simulated total quota exceeded');
    this.values.set(key, value);
  }
}
function fitsModel(values: Map<string, string>, total: number, perKey: number, encoding: 'utf8' | 'utf16le') {
  const model = new QuotaStorage(total, perKey, encoding);
  try {
    for (const [key, value] of values) model.setItem(key, value);
    return new CurrentLifeStore(model).read(() => {}).status === 'ready';
  }
  catch { return false; }
}
let quotaFailed = false;
function measure(label: string) {
  if (seen.has(label)) return;
  seen.add(label);
  const started = performance.now();
  const save = session.exportSave();
  const exported = performance.now();
  const json = JSON.stringify(save);
  const serialized = performance.now();
  const parsed = JSON.parse(json);
  const parsedAt = performance.now();
  const restored = new GameSession(new GameEngine(content, fingerprint), ports);
  restored.restoreSave(parsed);
  const finished = performance.now();
  const compressed = gzipSync(Buffer.from(json, 'utf8'), { level: 6 });
  const compressedAt = performance.now();
  const codec = compressLife(save);
  const encodedAt = performance.now();
  decompressLife(codec.data, codec.decoded_bytes);
  const decodedAt = performance.now();
  const storage = new QuotaStorage();
  const store = new CurrentLifeStore(storage);
  if (store.read(() => {}).status !== 'empty') throw new Error('Expected empty measurement storage');
  const writeStarted = performance.now();
  store.write(save, 'measure-life');
  const firstWriteAt = performance.now();
  store.write(save, 'measure-life');
  const secondWriteAt = performance.now();
  const read = new CurrentLifeStore(storage).read(() => {});
  const readAt = performance.now();
  if (read.status !== 'ready' || sha256Json(read.save) !== sha256Json(save)) throw new Error('Measurement save did not round-trip');
  const validatedStart = performance.now();
  const validated = new CurrentLifeStore(storage).read(value => {
    new GameSession(new GameEngine(content, fingerprint), ports).restoreSave(value);
  });
  const validatedAt = performance.now();
  if (validated.status !== 'ready') throw new Error(`Strict restore failed: ${validated.status}`);
  const entries = [...storage.values];
  const slots = entries.map(([key, value]) => ({ key, value_utf8_bytes: Buffer.byteLength(value, 'utf8'),
    value_utf16_bytes: Buffer.byteLength(value, 'utf16le') }));
  const totalBytes = (encoding: 'utf8' | 'utf16le') => entries.reduce((sum, [key, value]) =>
    sum + Buffer.byteLength(key, encoding) + Buffer.byteLength(value, encoding), 0);
  const quotaModels = {
    wechat_utf8_1mib_per_key_10mib_total: fitsModel(storage.values, 10 * 1024 * 1024, 1024 * 1024, 'utf8'),
    wechat_utf16_1mib_per_key_10mib_total: fitsModel(storage.values, 10 * 1024 * 1024, 1024 * 1024, 'utf16le'),
    web_utf16_5mib_total: fitsModel(storage.values, 5 * 1024 * 1024, Infinity, 'utf16le'),
  };
  if (Object.values(quotaModels).some(value => !value)) quotaFailed = true;
  const player = save.engine.payload.player;
  const row = { label, years_elapsed: player.calendar_year - player.start_year, age: player.age, status: save.engine.payload.run.status,
    json_utf8_bytes: Buffer.byteLength(json), json_utf16_bytes: Buffer.byteLength(json, 'utf16le'),
    double_slot_json_utf8_bytes: Buffer.byteLength(json) * 2,
    gzip_bytes: compressed.length, gzip_base64_chars: Math.ceil(compressed.length / 3) * 4,
    double_slot_gzip_base64_chars: Math.ceil(compressed.length / 3) * 8,
    slots, two_slot_utf8_bytes_including_keys: totalBytes('utf8'), two_slot_utf16_bytes_including_keys: totalBytes('utf16le'), quotaModels,
    replay_commands: save.replay_commands.length, export_ms: exported - started, stringify_ms: serialized - exported,
    parse_ms: parsedAt - serialized, restore_ms: finished - parsedAt, gzip_ms: compressedAt - finished,
    codec_encode_ms: encodedAt - compressedAt, codec_decode_ms: decodedAt - encodedAt,
    first_slot_write_ms: firstWriteAt - writeStarted, second_slot_write_ms: secondWriteAt - firstWriteAt,
    store_read_without_validation_ms: readAt - secondWriteAt, store_read_with_strict_restore_ms: validatedAt - validatedStart };
  snapshots.push(row);
  console.log(JSON.stringify(row));
}

const initialized = ok(await session.initialize(seed));
if (initialized.pending?.kind !== 'card') throw new Error('Missing opening offer');
ok(await session.command({ type: 'selectCard', cardId: initialized.pending.cards[0]! }));
let commands = 0;
for (;;) {
  const { state, pending } = session.current();
  const elapsed = state.player.calendar_year - state.player.start_year;
  if (state.status === 'READY' && elapsed >= 9) measure('year-10');
  if (state.status === 'READY' && elapsed >= 39) measure('year-40');
  if (state.status === 'READY' && state.player.age >= state.player.max_lifespan - 1) measure('before-old-age');
  if (state.status === 'ENDED') { measure('ended'); break; }
  if (++commands > 1000) throw new Error('Life did not end within 1000 commands');
  if (pending?.kind === 'option') {
    const definition = content.events.find(event => event.id === pending.event_id);
    if (!definition) throw new Error(`Unknown event ${pending.event_id}`);
    const option = chooseOption(pending, definition, 'normal', length => uniformInt(0, length - 1, random));
    ok(await session.command({ type: 'choose', optionId: option.id }));
  } else if (pending?.kind === 'stage') ok(await session.command({ type: 'stage' }));
  else if (pending === null && state.status === 'READY') ok(await session.command({ type: 'next' }));
  else throw new Error(`Unexpected state ${state.status}/${pending?.kind ?? 'none'}`);
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ seed, fingerprint, snapshots, note: 'In-memory quota models only, no real device, browser, platform overhead or other saved keys; slots include complete envelopes and totals include keys.' }, null, 2)}\n`);
if (quotaFailed) process.exitCode = 1;
