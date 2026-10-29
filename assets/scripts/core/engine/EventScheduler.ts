import type { ContentBundle, Event } from '../types/content.generated.js';
import type { CandidateLog, PlayerState, QueueEntry, RunState } from '../types/schema.js';
import type { RandomSource } from './RandomSource.js';
import { probabilityPasses, sampleWeighted } from './WeightedSampler.js';
import { conditionContext, evaluateCondition } from './ConditionEvaluator.js';

export function scheduleWeightedEvents(content: ContentBundle, player: PlayerState, run: RunState, kind: 'opening' | 'random', rng: RandomSource,
  available: (event: Event) => boolean, log: (candidates: CandidateLog[], selected: string | null) => void): QueueEntry[] {
  const limit = kind === 'opening' ? 1 : content.rules.events.per_year;
  if (limit === 0) return [];
  const context = conditionContext(player, run.timeline);
  const candidates = content.events.filter(event => event.trigger.kind === kind).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(event => {
    const trigger = event.trigger;
    if (trigger.kind !== 'opening' && trigger.kind !== 'random') throw new Error('Unexpected scheduled trigger');
    let reason: string | null = null;
    let weight = trigger.weight;
    if (trigger.kind === 'random' && trigger.rare) {
      const { min, max } = content.rules.attributes;
      const { factor_min, factor_max } = content.rules.luck;
      weight *= factor_min + (player.attributes.luck - min) / (max - min) * (factor_max - factor_min);
    }
    if (weight <= 0) reason = 'ZERO_WEIGHT';
    else if (!evaluateCondition(event.condition, context)) reason = 'CONDITION_NOT_MET';
    else if (trigger.kind === 'random' && trigger.max_occurrences !== null && (run.event_counts[event.id] ?? 0) >= trigger.max_occurrences) reason = 'MAX_OCCURRENCES';
    else if (trigger.kind === 'random' && run.cooldowns[event.id] !== undefined && player.calendar_year <= run.cooldowns[event.id]!) reason = 'COOLDOWN';
    else if (player.attributes.physique <= 1 && (event.id.includes('_PHYS_HARD_') || event.id.includes('_HEAVY_LABOR_'))) reason = 'PHYSIQUE_TOO_LOW';
    else if (player.attributes.wealth <= 1 && (event.id.includes('_RICH_') || event.id.includes('_LUXURY_'))) reason = 'WEALTH_TOO_LOW';
    else if (!available(event)) reason = 'NO_AVAILABLE_OPTION';
    const eligible = reason === null;
    return { event, info: { event_id: event.id, eligible, reason, gate_passed: eligible ? probabilityPasses(trigger.trigger_probability, rng) : null,
      effective_weight: weight, conditional_probability: null } as CandidateLog };
  });
  const selected = new Set<string>();
  const queue: QueueEntry[] = [];
  // History and chains count too. Project this batch, then resync from actual
  // encounters next time; skipped queue entries never permanently spend a quota.
  let encountered = 0;
  let automatic = 0;
  for (const event of content.events) {
    const count = run.event_counts[event.id] ?? 0;
    encountered += count;
    if (event.interaction === 'automatic') automatic += count;
  }
  for (let index = 0; index < limit; index++) {
    const current = candidates.map(({ event, info }) => {
      const copy = { ...info };
      if (selected.has(event.id)) { copy.eligible = false; copy.reason = 'ALREADY_SELECTED'; }
      return { event, info: copy };
    });
    const availableCandidates = current.filter(c => c.info.eligible && c.info.gate_passed);
    const preferred = automatic < Math.round((encountered + 1) * content.rules.events.automatic_ratio) ? 'automatic' : 'choice';
    const usePacing = kind === 'random' && availableCandidates.some(c => c.event.interaction === preferred);
    if (usePacing) {
      for (const candidate of availableCandidates) {
        if (candidate.event.interaction !== preferred) {
          candidate.info.eligible = false;
          candidate.info.reason = 'PACING_TARGET';
        }
      }
    }
    const eligible = availableCandidates.filter(c => c.info.eligible);
    const total = eligible.reduce((sum, c) => sum + c.info.effective_weight, 0);
    for (const candidate of eligible) candidate.info.conditional_probability = candidate.info.effective_weight / total;
    if (!eligible.length) { log(current.map(c => c.info), null); break; }
    const choice = sampleWeighted(eligible, c => c.info.effective_weight, rng);
    log(current.map(c => c.info), choice.event.id);
    selected.add(choice.event.id); queue.push({ event_id: choice.event.id, chain_instance_id: null });
    encountered++;
    if (choice.event.interaction === 'automatic') automatic++;
  }
  return queue;
}
export function scheduleHistory(content: ContentBundle, player: PlayerState, run: RunState): QueueEntry[] {
  if (run.timeline !== 'historical') return [];
  return content.events.filter(event => event.trigger.kind === 'historical' && event.trigger.year === player.calendar_year && !run.processed_history.includes(event.id))
    .sort((a, b) => (b.trigger.kind === 'historical' ? b.trigger.priority : 0) - (a.trigger.kind === 'historical' ? a.trigger.priority : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(event => ({ event_id: event.id, chain_instance_id: null }));
}
