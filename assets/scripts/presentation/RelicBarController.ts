import {
  _decorator,
  Component,
  Node,
  Label,
  Graphics,
  UITransform,
  Color,
  EventTouch,
  tween,
  v3,
  Vec3,
  UIOpacity,
} from 'cc';
import cardsJson from '../../resources/data/ming_end/cards.json';

const { ccclass } = _decorator;
const SHELF_WIDTH = 120;
const SHELF_HEIGHT = 934;
const SLOT_SIZE = 96;
const DETAIL_WIDTH = 360;
const DETAIL_HEIGHT = 276;
const DETAIL_X = -(SHELF_WIDTH + DETAIL_WIDTH) / 2 - 12;
const palette = {
  background: new Color(19, 21, 28, 255),
  panel: new Color(26, 29, 38, 255),
  border: new Color(53, 59, 73, 255),
  text: new Color(237, 241, 247, 255),
  secondary: new Color(140, 150, 168, 255),
  cyan: new Color(0, 240, 255, 255),
  gold: new Color(255, 190, 11, 255),
  purple: new Color(199, 125, 255, 255),
};

interface RelicIdentity {
  stamp: string;
  flagPrefix?: string;
  effect?: 'grain' | 'clean' | 'beam';
}

// ID 只决定表现，不授予物品、属性或被动；名称和说明始终来自实际入架数据。
const RELIC_IDENTITIES: Record<string, RelicIdentity> = {
  CARD_MODERN_CORN: { stamp: '玉米', flagPrefix: 'F_MOD_CORN_', effect: 'grain' },
  CARD_MODERN_ANTIBIOTIC: { stamp: '医册', flagPrefix: 'F_MOD_HEALER_', effect: 'clean' },
  CARD_MODERN_FLASHLIGHT: { stamp: '手电', flagPrefix: 'F_MOD_FLASHLIGHT_', effect: 'beam' },
  CARD_MODERN_CALCULATOR: { stamp: '算器' },
  CARD_MODERN_GLUE: { stamp: '胶刀' },
  CARD_MODERN_LIGHTER: { stamp: '火机' },
  CARD_NATIVE_BOWL: { stamp: '陶碗' },
  CARD_NATIVE_BOOK: { stamp: '书秤' },
};

const CHECK_NAMES: Record<string, string> = {
  farming: '农桑',
  medicine: '防疫',
  night_patrol: '夜巡',
  accounting: '清账',
  practical_learning: '经世',
  crafting: '工艺',
  marching: '行军',
  street_trade: '市井',
};

export interface RelicItemData {
  id: string;
  name: string;
  desc: string;
  rarity?: string;
  perk?: string;
  passive?: string;
}

/** 五个真实空槽；仅 addRelic 收到的物品入架，成就反馈不会生成额外物品。 */
@ccclass('RelicBarController')
export class RelicBarController extends Component {
  private relics: RelicItemData[] = [];
  private slotNodes: Node[] = [];
  private detailPanel: Node | null = null;
  private activeSlotIndex = -1;
  private shelfHeight = SHELF_HEIGHT;
  private readonly animations = new Set<{ stop(): void }>();
  private readonly detailAnimations = new Set<{ stop(): void }>();
  private readonly feedbackKeys = new Set<string>();
  private readonly earnedFlags = new Set<string>();

  private reduceMotion(): boolean {
    const host = globalThis as typeof globalThis & { matchMedia?: (query: string) => { matches: boolean } };
    return host.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  public reset(): void {
    this.stopAnimations();
    for (const child of [...this.node.children]) child.destroy();
    this.node.removeAllChildren();
    this.relics = [];
    this.slotNodes = [];
    this.detailPanel = null;
    this.activeSlotIndex = -1;
    this.feedbackKeys.clear();
    this.earnedFlags.clear();
    this.setupSlots();
  }

  public setHeight(height: number): void {
    this.shelfHeight = height;
    if (this.slotNodes.length === 0) {
      this.setupSlots();
      return;
    }
    this.node.getComponent(UITransform)!.setContentSize(SHELF_WIDTH, height);
    const background = this.node.getComponent(Graphics)!;
    background.clear();
    background.fillColor = palette.background;
    background.rect(-SHELF_WIDTH / 2, -height / 2, SHELF_WIDTH, height);
    background.fill();
    background.fillColor = palette.border;
    background.rect(-SHELF_WIDTH / 2, -height / 2, 1.5, height);
    background.fill();
    this.node.getChildByName('ShelfTitle')?.setPosition(0, height / 2 - 35, 0);
    this.node.getChildByName('ShelfSubtitle')?.setPosition(0, height / 2 - 63, 0);
    this.node.getChildByName('ShelfHint')?.setPosition(0, -height / 2 + 48, 0);
    const size = Math.min(SLOT_SIZE, (height - 220) / 5);
    for (const [index, slot] of this.slotNodes.entries()) {
      slot.setScale(size / SLOT_SIZE, size / SLOT_SIZE, 1);
      slot.setPosition(0, height / 2 - 90 - size / 2 - index * (size + 10), 0);
    }
    this.stopDetailAnimations();
    if (this.detailPanel) this.detailPanel.active = false;
  }
  private cardRarity(id: string): string | undefined {
    return cardsJson.find(card => card.id === id)?.rarity;
  }

  private rarityFor(data: RelicItemData): string {
    return this.cardRarity(data.id) ?? data.rarity?.trim() ?? '';
  }

  private rarityColor(rarity: string): Color {
    switch (rarity) {
      case 'SSR': return palette.gold;
      case 'SR': return palette.purple;
      case 'R': return palette.cyan;
      case '珍': return palette.gold;
      case '绝': return palette.purple;
      default: return palette.secondary;
    }
  }

  private relicColor(id: string, rarity?: string): Color {
    return this.rarityColor(rarity ?? this.cardRarity(id) ?? 'N');
  }

  private traitFor(data: RelicItemData): string {
    const bonus = cardsJson.find(card => card.id === data.id)?.check_bonus;
    if (bonus) {
      const sign = bonus.amount >= 0 ? '+' : '';
      return `专属特质：${CHECK_NAMES[bonus.tag] ?? bonus.tag}检定 ${sign}${bonus.amount}，仍受修正上限约束`;
    }
    return data.perk ?? data.passive ?? '';
  }
  private stopAnimations(): void {
    this.stopDetailAnimations();
    for (const animation of this.animations) animation.stop();
    this.animations.clear();
    for (const child of this.node.children) {
      if (child.name === 'RelicFlyer' && child.isValid) child.destroy();
    }
    for (const slot of this.slotNodes) {
      if (!slot.isValid) continue;
      for (const child of slot.children) {
        if (child.name === 'RelicFeedback' && child.isValid) child.destroy();
        if (child.name === 'RelicIcon' && child.isValid) {
          child.active = true;
          child.setScale(1, 1, 1);
        }
      }
    }
    if (this.detailPanel?.isValid) {
      this.detailPanel.active = false;
      this.detailPanel.setScale(1, 1, 1);
      const opacity = this.detailPanel.getComponent(UIOpacity);
      if (opacity) opacity.opacity = 255;
    }
  }

  private stopDetailAnimations(): void {
    for (const animation of this.detailAnimations) animation.stop();
    this.detailAnimations.clear();
  }

  private highlightSlot(index: number): void {
    this.activeSlotIndex = index;
    this.slotNodes.forEach((slot, slotIndex) => {
      this.drawSlot(slot, this.relics[slotIndex], slotIndex === index);
    });
  }

  private handleSlotTap(index: number, event?: EventTouch): void {
    if (event) event.propagationStopped = true;
    this.highlightSlot(index);
    const item = this.relics[index];
    if (item) this.showDetail(item);
    else this.showLockedDetail();
  }

  private showLockedDetail(): void {
    this.renderDetail({
      id: `LOCKED_RELIC_SLOT_${this.activeSlotIndex}`,
      name: '未解锁奇物槽',
      desc: '此槽尚未收录奇物；只有真实获得的家当会显示在架上。',
      rarity: 'N',
      perk: '状态：未解锁',
    }, true);
  }

  public playFeedback(cardId: string, flags: readonly string[], key?: string): void {
    const identity = RELIC_IDENTITIES[cardId];
    const index = this.relics.findIndex(relic => relic.id === cardId);
    const slot = this.slotNodes[index];
    if (!identity?.flagPrefix || !slot || (key && this.feedbackKeys.has(key))) return;
    if (key) this.feedbackKeys.add(key);
    let fresh = false;
    for (const flag of flags) {
      if (!flag.startsWith(identity.flagPrefix) || this.earnedFlags.has(flag)) continue;
      this.earnedFlags.add(flag);
      fresh = true;
    }
    if (!fresh || this.reduceMotion()) return;

    // 像素只沿卡槽两侧短暂浮动，不覆盖名字、品质或日志正文。
    const pixels = new Node('RelicFeedback');
    pixels.layer = this.node.layer;
    const graphics = pixels.addComponent(Graphics);
    graphics.fillColor = this.relicColor(cardId);
    if (identity.effect === 'grain') {
      for (let i = 0; i < 5; i++) graphics.rect(52, -22 + i * 10, 4, i % 2 === 0 ? 6 : 4);
    } else if (identity.effect === 'clean') {
      for (const x of [-54, 50]) {
        graphics.rect(x, -8, 4, 16);
        graphics.rect(x - 4, -2, 12, 4);
      }
    } else {
      for (let i = 0; i < 4; i++) graphics.rect(52, -22 + i * 12, 4, 8);
    }
    graphics.fill();
    slot.addChild(pixels);
    const opacity = pixels.addComponent(UIOpacity);
    const movement = tween(pixels).to(0.22, { position: v3(0, 8, 0) }, { easing: 'quadOut' });
    const fade = tween(opacity).to(0.26, { opacity: 0 });
    this.animations.add(movement);
    this.animations.add(fade);
    movement.start();
    fade.call(() => {
      this.animations.delete(movement);
      this.animations.delete(fade);
      if (pixels.isValid) pixels.destroy();
    }).start();
  }


  onLoad(): void {
    this.setupSlots();
  }

  onDisable(): void {
    this.stopAnimations();
  }

  onDestroy(): void {
    this.stopAnimations();
  }


  private setupSlots(): void {
    if (this.slotNodes.length > 0) return;
    const transform = this.getComponent(UITransform) || this.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 0.5);
    transform.setContentSize(SHELF_WIDTH, this.shelfHeight);
    if (!this.getComponent(Graphics)) this.addComponent(Graphics);
    this.addLabel(this.node, 'ShelfTitle', '博古架', 0, 432, 112, 32, 22, palette.secondary);
    this.addLabel(this.node, 'ShelfSubtitle', '（奇物槽）', 0, 404, 112, 26, 16, palette.secondary);

    for (let i = 0; i < 5; i++) {
      const slot = new Node(`RelicSlot_${i}`);
      slot.layer = this.node.layer;
      slot.addComponent(UITransform).setContentSize(SLOT_SIZE, SLOT_SIZE);
      slot.setPosition(0, 328 - i * 116, 0);
      this.node.addChild(slot);
      this.drawSlot(slot);
      this.addLabel(slot, 'EmptySlot', '空置', 0, 0, 88, 32, 20, palette.secondary);
      slot.on(Node.EventType.TOUCH_END, (event?: EventTouch) => this.handleSlotTap(i, event));
      this.slotNodes.push(slot);
    }
    this.addLabel(this.node, 'ShelfHint', '点击奇物\n查看详情', 0, -406, 112, 60, 17, palette.secondary);
    this.setHeight(this.shelfHeight);
  }

  private drawSlot(slot: Node, data?: RelicItemData, selected = false): void {
    const graphics = slot.getComponent(Graphics) || slot.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = palette.panel;
    graphics.rect(-47, -47, 94, 94);
    graphics.fill();
    if (!data && !selected) {
      graphics.fillColor = palette.border;
      for (const offset of [-43, -27, -11, 5, 21, 37]) {
        graphics.rect(offset, -48, 10, 2);
        graphics.rect(offset, 46, 10, 2);
      }
      for (const offset of [-43, -27, -11, 5, 21, 37]) {
        graphics.rect(-48, offset, 2, 10);
        graphics.rect(46, offset, 2, 10);
      }
      graphics.fill();
      return;
    }
    graphics.strokeColor = selected ? palette.gold : this.relicColor(data!.id, this.rarityFor(data!));
    graphics.lineWidth = selected ? 3 : 2;
    graphics.roundRect(-47, -47, 94, 94, 8);
    graphics.stroke();
  }
  public getRelics(): readonly RelicItemData[] {
    return this.relics;
  }

  public getSlotNode(index: number): Node | null {
    return this.slotNodes[index] ?? null;
  }

  public getDetailPanel(): Node | null {
    return this.detailPanel;
  }

  public addRelic(data: RelicItemData, sourceWorldNode?: Node): void {
    this.setupSlots();
    if (this.relics.some(relic => relic.id === data.id)) return;
    const openingRarity = this.cardRarity(data.id);
    // 开局家当只有一件；后续槽位仍接受调用方真实提供的非开局物品。
    if (openingRarity && this.relics.some(relic => this.cardRarity(relic.id) !== undefined)) return;
    const slotIndex = this.relics.length;
    const targetSlot = this.slotNodes[slotIndex];
    if (!targetSlot) return;
    this.relics.push(data);
    for (const child of [...targetSlot.children]) child.destroy();
    targetSlot.removeAllChildren();
    this.drawSlot(targetSlot, data, this.activeSlotIndex === slotIndex);

    const identity = RELIC_IDENTITIES[data.id];
    const rarity = this.rarityFor(data);
    const color = this.relicColor(data.id, rarity);
    const icon = this.addLabel(targetSlot, 'RelicIcon', identity?.stamp ?? data.name.slice(0, 2),
      0, 1, 88, 48, 28, color).node;
    this.addLabel(targetSlot, 'SlotTag', openingRarity ? '开局' : '奇物', 0, 48, 72, 28, 16,
      data.id.startsWith('CARD_MODERN_') ? palette.cyan : color);
    this.addLabel(targetSlot, 'RelicRarity', rarity, 0, -31, 88, 24, 17, color);
    icon.on(Node.EventType.TOUCH_END, (event?: EventTouch) => this.handleSlotTap(slotIndex, event));

    if (this.reduceMotion()) return;
    if (sourceWorldNode?.isValid) {
      this.playFlyToSlotAnimation(sourceWorldNode, targetSlot, icon, color);
    } else {
      this.playArrival(icon);
    }
  }

  private playArrival(icon: Node): void {
    icon.setScale(0.95, 0.95, 1);
    const arrival = tween(icon).to(0.16, { scale: v3(1, 1, 1) }, { easing: 'quadOut' });
    this.animations.add(arrival);
    arrival.call(() => this.animations.delete(arrival)).start();
  }

  /** 使用微型像素轮廓代理飞入，避免大块印章与长词条遮住正在阅读的正文。 */
  private playFlyToSlotAnimation(source: Node, slot: Node, icon: Node, color: Color): void {
    const transform = this.getComponent(UITransform);
    const sourceTransform = source.getComponent(UITransform);
    const slotTransform = slot.getComponent(UITransform);
    if (!transform || !sourceTransform || !slotTransform) {
      this.playArrival(icon);
      return;
    }
    const start = transform.convertToNodeSpaceAR(sourceTransform.convertToWorldSpaceAR(Vec3.ZERO));
    const end = transform.convertToNodeSpaceAR(slotTransform.convertToWorldSpaceAR(Vec3.ZERO));
    const flyer = new Node('RelicFlyer');
    flyer.layer = this.node.layer;
    flyer.addComponent(UITransform).setContentSize(20, 20);
    const graphics = flyer.addComponent(Graphics);
    graphics.fillColor = color;
    for (const x of [-8, 4]) {
      for (const y of [-8, 4]) graphics.rect(x, y, 4, 4);
    }
    graphics.fill();
    flyer.setPosition(start.x, start.y, 0);
    this.node.addChild(flyer);
    icon.active = false;
    const controlX = (start.x + end.x) / 2;
    const controlY = Math.max(start.y, end.y) + 48;
    const flight = tween(flyer).to(0.24, { scale: v3(0.9, 0.9, 1) }, {
      easing: 'quadOut',
      onUpdate: (target: Node, ratio: number) => {
        const inverse = 1 - ratio;
        target.setPosition(
          inverse * inverse * start.x + 2 * inverse * ratio * controlX + ratio * ratio * end.x,
          inverse * inverse * start.y + 2 * inverse * ratio * controlY + ratio * ratio * end.y,
          0,
        );
      },
    });
    this.animations.add(flight);
    flight.call(() => {
      this.animations.delete(flight);
      if (flyer.isValid) flyer.destroy();
      if (!icon.isValid) return;
      icon.active = true;
      this.playArrival(icon);
    }).start();
  }
  public showDetail(data: RelicItemData): void {
    const index = this.relics.findIndex(relic => relic.id === data.id);
    if (index < 0) {
      const locked = data.id === 'empty' || data.name === '未解锁奇物槽';
      if (!locked) return;
      this.renderDetail({
        ...data,
        name: '未解锁奇物槽',
        rarity: 'N',
        perk: data.perk ?? '状态：未解锁',
      }, true);
      return;
    }
    const item = this.relics[index]!;
    this.highlightSlot(index);
    this.renderDetail(item, false);
  }

  private renderDetail(item: RelicItemData, locked: boolean): void {
    this.stopDetailAnimations();
    if (!this.detailPanel) {
      this.detailPanel = new Node('RelicDetailTip');
      this.detailPanel.layer = this.node.layer;
      this.detailPanel.addComponent(UITransform);
      this.detailPanel.addComponent(UIOpacity);
      this.node.addChild(this.detailPanel);
    }
    const detail = this.detailPanel;
    for (const child of [...detail.children]) child.destroy();
    detail.removeAllChildren();
    detail.active = true;

    const rarity = this.rarityFor(item);
    const color = this.rarityColor(rarity);
    this.addLabel(detail, 'DetailName', `【${item.name}】`, 0, 98, 328, 40, 23, palette.text);
    this.addLabel(detail, 'RarityBadge', rarity, 0, 63, 120, 28, 19, color);
    const description = this.addLabel(detail, 'DetailDesc', locked
      ? `【未解锁奇物槽】${item.desc}`
      : item.desc, 0, 12, 328, 96, 19, palette.text);
    description.horizontalAlign = Label.HorizontalAlign.LEFT;
    description.verticalAlign = Label.VerticalAlign.TOP;
    description.overflow = Label.Overflow.SHRINK;
    const perk = this.addLabel(detail, 'DetailPerk', this.traitFor(item), 0, -82, 328, 58, 18, palette.gold);
    perk.horizontalAlign = Label.HorizontalAlign.LEFT;
    perk.verticalAlign = Label.VerticalAlign.TOP;
    perk.overflow = Label.Overflow.SHRINK;

    detail.getComponent(UITransform)!.setContentSize(DETAIL_WIDTH, DETAIL_HEIGHT);
    const slot = this.slotNodes[this.activeSlotIndex];
    const limit = Math.max(0, this.shelfHeight / 2 - DETAIL_HEIGHT / 2 - 12);
    const slotY = slot?.position.y ?? 0;
    detail.setPosition(DETAIL_X, Math.max(-limit, Math.min(limit, slotY)), 0);
    const graphics = detail.getComponent(Graphics) || detail.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = palette.panel;
    graphics.strokeColor = color;
    graphics.lineWidth = 2;
    graphics.roundRect(-DETAIL_WIDTH / 2, -DETAIL_HEIGHT / 2, DETAIL_WIDTH, DETAIL_HEIGHT, 8);
    graphics.fill();
    graphics.stroke();

    const opacity = detail.getComponent(UIOpacity)!;
    const reduced = this.reduceMotion();
    if (reduced) {
      detail.setScale(1, 1, 1);
      opacity.opacity = 255;
    } else {
      detail.setScale(0.8, 0.8, 1);
      opacity.opacity = 0;
      const entrance = tween(detail).to(0.15, { scale: v3(1, 1, 1) }, { easing: 'backOut' });
      this.detailAnimations.add(entrance);
      entrance.call(() => this.detailAnimations.delete(entrance)).start();
      const appearance = tween(opacity).to(0.15, { opacity: 255 }, { easing: 'quadOut' });
      this.detailAnimations.add(appearance);
      appearance.call(() => this.detailAnimations.delete(appearance)).start();
    }

    const fade = tween(opacity)
      .delay(0.15)
      .delay(2.5)
      .to(0.3, { opacity: 0 }, { easing: 'quadIn' });
    this.detailAnimations.add(fade);
    fade.call(() => {
      this.detailAnimations.delete(fade);
      if (!detail.isValid) return;
      detail.active = false;
      detail.setScale(1, 1, 1);
    }).start();
  }


  private addLabel(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, size: number, color: Color): Label {
    const node = new Node(name);
    node.layer = this.node.layer;
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = Math.round(size * 1.4);
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    parent.addChild(node);
    return label;
  }
}
