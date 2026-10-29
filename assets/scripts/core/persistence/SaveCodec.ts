import type { ContentBundle } from '../types/content.generated.js';
import type { GameSave } from '../types/schema.js';
import type { GachaSave } from '../engine/GachaEngine.js';
import { DomainError } from '../engine/DomainError.js';
import { cloneData } from '../engine/cloneData.js';

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
export function equalData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, i) => equalData(item, right[i]));
  if (!record(left) || !record(right)) return false;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && equalData(left[key], right[key]));
}
function requireSave(ok: unknown): asserts ok { if (!ok) throw new DomainError('SAVE_INVALID', 'Invalid save structure'); }
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text) && new Set(v).size === v.length;
function random(value: unknown): void {
  requireSave(record(value) && keys(value, ['algorithm', 'state', 'draws']) && value.algorithm === 'mulberry32-v1' && integer(value.state) && value.state <= 0xffffffff && integer(value.draws));
}
/** Reject non-JSON data before it can be silently changed by serialization. */
export function validateJson(value: unknown): void {
  const ancestors = new Set<object>();
  const visit = (v: unknown): void => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { requireSave(Number.isFinite(v)); return; }
    requireSave(typeof v === 'object' && v !== null && !ancestors.has(v));
    requireSave(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
    ancestors.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { requireSave(Object.hasOwn(v, i)); visit(v[i]); } }
    else for (const item of Object.values(v)) visit(item);
    ancestors.delete(v);
  };
  visit(value);
}
function envelope(value: unknown, kind: 'life' | 'gacha', content?: ContentBundle, fingerprint?: string): Record<string, unknown> {
  requireSave(record(value) && keys(value, ['save_version', 'kind', 'content_id', 'content_version', 'content_fingerprint', 'revision', 'payload']));
  requireSave(value.save_version === 1 && value.kind === kind && text(value.content_id) && text(value.content_version) && text(value.content_fingerprint) && integer(value.revision));
  if (content && (value.content_id !== content.manifest.content_id || value.content_version !== content.manifest.content_version || value.content_fingerprint !== fingerprint)) {
    throw new DomainError('CONTENT_MISMATCH', `Save ${value.content_id}@${value.content_version} (${value.content_fingerprint}) differs from ${content.manifest.content_id}@${content.manifest.content_version} (${fingerprint})`);
  }
  validateJson(value);
  requireSave(record(value.payload));
  return value.payload;
}
export function decodeGachaSave(value: unknown, content?: ContentBundle, fingerprint?: string): GachaSave {
  const p = envelope(value, 'gacha', content, fingerprint);
  const save = value as GachaSave;
  requireSave(keys(p, ['seed', 'pools', 'processed_commands']) && integer(p.seed) && p.seed <= 0xffffffff && record(p.pools) && record(p.processed_commands));
  for (const [id, pool] of Object.entries(p.pools)) {
    requireSave(text(id) && record(pool) && keys(pool, ['misses', 'total_draws', 'rng']) && integer(pool.misses) && integer(pool.total_draws) && pool.misses <= pool.total_draws);
    random(pool.rng);
  }
  requireSave(Object.keys(p.processed_commands).length === save.revision);
  const revisions = new Set<number>();
  for (const [id, receipt] of Object.entries(p.processed_commands)) {
    requireSave(text(id) && record(receipt) && keys(receipt, ['parameters', 'result']) && record(receipt.parameters) && record(receipt.result));
    const a = receipt.parameters, r = receipt.result;
    requireSave(keys(a, ['poolId', 'count']) && text(a.poolId) && integer(a.count, 1));
    requireSave(keys(r, ['items', 'pool_id', 'seed', 'revision', 'content_fingerprint']) && r.pool_id === a.poolId && r.seed === p.seed && r.content_fingerprint === save.content_fingerprint && integer(r.revision, 1) && r.revision <= save.revision && !revisions.has(r.revision));
    revisions.add(r.revision);
    requireSave(Array.isArray(r.items) && r.items.length === a.count);
    for (const item of r.items) requireSave(record(item) && keys(item, ['card_id', 'rarity', 'draw_index', 'forced_pity', 'pity_before', 'pity_after', 'conditional_probability']) && text(item.card_id) && text(item.rarity) && integer(item.draw_index, 1) && typeof item.forced_pity === 'boolean' && integer(item.pity_before) && integer(item.pity_after) && typeof item.conditional_probability === 'number' && item.conditional_probability > 0 && item.conditional_probability <= 1);
  }
  return save;
}
export function decodeGameSave(value: unknown, content?: ContentBundle, fingerprint?: string): GameSave {
  const p = envelope(value, 'life', content, fingerprint);
  const save = value as GameSave;
  requireSave(keys(p, ['player', 'run', 'logs']) && record(p.player) && record(p.run) && Array.isArray(p.logs));
  const player = p.player, run = p.run;
  requireSave(keys(player, ['era_id', 'start_age', 'age', 'max_lifespan', 'start_year', 'calendar_year', 'region_id', 'caste_id', 'identity_id', 'highest_identity_id', 'attributes', 'traits', 'flags', 'injuries', 'chains', 'achievements']));
  for (const key of ['era_id', 'region_id', 'caste_id', 'identity_id', 'highest_identity_id']) requireSave(text(player[key]));
  for (const key of ['start_age', 'age', 'max_lifespan']) requireSave(integer(player[key]));
  requireSave(Number.isSafeInteger(player.start_year) && Number.isSafeInteger(player.calendar_year) && (player.age as number) >= (player.start_age as number) && (player.calendar_year as number) - (player.start_year as number) === (player.age as number) - (player.start_age as number));
  for (const key of ['traits', 'flags', 'injuries', 'achievements']) requireSave(strings(player[key]));
  requireSave(record(player.attributes) && keys(player.attributes, ['physique', 'intelligence', 'wealth', 'prestige', 'luck']) && Object.values(player.attributes).every(v => typeof v === 'number' && Number.isFinite(v)) && Array.isArray(player.chains));
  for (const chain of player.chains) {
    requireSave(record(chain) && keys(chain, ['instance_id', 'chain_id', 'started_year', 'next_due_year', 'node_index', 'status', 'interruption_reason']) && text(chain.instance_id) && text(chain.chain_id) && Number.isSafeInteger(chain.started_year) && integer(chain.node_index) && ['active', 'completed', 'interrupted'].includes(chain.status as string) && (chain.next_due_year === null || Number.isSafeInteger(chain.next_due_year)) && (chain.interruption_reason === null || text(chain.interruption_reason)));
  }
  requireSave(keys(run, ['run_id', 'seed', 'prng', 'status', 'timeline', 'year_phase', 'queue', 'queue_cursor', 'event_counter', 'chain_counter', 'active_event', 'processed_history', 'cooldowns', 'event_counts', 'remaining_choice_budget', 'dice_results', 'death', 'ending', 'processed_commands', 'revision']));
  requireSave(integer(run.seed) && run.seed <= 0xffffffff && run.run_id === `life:${save.content_fingerprint}:${run.seed}` && integer(run.revision, 1) && run.revision === save.revision);
  random(run.prng);
  requireSave(['READY', 'ADVANCING', 'AWAITING_OPTION', 'AWAITING_STAGE', 'ENDED'].includes(run.status as string) && ['historical', 'fictional'].includes(run.timeline as string) && ['opening', 'vital', 'chains', 'history', 'random', 'complete'].includes(run.year_phase as string));
  requireSave(Array.isArray(run.queue) && integer(run.queue_cursor) && run.queue_cursor <= run.queue.length && strings(run.processed_history) && Array.isArray(run.dice_results));
  for (const key of ['event_counter', 'chain_counter', 'remaining_choice_budget']) requireSave(integer(run[key]));
  for (const entry of run.queue) requireSave(record(entry) && keys(entry, ['event_id', 'chain_instance_id']) && text(entry.event_id) && (entry.chain_instance_id === null || text(entry.chain_instance_id)));
  requireSave(run.active_event === null || (record(run.active_event) && keys(run.active_event, ['event_id', 'chain_instance_id', 'instance_id', 'stage_id']) && text(run.active_event.event_id) && text(run.active_event.instance_id) && (run.active_event.stage_id === null || text(run.active_event.stage_id)) && (run.active_event.chain_instance_id === null || text(run.active_event.chain_instance_id))));
  for (const key of ['cooldowns', 'event_counts']) { requireSave(record(run[key])); for (const [id, count] of Object.entries(run[key])) requireSave(text(id) && Number.isSafeInteger(count) && (key === 'cooldowns' || integer(count))); }
  requireSave((run.death === null || text(run.death)) && (run.ending === null || record(run.ending)) && record(run.processed_commands) && Object.keys(run.processed_commands).length === save.revision - 1);
  for (const [id, receipt] of Object.entries(run.processed_commands)) {
    requireSave(text(id) && record(receipt) && keys(receipt, ['parameters', 'result']) && record(receipt.parameters) && record(receipt.result));
    const a = receipt.parameters, r = receipt.result;
    requireSave(keys(a, ['api', 'args']) && ['nextYear', 'retire', 'resolveOption', 'resolveStage'].includes(a.api as string) && Array.isArray(a.args) && a.args.every(text) && a.args.length === (a.api === 'nextYear' || a.api === 'retire' ? 0 : 2));
    requireSave(r.ok === true && record(r.state) && integer(r.state.revision, 2) && r.state.revision <= save.revision && Array.isArray(r.logs));
  }
  for (let i = 0; i < p.logs.length; i++) { const log = p.logs[i]; requireSave(record(log) && keys(log, ['seq', 'age', 'calendar_year', 'type', 'source_id', 'message', 'data']) && log.seq === i + 1 && integer(log.age) && Number.isSafeInteger(log.calendar_year) && text(log.type) && typeof log.source_id === 'string' && typeof log.message === 'string' && record(log.data)); }
  return save;
}
export function encodeGameSave(content: ContentBundle, fingerprint: string, payload: GameSave['payload']): GameSave {
  return { save_version: 1, kind: 'life', content_id: content.manifest.content_id, content_version: content.manifest.content_version, content_fingerprint: fingerprint, revision: payload.run.revision, payload: cloneData(payload) };
}
export function encodeGachaSave(content: ContentBundle, fingerprint: string, revision: number, payload: GachaSave['payload']): GachaSave {
  return { save_version: 1, kind: 'gacha', content_id: content.manifest.content_id, content_version: content.manifest.content_version, content_fingerprint: fingerprint, revision, payload: cloneData(payload) };
}
