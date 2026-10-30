import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliFixtures, expectSuccess, fixedLife, runCli, savedLife, slotBytes } from './helpers.js';
import { save } from '../../tools/lib/FileStateStore.js';

const fixture = cliFixtures();

describe('play preserves lives and renders outcomes', () => {
  it('retains an invalid default save rather than replacing it', async () => {
    const context = await fixture(bundle => fixedLife(bundle, 12));
    const directory = join(context.root, '.local-state/life');
    await save(directory, { invalid: true });
    const before = await slotBytes(directory);
    const result = await runCli('play', ['--content', context.content], 'quit\n', context.root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('SAVE_INVALID');
    expect(await slotBytes(directory)).toEqual(before);
  });

  it('preserves the default save on seed and content mismatch and creates separate explicit new lives', async () => {
    const context = await fixture(bundle => fixedLife(bundle, 12));
    const other = await fixture(bundle => fixedLife(bundle, 13));
    const args = ['--content', context.content];
    expectSuccess(await runCli('play', [...args, '--seed', '31'], 'quit\n', context.root));
    const directory = join(context.root, '.local-state/life');
    const before = await slotBytes(directory);
    for (const rejectedArgs of [[...args, '--seed', '32'], ['--content', other.content]]) {
      const result = await runCli('play', rejectedArgs, 'quit\n', context.root);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/SEED_MISMATCH|CONTENT_MISMATCH/);
      expect(await slotBytes(directory)).toEqual(before);
    }
    const refused = await runCli('play', [...args, '--new', '--state', directory], 'quit\n', context.root);
    expect(refused.code).toBe(1);
    expect(await slotBytes(directory)).toEqual(before);
    const paths: string[] = [];
    for (let index = 0; index < 2; index++) {
      const fresh = await runCli('play', [...args, '--new', '--seed', '41'], 'quit\n', context.root);
      expectSuccess(fresh);
      const path = fresh.stdout.match(/存档：([^\n]+)/)?.[1];
      expect(path).toBeDefined();
      paths.push(path!);
      expect((await savedLife(path!)).engine.payload.run.seed).toBe(41);
      expect(fresh.stdout).toContain('--state');
    }
    expect(new Set(paths).size).toBe(2);
    expect(paths).not.toContain(directory);
    expect(await slotBytes(directory)).toEqual(before);
  });

  it('keeps ended default saves and offers a copyable independent new-game command', async () => {
    const context = await fixture(bundle => fixedLife(bundle, 12));
    const args = ['--content', context.content, '--auto'];
    expectSuccess(await runCli('play', args, '', context.root));
    const directory = join(context.root, '.local-state/life');
    const before = await slotBytes(directory);
    const result = await runCli('play', args, '', context.root);
    expectSuccess(result);
    expect(result.stdout).toContain('--new');
    expect(await slotBytes(directory)).toEqual(before);
    expect((await savedLife(directory)).engine.payload.run.status).toBe('ENDED');
  });

  it('prints outcomes and new achievements once while continuing through stages to death', async () => {
    const context = await fixture(bundle => {
      fixedLife(bundle, 20);
      const opening = bundle.events.find(event => event.id === 'E_OPEN_SAFE');
      if (opening?.interaction !== 'choice' || opening.trigger.kind !== 'opening') throw new Error('Missing opening');
      opening.trigger.trigger_probability = 1;
      bundle.achievements.forEach((achievement, index) => {
        achievement.condition = { op: 'has', collection: 'flags', id: index === 0 ? 'CLI_REWARD' : 'CLI_UNREACHABLE' };
      });
      opening.options = [{ id: 'finish', text: '收下奖励', unavailable_text: '不可选', risk: 'normal', outcome: {
        text: '街坊给你送来了奖励×一份。', next_stage_id: 'recovery', effects: [
          { type: 'attribute_add', attribute: 'wealth', amount: 1 },
          { type: 'injury_add', id: bundle.era.injuries[0]!.id },
          { type: 'identity_set', id: bundle.era.identities[0]!.id },
          { type: 'region_set', id: bundle.regions[0]!.id },
          { type: 'flag_add', id: 'CLI_REWARD' },
        ],
      } }];
      opening.stages = [{
        id: 'recovery', text: '歇脚后试着恢复体力。', check: { attribute: 'physique', dc: 14, modifier: 0 },
        success: { text: '伤势好了，精神也足了。', effects: [{ type: 'injury_remove', id: bundle.era.injuries[0]!.id }], next_stage_id: null },
        failure: { text: '伤势好了，仍需多歇一阵。', effects: [{ type: 'injury_remove', id: bundle.era.injuries[0]!.id }], next_stage_id: null },
      }];
    });
    const args = ['--content', context.content, '--state', context.state];
    const result = await runCli('play', args, 'choose finish\nstatus\nstatus\nquit\n');
    expectSuccess(result);
    expect(result.stdout.split('街坊给你送来了奖励×一份。')).toHaveLength(2);
    expect(result.stdout.indexOf('街坊给你送来了奖励×一份。')).toBeLessThan(result.stdout.indexOf('属性变动'));
    expect(result.stdout).toContain('伤病增加');
    expect(result.stdout).toContain('伤病移除');
    expect(result.stdout).toContain('身份变更');
    expect(result.stdout).toContain('地区变更');
    expect(result.stdout.match(/达成成就/g)).toHaveLength(1);
    expect((await savedLife(context.state)).engine.payload.run.status).toBe('ENDED');
    const resumed = await runCli('play', args, 'status\nquit\n');
    expectSuccess(resumed);
    expect(resumed.stdout).not.toContain('达成成就');
    expect(resumed.stdout).toContain(context.bundle.achievements[0]!.name);
    expect((await savedLife(context.state)).engine.payload.run.status).toBe('ENDED');
  });
});
