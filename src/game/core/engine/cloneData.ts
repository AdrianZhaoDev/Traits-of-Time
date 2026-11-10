/** Clone JSON-shaped engine data without platform globals or prototype-key setters. */
export function cloneData<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => cloneData(item)) as T;
  const copy = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(value)) copy[key] = cloneData(child);
  return copy as T;
}
