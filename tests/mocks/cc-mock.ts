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
  constructor() {
    this.node = new Node();
  }
  getComponent<T extends Component>(type: new () => T): T | null {
    return this.node ? this.node.getComponent(type) : null;
  }
  addComponent<T extends Component>(type: new () => T): T {
    return this.node.addComponent(type);
  }
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

  convertToNodeSpaceAR(pos: Vec3): Vec3 {
    return new Vec3(pos.x, pos.y, pos.z);
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
}

export class SpriteFrame {}

export class Sprite extends Component {
  color: Color = new Color();
  spriteFrame: SpriteFrame | null = null;
  type: number = 0;
  sizeMode: number = 0;
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
  fill(): void {}
  stroke(): void {}
  clear(): void {}
}

export class ScrollView extends Component {
  content: Node | null = null;
  scrollToBottom(_duration?: number): void {}
}

export class Button extends Component {}

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
  getUILocation(): { x: number; y: number };
}

export class Node {
  name: string = '';
  isValid: boolean = true;
  layer: number = 0;
  active: boolean = true;
  position: Vec3 = new Vec3();
  scale: Vec3 = new Vec3(1, 1, 1);
  angle: number = 0;
  children: Node[] = [];
  components: Component[] = [];
  eventListeners: Map<string, Array<(...args: any[]) => void>> = new Map();

  constructor(name: string = '') {
    this.name = name;
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
    this.children.push(child);
  }

  removeAllChildren(): void {
    this.children = [];
  }

  setScale(x: number, y: number, z: number = 1): void {
    this.scale.set(x, y, z);
  }

  setPosition(x: number, y: number, z: number = 0): void {
    this.position.set(x, y, z);
  }

  setRotationFromEuler(_x: number, _y: number, z: number): void {
    this.angle = z;
  }

  on(type: string, cb: (...args: any[]) => void, _target?: any): void {
    let arr = this.eventListeners.get(type);
    if (!arr) {
      arr = [];
      this.eventListeners.set(type, arr);
    }
    arr.push(cb);
  }

  emit(type: string, ...args: any[]): void {
    const arr = this.eventListeners.get(type);
    if (arr) {
      for (const cb of arr) cb(...args);
    }
  }

  static EventType = {
    TOUCH_START: 'touch-start',
    TOUCH_MOVE: 'touch-move',
    TOUCH_END: 'touch-end',
    TOUCH_CANCEL: 'touch-cancel',
  };
}

export const Layers = {
  Enum: {
    NONE: 0,
    DEFAULT: 1,
    UI_2D: 2,
    UI_3D: 3,
  },
};

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
    start() {
      return chain;
    },
    stop() {},
  };
  return chain;
}
