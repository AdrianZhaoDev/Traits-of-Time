import test from 'node:test';
import assert from 'node:assert/strict';
import { LogParser } from '../src/game/presentation/LogParser.ts';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { loadContent } from '../tools/content-io.mjs';

const row = (seq, type, message, data = {}, source_id = 'E_SAME', calendar_year = 1640) => ({
  seq, type, message, data, source_id, calendar_year, age: calendar_year === undefined ? 30 : 30 + calendar_year - 1640,
});
const instance = id => ({ event_instance_id: id });
const change = (attribute, amount) => ({ type: 'attribute_add', attribute, amount });
const kinds = fold => fold.segments.map(segment => segment.kind);

test('one event instance retains every choice, die, outcome, effect, achievement and death in order', () => {
  const id = 'life:one:event:1';
  const logs = [
    row(1, 'event', '事情开始', instance(id)),
    row(2, 'option', '动手处理', { ...instance(id), option_id: 'O_ONE' }),
    row(3, 'effects', '家资 +1', { effects: [change('wealth', 1), change('intelligence', 2)] }),
    row(4, 'dice', '第一步检定', { ...instance(id), stage_id: 'S_ONE', raw: 17, success: true }),
    row(5, 'effects', '【线索】第一步完成', { effects: [change('wealth', -1), { type: 'flag_add', id: 'F_ONE' }] }),
    row(6, 'dice', '第二步检定（原骰 3，失败）', { ...instance(id), stage_id: 'S_TWO', raw: 3, success: false }),
    row(7, 'effects', '第二步结果', { effects: [change('physique', -2)] }),
    row(8, 'achievement', '得到成就', { ...instance(id), achievement_id: 'A_ONE' }, 'A_ONE'),
    row(9, 'death', '最后的死因', { ...instance(id), death_id: 'D_ONE' }, 'D_ONE'),
  ];
  const folds = LogParser.parseBatch([...logs].reverse());
  assert.equal(folds.length, 1);
  const [fold] = folds;
  assert.equal(fold.calendarYear, 1640);
  assert.equal(fold.eventId, 'E_SAME');
  assert.equal(fold.type, 'death');
  assert.deepEqual(kinds(fold), ['intro', 'action', 'outcome', 'effects', 'dice', 'outcome', 'effects', 'dice', 'outcome', 'effects', 'achievement', 'death']);
  assert.deepEqual(fold.segments.filter(segment => segment.kind === 'dice').map(segment => segment.text), [
    '第一步检定（原骰 17，成功）', '第二步检定（原骰 3，失败）',
  ]);
  assert.deepEqual(fold.segments.filter(segment => segment.kind === 'outcome').map(segment => segment.text), [
    '家资 +1', '第一步完成', '第二步结果',
  ]);
  assert.equal(fold.segments.find(segment => segment.text === '第一步完成').stampTag, '线索');
  assert.deepEqual(fold.effectsText, [
    '家资实际变化可能受上下限限制', '才干 +2（实际变化可能受上下限限制）',
    '家资 -1（实际变化可能受上下限限制）', '体魄 -2（实际变化可能受上下限限制）',
  ]);
  assert.deepEqual(fold.effectsSummary, fold.effectsText);
  assert.deepEqual(fold.relicFlags, ['F_ONE']);
  assert.deepEqual(fold.achievementIds, ['A_ONE']);
  assert.deepEqual(fold.achievementFeedbackKeys, ['achievement_8']);
  assert.match(fold.actionText, /第一步检定.*第二步检定/);
  assert.match(fold.outcomeText, /家资 \+1\n第一步完成\n第二步结果\n最后的死因/);
  assert.deepEqual(LogParser.parseBatch([...logs].reverse()), folds);
});

test('identical text and event IDs never erase independent instances or years', () => {
  const logs = [
    row(1, 'event', '同一段话', instance('instance-a')),
    row(2, 'event', '同一段话', instance('instance-b')),
    row(3, 'event', '同一段话', instance('instance-a'), 'E_SAME', 1641),
    row(4, 'event', '同一段话', instance('instance-c'), 'E_SAME', 1641),
  ];
  const folds = LogParser.parseBatch(logs);
  assert.deepEqual(folds.map(fold => [fold.calendarYear, fold.introText]), [
    [1640, '同一段话'], [1640, '同一段话'], [1641, '同一段话'], [1641, '同一段话'],
  ]);
  assert.equal(new Set(folds.map(fold => fold.id)).size, 4);
  const legacy = [
    { type: 'event', message: '同一段话', source_id: 'E_SAME' },
    { type: 'event', message: '同一段话', source_id: 'E_SAME' },
  ];
  assert.equal(LogParser.parseBatch(legacy).length, 2);
  assert.notEqual(LogParser.parseBatch(legacy)[0].id, LogParser.parseBatch(legacy)[1].id);
  assert.deepEqual(LogParser.parseBatch(legacy), LogParser.parseBatch(legacy));
});

test('uncertain records stay separate and a later stage continues after the intervening entry', () => {
  const logs = [
    row(1, 'event', '开始', instance('a')),
    row(2, 'effects', '初步结果', { effects: [] }),
    row(3, 'achievement', '独立成就', { achievement_id: 'A_UNCLEAR' }, 'A_UNCLEAR'),
    row(4, 'dice', '接着检定', { ...instance('a'), stage_id: 'S', raw: 8, success: false }),
    row(5, 'effects', '后续结果', { effects: [] }),
    row(6, 'chain', '事业变化', { instance_id: 'chain:1' }, 'C_ONE'),
    row(7, 'effects', '没有实例的事业结果', { effects: [] }),
    row(8, 'death', '独立死因', { death_id: 'D_UNCLEAR' }, 'D_UNCLEAR'),
    row(9, 'event', '旧记录', { event_id: 'E_SAME' }),
    row(10, 'effects', '旧结果', { effects: [] }),
    row(11, 'event', '缺失中间日志', instance('b')),
    row(13, 'effects', '不能跨序号关联', { effects: [] }),
    { ...row(14, 'event', '没有年份', instance('c')), calendar_year: undefined },
    { ...row(15, 'effects', '年份不明的结果', { effects: [] }), calendar_year: undefined },
    row(16, 'event', '有隐藏的中间日志', instance('d')),
    row(17, 'skip', 'CONDITION_NOT_MET', {}),
    row(18, 'effects', '不能跨隐藏日志关联', { effects: [] }),
  ];
  const folds = LogParser.parseBatch(logs);
  assert.deepEqual(folds.map(fold => fold.type), [
    'event', 'achievement', 'event', 'chain', 'effects', 'death', 'event', 'effects',
    'event', 'effects', 'event', 'effects', 'event', 'effects',
  ]);
  assert.deepEqual(kinds(folds[0]), ['intro', 'outcome']);
  assert.deepEqual(kinds(folds[2]), ['dice', 'outcome']);
  assert.notEqual(folds[0].id, folds[2].id);
  assert.deepEqual(folds[1].achievementIds, ['A_UNCLEAR']);
  assert.equal(folds[5].outcomeText, '独立死因');
  assert.equal(folds[7].outcomeText, '旧结果');
  assert.equal(folds[9].outcomeText, '不能跨序号关联');
  assert.equal(folds[11].outcomeText, '年份不明的结果');
  assert.equal(folds[13].outcomeText, '不能跨隐藏日志关联');
  assert.equal(new Set(folds.map(fold => fold.id)).size, folds.length);
});

test('structured changes deduplicate only identical explicit amounts and always state the limit', () => {
  const logs = [
    row(1, 'effects', '家资 +1', { effects: [change('wealth', 1), change('wealth', 1), change('wealth', 10), change('physique', -1)] }),
    row(2, 'effects', '家资 +10', { effects: [change('wealth', 1)] }),
    row(3, 'effects', '不是家资 +1', { effects: [change('wealth', 1)] }),
    row(4, 'effects', '报酬（家资 +1）', { effects: [change('wealth', 1)] }),
    row(5, 'effects', '多个属性', { effects: ['physique', 'wealth', 'intelligence', 'prestige', 'luck'].map(attribute => change(attribute, 1)) }),
  ];
  const folds = LogParser.parseBatch(logs);
  assert.deepEqual(folds[0].effectsText, [
    '家资实际变化可能受上下限限制', '家资 +1（实际变化可能受上下限限制）',
    '家资 +10（实际变化可能受上下限限制）', '体魄 -1（实际变化可能受上下限限制）',
  ]);
  assert.deepEqual(folds[1].effectsText, ['家资 +1（实际变化可能受上下限限制）']);
  assert.deepEqual(folds[2].effectsText, ['家资 +1（实际变化可能受上下限限制）']);
  assert.deepEqual(folds[3].effectsText, ['家资实际变化可能受上下限限制']);
  assert.deepEqual(folds[4].effectsText, ['体魄', '家资', '才干', '人脉', '气数'].map(name => `${name} +1（实际变化可能受上下限限制）`));
});

test('opening records retain actual background provenance', () => {
  const [fold] = LogParser.parseBatch([
    row(1, 'opening', '初来人世', { background_id: 'BACKGROUND_REAL', age_band_id: 'BAND', card_id: 'CARD' }, 'SOURCE_REAL'),
  ]);
  assert.equal(fold.type, 'opening');
  assert.equal(fold.eventId, 'SOURCE_REAL');
  assert.equal(fold.backgroundId, 'BACKGROUND_REAL');
  assert.equal(fold.introText, '初来人世');
});

test('real separate engine commands aggregate their stages and survive deterministic save replay', async () => {
  const bundle = structuredClone(await loadContent());
  bundle.chains = [];
  bundle.achievements = [];
  bundle.era.age_transitions = [];
  bundle.rules.age_bands = [{ id: 'chronology-adult', min: 25, max: 25, weight: 1, modifiers: {} }];
  bundle.rules.opening.year_min = bundle.rules.opening.year_max = 1700;
  bundle.rules.lifespan = { min: 105, max: 105, min_remaining_years: 1 };
  const result = (text, next_stage_id, effects = []) => ({ text, effects, next_stage_id });
  const stage = (id, text, outcome) => ({
    id, text, check: { attribute: 'intelligence', dc: 10, modifier: 0 }, success: outcome, failure: outcome,
  });
  bundle.events = [{
    id: 'E_CHRONOLOGY', title: '时间顺序', text: '真实起因', interaction: 'choice',
    trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
    options: [{ id: 'O_CHOOSE', text: '真实选择', risk: 'normal',
      outcome: result('选择后的结果', 'S_ONE', [change('wealth', 1)]) }],
    stages: [
      stage('S_ONE', '第一场检定', result('第一阶段结果', 'S_TWO', [change('intelligence', 1)])),
      stage('S_TWO', '第二场检定', result('第二阶段结果', null, [change('physique', -1)])),
    ],
  }];
  const engine = new GameEngine(bundle, 'chronology-fixture');
  const ok = command => { assert.equal(command.ok, true, JSON.stringify(command.error)); return command; };
  const initialized = ok(engine.initGame({ seed: 1 }));
  let command = ok(engine.selectCard('card', initialized.pending.cards[0]));
  assert.equal(command.pending.kind, 'option');
  command = ok(engine.resolveOption('choice', command.pending.event_instance_id, 'O_CHOOSE'));
  assert.equal(command.pending.kind, 'stage');
  command = ok(engine.resolveStage('stage-one', command.pending.event_instance_id, command.pending.stage_id));
  assert.equal(command.pending.kind, 'stage');
  ok(engine.resolveStage('stage-two', command.pending.event_instance_id, command.pending.stage_id));

  const save = engine.exportSave();
  const folds = LogParser.parseBatch(save.payload.logs);
  const stories = folds.filter(fold => fold.eventId === 'E_CHRONOLOGY');
  assert.equal(stories.length, 1);
  assert.equal(stories[0].calendarYear, 1700);
  assert.deepEqual(kinds(stories[0]), ['intro', 'action', 'outcome', 'effects', 'dice', 'outcome', 'effects', 'dice', 'outcome', 'effects']);
  assert.deepEqual(stories[0].segments.filter(segment => segment.kind === 'outcome').map(segment => segment.text), [
    '选择后的结果', '第一阶段结果', '第二阶段结果',
  ]);
  const diceLogs = save.payload.logs.filter(log => log.type === 'dice');
  const diceSegments = stories[0].segments.filter(segment => segment.kind === 'dice');
  assert.equal(diceLogs.length, 2);
  diceLogs.forEach((log, index) => {
    assert.ok(diceSegments[index].text.includes(`原骰 ${log.data.raw}`));
    assert.ok(diceSegments[index].details.includes(`检定属性值 ${log.data.attribute_value}`));
    assert.ok(diceSegments[index].details.includes(`难度 ${log.data.dc}`));
    assert.ok(diceSegments[index].details.includes(`大成功条件 ${log.data.critical_success ? '满足' : '未满足'}`));
  });
  const restored = new GameEngine(bundle, 'chronology-fixture');
  restored.restoreSave(save);
  assert.deepEqual(LogParser.parseBatch(restored.exportSave().payload.logs), folds);
});

test('an adjacent effect needs the same year, age, source and consecutive sequence as its instance', () => {
  const logs = [
    row(1, 'event', '年龄不同', instance('age')),
    { ...row(2, 'effects', '不可凭来源合并一', { effects: [] }), age: 31 },
    row(3, 'option', '来源不同', instance('source')),
    row(4, 'effects', '不可凭邻接合并二', { effects: [] }, 'E_OTHER'),
    row(5, 'event', '年份不同', instance('year')),
    row(6, 'effects', '不可跨年合并', { effects: [] }, 'E_SAME', 1641),
    { ...row(7, 'event', '缺少序号', instance('sequence')), seq: undefined },
    { ...row(8, 'effects', '不可凭文本和来源合并', { effects: [] }), seq: undefined },
  ];
  const folds = LogParser.parseBatch(logs);
  assert.deepEqual(folds.map(fold => fold.type), ['event', 'effects', 'event', 'effects', 'event', 'effects', 'event', 'effects']);
  assert.deepEqual(folds.map(fold => fold.calendarYear), [1640, 1640, 1640, 1640, 1640, 1641, 1640, 1640]);
  assert.deepEqual(folds.filter(fold => fold.type === 'effects').map(fold => fold.outcomeText), [
    '不可凭来源合并一', '不可凭邻接合并二', '不可跨年合并', '不可凭文本和来源合并',
  ]);
});

test('controller metadata preserves synchronous outcome provenance', () => {
  const logs = [
    { ...row(1, 'event', '起因'), data: undefined, metadata: instance('metadata-instance') },
    { ...row(2, 'effects', '结果'), data: undefined, metadata: { effects: [change('luck', 1)] } },
  ];
  const folds = LogParser.parseBatch(logs);
  assert.equal(folds.length, 1);
  assert.deepEqual(kinds(folds[0]), ['intro', 'outcome', 'effects']);
  assert.deepEqual(folds[0].effectsText, ['气数 +1（实际变化可能受上下限限制）']);
});

test('executed dice details use logged values and only a proven attribute name', () => {
  const full = row(1, 'dice', '检定', {
    ...instance('full'), raw: 16, attribute_value: 7, modifier_before: -2, modifier_after: -1,
    luck_value: 11, luck_bonus: 2, dc: 12, effective_raw_minimum: null,
    success_probability: 0.75, critical_probability: 0.1, success: true, critical_success: false,
    check_attribute: 'intelligence',
  });
  const partial = row(2, 'dice', '旧检定', { ...instance('partial'), attribute_value: 8, check_attribute: 'unknown' });
  const empty = row(3, 'dice', '更早的检定', instance('empty'));
  const folds = LogParser.parseBatch([full, partial, empty]);
  assert.equal(folds[0].segments[0].text, '检定（原骰 16，成功）');
  assert.deepEqual(folds[0].segments[0].details, [
    '原骰 16', '才干值 7', '修正（限幅前） -2', '修正（限幅后） -1',
    '气数 11', '气数加成 +2', '难度 12', '原骰下限 无', '成功率 75%',
    '满足大成功条件的概率 10%', '本次检定 成功', '大成功条件 未满足',
  ]);
  assert.deepEqual(folds[1].segments[0].details, ['检定属性值 8']);
  assert.equal(folds[2].segments[0].details, undefined);
});
