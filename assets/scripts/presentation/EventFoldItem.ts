import { _decorator, Component, Node, Label, Color, Graphics, UITransform } from 'cc';
import type { FoldItemData } from './LogParser';

const { ccclass } = _decorator;
const CARD_WIDTH = 590;
const CONTENT_WIDTH = 542;
const PADDING_Y = 18;
const SECTION_GAP = 12;
const palette = {
  panel: new Color(26, 29, 38, 255),
  border: new Color(53, 59, 73, 255),
  text: new Color(237, 241, 247, 255),
  secondary: new Color(140, 150, 168, 255),
  cyan: new Color(0, 240, 255, 255),
  gold: new Color(255, 190, 11, 255),
  green: new Color(5, 223, 183, 255),
  red: new Color(255, 42, 95, 255),
};

/** 固定宽度的历史折页；每段正文与每条真实属性变动独立参与高度计算。 */
@ccclass('EventFoldItem')
export class EventFoldItem extends Component {
  private stampNode: Node | null = null;

  public init(data: FoldItemData): void {
    for (const child of [...this.node.children]) child.destroy();
    this.node.removeAllChildren();
    this.stampNode = null;

    const transform = this.getComponent(UITransform) || this.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 0.5);
    const effects = data.effectsSummary ?? data.effectsText ?? [];
    const death = data.type === 'death' || /盖棺|终章/.test(data.stampTag ?? '');
    const special = data.type === 'card_selected' || data.type === 'modern' || data.type === 'special'
      || Boolean(data.cardId?.startsWith('CARD_MODERN_'))
      || Boolean(data.eventId?.startsWith('E_MOD_'))
      || Boolean(data.relicFlags?.some(flag => flag.startsWith('F_MOD_')));
    const gain = data.type === 'achievement' || data.type === 'gain'
      || /珍宝|传家|珍藏|获利|进财|发财|金榜/.test(data.stampTag ?? '')
      || effects.some(effect => /^(家资|财富).*\+\s*\d/.test(effect));
    const accent = death ? palette.red : special ? palette.cyan : gain ? palette.gold : palette.border;
    const sections: Node[] = [];

    if (data.introText) {
      const intro = this.addText(this.node, 'IntroLabel', data.introText, CONTENT_WIDTH, 23,
        data.outcomeText || data.actionText ? palette.secondary : palette.text);
      sections.push(intro.node);
    }
    if (data.actionText) {
      sections.push(this.addText(this.node, 'ActionLabel', data.actionText, CONTENT_WIDTH, 23, palette.text).node);
    }

    if (data.outcomeText || data.stampTag) {
      const outcome = new Node('OutcomeNode');
      outcome.layer = this.node.layer;
      const outcomeTransform = outcome.addComponent(UITransform);
      outcomeTransform.setAnchorPoint(0.5, 1);
      this.node.addChild(outcome);
      let height = 0;

      if (data.stampTag) {
        const stamp = new Node('StampBadge');
        stamp.layer = this.node.layer;
        const stampTransform = stamp.addComponent(UITransform);
        stampTransform.setAnchorPoint(0.5, 1);
        outcome.addChild(stamp);
        const stampWidth = Math.min(CONTENT_WIDTH, Math.max(128, (data.stampTag.length + 2) * 20 + 20));
        const stampColor = death || special || gain ? accent : palette.secondary;
        const text = this.addText(stamp, 'StampText', `【${data.stampTag}】`, stampWidth - 16, 20, stampColor);
        text.horizontalAlign = Label.HorizontalAlign.CENTER;
        height = text.node.getComponent(UITransform)!.height + 12;
        text.node.setPosition(0, -6, 0);
        stampTransform.setContentSize(stampWidth, height);
        stamp.setPosition(-CONTENT_WIDTH / 2 + stampWidth / 2, 0, 0);
        const graphics = stamp.addComponent(Graphics);
        graphics.strokeColor = stampColor;
        graphics.lineWidth = 1.5;
        graphics.roundRect(-stampWidth / 2, -height, stampWidth, height, 4);
        graphics.stroke();
        this.stampNode = stamp;
      }

      if (data.outcomeText) {
        if (height > 0) height += SECTION_GAP;
        const body = this.addText(outcome, 'OutcomeText', data.outcomeText, CONTENT_WIDTH, 23, palette.text);
        body.node.setPosition(0, -height, 0);
        height += body.node.getComponent(UITransform)!.height;
      }
      outcomeTransform.setContentSize(CONTENT_WIDTH, height);
      sections.push(outcome);
    }

    if (effects.length > 0) {
      const summary = new Node('EffectsSummary');
      summary.layer = this.node.layer;
      const summaryTransform = summary.addComponent(UITransform);
      summaryTransform.setAnchorPoint(0.5, 1);
      this.node.addChild(summary);
      let x = 0;
      let y = 0;
      let rowHeight = 0;
      for (const [index, effect] of effects.entries()) {
        const width = Math.min(CONTENT_WIDTH, Math.max(104, effect.length * 20 + 24));
        if (x > 0 && x + width > CONTENT_WIDTH) {
          x = 0;
          y += rowHeight + 8;
          rowHeight = 0;
        }
        const negative = /[-−]\s*\d/.test(effect);
        const positive = /\+\s*\d/.test(effect);
        const color = negative ? palette.red : positive
          ? /^(家资|财富)/.test(effect) ? palette.gold : palette.green
          : palette.secondary;
        const chip = new Node(`Effect_${index}`);
        chip.layer = this.node.layer;
        const chipTransform = chip.addComponent(UITransform);
        chipTransform.setAnchorPoint(0.5, 1);
        summary.addChild(chip);
        const text = this.addText(chip, 'EffectText', effect, width - 24, 20, color);
        const height = text.node.getComponent(UITransform)!.height + 12;
        chipTransform.setContentSize(width, height);
        chip.setPosition(-CONTENT_WIDTH / 2 + x + width / 2, -y, 0);
        text.node.setPosition(0, -6, 0);
        const graphics = chip.addComponent(Graphics);
        graphics.fillColor = new Color(color.r, color.g, color.b, 22);
        graphics.strokeColor = new Color(color.r, color.g, color.b, 80);
        graphics.lineWidth = 1;
        graphics.roundRect(-width / 2, -height, width, height, 4);
        graphics.fill();
        graphics.stroke();
        x += width + 8;
        rowHeight = Math.max(rowHeight, height);
      }
      summaryTransform.setContentSize(CONTENT_WIDTH, y + rowHeight);
      sections.push(summary);
    }

    const height = Math.max(64, PADDING_Y * 2
      + sections.reduce((sum, section) => sum + section.getComponent(UITransform)!.height, 0)
      + Math.max(0, sections.length - 1) * SECTION_GAP);
    transform.setContentSize(CARD_WIDTH, height);
    let top = height / 2 - PADDING_Y;
    for (const section of sections) {
      section.setPosition(0, top, 0);
      top -= section.getComponent(UITransform)!.height + SECTION_GAP;
    }

    const graphics = this.getComponent(Graphics) || this.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = palette.panel;
    graphics.strokeColor = palette.border;
    graphics.lineWidth = 1.5;
    graphics.roundRect(-CARD_WIDTH / 2 + 1, -height / 2 + 1, CARD_WIDTH - 2, height - 2, 6);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = accent;
    graphics.rect(-CARD_WIDTH / 2 + 1, -height / 2 + 6, 6, height - 12);
    graphics.fill();
  }

  public getStampNode(): Node | null {
    return this.stampNode;
  }

  private addText(parent: Node, name: string, text: string, width: number, size: number, color: Color): Label {
    const node = new Node(name);
    node.layer = this.node.layer;
    const transform = node.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 1);
    const lineHeight = Math.round(size * 1.4);
    transform.setContentSize(width, lineHeight);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = lineHeight;
    label.color = color;
    label.overflow = Label.Overflow.RESIZE_HEIGHT;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
    parent.addChild(node);
    label.updateRenderData(true);
    // 非激活父节点尚未完成字体排版时也预留完整行高，不让相邻段落互相覆盖。
    const columns = Math.max(1, Math.floor(width / size));
    const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0);
    transform.setContentSize(width, Math.max(transform.height, lines * lineHeight));
    return label;
  }
}
