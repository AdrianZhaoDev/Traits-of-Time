export type MusicTrack = "home" | "life" | "ending";
export type AudioChannel = "music" | "effects" | "ambience";
export type AudioCue = "tap" | "reveal" | "select" | "error" | "choice" | "gain" | "achievement" | "ending" | "death" | "item" | "identity";

export interface AudioSettings {
  music: number;
  effects: number;
  ambience: number;
}

const SETTINGS_KEY = "time-travel.audio-settings.v1";
const MUSIC: Record<MusicTrack, string> = {
  home: new URL("../assets/resources/audio/ming_end/music/home.mp3", import.meta.url).href,
  life: new URL("../assets/resources/audio/ming_end/music/life.mp3", import.meta.url).href,
  ending: new URL("../assets/resources/audio/ming_end/music/ending.mp3", import.meta.url).href,
};
const AMBIENCE: Record<string, string> = {
  R_SHANBEI: new URL("../assets/resources/audio/ming_end/ambience/shanbei.mp3", import.meta.url).href,
  R_CAPITAL: new URL("../assets/resources/audio/ming_end/ambience/capital.mp3", import.meta.url).href,
  R_JIANGNAN: new URL("../assets/resources/audio/ming_end/ambience/jiangnan.mp3", import.meta.url).href,
};
const CUES: Record<AudioCue, string> = {
  tap: new URL("../assets/resources/audio/ming_end/cues/tap.mp3", import.meta.url).href,
  reveal: new URL("../assets/resources/audio/ming_end/cues/reveal.mp3", import.meta.url).href,
  select: new URL("../assets/resources/audio/ming_end/cues/select.mp3", import.meta.url).href,
  error: new URL("../assets/resources/audio/ming_end/cues/error.mp3", import.meta.url).href,
  choice: new URL("../assets/resources/audio/ming_end/cues/choice.mp3", import.meta.url).href,
  gain: new URL("../assets/resources/audio/ming_end/cues/gain.mp3", import.meta.url).href,
  achievement: new URL("../assets/resources/audio/ming_end/cues/achievement.mp3", import.meta.url).href,
  ending: new URL("../assets/resources/audio/ming_end/cues/ending.mp3", import.meta.url).href,
  death: new URL("../assets/resources/audio/ming_end/cues/death.mp3", import.meta.url).href,
  item: new URL("../assets/resources/audio/ming_end/cues/item.mp3", import.meta.url).href,
  identity: new URL("../assets/resources/audio/ming_end/cues/identity.mp3", import.meta.url).href,
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export class BrowserAudio {
  private settings: AudioSettings = { music: 0.45, effects: 0.65, ambience: 0.3 };
  private music = new Audio();
  private ambience = new Audio();
  private musicTrack: MusicTrack | null = null;
  private ambienceRegion: string | null = null;
  private unlocked = false;
  private suspended = false;

  constructor() {
    this.music.loop = true;
    this.ambience.loop = true;
    this.readSettings();
    document.addEventListener("visibilitychange", () => {
      this.suspended = document.hidden;
      if (this.suspended) {
        this.music.pause();
        this.ambience.pause();
      } else if (this.unlocked) {
        this.playCurrentLoops();
      }
    });
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  unlock(): void {
    this.unlocked = true;
    this.playCurrentLoops();
  }

  playMusic(track: MusicTrack): void {
    this.musicTrack = track;
    if (!this.unlocked || this.suspended) return;
    const src = MUSIC[track];
    if (this.music.src !== src) {
      this.music.src = src;
      this.music.currentTime = 0;
    }
    this.music.volume = this.settings.music;
    if (this.settings.music > 0) void this.music.play().catch(() => undefined);
    else this.music.pause();
  }

  playAmbience(region: string | null): void {
    this.ambienceRegion = region;
    if (!this.unlocked || this.suspended) return;
    const src = region ? AMBIENCE[region] : undefined;
    if (!src) {
      this.ambience.pause();
      this.ambience.removeAttribute("src");
      this.ambienceRegion = null;
      return;
    }
    if (this.ambience.src !== src) {
      this.ambience.src = src;
      this.ambience.currentTime = 0;
    }
    this.ambience.volume = this.settings.ambience;
    if (this.settings.ambience > 0) void this.ambience.play().catch(() => undefined);
    else this.ambience.pause();
  }

  playCue(cue: AudioCue): void {
    if (!this.unlocked || this.suspended || this.settings.effects <= 0) return;
    const audio = new Audio(CUES[cue]);
    audio.volume = this.settings.effects;
    void audio.play().catch(() => undefined);
    audio.addEventListener("ended", () => audio.remove(), { once: true });
  }

  setVolume(channel: AudioChannel, value: number): void {
    this.settings[channel] = clamp(value);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Audio remains usable for this page session when storage is unavailable.
    }
    if (channel === "music") {
      this.music.volume = this.settings.music;
      if (this.settings.music === 0) this.music.pause();
      else if (this.unlocked && !this.suspended) void this.music.play().catch(() => undefined);
    } else if (channel === "ambience") {
      this.ambience.volume = this.settings.ambience;
      if (this.settings.ambience === 0) this.ambience.pause();
      else if (this.unlocked && !this.suspended) void this.ambience.play().catch(() => undefined);
    }
  }

  stop(): void {
    this.music.pause();
    this.ambience.pause();
  }

  private playCurrentLoops(): void {
    if (this.musicTrack) this.playMusic(this.musicTrack);
    if (this.ambienceRegion) this.playAmbience(this.ambienceRegion);
  }

  private readSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AudioSettings>;
      for (const key of ["music", "effects", "ambience"] as const) {
        if (typeof parsed[key] === "number" && Number.isFinite(parsed[key])) {
          this.settings[key] = clamp(parsed[key]);
        }
      }
    } catch {
      // Keep defaults.
    }
  }
}