import { describe, expect, it } from 'vitest';
import type { PendingDecision } from '../../assets/scripts/core/types/schema.js';
import { chooseAutomaticOption } from '../../tools/lib/AutoPlay.js';

const decision = (instance: string): Extract<PendingDecision, { kind: 'option' }> => ({
  kind: 'option', event_instance_id: instance, event_id: 'event',
  options: [
    { id: 'locked', text: '不可用', risk: 'high', checks: [], available: false, reason: '条件不符' },
    { id: 'left', text: '左路', risk: 'safe', checks: [], available: true, reason: null },
    { id: 'right', text: '右路', risk: 'normal', checks: [], available: true, reason: null },
  ],
});

describe('automatic play option selection', () => {
  it('selects both legal routes across deterministic runs, never the locked route', () => {
    const selected = new Set(Array.from({ length: 32 }, (_, seed) =>
      chooseAutomaticOption(decision(`life:content:${seed}:event:1`))));
    expect(selected).toEqual(new Set(['left', 'right']));
  });

  it('repeats the same choice after restoring a pending event without changing it', () => {
    const pending = decision('life:content:1640:event:3');
    const snapshot = structuredClone(pending);
    const first = chooseAutomaticOption(pending);
    expect(chooseAutomaticOption(structuredClone(snapshot))).toBe(first);
    expect(pending).toEqual(snapshot);
  });

  it('takes the only legal choice and fails explicitly if none remain', () => {
    const pending = decision('life:content:7:event:1');
    pending.options[1].available = false;
    expect(chooseAutomaticOption(pending)).toBe('right');
    pending.options[2].available = false;
    expect(() => chooseAutomaticOption(pending)).toThrow(expect.objectContaining({ code: 'NO_AVAILABLE_OPTION' }));
  });
});
