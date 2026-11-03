import {
  _decorator,
  Component,
  Node,
  Label,
  Graphics,
  UITransform,
  Color,
  tween,
  v3,
  Vec3,
  UIOpacity,
} from 'cc';

const { ccclass } = _decorator;

export interface RelicItemData {
  id: string;
  name: string;
  desc: string;
}

/**
 * 右侧常驻垂直博古架（传家宝/珍贵词条槽位）
 */
@ccclass('RelicBarController')
export class RelicBarController extends Component {
  private relics: RelicItemData[] = [];
  private slotNodes: Node[] = [];
  private detailPanel: Node | null = null;
  private detailLabel: Label | null = null;
  private flyingStampNode: Node | null = null;
  onLoad(): void {
    this.setupSlots();
  }

  private setupSlots(): void {
    const transform = this.getComponent(UITransform) || this.addComponent(UITransform);
    transform.setContentSize(60, 800);

    // 创建 5 个微缩木架卡槽
    for (let i = 0; i < 5; i++) {
      const slotNode = new Node(`RelicSlot_${i}`);
      const slotTrans = slotNode.addComponent(UITransform);
      slotTrans.setContentSize(52, 52);
      slotNode.setPosition(0, 320 - i * 70, 0);

      const gfx = slotNode.addComponent(Graphics);
      gfx.lineWidth = 1.5;
      gfx.strokeColor = new Color(90, 75, 60, 160);
      gfx.fillColor = new Color(35, 30, 25, 200);
      gfx.roundRect(-26, -26, 52, 52, 6);
      gfx.fill();
      gfx.stroke();

      this.node.addChild(slotNode);
      this.slotNodes.push(slotNode);
    }
  }

  /**
   * 获取当前已收集的传家宝列表
   */
  public getRelics(): readonly RelicItemData[] {
    return this.relics;
  }

  /**
   * 获取指定槽位节点
   */
  public getSlotNode(index: number): Node | null {
    return this.slotNodes[index] ?? null;
  }

  /**
   * 获取详情面板节点
   */
  public getDetailPanel(): Node | null {
    return this.detailPanel;
  }

  /**
   * 添加传家宝/珍贵词条并播放印章平滑飞入入架动效
   */
  public addRelic(data: RelicItemData, sourceWorldNode?: Node): void {
    // 查重
    if (this.relics.some((r) => r.id === data.id)) return;
    if (this.relics.length >= this.slotNodes.length) return;

    const targetSlotIndex = this.relics.length;
    this.relics.push(data);
    const targetSlot = this.slotNodes[targetSlotIndex];
    if (!targetSlot) return;

    // 插槽内添加微缩文字节点
    const iconNode = new Node('RelicIcon');
    const iconTrans = iconNode.addComponent(UITransform);
    iconTrans.setContentSize(48, 48);
    const label = iconNode.addComponent(Label);
    label.string = data.name.slice(0, 2);
    label.fontSize = 16;
    label.color = new Color(212, 175, 55, 255); // 泥金色
    targetSlot.addChild(iconNode);

    // 绑定点击详情
    iconNode.on(Node.EventType.TOUCH_END, () => {
      this.showDetail(data);
    });

    if (sourceWorldNode && sourceWorldNode.isValid) {
      this.playFlyToSlotAnimation(sourceWorldNode, targetSlot, iconNode, data.name);
    } else {
      // 无来源节点时的回退入架动效
      iconNode.setScale(0, 0, 1);
      tween(iconNode)
        .to(0.3, { scale: v3(1.2, 1.2, 1) }, { easing: 'backOut' })
        .to(0.1, { scale: v3(1, 1, 1) })
        .start();
    }
  }

  /**
   * 词条生成时，朱砂印章飞入博古架插槽的平滑抛物曲线动画
   */
  private playFlyToSlotAnimation(
    sourceNode: Node,
    targetSlot: Node,
    finalIconNode: Node,
    relicName: string,
  ): void {
    finalIconNode.active = false;

    const myTrans = this.getComponent(UITransform);
    const srcTrans = sourceNode.getComponent(UITransform);
    const targetTrans = targetSlot.getComponent(UITransform);
    if (!myTrans || !srcTrans || !targetTrans) {
      finalIconNode.active = true;
      return;
    }

    const startWorldPos = srcTrans.convertToWorldSpaceAR(Vec3.ZERO);
    const endWorldPos = targetTrans.convertToWorldSpaceAR(Vec3.ZERO);
    const startLocalPos = myTrans.convertToNodeSpaceAR(startWorldPos);
    const endLocalPos = myTrans.convertToNodeSpaceAR(endWorldPos);

    // 创建飞行动画印章代理节点
    const flyer = new Node('RelicFlyer');
    const flyerTrans = flyer.addComponent(UITransform);
    flyerTrans.setContentSize(48, 48);
    const flyerGfx = flyer.addComponent(Graphics);
    flyerGfx.fillColor = new Color(200, 60, 35, 230); // 朱砂红底
    flyerGfx.roundRect(-24, -24, 48, 48, 6);
    flyerGfx.fill();

    const flyerLabelNode = new Node('FlyerLabel');
    const flTrans = flyerLabelNode.addComponent(UITransform);
    flTrans.setContentSize(48, 48);
    const flyerLabel = flyerLabelNode.addComponent(Label);
    flyerLabel.string = relicName.slice(0, 2);
    flyerLabel.fontSize = 16;
    flyerLabel.color = new Color(255, 245, 225, 255);
    flyer.addChild(flyerLabelNode);

    flyer.setPosition(startLocalPos.x, startLocalPos.y, startLocalPos.z);
    this.node.addChild(flyer);
    this.flyingStampNode = flyer;

    // 二阶贝塞尔控制点：向上弧度抛物线
    const controlX = (startLocalPos.x + endLocalPos.x) / 2;
    const controlY = Math.max(startLocalPos.y, endLocalPos.y) + 90;

    tween(flyer)
      .to(
        0.48,
        { scale: v3(0.9, 0.9, 1) },
        {
          easing: 'quadOut',
          onUpdate: (target: Node, ratio: number) => {
            const t = ratio;
            const invT = 1 - t;
            const curX = invT * invT * startLocalPos.x + 2 * invT * t * controlX + t * t * endLocalPos.x;
            const curY = invT * invT * startLocalPos.y + 2 * invT * t * controlY + t * t * endLocalPos.y;
            target.setPosition(curX, curY, 0);
          },
        },
      )
      .call(() => {
        flyer.active = false;
        const parent = flyer.parent ?? this.node;
        if (parent && parent.children) {
          const idx = parent.children.indexOf(flyer);
          if (idx !== -1) parent.children.splice(idx, 1);
        }
        this.flyingStampNode = null;
        finalIconNode.setScale(0.5, 0.5, 1);
        tween(finalIconNode)
          .to(0.18, { scale: v3(1.2, 1.2, 1) }, { easing: 'backOut' })
          .to(0.1, { scale: v3(1, 1, 1) })
          .start();
      })
      .start();
  }
  public showDetail(data: RelicItemData): void {
    if (!this.detailPanel) {
      this.detailPanel = new Node('RelicDetailTip');
      const trans = this.detailPanel.addComponent(UITransform);
      trans.setContentSize(240, 120);
      this.detailPanel.setPosition(-150, 0, 0);

      const gfx = this.detailPanel.addComponent(Graphics);
      gfx.fillColor = new Color(30, 25, 20, 240);
      gfx.strokeColor = new Color(180, 140, 80, 255);
      gfx.lineWidth = 2;
      gfx.roundRect(-120, -60, 240, 120, 8);
      gfx.fill();
      gfx.stroke();

      const labelNode = new Node('TipText');
      const labelTrans = labelNode.addComponent(UITransform);
      labelTrans.setContentSize(220, 100);
      this.detailLabel = labelNode.addComponent(Label);
      this.detailLabel.fontSize = 16;
      this.detailLabel.lineHeight = 22;
      this.detailLabel.color = new Color(220, 210, 190, 255);
      this.detailLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
      this.detailPanel.addChild(labelNode);

      this.node.addChild(this.detailPanel);
      this.detailPanel.addComponent(UIOpacity);
    }

    if (this.detailLabel) {
      this.detailLabel.string = `【${data.name}】\n${data.desc}`;
    }

    this.detailPanel.active = true;
    const op = this.detailPanel.getComponent(UIOpacity);
    if (op) {
      op.opacity = 255;
      tween(op)
        .delay(2.5)
        .to(0.4, { opacity: 0 })
        .call(() => {
          if (this.detailPanel) this.detailPanel.active = false;
        })
        .start();
    }
  }
}
