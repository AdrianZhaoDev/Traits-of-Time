/** UTF-8 conversion independent of DOM encoders, Node Buffer and mini-game host APIs. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

export function encodeUtf8(text: string): Uint8Array {
  const output = new Uint8Array(utf8Length(text));
  let offset = 0;
  for (let i = 0; i < text.length; i++) {
    let point = text.charCodeAt(i);
    if (point >= 0xd800 && point <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) { point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00; i++; }
    }
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    if (point < 0x80) output[offset++] = point;
    else if (point < 0x800) {
      output[offset++] = 0xc0 | (point >>> 6);
      output[offset++] = 0x80 | (point & 63);
    } else if (point < 0x10000) {
      output[offset++] = 0xe0 | (point >>> 12);
      output[offset++] = 0x80 | ((point >>> 6) & 63);
      output[offset++] = 0x80 | (point & 63);
    } else {
      output[offset++] = 0xf0 | (point >>> 18);
      output[offset++] = 0x80 | ((point >>> 12) & 63);
      output[offset++] = 0x80 | ((point >>> 6) & 63);
      output[offset++] = 0x80 | (point & 63);
    }
  }
  return output;
}

/** Reject malformed UTF-8 rather than silently replacing bytes in a damaged save. */
export function decodeUtf8(bytes: Uint8Array): string {
  const parts: string[] = [];
  const units: number[] = [];
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    let point: number;
    if (first < 0x80) point = first;
    else {
      const count = first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : 0;
      if (!count || i + count > bytes.length) throw new Error('Invalid UTF-8 in save');
      point = first & (count === 1 ? 31 : count === 2 ? 15 : 7);
      for (let n = 0; n < count; n++) {
        const next = bytes[i++];
        if ((next & 0xc0) !== 0x80) throw new Error('Invalid UTF-8 in save');
        point = (point << 6) | (next & 63);
      }
      if ((count === 1 && point < 0x80) || (count === 2 && point < 0x800) ||
          (count === 3 && point < 0x10000) || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
        throw new Error('Invalid UTF-8 in save');
      }
    }
    if (point < 0x10000) units.push(point);
    else {
      point -= 0x10000;
      units.push(0xd800 | (point >>> 10), 0xdc00 | (point & 1023));
    }
    if (units.length >= 8192) {
      parts.push(String.fromCharCode(...units));
      units.length = 0;
    }
  }
  if (units.length) parts.push(String.fromCharCode(...units));
  return parts.join('');
}
