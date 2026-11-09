import { Layout, ScrollView, env, type IStyle } from 'minigame-canvas-engine';
import type { GameView } from '../../assets/scripts/core/types/schema';
import { GameController, type AppSnapshot } from './controller';
import { GameAudio } from './audio';
import { PixelEffects } from './effects';
import type { GamePlatform } from './platform';
import { GameViewBuilder } from './view';
import { ink, fonts, type UiAction, type UiScene } from './ui';

const screenLabels: Record<string, string> = {
  home: '首页', identity: '确认身份', game: '人生推演', cards: '家当三选一',
  decision: '重大抉择', stage: '检定', career: '管理事业', ending: '人生总结',
  stats: '人生统计', achievements: '生涯成就', sound: '声音设置', relic: '物品详情',
};

type TouchName = 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel';
interface Point { x: number; y: number; id: number }
interface TouchInput {
  type: string; timeStamp: number;
  touches: { identifier: number; pageX: number; pageY: number; clientX: number; clientY: number; timeStamp: number }[];
  changedTouches: TouchInput['touches'];
}
interface Gesture { action: UiAction; id: number; x: number; y: number; start: number; last: number; ended: boolean }
interface WechatInput {
  onTouchStart(callback: (event: TouchInput) => void): void;
  onTouchMove(callback: (event: TouchInput) => void): void;
  onTouchEnd(callback: (event: TouchInput) => void): void;
  onTouchCancel(callback: (event: TouchInput) => void): void;
  offTouchStart(callback: (event: TouchInput) => void): void;
  offTouchMove(callback: (event: TouchInput) => void): void;
  offTouchEnd(callback: (event: TouchInput) => void): void;
  offTouchCancel(callback: (event: TouchInput) => void): void;
}

/** Two real Layout trees keep FX below modal panels and route input only to the top tree. */
export class GameRenderer {
  readonly baseLayout: Layout;
  readonly overlayLayout: Layout;
  private readonly baseCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly baseContext: CanvasRenderingContext2D;
  private readonly overlayContext: CanvasRenderingContext2D;
  private readonly view: GameViewBuilder;
  private readonly audio: GameAudio;
  private readonly effects: PixelEffects;
  private readonly cleanups: (() => void)[] = [];
  private baseScene: UiScene | null = null;
  private overlayScene: UiScene | null = null;
  private state: AppSnapshot;
  private pendingRender = true;
  private height = 1334;
  private safeTop = 0;
  private safeBottom = 0;
  private frameId = 0;
  private visible = true;
  private disposed = false;
  private gesture: Gesture | null = null;
  private pointerId: number | null = null;
  private lastView: GameView | null = null;
  private lastFolds = 0;
  private latestRequested = false;
  private modalEntered = 0;
  private previousLayer = '';
  private focusId: string | null = null;
  private noticeUntil = 0;
  private lastNotice = '';
  private readonly memoryNotice: string;
  private readonly pulses = new Map<string, { at: number; color: string; base: string }>();
  private readonly reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  private semantic: HTMLElement | null = null;
  private semanticText: HTMLElement | null = null;
  private semanticActions: HTMLElement | null = null;
  private live: HTMLElement | null = null;

  constructor(private readonly platform: GamePlatform, readonly controller: GameController) {
    // Layout's default browser adapter only listens to mouse events. Pointer routing also
    // covers touch, pen, capture, cancellation, and modal input isolation.
    const ignoreBinding = (): void => {};
    env.onTouchStart = env.onTouchMove = env.onTouchEnd = env.onTouchCancel = ignoreBinding;
    env.offTouchStart = env.offTouchMove = env.offTouchEnd = env.offTouchCancel = ignoreBinding;
    env.createCanvas = () => platform.createCanvas();
    env.createImage = () => platform.createImage();
    env.getDevicePixelRatio = () => platform.getViewport().pixelRatio;
    env.getRootCanvasSize = () => ({ width: 750, height: this.height });
    this.baseLayout = new Layout({});
    this.overlayLayout = new Layout({});
    this.baseCanvas = platform.createCanvas();
    this.overlayCanvas = platform.createCanvas();
    const baseContext = this.baseCanvas.getContext('2d');
    const overlayContext = this.overlayCanvas.getContext('2d');
    if (!baseContext || !overlayContext) throw new Error('无法创建游戏离屏画布。');
    this.baseContext = baseContext;
    this.overlayContext = overlayContext;
    this.state = controller.snapshot;
    this.memoryNotice = this.state.notice;
    this.audio = new GameAudio(platform);
    this.effects = new PixelEffects(platform);
    this.view = new GameViewBuilder(controller, this.audio, platform, () => { this.pendingRender = true; }, () => {
      this.latestRequested = true;
      const scroll = this.baseLayout.getElementById('history');
      if (scroll instanceof ScrollView) scroll.scrollTo(0, Math.max(0, scroll.scrollHeight - scroll.layoutBox.height), !this.reducedMotion?.matches);
    });
    this.resize();
    this.installInput();
    if (platform.kind === 'web') this.installAccessibility();
    this.cleanups.push(platform.onResize(() => { this.resize(); this.cancelGesture(); }));
    this.cleanups.push(platform.onVisibility(visible => {
      this.visible = visible;
      if (!visible) {
        this.cancelGesture();
        this.baseLayout.ticker.stop();
        this.overlayLayout.ticker.stop();
      } else {
        this.baseLayout.ticker.start();
        if (this.state.overlay) this.overlayLayout.ticker.start();
      }
    }));
    this.cleanups.push(controller.subscribe((snapshot, logs) => {
      const previous = this.state;
      this.state = snapshot;
      this.pendingRender = true;
      if (snapshot.notice !== this.lastNotice) {
        this.lastNotice = snapshot.notice;
        this.noticeUntil = snapshot.notice === this.memoryNotice ? 0 : Date.now() + 4200;
        if (this.live) this.live.textContent = snapshot.notice;
      }
      if (snapshot.screen !== 'game' || (this.lastView && snapshot.view && snapshot.view.player.cards[0] !== this.lastView.player.cards[0])) {
        this.lastView = null;
        this.pulses.clear();
      }
      if (snapshot.screen === 'game' && snapshot.view && this.lastView) {
        for (const key of Object.keys(snapshot.view.player.attributes) as (keyof GameView['player']['attributes'])[]) {
          const value = snapshot.view.player.attributes[key];
          if (value !== this.lastView.player.attributes[key]) this.pulses.set('stat_' + key, {
            at: Date.now(), color: value > this.lastView.player.attributes[key] ? ink.green : ink.red,
            base: key === 'wealth' ? ink.gold : key === 'physique' ? snapshot.view.status === 'ENDED' ? ink.red : ink.green : ink.text,
          });
        }
      }
      this.lastView = snapshot.view;
      if (snapshot.overlay && snapshot.overlay !== previous.overlay) {
        if (snapshot.overlay !== 'stage') this.cancelGesture();
        this.modalEntered = Date.now();
      }
      if (snapshot.view?.status === 'ENDED' || snapshot.view?.status === 'AWAITING_OPTION') this.cancelGesture();
      this.audio.playMusic(snapshot.screen === 'home' ? 'home' : snapshot.view?.status === 'ENDED' ? 'ending' : 'life');
      this.audio.playAmbience(snapshot.screen === 'game' && snapshot.view?.status !== 'ENDED' ? snapshot.view?.player.region_id ?? null : null);
      for (const log of logs) {
        if (log.type === 'death') { this.effects.play('poof'); this.audio.playCue('death'); }
        else if (log.type === 'achievement') { this.effects.play('confetti'); this.audio.playCue('achievement'); }
        else if (log.type === 'card_selected') this.audio.playCue('item');
        else if (log.type === 'option') this.audio.playCue('choice');
        else if (log.type === 'event') this.audio.playCue('reveal');
        else if (log.type === 'effects' && log.data.effects.some(effect => effect.type === 'attribute_add' && effect.attribute === 'wealth' && effect.amount > 0)) {
          this.effects.play('gold'); this.audio.playCue('gain');
        }
      }
    }));
    void this.effects.initialize().catch(() => controller.notify('像素特效素材未能载入，人生推演仍可继续。'));
    this.audio.playMusic('home');
    this.frameId = requestAnimationFrame(this.frame);
  }

  private resize(): void {
    const viewport = this.platform.getViewport();
    this.height = Math.round(750 * viewport.height / viewport.width);
    this.safeTop = Math.round(750 * viewport.safeTop / viewport.width);
    this.safeBottom = Math.round(750 * viewport.safeBottom / viewport.width);
    this.platform.canvas.width = Math.round(viewport.width * viewport.pixelRatio);
    this.platform.canvas.height = Math.round(viewport.height * viewport.pixelRatio);
    for (const canvas of [this.baseCanvas, this.overlayCanvas]) { canvas.width = 750; canvas.height = this.height; }
    const rect = this.platform.kind === 'web' ? this.platform.canvas.getBoundingClientRect() : { left: 0, top: 0 };
    for (const layout of [this.baseLayout, this.overlayLayout]) layout.updateViewPort({
      x: rect.left, y: rect.top, width: viewport.width, height: viewport.height,
    });
    this.pendingRender = true;
  }

  private renderScene(layout: Layout, context: CanvasRenderingContext2D, scene: UiScene, newest: boolean): void {
    const positions = new Map<string, number>();
    for (const id of scene.scrollIds) {
      const previous = layout.getElementById(id);
      if (previous instanceof ScrollView) positions.set(id, previous.scrollTop);
    }
    layout.clear();
    context.clearRect(0, 0, 750, this.height);
    layout.init(scene.xml, scene.styles as Record<string, IStyle>, (value: string) => value
      .replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    layout.layout(context);
    for (const action of scene.actions) {
      const element = layout.getElementById(action.id);
      if (!element || action.kind) continue;
      element.on('click', () => { this.invoke(action); });
      element.on('touchstart', () => {
        if (!action.disabled) element.style.backgroundColor = ink.selected;
      });
      const fill = element.style.backgroundColor;
      for (const event of ['touchend', 'touchcancel']) element.on(event, () => { element.style.backgroundColor = fill; });
    }
    // The scroller initializes after the first layout tick; restore offsets then.
    layout.ticker.next(() => {
      for (const id of scene.scrollIds) {
        const scroll = layout.getElementById(id);
        if (!(scroll instanceof ScrollView)) continue;
        const top = id === 'history' && newest ? Math.max(0, scroll.scrollHeight - scroll.layoutBox.height) : positions.get(id) ?? 0;
        scroll.scrollTo(0, top, false);
      }
    });
  }

  private readonly frame = (): void => {
    if (this.disposed) return;
    if (this.visible) {
      const now = Date.now();
      if (this.pendingRender) {
        this.pendingRender = false;
        const newest = this.latestRequested || this.state.folds.length !== this.lastFolds;
        this.lastFolds = this.state.folds.length;
        this.latestRequested = false;
        this.baseScene = this.view.base(this.state, this.height, this.safeTop, this.safeBottom);
        this.renderScene(this.baseLayout, this.baseContext, this.baseScene, newest);
        if (this.state.overlay) {
          this.overlayScene = this.view.overlay(this.state, this.height, this.safeTop, this.safeBottom);
          this.renderScene(this.overlayLayout, this.overlayContext, this.overlayScene, false);
        } else {
          this.overlayScene = null;
          this.overlayLayout.clear();
          this.overlayLayout.ticker.stop();
          this.overlayContext.clearRect(0, 0, 750, this.height);
        }
        this.syncAccessibility();
      }
      if (this.gesture?.action.kind === 'seal' && !this.gesture.ended && now - this.gesture.start > 350 && now - this.gesture.last > 220
        && !this.state.busy && !this.state.overlay && this.state.view?.status === 'READY') {
        this.gesture.last = now;
        void this.controller.advance();
      }
      for (const [id, pulse] of this.pulses) {
        const element = this.baseLayout.getElementById(id);
        const t = Math.min(1, (now - pulse.at) / 200);
        if (element) {
          element.style.transform = this.reducedMotion?.matches || t >= 1 ? 'scale(1, 1)' : `scale(${1 + 0.22 * Math.sin(t * Math.PI)}, ${1 + 0.22 * Math.sin(t * Math.PI)})`;
          element.style.color = t >= 1 ? pulse.base : pulse.color;
        }
        if (t >= 1) this.pulses.delete(id);
      }
      const context = this.platform.context;
      context.setTransform(this.platform.canvas.width / 750, 0, 0, this.platform.canvas.height / this.height, 0, 0);
      context.clearRect(0, 0, 750, this.height);
      context.drawImage(this.baseCanvas, 0, 0);
      this.effects.draw(context, 750, this.height - this.safeBottom, now, this.state.screen === 'game');
      if (this.state.overlay) {
        context.globalAlpha = this.reducedMotion?.matches ? 1 : Math.min(1, (now - this.modalEntered) / 180);
        context.drawImage(this.overlayCanvas, 0, 0);
        context.globalAlpha = 1;
      }
      this.drawFocus(context);
      if (this.state.notice && now < this.noticeUntil && (!this.state.overlay || (!this.state.busy && this.state.notice !== this.memoryNotice))) {
        this.drawNotice(context, this.state.notice);
      }
    }
    this.frameId = requestAnimationFrame(this.frame);
  };

  private invoke(action: UiAction): void {
    if (action.disabled) return;
    this.audio.unlock();
    this.audio.playCue('tap');
    try {
      const result = action.invoke();
      if (result instanceof Promise) void result.catch(error => this.controller.notify(error instanceof Error ? error.message : '操作未能完成，请重试。'));
    } catch (error) {
      this.controller.notify(error instanceof Error ? error.message : '操作未能完成，请重试。');
    }
  }

  private actionAt(point: Point): UiAction | undefined {
    const layout = this.state.overlay ? this.overlayLayout : this.baseLayout;
    const actions = (this.state.overlay ? this.overlayScene : this.baseScene)?.actions ?? [];
    for (let index = actions.length - 1; index >= 0; index--) {
      const action = actions[index];
      if (action.disabled) continue;
      const element = layout.getElementById(action.id);
      if (!element) continue;
      const rect = layout.getElementViewportRect(element);
      if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) continue;
      let parent = element.parent;
      let clipped = false;
      while (parent) {
        if (parent instanceof ScrollView) {
          const clip = layout.getElementViewportRect(parent);
          if (point.x < clip.left || point.x > clip.right || point.y < clip.top || point.y > clip.bottom) { clipped = true; break; }
        }
        parent = parent.parent;
      }
      if (!clipped) return action;
    }
    return undefined;
  }

  private route(name: TouchName, event: TouchInput, point: Point): void {
    if (name === 'touchstart') {
      if (this.pointerId !== null) return;
      this.pointerId = point.id;
      this.focusId = null;
      this.audio.unlock();
      const action = this.actionAt(point);
      if (action?.kind) {
        this.gesture = { action, id: point.id, x: point.x, y: point.y, start: Date.now(), last: Date.now(), ended: this.state.view?.status === 'ENDED' };
        if (action.kind === 'seal') {
          if (!this.gesture.ended) this.invoke(action);
        } else this.updateRange(point.x);
        return;
      }
    }
    if (this.pointerId !== point.id) return;
    if (this.gesture) {
      if (name === 'touchmove') {
        if (this.gesture.action.kind === 'range') this.updateRange(point.x);
        else if (Math.abs(point.x - this.gesture.x) > 32 || Math.abs(point.y - this.gesture.y) > 32) this.cancelGesture();
      } else if (name === 'touchend') {
        const gesture = this.gesture;
        if (gesture.action.kind === 'range') this.updateRange(point.x);
        else if (gesture.ended && this.actionAt(point)?.id === gesture.action.id) this.invoke(gesture.action);
        this.cancelGesture();
      } else if (name === 'touchcancel') this.cancelGesture();
      return;
    }
    (this.state.overlay ? this.overlayLayout : this.baseLayout).eventHandler(name)(event);
    if (name === 'touchend' || name === 'touchcancel') this.pointerId = null;
  }

  private updateRange(x: number): void {
    if (!this.gesture) return;
    const element = this.overlayLayout.getElementById(this.gesture.action.id);
    if (!element) return;
    const rect = this.overlayLayout.getElementViewportRect(element);
    const inset = 20 * rect.width / 650;
    this.gesture.action.setValue?.(Math.max(0, Math.min(1, (x - rect.left - inset) / (rect.width - 2 * inset))));
  }

  private cancelGesture(): void {
    this.gesture = null;
    this.pointerId = null;
  }

  private installInput(): void {
    if (this.platform.kind === 'wechat') {
      const host = globalThis as typeof globalThis & { wx?: WechatInput; GameGlobal?: { wx?: WechatInput } };
      const wx = host.wx ?? host.GameGlobal?.wx;
      if (!wx) throw new Error('微信触摸接口不可用。');
      const bind = (name: TouchName): ((event: TouchInput) => void) => event => {
        const touch = event.changedTouches[0] ?? event.touches[0];
        if (touch) this.route(name, event, { x: touch.clientX ?? touch.pageX, y: touch.clientY ?? touch.pageY, id: touch.identifier ?? 0 });
      };
      const start = bind('touchstart'); const move = bind('touchmove');
      const end = bind('touchend'); const cancel = bind('touchcancel');
      wx.onTouchStart(start); wx.onTouchMove(move); wx.onTouchEnd(end); wx.onTouchCancel(cancel);
      this.cleanups.push(() => { wx.offTouchStart(start); wx.offTouchMove(move); wx.offTouchEnd(end); wx.offTouchCancel(cancel); });
      return;
    }
    const canvas = this.platform.canvas;
    const handlers: [string, EventListener][] = [];
    for (const [domName, name] of [['pointerdown', 'touchstart'], ['pointermove', 'touchmove'], ['pointerup', 'touchend'], ['pointercancel', 'touchcancel']] as const) {
      const handler = ((event: PointerEvent) => {
        if (event.button > 0 || !event.isPrimary) return;
        if (domName === 'pointerdown') canvas.setPointerCapture(event.pointerId);
        const touch = { identifier: event.pointerId, pageX: event.clientX, pageY: event.clientY, clientX: event.clientX, clientY: event.clientY, timeStamp: event.timeStamp };
        this.route(name, { type: name, timeStamp: event.timeStamp, touches: name === 'touchend' || name === 'touchcancel' ? [] : [touch], changedTouches: [touch] },
          { x: event.clientX, y: event.clientY, id: event.pointerId });
        if (domName === 'pointermove') canvas.style.cursor = this.actionAt({ x: event.clientX, y: event.clientY, id: event.pointerId }) ? 'pointer' : 'default';
        event.preventDefault();
      }) as EventListener;
      canvas.addEventListener(domName, handler, { passive: false });
      handlers.push([domName, handler]);
    }
    const wheel = (event: WheelEvent): void => {
      const layout = this.state.overlay ? this.overlayLayout : this.baseLayout;
      const scene = this.state.overlay ? this.overlayScene : this.baseScene;
      const id = scene?.scrollIds[0];
      const scroll = id ? layout.getElementById(id) : null;
      if (!(scroll instanceof ScrollView)) return;
      scroll.scrollTo(0, Math.max(0, scroll.scrollTop + event.deltaY * 750 / this.platform.getViewport().width), false);
      event.preventDefault();
    };
    const blur = (): void => { this.cancelGesture(); this.focusId = null; };
    canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', blur);
    this.cleanups.push(() => {
      for (const [name, callback] of handlers) canvas.removeEventListener(name, callback);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', blur);
    });
  }

  private installAccessibility(): void {
    const semantic = document.getElementById('game-accessibility');
    if (!semantic) return;
    this.semantic = semantic;
    this.semanticText = document.createElement('div');
    this.semanticText.setAttribute('role', 'log');
    this.semanticActions = document.createElement('div');
    this.live = document.createElement('p');
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    semantic.replaceChildren(this.semanticText, this.semanticActions, this.live);
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { this.controller.close(); event.preventDefault(); return; }
      if (event.key === 'Tab' && this.state.overlay && this.semanticActions) {
        const controls = [...this.semanticActions.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { last?.focus({ preventScroll: true }); event.preventDefault(); }
        else if (!event.shiftKey && document.activeElement === last) { first?.focus({ preventScroll: true }); event.preventDefault(); }
      }
      if (event.target === this.platform.canvas && (event.key === 'Enter' || event.key === ' ')) {
        const action = (this.state.overlay ? this.overlayScene : this.baseScene)?.actions.find(entry => !entry.disabled);
        if (action) this.invoke(action);
        event.preventDefault();
      }
      if (event.target === this.platform.canvas && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
        const layout = this.state.overlay ? this.overlayLayout : this.baseLayout;
        const scene = this.state.overlay ? this.overlayScene : this.baseScene;
        const scroll = layout.getElementById(scene?.scrollIds[0] ?? 'history');
        if (scroll instanceof ScrollView) scroll.scrollTo(0, scroll.scrollTop + (event.key.endsWith('Down') ? 1 : -1) * 240, false);
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', keydown);
    this.cleanups.push(() => { document.removeEventListener('keydown', keydown); semantic.replaceChildren(); });
  }

  private syncAccessibility(): void {
    if (!this.semantic || !this.semanticActions || !this.semanticText) return;
    const scene = this.state.overlay ? this.overlayScene : this.baseScene;
    if (!scene) return;
    const layer = this.state.screen + ':' + (this.state.overlay ?? 'base');
    const changedLayer = layer !== this.previousLayer;
    this.previousLayer = layer;
    this.semantic.setAttribute('role', this.state.overlay ? 'dialog' : 'group');
    this.semantic.setAttribute('aria-label', '时空词条 · ' + screenLabels[this.state.overlay ?? this.state.screen]);
    if (this.state.overlay) this.semantic.setAttribute('aria-modal', 'true'); else this.semantic.removeAttribute('aria-modal');
    const narrative = scene.text.join('\n');
    if (this.semanticText.textContent !== narrative) this.semanticText.textContent = narrative;
    const present = new Map([...this.semanticActions.children].map(element => [element.id, element]));
    const focus = document.activeElement?.id;
    for (const action of scene.actions) {
      const id = 'access_' + action.id;
      let element = present.get(id) as HTMLButtonElement | HTMLInputElement | undefined;
      if (!element) {
        element = action.kind === 'range' ? document.createElement('input') : document.createElement('button');
        element.id = id;
        element.addEventListener('focus', () => { this.focusId = action.id; this.revealFocus(action.id); });
        element.addEventListener('blur', () => { if (this.focusId === action.id) this.focusId = null; });
        this.semanticActions.append(element);
      }
      present.delete(id);
      element.disabled = action.disabled;
      if (element instanceof HTMLInputElement) {
        element.type = 'range'; element.min = '0'; element.max = '100'; element.step = '1';
        element.value = String(Math.round((action.value ?? 0) * 100));
        element.setAttribute('aria-label', action.label);
        element.oninput = () => { this.audio.unlock(); action.setValue?.(Number(element.value) / 100); };
      } else {
        element.textContent = action.label;
        element.onclick = () => { this.invoke(action); };
        if (action.pressed !== undefined) element.setAttribute('aria-pressed', String(action.pressed));
        else element.removeAttribute('aria-pressed');
      }
    }
    for (const element of present.values()) element.remove();
    if (changedLayer && this.state.overlay) this.semanticActions.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled)')?.focus({ preventScroll: true });
    else if (focus && document.getElementById(focus)) (document.getElementById(focus) as HTMLElement).focus({ preventScroll: true });
  }

  private revealFocus(id: string): void {
    const layout = this.state.overlay ? this.overlayLayout : this.baseLayout;
    const element = layout.getElementById(id);
    if (!element) return;
    let parent = element.parent;
    while (parent) {
      if (parent instanceof ScrollView) {
        const box = element.getBoundingClientRect();
        const clip = parent.getBoundingClientRect();
        if (box.top < clip.top) parent.scrollTo(0, Math.max(0, parent.scrollTop + box.top - clip.top - 12), false);
        else if (box.bottom > clip.bottom) parent.scrollTo(0, parent.scrollTop + box.bottom - clip.bottom + 12, false);
        break;
      }
      parent = parent.parent;
    }
  }

  private drawFocus(context: CanvasRenderingContext2D): void {
    if (!this.focusId) return;
    const layout = this.state.overlay ? this.overlayLayout : this.baseLayout;
    const element = layout.getElementById(this.focusId);
    if (!element) return;
    const box = element.getBoundingClientRect();
    context.strokeStyle = ink.cyan;
    context.lineWidth = 3;
    context.strokeRect(box.left + 3, box.top + 3, box.width - 6, box.height - 6);
  }

  private drawNotice(context: CanvasRenderingContext2D, message: string): void {
    context.font = '24px ' + fonts.body;
    const lines: string[] = [];
    let line = '';
    for (const char of message) {
      if (context.measureText(line + char).width > 626) { lines.push(line); line = char; } else line += char;
    }
    if (line) lines.push(line);
    const y = this.height - this.safeBottom - 220 - lines.length * 36;
    context.fillStyle = ink.inset;
    context.fillRect(40, y, 670, lines.length * 36 + 28);
    context.strokeStyle = ink.borderLight;
    context.strokeRect(40, y, 670, lines.length * 36 + 28);
    context.fillStyle = ink.text;
    context.textBaseline = 'top';
    for (let index = 0; index < lines.length; index++) context.fillText(lines[index], 62, y + 14 + index * 36);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.cancelGesture();
    for (const cleanup of this.cleanups) cleanup();
    this.audio.dispose(); this.effects.dispose();
    this.baseLayout.clearAll(); this.overlayLayout.clearAll();
    this.baseLayout.ticker.stop(); this.overlayLayout.ticker.stop();
  }
}
