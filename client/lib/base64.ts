/**
 * Kleine, abhängigkeitsfreie Base64-Helfer (React Native hat kein Buffer).
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + "==";
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + "=";
  }
  return out;
}

const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]] = i;
LOOKUP["-"] = 62;
LOOKUP["_"] = 63;

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/\-_]/g, "");
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean[i]] ?? 0;
    const b = LOOKUP[clean[i + 1]] ?? 0;
    const c = LOOKUP[clean[i + 2]] ?? 0;
    const d = LOOKUP[clean[i + 3]] ?? 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < len) out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length && o < len) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length && o < len) out[o++] = n & 255;
  }
  return out;
}

/** Ungefähre Byte-Größe eines Base64-Strings. */
export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/\s/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
}
