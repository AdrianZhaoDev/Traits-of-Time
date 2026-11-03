import { _decorator, Component, Node, Label, Color, Graphics, UITransform, Layout, Sprite } from 'cc';
import { FoldItemData } from './LogParser';
const { ccclass, property } = _decorator;

/**
 * 单条折页历史际遇卡片
 * 根节点直接挂载 Sprite（背景）和 Layout（VERTICAL, CONTAINER）
 * 内部所有文本/行节点作为直接子节点，严禁独立卡片背景同级空框
 */
@ccclass('EventFoldItem')
export class EventFoldItem extends Component {
  private introLabel: Label | null = null;
  private actionLabel: Label | null = null;
  private outcomeLabel: Label | null = null;
  private stampNode: Node | null = null;
  private stampLabel: Label | null = null;
  private effectsLabel: Label | null = null;

  public init(data: FoldItemData): void {
    const cardWidth = 620;  // 固定宽度 620
    const paddingX = 24;    // 左右 Padding 24 (合计 48)
    const paddingY = 18;    // 上下 Padding 18
    const innerWidth = 572; // 620 - 48 = 572

    const transform = this.getComponent(UITransform) || this.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 0.5);
    transform.setContentSize(cardWidth, 80);

    // 1. 恢复深褐色圆角单色卡片背景 (#2A2621，高光 #362F28)，保证卡片边界清晰
    let sprite = this.getComponent(Sprite);
    if (!sprite) {
      sprite = this.addComponent(Sprite);
    }
    const isHighlight = Boolean(data.stampTag && (data.stampTag.includes('珍') || data.stampTag.includes('宝') || data.stampTag.includes('佛') || data.stampTag.includes('金')));
    sprite.color = isHighlight ? new Color(54, 47, 40, 255) : new Color(42, 38, 33, 255);

    // 2. 根节点挂载 Layout 组件 (VERTICAL, CONTAINER)，直接包裹内部子节点
    let rootLayout = this.getComponent(Layout);
    if (!rootLayout) {
      rootLayout = this.addComponent(Layout);
    }
    rootLayout.type = Layout.Type.VERTICAL;
    rootLayout.resizeMode = Layout.ResizeMode.CONTAINER;
    rootLayout.paddingTop = paddingY;
    rootLayout.paddingBottom = paddingY;
    rootLayout.paddingLeft = paddingX;
    rootLayout.paddingRight = paddingX;
    rootLayout.spacingY = 10;

    // 3. 淡墨起因 (IntroLabel) - 保持自身 AnchorX = 0.5, x = 0，宽度 572，Label.HorizontalAlign.LEFT
    if (data.introText) {
      const introNode = new Node('IntroLabel');
      introNode.setPosition(0, 0, 0);
      const introTrans = introNode.addComponent(UITransform);
      introTrans.setAnchorPoint(0.5, 0.5);
      introTrans.setContentSize(innerWidth, 28);

      this.introLabel = introNode.addComponent(Label);
      this.introLabel.string = data.introText;
      this.introLabel.fontSize = 22;
      this.introLabel.lineHeight = 28;
      this.introLabel.color = new Color(140, 130, 117, 255); // #8C8275 淡墨小字
      this.introLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
      this.introLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
      this.introLabel.updateRenderData(true);
      this.node.addChild(introNode);
    }

    // 4. 行动 (ActionLabel) - 白字行动陈词，AnchorX = 0.5, x = 0，宽度 572
    if (data.actionText) {
      const actNode = new Node('ActionLabel');
      actNode.setPosition(0, 0, 0);
      const actTrans = actNode.addComponent(UITransform);
      actTrans.setAnchorPoint(0.5, 0.5);
      actTrans.setContentSize(innerWidth, 28);

      this.actionLabel = actNode.addComponent(Label);
      this.actionLabel.string = data.actionText;
      this.actionLabel.fontSize = 24;
      this.actionLabel.lineHeight = 32;
      this.actionLabel.color = new Color(240, 240, 240, 255); // 白字
      this.actionLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
      this.actionLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
      this.actionLabel.updateRenderData(true);
      this.node.addChild(actNode);
    }

    // 5. 结果正文与印章栏 (OutcomeNode) - AnchorX = 0.5, x = 0
    if (data.outcomeText || data.stampTag) {
      const outcomeRow = new Node('OutcomeNode');
      outcomeRow.setPosition(0, 0, 0);
      const rowTrans = outcomeRow.addComponent(UITransform);
      rowTrans.setAnchorPoint(0.5, 0.5);
      rowTrans.setContentSize(innerWidth, 36);

      const rowLayout = outcomeRow.addComponent(Layout);
      rowLayout.type = Layout.Type.HORIZONTAL;
      rowLayout.resizeMode = Layout.ResizeMode.CONTAINER;
      rowLayout.spacingX = 16; // 留出足够的水平间距 16px，严禁印章与文字重叠

      const stampBadgeWidth = 120; // 适配【生平盖棺】等四字印章宽度

      // 印章 (StampBadge)
      if (data.stampTag) {
        this.stampNode = new Node('StampBadge');
        const stampTrans = this.stampNode.addComponent(UITransform);
        stampTrans.setAnchorPoint(0.5, 0.5);
        stampTrans.setContentSize(stampBadgeWidth, 36);

        const isDeathStamp = data.stampTag.includes('盖棺') || data.stampTag.includes('终章');
        const stampColor = isDeathStamp ? new Color(130, 140, 145, 255) : new Color(200, 60, 35, 255);

        const stampGfx = this.stampNode.addComponent(Graphics);
        stampGfx.lineWidth = 2;
        stampGfx.strokeColor = stampColor;
        stampGfx.rect(-stampBadgeWidth / 2, -18, stampBadgeWidth, 36);
        stampGfx.stroke();

        const sLabelNode = new Node('StampText');
        const sLabelTrans = sLabelNode.addComponent(UITransform);
        sLabelTrans.setAnchorPoint(0.5, 0.5);
        sLabelTrans.setContentSize(stampBadgeWidth, 36);
        this.stampLabel = sLabelNode.addComponent(Label);
        this.stampLabel.string = `【${data.stampTag}】`;
        this.stampLabel.fontSize = 20;
        this.stampLabel.color = stampColor;
        this.stampLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
        this.stampLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.stampLabel.updateRenderData(true);
        this.stampNode.addChild(sLabelNode);

        outcomeRow.addChild(this.stampNode);
      }

      // 结果文本
      if (data.outcomeText) {
        const outNode = new Node('OutcomeText');
        const outTrans = outNode.addComponent(UITransform);
        outTrans.setAnchorPoint(0.5, 0.5);
        const textWidth = data.stampTag ? (innerWidth - stampBadgeWidth - 16) : innerWidth;
        outTrans.setContentSize(textWidth, 34);

        this.outcomeLabel = outNode.addComponent(Label);
        this.outcomeLabel.string = data.outcomeText;
        this.outcomeLabel.fontSize = 26;
        this.outcomeLabel.lineHeight = 34;
        this.outcomeLabel.color = data.stampTag
          ? new Color(212, 175, 55, 255) // #D4AF37 泥金
          : new Color(230, 222, 200, 255); // #E6DEC8 浓墨正文
        this.outcomeLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
        this.outcomeLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
        this.outcomeLabel.updateRenderData(true);
        outcomeRow.addChild(outNode);
      }

      rowLayout.updateLayout();
      this.node.addChild(outcomeRow);
    }

    // 6. 属性变动摘要 (EffectsSummary)
    const effectsList = data.effectsSummary ?? data.effectsText;
    if (effectsList && effectsList.length > 0) {
      const effNode = new Node('EffectsSummary');
      effNode.setPosition(0, 0, 0);
      const effTrans = effNode.addComponent(UITransform);
      effTrans.setAnchorPoint(0.5, 0.5);
      effTrans.setContentSize(innerWidth, 24);

      this.effectsLabel = effNode.addComponent(Label);
      this.effectsLabel.string = `〔 ${effectsList.join(' · ')} 〕`;
      this.effectsLabel.fontSize = 18;
      this.effectsLabel.color = new Color(180, 160, 120, 220);
      this.effectsLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
      this.effectsLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
      this.effectsLabel.updateRenderData(true);
      this.node.addChild(effNode);
    }

    // 7. 强制刷新布局，由 Layout 容器动态撑开根节点高度，保持宽度固定 620
    rootLayout.updateLayout();
    if (transform.width !== cardWidth) {
      transform.setContentSize(cardWidth, transform.height);
    }
  }

  public getStampNode(): Node | null {
    return this.stampNode;
  }
}
