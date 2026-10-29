import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { recordCommand } from '../../assets/scripts/application/ReplayCommands.js';
import { buildInitializationFailureReplay, replay, validateReplay } from '../../tools/lib/Replay.js';
import { sha256 } from '../../tools/lib/canonical.js';
import { loadTemplate } from '../helpers/content.js';

describe('Replay diagnostics before initialization commits', () => {
  it('records and reproduces a real automatic-opening capacity failure without inventing a save', async () => {
    const content = await loadTemplate();
    content.rules.chains.max_active = 1;
    content.events = content.events.filter(event => event.trigger.kind !== 'opening');
    content.events.push({
      id: 'OPEN_CAPACITY', text: 'Two projects exceed available capacity.',
      trigger: { kind: 'opening', weight: 1, trigger_probability: 1 }, interaction: 'automatic',
      outcome: { text: 'Begin both projects.', effects: [
        { type: 'chain_start', id: 'CH_WORKSHOP' }, { type: 'chain_start', id: 'CH_WORKSHOP' },
      ], next_stage_id: null },
    });
    const fingerprint = sha256(content);
    const engine = new GameEngine(content, fingerprint);
    const { result, command } = recordCommand(engine, { api: 'initGame', commandId: 'init', args: { seed: 1640 } }, sha256);
    expect(result).toMatchObject({ ok: false, error: { code: 'OUTCOME_NOT_APPLICABLE' } });
    expect(() => engine.exportSave()).toThrow();
    const trace = buildInitializationFailureReplay(content, fingerprint, 1640, command);
    expect(trace.expected_final_hash).toBeNull();
    expect(replay(content, fingerprint, trace)).toEqual({ ok: true, kind: 'life', final_hash: null });
    expect(() => validateReplay({ ...trace, expected_final_hash: sha256(null) })).toThrow();
    expect(() => validateReplay({ ...trace, commands: [...trace.commands, trace.commands[0]] })).toThrow();
    expect(() => validateReplay({ ...trace, kind: 'gacha' })).toThrow();
    const altered = structuredClone(trace);
    altered.commands[0].expected_result_hash = sha256('different');
    expect(() => replay(content, fingerprint, altered)).toThrow(expect.objectContaining({ code: 'REPLAY_DIVERGED', command_index: 0 }));
    const success = structuredClone(trace);
    delete success.commands[0].error_code;
    expect(() => validateReplay(success)).toThrow();
  });
});
