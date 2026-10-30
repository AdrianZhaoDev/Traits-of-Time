import { describe, expect, it } from 'vitest';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { conditionContext, evaluateCondition } from '../../assets/scripts/core/engine/ConditionEvaluator.js';
import type { ContentBundle } from '../../assets/scripts/core/types/content.generated.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';
import { templateDirectory } from '../helpers/content.js';

type Success = Extract<CommandResult, { ok: true }>;
const fingerprint = 'c'.repeat(64);
const kinds = ['EPIDEMIC', 'STARVATION', 'EXPLOSION', 'DROWNING', 'POISON', 'FREEZING', 'BANDIT', 'CHARLATAN', 'WAR_CHAOS', 'PRISON_CORVEE'] as const;
type Kind = typeof kinds[number];
function ok(result: CommandResult): Success {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}
function choose(engine: GameEngine, result: Success, option: string): Success {
  if (result.pending?.kind !== 'option') throw new Error('Expected opening choice');
  return ok(engine.resolveOption(`choose:${result.state.revision}`, result.pending.event_instance_id, option));
}
function roll(engine: GameEngine, result: Success): Success {
  if (result.pending?.kind !== 'stage') throw new Error('Expected crisis stage');
  const next = ok(engine.resolveStage(`roll:${result.state.revision}`, result.pending.event_instance_id, result.pending.stage_id));
  const dice = next.logs.filter(entry => entry.type === 'dice');
  expect(dice).toHaveLength(1);
  expect(dice[0]!.data.raw).toBeGreaterThanOrEqual(1);
  expect(dice[0]!.data.raw).toBeLessThanOrEqual(20);
  return next;
}
function passed(result: Success): boolean {
  const entry = result.logs.find(entry => entry.type === 'dice');
  if (!entry || entry.type !== 'dice') throw new Error('Missing real D20');
  return entry.data.success;
}
// Control only initial population and candidate selection, never authored triggers,
// conditions, stages, DCs, effects or chain definitions. Resolve a real opening first.
function scenario(source: ContentBundle, kind: Kind): ContentBundle {
  const bundle = structuredClone(source);
  const opening = kind === 'EXPLOSION' ? 'E_gm_arms_start' : 'E_OPEN_ADULT';
  const selected = new Set([opening, `E_NATIVE_CRISIS_${kind}`]);
  if (kind === 'EXPLOSION') {
    for (const node of bundle.chains.find(chain => chain.id === 'CH_gm_arms')!.nodes) selected.add(node.event_id);
  }
  bundle.events = bundle.events.filter(event => selected.has(event.id));
  const startYear = kind === 'WAR_CHAOS' ? 1642 : 1630;
  bundle.era.start_year = startYear;
  bundle.rules.opening.year_min = startYear;
  bundle.rules.opening.year_max = startYear;
  bundle.rules.attributes.base = 1;
  bundle.rules.age_bands = [{ id: 'crisis-adult', min: 25, max: 25, weight: 1, modifiers: {} }];
  bundle.rules.lifespan = { min: 80, max: 80, min_remaining_years: 3 };
  for (const item of [...bundle.regions, ...bundle.castes, ...bundle.era.backgrounds]) {
    item.modifiers = {};
    item.flags = [];
  }
  for (const region of bundle.regions) region.weight = region.id === (kind === 'DROWNING' ? 'R_JIANGNAN' : 'R_SHANBEI') ? 1 : 0;
  return bundle;
}

describe('production native crises', () => {
  it.each(kinds)('%s offers escape, rescue and death through real D20, preserving failed-stage save replay', async kind => {
    const source = (await loadContent(templateDirectory)).bundle;
    const bundle = scenario(source, kind);
    const event = bundle.events.find(event => event.id === `E_NATIVE_CRISIS_${kind}`)!;
    const seen = new Set<string>();
    for (let seed = 0; seed < 512 && seen.size < 3; seed++) {
      const engine = new GameEngine(bundle, fingerprint);
      const opening = ok(engine.initGame({ seed }));
      expect(opening.pending?.kind).toBe('option');
      expect(engine.exportSave().payload.run.event_counts[event.id] ?? 0).toBe(0);
      const first = choose(engine, opening, kind === 'EXPLOSION' ? 'career_ch_gm_arms' : 'learning');
      if (!first.pending) continue; // Retain the production probability gate.
      expect(first.pending).toMatchObject({ kind: 'stage', event_id: event.id });
      const afterFirst = roll(engine, first);
      if (passed(afterFirst)) {
        expect(afterFirst.pending).toBeNull();
        expect(afterFirst.state.status).not.toBe('ENDED');
        expect(engine.exportSave().payload.run.dice_results).toHaveLength(1);
        seen.add('escape');
      } else {
        expect(afterFirst.pending).toMatchObject({ kind: 'stage', event_id: event.id });
        expect(afterFirst.state.player.injuries).toEqual(first.state.player.injuries);
        expect(afterFirst.state.player.chains).toEqual(first.state.player.chains);
        const restored = new GameEngine(bundle, fingerprint);
        // restoreSave reconstructs the seed and command history, not just a state copy.
        restored.restoreSave(JSON.parse(JSON.stringify(engine.exportSave())));
        expect(restored.current()).toEqual(engine.current());
        const final = roll(engine, afterFirst);
        expect(roll(restored, afterFirst)).toEqual(final);
        expect(restored.exportSave()).toEqual(engine.exportSave());
        expect(engine.exportSave().payload.run.dice_results).toHaveLength(2);
        expect(final.pending).toBeNull();
        if (passed(final)) {
          expect(final.state.status).not.toBe('ENDED');
          seen.add('rescue');
        } else {
          expect(final.state.status).toBe('ENDED');
          expect(engine.generateEndingReport()).toMatchObject({ end_reason: 'death', death_id: `D_${kind}` });
          expect(engine.exportSave().payload.run.dice_results.every(die => !die.success)).toBe(true);
          seen.add('death');
        }
      }
      expect(engine.exportSave().payload.logs.filter(entry => entry.type === 'option')).toHaveLength(1);
      if (engine.current().state.status !== 'ENDED') {
        // The same vulnerability does not permit a second occurrence in this life.
        let following = ok(engine.nextYear('after-crisis'));
        while (following.pending?.kind === 'stage') {
          expect(following.pending.event_id).not.toBe(event.id);
          following = roll(engine, following);
        }
        expect(following.pending).toBeNull();
        expect(engine.exportSave().payload.run.event_counts[event.id]).toBe(1);
      }
    }
    expect([...seen].sort()).toEqual(['death', 'escape', 'rescue']);
  });

  it.each(kinds)('%s excludes characters outside its current vulnerability', async kind => {
    const source = (await loadContent(templateDirectory)).bundle;
    const bundle = scenario(source, kind);
    const engine = new GameEngine(bundle, fingerprint);
    const first = choose(engine, ok(engine.initGame({ seed: 1 })), 'learning');
    const event = bundle.events.find(event => event.id === `E_NATIVE_CRISIS_${kind}`)!;
    const context = conditionContext(first.state.player, first.state.timeline);
    const eligible = { ...context, active_chains: kind === 'EXPLOSION' ? ['CH_gm_arms'] : context.active_chains };
    expect(evaluateCondition(event.condition, eligible)).toBe(true);
    const excluded = kind === 'EPIDEMIC' ? [{ ...eligible, physique: 3 }]
      : kind === 'STARVATION' ? [{ ...eligible, wealth: 2 }, { ...eligible, physique: 3 }, { ...eligible, region_id: 'R_CAPITAL', flags: eligible.flags.filter(flag => flag !== 'F_ERA_DISPLACED') }]
      : kind === 'EXPLOSION' ? [{ ...eligible, age: 17 }, { ...eligible, active_chains: [], flags: [...eligible.flags, 'F_CHAIN_FIREARMS_RESEARCH_STARTED', 'F_CH_gm_arms_STARTED'] }, { ...eligible, active_chains: [], completed_chains: ['CHAIN_FIREARMS_RESEARCH', 'CH_gm_arms'] }]
      : kind === 'DROWNING' ? [{ ...eligible, age: 10 }, { ...eligible, region_id: 'R_SHANBEI' }]
      : kind === 'POISON' ? [{ ...eligible, physique: 3 }, { ...eligible, wealth: 2 }]
      : kind === 'FREEZING' ? [{ ...eligible, physique: 3 }, { ...eligible, wealth: 2 }]
      : kind === 'BANDIT' ? [{ ...eligible, age: 13 }, { ...eligible, physique: 4 }]
      : kind === 'CHARLATAN' ? [{ ...eligible, intelligence: 4 }, { ...eligible, physique: 4 }]
      : kind === 'WAR_CHAOS' ? [{ ...eligible, calendar_year: 1641 }, { ...eligible, age: 11 }]
      : [{ ...eligible, wealth: 2 }, { ...eligible, age: 17 }];
    if (kind === 'STARVATION') expect(evaluateCondition(event.condition, { ...eligible, region_id: 'R_CAPITAL', flags: [...eligible.flags, 'F_ERA_DISPLACED'] })).toBe(true);
    if (kind === 'EXPLOSION') expect(evaluateCondition(event.condition, { ...eligible, active_chains: ['CHAIN_FIREARMS_RESEARCH'] })).toBe(true);
  });

  it('removes workshop exposure after actual abandonment despite the retained STARTED flag', async () => {
    const bundle = scenario((await loadContent(templateDirectory)).bundle, 'EXPLOSION');
    let abandoned = false;
    for (let seed = 0; seed < 64 && !abandoned; seed++) {
      const engine = new GameEngine(bundle, fingerprint);
      const result = choose(engine, ok(engine.initGame({ seed })), 'career_ch_gm_arms');
      if (result.pending) continue;
      const chain = result.state.player.chains.find(item => item.chain_id === 'CH_gm_arms')!;
      const after = ok(engine.abandonChain('leave-workshop', chain.instance_id));
      expect(after.state.player.flags).toContain('F_CH_gm_arms_STARTED');
      const crisis = bundle.events.find(event => event.id === 'E_NATIVE_CRISIS_EXPLOSION')!;
      expect(evaluateCondition(crisis.condition, conditionContext(after.state.player, after.state.timeline))).toBe(false);
      expect(ok(engine.nextYear('after-abandon')).pending).toBeNull();
      expect(engine.exportSave().payload.run.event_counts[crisis.id] ?? 0).toBe(0);
      abandoned = true;
    }
    expect(abandoned).toBe(true);
  });

  it('keeps the first production encounter a direction choice before every crisis', async () => {
    const source = (await loadContent(templateDirectory)).bundle;
    for (let seed = 0; seed < 64; seed++) {
      const engine = new GameEngine(source, fingerprint);
      const result = ok(engine.initGame({ seed }));
      expect(result.pending?.kind).toBe('option');
      const opening = source.events.find(event => event.id === result.pending?.event_id)!;
      expect(opening.trigger.kind).toBe('opening');
      expect(engine.exportSave().payload.logs.some(entry => entry.type === 'death')).toBe(false);
    }
  });
});
