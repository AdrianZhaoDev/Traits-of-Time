import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/controller.ts';
import { GameViewBuilder } from '../src/view.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function findAction(scene, id) {
  const action = scene.actions.find(item => item.id === id);
  assert.ok(action && !action.disabled, `available action ${id}`);
  return action;
}

test('a real life keeps the same decision through restart cancellation and can reopen its first year', async t => {
  const timer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => timer(fn, ms === 220 ? 0 : ms, ...args));
  const storage = memoryStorage();
  const controller = new GameController(storage);
  const context = { save() {}, restore() {}, measureText: text => ({ width: [...text].length * 24 }) };
  const platform = { storage, context, getViewport: () => ({ width: 360 }), asset: path => path };
  const builder = new GameViewBuilder(controller, {}, platform, () => {}, () => {});
  const base = () => builder.base(controller.snapshot, 1334, 0, 0);
  const overlay = () => builder.overlay(controller.snapshot, 1334, 0, 0);

  await controller.start(123);
  controller.revealCards();
  await controller.selectCard(controller.snapshot.view.pending.cards[0]);
  await controller.confirmCard();
  const startYear = controller.snapshot.view.player.start_year;
  const opening = controller.snapshot.folds.find(item => item.type === 'opening' && item.calendarYear === startYear);
  assert.ok(opening?.introText, 'real opening record is available');
  let checkedDecision = false;
  let checkedYear = false;

  for (let step = 0; step < 160 && !(checkedDecision && checkedYear); step++) {
    const snapshot = controller.snapshot;
    assert.notEqual(snapshot.view.status, 'ENDED', 'the fixture must reach the tested interactions');
    if (!checkedYear && snapshot.view.player.calendar_year > startYear) {
      let scene = base();
      const year = scene.actions.find(item => item.id.startsWith(`historyYear_${startYear}_`));
      assert.ok(year && !year.disabled, 'the original year can be opened');
      assert.ok(!scene.text.includes(opening.introText), 'the old year starts collapsed');
      year.invoke();
      scene = base();
      assert.ok(scene.text.includes(opening.introText), 'opening the year reveals the original record');
      checkedYear = true;
    }

    const pending = snapshot.view.pending;
    if (pending?.kind === 'option') {
      if (!checkedDecision) {
        const before = JSON.stringify(pending);
        findAction(overlay(), 'decisionCareer').invoke();
        assert.equal(controller.snapshot.overlay, 'career');
        await findAction(overlay(), 'restartLife').invoke();
        assert.equal(controller.snapshot.overlay, 'restart');
        controller.close();
        assert.equal(controller.snapshot.overlay, 'career');
        controller.close();
        assert.equal(controller.snapshot.overlay, 'decision');
        assert.equal(JSON.stringify(controller.snapshot.view.pending), before);
        checkedDecision = true;
      }
      const choice = controller.snapshot.view.pending.options.find(item => item.available);
      assert.ok(choice, 'the real decision has an available option');
      await controller.choose(choice.id);
    } else if (pending?.kind === 'stage') {
      await controller.resolveStage();
    } else {
      await controller.advance();
    }
  }

  assert.ok(checkedDecision, 'the real life reached a decision');
  assert.ok(checkedYear, 'the real life advanced beyond its first year');
});
