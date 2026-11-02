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
  BlockInputEvents,
} from 'cc';
import { GameEngine } from '../core/engine/GameEngine';
import { GameSession } from '../application/GameSession';
import { getNativeMingEndContent } from '../application/NativeContentLoader';
import type { GameView, PendingDecision, LogEntry } from '../core/types/schema';

const { ccclass } = _decorator;

/**
 * GameMain: 正式版竖屏水墨界面 (Step 06 - 阶段一)
 * 纯真实数据流：接入真实明末 0.7.1 ContentBundle 与 GameSession
 */
@ccclass('GameMain')
export class GameMain extends Component {
  private session: GameSession | null = null;
  private currentView: GameView | null = null;

  // UI 核心节点引用
  private eraYearLabel: Label | null = null;
  private identityLabel: Label | null = null;
  private attrLabel: Label | null = null;
  private logContentNode: Node | null = null;
  private scrollView: ScrollView | null = null;

  // 控制与交互面板
  private actionPanel: Node | null = null;
  private advanceBtn: Node | null = null;
  private optionDrawerNode: Node | null = null;
  // 历史日志条目缓存
  private renderedLogsCount: number = 0;

  onLoad(): void {
    this.buildBaseView();
    this.startNewLife();
  }

  /**
   * 1. 纯代码构建 750x1334 暗色水墨主界面
   */
  private buildBaseView(): void {
    const root = this.node;
    root.layer = Layers.Enum.UI_2D;
    const rootTransform = root.getComponent(UITransform) || root.addComponent(UITransform);
    rootTransform.setContentSize(750, 1334);

    // 1.1 顶部水墨档案 HUD (710 x 140)
    const headerBox = new Node('HeaderHUD');
    headerBox.layer = Layers.Enum.UI_2D;
    headerBox.parent = root;
    headerBox.setPosition(0, 560);
    const headerTransform = headerBox.addComponent(UITransform);
    headerTransform.setContentSize(710, 140);

    const eraYearNode = new Node('EraYearLabel');
    eraYearNode.layer = Layers.Enum.UI_2D;
    eraYearNode.parent = headerBox;
    eraYearNode.setPosition(0, 40);
    const eraLabel = eraYearNode.addComponent(Label);
    eraLabel.string = '大明崇祯纪事 · 正在启幕...';
    eraLabel.fontSize = 26;
    eraLabel.lineHeight = 32;
    eraLabel.color = new Color(223, 204, 163, 255); // 水墨金
    this.eraYearLabel = eraLabel;

    const identityNode = new Node('IdentityLabel');
    identityNode.layer = Layers.Enum.UI_2D;
    identityNode.parent = headerBox;
    identityNode.setPosition(0, 5);
    const idLabel = identityNode.addComponent(Label);
    idLabel.string = '出身: 测算命中... | 地区: 关陕';
    idLabel.fontSize = 18;
    idLabel.lineHeight = 24;
    idLabel.color = new Color(185, 185, 190, 255);
    this.identityLabel = idLabel;

    const attrNode = new Node('AttrLabel');
    attrNode.layer = Layers.Enum.UI_2D;
    attrNode.parent = headerBox;
    attrNode.setPosition(0, -32);
    const aLabel = attrNode.addComponent(Label);
    aLabel.string = '体魄: 0 | 见识: 0 | 财资: 0 | 声望: 0 | 气运: 0';
    aLabel.fontSize = 17;
    aLabel.lineHeight = 22;
    aLabel.color = new Color(210, 210, 215, 255);
    this.attrLabel = aLabel;

    // 1.2 中部史书流视窗 (ScrollView, 710 x 840)
    const logScrollNode = new Node('LogScrollView');
    logScrollNode.layer = Layers.Enum.UI_2D;
    logScrollNode.parent = root;
    logScrollNode.setPosition(0, 30);
    const scrollTransform = logScrollNode.addComponent(UITransform);
    scrollTransform.setContentSize(710, 840);

    // 1. 添加视口裁剪遮罩 (Mask)：超出 840 高度的文字自动精准裁切，严禁溢出到按钮区
    logScrollNode.addComponent(Mask);

    const scrollView = logScrollNode.addComponent(ScrollView);
    scrollView.horizontal = false;
    scrollView.vertical = true;
    this.scrollView = scrollView;

    const contentNode = new Node('LogContent');
    contentNode.layer = Layers.Enum.UI_2D;
    contentNode.parent = logScrollNode;
    const contentTransform = contentNode.addComponent(UITransform);
    contentTransform.setContentSize(690, 800);
    contentTransform.setAnchorPoint(0.5, 1); // 顶部对齐
    contentNode.setPosition(0, 420);
    scrollView.content = contentNode;
    this.logContentNode = contentNode;

    // 1.3 底部交互与推进操作区 (710 x 260)
    const actionPanel = new Node('ActionPanel');
    actionPanel.layer = Layers.Enum.UI_2D;
    actionPanel.parent = root;
    actionPanel.setPosition(0, -490);
    const panelTransform = actionPanel.addComponent(UITransform);
    panelTransform.setContentSize(710, 260);
    this.actionPanel = actionPanel;

    // 选项抽屉挂载节点 (用于动态排版 1-4 个选项按钮)
    const drawerNode = new Node('OptionDrawer');
    drawerNode.layer = Layers.Enum.UI_2D;
    drawerNode.parent = actionPanel;
    drawerNode.setPosition(0, 45);
    const drawerTransform = drawerNode.addComponent(UITransform);
    drawerTransform.setContentSize(710, 160);
    this.optionDrawerNode = drawerNode;
    // 推进一年主按钮
    const btnAdvance = this.createButton(actionPanel, '顺遂流转 · 推进一年', 0, 40, 420, 64, () => {
      this.onAdvance();
    });
    this.advanceBtn = btnAdvance;

    // 辅助控制栏
    this.createButton(actionPanel, '重启人生', -220, -45, 180, 50, () => {
      this.startNewLife();
    });
    this.createButton(actionPanel, '存档状态', 0, -45, 180, 50, () => {
      this.showSaveTip();
    });
    this.createButton(actionPanel, '滚至底部', 220, -45, 180, 50, () => {
      if (this.scrollView) this.scrollView.scrollToBottom(0.3);
    });
  }

  /**
   * 2. 真实启动新人生 (接入 ming_end 0.7.1 ContentBundle)
   */
  private startNewLife(): void {
    if (this.logContentNode) {
      this.logContentNode.removeAllChildren();
    }
    this.renderedLogsCount = 0;

    try {
      const content = getNativeMingEndContent();
      const engine = new GameEngine(content.bundle, content.fingerprint);

      // 初始化人生 (使用随机种子)
      const seed = Math.floor(Math.random() * 4294967295);
      const initResult = engine.initGame({ seed });
      if (!initResult.ok) {
        this.appendSystemLog(`开局失败：${initResult.error.message}`);
        return;
      }

      // 创建 GameSession
      this.session = new GameSession(engine, {
        persist: async () => {},
        load: async () => null,
        hash: (v) => String(v),
      });

      this.currentView = initResult.state;
      this.updateHUD(this.currentView);

      // 输出生平首段史书与开局日志
      if (initResult.logs && initResult.logs.length > 0) {
        for (const log of initResult.logs) {
          this.appendLogEntry(log.message, log.type);
        }
      }
      this.appendSystemLog(`【生平既定】人生种子 ${seed} · 天命已启。`);

      // 检查开局是否直接面临重大抉择 (方向选择)
      this.renderPending(initResult.pending);
    } catch (e) {
      this.appendSystemLog(`加载原生明末内容包异常: ${String(e)}`);
    }
  }

  /**
   * 3. 推进年轮 (推进一年或继续流转)
   */
  private async onAdvance(): Promise<void> {
    if (!this.session) return;

    if (this.currentView && this.currentView.status === 'ENDED') {
      this.appendSystemLog('【生平盖棺】尘埃落定，不可复进。请点击“重启人生”。');
      return;
    }

    try {
      // 提交 next 命令给 Session
      const res = await this.session.command({ type: 'next' });
      if (!res.ok) {
        this.appendSystemLog(`推进遇阻: ${res.error.message}`);
        return;
      }

      this.currentView = res.state;
      if (this.currentView) {
        this.updateHUD(this.currentView);
      }

      // 实时追加本年发生的所有历史大势与人生际遇日志
      if (res.logs && res.logs.length > 0) {
        for (const log of res.logs) {
          this.appendLogEntry(log.message, log.type);
        }
      }

      // 刷新待处理决断（选项抽屉或阶段检定）
      this.renderPending(res.pending);

      if (this.currentView && this.currentView.status === 'ENDED') {
        this.appendEndingHint();
      }
      // 自动滚到最新日志
      if (this.scrollView) {
        this.scrollToLatest();
      }
    } catch (e) {
      this.appendSystemLog(`推进异常: ${String(e)}`);
    }
  }

  /**
   * 4. 实时刷新顶部 HUD 档案与五维属性
   */
  private updateHUD(view: GameView): void {
    const p = view.player;
    if (this.eraYearLabel) {
      const reignYear = p.calendar_year - 1627;
      this.eraYearLabel.string = `崇祯 ${reignYear} 年 (${p.calendar_year}) · ${p.age} 岁`;
    }

    if (this.identityLabel) {
      this.identityLabel.string = `身份: ${p.identity_id} | 地区: ${p.region_id} | 阶层: ${p.caste_id}`;
    }

    if (this.attrLabel) {
      const a = p.attributes;
      this.attrLabel.string = `体魄: ${a.physique} | 见识: ${a.intelligence} | 财资: ${a.wealth} | 声望: ${a.prestige} | 气运: ${a.luck}`;
    }
  }

  /**
   * 5. 渲染单条史书日志 (富文本换行与水墨配色)
   */
  private appendLogEntry(message: string, type: string): void {
    // 严格过滤引擎内部调度与条件审计日志（这些是底层用来判断事件是否触发的，不属于面向玩家的剧情）
    if (
      !this.logContentNode ||
      !message ||
      type === 'skip' ||
      type === 'draw' ||
      message.startsWith('CONDITION_') ||
      message.startsWith('ZERO_WEIGHT') ||
      message.startsWith('MAX_OCCURRENCES') ||
      message.startsWith('COOLDOWN') ||
      message.startsWith('PHYSIQUE_TOO_LOW')
    ) {
      return;
    }
    this.renderedLogsCount += 1;
    const textNode = new Node(`Log_${this.renderedLogsCount}`);
    textNode.layer = Layers.Enum.UI_2D;
    textNode.parent = this.logContentNode;

    const transform = textNode.addComponent(UITransform);
    transform.setContentSize(670, 36);
    transform.setAnchorPoint(0.5, 1);

    const label = textNode.addComponent(Label);
    label.string = message;
    label.fontSize = 17;
    label.lineHeight = 24;
    label.overflow = Label.Overflow.RESIZE_HEIGHT;

    // 水墨分级染色
    if (type === 'option' || message.includes('【抉择】') || message.includes('【重大抉择】')) {
      label.color = new Color(223, 160, 75, 255); // 琥珀金
    } else if (type === 'death' || message.includes('【危机】') || message.includes('【伤病】') || message.includes('【死亡】')) {
      label.color = new Color(225, 75, 75, 255); // 朱砂红
    } else if (type === 'effects' || message.includes('【结果】')) {
      label.color = new Color(130, 195, 150, 255); // 青竹色
    } else if (type === 'achievement') {
      label.color = new Color(245, 215, 110, 255); // 耀金色
    } else {
      label.color = new Color(220, 220, 210, 255); // 宣纸白
    }

    this.updateLogContentLayout();
  }

  private appendSystemLog(msg: string): void {
    this.appendLogEntry(msg, 'system');
  }

  private appendChoiceHint(pending: Extract<PendingDecision, { kind: 'option' }>): void {
    this.appendLogEntry(`【重大抉择降临】面前有 ${pending.options.length} 条生路待你定夺。`, 'option');
  }

  private appendEndingHint(): void {
    this.appendLogEntry(`【寿终正寝 · 纪事结卷】大明此生已尽，可点击“重启人生”再入轮回。`, 'death');
  }

  /**
   * 6. 动态重算长日志高度，保证顺畅滚动
   */
  private updateLogContentLayout(): void {
    if (!this.logContentNode) return;

    const children = this.logContentNode.children;
    let accumulatedY = 0;
    const spacing = 12;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const transform = child.getComponent(UITransform);
      const h = transform ? transform.height : 28;
      child.setPosition(0, -accumulatedY);
      accumulatedY += h + spacing;
    }

    const contentTransform = this.logContentNode.getComponent(UITransform);
    if (contentTransform) {
      contentTransform.setContentSize(690, Math.max(820, accumulatedY + 40));
    }
  }
  private scrollToLatest(): void {
    setTimeout(() => {
      if (this.scrollView) {
        this.scrollView.scrollToBottom(0.3, true);
      }
    }, 50);
  }
  private showSaveTip(): void {
    this.appendSystemLog('【存档检测】当前人生状态已在 GameSession 中实时保持，支持无缝推进。');
  }
  /**
   * 7. 渲染待处理决断（重大抉择选项抽屉 / D20 骰子检定阶段）
   */
  private renderPending(pending: PendingDecision | null): void {
    if (!this.optionDrawerNode) return;
    this.optionDrawerNode.removeAllChildren();

    if (!pending) {
      // 无待决断：展示“推进一年”按钮
      if (this.advanceBtn) this.advanceBtn.active = true;
      return;
    }

    // 有待决断：隐藏常规推进按钮，展示专属决断交互
    if (this.advanceBtn) this.advanceBtn.active = false;

    if (pending.kind === 'option') {
      const options = pending.options;
      const count = options.length;
      const btnHeight = 48;
      const spacing = 8;
      const totalHeight = count * (btnHeight + spacing);
      let startY = totalHeight / 2 - btnHeight / 2;

      for (let i = 0; i < count; i++) {
        const opt = options[i];
        const riskLabel = opt.risk === 'high' ? '[高风险] ' : opt.risk === 'safe' ? '[安全] ' : '[普通] ';
        const title = `${riskLabel}${opt.text}`;
        const yPos = startY - i * (btnHeight + spacing);

        const btn = this.createButton(
          this.optionDrawerNode,
          title,
          0,
          yPos,
          640,
          btnHeight,
          () => {
            this.onChooseOption(opt.id, opt.available, opt.reason);
          }
        );

        // 如果条件不足不可选，置灰并标注原因
        if (!opt.available) {
          const btnComp = btn.getComponent(Button);
          if (btnComp) btnComp.interactable = false;
          const label = btn.getChildByName('Label')?.getComponent(Label);
          if (label) {
            label.color = new Color(140, 140, 145, 255);
            label.string = `${title} (${opt.reason || '门槛不足'})`;
          }
        }
      }
    } else if (pending.kind === 'stage') {
      // 骰子阶段检定
      const check = pending.check;
      const stageTitle = `【投掷 D20 检定】DC ${check.dc} · 判定天命`;
      this.createButton(this.optionDrawerNode, stageTitle, 0, 0, 560, 60, () => {
        this.onResolveStage();
      });
    }
  }

  /**
   * 选择生路选项
   */
  private async onChooseOption(optionId: string, available: boolean, reason: string | null): Promise<void> {
    if (!this.session) return;
    if (!available) {
      this.appendSystemLog(`【天命受阻】该生路不可行：${reason || '条件不符'}`);
      return;
    }

    try {
      const res = await this.session.command({ type: 'choose', optionId });
      if (!res.ok) {
        this.appendSystemLog(`抉择失败: ${res.error.message}`);
        return;
      }

      this.currentView = res.state;
      if (this.currentView) {
        this.updateHUD(this.currentView);
      }

      if (res.logs && res.logs.length > 0) {
        for (const log of res.logs) {
          this.appendLogEntry(log.message, log.type);
        }
      }

      this.renderPending(res.pending);

      if (this.currentView && this.currentView.status === 'ENDED') {
        this.appendEndingHint();
      }

      this.scrollToLatest();
    } catch (e) {
      this.appendSystemLog(`抉择异常: ${String(e)}`);
    }
  }

  /**
   * 提交阶段骰子结算
   */
  private async onResolveStage(): Promise<void> {
    if (!this.session) return;

    try {
      const res = await this.session.command({ type: 'stage' });
      if (!res.ok) {
        this.appendSystemLog(`阶段检定失败: ${res.error.message}`);
        return;
      }

      this.currentView = res.state;
      if (this.currentView) {
        this.updateHUD(this.currentView);
      }

      if (res.logs && res.logs.length > 0) {
        for (const log of res.logs) {
          this.appendLogEntry(log.message, log.type);
        }
      }

      this.renderPending(res.pending);

      if (this.currentView && this.currentView.status === 'ENDED') {
        this.appendEndingHint();
      }

      this.scrollToLatest();
    } catch (e) {
      this.appendSystemLog(`阶段检定异常: ${String(e)}`);
    }
  }
  /**
   * 7. 通用水墨按钮工厂
   */
  private createButton(
    parent: Node,
    title: string,
    x: number,
    y: number,
    w: number,
    h: number,
    onClick: () => void
  ): Node {
    const btnNode = new Node(`Btn_${title}`);
    btnNode.layer = Layers.Enum.UI_2D;
    btnNode.parent = parent;
    btnNode.setPosition(x, y);
    const transform = btnNode.addComponent(UITransform);
    transform.setContentSize(w, h);

    const labelNode = new Node('Label');
    labelNode.layer = Layers.Enum.UI_2D;
    labelNode.parent = btnNode;
    const label = labelNode.addComponent(Label);
    label.string = title;
    label.fontSize = 19;
    label.lineHeight = 24;
    label.color = new Color(240, 240, 240, 255);

    btnNode.addComponent(Button);
    btnNode.on(Node.EventType.TOUCH_END, onClick, this);
    return btnNode;
  }
}
