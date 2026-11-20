export interface GamePlatform {
  kind: "web" | "wechat";
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
  asset(path: string): string;
  createCanvas(): HTMLCanvasElement;
  createImage(): HTMLImageElement;
  getViewport(): {
    width: number;
    height: number;
    pixelRatio: number;
    safeTop: number;
    safeBottom: number;
  };
  onResize(cb: () => void): () => void;
  onVisibility(cb: (visible: boolean) => void): () => void;
}

interface WindowMetrics {
  windowWidth?: number;
  windowHeight?: number;
  screenWidth?: number;
  screenHeight?: number;
  pixelRatio?: number;
  safeArea?: { top: number; bottom: number };
}

interface WechatRuntime {
  createCanvas(): unknown;
  createImage(): unknown;
  getWindowInfo?: () => WindowMetrics;
  getSystemInfoSync(): WindowMetrics;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: string): void;
  onWindowResize(cb: () => void): void;
  offWindowResize?: (cb: () => void) => void;
  onShow(cb: () => void): void;
  offShow?: (cb: () => void) => void;
  onHide(cb: () => void): void;
  offHide?: (cb: () => void) => void;
}

function wechatPlatform(runtime: WechatRuntime): GamePlatform {
  // The first wx canvas is the main-domain screen; later canvases are offscreen.
  const canvas = runtime.createCanvas() as HTMLCanvasElement;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("微信小游戏无法创建 Canvas 2D 上下文。");

  const getViewport: GamePlatform["getViewport"] = () => {
    const metrics = runtime.getWindowInfo?.() ?? runtime.getSystemInfoSync();
    const width = metrics.windowWidth ?? metrics.screenWidth;
    const height = metrics.windowHeight ?? metrics.screenHeight;
    if (!width || !height) throw new Error("微信未提供有效的窗口尺寸。");
    const pixelRatio = Math.max(1, metrics.pixelRatio ?? 1);
    return {
      width,
      height,
      pixelRatio,
      safeTop: Math.max(0, metrics.safeArea?.top ?? 0),
      safeBottom: Math.max(0, height - (metrics.safeArea?.bottom ?? height)),
    };
  };
  const viewport = getViewport();
  canvas.width = Math.round(viewport.width * viewport.pixelRatio);
  canvas.height = Math.round(viewport.height * viewport.pixelRatio);

  return {
    kind: "wechat",
    canvas,
    context,
    storage: {
      getItem(key) {
        const value = runtime.getStorageSync(key);
        return typeof value === "string" && value !== "" ? value : null;
      },
      setItem(key, value) {
        runtime.setStorageSync(key, value);
      },
    },
    asset: (path) => `media/${path.replace(/^(?:\.\/|\/)+/, "")}`,
    createCanvas: () => runtime.createCanvas() as HTMLCanvasElement,
    createImage: () => runtime.createImage() as HTMLImageElement,
    getViewport,
    onResize(cb) {
      let subscribed = true;
      const listener = (): void => { if (subscribed) cb(); };
      runtime.onWindowResize(listener);
      return () => {
        subscribed = false;
        runtime.offWindowResize?.(listener);
      };
    },
    onVisibility(cb) {
      let subscribed = true;
      const show = (): void => { if (subscribed) cb(true); };
      const hide = (): void => { if (subscribed) cb(false); };
      runtime.onShow(show);
      runtime.onHide(hide);
      return () => {
        subscribed = false;
        runtime.offShow?.(show);
        runtime.offHide?.(hide);
      };
    },
  };
}

export function createPlatform(canvas?: HTMLCanvasElement): GamePlatform {
  // wx is supplied by the mini-game host, outside the DOM TypeScript library.
  const environment = globalThis as typeof globalThis & { wx?: WechatRuntime };
  const runtime = environment.wx;
  if (runtime && typeof runtime.createCanvas === "function") return wechatPlatform(runtime);
  if (!canvas) throw new Error("Web 平台必须传入主 Canvas。");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建 Canvas 2D 上下文。");
  const owner = canvas.ownerDocument;
  const host = owner.defaultView;
  if (!host) throw new Error("主 Canvas 未连接到浏览器窗口。");
  const base = new URL(import.meta.env.BASE_URL, owner.baseURI);

  return {
    kind: "web",
    canvas,
    context,
    storage: {
      getItem: (key) => host.localStorage.getItem(key),
      setItem: (key, value) => host.localStorage.setItem(key, value),
    },
    asset: (path) => new URL(path.replace(/^(?:\.\/|\/)+/, ""), base).href,
    createCanvas: () => owner.createElement("canvas"),
    createImage: () => owner.createElement("img"),
    getViewport() {
      const rect = canvas.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        pixelRatio: Math.max(1, host.devicePixelRatio || 1),
        safeTop: 0,
        safeBottom: 0,
      };
    },
    onResize(cb) {
      const observer = typeof ResizeObserver === "function" ? new ResizeObserver(cb) : null;
      observer?.observe(canvas);
      host.addEventListener("resize", cb);
      host.visualViewport?.addEventListener("resize", cb);
      return () => {
        observer?.disconnect();
        host.removeEventListener("resize", cb);
        host.visualViewport?.removeEventListener("resize", cb);
      };
    },
    onVisibility(cb) {
      const changed = (): void => cb(!owner.hidden);
      owner.addEventListener("visibilitychange", changed);
      const hide = (): void => cb(false);
      const show = (): void => cb(!owner.hidden);
      host.addEventListener("pagehide", hide);
      host.addEventListener("pageshow", show);
      return () => {
        owner.removeEventListener("visibilitychange", changed);
        host.removeEventListener("pagehide", hide);
        host.removeEventListener("pageshow", show);
      };
    },
  };
}
