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
  BlockInputEvents,
  view,
  screen,
  ResolutionPolicy,
  isValid,
} from 'cc';
import { GameEngine } from '../core/engine/GameEngine';
import { GameSession, type SessionSave } from '../application/GameSession';
import { sha256Json } from '../core/persistence/JsonDigest';
import { getNativeMingEndContent } from '../application/NativeContentLoader';
import type { GameView, PendingDecision, LogEntry, EndingReport } from '../core/types/schema';
import { EnumMapper } from './EnumMapper';
import { LogParser, FoldItemData } from './LogParser';
import { EventFoldItem } from './EventFoldItem';
import { UIAnimController } from './UIAnimController';
import { MemorialCard } from './MemorialCard';
import { RelicBarController } from './RelicBarController';
import { PixelFXController } from './PixelFXController';

const { ccclass } = _decorator;

const VIEW = {
  width: 750,
  height: 1334,
  hudHeight: 220,
  bodyHeight: 934,
  footerHeight: 180,
  logWidth: 630,
  foldWidth: 590,
  shelfWidth: 120,
};
const HOLD_DELAY = 0.35;
const HOLD_INTERVAL = 0.22;

const INK = {
  background: new Color(19, 21, 28, 255),
  hud: new Color(22, 25, 34, 255),
  panel: new Color(26, 29, 38, 255),
  raised: new Color(34, 38, 51, 255),
  inset: new Color(17, 19, 26, 255),
  border: new Color(53, 59, 73, 255),
  borderLight: new Color(82, 91, 110, 255),
  text: new Color(237, 241, 247, 255),
  sub: new Color(140, 150, 168, 255),
  cyan: new Color(0, 240, 255, 255),
  gold: new Color(255, 190, 11, 255),
  green: new Color(5, 223, 183, 255),
  red: new Color(255, 42, 95, 255),
  purple: new Color(199, 125, 255, 255),
  selected: new Color(18, 40, 50, 255),
  advance: new Color(25, 79, 59, 255),
  advanceBorder: new Color(74, 222, 128, 255),
  ended: new Color(87, 19, 31, 255),
  scrim: new Color(9, 10, 14, 224),
};

/**
 * GameMain: 真实 GameSession 驱动的暗色竖屏主界面。
 * 固定宽度 750：HUD 220、底部控制 180，日志和博古架随可视高度伸缩。
 * 家当仅从开局三选一取得；终局与像素反馈均读取真实状态。
 */
@ccclass('GameMain')
export class GameMain extends Component {
  private session: GameSession | null = null;
  private currentView: GameView | null = null;
  private viewportHeight = VIEW.height;
  private contentHeight = VIEW.bodyHeight;

  // 节点引用
  private eraYearLabel: Label | null = null;
  private turnLabel: Label | null = null;
  private identityLabel: Label | null = null;
  private identityPlaqueNode: Node | null = null;
  private statCoinNodes: Map<string, Node> = new Map();
  private prevStatValues: Map<string, number> = new Map();

  private pixelFX: PixelFXController | null = null;
  private endingPanel: Node | null = null;
  private endingReport: EndingReport | null = null;
  private terminalHandled = false;
  private endingFXDelay = 0;
  private logContentNode: Node | null = null;
  private scrollView: ScrollView | null = null;
  private relicBar: RelicBarController | null = null;
  private acquiredRelicId: string | null = null;

  // 抉择与遮罩
  private decisionOverlay: Node | null = null;
  private memorialCardComp: MemorialCard | null = null;
  private cardChoiceNode: Node | null = null;
  private selectedCardId: string | null = null;
  private cardSubmitting = false;
  private cardErrorLabel: Label | null = null;
  private careerButton: Node | null = null;
  private careerPanel: Node | null = null;
  private careerBusy = false;
  private stageInFlight: Promise<void> | null = null;

  // 底部推进官印交互
  private sealAdvanceBtn: Node | null = null;
  private isSealHolding = false;
  private holdTimer = 0;
  private autoAdvanceInterval = 0;
  private holdBeganEnded = false;
  private advanceInFlight: Promise<void> | null = null;

  // 统计已渲染折页
  private renderedItemsCount: number = 0;

  onLoad(): void {
    this.viewportHeight = view.getVisibleSize().height;
    this.contentHeight = this.viewportHeight - VIEW.hudHeight - VIEW.footerHeight;
    this.buildBaseView();
    screen.on('window-resize', this.resizeLayout, this);
    this.startNewLife();
  }

  onEnable(): void {
    this.resizeLayout();
  }

  onDisable(): void {
    this.cancelSealHold();
    this.holdBeganEnded = false;
    this.endingFXDelay = 0;
    UIAnimController.stopAnimations(this.node, true);
    this.pixelFX?.stopTransient();
  }

  onDestroy(): void {
    screen.off('window-resize', this.resizeLayout, this);
    this.onDisable();
    this.session = null;
  }

  private resizeLayout(): void {
    const frame = view.getFrameSize();
    const height = VIEW.width * frame.height / frame.width;
    if (Math.abs(view.getVisibleSize().height - height) > 1) {
      view.setDesignResolutionSize(VIEW.width, VIEW.height, ResolutionPolicy.FIXED_WIDTH);
    }
    this.viewportHeight = height;
    this.contentHeight = height - VIEW.hudHeight - VIEW.footerHeight;
    this.node.getComponent(UITransform)?.setContentSize(VIEW.width, height);
    const background = this.node.getChildByName('BgLayer');
    if (background) {
      background.getComponent(UITransform)!.setContentSize(VIEW.width, height);
      this.paintPanel(background, VIEW.width, height, INK.background, INK.background, 0);
    }
    this.node.getChildByName('TopHUD')?.setPosition(0, (height - VIEW.hudHeight) / 2, 0);
    this.node.getChildByName('BottomControlBar')?.setPosition(0, -(height - VIEW.footerHeight) / 2, 0);
    const center = this.node.getChildByName('CenterScrollArea');
    center?.getComponent(UITransform)?.setContentSize(VIEW.width, this.contentHeight);
    if (this.scrollView && this.logContentNode) {
      const offset = this.scrollView.getScrollOffset();
      this.scrollView.stopAutoScroll();
      this.scrollView.node.getComponent(UITransform)!.setContentSize(VIEW.logWidth, this.contentHeight);
      this.logContentNode.parent!.getComponent(UITransform)!.setContentSize(VIEW.logWidth, this.contentHeight);
      this.logContentNode.setPosition(0, this.contentHeight / 2, 0);
      this.updateLogContentLayout();
      this.scrollView.scrollToOffset(offset, 0);
    }
    this.relicBar?.setHeight(this.contentHeight);
    this.pixelFX?.setViewportHeight(height);
    if (this.decisionOverlay) {
      this.decisionOverlay.getComponent(UITransform)!.setContentSize(VIEW.width, height);
      const mask = this.decisionOverlay.getChildByName('MaskBg')!;
      mask.getComponent(UITransform)!.setContentSize(VIEW.width, height);
      this.paintPanel(mask, VIEW.width, height, INK.scrim, INK.scrim, 0);
      for (const child of this.decisionOverlay.children) {
        if (child !== mask) this.fitModal(child);
      }
    }
  }

  private fitModal(node: Node): void {
    const height = node.getComponent(UITransform)?.height;
    if (!height) return;
    const scale = Math.min(1, (this.viewportHeight - 48) / height);
    node.setScale(scale, scale, 1);
  }

  update(dt: number): void {
    if (this.endingFXDelay > 0) {
      this.endingFXDelay -= dt;
      if (this.endingFXDelay <= 0 && this.currentView?.status === 'ENDED') this.pixelFX?.play('ending');
    }
    if (!this.isSealHolding) return;
    const previousHoldTimer = this.holdTimer;
    this.holdTimer += dt;
    if (this.holdTimer < HOLD_DELAY) return;
    if (previousHoldTimer < HOLD_DELAY) {
      this.autoAdvanceInterval = 0;
      void this.onAdvance();
      return;
    }
    this.autoAdvanceInterval += dt;
    if (this.autoAdvanceInterval < HOLD_INTERVAL) return;
    this.autoAdvanceInterval = 0;
    void this.onAdvance();
  }

  /** 固定逻辑宽度，按实际可视高度构建首帧。 */
  private buildBaseView(): void {
    const root = this.node;
    root.layer = Layers.Enum.UI_2D;
    const rootTransform = root.getComponent(UITransform) || root.addComponent(UITransform);
    rootTransform.setContentSize(VIEW.width, this.viewportHeight);

    this.buildBackground(root);
    this.buildTopHUD(root);
    this.buildCenterArea(root);
    this.buildBottomControlBar(root);

    // 特效无输入组件，位于普通界面之上、所有交互弹层之下。
    const effectsNode = new Node('PixelFXLayer');
    effectsNode.layer = Layers.Enum.UI_2D;
    effectsNode.addComponent(UITransform).setContentSize(VIEW.width, this.viewportHeight);
    root.addChild(effectsNode);
    this.pixelFX = effectsNode.addComponent(PixelFXController);
    this.pixelFX.setViewportHeight(this.viewportHeight);
    this.buildDecisionOverlay(root);
  }

  private buildBackground(root: Node): void {
    const background = new Node('BgLayer');
    background.layer = Layers.Enum.UI_2D;
    background.addComponent(UITransform).setContentSize(VIEW.width, this.viewportHeight);
    this.paintPanel(background, VIEW.width, this.viewportHeight, INK.background, INK.background, 0);
    root.addChild(background);
  }

  private buildTopHUD(root: Node): void {
    const hudNode = new Node('TopHUD');
    hudNode.layer = Layers.Enum.UI_2D;
    hudNode.setPosition(0, (this.viewportHeight - VIEW.hudHeight) / 2, 0);
    hudNode.addComponent(UITransform).setContentSize(VIEW.width, VIEW.hudHeight);
    this.paintPanel(hudNode, VIEW.width, VIEW.hudHeight, INK.hud, INK.border, 0);
    root.addChild(hudNode);

    this.eraYearLabel = this.createText(hudNode, 'EraAndAgeLabel', '正在启幕…', -103, 72, 496, 44, 28, INK.gold);
    this.eraYearLabel.isBold = true;
    const turnBadge = new Node('TurnBadge');
    turnBadge.layer = Layers.Enum.UI_2D;
    turnBadge.setPosition(257, 72, 0);
    turnBadge.addComponent(UITransform).setContentSize(188, 38);
    this.paintPanel(turnBadge, 188, 38, INK.raised, INK.raised, 4);
    hudNode.addChild(turnBadge);
    this.turnLabel = this.createText(turnBadge, 'TurnLabel', '等待开局', 0, 0, 180, 34, 20, INK.sub, Label.HorizontalAlign.CENTER);

    this.identityPlaqueNode = new Node('IdentityPlaque');
    this.identityPlaqueNode.layer = Layers.Enum.UI_2D;
    this.identityPlaqueNode.setPosition(0, 18, 0);
    this.identityPlaqueNode.addComponent(UITransform).setContentSize(702, 48);
    this.paintPanel(this.identityPlaqueNode, 702, 48, INK.inset, INK.border, 4);
    hudNode.addChild(this.identityPlaqueNode);
    this.identityLabel = this.createText(this.identityPlaqueNode, 'IdentityLabel', '身份、地区与阶层正在载入…', 0, 0, 674, 42, 21, INK.text);

    const statBar = new Node('StatsCoinBar');
    statBar.layer = Layers.Enum.UI_2D;
    statBar.setPosition(0, -68, 0);
    statBar.addComponent(UITransform).setContentSize(VIEW.width, 84);
    this.paintPanel(statBar, VIEW.width, 84, INK.inset, INK.border, 0);
    hudNode.addChild(statBar);

    const stats = ['physique', 'wealth', 'intelligence', 'prestige', 'luck'];
    stats.forEach((key, index) => {
      const cell = new Node(`StatCell_${key}`);
      cell.layer = Layers.Enum.UI_2D;
      cell.setPosition(-284 + index * 142, 0, 0);
      cell.addComponent(UITransform).setContentSize(134, 70);
      this.paintPanel(cell, 134, 70, INK.panel, INK.panel, 4);
      statBar.addChild(cell);
      this.createText(cell, 'StatName', EnumMapper.translateStat(key).name, 0, 21, 126, 24, 19, INK.sub, Label.HorizontalAlign.CENTER);
      const value = this.createText(cell, `Coin_${key}`, '—', 0, -14, 118, 40, 28, key === 'wealth' ? INK.gold : key === 'physique' ? INK.green : INK.text, Label.HorizontalAlign.CENTER);
      value.isBold = true;
      this.statCoinNodes.set(key, value.node);
    });
  }

  private buildCenterArea(root: Node): void {
    const centerNode = new Node('CenterScrollArea');
    centerNode.layer = Layers.Enum.UI_2D;
    centerNode.setPosition(0, (VIEW.footerHeight - VIEW.hudHeight) / 2, 0);
    centerNode.addComponent(UITransform).setContentSize(VIEW.width, this.contentHeight);
    root.addChild(centerNode);

    const scrollNode = new Node('EventScrollView');
    scrollNode.layer = Layers.Enum.UI_2D;
    scrollNode.setPosition(-VIEW.shelfWidth / 2, 0, 0);
    scrollNode.addComponent(UITransform).setContentSize(VIEW.logWidth, this.contentHeight);
    const viewport = new Node('Viewport');
    viewport.layer = Layers.Enum.UI_2D;
    viewport.addComponent(UITransform).setContentSize(VIEW.logWidth, this.contentHeight);
    viewport.addComponent(Mask);
    scrollNode.addChild(viewport);

    const content = new Node('Content');
    content.layer = Layers.Enum.UI_2D;
    const contentTransform = content.addComponent(UITransform);
    contentTransform.setAnchorPoint(0.5, 1);
    contentTransform.setContentSize(VIEW.logWidth, this.contentHeight);
    content.setPosition(0, this.contentHeight / 2, 0);
    viewport.addChild(content);
    const scroll = scrollNode.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.vertical = true;
    scroll.content = content;
    this.scrollView = scroll;
    this.logContentNode = content;
    centerNode.addChild(scrollNode);
    scrollNode.on('scrolling', () => {
      if (this.scrollView) UIAnimController.updateScrollWeathering(this.scrollView);
    });

    const relicNode = new Node('RightRelicBar');
    relicNode.layer = Layers.Enum.UI_2D;
    relicNode.setPosition(VIEW.logWidth / 2, 0, 0);
    relicNode.addComponent(UITransform).setContentSize(VIEW.shelfWidth, this.contentHeight);
    centerNode.addChild(relicNode);
    this.relicBar = relicNode.addComponent(RelicBarController);
    this.relicBar.setHeight(this.contentHeight);
  }

  private buildDecisionOverlay(root: Node): void {
    const overlayNode = new Node('DecisionOverlay');
    overlayNode.layer = Layers.Enum.UI_2D;
    overlayNode.setPosition(0, 0, 0);
    const trans = overlayNode.addComponent(UITransform);
    trans.setContentSize(VIEW.width, this.viewportHeight);

    // 半透明遮罩 (MaskBg)
    const maskBg = new Node('MaskBg');
    maskBg.layer = Layers.Enum.UI_2D;
    const mTrans = maskBg.addComponent(UITransform);
    mTrans.setContentSize(VIEW.width, this.viewportHeight);
    maskBg.addComponent(BlockInputEvents);
    this.paintPanel(maskBg, VIEW.width, this.viewportHeight, INK.scrim, INK.scrim, 0);
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
    barNode.setPosition(0, -(this.viewportHeight - VIEW.footerHeight) / 2, 0);
    barNode.addComponent(UITransform).setContentSize(VIEW.width, VIEW.footerHeight);
    this.paintPanel(barNode, VIEW.width, VIEW.footerHeight, INK.hud, INK.border, 0);
    root.addChild(barNode);

    const advance = new Node('SealAdvanceBtn');
    advance.layer = Layers.Enum.UI_2D;
    advance.setPosition(0, 34, 0);
    advance.addComponent(UITransform).setContentSize(702, 80);
    this.paintPanel(advance, 702, 80, INK.advance, INK.advanceBorder, 10);
    const label = this.createText(advance, 'BtnLabel', '等待选择随身家当', 0, 0, 654, 72, 27, INK.text, Label.HorizontalAlign.CENTER);
    label.isBold = true;
    this.bindSealEvents(advance);
    barNode.addChild(advance);
    this.sealAdvanceBtn = advance;

    const controls = new Node('SubBtnLayout');
    controls.layer = Layers.Enum.UI_2D;
    controls.setPosition(0, -40, 0);
    controls.addComponent(UITransform).setContentSize(702, 48);
    barNode.addChild(controls);
    this.createButton(controls, '重启人生', -267, 0, 168, 48, () => this.startNewLife());
    this.createButton(controls, '存档状态', -89, 0, 168, 48, () => this.showSaveTip());
    this.careerButton = this.createButton(controls, '管理事业', 89, 0, 168, 48, () => {
      if (this.currentView?.status === 'ENDED') this.showEndingSummary();
      else this.openCareerManager();
    });
    this.careerButton.getComponent(Button)!.interactable = false;
    this.createButton(controls, '滚至最新', 267, 0, 168, 48, () => {
      this.scrollView?.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
    });
  }
  private bindSealEvents(btnNode: Node): void {
    btnNode.on(Node.EventType.TOUCH_START, () => {
      this.holdBeganEnded = false;
      const status = this.currentView?.status;
      if (!this.currentView || status === 'AWAITING_CARD') {
        this.cancelSealHold();
        return;
      }
      this.holdBeganEnded = status === 'ENDED';
      this.holdTimer = 0;
      this.autoAdvanceInterval = 0;
      if (status === 'ENDED') {
        this.isSealHolding = false;
        return;
      }

      this.isSealHolding = true;
      btnNode.setScale(0.98, 0.98, 1);
      if (status === 'READY' || status === 'AWAITING_STAGE') {
        void this.onAdvance();
      }
    });
    btnNode.on(Node.EventType.TOUCH_END, () => {
      const beganEnded = this.holdBeganEnded;
      this.holdBeganEnded = false;
      this.cancelSealHold();
      if (!this.currentView || this.currentView.status === 'AWAITING_CARD') return;
      if (this.currentView.status === 'ENDED') {
        // 死于本次长按时保留终局；下一次明确点击才重启。
        if (beganEnded) this.startNewLife();
      }
    });
    btnNode.on(Node.EventType.TOUCH_CANCEL, () => {
      this.holdBeganEnded = false;
      this.cancelSealHold();
    });
  }

  private cancelSealHold(): void {
    this.isSealHolding = false;
    this.holdTimer = 0;
    this.autoAdvanceInterval = 0;
    const seal = this.sealAdvanceBtn;
    if (seal && isValid(seal, true)) seal.setScale(1, 1, 1);
  }

  private startNewLife(): void {
    this.cancelSealHold();
    this.holdBeganEnded = false;
    UIAnimController.stopAnimations(this.node, true);
    this.pixelFX?.stopTransient();
    this.advanceInFlight = null;
    this.prevStatValues.clear();
    this.terminalHandled = false;
    this.endingFXDelay = 0;
    this.endingReport = null;
    this.endingPanel?.destroy();
    this.endingPanel = null;
    this.currentView = null;
    this.cardSubmitting = false;
    this.stageInFlight = null;
    this.careerBusy = false;
    this.careerPanel?.destroy();
    this.careerPanel = null;
    this.selectedCardId = null;
    this.acquiredRelicId = null;
    this.relicBar?.reset();
    this.cardChoiceNode?.destroy();
    this.cardChoiceNode = null;
    this.cardErrorLabel = null;
    if (this.eraYearLabel) this.eraYearLabel.string = '正在启幕…';
    if (this.turnLabel) this.turnLabel.string = '等待开局';
    if (this.identityLabel) this.identityLabel.string = '身份、地区与阶层正在载入…';
    for (const node of this.statCoinNodes.values()) {
      const label = node.getComponent(Label);
      if (label) label.string = '—';
    }
    if (this.careerButton) {
      this.careerButton.getComponent(Button)!.interactable = false;
      this.styleButton(this.careerButton, INK.raised, INK.border, INK.sub);
      const title = this.careerButton.children.find(child => child.name === 'Title')?.getComponent(Label);
      if (title) title.string = '管理事业';
    }
    this.updateSealButtonState(false);
    if (this.decisionOverlay) this.decisionOverlay.active = false;
    if (this.logContentNode) {
      for (const child of [...this.logContentNode.children]) child.destroy();
      this.logContentNode.removeAllChildren();
      const trans = this.logContentNode.getComponent(UITransform);
      if (trans) trans.setContentSize(VIEW.logWidth, this.contentHeight);
      this.logContentNode.setPosition(0, this.contentHeight / 2, 0);
      this.scrollView?.stopAutoScroll();
    }
    this.renderedItemsCount = 0;

    const pkg = getNativeMingEndContent();
    const engine = new GameEngine(pkg.bundle, pkg.fingerprint);
    let saveSlot: unknown = null;
    const session = new GameSession(engine, {
      hash: sha256Json,
      persist: async (save) => { saveSlot = structuredClone(save); },
      load: async () => saveSlot as SessionSave | null,
    });

    this.session = session;
    session.initialize(Math.floor(Math.random() * 0x1_0000_0000)).then((initResult) => {
      if (this.session !== session) return;
      if (!initResult.ok) {
        this.appendSystemLog(`启动遇阻: ${initResult.error.message}`);
        return;
      }
      this.currentView = initResult.state;
      this.updateHUD(this.currentView);

      this.appendSystemLog(`【人生启幕】${initResult.state.player.calendar_year}年，${initResult.state.player.age}岁。先选定一件随身家当，再续流年。`);

      this.renderPending(initResult.pending);
    }).catch((e) => {
      if (this.session === session) this.appendSystemLog(`启动异常: ${String(e)}`);
    });
  }

  private onAdvance(): Promise<void> {
    if (this.advanceInFlight) return this.advanceInFlight;
    const run = this.advanceOnce();
    let tracked: Promise<void>;
    tracked = run.finally(() => {
      if (this.advanceInFlight === tracked) this.advanceInFlight = null;
    });
    this.advanceInFlight = tracked;
    return tracked;
  }

  private async advanceOnce(): Promise<void> {
    if (!this.session) return;
    const session = this.session;
    if (!this.currentView || this.currentView.status === 'AWAITING_CARD') {
      this.cancelSealHold();
      return;
    }
    if (this.currentView && this.currentView.status === 'ENDED') {
      this.cancelSealHold();
      this.appendSystemLog('【生平盖棺】尘埃落定，不可复进。请点击“重启人生”。');
      return;
    }
    // 如果当前有尚未完成的玩家选择，阻止盲目推进并弹出提示
    if (this.currentView && this.currentView.status === 'AWAITING_OPTION') {
      this.cancelSealHold();
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
      const res = await session.command({ type: 'next' });
      if (this.session !== session) return;
      if (!res.ok) {
        this.cancelSealHold();
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
        this.cancelSealHold();
        this.appendEndingHint();
      }

      if (this.scrollView) {
        this.scrollView.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
        UIAnimController.updateScrollWeathering(this.scrollView);
      }
    } catch (e) {
      if (this.session !== session) return;
      this.cancelSealHold();
      this.appendSystemLog(`推进异常: ${String(e)}`);
    }
  }

  private updateHUD(view: GameView): void {
    const player = view.player;
    const isEnded = view.status === 'ENDED';
    if (view.status === 'AWAITING_CARD' || view.status === 'AWAITING_OPTION' || view.status === 'ENDED') this.cancelSealHold();
    if (this.careerButton) {
      const canManage = (view.status === 'READY' || view.status === 'AWAITING_OPTION') && player.chains.some(chain => chain.status === 'active');
      this.careerButton.getComponent(Button)!.interactable = canManage || isEnded;
      const title = this.careerButton.children.find(child => child.name === 'Title')?.getComponent(Label);
      if (title) title.string = isEnded ? '生平结案' : '管理事业';
      this.styleButton(this.careerButton, INK.raised, canManage || isEnded ? INK.gold : INK.border, canManage || isEnded ? INK.gold : INK.sub);
    }
    if (this.eraYearLabel) {
      const reignYear = player.calendar_year - 1627;
      this.eraYearLabel.string = view.timeline === 'historical'
        ? `大明崇祯 ${reignYear} 年 · ${player.calendar_year}`
        : `架空推演 · ${player.calendar_year}`;
    }
    if (this.turnLabel) this.turnLabel.string = `${player.age} 岁 · 第 ${player.calendar_year - player.start_year + 1} 年`;
    if (this.identityLabel) {
      this.identityLabel.string = `身份: ${EnumMapper.translateIdentity(player.identity_id)}  |  地区: ${EnumMapper.translateRegion(player.region_id)}  |  阶层: ${EnumMapper.translateCaste(player.caste_id)}`;
    }

    for (const [key, value] of Object.entries(player.attributes)) {
      const coin = this.statCoinNodes.get(key);
      const previous = this.prevStatValues.get(key);
      const label = coin?.getComponent(Label);
      if (label) label.string = String(value);
      if (previous !== undefined && previous !== value) {
        if (coin && !this.reduceMotion()) {
          const defaultColor = key === 'wealth' ? INK.gold : key === 'physique' ? INK.green : INK.text;
          UIAnimController.playAttrPunch(coin, label, value - previous, defaultColor);
        }
        if (key === 'wealth' && value > previous) this.pixelFX?.play('gain');
      }
      // 首帧只记录，重启后不会把另一局的初始家资误报为增益。
      this.prevStatValues.set(key, value);
    }
    this.updateSealButtonState(isEnded);
  }


  private appendFoldCard(data: FoldItemData): void {
    if (!this.logContentNode) return;
    this.renderedItemsCount += 1;

    const itemNode = new Node(`FoldCard_${this.renderedItemsCount}`);
    itemNode.layer = Layers.Enum.UI_2D;
    itemNode.setPosition(0, 0, 0);
    const itemTrans = itemNode.addComponent(UITransform);
    itemTrans.setAnchorPoint(0.5, 0.5);
    itemTrans.setContentSize(VIEW.foldWidth, 80);
    this.logContentNode.addChild(itemNode);

    const comp = itemNode.addComponent(EventFoldItem);
    comp.init(data);

    this.updateLogContentLayout();
    if (data.type === 'card_selected' && data.cardId && this.relicBar) {
      const card = getNativeMingEndContent().bundle.cards.find(entry => entry.id === data.cardId);
      if (card) {
        this.acquiredRelicId = card.id;
        this.relicBar.addRelic({ id: card.id, name: card.name, desc: card.description, rarity: card.rarity }, this.cardChoiceNode ?? itemNode);
      }
    }

    if (this.acquiredRelicId && data.relicFlags?.length) {
      this.relicBar?.playFeedback(this.acquiredRelicId, data.relicFlags, data.feedbackKey);
    }
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
      contentTrans.setContentSize(VIEW.logWidth, Math.max(this.contentHeight, totalHeight + 20));
    }
  }

  private renderPending(pending: PendingDecision | null): void {
    this.careerPanel?.destroy();
    this.careerPanel = null;
    this.cardChoiceNode?.destroy();
    this.cardChoiceNode = null;
    this.cardErrorLabel = null;
    this.selectedCardId = null;
    if (this.memorialCardComp) this.memorialCardComp.node.active = pending?.kind === 'option';
    if (pending?.kind === 'card' && this.decisionOverlay) {
      this.cancelSealHold();
      this.decisionOverlay.active = true;
      this.renderCardChoices(pending.cards);
      return;
    }
    if (!pending) {
      if (this.decisionOverlay) this.decisionOverlay.active = false;
      return;
    }

    if (pending.kind === 'option' && this.memorialCardComp && this.decisionOverlay) {
      this.cancelSealHold();
      const bundle = getNativeMingEndContent().bundle;
      const event = bundle.events.find(item => item.id === pending.event_id);
      const details: Record<string, string[]> = {};
      if (event?.interaction === 'choice') {
        for (const option of event.options) {
          const lines: string[] = [];
          if (option.condition && (event.id.endsWith('BREAKTHROUGH') || event.id === 'E_MOD_GLUE_CRAFT_CHALLENGE')) {
            lines.push(`门槛：${EnumMapper.describeCondition(option.condition, bundle)}`);
          }
          for (const effect of option.outcome.effects) {
            if (effect.type === 'attribute_add' && effect.amount < 0) {
              lines.push(`立即付出：${EnumMapper.translateStat(effect.attribute).name} ${effect.amount}`);
            } else if (effect.type === 'chain_start') {
              const commitment = bundle.chains.find(chain => chain.id === effect.id)?.commitment;
              if (commitment) lines.push(`事业说明：${commitment}`);
            }
          }
          details[option.id] = lines;
        }
      }
      this.decisionOverlay.active = true;
      this.memorialCardComp.init(pending, (optId) => {
        void this.chooseOption(optId);
      }, event?.text, details, this.currentView?.player.chains.some(chain => chain.status === 'active') ? () => this.openCareerManager() : undefined);
      this.fitModal(this.memorialCardComp.node);
    } else {
      if (this.decisionOverlay) this.decisionOverlay.active = false;
      if (pending.kind === 'stage') {
        void this.chooseStage();
      }
    }
  }

  private renderCardChoices(ids: string[]): void {
    if (!this.decisionOverlay) return;
    const paper = new Node('CardChoice');
    paper.layer = Layers.Enum.UI_2D;
    paper.addComponent(UITransform).setContentSize(700, 960);
    this.paintPanel(paper, 700, 960, INK.panel, INK.borderLight, 12);
    this.decisionOverlay.addChild(paper);
    this.cardChoiceNode = paper;
    this.createText(paper, 'Title', '选一件随身家当', 0, 406, 620, 48, 32, INK.cyan).isBold = true;
    this.createText(paper, 'Instruction', `${ids.length} 选 1 · 确认后本局只携此件，不可重选`, 0, 350, 620, 48, 21, INK.sub);

    const cards = getNativeMingEndContent().bundle.cards;
    const rows: { node: Node; label: Label; name: string; id: string }[] = [];
    const confirm = this.createButton(paper, '确认家当 · 进入人生', 0, -390, 620, 76, () => {
      if (this.selectedCardId && !this.cardSubmitting) void this.selectCard(this.selectedCardId, confirm);
    });
    confirm.getComponent(Button)!.interactable = false;
    this.styleButton(confirm, INK.raised, INK.border, INK.sub);

    ids.forEach((id, index) => {
      const card = cards.find(item => item.id === id);
      const row = new Node(`CardOffer_${id}`);
      row.layer = Layers.Enum.UI_2D;
      row.setPosition(0, 222 - index * 172, 0);
      row.addComponent(UITransform).setContentSize(620, 156);
      this.paintPanel(row, 620, 156, INK.raised, INK.borderLight, 8);
      paper.addChild(row);
      const name = card?.name ?? id;
      const label = this.createText(row, 'Name', name, -42, 44, 472, 40, 25, INK.text);
      label.isBold = true;
      const rarity = new Node('RarityBadge');
      rarity.layer = Layers.Enum.UI_2D;
      rarity.setPosition(252, 44, 0);
      rarity.addComponent(UITransform).setContentSize(70, 34);
      const rarityColor = this.rarityColor(card?.rarity ?? '');
      this.paintPanel(rarity, 70, 34, INK.inset, rarityColor, 4);
      row.addChild(rarity);
      this.createText(rarity, 'Rarity', card?.rarity ?? '—', 0, 0, 64, 30, 20, rarityColor, Label.HorizontalAlign.CENTER).isBold = true;
      this.createText(row, 'Description', card?.description ?? '家当资料缺失，无法确认。', 0, -24, 564, 70, 22, INK.sub);
      rows.push({ node: row, label, name, id });
      row.on(Node.EventType.TOUCH_START, () => {
        if (!this.cardSubmitting && card) row.setScale(0.98, 0.98, 1);
      });
      row.on(Node.EventType.TOUCH_CANCEL, () => row.setScale(1, 1, 1));
      row.on(Node.EventType.TOUCH_END, () => {
        row.setScale(1, 1, 1);
        if (this.cardSubmitting || !card) return;
        this.selectedCardId = id;
        for (const item of rows) {
          const selected = item.id === id;
          item.label.string = `${selected ? '已选 · ' : ''}${item.name}`;
          item.label.color = selected ? INK.cyan : INK.text;
          this.paintPanel(item.node, 620, 156, selected ? INK.selected : INK.raised, selected ? INK.cyan : INK.borderLight, 8);
        }
        confirm.getComponent(Button)!.interactable = true;
        this.styleButton(confirm, INK.cyan, INK.cyan, INK.inset);
      });
    });
    this.cardErrorLabel = this.createText(paper, 'CardError', '', 0, -270, 620, 60, 20, INK.red);
    this.fitModal(paper);
  }

  private async selectCard(cardId: string, confirm: Node): Promise<void> {
    if (!this.session || this.cardSubmitting) return;
    const session = this.session;
    this.cardSubmitting = true;
    if (this.cardErrorLabel) this.cardErrorLabel.string = '正在确认家当…';
    confirm.getComponent(Button)!.interactable = false;
    this.styleButton(confirm, INK.raised, INK.border, INK.sub);
    try {
      const result = await session.command({ type: 'selectCard', cardId });
      if (this.session !== session) return;
      if (!result.ok) {
        if (this.cardErrorLabel) this.cardErrorLabel.string = `未能确认：${result.error.message}`;
        return;
      }
      this.currentView = result.state;
      if (this.currentView) this.updateHUD(this.currentView);
      for (const item of LogParser.parseBatch(this.extractRawLogs(result.logs))) this.appendFoldCard(item);
      this.renderPending(result.pending);
      if (result.state.status === 'ENDED') this.appendEndingHint();
      this.scrollView?.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
    } catch (error) {
      if (this.session === session && this.cardErrorLabel) this.cardErrorLabel.string = `未能确认：${String(error)}`;
    } finally {
      if (this.session === session) {
        this.cardSubmitting = false;
        if (this.currentView?.status === 'AWAITING_CARD' && confirm.isValid) {
          confirm.getComponent(Button)!.interactable = true;
          this.styleButton(confirm, INK.cyan, INK.cyan, INK.inset);
        }
      }
    }
  }

  private openCareerManager(): void {
    if (!this.session || !this.currentView || !this.decisionOverlay || this.careerBusy) return;
    if (this.currentView.status !== 'READY' && this.currentView.status !== 'AWAITING_OPTION') return;
    const active = this.currentView.player.chains.filter(chain => chain.status === 'active');
    if (active.length === 0) return;
    this.cancelSealHold();
    if (this.memorialCardComp) this.memorialCardComp.node.active = false;
    this.decisionOverlay.active = true;
    this.careerPanel?.destroy();

    const panel = new Node('CareerPanel');
    panel.layer = Layers.Enum.UI_2D;
    panel.addComponent(UITransform).setContentSize(700, 1000);
    this.paintPanel(panel, 700, 1000, INK.panel, INK.borderLight, 12);
    this.decisionOverlay.addChild(panel);
    this.careerPanel = panel;
    this.fitModal(panel);
    this.createText(panel, 'Title', '管理事业', 0, 440, 620, 50, 32, INK.gold).isBold = true;
    this.createText(panel, 'Explanation', `进行中 ${active.length} 项 · 选择一项后确认退出`, 0, 365, 620, 60, 23, INK.sub);

    const scrollNode = new Node('CareerScrollView');
    scrollNode.layer = Layers.Enum.UI_2D;
    scrollNode.setPosition(0, 65, 0);
    scrollNode.addComponent(UITransform).setContentSize(640, 420);
    panel.addChild(scrollNode);
    const viewport = new Node('Viewport');
    viewport.layer = Layers.Enum.UI_2D;
    viewport.addComponent(UITransform).setContentSize(640, 420);
    viewport.addComponent(Mask);
    scrollNode.addChild(viewport);
    const content = new Node('Content');
    content.layer = Layers.Enum.UI_2D;
    const transform = content.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 1);
    transform.setContentSize(640, Math.max(420, active.length * 112 + 12));
    content.setPosition(0, 210, 0);
    viewport.addChild(content);
    const scroll = scrollNode.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.vertical = true;
    scroll.content = content;

    let selected: string | null = null;
    const rows: { node: Node; selection: Label; id: string }[] = [];
    const notice = this.createText(panel, 'CareerNotice', '退出后已付成本不退，不获完成奖励；已得成长保留。', 0, -235, 620, 132, 23, INK.sub);
    const confirm = this.createButton(panel, '确认退出事业', 160, -405, 292, 80, () => {
      if (selected) void this.abandonCareer(selected, notice);
    });
    confirm.getComponent(Button)!.interactable = false;
    this.createButton(panel, '返回', -160, -405, 292, 80, () => {
      if (this.careerBusy) return;
      panel.destroy();
      this.careerPanel = null;
      const pending = this.currentView?.pending;
      if (this.memorialCardComp) this.memorialCardComp.node.active = pending?.kind === 'option';
      if (this.decisionOverlay) this.decisionOverlay.active = pending?.kind === 'option';
    });
    const bundle = getNativeMingEndContent().bundle;
    active.forEach((chain, index) => {
      const definition = bundle.chains.find(item => item.id === chain.chain_id);
      const name = definition?.name ?? chain.chain_id;
      const button = this.createButton(content, `选择：${name}`, 0, -58 - index * 112, 600, 96, () => {
        if (this.careerBusy) return;
        selected = chain.instance_id;
        notice.string = `拟退出：${name}。\n已付成本不退，不获完成奖励；已得成长保留。`;
        for (const row of rows) {
          const chosen = row.id === selected;
          row.selection.string = chosen ? '已选' : '选择';
          this.styleButton(row.node, chosen ? INK.selected : INK.raised, chosen ? INK.cyan : INK.border, INK.text);
        }
        confirm.getComponent(Button)!.interactable = true;
        this.styleButton(confirm, INK.ended, INK.red, INK.text);
      });
      const label = button.children.find(child => child.name === 'Title')?.getComponent(Label);
      if (label) {
        label.string = name;
        label.fontSize = 25;
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.node.setPosition(-38, 21, 0);
        label.node.getComponent(UITransform)!.setContentSize(480, 38);
      }
      this.createText(button, 'Progress', `节点 ${chain.node_index}/${definition?.nodes.length ?? '—'} · 下次 ${chain.next_due_year ?? '—'} 年`, -38, -22, 480, 30, 20, INK.sub);
      const selection = this.createText(button, 'Selection', '选择', 253, 0, 64, 38, 20, INK.cyan, Label.HorizontalAlign.CENTER);
      rows.push({ node: button, selection, id: chain.instance_id });
    });
  }

  private async abandonCareer(instanceId: string, notice: Label): Promise<void> {
    if (!this.session || this.careerBusy) return;
    const session = this.session;
    this.careerBusy = true;
    notice.string = '正在退出事业…';
    try {
      const result = await session.command({ type: 'abandon', chainInstanceId: instanceId });
      if (this.session !== session) return;
      if (!result.ok) {
        notice.string = `未能退出：${result.error.message}`;
        return;
      }
      this.currentView = result.state;
      this.updateHUD(result.state);
      for (const item of LogParser.parseBatch(this.extractRawLogs(result.logs))) this.appendFoldCard(item);
      if (result.state.status === 'ENDED') {
        this.appendEndingHint();
      }
      this.renderPending(result.pending);
      if (this.scrollView) this.scrollView.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
    } catch (error) {
      if (this.session === session) notice.string = `未能退出：${String(error)}`;
    } finally {
      if (this.session === session) this.careerBusy = false;
    }
  }

  private async chooseOption(optId: string): Promise<void> {
    if (!this.session) return;
    const session = this.session;
    try {
      const res = await session.command({ type: 'choose', optionId: optId });
      if (this.session !== session) return;
      if (!res.ok) {
        this.memorialCardComp?.showError(res.error.message);
        return;
      }

      this.currentView = res.state;
      if (this.currentView) this.updateHUD(this.currentView);
      for (const item of LogParser.parseBatch(this.extractRawLogs(res.logs))) this.appendFoldCard(item);
      if (this.currentView && this.currentView.status === 'ENDED') {
        this.cancelSealHold();
        this.appendEndingHint();
      }
      this.renderPending(res.pending);
      if (this.scrollView) this.scrollView.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
    } catch (error) {
      if (this.session === session) this.memorialCardComp?.showError(String(error));
    }
  }

  private chooseStage(): Promise<void> {
    if (this.stageInFlight) return this.stageInFlight;
    const session = this.session;
    if (!session) return Promise.resolve();
    const run = async (): Promise<void> => {
      for (;;) {
        const res = await session.command({ type: 'stage' });
        if (this.session !== session) return;
        if (!res.ok) {
          this.cancelSealHold();
          this.appendSystemLog(`自动检定遇阻: ${res.error.message}`);
          return;
        }
        this.currentView = res.state;
        this.updateHUD(res.state);
        for (const item of LogParser.parseBatch(this.extractRawLogs(res.logs))) this.appendFoldCard(item);
        if (res.state.status === 'ENDED') {
          this.cancelSealHold();
          this.appendEndingHint();
        }
        if (res.pending?.kind === 'stage') continue;
        this.renderPending(res.pending);
        if (this.scrollView) this.scrollView.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
        return;
      }
    };
    this.stageInFlight = run().catch(error => {
      if (this.session === session) {
        this.cancelSealHold();
        this.appendSystemLog(`自动检定异常: ${String(error)}`);
      }
    }).finally(() => {
      if (this.session === session) this.stageInFlight = null;
    });
    return this.stageInFlight;
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
      let message = l.message;
      if (l.type === 'achievement') {
        const achievement = getNativeMingEndContent().bundle.achievements.find(item => item.id === l.data.achievement_id);
        if (achievement) message = `【${achievement.name} · ${EnumMapper.achievementMeta(achievement)}】${achievement.text}`;
      }
      return {
        type: l.type,
        seq: l.seq,
        source_id: l.source_id,
        message,
        metadata,
      };
    });
  }

  private appendEndingHint(): void {
    if (!this.session || this.currentView?.status !== 'ENDED' || this.terminalHandled) return;
    const run = this.session.exportSave().engine.payload.run;
    if (!run.ending) return;
    this.terminalHandled = true;
    this.endingReport = run.ending;
    this.cancelSealHold();
    if (run.death !== null) {
      this.pixelFX?.play('death');
      if (!this.reduceMotion()) UIAnimController.playDeathShake(this.node);
    }
    // 当前引擎的寿终也产生真实 death；结案礼花在白烟结束后单次播放。
    if (run.death !== null) this.endingFXDelay = 1.7;
    else this.pixelFX?.play('ending');
    this.updateSealButtonState(true);
    this.appendSystemLog(`【生平结案】${run.ending.start_year}—${run.ending.end_year}，历经 ${run.ending.years_played} 年。点击“生平结案”查看真实生平与成就。`);
  }

  private showEndingSummary(): void {
    if (!this.session || !this.decisionOverlay || this.currentView?.status !== 'ENDED') return;
    const report = this.endingReport ?? this.session.exportSave().engine.payload.run.ending;
    if (!report) return;
    const bundle = getNativeMingEndContent().bundle;
    const natural = report.death_id === bundle.era.old_age_death_id;
    const death = bundle.deaths.find(item => item.id === report.death_id);
    const primary = bundle.achievements.find(item => item.id === report.primary_achievement_id);
    this.cancelSealHold();
    if (this.memorialCardComp) this.memorialCardComp.node.active = false;
    this.endingPanel?.destroy();
    const panel = new Node('EndingPanel');
    panel.layer = Layers.Enum.UI_2D;
    panel.addComponent(UITransform).setContentSize(700, 1000);
    this.paintPanel(panel, 700, 1000, INK.panel, natural ? INK.gold : INK.red, 12);
    this.decisionOverlay.addChild(panel);
    this.decisionOverlay.active = true;
    this.endingPanel = panel;
    this.fitModal(panel);

    this.createText(panel, 'EndingTitle', natural ? '寿终归档' : '生平盖棺', 0, 440, 620, 50, 34, natural ? INK.gold : INK.red, Label.HorizontalAlign.CENTER).isBold = true;
    this.createText(panel, 'LifeSpan', `${report.start_year}—${report.end_year} · ${report.start_age}—${report.end_age} 岁 · 历经 ${report.years_played} 年`, 0, 376, 620, 52, 23, INK.sub, Label.HorizontalAlign.CENTER);
    this.createText(panel, 'DeathReason', death ? `${death.name} · ${death.text}` : report.death_id, 0, 294, 620, 84, 24, INK.text, Label.HorizontalAlign.CENTER);

    const finalStats = new Node('FinalStats');
    finalStats.layer = Layers.Enum.UI_2D;
    finalStats.setPosition(0, 202, 0);
    finalStats.addComponent(UITransform).setContentSize(620, 80);
    this.paintPanel(finalStats, 620, 80, INK.inset, INK.inset, 6);
    panel.addChild(finalStats);
    ['physique', 'wealth', 'intelligence', 'prestige', 'luck'].forEach((key, index) => {
      const value = report.final_attributes[key as keyof typeof report.final_attributes];
      const x = -248 + index * 124;
      this.createText(finalStats, `Name_${key}`, EnumMapper.translateStat(key).name, x, 24, 116, 24, 19, INK.sub, Label.HorizontalAlign.CENTER);
      this.createText(finalStats, `Value_${key}`, String(value), x, -12, 116, 40, 28, key === 'wealth' ? INK.gold : key === 'physique' ? INK.green : INK.text, Label.HorizontalAlign.CENTER).isBold = true;
    });

    const lines = [
      '结案评语',
      primary ? `${primary.name} · ${EnumMapper.achievementMeta(primary)}\n${primary.text}` : '普通人生',
      '',
      `最高身份 · ${EnumMapper.translateIdentity(report.highest_identity_id)}`,
      `事业 · 完成 ${report.chains_completed.length} 项 / 中断 ${report.chains_interrupted.length} 项`,
      ...report.chains_completed.map(chain => `完成 · ${bundle.chains.find(item => item.id === chain.chain_id)?.name ?? chain.chain_id}`),
      ...report.chains_interrupted.map(chain => `中断 · ${bundle.chains.find(item => item.id === chain.chain_id)?.name ?? chain.chain_id}`),
      '',
      `所获成就 · ${report.achievements.length} 项`,
      ...report.achievements.map(id => {
        const achievement = bundle.achievements.find(item => item.id === id);
        return achievement ? `${achievement.name} · ${EnumMapper.achievementMeta(achievement)}\n${achievement.text}` : id;
      }),
      ...(report.achievements.length === 0 ? ['本局未获得成就。'] : []),
      '',
      '随身家当',
      ...this.currentView.player.cards.map(id => {
        const card = bundle.cards.find(item => item.id === id);
        return card ? `${card.name} · ${card.rarity}\n${card.description}` : id;
      }),
    ];
    const scrollNode = new Node('EndingScrollView');
    scrollNode.layer = Layers.Enum.UI_2D;
    scrollNode.setPosition(0, -88, 0);
    scrollNode.addComponent(UITransform).setContentSize(640, 420);
    panel.addChild(scrollNode);
    const viewport = new Node('Viewport');
    viewport.layer = Layers.Enum.UI_2D;
    viewport.addComponent(UITransform).setContentSize(640, 420);
    viewport.addComponent(Mask);
    scrollNode.addChild(viewport);
    const content = new Node('Content');
    content.layer = Layers.Enum.UI_2D;
    const transform = content.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 1);
    content.setPosition(0, 210, 0);
    viewport.addChild(content);
    const details = this.createText(content, 'ReportDetails', lines.join('\n'), 0, -16, 604, 40, 23, INK.sub);
    const detailsTransform = details.node.getComponent(UITransform)!;
    detailsTransform.setAnchorPoint(0.5, 1);
    details.verticalAlign = Label.VerticalAlign.TOP;
    details.overflow = Label.Overflow.RESIZE_HEIGHT;
    details.updateRenderData(true);
    transform.setContentSize(640, Math.max(420, detailsTransform.height + 32));
    const scroll = scrollNode.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.vertical = true;
    scroll.content = content;
    this.createText(panel, 'ReportHint', '上下滑动查看完整结案记录', 0, -334, 620, 32, 20, INK.sub, Label.HorizontalAlign.CENTER);
    this.createButton(panel, '返回历程', -160, -414, 292, 76, () => {
      panel.destroy();
      this.endingPanel = null;
      if (this.decisionOverlay) this.decisionOverlay.active = false;
    });
    const restart = this.createButton(panel, '重启人生', 160, -414, 292, 76, () => this.startNewLife());
    this.styleButton(restart, INK.cyan, INK.cyan, INK.inset);
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
    width: number,
    height: number,
    callback: () => void,
  ): Node {
    const node = new Node(`Btn_${title}`);
    node.layer = Layers.Enum.UI_2D;
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, height);
    this.paintPanel(node, width, height, INK.raised, INK.border, 6);
    this.createText(node, 'Title', title, 0, 0, width - 16, height - 8, height > 60 ? 25 : 20, INK.sub, Label.HorizontalAlign.CENTER);
    const button = node.addComponent(Button);
    button.transition = Button.Transition.NONE;
    node.on(Node.EventType.TOUCH_START, () => {
      if (button.interactable && !this.reduceMotion()) node.setScale(0.98, 0.98, 1);
    });
    node.on(Node.EventType.TOUCH_CANCEL, () => node.setScale(1, 1, 1));
    node.on(Node.EventType.TOUCH_END, () => {
      node.setScale(1, 1, 1);
      if (button.interactable) callback();
    });
    parent.addChild(node);
    return node;
  }

  private createText(
    parent: Node,
    name: string,
    value: string,
    x: number,
    y: number,
    width: number,
    height: number,
    size: number,
    color: Color = INK.text,
    align = Label.HorizontalAlign.LEFT,
  ): Label {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, height);
    const label = node.addComponent(Label);
    label.string = value;
    label.fontSize = size;
    label.lineHeight = Math.round(size * 1.4);
    label.color = color;
    label.horizontalAlign = align;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    parent.addChild(node);
    return label;
  }

  private paintPanel(node: Node, width: number, height: number, fill: Color, border: Color, radius: number): void {
    const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = fill;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    graphics.lineWidth = 1.5;
    graphics.strokeColor = border;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.stroke();
  }

  private styleButton(node: Node, fill: Color, border: Color, text: Color): void {
    const transform = node.getComponent(UITransform);
    if (transform) this.paintPanel(node, transform.width, transform.height, fill, border, 6);
    const label = node.children.find(child => child.name === 'Title')?.getComponent(Label);
    if (label) label.color = text;
  }

  private rarityColor(rarity: string): Color {
    if (rarity === 'SSR') return INK.gold;
    if (rarity === 'SR') return INK.purple;
    if (rarity === 'R') return INK.cyan;
    return INK.sub;
  }

  private reduceMotion(): boolean {
    const host = globalThis as typeof globalThis & { matchMedia?: (query: string) => { matches: boolean } };
    return host.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
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
    const label = this.sealAdvanceBtn.children.find(child => child.name === 'BtnLabel')?.getComponent(Label);
    const status = this.currentView?.status;
    if (isEnded) {
      const death = this.endingReport?.death_id;
      const natural = death === getNativeMingEndContent().bundle.era.old_age_death_id;
      const title = death ? (natural ? '寿终归档' : '生平盖棺') : '生平已结';
      if (label) label.string = `${title} · 重启人生`;
      this.paintPanel(this.sealAdvanceBtn, 702, 80, INK.ended, INK.red, 10);
    } else if (!status || status === 'AWAITING_CARD') {
      if (label) label.string = status ? '先选定一件随身家当' : '正在启幕…';
      this.paintPanel(this.sealAdvanceBtn, 702, 80, INK.raised, INK.border, 10);
    } else {
      if (label) label.string = status === 'AWAITING_OPTION' ? '抉择待定 · 先作选择' : status === 'AWAITING_STAGE' ? '检定进行中…' : '推进流年 · 长按快进';
      this.paintPanel(this.sealAdvanceBtn, 702, 80, INK.advance, INK.advanceBorder, 10);
    }
    if (label) label.color = !status || status === 'AWAITING_CARD' ? INK.sub : INK.text;
  }
}
