import {
  _decorator,
  Component,
  Node,
  Label,
  ScrollView,
  Color,
  UITransform,
  Button,
  UIOpacity,
  EventTouch,
  Sprite,
  Vec3,
  Layers,
  Mask,
  Graphics,
  BlockInputEvents,
  view,
  screen,
  ResolutionPolicy,
  isValid,
  sys,
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
import { PixelFXController } from './PixelFXController';
import { RelicBarController, type RelicItemData } from './RelicBarController';
import { OpeningFlow } from './OpeningFlow';
import { LifetimeRecords } from './LifetimeRecords';
import { createArt, setArt } from './ArtAssets';
import { GameAudio } from './GameAudio';

const { ccclass } = _decorator;

const VIEW = {
  width: 750,
  height: 1334,
  hudHeight: 234,
  bodyHeight: 950,
  footerHeight: 150,
  shelfWidth: 120,
  logWidth: 630,
  foldWidth: 594,
};
const HOLD_DELAY = 0.35;
const HOLD_INTERVAL = 0.22;
const SOUND_ACCESS_STYLE = 'position:fixed;left:0;top:0;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;';
const SOUND_HELP = '上下滑动查看更多，拖动或使用加减按钮调音。\n键盘可用 Tab 切换、方向键调节、Esc 返回。';
let lifetimeSequence = 0;

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

function chineseYearNumber(value: number): string {
  if (!Number.isFinite(value) || value < 1 || value > 99) return String(value);
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value < 10) return digits[value]!;
  if (value === 10) return '十';
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${tens === 1 ? '' : digits[tens]}十${ones ? digits[ones] : ''}`;
}

function ganzhiYear(year: number): string {
  const index = ((year - 4) % 60 + 60) % 60;
  return `${STEMS[index % 10]}${BRANCHES[index % 12]}`;
}

function formatWealth(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type RegionScene = 'shanbei' | 'capital' | 'jiangnan';
type AudioChannel = 'music' | 'effects' | 'ambience';
type AudioVolumes = Record<AudioChannel, number>;
const REGION_SCENES: Readonly<Record<string, RegionScene>> = {
  R_SHANBEI: 'shanbei',
  R_CAPITAL: 'capital',
  R_JIANGNAN: 'jiangnan',
};
const AUDIO_CHANNELS: readonly AudioChannel[] = ['music', 'effects', 'ambience'];
const AUDIO_LABELS: Readonly<Record<AudioChannel, string>> = {
  music: '音乐', effects: '音效', ambience: '环境声',
};
interface RegionArtwork {
  image: Node;
  opacity: UIOpacity;
}
interface AudioSettingRow {
  node: Node;
  track: Node;
  value: Label;
  mute: Node;
}

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
  muted: new Color(94, 102, 119, 255),
  coin: new Color(24, 28, 38, 255),
  cyan: new Color(0, 240, 255, 255),
  gold: new Color(255, 190, 11, 255),
  green: new Color(5, 223, 183, 255),
  red: new Color(255, 42, 95, 255),
  purple: new Color(199, 125, 255, 255),
  selected: new Color(18, 40, 50, 255),
  advance: new Color(25, 79, 59, 255),
  advanceBorder: new Color(74, 222, 128, 255),
  ended: new Color(87, 19, 31, 255),
  scrim: new Color(9, 10, 14, 217),
};

/**
 * GameMain: 真实 GameSession 驱动的暗色竖屏主界面。
 * 固定宽度 750：HUD 220、底部控制 244，日志和博古架随可视高度伸缩。
 * 家当仅从开局三选一取得；终局与像素反馈均读取真实状态。
 */
@ccclass('GameMain')
export class GameMain extends Component {
  private session: GameSession | null = null;
  private currentView: GameView | null = null;
  private viewportHeight = VIEW.height;
  private contentHeight = VIEW.bodyHeight;
  private openingFlow: OpeningFlow | null = null;
  private lifetimeRecords: LifetimeRecords | null = null;
  private lifetimeId = '';
  private audio: GameAudio | null = null;
  private audioTrack: 'home' | 'life' | 'ending' | null = null;
  private audioRegion: RegionScene | null | undefined;
  private lastSoundSeq = -1;
  private readonly soundedEvents = new Set<string>();
  private wealthGainPending = false;
  private regionScene: RegionScene | null = null;
  private regionBackdrop: Node | null = null;
  private regionArtwork: RegionArtwork | null = null;
  private pendingRegionArtwork: RegionArtwork | null = null;
  private outgoingRegionArtwork: RegionArtwork | null = null;
  private regionFadeElapsed = -1;
  private endingEntranceElapsed = -1;
  private soundOverlay: Node | null = null;
  private soundPanel: Node | null = null;
  private soundMuteAll: Node | null = null;
  private readonly soundRows = new Map<AudioChannel, AudioSettingRow>();
  private readonly lastAudibleVolumes = new Map<AudioChannel, number>();
  private mutedVolumes: AudioVolumes | null = null;
  private soundAccessibility: HTMLElement | null = null;
  private soundFocusBefore: HTMLElement | null = null;
  private readonly soundInputs = new Map<AudioChannel, HTMLInputElement>();
  private readonly soundMuteInputs = new Map<AudioChannel, HTMLButtonElement>();
  private soundMasterInput: HTMLButtonElement | null = null;
  private soundFocusNode: Node | null = null;
  private readonly soundTouchPoint = new Vec3();
  private soundLauncher: HTMLButtonElement | null = null;
  private motionPreference: { readonly matches: boolean } | null | undefined;

  // 节点引用
  private eraYearLabel: Label | null = null;
  private turnLabel: Label | null = null;
  private identityLabel: Label | null = null;
  private regionLabel: Label | null = null;
  private casteLabel: Label | null = null;
  private identityPlaqueNode: Node | null = null;
  private statCoinNodes: Map<string, Node> = new Map();
  private prevStatValues: Map<string, number> = new Map();

  private pixelFX: PixelFXController | null = null;
  private relicBar: RelicBarController | null = null;
  private endingPanel: Node | null = null;
  private endingReport: EndingReport | null = null;
  private terminalHandled = false;
  private logContentNode: Node | null = null;
  private scrollView: ScrollView | null = null;

  // 抉择与遮罩
  private decisionOverlay: Node | null = null;
  private memorialCardComp: MemorialCard | null = null;
  private cardSubmitting = false;
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
  private narrativeYears: Node[][] = [];

  onLoad(): void {
    this.viewportHeight = view.getVisibleSize().height;
    this.contentHeight = this.viewportHeight - VIEW.hudHeight - VIEW.footerHeight;
    this.buildBaseView();
    // Audio owns gesture unlock, app hide/show and source disposal before any opening controls exist.
    this.audio = this.node.getComponent(GameAudio) || this.node.addComponent(GameAudio);
    this.setAudioScene('home', null);
    screen.on('window-resize', this.resizeLayout, this);
    this.lifetimeRecords = new LifetimeRecords({
      getItem: key => sys.localStorage.getItem(key),
      setItem: (key, value) => sys.localStorage.setItem(key, value),
    });
    const opening = new Node('OpeningFlow');
    this.node.addChild(opening);
    this.openingFlow = opening.addComponent(OpeningFlow);
    this.openingFlow.init({
      onStart: () => this.startNewLife(),
      onEnter: cardId => this.selectCard(cardId),
      onAchievements: () => this.showLifetimeRecords(true),
      onStats: () => this.showLifetimeRecords(false),
      onSoundSettings: () => this.showSoundSettings(),
    });
    this.openingFlow.resize(this.viewportHeight);
    this.openingFlow.showHome();
    this.buildSoundSettings();
    this.mountSoundLauncher();
  }

  onEnable(): void {
    this.resizeLayout();
    if (this.soundOverlay) this.mountSoundLauncher();
  }

  onDisable(): void {
    this.cancelSealHold();
    this.holdBeganEnded = false;
    this.finishRegionFade();
    this.finishEndingEntrance();
    this.closeSoundSettings();
    this.soundLauncher?.remove();
    this.soundLauncher = null;
    UIAnimController.stopAnimations(this.node, true);
    this.pixelFX?.stopTransient();
  }

  onDestroy(): void {
    screen.off('window-resize', this.resizeLayout, this);
    this.onDisable();
    this.session = null;
    this.clearRegionArtwork();
    this.audio = null;
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
    this.resizeRegionArtwork();
    this.node.getChildByName('TopHUD')?.setPosition(0, (height - VIEW.hudHeight) / 2, 0);
    this.node.getChildByName('BottomControlBar')?.setPosition(0, -(height - VIEW.footerHeight) / 2, 0);
    const center = this.node.getChildByName('CenterScrollArea');
    center?.getComponent(UITransform)?.setContentSize(VIEW.width, this.contentHeight);
    if (this.scrollView && this.logContentNode) {
      const offset = this.scrollView.getScrollOffset();
      this.scrollView.stopAutoScroll();
      const logHeight = this.logViewportHeight();
      this.scrollView.node.setPosition(-VIEW.shelfWidth / 2, 0, 0);
      this.scrollView.node.getComponent(UITransform)!.setContentSize(VIEW.logWidth, logHeight);
      this.logContentNode.parent!.getComponent(UITransform)!.setContentSize(VIEW.logWidth, logHeight);
      this.logContentNode.setPosition(0, logHeight / 2, 0);
      this.updateLogContentLayout();
      this.scrollView.scrollToOffset(offset, 0);
    }
    this.relicBar?.setHeight(this.contentHeight);
    this.pixelFX?.setViewportHeight(height);
    this.openingFlow?.resize(height);
    if (this.soundOverlay) {
      this.soundOverlay.getComponent(UITransform)!.setContentSize(VIEW.width, height);
      const mask = this.soundOverlay.getChildByName('SoundMask')!;
      mask.getComponent(UITransform)!.setContentSize(VIEW.width, height);
      this.paintPanel(mask, VIEW.width, height, INK.scrim, INK.scrim, 0);
      this.layoutSoundSettings();
    }
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
    this.updatePresentationMotion(dt);
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

  private regionImageHeight(): number {
    // The production game uses the same uninterrupted history stream as the
    // phone viewport in output/pixelfx/preview.html; region art stays off this layer.
    return 0;
  }

  private logViewportHeight(): number {
    return Math.max(1, this.contentHeight);
  }

  private setAudioScene(track: 'home' | 'life' | 'ending', region: RegionScene | null): void {
    if (this.audioTrack !== track) {
      this.audioTrack = track;
      this.audio?.playMusic(track);
    }
    if (this.audioRegion !== region) {
      this.audioRegion = region;
      this.audio?.playAmbience(region);
    }
  }

  private updateRegionArtwork(regionId: string): void {
    const scene = REGION_SCENES[regionId] ?? null;
    if (scene === this.regionScene) return;
    this.finishRegionFade();
    if (this.pendingRegionArtwork) this.destroyRegionArtwork(this.pendingRegionArtwork);
    this.pendingRegionArtwork = null;
    if (!scene) {
      // Unknown regions remain unillustrated; never substitute another real place.
      this.clearRegionArtwork();
      return;
    }
    this.regionScene = scene;
    if (!this.regionBackdrop) return;
    const path = `scenes/${scene}`;
    const image = createArt(this.regionBackdrop, `RegionScene_${scene}`, path, VIEW.width, this.regionImageHeight());
    const art: RegionArtwork = {
      image,
      opacity: image.getComponent(UIOpacity) || image.addComponent(UIOpacity),
    };
    art.opacity.opacity = 0;
    this.pendingRegionArtwork = art;
    const ready = (node: Node, loadedPath: string): void => {
      if (loadedPath !== path || this.pendingRegionArtwork !== art || !isValid(this.node, true)) return;
      this.coverArt(node, VIEW.width, this.regionImageHeight());
      this.outgoingRegionArtwork = this.regionArtwork;
      this.regionArtwork = art;
      this.pendingRegionArtwork = null;
      this.regionFadeElapsed = 0;
      if (this.reduceMotion() || !this.enabled || !this.node.activeInHierarchy) this.finishRegionFade();
    };
    const failed = (failedPath: string): void => {
      if (failedPath !== path || this.pendingRegionArtwork !== art) return;
      this.destroyRegionArtwork(art);
      this.pendingRegionArtwork = null;
      if (this.regionArtwork) this.destroyRegionArtwork(this.regionArtwork);
      this.regionArtwork = null;
    };
    image.on('art-ready', (loadedPath: string) => ready(image, loadedPath));
    image.on('art-error', failed);
  }

  private coverArt(node: Node, width: number, height: number): void {
    const size = node.getComponent(Sprite)?.spriteFrame?.originalSize;
    if (!size?.width || !size.height) return;
    const scale = Math.max(width / size.width, height / size.height);
    node.getComponent(UITransform)?.setContentSize(size.width * scale, size.height * scale);
  }

  private resizeRegionArtwork(): void {
    const imageHeight = this.regionImageHeight();
    this.regionBackdrop?.getComponent(UITransform)?.setContentSize(VIEW.width, imageHeight);
    this.regionBackdrop?.setPosition(0, (VIEW.footerHeight - VIEW.hudHeight) / 2 - this.contentHeight / 2 + imageHeight / 2, 0);
    for (const art of [this.regionArtwork, this.pendingRegionArtwork, this.outgoingRegionArtwork]) {
      if (art && isValid(art.image, true)) this.coverArt(art.image, VIEW.width, imageHeight);
    }
  }

  private destroyRegionArtwork(art: RegionArtwork): void {
    if (!isValid(art.image, true)) return;
    UIAnimController.stopAnimations(art.image, true);
    art.image.removeFromParent();
    art.image.destroy();
  }

  private clearRegionArtwork(): void {
    for (const art of [this.regionArtwork, this.pendingRegionArtwork, this.outgoingRegionArtwork]) {
      if (art) this.destroyRegionArtwork(art);
    }
    this.regionArtwork = null;
    this.pendingRegionArtwork = null;
    this.outgoingRegionArtwork = null;
    this.regionScene = null;
    this.regionFadeElapsed = -1;
  }

  private finishRegionFade(): void {
    if (this.regionArtwork) this.regionArtwork.opacity.opacity = 255;
    if (this.outgoingRegionArtwork) this.destroyRegionArtwork(this.outgoingRegionArtwork);
    this.outgoingRegionArtwork = null;
    this.regionFadeElapsed = -1;
  }

  private finishEndingEntrance(): void {
    if (this.endingPanel && isValid(this.endingPanel, true)) {
      this.endingPanel.setPosition(0, 0, 0);
      const opacity = this.endingPanel.getComponent(UIOpacity);
      if (opacity) opacity.opacity = 255;
    }
    this.endingEntranceElapsed = -1;
  }

  private updatePresentationMotion(dt: number): void {
    if (this.regionFadeElapsed >= 0 && this.regionArtwork) {
      this.regionFadeElapsed += dt;
      const t = this.reduceMotion() ? 1 : Math.min(1, this.regionFadeElapsed / 0.25);
      this.regionArtwork.opacity.opacity = Math.round(255 * t);
      if (this.outgoingRegionArtwork) {
        this.outgoingRegionArtwork.opacity.opacity = Math.round(255 * (1 - t));
      }
      if (t === 1) this.finishRegionFade();
    }
    if (this.endingEntranceElapsed >= 0 && this.endingPanel && isValid(this.endingPanel, true)) {
      this.endingEntranceElapsed += dt;
      const t = this.reduceMotion() ? 1 : Math.min(1, this.endingEntranceElapsed / 0.22);
      const eased = 1 - Math.pow(1 - t, 3);
      this.endingPanel.setPosition(0, -12 * (1 - eased), 0);
      this.endingPanel.getComponent(UIOpacity)!.opacity = Math.round(255 * eased);
      if (t === 1) this.finishEndingEntrance();
    }
  }

  private buildTopHUD(root: Node): void {
    const hudNode = new Node('TopHUD');
    hudNode.layer = Layers.Enum.UI_2D;
    hudNode.setPosition(0, (this.viewportHeight - VIEW.hudHeight) / 2, 0);
    hudNode.addComponent(UITransform).setContentSize(VIEW.width, VIEW.hudHeight);
    this.paintPanel(hudNode, VIEW.width, VIEW.hudHeight, INK.hud, INK.border, 0);
    root.addChild(hudNode);

    this.eraYearLabel = this.createText(hudNode, 'EraAndAgeLabel', '正在开局…', -103, 72, 496, 44, 28, INK.gold);
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
    this.identityLabel = this.createText(this.identityPlaqueNode, 'IdentityLabel', '身份: 正在读取…', -228, 0, 196, 42, 19, INK.text);
    this.regionLabel = this.createText(this.identityPlaqueNode, 'RegionLabel', '地区: —', 8, 0, 286, 42, 19, INK.sub, Label.HorizontalAlign.CENTER);
    this.casteLabel = this.createText(this.identityPlaqueNode, 'CasteLabel', '阶层: —', 254, 0, 158, 42, 19, INK.sub, Label.HorizontalAlign.CENTER);

    const statBar = new Node('StatsCoinBar');
    statBar.layer = Layers.Enum.UI_2D;
    statBar.setPosition(0, -68, 0);
    statBar.addComponent(UITransform).setContentSize(VIEW.width, 94);
    this.paintPanel(statBar, VIEW.width, 84, INK.inset, INK.border, 0);
    hudNode.addChild(statBar);

    const stats = ['physique', 'wealth', 'intelligence', 'prestige', 'luck'];
    stats.forEach((key, index) => {
      const cell = new Node(`StatCell_${key}`);
      cell.layer = Layers.Enum.UI_2D;
      cell.setPosition(-284 + index * 142, 0, 0);
      cell.addComponent(UITransform).setContentSize(134, 80);
      this.paintPanel(cell, 134, 80, INK.coin, INK.coin, 3);
      statBar.addChild(cell);
      const shortNames: Record<string, string> = {
        physique: '体魄 (体)', wealth: '家资 (财)', intelligence: '才干 (智)', prestige: '人脉 (脉)', luck: '气数 (运)',
      };
      this.createText(cell, 'StatName', shortNames[key] ?? EnumMapper.translateStat(key).name,
        0, 19, 128, 24, 18, INK.muted, Label.HorizontalAlign.CENTER);
      const value = this.createText(cell, `Coin_${key}`, '—', 0, -19, 122, 40, 24,
        key === 'wealth' ? INK.gold : key === 'physique' ? INK.green : INK.text, Label.HorizontalAlign.CENTER);
      value.isBold = true;
      this.statCoinNodes.set(key, value.node);
    });
  }

  private buildCenterArea(root: Node): void {
    const imageHeight = this.regionImageHeight();
    const logHeight = this.logViewportHeight();
    const centerNode = new Node('CenterScrollArea');
    centerNode.layer = Layers.Enum.UI_2D;
    centerNode.setPosition(0, (VIEW.footerHeight - VIEW.hudHeight) / 2, 0);
    centerNode.addComponent(UITransform).setContentSize(VIEW.width, this.contentHeight);
    root.addChild(centerNode);

    const scrollNode = new Node('EventScrollView');
    scrollNode.layer = Layers.Enum.UI_2D;
    scrollNode.setPosition(-VIEW.shelfWidth / 2, 0, 0);
    scrollNode.addComponent(UITransform).setContentSize(VIEW.logWidth, logHeight);
    const viewport = new Node('Viewport');
    viewport.layer = Layers.Enum.UI_2D;
    viewport.addComponent(UITransform).setContentSize(VIEW.logWidth, logHeight);
    viewport.addComponent(Mask);
    scrollNode.addChild(viewport);

    const content = new Node('Content');
    content.layer = Layers.Enum.UI_2D;
    const contentTransform = content.addComponent(UITransform);
    contentTransform.setAnchorPoint(0.5, 1);
    contentTransform.setContentSize(VIEW.logWidth, logHeight);
    content.setPosition(0, logHeight / 2, 0);
    viewport.addChild(content);
    const scroll = scrollNode.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.vertical = true;
    scroll.content = content;
    this.scrollView = scroll;
    this.logContentNode = content;
    centerNode.addChild(scrollNode);

    const shelf = new Node('RelicShelf');
    shelf.layer = Layers.Enum.UI_2D;
    shelf.setPosition(VIEW.width / 2 - VIEW.shelfWidth / 2, 0, 0);
    shelf.addComponent(UITransform).setContentSize(VIEW.shelfWidth, this.contentHeight);
    centerNode.addChild(shelf);
    this.relicBar = shelf.addComponent(RelicBarController);
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
    this.paintPanel(barNode, VIEW.width, VIEW.footerHeight, INK.background, INK.background, 0);
    root.addChild(barNode);

    const advance = new Node('SealAdvanceBtn');
    advance.layer = Layers.Enum.UI_2D;
    advance.setPosition(0, 32, 0);
    advance.addComponent(UITransform).setContentSize(702, 86);
    this.paintPanel(advance, 702, 86, new Color(31, 96, 72, 255), INK.advanceBorder, 10);
    this.createText(advance, 'SealMark', '印', -306, 0, 42, 60, 30, INK.text, Label.HorizontalAlign.CENTER).isBold = true;
    const label = this.createText(advance, 'BtnLabel', '推进流年 · 长按快进', 20, 0, 570, 78, 26, INK.text, Label.HorizontalAlign.CENTER);
    label.isBold = true;
    this.bindSealEvents(advance);
    barNode.addChild(advance);
    this.sealAdvanceBtn = advance;

    const controls = new Node('SubBtnLayout');
    controls.layer = Layers.Enum.UI_2D;
    controls.setPosition(0, -49, 0);
    controls.addComponent(UITransform).setContentSize(702, 48);
    barNode.addChild(controls);
    this.careerButton = this.createButton(controls, '事业', -238, 0, 226, 48, () => this.openCareerManager());
    this.careerButton.getChildByName('Title')!.getComponent(Label)!.string = '管理事业 (0)';
    this.styleButton(this.careerButton, new Color(30, 35, 48, 255), INK.border, INK.sub);
    this.careerButton.getComponent(Button)!.interactable = false;
    const restart = this.createButton(controls, '重启人生', 0, 0, 226, 48, () => this.startNewLife());
    this.styleButton(restart, new Color(30, 35, 48, 255), INK.border, INK.sub);
    const latest = this.createButton(controls, '滚至最新', 238, 0, 226, 48, () => {
      this.scrollView?.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
    });
    this.styleButton(latest, new Color(30, 35, 48, 255), INK.border, INK.sub);
  }
  private bindSealEvents(btnNode: Node): void {
    btnNode.on(Node.EventType.TOUCH_START, () => {
      this.holdBeganEnded = false;
      if (this.soundOverlay?.active) return;
      this.audio?.playCue('tap');
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
      if (!this.reduceMotion()) btnNode.setScale(0.98, 0.98, 1);
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
    this.closeSoundSettings();
    this.finishEndingEntrance();
    this.clearRegionArtwork();
    this.setAudioScene('home', null);
    this.lastSoundSeq = -1;
    this.soundedEvents.clear();
    this.wealthGainPending = false;
    UIAnimController.stopAnimations(this.node, true);
    this.pixelFX?.stopTransient();
    this.advanceInFlight = null;
    this.prevStatValues.clear();
    this.terminalHandled = false;
    this.endingEntranceElapsed = -1;
    this.endingReport = null;
    this.endingPanel?.destroy();
    this.endingPanel = null;
    this.currentView = null;
    this.cardSubmitting = false;
    this.stageInFlight = null;
    this.careerBusy = false;
    this.careerPanel?.destroy();
    this.careerPanel = null;
    if (this.eraYearLabel) this.eraYearLabel.string = '正在开局…';
    if (this.turnLabel) this.turnLabel.string = '等待开局';
    if (this.identityLabel) this.identityLabel.string = '正在读取身份信息…';
    if (this.regionLabel) this.regionLabel.string = '地区: —';
    if (this.casteLabel) this.casteLabel.string = '阶层: —';
    this.relicBar?.reset();
    for (const node of this.statCoinNodes.values()) {
      const label = node.getComponent(Label);
      if (label) label.string = '—';
    }
    if (this.careerButton) {
      this.careerButton.getComponent(Button)!.interactable = false;
      this.styleButton(this.careerButton, new Color(30, 35, 48, 255), INK.border, INK.sub);
      const title = this.careerButton.children.find(child => child.name === 'Title')?.getComponent(Label);
      if (title) title.string = '管理事业 (0)';
    }
    this.updateSealButtonState(false);
    if (this.decisionOverlay) this.decisionOverlay.active = false;
    if (this.logContentNode) {
      EventFoldItem.resetAchievementFeedback(this.logContentNode);
      for (const child of [...this.logContentNode.children]) child.destroy();
      this.logContentNode.removeAllChildren();
      const trans = this.logContentNode.getComponent(UITransform);
      const logHeight = this.logViewportHeight();
      if (trans) trans.setContentSize(VIEW.logWidth, logHeight);
      this.logContentNode.setPosition(0, logHeight / 2, 0);
      this.scrollView?.stopAutoScroll();
    }
    this.renderedItemsCount = 0;
    this.narrativeYears = [];

    const pkg = getNativeMingEndContent();
    const engine = new GameEngine(pkg.bundle, pkg.fingerprint);
    let saveSlot: unknown = null;
    const session = new GameSession(engine, {
      hash: sha256Json,
      persist: async (save) => { saveSlot = structuredClone(save); },
      load: async () => saveSlot as SessionSave | null,
    });

    this.session = session;
    this.lifetimeId = `${Date.now()}:${++lifetimeSequence}:${Math.random().toString(36).slice(2)}`;
    session.initialize(Math.floor(Math.random() * 0x1_0000_0000)).then((initResult) => {
      if (this.session !== session) return;
      if (!initResult.ok) {
        this.audio?.playCue('error');
        this.openingFlow?.showError(`未能开局：${EnumMapper.playerError(initResult.error)}`);
        return;
      }
      this.currentView = initResult.state;
      this.updateHUD(this.currentView);

      if (initResult.pending?.kind !== 'card') throw new Error('开局物品未能载入，请重试。');
      const cards = initResult.pending.cards.map(id => pkg.bundle.cards.find(card => card.id === id)!);
      this.openingFlow?.setCards(cards);
      this.openingFlow?.showIdentity(initResult.state.player);
    }).catch((e) => {
      if (this.session === session) {
        this.audio?.playCue('error');
        this.openingFlow?.showError(`未能开局：${EnumMapper.playerError(e)}`);
      }
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
      this.appendSystemLog('本局已经结束。想再来一次，请点击“重启人生”。');
      return;
    }
    // 如果当前有尚未完成的玩家选择，阻止盲目推进并弹出提示
    if (this.currentView && this.currentView.status === 'AWAITING_OPTION') {
      this.cancelSealHold();
      if (this.decisionOverlay) this.decisionOverlay.active = true;
      this.appendSystemLog('请先完成当前选择，再继续往下走。');
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
        this.audio?.playCue('error');
        this.appendSystemLog(`未能继续：${EnumMapper.playerError(res.error)}`);
        return;
      }

      this.currentView = res.state;
      if (this.currentView) {
        this.updateHUD(this.currentView);
      }

      // Keep the narrative surface focused on the three most recent in-game years.
      // Each successful `next` command is one year of play and may emit several cards.
      const yearCards: Node[] = [];
      this.narrativeYears.push(yearCards);
      while (this.narrativeYears.length > 3) {
        const expired = this.narrativeYears.shift() ?? [];
        for (const node of expired) node.destroy();
      }

      // 聚合解析引擎日志并追加折页卡片
      if (res.logs && res.logs.length > 0) {
        const foldItems = LogParser.parseBatch(this.extractRawLogs(res.logs));
        for (const item of foldItems) {
          this.appendFoldCard(item, yearCards);
        }
      }
      // 刷新待处理决断
      this.renderPending(res.pending);

      if (this.currentView && this.currentView.status === 'ENDED') {
        this.cancelSealHold();
        this.appendEndingHint();
      }

      this.scrollView?.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
    } catch (e) {
      if (this.session !== session) return;
      this.cancelSealHold();
      this.audio?.playCue('error');
      this.appendSystemLog(`未能继续：${EnumMapper.playerError(e)}`);
    }
  }

  private updateHUD(view: GameView): void {
    const player = view.player;
    const isEnded = view.status === 'ENDED';
    this.updateRegionArtwork(player.region_id);
    if (!isEnded && view.status !== 'AWAITING_CARD') this.setAudioScene('life', REGION_SCENES[player.region_id] ?? null);
    if (view.status === 'AWAITING_CARD' || view.status === 'AWAITING_OPTION' || view.status === 'ENDED') this.cancelSealHold();
    if (this.careerButton) {
      const canOpenCareer = view.status !== 'AWAITING_CARD';
      this.careerButton.getComponent(Button)!.interactable = canOpenCareer;
      const title = this.careerButton.children.find(child => child.name === 'Title')?.getComponent(Label);
      if (title) title.string = `管理事业 (${view.player.chains.filter(chain => chain.status === 'active').length})`;
      this.styleButton(this.careerButton, new Color(30, 35, 48, 255), canOpenCareer ? INK.gold : INK.border, canOpenCareer ? INK.gold : INK.sub);
    }
    if (this.eraYearLabel) {
      const reignYear = player.calendar_year - 1627;
      this.eraYearLabel.string = view.timeline === 'historical'
        ? `崇祯${chineseYearNumber(reignYear)}年 · 岁次${ganzhiYear(player.calendar_year)}`
        : `架空人生 · ${player.calendar_year}`;
    }
    if (this.turnLabel) this.turnLabel.string = `流年轮次 #${player.calendar_year - player.start_year + 1}`;
    if (this.identityLabel) {
      this.identityLabel.string = `身份: ${EnumMapper.translateIdentity(player.identity_id)}`;
    }
    if (this.regionLabel) this.regionLabel.string = `地区: ${EnumMapper.translateRegion(player.region_id)}`;
    if (this.casteLabel) this.casteLabel.string = `阶层: ${EnumMapper.translateCaste(player.caste_id)}`;

    for (const [key, value] of Object.entries(player.attributes)) {
      const coin = this.statCoinNodes.get(key);
      const previous = this.prevStatValues.get(key);
      const label = coin?.getComponent(Label);
      if (label) {
        label.string = key === 'wealth' ? `${formatWealth(value)}两` : String(value);
        label.color = isEnded && key === 'physique'
          ? INK.red
          : key === 'wealth' ? INK.gold : key === 'physique' ? INK.green : INK.text;
      }
      if (previous !== undefined && previous !== value) {
        if (coin && !this.reduceMotion()) {
          const defaultColor = isEnded && key === 'physique' ? INK.red
            : key === 'wealth' ? INK.gold : key === 'physique' ? INK.green : INK.text;
          UIAnimController.playAttrPunch(coin, label, value - previous, defaultColor);
        }
        if (key === 'wealth' && value > previous && !isEnded) {
          this.pixelFX?.play('gain');
          this.wealthGainPending = true;
        }
      }
      // 首帧只记录，重启后不会把另一局的初始家资误报为增益。
      this.prevStatValues.set(key, value);
    }
    const startingCardId = player.cards[0];
    if (startingCardId && this.relicBar && !this.relicBar.getRelics().some(item => item.id === startingCardId)) {
      const card = getNativeMingEndContent().bundle.cards.find(item => item.id === startingCardId);
      if (card) {
        const perk = card.check_bonus
          ? `对应检定修正 +${card.check_bonus.amount}`
          : '';
        const item: RelicItemData = {
          id: card.id,
          name: card.name,
          desc: card.description.replace(/\s+/g, ' ').trim(),
          rarity: card.rarity,
          perk,
        };
        this.relicBar.addRelic(item);
      }
    }
    this.updateSealButtonState(isEnded);
  }


  private appendFoldCard(data: FoldItemData, yearCards?: Node[]): void {
    if (!this.logContentNode) return;
    this.renderedItemsCount += 1;

    const itemNode = new Node(`FoldCard_${this.renderedItemsCount}`);
    itemNode.layer = Layers.Enum.UI_2D;
    itemNode.setPosition(0, 0, 0);
    const itemTrans = itemNode.addComponent(UITransform);
    itemTrans.setAnchorPoint(0.5, 0.5);
    itemTrans.setContentSize(VIEW.foldWidth, 80);
    this.logContentNode.addChild(itemNode);
    if (yearCards) yearCards.push(itemNode);

    const comp = itemNode.addComponent(EventFoldItem);
    comp.init(data, this.currentView?.status !== 'ENDED');
    const cardId = this.currentView?.player.cards[0];
    if (cardId && data.relicFlags?.length) {
      this.relicBar?.playFeedback(cardId, data.relicFlags, data.feedbackKey);
    }
    if (data.achievementIds?.length) this.pixelFX?.play('confetti');

    this.updateLogContentLayout();
  }

  private updateLogContentLayout(): void {
    if (!this.logContentNode) return;
    let totalHeight = 16;
    const spacing = 18;
    for (const child of this.logContentNode.children) {
      const trans = child.getComponent(UITransform);
      if (trans) {
        child.setPosition(0, -totalHeight - trans.height / 2, 0);
        totalHeight += trans.height + spacing;
      }
    }
    const contentTrans = this.logContentNode.getComponent(UITransform);
    if (contentTrans) {
      contentTrans.setContentSize(VIEW.logWidth, Math.max(this.logViewportHeight(), totalHeight + 20));
    }
  }

  private renderPending(pending: PendingDecision | null): void {
    this.careerPanel?.destroy();
    this.careerPanel = null;
    if (this.memorialCardComp) this.memorialCardComp.node.active = pending?.kind === 'option';
    if (pending?.kind === 'card') {
      this.cancelSealHold();
      if (this.decisionOverlay) this.decisionOverlay.active = false;
      const cards = getNativeMingEndContent().bundle.cards;
      this.openingFlow?.showCards(pending.cards.map(id => cards.find(card => card.id === id)!));
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
          const immediateDeath = option.outcome.effects.some(effect => effect.type === 'death');
          let possibleDeath = immediateDeath;
          if (!possibleDeath && option.outcome.next_stage_id !== null) {
            const stageIds = [option.outcome.next_stage_id];
            const seen = new Set<string>();
            for (const id of stageIds) {
              if (seen.has(id)) continue;
              seen.add(id);
              const stage = event.stages!.find(stage => stage.id === id)!;
              for (let branch = 0; branch < 3; branch++) {
                const outcome = branch === 0 ? stage.success : branch === 1 ? stage.failure : stage.critical_success;
                if (!outcome) continue;
                if (outcome.effects.some(effect => effect.type === 'death')) {
                  possibleDeath = true;
                  break;
                }
                if (outcome.next_stage_id !== null) stageIds.push(outcome.next_stage_id);
              }
              if (possibleDeath) break;
            }
          }
          if (possibleDeath) lines.push(immediateDeath ? '后果：此选择会导致死亡。' : '风险：后续可能丧命。');
          const chainCommitments: string[] = [];
          for (const effect of option.outcome.effects) {
            if (effect.type === 'chain_start') {
              const commitment = bundle.chains.find(chain => chain.id === effect.id)?.commitment;
              if (commitment) {
                chainCommitments.push(commitment);
                lines.push(`开始前请留意：${commitment}`);
              }
            }
          }
          for (const effect of option.outcome.effects) {
            if (effect.type === 'attribute_add' && effect.amount < 0) {
              const statName = EnumMapper.translateStat(effect.attribute).name;
              const costListedInCommitment = chainCommitments.some(commitment =>
                commitment.includes(`${statName}${Math.abs(effect.amount)}`));
              if (!costListedInCommitment) lines.push(`立即消耗：${statName} ${effect.amount}`);
            }
          }
          details[option.id] = lines;
        }
      }
      this.decisionOverlay.active = true;
      this.memorialCardComp.init(pending, (optId) => {
        void this.chooseOption(optId);
      }, event?.text, details, () => this.openCareerManager());
      this.fitModal(this.memorialCardComp.node);
    } else {
      if (this.decisionOverlay) this.decisionOverlay.active = false;
      if (pending.kind === 'stage') {
        void this.chooseStage();
      }
    }
  }

  private async selectCard(cardId: string): Promise<void> {
    if (!this.session || this.cardSubmitting) return;
    const session = this.session;
    this.cardSubmitting = true;
    try {
      const result = await session.command({ type: 'selectCard', cardId });
      if (this.session !== session) return;
      if (!result.ok) {
        this.audio?.playCue('error');
        this.openingFlow?.showError(EnumMapper.playerError(result.error));
        return;
      }
      this.openingFlow?.hide();
      this.currentView = result.state;
      this.updateHUD(this.currentView);
      for (const item of LogParser.parseBatch(this.extractRawLogs(result.logs))) this.appendFoldCard(item);
      this.renderPending(result.pending);
      if (result.state.status === 'ENDED') this.appendEndingHint();
      this.scrollView?.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
    } catch (error) {
      if (this.session === session) {
        this.audio?.playCue('error');
        this.openingFlow?.showError(EnumMapper.playerError(error));
      }
    } finally {
      if (this.session === session) this.cardSubmitting = false;
    }
  }

  private showLifetimeRecords(achievements: boolean): void {
    const stats = this.lifetimeRecords?.snapshot();
    if (!stats) return;
    const bundle = getNativeMingEndContent().bundle;
    const text = achievements
      ? [`已获得 ${stats.achievements.size} 项成就`, '',
        ...(stats.achievements.size ? [...stats.achievements].map(id => {
          const item = bundle.achievements.find(entry => entry.id === id);
          return item ? `${item.name} · ${EnumMapper.achievementMeta(item)}\n${item.text}\n` : '旧版本成就\n';
        }) : ['还没有完成的人生。', '穿越一次，留下你的第一段经历。'])]
      : [`完成的人生  ${stats.completed} 次`, '', `最长寿命  ${stats.longest} 岁`, '',
        `累计经历  ${stats.years} 年`, '', `已获成就  ${stats.achievements.size} 项`];
    text.push('', '仅统计本机完成的人生；当前未结束的进度不计入。');
    if (stats.warning) text.push('', stats.warning);
    this.openingFlow?.showRecords(achievements ? '成就' : '统计', text.join('\n'));
  }

  private openCareerManager(): void {
    if (!this.currentView || !this.decisionOverlay || this.careerBusy || this.currentView.status === 'AWAITING_CARD') return;
    this.cancelSealHold();
    if (this.memorialCardComp) this.memorialCardComp.node.active = false;
    this.decisionOverlay.active = true;
    this.careerPanel?.destroy();

    const panel = new Node('CareerPanel');
    panel.layer = Layers.Enum.UI_2D;
    panel.addComponent(UITransform).setContentSize(700, 900);
    this.paintPanel(panel, 700, 900, new Color(24, 27, 36, 255), INK.borderLight, 12);
    this.decisionOverlay.addChild(panel);
    this.careerPanel = panel;
    this.fitModal(panel);
    this.createText(panel, 'Title', '事业', 0, 377, 620, 50, 30, INK.gold).isBold = true;
    this.createText(panel, 'Explanation', '路线、词条、家当与这段人生的成就', 0, 332, 620, 36, 20, INK.sub, Label.HorizontalAlign.CENTER);

    const tabs = [
      { id: 'careers', name: '事业' },
      { id: 'modern', name: '现代词条' },
      { id: 'relics', name: '家当' },
      { id: 'achievements', name: '生涯成就' },
    ] as const;
    type HubTab = typeof tabs[number]['id'];
    let selectedTab: HubTab = 'careers';

    const scrollNode = new Node('CareerScrollView');
    scrollNode.layer = Layers.Enum.UI_2D;
    scrollNode.setPosition(0, 6, 0);
    scrollNode.addComponent(UITransform).setContentSize(640, 470);
    panel.addChild(scrollNode);
    const viewport = new Node('Viewport');
    viewport.layer = Layers.Enum.UI_2D;
    viewport.addComponent(UITransform).setContentSize(640, 470);
    viewport.addComponent(Mask);
    scrollNode.addChild(viewport);
    const content = new Node('Content');
    content.layer = Layers.Enum.UI_2D;
    const transform = content.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 1);
    transform.setContentSize(640, 470);
    content.setPosition(0, 235, 0);
    viewport.addChild(content);
    const scroll = scrollNode.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.vertical = true;
    scroll.content = content;

    let selected: string | null = null;
    const rows: { node: Node; selection: Label; id: string }[] = [];
    const notice = this.createText(panel, 'CareerNotice', '选中进行中的事业后，可在此确认退出。', 0, -251, 620, 42, 18, INK.sub, Label.HorizontalAlign.CENTER);
    const confirm = this.createButton(panel, '确认退出事业', -160, -354, 292, 64, () => {
      if (selected) void this.abandonCareer(selected, notice);
    });
    confirm.getComponent(Button)!.interactable = false;
    const closeHub = (): void => {
      if (this.careerBusy) return;
      panel.destroy();
      this.careerPanel = null;
      const pending = this.currentView?.pending;
      if (this.memorialCardComp) this.memorialCardComp.node.active = pending?.kind === 'option';
      if (this.decisionOverlay) this.decisionOverlay.active = pending?.kind === 'option';
    };
    const close = this.createButton(panel, '返回', 160, -354, 292, 64, closeHub);
    let summaryButton: Node | null = null;
    if (this.currentView.status === 'ENDED') {
      summaryButton = this.createButton(panel, '人生总结', 0, -354, 292, 64, () => {
        if (this.careerBusy) return;
        panel.destroy();
        this.careerPanel = null;
        this.showEndingSummary();
      });
      this.addActionIcon(summaryButton, 'btn-summary');
    }

    const tabButtons = new Map<HubTab, Node>();
    let renderTab: () => void = () => undefined;
    const tabLayout = [
      { x: -240, width: 152 }, { x: -80, width: 152 },
      { x: 80, width: 152 }, { x: 240, width: 152 },
    ];
    tabs.forEach((tab, index) => {
      const button = this.createButton(panel, tab.name, tabLayout[index].x, 284, tabLayout[index].width, 48, () => {
        if (this.careerBusy) return;
        selectedTab = tab.id;
        renderTab();
      });
      tabButtons.set(tab.id, button);
    });

    const bundle = getNativeMingEndContent().bundle;
    renderTab = (): void => {
      for (const child of [...content.children]) child.destroy();
      content.removeAllChildren();
      rows.length = 0;
      selected = null;
      confirm.getComponent(Button)!.interactable = false;
      this.styleButton(confirm, INK.raised, INK.border, INK.sub);
      for (const [id, button] of tabButtons) {
        const active = id === selectedTab;
        this.styleButton(button, active ? INK.selected : INK.raised, active ? INK.cyan : INK.border,
          active ? INK.cyan : INK.text);
      }
      const current = this.currentView;
      if (!current) return;
      const rowGap = 96;
      let count = 0;
      const addTextEntry = (title: string, body: string, color = INK.text): void => {
        const y = -46 - count * rowGap;
        const heading = this.createText(content, `EntryTitle_${count}`, title, 0, y, 600, 34, 23, color);
        heading.isBold = true;
        this.createText(content, `EntryBody_${count}`, body || '暂无说明。', 0, y - 42, 600, 62, 19, INK.sub);
        count += 1;
      };
      const chains = current.player.chains;
      const activeChains = chains.filter(chain => chain.status === 'active');
      notice.node.active = selectedTab === 'careers' && activeChains.length > 0;
      confirm.active = selectedTab === 'careers' && activeChains.length > 0;
      if (summaryButton) summaryButton.active = true;
      if (close.isValid) close.active = true;

      if (selectedTab === 'careers') {
        notice.string = activeChains.length > 0
          ? '选中进行中的事业后，可在此确认退出。'
          : '当前没有进行中的事业。';
        activeChains.forEach((chain, index) => {
          const definition = bundle.chains.find(item => item.id === chain.chain_id);
          const name = definition?.name ?? chain.chain_id;
          const button = this.createButton(content, `选择：${name}`, 0, -50 - index * 104, 600, 88, () => {
            if (this.careerBusy) return;
            selected = chain.instance_id;
            notice.string = `将退出“${name}”。已付费用不退，已学本事保留。`;
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
          this.createText(button, 'Progress', `进展 ${chain.node_index}/${definition?.nodes.length ?? '—'} · 下次 ${chain.next_due_year ?? '—'} 年`, -38, -20, 480, 28, 18, INK.sub);
          const selection = this.createText(button, 'Selection', '选择', 253, 0, 64, 38, 20, INK.cyan, Label.HorizontalAlign.CENTER);
          rows.push({ node: button, selection, id: chain.instance_id });
        });
        chains.filter(chain => chain.status !== 'active').forEach(chain => {
          const definition = bundle.chains.find(item => item.id === chain.chain_id);
          const name = definition?.name ?? chain.chain_id;
          const status = chain.status === 'completed' ? '已完成' : '已中断';
          addTextEntry(`${name} · ${status}`, `进展 ${chain.node_index}/${definition?.nodes.length ?? '—'}`,
            chain.status === 'completed' ? INK.gold : INK.sub);
        });
        if (chains.length === 0) addTextEntry('暂无事业记录', '选择一条事业路线后，会在这里看到进展。', INK.sub);
      } else if (selectedTab === 'modern' || selectedTab === 'relics') {
        const cards = current.player.cards
          .map(id => bundle.cards.find(card => card.id === id))
          .filter((card): card is (typeof bundle.cards)[number] => Boolean(card));
        const entries = cards.filter(card => selectedTab === 'modern'
          ? card.id.startsWith('CARD_MODERN_')
          : !card.id.startsWith('CARD_MODERN_'));
        for (const card of entries) {
          const label = card.rarity ? `${card.name} · ${card.rarity}` : card.name;
          addTextEntry(label, card.description, selectedTab === 'modern' ? INK.cyan : INK.gold);
        }
        if (entries.length === 0) {
          addTextEntry(selectedTab === 'modern' ? '尚无现代词条' : '尚未获得家当',
            selectedTab === 'modern' ? '开局选择后，词条会记在这里。' : '获得的物件会记在这里。', INK.sub);
        }
      } else {
        const completedLifeAchievements = this.lifetimeRecords?.snapshot().achievements ?? new Set<string>();
        const endingAchievements = current.status === 'ENDED' && this.endingReport
          ? [...this.endingReport.achievements, this.endingReport.primary_achievement_id].filter((id): id is string => Boolean(id))
          : [];
        const ids = [...new Set([...completedLifeAchievements, ...current.player.achievements, ...endingAchievements])];
        const achievements = ids
          .map(id => bundle.achievements.find(item => item.id === id))
          .filter((item): item is (typeof bundle.achievements)[number] => Boolean(item));
        for (const achievement of achievements) {
          addTextEntry(`${achievement.name} · ${EnumMapper.achievementMeta(achievement)}`, achievement.text, INK.gold);
        }
        if (achievements.length === 0) addTextEntry('本局还没有成就', '这一段人生还没留下称号。', INK.sub);
      }

      const height = Math.max(470, count * rowGap + 24,
        selectedTab === 'careers' ? activeChains.length * 104 + Math.max(0, chains.length - activeChains.length) * rowGap + 24 : 0);
      transform.setContentSize(640, height);
      content.setPosition(0, height / 2, 0);
      notice.node.active = selectedTab === 'careers' && activeChains.length > 0;
      confirm.active = selectedTab === 'careers' && activeChains.length > 0;
      if (this.currentView?.status === 'ENDED' && summaryButton) {
        summaryButton.setPosition(-160, -354, 0);
        close.setPosition(160, -354, 0);
      } else {
        close.setPosition(0, -354, 0);
      }
    };
    renderTab();
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
        this.audio?.playCue('error');
        notice.string = `未能退出：${EnumMapper.playerError(result.error)}`;
        return;
      }
      this.careerPanel?.destroy();
      this.careerPanel = null;
      this.currentView = result.state;
      this.updateHUD(result.state);
      for (const item of LogParser.parseBatch(this.extractRawLogs(result.logs))) this.appendFoldCard(item);
      if (result.state.status === 'ENDED') {
        this.appendEndingHint();
      }
      this.renderPending(result.pending);
      if (this.scrollView) this.scrollView.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
    } catch (error) {
      if (this.session === session) {
        this.audio?.playCue('error');
        notice.string = `未能退出：${EnumMapper.playerError(error)}`;
      }
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
        this.memorialCardComp?.showError(EnumMapper.playerError(res.error));
        return;
      }
      if (res.state.status !== 'ENDED') this.audio?.playCue('choice');

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
      if (this.session === session) this.memorialCardComp?.showError(EnumMapper.playerError(error));
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
          this.audio?.playCue('error');
          this.appendSystemLog(`未能完成检定：${EnumMapper.playerError(res.error)}`);
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
        this.audio?.playCue('error');
        this.appendSystemLog(`未能完成检定：${EnumMapper.playerError(error)}`);
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
    this.scrollView?.scrollToBottom(this.reduceMotion() ? 0 : 0.2);
  }

  private playLogCues(logs: readonly LogEntry[]): void {
    let card = false;
    let option = false;
    let career = false;
    let achievement = false;
    let eventCue: 'reveal' | 'choice' | null = null;
    for (const log of logs) {
      if (log.seq <= this.lastSoundSeq) continue;
      this.lastSoundSeq = log.seq;
      if (log.type === 'event' && !this.soundedEvents.has(log.data.event_instance_id)) {
        this.soundedEvents.add(log.data.event_instance_id);
        const event = getNativeMingEndContent().bundle.events.find(item => item.id === log.source_id);
        eventCue = event?.interaction === 'choice' ? 'choice' : 'reveal';
      } else if (log.type === 'card_selected') card = true;
      else if (log.type === 'option') option = true;
      else if (log.type === 'chain') career = true;
      else if (log.type === 'achievement') achievement = true;
    }
    const gain = this.wealthGainPending;
    this.wealthGainPending = false;
    // A receipt can resolve several automatic stages. Coalesce it to one cue;
    // achievements have their own receipt-deduplicated panel feedback.
    if (this.currentView?.status === 'ENDED' || achievement || option) return;
    if (card) this.audio?.playCue('item');
    else if (gain) this.audio?.playCue('gain');
    else if (career) this.audio?.playCue('select');
    else if (eventCue) this.audio?.playCue(eventCue);
  }

  private extractRawLogs(logs: readonly LogEntry[]) {
    this.playLogCues(logs);
    return logs.map((l) => {
      let metadata: Record<string, unknown> | undefined = undefined;
      if ('data' in l && l.data && typeof l.data === 'object') {
        metadata = l.data as Record<string, unknown>;
      }
      let message = l.message;
      if (l.type === 'achievement') {
        const achievement = getNativeMingEndContent().bundle.achievements.find(item => item.id === l.data.achievement_id);
        if (achievement) message = `【${achievement.name}】${achievement.text}`;
      }
      return {
        type: l.type,
        seq: l.seq,
        age: l.age,
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
    this.lifetimeRecords?.record(this.lifetimeId, run.ending);
    this.cancelSealHold();
    const natural = run.ending.death_id === getNativeMingEndContent().bundle.era.old_age_death_id;
    this.setAudioScene('ending', null);
    this.audio?.playCue(natural ? 'ending' : 'death');
    if (run.death !== null && !natural) {
      this.pixelFX?.play('death');
      if (!this.reduceMotion()) UIAnimController.playDeathShake(this.node);
    } else if (natural && run.ending.achievements.length > 0) {
      this.pixelFX?.play('confetti');
    }
    // A death report is not a victory: no delayed confetti or cheerful success cue.
    this.updateSealButtonState(true);
    this.appendSystemLog(`你的人生走到了终点。点击“人生总结”查看经历和成就。`);
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
    this.finishEndingEntrance();
    this.endingPanel?.destroy();
    const panel = new Node('EndingPanel');
    panel.layer = Layers.Enum.UI_2D;
    panel.addComponent(UITransform).setContentSize(700, 860);
    this.paintPanel(panel, 700, 860, new Color(23, 25, 34, 255), INK.borderLight, 12);
    this.decisionOverlay.addChild(panel);
    this.decisionOverlay.active = true;
    this.endingPanel = panel;
    this.fitModal(panel);
    const opacity = panel.addComponent(UIOpacity);
    if (!this.reduceMotion()) {
      opacity.opacity = 0;
      panel.setPosition(0, -12, 0);
      this.endingEntranceElapsed = 0;
    }

    this.createText(panel, 'EndingTitle', '【 终局盖棺 · 历史定论 】', 0, 380, 620, 48, 32, natural ? INK.gold : INK.text, Label.HorizontalAlign.CENTER).isBold = true;
    this.createText(panel, 'LifeSpan', `${report.start_year}—${report.end_year} · ${report.start_age}—${report.end_age} 岁 · 历经 ${report.years_played} 年`, 0, 326, 620, 42, 20, INK.sub, Label.HorizontalAlign.CENTER);
    this.createText(panel, 'DeathReason', death ? `${death.name} · ${death.text}` : '未能读取死因。', 0, 257, 620, 78, 22, INK.text, Label.HorizontalAlign.CENTER);

    const finalStats = new Node('FinalStats');
    finalStats.layer = Layers.Enum.UI_2D;
    finalStats.setPosition(0, 150, 0);
    finalStats.addComponent(UITransform).setContentSize(620, 78);
    this.paintPanel(finalStats, 620, 78, INK.inset, INK.inset, 6);
    panel.addChild(finalStats);
    const endingStats = [
      { key: 'age', title: '享寿', value: `${report.end_age} 岁`, color: INK.green },
      { key: 'wealth', title: '积累家资', value: `${formatWealth(report.final_attributes.wealth)} 两`, color: INK.gold },
      { key: 'achievements', title: '达成成就', value: `${report.achievements.length} 项`, color: INK.cyan },
    ];
    endingStats.forEach((item, index) => {
      const x = -202 + index * 202;
      this.createText(finalStats, `Name_${item.key}`, item.title, x, 19, 180, 24, 18, INK.sub, Label.HorizontalAlign.CENTER);
      this.createText(finalStats, `Value_${item.key}`, item.value, x, -15, 180, 34, 25, item.color, Label.HorizontalAlign.CENTER).isBold = true;
    });

    const otherAchievements: string[] = [];
    for (const id of report.achievements) {
      if (id === report.primary_achievement_id) continue;
      const achievement = bundle.achievements.find(item => item.id === id);
      if (achievement) otherAchievements.push(`${achievement.name} · ${EnumMapper.achievementMeta(achievement)}\n${achievement.text}`);
    }

    const lines = [
      '人生评语',
      primary ? `${primary.name} · ${EnumMapper.achievementMeta(primary)}\n${primary.text}` : '普通人生',
      '',
      `最高身份 · ${EnumMapper.translateIdentity(report.highest_identity_id)}`,
      `事业 · 完成 ${report.chains_completed.length} 项 / 中断 ${report.chains_interrupted.length} 项`,
      ...report.chains_completed.map(chain => `完成 · ${bundle.chains.find(item => item.id === chain.chain_id)?.name ?? chain.chain_id}`),
      ...report.chains_interrupted.map(chain => `中断 · ${bundle.chains.find(item => item.id === chain.chain_id)?.name ?? chain.chain_id}`),
      '',
      `其他成就 · ${otherAchievements.length} 项`,
      ...otherAchievements,
      ...(otherAchievements.length === 0 ? ['没有其他成就。'] : []),
      '',
      '随身家当',
      ...this.currentView.player.cards.map(id => {
        const card = bundle.cards.find(item => item.id === id);
        return card ? `${card.name} · ${card.rarity}\n${card.description}` : id;
      }),
    ];
    const scrollNode = new Node('EndingScrollView');
    scrollNode.layer = Layers.Enum.UI_2D;
    scrollNode.setPosition(0, -42, 0);
    scrollNode.addComponent(UITransform).setContentSize(640, 270);
    panel.addChild(scrollNode);
    const viewport = new Node('Viewport');
    viewport.layer = Layers.Enum.UI_2D;
    viewport.addComponent(UITransform).setContentSize(640, 270);
    viewport.addComponent(Mask);
    scrollNode.addChild(viewport);
    const content = new Node('Content');
    content.layer = Layers.Enum.UI_2D;
    const transform = content.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 1);
    content.setPosition(0, 135, 0);
    viewport.addChild(content);
    const details = this.createText(content, 'ReportDetails', lines.join('\n'), 0, 0, 604, 40, 20, INK.sub);
    const detailsTransform = details.node.getComponent(UITransform)!;
    detailsTransform.setAnchorPoint(0.5, 1);
    details.verticalAlign = Label.VerticalAlign.TOP;
    details.overflow = Label.Overflow.RESIZE_HEIGHT;
    details.updateRenderData(true);
    const detailsHeight = Math.max(270, detailsTransform.height + 16);
    transform.setContentSize(640, detailsHeight);
    content.setPosition(0, 135, 0);
    const scroll = scrollNode.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.vertical = true;
    scroll.content = content;
    this.createText(panel, 'ReportHint', '上下滑动查看完整记录', 0, -218, 620, 28, 18, INK.sub, Label.HorizontalAlign.CENTER);
    const restartLife = this.createButton(panel, '尘埃落定 · 重启人生', 0, -292, 620, 64, () => {
      this.finishEndingEntrance();
      panel.destroy();
      this.endingPanel = null;
      if (this.decisionOverlay) this.decisionOverlay.active = false;
      this.startNewLife();
    });
    this.styleButton(restartLife, INK.green, INK.green, INK.inset);
    this.createButton(panel, '返回历程', -155, -376, 280, 42, () => {
      this.finishEndingEntrance();
      panel.destroy();
      this.endingPanel = null;
      if (this.decisionOverlay) this.decisionOverlay.active = false;
    });
    const home = this.createButton(panel, '返回首页', 155, -376, 280, 42, () => {
      this.finishEndingEntrance();
      panel.destroy();
      this.endingPanel = null;
      if (this.decisionOverlay) this.decisionOverlay.active = false;
      this.setAudioScene('home', null);
      this.openingFlow?.showHome();
    });
    this.styleButton(home, INK.raised, INK.border, INK.text);
  }

  private showSaveTip(): void {
    if (!this.session) return;
    this.appendSystemLog('本界面只临时记录本局进度。关闭或刷新后不能接着玩，重启人生会新开一局。');
  }

  private buildSoundSettings(): void {
    const overlay = new Node('SoundSettingsOverlay');
    overlay.layer = Layers.Enum.UI_2D;
    overlay.addComponent(UITransform).setContentSize(VIEW.width, this.viewportHeight);
    const mask = new Node('SoundMask');
    mask.layer = Layers.Enum.UI_2D;
    mask.addComponent(UITransform).setContentSize(VIEW.width, this.viewportHeight);
    mask.addComponent(BlockInputEvents);
    this.paintPanel(mask, VIEW.width, this.viewportHeight, INK.scrim, INK.scrim, 0);
    overlay.addChild(mask);
    const panel = new Node('SoundSettingsPanel');
    panel.layer = Layers.Enum.UI_2D;
    panel.addComponent(UITransform).setContentSize(700, 880);
    panel.addComponent(BlockInputEvents);
    overlay.addChild(panel);
    this.soundOverlay = overlay;
    this.soundPanel = panel;
    this.createText(panel, 'SoundTitle', '声音设置', 0, 0, 620, 50, 32, INK.gold).isBold = true;
    this.createText(panel, 'SoundHelp', SOUND_HELP, 0, 0, 620, 66, 22, INK.text);

    const scrollNode = new Node('SoundSettingsScrollView');
    scrollNode.layer = Layers.Enum.UI_2D;
    scrollNode.addComponent(UITransform).setContentSize(652, 604);
    panel.addChild(scrollNode);
    const viewport = new Node('Viewport');
    viewport.layer = Layers.Enum.UI_2D;
    viewport.addComponent(UITransform).setContentSize(652, 604);
    viewport.addComponent(Mask);
    scrollNode.addChild(viewport);
    const content = new Node('Content');
    content.layer = Layers.Enum.UI_2D;
    const transform = content.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 1);
    transform.setContentSize(652, 704);
    viewport.addChild(content);
    const scroll = scrollNode.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.vertical = true;
    scroll.content = content;

    AUDIO_CHANNELS.forEach((channel, index) => {
      const row = new Node(`SoundRow_${channel}`);
      row.layer = Layers.Enum.UI_2D;
      row.addComponent(UITransform).setContentSize(620, 220);
      row.setPosition(0, -118 - index * 232, 0);
      this.paintPanel(row, 620, 220, INK.inset, INK.border, 8);
      content.addChild(row);
      this.createText(row, 'ChannelName', AUDIO_LABELS[channel], -192, 62, 200, 42, 27, INK.text).isBold = true;
      const value = this.createText(row, 'VolumeValue', '', -20, 62, 120, 42, 27, INK.gold, Label.HorizontalAlign.CENTER);
      const mute = this.createButton(row, '静音', 218, 62, 152, 88, () => this.toggleChannelMute(channel));
      const minus = this.createButton(row, '−', -250, -48, 88, 88, () => this.setAudioLevel(channel, this.getAudioLevel(channel) - 0.05));
      minus.name = `Decrease_${channel}`;
      const plus = this.createButton(row, '＋', 250, -48, 88, 88, () => this.setAudioLevel(channel, this.getAudioLevel(channel) + 0.05));
      plus.name = `Increase_${channel}`;
      const track = new Node(`VolumeTrack_${channel}`);
      track.layer = Layers.Enum.UI_2D;
      track.addComponent(UITransform).setContentSize(380, 88);
      track.setPosition(0, -48, 0);
      row.addChild(track);
      this.soundRows.set(channel, { node: row, track, value, mute });
      let touchId: number | null = null;
      let startX = 0;
      let startY = 0;
      let horizontal = false;
      const adjust = (event: EventTouch): void => {
        const point = event.getUILocation();
        this.soundTouchPoint.set(point.x, point.y, 0);
        const local = track.getComponent(UITransform)!.convertToNodeSpaceAR(this.soundTouchPoint, this.soundTouchPoint);
        this.setAudioLevel(channel, (local.x + 176) / 352);
        event.propagationStopped = true;
      };
      track.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
        if (touchId !== null) return;
        touchId = event.getID();
        const point = event.getUILocation();
        startX = point.x;
        startY = point.y;
        horizontal = false;
        this.focusSoundControl(row, `正在调整${AUDIO_LABELS[channel]}。上下滑动查看更多，方向键调节音量。`);
      });
      track.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
        if (touchId !== event.getID()) return;
        const point = event.getUILocation();
        const dx = Math.abs(point.x - startX);
        const dy = Math.abs(point.y - startY);
        if (!horizontal && dx > 8 && dx > dy) horizontal = true;
        if (horizontal) adjust(event);
      });
      track.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
        if (touchId !== event.getID()) return;
        const point = event.getUILocation();
        if (horizontal || Math.abs(point.y - startY) <= 12) adjust(event);
        touchId = null;
      });
      track.on(Node.EventType.TOUCH_CANCEL, () => { touchId = null; });
    });
    this.soundMuteAll = this.createButton(panel, '全部静音', -160, 0, 292, 88, () => this.toggleAllAudio());
    this.createButton(panel, '返回', 160, 0, 292, 88, () => this.closeSoundSettings());
    overlay.active = false;
    this.node.addChild(overlay);
    this.layoutSoundSettings();
    this.refreshSoundSettings();
  }

  private layoutSoundSettings(): void {
    if (!this.soundPanel) return;
    // Scroll rather than scaling the controls or text on short/landscape viewports.
    const height = Math.max(320, Math.min(880, this.viewportHeight - 48));
    const scrollHeight = Math.max(44, height - 276);
    const panel = this.soundPanel;
    panel.getComponent(UITransform)!.setContentSize(700, height);
    this.paintPanel(panel, 700, height, INK.panel, INK.borderLight, 12);
    panel.getChildByName('SoundTitle')!.setPosition(0, height / 2 - 44, 0);
    panel.getChildByName('SoundHelp')!.setPosition(0, height / 2 - 104, 0);
    const scrollNode = panel.getChildByName('SoundSettingsScrollView')!;
    scrollNode.setPosition(0, -6, 0);
    scrollNode.getComponent(UITransform)!.setContentSize(652, scrollHeight);
    const viewport = scrollNode.getChildByName('Viewport')!;
    viewport.getComponent(UITransform)!.setContentSize(652, scrollHeight);
    const scroll = scrollNode.getComponent(ScrollView)!;
    const offset = scroll.getScrollOffset();
    scroll.stopAutoScroll();
    scroll.content!.setPosition(0, scrollHeight / 2, 0);
    scroll.content!.getComponent(UITransform)!.setContentSize(652, Math.max(704, scrollHeight));
    scroll.scrollToOffset(offset, 0);
    this.soundMuteAll?.setPosition(-160, -height / 2 + 64, 0);
    panel.getChildByName('Btn_返回')!.setPosition(160, -height / 2 + 64, 0);
  }

  private showSoundSettings(): void {
    if (!this.soundOverlay) this.buildSoundSettings();
    if (!this.soundOverlay || this.soundOverlay.active) return;
    this.cancelSealHold();
    this.soundOverlay.active = true;
    this.soundOverlay.setSiblingIndex(this.node.children.length - 1);
    const help = this.soundPanel?.getChildByName('SoundHelp')?.getComponent(Label);
    if (help) help.string = SOUND_HELP;
    this.layoutSoundSettings();
    this.refreshSoundSettings();
    this.mountSoundAccessibility();
  }

  private closeSoundSettings(): void {
    if (this.soundOverlay) this.soundOverlay.active = false;
    this.soundAccessibility?.remove();
    this.soundAccessibility = null;
    this.soundInputs.clear();
    this.soundMuteInputs.clear();
    this.soundMasterInput = null;
    this.soundFocusNode = null;
    if (this.soundFocusBefore?.isConnected) this.soundFocusBefore.focus({ preventScroll: true });
    this.soundFocusBefore = null;
  }

  private getAudioLevel(channel: AudioChannel): number {
    if (!this.audio) return 0;
    return channel === 'music' ? this.audio.getMusicVolume()
      : channel === 'effects' ? this.audio.getEffectsVolume() : this.audio.getAmbienceVolume();
  }

  private setAudioLevel(channel: AudioChannel, volume: number, preserveMuteSnapshot = false): void {
    const value = Math.max(0, Math.min(1, Math.round(volume * 100) / 100));
    if (!preserveMuteSnapshot) this.mutedVolumes = null;
    if (value > 0) this.lastAudibleVolumes.set(channel, value);
    if (channel === 'music') this.audio?.setMusicVolume(value);
    else if (channel === 'effects') this.audio?.setEffectsVolume(value);
    else this.audio?.setAmbienceVolume(value);
    this.refreshSoundSettings();
  }

  private toggleChannelMute(channel: AudioChannel): void {
    const volume = this.getAudioLevel(channel);
    if (volume > 0) this.lastAudibleVolumes.set(channel, volume);
    this.setAudioLevel(channel, volume > 0 ? 0 : this.lastAudibleVolumes.get(channel) ?? 1);
  }

  private toggleAllAudio(): void {
    const allMuted = AUDIO_CHANNELS.every(channel => this.getAudioLevel(channel) === 0);
    if (allMuted) {
      const restore = this.mutedVolumes;
      this.mutedVolumes = null;
      for (const channel of AUDIO_CHANNELS) this.setAudioLevel(channel, restore?.[channel] ?? this.lastAudibleVolumes.get(channel) ?? 1, true);
    } else {
      this.mutedVolumes = { music: this.getAudioLevel('music'), effects: this.getAudioLevel('effects'), ambience: this.getAudioLevel('ambience') };
      for (const channel of AUDIO_CHANNELS) this.setAudioLevel(channel, 0, true);
    }
    this.refreshSoundSettings();
  }

  private refreshSoundSettings(): void {
    for (const channel of AUDIO_CHANNELS) {
      const value = this.getAudioLevel(channel);
      if (value > 0) this.lastAudibleVolumes.set(channel, value);
      const row = this.soundRows.get(channel);
      if (row) {
        row.value.string = `${Math.round(value * 100)}%`;
        row.mute.getChildByName('Title')!.getComponent(Label)!.string = value === 0 ? '取消静音' : '静音';
        this.styleButton(row.mute, INK.raised, row.mute === this.soundFocusNode ? INK.cyan : INK.border, INK.text);
        this.paintPanel(row.node, 620, 220, INK.inset, row.node === this.soundFocusNode ? INK.cyan : INK.border, 8);
        const graphics = row.track.getComponent(Graphics) || row.track.addComponent(Graphics);
        graphics.clear();
        graphics.fillColor = INK.borderLight;
        graphics.roundRect(-176, -4, 352, 8, 4);
        graphics.fill();
        if (value > 0) {
          graphics.fillColor = INK.cyan;
          graphics.roundRect(-176, -4, 352 * value, 8, 4);
          graphics.fill();
        }
        graphics.fillColor = INK.text;
        graphics.circle(-176 + 352 * value, 0, 14);
        graphics.fill();
      }
      const input = this.soundInputs.get(channel);
      if (input) {
        input.value = String(value);
        input.setAttribute('aria-valuetext', `${Math.round(value * 100)}%`);
      }
      const mute = this.soundMuteInputs.get(channel);
      if (mute) mute.textContent = `${value === 0 ? '取消静音' : '静音'}${AUDIO_LABELS[channel]}`;
    }
    const allMuted = AUDIO_CHANNELS.every(channel => this.getAudioLevel(channel) === 0);
    const title = allMuted ? '取消全部静音' : '全部静音';
    if (this.soundMuteAll) {
      this.soundMuteAll.getChildByName('Title')!.getComponent(Label)!.string = title;
      this.styleButton(this.soundMuteAll, INK.raised, this.soundMuteAll === this.soundFocusNode ? INK.cyan : INK.border, INK.text);
    }
    if (this.soundMasterInput) this.soundMasterInput.textContent = title;
    const close = this.soundPanel?.getChildByName('Btn_返回');
    if (close) this.styleButton(close, INK.raised, close === this.soundFocusNode ? INK.cyan : INK.border, INK.text);
  }

  private focusSoundControl(node: Node, description: string): void {
    this.soundFocusNode = node;
    const help = this.soundPanel?.getChildByName('SoundHelp')?.getComponent(Label);
    if (help) help.string = description;
    this.refreshSoundSettings();
  }

  private mountSoundLauncher(): void {
    const document = globalThis.document;
    if (this.soundLauncher || !document?.body) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '声音设置';
    button.setAttribute('aria-label', '打开声音设置');
    button.style.cssText = SOUND_ACCESS_STYLE;
    // Visible on keyboard focus; otherwise the regular Cocos controls are the UI.
    button.addEventListener('focus', () => {
      button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 18px;min-height:44px;border:2px solid;border-radius:6px;font:20px sans-serif;';
      button.style.backgroundColor = `rgb(${INK.panel.r},${INK.panel.g},${INK.panel.b})`;
      button.style.color = `rgb(${INK.text.r},${INK.text.g},${INK.text.b})`;
      button.style.borderColor = `rgb(${INK.cyan.r},${INK.cyan.g},${INK.cyan.b})`;
    });
    button.addEventListener('blur', () => { button.style.cssText = SOUND_ACCESS_STYLE; });
    button.addEventListener('click', () => this.showSoundSettings());
    document.body.appendChild(button);
    this.soundLauncher = button;
  }


  private mountSoundAccessibility(): void {
    // Canvas has no semantic range controls. A visually hidden, synchronized DOM
    // bridge supplies real sliders, screen-reader labels, focus trapping and Escape.
    const document = globalThis.document;
    if (!document?.body) return;
    this.soundFocusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', '声音设置');
    dialog.style.cssText = SOUND_ACCESS_STYLE;
    const controls: HTMLElement[] = [];
    const scroll = this.soundPanel?.getChildByName('SoundSettingsScrollView')?.getComponent(ScrollView);
    AUDIO_CHANNELS.forEach((channel, index) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.id = `sound-${this.node.uuid}-${channel}`;
      label.htmlFor = input.id;
      label.textContent = `${AUDIO_LABELS[channel]}音量`;
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.addEventListener('input', () => this.setAudioLevel(channel, Number(input.value)));
      input.addEventListener('focus', () => {
        scroll?.scrollToPercentVertical(1 - index / 2, 0);
        this.focusSoundControl(this.soundRows.get(channel)!.node, `正在调整${AUDIO_LABELS[channel]}。上下滑动查看更多，方向键调音，Tab 切换，Esc 返回。`);
      });
      const mute = document.createElement('button');
      mute.type = 'button';
      mute.addEventListener('click', () => this.toggleChannelMute(channel));
      mute.addEventListener('focus', () => {
        scroll?.scrollToPercentVertical(1 - index / 2, 0);
        this.focusSoundControl(this.soundRows.get(channel)!.mute, `${AUDIO_LABELS[channel]}静音按钮。按空格或回车切换。`);
      });
      dialog.append(label, input, mute);
      controls.push(input, mute);
      this.soundInputs.set(channel, input);
      this.soundMuteInputs.set(channel, mute);
    });
    const muteAll = document.createElement('button');
    muteAll.type = 'button';
    muteAll.addEventListener('click', () => this.toggleAllAudio());
    muteAll.addEventListener('focus', () => this.focusSoundControl(this.soundMuteAll!, '全部静音按钮。按空格或回车切换。'));
    this.soundMasterInput = muteAll;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '返回';
    close.addEventListener('click', () => this.closeSoundSettings());
    close.addEventListener('focus', () => this.focusSoundControl(this.soundPanel!.getChildByName('Btn_返回')!, '返回按钮。按空格或回车关闭声音设置。'));
    controls.push(muteAll, close);
    dialog.append(muteAll, close);
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeSoundSettings();
      } else if (event.key === 'Tab') {
        const index = controls.indexOf(document.activeElement as HTMLElement);
        if ((event.shiftKey && index === 0) || (!event.shiftKey && index === controls.length - 1)) {
          event.preventDefault();
          controls[event.shiftKey ? controls.length - 1 : 0].focus({ preventScroll: true });
        }
      }
    });
    document.body.appendChild(dialog);
    this.soundAccessibility = dialog;
    this.refreshSoundSettings();
    controls[0].focus({ preventScroll: true });
  }

  private addActionIcon(node: Node, icon: string, titleName = 'Title'): void {
    const name = `ActionIcon_${icon}`;
    const existing = node.children.find(child => child.name.startsWith('ActionIcon_'));
    if (existing) {
      if (existing.name !== name) {
        existing.name = name;
        setArt(existing, `icons/${icon}`);
      }
      return;
    }
    const transform = node.getComponent(UITransform)!;
    const size = transform.height >= 76 ? 34 : 26;
    createArt(node, name, `icons/${icon}`, size, size, -transform.width / 2 + 28, 0);
    const title = node.getChildByName(titleName);
    title?.setPosition(18, 0, 0);
    title?.getComponent(UITransform)?.setContentSize(transform.width - 68, transform.height - 8);
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
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let cancelled = false;
    node.on(Node.EventType.TOUCH_START, (event?: EventTouch) => {
      cancelled = false;
      tracking = !!event;
      if (event) {
        const point = event.getUILocation();
        startX = point.x;
        startY = point.y;
      }
      if (button.interactable && !this.reduceMotion()) node.setScale(0.98, 0.98, 1);
    });
    node.on(Node.EventType.TOUCH_CANCEL, () => {
      cancelled = true;
      tracking = false;
      node.setScale(1, 1, 1);
    });
    node.on(Node.EventType.TOUCH_END, (event?: EventTouch) => {
      node.setScale(1, 1, 1);
      if (tracking && event) {
        const point = event.getUILocation();
        if (Math.abs(point.x - startX) + Math.abs(point.y - startY) > 14) cancelled = true;
      }
      tracking = false;
      if (!button.interactable || cancelled) return;
      this.audio?.playCue('tap');
      callback();
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


  private reduceMotion(): boolean {
    if (this.motionPreference === undefined) {
      const host = globalThis as typeof globalThis & { matchMedia?: (query: string) => { readonly matches: boolean } };
      this.motionPreference = host.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    }
    return this.openingFlow?.reducedMotion === true || this.pixelFX?.reducedMotion === true || this.motionPreference?.matches === true;
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
      if (label) label.string = '尘埃落定 · 重启人生';
      this.paintPanel(this.sealAdvanceBtn, 702, 86, new Color(133, 34, 51, 255), new Color(255, 77, 109, 255), 10);
    } else if (!status || status === 'AWAITING_CARD') {
      if (label) label.string = status ? '先选一件随身家当' : '正在开局…';
      this.paintPanel(this.sealAdvanceBtn, 702, 86, INK.raised, INK.border, 10);
    } else {
      if (label) label.string = status === 'AWAITING_OPTION' ? '先完成当前选择' : status === 'AWAITING_STAGE' ? '正在检定…' : '推进流年 · 长按快进';
      this.paintPanel(this.sealAdvanceBtn, 702, 86, new Color(31, 96, 72, 255), INK.advanceBorder, 10);
    }
    if (label) label.color = !status || status === 'AWAITING_CARD' ? INK.sub : INK.text;
  }
}
