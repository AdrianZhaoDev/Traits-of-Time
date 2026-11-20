import type { Attributes, InheritanceBonus } from '../types/schema';

const attributes: readonly (keyof Attributes)[] = ['physique', 'intelligence', 'wealth', 'prestige', 'luck'];

/** Inheritance is persisted and replayed, so accept only the exact supported shapes. */
export function isInheritanceBonus(value: unknown): value is InheritanceBonus {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const bonus = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(bonus);
  if (bonus.kind === 'extra_card') return keys.length === 2 && Object.prototype.propertyIsEnumerable.call(bonus, 'kind') &&
    Object.prototype.propertyIsEnumerable.call(bonus, 'card_id') && typeof bonus.card_id === 'string' && bonus.card_id.length > 0;
  return bonus.kind === 'attribute' && keys.length === 2 && Object.prototype.propertyIsEnumerable.call(bonus, 'kind') &&
    Object.prototype.propertyIsEnumerable.call(bonus, 'attribute') && attributes.some(attribute => attribute === bonus.attribute);
}
