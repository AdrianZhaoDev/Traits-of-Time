import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { loadTemplate } from '../helpers/content.js';
import type { CommandResult } from '../../assets/scripts/core/types/commands.js';

function offers(result: CommandResult): string[] {
  if (!result.ok || result.pending?.kind !== 'card') throw new Error('Expected card selection');
  return result.pending.cards;
}
const fingerprint = 'c'.repeat(64);

describe('C3 opening card selection', () => {
  it('offers deterministic unique weighted candidates without running opening events', async () => {
    const content = await loadTemplate();
    for (let seed = 0; seed < 32; seed++) {
      const engine = new GameEngine(content, fingerprint);
      const initial = engine.initGame({ seed });
      const cards = offers(initial);
      const positive = content.pools.find(pool => pool.id === content.rules.opening.pool_id)!.entries.filter(entry => entry.weight > 0);
      expect(cards).toHaveLength(Math.min(3, positive.length));
      expect(new Set(cards).size).toBe(cards.length);
      expect(cards.every(id => positive.some(entry => entry.card_id === id))).toBe(true);
      expect(initial).toEqual(new GameEngine(content, fingerprint).initGame({ seed }));
      expect(initial).toMatchObject({ ok: true, logs: [], state: { status: 'AWAITING_CARD', active_event: null, player: { cards: [], achievements: [] } } });
      const before = engine.exportSave();
      expect(before.payload.run).toMatchObject({ death: null, ending: null, card_offers: cards, event_counter: 0 });
      expect(engine.nextYear('early')).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
      expect(engine.selectCard('outside', 'not-offered')).toMatchObject({ ok: false, error: { code: 'CARD_UNAVAILABLE' } });
      expect(engine.exportSave()).toEqual(before);
    }
  });


  it.each([1, 2])('offers all %i positive cards and excludes zero weights', async count => {
    const content = await loadTemplate();
    const pool = content.pools.find(pool => pool.id === content.rules.opening.pool_id)!;
    pool.entries.forEach((entry, index) => { entry.weight = index < count ? index + 1 : 0; });
    const engine = new GameEngine(content, fingerprint);
    expect(new Set(offers(engine.initGame({ seed: 0 })))).toEqual(new Set(pool.entries.slice(0, count).map(entry => entry.card_id)));
  });

  it('restores both sides of selection, replays receipts and rejects tampering atomically', async () => {
    const content = await loadTemplate();
    const engine = new GameEngine(content, fingerprint);
    const cards = offers(engine.initGame({ seed: 17 }));
    const before = engine.exportSave();
    const restored = new GameEngine(content, fingerprint);
    restored.restoreSave(before);
    expect(restored.current()).toEqual(engine.current());
    const selected = engine.selectCard('card', cards[0]!);
    expect(selected).toEqual(restored.selectCard('card', cards[0]!));
    expect(selected).toMatchObject({ ok: true, state: { player: { cards: [cards[0]] } } });
    if (!selected.ok) throw new Error(selected.error.code);
    expect(selected.logs.filter(log => log.type === 'card_selected')).toHaveLength(1);
    expect(selected.logs.find(log => log.type === 'opening')?.data).toMatchObject({ card_id: cards[0] });
    const after = engine.exportSave();
    expect(after.save_version).toBe(4);
    expect(after.payload.run.card_offers).toEqual([]);
    restored.restoreSave(after);
    expect(restored.selectCard('card', cards[0]!)).toEqual(selected);
    expect(restored.selectCard('card', 'other')).toMatchObject({ ok: false, error: { code: 'COMMAND_ID_CONFLICT' } });
    expect(restored.selectCard('again', cards[0]!)).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    expect(restored.exportSave()).toEqual(after);
    const corruptions = [
      () => { const save = structuredClone(before); save.payload.run.card_offers.reverse(); return save; },
      () => { const save = structuredClone(before); save.payload.run.status = 'READY'; return save; },
      () => { const save = structuredClone(after); save.payload.run.processed_commands.card!.parameters.args = ['not-offered']; return save; },
      () => { const save = structuredClone(after); Reflect.set(save, 'save_version', 3); return save; },
    ];
    for (const corrupt of corruptions) {
      expect(() => restored.restoreSave(corrupt())).toThrow(expect.objectContaining({ code: 'SAVE_INVALID' }));
      expect(restored.exportSave()).toEqual(after);
    }
  });
});
