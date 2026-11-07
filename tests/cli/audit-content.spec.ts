import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { cliFixtures, expectSuccess, runCli } from './helpers.js';

const fixture = cliFixtures();

describe('audit-content: authored effect scopes', () => {
  it('counts each event outcome once and separates chain completion without modifying content', async () => {
    const context = await fixture(bundle => {
      bundle.events = [
        { id: 'E_AUDIT_AUTO', text: '自动事件', interaction: 'automatic',
          trigger: { kind: 'random', weight: 1, trigger_probability: 1, cooldown_years: 0, max_occurrences: null, rare: false },
          outcome: { text: '自动效果', effects: [{ type: 'attribute_add', attribute: 'physique', amount: 2 }], next_stage_id: 'S_AUDIT' },
          stages: [{ id: 'S_AUDIT', text: '真实检定', check: { attribute: 'intelligence', dc: 12, modifier: 0 },
            success: { text: '成功效果', effects: [{ type: 'flag_add', id: 'AUDIT_SUCCESS' }], next_stage_id: null },
            failure: { text: '失败效果', effects: [{ type: 'attribute_add', attribute: 'wealth', amount: -1 }], next_stage_id: null } }] },
        { id: 'E_AUDIT_CHOICE', text: '选择事件', interaction: 'choice',
          trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
          options: [{ id: 'start', text: '投入事业', risk: 'normal', unavailable_text: '不可选',
            outcome: { text: '启动事业', effects: [{ type: 'chain_start', id: 'CH_WORKSHOP' }], next_stage_id: null } }] },
        { id: 'E_AUDIT_NODE', text: '链节点', interaction: 'automatic', trigger: { kind: 'chain' },
          outcome: { text: '节点完成', effects: [], next_stage_id: null } },
      ];
      const chain = bundle.chains.find(item => item.id === 'CH_WORKSHOP')!;
      chain.nodes = [{ after_years: 1, event_id: 'E_AUDIT_NODE' }];
      chain.completion.effects = [{ type: 'flag_add', id: 'AUDIT_DONE' }, { type: 'attribute_add', attribute: 'prestige', amount: 3 }];
      bundle.chains = [chain];
      bundle.achievements = [];
    });
    const files = ['manifest.json', ...Object.values(context.bundle.manifest.files)];
    const before = await Promise.all(files.map(file => readFile(join(context.content, file), 'utf8')));
    const loaded = await loadContent(context.content);
    const result = await runCli('audit-content', ['--content', context.content, '--json']);
    expectSuccess(result);
    const report = JSON.parse(result.stdout);
    expect(report.content.fingerprint).toBe(loaded.fingerprint);
    expect(report.events).toMatchObject({ total: 3, options: 1, stages: 1, outcomes: 5,
      effects: { total: 4, by_type: { attribute_add: 2, flag_add: 1, chain_start: 1 } },
      attribute_add: { physique: { positive: 2, negative: 0, total_points: 2, count: 1 },
        wealth: { positive: 0, negative: -1, total_points: -1, count: 1 } } });
    expect(report.events.attribute_add.prestige).toBeUndefined();
    expect(report.chains.completion.effects).toEqual({ total: 2, by_type: { flag_add: 1, attribute_add: 1 } });
    expect(report.effects_scope).toMatchObject({ event_effects: 4, chain_completion_effects: 2, event_and_chain_completion_total: 6 });
    expect(await Promise.all(files.map(file => readFile(join(context.content, file), 'utf8')))).toEqual(before);
  }, 90_000);
});
