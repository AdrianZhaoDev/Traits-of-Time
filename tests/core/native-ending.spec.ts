import { describe, expect, it } from 'vitest';
import { endingReport, evaluateAchievements } from '../../assets/scripts/core/engine/EndingEvaluator.js';
import { conditionContext, evaluateCondition } from '../../assets/scripts/core/engine/ConditionEvaluator.js';
import { executeEffects } from '../../assets/scripts/core/engine/EffectExecutor.js';
import { createContentRegistry } from '../../assets/scripts/core/content/ContentRegistry.js';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import type { PlayerState, RunState } from '../../assets/scripts/core/types/schema.js';
import { loadTemplate, templateDirectory } from '../helpers/content.js';

describe('categorized endings', () => {
  it('selects a terminal life rather than a lost fortune or former identity, retaining milestones', async () => {
    const content = await loadTemplate();
    content.achievements = [
      { id: 'A_RICH', name: 'Rich', text: 'Rich', category: 'life', priority: 100, condition: { op: 'compare', field: 'wealth', comparator: 'gte', value: 8 } },
      { id: 'A_ARTISAN', name: 'Artisan', text: 'Artisan', category: 'life', priority: 95, condition: { op: 'is', field: 'identity_id', value: 'I_ARTISAN' } },
      { id: 'A_EARLY', name: 'Early', text: 'Early', category: 'life', priority: 86, condition: { op: 'compare', field: 'age', comparator: 'lt', value: 18 } },
      { id: 'A_ORDINARY', name: 'Ordinary', text: 'Ordinary', category: 'life', priority: 85, condition: { op: 'compare', field: 'age', comparator: 'gte', value: 0 } },
      { id: 'A_EARNED', name: 'Earned', text: 'Earned', category: 'milestone', priority: 70, condition: { op: 'compare', field: 'wealth', comparator: 'gte', value: 8 } },
      { id: 'A_STORY', name: 'Story', text: 'Story', category: 'anecdote', priority: 30, condition: { op: 'has', collection: 'flags', id: 'story' } },
    ];
    const player: PlayerState = { era_id: content.era.id, start_age: 18, age: 18, max_lifespan: 80, start_year: 1640, calendar_year: 1640,
      region_id: 'R_JIANGNAN', caste_id: 'C_SOLDIER', identity_id: 'I_ARTISAN', highest_identity_id: 'I_ARTISAN',
      attributes: { physique: 5, intelligence: 5, wealth: 9, prestige: 5, luck: 5 }, cards: [], flags: ['story'], injuries: [], chains: [], achievements: [] };
    const run = { timeline: 'historical', seed: 1, status: 'ENDED', death: content.era.old_age_death_id } as RunState;
    evaluateAchievements(content, player, run, () => {});
    expect(player.achievements.sort()).toEqual(['A_EARNED', 'A_STORY']);
    player.attributes.wealth = 0;
    player.identity_id = 'I_REFUGEE';
    player.flags = [];
    expect(() => endingReport(content, 'fingerprint', player, { ...run, status: 'READY' }, [])).toThrowError(expect.objectContaining({ code: 'RUN_NOT_ENDED' }));
    expect(() => endingReport(content, 'fingerprint', player, { ...run, death: null }, [])).toThrowError(expect.objectContaining({ code: 'RUN_NOT_ENDED' }));
    expect(() => endingReport(content, 'fingerprint', player, { ...run, death: 'D_UNKNOWN' }, [])).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
    const report = endingReport(content, 'fingerprint', player, run, []);
    expect(report.primary_achievement_id).toBe('A_ORDINARY');
    expect(report.milestone_achievement_ids).toEqual(['A_EARNED']);
    expect(report.anecdote_achievement_ids).toEqual(['A_STORY']);
    expect(report.highest_identity_id).toBe('I_ARTISAN');
    player.age = 8;
    player.calendar_year = 1630;
    expect(endingReport(content, 'fingerprint', player, run, []).primary_achievement_id).toBe('A_EARLY');
    const canStart = { op: 'not', condition: { op: 'has', collection: 'active_chains', id: 'CH_TEST' } } as const;
    player.chains = [{ instance_id: 'chain:1', chain_id: 'CH_TEST', started_year: 1640, next_due_year: 1641, node_index: 0, status: 'active', interruption_reason: null }];
    expect(evaluateCondition(canStart, conditionContext(player, 'historical'))).toBe(false);
    player.chains[0]!.status = 'interrupted';
    player.chains[0]!.next_due_year = null;
    player.chains[0]!.interruption_reason = 'interrupted';
    expect(evaluateCondition(canStart, conditionContext(player, 'historical'))).toBe(true);
  });

  it.each(['E_LIFE_CHILD_BIRTH', 'E_LIFE_CHILD_DAUGHTER'])('retains the real %s experience independently of terminal life', async (eventId) => {
    const { bundle: content } = await loadContent(templateDirectory);
    const registry = createContentRegistry(content);
    const event = registry.events.get(eventId)!;
    if (event.interaction !== 'automatic') throw new Error('Expected automatic childbirth event');
    const player: PlayerState = { era_id: content.era.id, start_age: 25, age: 25, max_lifespan: 80,
      start_year: 1640, calendar_year: 1640, region_id: 'R_JIANGNAN', caste_id: 'C_SOLDIER',
      identity_id: 'I_ARTISAN', highest_identity_id: 'I_ARTISAN',
      attributes: { physique: 5, intelligence: 5, wealth: 5, prestige: 5, luck: 5 },
      cards: [], flags: ['F_LIFE_MARRIED'], injuries: [], chains: [], achievements: [] };
    const run = { timeline: 'historical', seed: 1, status: 'READY', death: null } as RunState;
    const terminalRun = { ...run, status: 'ENDED', death: content.era.old_age_death_id } as RunState;
    const unlocked: string[] = [];
    const notify = (id: string): void => { unlocked.push(id); };

    evaluateAchievements(content, player, run, notify);
    expect(player.achievements).not.toContain('A_LIFE_FAMILY_JOY');
    expect(endingReport(content, 'fingerprint', player, terminalRun, []).anecdote_achievement_ids)
      .not.toContain('A_LIFE_FAMILY_JOY');
    expect(evaluateCondition(event.condition, conditionContext(player, run.timeline))).toBe(true);
    executeEffects(event.outcome.effects, player, run, content, registry, {
      chain: () => {}, death: () => {}, achievement: notify,
    });
    evaluateAchievements(content, player, run, notify);
    expect(player.flags).toContain('F_LIFE_HAS_CHILD');
    expect(player.achievements).toContain('A_LIFE_FAMILY_JOY');
    expect(evaluateCondition(event.condition, conditionContext(player, run.timeline))).toBe(false);
    expect(endingReport(content, 'fingerprint', player, terminalRun, []).primary_achievement_id)
      .toBe('A_LIFE_ARTISAN');

    // A past experience remains earned; a former livelihood is not the terminal life.
    player.identity_id = 'I_REFUGEE';
    player.flags = [];
    player.age = 40;
    player.calendar_year = 1655;
    evaluateAchievements(content, player, run, notify);
    expect(unlocked.filter(id => id === 'A_LIFE_FAMILY_JOY')).toHaveLength(1);
    expect(endingReport(content, 'fingerprint', player, terminalRun, [])).toMatchObject({
      primary_achievement_id: 'A_LIFE_ORDINARY',
      anecdote_achievement_ids: expect.arrayContaining(['A_LIFE_FAMILY_JOY']),
    });
  });
});
