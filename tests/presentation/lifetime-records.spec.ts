import { describe, expect, it } from 'vitest';
import { LifetimeRecords } from '../../assets/scripts/presentation/LifetimeRecords';
import type { EndingReport } from '../../assets/scripts/core/types/schema';

const ending = { end_age: 75, years_played: 43, achievements: ['first'], primary_achievement_id: 'elder' } as EndingReport;

describe('completed lifetime records', () => {
  it('persists completed lives and counts a revisited report only once', () => {
    let value: string | null = null;
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    const records = new LifetimeRecords(storage);
    records.record('life-1', ending);
    records.record('life-1', ending);
    const restored = new LifetimeRecords(storage);
    restored.record('life-2', { ...ending, end_age: 40, years_played: 10 });
    expect(restored.snapshot()).toEqual({ completed: 2, longest: 75, years: 53, achievements: new Set(['first', 'elder']), warning: '' });
  });

  it('does not overwrite unreadable history and reports its persistence boundary', () => {
    let value = '{broken';
    const records = new LifetimeRecords({ getItem: () => value, setItem: (_key, next) => { value = next; } });
    records.record('life-1', ending);
    expect(value).toBe('{broken');
    expect(records.snapshot().completed).toBe(1);
    expect(records.snapshot().warning).toContain('原记录未覆盖');
  });

  it('keeps completed results visible when storage quota is exhausted', () => {
    const records = new LifetimeRecords({ getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } });
    records.record('life-1', ending);
    expect(records.snapshot().completed).toBe(1);
    expect(records.snapshot().warning).toContain('仅在当前页面保留');
  });
});
