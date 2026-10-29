import type { Effect, Stage } from './content.generated.js';
import type { CommandResult } from './commands.js';
export type Timeline = 'historical' | 'fictional';
export type GameStatus = 'READY' | 'ADVANCING' | 'AWAITING_OPTION' | 'AWAITING_STAGE' | 'ENDED';
export type YearPhase = 'opening' | 'vital' | 'chains' | 'history' | 'random' | 'complete';
export type Attributes = Record<'physique' | 'intelligence' | 'wealth' | 'prestige' | 'luck', number>;
export interface ChainInstance {
  instance_id: string; chain_id: string; started_year: number; next_due_year: number | null; node_index: number;
  status: 'active' | 'completed' | 'interrupted'; interruption_reason: string | null;
}
export interface PlayerState {
  era_id: string; start_age: number; age: number; max_lifespan: number; start_year: number; calendar_year: number;
  region_id: string; caste_id: string; identity_id: string; highest_identity_id: string; attributes: Attributes;
  traits: string[]; flags: string[]; injuries: string[]; chains: ChainInstance[]; achievements: string[];
}
export interface DiceResult { raw: number; attribute_value: number; modifier_before: number; modifier_after: number; dc: number; success: boolean; success_probability: number }
export interface QueueEntry { event_id: string; chain_instance_id: string | null }
export interface ActiveEvent extends QueueEntry { instance_id: string; stage_id: string | null }
export type PendingDecision =
  | { kind: 'option'; event_instance_id: string; event_id: string; options: { id: string; text: string; available: boolean; reason: string | null }[] }
  | { kind: 'stage'; event_instance_id: string; event_id: string; stage_id: string; text: string; check: Stage['check'] };
export interface CandidateLog { event_id: string; eligible: boolean; reason: string | null; gate_passed: boolean | null; effective_weight: number; conditional_probability: number | null }
export interface LogData {
  opening: { background_id: string; age_band_id: string; trait_ids: string[] };
  draw: { candidates: CandidateLog[]; selected_event_id: string | null };
  event: { event_instance_id: string };
  option: { event_instance_id: string; option_id: string };
  dice: DiceResult & { event_instance_id: string; stage_id: string };
  effects: { effects: Effect[] };
  chain: { instance_id: string; chain_id: string; action: 'started' | 'completed' | 'interrupted'; reason: string | null };
  history_switch: { timeline: Timeline };
  death: { death_id: string };
  ending: { end_reason: 'death' | 'retired'; primary_achievement_id: string | null };
  skip: { reason: string };
}
export type LogEntry = { [K in keyof LogData]: { seq: number; age: number; calendar_year: number; type: K; source_id: string; message: string; data: LogData[K] } }[keyof LogData];
export interface EndingReport {
  content_id: string; content_version: string; content_fingerprint: string; seed: number;
  start_age: number; end_age: number; start_year: number; end_year: number; years_played: number;
  end_reason: 'death' | 'retired'; death_id: string | null; primary_achievement_id: string | null;
  achievements: string[]; highest_identity_id: string; chains_completed: ChainInstance[]; chains_interrupted: ChainInstance[];
  key_decisions: LogEntry[]; final_attributes: Attributes;
}
export interface CommandParameters { api: 'nextYear' | 'resolveOption' | 'resolveStage' | 'retire'; args: string[] }
export interface CommandReceipt { parameters: CommandParameters; result: Extract<CommandResult, { ok: true }> }
export interface RunState {
  run_id: string; seed: number; prng: { algorithm: 'mulberry32-v1'; state: number; draws: number };
  status: GameStatus; timeline: Timeline; year_phase: YearPhase; queue: QueueEntry[]; queue_cursor: number;
  event_counter: number; chain_counter: number; active_event: ActiveEvent | null; processed_history: string[];
  cooldowns: Record<string, number>; event_counts: Record<string, number>; remaining_choice_budget: number;
  dice_results: DiceResult[]; death: string | null; ending: EndingReport | null;
  processed_commands: Record<string, CommandReceipt>; revision: number;
}
export interface GameView { player: PlayerState; status: GameStatus; timeline: Timeline; year_phase: YearPhase; active_event: ActiveEvent | null; revision: number; pending: PendingDecision | null }
export interface GameSave {
  save_version: 1; kind: 'life'; content_id: string; content_version: string; content_fingerprint: string; revision: number;
  payload: { player: PlayerState; run: RunState; logs: LogEntry[] };
}
