import {
  _decorator,
  Component,
  Layers,
  Node,
  isValid,
  resources,
  Sprite,
  SpriteAtlas,
  SpriteFrame,
  Texture2D,
  UITransform,
} from 'cc';

const { ccclass, property } = _decorator;

type EffectKind = 'gain' | 'death' | 'confetti';
type EffectName = 'candle' | EffectKind;

interface EffectSpec {
  readonly path: string;
  readonly prefix: string;
  readonly frameCount: number;
  readonly fps: number;
  readonly duration: number;
  readonly loop: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Timings and frame names come from the existing JSON/plist exports, not game data.
// One-shot duration is the export's final sample time (its last frame is empty).
const EFFECTS: Readonly<Record<EffectName, EffectSpec>> = {
  candle: {
    path: 'pixel/ming_end/fx/fire/candle/candle',
    prefix: 'candle',
    frameCount: 80,
    fps: 20,
    duration: 4,
    loop: true,
    // Reference's lower-left candle, fitted into the agreed non-text gutter.
    x: -317,
    y: -457,
    width: 101,
    height: 137,
  },
  gain: {
    path: 'pixel/ming_end/fx/pickups/collect-burst/collect-burst',
    prefix: 'collect-burst',
    frameCount: 28,
    fps: 20,
    duration: 1.35,
    loop: false,
    // Beside the real wealth value, not over the value or its heading.
    x: -112,
    y: 500,
    width: 202,
    height: 194,
  },
  death: {
    path: 'pixel/ming_end/fx/spawn/poof/poof',
    prefix: 'poof',
    frameCount: 25,
    fps: 15,
    duration: 1.6,
    loop: false,
    // Center on the event stream like the comic poof in the phone preview.
    x: -4,
    y: 151,
    width: 202,
    height: 166,
  },
  confetti: {
    path: 'pixel/ming_end/fx/ui/confetti/confetti',
    prefix: 'confetti',
    frameCount: 52,
    fps: 15,
    duration: 3.4,
    loop: false,
    x: 0,
    y: 0,
    width: 360,
    height: 252,
  },
};
const EFFECT_NAMES: readonly EffectName[] = ['candle', 'gain', 'death', 'confetti'];

interface LoadedEffect {
  readonly spec: EffectSpec;
  readonly atlas: SpriteAtlas;
  readonly frames: readonly SpriteFrame[];
}

interface Playback {
  readonly node: Node;
  readonly sprite: Sprite;
  readonly transform: UITransform;
  effect: LoadedEffect | null;
  elapsed: number;
  frameIndex: number;
}

// Structural types keep the controller usable in native builds without DOM globals.
interface MotionPreference {
  readonly matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

/**
 * Decorative sprite-atlas playback on a centered, fixed-width UI layer.
 * Mount above the ordinary UI and below modal panels. No input handlers or blockers
 * are installed. The host owns game-state decisions and when to call play().
 */
@ccclass('PixelFXController')
export class PixelFXController extends Component {
  @property({ tooltip: '停止装饰性动态。Web 同时遵循系统偏好；原生由宿主接入系统或应用设置。' })
  public reducedMotion = false;

  private readonly loaded: Partial<Record<EffectName, LoadedEffect>> = {};
  private readonly failed: Partial<Record<EffectName, boolean>> = {};
  private candle: Playback | null = null;
  private transient: Playback | null = null;
  private pending: EffectKind | null = null;
  private motionPreference: MotionPreference | null = null;
  private motionReduced = false;
  private disposed = false;
  private viewportHeight = 1334;

  private readonly onMotionChange = (): void => {
    this.syncMotionPreference();
  };

  onLoad(): void {
    this.node.layer = Layers.Enum.UI_2D;
    const transform = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 0.5);
    transform.setContentSize(750, 1334);
    this.candle = this.createPlayback('PixelCandle');
    this.transient = this.createPlayback('PixelOneShot');

    const host = globalThis as typeof globalThis & {
      matchMedia?: (query: string) => MotionPreference;
    };
    this.motionPreference = host.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    this.syncMotionPreference();

    // Each atlas loads independently: a missing celebration must not hide the candle.
    for (const name of EFFECT_NAMES) this.loadEffect(name);
  }

  onEnable(): void {
    if (!this.isOwnerValid()) return;
    this.watchMotionPreference(true);
    this.syncMotionPreference();
    const effect = this.loaded.candle;
    if (effect) this.startPlayback(this.candle, effect);
    this.playPending();
  }

  /**
   * Repeated calls restart one sprite, never stack nodes. During cold loading only
   * the latest request is retained, so an old gain cannot replay after a death or
   * ending. Disabled/destroying owners and reduced motion discard new requests.
   */
  public play(kind: EffectKind): void {
    if (!this.isOwnerValid() || !this.enabledInHierarchy) return;
    this.syncMotionPreference();
    if (this.motionReduced || this.failed[kind]) return;
    this.clearPlayback(this.transient);
    this.pending = kind;
    this.playPending();
  }

  /** 重开时取消本局一次性动效和待载请求，不中断界面烛火。 */
  public stopTransient(): void {
    this.pending = null;
    this.clearPlayback(this.transient);
  }

  public setViewportHeight(height: number): void {
    this.viewportHeight = height;
    this.node.getComponent(UITransform)?.setContentSize(750, height);
    for (const playback of [this.candle, this.transient]) {
      if (playback?.effect) this.positionPlayback(playback, playback.effect.spec);
    }
  }

  private positionPlayback(playback: Playback, spec: EffectSpec): void {
    const offset = (this.viewportHeight - 1334) / 2;
    const y = spec.y + (spec === EFFECTS.candle ? -offset
      : spec === EFFECTS.gain || spec === EFFECTS.death ? offset : 0);
    playback.node.setPosition(spec.x, y, 0);
  }

  update(dt: number): void {
    this.syncMotionPreference();
    if (!this.isOwnerValid() || this.motionReduced || !Number.isFinite(dt) || dt <= 0) return;
    this.advance(this.candle, dt);
    this.advance(this.transient, dt);
  }

  onDisable(): void {
    this.watchMotionPreference(false);
    this.stopTransient();
    this.clearPlayback(this.candle);
  }

  onDestroy(): void {
    this.disposed = true;
    this.pending = null;
    this.watchMotionPreference(false);
    this.motionPreference = null;
    this.destroyPlayback(this.candle);
    this.destroyPlayback(this.transient);
    this.candle = null;
    this.transient = null;
    for (const name of EFFECT_NAMES) {
      this.loaded[name]?.atlas.decRef();
      delete this.loaded[name];
    }
  }

  private createPlayback(name: string): Playback {
    const node = new Node(name);
    node.layer = this.node.layer;
    node.active = false;
    const transform = node.addComponent(UITransform);
    transform.setAnchorPoint(0.5, 0.5);
    const sprite = node.addComponent(Sprite);
    sprite.type = Sprite.Type.SIMPLE;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    this.node.addChild(node);
    return { node, sprite, transform, effect: null, elapsed: 0, frameIndex: -1 };
  }

  private isOwnerValid(): boolean {
    // Cocos defers destruction to frame end; ordinary .isValid misses that window.
    return !this.disposed && isValid(this, true) && isValid(this.node, true);
  }

  private isPlaybackValid(playback: Playback | null): playback is Playback {
    return playback !== null && isValid(playback.node, true)
      && isValid(playback.sprite, true) && isValid(playback.transform, true);
  }

  private watchMotionPreference(listen: boolean): void {
    if (this.motionPreference?.addEventListener) {
      if (listen) this.motionPreference.addEventListener('change', this.onMotionChange);
      else this.motionPreference.removeEventListener?.('change', this.onMotionChange);
    } else if (listen) {
      this.motionPreference?.addListener?.(this.onMotionChange);
    } else {
      this.motionPreference?.removeListener?.(this.onMotionChange);
    }
  }

  private loadEffect(name: EffectName): void {
    const spec = EFFECTS[name];
    try {
      // Explicit type distinguishes the plist from its same-named JSON and PNG.
      resources.load(spec.path, SpriteAtlas, (error, atlas) => {
        // Cache completed loads while disabled, but never touch an owner whose
        // destroy() has already been requested, even before onDestroy executes.
        if (!this.isOwnerValid()) return;
        if (error || !atlas) {
          this.reportFailure(name, error ?? new Error('SpriteAtlas is missing'));
          return;
        }
        atlas.addRef();

        let effect: LoadedEffect;
        try {
          effect = this.readAtlas(atlas, spec);
        } catch (cause) {
          atlas.decRef();
          this.reportFailure(name, cause);
          return;
        }
        this.loaded[name] = effect;
        this.syncMotionPreference();
        if (!this.enabledInHierarchy) return;
        if (name === 'candle') this.startPlayback(this.candle, effect);
        else this.playPending();
      });
    } catch (cause) {
      if (this.isOwnerValid()) this.reportFailure(name, cause);
    }
  }

  private readAtlas(atlas: SpriteAtlas, spec: EffectSpec): LoadedEffect {
    const texture = atlas.getTexture();
    if (!texture || !isValid(texture, true)) throw new Error('Atlas PNG texture is unavailable');
    const frames: SpriteFrame[] = [];
    for (let index = 0; index < spec.frameCount; index++) {
      const key = `${spec.prefix}_${String(index).padStart(3, '0')}`;
      const frame = atlas.getSpriteFrame(key);
      if (!frame || !isValid(frame, true) || frame.texture !== texture) {
        throw new Error(`Missing or invalid atlas frame: ${key}`);
      }
      // Dynamic atlases use their own sampler; keep these frames on the pixel sheet.
      frame.packable = false;
      frames.push(frame);
    }
    // Import metadata currently uses linear filtering, so apply real nearest sampling.
    texture.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
    texture.setMipFilter(Texture2D.Filter.NONE);
    texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    return { spec, atlas, frames };
  }

  private reportFailure(name: EffectName, cause: unknown): void {
    this.failed[name] = true;
    if (this.pending === name) this.pending = null;
    console.error(`[PixelFXController] 无法载入像素图集 ${EFFECTS[name].path}.plist 及其 PNG/帧资源；不播放替代效果。`, cause);
  }

  private playPending(): void {
    this.syncMotionPreference();
    if (!this.isOwnerValid() || this.motionReduced || !this.enabledInHierarchy || !this.pending) return;
    const effect = this.loaded[this.pending];
    if (!effect) return;
    this.pending = null;
    this.startPlayback(this.transient, effect);
  }

  private startPlayback(playback: Playback | null, effect: LoadedEffect): void {
    if (!this.isOwnerValid() || !this.enabledInHierarchy || !this.isPlaybackValid(playback)) return;
    const spec = effect.spec;
    playback.effect = effect;
    playback.elapsed = 0;
    playback.frameIndex = 0;
    playback.transform.setContentSize(spec.width, spec.height);
    this.positionPlayback(playback, spec);
    playback.sprite.spriteFrame = effect.frames[0];
    playback.node.active = true;
  }

  private advance(playback: Playback | null, dt: number): void {
    if (!this.isPlaybackValid(playback) || !playback.node.active || !playback.effect) return;
    const { spec, frames } = playback.effect;
    playback.elapsed += dt;
    if (spec.loop) playback.elapsed %= spec.duration;
    else if (playback.elapsed >= spec.duration) {
      this.clearPlayback(playback);
      return;
    }
    const index = Math.min(Math.floor(playback.elapsed * spec.fps), frames.length - 1);
    if (index === playback.frameIndex) return;
    playback.frameIndex = index;
    playback.sprite.spriteFrame = frames[index];
  }

  private syncMotionPreference(): void {
    const reduced = this.reducedMotion || (this.motionPreference?.matches ?? false);
    if (this.motionReduced === reduced) return;
    this.motionReduced = reduced;
    if (!reduced) return;
    this.pending = null;
    this.clearPlayback(this.transient);
    if (this.isPlaybackValid(this.candle) && this.candle.effect) {
      // A real first atlas frame remains as a quiet, static candle.
      this.candle.elapsed = 0;
      this.candle.frameIndex = 0;
      this.candle.sprite.spriteFrame = this.candle.effect.frames[0];
    }
  }

  private clearPlayback(playback: Playback | null): void {
    if (!playback) return;
    if (isValid(playback.node, true)) playback.node.active = false;
    if (isValid(playback.sprite, true)) playback.sprite.spriteFrame = null;
    playback.effect = null;
    playback.elapsed = 0;
    playback.frameIndex = -1;
  }

  private destroyPlayback(playback: Playback | null): void {
    if (!playback) return;
    this.clearPlayback(playback);
    if (isValid(playback.node, true)) playback.node.destroy();
  }
}
