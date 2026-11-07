import { describe, expect, it, vi } from 'vitest';
import { Node, Label } from '../mocks/cc-mock';
import { OpeningFlow } from '../../assets/scripts/presentation/OpeningFlow';

const offers = [
  { id: 'glue', name: '强力胶', description: '修补小物件。', rarity: 'R' },
  { id: 'light', name: '手电', description: '照亮夜路。', rarity: 'SR' },
  { id: 'corn', name: '玉米良种', description: '种下后仍需照料。', rarity: 'SSR' },
];
const nodes = (root: Node): Node[] => [root, ...root.children.flatMap(nodes)];
const click = (root: Node, name: string) => nodes(root).find(node => node.name === name)!.emit(Node.EventType.TOUCH_END);

describe('opening reveal interaction', () => {
  it('blocks premature and duplicate entry, preserving offers through resizing and retry', async () => {
    const root = new Node('Opening');
    const flow = root.addComponent(OpeningFlow);
    const enter = vi.fn(async () => { throw new Error('暂时无法进入'); });
    flow.init({ onStart: () => {}, onAchievements: () => {}, onStats: () => {}, onEnter: enter });
    flow.showCards(offers);
    click(root, 'CardOffer_corn');
    click(root, 'Btn_穿越');
    expect(enter).not.toHaveBeenCalled();
    flow.update(1.7);
    click(root, 'CardOffer_glue');
    click(root, 'Btn_穿越');
    expect(enter).not.toHaveBeenCalled();
    flow.resize(1331);
    flow.update(2);
    click(root, 'CardOffer_corn');
    click(root, 'Btn_穿越');
    click(root, 'Btn_穿越');
    expect(enter).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledWith('corn');
    await Promise.resolve();
    await Promise.resolve();
    click(root, 'Btn_穿越');
    expect(enter).toHaveBeenCalledTimes(2);
    expect(nodes(root).filter(node => node.name.startsWith('CardOffer_')).map(node => node.name))
      .toEqual(['CardOffer_glue', 'CardOffer_light', 'CardOffer_corn']);
  });

  it('reduced motion still reveals real offers and permits selection', () => {
    const root = new Node('Opening');
    const flow = root.addComponent(OpeningFlow);
    flow.reducedMotion = true;
    const enter = vi.fn(async () => {});
    flow.init({ onStart: () => {}, onAchievements: () => {}, onStats: () => {}, onEnter: enter });
    flow.showCards(offers);
    flow.update(3);
    click(root, 'CardOffer_light');
    click(root, 'Btn_穿越');
    expect(enter).toHaveBeenCalledWith('light');
    expect(nodes(root).some(node => node.getComponent(Label)?.string === '手电')).toBe(true);
    flow.hide();
    expect(root.active).toBe(false);
    flow.showHome();
    expect(nodes(root).some(node => node.name === 'CardOffer_light')).toBe(false);
  });
});
