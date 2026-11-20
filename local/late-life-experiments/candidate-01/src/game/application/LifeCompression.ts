import { deflateSync, Inflate } from 'fflate/browser';
import { deduplicateLife, restoreDeduplicatedLife } from './LifeDeduplication';
import { decodeUtf8, encodeUtf8 } from './LifeUtf8';

// Limits the maximum allocation for a damaged or deliberately oversized save.
// Normal life saves are substantially smaller; changing this is a format policy.
export const MAX_LIFE_JSON_BYTES = 32 * 1024 * 1024;
const MAX_DEFLATE_BYTES = MAX_LIFE_JSON_BYTES + Math.ceil(MAX_LIFE_JSON_BYTES / 100) + 1024;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) BASE64_VALUES[ALPHABET.charCodeAt(i)] = i;

function base64Encode(bytes: Uint8Array): string {
  const parts: string[] = [];
  // Multiples of three let each intermediate string end on a quartet boundary.
  const chunkSize = 12288;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, bytes.length);
    let part = '';
    for (let i = start; i < end; i += 3) {
      const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
      part += ALPHABET[a >>> 2] + ALPHABET[((a & 3) << 4) | (b >>> 4)]
        + (i + 1 < end ? ALPHABET[((b & 15) << 2) | (c >>> 6)] : '=')
        + (i + 2 < end ? ALPHABET[c & 63] : '=');
    }
    parts.push(part);
  }
  return parts.join('');
}

function base64Decode(text: string): Uint8Array {
  if (!text.length || text.length % 4 !== 0 || text.length > Math.ceil(MAX_DEFLATE_BYTES / 3) * 4) {
    throw new Error('Invalid compressed save length');
  }
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(text.length / 4 * 3 - padding);
  let output = 0;
  for (let i = 0; i < text.length; i += 4) {
    const final = i + 4 === text.length;
    const a = text.charCodeAt(i), b = text.charCodeAt(i + 1);
    const c = text.charCodeAt(i + 2), d = text.charCodeAt(i + 3);
    const x = a < 128 ? BASE64_VALUES[a] : -1, y = b < 128 ? BASE64_VALUES[b] : -1;
    const z = c < 128 ? BASE64_VALUES[c] : -1, w = d < 128 ? BASE64_VALUES[d] : -1;
    if (x < 0 || y < 0 || (z < 0 && !(final && padding === 2 && c === 61)) ||
        (w < 0 && !(final && padding > 0 && d === 61)) ||
        (final && padding === 2 && (y & 15) !== 0) || (final && padding === 1 && (z & 3) !== 0)) {
      throw new Error('Invalid compressed save encoding');
    }
    bytes[output++] = (x << 2) | (y >>> 4);
    if (output < bytes.length) bytes[output++] = (y << 4) | (z >>> 2);
    if (output < bytes.length) bytes[output++] = (z << 6) | w;
  }
  return bytes;
}

/** Deduplicates repeated JSON subtrees, then compresses UTF-8 with platform-independent DEFLATE. */
export function compressLife(value: unknown): { decoded_bytes: number; data: string } {
  const json = deduplicateLife(value, MAX_LIFE_JSON_BYTES);
  if (json.length > MAX_LIFE_JSON_BYTES) throw new Error('Current life exceeds the decoded save limit');
  const bytes = encodeUtf8(json);
  if (bytes.length > MAX_LIFE_JSON_BYTES) throw new Error('Current life exceeds the decoded save limit');
  return { decoded_bytes: bytes.length, data: base64Encode(deflateSync(bytes, { level: 6 })) };
}

/** Inflate incrementally so a forged length cannot cause an unbounded decompression allocation. */
export function decompressLife(data: string, decodedBytes: number): unknown {
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes < 1 || decodedBytes > MAX_LIFE_JSON_BYTES) {
    throw new Error('Invalid decoded save length');
  }
  const compressed = base64Decode(data);
  const bytes = new Uint8Array(decodedBytes);
  let offset = 0;
  const inflater = new Inflate((chunk) => {
    if (chunk.length > decodedBytes - offset) throw new Error('Decoded save exceeds its declared length');
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  // A small input chunk bounds the library's internal output buffer even for a compression bomb.
  const chunkSize = 1024;
  for (let start = 0; start < compressed.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, compressed.length);
    inflater.push(compressed.subarray(start, end), end === compressed.length);
  }
  if (offset !== decodedBytes) throw new Error('Decoded save length differs from its declaration');
  return restoreDeduplicatedLife(JSON.parse(decodeUtf8(bytes)), MAX_LIFE_JSON_BYTES);
}
