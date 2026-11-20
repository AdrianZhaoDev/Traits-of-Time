import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/controller.ts';
import { GameViewBuilder } from '../src/view.ts';
import { ACHIEVEMENT_CATALOG } from '../src/game/presentation/CollectionCatalog.ts';
import { CollectionGoalStore } from '../src/game/presentation/CollectionGoal.ts';

const RECORD_KEY = 'time-travel.lifetime-records.v2';
const GOAL_KEY = 'time-travel.collection-goal.v1';
function storage(initial = []) {
  const values = new Map(initial);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function builder(controller, port) {
  const context = { save() {}, restore() {}, measureText: text => ({ width: [...text].length * 24 }) };
  return new GameViewBuilder(controller, {}, { storage: port, context, getViewport: () => ({ width: 360 }), asset: path => path }, () => {}, () => {});
}
function scene(view, controller) { return view.overlay(controller.snapshot, 1600, 0, 0); }
function invoke(view, controller, id) {
  const action = scene(view, controller).actions.find(item => item.id === id);
  assert.ok(action, `missing action ${id}`);
  assert.equal(action.disabled, false);
  action.invoke();
}

test('goal preference is isolated, verified, and does not write in read-only mode', () => {
  const port = storage([[RECORD_KEY, 'untouched-records'], ['time-travel.current-life.a.v1', 'untouched-life']]);
  const goal = new CollectionGoalStore(port);
  assert.equal(goal.set({ kind: 'achievements', id: 'A_SAMPLE' }, true), true);
  assert.deepEqual(new CollectionGoalStore(port).goal, { kind: 'achievements', id: 'A_SAMPLE' });
  const before = new Map(port.values);
  assert.equal(goal.set(null, false), false);
  assert.deepEqual(port.values, before);
  assert.equal(port.getItem(RECORD_KEY), 'untouched-records');
  assert.equal(port.getItem('time-travel.current-life.a.v1'), 'untouched-life');
  assert.equal(goal.set(null, true), true);
  assert.equal(new CollectionGoalStore(port).goal, null);
});

test('a failed or unreadable preference never blocks records or pretends to save', () => {
  const port = storage([[GOAL_KEY, '{broken'], [RECORD_KEY, 'keep']]);
  const goal = new CollectionGoalStore(port);
  assert.equal(goal.goal, null);
  assert.match(goal.warning, /无法读取/);
  port.setItem = () => { throw new Error('quota'); };
  assert.equal(goal.set({ kind: 'deaths', id: 'D_SAMPLE' }, true), false);
  assert.equal(goal.goal, null);
  assert.match(goal.warning, /未能确认保存/);
  assert.equal(port.getItem(RECORD_KEY), 'keep');
  assert.equal(port.getItem(GOAL_KEY), '{broken');
});

test('codex keeps historical IDs out of progress while retaining known and unknown records', () => {
  const records = { version: 2, inheritanceAvailable: false, records: [{ id: 'old', age: 70, years: 30,
    achievements: ['A_NATIVE_BOWL_CONGEE', 'A_OLD_REMOVED'], death_id: 'D_OLD_REMOVED' }] };
  const port = storage([[RECORD_KEY, JSON.stringify(records)]]);
  const controller = new GameController(port);
  const view = builder(controller, port);
  controller.open('achievements');
  let output = scene(view, controller);
  const bowl = controller.bundle.achievements.find(item => item.id === 'A_NATIVE_BOWL_CONGEE');
  assert.ok(bowl);
  assert.ok(!output.text.includes(bowl.name));
  assert.ok(!output.text.some(text => text.includes('A_OLD_REMOVED')));
  invoke(view, controller, 'codex_scope_history');
  output = scene(view, controller);
  assert.ok(output.text.includes(bowl.name));
  assert.ok(output.text.includes(bowl.text));
  assert.ok(output.text.some(text => text.includes('A_OLD_REMOVED')));
  assert.equal(controller.snapshot.records.achievements.has('A_OLD_REMOVED'), true);
  invoke(view, controller, 'codex_deaths');
  assert.ok(scene(view, controller).text.some(text => text.includes('D_OLD_REMOVED')));
  assert.equal(port.getItem(RECORD_KEY), JSON.stringify(records));
});

test('only a verified hinted item can be chosen, restored, filtered and cleared without a reward', () => {
  const port = storage();
  const controller = new GameController(port);
  const view = builder(controller, port);
  controller.open('achievements');
  const candidate = controller.bundle.achievements.find(item => ACHIEVEMENT_CATALOG[item.id]?.status === 'current' && ACHIEVEMENT_CATALOG[item.id]?.hint);
  assert.ok(candidate, 'need a verified achievement with a truthful hint');
  const before = controller.snapshot.records;
  invoke(view, controller, 'codex_goal_' + candidate.id);
  assert.deepEqual(new CollectionGoalStore(port).goal, { kind: 'achievements', id: candidate.id });
  assert.equal(controller.snapshot.records.inheritanceAvailable, before.inheritanceAvailable);
  assert.deepEqual(controller.snapshot.records.achievements, before.achievements);
  assert.ok(scene(view, controller).text.some(text => text.includes(`收集目标：${candidate.name}`)));
  const restored = builder(controller, port);
  assert.ok(scene(restored, controller).text.some(text => text.includes(`收集目标：${candidate.name}`)));
  invoke(restored, controller, 'codex_status_collected');
  assert.ok(!scene(restored, controller).actions.some(action => action.id === 'codex_goal_' + candidate.id));
  invoke(restored, controller, 'clearCollectionGoal');
  assert.equal(new CollectionGoalStore(port).goal, null);
});

test('an unavailable old goal remains visible and clearable, without automatic substitution', () => {
  const value = JSON.stringify({ version: 1, goal: { kind: 'achievements', id: 'A_OLD_REMOVED' } });
  const port = storage([[GOAL_KEY, value]]);
  const controller = new GameController(port);
  const view = builder(controller, port);
  controller.open('achievements');
  assert.ok(scene(view, controller).text.some(text => text.includes('当前版本暂不可追')));
  assert.equal(port.getItem(GOAL_KEY), value);
  invoke(view, controller, 'clearCollectionGoal');
  assert.equal(new CollectionGoalStore(port).goal, null);
});
