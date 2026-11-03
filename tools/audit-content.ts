import { loadContent } from './lib/ContentLoader.js';
import { DEFAULT_CONTENT, parseCli, requiredString, runCli } from './lib/cli.js';
import type { ContentBundle, Effect, Stage } from '../assets/scripts/core/types/content.generated.js';

type Counts = Record<string, number>;
function increment(counts: Counts, key: string, amount = 1): void { counts[key] = (counts[key] ?? 0) + amount; }
function conditionReferences(value: unknown, counts: Counts): void {
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  if (object.op === 'has' && typeof object.collection === 'string' && typeof object.id === 'string') increment(counts, `${object.collection}:${object.id}`);
  for (const child of Object.values(object)) conditionReferences(child, counts);
}
function effectSummary(effects: readonly Effect[], attributes: Record<string, { positive: number; negative: number; total_points: number; count: number }>, types: Counts): void {
  for (const effect of effects) {
    increment(types, effect.type);
    if (effect.type !== 'attribute_add') continue;
    const summary = attributes[effect.attribute] ??= { positive: 0, negative: 0, total_points: 0, count: 0 };
    summary.count += 1; summary.total_points += effect.amount;
    if (effect.amount >= 0) summary.positive += effect.amount; else summary.negative += effect.amount;
  }
}
function lengths(bundle: ContentBundle): Counts {
  const result: Counts = {};
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['text', 'title', 'name', 'description', 'unavailable_text', 'commitment', 'interrupt_text'].includes(key) && typeof child === 'string') increment(result, String(child.length));
      else visit(child);
    }
  };
  visit(bundle); return result;
}
function audit(bundle: ContentBundle) {
  const trigger: Counts = {}, interaction: Counts = {}, dc: Counts = {}, modifier: Counts = {}, effects: Counts = {}, conditions: Counts = {};
  const attributes: Record<string, { positive: number; negative: number; total_points: number; count: number }> = {};
  let options = 0, stages = 0, outcomes = 0;
  for (const event of bundle.events) {
    increment(trigger, event.trigger.kind); increment(interaction, event.interaction); conditionReferences(event.condition, conditions);
    if (event.interaction === 'choice') {
      options += event.options.length;
      for (const option of event.options) { outcomes += 1; conditionReferences(option.condition, conditions); effectSummary(option.outcome.effects, attributes, effects); }
    } else { outcomes += 1; effectSummary(event.outcome.effects, attributes, effects); }
    for (const stage of event.stages ?? []) { stages += 1; dc[String(stage.check.dc)] = (dc[String(stage.check.dc)] ?? 0) + 1; modifier[String(stage.check.modifier)] = (modifier[String(stage.check.modifier)] ?? 0) + 1; effectSummary(stage.success.effects, attributes, effects); effectSummary(stage.failure.effects, attributes, effects); outcomes += 2; }
  }
  const tags: Counts = {}, rarity: Counts = {}, randomWeights: Counts = {};
  for (const card of bundle.cards) { for (const tag of card.tags) increment(tags, tag); increment(rarity, card.rarity); }
  const pools = bundle.pools.map(pool => ({ id: pool.id, entries: pool.entries.length, weight_total: pool.entries.reduce((sum, entry) => sum + entry.weight, 0) }));
  for (const pool of bundle.pools) for (const entry of pool.entries) increment(randomWeights, `${pool.id}:${entry.card_id}`, entry.weight);
  const categories: Counts = {}; for (const achievement of bundle.achievements) increment(categories, achievement.category ?? 'uncategorized');
  return { content: { id: bundle.manifest.content_id, version: bundle.manifest.content_version }, events: { total: bundle.events.length, trigger_kind: trigger, interaction, options, stages, outcomes, effects, dc_distribution: dc, modifier_distribution: modifier, attribute_add: attributes }, cards: { total: bundle.cards.length, tags, rarity, pools, condition_references: conditions, random_weight_by_card: randomWeights }, chains: { total: bundle.chains.length, node_lengths: bundle.chains.map(chain => chain.nodes.length) }, achievements: { total: bundle.achievements.length, categories }, deaths: { total: bundle.deaths.length, d_mod_total: bundle.deaths.filter(death => death.id.startsWith('D_MOD_')).length }, text_length_distribution: lengths(bundle) };
}
await runCli(async () => { const args = parseCli({ content: { type: 'string', default: DEFAULT_CONTENT }, json: { type: 'boolean' } }); const loaded = await loadContent(requiredString(args, 'content')); const result = audit(loaded.bundle); console.log(args.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)); });
