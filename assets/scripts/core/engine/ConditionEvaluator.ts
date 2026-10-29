import type { Condition } from '../types/content.generated.js';
import type { PlayerState, Timeline } from '../types/schema.js';

export interface ConditionContext {
  age: number; calendar_year: number; physique: number; intelligence: number; wealth: number; prestige: number; luck: number;
  region_id: string; caste_id: string; identity_id: string; timeline: Timeline;
  traits: readonly string[]; flags: readonly string[]; injuries: readonly string[]; completed_chains: readonly string[];
}
export function conditionContext(player: PlayerState, timeline: Timeline): ConditionContext {
  return { ...player.attributes, age: player.age, calendar_year: player.calendar_year, region_id: player.region_id,
    caste_id: player.caste_id, identity_id: player.identity_id, timeline, traits: player.traits, flags: player.flags,
    injuries: player.injuries, completed_chains: player.chains.filter(c => c.status === 'completed').map(c => c.chain_id) };
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
