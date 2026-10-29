import type { ContentBundle, Event, Outcome } from '../types/content.generated.js';
import type { ActiveEvent, Attributes, ChainInstance, CommandParameters, EndingReport, GameSave, GameView, LogData, LogEntry, PendingDecision, PlayerState, RunState } from '../types/schema.js';
import type { CommandResult } from '../types/commands.js';
import { createContentRegistry, type ContentRegistry } from '../content/ContentRegistry.js';
import { cloneData } from './cloneData.js';
import { DomainError } from './DomainError.js';
import { Mulberry32, uniformInt } from './RandomSource.js';
import { sampleWeighted } from './WeightedSampler.js';
import { conditionContext, evaluateCondition, type ConditionContext } from './ConditionEvaluator.js';
import { resolveCheck } from './DiceResolver.js';
import { executeEffects, previewOutcome } from './EffectExecutor.js';
import { evaluateAchievements, endingReport } from './EndingEvaluator.js';
import { scheduleHistory, scheduleWeightedEvents } from './EventScheduler.js';
import { dueChains, interruptChains } from './ChainRunner.js';
import { decodeGameSave, encodeGameSave, equalData } from '../persistence/SaveCodec.js';

interface Draft { player: PlayerState; run: RunState; logs: LogEntry[]; rng: Mulberry32 }
const attributes = ['physique', 'intelligence', 'wealth', 'prestige', 'luck'] as const;
const byId = (a: { id: string }, b: { id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export class GameEngine {
  private readonly content: ContentBundle;
  private readonly registry: ContentRegistry;
  private saved: GameSave['payload'] | null = null;
  constructor(content: ContentBundle, private readonly fingerprint: string) {
    this.content = cloneData(content);
    this.registry = createContentRegistry(this.content);
  }
  current(): { state: GameView; pending: PendingDecision | null } {
    if (!this.saved) throw new DomainError('NOT_INITIALIZED');
    const pending = this.pending(this.saved.player, this.saved.run);
    return { state: this.view(this.saved.player, this.saved.run, pending), pending: cloneData(pending) };
  }
  private view(player: PlayerState, run: RunState, pending = this.pending(player, run)): GameView {
    return cloneData({ player, status: run.status, timeline: run.timeline, year_phase: run.year_phase, active_event: run.active_event, revision: run.revision, pending });
  }
  private pending(player: PlayerState, run: RunState): PendingDecision | null {
    const active = run.active_event;
    if (!active || run.status === 'ENDED') return null;
    const event = this.registry.events.get(active.event_id)!;
    if (active.stage_id !== null) {
      const stage = event.stages!.find(s => s.id === active.stage_id)!;
      return { kind: 'stage', event_instance_id: active.instance_id, event_id: event.id, stage_id: stage.id, text: stage.text, check: cloneData(stage.check) };
    }
    if (event.interaction !== 'choice') return null;
    const context = conditionContext(player, run.timeline);
    return { kind: 'option', event_instance_id: active.instance_id, event_id: event.id, options: event.options.map(option => {
      const condition = evaluateCondition(option.condition, context);
      const available = condition && previewOutcome(option.outcome, player, run, this.content, this.registry);
      return { id: option.id, text: option.text, available, reason: available ? null : condition ? 'OUTCOME_NOT_APPLICABLE' : option.unavailable_text };
    }) };
  }
  private available(event: Event, draft: Draft): boolean {
    return event.interaction === 'automatic' || event.options.some(o => evaluateCondition(o.condition, conditionContext(draft.player, draft.run.timeline)) && previewOutcome(o.outcome, draft.player, draft.run, this.content, this.registry));
  }
  private log<K extends keyof LogData>(draft: Draft, type: K, source_id: string, message: string, data: LogData[K]): void {
    draft.logs.push({ seq: (this.saved?.logs.length ?? 0) + draft.logs.length + 1, age: draft.player.age, calendar_year: draft.player.calendar_year, type, source_id, message, data } as LogEntry);
  }
  private draft(): Draft {
    if (!this.saved) throw new DomainError('NOT_INITIALIZED');
    const { processed_commands, ...mutable } = this.saved.run;
    return { player: cloneData(this.saved.player), run: { ...cloneData(mutable), processed_commands }, logs: [], rng: Mulberry32.restore(this.saved.run.prng) };
  }
  private commit(draft: Draft, commandId?: string, parameters?: CommandParameters): CommandResult {
    draft.run.prng = draft.rng.exportState();
    draft.run.revision++;
    const pending = this.pending(draft.player, draft.run);
    const result: Extract<CommandResult, { ok: true }> = { ok: true, state: this.view(draft.player, draft.run, pending), logs: cloneData(draft.logs), pending: cloneData(pending) };
    if (commandId !== undefined && parameters) draft.run.processed_commands[commandId] = { parameters, result: cloneData(result) };
    if (this.saved) {
      this.saved.player = draft.player; this.saved.run = draft.run; this.saved.logs.push(...draft.logs);
    } else this.saved = { player: draft.player, run: draft.run, logs: draft.logs };
    return result;
  }
  private command(commandId: string, parameters: CommandParameters, apply: (draft: Draft) => void): CommandResult {
    if (!this.saved) throw new DomainError('NOT_INITIALIZED');
    const previous = Object.hasOwn(this.saved.run.processed_commands, commandId) ? this.saved.run.processed_commands[commandId] : undefined;
    if (previous) {
      if (JSON.stringify(previous.parameters) === JSON.stringify(parameters)) return cloneData(previous.result);
      return { ok: false, error: { code: 'COMMAND_ID_CONFLICT', message: 'Command ID has different parameters' }, state: this.current().state };
    }
    try {
      if (!commandId) throw new DomainError('INVALID_COMMAND_ID');
      const draft = this.draft(); apply(draft); evaluateAchievements(this.content, draft.player, draft.run);
      return this.commit(draft, commandId, parameters);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return { ok: false, error: { code: error.code, message: error.message }, state: this.current().state };
    }
  }
  initGame(options: { seed: number }): CommandResult {
    if (this.saved) return { ok: false, error: { code: 'ALREADY_INITIALIZED', message: 'Create a new engine to begin another life' }, state: this.current().state };
    const rng = new Mulberry32(options.seed);
    const c = this.content;
    const band = sampleWeighted([...c.rules.age_bands].sort(byId), a => a.weight, rng);
    const age = uniformInt(band.min, band.max, rng);
    const year = uniformInt(c.rules.opening.year_min, c.rules.opening.year_max, rng);
    const context: ConditionContext = { age, calendar_year: year, physique: 0, intelligence: 0, wealth: 0, prestige: 0, luck: 0,
      region_id: '', caste_id: '', identity_id: '', timeline: 'historical', cards: [], flags: [], injuries: [], completed_chains: [] };
    const pairs = [...c.regions].sort(byId).flatMap(region => [...c.castes].sort(byId).map(caste => ({ region, caste, weight: region.weight * caste.weight })))
      .filter(pair => pair.weight > 0 && c.era.backgrounds.some(background => background.weight > 0 && evaluateCondition(background.condition, { ...context, region_id: pair.region.id, caste_id: pair.caste.id })));
    const pair = sampleWeighted(pairs, p => p.weight, rng);
    context.region_id = pair.region.id; context.caste_id = pair.caste.id;
    const background = sampleWeighted([...c.era.backgrounds].sort(byId).filter(b => evaluateCondition(b.condition, context)), b => b.weight, rng);
    const pool = this.registry.pools.get(c.rules.opening.pool_id)!;
    const card = sampleWeighted([...pool.entries].sort((a, b) => a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0), entry => entry.weight, rng).card_id;
    const max_lifespan = uniformInt(Math.max(c.rules.lifespan.min, age + c.rules.lifespan.min_remaining_years), c.rules.lifespan.max, rng);
    const values = {} as Attributes;
    const sources = [band, pair.caste, pair.region, background];
    for (const key of attributes) values[key] = Math.max(c.rules.attributes.min, Math.min(c.rules.attributes.max, c.rules.attributes.base + sources.reduce((sum, source) => sum + (source.modifiers[key] ?? 0), 0)));
    const player: PlayerState = { era_id: c.era.id, start_age: age, age, max_lifespan, start_year: year, calendar_year: year,
      region_id: pair.region.id, caste_id: pair.caste.id, identity_id: background.identity_id, highest_identity_id: background.identity_id, attributes: values,
      cards: [card], flags: [...new Set([pair.caste, pair.region, background].flatMap(source => source.flags))], injuries: [], chains: [], achievements: [] };
    const run: RunState = { run_id: `life:${this.fingerprint}:${options.seed}`, seed: options.seed, prng: rng.exportState(), status: 'ADVANCING', timeline: 'historical', year_phase: 'opening', queue: [], queue_cursor: 0,
      event_counter: 0, chain_counter: 0, active_event: null, processed_history: [], cooldowns: Object.create(null), event_counts: Object.create(null),
      dice_results: [], death: null, ending: null, processed_commands: Object.create(null), revision: 0 };
    const draft: Draft = { player, run, logs: [], rng };
    this.log(draft, 'opening', background.id, background.text, { background_id: background.id, age_band_id: band.id, card_id: card });
    evaluateAchievements(c, player, run);
    run.queue = this.weighted(draft, 'opening');
    this.resume(draft);
    return this.commit(draft);
  }
  resolveOption(commandId: string, eventInstanceId: string, optionId: string): CommandResult {
    return this.command(commandId, { api: 'resolveOption', args: [eventInstanceId, optionId] }, draft => {
      const active = draft.run.active_event;
      if (draft.run.status !== 'AWAITING_OPTION' || active?.instance_id !== eventInstanceId) throw new DomainError('STALE_DECISION');
      const event = this.registry.events.get(active.event_id)!;
      if (event.interaction !== 'choice') throw new DomainError('STALE_DECISION');
      const option = event.options.find(o => o.id === optionId);
      const pending = this.pending(draft.player, draft.run);
      if (!option || pending?.kind !== 'option' || !pending.options.find(o => o.id === optionId)?.available) throw new DomainError('OPTION_UNAVAILABLE');
      this.log(draft, 'option', event.id, option.text, { event_instance_id: eventInstanceId, option_id: optionId });
      this.applyOutcome(draft, option.outcome, event.id); this.route(draft, option.outcome, active); this.resume(draft);
    });
  }
  resolveStage(commandId: string, eventInstanceId: string, stageId: string): CommandResult {
    return this.command(commandId, { api: 'resolveStage', args: [eventInstanceId, stageId] }, draft => {
      const active = draft.run.active_event;
      if (draft.run.status !== 'AWAITING_STAGE' || active?.instance_id !== eventInstanceId || active.stage_id !== stageId) throw new DomainError('STALE_DECISION');
      const event = this.registry.events.get(active.event_id)!;
      const stage = event.stages!.find(s => s.id === stageId)!;
      const dice = resolveCheck(stage.check, draft.player.attributes[stage.check.attribute], this.content.rules.check, draft.rng);
      draft.run.dice_results.push(dice);
      this.log(draft, 'dice', event.id, stage.text, { ...dice, event_instance_id: eventInstanceId, stage_id: stageId });
      const outcome = dice.success ? stage.success : stage.failure;
      this.applyOutcome(draft, outcome, event.id); this.route(draft, outcome, active); this.resume(draft);
    });
  }
  private chainLog(draft: Draft, chain: ChainInstance, action: 'started' | 'interrupted' | 'completed'): void {
    this.log(draft, 'chain', chain.chain_id, action === 'interrupted' ? chain.interruption_reason! : this.registry.chains.get(chain.chain_id)!.name,
      { instance_id: chain.instance_id, chain_id: chain.chain_id, action, reason: chain.interruption_reason });
  }
  private applyOutcome(draft: Draft, outcome: Outcome, source: string): void {
    executeEffects(outcome.effects, draft.player, draft.run, this.content, this.registry, {
      chain: (chain, action) => this.chainLog(draft, chain, action), death: id => this.end(draft, id),
    });
    this.log(draft, 'effects', source, outcome.text, { effects: outcome.effects });
    evaluateAchievements(this.content, draft.player, draft.run);
  }
  private route(draft: Draft, outcome: Outcome, active: ActiveEvent): void {
    if (draft.run.status === 'ENDED') return;
    const chain = active.chain_instance_id ? draft.player.chains.find(c => c.instance_id === active.chain_instance_id) : undefined;
    if (outcome.next_stage_id !== null && (!chain || chain.status === 'active')) {
      active.stage_id = outcome.next_stage_id; draft.run.status = 'AWAITING_STAGE'; return;
    }
    draft.run.active_event = null; draft.run.status = 'ADVANCING';
    if (chain?.status === 'active') {
      const definition = this.registry.chains.get(chain.chain_id)!;
      chain.node_index++;
      const next = definition.nodes[chain.node_index];
      if (next) chain.next_due_year = chain.started_year + next.after_years;
      else {
        chain.status = 'completed'; chain.next_due_year = null;
        this.applyOutcome(draft, definition.completion, chain.chain_id); this.chainLog(draft, chain, 'completed');
      }
    }
  }
  private weighted(draft: Draft, kind: 'opening' | 'random') {
    return scheduleWeightedEvents(this.content, draft.player, draft.run, kind, draft.rng, event => this.available(event, draft), (candidates, selected) => {
      this.log(draft, 'draw', kind, selected === null ? this.content.era.fallback_text : this.registry.events.get(selected)!.text, { candidates, selected_event_id: selected });
    });
  }
  private resume(draft: Draft): void {
    const run = draft.run;
    while (run.status !== 'ENDED' && !run.active_event) {
      if (run.queue_cursor < run.queue.length) {
        const entry = run.queue[run.queue_cursor++]!;
        const event = this.registry.events.get(entry.event_id)!;
        const chain = entry.chain_instance_id ? draft.player.chains.find(c => c.instance_id === entry.chain_instance_id) : undefined;
        if (event.trigger.kind === 'historical' && !run.processed_history.includes(event.id)) run.processed_history.push(event.id);
        let reason: string | null = null;
        if (chain && chain.status !== 'active') reason = 'CHAIN_INTERRUPTED';
        else if (!evaluateCondition(event.condition, conditionContext(draft.player, run.timeline))) reason = 'CONDITION_NOT_MET';
        else if (!this.available(event, draft)) reason = 'NO_AVAILABLE_OPTION';
        if (reason) {
          this.log(draft, 'skip', event.id, reason, { reason });
          if (chain?.status === 'active') { chain.status = 'interrupted'; chain.next_due_year = null; chain.interruption_reason = reason; this.chainLog(draft, chain, 'interrupted'); }
          continue;
        }
        const active: ActiveEvent = { ...entry, instance_id: `${run.run_id}:event:${++run.event_counter}`, stage_id: null };
        run.active_event = active;
        run.event_counts[event.id] = (run.event_counts[event.id] ?? 0) + 1;
        if (event.trigger.kind === 'random') run.cooldowns[event.id] = draft.player.calendar_year + event.trigger.cooldown_years;
        this.log(draft, 'event', event.id, event.text, { event_instance_id: active.instance_id });
        if (event.interaction === 'choice') { run.status = 'AWAITING_OPTION'; return; }
        this.applyOutcome(draft, event.outcome, event.id); this.route(draft, event.outcome, active);
        continue;
      }
      run.queue = []; run.queue_cursor = 0;
      switch (run.year_phase) {
        case 'opening': case 'chains': run.year_phase = 'history'; run.queue = scheduleHistory(this.content, draft.player, run); break;
        case 'history':
          if (run.timeline === 'historical' && draft.player.calendar_year >= this.content.era.historical_end_year) {
            run.timeline = 'fictional'; this.log(draft, 'history_switch', this.content.era.id, '架空推演', { timeline: 'fictional' });
          }
          run.year_phase = 'random'; run.queue = this.weighted(draft, 'random'); break;
        case 'random': run.year_phase = 'complete'; break;
        case 'complete': run.status = 'READY'; return;
        case 'vital': throw new DomainError('INVALID_STATE', 'Vital phase cannot resume without annual processing');
      }
    }
  }
  private end(draft: Draft, death: string | null): void {
    draft.run.death = death; draft.run.status = 'ENDED'; draft.run.active_event = null; draft.run.queue = []; draft.run.queue_cursor = 0;
    evaluateAchievements(this.content, draft.player, draft.run);
    if (death !== null) this.log(draft, 'death', death, this.registry.deaths.get(death)!.text, { death_id: death });
    draft.run.ending = endingReport(this.content, this.fingerprint, draft.player, draft.run, [...(this.saved?.logs ?? []), ...draft.logs]);
    this.log(draft, 'ending', draft.run.ending.primary_achievement_id ?? '', draft.run.ending.primary_achievement_id ? this.registry.achievements.get(draft.run.ending.primary_achievement_id)!.text : '普通人生',
      { end_reason: death === null ? 'retired' : 'death', primary_achievement_id: draft.run.ending.primary_achievement_id });
  }
  nextYear(commandId: string): CommandResult {
    return this.command(commandId, { api: 'nextYear', args: [] }, draft => {
      if (draft.run.status !== 'READY') throw new DomainError('INVALID_STATE');
      draft.player.age++; draft.player.calendar_year++;
      draft.run.status = 'ADVANCING'; draft.run.year_phase = 'vital';
      if (draft.player.age >= draft.player.max_lifespan) { this.end(draft, this.content.era.old_age_death_id); return; }
      interruptChains(draft.player, draft.run, this.registry, chain => this.chainLog(draft, chain, 'interrupted'));
      for (const id of [...draft.player.injuries].sort()) {
        const injury = this.registry.injuries.get(id)!;
        this.applyOutcome(draft, { text: injury.name, effects: injury.annual_effects, next_stage_id: null }, id);
        if (draft.run.death !== null) return;
      }
      draft.run.year_phase = 'chains'; draft.run.queue = dueChains(draft.player, this.registry); draft.run.queue_cursor = 0;
      this.resume(draft);
    });
  }
  retire(commandId: string): CommandResult {
    return this.command(commandId, { api: 'retire', args: [] }, draft => {
      if (draft.run.status !== 'READY' || !draft.player.achievements.some(id => this.registry.achievements.get(id)!.retirable)) throw new DomainError('RETIRE_UNAVAILABLE');
      this.end(draft, null);
    });
  }
  generateEndingReport(): EndingReport {
    if (!this.saved?.run.ending) throw new DomainError('RUN_NOT_ENDED');
    return cloneData(this.saved.run.ending);
  }
  exportSave(): GameSave {
    if (!this.saved) throw new DomainError('NOT_INITIALIZED');
    return encodeGameSave(this.content, this.fingerprint, this.saved);
  }
  restoreSave(data: GameSave): void {
    const invalid = (): never => { throw new DomainError('SAVE_INVALID', 'Save does not match a valid deterministic command history'); };
    data = decodeGameSave(data, this.content, this.fingerprint);
    try {
      if (!data.payload || !data.payload.run || !Number.isSafeInteger(data.revision) || data.revision < 1) invalid();
      const commands = data.payload.run.processed_commands;
      if (!commands || typeof commands !== 'object' || Array.isArray(commands)) invalid();
      const entries = Object.entries(commands);
      if (entries.length !== data.revision - 1) invalid();
      const replay = new GameEngine(this.content, this.fingerprint);
      replay.initGame({ seed: data.payload.run.seed });
      entries.sort((a, b) => a[1].result.state.revision - b[1].result.state.revision);
      for (const [id, receipt] of entries) {
        if (!receipt || !receipt.parameters || !Array.isArray(receipt.parameters.args)) invalid();
        const { api, args } = receipt.parameters;
        if (!args.every(arg => typeof arg === 'string')) invalid();
        let result: CommandResult;
        switch (api) {
          case 'nextYear': if (args.length !== 0) invalid(); result = replay.nextYear(id); break;
          case 'retire': if (args.length !== 0) invalid(); result = replay.retire(id); break;
          case 'resolveOption': if (args.length !== 2) invalid(); result = replay.resolveOption(id, args[0]!, args[1]!); break;
          case 'resolveStage': if (args.length !== 2) invalid(); result = replay.resolveStage(id, args[0]!, args[1]!); break;
          default: return invalid();
        }
        if (!result.ok) invalid();
      }
      // Exact recursive comparison validates fields, references, cursors, receipts and logs,
      // including unknown keys, and proves reachability through the real rules.
      if (!equalData(data, replay.exportSave())) invalid();
      this.saved = replay.saved;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'SAVE_INVALID') throw error;
      invalid();
    }
  }
}
