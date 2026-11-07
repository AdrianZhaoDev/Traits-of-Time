import { describe, it, expect } from 'vitest';
import { LogParser } from '../../assets/scripts/presentation/LogParser';
import { EventFoldItem } from '../../assets/scripts/presentation/EventFoldItem';
import { Label, Node } from '../mocks/cc-mock';

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

  it('renders an independent result stamp once without losing the outcome or cost', () => {
    const [item] = LogParser.parseBatch([{
      type: 'effects', source_id: 'E_SUPPLIES', message: '【已备粮】口粮备齐了。',
      data: { effects: [{ type: 'attribute_add', attribute: 'wealth', amount: -1 }] },
    }]);
    const node = new Node('Result');
    node.addComponent(EventFoldItem).init(item!);
    const displayed: string[] = [];
    const nodes = [node];
    for (const current of nodes) {
      const label = current.getComponent(Label);
      if (label) displayed.push(label.string);
      nodes.push(...current.children);
    }
    expect(displayed.filter(text => text === '【已备粮】')).toHaveLength(1);
    expect(displayed).toContain('口粮备齐了。');
    expect(displayed).toContain('家资 -1');
  });

  it('does not repeat the primary achievement review as a terminal log', () => {
    const items = LogParser.parseBatch([
      { type: 'achievement', source_id: 'A_REVIEW', message: '【学成手艺】两年的功夫没有白费。' },
      { type: 'death', source_id: 'D_OLD', message: '这一生结束了。' },
      { type: 'ending', source_id: 'A_REVIEW', message: '两年的功夫没有白费。' },
    ]);
    expect(items.map(item => item.type)).toEqual(['achievement', 'death']);
    expect(items[0]!.outcomeText).toBe('两年的功夫没有白费。');
    expect(items[1]!.outcomeText).toBe('这一生结束了。');
  });


});
