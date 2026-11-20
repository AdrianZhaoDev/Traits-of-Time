import { utf8Length } from './LifeUtf8';

// A post-order table of unique JSON subtrees removes repeated command snapshots before
// DEFLATE. Child arrays of the form [index] are references; ordinary arrays are table nodes.
// Expansion creates fresh objects for every reference, exactly as a JSON parse would.

type JsonAtom = string | number | boolean | null;
type Token = JsonAtom | [number];

/** Encode only JSON data; reject the same lossy values that canonicalJson rejects. */
export function deduplicateLife(value: unknown, maxBytes: number): string {
  const nodes: string[] = [];
  const interned = new Map<string, number>();
  const ancestors = new Set<object>();
  let expandedBytes = 0;
  const addBytes = (count: number) => {
    expandedBytes += count;
    if (expandedBytes > maxBytes) throw new Error('Current life exceeds the expanded save limit');
  };
  function encode(item: unknown): string {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number') {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('Save requires finite numbers');
      const encoded = JSON.stringify(item);
      addBytes(utf8Length(encoded));
      return encoded;
    }
    if (typeof item !== 'object') throw new TypeError('Save accepts JSON values only');
    if (ancestors.has(item)) throw new TypeError('Save rejects cyclic objects');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError('Save requires plain objects');
    }
    ancestors.add(item);
    const parts = [Array.isArray(item) ? '0' : '1'];
    if (Array.isArray(item)) {
      addBytes(2 + Math.max(0, item.length - 1));
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor || !('value' in descriptor)) throw new TypeError('Save rejects array holes and accessors');
        parts.push(encode(descriptor.value));
      }
    } else {
      const keys = Reflect.ownKeys(item);
      if (keys.some(key => typeof key !== 'string')) throw new TypeError('Save rejects symbol keys');
      const strings = (keys as string[]).sort();
      addBytes(2 + Math.max(0, strings.length - 1) + strings.length);
      for (const key of strings) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Save rejects hidden fields and accessors');
        const encodedKey = JSON.stringify(key);
        addBytes(utf8Length(encodedKey));
        parts.push(encodedKey, encode(descriptor.value));
      }
    }
    ancestors.delete(item);
    const node = `[${parts.join(',')}]`;
    let index = interned.get(node);
    if (index === undefined) {
      index = nodes.length;
      interned.set(node, index);
      nodes.push(node);
    }
    return `[${index}]`;
  }
  const root = encode(value);
  return `[${root},[${nodes.join(',')}]]`;
}

/** Validate the post-order table and its fully expanded size before materializing a JSON tree. */
export function restoreDeduplicatedLife(data: unknown, maxBytes: number): unknown {
  if (!Array.isArray(data) || data.length !== 2 || !Array.isArray(data[1])) throw new Error('Invalid deduplicated save');
  const [root, nodes] = data as [unknown, unknown[]];
  const sizes: number[] = [];
  const tokenSize = (token: unknown, before: number): number => {
    if (Array.isArray(token)) {
      if (token.length !== 1 || !Number.isSafeInteger(token[0]) || token[0] < 0 || token[0] >= before) throw new Error('Invalid save reference');
      return sizes[token[0]];
    }
    if (token !== null && typeof token !== 'string' && typeof token !== 'number' && typeof token !== 'boolean') throw new Error('Invalid save value');
    if (typeof token === 'number' && !Number.isFinite(token)) throw new Error('Invalid save number');
    return utf8Length(JSON.stringify(token));
  };
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!Array.isArray(node) || (node[0] !== 0 && node[0] !== 1)) throw new Error('Invalid save node');
    const isObject = node[0] === 1;
    if (isObject && node.length % 2 !== 1) throw new Error('Invalid save object');
    const count = isObject ? (node.length - 1) / 2 : node.length - 1;
    let size = 2 + Math.max(0, count - 1) + (isObject ? count : 0);
    const keys = isObject ? new Set<string>() : null;
    for (let j = 1; j < node.length; j += isObject ? 2 : 1) {
      if (keys) {
        const key = node[j];
        if (typeof key !== 'string' || keys.has(key)) throw new Error('Invalid save key');
        keys.add(key);
        size += utf8Length(JSON.stringify(key));
      }
      size += tokenSize(node[j + (isObject ? 1 : 0)], i);
      if (size > maxBytes) throw new Error('Expanded save exceeds its limit');
    }
    sizes.push(size);
  }
  if (tokenSize(root, nodes.length) > maxBytes) throw new Error('Expanded save exceeds its limit');
  function expand(token: Token): unknown {
    if (!Array.isArray(token)) return token;
    const node = nodes[token[0]] as unknown[];
    if (node[0] === 0) return node.slice(1).map(child => expand(child as Token));
    const object: Record<string, unknown> = {};
    for (let i = 1; i < node.length; i += 2) {
      const key = node[i] as string;
      const value = expand(node[i + 1] as Token);
      if (key === '__proto__') Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
      else object[key] = value;
    }
    return object;
  }
  return expand(root as Token);
}
