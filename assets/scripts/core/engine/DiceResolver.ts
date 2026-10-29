import type { Stage } from '../types/content.generated.js';
import type { DiceResult } from '../types/schema.js';
import { uniformInt, type RandomSource } from './RandomSource.js';
export function resolveCheck(check: Stage['check'], attributeValue: number,
  limits: { modifier_min: number; modifier_max: number }, rng: RandomSource): DiceResult {
  const modifier_before = check.modifier;
  const modifier_after = Math.max(limits.modifier_min, Math.min(limits.modifier_max, modifier_before));
  const succeeds = (raw: number): boolean => raw === 20 || (raw !== 1 && raw + attributeValue + modifier_after >= check.dc);
  let count = 0;
  for (let raw = 1; raw <= 20; raw++) if (succeeds(raw)) count++;
  const raw = uniformInt(1, 20, rng);
  return { raw, attribute_value: attributeValue, modifier_before, modifier_after, dc: check.dc, success: succeeds(raw), success_probability: count / 20 };
}
