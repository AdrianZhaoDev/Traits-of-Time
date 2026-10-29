import type { ContentBundle, Effect, Outcome } from '../types/content.generated.js';
import type { ContentRegistry } from '../content/ContentRegistry.js';
import type { ChainInstance, PlayerState, RunState } from '../types/schema.js';
import { DomainError } from './DomainError.js';
import { interruptChains } from './ChainRunner.js';

export interface EffectPorts { chain: (chain: ChainInstance, action: 'started' | 'interrupted') => void; death: (id: string) => void }
/** Mutates a transaction draft only. Callers commit the complete outcome or discard the draft. */
export function executeEffects(effects: readonly Effect[], player: PlayerState, run: RunState, content: ContentBundle, registry: ContentRegistry, ports: EffectPorts): void {
  for (const effect of effects) {
    if (run.status === 'ENDED') throw new DomainError('OUTCOME_NOT_APPLICABLE');
    switch (effect.type) {
      case 'attribute_add': player.attributes[effect.attribute] = Math.max(content.rules.attributes.min, Math.min(content.rules.attributes.max, player.attributes[effect.attribute] + effect.amount)); break;
      case 'flag_add': if (!player.flags.includes(effect.id)) player.flags.push(effect.id); break;
      case 'flag_remove': player.flags = player.flags.filter(id => id !== effect.id); break;
      case 'injury_add': if (!player.injuries.includes(effect.id)) player.injuries.push(effect.id); break;
      case 'injury_remove': player.injuries = player.injuries.filter(id => id !== effect.id); break;
      case 'region_set': player.region_id = effect.id; break;
      case 'identity_set':
        player.identity_id = effect.id;
        if (registry.identities.get(effect.id)!.rank > registry.identities.get(player.highest_identity_id)!.rank) player.highest_identity_id = effect.id;
        break;
      case 'ending_unlock': if (!player.achievements.includes(effect.id)) player.achievements.push(effect.id); break;
      case 'chain_start': {
        if (player.chains.filter(c => c.status === 'active').length >= content.rules.chains.max_active) throw new DomainError('OUTCOME_NOT_APPLICABLE', 'Active chain capacity is exhausted');
        const definition = registry.chains.get(effect.id)!;
        const chain: ChainInstance = { instance_id: `${run.run_id}:chain:${++run.chain_counter}`, chain_id: effect.id, started_year: player.calendar_year,
          next_due_year: player.calendar_year + definition.nodes[0]!.after_years, node_index: 0, status: 'active', interruption_reason: null };
        player.chains.push(chain); ports.chain(chain, 'started'); break;
      }
      case 'death': ports.death(effect.id); break;
    }
    if (effect.type !== 'death') interruptChains(player, run, registry, chain => ports.chain(chain, 'interrupted'));
  }
}
export function previewOutcome(outcome: Outcome, player: PlayerState, run: RunState, content: ContentBundle, registry: ContentRegistry): boolean {
  const draftPlayer: PlayerState = { ...player, attributes: { ...player.attributes }, flags: [...player.flags], injuries: [...player.injuries], achievements: [...player.achievements], chains: player.chains.map(c => ({ ...c })) };
  const draftRun = { ...run };
  try {
    executeEffects(outcome.effects, draftPlayer, draftRun, content, registry, { chain: () => {}, death: () => { draftRun.status = 'ENDED'; } });
    return true;
  } catch (error) {
    if (error instanceof DomainError && error.code === 'OUTCOME_NOT_APPLICABLE') return false;
    throw error;
  }
}
