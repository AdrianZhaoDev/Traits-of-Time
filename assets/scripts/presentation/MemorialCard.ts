import {
  _decorator,
  Component,
  Node,
  Label,
  Graphics,
  UITransform,
  Color,
  EventTouch,
  Vec3,
  v3,
  tween,
  UIOpacity,
  Layers,
} from 'cc';
import type { PendingDecision } from '../core/types/schema';

export type OptionPending = Extract<PendingDecision, { kind: 'option' }>;

const { ccclass } = _decorator;

/**
 * 奏折式抉择卡片 (支持左右滑动批红/批墨交互)
 * 向左划动 > 100px：冷眼旁观 / 拒绝 (批墨叉)
 * 向右划动 > 100px：倾力入局 / 顺从 (批朱圈)
 */
@ccclass('MemorialCard')
export class MemorialCard extends Component {
  private titleLabel: Label | null = null;
  private descLabel: Label | null = null;
  private leftHintLabel: Label | null = null;
  private rightHintLabel: Label | null = null;

  private decisionData: OptionPending | null = null;
  private onSelectCallback: ((optionId: string) => void) | null = null;

  private startTouchPos: Vec3 = new Vec3();
  private currentOffset: number = 0;
  private isDragging: boolean = false;

  public init(
    decision: OptionPending,
    onSelect: (optionId: string) => void,
    customDesc?: string,
  ): void {
    this.decisionData = decision;
    this.onSelectCallback = onSelect;
    this.node.removeAllChildren();
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setPosition(0, 0, 0);

    const transform = this.getComponent(UITransform) || this.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 0.5);
    transform.setContentSize(640, 520);

    // 1. 奏折底板背景 (醒目古宣纸黄 #F4EBD9，深赭色边框 #6A4426)
    const bgNode = new Node('MemorialPaperBg');
    bgNode.layer = Layers.Enum.UI_2D;
    bgNode.setPosition(0, 0, 0);
    const bgTrans = bgNode.addComponent(UITransform);
    bgTrans.setAnchorPoint(0.5, 0.5);
    bgTrans.setContentSize(640, 520);

    const gfx = bgNode.addComponent(Graphics);
    // 纸张底色
    gfx.fillColor = new Color(244, 235, 217, 255);
    gfx.roundRect(-320, -260, 640, 520, 12);
    gfx.fill();
    // 赭色外边框
    gfx.lineWidth = 4;
    gfx.strokeColor = new Color(106, 68, 38, 255);
    gfx.roundRect(-320, -260, 640, 520, 12);
    gfx.stroke();
    // 内侧朱砂金线
    gfx.lineWidth = 1.5;
    gfx.strokeColor = new Color(200, 60, 35, 180);
    gfx.roundRect(-312, -252, 624, 504, 8);
    gfx.stroke();
    this.node.addChild(bgNode);

    // 2. 奏折顶端标题
    const titleNode = new Node('Title');
    titleNode.layer = Layers.Enum.UI_2D;
    titleNode.setPosition(0, 215, 0);
    const titleTrans = titleNode.addComponent(UITransform);
    titleTrans.setAnchorPoint(0.5, 0.5);
    titleTrans.setContentSize(580, 40);

    this.titleLabel = titleNode.addComponent(Label);
    this.titleLabel.string = '【 呈阅 · 时局要事定夺 】';
    this.titleLabel.fontSize = 24;
    this.titleLabel.lineHeight = 32;
    this.titleLabel.color = new Color(140, 35, 25, 255); // 朱红标题
    this.titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    this.node.addChild(titleNode);

    // 3. 详细陈词区
    const descNode = new Node('Desc');
    descNode.layer = Layers.Enum.UI_2D;
    descNode.setPosition(0, 75, 0);
    const descTrans = descNode.addComponent(UITransform);
    descTrans.setAnchorPoint(0.5, 0.5);
    descTrans.setContentSize(560, 210);

    this.descLabel = descNode.addComponent(Label);
    this.descLabel.string = customDesc || '时值崇祯年间天下扰攘，正是立身立命之机。前方机缘路口已至，请主公斟酌批定：';
    this.descLabel.fontSize = 21;
    this.descLabel.lineHeight = 32;
    this.descLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
    this.descLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.descLabel.color = new Color(50, 40, 32, 255); // 焦墨正文
    this.node.addChild(descNode);

    // 4. 左选项（批墨 / 谨守）
    const leftOpt = decision.options[0];
    const leftBtnNode = new Node('LeftBtn');
    leftBtnNode.layer = Layers.Enum.UI_2D;
    leftBtnNode.setPosition(-155, -190, 0);
    const leftTrans = leftBtnNode.addComponent(UITransform);
    leftTrans.setAnchorPoint(0.5, 0.5);
    leftTrans.setContentSize(270, 76);

    const leftGfx = leftBtnNode.addComponent(Graphics);
    leftGfx.fillColor = new Color(48, 44, 40, 255); // 浓墨深底
    leftGfx.roundRect(-135, -38, 270, 76, 8);
    leftGfx.fill();
    leftGfx.lineWidth = 2;
    leftGfx.strokeColor = new Color(130, 120, 105, 255);
    leftGfx.roundRect(-135, -38, 270, 76, 8);
    leftGfx.stroke();

    const leftLabelNode = new Node('LeftLabel');
    leftLabelNode.layer = Layers.Enum.UI_2D;
    const lLblTrans = leftLabelNode.addComponent(UITransform);
    lLblTrans.setAnchorPoint(0.5, 0.5);
    lLblTrans.setContentSize(250, 70);

    this.leftHintLabel = leftLabelNode.addComponent(Label);
    this.leftHintLabel.string = `← 批墨\n${leftOpt ? leftOpt.text : '作罢'}`;
    this.leftHintLabel.fontSize = 18;
    this.leftHintLabel.lineHeight = 24;
    this.leftHintLabel.color = new Color(240, 235, 220, 255);
    this.leftHintLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    leftBtnNode.addChild(leftLabelNode);
    this.node.addChild(leftBtnNode);

    // 点击左选项
    leftBtnNode.on(Node.EventType.TOUCH_END, (e: unknown) => {
      if (leftOpt) this.confirmSelection(leftOpt.id, -1);
    });

    // 5. 右选项（批朱 / 破局）
    const rightOpt = decision.options[1] || decision.options[0];
    const rightBtnNode = new Node('RightBtn');
    rightBtnNode.layer = Layers.Enum.UI_2D;
    rightBtnNode.setPosition(155, -190, 0);
    const rightTrans = rightBtnNode.addComponent(UITransform);
    rightTrans.setAnchorPoint(0.5, 0.5);
    rightTrans.setContentSize(270, 76);

    const rightGfx = rightBtnNode.addComponent(Graphics);
    rightGfx.fillColor = new Color(180, 50, 35, 255); // 朱砂红底
    rightGfx.roundRect(-135, -38, 270, 76, 8);
    rightGfx.fill();
    rightGfx.lineWidth = 2;
    rightGfx.strokeColor = new Color(225, 185, 90, 255); // 金色勾边
    rightGfx.roundRect(-135, -38, 270, 76, 8);
    rightGfx.stroke();

    const rightLabelNode = new Node('RightLabel');
    rightLabelNode.layer = Layers.Enum.UI_2D;
    const rLblTrans = rightLabelNode.addComponent(UITransform);
    rLblTrans.setAnchorPoint(0.5, 0.5);
    rLblTrans.setContentSize(250, 70);

    this.rightHintLabel = rightLabelNode.addComponent(Label);
    this.rightHintLabel.string = `批朱 →\n${rightOpt ? rightOpt.text : '准予'}`;
    this.rightHintLabel.fontSize = 18;
    this.rightHintLabel.lineHeight = 24;
    this.rightHintLabel.color = new Color(255, 250, 235, 255);
    this.rightHintLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    rightBtnNode.addChild(rightLabelNode);
    this.node.addChild(rightBtnNode);

    // 点击右选项
    rightBtnNode.on(Node.EventType.TOUCH_END, (e: unknown) => {
      if (rightOpt) this.confirmSelection(rightOpt.id, 1);
    });

    // 6. 注册拖拽手势
    this.registerTouch();
  }

  private registerTouch(): void {
    this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
  }

  private onTouchStart(e: unknown): void {
    const touch = e as EventTouch;
    this.isDragging = true;
    this.startTouchPos.set(touch.getUILocation().x, touch.getUILocation().y, 0);
  }

  private onTouchMove(e: unknown): void {
    if (!this.isDragging) return;
    const touch = e as EventTouch;
    const currentPos = touch.getUILocation();
    const deltaX = currentPos.x - this.startTouchPos.x;
    this.currentOffset = deltaX;
    // 跟随位移与轻微倾斜角度
    this.node.setPosition(deltaX, 0, 0);
    const rotZ = -(deltaX / 500) * 8; // -8° ~ 8°
    this.node.setRotationFromEuler(0, 0, rotZ);

    // 左右文字高亮提示
    if (this.leftHintLabel && this.rightHintLabel) {
      if (deltaX < -60) {
        this.leftHintLabel.node.setScale(1.15, 1.15, 1);
        this.rightHintLabel.node.setScale(0.9, 0.9, 1);
      } else if (deltaX > 60) {
        this.rightHintLabel.node.setScale(1.15, 1.15, 1);
        this.leftHintLabel.node.setScale(0.9, 0.9, 1);
      } else {
        this.leftHintLabel.node.setScale(1.0, 1.0, 1);
        this.rightHintLabel.node.setScale(1.0, 1.0, 1);
      }
    }
  }

  private onTouchEnd(): void {
    if (!this.isDragging) return;
    this.isDragging = false;

    const threshold = 110;
    if (this.currentOffset < -threshold && this.decisionData?.options[0]) {
      // 触发左侧选项 (冷眼旁观/拒绝)
      this.confirmSelection(this.decisionData.options[0].id, -1);
    } else if (this.currentOffset > threshold) {
      // 触发右侧选项 (倾力入局/照准)
      const targetOpt = this.decisionData?.options[1] || this.decisionData?.options[0];
      if (targetOpt) {
        this.confirmSelection(targetOpt.id, 1);
      } else {
        this.resetPosition();
      }
    } else {
      // 未达到滑动门槛，弹性复位
      this.resetPosition();
    }
  }

  private onTouchCancel(): void {
    this.isDragging = false;
    this.resetPosition();
  }

  private resetPosition(): void {
    tween(this.node)
      .to(0.2, { position: v3(0, 0, 0) }, { easing: 'backOut' })
      .call(() => {
        this.node.setRotationFromEuler(0, 0, 0);
      })
      .start();

    if (this.leftHintLabel) this.leftHintLabel.node.setScale(1.0, 1.0, 1);
    if (this.rightHintLabel) this.rightHintLabel.node.setScale(1.0, 1.0, 1);
  }

  private confirmSelection(optionId: string, direction: number): void {
    // 飞出屏幕动效
    const targetX = direction * 800;
    tween(this.node)
      .to(0.2, { position: v3(targetX, 0, 0) }, { easing: 'quadIn' })
      .call(() => {
        if (this.onSelectCallback) {
          this.onSelectCallback(optionId);
        }
      })
      .start();
  }
}
