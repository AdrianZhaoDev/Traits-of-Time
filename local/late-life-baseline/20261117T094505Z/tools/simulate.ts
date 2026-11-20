import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadContent } from './content-io.mjs';
import type { ContentBundle, Event, Option } from '../src/game/core/types/content.generated';
import type { GameView, LogEntry, PendingDecision, PlayerState } from '../src/game/core/types/schema';
import type { CommandResult } from '../src/game/core/types/commands';
import type { GameEngine } from '../src/game/core/engine/GameEngine';
import type { Mulberry32, uniformInt } from '../src/game/core/engine/RandomSource';

export type Strategy = 'normal' | 'cautious' | 'risky' | 'career';
const strategies: Strategy[] = ['normal', 'cautious', 'risky', 'career'];
const riskOrder = { safe: 0, normal: 1, high: 2 } as const;
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

type OptionPending = Extract<PendingDecision, { kind: 'option' }>;
type Success = Extract<CommandResult, { ok: true }>;
type EngineConstructor = typeof GameEngine;
type RandomConstructor = typeof Mulberry32;
type UniformInt = typeof uniformInt;

/** Strategy randomness is separate from the engine's saved RNG and never sees future rolls. */
export function chooseOption(pending: OptionPending, definition: Event, strategy: Strategy, randomIndex: (length: number) => number) {
  if (definition.interaction !== 'choice') throw new Error(`Expected choice event ${definition.id}`);
  const available = pending.options.filter(option => option.available).sort(byId);
  if (!available.length) throw new Error(`No available option for ${definition.id}`);
  if (strategy === 'normal') return available[randomIndex(available.length)]!;
  if (strategy === 'career') {
    const score = (option: Option) => {
      const effects = option.outcome.effects;
      return (effects.some(effect => effect.type === 'chain_start') ? 100 : 0)
        + (effects.some(effect => effect.type === 'identity_set') ? 10 : 0)
        + (definition.trigger.kind === 'chain' && option.outcome.next_stage_id !== null ? 2 : 0)
        + effects.filter(effect => effect.type === 'attribute_add' && effect.amount > 0).length;
    };
    const definitions = new Map(definition.options.map(option => [option.id, option]));
    return available.sort((a, b) => score(definitions.get(b.id)!) - score(definitions.get(a.id)!) || byId(a, b))[0]!;
  }
  const direction = strategy === 'cautious' ? 1 : -1;
  return available.sort((a, b) => direction * (riskOrder[a.risk] - riskOrder[b.risk]) || byId(a, b))[0]!;
}

export function longestGap(exposedYears: number[], markedYears: Iterable<number>): number {
  const marked = new Set(markedYears);
  let longest = 0, gap = 0;
  for (const year of [...new Set(exposedYears)].sort((a, b) => a - b)) {
    gap = marked.has(year) ? 0 : gap + 1;
    longest = Math.max(longest, gap);
  }
  return longest;
}

export function percentile(values: number[], percentile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)]!;
}

function difference(before: PlayerState, after: PlayerState) {
  const changes: Record<string, unknown> = {};
  for (const key of ['attributes', 'region_id', 'identity_id', 'highest_identity_id', 'injuries', 'achievements'] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key], after: after[key] };
  }
  const materialFlags = (flags: string[]) => flags.filter(flag => flag !== 'F_LIFE_DIRECTION_TURN_USED' && flag !== 'F_LIFE_HISTORICAL_TURN_USED').sort();
  const oldFlags = materialFlags(before.flags), newFlags = materialFlags(after.flags);
  if (JSON.stringify(oldFlags) !== JSON.stringify(newFlags)) {
    changes.flags = { added: newFlags.filter(flag => !oldFlags.includes(flag)), removed: oldFlags.filter(flag => !newFlags.includes(flag)) };
  }
  const chains = (player: PlayerState) => player.chains.map(({ chain_id, instance_id, status }) => ({ chain_id, instance_id, status }));
  if (JSON.stringify(chains(before)) !== JSON.stringify(chains(after))) changes.chains = { before: chains(before), after: chains(after) };
  return changes;
}

function successful(result: CommandResult, context: string): Success {
  if (!result.ok) throw new Error(`${context}: ${result.error.code}: ${result.error.message}`);
  return result;
}

export interface LifeReport {
  strategy: Strategy; seed: number; card: string; offered_cards: string[]; targeted_card: boolean;
  start_age: number; start_year: number; age_band: string; region: string; caste: string;
  end_age: number; end_year: number; death: string; achievements: string[]; final_attributes: PlayerState['attributes'];
  choices: { year: number; event_id: string; instance_id: string; option_id: string }[];
  presented_choices: { year: number; event_id: string; instance_id: string }[];
  reached_year_10: boolean; late_exposure_years: number; late_presented_choices: number; late_successful_choices: number;
  budget_used_before_year_10: number; budget_exhausted_before_year_10: boolean;
  category_budget_exhausted_at_year_10: boolean | null;
  year_10_slots: { direction_used: boolean; historical_used: boolean; active_chain_choices: number; choice_pending: boolean } | null;
  career_nodes: { year: number; event_id: string; instance_id: string }[];
  chain_results: { year: number; chain_id: string; action: string; reason: string | null }[];
  automatic_checks: { year: number; event_id: string; stage_id: string; raw: number; success: boolean }[];
  state_changes: { year: number; changes: Record<string, unknown> }[];
  longest_no_choice_years: number; longest_no_progress_years: number;
  late_longest_no_choice_years: number; late_longest_no_progress_years: number;
  late_choice_candidates: { conditioned_years: number; eligible_years: number; reasons: Record<string, number> };
}

export function simulateLife(content: ContentBundle, Engine: EngineConstructor, Random: RandomConstructor, uniformInt: UniformInt,
  strategy: Strategy, seed: number, targetCard?: string): LifeReport {
  const engine = new Engine(content, 'simulation');
  const random = new Random((seed ^ 0xa511e9b3) >>> 0);
  const events = new Map(content.events.map(event => [event.id, event]));
  const init = successful(engine.initGame({ seed }), `init seed=${seed} strategy=${strategy}`);
  if (init.pending?.kind !== 'card') throw new Error('Engine did not offer opening cards');
  const offers = [...init.pending.cards];
  let previous: GameView = init.state;
  let command = 0;
  const context = () => `seed=${seed} strategy=${strategy} command=${command}`;
  const nextId = () => `simulation:${command++}`;
  const startYear = init.state.player.start_year;
  const lateStart = startYear + 9;
  const exposedYears = new Set<number>();
  const progressYears = new Set<number>();
  const presented = new Map<string, LifeReport['presented_choices'][number]>();
  const choices = new Map<string, LifeReport['choices'][number]>();
  const careerNodes: LifeReport['career_nodes'] = [];
  const chainResults: LifeReport['chain_results'] = [];
  const automaticChecks: LifeReport['automatic_checks'] = [];
  const stateChanges: LifeReport['state_changes'] = [];
  const candidateStats: LifeReport['late_choice_candidates'] = { conditioned_years: 0, eligible_years: 0, reasons: {} };
  const conditionedYears = new Set<number>(), eligibleYears = new Set<number>();
  let lateEntry: { direction_used: boolean; historical_used: boolean; active_chain_choices: number; choice_pending: boolean } | null = null;

  function capture(result: Success) {
    const year = result.state.player.calendar_year;
    if (result.state.status !== 'ENDED') exposedYears.add(year);
    if (year >= lateStart && lateEntry === null && (result.state.status !== 'ENDED' || result.logs.some(log => log.type === 'event' || log.type === 'draw'))) {
      const player = result.state.player;
      lateEntry = {
        direction_used: player.flags.includes('F_LIFE_DIRECTION_TURN_USED'),
        historical_used: player.flags.includes('F_LIFE_HISTORICAL_TURN_USED'),
        active_chain_choices: player.chains.filter(chain => chain.status === 'active').reduce((sum, chain) => {
          const definition = content.chains.find(candidate => candidate.id === chain.chain_id);
          if (!definition) throw new Error(`Unknown active chain ${chain.chain_id}`);
          return sum + definition.nodes.slice(chain.node_index).filter(node => events.get(node.event_id)?.interaction === 'choice').length;
        }, 0),
        choice_pending: result.pending?.kind === 'option',
      };
    }
    const changes = difference(previous.player, result.state.player);
    if (Object.keys(changes).length) { stateChanges.push({ year, changes }); progressYears.add(year); }
    for (const log of result.logs as LogEntry[]) {
      if (log.type === 'event' || log.type === 'draw') exposedYears.add(log.calendar_year);
      if (log.type === 'event') {
        const event = events.get(log.source_id);
        if (!event) throw new Error(`Unknown logged event ${log.source_id}`);
        const row = { year: log.calendar_year, event_id: log.source_id, instance_id: log.data.event_instance_id };
        if (event.interaction === 'choice') presented.set(row.instance_id, row);
        if (event.trigger.kind === 'chain') careerNodes.push(row);
      } else if (log.type === 'option') {
        choices.set(log.data.event_instance_id, { year: log.calendar_year, event_id: log.source_id, instance_id: log.data.event_instance_id, option_id: log.data.option_id });
      } else if (log.type === 'chain') {
        chainResults.push({ year: log.calendar_year, chain_id: log.data.chain_id, action: log.data.action, reason: log.data.reason });
      } else if (log.type === 'dice' && events.get(log.source_id)?.interaction === 'automatic') {
        automaticChecks.push({ year: log.calendar_year, event_id: log.source_id, stage_id: log.data.stage_id, raw: log.data.raw, success: log.data.success });
      } else if (log.type === 'draw' && log.source_id === 'random' && log.calendar_year >= lateStart) {
        for (const candidate of log.data.candidates) {
          if (events.get(candidate.event_id)?.interaction !== 'choice') continue;
          const reason = candidate.reason ?? (candidate.gate_passed === false ? 'PROBABILITY_GATE' : 'ELIGIBLE');
          candidateStats.reasons[reason] = (candidateStats.reasons[reason] ?? 0) + 1;
          if (candidate.reason !== 'CONDITION_NOT_MET' && candidate.reason !== 'ZERO_WEIGHT') conditionedYears.add(log.calendar_year);
          if (candidate.eligible && candidate.gate_passed) eligibleYears.add(log.calendar_year);
        }
      }
    }
    previous = result.state;
  }

  const card = targetCard ?? offers[0]!;
  if (!offers.includes(card)) {
    const replace = (engine as InstanceType<EngineConstructor> & { replaceCardOffer?: (id: string, previous: string, next: string) => CommandResult }).replaceCardOffer;
    if (!replace) throw new Error('Targeted cards outside the original offer require replaceCardOffer; this engine predates the feature');
    capture(successful(replace.call(engine, nextId(), offers[0]!, card), context()));
  }
  capture(successful(engine.selectCard(nextId(), card), context()));
  while (previous.status !== 'ENDED') {
    if (command >= 1000) throw new Error(`${context()}: exceeded 1000 commands without a normal death`);
    const pending = engine.current().pending;
    let result: CommandResult;
    if (pending?.kind === 'option') {
      const event = events.get(pending.event_id);
      if (!event) throw new Error(`${context()}: unknown event ${pending.event_id}`);
      const option = chooseOption(pending, event, strategy, length => uniformInt(0, length - 1, random));
      result = engine.resolveOption(nextId(), pending.event_instance_id, option.id);
    } else if (pending?.kind === 'stage') result = engine.resolveStage(nextId(), pending.event_instance_id, pending.stage_id);
    else if (pending === null && previous.status === 'READY') result = engine.nextYear(nextId());
    else throw new Error(`${context()}: unexpected state ${previous.status} / ${pending?.kind ?? 'none'}`);
    capture(successful(result, context()));
  }
  const ending = engine.generateEndingReport();
  if (ending.end_reason !== 'death') throw new Error(`${context()}: non-death ending`);
  const selected = [...choices.values()], encountered = [...presented.values()];
  if (selected.length < 1 || selected.length > 5) throw new Error(`${context()}: ${selected.length} successful choices, expected 1–5`);
  if (selected.some(choice => !presented.has(choice.instance_id))) throw new Error(`${context()}: choice without a presented event`);
  const years = [...exposedYears], lateYears = years.filter(year => year >= lateStart);
  candidateStats.conditioned_years = conditionedYears.size; candidateStats.eligible_years = eligibleYears.size;
  const usedBeforeLate = selected.filter(choice => choice.year < lateStart).length;
  const slots = lateEntry as LifeReport['year_10_slots'];
  const categoryExhausted = slots === null ? null : usedBeforeLate >= 5 || (slots.direction_used && slots.historical_used && slots.active_chain_choices === 0 && !slots.choice_pending);
  const band = content.rules.age_bands.find(value => init.state.player.start_age >= value.min && init.state.player.start_age <= value.max)?.id ?? 'unknown';
  return {
    strategy, seed, card, offered_cards: offers, targeted_card: targetCard !== undefined,
    start_age: init.state.player.start_age, start_year: startYear, age_band: band, region: init.state.player.region_id, caste: init.state.player.caste_id,
    end_age: ending.end_age, end_year: ending.end_year, death: ending.death_id, achievements: ending.achievements, final_attributes: ending.final_attributes,
    choices: selected, presented_choices: encountered, reached_year_10: lateYears.length > 0, late_exposure_years: lateYears.length,
    late_presented_choices: encountered.filter(choice => choice.year >= lateStart).length,
    late_successful_choices: selected.filter(choice => choice.year >= lateStart).length,
    budget_used_before_year_10: usedBeforeLate, budget_exhausted_before_year_10: usedBeforeLate >= 5,
    category_budget_exhausted_at_year_10: categoryExhausted, year_10_slots: slots,
    career_nodes: careerNodes, chain_results: chainResults, automatic_checks: automaticChecks, state_changes: stateChanges,
    longest_no_choice_years: longestGap(years, selected.map(choice => choice.year)),
    longest_no_progress_years: longestGap(years, progressYears),
    late_longest_no_choice_years: longestGap(lateYears, selected.map(choice => choice.year)),
    late_longest_no_progress_years: longestGap(lateYears, progressYears), late_choice_candidates: candidateStats,
  };
}

function counts(values: string[]) {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}
function distribution(values: number[]) {
  return { n: values.length, p50: percentile(values, 0.5), p90: percentile(values, 0.9), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null };
}
export function summarize(lives: LifeReport[], content: ContentBundle) {
  return Object.fromEntries((['all', ...strategies] as const).map(strategy => {
    const group = strategy === 'all' ? lives : lives.filter(life => life.strategy === strategy), survivors = group.filter(life => life.reached_year_10);
    const unspent = survivors.filter(life => !life.budget_exhausted_before_year_10);
    const categoryOpen = survivors.filter(life => life.category_budget_exhausted_at_year_10 === false);
    const age = counts(group.map(life => life.age_band)), cards = counts(group.map(life => life.card));
    const years = counts(group.map(life => String(life.start_year)));
    const reasons: Record<string, number> = {};
    for (const life of survivors) for (const [reason, count] of Object.entries(life.late_choice_candidates.reasons)) reasons[reason] = (reasons[reason] ?? 0) + count;
    return [strategy, {
      lives: group.length, deaths_before_year_10: group.length - survivors.length,
      early_death_rate: group.length ? (group.length - survivors.length) / group.length : null,
      survivors_year_10: survivors.length, late_exposure_years: distribution(survivors.map(life => life.late_exposure_years)),
      total_choices: distribution(group.map(life => life.choices.length)),
      late_presented_choices: distribution(survivors.map(life => life.late_presented_choices)),
      late_successful_choices: distribution(survivors.map(life => life.late_successful_choices)),
      late_career_nodes: distribution(survivors.map(life => life.career_nodes.filter(node => node.year >= life.start_year + 9).length)),
      late_automatic_checks: distribution(survivors.map(life => life.automatic_checks.filter(check => check.year >= life.start_year + 9).length)),
      late_state_changes: distribution(survivors.map(life => life.state_changes.filter(change => change.year >= life.start_year + 9).length)),
      late_zero_choice_rate: survivors.length ? survivors.filter(life => life.late_successful_choices === 0).length / survivors.length : null,
      budget_exhausted_before_year_10: survivors.length - unspent.length,
      unspent_budget_survivors: unspent.length,
      unspent_budget_late_zero_choice_rate: unspent.length ? unspent.filter(life => life.late_successful_choices === 0).length / unspent.length : null,
      category_exhausted_at_year_10: survivors.filter(life => life.category_budget_exhausted_at_year_10).length,
      category_open_survivors: categoryOpen.length,
      category_open_late_zero_choice_rate: categoryOpen.length ? categoryOpen.filter(life => life.late_successful_choices === 0).length / categoryOpen.length : null,
      whole_life_no_choice_gap: distribution(group.map(life => life.longest_no_choice_years)),
      whole_life_no_progress_gap: distribution(group.map(life => life.longest_no_progress_years)),
      late_no_choice_gap: distribution(survivors.map(life => life.late_longest_no_choice_years)),
      late_no_progress_gap: distribution(survivors.map(life => life.late_longest_no_progress_years)),
      late_choice_candidate_reasons: reasons, deaths: counts(group.map(life => life.death)), cards, age_bands: age, start_years: years,
      coverage: {
        // Fewer than 10 samples makes stratified rates descriptive rather than reliable.
        low_card_samples: content.pools.find(pool => pool.id === content.rules.opening.pool_id)!.entries.filter(entry => entry.weight > 0).map(entry => entry.card_id).filter(id => (cards[id] ?? 0) < 10),
        low_age_band_samples: content.rules.age_bands.map(band => band.id).filter(id => (age[id] ?? 0) < 10),
        low_start_year_samples: Array.from({ length: content.rules.opening.year_max - content.rules.opening.year_min + 1 }, (_, i) => String(content.rules.opening.year_min + i)).filter(year => (years[year] ?? 0) < 10),
      },
    }];
  }));
}

function argumentsFor(argv: string[]) {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(`Expected --name value, got ${key ?? '<end>'}`);
    if (!['--root', '--events', '--out', '--samples', '--seed-start', '--strategy', '--target-card'].includes(key)) throw new Error(`Unknown option ${key}`);
    options[key.slice(2)] = value;
  }
  const samples = Number(options.samples ?? 100), seedStart = Number(options['seed-start'] ?? 0);
  if (!Number.isSafeInteger(samples) || samples < 1 || !Number.isSafeInteger(seedStart) || seedStart < 0 || seedStart + samples > 0x100000000) throw new Error('Invalid sample count or seed range');
  const selected = options.strategy ? options.strategy.split(',') : strategies;
  if (!selected.length || selected.some(strategy => !strategies.includes(strategy as Strategy)) || new Set(selected).size !== selected.length) throw new Error('Invalid or duplicated strategy');
  return { root: resolve(options.root ?? '.'), events: options.events ? resolve(options.events) : null, out: resolve(options.out ?? 'local/simulation/latest'), samples, seedStart, strategies: selected as Strategy[], targetCard: options['target-card'] };
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  const content = await loadContent(resolve(options.root, 'assets/resources/data/ming_end')) as ContentBundle;
  if (options.events) content.events = JSON.parse(readFileSync(options.events, 'utf8')) as Event[];
  // The engine root is runtime-selected so a captured, isolated baseline can be replayed.
  const engineModule = await import(pathToFileURL(resolve(options.root, 'src/game/core/engine/GameEngine.ts')).href);
  const randomModule = await import(pathToFileURL(resolve(options.root, 'src/game/core/engine/RandomSource.ts')).href);
  if (options.targetCard && !content.pools.find(pool => pool.id === content.rules.opening.pool_id)?.entries.some(entry => entry.card_id === options.targetCard && entry.weight > 0)) throw new Error(`Target card is not in the opening pool: ${options.targetCard}`);
  mkdirSync(dirname(options.out), { recursive: true });
  const stream = createWriteStream(`${options.out}.jsonl`, { flags: 'w' });
  const lives: LifeReport[] = [];
  try {
    for (const strategy of options.strategies) for (let offset = 0; offset < options.samples; offset++) {
      const life = simulateLife(content, engineModule.GameEngine, randomModule.Mulberry32, randomModule.uniformInt, strategy, options.seedStart + offset, options.targetCard);
      lives.push(life);
      if (!stream.write(`${JSON.stringify(life)}\n`)) await once(stream, 'drain');
    }
  } finally { stream.end(); await once(stream, 'finish'); }
  const summary = {
    root: options.root, events_override: options.events, seed_start: options.seedStart, samples_per_strategy: options.samples, selected_strategies: options.strategies,
    targeted_card: options.targetCard ?? null,
    definitions: {
      start: 'Opening year is year 1; late begins at calendar_year - start_year >= 9.',
      exposure: 'Years with a pending/ready state or a scheduled event/draw; death in the vital phase before scheduling is excluded.',
      choices: 'Successful resolveOption logs, deduplicated by event instance. Card selection and stage resolution are not choices.',
      progress: 'Net attribute/identity/region/injury/achievement/material-flag/chain-status changes; chain node visits are reported separately. Two budget bookkeeping flags and node indices are excluded.',
      budget: 'Five successful choices maximum; category exhaustion additionally requires direction and historical slots used, no pending choice and no future choice on an active chain.',
      targeted: 'Target-card runs actively replace an offer when needed and are conditional scenarios, not natural selection rates.',
      percentiles: 'Nearest rank among year-10 survivors; null denotes empty denominator.',
    },
    strategies: summarize(lives, content),
  };
  writeFileSync(`${options.out}.summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
}
