import { GEOID_COLS, GEOID_GRID_B64, GEOID_ROWS, GEOID_STEP_DEG } from "./geoidGrid";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

let grid: Int16Array | null = null;

function decodeGrid(): Int16Array {
  const lookup = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const s = GEOID_GRID_B64.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = lookup[s.charCodeAt(i)];
    const b = lookup[s.charCodeAt(i + 1)];
    const c = i + 2 < s.length ? lookup[s.charCodeAt(i + 2)] : 0;
    const d = i + 3 < s.length ? lookup[s.charCodeAt(i + 3)] : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < bytes.length) bytes[o++] = (n >> 16) & 255;
    if (o < bytes.length) bytes[o++] = (n >> 8) & 255;
    if (o < bytes.length) bytes[o++] = n & 255;
  }
  const out = new Int16Array(GEOID_ROWS * GEOID_COLS);
  for (let i = 0; i < out.length; i++) {
    const v = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    out[i] = v >= 0x8000 ? v - 0x10000 : v;
  }
  return out;
}

function at(row: number, col: number): number {
  const g = (grid ??= decodeGrid());
  const r = Math.min(GEOID_ROWS - 1, Math.max(0, row));
  const c = ((col % GEOID_COLS) + GEOID_COLS) % GEOID_COLS;
  return g[r * GEOID_COLS + c] / 10;
}

/** Geoidundulation N in Metern (EGM96): MSL-Höhe = Ellipsoidhöhe − N. */
export function geoidUndulationM(lat: number, lon: number): number {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;
  const y = (90 - Math.min(90, Math.max(-90, lat))) / GEOID_STEP_DEG;
  const x = (((lon + 180) % 360) + 360) % 360 / GEOID_STEP_DEG;
  const r0 = Math.floor(y);
  const c0 = Math.floor(x);
  const fy = y - r0;
  const fx = x - c0;
  const top = at(r0, c0) * (1 - fx) + at(r0, c0 + 1) * fx;
  const bottom = at(r0 + 1, c0) * (1 - fx) + at(r0 + 1, c0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}
