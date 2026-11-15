import type { GamePlatform } from "./platform";

export type AudioChannel = "music" | "effects";
export type AudioCue = "tap" | "reveal" | "select" | "error" | "choice" | "gain" | "achievement" | "ending" | "ending_high" | "death" | "item" | "identity" | "departure" | "advance" | "special_event" | "check_success" | "career_complete";
export interface AudioSettings {
  music: number;
  effects: number;
}

const SETTINGS_KEY = "time-travel.audio-settings.v1";
const CHANNELS: readonly AudioChannel[] = ["music", "effects"];
type MusicTrack = "game" | "ending";
const MUSIC_CROSSFADE_MS = 1050;
const CUE_FILES: Readonly<Record<AudioCue, readonly string[]>> = {
  tap: ["tap_a", "tap_b", "tap_c"],
  reveal: ["reveal"], select: ["select"], error: ["error"], choice: ["choice"], gain: ["gain"],
  achievement: ["achievement"], ending: ["ending"], ending_high: ["ending_high"], death: ["death"],
  item: ["item"], identity: ["identity"], departure: ["departure"], advance: ["advance_year"],
  special_event: ["special_event"], check_success: ["check_success"], career_complete: ["career_complete"],
};
const CUE_GAIN: Readonly<Record<AudioCue, number>> = {
  tap: 0.55, reveal: 0.58, select: 0.58, error: 0.48, choice: 0.58, gain: 0.58,
  achievement: 0.62, ending: 0.65, ending_high: 0.68, death: 0.5, item: 0.58, identity: 0.6,
  departure: 0.58, advance: 0.55, special_event: 0.62, check_success: 0.55, career_complete: 0.62,
};
const VOICE_COUNT = 4;

interface NativeAudioContext {
  src: string;
  loop: boolean;
  volume: number;
  obeyMuteSwitch: boolean;
  play(): void;
  pause(): void;
  stop(): void;
  seek(position: number): void;
  destroy(): void;
  onError(cb: (error: unknown) => void): void;
  offError?: (cb: (error: unknown) => void) => void;
}

interface AudioEnvironment {
  wx?: { createInnerAudioContext(): NativeAudioContext };
}

/** A fixed pool reuses players; a missing MP3 stays silent, never synthesized. */
class AudioVoice {
  private readonly web: HTMLAudioElement | null;
  private readonly native: NativeAudioContext | null;
  private source: string | null = null;
  private readonly failed = (error: unknown): void => {
    if (this.source) this.onFailure(this.source, error);
  };
  private readonly webFailed = (): void => this.failed(this.web?.error);
  private readonly playRejected = (error: unknown): void => {
    // Gesture policy and a superseded play() are not missing/corrupt files.
    if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")) return;
    this.failed(error);
  };

  constructor(
    platform: GamePlatform,
    loop: boolean,
    private readonly unavailable: Set<string>,
    private readonly onFailure: (source: string, error: unknown) => void,
  ) {
    if (platform.kind === "wechat") {
      // The native audio host is not described by the DOM TypeScript library.
      const environment = globalThis as typeof globalThis & AudioEnvironment;
      if (!environment.wx) throw new Error("微信音频环境不可用。");
      this.native = environment.wx.createInnerAudioContext();
      this.native.loop = loop;
      this.native.obeyMuteSwitch = true;
      this.native.onError(this.failed);
      this.web = null;
    } else {
      this.web = new Audio();
      this.web.preload = "none";
      this.web.loop = loop;
      this.web.addEventListener("error", this.webFailed);
      this.native = null;
    }
  }

  setSource(source: string | null): void {
    if (source === this.source) return;
    this.stop();
    this.source = source;
    if (this.web) {
      if (source) this.web.src = source;
      else this.web.removeAttribute("src");
    } else if (this.native && source) {
      this.native.src = source;
    }
  }

  setVolume(value: number): void {
    if (this.web) this.web.volume = value;
    if (this.native) this.native.volume = value;
  }

  play(): void {
    if (!this.source || this.unavailable.has(this.source)) return;
    if (this.web) void this.web.play().catch(this.playRejected);
    else this.native?.play();
  }

  pause(): void {
    this.web?.pause();
    this.native?.pause();
  }

  stop(): void {
    if (this.web) {
      this.web.pause();
      if (this.web.readyState > 0) this.web.currentTime = 0;
    }
    this.native?.stop();
  }

  dispose(): void {
    this.stop();
    if (this.web) {
      this.web.removeEventListener("error", this.webFailed);
      this.web.removeAttribute("src");
      this.web.load();
    }
    if (this.native) {
      this.native.offError?.(this.failed);
      this.native.destroy();
    }
    this.source = null;
  }
}

export class GameAudio {
  private readonly settings: AudioSettings = { music: 0.45, effects: 0.65 };
  private readonly lastAudible: AudioSettings = { music: 0.45, effects: 0.65 };
  private readonly unavailable = new Set<string>();
  private readonly music: AudioVoice;
  private readonly endingMusic: AudioVoice;
  private readonly voices: AudioVoice[] = [];
  private readonly cueGains = new Float32Array(VOICE_COUNT).fill(1);
  private readonly unsubscribeVisibility: () => void;
  private lastTapVariant = -1;
  private musicTrack: MusicTrack | null = null;
  private musicFadeTarget: MusicTrack | null = null;
  private musicMix = { game: 1, ending: 0 };
  private musicFadeTimer: ReturnType<typeof setInterval> | null = null;
  private nextVoice = 0;
  private unlocked = false;
  private suspended = false;
  private disposed = false;
  private storageWarning = false;
  private readonly fileFailed = (source: string, error: unknown): void => {
    if (this.disposed || this.unavailable.has(source)) return;
    this.unavailable.add(source);
    console.warn(`音频文件不可用，保持静音：${source}`, error);
  };

  constructor(private readonly platform: GamePlatform) {
    this.readSettings();
    this.music = new AudioVoice(platform, true, this.unavailable, this.fileFailed);
    this.endingMusic = new AudioVoice(platform, true, this.unavailable, this.fileFailed);
    for (let i = 0; i < VOICE_COUNT; i += 1) {
      this.voices.push(new AudioVoice(platform, false, this.unavailable, this.fileFailed));
    }
    this.unsubscribeVisibility = platform.onVisibility((visible) => {
      this.suspended = !visible;
      if (visible) {
        if (this.musicTrack && !this.isMusicSettled(this.musicTrack)) {
          this.crossfadeTo(this.musicTrack, MUSIC_CROSSFADE_MS);
        } else this.playCurrentLoops();
      }
      else {
        this.clearMusicFade();
        this.music.pause();
        this.endingMusic.pause();
        for (const voice of this.voices) voice.stop();
      }
    });
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /** Call synchronously from a real tap/key gesture before playing a cue. */
  unlock(): void {
    if (this.disposed) return;
    this.unlocked = true;
    this.playCurrentLoops();
  }

  playMusic(): void {
    this.switchMusic("game");
  }

  playEndingMusic(): void {
    this.switchMusic("ending");
  }

  private switchMusic(track: MusicTrack): void {
    if (this.disposed) return;
    if (this.musicTrack === track) {
      if (!this.musicFadeTarget) this.playCurrentLoops();
      return;
    }
    this.musicTrack = track;
    const voice = track === "game" ? this.music : this.endingMusic;
    voice.setSource(this.platform.asset(track === "game" ? "audio/music/life.mp3" : "audio/music/ending.mp3"));
    this.crossfadeTo(track, MUSIC_CROSSFADE_MS);
  }

  private crossfadeTo(track: MusicTrack, duration: number): void {
    this.clearMusicFade();
    const startGame = this.musicMix.game;
    const startEnding = this.musicMix.ending;
    const targetGame = track === "game" ? 1 : 0;
    const targetEnding = track === "ending" ? 1 : 0;
    if (!this.unlocked || this.suspended || this.settings.music <= 0 || duration <= 0) {
      this.musicMix = { game: targetGame, ending: targetEnding };
      this.musicFadeTarget = null;
      this.playCurrentLoops();
      return;
    }
    const startedAt = Date.now();
    this.musicFadeTarget = track;
    this.playCurrentLoops();
    this.musicFadeTimer = setInterval(() => {
      if (this.disposed || this.suspended) return;
      const progress = Math.max(0, Math.min(1, (Date.now() - startedAt) / duration));
      const eased = 1 - (1 - progress) ** 3;
      this.musicMix.game = startGame + (targetGame - startGame) * eased;
      this.musicMix.ending = startEnding + (targetEnding - startEnding) * eased;
      this.applyMusicVolumes();
      if (progress >= 1) {
        this.clearMusicFade();
        this.musicMix = { game: targetGame, ending: targetEnding };
        this.musicFadeTarget = null;
        this.playCurrentLoops();
      }
    }, 32);
  }

  private applyMusicVolumes(): void {
    const gain = this.settings.music ** 2;
    this.music.setVolume(gain * this.musicMix.game);
    this.endingMusic.setVolume(gain * this.musicMix.ending);
  }

  private isMusicSettled(track: MusicTrack): boolean {
    return track === "game" ? this.musicMix.game === 1 && this.musicMix.ending === 0
      : this.musicMix.ending === 1 && this.musicMix.game === 0;
  }

  private clearMusicFade(): void {
    if (this.musicFadeTimer !== null) clearInterval(this.musicFadeTimer);
    this.musicFadeTimer = null;
  }

  playCue(cue: AudioCue): void {
    if (this.disposed || !this.unlocked || this.suspended || this.settings.effects <= 0) return;
    const index = this.nextVoice;
    this.nextVoice = (index + 1) % VOICE_COUNT;
    const voice = this.voices[index];
    voice.stop();
    const files = CUE_FILES[cue];
    let fileIndex = 0;
    if (cue === "tap" && files.length > 1) {
      fileIndex = Math.floor(Math.random() * files.length);
      if (fileIndex === this.lastTapVariant) {
        fileIndex = (fileIndex + 1 + Math.floor(Math.random() * (files.length - 1))) % files.length;
      }
      this.lastTapVariant = fileIndex;
    }
    voice.setSource(this.platform.asset(`audio/cues/${files[fileIndex]}.mp3`));
    this.cueGains[index] = CUE_GAIN[cue];
    voice.setVolume(this.settings.effects ** 2 * CUE_GAIN[cue]);
    voice.play();
  }

  setVolume(channel: AudioChannel, value: number): void {
    if (this.disposed || !Number.isFinite(value)) return;
    const volume = Math.max(0, Math.min(1, value));
    if (volume > 0) this.lastAudible[channel] = volume;
    this.settings[channel] = volume;
    try {
      this.platform.storage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (error) {
      if (!this.storageWarning) console.warn("音量设置无法保存，仅在本次运行中生效。", error);
      this.storageWarning = true;
    }
    if (channel === "effects") {
      for (let i = 0; i < this.voices.length; i += 1) {
        this.voices[i].setVolume(volume ** 2 * this.cueGains[i]);
        if (volume === 0) this.voices[i].stop();
      }
    }
    this.playCurrentLoops();
  }

  toggleMute(channel?: AudioChannel): void {
    if (this.disposed) return;
    if (channel) {
      this.setVolume(channel, this.settings[channel] > 0 ? 0 : this.lastAudible[channel]);
      return;
    }
    const mute = CHANNELS.some((name) => this.settings[name] > 0);
    for (const name of CHANNELS) this.setVolume(name, mute ? 0 : this.lastAudible[name]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeVisibility();
    this.clearMusicFade();
    this.music.dispose();
    this.endingMusic.dispose();
    for (const voice of this.voices) voice.dispose();
  }

  private playCurrentLoops(): void {
    if (this.disposed || !this.unlocked || this.suspended) return;
    // Square slider values at the player boundary for perceptually useful travel.
    this.applyMusicVolumes();
    if (this.settings.music <= 0) {
      this.music.pause();
      this.endingMusic.pause();
      return;
    }
    if (this.musicMix.game > 0 || this.musicFadeTarget === "game") this.music.play();
    else this.music.pause();
    if (this.musicMix.ending > 0 || this.musicFadeTarget === "ending") this.endingMusic.play();
    else this.endingMusic.pause();
  }

  private readSettings(): void {
    try {
      const raw = this.platform.storage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      for (const channel of CHANNELS) {
        const value: unknown = Object.getOwnPropertyDescriptor(parsed, channel)?.value;
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        this.settings[channel] = Math.max(0, Math.min(1, value));
        if (this.settings[channel] > 0) this.lastAudible[channel] = this.settings[channel];
      }
    } catch (error) {
      console.warn("无法读取音量设置，本次使用默认音量。", error);
    }
  }
}
