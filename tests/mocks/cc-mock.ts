export class Vec3 {
  x: number = 0;
  y: number = 0;
  z: number = 0;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number = 0): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  static readonly ZERO = new Vec3(0, 0, 0);
  static readonly ONE = new Vec3(1, 1, 1);
}

export function v3(x: number = 0, y: number = 0, z: number = 0): Vec3 {
  return new Vec3(x, y, z);
}

export class Color {
  r: number;
  g: number;
  b: number;
  a: number;

  constructor(r: number = 255, g: number = 255, b: number = 255, a: number = 255) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }
}

export class Component {
  node: Node;
  enabled = true;
  get isValid(): boolean { return this.node.isValid; }
  get enabledInHierarchy(): boolean { return this.enabled && this.node.activeInHierarchy; }
  constructor() {
    this.node = new Node();
  }
  getComponent<T extends Component>(type: new () => T): T | null {
    return this.node ? this.node.getComponent(type) : null;
  }
  addComponent<T extends Component>(type: new () => T): T {
    return this.node.addComponent(type);
  }
  destroy(): boolean {
    const index = this.node.components.indexOf(this);
    if (index >= 0) this.node.components.splice(index, 1);
    this.enabled = false;
    return index >= 0;
  }
}

export function isValid(value: { isValid?: boolean } | null | undefined, _strictMode = false): boolean {
  return value !== null && value !== undefined && value.isValid !== false;
}

export class UITransform extends Component {
  width: number = 100;
  height: number = 100;
  anchorX: number = 0.5;
  anchorY: number = 0.5;

  setContentSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }

  setAnchorPoint(x: number, y: number): void {
    this.anchorX = x;
    this.anchorY = y;
  }
  convertToWorldSpaceAR(pos: Vec3): Vec3 {
    return new Vec3(pos.x, pos.y, pos.z);
  }

  convertToNodeSpaceAR(pos: Vec3, out = new Vec3()): Vec3 {
    return out.set(pos.x, pos.y, pos.z);
  }
}

export class UIOpacity extends Component {
  opacity: number = 255;
}

export class Label extends Component {
  string: string = '';
  fontSize: number = 20;
  lineHeight: number = 20;
  color: Color = new Color();
  overflow: number = 0;
  horizontalAlign: number = 0;
  verticalAlign: number = 0;
  isBold: boolean = false;
  updateRenderData(_force?: boolean): void {}
  static Overflow = {
    NONE: 0,
    CLAMP: 1,
    SHRINK: 2,
    RESIZE_HEIGHT: 3,
  };
  static HorizontalAlign = {
    LEFT: 0,
    CENTER: 1,
    RIGHT: 2,
  };
  static VerticalAlign = { TOP: 0, CENTER: 1, BOTTOM: 2 };
}

export class Texture2D {
  isValid = true;
  static Filter = { NEAREST: 0, NONE: 0 };
  static WrapMode = { CLAMP_TO_EDGE: 0 };
  setFilters(_min: number, _mag: number): void {}
  setMipFilter(_filter: number): void {}
  setWrapMode(_s: number, _t: number): void {}
}

export class SpriteFrame {
  isValid = true;
  texture: Texture2D | null = null;
  packable = true;
  originalSize = { width: 256, height: 256 };
  addRef(): this { return this; }
  decRef(): this { return this; }
}

export class SpriteAtlas {
  getTexture(): Texture2D | null { return null; }
  getSpriteFrame(_name: string): SpriteFrame | null { return null; }
  addRef(): void {}
  decRef(): void {}
}

export class AudioClip {
  isValid = true;
  addRef(): this { return this; }
  decRef(): this { return this; }
}

export class AudioSource extends Component {
  static EventType = { STARTED: 'started', ENDED: 'ended' };
  clip: AudioClip | null = null;
  playing = false;
  loop = false;
  playOnAwake = false;
  volume = 1;
  play(): void { this.playing = true; this.node.emit(AudioSource.EventType.STARTED); }
  pause(): void { this.playing = false; }
  stop(): void { this.playing = false; }
}

export const resources = {
  load<T extends SpriteAtlas | SpriteFrame | AudioClip>(_path: string, type: new () => T, callback: (error: Error | null, asset: T | null) => void): void {
    if (type === SpriteAtlas) callback(new Error('Resource loading is not available in the Cocos test double'), null);
    else callback(null, new type());
  },
};

export class Sprite extends Component {
  color: Color = new Color();
  spriteFrame: SpriteFrame | null = null;
  type: number = 0;
  sizeMode: number = 0;
  trim = true;
  static Type = {
    SIMPLE: 0,
    SLICED: 1,
    TILED: 2,
    FILLED: 3,
  };
  static SizeMode = {
    CUSTOM: 0,
    TRIMMED: 1,
    RAW: 2,
  };
}

export class Graphics extends Component {
  fillColor: Color = new Color();
  strokeColor: Color = new Color();
  lineWidth: number = 1;
  rect(_x: number, _y: number, _w: number, _h: number): void {}
  roundRect(_x: number, _y: number, _w: number, _h: number, _radius?: number): void {}
  circle(_cx: number, _cy: number, _r: number): void {}
  moveTo(_x: number, _y: number): void {}
  lineTo(_x: number, _y: number): void {}
  close(): void {}
  arc(_cx: number, _cy: number, _r: number, _start: number, _end: number, _counterclockwise?: boolean): void {}
  fill(): void {}
  stroke(): void {}
  clear(): void {}
}

export class ScrollView extends Component {
  horizontal: boolean = true;
  vertical: boolean = true;
  content: Node | null = null;
  cancelInnerEvents = true;
  scrollToBottom(_duration?: number): void {}
  stopAutoScroll(): void {}
  getScrollOffset(): { x: number; y: number } { return { x: 0, y: 0 }; }
  scrollToOffset(_offset: { x: number; y: number }, _duration?: number): void {}
  scrollToPercentVertical(_percent: number, _duration?: number): void {}
}

export class Button extends Component {
  static Transition = { NONE: 0 };
  interactable = true;
  transition = Button.Transition.NONE;
}

export class Mask extends Component {}
export class BlockInputEvents extends Component {}


export class Layout extends Component {
  type: number = 0;
  resizeMode: number = 0;
  spacingX: number = 0;
  spacingY: number = 0;
  paddingLeft: number = 0;
  paddingRight: number = 0;
  paddingTop: number = 0;
  paddingBottom: number = 0;
  updateLayout(): void {}
  static Type = {
    NONE: 0,
    HORIZONTAL: 1,
    VERTICAL: 2,
    GRID: 3,
  };
  static ResizeMode = {
    NONE: 0,
    CONTAINER: 1,
    CHILDREN: 2,
  };
}
export interface EventTouch {
  propagationStopped: boolean;
  getUILocation(): { x: number; y: number };
  getID(): number;
}

let mockNodeSequence = 0;

export class Node {
  name: string = '';
  readonly uuid = `mock-node-${++mockNodeSequence}`;
  isValid: boolean = true;
  layer: number = 0;
  active: boolean = true;
  position: Vec3 = new Vec3();
  scale: Vec3 = new Vec3(1, 1, 1);
  angle: number = 0;
  children: Node[] = [];
  private _parent: Node | null = null;
  get activeInHierarchy(): boolean { return this.isValid && this.active && (!this.parent || this.parent.activeInHierarchy); }
  get eulerAngles(): Vec3 { return new Vec3(0, 0, this.angle); }
  components: Component[] = [];
  eventListeners: Map<string, Array<(...args: any[]) => void>> = new Map();

  constructor(name: string = '') {
    this.name = name;
  }

  get parent(): Node | null {
    return this._parent;
  }

  set parent(parent: Node | null) {
    if (this._parent === parent) return;
    if (this._parent) {
      const index = this._parent.children.indexOf(this);
      if (index !== -1) this._parent.children.splice(index, 1);
    }
    this._parent = parent;
    if (parent) parent.children.push(this);
  }

  addComponent<T extends Component>(type: new () => T): T {
    const comp = new type();
    comp.node = this;
    this.components.push(comp);
    return comp;
  }

  getComponent<T extends Component>(type: new () => T): T | null {
    for (const c of this.components) {
      if (c instanceof type) return c as T;
    }
    return null;
  }

  addChild(child: Node): void {
    child.parent = this;
  }

  getChildByName(name: string): Node | null {
    return this.children.find(child => child.name === name) ?? null;
  }

  removeChild(child: Node): void {
    if (child.parent === this) child.parent = null;
  }

  removeFromParent(): void { this.parent = null; }

  setSiblingIndex(index: number): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    const current = siblings.indexOf(this);
    if (current < 0) return;
    siblings.splice(current, 1);
    siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, this);
  }

  removeAllChildren(): void {
    for (const child of this.children) child._parent = null;
    this.children.length = 0;
  }

  destroy(): boolean {
    if (!this.isValid) return false;
    // Tests have no engine frame loop, so finish node destruction synchronously.
    this.isValid = false;
    this.active = false;
    this.parent = null;
    while (this.children.length > 0) {
      const child = this.children[this.children.length - 1];
      child.destroy();
      this.removeChild(child);
    }
    this.eventListeners.clear();
    this.components.length = 0;
    return true;
  }

  setScale(value: number | Vec3, y?: number, z: number = 1): void {
    if (!this.isValid) throw new Error('Cannot transform a destroyed Cocos node');
    if (typeof value === 'number') this.scale.set(value, y ?? value, z);
    else this.scale.set(value.x, value.y, value.z);
  }

  setPosition(value: number | Vec3, y?: number, z: number = 0): void {
    if (typeof value === 'number') this.position.set(value, y ?? 0, z);
    else this.position.set(value.x, value.y, value.z);
  }

  setRotationFromEuler(value: number | Vec3, _y?: number, z?: number): void {
    this.angle = typeof value === 'number' ? z ?? 0 : value.z;
  }

  on(type: string, cb: (...args: any[]) => void, _target?: any): void {
    let arr = this.eventListeners.get(type);
    if (!arr) {
      arr = [];
      this.eventListeners.set(type, arr);
    }
    arr.push(cb);
  }

  off(type: string, callback: (...args: unknown[]) => void, _target?: unknown): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) this.eventListeners.set(type, listeners.filter(item => item !== callback));
  }

  emit(type: string, ...args: unknown[]): void {
    const arr = this.eventListeners.get(type);
    if (arr) {
      const eventArgs = args.length || !type.startsWith('touch-') ? args : [{ propagationStopped: false, getUILocation: () => ({ x: 0, y: 0 }), getID: () => 0 }];
      for (const cb of arr) cb(...eventArgs);
    }
  }

  static EventType = {
    TOUCH_START: 'touch-start',
    TOUCH_MOVE: 'touch-move',
    TOUCH_END: 'touch-end',
    SIZE_CHANGED: 'size-changed',
    TOUCH_CANCEL: 'touch-cancel',
  };
}

export const input = new Node('Input');
export const Input = { EventType: { TOUCH_END: 'touch-end', MOUSE_UP: 'mouse-up', KEY_DOWN: 'key-down' } };
export const game = new Node('Game');
export const Game = { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' };

export const Layers = {
  Enum: {
    NONE: 0,
    DEFAULT: 1,
    UI_2D: 2,
    UI_3D: 3,
  },
};

export const screen = new Node('Screen');
export const view = {
  getVisibleSize: () => ({ width: 750, height: 1334 }),
  getFrameSize: () => ({ width: 750, height: 1334 }),
  setDesignResolutionSize(_width: number, _height: number, _policy: number): void {},
};
export const ResolutionPolicy = { FIXED_WIDTH: 3 };

const localValues = new Map<string, string>();
export const sys = { localStorage: {
  getItem: (key: string): string | null => localValues.get(key) ?? null,
  setItem: (key: string, value: string): void => { localValues.set(key, value); },
  clear: (): void => localValues.clear(),
} };

export class Tween {
  static stopAllByTarget(_target: unknown): void {}
}

export const _decorator = {
  ccclass: (_name?: string) => (target: any) => target,
  property: (_opts?: any) => (_target: any, _key: string) => {},
};

export interface MockTween<T> {
  to(duration: number, props: Record<string, unknown>, opts?: Record<string, unknown>): MockTween<T>;
  by(duration: number, props: Record<string, unknown>, opts?: Record<string, unknown>): MockTween<T>;
  delay(duration: number): MockTween<T>;
  call(cb: () => void): MockTween<T>;
  repeatForever(subTween?: MockTween<unknown>): MockTween<T>;
  start(): MockTween<T>;
  stop(): void;
}

export function tween<T = unknown>(_target?: T): MockTween<T> {
  let hasDelay = false;
  const chain: MockTween<T> = {
    to(_duration: number, _props: Record<string, unknown>, _opts?: Record<string, unknown>) {
      return chain;
    },
    by(_duration: number, _props: Record<string, unknown>, _opts?: Record<string, unknown>) {
      return chain;
    },
    delay(_duration: number) {
      hasDelay = true;
      return chain;
    },
    call(cb: () => void) {
      if (!hasDelay) {
        cb();
      }
      return chain;
    },
    // Keep perpetual animations chainable without starting an endless test timer.
    repeatForever(_subTween?: MockTween<unknown>) {
      return chain;
    },
    start() {
      return chain;
    },
    stop() {},
  };
  return chain;
}
