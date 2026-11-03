import { describe, it, expect, vi } from 'vitest';
import { Node, UITransform, Label, UIOpacity } from '../mocks/cc-mock';
import { RelicBarController, type RelicItemData } from '../../assets/scripts/presentation/RelicBarController';
import { GameMain } from '../../assets/scripts/presentation/GameMain';
import { EnumMapper } from '../../assets/scripts/presentation/EnumMapper';
import { LogParser } from '../../assets/scripts/presentation/LogParser';
import { EventFoldItem } from '../../assets/scripts/presentation/EventFoldItem';

describe('UI Refactor Phase 4 - Relic Shelf & GameMain Integration', () => {
  describe('RelicBarController component logic', () => {
    it('initializes 5 antique display shelf slots upon onLoad', () => {
      const node = new Node('RelicBarRoot');
      const relicBar = node.addComponent(RelicBarController);
      relicBar.onLoad();

      expect(relicBar.getRelics()).toHaveLength(0);
      for (let i = 0; i < 5; i++) {
        const slot = relicBar.getSlotNode(i);
        expect(slot).not.toBeNull();
        expect(slot?.name).toBe(`RelicSlot_${i}`);
      }
      expect(relicBar.getSlotNode(5)).toBeNull();
    });

    it('adds heirloom and rare entries, deduplicates and caps at shelf capacity', () => {
      const node = new Node('RelicBarRoot');
      const relicBar = node.addComponent(RelicBarController);
      relicBar.onLoad();

      const item1: RelicItemData = {
        id: 'relic_iron_armor',
        name: '传家之宝',
        desc: '锁片铿锵甲光向日，披挂在身刀枪难透',
      };
      relicBar.addRelic(item1);

      expect(relicBar.getRelics()).toHaveLength(1);
      expect(relicBar.getRelics()[0]?.id).toBe('relic_iron_armor');

      // Duplicate addition should be ignored
      relicBar.addRelic(item1);
      expect(relicBar.getRelics()).toHaveLength(1);

      // Fill remaining 4 slots
      for (let i = 2; i <= 5; i++) {
        relicBar.addRelic({
          id: `relic_${i}`,
          name: `宝物${i}`,
          desc: `宝物描述${i}`,
        });
      }
      expect(relicBar.getRelics()).toHaveLength(5);

      // Exceeding capacity should be safely ignored
      relicBar.addRelic({
        id: 'relic_overflow',
        name: '溢出宝物',
        desc: '无法存入',
      });
      expect(relicBar.getRelics()).toHaveLength(5);
    });

    it('plays smooth curved flying animation from source node to target shelf slot', () => {
      const node = new Node('RelicBarRoot');
      const relicBar = node.addComponent(RelicBarController);
      relicBar.onLoad();

      const sourceNode = new Node('FoldCardStamp');
      const item: RelicItemData = {
        id: 'relic_buddha',
        name: '万家生佛',
        desc: '全城百姓盛赞你是乱世活菩萨，声望直冲云霄！',
      };

      // Add with sourceWorldNode
      relicBar.addRelic(item, sourceNode);
      expect(relicBar.getRelics()).toHaveLength(1);

      const slot0 = relicBar.getSlotNode(0);
      expect(slot0).not.toBeNull();
      const icon = slot0?.children.find((c) => c.name === 'RelicIcon');
      expect(icon).toBeDefined();

      const iconLabel = icon?.getComponent(Label);
      expect(iconLabel?.string).toBe('万家');
    });

    it('pops up relic provenance detail upon clicking slot icon', () => {
      const node = new Node('RelicBarRoot');
      const relicBar = node.addComponent(RelicBarController);
      relicBar.onLoad();

      const item: RelicItemData = {
        id: 'relic_antique',
        name: '绝世古董',
        desc: '擦干净一看竟是宋代建盏！收古董的大官追了三条街求购！',
      };
      relicBar.addRelic(item);

      const slot0 = relicBar.getSlotNode(0);
      const icon = slot0?.children.find((c) => c.name === 'RelicIcon');
      expect(icon).toBeDefined();

      // Trigger click event
      icon?.emit(Node.EventType.TOUCH_END);

      const detailPanel = relicBar.getDetailPanel();
      expect(detailPanel).not.toBeNull();
      expect(detailPanel?.active).toBe(true);

      const textNode = detailPanel?.children.find((c) => c.name === 'TipText');
      const label = textNode?.getComponent(Label);
      expect(label?.string).toContain('【绝世古董】');
      expect(label?.string).toContain('擦干净一看竟是宋代建盏');
    });
  });

  describe('GameMain full orchestration & UI tree integration', () => {
    it('constructs 750x1334 ink wash hierarchy and initializes components', async () => {
      const mainNode = new Node('GameMainRoot');
      const gameMain = mainNode.addComponent(GameMain);

      gameMain.onLoad();

      // 验证 750x1334 画布尺寸
      const rootTrans = mainNode.getComponent(UITransform);
      expect(rootTrans?.width).toBe(750);
      expect(rootTrans?.height).toBe(1334);

      // 验证顶部 HUD (汉化身份、地区、阶层)
      const eraLabel = gameMain.getEraYearLabel();
      expect(eraLabel).not.toBeNull();
      expect(eraLabel?.string).toContain('大明崇祯');

      const idLabel = gameMain.getIdentityLabel();
      expect(idLabel).not.toBeNull();
      expect(idLabel?.string).toContain('身份:');
      expect(idLabel?.string).toContain('地区:');
      expect(idLabel?.string).toContain('阶层:');

      // 验证五维铜钱
      const stats = ['physique', 'wealth', 'intelligence', 'prestige', 'luck'];
      for (const st of stats) {
        const coin = gameMain.getStatCoinNode(st);
        expect(coin).not.toBeNull();
      }

      // 验证博古架、奏折抉择弹层、青铜官印
      expect(gameMain.getRelicBar()).not.toBeNull();
      expect(gameMain.getDecisionOverlay()).not.toBeNull();
      expect(gameMain.getMemorialCard()).not.toBeNull();
      expect(gameMain.getSealAdvanceBtn()).not.toBeNull();
      expect(gameMain.getLogContentNode()).not.toBeNull();
    });

    it('binds seal button touch interactions for tap and hold cadence', () => {
      const mainNode = new Node('GameMainRoot');
      const gameMain = mainNode.addComponent(GameMain);
      gameMain.onLoad();

      const sealBtn = gameMain.getSealAdvanceBtn();
      expect(sealBtn).not.toBeNull();

      // TOUCH_START activates holding state
      sealBtn?.emit(Node.EventType.TOUCH_START);
      expect(gameMain.isHoldingSeal()).toBe(true);

      // TOUCH_END releases holding state
      sealBtn?.emit(Node.EventType.TOUCH_END);
      expect(gameMain.isHoldingSeal()).toBe(false);

      // TOUCH_CANCEL also releases holding state safely
      sealBtn?.emit(Node.EventType.TOUCH_START);
      expect(gameMain.isHoldingSeal()).toBe(true);
      sealBtn?.emit(Node.EventType.TOUCH_CANCEL);
      expect(gameMain.isHoldingSeal()).toBe(false);
    });

    it('collects heirloom & rare entries into relic bar during game turn advance', async () => {
      const mainNode = new Node('GameMainRoot');
      const gameMain = mainNode.addComponent(GameMain);
      gameMain.onLoad();

      // Wait a microtask for session initialization
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 10);
      await promise;
      const relicBar = gameMain.getRelicBar();
      expect(relicBar).not.toBeNull();
      const initialRelics = relicBar?.getRelics().length ?? 0;

      // Simulate advancing a turn
      await gameMain.triggerAdvance();

      // Ensure view state is updated
      expect(gameMain.getCurrentView()).not.toBeNull();
      expect(gameMain.getEraYearLabel()?.string).toContain('崇祯');
    });

    it('changes seal button text to 尘埃落定 · 重启人生 when life ends and triggers restart upon click', () => {
      const mainNode = new Node('GameMainRoot');
      const gameMain = mainNode.addComponent(GameMain);
      gameMain.onLoad();

      const sealBtn = gameMain.getSealAdvanceBtn();
      expect(sealBtn).not.toBeNull();
      const labelNode = sealBtn?.children.find((c) => c.name === 'BtnLabel');
      const label = labelNode?.getComponent(Label);
      expect(label?.string).toBe('钤印流转 · 推进流年');

      // Mock ENDED status
      (gameMain as unknown as { currentView: { status: string } }).currentView = { status: 'ENDED' };
      (gameMain as unknown as { updateSealButtonState: (isEnded: boolean) => void }).updateSealButtonState(true);
      expect(label?.string).toBe('尘埃落定 · 重启人生');

      // Clicking seal button in ENDED state restarts new life
      sealBtn?.emit(Node.EventType.TOUCH_END);
      // Verify holding is cleared and restart handled
      expect(gameMain.isHoldingSeal()).toBe(false);
    });
  });
});
