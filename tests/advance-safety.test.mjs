import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { GameController } from '../src/controller.ts';
import { CurrentLifeStore } from '../src/game/application/CurrentLifeStore.ts';

// The package is CommonJS with dynamic webpack exports; expose its real exports
// to Node's ESM test loader just as the application bundler does.
const require = createRequire(import.meta.url);
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', { value: { devicePixelRatio: 1 }, configurable: true, writable: true });
const canvasLibrary = require('minigame-canvas-engine');
if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
else delete globalThis.window;
const canvasUrl = pathToFileURL(require.resolve('minigame-canvas-engine')).href;
const facade = 'data:text/javascript,' + encodeURIComponent(
  `import library from ${JSON.stringify(canvasUrl)}; export const { Layout, ScrollView, env } = library;`,
);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'minigame-canvas-engine' && context.parentURL?.endsWith('/src/renderer.ts')) {
      return { url: facade, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { GameRenderer } = await import('../src/renderer.ts');

class Storage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

function fixture(controller, lethal = false, secondChoice = false) {
  const bundle = structuredClone(controller.bundle);
  bundle.chains = [];
  bundle.achievements = [];
  bundle.era.age_transitions = [];
  for (const source of [...bundle.regions, ...bundle.castes]) { source.modifiers = {}; source.flags = []; }
  for (const background of bundle.era.backgrounds) {
    background.modifiers = { intelligence: 15, luck: 11 };
    background.flags = [];
  }
  bundle.rules.age_bands = [{ id: 'test-adult', min: 25, max: 25, weight: 1, modifiers: {} }];
  const outcome = (text, next_stage_id) => ({ text, effects: [], next_stage_id });
  const death = { text: '终局', effects: [{ type: 'death', id: bundle.era.old_age_death_id }], next_stage_id: null };
  const stage = (id, next) => ({
    id, text: id, check: { attribute: 'intelligence', dc: 10, modifier: 0, raw_minimum: 10 },
    success: lethal && id === 'S_ONE' ? death : outcome(id + '成功', next),
    failure: lethal && id === 'S_ONE' ? death : outcome(id + '失败', next),
  });
  bundle.events = [{ id: 'E_TEST_CHECK', text: '开始检定', interaction: 'choice',
    trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
    options: [{ id: 'O_TEST', text: '开始', risk: 'normal', outcome: outcome('行动', 'S_ONE') }],
    stages: [stage('S_ONE', 'S_TWO'), stage('S_TWO', null)] }];
  if (secondChoice) {
    bundle.rules.opening.year_min = 1630;
    bundle.rules.opening.year_max = 1630;
    bundle.events.push({ id: 'E_TEST_NEXT_CHOICE', text: '下一次抉择', interaction: 'choice',
      trigger: { kind: 'historical', year: 1630, priority: 1 },
      options: [{ id: 'O_WAIT', text: '等待', risk: 'normal', outcome: outcome('等待', null) }] });
  }
  controller.bundle = bundle;
  return bundle;
}

async function choiceFixture(lethal = false, secondChoice = false) {
  const storage = new Storage();
  const controller = new GameController(storage);
  const bundle = fixture(controller, lethal, secondChoice);
  await controller.start(17);
  controller.revealCards();
  await controller.selectCard(controller.snapshot.view.pending.cards[0]);
  await controller.confirmCard();
  assert.equal(controller.snapshot.view.pending.kind, 'option');
  assert.equal(controller.snapshot.overlay, 'decision');
  return { controller, storage, bundle };
}

function restoredFrom(storage, bundle) {
  const copied = new Storage();
  const controller = new GameController(copied);
  controller.bundle = bundle;
  for (const [key, value] of storage.values) copied.values.set(key, value);
  controller.continueLife();
  return controller;
}

function accelerateChecks(t) {
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => timeout(fn, ms === 220 ? 0 : ms, ...args));
}

function installWebBlur(controller, t) {
  const listeners = new Map();
  const host = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: host, configurable: true, writable: true });
  const renderer = Object.create(GameRenderer.prototype);
  Object.assign(renderer, {
    platform: { kind: 'web', canvas: { addEventListener() {}, removeEventListener() {} } },
    cleanups: [], controller, gesture: { action: { kind: 'seal' } }, pointerId: 1, focusId: 'advance', clearFeedback() {},
  });
  renderer.installInput();
  t.after(() => {
    for (const cleanup of renderer.cleanups) cleanup();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
  return { renderer, blur: listeners.get('blur') };
}

const diceLogs = save => save.engine.payload.logs.filter(log => log.type === 'dice');
const stageCommands = save => save.replay_commands.filter(command => command.api === 'resolveStage');

test('automatic stages publish inline progress and persist each receipt without choosing for the player', async t => {
  accelerateChecks(t);
  const { controller, storage } = await choiceFixture();
  const observed = [];
  const dice = [];
  controller.subscribe((snapshot, logs) => {
    if (snapshot.view?.pending?.kind === 'stage') observed.push({ overlay: snapshot.overlay, notice: snapshot.notice });
    dice.push(...logs.filter(log => log.type === 'dice'));
  });
  await controller.choose('O_TEST');
  const save = controller.session.exportSave();
  assert.equal(controller.snapshot.view.status, 'READY');
  assert.ok(observed.length >= 2);
  assert.ok(observed.every(entry => entry.overlay === null && entry.notice.startsWith('检定中')));
  assert.deepEqual(stageCommands(save).map(command => command.args.stageId), ['S_ONE', 'S_TWO']);
  assert.deepEqual(dice.map(log => log.seq), diceLogs(save).map(log => log.seq));
  assert.deepEqual(controller.rawLogs.filter(log => log.type === 'dice').map(log => log.metadata.check_attribute), ['intelligence', 'intelligence']);
  assert.ok(dice.every(log => !Object.hasOwn(log.data, 'check_attribute')));
  assert.equal(new Set(dice.map(log => log.seq)).size, 2);
  assert.equal(save.replay_commands.filter(command => command.api === 'resolveOption').length, 1);
  const durable = new CurrentLifeStore(storage).read(() => {});
  assert.equal(durable.status, 'ready');
  assert.deepEqual(structuredClone(durable.save.engine), structuredClone(save.engine));
  assert.deepEqual(structuredClone(controller.snapshot.logs), structuredClone(save.engine.payload.logs));
  assert.ok(controller.snapshot.folds.some(fold => fold.calendarYear === save.engine.payload.player.calendar_year));
  controller.home();
  assert.deepEqual(controller.snapshot.logs, []);
});

test('automatic stages stop at the next choice without selecting it', async t => {
  accelerateChecks(t);
  const { controller } = await choiceFixture(false, true);
  await controller.choose('O_TEST');
  assert.equal(controller.snapshot.view.status, 'AWAITING_OPTION');
  assert.equal(controller.snapshot.view.pending.event_id, 'E_TEST_NEXT_CHOICE');
  assert.equal(controller.snapshot.overlay, 'decision');
  const commands = controller.session.exportSave().replay_commands;
  assert.equal(commands.filter(command => command.api === 'resolveStage').length, 2);
  assert.equal(commands.filter(command => command.api === 'resolveOption').length, 1);
});

test('a restored pending stage stays paused and does not roll until explicitly continued', async t => {
  accelerateChecks(t);
  const { controller, storage, bundle } = await choiceFixture();
  let paused = false;
  controller.subscribe(snapshot => {
    if (!paused && snapshot.busy && snapshot.view?.pending?.kind === 'stage') {
      paused = true;
      controller.pauseAutomatic();
    }
  });
  await controller.choose('O_TEST');
  assert.equal(controller.snapshot.overlay, 'stage');
  const before = controller.session.exportSave();
  assert.equal(stageCommands(before).length, 0);
  const restored = restoredFrom(storage, bundle);
  assert.equal(restored.snapshot.overlay, 'stage');
  assert.equal(restored.snapshot.view.pending.stage_id, 'S_ONE');
  assert.deepEqual(restored.session.exportSave().engine, before.engine);
  assert.deepEqual(structuredClone(restored.snapshot.logs), structuredClone(before.engine.payload.logs));
  assert.deepEqual(restored.session.exportSave().replay_commands, before.replay_commands);
  await Promise.resolve();
  assert.deepEqual(restored.session.exportSave().engine, before.engine);
  await restored.resolveStage();
  assert.equal(restored.snapshot.view.status, 'READY');
  assert.deepEqual(stageCommands(restored.session.exportSave()).map(command => command.args.stageId), ['S_ONE', 'S_TWO']);
});

test('background interruption lets an in-flight stage commit, then pauses before the next stage', async t => {
  accelerateChecks(t);
  const { controller, storage, bundle } = await choiceFixture();
  const { renderer, blur } = installWebBlur(controller, t);
  const session = controller.session;
  const persist = session.ports.persist;
  const { promise: inFlight, resolve: entered } = Promise.withResolvers();
  const { promise: gate, resolve: release } = Promise.withResolvers();
  let delayed = false;
  session.ports.persist = async save => {
    if (!delayed && save.replay_commands.at(-1).api === 'resolveStage') {
      delayed = true;
      await persist(save);
      entered();
      await gate;
      return;
    }
    await persist(save);
  };
  const choosing = controller.choose('O_TEST');
  await inFlight;
  blur();
  assert.equal(renderer.gesture, null);
  assert.equal(renderer.focusId, null);
  const durable = new CurrentLifeStore(storage).read(() => {});
  assert.equal(durable.status, 'ready');
  assert.equal(stageCommands(durable.save).length, 1);
  assert.equal(controller.snapshot.logs.filter(log => log.type === 'dice').length, 0);
  release();
  await choosing;
  assert.equal(controller.snapshot.overlay, 'stage');
  assert.equal(controller.snapshot.view.pending.stage_id, 'S_TWO');
  const pausedSave = session.exportSave();
  assert.deepEqual(stageCommands(pausedSave).map(command => command.args.stageId), ['S_ONE']);
  assert.equal(diceLogs(pausedSave).length, 1);
  const restored = restoredFrom(storage, bundle);
  assert.equal(restored.snapshot.view.pending.stage_id, 'S_TWO');
  assert.deepEqual(restored.session.exportSave().engine, pausedSave.engine);
  await restored.resolveStage();
  const continued = restored.session.exportSave();
  assert.deepEqual(stageCommands(continued).map(command => command.args.stageId), ['S_ONE', 'S_TWO']);
  assert.deepEqual(diceLogs(continued)[0], diceLogs(pausedSave)[0]);
  assert.equal(diceLogs(continued).length, 2);
});

test('a failed stage save stops advancement and reloads the durable pending check', async t => {
  accelerateChecks(t);
  for (const written of [false, true]) {
    const { controller } = await choiceFixture();
    const session = controller.session;
    const persist = session.ports.persist;
    let failed = false;
    session.ports.persist = async save => {
      if (!failed && save.replay_commands.at(-1).api === 'resolveStage') {
        failed = true;
        if (written) await persist(save);
        throw new Error('quota');
      }
      await persist(save);
    };
    await controller.choose('O_TEST');
    assert.equal(controller.snapshot.saveBlocked, true);
    assert.equal(controller.snapshot.overlay, 'saveFailure');
    controller.retryStorage();
    assert.equal(controller.snapshot.overlay, 'stage');
    assert.equal(controller.snapshot.view.pending.stage_id, written ? 'S_TWO' : 'S_ONE');
    assert.equal(diceLogs(controller.session.exportSave()).length, written ? 1 : 0);
    await controller.resolveStage();
    assert.equal(diceLogs(controller.session.exportSave()).length, 2);
  }
});

test('death during an automatic check stops the chain and opens the ending', async t => {
  accelerateChecks(t);
  const { controller } = await choiceFixture(true);
  await controller.choose('O_TEST');
  assert.equal(controller.snapshot.view.status, 'ENDED');
  assert.equal(controller.snapshot.overlay, 'ending');
  assert.deepEqual(stageCommands(controller.session.exportSave()).map(command => command.args.stageId), ['S_ONE']);
});

function gestureRenderer(bounds = { left: 0, right: 110, top: 0, bottom: 200 }) {
  const renderer = Object.create(GameRenderer.prototype);
  let calls = 0;
  const action = { id: 'advance', kind: 'seal', disabled: false, invoke() { calls++; } };
  Object.assign(renderer, {
    state: { overlay: null, busy: false, view: { status: 'READY' } },
    pointerId: null, gesture: null, feedback: null,
    baseLayout: { getElementById: () => ({}), getElementViewportRect: () => bounds },
    audio: { unlock() {} }, actionAt: () => action, showFeedback() {}, clearFeedback() {},
    invoke: selected => selected.invoke(),
    controller: { advance() { calls++; } },
  });
  const input = (name, x = 100, y = 100) => renderer.route(name, { type: name, touches: [], changedTouches: [] }, { x, y, id: 1 });
  return { renderer, input, calls: () => calls };
}

test('seal release, cancellation, movement, and crossing its edge end held authorization', () => {
  for (const [event, x] of [['touchend', 100], ['touchcancel', 100], ['touchmove', 111], ['touchmove', 133]]) {
    const { renderer, input, calls } = gestureRenderer(event === 'touchmove' && x === 133
      ? { left: 0, right: 300, top: 0, bottom: 200 } : undefined);
    input('touchstart');
    assert.equal(calls(), 1);
    assert.ok(renderer.gesture);
    input(event, x);
    assert.equal(renderer.gesture, null);
    renderer.advanceHeldYear(Date.now() + 1000);
    assert.equal(calls(), 1);
  }
});

test('held years advance serially only at READY without revoking a normal automatic stage', () => {
  const { renderer, input, calls } = gestureRenderer();
  input('touchstart');
  const now = Date.now() + 1000;
  renderer.state.busy = true;
  renderer.state.view.status = 'AWAITING_STAGE';
  renderer.actionAt = () => undefined; // The busy-state button can be disabled after relayout.
  input('touchmove', 101);
  renderer.advanceHeldYear(now);
  assert.ok(renderer.gesture);
  assert.equal(calls(), 1);
  renderer.state.busy = false;
  renderer.state.view.status = 'READY';
  renderer.advanceHeldYear(now + 1);
  assert.equal(calls(), 2);
  renderer.state.busy = true;
  renderer.advanceHeldYear(now + 1000);
  assert.equal(calls(), 2);
  renderer.state.busy = false;
  renderer.state.overlay = 'decision';
  renderer.advanceHeldYear(now + 2000);
  assert.equal(calls(), 2);
  assert.equal(renderer.gesture, null);
  renderer.state.overlay = null;
  renderer.advanceHeldYear(now + 3000);
  assert.equal(calls(), 2);
  for (const status of ['AWAITING_OPTION', 'ENDED']) {
    const next = gestureRenderer();
    next.input('touchstart');
    next.renderer.state.view.status = status;
    next.renderer.advanceHeldYear(now);
    assert.equal(next.renderer.gesture, null);
    assert.equal(next.calls(), 1);
  }
});

function fakeScroll(top, height = 2000, viewport = 200) {
  const scroll = Object.create(canvasLibrary.ScrollView.prototype);
  Object.defineProperties(scroll, {
    scrollTop: { value: top, writable: true },
    scrollHeight: { value: height },
    layoutBox: { value: { height: viewport } },
    scrollTo: { value(_left, next) { this.scrollTop = next; } },
  });
  return scroll;
}

test('history and compact scrollers preserve offsets unless latest is explicitly requested', () => {
  for (const id of ['history', 'compactGame']) {
    const renderer = Object.create(GameRenderer.prototype);
    renderer.feedback = null;
    renderer.height = 500;
    let elements = new Map([[id, fakeScroll(325)]]);
    const layout = {
      getElementById: key => elements.get(key),
      clear() { elements = new Map(); },
      init() { elements.set(id, fakeScroll(0)); },
      layout() {}, ticker: { next(callback) { callback(); } },
    };
    const scene = { scrollIds: [id], xml: '', styles: {}, actions: [] };
    renderer.renderScene(layout, { clearRect() {} }, scene, false);
    assert.equal(elements.get(id).scrollTop, 325);
    renderer.renderScene(layout, { clearRect() {} }, scene, true);
    assert.equal(elements.get(id).scrollTop, 1800);
  }
});
