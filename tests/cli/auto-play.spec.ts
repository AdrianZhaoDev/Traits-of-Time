import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliFixtures, expectReplay, expectSuccess, fixedLife, runCli, savedLife, slotBytes, startCli } from './helpers.js';

const fixture = cliFixtures();

describe('play --auto: unattended random choices', () => {
  it('finishes without stdin, confirms both stages, and resumes identically from a saved stage', async () => {
    const context = await fixture(bundle => {
      fixedLife(bundle, 12);
      bundle.rules.events = { per_year: 1, automatic_ratio: 0.6 };
      const opening = bundle.events.find(event => event.id === 'E_OPEN_SAFE');
      const work = bundle.events.find(event => event.id === 'E_WORK');
      if (opening?.interaction !== 'choice' || opening.trigger.kind !== 'opening' || work?.interaction !== 'choice' || work.trigger.kind !== 'random') throw new Error('Fixture events missing');
      opening.trigger.trigger_probability = 1;
      opening.options = [{ id: 'attempt', text: '开始', unavailable_text: '不可选', risk: 'normal', outcome: { text: '开始阶段', effects: [], next_stage_id: 'S1' } }];
      opening.stages = ['S1', 'S2'].map((id, index) => ({
        id, text: id, check: { attribute: 'intelligence', dc: 14, modifier: 0 },
        success: { text: '成功', effects: [], next_stage_id: index === 0 ? 'S2' : null },
        failure: { text: '失败', effects: [], next_stage_id: index === 0 ? 'S2' : null },
      }));
      work.trigger.trigger_probability = 1;
      work.options.unshift({ id: 'locked', text: '禁止路线', unavailable_text: '永不满足', risk: 'safe', condition: { op: 'compare', field: 'age', comparator: 'lt', value: 0 }, outcome: { text: '不能执行', effects: [{ type: 'flag_add', id: 'invalid_choice' }], next_stage_id: null } });
    });
    const replayFile = join(context.root, 'auto.json');
    // Leave stdin open: unattended execution must exit without waiting for a line or EOF.
    const automatic = startCli('play', ['--content', context.content, '--seed', '1640', '--state', context.state, '--auto', '--export-replay', replayFile]);
    expectSuccess(await automatic.finished);
    const full = await savedLife(context.state);
    expect(full.engine.payload.run.status).toBe('ENDED');
    expect(full.engine.payload.player.age).toBe(12);
    expect(full.engine.payload.run.dice_results).toHaveLength(2);
    expect(full.engine.payload.player.flags).not.toContain('invalid_choice');
    const trace = await expectReplay(context.content, replayFile, full.engine);
    expect(trace.commands.filter(command => command.api === 'resolveOption').map(command => command.args.optionId)).not.toContain('locked');

    const resumedState = join(context.root, 'resumed');
    expectSuccess(await runCli('play', ['--content', context.content, '--seed', '1640', '--state', resumedState], 'pause\nchoose attempt\nquit\n'));
    expect((await savedLife(resumedState)).engine.payload.run.status).toBe('AWAITING_STAGE');
    expectSuccess(await runCli('play', ['--content', context.content, '--state', resumedState, '--auto']));
    expect((await savedLife(resumedState)).engine).toEqual(full.engine);

    const before = await slotBytes(context.state);
    expectSuccess(await runCli('play', ['--content', context.content, '--state', context.state, '--auto']));
    expect(await slotBytes(context.state)).toEqual(before);
  });

  it('still leaves a manual run waiting for input when --auto is absent', async () => {
    const context = await fixture(bundle => {
      fixedLife(bundle, 12);
      const opening = bundle.events.find(event => event.id === 'E_OPEN_SAFE');
      if (opening?.trigger.kind !== 'opening') throw new Error('Opening missing');
      opening.trigger.trigger_probability = 1;
    });
    expectSuccess(await runCli('play', ['--content', context.content, '--state', context.state]));
    const save = await savedLife(context.state);
    expect(save.engine.payload.run.status).toBe('AWAITING_OPTION');
    expect(save.cursor.input_sequence).toBe(0);
  });

  it('stops on an unappliable automatic outcome rather than retrying or losing its saved position', async () => {
    const context = await fixture(bundle => {
      fixedLife(bundle, 12);
      bundle.rules.chains.max_active = 1;
      bundle.events.push({ id: 'E_FAIL', text: '容量冲突', trigger: { kind: 'historical', year: 1641, priority: 0 }, interaction: 'automatic', outcome: {
        text: '两条任务超容量', effects: [{ type: 'chain_start', id: 'CH_WORKSHOP' }, { type: 'chain_start', id: 'CH_WORKSHOP' }], next_stage_id: null,
      } });
    });
    const result = await runCli('play', ['--content', context.content, '--state', context.state, '--auto']);
    expect(result.signal).toBeNull();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('OUTCOME_NOT_APPLICABLE');
    const save = await savedLife(context.state);
    expect(save.engine.payload.player.age).toBe(9);
    expect(save.engine.payload.player.chains).toEqual([]);
    expect(save.cursor.input_sequence).toBe(1);
  });
});
