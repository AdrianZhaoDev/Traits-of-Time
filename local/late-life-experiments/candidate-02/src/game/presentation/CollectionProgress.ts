import type { ContentBundle } from '../core/types/content.generated';
import type { LifetimeRecordsSnapshot } from './LifetimeRecords';

export interface CollectionProgress {
  achievements: { collected: number; total: number; percent: number };
  deaths: { collected: number; total: number; percent: number };
  total: { collected: number; total: number; percent: number };
}

/** Count only IDs present in the current catalog; historic unknown IDs remain in records. */
export function collectionProgress(bundle: ContentBundle, records: LifetimeRecordsSnapshot): CollectionProgress {
  const achievements = {
    collected: bundle.achievements.filter(item => records.achievements.has(item.id)).length,
    total: bundle.achievements.length,
  };
  const deaths = {
    collected: bundle.deaths.filter(item => records.deaths.has(item.id)).length,
    total: bundle.deaths.length,
  };
  const total = { collected: achievements.collected + deaths.collected, total: achievements.total + deaths.total };
  const percent = (collected: number, count: number) => count === 0 ? 0 : Math.floor(collected * 1000 / count) / 10;
  return {
    achievements: { ...achievements, percent: percent(achievements.collected, achievements.total) },
    deaths: { ...deaths, percent: percent(deaths.collected, deaths.total) },
    total: { ...total, percent: percent(total.collected, total.total) },
  };
}
