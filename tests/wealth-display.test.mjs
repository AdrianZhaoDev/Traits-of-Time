import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWealth, optionDetails } from '../src/presenters.ts';
import { EnumMapper } from '../src/game/presentation/EnumMapper.ts';
import { LogParser } from '../src/game/presentation/LogParser.ts';
import { loadContent } from '../tools/content-io.mjs';
import { scenario } from './family-harness.mjs';

test('wealth attributes use the unchanged abstract scale, not a silver unit', () => {
  for (let value = 0; value <= 20; value++) assert.equal(formatWealth(value), String(value));
  assert.equal(formatWealth(-1), '-1');
  assert.equal(formatWealth(1234.5), '1,234.5');
  assert.equal(EnumMapper.translateStat('wealth').name, '家资');
  assert.equal(EnumMapper.describeCondition({ op: 'compare', field: 'wealth', comparator: 'gte', value: 3 }, {}), '家资≥3');
});

test('option costs retain signed attributes and disclose the wealth floor', () => {
  const bundle = { chains: [{ id: 'CHAIN_TEST', commitment: '请匠人量木，备些银钱。' }] };
  const option = {
    id: 'O_TEST', text: '修补', risk: 'normal',
    condition: { op: 'compare', field: 'wealth', comparator: 'gte', value: 3 },
    outcome: { text: '修补屋顶。', effects: [
      { type: 'attribute_add', attribute: 'wealth', amount: -1 },
      { type: 'attribute_add', attribute: 'physique', amount: -2 },
      { type: 'chain_start', id: 'CHAIN_TEST' },
    ], next_stage_id: null },
  };
  const event = { id: 'E_TEST', stages: [] };
  const status = { id: 'O_TEST', text: '修补', risk: 'normal', checks: [], available: false, reason: null };
  const details = optionDetails(bundle, event, option, status).join('\n');
  assert.match(details, /家资≥3/);
  assert.match(details, /家资 -1.*上下限/);
  assert.match(details, /体魄 -2.*上下限/);
  assert.match(details, /请匠人量木，备些银钱/);
  assert.match(details, /风险等级：普通/);
});

test('effect logs preserve legacy delta format, other attributes and money narratives', () => {
  const log = {
    type: 'effects', message: '两匹布换了些银钱。(-1 wealth)',
    metadata: { effects: [
      { type: 'attribute_delta', field: 'wealth', delta: -1 },
      { type: 'attribute_add', attribute: 'wealth', amount: 1 },
      { type: 'attribute_add', attribute: 'physique', amount: -2 },
      { type: 'flag_add', id: 'F_TEST' },
    ] },
  };
  const [fold] = LogParser.parseBatch([log]);
  assert.equal(fold.outcomeText, '两匹布换了些银钱。(家资 -1)');
  const changes = fold.effectsText.join('\n');
  assert.doesNotMatch(changes, /家资 -1/, 'the amount already present in the narrative is not repeated');
  assert.match(changes, /家资.*上下限/);
  assert.match(changes, /家资 \+1.*上下限/);
  assert.match(changes, /体魄 -2.*上下限/);
  assert.deepEqual(fold.effectsSummary, fold.effectsText);
  assert.deepEqual(fold.relicFlags, ['F_TEST']);
});

test('real logged wealth effects disclose limits without changing engine clamping', async () => {
  const content = await loadContent();
  for (const { start, amount, end } of [
    { start: 0, amount: -1, end: 0 },
    { start: 20, amount: 1, end: 20 },
    { start: 10, amount: -1, end: 9 },
    { start: 10, amount: 1, end: 11 },
  ]) {
    const event = {
      id: 'E_TEST_WEALTH_DISPLAY', title: '测试家资展示', text: '你卖出两匹布，拿到一些银钱。', interaction: 'automatic',
      trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
      outcome: { text: '银钱收好了。', effects: [{ type: 'attribute_add', attribute: 'wealth', amount }], next_stage_id: null },
    };
    const run = scenario(content, [event], { wealth: start });
    assert.equal(run.before.attributes.wealth, start);
    const result = run.start();
    assert.equal(result.state.player.attributes.wealth, end);
    const fold = LogParser.parseBatch(run.engine.exportSave().payload.logs).find(item => item.eventId === event.id);
    assert.ok(fold);
    assert.equal(fold.introText, event.text);
    assert.equal(fold.outcomeText, event.outcome.text);
    const sign = amount > 0 ? `+${amount}` : String(amount);
    assert.ok(fold.effectsText.some(text => text.includes(`家资 ${sign}`) && /上下限/.test(text)));
    assert.ok(!fold.effectsText.some(text => /\d两/.test(text)));
  }
});
