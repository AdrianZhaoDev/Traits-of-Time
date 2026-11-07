import { afterEach, describe, expect, it, vi } from 'vitest';
import { Node, resources, Sprite, SpriteFrame, UITransform } from '../mocks/cc-mock';
import { createArt, setArt } from '../../assets/scripts/presentation/ArtAssets';

afterEach(() => vi.restoreAllMocks());

describe('art loading', () => {
  it('keeps the latest illustration when earlier requests finish out of order', async () => {
    const pending = new Map<string, (error: Error | null, frame: SpriteFrame | null) => void>();
    vi.spyOn(resources, 'load').mockImplementation(((path: string, _type: unknown, callback: (error: Error | null, frame: SpriteFrame | null) => void) => {
      pending.set(path, callback);
    }) as typeof resources.load);

    const root = new Node('Root');
    const art = createArt(root, 'RegionalView', 'scenes/shanbei', 100, 100);
    setArt(art, 'scenes/jiangnan');
    const newer = new SpriteFrame();
    newer.originalSize = { width: 200, height: 100 };
    const older = new SpriteFrame();
    pending.get('art/ming_end/scenes/jiangnan/spriteFrame')!(null, newer);
    pending.get('art/ming_end/scenes/shanbei/spriteFrame')!(null, older);
    await Promise.resolve();

    const image = art.getChildByName('ArtImage')!;
    expect(image.getComponent(Sprite)?.spriteFrame).toBe(newer);
    expect(image.getComponent(UITransform)).toMatchObject({ width: 100, height: 50 });
  });
});
