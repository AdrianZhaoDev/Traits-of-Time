import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeContent } from '../helpers/content.js';
import {
  chainLife, chainOpeningText, chainStartText, cliFixtures, expectReplay, expectSuccess,
  fixedLife, runCli, savedLife, slotBytes,
} from './helpers.js';

const fixture = cliFixtures();

describe('play: real stdin, durable decisions and replay', () => {
  it('starts a chain at nine, resumes its next two years, and replays the exact 1643/12 state', async () => {
    const context = await fixture(chainLife);
    const first = await runCli('play', [
      '--content', context.content, '--seed', '1640', '--state', context.state,
    ], 'choose start\nnext\nquit\n');
    expectSuccess(first);
    expect(first.stdout).toContain(chainOpeningText);
    expect(first.stdout).toContain(chainStartText);
    const afterFirstYear = await savedLife(context.state);
    expect(afterFirstYear.engine.payload.player).toMatchObject({
      start_age: 9, age: 10, calendar_year: 1641, identity_id: 'I_DEPENDENT',
      attributes: { wealth: 2, intelligence: 4, prestige: 3 },
    });
    expect(afterFirstYear.engine.payload.player.traits).toHaveLength(2);
    expect(new Set(afterFirstYear.engine.payload.player.traits).size).toBe(2);
    expect(afterFirstYear.engine.payload.player.chains).toEqual([
      expect.objectContaining({ status: 'active' }),
    ]);
    expect(afterFirstYear.engine.payload.run.status).toBe('READY');
    expect(afterFirstYear.engine.payload.run.dice_results).toEqual([]);
    expect(afterFirstYear.replay_commands).toHaveLength(3);

    const replayFile = join(context.root, 'continued-life.json');
    const continued = await runCli('play', [
      '--content', context.content, '--state', context.state, '--export-replay', replayFile,
    ], 'next\nnext\nstatus\nquit\n');
    expectSuccess(continued);
    expect(continued.stdout).toContain('1643');
    expect(continued.stdout).toContain(context.bundle.era.identities.find((entry) => entry.id === 'I_ARTISAN')!.name);
    const completed = await savedLife(context.state);
    expect(completed.engine.payload.player).toMatchObject({
      start_age: 9, age: 12, calendar_year: 1643, identity_id: 'I_ARTISAN', highest_identity_id: 'I_ARTISAN',
      attributes: { wealth: 3, intelligence: 4, prestige: 4 },
    });
    expect(completed.engine.payload.player.flags).toContain('workshop_complete');
    expect(completed.engine.payload.player.achievements).toContain('A_PROJECT');
    expect(completed.engine.payload.player.chains).toEqual([
      expect.objectContaining({ status: 'completed' }),
    ]);
    expect(completed.engine.payload.run.status).toBe('READY');
    expect(completed.engine.payload.logs.filter((entry) => entry.type === 'event' && entry.source_id.startsWith('E_CHAIN_'))
      .map((entry) => [entry.source_id, entry.age, entry.calendar_year]))
      .toEqual([['E_CHAIN_1', 10, 1641], ['E_CHAIN_2', 11, 1642], ['E_CHAIN_3', 12, 1643]]);
    expect(completed.cursor.input_sequence).toBeGreaterThan(afterFirstYear.cursor.input_sequence);
    const replay = await expectReplay(context.content, replayFile, completed.engine);
    expect(replay).toMatchObject({ kind: 'life', seed: 1640 });
    expect(replay.commands).toHaveLength(5);
    expect(new Set(replay.commands.map((command) => command.commandId)).size).toBe(5);
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

  it('pauses each stage explicitly and resumes the same next dice value after a restart', async () => {
    const context = await fixture((bundle) => {
      fixedLife(bundle);
      const opening = bundle.events.find((event) => event.id === 'E_OPEN_SAFE');
      if (opening?.interaction !== 'choice' || opening.trigger.kind !== 'opening') throw new Error('Missing opening choice');
      opening.trigger.trigger_probability = 1;
      opening.options = [{
        id: 'attempt', text: '确认进入两个阶段', unavailable_text: '不可用', risk: 'high',
        outcome: { text: '等待第一阶段确认', effects: [], next_stage_id: 'S1' },
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
    });
    expectSuccess(await runCli('play', ['--content', context.content, '--seed', '71', '--state', context.state],
      'choose attempt\nquit\n'));
    const pendingFirst = await savedLife(context.state);
    expect(pendingFirst.engine.payload.run.status).toBe('AWAITING_STAGE');
    expect(pendingFirst.engine.payload.run.dice_results).toEqual([]);
    expect(pendingFirst.engine.payload.player.calendar_year).toBe(1640);

    expectSuccess(await runCli('play', ['--content', context.content, '--state', context.state], 'stage\nquit\n'));
    const pendingSecond = await savedLife(context.state);
    expect(pendingSecond.engine.payload.run.status).toBe('AWAITING_STAGE');
    expect(pendingSecond.engine.payload.run.dice_results).toHaveLength(1);
    expect(pendingSecond.engine.payload.player.calendar_year).toBe(1640);
    const replayFile = join(context.root, 'stages.json');
    expectSuccess(await runCli('play', [
      '--content', context.content, '--state', context.state, '--export-replay', replayFile,
    ], 'stage\nquit\n'));
    const restarted = await savedLife(context.state);
    expect(restarted.engine.payload.run.status).toBe('READY');
    expect(restarted.engine.payload.run.dice_results).toHaveLength(2);

    const continuousState = join(context.root, 'continuous');
    expectSuccess(await runCli('play', ['--content', context.content, '--seed', '71', '--state', continuousState],
      'choose attempt\nstage\nstage\nquit\n'));
    const continuous = await savedLife(continuousState);
    expect(restarted.engine).toEqual(continuous.engine);
    await expectReplay(context.content, replayFile, restarted.engine);
  });

  it('changes a real work outcome from wealth three to seven through external JSON alone, then refuses its old save', async () => {
    const context = await fixture((bundle) => {
      fixedLife(bundle);
      bundle.rules.events = { per_year: 1, choice_budget_min: 1, choice_budget_max: 1 };
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
    ], 'choose work\nquit\n'));
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
