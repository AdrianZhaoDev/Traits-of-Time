import test from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../src/controller.ts';
import { GameViewBuilder } from '../src/view.ts';
import { cardPresentation } from '../src/presenters.ts';

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

async function fixture(bundleOverride) {
  const port = storage();
  const source = new GameController(port);
  await source.start(123);
  const calls = [];
  const controller = {
    bundle: bundleOverride ? bundleOverride(source.bundle) : source.bundle,
    choose: id => calls.push(['choose', id]),
    open: name => calls.push(['open', name]),
    start: () => calls.push(['start']),
    close: () => calls.push(['close']),
    inspectRelic: id => calls.push(['inspect', id]),
    advance: () => calls.push(['advance']),
    abandon: id => calls.push(['abandon', id]),
    resolveStage: () => calls.push(['stage']),
  };
  const context = { save() {}, restore() {}, measureText: text => ({ width: [...text].length * 24 }) };
  const platform = { storage: port, context, getViewport: () => ({ width: 360 }), asset: path => path };
  const builder = new GameViewBuilder(controller, {}, platform, () => {}, () => calls.push(['latest']));
  const snapshot = source.snapshot;
  const game = {
    ...snapshot, screen: 'game', overlay: null, busy: false, notice: '', folds: [],
    view: { ...snapshot.view, status: 'READY', pending: null,
      player: { ...snapshot.view.player, calendar_year: 1631, cards: [], chains: [], achievements: [] } },
  };
  return { controller, builder, game, calls, source };
}

const sceneText = scene => scene.text.join('\n');
const action = (scene, id) => {
  const found = scene.actions.find(item => item.id === id);
  assert.ok(found, `missing action ${id}`);
  return found;
};

test('old years can be reopened without losing ordered dice, results, changes, achievements or death', async () => {
  const { builder, game, controller } = await fixture();
  const achievement = controller.bundle.achievements[0];
  game.folds = [
    { id: 'first', calendarYear: 1630, age: 20, type: 'event', introText: 'legacy must not repeat', segments: [
      { kind: 'intro', text: '先前情境' },
      { kind: 'action', text: '真实行动' },
      { kind: 'dice', text: '第一次检定（原骰 8，失败）', details: ['真实难度 14'] },
      { kind: 'outcome', text: '第一次结果' },
      { kind: 'dice', text: '第二次检定（原骰 20，成功）' },
      { kind: 'effects', effectsText: ['体魄 -1（实际变化可能受上下限限制）'] },
      { kind: 'achievement', achievementId: achievement.id, text: `【${achievement.name}】真实成就短评` },
      { kind: 'death', text: '真实死因' },
    ] },
    { id: 'current', calendarYear: 1631, age: 21, type: 'event', introText: '本年记录', segments: [{ kind: 'intro', text: '本年记录' }] },
  ];
  let scene = builder.base(game, 1334, 0, 0);
  assert.ok(sceneText(scene).includes('本年记录'));
  assert.ok(!sceneText(scene).includes('先前情境'));
  const oldYear = scene.actions.find(item => item.id.startsWith('historyYear_1630_'));
  assert.match(oldYear.label, /1 条.*有新记录.*展开/);
  oldYear.invoke();
  scene = builder.base(game, 1334, 0, 0);
  const values = ['先前情境', '你的行动：真实行动', '第一次检定（原骰 8，失败）', '第一次结果',
    '第二次检定（原骰 20，成功）', '体魄 -1（实际变化可能受上下限限制）', `解锁成就：${achievement.name}`, '真实成就短评', '真实死因'];
  const indices = values.map(value => scene.text.indexOf(value));
  assert.ok(indices.every(index => index >= 0));
  assert.deepEqual([...indices].sort((a, b) => a - b), indices);
  assert.ok(!sceneText(scene).includes('legacy must not repeat'));
  assert.ok(!sceneText(scene).includes('真实难度 14'));
  const diceDetails = scene.actions.find(item => item.id.startsWith('diceDetails_'));
  assert.equal(diceDetails.pressed, false);
  diceDetails.invoke();
  scene = builder.base(game, 1334, 0, 0);
  assert.ok(sceneText(scene).includes('真实难度 14'));
  assert.equal(scene.actions.find(item => item.id.startsWith('diceDetails_')).pressed, true);
  scene.actions.find(item => item.id.startsWith('historyYear_1630_')).invoke();
  scene = builder.base(game, 1334, 0, 0);
  assert.ok(!sceneText(scene).includes('先前情境'));
  assert.doesNotMatch(scene.actions.find(item => item.id.startsWith('historyYear_1630_')).label, /有新记录/);
  const next = { ...game, view: { ...game.view, player: { ...game.view.player, calendar_year: 1632 } },
    folds: [...game.folds, { calendarYear: 1632, age: 22, type: 'event', introText: '下一年记录' }] };
  scene = builder.base(next, 1334, 0, 0);
  assert.match(scene.actions.find(item => item.id.startsWith('historyYear_1631_')).label, /有新记录/);
  assert.ok(sceneText(scene).includes('下一年记录'));
});

test('card bonus deduplication requires matching tag and amount', () => {
  const card = { id: 'test', name: '测试', rarity: 'R', tags: [],
    description: '工具说明。\n经世检定+1，不保证考中。', check_bonus: { tag: 'practical_learning', amount: 1 } };
  assert.equal(cardPresentation(card).effect, '检定修正受上限限制。');
  assert.match(cardPresentation({ ...card, check_bonus: { tag: 'farming', amount: 1 } }).effect, /农桑检定.*\+1/);
  assert.match(cardPresentation({ ...card, check_bonus: { tag: 'practical_learning', amount: 2 } }).effect, /经世检定.*\+2/);
  assert.match(cardPresentation({ ...card, description: '只有部分经世检定+1。' }).effect, /经世检定.*\+1/);
});

test('choice safety is visible before selection while engine check math is explicitly expandable', async () => {
  const check = { attribute: 'intelligence', dc: 14, modifier: 0, attribute_value: 10,
    modifier_before: 2, modifier_after: 1, luck_value: 8, luck_bonus: 0, effective_raw_minimum: 9,
    success_probability: 0.65, critical_probability: 0.1 };
  const outcome = { text: '继续', effects: [], next_stage_id: null };
  const choice = { id: 'choose', text: '处理屋顶', risk: 'high', unavailable_text: '无法处理',
    outcome: { text: '开始', effects: [{ type: 'attribute_add', attribute: 'wealth', amount: -2 },
      { type: 'chain_start', id: 'career-test' }], next_stage_id: 'roll' } };
  const event = { id: 'event-test', text: '屋顶漏雨', interaction: 'choice', options: [choice],
    stages: [{ id: 'roll', text: '修屋顶', check,
      success: { ...outcome, effects: [{ type: 'chain_start', id: 'career-later' }] }, critical_success: outcome,
      failure: { text: '失足', effects: [{ type: 'death', id: 'death-test' }], next_stage_id: null } }] };
  const chain = { id: 'career-test', name: '屋顶事业', commitment: '之后还要照看屋顶', nodes: [] };
  const later = { ...chain, id: 'career-later', name: '后续事业', commitment: '以后需要继续照看' };
  const { builder, game, calls } = await fixture(bundle => ({ ...bundle, events: [event], chains: [chain, later] }));
  const status = { id: choice.id, text: choice.text, risk: choice.risk, checks: [check], available: true, reason: null };
  const pending = { kind: 'option', event_instance_id: 'instance', event_id: event.id, options: [status] };
  const decision = { ...game, overlay: 'decision', view: { ...game.view, pending, status: 'AWAITING_OPTION' } };
  let scene = builder.overlay(decision, 1334, 0, 0);
  const before = sceneText(scene);
  assert.match(before, /家资 -2/);
  assert.match(before, /之后还要照看屋顶/);
  assert.match(before, /后续可能开始「后续事业」.*以后需要继续照看/);
  assert.match(before, /后续阶段可能丧命/);
  assert.match(before, /成功率 65%/);
  assert.doesNotMatch(before, /难度 14/);
  action(scene, 'check_choose').invoke();
  assert.deepEqual(calls, []);
  scene = builder.overlay(decision, 1334, 0, 0);
  assert.match(sceneText(scene), /难度 14/);
  assert.match(sceneText(scene), /特殊大成功率 10%/);
  assert.match(sceneText(scene), /自然 1 失败，自然 20 成功/);
  assert.equal(action(scene, 'check_choose').pressed, true);
  action(scene, 'option_choose').invoke();
  assert.deepEqual(calls, [['choose', 'choose']]);
  const unavailable = { ...decision, view: { ...decision.view, pending: { ...pending,
    options: [{ ...status, available: false, checks: [], reason: '真实不可用原因' }] } } };
  scene = builder.overlay(unavailable, 1334, 0, 0);
  assert.ok(sceneText(scene).includes('真实不可用原因'));
  assert.equal(action(scene, 'option_choose').disabled, true);
  assert.match(sceneText(scene), /后续阶段可能丧命/);
  const staged = { ...game, overlay: 'stage', view: { ...game.view, status: 'AWAITING_STAGE',
    pending: { kind: 'stage', event_instance_id: 'instance', event_id: event.id, stage_id: 'roll', text: '修屋顶', check } } };
  scene = builder.overlay(staged, 1334, 0, 0);
  assert.match(sceneText(scene), /可能导致死亡/);
  assert.doesNotMatch(sceneText(scene), /难度 14/);
  action(scene, 'stageCheckDetails').invoke();
  scene = builder.overlay(staged, 1334, 0, 0);
  assert.match(sceneText(scene), /难度 14/);
  assert.match(sceneText(scene), /自然 1 失败，自然 20 成功/);
  action(scene, 'resolveStage').invoke();
  assert.deepEqual(calls.at(-1), ['stage']);
});

test('decision hides options exclusive to the other timeline but keeps potentially relevant disabled choices', async () => {
  const historical = { op: 'is', field: 'timeline', value: 'historical' };
  const stat = { op: 'compare', field: 'intelligence', comparator: 'gte', value: 12 };
  const option = (id, condition) => ({ id, condition, text: id, risk: 'safe',
    outcome: { text: '继续', effects: [], next_stage_id: null } });
  const event = { id: 'timeline-test', title: '时局抉择', text: '眼下如何处理？', interaction: 'choice', options: [
    option('history', { op: 'all', conditions: [historical, stat] }),
    option('fiction', { op: 'not', condition: historical }),
    option('either', { op: 'any', conditions: [historical, stat] }),
    option('notBoth', { op: 'not', condition: { op: 'all', conditions: [historical, stat] } }),
    option('leave'),
  ] };
  const { builder, game, calls } = await fixture(bundle => ({ ...bundle, events: [event] }));
  const render = (timeline, available) => {
    const pending = { kind: 'option', event_instance_id: 'instance', event_id: event.id,
      options: event.options.map(o => ({ id: o.id, available: available.includes(o.id), risk: o.risk,
        checks: [], reason: available.includes(o.id) ? null : '才干不足' })) };
    return builder.overlay({ ...game, overlay: 'decision', view: { ...game.view, timeline, pending, status: 'AWAITING_OPTION' } }, 1334, 0, 0);
  };
  const past = render('historical', ['either', 'leave']);
  assert.ok(!past.actions.some(item => item.id === 'option_fiction'));
  assert.equal(action(past, 'option_history').disabled, true);
  assert.match(sceneText(past), /才干不足/);
  assert.equal(action(past, 'option_notBoth').disabled, true);
  const imagined = render('fictional', ['fiction', 'notBoth', 'leave']);
  assert.ok(!imagined.actions.some(item => item.id === 'option_history'));
  assert.equal(action(imagined, 'option_either').disabled, true);
  action(imagined, 'option_fiction').invoke();
  assert.deepEqual(calls, [['choose', 'fiction']]);
});

test('nearest due career and held cards use real player state; restart stays in management', async () => {
  const { builder, game, controller, calls } = await fixture();
  const [first, second] = controller.bundle.chains;
  const [modern, native] = [controller.bundle.cards.find(card => card.tags.includes('modern')),
    controller.bundle.cards.find(card => card.tags.includes('native'))];
  const chain = (instance_id, chain_id, next_due_year, status = 'active') => ({
    instance_id, chain_id, next_due_year, status, started_year: 1630, node_index: 0, interruption_reason: null,
  });
  game.view.player.cards = [modern.id, native.id];
  game.view.player.chains = [chain('later', second.id, 1634), chain('b', second.id, 1631),
    chain('a', first.id, 1631), chain('none', second.id, null), chain('done', second.id, 1629, 'completed')];
  let scene = builder.base(game, 1334, 0, 0);
  assert.match(action(scene, 'nearestCareer').label, new RegExp(first.name));
  assert.match(action(scene, 'nearestCareer').label, /等待本年进展/);
  assert.ok(!scene.actions.some(item => item.id === 'restartLife'));
  action(scene, 'nearestCareer').invoke();
  assert.deepEqual(calls, [['open', 'career']]);
  const management = { ...game, overlay: 'career' };
  scene = builder.overlay(management, 1334, 0, 0);
  assert.ok(sceneText(scene).includes('退出后已付费用不退，\n已学本事保留。'));
  action(scene, 'hub_relics').invoke();
  scene = builder.overlay(management, 1334, 0, 0);
  assert.ok(scene.text.includes(modern.name));
  assert.ok(scene.text.includes(native.name));
  assert.ok(!scene.actions.some(item => item.id === 'hub_modern'));
  action(scene, 'restartLife').invoke();
  assert.deepEqual(calls.at(-1), ['start']);
});

test('read-only home preserves warnings without a start or overwrite action', async () => {
  const { builder, source } = await fixture();
  const snapshot = { ...source.snapshot, screen: 'home', overlay: null, saveStatus: 'ready',
    readOnlyReason: '另一个页面持有写锁，本页只读。', notice: '记录读取提示' };
  const scene = builder.base(snapshot, 1334, 0, 0);
  assert.ok(sceneText(scene).includes(snapshot.readOnlyReason));
  assert.ok(sceneText(scene).includes(snapshot.notice));
  assert.match(action(scene, 'startLife').label, /查看已完成人生/);
  assert.ok(!scene.actions.some(item => item.id === 'restartLife'));
  assert.ok(!sceneText(scene).includes('我要穿越'));
});

test('ending opens with recorded opening, real experience and actual death', async () => {
  const { builder, game, controller } = await fixture();
  const background = controller.bundle.era.backgrounds[0];
  const identity = controller.bundle.era.identities.find(item => item.id === background.identity_id);
  const death = controller.bundle.deaths[0];
  const card = controller.bundle.cards[0];
  const opening = { seq: 1, age: 20, calendar_year: 1630, type: 'opening', source_id: background.id,
    message: '真实开局', data: { background_id: background.id, age_band_id: 'age', card_id: card.id } };
  const decision = { seq: 2, age: 21, calendar_year: 1631, type: 'option', source_id: 'event',
    message: '真实决定', data: { event_instance_id: 'one', option_id: 'choice' } };
  const report = { start_age: 20, end_age: 22, start_year: 1630, end_year: 1632, years_played: 2,
    death_id: death.id, primary_achievement_id: null, milestone_achievement_ids: [], anecdote_achievement_ids: [],
    achievements: [], highest_identity_id: game.view.player.highest_identity_id, chains_completed: [], chains_interrupted: [],
    key_decisions: [decision], final_attributes: game.view.player.attributes };
  const ended = { ...game, overlay: 'ending', ending: report, logs: [opening, decision],
    view: { ...game.view, status: 'ENDED', player: { ...game.view.player, cards: [card.id] } } };
  const scene = builder.overlay(ended, 1334, 0, 0);
  const start = scene.text.indexOf('初来乍到'), middle = scene.text.indexOf('这一路'), end = scene.text.indexOf('人生终点');
  assert.ok(start >= 0 && start < middle && middle < end);
  assert.match(sceneText(scene), new RegExp(identity.name));
  assert.match(sceneText(scene), /真实决定/);
  assert.match(sceneText(scene), new RegExp(death.name));
  assert.match(sceneText(scene), new RegExp(card.name));
  const empty = { ...ended, logs: [], ending: { ...report, key_decisions: [] } };
  const emptyScene = builder.overlay(empty, 1334, 0, 0);
  assert.match(sceneText(emptyScene), /这段经历没有可展示的记录/);
  assert.match(sceneText(emptyScene), /开局身份没有可确认的记录/);
});
