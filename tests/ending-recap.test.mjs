import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/core/engine/GameEngine.ts';
import { buildEndingRecap } from '../src/game/presentation/EndingRecap.ts';
import { loadContent } from '../tools/content-io.mjs';

const attributes = { physique: 8, intelligence: 8, wealth: 8, prestige: 8, luck: 8 };

function fixture() {
  const bundle = {
    era: {
      backgrounds: [{ id: 'B_START', identity_id: 'I_START', text: '开局背景。' }],
      identities: [{ id: 'I_START', name: '学徒' }, { id: 'I_FINAL', name: '官员' }],
    },
    cards: [{ id: 'C_ACTUAL', name: '手电' }, { id: 'C_OTHER', name: '玉米种子' }],
    events: [{
      id: 'E_CHOICE', interaction: 'choice', text: '码头需要帮手。',
      options: [{ id: 'try', text: '试着帮忙', outcome: { text: '虚构的选项成功结果' } }],
      stages: [{ id: 'check', success: { text: '虚构的检定成功结果' }, failure: { text: '不应从配置补出的失败结果' } }],
    }],
    chains: [{ id: 'CH_WORK', name: '码头差事', completion: { text: '不应补出的事业完成结果' } }],
    achievements: [
      { id: 'A_LIFE', name: '平凡一生' },
      { id: 'A_MILESTONE', name: '认真做事' },
      { id: 'A_OTHER', name: '从未获得' },
    ],
    deaths: [{ id: 'D_OLD', name: '寿终', text: '安静地走完一生。' }],
  };
  const report = {
    content_id: 'fixture', content_version: '1', content_fingerprint: 'fixture-fingerprint', seed: 1,
    start_age: 9, start_year: 1632, end_age: 45, end_year: 1668, years_played: 36,
    end_reason: 'death', death_id: 'D_OLD', primary_achievement_id: 'A_LIFE',
    milestone_achievement_ids: ['A_MILESTONE'], anecdote_achievement_ids: [], achievements: ['A_MILESTONE'],
    highest_identity_id: 'I_FINAL', chains_completed: [], chains_interrupted: [], key_decisions: [], final_attributes: attributes,
  };
  const player = {
    era_id: 'ERA', start_age: 9, age: 45, max_lifespan: 45, start_year: 1632, calendar_year: 1668,
    region_id: 'R_FINAL', caste_id: 'C_FINAL', identity_id: 'I_FINAL', highest_identity_id: 'I_FINAL',
    attributes, cards: ['C_ACTUAL'], flags: [], injuries: [], chains: [], achievements: ['A_MILESTONE'],
    late_life: { route_id: null, phase: null, entered_year: null, candidate_route_id: null, candidate_years: 0 },
  };
  return { bundle, report, player };
}

function log(seq, type, source_id, message, data, age = 12, calendar_year = 1635) {
  return { seq, type, source_id, message, data, age, calendar_year };
}

function diceData(event_instance_id, success) {
  return {
    event_instance_id, stage_id: 'check', raw: success ? 15 : 2,
    attribute_value: 8, modifier_before: 0, modifier_after: 0, luck_value: 8, luck_bonus: 0,
    effective_raw_minimum: null, dc: 20, success, critical_success: false,
    success_probability: 0.4, critical_probability: 0.05,
  };
}

test('missing player and logs retain report facts without inventing identity, cards or a story', () => {
  const { bundle, report } = fixture();
  const recap = buildEndingRecap(bundle, report, null, []);
  assert.match(recap.start, /1632年，9岁/);
  assert.match(recap.start, /没有可确认的家当记录/);
  assert.doesNotMatch(recap.start, /学徒|官员|手电|玉米种子/);
  assert.equal(recap.experience, '这段经历没有可展示的记录');
  assert.match(recap.ending, /1668年，45岁离世/);
  assert.match(recap.ending, /死因：寿终/);
  assert.match(recap.ending, /平凡一生/);
  assert.match(recap.ending, /认真做事/);
  assert.equal(recap.ending.match(/认真做事/g)?.length, 1);
  assert.doesNotMatch(recap.ending, /从未获得/);
});

test('opening identity comes from the actual opening, and carried cards come from the player', () => {
  const { bundle, report, player } = fixture();
  const logs = [
    log(1, 'card_selected', 'C_ACTUAL', '手电', { card_id: 'C_ACTUAL' }, 9, 1632),
    log(2, 'opening', 'B_START', '你先跟着师傅学活。', { background_id: 'B_START', age_band_id: 'child', card_id: 'C_ACTUAL' }, 9, 1632),
  ];
  const recap = buildEndingRecap(bundle, report, player, logs);
  assert.match(recap.start, /开局身份：学徒/);
  assert.match(recap.start, /你先跟着师傅学活/);
  assert.match(recap.start, /携带家当：手电/);
  assert.doesNotMatch(recap.start, /官员|玉米种子/);
  assert.equal(recap.experience, '这段经历没有可展示的记录');

  const noOpening = buildEndingRecap(bundle, report, player, []);
  assert.doesNotMatch(noOpening.start, /学徒|官员/);
  assert.match(noOpening.start, /手电/);
  const noPlayer = buildEndingRecap(bundle, report, null, logs);
  assert.match(noPlayer.start, /开局所选家当：手电/);
});

test('failed player choice uses observed outcomes in sequence, not the success of a later instance', () => {
  const { bundle, report, player } = fixture();
  const logs = [
    log(1, 'event', 'E_ORDINARY', '你路过一处集市。', { event_instance_id: 'ordinary' }),
    log(2, 'effects', 'E_ORDINARY', '你买了一些干粮。', { effects: [] }),
    log(5, 'event', 'E_CHOICE', '码头需要帮手。', { event_instance_id: 'first' }),
    log(6, 'option', 'E_CHOICE', '试着帮忙', { event_instance_id: 'first', option_id: 'try' }),
    log(7, 'effects', 'E_CHOICE', '你先去打听差事。', { effects: [] }),
    log(8, 'dice', 'E_CHOICE', '能否赶上运船', diceData('first', false)),
    log(9, 'effects', 'E_CHOICE', '你没有赶上运船，只好另找活计。', { effects: [] }),
    log(10, 'event', 'E_CHOICE', '第二次遇见码头差事。', { event_instance_id: 'second' }),
    log(11, 'effects', 'E_CHOICE', '第二次差事大获成功。', { effects: [] }),
  ];
  report.key_decisions = [logs[3], logs[5]];
  const reversed = Object.freeze([...logs].reverse());
  const snapshot = structuredClone({ bundle, report, player, logs: reversed });
  const recap = buildEndingRecap(bundle, report, player, reversed);
  const expected = ['码头需要帮手', '选择：试着帮忙', '你先去打听差事', '检定未通过', '你没有赶上运船'];
  let previous = -1;
  for (const text of expected) {
    const index = recap.experience.indexOf(text);
    assert.ok(index > previous, `${text} was absent or out of order: ${recap.experience}`);
    previous = index;
  }
  assert.match(recap.experience, /^1635年，12岁/);
  assert.doesNotMatch(recap.experience, /第二次|大获成功|虚构的选项成功结果|虚构的检定成功结果/);
  assert.deepEqual({ bundle, report, player, logs: reversed }, snapshot);
});

test('report key decisions are actual sparse logs, but do not supply a missing outcome', () => {
  const { bundle, report, player } = fixture();
  report.key_decisions = [
    log(5, 'option', 'E_CHOICE', '试着帮忙', { event_instance_id: 'first', option_id: 'try' }),
    log(8, 'dice', 'E_CHOICE', '能否赶上运船', diceData('first', false)),
  ];
  const recap = buildEndingRecap(bundle, report, player, []);
  assert.match(recap.experience, /选择：试着帮忙/);
  assert.match(recap.experience, /检定未通过/);
  assert.doesNotMatch(recap.experience, /虚构的|不应从配置补出|结果：/);

  report.key_decisions.pop();
  const choiceOnly = buildEndingRecap(bundle, report, player, []);
  assert.match(choiceOnly.experience, /选择：试着帮忙/);
  assert.doesNotMatch(choiceOnly.experience, /通过|成功|失败|结果：/);
});

test('uses a real ordinary event and result when there is no decision', () => {
  const { bundle, report, player } = fixture();
  const logs = [
    log(1, 'event', 'E_ORDINARY', '你路过一处集市。', { event_instance_id: 'ordinary' }),
    log(2, 'effects', 'E_ORDINARY', '你买了一些干粮。', { effects: [] }),
  ];
  const recap = buildEndingRecap(bundle, report, player, logs);
  assert.match(recap.experience, /你路过一处集市/);
  assert.match(recap.experience, /结果：你买了一些干粮/);
  assert.doesNotMatch(recap.experience, /选择|检定|虚构/);

  const diagnosticOnly = [log(3, 'skip', 'E_ORDINARY', 'CONDITION_NOT_MET', { reason: 'CONDITION_NOT_MET' })];
  assert.equal(buildEndingRecap(bundle, report, player, diagnosticOnly).experience, '这段经历没有可展示的记录');
});

test('career interruption is factual, and missing log entries do not join unrelated outcomes', () => {
  const { bundle, report, player } = fixture();
  const interruption = log(2, 'chain', 'CH_WORK', '道路不通，差事中断。', {
    instance_id: 'chain-1', chain_id: 'CH_WORK', action: 'interrupted', reason: '道路不通，差事中断。',
  });
  const career = buildEndingRecap(bundle, report, player, [interruption]);
  assert.match(career.experience, /码头差事.*中断/);
  assert.match(career.experience, /道路不通/);
  assert.doesNotMatch(career.experience, /不应补出|完成/);

  const incomplete = [
    log(3, 'event', 'E_CHOICE', '码头需要帮手。', { event_instance_id: 'first' }),
    log(4, 'option', 'E_CHOICE', '试着帮忙', { event_instance_id: 'first', option_id: 'try' }),
    log(7, 'effects', 'E_CHOICE', '无法确认属于这次选择的结果。', { effects: [] }),
  ];
  const partial = buildEndingRecap(bundle, report, player, incomplete);
  assert.match(partial.experience, /选择：试着帮忙/);
  assert.doesNotMatch(partial.experience, /无法确认属于这次选择的结果|虚构的/);
});

test('unknown card, death and achievement IDs are not replaced with invented names', () => {
  const { bundle, report, player } = fixture();
  player.cards = ['C_MISSING'];
  report.death_id = 'D_MISSING';
  report.primary_achievement_id = null;
  report.milestone_achievement_ids = ['A_MISSING'];
  report.achievements = ['A_MISSING'];
  const logs = [log(1, 'death', 'D_MISSING', '这一生在病中结束。', { death_id: 'D_MISSING' }, 45, 1668)];
  const recap = buildEndingRecap(bundle, report, player, logs);
  assert.match(recap.start, /名称暂不可用/);
  assert.match(recap.ending, /死因：名称暂不可用/);
  assert.match(recap.ending, /这一生在病中结束/);
  assert.match(recap.ending, /名称暂不可用（1项）/);
  assert.doesNotMatch(`${recap.start} ${recap.ending}`, /C_MISSING|D_MISSING|A_MISSING|寿终|平凡一生/);
});

test('uses the actual engine report, player and logs for an automatic event', async () => {
  const bundle = await loadContent();
  bundle.events = [{
    id: 'E_RECAP_AUTOMATIC', text: '你在井边遇见了一件事。', interaction: 'automatic',
    trigger: { kind: 'opening', weight: 1, trigger_probability: 1 },
    outcome: { text: '井边的事情有了实际结果。', effects: [{ type: 'death', id: 'D_OLD_AGE' }], next_stage_id: null },
  }];
  const engine = new GameEngine(bundle, 'recap-engine-fixture');
  const initialized = engine.initGame({ seed: 1 });
  assert.equal(initialized.ok, true);
  assert.equal(initialized.pending.kind, 'card');
  const finished = engine.selectCard('choose-card', initialized.pending.cards[0]);
  assert.equal(finished.ok, true);
  assert.equal(finished.state.status, 'ENDED');
  const report = engine.generateEndingReport();
  const save = engine.exportSave();
  const recap = buildEndingRecap(bundle, report, save.payload.player, save.payload.logs);
  assert.match(recap.start, new RegExp(`${report.start_year}年，${report.start_age}岁`));
  assert.match(recap.experience, /你在井边遇见了一件事/);
  assert.match(recap.experience, /井边的事情有了实际结果/);
  assert.match(recap.ending, /死因：寿终/);
});

test('an unrelated intervening log does not attach a later same-source result to a choice', () => {
  const { bundle, report, player } = fixture();
  const event = log(1, 'event', 'E_CHOICE', '码头需要帮手。', { event_instance_id: 'first' });
  const choice = log(2, 'option', 'E_CHOICE', '试着帮忙', { event_instance_id: 'first', option_id: 'try' });
  const earned = log(3, 'achievement', 'A_MILESTONE', '认真做事', { achievement_id: 'A_MILESTONE' });
  const uncertain = log(4, 'effects', 'E_CHOICE', '另一次未能关联的结果。', { effects: [] });
  const recap = buildEndingRecap(bundle, report, player, [event, choice, earned, uncertain]);
  assert.match(recap.experience, /选择：试着帮忙/);
  assert.doesNotMatch(recap.experience, /另一次未能关联的结果/);

  const direct = buildEndingRecap(bundle, report, player, [event, choice,
    log(3, 'effects', 'E_CHOICE', '眼前差事的结果。', { effects: [] })]);
  assert.match(direct.experience, /选择：试着帮忙/);
  assert.match(direct.experience, /眼前差事的结果/);
});
