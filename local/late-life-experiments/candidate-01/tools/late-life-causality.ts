import type { LifeReport } from './simulate';

export interface CausalMapping {
  event_id: string;
  meaning: 'treatment' | 'respect' | 'resource_choice' | 'spread' | 'livelihood_loss' | 'lost_standing' | 'dependence' | 'ordinary';
  consequence_event_ids: string[];
  prerequisite_flags: string[];
  arrangement: string;
}

/** Count a distinct arrangement only after its actual later consequence is observed. */
export function causalProgress(life: LifeReport, mappings: CausalMapping[]) {
  const lateStart = life.start_year + 9;
  const observations: { year: number; event_id: string; instance_id: string; before: LifeReport['evidence']['initial_state']; after: LifeReport['evidence']['initial_state']; effects: unknown[] }[] = [];
  const active = new Map<string, typeof observations[number]>();
  for (const command of life.evidence.commands) {
    for (const log of command.logs) {
      if (log.type === 'event') {
        const observation = { year: log.calendar_year, event_id: log.source_id, instance_id: log.data.event_instance_id, before: command.before, after: command.after, effects: [] as unknown[] };
        observations.push(observation);
        active.set(log.source_id, observation);
      } else if (log.type === 'effects') {
        const observation = active.get(log.source_id);
        if (observation) { observation.effects.push(...log.data.effects); observation.after = command.after; }
      }
    }
  }
  const years = new Set<number>();
  const credited = new Set<string>();
  const arrangements = [];
  for (let index = 0; index < observations.length; index++) {
    const observed = observations[index]!;
    const mapping = mappings.find(item => item.event_id === observed.event_id);
    if (!mapping || observed.year < lateStart) continue;
    const prerequisitesMet = mapping.prerequisite_flags.every(flag => observed.before.flags.includes(flag));
    const consequence = observations.slice(index + 1).find(next => next.year > observed.year && mapping.consequence_event_ids.includes(next.event_id));
    const status = !prerequisitesMet ? 'invalid_prerequisite' : !consequence ? 'unrealized_before_death' : credited.has(mapping.arrangement) ? 'repeat' : 'realized';
    if (status === 'realized') {
      credited.add(mapping.arrangement);
      years.add(observed.year);
      years.add(consequence!.year);
    }
    arrangements.push({ ...observed, meaning: mapping.meaning, arrangement: mapping.arrangement, status,
      consequence: consequence ? { event_id: consequence.event_id, year: consequence.year, instance_id: consequence.instance_id, effects: consequence.effects, before: consequence.before, after: consequence.after } : null });
  }
  const exposed = life.evidence.exposed_years.filter(year => year >= lateStart).sort((a, b) => a - b);
  let gap = 0, longest = 0;
  for (const year of exposed) { gap = years.has(year) ? 0 : gap + 1; longest = Math.max(longest, gap); }
  return {
    definition: 'Distinct evidenced resource/relationship arrangements count at establishment and later realized consequence; repeated arrangements, flags, event counts and attribute increments alone do not count.',
    arrangements, progress_years: [...years].sort((a, b) => a - b), longest_gap: longest,
    meanings: Object.fromEntries([...new Set(mappings.map(item => item.meaning))].map(meaning => [meaning, arrangements.filter(item => item.meaning === meaning && item.status === 'realized').length])),
  };
}
