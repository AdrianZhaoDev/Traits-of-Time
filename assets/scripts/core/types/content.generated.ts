/* Generated from assets/resources/data/content.schema.json. Do not edit by hand. */

/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Condition".
 */
export type Condition =
  LogicalCondition | NotCondition | CompareCondition | HasCondition | IdentityCondition | TimelineCondition;
export type AnnualEffect = AnnualAttributeEffect | AnnualDeathEffect;
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Attribute".
 */
export type Attribute = 'physique' | 'intelligence' | 'wealth' | 'prestige' | 'luck';
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Event".
 */
export type Event = ChoiceEvent | AutomaticEvent;
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Trigger".
 */
export type Trigger = OpeningTrigger | RandomTrigger | HistoricalTrigger | ChainTrigger;
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "VisibleAttribute".
 */
export type VisibleAttribute = 'physique' | 'intelligence' | 'wealth' | 'prestige';
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Effect".
 */
export type Effect =
  | AttributeAddEffect
  | FlagEffect
  | InjuryEffect
  | RegionEffect
  | IdentityEffect
  | ChainEffect
  | EndingEffect
  | DeathEffect;

export interface ContentBundle {
  manifest: Manifest;
  rules: Rules;
  era: Era;
  regions: Region[];
  castes: Caste[];
  cards: Card[];
  pools: Pool[];
  events: Event[];
  chains: Chain[];
  achievements: Achievement[];
  deaths: Death[];
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Manifest".
 */
export interface Manifest {
  schema_version: 2;
  content_id: string;
  content_version: string;
  files: ContentFiles;
}
export interface ContentFiles {
  rules: string;
  era: string;
  regions: string;
  castes: string;
  cards: string;
  pools: string;
  events: string;
  chains: string;
  achievements: string;
  deaths: string;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Rules".
 */
export interface Rules {
  attributes: AttributeRules;
  /**
   * @minItems 1
   */
  age_bands: AgeBand[];
  lifespan: LifespanRules;
  check: CheckRules;
  luck: LuckRules;
  opening: OpeningRules;
  events: EventRules;
  chains: ChainRules;
}
export interface AttributeRules {
  min: number;
  max: number;
  base: number;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "AgeBand".
 */
export interface AgeBand {
  id: string;
  min: number;
  max: number;
  weight: number;
  modifiers: AttributeModifiers;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "AttributeModifiers".
 */
export interface AttributeModifiers {
  physique?: number;
  intelligence?: number;
  wealth?: number;
  prestige?: number;
  luck?: number;
}
export interface LifespanRules {
  min: number;
  max: number;
  min_remaining_years: number;
}
export interface CheckRules {
  modifier_min: number;
  modifier_max: number;
}
export interface LuckRules {
  factor_min: number;
  factor_max: number;
}
export interface OpeningRules {
  pool_id: string;
  year_min: number;
  year_max: number;
}
export interface EventRules {
  per_year: number;
  automatic_ratio: number;
}
export interface ChainRules {
  max_active: number;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Era".
 */
export interface Era {
  id: string;
  name: string;
  start_year: number;
  historical_end_year: number;
  backgrounds: Background[];
  identities: Identity[];
  injuries: Injury[];
  fallback_text: string;
  old_age_death_id: string;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Background".
 */
export interface Background {
  id: string;
  text: string;
  condition?: Condition;
  weight: number;
  identity_id: string;
  modifiers: AttributeModifiers;
  flags: string[];
}
export interface LogicalCondition {
  op: 'all' | 'any';
  /**
   * @minItems 1
   */
  conditions: Condition[];
}
export interface NotCondition {
  op: 'not';
  condition: Condition;
}
export interface CompareCondition {
  op: 'compare';
  field: 'age' | 'calendar_year' | 'physique' | 'intelligence' | 'wealth' | 'prestige' | 'luck';
  comparator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
  value: number;
}
export interface HasCondition {
  op: 'has';
  collection: 'cards' | 'flags' | 'injuries' | 'completed_chains';
  id: string;
}
export interface IdentityCondition {
  op: 'is';
  field: 'region_id' | 'caste_id' | 'identity_id';
  value: string;
}
export interface TimelineCondition {
  op: 'is';
  field: 'timeline';
  value: 'historical' | 'fictional';
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Identity".
 */
export interface Identity {
  id: string;
  name: string;
  rank: number;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Injury".
 */
export interface Injury {
  id: string;
  name: string;
  annual_effects: AnnualEffect[];
}
export interface AnnualAttributeEffect {
  type: 'attribute_add';
  attribute: Attribute;
  amount: number;
}
export interface AnnualDeathEffect {
  type: 'death';
  id: string;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Region".
 */
export interface Region {
  id: string;
  name: string;
  weight: number;
  modifiers: AttributeModifiers;
  flags: string[];
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Caste".
 */
export interface Caste {
  id: string;
  name: string;
  weight: number;
  modifiers: AttributeModifiers;
  flags: string[];
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Card".
 */
export interface Card {
  id: string;
  name: string;
  description: string;
  rarity: string;
  tags: string[];
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Pool".
 */
export interface Pool {
  id: string;
  name: string;
  /**
   * @minItems 1
   */
  entries: PoolEntry[];
  replacement: boolean;
  hard_pity: HardPity | null;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "PoolEntry".
 */
export interface PoolEntry {
  card_id: string;
  weight: number;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "HardPity".
 */
export interface HardPity {
  after: number;
  /**
   * @minItems 1
   */
  target_card_ids: string[];
}
export interface ChoiceEvent {
  id: string;
  title?: string;
  text: string;
  condition?: Condition;
  trigger: Trigger;
  /**
   * @minItems 1
   */
  stages?: Stage[];
  interaction: 'choice';
  /**
   * @minItems 1
   */
  options: Option[];
}
export interface OpeningTrigger {
  kind: 'opening';
  weight: number;
  trigger_probability: number;
}
export interface RandomTrigger {
  kind: 'random';
  weight: number;
  trigger_probability: number;
  cooldown_years: number;
  max_occurrences: number | null;
  rare: boolean;
}
export interface HistoricalTrigger {
  kind: 'historical';
  year: number;
  priority: number;
}
export interface ChainTrigger {
  kind: 'chain';
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Stage".
 */
export interface Stage {
  id: string;
  text: string;
  check: Check;
  success: Outcome;
  failure: Outcome;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Check".
 */
export interface Check {
  attribute: VisibleAttribute;
  dc: number;
  modifier: number;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Outcome".
 */
export interface Outcome {
  text: string;
  effects: Effect[];
  next_stage_id: string | null;
}
export interface AttributeAddEffect {
  type: 'attribute_add';
  attribute: Attribute;
  amount: number;
}
export interface FlagEffect {
  type: 'flag_add' | 'flag_remove';
  id: string;
}
export interface InjuryEffect {
  type: 'injury_add' | 'injury_remove';
  id: string;
}
export interface RegionEffect {
  type: 'region_set';
  id: string;
}
export interface IdentityEffect {
  type: 'identity_set';
  id: string;
}
export interface ChainEffect {
  type: 'chain_start';
  id: string;
}
export interface EndingEffect {
  type: 'ending_unlock';
  id: string;
}
export interface DeathEffect {
  type: 'death';
  id: string;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Option".
 */
export interface Option {
  id: string;
  text: string;
  condition?: Condition;
  unavailable_text: string;
  risk: 'safe' | 'normal' | 'high';
  outcome: Outcome;
}
export interface AutomaticEvent {
  id: string;
  title?: string;
  text: string;
  condition?: Condition;
  trigger: Trigger;
  /**
   * @minItems 1
   */
  stages?: Stage[];
  interaction: 'automatic';
  outcome: Outcome;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Chain".
 */
export interface Chain {
  id: string;
  name: string;
  priority: number;
  interrupt_condition?: Condition;
  interrupt_text: string;
  /**
   * @minItems 1
   */
  nodes: ChainNode[];
  completion: Outcome;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "ChainNode".
 */
export interface ChainNode {
  after_years: number;
  event_id: string;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Achievement".
 */
export interface Achievement {
  id: string;
  name: string;
  text: string;
  condition: Condition;
  priority: number;
  retirable: boolean;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Death".
 */
export interface Death {
  id: string;
  name: string;
  text: string;
}
/**
 * This interface was referenced by `ContentBundle`'s JSON-Schema
 * via the `definition` "Attributes".
 */
export interface Attributes {
  physique: number;
  intelligence: number;
  wealth: number;
  prestige: number;
  luck: number;
}
