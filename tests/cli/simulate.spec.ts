import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { load } from '../../tools/lib/FileStateStore.js';
import { sha256 } from '../../tools/lib/canonical.js';
import {
  chainLife, cliFixtures, expectReplay, expectSuccess, fixedLife, readJson, readJsonLines,
  runCli, successJson, type DrawItem, type DrawJson, type SavedLife,
} from './helpers.js';

const fixture = cliFixtures();

interface Summary {
  mode: 'life' | 'draw';
  content_id: string;
  content_version: string;
  content_fingerprint: string;
  seed: number;
  runs: number;
  success: number;
  failed: number;
  strategy?: string;
}

interface LifeRun {
  index: number;
  seed: number;
  status: 'ended';
  report: {
    seed: number;
    content_fingerprint: string;
    years_played: number;
    end_reason: string;
    death_id: string | null;
    primary_achievement_id: string | null;
    highest_identity_id: string;
  };
  blocking_inputs: number;
  estimated_input_seconds: number;
  age_band_id: string;
  path_category: string;
  automatic_events: number;
  choice_events: number;
  auto_ratio: number | null;
  card_id: string;
  start_year: number;
  origin_id: string;
}

interface Stratum {
  age_band_id: string;
  path_category: string;
  samples: number;
  final_age: { p50: number; p90: number };
  years_played: { p50: number; p90: number };
  blocking_inputs: { p50: number; p90: number };
  early_death_rate: number;
  death_counts: Record<string, number>;
  ending_counts: Record<string, number>;
  chain_started: number;
  chain_completed: number;
  chain_interrupted: number;
  chain_completion_rate: number | null;
}

describe('simulate: real life reports and replayable choices', () => {
  it('prefers an available nested physical-card reaction over normal and negated gates', async () => {
    const context = await fixture((bundle) => {
      fixedLife(bundle, 12);
      bundle.cards.push({ id: 'CARD_MOD_TEST', name: '随身物件', description: '用于确定性策略覆盖的随身物件。', rarity: 'N', tags: [] });
      bundle.pools.find((pool) => pool.id === 'POOL_BASIC')!.entries = [{ card_id: 'CARD_MOD_TEST', weight: 1 }];
      const opening = bundle.events.find((event) => event.id === 'E_OPEN_SAFE');
      if (opening?.interaction !== 'choice' || opening.trigger.kind !== 'opening') throw new Error('Missing opening choice');
      opening.trigger.trigger_probability = 1;
      const outcome = { text: '完成选择', effects: [], next_stage_id: null };
      opening.options = [
        { id: 'normal', text: '普通路线', unavailable_text: '不可选', risk: 'normal', outcome },
        { id: 'negated', text: '反向条件', unavailable_text: '不可选', risk: 'high', outcome,
          condition: { op: 'not', condition: { op: 'has', collection: 'cards', id: 'CARD_RARE' } } },
        { id: 'locked', text: '不可用物件路线', unavailable_text: '不可选', risk: 'high', outcome,
          condition: { op: 'all', conditions: [{ op: 'has', collection: 'cards', id: 'CARD_MOD_TEST' },
            { op: 'compare', field: 'age', comparator: 'lt', value: 0 }] } },
        { id: 'reaction', text: '物件路线', unavailable_text: '不可选', risk: 'high', outcome,
          condition: { op: 'all', conditions: [{ op: 'any', conditions: [{ op: 'has', collection: 'cards', id: 'CARD_MOD_TEST' }] }] } },
      ];
    });
    const output = join(context.root, 'reaction-strategy');
    expectSuccess(await runCli('simulate', ['--content', context.content, '--runs', '1', '--seed', '23', '--strategy', 'reaction', '--out', output]));
    const trace = await expectReplay(context.content, join(output, 'traces', '0.json'));
    expect(trace.commands.filter((command) => command.api === 'resolveOption')).toEqual([
      expect.objectContaining({ args: expect.objectContaining({ optionId: 'reaction' }) }),
    ]);
  }, 90_000);

  it.each([false, true])('counts encountered events without counting stages or audits (events=%s)', async (withEvents) => {
    const context = await fixture((bundle) => {
      fixedLife(bundle, 12);
      if (!withEvents) return;
      const opening = bundle.events.find((event) => event.id === 'E_OPEN_SAFE');
      if (opening?.interaction !== 'choice' || opening.trigger.kind !== 'opening') throw new Error('Missing opening choice');
      opening.trigger.trigger_probability = 1;
      opening.options = [{ id: 'attempt', text: '开始', unavailable_text: '不可选', risk: 'normal',
        outcome: { text: '进入阶段', effects: [], next_stage_id: 'S_STATS' } }];
      opening.stages = [{ id: 'S_STATS', text: '确认阶段', check: { attribute: 'intelligence', dc: 14, modifier: 0 },
        success: { text: '成功', effects: [], next_stage_id: null },
        failure: { text: '失败', effects: [], next_stage_id: null } }];
      bundle.events.push({ id: 'E_STATS_AUTO', text: '自动历史事件',
        trigger: { kind: 'historical', year: 1641, priority: 0 }, interaction: 'automatic',
        outcome: { text: '完成', effects: [], next_stage_id: null } });
    });
    const output = join(context.root, 'observed-statistics');
    expectSuccess(await runCli('simulate', ['--content', context.content, '--runs', '2', '--seed', '1640', '--out', output]));
    const records = await readJsonLines<LifeRun>(join(output, 'runs.jsonl'));
    const cardCounts: Record<string, number> = {};
    const originCounts: Record<string, number> = {};
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record).toMatchObject({ age_band_id: 'child', path_category: 'short', start_year: 1640,
        automatic_events: Number(withEvents), choice_events: Number(withEvents), auto_ratio: withEvents ? 0.5 : null });
      expect(context.bundle.cards.map((card) => card.id)).toContain(record.card_id);
      expect(context.bundle.era.backgrounds.map((origin) => origin.id)).toContain(record.origin_id);
      cardCounts[record.card_id] = (cardCounts[record.card_id] ?? 0) + 1;
      originCounts[record.origin_id] = (originCounts[record.origin_id] ?? 0) + 1;
      const trace = await expectReplay(context.content, join(output, 'traces', `${record.index}.json`));
      expect(trace.commands.filter((command) => command.api === 'resolveStage')).toHaveLength(Number(withEvents));
    }
    const summary = await readJson<Summary & { life: { strata: Stratum[] } }>(join(output, 'summary.json'));
    const expected = { automatic_events: withEvents ? 2 : 0, choice_events: withEvents ? 2 : 0,
      auto_ratio: withEvents ? 0.5 : null, card_counts: cardCounts, origin_counts: originCounts, start_year_counts: { '1640': 2 } };
    expect(summary.life).toMatchObject(expected);
    expect(summary.life.strata).toEqual([expect.objectContaining({ ...expected, samples: 2 })]);
  }, 90_000);

  it('reports every small life sample, completing the real chain and replaying every trace', async () => {
    const context = await fixture((bundle) => chainLife(bundle, 13));
    const output = join(context.root, 'life-report');
    const run = await runCli('simulate', [
      '--content', context.content, '--runs', '2', '--seed', '1640', '--strategy', 'normal', '--out', output,
    ]);
    expectSuccess(run);
    const summary = await readJson<Summary & { life: { strata: Stratum[] } }>(join(output, 'summary.json'));
    expect(summary).toMatchObject({
      mode: 'life', content_id: context.bundle.manifest.content_id,
      content_version: context.bundle.manifest.content_version, seed: 1640,
      runs: 2, success: 2, failed: 0, strategy: 'normal',
    });
    expect(summary.content_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const records = await readJsonLines<LifeRun>(join(output, 'runs.jsonl'));
    expect(records).toHaveLength(2);
    expect(records.map(({ index, seed, status }) => ({ index, seed, status }))).toEqual([
      { index: 0, seed: 1640, status: 'ended' }, { index: 1, seed: 1641, status: 'ended' },
    ]);
    for (const record of records) {
      expect(record).toMatchObject({
        blocking_inputs: 2, estimated_input_seconds: 10,
        report: {
          seed: record.seed, content_fingerprint: summary.content_fingerprint,
          years_played: 4, end_reason: 'death', death_id: 'D_OLD_AGE',
          primary_achievement_id: 'A_PROJECT', highest_identity_id: 'I_ARTISAN',
        },
      });
      const trace = await expectReplay(context.content, join(output, 'traces', `${record.index}.json`));
      expect(trace).toMatchObject({ kind: 'life', seed: record.seed, content_fingerprint: summary.content_fingerprint });
      expect(trace.commands.map((command) => command.api)).toEqual([
        'initGame', 'resolveOption', 'nextYear', 'nextYear', 'nextYear', 'nextYear',
      ]);
      expect(new Set(trace.commands.map((command) => command.commandId)).size).toBe(trace.commands.length);
      for (const command of trace.commands) expect(command.expected_result_hash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(summary.life.strata).toEqual([expect.objectContaining({
      age_band_id: 'child', path_category: 'long_or_major', samples: 2,
      final_age: { p50: 13, p90: 13 }, years_played: { p50: 4, p90: 4 },
      blocking_inputs: { p50: 2, p90: 2 }, early_death_rate: 0,
      death_counts: { D_OLD_AGE: 2 }, ending_counts: { A_PROJECT: 2 },
      chain_started: 2, chain_completed: 2, chain_interrupted: 0, chain_completion_rate: 1,
    })]);
    expect((await readdir(join(output, 'traces'))).sort()).toEqual(['0.json', '1.json']);
    expect((await readdir(context.root)).sort()).toEqual(['life-report']);
  }, 90_000);

  it.each([
    { strategy: 'normal', optionId: 'first-normal' },
    { strategy: 'cautious', optionId: 'first-safe' },
    { strategy: 'risky', optionId: 'first-high' },
    { strategy: 'reaction', optionId: 'first-normal' },
  ])('uses the $strategy option ordering without consuming strategy randomness', async ({ strategy, optionId }) => {
    const context = await fixture((bundle) => {
      fixedLife(bundle, 12);
      const opening = bundle.events.find((event) => event.id === 'E_OPEN_SAFE');
      if (opening?.interaction !== 'choice' || opening.trigger.kind !== 'opening') throw new Error('Missing opening choice');
      opening.trigger.trigger_probability = 1;
      opening.options = [
        { id: 'locked-high', risk: 'high' as const, locked: true },
        { id: 'first-normal', risk: 'normal' as const },
        { id: 'first-safe', risk: 'safe' as const },
        { id: 'second-safe', risk: 'safe' as const },
        { id: 'first-high', risk: 'high' as const },
        { id: 'second-high', risk: 'high' as const },
      ].map(({ id, risk, locked }) => ({
        id, text: id, risk, unavailable_text: '这是锁定选项',
        ...(locked ? { condition: { op: 'compare' as const, field: 'wealth' as const, comparator: 'gt' as const, value: 99 } } : {}),
        outcome: { text: `已选 ${id}`, effects: [{ type: 'flag_add' as const, id }], next_stage_id: null },
      }));
    });
    const output = join(context.root, 'strategy-report');
    expectSuccess(await runCli('simulate', [
      '--content', context.content, '--runs', '1', '--seed', '23', '--strategy', strategy, '--out', output,
    ]));
    const trace = await expectReplay(context.content, join(output, 'traces', '0.json'));
    const choices = trace.commands.filter((command) => command.api === 'resolveOption');
    expect(choices).toHaveLength(1);
    expect(choices[0]!.args).toMatchObject({ optionId });
    const records = await readJsonLines<LifeRun>(join(output, 'runs.jsonl'));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ blocking_inputs: 2, estimated_input_seconds: 10, report: { years_played: 3 } });
    expect(trace.commands.some((command) => command.api === 'retire')).toBe(false);
  }, 90_000);

  it('classifies opening death first, retains zero-year samples, and uses null for no chain denominator', async () => {
    const context = await fixture((bundle) => {
      fixedLife(bundle, 12);
      const ending = bundle.events.find((event) => event.id === 'E_OPEN_END');
      if (ending?.trigger.kind !== 'opening') throw new Error('Missing opening death');
      ending.trigger.trigger_probability = 1;
    });
    const output = join(context.root, 'opening-deaths');
    expectSuccess(await runCli('simulate', ['--content', context.content, '--runs', '2', '--seed', '90', '--out', output]));
    const summary = await readJson<Summary & { life: { strata: Stratum[] } }>(join(output, 'summary.json'));
    expect(summary).toMatchObject({ runs: 2, success: 2, failed: 0 });
    expect(summary.life.strata).toEqual([expect.objectContaining({
      age_band_id: 'child', path_category: 'opening_death', samples: 2,
      final_age: { p50: 9, p90: 9 }, years_played: { p50: 0, p90: 0 },
      blocking_inputs: { p50: 1, p90: 1 }, early_death_rate: 1,
      death_counts: { D_OPENING: 2 }, chain_started: 0, chain_completed: 0,
      chain_interrupted: 0, chain_completion_rate: null,
    })]);
    const records = await readJsonLines<LifeRun>(join(output, 'runs.jsonl'));
    expect(records.map((record) => ({
      years: record.report.years_played, reason: record.report.end_reason,
      death: record.report.death_id, inputs: record.blocking_inputs, seconds: record.estimated_input_seconds,
    }))).toEqual([
      { years: 0, reason: 'death', death: 'D_OPENING', inputs: 1, seconds: 5 },
      { years: 0, reason: 'death', death: 'D_OPENING', inputs: 1, seconds: 5 },
    ]);
    for (const record of records) {
      const replay = await expectReplay(context.content, join(output, 'traces', `${record.index}.json`));
      expect(replay.commands.map((command) => command.api)).toEqual(['initGame']);
    }
  }, 90_000);

  it('keeps failed samples, exact saves and rejected commands while continuing the remaining runs', async () => {
    const context = await fixture((bundle) => {
      chainLife(bundle, 13);
      bundle.rules.chains.max_active = 1;
      bundle.events.push({
        id: 'E_CAPACITY_FAILURE', text: '任务容量已满时不可自动再开任务',
        trigger: { kind: 'historical', year: 1641, priority: 0 }, interaction: 'automatic',
        outcome: { text: '必须完整执行或整体回滚', effects: [{ type: 'chain_start', id: 'CH_WORKSHOP' }], next_stage_id: null },
      });
    });
    const output = join(context.root, 'failed-runs');
    const run = await runCli('simulate', ['--content', context.content, '--runs', '2', '--seed', '14', '--out', output]);
    expect(run.signal).toBeNull();
    expect(run.code).toBe(1);
    const summary = await readJson<Summary>(join(output, 'summary.json'));
    expect(summary).toMatchObject({ mode: 'life', seed: 14, runs: 2, success: 0, failed: 2 });
    const failures = await readJsonLines<{
      index: number; seed: number; status: string;
      error: { code: string }; save: SavedLife['engine'];
    }>(join(output, 'runs.jsonl'));
    expect(failures.map(({ index, seed, status, error }) => ({ index, seed, status, code: error.code }))).toEqual([
      { index: 0, seed: 14, status: 'failed', code: 'OUTCOME_NOT_APPLICABLE' },
      { index: 1, seed: 15, status: 'failed', code: 'OUTCOME_NOT_APPLICABLE' },
    ]);
    for (const failure of failures) {
      expect(failure.save.payload.run.status).toBe('READY');
      expect(failure.save.payload.player).toMatchObject({ age: 9, calendar_year: 1640 });
      expect(failure.save.payload.player.flags).not.toContain('workshop_complete');
      const trace = await expectReplay(context.content, join(output, 'traces', `${failure.index}.json`), failure.save);
      expect(trace.commands.at(-1)).toMatchObject({ api: 'nextYear', error_code: 'OUTCOME_NOT_APPLICABLE' });
    }
  }, 90_000);
});

describe('simulate: draw statistics derived from real per-seed experiments', () => {
  it('replays every experiment and reports observed counts separately from authored base probabilities', async () => {
    const context = await fixture((bundle) => {
      const pool = bundle.pools.find((entry) => entry.id === 'POOL_PITY')!;
      pool.hard_pity = { after: 3, target_card_ids: ['CARD_EPIC'] };
      for (const entry of pool.entries) entry.weight = entry.card_id === 'CARD_COMMON' ? 3 : entry.card_id === 'CARD_EPIC' ? 1 : 0;
    });
    const output = join(context.root, 'draw-report');
    expectSuccess(await runCli('simulate', [
      '--mode', 'draw', '--content', context.content, '--pool', 'POOL_PITY', '--draws-per-run', '12',
      '--runs', '3', '--seed', '20', '--out', output,
    ]));
    const summary = await readJson<Summary & { draw: {
      total_draws: number;
      cards: Record<string, { count: number; frequency: number; base_probability: number }>;
      rarities: Record<string, { count: number; frequency: number }>;
      forced_pity: number;
      longest_miss_streak: number;
    } }>(join(output, 'summary.json'));
    expect(summary).toMatchObject({ mode: 'draw', seed: 20, runs: 3, success: 3, failed: 0 });
    const records = await readJsonLines<{ index: number; seed: number; misses: number }>(join(output, 'runs.jsonl'));
    expect(records.map(({ index, seed }) => ({ index, seed }))).toEqual([
      { index: 0, seed: 20 }, { index: 1, seed: 21 }, { index: 2, seed: 22 },
    ]);
    const observed: DrawItem[] = [];
    let longest = 0;
    for (const record of records) {
      const trace = await expectReplay(context.content, join(output, 'traces', `${record.index}.json`));
      expect(trace).toMatchObject({ kind: 'gacha', seed: record.seed, content_fingerprint: summary.content_fingerprint });
      expect(trace.commands).toHaveLength(1);
      expect(trace.commands[0]).toMatchObject({ api: 'draw', args: { poolId: 'POOL_PITY', count: 12 } });
      const state = join(context.root, `reference-${record.index}`);
      const reference = successJson<DrawJson>(await runCli('draw', [
        '--content', context.content, '--pool', 'POOL_PITY', '--count', '12', '--seed', String(record.seed),
        '--command-id', trace.commands[0]!.commandId, '--state', state, '--json',
      ]));
      expect(sha256(reference)).toBe(trace.commands[0]!.expected_result_hash);
      expect(sha256(await load(state))).toBe(trace.expected_final_hash);
      expect(reference.items).toHaveLength(12);
      expect(reference.items.map((item) => item.card_id)).not.toContain('CARD_RARE');
      let misses = 0;
      for (const item of reference.items) {
        misses = item.card_id === 'CARD_EPIC' ? 0 : misses + 1;
        longest = Math.max(longest, misses);
        expect(item.pity_after).toBe(misses);
      }
      expect(record.misses).toBe(misses);
      expect(misses).toBeLessThan(3);
      observed.push(...reference.items);
    }
    expect(summary.draw.total_draws).toBe(36);
    expect(summary.draw.forced_pity).toBe(observed.filter((item) => item.forced_pity).length);
    expect(summary.draw.longest_miss_streak).toBe(longest);
    expect(longest).toBeLessThan(3);
    for (const [card, base] of [['CARD_COMMON', 0.75], ['CARD_EPIC', 0.25], ['CARD_RARE', 0]] as const) {
      const count = observed.filter((item) => item.card_id === card).length;
      expect(summary.draw.cards[card]).toEqual({ count, frequency: count / 36, base_probability: base });
    }
    for (const rarity of ['N', 'SSR', 'R']) {
      const count = observed.filter((item) => item.rarity === rarity).length;
      expect(summary.draw.rarities[rarity]).toEqual({ count, frequency: count / 36 });
    }
    expect((await readdir(join(output, 'traces'))).sort()).toEqual(['0.json', '1.json', '2.json']);
  }, 90_000);

  it('never overwrites a previous report directory or any previous trace', async () => {
    const context = await fixture((bundle) => fixedLife(bundle, 12));
    const output = join(context.root, 'keep-report');
    const args = ['--content', context.content, '--runs', '1', '--seed', '0', '--out', output];
    expectSuccess(await runCli('simulate', args));
    const paths = ['summary.json', 'runs.jsonl', 'traces/0.json'];
    const original = await Promise.all(paths.map((path) => readFile(join(output, path), 'utf8')));
    await writeFile(join(output, 'user-note.txt'), 'Keep this user-owned report.\n');
    const rejected = await runCli('simulate', args);
    expect(rejected.code).toBe(1);
    expect(await Promise.all(paths.map((path) => readFile(join(output, path), 'utf8')))).toEqual(original);
    expect(await readFile(join(output, 'user-note.txt'), 'utf8')).toBe('Keep this user-owned report.\n');
  });
});
