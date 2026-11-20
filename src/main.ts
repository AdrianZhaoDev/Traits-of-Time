import { GameController } from './controller';
import { acquireWebSessionLock, createPlatform } from './platform';
import { GameRenderer } from './renderer';

async function startWeb(): Promise<void> {
  let release: (() => void) | null = null;
  try {
    const canvas = document.getElementById('game');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('游戏画布未能载入。');
    const platform = createPlatform(canvas);
    const ownership = await acquireWebSessionLock(navigator.locks);
    release = ownership.release;
    const controller = new GameController(platform.storage, ownership.reason);
    const renderer = new GameRenderer(platform, controller);
    if (import.meta.env.DEV) {
      Object.assign(window, { layoutGame: { controller, renderer } });
    }
    if (import.meta.hot) import.meta.hot.dispose(() => { renderer.dispose(); release?.(); });
  } catch (error) {
    release?.();
    const status = document.getElementById('startup-status');
    if (status) {
      status.hidden = false;
      status.textContent = '游戏启动失败：' + (error instanceof Error ? error.message : String(error));
    }
    console.error(error);
  }
}

void startWeb();
