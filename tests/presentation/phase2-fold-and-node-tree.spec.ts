import { describe, it, expect } from 'vitest';
import { LogParser } from '../../assets/scripts/presentation/LogParser';

describe('UI Refactor Phase 2 - FoldItem & Presentation Structure', () => {
  it('correctly maps FoldItemData attributes and handles effectsText / effectsSummary fallback', () => {
    const rawLogs = [
      {
        type: 'event',
        message: '崇祯初年，西北大旱。',
        source_id: 'E_DROUGHT_TEST',
      },
      {
        type: 'effects',
        message: '粮价飞涨，颗粒无收。',
        source_id: 'E_DROUGHT_TEST',
        metadata: {
          effects: [
            { type: 'attribute_add', attribute: 'wealth', amount: -3 },
            { type: 'attribute_add', attribute: 'physique', amount: -1 },
          ],
        },
      },
    ];

    const parsed = LogParser.parseBatch(rawLogs);
    expect(parsed).toHaveLength(1);
    const item = parsed[0]!;
    expect(item.introText).toBe('崇祯初年，西北大旱。');
    expect(item.outcomeText).toBe('粮价飞涨，颗粒无收。');
    expect(item.effectsText).toEqual(['家资 -3', '体魄 -1']);
  });

  it('correctly extracts stampTag and outcomeText for highlight fold card styling', () => {
    const rawLogs = [
      {
        type: 'event',
        message: '老工匠精心修复祖传战甲。',
        source_id: 'E_SOC_SENIOR_REPAIR',
      },
      {
        type: 'effects',
        message: '【传家之宝】锁片铿锵甲光向日，披甲之姿凛然如生。',
        source_id: 'E_SOC_SENIOR_REPAIR',
      },
    ];

    const parsed = LogParser.parseBatch(rawLogs);
    expect(parsed).toHaveLength(1);
    const item = parsed[0]!;
    expect(item.stampTag).toBe('传家之宝');
    expect(item.outcomeText).toBe('锁片铿锵甲光向日，披甲之姿凛然如生。');
  });


});
