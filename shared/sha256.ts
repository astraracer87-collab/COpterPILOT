// Kleines, abhängigkeitsfreies SHA-256 (FIPS 180-4) – inkrementell
// (update/digest), damit große Dateien (NATS-AIXM ≈ 12 MB) stückweise mit
// Pausen für den JS-Thread geprüft werden können.
//
// Warum nicht expo-crypto: `digest()` ist nativ (unter tsx/Node nicht testbar)
// und nicht inkrementell; `digestStringAsync` arbeitet nur auf Strings. Diese
// Fassung läuft identisch in Hermes, im Browser und in Node.
//
// Bewusst frei von React-Native-Importen.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Inkrementeller SHA-256-Hasher. */
export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private w = new Uint32Array(64);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private total = 0;
  private done = false;

  update(data: Uint8Array): this {
    if (this.done) throw new Error("SHA-256: digest() bereits aufgerufen");
    let i = 0;
    const n = data.length;
    this.total += n;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, n);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      i = take;
      if (this.bufLen === 64) {
        this.block(this.buf, 0);
        this.bufLen = 0;
      }
    }
    for (; i + 64 <= n; i += 64) this.block(data, i);
    if (i < n) {
      this.buf.set(data.subarray(i), 0);
      this.bufLen = n - i;
    }
    return this;
  }

  /** Hash als Bytes (32). Danach ist der Hasher verbraucht. */
  digest(): Uint8Array {
    if (!this.done) {
      this.done = true;
      const bits = this.total * 8;
      const pad = new Uint8Array(this.bufLen < 56 ? 64 : 128);
      pad.set(this.buf.subarray(0, this.bufLen));
      pad[this.bufLen] = 0x80;
      const hi = Math.floor(bits / 0x100000000);
      const lo = bits >>> 0;
      const L = pad.length;
      pad[L - 8] = hi >>> 24;
      pad[L - 7] = hi >>> 16;
      pad[L - 6] = hi >>> 8;
      pad[L - 5] = hi;
      pad[L - 4] = lo >>> 24;
      pad[L - 3] = lo >>> 16;
      pad[L - 2] = lo >>> 8;
      pad[L - 1] = lo;
      for (let o = 0; o < L; o += 64) this.block(pad, o);
    }
    const out = new Uint8Array(32);
    for (let k = 0; k < 8; k++) {
      out[k * 4] = this.h[k] >>> 24;
      out[k * 4 + 1] = this.h[k] >>> 16;
      out[k * 4 + 2] = this.h[k] >>> 8;
      out[k * 4 + 3] = this.h[k];
    }
    return out;
  }

  /** Hash als Kleinbuchstaben-Hex (64 Zeichen). */
  digestHex(): string {
    const d = this.digest();
    let s = "";
    for (let k = 0; k < d.length; k++) s += (d[k] < 16 ? "0" : "") + d[k].toString(16);
    return s;
  }

  private block(p: Uint8Array, o: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t++) {
      const j = o + t * 4;
      w[t] = (p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    const h = this.h;
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
}

/** SHA-256 eines Puffers als Hex. */
export function sha256Hex(data: Uint8Array): string {
  return new Sha256().update(data).digestHex();
}

/**
 * Erwarteten Hash aus einer `.sha256`-Datei lesen ("<hex> *datei.xml",
 * "<hex>  datei" oder nur "<hex>"). null, wenn kein 64-stelliger Hex-Wert.
 */
export function parseSha256File(text: string): { hash: string; fileName?: string } | null {
  const m = String(text ?? "").match(/\b([0-9a-fA-F]{64})\b(?:\s+\*?([^\r\n]+))?/);
  if (!m) return null;
  return { hash: m[1].toLowerCase(), ...(m[2] ? { fileName: m[2].trim() } : {}) };
}
