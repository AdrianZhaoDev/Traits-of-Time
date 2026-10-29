import type { ContentRegistry } from '../content/ContentRegistry.js';
import type { ChainInstance, PlayerState, QueueEntry, RunState } from '../types/schema.js';
import { conditionContext, evaluateCondition } from './ConditionEvaluator.js';

export function interruptChains(player: PlayerState, run: RunState, registry: ContentRegistry, interrupted: (chain: ChainInstance) => void): void {
  const context = conditionContext(player, run.timeline);
  for (const chain of [...player.chains].sort((a, b) => a.instance_id < b.instance_id ? -1 : a.instance_id > b.instance_id ? 1 : 0)) {
    const definition = registry.chains.get(chain.chain_id)!;
    if (chain.status === 'active' && definition.interrupt_condition && evaluateCondition(definition.interrupt_condition, context)) {
      chain.status = 'interrupted'; chain.next_due_year = null; chain.interruption_reason = definition.interrupt_text;
      interrupted(chain);
    }
  }
}
export function dueChains(player: PlayerState, registry: ContentRegistry): QueueEntry[] {
  return player.chains.filter(c => c.status === 'active' && c.next_due_year !== null && c.next_due_year <= player.calendar_year)
    .sort((a, b) => a.next_due_year! - b.next_due_year! || registry.chains.get(b.chain_id)!.priority - registry.chains.get(a.chain_id)!.priority || (a.instance_id < b.instance_id ? -1 : a.instance_id > b.instance_id ? 1 : 0))
    .map(c => ({ event_id: registry.chains.get(c.chain_id)!.nodes[c.node_index]!.event_id, chain_instance_id: c.instance_id }));
}
