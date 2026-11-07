import {
  _decorator,
  AudioClip,
  AudioSource,
  Component,
  Game,
  game,
  Input,
  input,
  isValid,
  Node,
  resources,
  sys,
} from 'cc';

const { ccclass } = _decorator;

type MusicTrack = 'home' | 'life' | 'ending';
type Region = 'shanbei' | 'capital' | 'jiangnan';
type Cue = 'tap' | 'reveal' | 'select' | 'error' | 'choice' | 'gain'
  | 'achievement' | 'ending' | 'death' | 'item' | 'identity';
type ClipListener = (clip: AudioClip | null) => void;

interface Volumes {
  music: number;
  effects: number;
  ambience: number;
}
interface LoopChannel {
  source: AudioSource;
  path: string | null;
  revision: number;
  loading: boolean;
  playPending: boolean;
}
interface CueVoice {
  source: AudioSource;
  busy: boolean;
  order: number;
  gain: number;
}
interface GestureDocument {
  readonly hidden?: boolean;
  addEventListener(type: string, listener: (event: { isTrusted?: boolean }) => void,
    options?: { capture: boolean; passive: boolean }): void;
  removeEventListener(type: string, listener: (event: { isTrusted?: boolean }) => void, capture?: boolean): void;
}
interface GestureEnvironment {
  document?: GestureDocument;
}

const ROOT = 'audio/ming_end';
const SETTINGS_KEY = 'time-travel.audio-settings.v1';
const CUES: readonly Cue[] = [
  'tap', 'reveal', 'select', 'error', 'choice', 'gain', 'achievement', 'ending', 'death', 'item', 'identity',
];
const GESTURES = ['pointerup', 'touchend', 'mouseup', 'keydown'] as const;
const CUE_GAIN: Readonly<Record<Cue, number>> = {
  tap: 0.7, reveal: 0.8, select: 0.75, error: 0.65, choice: 0.75, gain: 0.8,
  achievement: 0.8, ending: 0.75, death: 0.55, item: 0.8, identity: 0.8,
};
const VOICE_COUNT = 4;

/**
 * Original offline-rendered audio; see audio/ming_end/provenance.json and its generator.
 * Two loop sources and four stoppable cue voices bound simultaneous playback on phones.
 * No sound is started before a user gesture. Zero volume also stops its sources, rather
 * than relying on platform volume support. Backgrounding pauses loops and discards cues.
 */
@ccclass('GameAudio')
export class GameAudio extends Component {
  static instance: GameAudio | null = null;

  private volumes: Volumes = { music: 0.45, effects: 0.65, ambience: 0.3 };
  private music: LoopChannel | null = null;
  private ambience: LoopChannel | null = null;
  private readonly voices: CueVoice[] = [];
  private readonly clips = new Map<string, AudioClip>();
  private readonly loads = new Map<string, ClipListener[]>();
  private gestureDocument: GestureDocument | null = null;
  private pendingCue: { name: Cue; request: number; time: number } | null = null;
  private cueRequest = 0;
  private voiceOrder = 0;
  private unlocked = false;
  private active = false;
  private hidden = false;
  private disposed = false;
  private storageWarning = false;

  onLoad(): void {
    if (GameAudio.instance && isValid(GameAudio.instance, true) && isValid(GameAudio.instance.node, true)) {
      this.disposed = true;
      this.destroy();
      return;
    }
    GameAudio.instance = this;
    this.readSettings();
    this.music = this.createLoop('Music');
    this.ambience = this.createLoop('Ambience');
    for (let index = 0; index < VOICE_COUNT; index++) {
      const voice: CueVoice = { source: this.createSource(`Cue${index}`, false), busy: false, order: 0, gain: 1 };
      voice.source.node.on(AudioSource.EventType.ENDED, () => { voice.busy = false; }, this);
      voice.source.node.on(AudioSource.EventType.STARTED, () => {
        if (!this.canPlay() || this.volumes.effects === 0) this.stopVoice(voice);
      }, this);
      this.voices.push(voice);
    }
    game.on(Game.EVENT_HIDE, this.onHide, this);
    game.on(Game.EVENT_SHOW, this.onShow, this);
    // Cues are small; only the requested music/region is retained, not every long loop.
    for (const cue of CUES) this.loadClip(`${ROOT}/cues/${cue}`);
  }

  onEnable(): void {
    if (this.disposed) return;
    this.active = true;
    input.on(Input.EventType.TOUCH_END, this.onGesture, this);
    input.on(Input.EventType.MOUSE_UP, this.onGesture, this);
    input.on(Input.EventType.KEY_DOWN, this.onGesture, this);
    // Cocos can dispatch queued input outside the browser's activation stack. Capture
    // native end/up events as well, including UI buttons outside GameMain's ownership.
    // Browser globals are optional in native/minigame builds; do not instantiate a second audio context.
    const environment = globalThis as unknown as GestureEnvironment;
    this.gestureDocument = environment.document ?? null;
    if (this.gestureDocument) {
      this.hidden = this.gestureDocument.hidden === true;
      for (const event of GESTURES) {
        this.gestureDocument.addEventListener(event, this.onBrowserGesture, { capture: true, passive: true });
      }
    }
    this.syncLoops();
  }

  onDisable(): void {
    this.active = false;
    this.unbindGestures();
    this.suspend();
  }

  onDestroy(): void {
    this.disposed = true;
    this.active = false;
    if (GameAudio.instance === this) GameAudio.instance = null;
    this.unbindGestures();
    game.off(Game.EVENT_HIDE, this.onHide, this);
    game.off(Game.EVENT_SHOW, this.onShow, this);
    this.cueRequest++;
    this.pendingCue = null;
    for (const channel of [this.music, this.ambience]) {
      if (!channel) continue;
      channel.revision++;
      channel.source.stop();
      channel.source.clip = null;
      channel.source.node.destroy();
    }
    for (const voice of this.voices) {
      this.stopVoice(voice);
      voice.source.clip = null;
      voice.source.node.destroy();
    }
    this.voices.length = 0;
    for (const clip of this.clips.values()) clip.decRef();
    this.clips.clear();
    // In-flight resources.load callbacks release their reference when they arrive.
    this.loads.clear();
  }

  playMusic(track: MusicTrack): void {
    if (this.music && !this.disposed) this.requestLoop(this.music, `${ROOT}/music/${track}`);
  }

  playAmbience(region: Region | null): void {
    if (this.ambience && !this.disposed) {
      this.requestLoop(this.ambience, region === null ? null : `${ROOT}/ambience/${region}`);
    }
  }

  playCue(name: Cue): void {
    if (this.disposed || !this.active || this.hidden || this.volumes.effects === 0) return;
    const request = ++this.cueRequest;
    if (!this.unlocked) {
      // Preserve a cue emitted by a UI handler just before Cocos' global gesture handler,
      // but never replay an old opening animation when the player eventually touches.
      this.pendingCue = { name, request, time: Date.now() };
      return;
    }
    this.dispatchCue(name, request);
  }

  setMusicVolume(n: number): void { this.setVolume('music', n); }
  setEffectsVolume(n: number): void { this.setVolume('effects', n); }
  setAmbienceVolume(n: number): void { this.setVolume('ambience', n); }
  getMusicVolume(): number { return this.volumes.music; }
  getEffectsVolume(): number { return this.volumes.effects; }
  getAmbienceVolume(): number { return this.volumes.ambience; }

  private createSource(name: string, loop: boolean): AudioSource {
    const node = new Node(`Audio${name}`);
    this.node.addChild(node);
    const source = node.addComponent(AudioSource);
    source.playOnAwake = false;
    source.loop = loop;
    source.volume = 0;
    return source;
  }

  private createLoop(name: string): LoopChannel {
    const channel: LoopChannel = {
      source: this.createSource(name, true), path: null, revision: 0, loading: false, playPending: false,
    };
    channel.source.node.on(AudioSource.EventType.STARTED, () => {
      channel.playPending = false;
      this.syncLoop(channel, channel === this.music ? this.volumes.music : this.volumes.ambience);
    }, this);
    return channel;
  }

  private requestLoop(channel: LoopChannel, path: string | null): void {
    if (channel.path === path && (channel.loading || channel.source.clip || path === null)) return;
    const revision = ++channel.revision;
    channel.path = path;
    channel.loading = path !== null;
    channel.playPending = false;
    channel.source.stop();
    channel.source.clip = null;
    this.releaseUnusedLoops();
    if (path === null) return;
    this.loadClip(path, clip => {
      if (this.disposed || !isValid(this.node, true)) return;
      if (channel.revision !== revision || channel.path !== path) {
        this.releaseUnusedLoops();
        return;
      }
      channel.loading = false;
      if (clip) {
        channel.source.clip = clip;
        this.syncLoop(channel, channel === this.music ? this.volumes.music : this.volumes.ambience);
      }
      this.releaseUnusedLoops();
    });
  }

  private syncLoops(): void {
    if (this.music) this.syncLoop(this.music, this.volumes.music);
    if (this.ambience) this.syncLoop(this.ambience, this.volumes.ambience);
  }

  private syncLoop(channel: LoopChannel, volume: number): void {
    const source = channel.source;
    if (this.disposed || !isValid(source, true)) return;
    source.volume = this.canPlay() ? volume : 0;
    if (volume === 0) {
      source.stop();
      channel.playPending = false;
    } else if (!this.canPlay()) {
      source.pause();
      channel.playPending = false;
    } else if (source.clip && !source.playing && !channel.playPending) {
      // AudioSource.play restarts an already-playing clip, so never use it as an
      // unconditional "ensure playing", including while its native player loads.
      channel.playPending = true;
      source.play();
    }
  }

  private canPlay(): boolean {
    return !this.disposed && this.active && !this.hidden && this.unlocked && isValid(this.node, true);
  }

  private readonly onBrowserGesture = (event: { isTrusted?: boolean }): void => {
    if (event.isTrusted !== false) this.onGesture();
  };

  private onGesture(): void {
    if (this.disposed || !this.active || this.hidden) return;
    this.unlocked = true;
    this.syncLoops();
    const pending = this.pendingCue;
    this.pendingCue = null;
    if (pending && pending.request === this.cueRequest && Date.now() - pending.time <= 400) {
      this.dispatchCue(pending.name, pending.request);
    }
  }

  private unbindGestures(): void {
    input.off(Input.EventType.TOUCH_END, this.onGesture, this);
    input.off(Input.EventType.MOUSE_UP, this.onGesture, this);
    input.off(Input.EventType.KEY_DOWN, this.onGesture, this);
    if (this.gestureDocument) {
      for (const event of GESTURES) this.gestureDocument.removeEventListener(event, this.onBrowserGesture, true);
      this.gestureDocument = null;
    }
  }

  private onHide(): void {
    this.hidden = true;
    this.suspend();
  }

  private onShow(): void {
    this.hidden = false;
    this.syncLoops();
  }

  private suspend(): void {
    this.cueRequest++;
    this.pendingCue = null;
    this.syncLoops();
    for (const voice of this.voices) this.stopVoice(voice);
  }

  private dispatchCue(name: Cue, request: number): void {
    const path = `${ROOT}/cues/${name}`;
    const cached = this.clips.get(path);
    if (cached) {
      this.startCue(cached, name);
      return;
    }
    const time = Date.now();
    this.loadClip(path, clip => {
      // Only the latest still-relevant unloaded cue may arrive late; cached cues can
      // overlap through the bounded pool, without an old load stealing a newer voice.
      if (clip && request === this.cueRequest && Date.now() - time <= 800
        && this.canPlay() && this.volumes.effects > 0) this.startCue(clip, name);
    });
  }

  private startCue(clip: AudioClip, name: Cue): void {
    if (!this.canPlay() || this.volumes.effects === 0 || this.voices.length === 0) return;
    let voice = this.voices.find(candidate => !candidate.busy);
    if (!voice) voice = this.voices.reduce((oldest, candidate) => candidate.order < oldest.order ? candidate : oldest);
    this.stopVoice(voice);
    voice.busy = true;
    voice.order = ++this.voiceOrder;
    voice.gain = CUE_GAIN[name];
    voice.source.clip = clip;
    voice.source.volume = this.volumes.effects * voice.gain;
    voice.source.play();
  }

  private stopVoice(voice: CueVoice): void {
    voice.source.volume = 0;
    voice.source.stop();
    voice.busy = false;
  }

  private loadClip(path: string, listener?: ClipListener): void {
    const cached = this.clips.get(path);
    if (cached) {
      listener?.(cached);
      return;
    }
    const pending = this.loads.get(path);
    if (pending) {
      if (listener) pending.push(listener);
      return;
    }
    // A callback fan-out also supports Cocos' older mobile JS runtimes without
    // Promise.withResolvers or a Promise allocation for every short cue.
    this.loads.set(path, listener ? [listener] : []);
    resources.load(path, AudioClip, (error, clip) => {
      const listeners = this.loads.get(path) ?? [];
      this.loads.delete(path);
      let loaded: AudioClip | null = null;
      if (error || !clip) {
        if (!this.disposed) console.warn(`[GameAudio] Unable to load ${path}`, error);
      } else {
        clip.addRef();
        if (this.disposed || !isValid(this, true) || !isValid(this.node, true)) {
          clip.decRef();
        } else {
          this.clips.set(path, clip);
          loaded = clip;
        }
      }
      for (const done of listeners) done(loaded);
    });
  }

  private releaseUnusedLoops(): void {
    for (const [path, clip] of this.clips) {
      if (!path.startsWith(`${ROOT}/cues/`) && path !== this.music?.path && path !== this.ambience?.path) {
        this.clips.delete(path);
        clip.decRef();
      }
    }
  }

  private setVolume(channel: keyof Volumes, n: number): void {
    if (!Number.isFinite(n) || this.disposed) return;
    const volume = Math.max(0, Math.min(1, n));
    if (this.volumes[channel] === volume) return;
    this.volumes[channel] = volume;
    if (channel === 'effects') {
      if (volume === 0) {
        this.cueRequest++;
        this.pendingCue = null;
        for (const voice of this.voices) this.stopVoice(voice);
      } else {
        for (const voice of this.voices) {
          // Retain each cue's authored balance while adjusting already-playing sounds.
          if (voice.busy) voice.source.volume = volume * voice.gain;
        }
      }
    } else {
      this.syncLoops();
    }
    try {
      sys.localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.volumes));
    } catch (error) {
      this.warnStorage(error);
    }
  }

  private readSettings(): void {
    try {
      const raw = sys.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const saved = [
        ['music', 'music' in parsed ? parsed.music : undefined],
        ['effects', 'effects' in parsed ? parsed.effects : undefined],
        ['ambience', 'ambience' in parsed ? parsed.ambience : undefined],
      ] as const;
      for (const [channel, value] of saved) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          this.volumes[channel] = Math.max(0, Math.min(1, value));
        }
      }
    } catch (error) {
      this.warnStorage(error);
    }
  }

  private warnStorage(error: unknown): void {
    if (this.storageWarning) return;
    this.storageWarning = true;
    console.warn('[GameAudio] Sound settings are only retained in this session; local storage is unavailable.', error);
  }
}
