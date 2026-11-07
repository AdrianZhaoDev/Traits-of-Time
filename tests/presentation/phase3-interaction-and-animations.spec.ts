import { describe, it, expect } from 'vitest';
import { Label, Node } from '../mocks/cc-mock';
import { MemorialCard } from '../../assets/scripts/presentation/MemorialCard';
import type { OptionPending } from '../../assets/scripts/presentation/MemorialCard';

describe('UI Refactor Phase 3 - Motion Matrix & Interactive Controller', () => {

  describe('MemorialCard decisions', () => {
    it('exposes later options and their conditions without allowing unavailable or duplicate selections', () => {
      const decision: OptionPending = {
        kind: 'option', event_instance_id: 'inst_1', event_id: 'E_PROJECT',
        options: [
          { id: 'study', text: '借书学认字', risk: 'normal', checks: [{ attribute: 'intelligence', dc: 12, modifier: 0, attribute_value: 4, modifier_before: 0, modifier_after: 0, success_probability: 0.65 }], available: true, reason: null },
          { id: 'household', text: '守艺养家', risk: 'safe', checks: [], available: false, reason: '条件不足' },
          { id: 'decline', text: '传艺济邻', risk: 'safe', checks: [], available: true, reason: null },
          { id: 'workshop', text: '投身工坊', risk: 'high', checks: [], available: true, reason: null },
        ],
      };
      const card = new MemorialCard();
      const selected: string[] = [];
      card.init(decision, id => selected.push(id), '人生转向', { workshop: ['事业说明：起步花费财富1，失败可能中断。'] });
      const surface = card.node.children.find(node => node.name === 'DecisionPanelSurface')!;
      const scroll = surface.children.find(node => node.name === 'OptionScrollView')!;
      const content = scroll.children.find(node => node.name === 'Viewport')!.children.find(node => node.name === 'Content')!;
      const row = (id: string) => content.children.find(node => node.name === `Option_${id}`)!;
      const detail = (id: string) => row(id).children.find(node => node.name === 'OptionDetail')!.getComponent(Label)!.string;
      expect(detail('study')).toMatch(/\b12\b/);
      expect(detail('study')).toContain('65%');
      expect(detail('household')).toContain('不可选：条件不足');
      expect(detail('workshop')).toContain('起步花费财富1，失败可能中断。');
      row('household').emit(Node.EventType.TOUCH_END);
      expect(selected).toEqual([]);
      row('decline').emit(Node.EventType.TOUCH_END);
      row('workshop').emit(Node.EventType.TOUCH_END);
      expect(selected).toEqual(['decline']);
      card.showError('请重试');
      row('workshop').emit(Node.EventType.TOUCH_END);
      expect(selected).toEqual(['decline', 'workshop']);
    });
  });

});
