import type { EndingReport } from '../core/types/schema';

export interface LifetimeRecord {
  id: string;
  age: number;
  years: number;
  achievements: string[];
}
export interface RecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = 'time-travel.lifetime-records.v1';

/** Only completed lives count; revisiting a report cannot award another completion. */
export class LifetimeRecords {
  private records: LifetimeRecord[] = [];
  private readable = true;
  private writable = true;

  constructor(private readonly storage: RecordStorage) {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((row: unknown) => {
        if (!row || typeof row !== 'object') return false;
        const r = row as Partial<LifetimeRecord>;
        return typeof r.id === 'string' && Number.isInteger(r.age) && Number.isInteger(r.years)
          && r.age! >= 0 && r.years! >= 0 && Array.isArray(r.achievements)
          && r.achievements.every(id => typeof id === 'string');
      })) throw new Error('Invalid lifetime records');
      this.records = parsed;
    } catch {
      this.readable = false;
    }
  }

  record(id: string, report: EndingReport): void {
    if (this.records.some(row => row.id === id)) return;
    this.records.push({ id, age: report.end_age, years: report.years_played, achievements: [...new Set([
      ...report.achievements, report.primary_achievement_id,
    ].filter((value): value is string => typeof value === 'string'))] });
    if (!this.readable) return;
    try {
      this.storage.setItem(KEY, JSON.stringify(this.records));
      this.writable = true;
    } catch {
      this.writable = false;
    }
  }

  snapshot(): { completed: number; longest: number; years: number; achievements: Set<string>; warning: string } {
    return {
      completed: this.records.length,
      longest: this.records.reduce((max, row) => Math.max(max, row.age), 0),
      years: this.records.reduce((total, row) => total + row.years, 0),
      achievements: new Set(this.records.flatMap(row => row.achievements)),
      warning: !this.readable ? '本机历史记录读取失败，原记录未覆盖；本次新增记录仅在当前页面保留。'
        : !this.writable ? '本机存储不可用，新增记录仅在当前页面保留。' : '',
    };
  }
}
