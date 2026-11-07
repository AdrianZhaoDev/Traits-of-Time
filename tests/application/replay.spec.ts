import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { recordCommand, validateReplayCommands } from '../../assets/scripts/application/ReplayCommands.js';
import { buildInitializationFailureReplay, buildReplay, replay, validateReplay } from '../../tools/lib/Replay.js';
import { sha256 } from '../../tools/lib/canonical.js';
import { loadTemplate } from '../helpers/content.js';

describe('Replay diagnostics across initialization and card selection', () => {
  it('rejects historical retirement actions before replay execution', () => {
    expect(() => validateReplayCommands([
      { api: 'initGame', commandId: 'init', args: { seed: 1640 }, expected_result_hash: sha256('init') },
      { api: 'retire', commandId: 'old-command', args: {}, expected_result_hash: sha256('ended') },
    ], 'life')).toThrow(expect.objectContaining({ code: 'REPLAY_INVALID' }));
  });

  it('records and reproduces a real initialization failure without inventing a save', async () => {
    const content = await loadTemplate();
    content.rules.age_bands = content.rules.age_bands.map(band => ({ ...band, weight: 0 }));
    const fingerprint = sha256(content);
    const engine = new GameEngine(content, fingerprint);
    const { result, command } = recordCommand(engine, { api: 'initGame', commandId: 'init', args: { seed: 1640 } }, sha256);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_DISTRIBUTION' } });
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

  it('records and reproduces an automatic-opening capacity failure at card selection without replacing the initialized save', async () => {
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
    const initialized = recordCommand(engine, { api: 'initGame', commandId: 'init', args: { seed: 1640 } }, sha256);
    if (!('ok' in initialized.result) || !initialized.result.ok || initialized.result.pending?.kind !== 'card') {
      throw new Error('Fixture must offer a card before its opening');
    }
    const before = engine.exportSave();
    const selected = recordCommand(engine, {
      api: 'selectCard', commandId: 'select-card', args: { cardId: initialized.result.pending.cards[0]! },
    }, sha256);
    expect(selected.result).toMatchObject({ ok: false, error: { code: 'OUTCOME_NOT_APPLICABLE' }, state: initialized.result.state });
    expect(engine.exportSave()).toEqual(before);
    const trace = buildReplay(engine, [initialized.command, selected.command]);
    expect(trace.expected_final_hash).toBe(sha256(before));
    expect(replay(content, fingerprint, trace)).toEqual({ ok: true, kind: 'life', final_hash: sha256(before) });
    expect(() => validateReplay({ ...trace, expected_final_hash: null })).toThrow();
    const altered = structuredClone(trace);
    altered.commands[1].expected_result_hash = sha256('different');
    expect(() => replay(content, fingerprint, altered)).toThrow(expect.objectContaining({ code: 'REPLAY_DIVERGED', command_index: 1 }));
    const success = structuredClone(trace);
    delete success.commands[1].error_code;
    expect(() => replay(content, fingerprint, success)).toThrow(expect.objectContaining({ code: 'REPLAY_DIVERGED', command_index: 1 }));
  });

  it('validates and replays an instance abandonment including its duplicate receipt', async () => {
    const content = await loadTemplate();
    content.rules.events.per_year = 0;
    content.events = content.events.filter(event => event.trigger.kind === 'chain');
    content.events.push({ id: 'OPEN_PROJECT', text: 'Begin project', interaction: 'automatic',
      trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
      outcome: { text: 'Started', effects: [{ type: 'chain_start', id: 'CH_WORKSHOP' }], next_stage_id: null } });
    const fingerprint = sha256(content);
    const engine = new GameEngine(content, fingerprint);
    const initialized = recordCommand(engine, { api: 'initGame', commandId: 'init', args: { seed: 1640 } }, sha256);
    if (!('ok' in initialized.result) || !initialized.result.ok || initialized.result.pending?.kind !== 'card') {
      throw new Error('Fixture must offer a card before its opening');
    }
    const selected = recordCommand(engine, {
      api: 'selectCard', commandId: 'select-card', args: { cardId: initialized.result.pending.cards[0]! },
    }, sha256);
    expect(selected.result).toMatchObject({ ok: true });
    const chainInstanceId = engine.exportSave().payload.player.chains[0]!.instance_id;
    const action = { api: 'abandonChain' as const, commandId: 'leave', args: { chainInstanceId } };
    const abandoned = recordCommand(engine, action, sha256);
    if (!('ok' in abandoned.result)) throw new Error('Expected a life command result');
    expect(abandoned.result.ok).toBe(true);
    const saved = engine.exportSave();
    const duplicate = recordCommand(engine, action, sha256);
    expect(duplicate).toEqual(abandoned);
    expect(engine.exportSave()).toEqual(saved);
    const trace = buildReplay(engine, [initialized.command, selected.command, abandoned.command, duplicate.command]);
    expect(() => validateReplay(trace)).not.toThrow();
    expect(replay(content, fingerprint, trace)).toEqual({ ok: true, kind: 'life', final_hash: sha256(saved) });
  });
});
