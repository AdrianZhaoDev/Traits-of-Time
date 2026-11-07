import { createHash } from 'node:crypto';
import { canonicalJson } from '../../assets/scripts/core/persistence/JsonDigest.js';

/** Hash a JSON value, not a pre-encoded string of JSON. */
export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
