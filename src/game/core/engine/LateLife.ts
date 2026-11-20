import type { ContentBundle } from '../types/content.generated';
import type { LateLifePhase, LogData, PlayerState, RunState } from '../types/schema';
import { conditionContext, evaluateCondition } from './ConditionEvaluator';

/** Classify once per real year. Entry thresholds and wider retain thresholds are content-owned. */
export function updateLateLife(content: ContentBundle, player: PlayerState, run: RunState, log: (data: LogData['late_life']) => void): void {
  const rules = content.rules.late_life;
  const elapsed = player.calendar_year - player.start_year;
  if (!rules || elapsed < rules.start_years) return;
  const state = player.late_life;
  const phase: LateLifePhase = elapsed >= rules.settlement_years && player.age >= rules.settlement_age ? 'settlement'
    : elapsed >= rules.expansion_years ? 'expansion' : 'realization';
  const emit = (action: LogData['late_life']['action'], previous: string | null, reason: string): void => {
    log({ action, route_id: state.route_id, previous_route_id: previous, candidate_route_id: state.candidate_route_id, reason, phase, years_elapsed: elapsed });
  };
  if (state.phase !== phase) {
    const previous = state.phase;
    state.phase = phase;
    if (previous !== null) emit('phase', state.route_id, 'STAGE_THRESHOLD');
  }
  const context = conditionContext(player, run.timeline);
  const desired = rules.routes.find(route => evaluateCondition(route.entry_condition, context));
  if (!desired) throw new Error('Late-life routes have no matching fallback');
  if (state.route_id === null) {
    state.route_id = desired.id;
    state.entered_year = player.calendar_year;
    emit('entered', null, 'INITIAL_MATCH');
    return;
  }
  const current = rules.routes.find(route => route.id === state.route_id);
  if (!current) throw new Error('Unknown late-life route');
  if (desired.id === current.id || evaluateCondition(current.retain_condition ?? current.entry_condition, context)) {
    if (state.candidate_route_id !== null) {
      state.candidate_route_id = null;
      state.candidate_years = 0;
      emit('candidate_cancelled', current.id, 'RETAIN_RESTORED');
    }
    return;
  }
  if (state.candidate_route_id !== desired.id) {
    state.candidate_route_id = desired.id;
    state.candidate_years = 1;
    emit('candidate', current.id, 'RETAIN_FAILED');
  } else state.candidate_years++;
  if (state.candidate_years >= rules.confirmation_years) {
    const previous = state.route_id;
    state.route_id = desired.id;
    state.entered_year = player.calendar_year;
    state.candidate_route_id = null;
    state.candidate_years = 0;
    emit('changed', previous, 'CONFIRMED');
  }
}
