import type { SessionSave } from './GameSession';
import { sha256Json } from '../core/persistence/JsonDigest';
import { compressLife, decompressLife, MAX_LIFE_JSON_BYTES } from './LifeCompression';

export interface LifeStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SLOTS = ['time-travel.current-life.a.v1', 'time-travel.current-life.b.v1'] as const;
const FORMAT = 2;

type LegacyLife = { format: 1; generation: number; life_id: string; session: SessionSave; checksum: string };
type CompressedLife = { format: 2; generation: number; life_id: string; encoding: 'dedupe-deflate-base64'; decoded_bytes: number; data: string; checksum: string };
type StoredLife = LegacyLife | CompressedLife;
type Candidate = { slot: number; value: StoredLife };
export type LifeRead =
  | { status: 'ready'; save: SessionSave; lifeId: string; recovered: boolean }
  | { status: 'empty' | 'damaged' | 'incompatible' | 'unavailable' };

const failure = (message: string): Error => Object.assign(new Error(message), { code: 'SAVE_FAILED' });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Two independently written platform keys; the last validated slot is never the next write target. */
export class CurrentLifeStore {
  private active: number | null = null;
  private generation = 0;
  private state: LifeRead['status'] = 'unavailable';

  constructor(private readonly storage: LifeStoragePort) {}

  read(validate: (save: SessionSave) => void): LifeRead {
    const candidates: Candidate[] = [];
    let occupied = false;
    let damaged = false;
    let incompatibleGeneration = -1;
    let incompatibleSlot: number | null = null;
    let highest = 0;
    try {
      for (let slot = 0; slot < SLOTS.length; slot++) {
        const raw = this.storage.getItem(SLOTS[slot]);
        if (raw === null) continue;
        occupied = true;
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { damaged = true; continue; }
        if (!object(parsed)) { damaged = true; continue; }
        if (typeof parsed.format === 'number' && parsed.format !== 1 && parsed.format !== FORMAT) {
          const generation = Number.isSafeInteger(parsed.generation) && Number(parsed.generation) > 0 ? Number(parsed.generation) : Number.MAX_SAFE_INTEGER;
          if (generation > incompatibleGeneration) { incompatibleGeneration = generation; incompatibleSlot = slot; }
          highest = Math.max(highest, generation === Number.MAX_SAFE_INTEGER ? 0 : generation);
          continue;
        }
        if (!Number.isSafeInteger(parsed.generation) || Number(parsed.generation) < 1 ||
            typeof parsed.life_id !== 'string' || !parsed.life_id || typeof parsed.checksum !== 'string' ||
            !((parsed.format === 1 && Object.keys(parsed).length === 5 && object(parsed.session)) ||
              (parsed.format === FORMAT && Object.keys(parsed).length === 7 && parsed.encoding === 'dedupe-deflate-base64' &&
                typeof parsed.data === 'string' && typeof parsed.decoded_bytes === 'number' &&
                Number.isSafeInteger(parsed.decoded_bytes) && parsed.decoded_bytes > 0 && parsed.decoded_bytes <= MAX_LIFE_JSON_BYTES))) {
          damaged = true; continue;
        }
        const value = parsed as unknown as StoredLife;
        const { checksum, ...body } = value;
        if (checksum !== sha256Json(body)) { damaged = true; continue; }
        highest = Math.max(highest, value.generation);
        candidates.push({ slot, value });
      }
    } catch {
      this.state = 'unavailable';
      return { status: 'unavailable' };
    }
    candidates.sort((a, b) => b.value.generation - a.value.generation);
    let selected: (Candidate & { session: SessionSave }) | null = null;
    for (const candidate of candidates) {
      try {
        const session = candidate.value.format === 1 ? candidate.value.session :
          decompressLife(candidate.value.data, candidate.value.decoded_bytes);
        if (!object(session)) throw new Error('Decoded life is not an object');
        validate(session as unknown as SessionSave);
        selected = { ...candidate, session: session as unknown as SessionSave };
        break;
      } catch (error) {
        if (object(error) && ['CONTENT_MISMATCH', 'RULES_MISMATCH', 'SAVE_VERSION_MISMATCH'].includes(String(error.code))) {
          incompatibleGeneration = Math.max(incompatibleGeneration, candidate.value.generation);
          incompatibleSlot = candidate.slot;
          break;
        }
        damaged = true;
      }
    }
    this.generation = highest;
    if (incompatibleGeneration >= (selected?.value.generation ?? 0)) {
      this.active = incompatibleSlot;
      this.state = 'incompatible';
      return { status: 'incompatible' };
    }
    if (selected) {
      this.active = selected.slot;
      this.state = 'ready';
      return { status: 'ready', save: selected.session, lifeId: selected.value.life_id, recovered: damaged || selected.value.generation < highest };
    }
    this.active = null;
    this.state = occupied ? 'damaged' : 'empty';
    return { status: this.state };
  }

  write(session: SessionSave, lifeId: string, overwriteAcknowledged = false): void {
    if (this.state === 'unavailable') throw failure('Current-life storage is unavailable');
    if ((this.state === 'damaged' || this.state === 'incompatible') && !overwriteAcknowledged) throw failure('Existing save requires explicit overwrite consent');
    if (this.generation >= Number.MAX_SAFE_INTEGER) throw failure('Save generation exhausted');
    const slot = this.active === null ? 0 : 1 - this.active;
    const generation = this.generation + 1;
    try {
      const body = { format: FORMAT, generation, life_id: lifeId, encoding: 'dedupe-deflate-base64', ...compressLife(session) };
      const raw = JSON.stringify({ ...body, checksum: sha256Json(body) });
      this.storage.setItem(SLOTS[slot], raw);
      if (this.storage.getItem(SLOTS[slot]) !== raw) throw failure('Save readback differs');
    } catch (cause) {
      throw Object.assign(failure('Could not confirm current-life save'), { cause });
    }
    this.active = slot;
    this.generation = generation;
    this.state = 'ready';
  }
}
