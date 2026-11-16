/**
 * DJI-DUML-Protokoll (öffentlich dokumentiert in dji-firmware-tools).
 * Portiert aus der eigenständigen FCC-Tool-App (Kotlin) nach TypeScript.
 *
 * Rahmen:
 *  [0]     0x55
 *  [1..2]  Länge (10 Bit) | Version 1
 *  [3]     CRC-8 über Byte 0..2 (Start 0x77, Polynom 0x31 gespiegelt = 0x8C)
 *  [4]     Absender  (Bit 0..4 Gerätetyp, Bit 5..7 Index)
 *  [5]     Empfänger
 *  [6..7]  Sequenznummer, little-endian
 *  [8]     Befehlstyp
 *  [9]     cmdSet
 *  [10]    cmdId
 *  [11..]  Nutzdaten
 *  [n-2..] CRC-16 über alles davor (Start 0x3692, Polynom 0x1021 gespiegelt = 0x8408), little-endian
 */

const DEVICE_NAMES = [
  "ANY", "CAMERA", "MOBILE_APP", "FLYCONTROLLER", "GIMBAL", "CENTER_BOARD", "REMOTE_RADIO",
  "WIFI", "LB_DM3XX_SKY", "LB_MCU_SKY", "PC", "BATTERY", "ESC", "DM368_GROUND", "OFDM_GROUND",
  "LB_68013_SKY", "SER_68013_GROUND", "MVO", "SVO", "LB_FPGA_SKY", "FPGA_GROUND", "FPGA_SIM",
  "STATION", "XU", "WTF", "IMU", "GPS", "WIFI_GROUND", "SIG_CVT", "PMU", "UNKNOWN30", "WM330_OR_WM220",
];

export function crc8(data: Uint8Array, len: number = data.length): number {
  let crc = 0x77;
  for (let i = 0; i < len; i++) {
    crc ^= data[i];
    for (let b = 0; b < 8; b++) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0x8c : crc >>> 1;
  }
  return crc & 0xff;
}

export function crc16(data: Uint8Array, len: number = data.length): number {
  let crc = 0x3692;
  for (let i = 0; i < len; i++) {
    crc ^= data[i];
    for (let b = 0; b < 8; b++) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc & 0xffff;
}

let seq = 0x95;
export function nextSeq(): number {
  const s = seq & 0xffff;
  seq = (seq + 1) & 0xffff;
  return s;
}

export function buildFrame(
  sender: number,
  receiver: number,
  cmdType: number,
  cmdSet: number,
  cmdId: number,
  payload: Uint8Array = new Uint8Array(0),
  sequence: number = nextSeq(),
): Uint8Array {
  const len = 13 + payload.length;
  if (len >= 0x400) throw new Error("Nutzdaten zu lang");
  const f = new Uint8Array(len);
  f[0] = 0x55;
  f[1] = len & 0xff;
  f[2] = ((len >> 8) & 0x03) | 0x04;
  f[3] = crc8(f, 3);
  f[4] = sender & 0xff;
  f[5] = receiver & 0xff;
  f[6] = sequence & 0xff;
  f[7] = (sequence >> 8) & 0xff;
  f[8] = cmdType & 0xff;
  f[9] = cmdSet & 0xff;
  f[10] = cmdId & 0xff;
  f.set(payload, 11);
  const c = crc16(f, len - 2);
  f[len - 2] = c & 0xff;
  f[len - 1] = (c >> 8) & 0xff;
  return f;
}

export interface Frame {
  raw: Uint8Array;
  sender: number;
  receiver: number;
  seq: number;
  cmdType: number;
  cmdSet: number;
  cmdId: number;
  payload: Uint8Array;
  isResponse: boolean;
}

export function deviceName(b: number): string {
  return `${DEVICE_NAMES[b & 0x1f]}#${(b >> 5) & 7}(0x${(b & 0xff).toString(16).padStart(2, "0")})`;
}

export function describeFrame(f: Frame): string {
  const p = f.payload;
  const ascii = Array.from(p)
    .map((c) => (c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : "."))
    .join("")
    .replace(/\.+$/, "");
  return (
    `${f.isResponse ? "ANTWORT" : "ANFRAGE"} von ${deviceName(f.sender)} an ${deviceName(f.receiver)} ` +
    `seq=${f.seq} set=0x${f.cmdSet.toString(16).padStart(2, "0")} id=0x${f.cmdId
      .toString(16)
      .padStart(2, "0")} typ=0x${f.cmdType.toString(16).padStart(2, "0")}  daten=${toHex(p)}` +
    (ascii ? `  "${ascii}"` : "")
  );
}

/** Sammelt gültige Rahmen aus einem Bytestrom; unvollständige Reste bleiben gepuffert. */
export class FrameParser {
  private buf = new Uint8Array(0);

  feed(data: Uint8Array, n: number = data.length): Frame[] {
    const merged = new Uint8Array(this.buf.length + n);
    merged.set(this.buf, 0);
    merged.set(data.subarray(0, n), this.buf.length);
    this.buf = merged;

    const out: Frame[] = [];
    let i = 0;
    while (i + 4 <= this.buf.length) {
      if (this.buf[i] !== 0x55) { i++; continue; }
      const hdr = this.buf.subarray(i, i + 3);
      if (crc8(hdr) !== this.buf[i + 3]) { i++; continue; }
      const len = this.buf[i + 1] | ((this.buf[i + 2] & 0x03) << 8);
      if (len < 13) { i++; continue; }
      if (i + len > this.buf.length) break;
      const raw = this.buf.slice(i, i + len);
      const got = raw[len - 2] | (raw[len - 1] << 8);
      if (crc16(raw, len - 2) === got) {
        out.push(parseFrame(raw));
        i += len;
      } else {
        i++;
      }
    }
    this.buf = this.buf.slice(i);
    return out;
  }
}

function parseFrame(raw: Uint8Array): Frame {
  const cmdType = raw[8];
  return {
    raw,
    sender: raw[4],
    receiver: raw[5],
    seq: raw[6] | (raw[7] << 8),
    cmdType,
    cmdSet: raw[9],
    cmdId: raw[10],
    payload: raw.slice(11, raw.length - 2),
    isResponse: (cmdType & 0x80) !== 0,
  };
}

export function toHex(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i++) s += data[i].toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const s = hex.replace(/\s+/g, "");
  if (s.length % 2 !== 0) throw new Error("ungerade Hex-Länge");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
