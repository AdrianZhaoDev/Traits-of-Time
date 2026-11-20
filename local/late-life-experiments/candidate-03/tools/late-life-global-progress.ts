import type { LifeReport } from './simulate';
import { causalProgress, type CausalMapping } from './late-life-causality';

// Fixed before recomputation, applied identically to baseline and every candidate.
// Only concrete family-state milestones are allowlisted: no generic flag count, awards,
// repeated attribute increments, node visits or deaths are automatically credited.
export const familyMilestones = [
  'F_FAM_MARRIED', 'F_FAM_REMARRIED', 'F_FAM_CHILD_1', 'F_FAM_CHILD_2',
  'F_FAM_CHILD_SCHOOLED', 'F_FAM_CHILD_SUCCESS', 'F_FAM_CHILD_MARRIED',
  'F_FAM_GRANDCHILD', 'F_FAM_CHILD_GREAT_BIRTH_LE75', 'F_FAM_CHILD_GREAT_BIRTH_LE80',
  'F_FAM_FIVE_GENERATIONS',
] as const;
export function globalProgress(life: LifeReport, mappings: CausalMapping[]) {
  const causal = causalProgress(life, mappings);
  const evidence: { year: number; kind: string; id: string }[] = [];
  const credited = new Set<string>();
  const record = (year: number, kind: string, id: string) => {
    const key = `${kind}:${id}`;
    if (!credited.has(key)) { credited.add(key); evidence.push({ year, kind, id }); }
  };
  for (const command of life.evidence.commands) {
    for (const flag of familyMilestones) if (!command.before.flags.includes(flag) && command.after.flags.includes(flag)) record(command.year, 'family_state', flag);
    if (command.before.identity_id !== command.after.identity_id) record(command.year, 'identity_transition', `${command.before.identity_id}->${command.after.identity_id}`);
    for (const chain of command.after.chains) {
      const previous = command.before.chains.find(item => item.instance_id === chain.instance_id);
      // Interruption is concrete loss evidence, never credited as successful growth.
      if (chain.status === 'completed' && previous?.status !== 'completed') record(command.year, 'career_completed', chain.chain_id);
      if (chain.status === 'interrupted' && previous?.status !== 'interrupted') record(command.year, 'career_interrupted', chain.chain_id);
    }
  }
  const years = new Set([...causal.progress_years, ...evidence.map(item => item.year)]);
  const exposed = life.evidence.exposed_years.filter(year => year >= life.start_year + 9).sort((a, b) => a - b);
  // Same configured phase boundary for historical baseline, which predates late_life state.
  const settlement = Math.max(life.start_year + 19, life.start_year + 55 - life.start_age);
  const gap = (values: number[]) => { let run = 0, max = 0; for (const year of values) { run = years.has(year) ? 0 : run + 1; max = Math.max(max, run); } return max; };
  return { definition: 'LL realized causal pairs plus first concrete family-state, identity-transition and career completion/interruption changes; no death, generic flags, awards, repeated stat increments or text-only milestones.', evidence,
    progress_years: [...years].sort((a, b) => a - b), whole_gap: gap(exposed), active_gap: gap(exposed.filter(year => year < settlement)), settlement_year: settlement };
}
