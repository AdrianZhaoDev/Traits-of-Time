import type { ContentBundle } from '../types/content.generated.js';

/** A read-only view deliberately omits Map mutation methods at runtime, not only in its type. */
class IdMap<T extends { id: string }> implements ReadonlyMap<string, T> {
  readonly #map: Map<string, T>;
  constructor(items: readonly T[]) {
    this.#map = new Map(items.map((item) => [item.id, item]));
    Object.freeze(this);
  }
  get size(): number { return this.#map.size; }
  get(key: string): T | undefined { return this.#map.get(key); }
  has(key: string): boolean { return this.#map.has(key); }
  entries(): MapIterator<[string, T]> { return this.#map.entries(); }
  keys(): MapIterator<string> { return this.#map.keys(); }
  values(): MapIterator<T> { return this.#map.values(); }
  [Symbol.iterator](): MapIterator<[string, T]> { return this.#map[Symbol.iterator](); }
  forEach(callback: (value: T, key: string, map: ReadonlyMap<string, T>) => void, thisArg?: unknown): void {
    this.#map.forEach((value, key) => callback.call(thisArg, value, key, this));
  }
}

export interface ContentRegistry {
  readonly regions: ReadonlyMap<string, ContentBundle['regions'][number]>;
  readonly castes: ReadonlyMap<string, ContentBundle['castes'][number]>;
  readonly traits: ReadonlyMap<string, ContentBundle['traits'][number]>;
  readonly cards: ReadonlyMap<string, ContentBundle['cards'][number]>;
  readonly pools: ReadonlyMap<string, ContentBundle['pools'][number]>;
  readonly events: ReadonlyMap<string, ContentBundle['events'][number]>;
  readonly chains: ReadonlyMap<string, ContentBundle['chains'][number]>;
  readonly achievements: ReadonlyMap<string, ContentBundle['achievements'][number]>;
  readonly deaths: ReadonlyMap<string, ContentBundle['deaths'][number]>;
  readonly backgrounds: ReadonlyMap<string, ContentBundle['era']['backgrounds'][number]>;
  readonly identities: ReadonlyMap<string, ContentBundle['era']['identities'][number]>;
  readonly injuries: ReadonlyMap<string, ContentBundle['era']['injuries'][number]>;
}

/** Freeze successfully validated content; no live game state belongs in these objects. */
export function freezeContent<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => freezeContent(child));
    Object.freeze(value);
  }
  return value;
}

const registries = new WeakMap<ContentBundle, ContentRegistry>();

export function createContentRegistry(bundle: ContentBundle): ContentRegistry {
  const existing = registries.get(bundle);
  if (existing) return existing;
  freezeContent(bundle);
  const registry = Object.freeze({
    regions: new IdMap(bundle.regions),
    castes: new IdMap(bundle.castes),
    traits: new IdMap(bundle.traits),
    cards: new IdMap(bundle.cards),
    pools: new IdMap(bundle.pools),
    events: new IdMap(bundle.events),
    chains: new IdMap(bundle.chains),
    achievements: new IdMap(bundle.achievements),
    deaths: new IdMap(bundle.deaths),
    backgrounds: new IdMap(bundle.era.backgrounds),
    identities: new IdMap(bundle.era.identities),
    injuries: new IdMap(bundle.era.injuries),
  });
  registries.set(bundle, registry);
  return registry;
}
