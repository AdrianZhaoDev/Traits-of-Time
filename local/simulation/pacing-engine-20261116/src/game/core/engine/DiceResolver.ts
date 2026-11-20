import type { Stage } from '../types/content.generated';
import type { CheckPreview, DiceResult } from '../types/schema';
import { uniformInt, type RandomSource } from './RandomSource';
type CheckLimits = { modifier_min: number; modifier_max: number };

function succeeds(raw: number, check: Stage['check'], attributeValue: number, modifier: number): boolean {
  return raw === 20 || (raw !== 1 && raw >= (check.raw_minimum ?? 1) && raw + attributeValue + modifier >= check.dc);
}

export function previewCheck(check: Stage['check'], attributeValue: number, limits: CheckLimits, bonus = 0): CheckPreview {
  const modifier_before = check.modifier + bonus;
  const modifier_after = Math.max(limits.modifier_min, Math.min(limits.modifier_max, modifier_before));
  let count = 0;
  for (let raw = 1; raw <= 20; raw++) if (succeeds(raw, check, attributeValue, modifier_after)) count++;
  return { ...check, modifier: modifier_after, attribute_value: attributeValue, modifier_before, modifier_after, success_probability: count / 20 };
}

export function resolveCheck(check: Stage['check'], attributeValue: number,
  limits: CheckLimits, rng: RandomSource, bonus = 0): DiceResult {
  const preview = previewCheck(check, attributeValue, limits, bonus);
  const raw = uniformInt(1, 20, rng);
  return { raw, attribute_value: attributeValue, modifier_before: preview.modifier_before, modifier_after: preview.modifier_after,
    dc: check.dc, success: succeeds(raw, check, attributeValue, preview.modifier_after), success_probability: preview.success_probability };
}
