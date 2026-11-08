import { _decorator, Component, Node, Label, Color, Graphics, UITransform, tween, v3 } from 'cc';
import achievementsJson from '../../resources/data/ming_end/achievements.json';
import type { FoldItemData } from './LogParser';
import { GameAudio } from './GameAudio';
import { prefersReducedNarrativeMotion } from './NarrativePanelArt';

const { ccclass } = _decorator;
const ROW_WIDTH = 594;
const CONTENT_WIDTH = 558;
const MAIN_FONT_SIZE = 22;
const STATUS_FONT_SIZE = 18;
const STATUS_HEIGHT = 34;
const HEADER_HEIGHT = 32;
const PAD_X = 18;
const PAD_Y = 14;
const SECTION_GAP = 8;
const ACHIEVEMENTS_BY_ID = Object.fromEntries(achievementsJson.map(achievement => [achievement.id, achievement]));
const palette = {
  text: new Color(237, 241, 247, 255),
  secondary: new Color(140, 150, 168, 255),
  muted: new Color(94, 102, 119, 255),
  cyan: new Color(0, 240, 255, 255),
  gold: new Color(255, 190, 11, 255),
  green: new Color(5, 223, 183, 255),
  red: new Color(255, 42, 95, 255),
  panel: new Color(24, 27, 36, 255),
  border: new Color(53, 59, 73, 255),
  borderLight: new Color(82, 91, 110, 255),
  age: new Color(38, 45, 61, 255),
  modernAge: new Color(14, 56, 70, 255),
  modernPanel: new Color(18, 28, 41, 255),
  deathPanel: new Color(43, 18, 24, 255),
};

interface StatusPill {
  text: string;
  color: Color;
  achievementId?: string;
}

/** Preview-matched event receipt with a compact header, full narrative and effect badges. */
@ccclass('EventFoldItem')
export class EventFoldItem extends Component {
  private static readonly achievementReceipts = new WeakMap<Node, Set<string>>();
  public reducedMotion = false;
  private stampAnimations: { stop(): void }[] = [];
  private achievementPills: Node[] = [];

  /** Call only when this log surface starts a genuinely new life, never on a view refresh. */
  public static resetAchievementFeedback(logParent: Node): void {
    this.achievementReceipts.delete(logParent);
  }

  public init(data: FoldItemData, celebrateAchievement = true): void {
    this.stopFeedback();
    for (const child of [...this.node.children]) child.destroy();
    this.node.removeAllChildren();

    const achievementIds = data.achievementIds
      ?? (data.type === 'achievement' && data.eventId ? [data.eventId] : []);
    const achievements = achievementIds
      .map(id => ACHIEVEMENTS_BY_ID[id])
      .filter((achievement): achievement is (typeof achievementsJson)[number] => Boolean(achievement));
    const effects = data.effectsSummary ?? data.effectsText ?? [];
    const mainText = [data.introText, data.actionText, data.outcomeText]
      .map(text => (text ?? '').replace(/\s*\n+\s*/g, ' · ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' · ');
    const isModern = data.type === 'card_selected' && data.cardId?.startsWith('CARD_MODERN_') === true;
    const isDeath = data.type === 'death';
    const isGain = effects.some(effect => /家资|财富/.test(effect) && /\+\s*\d/.test(effect));
    const title = data.stampTag
      ? data.stampTag
      : data.type === 'card_selected' ? isModern ? '⚡ 现代词条共鸣' : '本世家当'
        : ({
          event: '【岁月流转】', effects: '【岁月回响】', chain: '【事业进展】',
          crisis: '【时局变动】', achievement: '【人生留名】', death: '【人生终局】',
          history: '【历史节点】', system: '【推演提示】',
        } as Record<string, string>)[data.type] ?? '【人生记事】';

    const pills: StatusPill[] = [];
    for (const effect of effects) {
      const negative = /[-−]\s*\d/.test(effect);
      const positive = /\+\s*\d/.test(effect);
      const color = negative ? palette.red : positive
        ? /^(家资|财富)/.test(effect) ? palette.gold : palette.green
        : palette.secondary;
      pills.push({ text: effect, color });
    }
    for (const achievement of achievements) {
      pills.push({ text: `成就：${achievement.name}`, color: palette.gold, achievementId: achievement.id });
    }

    const bodyLines = mainText
      ? Math.max(1, Math.ceil(mainText.length * MAIN_FONT_SIZE / CONTENT_WIDTH))
      : 0;
    const bodyHeight = bodyLines * 36;
    const hasBody = bodyHeight > 0;
    const hasStatus = pills.length > 0;
    const height = PAD_Y * 2 + HEADER_HEIGHT
      + (hasBody ? SECTION_GAP + bodyHeight : 0)
      + (hasStatus ? SECTION_GAP + STATUS_HEIGHT : 0);
    const itemTransform = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    itemTransform.setAnchorPoint(0.5, 0.5);
    itemTransform.setContentSize(ROW_WIDTH, height);

    const card = this.getComponent(Graphics) || this.addComponent(Graphics)!;
    card.clear();
    card.fillColor = isDeath ? palette.deathPanel : isModern ? palette.modernPanel : palette.panel;
    card.strokeColor = palette.border;
    card.lineWidth = 1.5;
    card.roundRect(-ROW_WIDTH / 2, -height / 2, ROW_WIDTH, height, 6);
    card.fill();
    card.stroke();
    card.fillColor = isDeath ? palette.red : isModern ? palette.cyan : isGain ? palette.gold : palette.borderLight;
    card.roundRect(-ROW_WIDTH / 2, -height / 2 + 3, 6, height - 6, 3);
    card.fill();

    const headerY = height / 2 - PAD_Y - HEADER_HEIGHT / 2;
    const ageText = data.age === undefined ? '' : `${data.age} 岁`;
    if (ageText) {
      const age = new Node('AgePill');
      age.layer = this.node.layer;
      age.addComponent(UITransform).setContentSize(64, 30);
      age.setPosition(-ROW_WIDTH / 2 + PAD_X + 32, headerY, 0);
      const graphics = age.addComponent(Graphics);
      graphics.fillColor = isModern ? palette.modernAge : palette.age;
      graphics.roundRect(-32, -15, 64, 30, 3);
      graphics.fill();
      this.addLabel(age, 'AgeLabel', ageText, 0, 0, 60, 27, 19, isModern ? palette.cyan : palette.text, Label.HorizontalAlign.CENTER);
      this.node.addChild(age);
    }

    const titleWidth = ROW_WIDTH - (ageText ? 116 : 2 * PAD_X);
    const titleX = ROW_WIDTH / 2 - PAD_X - titleWidth / 2;
    this.addLabel(this.node, 'EventType', title, titleX, headerY, titleWidth, HEADER_HEIGHT, 18,
      isDeath ? palette.red : isModern ? palette.cyan : palette.muted, Label.HorizontalAlign.RIGHT);

    if (hasBody) {
      const main = new Node('MainText');
      main.layer = this.node.layer;
      const transform = main.addComponent(UITransform);
      transform.setAnchorPoint(0.5, 1);
      transform.setContentSize(CONTENT_WIDTH, bodyHeight);
      const top = height / 2 - PAD_Y - HEADER_HEIGHT - SECTION_GAP;
      main.setPosition(0, top, 0);
      const label = main.addComponent(Label);
      label.string = mainText;
      label.fontSize = MAIN_FONT_SIZE;
      label.lineHeight = 36;
      label.color = palette.text;
      label.horizontalAlign = Label.HorizontalAlign.LEFT;
      label.verticalAlign = Label.VerticalAlign.TOP;
      label.overflow = Label.Overflow.SHRINK;
      this.node.addChild(main);
    }

    if (hasStatus) {
      const widths = pills.map(pill => Math.max(58, pill.text.length * STATUS_FONT_SIZE + 18));
      const gap = 8;
      const availableWidth = CONTENT_WIDTH - Math.max(0, pills.length - 1) * gap;
      const scale = Math.min(1, availableWidth / widths.reduce((sum, width) => sum + width, 0));
      const scaledWidths = widths.map(width => width * scale);
      const totalWidth = scaledWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, pills.length - 1) * gap;
      let x = -totalWidth / 2;
      const y = -height / 2 + PAD_Y + STATUS_HEIGHT / 2;
      pills.forEach((pill, index) => {
        const width = scaledWidths[index]!;
        const node = new Node(`StatusPill_${index}`);
        node.layer = this.node.layer;
        node.addComponent(UITransform).setContentSize(width, STATUS_HEIGHT);
        node.setPosition(x + width / 2, y, 0);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = new Color(pill.color.r, pill.color.g, pill.color.b, 30);
        graphics.strokeColor = new Color(pill.color.r, pill.color.g, pill.color.b, 64);
        graphics.lineWidth = 1;
        graphics.roundRect(-width / 2, -STATUS_HEIGHT / 2, width, STATUS_HEIGHT, 3);
        graphics.fill();
        graphics.stroke();
        this.addLabel(node, 'Label', pill.text, 0, 0, Math.max(1, width - 10), STATUS_HEIGHT - 2,
          STATUS_FONT_SIZE, pill.color, Label.HorizontalAlign.CENTER);
        this.node.addChild(node);
        if (pill.achievementId) this.achievementPills.push(node);
        x += width + gap;
      });
    }

    this.playAchievementFeedback(achievements.map(item => item.id), data.achievementFeedbackKeys, celebrateAchievement);
  }

  private addLabel(parent: Node, name: string, text: string, x: number, y: number,
    width: number, height: number, size: number, color: Color, align = Label.HorizontalAlign.LEFT): Label {
    const node = new Node(name);
    node.layer = this.node.layer;
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = Math.round(size * 1.4);
    label.color = color;
    label.horizontalAlign = align;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    parent.addChild(node);
    return label;
  }

  private playAchievementFeedback(achievementIds: string[], feedbackKeys: string[] | undefined, celebrateAchievement: boolean): void {
    if (achievementIds.length === 0) return;
    const scope = this.node.parent ?? this.node;
    let receipts = EventFoldItem.achievementReceipts.get(scope);
    if (!receipts) {
      receipts = new Set<string>();
      EventFoldItem.achievementReceipts.set(scope, receipts);
    }
    const newIndexes = achievementIds.map((id, index) => ({
      id,
      index,
      receiptKey: feedbackKeys?.[index] ?? id,
    })).filter(item => {
      if (receipts!.has(item.receiptKey)) return false;
      receipts!.add(item.receiptKey);
      return true;
    });
    if (newIndexes.length === 0 || !celebrateAchievement) return;
    GameAudio.instance?.playCue('achievement');
    if (prefersReducedNarrativeMotion(this.reducedMotion)) return;
    for (const { index } of newIndexes) {
      const pill = this.achievementPills[index];
      if (!pill) continue;
      pill.setScale(1.08, 1.08, 1);
      const feedback = tween(pill).to(0.16, { scale: v3(1, 1, 1) }, { easing: 'cubicOut' });
      this.stampAnimations.push(feedback);
      feedback.call(() => {
        this.stampAnimations = this.stampAnimations.filter(animation => animation !== feedback);
      }).start();
    }
  }

  private stopFeedback(): void {
    for (const animation of this.stampAnimations) animation.stop();
    this.stampAnimations = [];
    for (const pill of this.achievementPills) {
      if (pill.isValid) pill.setScale(1, 1, 1);
    }
    this.achievementPills = [];
  }

  onDisable(): void {
    this.stopFeedback();
  }

  onDestroy(): void {
    this.stopFeedback();
  }
}
