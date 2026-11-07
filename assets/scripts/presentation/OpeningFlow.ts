import {
  _decorator,
  BlockInputEvents,
  Button,
  Color,
  Component,
  EventTouch,
  Graphics,
  Label,
  Layers,
  Mask,
  Node,
  ScrollView,
  UITransform,
  UIOpacity,
  view,
} from 'cc';
import type { GameView } from '../core/types/schema';
import eraJson from '../../resources/data/ming_end/era.json';
import rulesJson from '../../resources/data/ming_end/rules.json';
import { EnumMapper } from './EnumMapper';
import { createArt } from './ArtAssets';
import { GameAudio } from './GameAudio';

const { ccclass, property } = _decorator;
const WIDTH = 750;
const CONTENT_WIDTH = 654;
const VIEWPORT_WIDTH = 678;
const TAU = Math.PI * 2;
const REEL_ROWS = 18;
const CARD_ART_X = -264;
const CARD_ART_Y = -88;
const CARD_ART_DURATION = 0.20;
const INK = {
  background: new Color(10, 14, 25, 255),
  surface: new Color(20, 27, 43, 255),
  inset: new Color(13, 20, 34, 255),
  homeVeil: new Color(7, 13, 23, 96),
  pressed: new Color(30, 43, 62, 255),
  selected: new Color(19, 47, 57, 255),
  border: new Color(67, 84, 110, 255),
  text: new Color(239, 244, 251, 255),
  secondary: new Color(173, 188, 208, 255),
  disabled: new Color(114, 132, 155, 255),
  cyan: new Color(112, 232, 235, 255),
  purple: new Color(203, 160, 255, 255),
  gold: new Color(255, 211, 122, 255),
  error: new Color(255, 169, 169, 255),
  portal: new Color(98, 185, 214, 58),
  portalDim: new Color(91, 145, 184, 24),
  portalBright: new Color(144, 224, 235, 110),
  star: new Color(157, 216, 236, 255),
};

const ITEM_ART: Readonly<Record<string, string>> = {
  CARD_MODERN_CORN: 'items/corn',
  CARD_MODERN_ANTIBIOTIC: 'items/antibiotic',
  CARD_MODERN_FLASHLIGHT: 'items/flashlight',
  CARD_MODERN_CALCULATOR: 'items/calculator',
  CARD_MODERN_GLUE: 'items/glue',
  CARD_MODERN_LIGHTER: 'items/lighter',
  CARD_NATIVE_BOOK: 'items/book',
  CARD_NATIVE_BOWL: 'items/bowl',
};
const REGION_ART: Readonly<Record<string, string>> = {
  R_SHANBEI: 'scenes/shanbei',
  R_CAPITAL: 'scenes/capital',
  R_JIANGNAN: 'scenes/jiangnan',
};
const CASTE_ART: Readonly<Record<string, string>> = {
  C_REFUGEE: 'identity/refugee',
  C_SOLDIER: 'identity/soldier',
  C_GENTRY: 'identity/gentry',
};

type ScreenKind = 'home' | 'identity' | 'cards' | 'records';
type OpeningCard = Readonly<{ id: string; name: string; description: string; rarity: string }>;
type OpeningCallbacks = {
  onStart: () => void;
  onEnter: (cardId: string) => Promise<void>;
  onAchievements: () => void;
  onStats: () => void;
  onSoundSettings?: () => void;
};
interface MotionPreference { readonly matches: boolean }
interface Control {
  node: Node;
  button: Button;
  label: Label;
  graphics: Graphics;
  width: number;
  height: number;
  primary: boolean;
  pressed: boolean;
}
interface CardSlot {
  card: OpeningCard;
  node: Node;
  button: Button;
  graphics: Graphics;
  height: number;
  rarity: Label;
  rarityOpacity: UIOpacity;
  selection: Label;
  settled: boolean;
  pressed: boolean;
  art: Node | null;
  artOpacity: UIOpacity | null;
  artReady: boolean;
  artElapsed: number;
}
interface Reel {
  strip: Node;
  opacity: UIOpacity;
  distance: number;
  elapsed: number;
  duration: number;
  settled: boolean;
  slot: CardSlot | null;
}
interface PortalRing { node: Node; speed: number; phase: number; opacity: UIOpacity }
interface StarStreak { node: Node; opacity: UIOpacity; dx: number; dy: number; phase: number; speed: number }
interface Shockwave { node: Node; graphics: Graphics; opacity: UIOpacity; elapsed: number; duration: number; expansion: number }

/**
 * A full-screen presentation of a session the host already owns. Reels never draw
 * outcomes: their final cells are the supplied player state and supplied offers.
 * All transient motion lives in update(), so changing screens leaves no timers or
 * tweens behind. Native hosts can set reducedMotion alongside the web preference.
 */
@ccclass('OpeningFlow')
export class OpeningFlow extends Component {
  @property({ tooltip: '减少卷轴、星流和震动；Web 同时遵循系统减少动态偏好。' })
  public reducedMotion = false;

  private callbacks: OpeningCallbacks | null = null;
  private cards: readonly OpeningCard[] = [];
  private built = false;
  private disposed = false;
  private screenKind: ScreenKind = 'home';
  private revision = 0;
  private viewportHeight = 1334;
  private naturalHeight = 0;
  private centerContent = true;
  private busy = false;
  private revealDone = true;
  private selectedId: string | null = null;
  private remainingReels = 0;
  private motionPreference: MotionPreference | null = null;
  private motionReduced = false;
  private time = 0;
  private portalReach = 800;
  private shakeElapsed = -1;
  private entranceElapsed = -1;
  private background: Graphics | null = null;
  private homeArt: Node | null = null;
  private homeVeil: Graphics | null = null;
  private portalRoot: Node | null = null;
  private pageHost: Node | null = null;
  private effectHost: Node | null = null;
  private page: Node | null = null;
  private pageOpacity: UIOpacity | null = null;
  private header: Node | null = null;
  private kicker: Label | null = null;
  private heading: Label | null = null;
  private subtitle: Label | null = null;
  private scroll: ScrollView | null = null;
  private viewport: Node | null = null;
  private content: Node | null = null;
  private items: Node | null = null;
  private footer: Node | null = null;
  private notice: Label | null = null;
  private noticeHeight = 0;
  private noticeIsError = false;
  private primary: Control | null = null;
  private soundSettings: Control | null = null;
  private recordsIcon: Node | null = null;
  private identityDetails: UIOpacity | null = null;
  private readonly utilityControls: Control[] = [];
  private readonly reels: Reel[] = [];
  private readonly slots: CardSlot[] = [];
  private readonly rings: PortalRing[] = [];
  private readonly streaks: StarStreak[] = [];
  private readonly shockwaves: Shockwave[] = [];

  onLoad(): void {
    this.ensureBuilt();
    if (!this.page) this.showHome();
  }

  /** Also builds in non-engine hosts, where addComponent does not run onLoad. */
  public init(callbacks: OpeningCallbacks): void {
    this.callbacks = callbacks;
    this.ensureBuilt();
    if (!this.page) this.showHome();
    else this.refreshActions();
  }

  public setCards(cards: readonly OpeningCard[]): void {
    // The production pool belongs to the engine, not to the presentation layer.
    this.cards = cards;
    if (this.screenKind === 'identity') this.refreshActions();
  }

  public showHome(): void {
    this.beginScreen('home');
    GameAudio.instance?.playMusic('home');
    GameAudio.instance?.playAmbience(null);
    this.cards = [];
    this.kicker!.string = '历史重开模拟器';
    this.kicker!.node.setPosition(-185, -44, 0);
    this.kicker!.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.kicker!.node.getComponent(UITransform)!.setContentSize(280, 52);
    this.heading!.node.active = false;
    this.subtitle!.node.active = false;
    this.soundSettings = this.makeControl(this.header!, '声音', 86, -44, 88, 88, false,
      () => this.callbacks?.onSoundSettings?.());
    this.utilityControls.push(
      this.soundSettings,
      this.makeControl(this.header!, '成就', 190, -44, 88, 88, false, () => this.callbacks?.onAchievements()),
      this.makeControl(this.header!, '统计', 294, -44, 88, 88, false, () => this.callbacks?.onStats()),
    );
    this.decorateControl(this.utilityControls[1], 'icons/milestone');
    this.decorateControl(this.utilityControls[2], 'icons/life');
    this.text(this.items!, 'GameTitle', '时空词条', 0, -140, CONTENT_WIDTH, 124, 88, INK.text, true).isBold = true;
    this.text(this.items!, 'HomePremise', '带上一件现代物品，\n去明朝过一生。', 0, -252, 600, 100, 34, INK.text, true);
    this.text(this.items!, 'HomeHint', '出发前，先看看你的身份。', 0, -486, 610, 48, 28, INK.secondary, true);
    this.naturalHeight = 560;
    this.primary = this.makeControl(this.items!, '我要穿越', 0, -390, CONTENT_WIDTH, 112, true, () => this.beginJourney());
    this.setNotice('本局进度仅临时保留，关闭或刷新后不能继续。');
    this.refreshActions();
    this.layout();
  }

  public showIdentity(player: GameView['player']): void {
    this.beginScreen('identity');
    this.revealDone = false;
    this.setHeader('01 / 确认身份', '你将来到明朝', '年份、年龄和身份，正在揭晓。');
    const era = this.makeNode(this.items!, 'EraPlaque', CONTENT_WIDTH, 92, 0, -46);
    const eraInk = era.addComponent(Graphics);
    eraInk.strokeColor = INK.portalBright;
    eraInk.lineWidth = 1.5;
    eraInk.moveTo(-250, 0);
    eraInk.lineTo(-104, 0);
    eraInk.moveTo(104, 0);
    eraInk.lineTo(250, 0);
    eraInk.stroke();
    this.text(era, 'EraName', '明朝', 0, 0, 180, 80, 54, INK.cyan, true).isBold = true;

    const yearValues: string[] = [];
    for (let year = rulesJson.opening.year_min; year <= rulesJson.opening.year_max; year++) yearValues.push(`${year} 年`);
    const ageValues = rulesJson.age_bands.flatMap(band => [`${band.min} 岁`, `${band.max} 岁`]);
    const identityValues = [...new Set(eraJson.backgrounds.map(background => EnumMapper.translateIdentity(background.identity_id)))];
    const values = [`${player.calendar_year} 年`, `${player.age} 岁`, EnumMapper.translateIdentity(player.identity_id)];
    const candidates = [yearValues, ageValues, identityValues];
    const captions = ['年份', '年龄', '身份'];
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 220;
      const well = this.makeNode(this.items!, `IdentityWell_${i}`, 204, 218, x, -244);
      const graphics = well.addComponent(Graphics);
      this.panel(graphics, 204, 218, INK.inset, INK.border, 14);
      this.text(well, `IdentityCaption_${i}`, captions[i], 0, 68, 184, 38, 26, INK.secondary, true);
      this.makeReel(well, `IdentityReel_${i}`, values[i], candidates[i], 180, 84, 36, 0, -10, 1.02 + i * 0.24, null);
      graphics.strokeColor = INK.portalBright;
      graphics.lineWidth = 2;
      graphics.moveTo(-72, -69);
      graphics.lineTo(72, -69);
      graphics.stroke();
    }
    const details = this.makeNode(this.items!, 'IdentityDetails', CONTENT_WIDTH, 292, 0, -382);
    details.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    const regionArt = REGION_ART[player.region_id];
    if (regionArt) createArt(details, `RegionArt_${player.region_id}`, regionArt, CONTENT_WIDTH, 204, 0, -102);
    const casteArt = CASTE_ART[player.caste_id];
    if (casteArt) createArt(details, `CasteArt_${player.caste_id}`, casteArt, 72, 72, -280, -250);
    this.text(details, 'IdentityDetailsLabel', `${EnumMapper.translateRegion(player.region_id)} · ${EnumMapper.translateCaste(player.caste_id)}`,
      40, -250, CONTENT_WIDTH - 96, 84, 30, INK.secondary, true);
    this.identityDetails = details.addComponent(UIOpacity);
    this.identityDetails.opacity = 0;
    this.naturalHeight = 708;
    this.primary = this.makeControl(this.footer!, '带一个现代物品', 0, 0, CONTENT_WIDTH, 104, true, () => {
      if (this.revealDone && this.cards.length > 0) this.showCards(this.cards);
    });
    this.setNotice('正在揭晓你的开局身份…');
    this.refreshActions();
    this.layout();
  }

  public showCards(cards: readonly OpeningCard[]): void {
    this.setCards(cards);
    this.beginScreen('cards');
    this.revealDone = cards.length === 0;
    this.setHeader('02 / 选择物品', '只能带走一件', '三件同时抽取，依次揭晓。');
    const candidates = cards.map(card => card.name);
    let offset = 8;
    for (let i = 0; i < cards.length; i++) {
      const slot = this.makeCard(cards[i], i, candidates, offset);
      this.slots.push(slot);
      offset += slot.height + 16;
    }
    this.naturalHeight = Math.max(120, offset - 8);
    this.primary = this.makeControl(this.footer!, '穿越', 0, 0, CONTENT_WIDTH, 104, true, () => { void this.enter(); });
    this.setNotice(cards.length > 0 ? '正在揭晓物品，稍后选择一件。' : '未能读取本次物品，请返回首页重新开始。', cards.length === 0);
    if (cards.length === 0) {
      this.makeControl(this.items!, '返回首页', 0, -60, CONTENT_WIDTH, 96, false, () => this.showHome());
    }
    this.refreshActions();
    this.layout();
  }

  public showRecords(title: string, text: string): void {
    this.beginScreen('records');
    this.centerContent = false;
    this.setHeader('本机记录', title, '上下滑动，查看完整记录。');
    this.recordsIcon = createArt(this.header!, 'RecordsIcon', title === '成就' ? 'icons/milestone' : 'icons/life', 42, 42, -110, -76);
    const records = this.text(this.items!, 'RecordsText', text, 0, 0, CONTENT_WIDTH - 24, 44, 30, INK.text);
    records.node.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    this.naturalHeight = this.measure(records, CONTENT_WIDTH - 24) + 32;
    this.primary = this.makeControl(this.footer!, '返回首页', 0, 0, CONTENT_WIDTH, 104, true, () => this.showHome());
    this.setNotice('');
    this.refreshActions();
    this.layout();
  }

  public showError(message: string): void {
    this.ensureBuilt();
    if (!this.page) this.showHome();
    this.busy = false;
    this.setNotice(message, true);
    this.refreshActions();
  }

  public resize(height: number): void {
    if (!Number.isFinite(height) || height <= 0) return;
    this.viewportHeight = height;
    this.ensureBuilt();
    this.node.getComponent(UITransform)!.setContentSize(WIDTH, height);
    this.drawBackground();
    this.layout();
  }

  public hide(): void {
    this.revision++;
    this.busy = false;
    this.cancelMotion();
    this.node.active = false;
  }

  onDisable(): void {
    this.cancelMotion();
  }

  onDestroy(): void {
    this.disposed = true;
    this.revision++;
    this.reels.length = 0;
    this.slots.length = 0;
    this.utilityControls.length = 0;
    this.rings.length = 0;
    this.streaks.length = 0;
    this.shockwaves.length = 0;
    this.callbacks = null;
    this.cards = [];
  }

  update(dt: number): void {
    if (!this.built || this.disposed || !this.enabledInHierarchy || !Number.isFinite(dt) || dt <= 0) return;
    this.syncMotionPreference();
    this.time += dt;
    if (this.entranceElapsed >= 0 && this.pageOpacity) {
      this.entranceElapsed += dt;
      this.pageOpacity.opacity = Math.round(255 * Math.min(1, this.entranceElapsed / 0.22));
      if (this.entranceElapsed >= 0.22) this.entranceElapsed = -1;
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.artElapsed < 0 || !slot.art || !slot.artOpacity) continue;
      slot.artElapsed += dt;
      const progress = Math.min(1, slot.artElapsed / CARD_ART_DURATION);
      const eased = 1 - (1 - progress) * (1 - progress);
      const scale = 0.96 + 0.04 * eased;
      slot.art.setPosition(CARD_ART_X, CARD_ART_Y - 6 * (1 - eased), 0);
      slot.art.setScale(scale, scale, 1);
      slot.artOpacity.opacity = Math.round(255 * eased);
      if (progress >= 1) slot.artElapsed = -1;
    }
    for (let i = 0; i < this.reels.length; i++) {
      const reel = this.reels[i];
      if (reel.settled) continue;
      reel.elapsed += dt;
      const progress = Math.min(1, reel.elapsed / reel.duration);
      if (this.motionReduced) reel.opacity.opacity = Math.round(255 * progress);
      else reel.strip.setPosition(0, reel.distance * this.reelProgress(progress), 0);
      if (progress >= 1) this.settleReel(reel, true);
    }
    if (!this.motionReduced) this.advanceAtmosphere(dt);
    for (let i = 0; i < this.shockwaves.length; i++) {
      const wave = this.shockwaves[i];
      if (!wave.node.active) continue;
      wave.elapsed += dt;
      const progress = Math.min(1, wave.elapsed / wave.duration);
      const eased = 1 - (1 - progress) * (1 - progress);
      const scale = 1 + eased * wave.expansion;
      wave.node.setScale(scale, scale, 1);
      wave.opacity.opacity = Math.round(180 * (1 - progress) * (1 - progress));
      if (progress >= 1) wave.node.active = false;
    }
    if (this.shakeElapsed >= 0 && this.page) {
      this.shakeElapsed += dt;
      const progress = Math.min(1, this.shakeElapsed / 0.24);
      this.page.setPosition(Math.sin(progress * Math.PI * 5) * 3.5 * (1 - progress), 0, 0);
      if (progress >= 1) this.shakeElapsed = -1;
    }
  }

  private ensureBuilt(): void {
    if (this.built || this.disposed) return;
    this.built = true;
    this.node.layer = Layers.Enum.UI_2D;
    const transform = this.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 0.5);
    transform.setContentSize(WIDTH, this.viewportHeight);
    if (!this.getComponent(BlockInputEvents)) this.addComponent(BlockInputEvents);
    const host = globalThis as typeof globalThis & { matchMedia?: (query: string) => MotionPreference };
    this.motionPreference = host.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    this.motionReduced = this.reducedMotion || (this.motionPreference?.matches ?? false);
    const background = this.makeNode(this.node, 'OpeningOpaqueBackground', WIDTH, this.viewportHeight);
    this.background = background.addComponent(Graphics);
    this.homeArt = createArt(this.node, 'OpeningHomeArt', 'scenes/home', WIDTH, WIDTH * 8 / 5);
    this.homeVeil = this.makeNode(this.node, 'OpeningHomeVeil', WIDTH, this.viewportHeight).addComponent(Graphics);
    this.portalRoot = this.makeNode(this.node, 'OpeningPortal', WIDTH, this.viewportHeight);
    this.buildAtmosphere();
    this.pageHost = this.makeNode(this.node, 'OpeningPageHost', WIDTH, this.viewportHeight);
    this.effectHost = this.makeNode(this.node, 'OpeningRarityEffects', WIDTH, this.viewportHeight);
    for (let i = 0; i < 3; i++) {
      const node = this.makeNode(this.effectHost, `RarityShockwave_${i}`, 100, 100);
      this.shockwaves.push({ node, graphics: node.addComponent(Graphics), opacity: node.addComponent(UIOpacity), elapsed: 0, duration: 0.65, expansion: 7 });
      node.active = false;
    }
    // Respect an explicit resize made before init rather than replacing it here.
    const visibleHeight = view.getVisibleSize().height;
    if (this.viewportHeight === 1334 && visibleHeight > 0) this.viewportHeight = visibleHeight;
    transform.setContentSize(WIDTH, this.viewportHeight);
    this.drawBackground();
  }

  private beginScreen(kind: ScreenKind): void {
    this.ensureBuilt();
    this.revision++;
    this.cancelMotion();
    this.reels.length = 0;
    this.slots.length = 0;
    this.utilityControls.length = 0;
    this.remainingReels = 0;
    this.identityDetails = null;
    this.selectedId = null;
    this.busy = false;
    this.revealDone = true;
    this.centerContent = true;
    this.naturalHeight = 0;
    this.noticeHeight = 0;
    this.noticeIsError = false;
    this.primary = null;
    this.soundSettings = null;
    this.recordsIcon = null;
    this.screenKind = kind;
    this.homeArt!.active = kind === 'home';
    this.homeVeil!.node.active = kind === 'home';
    if (this.page) {
      this.page.active = false;
      this.page.parent = null;
      this.page.destroy();
    }
    this.node.active = true;
    this.page = this.makeNode(this.pageHost!, `OpeningPage_${kind}`, WIDTH, this.viewportHeight);
    this.pageOpacity = this.page.addComponent(UIOpacity);
    this.pageOpacity.opacity = this.motionReduced ? 255 : 0;
    this.entranceElapsed = this.motionReduced ? -1 : 0;
    this.header = this.makeNode(this.page, 'OpeningHeader', WIDTH, 190);
    this.kicker = this.text(this.header, 'OpeningStep', '', 0, -18, CONTENT_WIDTH, 36, 24, INK.cyan, true);
    this.heading = this.text(this.header, 'OpeningHeading', '', 0, -76, CONTENT_WIDTH, 72, 50, INK.text, true);
    this.heading.isBold = true;
    this.subtitle = this.text(this.header, 'OpeningSubtitle', '', 0, -140, CONTENT_WIDTH, 44, 28, INK.secondary, true);
    const scrollNode = this.makeNode(this.page, 'OpeningScrollView', VIEWPORT_WIDTH, 600);
    this.viewport = this.makeNode(scrollNode, 'Viewport', VIEWPORT_WIDTH, 600);
    this.viewport.addComponent(Mask);
    this.content = this.makeNode(this.viewport, 'Content', VIEWPORT_WIDTH, 600);
    this.content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    this.items = this.makeNode(this.content, 'OpeningItems', CONTENT_WIDTH, 600);
    this.items.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    this.scroll = scrollNode.addComponent(ScrollView);
    this.scroll.content = this.content;
    this.scroll.horizontal = false;
    this.scroll.vertical = true;
    this.scroll.cancelInnerEvents = true;
    this.footer = this.makeNode(this.page, 'OpeningFooter', WIDTH, 220);
    this.notice = this.text(this.footer, 'OpeningNotice', '', 0, 0, CONTENT_WIDTH, 36, 26, INK.secondary, true);
    this.notice.node.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    for (let i = 0; i < this.rings.length; i++) this.rings[i].opacity.opacity = kind === 'cards' ? 235 : 150;
    for (let i = 0; i < this.streaks.length; i++) this.streaks[i].node.active = i < (kind === 'cards' ? 32 : 16);
  }

  private setHeader(kicker: string, heading: string, subtitle: string): void {
    this.kicker!.string = kicker;
    this.heading!.string = heading;
    this.subtitle!.string = subtitle;
  }

  private layout(): void {
    if (!this.page || !this.scroll || !this.content || !this.items || !this.footer || !this.viewport) return;
    const home = this.screenKind === 'home';
    const compact = this.viewportHeight < 1200;
    const topInset = compact ? 24 : 48;
    const bottomInset = compact ? 24 : 48;
    const headerHeight = home ? 112 : compact ? 90 : 184;
    const actionHeight = home ? 112 : compact ? 88 : 104;
    const footerActionHeight = home ? 0 : actionHeight;
    const footerHeight = bottomInset + footerActionHeight + (this.noticeHeight > 0 ? this.noticeHeight + (home ? 0 : 16) : 0) + 24;
    const top = this.viewportHeight / 2 - topInset - headerHeight;
    const bottom = -this.viewportHeight / 2 + footerHeight;
    const bodyHeight = Math.max(48, top - bottom);
    const oldOffset = this.scroll.getScrollOffset();
    this.page.getComponent(UITransform)!.setContentSize(WIDTH, this.viewportHeight);
    this.pageHost!.getComponent(UITransform)!.setContentSize(WIDTH, this.viewportHeight);
    this.header!.setPosition(0, this.viewportHeight / 2 - topInset, 0);
    if (this.screenKind !== 'home') {
      this.kicker!.node.active = !compact;
      this.subtitle!.node.active = !compact;
      this.heading!.node.setPosition(0, compact ? -40 : -76, 0);
      this.recordsIcon?.setPosition(-110, compact ? -40 : -76, 0);
    }
    this.scroll.stopAutoScroll();
    this.scroll.node.setPosition(0, (top + bottom) / 2, 0);
    this.scroll.node.getComponent(UITransform)!.setContentSize(VIEWPORT_WIDTH, bodyHeight);
    this.viewport.getComponent(UITransform)!.setContentSize(VIEWPORT_WIDTH, bodyHeight);
    this.content.getComponent(UITransform)!.setContentSize(VIEWPORT_WIDTH, Math.max(bodyHeight, this.naturalHeight));
    this.content.setPosition(0, bodyHeight / 2, 0);
    this.items.getComponent(UITransform)!.setContentSize(CONTENT_WIDTH, this.naturalHeight);
    this.items.setPosition(0, this.centerContent ? -Math.max(0, (bodyHeight - this.naturalHeight) / 2) : 0, 0);
    this.scroll.scrollToOffset(oldOffset, 0);
    this.footer.setPosition(0, -this.viewportHeight / 2 + bottomInset, 0);
    this.footer.getComponent(UITransform)!.setContentSize(WIDTH, footerHeight);
    if (this.primary) {
      this.primary.height = actionHeight;
      this.primary.node.setPosition(0, home ? -390 : actionHeight / 2, 0);
      this.primary.node.getComponent(UITransform)!.setContentSize(CONTENT_WIDTH, actionHeight);
      this.primary.label.node.getComponent(UITransform)!.setContentSize(CONTENT_WIDTH - 32, actionHeight - 12);
      this.drawControl(this.primary);
    }
    this.notice!.node.setPosition(0, footerActionHeight + (home ? 0 : 16) + this.noticeHeight, 0);
    this.notice!.node.active = this.noticeHeight > 0;
    this.portalRoot!.setPosition(0, this.screenKind === 'home' ? (top + bottom) / 2 + 12 : 44, 0);
    this.portalReach = Math.sqrt(WIDTH * WIDTH / 4 + this.viewportHeight * this.viewportHeight / 4) + 200;
    this.positionStars();
  }

  private beginJourney(): void {
    if (this.busy || !this.callbacks) return;
    this.busy = true;
    this.setNotice('正在准备穿越…');
    this.refreshActions();
    try { this.callbacks.onStart(); }
    catch (error) { this.showError(EnumMapper.playerError(error)); }
  }

  private async enter(): Promise<void> {
    if (this.busy || !this.revealDone || !this.selectedId || !this.callbacks) return;
    const revision = this.revision;
    this.busy = true;
    this.setNotice('正在进入本局人生…');
    this.refreshActions();
    try {
      await this.callbacks.onEnter(this.selectedId);
      // Success is the host's cutover: only it may hide this surface.
    } catch (error) {
      if (!this.disposed && revision === this.revision) this.showError(EnumMapper.playerError(error));
    }
  }

  private refreshActions(): void {
    if (!this.primary) return;
    const ready = !!this.callbacks && !this.busy;
    let enabled = ready;
    let title = '返回首页';
    if (this.screenKind === 'home') title = this.busy ? '正在准备…' : '我要穿越';
    if (this.screenKind === 'identity') {
      enabled = ready && this.revealDone && this.cards.length > 0;
      title = this.revealDone ? '带一个现代物品' : '身份揭晓中…';
    }
    if (this.screenKind === 'cards') {
      enabled = ready && this.revealDone && this.selectedId !== null;
      title = this.busy ? '正在穿越…' : this.revealDone ? '穿越' : '物品揭晓中…';
    }
    this.primary.label.string = title;
    this.primary.button.interactable = enabled;
    this.drawControl(this.primary);
    for (let i = 0; i < this.utilityControls.length; i++) {
      const control = this.utilityControls[i];
      control.button.interactable = ready && (control !== this.soundSettings || !!this.callbacks?.onSoundSettings);
      this.drawControl(control);
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.button.interactable = ready && this.revealDone && slot.settled;
      slot.selection.string = !slot.settled ? '正在揭晓' : !this.revealDone ? '稍后可选' : this.selectedId === slot.card.id ? '已选择' : '点击选择';
      this.drawCard(slot);
    }
  }

  private makeCard(card: OpeningCard, index: number, candidates: readonly string[], offset: number): CardSlot {
    // Keep all three moving reels visible together, even on shorter phones.
    // The selected item's complete description occupies the fixed footer below.
    const height = 152;
    const node = this.makeNode(this.items!, `CardOffer_${card.id}`, CONTENT_WIDTH, height, 0, -offset);
    node.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    const graphics = node.addComponent(Graphics);
    this.text(node, 'OfferNumber', `${index + 1}`.padStart(2, '0'), CARD_ART_X, -22, 48, 36, 26, INK.secondary, true);
    const rarity = this.text(node, 'OfferRarity', card.rarity, 260, -48, 92, 42, 28, this.rarityColor(card.rarity), true);
    rarity.isBold = true;
    const rarityOpacity = rarity.node.addComponent(UIOpacity);
    rarityOpacity.opacity = 0;
    const selection = this.text(node, 'OfferSelection', '正在揭晓', -12, -height + 34, 380, 40, 26, INK.secondary);
    const artPath = ITEM_ART[card.id];
    const art = artPath ? createArt(node, `OfferArt_${card.id}`, artPath, 96, 96, CARD_ART_X, CARD_ART_Y) : null;
    const artOpacity = art?.addComponent(UIOpacity) ?? null;
    if (artOpacity) artOpacity.opacity = 0;
    const slot: CardSlot = {
      card, node, graphics, height, rarity, rarityOpacity, selection,
      button: node.addComponent(Button), settled: false, pressed: false,
      art, artOpacity, artReady: false, artElapsed: -1,
    };
    const revision = this.revision;
    art?.on('art-ready', (relativePath: string) => {
      if (this.disposed || revision !== this.revision || relativePath !== artPath) return;
      slot.artReady = true;
      if (slot.settled) this.revealCardArt(slot);
    });
    slot.button.transition = Button.Transition.NONE;
    slot.button.interactable = false;
    this.makeReel(node, `CardReel_${card.id}`, card.name, candidates, 380, 80, 32, -12, -48, 1.52 + index * 0.42, slot);
    this.bindPress(node, slot.button, () => {
      if (this.busy || !this.revealDone) return;
      GameAudio.instance?.playCue('select');
      this.selectedId = card.id;
      this.setNotice(`已选择「${card.name}」\n${card.description}`);
      this.refreshActions();
    }, pressed => { slot.pressed = pressed; this.drawCard(slot); });
    this.drawCard(slot);
    return slot;
  }

  private revealCardArt(slot: CardSlot, animate = true): void {
    if (!slot.artReady || !slot.art || !slot.artOpacity) return;
    const reveal = animate && !this.motionReduced;
    slot.artElapsed = reveal ? 0 : -1;
    slot.artOpacity.opacity = reveal ? 0 : 255;
    slot.art.setPosition(CARD_ART_X, CARD_ART_Y - (reveal ? 6 : 0), 0);
    slot.art.setScale(reveal ? 0.96 : 1, reveal ? 0.96 : 1, 1);
  }

  private drawCard(slot: CardSlot): void {
    const selected = this.selectedId === slot.card.id;
    const color = this.rarityColor(slot.card.rarity);
    const graphics = slot.graphics;
    graphics.clear();
    graphics.fillColor = selected ? INK.selected : slot.pressed ? INK.pressed : INK.surface;
    graphics.strokeColor = selected ? INK.cyan : slot.settled ? color : INK.border;
    graphics.lineWidth = selected ? 3 : 1.5;
    graphics.roundRect(-CONTENT_WIDTH / 2, -slot.height, CONTENT_WIDTH, slot.height, 16);
    graphics.fill();
    graphics.stroke();
    if (slot.settled) {
      graphics.fillColor = color;
      graphics.roundRect(-CONTENT_WIDTH / 2 + 1, -slot.height + 18, 4, slot.height - 36, 2);
      graphics.fill();
    }
    graphics.strokeColor = selected ? INK.cyan : INK.border;
    graphics.lineWidth = 2;
    graphics.circle(280, -slot.height + 34, 13);
    graphics.stroke();
    if (selected) {
      graphics.moveTo(273, -slot.height + 34);
      graphics.lineTo(278, -slot.height + 29);
      graphics.lineTo(288, -slot.height + 40);
      graphics.stroke();
    }
    slot.selection.color = selected ? INK.cyan : INK.secondary;
  }

  private makeReel(parent: Node, name: string, result: string, candidates: readonly string[], width: number, height: number,
    fontSize: number, x: number, y: number, duration: number, slot: CardSlot | null): void {
    const viewport = this.makeNode(parent, name, width, height, x, y);
    viewport.addComponent(Mask);
    const opacity = viewport.addComponent(UIOpacity);
    const step = height + 24;
    const strip = this.makeNode(viewport, 'ReelStrip', width, step * (REEL_ROWS + 1));
    strip.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    for (let i = 0; i <= REEL_ROWS; i++) {
      const value = i === REEL_ROWS ? result : candidates.length > 0 ? candidates[(i + this.reels.length * 3) % candidates.length] : result;
      const label = this.text(strip, `ReelCell_${i}`, value, 0, -i * step, width, height, fontSize,
        i === REEL_ROWS ? INK.text : INK.secondary, true);
      label.isBold = true;
    }
    const reel: Reel = { strip, opacity, distance: REEL_ROWS * step, elapsed: 0,
      duration: this.motionReduced ? 0.12 + this.reels.length * 0.12 : duration, settled: false, slot };
    if (this.motionReduced) {
      strip.setPosition(0, reel.distance, 0);
      opacity.opacity = 0;
    }
    this.reels.push(reel);
    this.remainingReels++;
  }

  /** Constant-speed travel followed by a continuous, quadratic velocity decay. */
  private reelProgress(progress: number): number {
    const cruise = 0.55;
    const brake = 1 - cruise;
    const distance = cruise + brake / 3;
    if (progress <= cruise) return progress / distance;
    const t = (progress - cruise) / brake;
    return (cruise + brake * (t - t * t + t * t * t / 3)) / distance;
  }

  private settleReel(reel: Reel, celebrate: boolean): void {
    if (reel.settled) return;
    reel.settled = true;
    reel.strip.setPosition(0, reel.distance, 0);
    reel.opacity.opacity = 255;
    this.remainingReels--;
    if (celebrate) GameAudio.instance?.playCue(reel.slot ? 'reveal' : this.remainingReels === 0 ? 'identity' : 'reveal');
    if (reel.slot) {
      reel.slot.settled = true;
      reel.slot.rarityOpacity.opacity = 255;
      this.revealCardArt(reel.slot, celebrate);
      this.drawCard(reel.slot);
      if (celebrate && !this.motionReduced) this.reactToRarity(reel.slot);
    }
    if (this.remainingReels === 0) {
      this.revealDone = true;
      if (this.identityDetails) this.identityDetails.opacity = 255;
      if (!this.noticeIsError) this.setNotice(this.screenKind === 'identity'
        ? '身份已揭晓，接下来选一件现代物品。' : '物品已揭晓，点击一件查看说明。');
      this.refreshActions();
    }
  }

  private setNotice(message: string, error = false): void {
    if (!this.notice) return;
    this.notice.string = message;
    const description = this.screenKind === 'cards' && this.selectedId !== null && !this.busy && !error;
    this.notice.fontSize = description ? 28 : 26;
    this.notice.lineHeight = description ? 39 : 36;
    this.notice.horizontalAlign = description ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
    this.notice.color = error ? INK.error : description ? INK.text : INK.secondary;
    this.noticeIsError = error;
    this.noticeHeight = message.length > 0 ? this.measure(this.notice, CONTENT_WIDTH) : 0;
    this.layout();
  }

  private syncMotionPreference(): void {
    const reduced = this.reducedMotion || (this.motionPreference?.matches ?? false);
    if (reduced === this.motionReduced) return;
    this.motionReduced = reduced;
    if (reduced) this.cancelMotion();
  }

  private cancelMotion(): void {
    this.entranceElapsed = -1;
    if (this.pageOpacity) this.pageOpacity.opacity = 255;
    this.shakeElapsed = -1;
    if (this.page) this.page.setPosition(0, 0, 0);
    for (let i = 0; i < this.shockwaves.length; i++) this.shockwaves[i].node.active = false;
    for (let i = 0; i < this.reels.length; i++) this.settleReel(this.reels[i], false);
    for (let i = 0; i < this.slots.length; i++) this.revealCardArt(this.slots[i], false);
  }

  private reactToRarity(slot: CardSlot): void {
    const rarity = slot.card.rarity;
    if (rarity !== 'SR' && rarity !== 'SSR') return;
    let wave = this.shockwaves[0];
    for (let i = 0; i < this.shockwaves.length; i++) {
      if (!this.shockwaves[i].node.active) { wave = this.shockwaves[i]; break; }
    }
    wave.elapsed = 0;
    wave.duration = rarity === 'SSR' ? 0.78 : 0.58;
    wave.expansion = rarity === 'SSR' ? 10 : 7;
    wave.graphics.clear();
    wave.graphics.strokeColor = this.rarityColor(rarity);
    wave.graphics.lineWidth = rarity === 'SSR' ? 2.4 : 1.8;
    wave.graphics.circle(0, 0, 46);
    wave.graphics.stroke();
    if (rarity === 'SR') {
      for (let i = 0; i < 8; i++) {
        const angle = i * TAU / 8;
        wave.graphics.moveTo(Math.cos(angle) * 52, Math.sin(angle) * 52);
        wave.graphics.lineTo(Math.cos(angle) * 60, Math.sin(angle) * 60);
      }
      wave.graphics.stroke();
    }
    const y = this.scroll!.node.position.y + this.content!.position.y + this.items!.position.y + slot.node.position.y - slot.height / 2;
    wave.node.setPosition(0, y, 0);
    wave.node.setScale(1, 1, 1);
    wave.opacity.opacity = 180;
    wave.node.active = true;
    if (rarity === 'SSR') this.shakeElapsed = 0;
  }

  private buildAtmosphere(): void {
    for (let i = 0; i < 4; i++) {
      const radius = 160 + i * 94;
      const node = this.makeNode(this.portalRoot!, `PortalRing_${i}`, radius * 2 + 32, radius * 2 + 32);
      const graphics = node.addComponent(Graphics);
      graphics.strokeColor = INK.portalDim;
      graphics.lineWidth = i === 3 ? 14 : 8;
      graphics.circle(0, 0, radius);
      graphics.stroke();
      graphics.strokeColor = INK.portal;
      graphics.lineWidth = 1.5;
      graphics.circle(0, 0, radius - 8);
      graphics.circle(0, 0, radius + 8);
      graphics.stroke();
      graphics.strokeColor = INK.portalBright;
      graphics.lineWidth = 2;
      for (let segment = 0; segment < 3; segment++) {
        const start = segment * TAU / 3 + i * 0.42;
        graphics.arc(0, 0, radius, start, start + 0.65, false);
        graphics.stroke();
      }
      graphics.strokeColor = INK.portal;
      for (let tick = 0; tick < 24; tick++) {
        const angle = tick * TAU / 24;
        graphics.moveTo(Math.cos(angle) * (radius - 5), Math.sin(angle) * (radius - 5));
        graphics.lineTo(Math.cos(angle) * (radius + (tick % 3 === 0 ? 10 : 3)), Math.sin(angle) * (radius + (tick % 3 === 0 ? 10 : 3)));
      }
      graphics.stroke();
      node.setScale(1, 1.14, 1);
      const opacity = node.addComponent(UIOpacity);
      opacity.opacity = 150;
      this.rings.push({ node, opacity, speed: i % 2 === 0 ? 2.4 / (i + 1) : -2 / (i + 1), phase: i * 1.4 });
    }
    for (let i = 0; i < 32; i++) {
      const angle = i * 2.3999632297;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const node = this.makeNode(this.portalRoot!, `PortalStar_${i}`, 40, 40);
      const graphics = node.addComponent(Graphics);
      graphics.strokeColor = INK.star;
      graphics.fillColor = INK.star;
      graphics.lineWidth = i % 4 === 0 ? 1.5 : 1;
      graphics.moveTo(0, 0);
      graphics.lineTo(dx * (12 + i % 4 * 7), dy * (12 + i % 4 * 7));
      graphics.stroke();
      graphics.circle(0, 0, 1.4);
      graphics.fill();
      this.streaks.push({ node, opacity: node.addComponent(UIOpacity), dx, dy, phase: (i * 0.61803398875) % 1, speed: 0.055 + i % 5 * 0.009 });
    }
    this.positionStars();
  }

  private advanceAtmosphere(dt: number): void {
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      ring.node.angle = (ring.node.angle + dt * ring.speed) % 360;
      const scale = 1 + Math.sin(this.time * 0.5 + ring.phase) * 0.012;
      ring.node.setScale(scale, scale * 1.14, 1);
    }
    for (let i = 0; i < this.streaks.length; i++) {
      const streak = this.streaks[i];
      if (!streak.node.active) continue;
      streak.phase = (streak.phase + dt * streak.speed * (this.screenKind === 'cards' ? 1.6 : 1)) % 1;
    }
    this.positionStars();
  }

  private positionStars(): void {
    for (let i = 0; i < this.streaks.length; i++) {
      const streak = this.streaks[i];
      if (!streak.node.active) continue;
      const distance = 80 + streak.phase * streak.phase * this.portalReach;
      streak.node.setPosition(streak.dx * distance, streak.dy * distance, 0);
      streak.opacity.opacity = Math.round(Math.sin(streak.phase * Math.PI) * (this.screenKind === 'cards' ? 160 : 100));
    }
  }

  private drawBackground(): void {
    if (!this.background) return;
    const graphics = this.background;
    graphics.clear();
    graphics.fillColor = INK.background;
    graphics.rect(-WIDTH / 2, -this.viewportHeight / 2, WIDTH, this.viewportHeight);
    graphics.fill();
    graphics.strokeColor = INK.portalDim;
    graphics.lineWidth = 1;
    graphics.moveTo(-350, -this.viewportHeight / 2);
    graphics.lineTo(-350, this.viewportHeight / 2);
    graphics.moveTo(350, -this.viewportHeight / 2);
    graphics.lineTo(350, this.viewportHeight / 2);
    graphics.stroke();
    graphics.node.getComponent(UITransform)!.setContentSize(WIDTH, this.viewportHeight);
    this.homeArt?.getComponent(UITransform)!.setContentSize(
      Math.max(WIDTH, this.viewportHeight * 5 / 8), Math.max(this.viewportHeight, WIDTH * 8 / 5));
    if (this.homeVeil) {
      this.homeVeil.clear();
      this.homeVeil.fillColor = INK.homeVeil;
      this.homeVeil.rect(-WIDTH / 2, -this.viewportHeight / 2, WIDTH, this.viewportHeight);
      this.homeVeil.fill();
      this.homeVeil.node.getComponent(UITransform)!.setContentSize(WIDTH, this.viewportHeight);
    }
  }

  private decorateControl(control: Control, relativePath: string): void {
    createArt(control.node, 'ControlIcon', relativePath, 30, 30, 0, 20);
    control.label.node.setPosition(0, -18, 0);
    control.label.node.getComponent(UITransform)!.setContentSize(control.width - 24, 42);
  }

  private makeControl(parent: Node, title: string, x: number, y: number, width: number, height: number, primary: boolean, activate: () => void): Control {
    const node = this.makeNode(parent, `Btn_${title}`, width, height, x, y);
    const graphics = node.addComponent(Graphics);
    const button = node.addComponent(Button);
    button.transition = Button.Transition.NONE;
    const label = this.text(node, 'Title', title, 0, 0, width - 24, height - 12, primary ? 34 : 28, primary ? INK.background : INK.secondary, true);
    label.isBold = primary;
    const control: Control = { node, button, label, graphics, width, height, primary, pressed: false };
    this.bindPress(node, button, () => {
      GameAudio.instance?.playCue('tap');
      activate();
    }, pressed => { control.pressed = pressed; this.drawControl(control); });
    this.drawControl(control);
    return control;
  }

  private drawControl(control: Control): void {
    const enabled = control.button.interactable;
    const fill = control.primary && enabled ? INK.cyan : control.pressed && enabled ? INK.pressed : INK.surface;
    const border = control.primary && enabled ? INK.cyan : INK.border;
    this.panel(control.graphics, control.width, control.height, fill, border, 14);
    control.label.color = !enabled ? INK.disabled : control.primary ? INK.background : INK.text;
  }

  private bindPress(node: Node, button: Button, activate: () => void, paint: (pressed: boolean) => void): void {
    let originX = 0;
    let originY = 0;
    let tracking = false;
    let dragged = false;
    const moved = (event?: EventTouch): boolean => {
      if (!event || !tracking) return false;
      const point = event.getUILocation();
      return Math.abs(point.x - originX) + Math.abs(point.y - originY) > 14;
    };
    const restore = (): void => {
      node.setScale(1, 1, 1);
      paint(false);
    };
    node.on(Node.EventType.TOUCH_START, (event?: EventTouch) => {
      if (!button.interactable) return;
      const point = event?.getUILocation();
      originX = point?.x ?? 0;
      originY = point?.y ?? 0;
      tracking = true;
      dragged = false;
      paint(true);
      if (!this.motionReduced) node.setScale(0.98, 0.98, 1);
    });
    node.on(Node.EventType.TOUCH_MOVE, (event?: EventTouch) => {
      dragged = dragged || moved(event);
      if (dragged) restore();
    });
    node.on(Node.EventType.TOUCH_CANCEL, () => {
      dragged = true;
      tracking = false;
      restore();
    });
    node.on(Node.EventType.TOUCH_END, (event?: EventTouch) => {
      const cancelled = dragged || moved(event);
      tracking = false;
      dragged = false;
      restore();
      if (button.interactable && !cancelled) activate();
    });
  }

  private rarityColor(rarity: string): Color {
    return rarity === 'SSR' ? INK.gold : rarity === 'SR' ? INK.purple : rarity === 'R' ? INK.cyan : INK.secondary;
  }

  private makeNode(parent: Node, name: string, width: number, height: number, x = 0, y = 0): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.addComponent(UITransform).setContentSize(width, height);
    node.setPosition(x, y, 0);
    parent.addChild(node);
    return node;
  }

  private text(parent: Node, name: string, value: string, x: number, y: number, width: number, height: number, size: number, color: Color, centered = false): Label {
    const node = this.makeNode(parent, name, width, height, x, y);
    const label = node.addComponent(Label);
    label.string = value;
    label.fontSize = size;
    label.lineHeight = Math.round(size * 1.4);
    label.color = color;
    label.horizontalAlign = centered ? Label.HorizontalAlign.CENTER : Label.HorizontalAlign.LEFT;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.CLAMP;
    return label;
  }

  private measure(label: Label, width: number): number {
    label.overflow = Label.Overflow.RESIZE_HEIGHT;
    label.node.getComponent(UITransform)!.setContentSize(width, label.lineHeight);
    label.updateRenderData(true);
    const columns = Math.max(1, Math.floor(width / label.fontSize));
    const lines = label.string.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0);
    const height = Math.max(label.node.getComponent(UITransform)!.height, lines * label.lineHeight);
    label.node.getComponent(UITransform)!.setContentSize(width, height);
    label.verticalAlign = Label.VerticalAlign.TOP;
    return height;
  }

  private panel(graphics: Graphics, width: number, height: number, fill: Color, border: Color, radius: number): void {
    graphics.clear();
    graphics.fillColor = fill;
    graphics.strokeColor = border;
    graphics.lineWidth = 1.5;
    graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    graphics.fill();
    graphics.stroke();
  }
}
