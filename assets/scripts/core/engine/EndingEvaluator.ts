import type { ContentBundle } from '../types/content.generated.js';
import type { EndingReport, LogEntry, PlayerState, RunState } from '../types/schema.js';
import { conditionContext, evaluateCondition } from './ConditionEvaluator.js';
export function evaluateAchievements(content: ContentBundle, player: PlayerState, run: RunState): void {
  const context = conditionContext(player, run.timeline);
  for (const achievement of [...content.achievements].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (!player.achievements.includes(achievement.id) && evaluateCondition(achievement.condition, context)) player.achievements.push(achievement.id);
  }
}
export function endingReport(content: ContentBundle, fingerprint: string, player: PlayerState, run: RunState, logs: readonly LogEntry[]): EndingReport {
  const achieved = content.achievements.filter(a => player.achievements.includes(a.id)).sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { content_id: content.manifest.content_id, content_version: content.manifest.content_version, content_fingerprint: fingerprint, seed: run.seed,
    start_age: player.start_age, end_age: player.age, start_year: player.start_year, end_year: player.calendar_year, years_played: player.calendar_year - player.start_year,
    end_reason: run.death === null ? 'retired' : 'death', death_id: run.death, primary_achievement_id: achieved[0]?.id ?? null,
    achievements: [...player.achievements], highest_identity_id: player.highest_identity_id,
    chains_completed: player.chains.filter(c => c.status === 'completed').map(c => ({ ...c })), chains_interrupted: player.chains.filter(c => c.status === 'interrupted').map(c => ({ ...c })),
    key_decisions: logs.filter(l => l.type === 'option' || l.type === 'dice'), final_attributes: { ...player.attributes } };
}
