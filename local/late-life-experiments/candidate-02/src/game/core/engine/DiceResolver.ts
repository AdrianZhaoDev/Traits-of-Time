import type { CheckRules, Stage } from '../types/content.generated';
import type { CheckPreview, DiceResult } from '../types/schema';
import { uniformInt, type RandomSource } from './RandomSource';

const DIE_MIN = 1;
const DIE_MAX = 20;

function succeeds(raw: number, dc: number, attributeValue: number, modifier: number, luckBonus: number, rawMinimum: number | null): boolean {
  return raw === DIE_MAX || (raw !== DIE_MIN && (rawMinimum === null || raw >= rawMinimum) && raw + attributeValue + modifier + luckBonus >= dc);
}

function isCritical(raw: number, success: boolean, luck: number, rules: CheckRules): boolean {
  return raw === DIE_MAX || (success && raw === rules.critical_luck_raw && luck >= rules.critical_luck_minimum);
}

export function previewCheck(check: Stage['check'], attributeValue: number, rules: CheckRules, luck: number, bonus = 0): CheckPreview {
  const modifier_before = check.modifier + bonus;
  const modifier_after = Math.max(rules.modifier_min, Math.min(rules.modifier_max, modifier_before));
  const dynamic = rules.dynamic_raw_minimum;
  const effective_raw_minimum = check.raw_minimum === undefined ? null : Math.min(check.raw_minimum,
    Math.max(dynamic.floor, check.raw_minimum - Math.floor(Math.max(0, attributeValue - dynamic.attribute_base) / dynamic.attribute_step)));
  let luck_bonus = 0;
  for (const threshold of rules.luck_bonus_thresholds) if (luck >= threshold) luck_bonus++;
  let successes = 0;
  let criticals = 0;
  for (let raw = DIE_MIN; raw <= DIE_MAX; raw++) {
    const success = succeeds(raw, check.dc, attributeValue, modifier_after, luck_bonus, effective_raw_minimum);
    if (success) successes++;
    if (isCritical(raw, success, luck, rules)) criticals++;
  }
  return { ...check, modifier: modifier_after, attribute_value: attributeValue, modifier_before, modifier_after,
    luck_value: luck, luck_bonus, effective_raw_minimum, success_probability: successes / DIE_MAX, critical_probability: criticals / DIE_MAX };
}

export function resolveCheck(check: Stage['check'], attributeValue: number,
  rules: CheckRules, luck: number, rng: RandomSource, bonus = 0): DiceResult {
  const preview = previewCheck(check, attributeValue, rules, luck, bonus);
  const raw = uniformInt(DIE_MIN, DIE_MAX, rng);
  const success = succeeds(raw, check.dc, attributeValue, preview.modifier_after, preview.luck_bonus, preview.effective_raw_minimum);
  return { raw, attribute_value: attributeValue, modifier_before: preview.modifier_before, modifier_after: preview.modifier_after,
    luck_value: luck, luck_bonus: preview.luck_bonus, effective_raw_minimum: preview.effective_raw_minimum,
    dc: check.dc, success, critical_success: isCritical(raw, success, luck, rules),
    success_probability: preview.success_probability, critical_probability: preview.critical_probability };
}
