import {
  _decorator,
  Component,
  Node,
  Label,
  ScrollView,
  Color,
  UITransform,
  Button,
  Layers,
  Mask,
  Graphics,
  EventTouch,
  v3,
  UIOpacity,
  BlockInputEvents,
} from 'cc';
import { GameEngine } from '../core/engine/GameEngine';
import { GameSession, type SessionSave } from '../application/GameSession';
import { getNativeMingEndContent } from '../application/NativeContentLoader';
import type { GameView, PendingDecision, LogEntry } from '../core/types/schema';
import { EnumMapper } from './EnumMapper';
import { LogParser, FoldItemData } from './LogParser';
import { EventFoldItem } from './EventFoldItem';
import { UIAnimController } from './UIAnimController';
import { MemorialCard } from './MemorialCard';
import { RelicBarController } from './RelicBarController';

const { ccclass } = _decorator;

/**
 * GameMain: 竖屏水墨沉浸式界面主控
 * 尺寸：750 x 1334
 * 模块：顶栏 HUD (汉化+五维铜钱)、折页日志视口、右侧博古架、奏折批红遮罩、青铜官印长按推进
 */
@ccclass('GameMain')
export class GameMain extends Component {
  private session: GameSession | null = null;
  private currentView: GameView | null = null;

  // 节点引用
  private eraYearLabel: Label | null = null;
  private identityLabel: Label | null = null;
  private identityPlaqueNode: Node | null = null;
  private statCoinNodes: Map<string, Node> = new Map();
  private prevStatValues: Map<string, number> = new Map();

  private candleVignetteNode: Node | null = null;
  private logContentNode: Node | null = null;
  private scrollView: ScrollView | null = null;
  private relicBar: RelicBarController | null = null;

  // 抉择与遮罩
  private decisionOverlay: Node | null = null;
  private memorialCardComp: MemorialCard | null = null;

  // 底部推进官印交互
  private sealAdvanceBtn: Node | null = null;
  private isSealHolding: boolean = false;
  private holdTimer: number = 0;
  private autoAdvanceInterval: number = 0;

  // 统计已渲染折页
  private renderedItemsCount: number = 0;

  onLoad(): void {
    this.buildBaseView();
    this.startNewLife();
  }

  update(dt: number): void {
    // 监听长按快进
    if (this.isSealHolding) {
      this.holdTimer += dt;
      if (this.holdTimer >= 0.35) {
        this.autoAdvanceInterval += dt;
        if (this.autoAdvanceInterval >= 0.22) {
          this.autoAdvanceInterval = 0;
          this.onAdvance();
        }
      }
    }
  }

  /**
   * 纯代码构建 750x1334 沉浸式竖屏水墨节点树
   */
  private buildBaseView(): void {
    const root = this.node;
    root.layer = Layers.Enum.UI_2D;
    const rootTransform = root.getComponent(UITransform) || root.addComponent(UITransform);
    rootTransform.setContentSize(750, 1334);

    // 0. 背景层：宣纸暗底与烛火暗角
    this.buildBackground(root);

    // 1. 顶部水墨档案 HUD (710 x 160)
    this.buildTopHUD(root);

    // 2. 中部核心区：左侧历史流折页 + 右侧博古架
    this.buildCenterArea(root);

    // 3. 底部青铜官印与辅助控制区
    this.buildBottomControlBar(root);

    // 4. 奏折抉择弹层 (必须处于最顶层以响应交互并遮罩底层)
    this.buildDecisionOverlay(root);
  }

  private buildBackground(root: Node): void {
    const bgNode = new Node('BgLayer');
    bgNode.layer = Layers.Enum.UI_2D;
    const bgTrans = bgNode.addComponent(UITransform);
    bgTrans.setContentSize(750, 1334);
    const bgGfx = bgNode.addComponent(Graphics);
    bgGfx.fillColor = new Color(30, 27, 24, 255); // #1E1B18 宣纸炭黑底
    bgGfx.rect(-375, -667, 750, 1334);
    bgGfx.fill();
    root.addChild(bgNode);

    // 烛火暗角
    const candleNode = new Node('CandleVignette');
    candleNode.layer = Layers.Enum.UI_2D;
    const candleTrans = candleNode.addComponent(UITransform);
    candleTrans.setContentSize(750, 1334);
    const cGfx = candleNode.addComponent(Graphics);
    cGfx.fillColor = new Color(0, 0, 0, 120);
    cGfx.rect(-375, -667, 750, 1334);
    cGfx.fill();
    candleNode.addComponent(UIOpacity);
    root.addChild(candleNode);
    this.candleVignetteNode = candleNode;
  }

  private buildTopHUD(root: Node): void {
    const hudNode = new Node('TopHUD');
    hudNode.layer = Layers.Enum.UI_2D;
    hudNode.setPosition(0, 567, 0);
    const hudTrans = hudNode.addComponent(UITransform);
    hudTrans.setContentSize(750, 200);
    root.addChild(hudNode);

    // 纪年与岁数 (EraAndAgeLabel)
    const eraNode = new Node('EraAndAgeLabel');
    eraNode.layer = Layers.Enum.UI_2D;
    eraNode.setPosition(0, 55, 0);
    const eraTrans = eraNode.addComponent(UITransform);
    eraTrans.setContentSize(750, 36);
    this.eraYearLabel = eraNode.addComponent(Label);
    this.eraYearLabel.string = '大明崇祯纪事 · 正在启幕...';
    this.eraYearLabel.fontSize = 24;
    this.eraYearLabel.color = new Color(223, 204, 163, 255);
    hudNode.addChild(eraNode);

    // 身份腰牌容器 (IdentityPlaque)
    this.identityPlaqueNode = new Node('IdentityPlaque');
    this.identityPlaqueNode.layer = Layers.Enum.UI_2D;
    this.identityPlaqueNode.setPosition(0, 15, 0);
    const idTrans = this.identityPlaqueNode.addComponent(UITransform);
    idTrans.setContentSize(640, 34);
    this.identityLabel = this.identityPlaqueNode.addComponent(Label);
    this.identityLabel.string = '身份: 测算命中... | 地区: 关陕 | 阶层: 平民';
    this.identityLabel.fontSize = 18;
    this.identityLabel.color = new Color(190, 180, 165, 255);
    hudNode.addChild(this.identityPlaqueNode);

    // 五维属性铜钱栏 (StatsCoinBar)
    const coinBarNode = new Node('StatsCoinBar');
    coinBarNode.layer = Layers.Enum.UI_2D;
    coinBarNode.setPosition(0, -32, 0);
    const barTrans = coinBarNode.addComponent(UITransform);
    barTrans.setContentSize(700, 40);
    hudNode.addChild(coinBarNode);

    const stats = ['physique', 'wealth', 'intelligence', 'prestige', 'luck'];
    const startX = -260;
    const spacingX = 130;

    stats.forEach((stKey, index) => {
      const info = EnumMapper.translateStat(stKey);
      const coinNode = new Node(`Coin_${stKey}`);
      coinNode.layer = Layers.Enum.UI_2D;
      coinNode.setPosition(startX + index * spacingX, 0, 0);
      const cTrans = coinNode.addComponent(UITransform);
      cTrans.setContentSize(120, 36);

      const label = coinNode.addComponent(Label);
      label.string = `${info.name}: 0`;
      label.fontSize = 17;
      label.color = new Color(210, 200, 180, 255);

      coinBarNode.addChild(coinNode);
      this.statCoinNodes.set(stKey, coinNode);
    });
  }

  private buildCenterArea(root: Node): void {
    const centerNode = new Node('CenterScrollArea');
    centerNode.layer = Layers.Enum.UI_2D;
    centerNode.setPosition(0, 20, 0);
    const centerTrans = centerNode.addComponent(UITransform);
    centerTrans.setContentSize(750, 880);
    root.addChild(centerNode);

    // 左侧历史流视窗 (ScrollView, 680 x 880, X: -30)
    const scrollNode = new Node('EventScrollView');
    scrollNode.layer = Layers.Enum.UI_2D;
    scrollNode.setPosition(-30, 0, 0);
    const scrollTrans = scrollNode.addComponent(UITransform);
    scrollTrans.setContentSize(680, 880);

    // Viewport (Mask) - 居中且 AnchorX = 0.5, x = 0
    const viewportNode = new Node('Viewport');
    viewportNode.layer = Layers.Enum.UI_2D;
    viewportNode.setPosition(0, 0, 0);
    const vpTrans = viewportNode.addComponent(UITransform);
    vpTrans.setAnchorPoint(0.5, 0.5);
    vpTrans.setContentSize(680, 880);
    viewportNode.addComponent(Mask);
    scrollNode.addChild(viewportNode);

    const scrollView = scrollNode.addComponent(ScrollView);
    scrollView.horizontal = false;
    scrollView.vertical = true;
    this.scrollView = scrollView;

    const contentNode = new Node('Content');
    contentNode.layer = Layers.Enum.UI_2D;
    const contentTrans = contentNode.addComponent(UITransform);
    contentTrans.setContentSize(680, 880);
    contentTrans.setAnchorPoint(0.5, 1);
    contentNode.setPosition(0, 440, 0);
    viewportNode.addChild(contentNode);
    scrollView.content = contentNode;
    this.logContentNode = contentNode;
    centerNode.addChild(scrollNode);

    // 监听滚动实现历史折页岁月风化褪色
    scrollNode.on('scrolling', () => {
      if (this.scrollView) {
        UIAnimController.updateScrollWeathering(this.scrollView);
      }
    });

    // 右侧博古架 (60 x 880, X: 335)
    const relicNode = new Node('RightRelicBar');
    relicNode.layer = Layers.Enum.UI_2D;
    relicNode.setPosition(335, 0, 0);
    const relicTrans = relicNode.addComponent(UITransform);
    relicTrans.setContentSize(60, 880);
    this.relicBar = relicNode.addComponent(RelicBarController);
    centerNode.addChild(relicNode);
  }

  private buildDecisionOverlay(root: Node): void {
    const overlayNode = new Node('DecisionOverlay');
    overlayNode.layer = Layers.Enum.UI_2D;
    overlayNode.setPosition(0, 0, 0);
    const trans = overlayNode.addComponent(UITransform);
    trans.setContentSize(750, 1334);

    // 半透明遮罩 (MaskBg)
    const maskBg = new Node('MaskBg');
    maskBg.layer = Layers.Enum.UI_2D;
    const mTrans = maskBg.addComponent(UITransform);
    mTrans.setContentSize(750, 1334);
    maskBg.addComponent(BlockInputEvents);
    const gfx = maskBg.addComponent(Graphics);
    gfx.fillColor = new Color(0, 0, 0, 180);
    gfx.rect(-375, -667, 750, 1334);
    gfx.fill();
    overlayNode.addChild(maskBg);

    // 奏折卡片 (MemorialCard)
    const cardNode = new Node('MemorialCard');
    cardNode.layer = Layers.Enum.UI_2D;
    this.memorialCardComp = cardNode.addComponent(MemorialCard);
    overlayNode.addChild(cardNode);

    overlayNode.active = false;
    root.addChild(overlayNode);
    this.decisionOverlay = overlayNode;
  }

  private buildBottomControlBar(root: Node): void {
    const barNode = new Node('BottomControlBar');
    barNode.layer = Layers.Enum.UI_2D;
    barNode.setPosition(0, -547, 0);
    const barTrans = barNode.addComponent(UITransform);
    barTrans.setContentSize(750, 240);
    root.addChild(barNode);

    // 青铜官印大按钮 (推进流转)
    const sealBtnNode = new Node('SealAdvanceBtn');
    sealBtnNode.layer = Layers.Enum.UI_2D;
    sealBtnNode.setPosition(0, 48, 0);
    const sealTrans = sealBtnNode.addComponent(UITransform);
    sealTrans.setContentSize(380, 72);

    const btnGfx = sealBtnNode.addComponent(Graphics);
    btnGfx.fillColor = new Color(45, 75, 60, 255); // 青铜官印墨绿底
    btnGfx.roundRect(-190, -36, 380, 72, 10);
    btnGfx.fill();
    btnGfx.lineWidth = 2.5;
    btnGfx.strokeColor = new Color(180, 140, 60, 255);
    btnGfx.roundRect(-190, -36, 380, 72, 10);
    btnGfx.stroke();

    const labelNode = new Node('BtnLabel');
    labelNode.layer = Layers.Enum.UI_2D;
    const lTrans = labelNode.addComponent(UITransform);
    lTrans.setContentSize(380, 72);
    const label = labelNode.addComponent(Label);
    label.string = '钤印流转 · 推进流年';
    label.fontSize = 22;
    label.color = new Color(235, 225, 205, 255);
    sealBtnNode.addChild(labelNode);

    this.bindSealEvents(sealBtnNode);
    barNode.addChild(sealBtnNode);
    this.sealAdvanceBtn = sealBtnNode;

    // 辅助控制栏容器 (SubBtnLayout)
    const subLayoutNode = new Node('SubBtnLayout');
    subLayoutNode.layer = Layers.Enum.UI_2D;
    subLayoutNode.setPosition(0, -42, 0);
    const subTrans = subLayoutNode.addComponent(UITransform);
    subTrans.setContentSize(700, 50);
    barNode.addChild(subLayoutNode);

    this.createButton(subLayoutNode, '重启人生', -220, 0, 180, 48, () => this.startNewLife());
    this.createButton(subLayoutNode, '存档状态', 0, 0, 180, 48, () => this.showSaveTip());
    this.createButton(subLayoutNode, '滚至最新', 220, 0, 180, 48, () => {
      if (this.scrollView) this.scrollView.scrollToBottom(0.2);
    });
  }
  private bindSealEvents(btnNode: Node): void {
    btnNode.on(Node.EventType.TOUCH_START, () => {
      this.isSealHolding = true;
      this.holdTimer = 0;
      this.autoAdvanceInterval = 0;
      btnNode.setScale(0.95, 0.95, 1);
    });

    btnNode.on(Node.EventType.TOUCH_END, () => {
      btnNode.setScale(1, 1, 1);
      if (this.currentView && this.currentView.status === 'ENDED') {
        // 死亡状态直接触发重启人生
        this.startNewLife();
        return;
      }
      if (this.holdTimer < 0.35) {
        // 短按推进单步
        this.onAdvance();
      }
      this.isSealHolding = false;
    });
    btnNode.on(Node.EventType.TOUCH_CANCEL, () => {
      btnNode.setScale(1, 1, 1);
      this.isSealHolding = false;
    });
  }

  private startNewLife(): void {
    this.isSealHolding = false;
    if (this.logContentNode) {
      this.logContentNode.removeAllChildren();
      const trans = this.logContentNode.getComponent(UITransform);
      if (trans) trans.setContentSize(630, 800);
    }
    this.renderedItemsCount = 0;

    const pkg = getNativeMingEndContent();
    const engine = new GameEngine(pkg.bundle, pkg.fingerprint);
    let saveSlot: unknown = null;
    this.session = new GameSession(engine, {
      hash: (val: unknown) => String(val),
      persist: async (save) => { saveSlot = structuredClone(save); },
      load: async () => saveSlot as SessionSave | null,
    });

    this.session.initialize(1628).then((initResult) => {
      if (!initResult.ok) {
        this.appendSystemLog(`启动遇阻: ${initResult.error.message}`);
        return;
      }
      this.currentView = initResult.state;
      this.updateHUD(this.currentView);
      this.updateSealButtonState(false);

      this.appendSystemLog('【天启末造】大明崇祯元年，天象动荡，世事如棋。');
      if (this.identityPlaqueNode) {
        UIAnimController.playPlaqueSway(this.identityPlaqueNode);
      }

      this.renderPending(initResult.pending);
    }).catch((e) => {
      this.appendSystemLog(`启动异常: ${String(e)}`);
    });
  }

  private async onAdvance(): Promise<void> {
    if (!this.session) return;
    if (this.currentView && this.currentView.status === 'ENDED') {
      this.isSealHolding = false;
      this.appendSystemLog('【生平盖棺】尘埃落定，不可复进。请点击“重启人生”。');
      return;
    }
    // 如果当前有尚未完成的玩家选择，阻止盲目推进并弹出提示
    if (this.currentView && this.currentView.status === 'AWAITING_OPTION') {
      this.isSealHolding = false;
      if (this.decisionOverlay) this.decisionOverlay.active = true;
      this.appendSystemLog('【时局待定】当前有机缘抉择尚未定夺，请先批红呈阅。');
      return;
    }
    // 如果当前有自动阶段检定，自动继续执行检定而不阻断
    if (this.currentView && this.currentView.status === 'AWAITING_STAGE') {
      await this.chooseStage();
      return;
    }

    try {
      const res = await this.session.command({ type: 'next' });
      if (!res.ok) {
        this.isSealHolding = false;
        this.appendSystemLog(`推进遇阻: ${res.error.message}`);
        return;
      }

      this.currentView = res.state;
      if (this.currentView) {
        this.updateHUD(this.currentView);
      }

      // 聚合解析引擎日志并追加折页卡片
      if (res.logs && res.logs.length > 0) {
        const foldItems = LogParser.parseBatch(this.extractRawLogs(res.logs));
        for (const item of foldItems) {
          this.appendFoldCard(item);
        }
      }
      // 刷新待处理决断
      this.renderPending(res.pending);

      if (this.currentView && this.currentView.status === 'ENDED') {
        this.isSealHolding = false;
        this.updateSealButtonState(true);
        this.appendEndingHint();
      }

      if (this.scrollView) {
        this.scrollView.scrollToBottom(0.2);
        UIAnimController.updateScrollWeathering(this.scrollView);
      }
    } catch (e) {
      this.isSealHolding = false;
      this.appendSystemLog(`推进异常: ${String(e)}`);
    }
  }

  private updateHUD(view: GameView): void {
    const p = view.player;
    if (this.eraYearLabel) {
      const reignYear = p.calendar_year - 1627;
      this.eraYearLabel.string = `大明崇祯 ${reignYear} 年 (${p.calendar_year}) · ${p.age} 岁`;
    }

    if (this.identityLabel) {
      const idName = EnumMapper.translateIdentity(p.identity_id);
      const regName = EnumMapper.translateRegion(p.region_id);
      const casteName = EnumMapper.translateCaste(p.caste_id);
      this.identityLabel.string = `身份: ${idName} | 地区: ${regName} | 阶层: ${casteName}`;
    }

    // 五维属性与铜钱翻转动效
    const stats: Record<string, number> = {
      physique: p.attributes.physique,
      wealth: p.attributes.wealth,
      intelligence: p.attributes.intelligence,
      prestige: p.attributes.prestige,
      luck: p.attributes.luck,
    };

    for (const [k, val] of Object.entries(stats)) {
      const node = this.statCoinNodes.get(k);
      if (node) {
        const lbl = node.getComponent(Label);
        const prev = this.prevStatValues.get(k) ?? val;
        const info = EnumMapper.translateStat(k);
        if (lbl) lbl.string = `${info.name}: ${val}`;

        if (prev !== val) {
          UIAnimController.playStatChangeEffect(node, val - prev);
          this.prevStatValues.set(k, val);
        }
      }
    }

    // 烛火暗角更新
    if (this.candleVignetteNode) {
      UIAnimController.updateCandleVignette(
        this.candleVignetteNode,
        p.age,
        p.attributes.luck,
      );
    }
  }

  private appendFoldCard(data: FoldItemData): void {
    if (!this.logContentNode) return;
    this.renderedItemsCount += 1;

    const itemNode = new Node(`FoldCard_${this.renderedItemsCount}`);
    itemNode.layer = Layers.Enum.UI_2D;
    itemNode.setPosition(0, -this.renderedItemsCount * 90, 0);
    const itemTrans = itemNode.addComponent(UITransform);
    itemTrans.setAnchorPoint(0.5, 0.5);
    this.logContentNode.addChild(itemNode);

    const comp = itemNode.addComponent(EventFoldItem);
    comp.init(data);
    // 朱砂印章盖印动效与震屏
    const stampBadge = comp.getStampNode();
    if (stampBadge) {
      UIAnimController.playStampEffect(stampBadge, this.node);
      // 如果是传家宝或珍贵词条，飞入右侧博古架
      if (this.relicBar && this.isRareRelicTag(data.stampTag)) {
        const relicInfo = this.resolveRelicItem(data);
        this.relicBar.addRelic(relicInfo, stampBadge);
      }
    }

    this.updateLogContentLayout();
  }

  /**
   * 识别传家宝与珍贵词条（如“传家之宝”锁子甲、“万家生佛”、“点石成金”、“绝世古董”等）
   */
  private isRareRelicTag(tag?: string): boolean {
    if (!tag) return false;
    const rareKeywords = [
      '传家之宝',
      '万家生佛',
      '点石成金',
      '绝世古董',
      '民间鲁班',
      '大明货王',
      '泰山北斗',
      '赛华佗在世',
    ];
    return rareKeywords.includes(tag) || tag.includes('传家') || tag.includes('古董') || tag.includes('至宝');
  }

  private resolveRelicItem(data: FoldItemData) {
    const name = data.stampTag || '传家珍宝';
    return {
      id: data.id ?? `relic_${Date.now()}_${Math.random()}`,
      name: name === '传家之宝' ? '铁扎战甲' : name,
      desc: data.outcomeText || '明末遗珍，岁月见证。',
    };
  }
  private updateLogContentLayout(): void {
    if (!this.logContentNode) return;
    let totalHeight = 16;
    const spacing = 16;
    for (const child of this.logContentNode.children) {
      const trans = child.getComponent(UITransform);
      if (trans) {
        child.setPosition(0, -totalHeight - trans.height / 2, 0);
        totalHeight += trans.height + spacing;
      }
    }
    const contentTrans = this.logContentNode.getComponent(UITransform);
    if (contentTrans) {
      contentTrans.setContentSize(680, Math.max(880, totalHeight + 20));
    }
  }

  private renderPending(pending: PendingDecision | null): void {
    if (!pending) {
      if (this.decisionOverlay) this.decisionOverlay.active = false;
      return;
    }

    // 打断官印长按
    this.isSealHolding = false;

    if (pending.kind === 'option' && this.memorialCardComp && this.decisionOverlay) {
      this.decisionOverlay.active = true;
      this.memorialCardComp.init(pending, (optId) => {
        this.chooseOption(optId);
      });
    } else {
      if (this.decisionOverlay) this.decisionOverlay.active = false;
      if (pending.kind === 'stage') {
        this.chooseStage();
      }
    }
  }

  private async chooseOption(optId: string): Promise<void> {
    if (!this.session) return;
    if (this.decisionOverlay) this.decisionOverlay.active = false;

    const res = await this.session.command({ type: 'choose', optionId: optId });
    if (!res.ok) {
      this.appendSystemLog(`抉择遇阻: ${res.error.message}`);
      return;
    }

    this.currentView = res.state;
    if (this.currentView) this.updateHUD(this.currentView);

    if (res.logs && res.logs.length > 0) {
      const items = LogParser.parseBatch(this.extractRawLogs(res.logs));
      for (const it of items) this.appendFoldCard(it);
    }
    if (this.currentView && this.currentView.status === 'ENDED') {
      this.isSealHolding = false;
      this.updateSealButtonState(true);
      this.appendEndingHint();
    }
    this.renderPending(res.pending);
    if (this.scrollView) this.scrollView.scrollToBottom(0.2);
  }

  private async chooseStage(): Promise<void> {
    if (!this.session) return;
    const res = await this.session.command({ type: 'stage' });
    if (!res.ok) return;

    this.currentView = res.state;
    if (this.currentView) this.updateHUD(this.currentView);
    if (res.logs && res.logs.length > 0) {
      const items = LogParser.parseBatch(this.extractRawLogs(res.logs));
      for (const it of items) this.appendFoldCard(it);
    }
    if (this.currentView && this.currentView.status === 'ENDED') {
      this.isSealHolding = false;
      this.updateSealButtonState(true);
      this.appendEndingHint();
    }
    this.renderPending(res.pending);
    if (this.scrollView) this.scrollView.scrollToBottom(0.2);
  }

  private appendSystemLog(msg: string): void {
    this.appendFoldCard({
      id: `sys_${Date.now()}_${Math.random()}`,
      introText: msg,
      type: 'system',
    });
  }
  private extractRawLogs(logs: readonly LogEntry[]) {
    return logs.map((l) => {
      let metadata: Record<string, unknown> | undefined = undefined;
      if ('data' in l && l.data && typeof l.data === 'object') {
        metadata = l.data as Record<string, unknown>;
      }
      return {
        type: l.type,
        message: l.message,
        metadata,
      };
    });
  }

  private appendEndingHint(): void {
    this.appendFoldCard({
      id: `end_${Date.now()}`,
      introText: '【大明终章】一代沧桑过往俱成青史微尘。',
      outcomeText: '盖棺定论，岁月寂然。',
      type: 'death',
    });
  }

  private showSaveTip(): void {
    if (!this.session) return;
    const saveObj = this.session.exportSave();
    this.appendSystemLog(`【文书存档】存档版本: ${saveObj.engine.save_version}`);
  }

  private createButton(
    parent: Node,
    title: string,
    x: number,
    y: number,
    w: number,
    h: number,
    cb: () => void,
  ): Node {
    const btnNode = new Node(`Btn_${title}`);
    btnNode.layer = Layers.Enum.UI_2D;
    btnNode.setPosition(x, y, 0);
    const trans = btnNode.addComponent(UITransform);
    trans.setContentSize(w, h);

    const gfx = btnNode.addComponent(Graphics);
    gfx.fillColor = new Color(50, 45, 40, 220);
    gfx.roundRect(-w / 2, -h / 2, w, h, 6);
    gfx.fill();
    gfx.lineWidth = 1.5;
    gfx.strokeColor = new Color(130, 110, 80, 200);
    gfx.roundRect(-w / 2, -h / 2, w, h, 6);
    gfx.stroke();

    const lblNode = new Node('Title');
    lblNode.layer = Layers.Enum.UI_2D;
    const lTrans = lblNode.addComponent(UITransform);
    lTrans.setContentSize(w, h);
    const lbl = lblNode.addComponent(Label);
    lbl.string = title;
    lbl.fontSize = 18;
    lbl.color = new Color(220, 210, 190, 255);
    btnNode.addChild(lblNode);

    btnNode.on(Node.EventType.TOUCH_END, cb);
    parent.addChild(btnNode);
    return btnNode;
  }

  // --- 公共检查与交互接口 (供测试、调试与自动化验收) ---
  public getEraYearLabel(): Label | null {
    return this.eraYearLabel;
  }

  public getIdentityLabel(): Label | null {
    return this.identityLabel;
  }

  public getStatCoinNode(statKey: string): Node | null {
    return this.statCoinNodes.get(statKey) ?? null;
  }

  public getRelicBar(): RelicBarController | null {
    return this.relicBar;
  }

  public getDecisionOverlay(): Node | null {
    return this.decisionOverlay;
  }

  public getMemorialCard(): MemorialCard | null {
    return this.memorialCardComp;
  }

  public getSealAdvanceBtn(): Node | null {
    return this.sealAdvanceBtn;
  }

  public getLogContentNode(): Node | null {
    return this.logContentNode;
  }

  public getSession(): GameSession | null {
    return this.session;
  }

  public getCurrentView(): GameView | null {
    return this.currentView;
  }

  public isHoldingSeal(): boolean {
    return this.isSealHolding;
  }

  public triggerAdvance(): Promise<void> {
    return this.onAdvance();
  }

  private updateSealButtonState(isEnded: boolean): void {
    if (!this.sealAdvanceBtn) return;
    const labelNode = this.sealAdvanceBtn.children.find((c) => c.name === 'BtnLabel');
    const label = labelNode?.getComponent(Label);
    const gfx = this.sealAdvanceBtn.getComponent(Graphics);
    if (isEnded) {
      if (label) label.string = '尘埃落定 · 重启人生';
      if (gfx) {
        gfx.clear();
        gfx.fillColor = new Color(55, 50, 50, 255); // 置灰深色
        gfx.roundRect(-190, -36, 380, 72, 10);
        gfx.fill();
        gfx.lineWidth = 2.5;
        gfx.strokeColor = new Color(130, 110, 90, 255);
        gfx.roundRect(-190, -36, 380, 72, 10);
        gfx.stroke();
      }
    } else {
      if (label) label.string = '钤印流转 · 推进流年';
      if (gfx) {
        gfx.clear();
        gfx.fillColor = new Color(45, 75, 60, 255); // 青铜墨绿底
        gfx.roundRect(-190, -36, 380, 72, 10);
        gfx.fill();
        gfx.lineWidth = 2.5;
        gfx.strokeColor = new Color(180, 140, 60, 255);
        gfx.roundRect(-190, -36, 380, 72, 10);
        gfx.stroke();
      }
    }
  }
}
