import { GameController } from './controller';
import { createPlatform } from './platform';
import { GameRenderer } from './renderer';

try {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('游戏画布未能载入。');
  const platform = createPlatform(canvas);
  const controller = new GameController(platform.storage);
  const renderer = new GameRenderer(platform, controller);
  if (import.meta.env.DEV) {
    Object.assign(window, { layoutGame: { controller, renderer } });
  }
  if (import.meta.hot) import.meta.hot.dispose(() => renderer.dispose());
} catch (error) {
  const status = document.getElementById('startup-status');
  if (status) {
    status.hidden = false;
    status.textContent = '游戏启动失败：' + (error instanceof Error ? error.message : String(error));
  }
  console.error(error);
}
