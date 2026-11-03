import { describe, it, expect } from 'vitest';
import { LogParser, type FoldItemData } from '../../assets/scripts/presentation/LogParser';
import { EnumMapper } from '../../assets/scripts/presentation/EnumMapper';
import { EventFoldItem } from '../../assets/scripts/presentation/EventFoldItem';
import { Node, Layout, Label, Sprite, UITransform } from '../mocks/cc-mock';

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

  it('translates HUD header values comprehensively for 750x1334 top bar', () => {
    const identity = EnumMapper.translateIdentity('I_ARTISAN');
    const region = EnumMapper.translateRegion('R_JIANGNAN');
    const caste = EnumMapper.translateCaste('C_SOLDIER');

    expect(identity).toBe('军匠百工');
    expect(region).toBe('江南·苏州府');
    expect(caste).toBe('军户');

    const stats = ['physique', 'wealth', 'intelligence', 'prestige', 'luck'].map((k) => {
      const info = EnumMapper.translateStat(k);
      return `${info.name}:${info.icon}`;
    });

    expect(stats).toEqual([
      '体魄:体',
      '家资:财',
      '才干:智',
      '人脉:脉',
      '气数:气',
    ]);
  });

  it('mounts Sprite and Layout directly on root, puts labels as direct children, and configures width 620 / 572', () => {
    const node = new Node('TestFoldCard');
    const comp = node.addComponent(EventFoldItem);

    const data: FoldItemData = {
      id: 'test_fold_item',
      introText: '起因测试：陕北风沙漫天。',
      actionText: '行动测试：决意开仓放粮。',
      outcomeText: '泥金正文测试：百姓称颂！',
      stampTag: '功德无量',
      effectsSummary: ['气数+1', '家资-2'],
      type: 'event',
    };

    comp.init(data);

    // 1. 验证根节点自身挂载 Sprite 组件与尺寸 620
    const sprite = node.getComponent(Sprite);
    expect(sprite).not.toBeNull();
    const rootTrans = node.getComponent(UITransform);
    expect(rootTrans?.width).toBe(620);

    // 2. 验证根节点 Layout (VERTICAL, CONTAINER, 上下18, 左右24)
    const rootLayout = node.getComponent(Layout);
    expect(rootLayout).not.toBeNull();
    expect(rootLayout?.type).toBe(Layout.Type.VERTICAL);
    expect(rootLayout?.resizeMode).toBe(Layout.ResizeMode.CONTAINER);
    expect(rootLayout?.paddingTop).toBe(18);
    expect(rootLayout?.paddingBottom).toBe(18);
    expect(rootLayout?.paddingLeft).toBe(24);
    expect(rootLayout?.paddingRight).toBe(24);

    // 3. 验证无 CardBg 同级空背景节点，所有文本与结果栏均为根节点的直接子节点
    const cardBg = node.children.find((c) => c.name === 'CardBg');
    expect(cardBg).toBeUndefined();

    const introNode = node.children.find((c) => c.name === 'IntroLabel');
    expect(introNode).toBeDefined();
    const introTrans = introNode?.getComponent(UITransform);
    expect(introTrans?.width).toBe(572);
    expect(introTrans?.anchorX).toBe(0.5);
    const introLabel = introNode?.getComponent(Label);
    expect(introLabel?.overflow).toBe(Label.Overflow.RESIZE_HEIGHT);
    expect(introLabel?.horizontalAlign).toBe(Label.HorizontalAlign.LEFT);

    const actionNode = node.children.find((c) => c.name === 'ActionLabel');
    expect(actionNode).toBeDefined();
    const actTrans = actionNode?.getComponent(UITransform);
    expect(actTrans?.width).toBe(572);
    expect(actTrans?.anchorX).toBe(0.5);
    const actionLabel = actionNode?.getComponent(Label);
    expect(actionLabel?.overflow).toBe(Label.Overflow.RESIZE_HEIGHT);
    expect(actionLabel?.horizontalAlign).toBe(Label.HorizontalAlign.LEFT);

    const outcomeNode = node.children.find((c) => c.name === 'OutcomeNode');
    expect(outcomeNode).toBeDefined();
    const outRowTrans = outcomeNode?.getComponent(UITransform);
    expect(outRowTrans?.anchorX).toBe(0.5);
  });
});
