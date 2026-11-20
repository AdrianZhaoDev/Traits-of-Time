import type { EndingReport } from '../core/types/schema';

export interface LifetimeRecord {
  id: string;
  age: number;
  years: number;
  achievements: string[];
  death_id: string | null;
}
export interface RecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface LifetimeRecordsSnapshot {
  completed: number;
  longest: number;
  years: number;
  achievements: Set<string>;
  deaths: Set<string>;
  unknownDeaths: number;
  inheritanceAvailable: boolean;
  inheritancePending: boolean;
  warning: string;
}
const LEGACY_KEY = 'time-travel.lifetime-records.v1';
const KEY = 'time-travel.lifetime-records.v2';

interface InheritanceClaim {
  rewardId: string;
  lifeId: string;
  state: 'pending' | 'consumed';
}

const failure = (message: string): Error => Object.assign(new Error(message), { code: 'SAVE_FAILED' });

function isInheritanceClaim(value: unknown): value is InheritanceClaim {
  return isObject(value) && Object.keys(value).length === 3
    && typeof value.rewardId === 'string' && value.rewardId.length > 0
    && typeof value.lifeId === 'string' && value.lifeId.length > 0
    && (value.state === 'pending' || value.state === 'consumed');
}

interface LegacyRecord {
  id: string;
  age: number;
  years: number;
  achievements: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLegacyRecord(value: unknown): value is LegacyRecord {
  if (!isObject(value)) return false;
  return typeof value.id === 'string' && typeof value.age === 'number' && Number.isInteger(value.age) && value.age >= 0
    && typeof value.years === 'number' && Number.isInteger(value.years) && value.years >= 0
    && Array.isArray(value.achievements) && value.achievements.every(id => typeof id === 'string');
}

function isLifetimeRecord(value: unknown): value is LifetimeRecord {
  if (!isObject(value) || Object.keys(value).length !== 5
    || !['id', 'age', 'years', 'achievements', 'death_id'].every(key => Object.hasOwn(value, key))) return false;
  return isLegacyRecord(value) && (value.death_id === null || (typeof value.death_id === 'string' && value.death_id.length > 0));
}

/** Only completed lives count; revisiting a report cannot award another completion. */
export class LifetimeRecords {
  private records: LifetimeRecord[] = [];
  private inheritanceRewardId: string | null = null;
  private inheritanceClaim: InheritanceClaim | null = null;
  private readable = true;
  private writable = true;

  constructor(private readonly storage: RecordStorage) {
    try { this.reload(); } catch { /* The caller sees the warning and must retry before writing. */ }
  }

  /** The pending target is only usable after a successful records read. */
  get pendingInheritanceLifeId(): string | null {
    return this.readable && this.inheritanceClaim?.state === 'pending' ? this.inheritanceClaim.lifeId : null;
  }

  /** Discard uncertain in-memory changes and reread the authoritative record key. */
  reload(): void {
    try {
      const raw = this.storage.getItem(KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (!isObject(parsed) || !Array.isArray(parsed.records) || !parsed.records.every(isLifetimeRecord)) {
          throw new Error('Invalid lifetime records');
        }
        const ids = new Set(parsed.records.map(row => row.id));
        if (ids.size !== parsed.records.length) throw new Error('Duplicate lifetime records');
        let rewardId: string | null;
        let claim: InheritanceClaim | null;
        if (parsed.version === 2 && Object.keys(parsed).length === 3
          && typeof parsed.inheritanceAvailable === 'boolean') {
          rewardId = parsed.inheritanceAvailable
            ? parsed.records.length ? `life:${parsed.records[parsed.records.length - 1].id}` : 'legacy:v2'
            : null;
          claim = null;
        } else if (parsed.version === 3 && Object.keys(parsed).length === 4
          && (parsed.inheritanceRewardId === null || (typeof parsed.inheritanceRewardId === 'string' && parsed.inheritanceRewardId.length > 0))
          && (parsed.inheritanceClaim === null || isInheritanceClaim(parsed.inheritanceClaim))) {
          rewardId = parsed.inheritanceRewardId as string | null;
          claim = parsed.inheritanceClaim as InheritanceClaim | null;
          if (claim && ((claim.state === 'pending' && claim.rewardId !== rewardId)
            || (claim.state === 'consumed' && claim.rewardId === rewardId))) throw new Error('Invalid inheritance claim');
        } else throw new Error('Invalid lifetime records');
        this.records = parsed.records;
        this.inheritanceRewardId = rewardId;
        this.inheritanceClaim = claim;
      } else {
        const legacyRaw = this.storage.getItem(LEGACY_KEY);
        const rows: LifetimeRecord[] = [];
        if (legacyRaw !== null) {
          const legacy: unknown = JSON.parse(legacyRaw);
          if (!Array.isArray(legacy) || !legacy.every(isLegacyRecord)) throw new Error('Invalid lifetime records');
          const ids = new Set<string>();
          for (const row of legacy) {
            if (ids.has(row.id)) continue;
            ids.add(row.id);
            rows.push({ id: row.id, age: row.age, years: row.years,
              achievements: [...new Set(row.achievements)], death_id: null });
          }
        }
        this.records = rows;
        this.inheritanceRewardId = rows.length ? `life:${rows[rows.length - 1].id}` : null;
        this.inheritanceClaim = null;
      }
      this.readable = true;
      this.writable = true;
    } catch (cause) {
      this.readable = false;
      throw Object.assign(failure('Could not read lifetime records'), { cause });
    }
  }

  record(id: string, report: EndingReport): void {
    this.assertWritable();
    if (this.inheritanceClaim?.state === 'pending') throw failure('Inheritance claim must be reconciled before recording a life');
    if (this.records.some(row => row.id === id)) return;
    this.records.push({ id, age: report.end_age, years: report.years_played, achievements: [...new Set([
      ...report.achievements, report.primary_achievement_id,
    ].filter((value): value is string => typeof value === 'string'))], death_id: report.death_id });
    this.inheritanceRewardId = `life:${id}`;
    this.persist();
  }

  /** Reserve one durable reward before writing the new current life. */
  reserveInheritance(lifeId: string): void {
    this.assertWritable();
    if (typeof lifeId !== 'string' || !lifeId) throw failure('A claim requires a current-life ID');
    if (this.inheritanceClaim?.lifeId === lifeId) return;
    if (this.inheritanceClaim?.state === 'pending') throw failure('Another inheritance claim is pending');
    if (this.inheritanceRewardId === null) throw failure('No inheritance reward is available');
    this.inheritanceClaim = { rewardId: this.inheritanceRewardId, lifeId, state: 'pending' };
    this.persist();
  }

  /** Commit a matching saved life, or release only when its absence is certain. */
  reconcileInheritance(currentLifeId: string | null, definitelyAbsent: boolean): void {
    this.assertWritable();
    const claim = this.inheritanceClaim;
    if (!claim || claim.state !== 'pending') return;
    if (currentLifeId === claim.lifeId) {
      this.inheritanceRewardId = null;
      this.inheritanceClaim = { ...claim, state: 'consumed' };
    } else if (definitelyAbsent) {
      this.inheritanceClaim = null;
    } else throw Object.assign(failure('Cannot determine whether the inheritance life was saved'), { reason: 'INHERITANCE_UNCERTAIN' });
    this.persist();
  }

  /** Irrevocably forfeit an unresolved reward after the player explicitly confirms. */
  forfeitPendingInheritance(): boolean {
    this.assertWritable();
    const claim = this.inheritanceClaim;
    if (!claim || claim.state !== 'pending') return false;
    this.inheritanceRewardId = null;
    this.inheritanceClaim = { ...claim, state: 'consumed' };
    this.persist();
    return true;
  }

  private assertWritable(): void {
    if (!this.readable || !this.writable) throw failure('Lifetime records must be reread before continuing');
  }

  private persist(): void {
    const raw = JSON.stringify({ version: 3, records: this.records,
      inheritanceRewardId: this.inheritanceRewardId, inheritanceClaim: this.inheritanceClaim });
    try {
      this.storage.setItem(KEY, raw);
      if (this.storage.getItem(KEY) !== raw) throw new Error('Lifetime records readback differs');
      this.writable = true;
    } catch (cause) {
      this.writable = false;
      throw Object.assign(failure('Could not confirm lifetime records'), { cause });
    }
  }

  snapshot(): LifetimeRecordsSnapshot {
    return {
      completed: this.records.length,
      longest: this.records.reduce((max, row) => Math.max(max, row.age), 0),
      years: this.records.reduce((total, row) => total + row.years, 0),
      achievements: new Set(this.records.flatMap(row => row.achievements)),
      deaths: new Set(this.records.flatMap(row => row.death_id === null ? [] : [row.death_id])),
      unknownDeaths: this.records.filter(row => row.death_id === null).length,
      inheritanceAvailable: this.readable && this.writable && this.inheritanceRewardId !== null && this.inheritanceClaim?.state !== 'pending',
      inheritancePending: this.readable && this.inheritanceClaim?.state === 'pending',
      warning: !this.readable ? '本机记录与传承读取失败，原数据未覆盖；请检查后重试。'
        : !this.writable ? '本机记录与传承写入无法确认；请检查后重新读取。' : '',
    };
  }
}
