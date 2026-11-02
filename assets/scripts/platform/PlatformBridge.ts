export interface StorageBridge {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

export interface AudioBridge {
  playMusic(url: string, loop?: boolean): void;
  stopMusic(): void;
  playSound(url: string): void;
  stopSound(): void;
  setMusicVolume(volume: number): void;
  setSoundVolume(volume: number): void;
}

export interface PosterBridge {
  renderAndSavePoster(params: {
    title: string;
    summary: string;
    seed: number;
    year: number;
    achievements: string[];
  }): Promise<{ success: boolean; filePath?: string; error?: string }>;
}

export interface PlatformCapabilities {
  platformName: "wechat" | "douyin" | "web" | "native";
  hasStorage: boolean;
  hasAudio: boolean;
  hasAdReward: boolean;
  hasPosterExport: boolean;
}

export interface PlatformBridge {
  capabilities: PlatformCapabilities;
  storage: StorageBridge;
  audio: AudioBridge;
  poster: PosterBridge;
  vibrateShort?(): void;
  showToast?(message: string): void;
}
