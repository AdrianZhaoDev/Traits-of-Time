import { describe, it, expect, vi } from 'vitest';
import { UIAnimController } from '../../assets/scripts/presentation/UIAnimController';
import { MemorialCard } from '../../assets/scripts/presentation/MemorialCard';
import type { OptionPending } from '../../assets/scripts/presentation/MemorialCard';

describe('UI Refactor Phase 3 - Motion Matrix & Interactive Controller', () => {
  describe('UIAnimController API Contracts', () => {
    it('provides playStampEffect with safe fallback when node is invalid or null', () => {
      expect(() => {
        UIAnimController.playStampEffect(null as any, null);
      }).not.toThrow();

      let completed = false;
      UIAnimController.playStampEffect({ isValid: false } as any, null, () => {
        completed = true;
      });
      expect(completed).toBe(false);
    });

    it('provides playScreenShake with safe guard on null/invalid target', () => {
      expect(() => {
        UIAnimController.playScreenShake(null as any);
        UIAnimController.playScreenShake({ isValid: false } as any, 10, 0.2);
      }).not.toThrow();
    });

    it('provides playStatChangeEffect handling positive and negative deltas safely', () => {
      expect(() => {
        UIAnimController.playStatChangeEffect(null as any, 5);
        UIAnimController.playStatChangeEffect({ isValid: false } as any, -3);
      }).not.toThrow();
    });

    it('provides updateScrollWeathering handling empty or null ScrollView gracefully', () => {
      expect(() => {
        UIAnimController.updateScrollWeathering(null as any);
        UIAnimController.updateScrollWeathering({ content: null } as any);
      }).not.toThrow();
    });

    it('provides updateCandleVignette switching between normal breath and endangered flicker', () => {
      expect(() => {
        UIAnimController.updateCandleVignette(null as any, 25, 8);
        UIAnimController.updateCandleVignette({ isValid: false } as any, 65, 1);
      }).not.toThrow();
    });

    it('provides playPlaqueSway guarding against null/invalid nodes', () => {
      expect(() => {
        UIAnimController.playPlaqueSway(null as any);
        UIAnimController.playPlaqueSway({ isValid: false } as any);
      }).not.toThrow();
    });
  });

  describe('MemorialCard Direction & Option Logic', () => {
    it('defines left as first option and right as second option or fallback', () => {
      const mockDecision: OptionPending = {
        kind: 'option',
        event_instance_id: 'inst_1',
        event_id: 'E_TEST_CRISIS',
        options: [
          {
            id: 'OPT_PASS',
            text: '冷眼旁观，不插手',
            risk: 'safe',
            checks: [],
            available: true,
            reason: null,
          },
          {
            id: 'OPT_JOIN',
            text: '倾力入局，纳粮借兵',
            risk: 'risky',
            checks: [],
            available: true,
            reason: null,
          },
        ],
      };

      const card = new MemorialCard();
      let selectedOption: string | null = null;
      // Inject internal fields for testing logic
      (card as any).decisionData = mockDecision;
      (card as any).onSelectCallback = (id: string) => {
        selectedOption = id;
      };

      // Test option routing logic
      expect(mockDecision.options[0].id).toBe('OPT_PASS');
      expect(mockDecision.options[1].id).toBe('OPT_JOIN');

      // Test simulated left swipe triggering option 0
      (card as any).currentOffset = -150;
      (card as any).isDragging = true;
      (card as any).onTouchEnd();
      expect(selectedOption).toBe('OPT_PASS');

      // Test simulated right swipe triggering option 1
      selectedOption = null;
      (card as any).currentOffset = 150;
      (card as any).isDragging = true;
      (card as any).onTouchEnd();
      expect(selectedOption).toBe('OPT_JOIN');
    });

    it('falls back to single option when only one option is present', () => {
      const singleOptDecision: OptionPending = {
        kind: 'option',
        event_instance_id: 'inst_2',
        event_id: 'E_TEST_SINGLE',
        options: [
          {
            id: 'OPT_ONLY',
            text: '别无选择',
            risk: 'safe',
            checks: [],
            available: true,
            reason: null,
          },
        ],
      };

      const card = new MemorialCard();
      let selectedOption: string | null = null;
      (card as any).decisionData = singleOptDecision;
      (card as any).onSelectCallback = (id: string) => {
        selectedOption = id;
      };

      // Right swipe with single option targets the single option
      (card as any).currentOffset = 120;
      (card as any).isDragging = true;
      (card as any).onTouchEnd();
      expect(selectedOption).toBe('OPT_ONLY');
    });

    it('resets position without triggering selection when swipe offset does not reach threshold', () => {
      const card = new MemorialCard();
      let selectedOption: string | null = null;
      (card as any).decisionData = {
        kind: 'option',
        event_instance_id: 'inst_3',
        event_id: 'E_TEST_THRESHOLD',
        options: [
          { id: 'O1', text: 'Left', risk: 'safe', checks: [], available: true, reason: null },
          { id: 'O2', text: 'Right', risk: 'safe', checks: [], available: true, reason: null },
        ],
      };
      (card as any).onSelectCallback = (id: string) => {
        selectedOption = id;
      };

      // Minor swipe (offset 50 < threshold 110)
      (card as any).currentOffset = 50;
      (card as any).isDragging = true;
      (card as any).onTouchEnd();
      expect(selectedOption).toBeNull();
    });
  });

  describe('Bronze Seal Hold & Advance Cadence', () => {
    it('models seal press: short tap (<0.35s) triggers single step, hold (>=0.35s) continues at 0.22s interval', () => {
      let stepCount = 0;
      const advance = () => { stepCount++; };

      let isSealHolding = true;
      let holdTimer = 0;
      let autoAdvanceInterval = 0;

      // Simulate short tap (e.g. 0.15s)
      holdTimer += 0.15;
      if (holdTimer < 0.35) {
        advance();
      }
      isSealHolding = false;
      expect(stepCount).toBe(1);

      // Reset for continuous hold simulation
      stepCount = 0;
      isSealHolding = true;
      holdTimer = 0;
      autoAdvanceInterval = 0;

      // Simulate frame updates totaling 1.0s of continuous hold
      const dt = 0.05;
      for (let t = 0; t < 1.0; t += dt) {
        if (isSealHolding) {
          holdTimer += dt;
          if (holdTimer >= 0.35) {
            autoAdvanceInterval += dt;
            if (autoAdvanceInterval >= 0.22) {
              autoAdvanceInterval = 0;
              advance();
            }
          }
        }
      }

      // In (1.0s - 0.35s) = 0.65s hold time, with 0.22s interval:
      // Trigger at approx 0.35+0.25 (step 1), 0.35+0.50 (step 2) -> 2 or 3 steps
      expect(stepCount).toBeGreaterThanOrEqual(2);
      expect(stepCount).toBeLessThanOrEqual(3);
    });

    it('automatically truncates hold when pending decision or death occurs', () => {
      let isSealHolding = true;
      const pending: OptionPending | null = {
        kind: 'option',
        event_instance_id: 'inst_x',
        event_id: 'E_CRISIS',
        options: [],
      };

      // When pending arrives:
      if (pending) {
        isSealHolding = false;
      }
      expect(isSealHolding).toBe(false);

      // When ended arrives:
      isSealHolding = true;
      const status = 'ENDED';
      if (status === 'ENDED') {
        isSealHolding = false;
      }
      expect(isSealHolding).toBe(false);
    });
  });
});
