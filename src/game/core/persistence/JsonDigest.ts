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

const SHA256_ROUND = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function compressSha256(words: Uint32Array, hash: Uint32Array): void {
  for (let i = 16; i < 64; i++) {
    const x = words[i - 15], y = words[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
  }
  let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
  let e = hash[4], f = hash[5], g = hash[6], h = hash[7];
  for (let i = 0; i < 64; i++) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + s1 + ((e & f) ^ (~e & g)) + SHA256_ROUND[i] + words[i]) >>> 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0;
    d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
  hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
  hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
  hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
}

/** The CLI's canonical JSON/SHA-256 contract, without Node or DOM dependencies. */
export function sha256Json(value: unknown): string {
  const text = canonicalJson(value);
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  let used = 0, byteLength = 0;
  // Stream UTF-8 into one SHA block instead of copying a potentially large save.
  const append = (byte: number): void => {
    words[used >>> 2] |= byte << (24 - (used & 3) * 8);
    used++;
    byteLength++;
    if (used === 64) {
      compressSha256(words, hash);
      words.fill(0, 0, 16);
      used = 0;
    }
  };
  for (let i = 0; i < text.length; i++) {
    let point = text.charCodeAt(i);
    if (point >= 0xd800 && point <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00;
        i++;
      }
    }
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    if (point < 0x80) append(point);
    else if (point < 0x800) {
      append(0xc0 | (point >>> 6)); append(0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      append(0xe0 | (point >>> 12)); append(0x80 | ((point >>> 6) & 0x3f)); append(0x80 | (point & 0x3f));
    } else {
      append(0xf0 | (point >>> 18)); append(0x80 | ((point >>> 12) & 0x3f));
      append(0x80 | ((point >>> 6) & 0x3f)); append(0x80 | (point & 0x3f));
    }
  }
  const highBits = Math.floor(byteLength / 0x20000000), lowBits = (byteLength * 8) >>> 0;
  append(0x80);
  while (used !== 56) append(0);
  words[14] = highBits;
  words[15] = lowBits;
  compressSha256(words, hash);
  let result = '';
  for (const word of hash) result += word.toString(16).padStart(8, '0');
  return result;
}
