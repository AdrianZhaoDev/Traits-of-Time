import type { ContentBundle, Event, FollowUpTrigger } from '../types/content.generated';
import type { CandidateLog, LogData, PlayerState, QueueEntry, RunState } from '../types/schema';
import type { RandomSource } from './RandomSource';
import { probabilityPasses, sampleWeighted } from './WeightedSampler';
import { conditionContext, evaluateCondition } from './ConditionEvaluator';

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
    if (kind === 'random') {
      let priority = 0;
      for (const candidate of availableCandidates) {
        if (candidate.event.trigger.kind === 'random') priority = Math.max(priority, candidate.event.trigger.priority ?? 0);
      }
      for (const candidate of availableCandidates) {
        if (candidate.event.trigger.kind === 'random' && (candidate.event.trigger.priority ?? 0) < priority) {
          candidate.info.eligible = false;
          candidate.info.reason = 'LOWER_PRIORITY';
        }
      }
    }
    const preferred = automatic < Math.round((encountered + 1) * content.rules.events.automatic_ratio) ? 'automatic' : 'choice';
    const usePacing = kind === 'random' && availableCandidates.some(c => c.info.eligible && c.event.interaction === preferred);
    if (usePacing) {
      for (const candidate of availableCandidates) {
        if (candidate.info.eligible && candidate.event.interaction !== preferred) {
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

/** One follow-up per year, independently of the ordinary random-event allowance. */
export function scheduleFollowUps(content: ContentBundle, player: PlayerState, run: RunState,
  available: (event: Event) => boolean, log: (data: LogData['follow_up']) => void): QueueEntry[] {
  const rules = content.rules.late_life;
  if (!rules || player.calendar_year - player.start_year < rules.start_years) return [];
  type FollowUpEvent = Event & { trigger: FollowUpTrigger };
  const groups = new Map<string, FollowUpEvent[]>();
  for (const event of content.events) {
    if (event.trigger.kind !== 'follow_up' || Object.hasOwn(run.follow_up_groups, event.trigger.group_id)) continue;
    const list = groups.get(event.trigger.group_id) ?? [];
    list.push(event as FollowUpEvent);
    groups.set(event.trigger.group_id, list);
  }
  const context = conditionContext(player, run.timeline);
  const due: { data: LogData['follow_up']; best: FollowUpEvent | null }[] = [];
  for (const [group_id, events] of groups) {
    const trigger = events[0]!.trigger;
    const anchor = trigger.after_group === null ? player.start_year + rules.start_years : run.follow_up_groups[trigger.after_group];
    if (anchor === undefined) continue;
    const earliest = anchor + trigger.earliest, latest = anchor + trigger.latest;
    if (player.calendar_year < earliest) continue;
    const candidates = events.sort((a, b) => b.trigger.priority - a.trigger.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(event => {
      const reason = event.trigger.fallback && player.calendar_year < latest ? 'BEFORE_FALLBACK'
        : !evaluateCondition(event.condition, context) ? 'CONDITION_NOT_MET'
        : !available(event) ? 'NO_AVAILABLE_OPTION' : null;
      return { event, info: { event_id: event.id, eligible: reason === null, reason } };
    });
    const best = candidates.find(candidate => candidate.info.eligible)?.event ?? null;
    due.push({ best, data: { group_id, anchor_year: anchor, earliest_year: earliest, latest_year: latest,
      status: player.calendar_year > latest ? 'overdue' : 'no_candidate', selected_event_id: null,
      candidates: candidates.map(candidate => candidate.info.eligible && best && candidate.event.id !== best.id
        ? { ...candidate.info, eligible: false, reason: candidate.event.trigger.priority < best.trigger.priority ? 'LOWER_PRIORITY' : 'TIE_BREAK' }
        : candidate.info) } });
  }
  due.sort((a, b) => a.data.latest_year - b.data.latest_year || (b.best?.trigger.priority ?? -1) - (a.best?.trigger.priority ?? -1)
    || ((a.best?.id ?? a.data.group_id) < (b.best?.id ?? b.data.group_id) ? -1 : (a.best?.id ?? a.data.group_id) > (b.best?.id ?? b.data.group_id) ? 1 : 0));
  const chosen = due.find(group => group.best !== null);
  for (const group of due) {
    if (group === chosen) {
      group.data.status = 'selected';
      group.data.selected_event_id = group.best!.id;
    } else if (group.best && player.calendar_year <= group.data.latest_year) group.data.status = 'deferred';
    log(group.data);
  }
  return chosen ? [{ event_id: chosen.best!.id, chain_instance_id: null }] : [];
}
