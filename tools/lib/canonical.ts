import { createHash } from 'node:crypto';

/** Canonical JSON: Unicode-code-unit key order, array order preserved, no lossy coercion. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('Canonical JSON requires finite numbers');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new TypeError('Canonical JSON accepts JSON values only');
    if (ancestors.has(item)) throw new TypeError('Canonical JSON rejects cyclic objects');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError('Canonical JSON requires plain objects');
    }
    ancestors.add(item);
    let result: string;
    if (Array.isArray(item)) {
      const encoded: string[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !('value' in descriptor)) throw new TypeError('Canonical JSON rejects array holes and accessors');
        encoded.push(encode(descriptor.value));
      }
      result = `[${encoded.join(',')}]`;
    } else {
      const keys = Reflect.ownKeys(item);
      if (keys.some((key) => typeof key !== 'string')) throw new TypeError('Canonical JSON rejects symbol keys');
      result = `{${(keys as string[]).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Canonical JSON rejects hidden fields and accessors');
        return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
      }).join(',')}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return encode(value);
}

/** Hash a JSON value, not a pre-encoded string of JSON. */
export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
