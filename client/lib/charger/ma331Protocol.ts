/**
 * ISDT MA331 (und verwandte Ladegeräte MC234 / AC341) – BLE-Protokoll, NUR LESEN.
 *
 * Eigene Implementierung nach unserer Protokoll-Beschreibung
 * docs/isdt-ma331-protokoll.md (Interoperabilität, kein ISDT-Code).
 *
 * Reines TypeScript ohne React-Native-Importe (mit tsx testbar).
 *
 * Sicherheit: Dieses Modul baut ausschließlich lesende Anfragen
 * (Status `12 C2`, Einstellungen lesen `12 C6`, Hardware-Info `E0`) und den
 * Kopplungs-Frame `18 …`. Schreibende Befehle (`12 C4` Einstellungen,
 * `12 C0` Umbenennen) gibt es hier bewusst NICHT; `isAllowedRequest` lehnt sie
 * ab und der Transport sendet nur, was diese Prüfung besteht.
 */

// ── GATT ───────────────────────────────────────────────────────────────────
export const ISDT_SERVICE_UUID = "0000af00-0000-1000-8000-00805f9b34fb";
/** Daten/Polling (Notify + Write Without Response) */
export const ISDT_CHAR_DATA_UUID = "0000af01-0000-1000-8000-00805f9b34fb";
/** Kopplung + Hardware-Info (Notify + Write Without Response) */
export const ISDT_CHAR_BIND_UUID = "0000af02-0000-1000-8000-00805f9b34fb";
export const ISDT_REQUESTED_MTU = 240;

// ── Erkennung (Herstellerdaten) ────────────────────────────────────────────
/** Company-ID 0xABBA (LE im Advertisement: BA AB) */
export const ISDT_COMPANY_ID = 0xabba;
/** Kennung direkt nach der Company-ID */
export const ISDT_MAGIC = [0xaf, 0xfa] as const;

export type IsdtModelKind = "MA331" | "MC234" | "AC341";

export interface IsdtModelInfo {
  modelId: string;
  name: string;
  /** Familie mit eigenem Status-Layout; null = nicht unterstützt */
  kind: IsdtModelKind | null;
  /** Bootloader/OTA-Modus (Präfix 81…): NICHT verbinden */
  bootloader: boolean;
}

const MODEL_NAMES: Record<
  string,
  { name: string; kind: IsdtModelKind | null }
> = {
  "01400000": { name: "MA331", kind: "MA331" },
  "01400100": { name: "NP2Go", kind: null },
  "01400200": { name: "ActionGo", kind: null },
  "01400300": { name: "MC234AC", kind: "MC234" },
  "01400301": { name: "BC237AC", kind: "MC234" },
  "01400400": { name: "UC342", kind: null },
  "01400401": { name: "UC342", kind: null },
  "01400500": { name: "AC341", kind: "AC341" },
  "01400600": { name: "NeoGo", kind: null },
};

export const MA331_MODEL_ID = "01400000";
export const MA331_BOOTLOADER_MODEL_ID = "81400000";

export function modelInfo(modelId: string): IsdtModelInfo {
  const id = modelId.toLowerCase();
  const bootloader = id.startsWith("81");
  const normal = bootloader ? `01${id.slice(2)}` : id;
  const known = MODEL_NAMES[normal];
  return {
    modelId: id,
    name: known?.name ?? `ISDT ${id}`,
    kind: known?.kind ?? null,
    bootloader,
  };
}

export interface IsdtAdvertisement {
  modelId: string;
  model: IsdtModelInfo;
  /** Benutzername aus dem Advertisement (getrimmt), falls vorhanden */
  userName: string | null;
}

/**
 * Herstellerdaten NACH der Company-ID (also beginnend mit `AF FA`) auswerten.
 * null = kein ISDT-Ladegerät.
 */
export function parseIsdtManufacturerPayload(
  payload: ArrayLike<number> | null | undefined,
): IsdtAdvertisement | null {
  if (!payload || payload.length < 6) return null;
  if (
    (payload[0] & 0xff) !== ISDT_MAGIC[0] ||
    (payload[1] & 0xff) !== ISDT_MAGIC[1]
  )
    return null;
  const modelId = toHex([payload[2], payload[3], payload[4], payload[5]], "");
  let userName: string | null = null;
  if (payload.length >= 20) {
    const chars: string[] = [];
    for (let i = 6; i < 20; i++) {
      const c = payload[i] & 0xff;
      chars.push(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : " ");
    }
    userName = chars.join("").trim() || null;
  }
  return { modelId, model: modelInfo(modelId), userName };
}

/**
 * Rohe Advertising-Bytes (AD-Strukturen: Länge, Typ, Daten …) nach
 * Herstellerdaten (Typ 0xFF) mit Company-ID 0xABBA durchsuchen und den Teil
 * nach der Company-ID zurückgeben.
 */
export function findIsdtPayloadInRawAdvertising(
  raw: ArrayLike<number> | null | undefined,
): number[] | null {
  if (!raw) return null;
  let i = 0;
  while (i < raw.length) {
    const len = raw[i] & 0xff;
    if (len === 0) break;
    const end = i + 1 + len;
    if (end > raw.length) break;
    const type = raw[i + 1] & 0xff;
    if (type === 0xff && len >= 3) {
      const company = (raw[i + 2] & 0xff) | ((raw[i + 3] & 0xff) << 8);
      if (company === ISDT_COMPANY_ID)
        return Array.from({ length: len - 3 }, (_, k) => raw[i + 4 + k] & 0xff);
    }
    i = end;
  }
  return null;
}

/**
 * Manufacturer-Payload aus einem Scan-Ergebnis von react-native-ble-manager
 * (oder ähnlich) holen. Akzeptiert `manufacturerData` (Schlüssel = Company-ID
 * hex, Groß/Klein egal), `manufacturerRawData` (Company-ID LE + Daten) und
 * `rawData` (AD-Strukturen).
 */
export function extractIsdtPayload(
  adv:
    | {
        manufacturerData?: Record<string, { bytes?: number[] } | undefined>;
        manufacturerRawData?: { bytes?: number[] };
        rawData?: { bytes?: number[] };
      }
    | null
    | undefined,
): number[] | null {
  if (!adv) return null;
  const md = adv.manufacturerData;
  if (md) {
    for (const [k, v] of Object.entries(md)) {
      const key = k.toLowerCase().replace(/^0x/, "");
      if (
        (key === "abba" || parseInt(key, 16) === ISDT_COMPANY_ID) &&
        v?.bytes?.length
      )
        return v.bytes.map((b) => b & 0xff);
    }
  }
  const mr = adv.manufacturerRawData?.bytes;
  if (
    mr &&
    mr.length >= 4 &&
    ((mr[0] & 0xff) | ((mr[1] & 0xff) << 8)) === ISDT_COMPANY_ID
  )
    return mr.slice(2).map((b) => b & 0xff);
  return findIsdtPayloadInRawAdvertising(adv.rawData?.bytes);
}

/** Scan-Filter (Android ScanFilter): Company 0xABBA, Payload beginnt mit AF FA. */
export const ISDT_SCAN_FILTER = {
  manufacturerId: ISDT_COMPANY_ID,
  manufacturerData: [ISDT_MAGIC[0], ISDT_MAGIC[1]],
  manufacturerDataMask: [0xff, 0xff],
};

// ── Anfragen ───────────────────────────────────────────────────────────────
export const REQ_STATUS: readonly number[] = [0x12, 0xc2];
export const REQ_SETTINGS_READ: readonly number[] = [0x12, 0xc6];
export const REQ_HARDWARE_INFO: readonly number[] = [0xe0];

export type BindMode = 0 | 1;

/** App-ID: 32 Hex-Zeichen (16 Byte), wird pro Ladegerät zufällig erzeugt */
export function normalizeAppId(hex: string): string | null {
  const h = hex.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  return h.length === 32 ? h : null;
}

export function appIdFromBytes(bytes: ArrayLike<number>): string {
  if (bytes.length < 16) throw new Error("App-ID braucht 16 Byte");
  const b = Array.from({ length: 16 }, (_, i) => bytes[i] & 0xff);
  // wie eine UUIDv4 kennzeichnen (Version 4, Variante 10xx)
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return toHex(b, "");
}

/** Kopplungs-Frame (19 Byte): 0x18, 16 Byte App-ID, 0x00, Modus */
export function buildBindRequest(appIdHex: string, mode: BindMode): number[] {
  const id = normalizeAppId(appIdHex);
  if (!id) throw new Error("Ungültige App-ID");
  const out = [0x18];
  for (let i = 0; i < 32; i += 2) out.push(parseInt(id.slice(i, i + 2), 16));
  out.push(0x00, mode);
  return out;
}

/**
 * Nur diese Anfragen dürfen den Transport verlassen (v1 nur lesen):
 * Status, Einstellungen LESEN, Hardware-Info, Kopplung.
 */
export function isAllowedRequest(frame: ArrayLike<number>): boolean {
  if (!frame || frame.length === 0) return false;
  const a = frame[0] & 0xff;
  if (a === 0xe0) return frame.length === 1;
  if (a === 0x18)
    return (
      frame.length === 19 &&
      (frame[18] === 0 || frame[18] === 1) &&
      frame[17] === 0
    );
  if (a === 0x12 && frame.length === 2) {
    const b = frame[1] & 0xff;
    return b === 0xc2 || b === 0xc6;
  }
  return false;
}

// ── Antworten ──────────────────────────────────────────────────────────────
export type BindResult = { kind: "bound" } | { kind: "rejected"; code: number };

export function parseBindResponse(f: ArrayLike<number>): BindResult | null {
  if (!f || f.length < 2 || (f[0] & 0xff) !== 0x19) return null;
  const code = f[1] & 0xff;
  return code === 0 ? { kind: "bound" } : { kind: "rejected", code };
}

/** `xx FF` → Gerät meldet „Kopplung abgelaufen, neu binden“. */
export function isBindingExpiredResponse(f: ArrayLike<number>): boolean {
  return !!f && f.length === 2 && (f[1] & 0xff) === 0xff;
}

export interface IsdtHardwareInfo {
  bleHw: [number, number];
  bleFw: [number, number];
  /** Geräte-ID des Ladegeräts, 8 Byte roh als Hex ("" wenn zu kurz) */
  deviceIdHex: string;
  mcuHw?: [number, number];
  mcuFw?: [number, number];
  /** Anzeige wie Polying: b1.b2.b3.b4 */
  firmwareLabel: string;
}

/** Hardware-Info: `E1 …` (optional mit vorangestelltem `31`). */
export function parseHardwareInfo(
  input: ArrayLike<number>,
): IsdtHardwareInfo | null {
  if (!input || input.length < 5) return null;
  let f = Array.from(input as ArrayLike<number>, (x) => x & 0xff);
  if (f[0] === 0x31 && f[1] === 0xe1) f = f.slice(1);
  if (f[0] !== 0xe1 || f.length < 5) return null;
  const info: IsdtHardwareInfo = {
    bleHw: [f[1], f[2]],
    bleFw: [f[3], f[4]],
    deviceIdHex: f.length >= 13 ? toHex(f.slice(5, 13), "") : "",
    firmwareLabel: `${f[1]}.${f[2]}.${f[3]}.${f[4]}`,
  };
  if (f.length >= 17) {
    info.mcuHw = [f[13], f[14]];
    info.mcuFw = [f[15], f[16]];
  }
  return info;
}

/** Betriebsmodus des Hubs (Status Offset 2, Einstellung d6) */
export enum IsdtHubMode {
  Charge = 0,
  Output = 1,
  Gather = 2,
  Balance = 3,
}

export enum IsdtSlotState {
  Empty = 0,
  Standby = 1,
  Charging = 2,
  Full = 3,
  Discharging = 4,
  DischargingAlt = 5,
  Error = 6,
  OverTemp = 7,
  UnderTemp = 8,
}

export interface IsdtUsbPort {
  index: number;
  state: number;
  voltageV: number;
  powerW: number;
}

export interface IsdtProductionDate {
  year: number;
  month: number;
  day: number;
}

export interface IsdtSlot {
  index: number;
  state: number;
  /** Detailwerte gültig (Status ≠ 0 und ≠ 6) */
  hasData: boolean;
  socPercent: number;
  timeMinutes: number;
  remainingMah: number;
  temperatureC: number;
  currentA: number;
  powerW: number;
  cycleCount: number;
  productionDate: IsdtProductionDate;
  cellMillivolts: number[];
  /** Summe der Zellen in V (abgeleitet) */
  packVoltageV: number;
  /** Rohbytes dieses Schachts (Hex) – zum Prüfen unbekannter Felder */
  rawHex: string;
}

export interface IsdtStatus {
  model: IsdtModelKind;
  /** null bei Modellen ohne Modus-Byte (MC234) */
  mode: number | null;
  usb: IsdtUsbPort[];
  slots: IsdtSlot[];
  /** Bytes nach dem bekannten Layout (Hex), z. B. eine mögliche Akku-SN */
  extraHex: string;
  frameLength: number;
}

export type StatusParseResult =
  | { ok: true; status: IsdtStatus }
  | { ok: false; error: string };

const u16 = (f: ArrayLike<number>, o: number) =>
  (f[o] & 0xff) | ((f[o + 1] & 0xff) << 8);

export const MA331_STATUS_LENGTH = 90;
const MA331_SLOT_BASE = 18;
const MA331_SLOT_SIZE = 24;

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Gemeinsamer 16-Byte-Kopf eines Schachts (MA331/AC341 identisch) */
function readSlotHead(
  f: ArrayLike<number>,
  b: number,
  index: number,
  cells: number[],
  rawEnd: number,
): IsdtSlot {
  const state = f[b] & 0xff;
  const sum = cells.reduce((a, c) => a + c, 0);
  return {
    index,
    state,
    hasData: state !== IsdtSlotState.Empty && state !== IsdtSlotState.Error,
    socPercent: f[b + 1] & 0xff,
    timeMinutes: u16(f, b + 2),
    remainingMah: u16(f, b + 4),
    temperatureC: f[b + 6] & 0xff,
    currentA: round1(u16(f, b + 7) / 10),
    powerW: round1(u16(f, b + 9) / 10),
    cycleCount: u16(f, b + 11),
    productionDate: {
      year: 2000 + (f[b + 13] & 0xff),
      month: f[b + 14] & 0xff,
      day: f[b + 15] & 0xff,
    },
    cellMillivolts: cells,
    packVoltageV: Math.round(sum) / 1000,
    rawHex: toHex(sliceArr(f, b, rawEnd), " "),
  };
}

function readUsb(f: ArrayLike<number>, o: number, index: number): IsdtUsbPort {
  return {
    index,
    state: f[o] & 0xff,
    voltageV: round1(u16(f, o + 1) / 10),
    powerW: round1(u16(f, o + 3) / 10),
  };
}

function checkHeader(f: ArrayLike<number>): string | null {
  if (!f || f.length < 2) return "Frame zu kurz";
  if ((f[0] & 0xff) !== 0x31 || (f[1] & 0xff) !== 0xc3)
    return `Kein Status-Frame (${toHex(sliceArr(f, 0, 2), " ")})`;
  return null;
}

/** MA331: 90 Byte, Modus, 3 USB-Ports, 3 Schächte à 24 Byte (4 Zellen). */
export function parseMa331Status(f: ArrayLike<number>): StatusParseResult {
  const err = checkHeader(f);
  if (err) return { ok: false, error: err };
  if (f.length < MA331_STATUS_LENGTH)
    return {
      ok: false,
      error: `Status-Frame zu kurz (${f.length} statt ${MA331_STATUS_LENGTH} Byte)`,
    };
  const usb = [0, 1, 2].map((p) => readUsb(f, 3 + 5 * p, p));
  const slots = [0, 1, 2].map((s) => {
    const b = MA331_SLOT_BASE + MA331_SLOT_SIZE * s;
    const cells = [0, 1, 2, 3].map((c) => u16(f, b + 16 + 2 * c));
    return readSlotHead(f, b, s, cells, b + MA331_SLOT_SIZE);
  });
  return {
    ok: true,
    status: {
      model: "MA331",
      mode: f[2] & 0xff,
      usb,
      slots,
      extraHex: toHex(sliceArr(f, MA331_STATUS_LENGTH, f.length), " "),
      frameLength: f.length,
    },
  };
}

/** MC234/BC237: kein Modus-Byte, 1 USB-Port ab 2, 2 Schächte à 20 Byte (2 Zellen). */
export function parseMc234Status(f: ArrayLike<number>): StatusParseResult {
  const err = checkHeader(f);
  if (err) return { ok: false, error: err };
  const need = 2 + 5 + 2 * 20;
  if (f.length < need)
    return {
      ok: false,
      error: `Status-Frame zu kurz (${f.length} statt ${need} Byte)`,
    };
  const usb = [readUsb(f, 2, 0)];
  const slots = [0, 1].map((s) => {
    const b = 7 + 20 * s;
    const cells = [0, 1].map((c) => u16(f, b + 16 + 2 * c));
    return readSlotHead(f, b, s, cells, b + 20);
  });
  return {
    ok: true,
    status: {
      model: "MC234",
      mode: null,
      usb,
      slots,
      extraHex: toHex(sliceArr(f, need, f.length), " "),
      frameLength: f.length,
    },
  };
}

/** AC341: selbstbeschreibend (Anzahl Ports, Anzahl Schächte, Zellenzahl je Schacht). */
export function parseAc341Status(f: ArrayLike<number>): StatusParseResult {
  const err = checkHeader(f);
  if (err) return { ok: false, error: err };
  if (f.length < 3) return { ok: false, error: "Status-Frame zu kurz" };
  let o = 2;
  const nUsb = f[o++] & 0xff;
  if (nUsb > 8 || o + 5 * nUsb + 1 > f.length)
    return { ok: false, error: "AC341: USB-Block unvollständig" };
  const usb: IsdtUsbPort[] = [];
  for (let p = 0; p < nUsb; p++, o += 5) usb.push(readUsb(f, o, p));
  const nSlots = f[o++] & 0xff;
  if (nSlots > 8) return { ok: false, error: "AC341: unplausible Schachtzahl" };
  const slots: IsdtSlot[] = [];
  for (let s = 0; s < nSlots; s++) {
    if (o + 17 > f.length)
      return { ok: false, error: `AC341: Schacht ${s + 1} unvollständig` };
    const b = o;
    const n = f[b + 16] & 0xff;
    if (n > 16 || b + 17 + 2 * n > f.length)
      return {
        ok: false,
        error: `AC341: Zellen von Schacht ${s + 1} unvollständig`,
      };
    const cells = Array.from({ length: n }, (_, c) => u16(f, b + 17 + 2 * c));
    o = b + 17 + 2 * n;
    slots.push(readSlotHead(f, b, s, cells, o));
  }
  return {
    ok: true,
    status: {
      model: "AC341",
      mode: null,
      usb,
      slots,
      extraHex: toHex(sliceArr(f, o, f.length), " "),
      frameLength: f.length,
    },
  };
}

export function parseStatus(
  f: ArrayLike<number>,
  kind: IsdtModelKind = "MA331",
): StatusParseResult {
  try {
    if (kind === "MC234") return parseMc234Status(f);
    if (kind === "AC341") return parseAc341Status(f);
    return parseMa331Status(f);
  } catch (e) {
    return { ok: false, error: `Parserfehler: ${(e as Error)?.message ?? e}` };
  }
}

export interface IsdtSettings {
  /** 0 = 60 %, 1 = 100 %, 2 = schnell 95 %, 3 = schnell 99 % */
  chargeTarget: number;
  dischargeToZero: boolean;
  alarm: boolean;
  lamp: boolean;
  mute: boolean;
  screenAutoOff: boolean;
  mode: number;
}

/** Einstellungen lesen: `31 C7 d0..d6` */
export function parseSettings(f: ArrayLike<number>): IsdtSettings | null {
  if (!f || f.length < 9 || (f[0] & 0xff) !== 0x31 || (f[1] & 0xff) !== 0xc7)
    return null;
  return {
    chargeTarget: f[2] & 0xff,
    dischargeToZero: (f[3] & 0xff) !== 0,
    alarm: (f[4] & 0xff) !== 0,
    lamp: (f[5] & 0xff) !== 0,
    mute: (f[6] & 0xff) !== 0,
    screenAutoOff: (f[7] & 0xff) !== 0,
    mode: f[8] & 0xff,
  };
}

/** Einordnung eines eingehenden Frames (Kanal + Kopf) */
export type FrameKind =
  | "bind"
  | "hwinfo"
  | "status"
  | "settings"
  | "expired"
  | "unknown";

export function classifyFrame(f: ArrayLike<number>): FrameKind {
  if (!f || f.length === 0) return "unknown";
  const a = f[0] & 0xff;
  const b = f.length > 1 ? f[1] & 0xff : -1;
  if (a === 0x19) return "bind";
  if (a === 0xe1 || (a === 0x31 && b === 0xe1)) return "hwinfo";
  if (a === 0x31 && b === 0xc3) return "status";
  if (a === 0x31 && b === 0xc7) return "settings";
  if (isBindingExpiredResponse(f)) return "expired";
  return "unknown";
}

// ── Anzeige (deutsch) ──────────────────────────────────────────────────────
export function slotStateLabel(state: number): string {
  switch (state) {
    case IsdtSlotState.Empty:
      return "Leer";
    case IsdtSlotState.Standby:
      return "Bereit";
    case IsdtSlotState.Charging:
      return "Lädt";
    case IsdtSlotState.Full:
      return "Voll";
    case IsdtSlotState.Discharging:
      return "Entlädt";
    case IsdtSlotState.DischargingAlt:
      return "Gibt ab";
    case IsdtSlotState.Error:
      return "Fehler";
    case IsdtSlotState.OverTemp:
      return "Zu heiß";
    case IsdtSlotState.UnderTemp:
      return "Zu kalt";
    default:
      return `Status ${state}`;
  }
}

export type SlotSeverity = "normal" | "ok" | "warn" | "error" | "hot" | "cold";

export function slotSeverity(state: number): SlotSeverity {
  if (state === IsdtSlotState.Error) return "error";
  if (state === IsdtSlotState.OverTemp) return "hot";
  if (state === IsdtSlotState.UnderTemp) return "cold";
  if (state === IsdtSlotState.Full) return "ok";
  if (state > IsdtSlotState.UnderTemp) return "warn";
  return "normal";
}

export function hubModeLabel(mode: number | null): string {
  if (mode == null) return "–";
  switch (mode) {
    case IsdtHubMode.Charge:
      return "Laden";
    case IsdtHubMode.Output:
      return "Ausgabe (Powerbank)";
    case IsdtHubMode.Gather:
      return "Sammeln";
    case IsdtHubMode.Balance:
      return "Ausgleichen";
    default:
      return `Modus ${mode}`;
  }
}

export function chargeTargetLabel(t: number): string {
  switch (t) {
    case 0:
      return "60 %";
    case 1:
      return "100 %";
    case 2:
      return "schnell 95 %";
    case 3:
      return "schnell 99 %";
    default:
      return `Ziel ${t}`;
  }
}

export const USB_PORT_LABELS = ["OUTPUT", "INPUT-1", "INPUT-2"];

export function usbStateLabel(state: number): string {
  if (state === 0) return "NC";
  return `aktiv (${state})`;
}

/** Zellen-Spreizung (max − min) in mV; null ohne gültige Zellen */
export function cellDeltaMv(
  cells: number[],
): { min: number; max: number; delta: number } | null {
  const valid = cells.filter((c) => c > 0);
  if (valid.length === 0) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return { min, max, delta: max - min };
}

export function formatProductionDate(d: IsdtProductionDate): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.day)}.${p(d.month)}.${d.year}`;
}

/** ISO-Datum JJJJ-MM-TT; null bei unplausiblem Datum (z. B. 00.00.2000) */
export function productionDateKey(d: IsdtProductionDate): string | null {
  if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > 31 || d.year <= 2000)
    return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.year}-${p(d.month)}-${p(d.day)}`;
}

// ── Hilfen ─────────────────────────────────────────────────────────────────
function sliceArr(f: ArrayLike<number>, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < Math.min(to, f.length); i++) out.push(f[i] & 0xff);
  return out;
}

export function toHex(bytes: ArrayLike<number>, sep = " "): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++)
    out.push((bytes[i] & 0xff).toString(16).padStart(2, "0"));
  return out.join(sep);
}

export function fromHex(hex: string): number[] {
  const h = hex.replace(/[^0-9a-fA-F]/g, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < h.length; i += 2)
    out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
}
