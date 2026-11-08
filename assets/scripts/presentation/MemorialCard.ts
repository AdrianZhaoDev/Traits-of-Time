import {
  _decorator,
  Component,
  Node,
  Label,
  Graphics,
  UITransform,
  Color,
  ScrollView,
  Mask,
  Layers,
  EventTouch,
  UIOpacity,
  tween,
  v3,
} from 'cc';
import type { PendingDecision } from '../core/types/schema';
import { EnumMapper } from './EnumMapper';
import { createArt } from './ArtAssets';
import { GameAudio } from './GameAudio';
import { prefersReducedNarrativeMotion } from './NarrativePanelArt';

export type OptionPending = Extract<PendingDecision, { kind: 'option' }>;

const { ccclass } = _decorator;
const riskNames = { safe: '安全', normal: '普通', high: '高风险' } as const;
const PANEL_WIDTH = 710;
const PANEL_HEIGHT = 900;
const SCROLL_WIDTH = 662;
const SCROLL_HEIGHT = 652;
const ROW_WIDTH = 646;
const TEXT_WIDTH = 598;
const palette = {
  background: new Color(19, 21, 28, 255),
  panel: new Color(26, 29, 38, 255),
  option: new Color(34, 39, 54, 255),
  pressed: new Color(43, 50, 69, 255),
  border: new Color(53, 59, 73, 255),
  text: new Color(237, 241, 247, 255),
  secondary: new Color(140, 150, 168, 255),
  cyan: new Color(0, 240, 255, 255),
  gold: new Color(255, 190, 11, 255),
  green: new Color(5, 223, 183, 255),
  red: new Color(255, 42, 95, 255),
};

interface DecisionRow {
  id: string;
  node: Node;
  graphics: Graphics;
  height: number;
  available: boolean;
  risk: OptionPending['options'][number]['risk'];
}

/** 金色标题栏固定；事件正文与全部真实选项共用一个滚动区，不截断长分支。 */
@ccclass('MemorialCard')
export class MemorialCard extends Component {
  public reducedMotion = false;
  private presentedDecisionId: string | null = null;
  private surfaceNode: Node | null = null;
  private readonly entranceAnimations = new Set<{ stop(): void }>();
  private submitting = false;
  private selectedOptionId: string | null = null;
  private noticeLabel: Label | null = null;
  private rows: DecisionRow[] = [];

  public init(
    decision: OptionPending,
    onSelect: (optionId: string) => void,
    eventText = '',
    optionDetails: Record<string, string[]> = {},
    onManageCareers?: () => void,
  ): void {
    const isNewDecision = this.presentedDecisionId !== decision.event_instance_id;
    this.presentedDecisionId = decision.event_instance_id;
    this.stopEntrance();
    this.submitting = false;
    this.selectedOptionId = null;
    this.noticeLabel = null;
    this.rows = [];
    for (const child of [...this.node.children]) child.destroy();
    this.node.removeAllChildren();
    this.node.layer = Layers.Enum.UI_2D;
    this.node.setPosition(0, 0, 0);

    const transform = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    transform.setAnchorPoint(0.5, 0.5);
    transform.setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
    // Fit/scale stays on the modal node; only this inner surface moves, so layout
    // and touch availability never wait for a presentation tween.
    const surface = new Node('DecisionPanelSurface');
    surface.layer = Layers.Enum.UI_2D;
    surface.addComponent(UITransform).setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
    surface.addComponent(UIOpacity);
    this.node.addChild(surface);
    this.surfaceNode = surface;

    const background = new Node('MemorialPaperBg');
    background.layer = Layers.Enum.UI_2D;
    background.addComponent(UITransform).setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
    const panel = background.addComponent(Graphics);
    panel.fillColor = palette.panel;
    panel.strokeColor = palette.gold;
    panel.lineWidth = 2;
    panel.roundRect(-354, -449, 708, 898, 12);
    panel.fill();
    panel.stroke();
    panel.fillColor = palette.gold;
    panel.rect(-353, 389, 706, 58);
    panel.fill();
    surface.addChild(background);

    this.addLabel(surface, 'Title', '★ 重大抉择 · 奏折 ★', -130, 418, 380, 42, 21, palette.background, true);
    this.addLabel(surface, 'DecisionCount', `${decision.options.length} 个选项`, 258, 418, 150, 38, 18, palette.background, true);

    const scrollNode = new Node('OptionScrollView');
    scrollNode.layer = Layers.Enum.UI_2D;
    scrollNode.setPosition(0, 20, 0);
    scrollNode.addComponent(UITransform).setContentSize(SCROLL_WIDTH, SCROLL_HEIGHT);
    surface.addChild(scrollNode);

    const viewport = new Node('Viewport');
    viewport.layer = Layers.Enum.UI_2D;
    viewport.addComponent(UITransform).setContentSize(SCROLL_WIDTH, SCROLL_HEIGHT);
    viewport.addComponent(Mask);
    scrollNode.addChild(viewport);

    const content = new Node('Content');
    content.layer = Layers.Enum.UI_2D;
    const contentTransform = content.addComponent(UITransform);
    contentTransform.setAnchorPoint(0.5, 1);
    content.setPosition(0, SCROLL_HEIGHT / 2, 0);
    viewport.addChild(content);
    const scroll = scrollNode.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.vertical = true;
    scroll.cancelInnerEvents = true;
    scroll.content = content;

    const descriptionTop = 8;
    const description = this.addLabel(content, 'Desc', eventText || '未能读取事件详情。', 0, -descriptionTop, 630, 38, 22, palette.text);
    description.node.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    const descriptionHeight = this.measureLabel(description, 630);
    let offset = descriptionTop + descriptionHeight + 28;

    decision.options.forEach((option, index) => {
      const rowNode = new Node(`Option_${option.id}`);
      rowNode.layer = Layers.Enum.UI_2D;
      const rowTransform = rowNode.addComponent(UITransform);
      rowTransform.setAnchorPoint(0.5, 1);
      rowNode.setPosition(0, -offset, 0);
      content.addChild(rowNode);

      // Risk has its own 40px row. The original 598px title/detail measure and
      // their 28px/24px fonts remain untouched, including long unavailable reasons.
      createArt(rowNode, `RiskIcon_${option.risk}`, `icons/risk-${option.risk}`,
        32, 32, -TEXT_WIDTH / 2 + 16, -28);
      const riskColor = !option.available ? palette.secondary
        : option.risk === 'high' ? palette.red : option.risk === 'safe' ? palette.green : palette.secondary;
      this.addLabel(rowNode, 'RiskLabel', riskNames[option.risk], -151, -28, 200, 34, 18, riskColor);
      const title = this.addLabel(rowNode, 'OptionTitle', `${index + 1}. ${option.text}`, 0, -60,
        TEXT_WIDTH, 40, 22, option.available ? palette.text : palette.secondary);
      title.node.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
      const titleHeight = this.measureLabel(title, TEXT_WIDTH);
      const checks = option.checks.length === 0 ? '无检定' : `接下来检定：\n${option.checks.map(check => {
        const modifier = check.modifier_after ?? check.modifier;
        const value = Number.isFinite(check.attribute_value) ? ` ${check.attribute_value}` : '';
        const capped = check.modifier_before !== undefined && check.modifier_after !== undefined
          && check.modifier_before !== check.modifier_after ? '（已按上下限计算）' : '';
        const minimum = check.raw_minimum === undefined ? '' : `，骰子至少掷出 ${check.raw_minimum}`;
        const probability = Number.isFinite(check.success_probability)
          ? `${Math.round(check.success_probability * 100)}%` : '未提供';
        return `${EnumMapper.translateStat(check.attribute).name}${value} / 难度 ${check.dc}，修正 ${modifier >= 0 ? '+' : ''}${modifier}${capped}${minimum}，成功率 ${probability}`;
      }).join('\n')}`;
      const reason = option.reason === 'OUTCOME_NOT_APPLICABLE' ? EnumMapper.playerError(option.reason) : option.reason;
      const availability = option.available ? '可选' : `不可选：${reason || '尚未满足条件。'}`;
      const text = [availability, checks, ...(optionDetails[option.id] ?? [])].join('\n');
      const detail = this.addLabel(rowNode, 'OptionDetail', text, 0, -72 - titleHeight,
        TEXT_WIDTH, 34, 18, palette.secondary);
      detail.node.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
      const detailHeight = this.measureLabel(detail, TEXT_WIDTH);
      const height = 92 + titleHeight + detailHeight;
      rowTransform.setContentSize(ROW_WIDTH, height);
      const row: DecisionRow = {
        id: option.id,
        node: rowNode,
        graphics: rowNode.addComponent(Graphics),
        height,
        available: option.available,
        risk: option.risk,
      };
      this.rows.push(row);
      this.drawOption(row);

      if (option.available) {
        let origin: { x: number; y: number } | null = null;
        let dragged = false;
        const moved = (event?: EventTouch): boolean => {
          if (!event || !origin) return false;
          const point = event.getUILocation();
          return Math.abs(point.x - origin.x) + Math.abs(point.y - origin.y) > 14;
        };
        rowNode.on(Node.EventType.TOUCH_START, (event?: EventTouch) => {
          origin = event ? event.getUILocation() : null;
          dragged = false;
          if (!this.submitting) this.drawOption(row, true);
        });
        rowNode.on(Node.EventType.TOUCH_MOVE, (event?: EventTouch) => {
          dragged = dragged || moved(event);
          if (dragged) this.drawOption(row);
        });
        rowNode.on(Node.EventType.TOUCH_CANCEL, () => {
          dragged = true;
          origin = null;
          this.drawOption(row);
        });
        rowNode.on(Node.EventType.TOUCH_END, (event?: EventTouch) => {
          const wasDragged = dragged || moved(event);
          origin = null;
          this.drawOption(row);
          if (this.submitting || wasDragged) return;
          this.submitting = true;
          this.selectedOptionId = option.id;
          for (const other of this.rows) this.drawOption(other);
          if (this.noticeLabel) {
            this.noticeLabel.string = '正在处理，请稍等。';
            this.noticeLabel.color = palette.gold;
          }
          // GameMain plays the choice cue only after the engine accepts this submission.
          onSelect(option.id);
        });
      }
      offset += height + 16;
    });
    contentTransform.setContentSize(SCROLL_WIDTH, Math.max(SCROLL_HEIGHT, offset + 8));

    this.noticeLabel = this.addLabel(surface, 'Notice', '上下滑动查看选项，点击即可选择。',
      onManageCareers ? -106 : 0, -390, onManageCareers ? 410 : 646, 48, 18, palette.secondary);
    if (onManageCareers) {
      const manage = new Node('ManageCareers');
      manage.layer = Layers.Enum.UI_2D;
      manage.setPosition(225, -390, 0);
      manage.addComponent(UITransform).setContentSize(196, 52);
      const graphics = manage.addComponent(Graphics);
      const drawManage = (pressed: boolean): void => {
        graphics.clear();
        graphics.fillColor = pressed ? palette.pressed : palette.option;
        graphics.strokeColor = pressed ? palette.cyan : palette.border;
        graphics.lineWidth = 2;
        graphics.roundRect(-98, -26, 196, 52, 6);
        graphics.fill();
        graphics.stroke();
      };
      drawManage(false);
      this.addLabel(manage, 'ManageLabel', '管理事业', 0, 0, 180, 44, 19, palette.text, true);
      manage.on(Node.EventType.TOUCH_START, () => { if (!this.submitting) drawManage(true); });
      manage.on(Node.EventType.TOUCH_CANCEL, () => drawManage(false));
      manage.on(Node.EventType.TOUCH_END, () => {
        drawManage(false);
        if (!this.submitting) {
          GameAudio.instance?.playCue('tap');
          onManageCareers();
        }
      });
      surface.addChild(manage);
    }
    if (isNewDecision) this.playEntrance(surface);
  }

  public showError(message: string): void {
    this.submitting = false;
    this.selectedOptionId = null;
    GameAudio.instance?.playCue('error');
    for (const row of this.rows) this.drawOption(row);
    if (this.noticeLabel) {
      this.noticeLabel.string = `选择未完成：${message}`;
      this.noticeLabel.color = palette.red;
    }
  }

  private drawOption(row: DecisionRow, pressed = false): void {
    const selected = this.submitting && this.selectedOptionId === row.id;
    const graphics = row.graphics;
    graphics.clear();
    graphics.fillColor = row.available ? pressed ? palette.pressed : palette.option : palette.panel;
    graphics.strokeColor = selected ? palette.gold : pressed && !this.submitting ? palette.cyan : palette.border;
    graphics.lineWidth = selected ? 2.5 : 1.5;
    graphics.roundRect(-ROW_WIDTH / 2, -row.height, ROW_WIDTH, row.height, 6);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = !row.available || (this.submitting && !selected) ? palette.border
      : row.risk === 'high' ? palette.red : row.risk === 'safe' ? palette.green : palette.secondary;
    graphics.rect(-ROW_WIDTH / 2 + 1, -row.height + 8, 4, row.height - 16);
    graphics.fill();
  }
  private playEntrance(surface: Node): void {
    if (prefersReducedNarrativeMotion(this.reducedMotion)) return;
    surface.setPosition(0, -10, 0);
    const opacity = surface.getComponent(UIOpacity)!;
    opacity.opacity = 224;
    const movement = tween(surface).to(0.20, { position: v3(0, 0, 0) }, { easing: 'cubicOut' });
    const appearance = tween(opacity).to(0.20, { opacity: 255 }, { easing: 'quadOut' });
    this.entranceAnimations.add(movement);
    this.entranceAnimations.add(appearance);
    movement.call(() => this.entranceAnimations.delete(movement)).start();
    appearance.call(() => this.entranceAnimations.delete(appearance)).start();
  }

  private stopEntrance(): void {
    for (const animation of this.entranceAnimations) animation.stop();
    this.entranceAnimations.clear();
    if (!this.surfaceNode?.isValid) return;
    this.surfaceNode.setPosition(0, 0, 0);
    this.surfaceNode.getComponent(UIOpacity)!.opacity = 255;
  }

  onDisable(): void {
    this.stopEntrance();
  }

  onDestroy(): void {
    this.stopEntrance();
  }


  private measureLabel(label: Label, width: number): number {
    label.overflow = Label.Overflow.RESIZE_HEIGHT;
    label.updateRenderData(true);
    const columns = Math.max(1, Math.floor(width / label.fontSize));
    const lines = label.string.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0);
    const height = Math.max(label.node.getComponent(UITransform)!.height, lines * label.lineHeight);
    label.node.getComponent(UITransform)!.setContentSize(width, height);
    return height;
  }

  private addLabel(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, size: number, color: Color, centered = false): Label {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = Math.round(size * 1.4);
    label.color = color;
    label.horizontalAlign = centered ? Label.HorizontalAlign.CENTER : Label.HorizontalAlign.LEFT;
    parent.addChild(node);
    return label;
  }
}
