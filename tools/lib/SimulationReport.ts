import type { ContentBundle, Pool } from '../../assets/scripts/core/types/content.generated.js';
import type { EndingReport, GameSave } from '../../assets/scripts/core/types/schema.js';
import type { DrawResult } from '../../assets/scripts/core/engine/GachaEngine.js';

const counts = (): Record<string, number> => Object.create(null) as Record<string, number>;
const increment = (values: Record<string, number>, key: string): void => { values[key] = (values[key] ?? 0) + 1; };
function quantiles(values: number[]): { p50: number; p90: number } {
  values.sort((a, b) => a - b);
  return { p50: values[Math.ceil(values.length * 0.5) - 1]!, p90: values[Math.ceil(values.length * 0.9) - 1]! };
}
interface Stratum {
  age_band_id: string; path_category: string; samples: number;
  ages: number[]; years: number[]; inputs: number[]; early: number;
  death_counts: Record<string, number>; ending_counts: Record<string, number>;
  chain_started: number; chain_completed: number; chain_interrupted: number;
}
/** Retains numeric quantile samples, never engines, saves, command receipts or logs. */
export class LifeStatistics {
  private readonly strata = new Map<string, Stratum>();
  private readonly retirable: Set<string>;
  constructor(private readonly content: ContentBundle) {
    this.retirable = new Set(content.achievements.filter(item => item.retirable).map(item => item.id));
  }
  add(report: EndingReport, save: GameSave, blockingInputs: number): { age_band_id: string; path_category: string } {
    const age_band_id = this.content.rules.age_bands.find(band => report.start_age >= band.min && report.start_age <= band.max)!.id;
    const path_category = report.end_reason === 'death' && report.years_played === 0 ? 'opening_death'
      : report.achievements.some(id => this.retirable.has(id)) || blockingInputs >= 30 ? 'long_or_major'
      : blockingInputs <= 9 ? 'short' : 'regular';
    const key = JSON.stringify([age_band_id, path_category]);
    let group = this.strata.get(key);
    if (!group) {
      group = { age_band_id, path_category, samples: 0, ages: [], years: [], inputs: [], early: 0,
        death_counts: counts(), ending_counts: counts(), chain_started: 0, chain_completed: 0, chain_interrupted: 0 };
      this.strata.set(key, group);
    }
    group.samples++;
    group.ages.push(report.end_age); group.years.push(report.years_played); group.inputs.push(blockingInputs);
    if (report.end_reason === 'death') {
      if (report.years_played <= 3) group.early++;
      if (report.death_id !== null) increment(group.death_counts, report.death_id);
    }
    increment(group.ending_counts, report.primary_achievement_id ?? '普通人生');
    for (const log of save.payload.logs) if (log.type === 'chain') {
      if (log.data.action === 'started') group.chain_started++;
      else if (log.data.action === 'completed') group.chain_completed++;
      else if (log.data.action === 'interrupted') group.chain_interrupted++;
    }
    return { age_band_id, path_category };
  }
  summary() {
    return { strata: [...this.strata.values()].map(({ ages, years, inputs, early, ...group }) => ({
      ...group, final_age: quantiles(ages), years_played: quantiles(years), blocking_inputs: quantiles(inputs),
      early_death_rate: early / group.samples,
      chain_completion_rate: group.chain_started === 0 ? null : group.chain_completed / group.chain_started,
    })) };
  }
}

export class DrawStatistics {
  private total = 0;
  private forced = 0;
  private longest = 0;
  private readonly cards = counts();
  private readonly rarities = counts();
  private readonly base = counts();
  constructor(content: ContentBundle, pool: Pool) {
    const totalWeight = pool.entries.reduce((sum, entry) => sum + entry.weight, 0);
    const cardById = new Map(content.cards.map(card => [card.id, card]));
    for (const entry of pool.entries) {
      this.cards[entry.card_id] = 0;
      this.base[entry.card_id] = entry.weight / totalWeight;
      this.rarities[cardById.get(entry.card_id)!.rarity] = 0;
    }
  }
  add(result: DrawResult): void {
    for (const item of result.items) {
      this.total++; increment(this.cards, item.card_id); increment(this.rarities, item.rarity);
      if (item.forced_pity) this.forced++;
      this.longest = Math.max(this.longest, item.pity_after);
    }
  }
  summary() {
    return { total_draws: this.total,
      cards: Object.fromEntries(Object.entries(this.cards).map(([id, count]) => [id, {
        count, frequency: this.total === 0 ? 0 : count / this.total, base_probability: this.base[id]!,
      }])),
      rarities: Object.fromEntries(Object.entries(this.rarities).map(([id, count]) => [id, {
        count, frequency: this.total === 0 ? 0 : count / this.total,
      }])), forced_pity: this.forced, longest_miss_streak: this.longest,
    };
  }
}
