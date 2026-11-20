import type { ContentBundle } from '../core/types/content.generated';
import { ACHIEVEMENT_CATALOG, DEATH_CATALOG, type CatalogEntry } from './CollectionCatalog';
import type { LifetimeRecordsSnapshot } from './LifetimeRecords';

/** Compatibility lookup for confirmed unavailable IDs; unverified IDs are not historical. */
function unavailableIds(catalog: Readonly<Record<string, CatalogEntry>>): Readonly<Record<string, true>> {
  const unavailable: Record<string, true> = Object.create(null);
  for (const [id, entry] of Object.entries(catalog)) {
    if (entry.status === 'unavailable') unavailable[id] = true;
  }
  return unavailable;
}

export const HISTORICAL_COLLECTION: { achievements: Readonly<Record<string, true>>; deaths: Readonly<Record<string, true>> } = {
  achievements: unavailableIds(ACHIEVEMENT_CATALOG),
  deaths: unavailableIds(DEATH_CATALOG),
};

function countCurrent(items: readonly { id: string }[], catalog: Readonly<Record<string, CatalogEntry>>, collectedIds: ReadonlySet<string>) {
  let collected = 0;
  let total = 0;
  for (const item of items) {
    if (catalog[item.id]?.status !== 'current') continue;
    total++;
    if (collectedIds.has(item.id)) collected++;
  }
  return { collected, total };
}

export interface CollectionProgress {
  achievements: { collected: number; total: number; percent: number };
  deaths: { collected: number; total: number; percent: number };
  total: { collected: number; total: number; percent: number };
}

/** Count only confirmed current IDs present in the content bundle, not historical records. */
export function collectionProgress(bundle: ContentBundle, records: LifetimeRecordsSnapshot): CollectionProgress {
  const achievements = countCurrent(bundle.achievements, ACHIEVEMENT_CATALOG, records.achievements);
  const deaths = countCurrent(bundle.deaths, DEATH_CATALOG, records.deaths);
  const total = { collected: achievements.collected + deaths.collected, total: achievements.total + deaths.total };
  const percent = (collected: number, count: number) => count === 0 ? 0 : Math.floor(collected * 1000 / count) / 10;
  return {
    achievements: { ...achievements, percent: percent(achievements.collected, achievements.total) },
    deaths: { ...deaths, percent: percent(deaths.collected, deaths.total) },
    total: { ...total, percent: percent(total.collected, total.total) },
  };
}

/** Use the same wording on the home screen, ending and collection. */
export function formatCollectionProgress(label: string, progress: CollectionProgress['total']): string {
  return progress.total === 0 ? `${label} 暂无可收集条目`
    : `${label} ${progress.collected}/${progress.total} · ${progress.percent.toFixed(1)}%`;
}
