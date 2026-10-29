import type { Condition } from '../types/content.generated.js';
import type { PlayerState, Timeline } from '../types/schema.js';

export interface ConditionContext {
  age: number; calendar_year: number; physique: number; intelligence: number; wealth: number; prestige: number; luck: number;
  region_id: string; caste_id: string; identity_id: string; timeline: Timeline;
  cards: readonly string[]; flags: readonly string[]; injuries: readonly string[]; completed_chains: readonly string[];
}
export function conditionContext(player: PlayerState, timeline: Timeline): ConditionContext {
  const dynamicFlags = new Set(player.flags);
  // Physique Tiers
  if (player.attributes.physique <= 1) dynamicFlags.add('TIER_PHYSIQUE_FRAIL');
  else if (player.attributes.physique >= 7) dynamicFlags.add('TIER_PHYSIQUE_MIGHTY');
  // Intelligence Tiers
  if (player.attributes.intelligence <= 1) dynamicFlags.add('TIER_INTEL_DULL');
  else if (player.attributes.intelligence >= 7) dynamicFlags.add('TIER_INTEL_GENIUS');
  // Wealth Tiers
  if (player.attributes.wealth <= 1) dynamicFlags.add('TIER_WEALTH_DESTITUTE');
  else if (player.attributes.wealth >= 7) dynamicFlags.add('TIER_WEALTH_MAGNATE');
  // Prestige Tiers
  if (player.attributes.prestige <= 1) dynamicFlags.add('TIER_PRESTIGE_OBSCURE');
  else if (player.attributes.prestige >= 7) dynamicFlags.add('TIER_PRESTIGE_EMINENT');

  return {
    ...player.attributes,
    age: player.age,
    calendar_year: player.calendar_year,
    region_id: player.region_id,
    caste_id: player.caste_id,
    identity_id: player.identity_id,
    timeline,
    cards: player.cards,
    flags: Array.from(dynamicFlags),
    injuries: player.injuries,
    completed_chains: player.chains.filter(c => c.status === 'completed').map(c => c.chain_id),
  };
}
export function evaluateCondition(condition: Condition | undefined, state: ConditionContext): boolean {
  if (!condition) return true;
  switch (condition.op) {
    case 'all': return condition.conditions.every(c => evaluateCondition(c, state));
    case 'any': return condition.conditions.some(c => evaluateCondition(c, state));
    case 'not': return !evaluateCondition(condition.condition, state);
    case 'has': return state[condition.collection].includes(condition.id);
    case 'is': return state[condition.field] === condition.value;
    case 'compare': {
      const actual = state[condition.field];
      switch (condition.comparator) {
        case 'eq': return actual === condition.value;
        case 'ne': return actual !== condition.value;
        case 'lt': return actual < condition.value;
        case 'lte': return actual <= condition.value;
        case 'gt': return actual > condition.value;
        case 'gte': return actual >= condition.value;
      }
    }
  }
}
