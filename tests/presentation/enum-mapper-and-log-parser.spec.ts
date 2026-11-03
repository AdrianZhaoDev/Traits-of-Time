import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EnumMapper } from '../../assets/scripts/presentation/EnumMapper';
import { LogParser } from '../../assets/scripts/presentation/LogParser';
describe('Presentation - EnumMapper', () => {
  it('translates region, caste and identity correctly', () => {
    expect(EnumMapper.translateRegion('R_SHANBEI')).toBe('陕北·延安府');
    expect(EnumMapper.translateRegion('R_UNKNOWN')).toBe('R_UNKNOWN');

    expect(EnumMapper.translateCaste('C_SOLDIER')).toBe('军户');
    expect(EnumMapper.translateCaste('C_GENTRY')).toBe('士绅');

    expect(EnumMapper.translateIdentity('I_CLAN_ELDER')).toBe('宗族耆老');
    expect(EnumMapper.translateIdentity('I_MILITARY_OFFICER')).toBe('卫所旗官');
  });

  it('translates stat attributes correctly with aliases and icons', () => {
    // 规范属性与别名
    const physique = EnumMapper.translateStat('physique');
    expect(physique.name).toBe('体魄');
    expect(physique.icon).toBe('体');
    expect(physique.shortName).toBe('体');

    const health = EnumMapper.translateStat('health');
    expect(health.name).toBe('体魄');
    expect(health.icon).toBe('体');

    const wealth = EnumMapper.translateStat('wealth');
    expect(wealth.name).toBe('家资');
    expect(wealth.icon).toBe('财');

    const intelligence = EnumMapper.translateStat('intelligence');
    expect(intelligence.name).toBe('才干');
    expect(intelligence.icon).toBe('智');

    const capability = EnumMapper.translateStat('capability');
    expect(capability.name).toBe('才干');
    expect(capability.icon).toBe('智');

    const prestige = EnumMapper.translateStat('prestige');
    expect(prestige.name).toBe('人脉');
    expect(prestige.icon).toBe('脉');

    const connection = EnumMapper.translateStat('connection');
    expect(connection.name).toBe('人脉');
    expect(connection.icon).toBe('脉');

    const luck = EnumMapper.translateStat('luck');
    expect(luck.name).toBe('气数');
    expect(luck.icon).toBe('气');

    const unknown = EnumMapper.translateStat('custom_stat');
    expect(unknown.name).toBe('custom_stat');
    expect(unknown.icon).toBe('c');
  });

  it('translates enum values dynamically via translateEnum', () => {
    expect(EnumMapper.translateEnum('R_JIANGNAN')).toBe('江南·苏州府');
    expect(EnumMapper.translateEnum('C_MILITARY')).toBe('卫所武官');
    expect(EnumMapper.translateEnum('I_SILK_MERCHANT')).toBe('绸缎巨贾');
    expect(EnumMapper.translateEnum('UNKNOWN_KEY')).toBe('UNKNOWN_KEY');
  });
});

describe('Presentation - LogParser', () => {
  it('parses stamp tags properly from 【xxx】', () => {
    const parsed = LogParser.parseStamp('【传家之宝】锁片铿锵甲光向日');
    expect(parsed.stamp).toBe('传家之宝');
    expect(parsed.text).toBe('锁片铿锵甲光向日');

    const noStamp = LogParser.parseStamp('春雷初动，万物萌发。');
    expect(noStamp.stamp).toBeUndefined();
    expect(noStamp.text).toBe('春雷初动，万物萌发。');
  });

  it('aggregates event and subsequent effects into single fold item', () => {
    const rawLogs = [
      {
        type: 'event',
        message: '翻出旧日卫所铁扎锁子甲，穿针引线重新铆合锈片。',
        metadata: { event_instance_id: 'inst_1' },
      },
      {
        type: 'effects',
        message: '【传家之宝】锁片铿锵甲光向日，披挂在身刀枪难透！',
        metadata: {
          effects: [
            { type: 'attribute_delta', field: 'health', delta: 2 },
          ],
        },
      },
    ];

    const result = LogParser.parseBatch(rawLogs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('inst_1');
    expect(result[0].eventId).toBe('inst_1');
    expect(result[0].introText).toBe('翻出旧日卫所铁扎锁子甲，穿针引线重新铆合锈片。');
    expect(result[0].stampTag).toBe('传家之宝');
    expect(result[0].outcomeText).toBe('锁片铿锵甲光向日，披挂在身刀枪难透！');
    expect(result[0].effectsText).toEqual(['体魄 +2']);
    expect(result[0].effectsSummary).toEqual(['体魄 +2']);
  });

  it('supports engine attribute_add effect payloads and independent effects', () => {
    const rawLogs = [
      {
        type: 'event',
        source_id: 'E_TEST_EVENT',
        message: '山洪忽至。',
        data: { event_instance_id: 'inst_test' },
      },
      {
        type: 'effects',
        source_id: 'E_TEST_EVENT',
        message: '【脱险】涉险登高，全身而退。',
        data: {
          effects: [
            { type: 'attribute_add', attribute: 'physique', amount: 1 },
            { type: 'attribute_add', attribute: 'wealth', amount: -2 },
          ],
        },
      },
      {
        type: 'history',
        source_id: 'H_1644',
        message: '【甲申国变】三月十九日，京师陷落。',
      },
    ];

    const result = LogParser.parseBatch(rawLogs);
    expect(result).toHaveLength(2);

    expect(result[0].introText).toBe('山洪忽至。');
    expect(result[0].stampTag).toBe('脱险');
    expect(result[0].outcomeText).toBe('涉险登高，全身而退。');
    expect(result[0].effectsText).toEqual(['体魄 +1', '家资 -2']);

    expect(result[1].type).toBe('history');
    expect(result[1].stampTag).toBe('甲申国变');
    expect(result[1].outcomeText).toBe('三月十九日，京师陷落。');
  });

  it('merges event intro, action option and outcome effects into a single fold item', () => {
    const rawLogs = [
      {
        type: 'event',
        source_id: 'E_CHOICE_EVENT',
        message: '街头饥民哄抢粮车，差役拔刀相向。',
        data: { event_instance_id: 'inst_choice' },
      },
      {
        type: 'option',
        source_id: 'E_CHOICE_EVENT',
        message: '倾囊相助，买下余粮赈济乡民。',
        data: { event_instance_id: 'inst_choice', option_id: 'opt_help' },
      },
      {
        type: 'effects',
        source_id: 'E_CHOICE_EVENT',
        message: '【万家生佛】众生感念恩德，赞不绝口。 (+1 qi_yun)',
        data: {
          effects: [
            { type: 'attribute_add', attribute: 'prestige', amount: 3 },
          ],
        },
      },
    ];

    const result = LogParser.parseBatch(rawLogs);
    expect(result).toHaveLength(1);
    expect(result[0].introText).toBe('街头饥民哄抢粮车，差役拔刀相向。');
    expect(result[0].actionText).toBe('倾囊相助，买下余粮赈济乡民。');
    expect(result[0].stampTag).toBe('万家生佛');
    expect(result[0].outcomeText).toBe('众生感念恩德，赞不绝口。 (气数 +1)');
    expect(result[0].effectsText).toEqual(['人脉 +3']);
  });

  it('filters CONDITION_NOT_MET, skip and draw logs, and deduplicates consecutive intro text', () => {
    const rawLogs = [
      {
        type: 'skip',
        source_id: 'E_TEST_SKIP',
        message: 'CONDITION_NOT_MET',
      },
      {
        type: 'draw',
        source_id: 'random',
        message: '隔壁二大爷如厕忘带干草...',
      },
      {
        type: 'event',
        source_id: 'E_MOD_SEEDS_COB',
        message: '隔壁二大爷如厕忘带干草，见墙角堆着坚硬玉米芯...',
      },
      {
        type: 'event',
        source_id: 'E_MOD_SEEDS_COB',
        message: '隔壁二大爷如厕忘带干草，见墙角堆着坚硬玉米芯...',
      },
      {
        type: 'effects',
        source_id: 'E_MOD_SEEDS_COB',
        message: '【刮骨黄金棒】酸爽刺痛让老汉一嗓子吼穿院墙！ ( physique +1 )',
      },
    ];

    const result = LogParser.parseBatch(rawLogs);
    expect(result).toHaveLength(1);
    expect(result[0].introText).toBe('隔壁二大爷如厕忘带干草，见墙角堆着坚硬玉米芯...');
    expect(result[0].stampTag).toBe('刮骨黄金棒');
    expect(result[0].outcomeText).toBe('酸爽刺痛让老汉一嗓子吼穿院墙！ (体魄 +1)');
  });

  it('merges event intro and death log outcome into same fold item with 生平盖棺 stamp', () => {
    const rawLogs = [
      {
        type: 'event',
        source_id: 'E_MOD_SEEDS_MISUSE',
        message: '天寒地冻饥肠辘辘，你偷摸把整包玉米种子倒进滚烫炭盆想吃爆米花...',
      },
      {
        type: 'death',
        source_id: 'D_MOD_SEEDS_POPCORN_BLAST',
        message: '被飞溅的火炭精准引燃了破草屋顶，轰然大火中光荣升天。',
      },
    ];

    const result = LogParser.parseBatch(rawLogs);
    expect(result).toHaveLength(1);
    expect(result[0].introText).toBe('天寒地冻饥肠辘辘，你偷摸把整包玉米种子倒进滚烫炭盆想吃爆米花...');
    expect(result[0].stampTag).toBe('生平盖棺');
    expect(result[0].outcomeText).toBe('被飞溅的火炭精准引燃了破草屋顶，轰然大火中光荣升天。');
    expect(result[0].type).toBe('death');
  });
});

describe('Content Fix - E_SOC_SENIOR_REPAIR', () => {
  it('has armor outcome text rather than wooden furniture text', () => {
    const eventsPath = resolve(__dirname, '../../assets/resources/data/ming_end/events.json');
    const content = readFileSync(eventsPath, 'utf-8');
    const events = JSON.parse(content) as Array<{ id: string; outcome?: { text?: string } }>;
    const target = events.find(e => e.id === 'E_SOC_SENIOR_REPAIR');

    expect(target).toBeDefined();
    expect(target?.outcome?.text).toContain('【传家之宝】锁片铿锵甲光向日');
    expect(target?.outcome?.text).not.toContain('木料');
    expect(target?.outcome?.text).not.toContain('圈椅');
  });
});
