import atlasData from "../public/fx/data.json";
import type { GamePlatform } from "./platform";

export type EffectName = "gold" | "poof" | "confetti";
type LayerName = "candle" | EffectName;
interface AtlasAsset {
  id: string;
  image: string;
  fps: number;
  duration_seconds: number;
  sheet: { frames: Array<{ frame: { x: number; y: number; w: number; h: number } }> };
}
interface EffectLayer {
  name: LayerName;
  asset: AtlasAsset;
  image: HTMLImageElement | null;
  loaded: boolean;
  elapsed: number;
  cancelLoad: (() => void) | null;
}
const EFFECT_IDS: Readonly<Record<LayerName, string>> = {
  candle: "FX_MING_CANDLE",
  gold: "FX_COLLECT_BURST",
  poof: "FX_COMIC_POOF",
  confetti: "FX_ACHIEVE_CONFETTI",
};
const LAYERS: readonly LayerName[] = ["candle", "gold", "poof", "confetti"];

/** Replays the original exported atlases directly; no generated/code-drawn substitute. */
export class PixelEffects {
  private readonly layers: EffectLayer[] = [];
  private readonly motionPreference: MediaQueryList | null;
  private readonly unsubscribeVisibility: () => void;
  private initialization: Promise<void> | null = null;
  private visible = true;
  private disposed = false;
  private lastTime = 0;

  constructor(private readonly platform: GamePlatform) {
    for (const name of LAYERS) {
      const asset = atlasData.assets.find((entry) => entry.id === EFFECT_IDS[name]);
      if (!asset) throw new Error(`缺少原始像素特效配置：${EFFECT_IDS[name]}`);
      this.layers.push({ name, asset, image: null, loaded: false, elapsed: name === "candle" ? 0 : -1, cancelLoad: null });
    }
    this.motionPreference = platform.kind === "web" && typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia("(prefers-reduced-motion: reduce)") : null;
    this.unsubscribeVisibility = platform.onVisibility((visible) => {
      this.visible = visible;
      this.lastTime = 0;
    });
  }

  initialize(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.initialization) {
      this.initialization = Promise.all(this.layers.map((layer) => this.loadLayer(layer))).then(() => undefined);
    }
    return this.initialization;
  }

  play(name: EffectName): void {
    if (this.disposed || !this.visible || this.motionPreference?.matches) return;
    for (const layer of this.layers) {
      if (layer.name === name) layer.elapsed = 0;
    }
  }

  /** Width/height are logical Canvas units; the host applies DPR before compositing. */
  draw(context: CanvasRenderingContext2D, width: number, height: number, now: number, active: boolean): void {
    if (this.disposed || !active || !this.visible) {
      this.lastTime = 0;
      return;
    }
    const elapsed = this.lastTime ? Math.max(0, Math.min(0.1, (now - this.lastTime) / 1000)) : 0;
    this.lastTime = now;
    const reduced = this.motionPreference?.matches ?? false;
    const scale = width / 750;
    context.save();
    context.imageSmoothingEnabled = false;
    for (const layer of this.layers) {
      if (!layer.loaded || !layer.image) continue;
      if (layer.name === "candle") {
        layer.elapsed = reduced ? 0 : (layer.elapsed + elapsed) % layer.asset.duration_seconds;
      } else {
        if (reduced) layer.elapsed = -1;
        if (layer.elapsed < 0) continue;
        layer.elapsed += elapsed;
        if (layer.elapsed >= layer.asset.duration_seconds) {
          layer.elapsed = -1;
          continue;
        }
      }
      const frames = layer.asset.sheet.frames;
      const frameIndex = Math.min(frames.length - 1, Math.floor(layer.elapsed * layer.asset.fps));
      const frame = frames[frameIndex].frame;
      let x: number;
      let y: number;
      let drawWidth: number;
      let drawHeight: number;
      if (layer.name === "candle") {
        drawWidth = 101 * scale;
        drawHeight = 137 * scale;
        x = 8 * scale;
        // The 202-unit footer stays clear; the candle sits in its left gutter.
        y = height - 202 * scale - drawHeight;
      } else if (layer.name === "gold") {
        drawWidth = 202 * scale;
        drawHeight = 194 * scale;
        x = 263 * scale - drawWidth / 2;
        y = 212 * scale - drawHeight / 2;
      } else {
        drawWidth = (layer.name === "poof" ? 202 : 360) * scale;
        drawHeight = (layer.name === "poof" ? 166 : 252) * scale;
        x = (width - drawWidth) / 2;
        y = (height - drawHeight) / 2;
      }
      context.drawImage(layer.image, frame.x, frame.y, frame.w, frame.h, x, y, drawWidth, drawHeight);
    }
    context.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeVisibility();
    for (const layer of this.layers) {
      layer.cancelLoad?.();
      if (layer.image) {
        layer.image.onload = null;
        layer.image.onerror = null;
      }
      layer.image = null;
      layer.loaded = false;
    }
  }

  private loadLayer(layer: EffectLayer): Promise<void> {
    // The ES2020 mini-game runtime has no Promise.withResolvers API.
    return new Promise((resolve, reject) => {
      const image = this.platform.createImage();
      layer.image = image;
      const finish = (): void => {
        image.onload = null;
        image.onerror = null;
        layer.cancelLoad = null;
      };
      layer.cancelLoad = () => {
        finish();
        resolve();
      };
      image.onload = () => {
        layer.loaded = !this.disposed;
        finish();
        resolve();
      };
      image.onerror = () => {
        finish();
        reject(new Error(`像素特效图集加载失败：${layer.asset.image}`));
      };
      image.src = this.platform.asset(layer.asset.image);
    });
  }
}
