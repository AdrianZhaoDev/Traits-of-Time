import type { ContentBundle } from '../types/content.generated.js';
import type { EndingReport, LogEntry, PlayerState, RunState } from '../types/schema.js';
import { conditionContext, evaluateCondition } from './ConditionEvaluator.js';
import { DomainError } from './DomainError.js';
export function evaluateAchievements(content: ContentBundle, player: PlayerState, run: RunState, notify: (id: string) => void): void {
  const context = conditionContext(player, run.timeline);
  for (const achievement of [...content.achievements].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (achievement.category !== 'life' && !player.achievements.includes(achievement.id) && evaluateCondition(achievement.condition, context)) {
      player.achievements.push(achievement.id);
      notify(achievement.id);
    }
  }
}
export function endingReport(content: ContentBundle, fingerprint: string, player: PlayerState, run: RunState, logs: readonly LogEntry[]): EndingReport {
  if (run.status !== 'ENDED' || run.death === null) throw new DomainError('RUN_NOT_ENDED');
  if (!content.deaths.some(death => death.id === run.death)) throw new DomainError('INVALID_STATE', 'Ending requires a valid death');
  const byPriority = (a: ContentBundle['achievements'][number], b: ContentBundle['achievements'][number]) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const achieved = content.achievements.filter(a => player.achievements.includes(a.id)).sort(byPriority);
  const context = conditionContext(player, run.timeline);
  const life = content.achievements.filter(a => a.category === 'life' && evaluateCondition(a.condition, context)).sort(byPriority);
  const legacy = achieved.filter(a => a.category === undefined);
  return { content_id: content.manifest.content_id, content_version: content.manifest.content_version, content_fingerprint: fingerprint, seed: run.seed,
    start_age: player.start_age, end_age: player.age, start_year: player.start_year, end_year: player.calendar_year, years_played: player.calendar_year - player.start_year,
    end_reason: 'death', death_id: run.death, primary_achievement_id: life[0]?.id ?? legacy[0]?.id ?? null,
    milestone_achievement_ids: achieved.filter(a => a.category === 'milestone').map(a => a.id),
    anecdote_achievement_ids: achieved.filter(a => a.category === 'anecdote').map(a => a.id),
    achievements: [...player.achievements], highest_identity_id: player.highest_identity_id,
    chains_completed: player.chains.filter(c => c.status === 'completed').map(c => ({ ...c })), chains_interrupted: player.chains.filter(c => c.status === 'interrupted').map(c => ({ ...c })),
    key_decisions: logs.filter(l => l.type === 'option' || l.type === 'dice'), final_attributes: { ...player.attributes } };
}
