import type { ContentBundle, Pool } from '../../assets/scripts/core/types/content.generated.js';
import type { EndingReport, GameSave } from '../../assets/scripts/core/types/schema.js';
import type { DrawResult } from '../../assets/scripts/core/engine/GachaEngine.js';

const ATTRIBUTES = ['physique', 'intelligence', 'wealth', 'prestige', 'luck'] as const;
type Attribute = typeof ATTRIBUTES[number];
interface NumericAggregate { values: number[]; capped: number; }
type AttributeAggregates = { [K in Attribute]: NumericAggregate };
const aggregate = (): AttributeAggregates => ({ physique: { values: [], capped: 0 }, intelligence: { values: [], capped: 0 }, wealth: { values: [], capped: 0 }, prestige: { values: [], capped: 0 }, luck: { values: [], capped: 0 } });
const counts = (): Record<string, number> => Object.create(null) as Record<string, number>;
const increment = (values: Record<string, number>, key: string): void => { values[key] = (values[key] ?? 0) + 1; };
const proportion = (part: number, whole: number): number | null => whole === 0 ? null : part / whole;
function quantiles(values: number[]): { p50: number | null; p90: number | null } {
  if (values.length === 0) return { p50: null, p90: null };
  values.sort((a, b) => a - b);
  return { p50: values[Math.ceil(values.length * 0.5) - 1]!, p90: values[Math.ceil(values.length * 0.9) - 1]! };
}
function decisionRange(values: number[]) {
  if (values.length === 0) return null;
  const percentiles = quantiles(values);
  return { min: values[0]!, ...percentiles, max: values[values.length - 1]! };
}
const autoRatio = (automatic: number, choice: number): number | null => automatic + choice === 0 ? null : automatic / (automatic + choice);
function positiveCardIds(condition: unknown, result: Set<string>): void {
  if (!condition || typeof condition !== 'object') return;
  const value = condition as { op?: string; collection?: string; id?: string; condition?: unknown; conditions?: unknown[] };
  if (value.op === 'has' && value.collection === 'cards' && typeof value.id === 'string') { result.add(value.id); return; }
  if (value.op === 'not') return;
  if (value.condition !== undefined) positiveCardIds(value.condition, result);
  for (const child of value.conditions ?? []) positiveCardIds(child, result);
}
interface Stratum {
  age_band_id: string; path_category: string; samples: number;
  ages: number[]; years: number[]; inputs: number[]; decisions: number[]; early: number;
  death_counts: Record<string, number>; ending_counts: Record<string, number>;
  chain_started: number; chain_completed: number; chain_interrupted: number;
  automatic_events: number; choice_events: number;
  card_counts: Record<string, number>; start_year_counts: Record<string, number>; origin_counts: Record<string, number>;
  final_attributes: AttributeAggregates; final_totals: NumericAggregate; dice_total: number; dice_success: number;
  card_event_triggers: number;
}
/** Retains numeric aggregates, never engines, saves, command receipts or logs. */
export class LifeStatistics {
  private readonly strata = new Map<string, Stratum>();
  private readonly interactions: Map<string, 'automatic' | 'choice'>;
  private readonly cardGatedEvents = new Map<string, Set<string>>();
  private automaticEvents = 0;
  private choiceEvents = 0;
  private readonly decisions: number[] = [];
  private readonly cardCounts = counts();
  private readonly startYearCounts = counts();
  private readonly originCounts = counts();
  private readonly deathCounts = counts();
  private readonly endingCounts = counts();
  private readonly finalAttributes = aggregate();
  private readonly finalTotals: NumericAggregate = { values: [], capped: 0 };
  private diceTotal = 0;
  private diceSuccess = 0;
  private chainStarted = 0;
  private chainCompleted = 0;
  private chainInterrupted = 0;
  private readonly cardEventTriggers = counts();
  constructor(private readonly content: ContentBundle) {
    this.interactions = new Map(content.events.map(event => [event.id, event.interaction]));
    for (const event of content.events) {
      const cardIds = new Set<string>();
      positiveCardIds(event.condition, cardIds);
      if (cardIds.size === 0) continue;
      this.cardGatedEvents.set(event.id, cardIds);
      for (const cardId of cardIds) this.cardEventTriggers[cardId] = 0;
    }
  }
  add(report: EndingReport, save: GameSave, blockingInputs: number) {
    const ageBand = this.content.rules.age_bands.find(band => report.start_age >= band.min && report.start_age <= band.max);
    if (!ageBand) throw new Error(`未找到开局年龄档：${report.start_age}`);
    const age_band_id = ageBand.id;
    const path_category = report.years_played === 0 ? 'opening_death'
      : report.milestone_achievement_ids.length > 0 || (report.primary_achievement_id !== null && this.content.achievements.some(item => item.id === report.primary_achievement_id && item.category === undefined)) || blockingInputs >= 30 ? 'long_or_major'
      : blockingInputs <= 9 ? 'short' : 'regular';
    const key = JSON.stringify([age_band_id, path_category]);
    let group = this.strata.get(key);
    if (!group) {
      group = { age_band_id, path_category, samples: 0, ages: [], years: [], inputs: [], decisions: [], early: 0,
        death_counts: counts(), ending_counts: counts(), chain_started: 0, chain_completed: 0, chain_interrupted: 0,
        automatic_events: 0, choice_events: 0, card_counts: counts(), start_year_counts: counts(), origin_counts: counts(),
        final_attributes: aggregate(), final_totals: { values: [], capped: 0 }, dice_total: 0, dice_success: 0, card_event_triggers: 0 };
      this.strata.set(key, group);
    }
    group.samples++;
    group.ages.push(report.end_age); group.years.push(report.years_played); group.inputs.push(blockingInputs);
    if (report.years_played <= 3) group.early++;
    increment(group.death_counts, report.death_id); increment(this.deathCounts, report.death_id);
    increment(group.ending_counts, report.primary_achievement_id ?? '普通人生'); increment(this.endingCounts, report.primary_achievement_id ?? '普通人生');
    for (const attribute of ATTRIBUTES) {
      const value = report.final_attributes[attribute];
      group.final_attributes[attribute].values.push(value); this.finalAttributes[attribute].values.push(value);
      if (value >= this.content.rules.attributes.max) { group.final_attributes[attribute].capped++; this.finalAttributes[attribute].capped++; }
    }
    const finalTotal = ATTRIBUTES.reduce((sum, attribute) => sum + report.final_attributes[attribute], 0);
    group.final_totals.values.push(finalTotal); this.finalTotals.values.push(finalTotal);
    const dice = save.payload.run.dice_results;
    group.dice_total += dice.length; group.dice_success += dice.filter(result => result.success).length;
    this.diceTotal += dice.length; this.diceSuccess += dice.filter(result => result.success).length;
    let automatic_events = 0;
    let choice_events = 0;
    let player_decisions = 0;
    let card_id: string | null = null;
    let origin_id: string | null = null;
    for (const log of save.payload.logs) {
      if (log.type === 'opening') {
        card_id = log.data.card_id; origin_id = log.data.background_id;
      } else if (log.type === 'option') {
        player_decisions++;
      } else if (log.type === 'event') {
        const interaction = this.interactions.get(log.source_id);
        if (interaction === 'automatic') automatic_events++;
        else if (interaction === 'choice') choice_events++;
        const gatedCards = this.cardGatedEvents.get(log.source_id);
        if (card_id !== null && gatedCards?.has(card_id)) { increment(this.cardEventTriggers, card_id); group.card_event_triggers++; }
      } else if (log.type === 'chain') {
        if (log.data.action === 'started') { group.chain_started++; this.chainStarted++; }
        else if (log.data.action === 'completed') { group.chain_completed++; this.chainCompleted++; }
        else if (log.data.action === 'interrupted') { group.chain_interrupted++; this.chainInterrupted++; }
      }
    }
    group.decisions.push(player_decisions); this.decisions.push(player_decisions);
    group.automatic_events += automatic_events; group.choice_events += choice_events;
    this.automaticEvents += automatic_events; this.choiceEvents += choice_events;
    if (card_id !== null) { increment(group.card_counts, card_id); increment(this.cardCounts, card_id); }
    if (origin_id !== null) { increment(group.origin_counts, origin_id); increment(this.originCounts, origin_id); }
    increment(group.start_year_counts, String(report.start_year)); increment(this.startYearCounts, String(report.start_year));
    return { age_band_id, path_category, automatic_events, choice_events, player_decisions,
      auto_ratio: autoRatio(automatic_events, choice_events), card_id, start_year: report.start_year, origin_id };
  }
  private numericSummary(values: NumericAggregate, includeCap = true) {
    const quantile = quantiles(values.values);
    const result: { mean: number | null; p50: number | null; capped_rate?: number | null } = {
      mean: values.values.length === 0 ? null : values.values.reduce((sum, value) => sum + value, 0) / values.values.length,
      p50: quantile.p50,
    };
    if (includeCap) result.capped_rate = proportion(values.capped, values.values.length);
    return result;
  }
  summary() {
    const ended_runs = this.decisions.length;
    const death_proportions = Object.fromEntries(Object.entries(this.deathCounts).map(([id, count]) => [id, proportion(count, ended_runs)]));
    const ending_proportions = Object.fromEntries(Object.entries(this.endingCounts).map(([id, count]) => [id, proportion(count, ended_runs)]));
    return { sample_count: ended_runs, automatic_events: this.automaticEvents, choice_events: this.choiceEvents,
      player_decisions: decisionRange(this.decisions), auto_ratio: autoRatio(this.automaticEvents, this.choiceEvents),
      d20: { total: this.diceTotal, success: this.diceSuccess, success_rate: proportion(this.diceSuccess, this.diceTotal) },
      final_attributes: Object.fromEntries(ATTRIBUTES.map(attribute => [attribute, this.numericSummary(this.finalAttributes[attribute])])),
      final_attribute_total: this.numericSummary(this.finalTotals, false),
      death_counts: this.deathCounts, death_proportions, ending_counts: this.endingCounts, ending_proportions,
      chains: { started: this.chainStarted, completed: this.chainCompleted, interrupted: this.chainInterrupted, completion_rate: proportion(this.chainCompleted, this.chainStarted) },
      opening_card_total: Object.values(this.cardCounts).reduce((sum, count) => sum + count, 0), card_counts: this.cardCounts,
      card_event_trigger_total: Object.values(this.cardEventTriggers).reduce((sum, count) => sum + count, 0), card_event_triggers: this.cardEventTriggers,
      start_year_counts: this.startYearCounts, origin_counts: this.originCounts,
      denominator: { ended_runs, note: 'death_counts、ending_counts、d20、最终属性和链统计均以 ended_runs 为分母；failed runs 不进入 EndingReport 聚合。' },
      early_death_definition: { years_played_lte: 3, rate_denominator: 'stratum.samples' },
      path_category_definition: 'path_category 是按开局死亡、里程碑/重大路径和阻塞输入数分类，不是单纯按寿命长短分类。',
      strata: [...this.strata.values()].map(({ ages, years, inputs, decisions, early, final_attributes, final_totals, dice_total, dice_success, ...group }) => ({
        ...group, final_age: quantiles(ages), years_played: quantiles(years), blocking_inputs: quantiles(inputs),
        player_decisions: decisionRange(decisions), auto_ratio: autoRatio(group.automatic_events, group.choice_events),
        early_death_rate: early / group.samples, final_attributes: Object.fromEntries(ATTRIBUTES.map(attribute => [attribute, this.numericSummary(final_attributes[attribute])])),
        final_attribute_total: this.numericSummary(final_totals, false), d20: { total: dice_total, success: dice_success, success_rate: proportion(dice_success, dice_total) },
        card_event_trigger_total: group.card_event_triggers,
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
