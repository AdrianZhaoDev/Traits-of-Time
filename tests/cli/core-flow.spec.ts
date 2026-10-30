import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeContent } from '../helpers/content.js';
import {
  chainLife, chainOpeningText, cliFixtures, expectReplay, expectSuccess,
  fixedLife, runCli, savedLife, slotBytes,
} from './helpers.js';

const fixture = cliFixtures();

describe('play: real stdin, durable decisions and replay', () => {
  it('automatically completes routine chain years and continues through death', async () => {
    const context = await fixture(chainLife);
    const replayFile = join(context.root, 'continued-life.json');
    const result = await runCli('play', [
      '--content', context.content, '--seed', '1640', '--state', context.state, '--export-replay', replayFile,
    ], 'choose start\n');
    expectSuccess(result);
    const completed = await savedLife(context.state);
    expect(completed.engine.payload.player).toMatchObject({
      start_age: 9, age: 20, calendar_year: 1651, identity_id: 'I_ARTISAN', highest_identity_id: 'I_ARTISAN',
      attributes: { wealth: 3, intelligence: 4, prestige: 4 },
    });
    expect(completed.engine.payload.player.flags).toContain('workshop_complete');
    expect(completed.engine.payload.player.achievements).toContain('A_PROJECT');
    expect(completed.engine.payload.player.chains).toEqual([expect.objectContaining({ status: 'completed' })]);
    expect(completed.engine.payload.run.status).toBe('ENDED');
    expect(completed.engine.payload.logs.filter(entry => entry.type === 'event' && entry.source_id.startsWith('E_CHAIN_'))
      .map(entry => [entry.source_id, entry.age, entry.calendar_year]))
      .toEqual([['E_CHAIN_1', 10, 1641], ['E_CHAIN_2', 11, 1642], ['E_CHAIN_3', 12, 1643]]);
    const trace = await expectReplay(context.content, replayFile, completed.engine);
    expect(trace.commands.filter(command => command.api === 'resolveOption')).toHaveLength(1);
    expect(trace.commands.filter(command => command.api === 'nextYear')).toHaveLength(11);
    expect(new Set(trace.commands.map(command => command.commandId)).size).toBe(trace.commands.length);
  });

  it('can pause routine advancement and abandon one active instance through real stdin', async () => {
    const context = await fixture(chainLife);
    const replayFile = join(context.root, 'abandoned.json');
    const result = await runCli('play', [
      '--content', context.content, '--seed', '1640', '--state', context.state, '--export-replay', replayFile,
    ], 'pause\nchoose start\nnext\nabandon 1\nquit\n');
    expectSuccess(result);
    const saved = await savedLife(context.state);
    expect(saved.engine.payload.player).toMatchObject({ age: 10, calendar_year: 1641,
      attributes: { wealth: 2, intelligence: 4, prestige: 3 } });
    expect(saved.engine.payload.player.chains).toEqual([expect.objectContaining({ status: 'interrupted' })]);
    expect(saved.engine.payload.player.flags).not.toContain('workshop_complete');
    const trace = await expectReplay(context.content, replayFile, saved.engine);
    expect(trace.commands.filter(command => command.api === 'abandonChain')).toEqual([
      expect.objectContaining({ args: { chainInstanceId: saved.engine.payload.player.chains[0]!.instance_id } }),
    ]);
  });

  it('treats EOF as quit and never chooses an opening option on either launch', async () => {
    const context = await fixture(chainLife);
    const firstReplay = join(context.root, 'first-eof.json');
    const first = await runCli('play', [
      '--content', context.content, '--seed', '27', '--state', context.state, '--export-replay', firstReplay,
    ]);
    expectSuccess(first);
    expect(first.stdout).toContain(chainOpeningText);
    const before = await savedLife(context.state);
    expect(before.engine.payload.run).toMatchObject({ status: 'AWAITING_OPTION', seed: 27, dice_results: [] });
    expect(before.engine.payload.player).toMatchObject({ age: 9, calendar_year: 1640, attributes: { wealth: 3 } });
    expect(before.engine.payload.player.chains).toEqual([]);
    const replay = await expectReplay(context.content, firstReplay, before.engine);
    expect(replay.commands).toHaveLength(1);

    const second = await runCli('play', ['--content', context.content, '--state', context.state]);
    expectSuccess(second);
    expect(second.stdout).toContain(chainOpeningText);
    const restored = await savedLife(context.state);
    expect(restored.engine).toEqual(before.engine);
    expect(restored.cursor.input_sequence).toBe(before.cursor.input_sequence);
    expect(restored.cursor.authorized).toBe(false);
  });

  it('previews real risk checks and automatically resolves authorized dice before the next choice', async () => {
    const context = await fixture((bundle) => {
      fixedLife(bundle);
      const opening = bundle.events.find((event) => event.id === 'E_OPEN_SAFE');
      if (opening?.interaction !== 'choice' || opening.trigger.kind !== 'opening') throw new Error('Missing opening choice');
      opening.trigger.trigger_probability = 1;
      opening.options = [{
        id: 'attempt', text: '确认进入两个阶段', unavailable_text: '不可用', risk: 'high',
        outcome: { text: '等待第一阶段确认', effects: [], next_stage_id: 'S1' },
      }, {
        id: 'rest', text: '留在家中', unavailable_text: '不可用', risk: 'safe',
        outcome: { text: '留在家中歇息', effects: [], next_stage_id: null },
      }, {
        id: 'locked', text: '付钱找向导', unavailable_text: '钱不够请向导', risk: 'normal',
        condition: { op: 'compare', field: 'wealth', comparator: 'gte', value: 10 },
        outcome: { text: '等待向导带路', effects: [], next_stage_id: 'S2' },
      }];
      opening.stages = [
        {
          id: 'S1', text: '第一阶段：必须明确确认', check: { attribute: 'intelligence', dc: 14, modifier: 0 },
          success: { text: '第一阶段成功，仍需确认下一阶段', effects: [], next_stage_id: 'S2' },
          failure: { text: '第一阶段失败，仍需确认下一阶段', effects: [], next_stage_id: 'S2' },
        },
        {
          id: 'S2', text: '第二阶段：必须再次明确确认', check: { attribute: 'physique', dc: 14, modifier: 0 },
          success: { text: '第二阶段成功', effects: [{ type: 'attribute_add', attribute: 'wealth', amount: 2 }], next_stage_id: null },
          failure: { text: '第二阶段失败', effects: [{ type: 'attribute_add', attribute: 'wealth', amount: -1 }], next_stage_id: null },
        },
      ];
      bundle.events.push({ id: 'E_AFTER_ROLLS', text: 'Choose after the rolls', interaction: 'choice',
        trigger: { kind: 'historical', year: 1640, priority: 0 },
        options: [{ id: 'wait', text: 'Wait', risk: 'safe', unavailable_text: 'Unavailable',
          outcome: { text: 'Waited', effects: [], next_stage_id: null } }] });
    });
    const preview = await runCli('play', ['--content', context.content, '--seed', '71', '--state', context.state], 'quit\n');
    expectSuccess(preview);
    const lines = preview.stdout.split('\n');
    const attemptLine = lines.find(line => line.includes('确认进入两个阶段'));
    expect(attemptLine).toContain('[高风险]');
    expect(attemptLine).toMatch(/(?:intelligence|智力|智谋)\s*\/\s*DC\s*14/);
    expect(attemptLine).toMatch(/(?:physique|体魄|体质)\s*\/\s*DC\s*14/);
    // Both branches reach S2: show its check once, not twice or as a combined probability.
    expect(attemptLine?.match(/DC\s*14/g)).toHaveLength(2);
    expect(lines.find(line => line.includes('留在家中'))).toContain('[安全]');
    const lockedLine = lines.find(line => line.includes('付钱找向导'));
    expect(lockedLine).toContain('[普通]');
    expect(lockedLine).toContain('钱不够请向导');
    expect(lockedLine).toMatch(/(?:physique|体魄|体质)\s*\/\s*DC\s*14/);
    const beforeChoice = await savedLife(context.state);
    expect(beforeChoice.engine.payload.run.status).toBe('AWAITING_OPTION');
    expect(beforeChoice.engine.payload.run.dice_results).toEqual([]);
    expect(beforeChoice.replay_commands).toHaveLength(1);
    const replayFile = join(context.root, 'stages.json');
    const rolled = await runCli('play', [
      '--content', context.content, '--state', context.state, '--export-replay', replayFile,
    ], 'choose attempt\n');
    expectSuccess(rolled);
    const restarted = await savedLife(context.state);
    expect(restarted.engine.payload.run.status).toBe('AWAITING_OPTION');
    expect(restarted.engine.payload.run.dice_results).toHaveLength(2);
    expect(restarted.engine.payload.player.calendar_year).toBe(1640);
    expect(rolled.stdout).toContain('D20');
    const trace = await expectReplay(context.content, replayFile, restarted.engine);
    expect(trace.commands.filter(command => command.api === 'resolveOption')).toHaveLength(1);
    expect(trace.commands.filter(command => command.api === 'resolveStage')).toHaveLength(2);
    const preserved = await slotBytes(context.state);
    expectSuccess(await runCli('play', ['--content', context.content, '--state', context.state]));
    expect(await slotBytes(context.state)).toEqual(preserved);
  });

  it('resolves a routine automatic D20 without a menu and restores exactly at the later major choice', async () => {
    const context = await fixture((bundle) => {
      fixedLife(bundle);
      bundle.events.push({ id: 'E_ROUTINE_DICE', text: '路上忽然落雨，赶紧护住随身行李。', interaction: 'automatic',
        trigger: { kind: 'historical', year: 1640, priority: 10 },
        outcome: { text: '看能否及时避雨。', effects: [], next_stage_id: 'S_RAIN' },
        stages: [{ id: 'S_RAIN', text: '护住行李', check: { attribute: 'intelligence', dc: 14, modifier: 0 },
          success: { text: '行李没有淋湿。', effects: [{ type: 'flag_add', id: 'rain_dry' }], next_stage_id: null },
          failure: { text: '行李沾了些雨水。', effects: [{ type: 'flag_add', id: 'rain_wet' }], next_stage_id: null } }] });
      bundle.events.push({ id: 'E_MAJOR_AFTER_RAIN', text: '决定今后的去向。', interaction: 'choice',
        trigger: { kind: 'historical', year: 1641, priority: 0 },
        options: [{ id: 'major_direction', text: '留下学艺', risk: 'normal', unavailable_text: '不可用',
          outcome: { text: '决定留下。', effects: [], next_stage_id: null } }] });
    });
    const replayFile = join(context.root, 'automatic-rain.json');
    const result = await runCli('play', [
      '--content', context.content, '--seed', '71', '--state', context.state, '--export-replay', replayFile,
    ]);
    expectSuccess(result);
    const saved = await savedLife(context.state);
    expect(saved.engine.payload.run.status).toBe('AWAITING_OPTION');
    expect(saved.engine.payload.player.calendar_year).toBe(1641);
    expect(saved.engine.payload.logs.filter(entry => entry.type === 'option')).toEqual([]);
    expect(saved.engine.payload.logs.filter(entry => entry.type === 'dice' && entry.source_id === 'E_ROUTINE_DICE')).toHaveLength(1);
    expect(saved.engine.payload.run.dice_results).toHaveLength(1);
    expect(saved.engine.payload.player.flags.filter(flag => flag === 'rain_dry' || flag === 'rain_wet')).toHaveLength(1);
    const routine = context.bundle.events.find(event => event.id === 'E_ROUTINE_DICE')!;
    const major = context.bundle.events.find(event => event.id === 'E_MAJOR_AFTER_RAIN')!;
    const routineStart = result.stdout.indexOf(routine.text);
    const majorStart = result.stdout.indexOf(major.text);
    expect(routineStart).toBeGreaterThanOrEqual(0);
    expect(majorStart).toBeGreaterThan(routineStart);
    const routineOutput = result.stdout.slice(routineStart, majorStart);
    expect(routineOutput).toContain('D20');
    expect(routineOutput).not.toContain('choose ');
    expect(result.stdout.slice(majorStart)).toContain('choose major_direction');
    const trace = await expectReplay(context.content, replayFile, saved.engine);
    expect(trace.commands.filter(command => command.api === 'resolveOption')).toEqual([]);
    expect(trace.commands.filter(command => command.api === 'resolveStage')).toHaveLength(1);
    const bytes = await slotBytes(context.state);
    const restoredReplay = join(context.root, 'automatic-rain-restored.json');
    expectSuccess(await runCli('play', [
      '--content', context.content, '--state', context.state, '--export-replay', restoredReplay,
    ]));
    expect(await slotBytes(context.state)).toEqual(bytes);
    expect((await savedLife(context.state)).engine).toEqual(saved.engine);
    expect(await expectReplay(context.content, restoredReplay, saved.engine)).toEqual(trace);
  });

  it('changes a real work outcome from wealth three to seven through external JSON alone, then refuses its old save', async () => {
    const context = await fixture((bundle) => {
      fixedLife(bundle);
      bundle.rules.events = { per_year: 1, automatic_ratio: 0.6 };
      const work = bundle.events.find((event) => event.id === 'E_WORK');
      if (work?.interaction !== 'choice' || work.trigger.kind !== 'random') throw new Error('Missing work event');
      work.trigger.trigger_probability = 1;
      const option = work.options.find((entry) => entry.id === 'work')!;
      option.outcome.effects = [{ type: 'attribute_add', attribute: 'wealth', amount: 4 }];
    });
    expectSuccess(await runCli('play', ['--content', context.content, '--state', context.state], 'quit\n'));
    const before = await savedLife(context.state);
    expect(before.engine.payload.player.attributes.wealth).toBe(3);
    expect(before.engine.payload.run.status).toBe('AWAITING_OPTION');

    const replayFile = join(context.root, 'wealth.json');
    expectSuccess(await runCli('play', [
      '--content', context.content, '--state', context.state, '--export-replay', replayFile,
    ], 'pause\nchoose work\nquit\n'));
    const after = await savedLife(context.state);
    expect(after.engine.payload.player).toMatchObject({ age: 9, calendar_year: 1640, attributes: { wealth: 7 } });
    expect(after.engine.payload.run.status).toBe('READY');
    await expectReplay(context.content, replayFile, after.engine);

    const preserved = await slotBytes(context.state);
    const work = context.bundle.events.find((event) => event.id === 'E_WORK');
    if (work?.interaction !== 'choice') throw new Error('Missing work event');
    work.options.find((entry) => entry.id === 'work')!.outcome.effects = [
      { type: 'attribute_add', attribute: 'wealth', amount: 5 },
    ];
    await writeContent(context.content, context.bundle);
    const refused = await runCli('play', ['--content', context.content, '--state', context.state], 'quit\n');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('CONTENT_MISMATCH');
    expect(await slotBytes(context.state)).toEqual(preserved);
  });

  it('does not overwrite an existing replay or discard the saved session when export fails', async () => {
    const context = await fixture(chainLife);
    expectSuccess(await runCli('play', ['--content', context.content, '--state', context.state], 'quit\n'));
    const before = await savedLife(context.state);
    const replayFile = join(context.root, 'keep.json');
    const sentinel = '{"owned_by":"previous export"}\n';
    await writeFile(replayFile, sentinel, { flag: 'wx' });
    const failed = await runCli('play', [
      '--content', context.content, '--state', context.state, '--export-replay', replayFile,
    ], 'quit\n');
    expect(failed.code).toBe(1);
    expect(await readFile(replayFile, 'utf8')).toBe(sentinel);
    expect((await savedLife(context.state)).engine).toEqual(before.engine);
    expectSuccess(await runCli('play', ['--content', context.content, '--state', context.state], 'quit\n'));
  });

  it('keeps an ended save ended on relaunch rather than silently creating a new life', async () => {
    const context = await fixture((bundle) => fixedLife(bundle, 12));
    const first = await runCli('play', ['--content', context.content, '--state', context.state], 'next\nnext\nnext\nquit\n');
    expectSuccess(first);
    const ended = await savedLife(context.state);
    expect(ended.engine.payload.run.status).toBe('ENDED');
    expect(ended.engine.payload.player).toMatchObject({ age: 12, calendar_year: 1643 });
    const rerun = await runCli('play', ['--content', context.content, '--state', context.state], 'next\nquit\n');
    expectSuccess(rerun);
    expect(rerun.stdout).toContain(context.bundle.deaths.find((entry) => entry.id === 'D_OLD_AGE')!.name);
    expect((await savedLife(context.state)).engine).toEqual(ended.engine);
  });
});
