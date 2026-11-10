import { GameController } from './controller';
import { createPlatform } from './platform';
import { GameRenderer } from './renderer';

/** Called by the generated native loader after all local subpackages are ready. */
export function startWechat(): void {
  const platform = createPlatform();
  const controller = new GameController(platform.storage);
  new GameRenderer(platform, controller);
}
