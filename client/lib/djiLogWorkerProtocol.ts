/**
 * Nachrichtenprotokoll zwischen der App (React Native, Hermes) und der
 * versteckten WebView, in der dji-log-parser (WebAssembly) läuft.
 *
 * RN → WebView (per injectJavaScript, `window.__djiWorker.receive(msg)`):
 *   begin   { jobId, fileName }                 neuer Auftrag
 *   chunk   { jobId, index, data }              Dateiinhalt, Base64, in Stücken
 *   inspect { jobId }                           Kopf lesen (Version, Details, Schlüsselbedarf)
 *   parse   { jobId, keychains? }               vollständig auswerten (ab v13 mit Schlüsseln)
 *   release { jobId }                           Speicher freigeben
 *
 * WebView → RN (per ReactNativeWebView.postMessage, JSON):
 *   ready     { protocol, parserVersion }       WebAssembly geladen
 *   fatal     { message }                       WebAssembly ließ sich nicht laden
 *   ack       { jobId, index }                  Stück angekommen (Flusskontrolle)
 *   inspected { jobId, info }                   Ergebnis von inspect
 *   summary   { jobId, summary, totalRows, rowChunks }  Kennzahlen eines parse
 *   rows      { jobId, index, rows }            Datenzeilen (gestreamt, in Stücken)
 *   done      { jobId }                         parse vollständig
 *   error     { jobId, code, message }          Fehler eines Auftrags
 *
 * RN-frei und unter Node testbar.
 */

export const DJI_WORKER_PROTOCOL = 1;

/** Rohbytes je Stück (Vielfaches von 3 → Base64 ohne Füllzeichen in der Mitte). */
export const DJI_CHUNK_BYTES = 192 * 1024;
/** Höchstzahl gestreamter Zeilen je Log (gleichmäßig ausgedünnt). */
export const DJI_MAX_STREAM_ROWS = 4000;
/** Zeilen je rows-Nachricht. */
export const DJI_ROWS_PER_MESSAGE = 800;

/**
 * Spaltenreihenfolge einer Datenzeile. Die WebView liefert sie im summary mit;
 * die App prüft die Übereinstimmung (Schutz vor veraltetem Worker-Skript).
 */
export const DJI_ROW_COLUMNS = [
  "t", // Flugzeit s
  "ts", // Zeitpunkt (ms seit Epoch)
  "lat",
  "lon",
  "heightM", // Höhe über Start (Barometer)
  "vpsM", // Ultraschall/VPS
  "altM", // MSL
  "hSpeedMs",
  "vSpeedMs", // positiv = steigen
  "distM", // Abstand zum Startpunkt
  "sats",
  "battPct",
  "battV",
  "aileron", // -1..1
  "elevator",
  "throttle",
  "rudder",
  "pitch",
  "roll",
  "yaw",
  "mode",
  "cells", // Zellspannungen V oder null
  "tempC", // Akkutemperatur °C oder null
] as const;

export type DjiRowColumn = (typeof DJI_ROW_COLUMNS)[number];
export type DjiRow = (number | string | number[] | null)[];

/** Auszug aus dem (unverschlüsselten) Details-Block des Logs. */
export interface DjiLogDetailsInfo {
  startTime?: string;
  latitude?: number;
  longitude?: number;
  totalDistance?: number;
  totalTime?: number;
  maxHeight?: number;
  maxHorizontalSpeed?: number;
  maxVerticalSpeed?: number;
  productType?: string;
  aircraftName?: string;
  aircraftSn?: string;
  batterySn?: string;
  rcSn?: string;
  cameraSn?: string;
  appPlatform?: string;
  appVersion?: string;
  city?: string;
  area?: string;
}

export interface DjiKeychainFeaturePoint {
  featurePoint: string;
  aesKey: string;
  aesIv: string;
}

export interface DjiEncodedKeychainFeaturePoint {
  featurePoint: string;
  aesCiphertext: string;
}

/** Request-Body für POST /openapi/v1/flight-records/keychains. */
export interface DjiKeychainsRequest {
  version: number;
  department: number;
  keychainsArray: DjiEncodedKeychainFeaturePoint[][];
}

export type DjiKeychains = DjiKeychainFeaturePoint[][];

export interface DjiInspectInfo {
  version: number;
  byteLength: number;
  /** Stabile Kennung des Logs (für den Schlüssel-Cache). */
  fingerprint: string;
  details: DjiLogDetailsInfo;
  keychainsRequired: boolean;
  keychainsRequest: DjiKeychainsRequest | null;
}

/** Exakte Kennzahlen über ALLE Frames (nicht nur die gestreamten Zeilen). */
export interface DjiParseStats {
  frameCount: number;
  durationSec?: number;
  maxHeightM?: number;
  distanceM?: number;
  maxDistFromHomeM?: number;
  batteryStartPercent?: number;
  batteryEndPercent?: number;
  batteryMinPercent?: number;
  minCellV?: number;
  /** true, wenn die Zellspannung nur geschätzt (Gesamtspannung / Zellzahl) ist. */
  minCellEstimated?: boolean;
  maxTempC?: number;
  startTs?: number;
  endTs?: number;
  homeLat?: number;
  homeLon?: number;
  /** keine verwertbaren Frames (z. B. falsche Schlüssel) */
  empty?: boolean;
}

export interface DjiParseBattery {
  batterySn?: string;
  aircraftSn?: string;
  cycleCount?: number;
  /** Akku-Gesundheit in % (SmartBatteryStatic.battery_life), falls geloggt. */
  healthPercent?: number;
}

export interface DjiParseMessage {
  t?: number;
  text: string;
  kind: "tip" | "warn" | "serious";
}

export interface DjiParseSummary {
  version: number;
  columns: string[];
  details: DjiLogDetailsInfo;
  stats: DjiParseStats;
  battery: DjiParseBattery;
  messages: DjiParseMessage[];
  /** gestreamte Zeilen sind jede n-te Frame */
  rowStride: number;
}

export type DjiWorkerErrorCode =
  | "not_a_log"
  | "unsupported"
  | "decrypt_failed"
  | "keychain_required"
  | "unknown_job"
  | "internal";

export type DjiWorkerRequest =
  | { type: "begin"; jobId: string; fileName: string }
  | { type: "chunk"; jobId: string; index: number; data: string }
  | { type: "inspect"; jobId: string }
  | { type: "parse"; jobId: string; keychains?: DjiKeychains | null }
  | { type: "release"; jobId: string };

export type DjiWorkerResponse =
  | { type: "ready"; protocol: number; parserVersion?: string }
  | { type: "fatal"; message: string }
  | { type: "ack"; jobId: string; index: number }
  | { type: "inspected"; jobId: string; info: DjiInspectInfo }
  | {
      type: "summary";
      jobId: string;
      summary: DjiParseSummary;
      totalRows: number;
      rowChunks: number;
    }
  | { type: "rows"; jobId: string; index: number; rows: DjiRow[] }
  | { type: "done"; jobId: string }
  | { type: "error"; jobId: string; code: DjiWorkerErrorCode; message: string };

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/** JS-Aufruf für injectJavaScript (endet mit `true;`, wie von react-native-webview verlangt). */
export function encodeWorkerRequest(msg: DjiWorkerRequest): string {
  // JSON ist gültiges JS; U+2028/2029 sind in alten Engines in String-Literalen verboten.
  const json = JSON.stringify(msg)
    .split(LS)
    .join("\\u2028")
    .split(PS)
    .join("\\u2029");
  return `window.__djiWorker&&window.__djiWorker.receive(${json});true;`;
}

export function decodeWorkerResponse(raw: unknown): DjiWorkerResponse | null {
  if (typeof raw !== "string") return null;
  try {
    const msg = JSON.parse(raw) as DjiWorkerResponse;
    if (
      !msg ||
      typeof msg !== "object" ||
      typeof (msg as { type?: unknown }).type !== "string"
    )
      return null;
    return msg;
  } catch {
    return null;
  }
}

/** Anzahl Stücke für eine Datei bekannter Größe. */
export function chunkCount(
  byteLength: number,
  chunkBytes = DJI_CHUNK_BYTES,
): number {
  return Math.max(1, Math.ceil(byteLength / chunkBytes));
}

/** Byte-Länge eines Base64-Strings (ohne Leerraum). */
export function base64ByteLength(b64: string): number {
  const n = b64.length;
  if (n === 0) return 0;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (n / 4) * 3 - pad;
}

/** Zeile → benanntes Objekt (für Tests/Debugging). */
export function rowToObject(
  row: DjiRow,
): Partial<Record<DjiRowColumn, DjiRow[number]>> {
  const out: Partial<Record<DjiRowColumn, DjiRow[number]>> = {};
  DJI_ROW_COLUMNS.forEach((c, i) => {
    if (row[i] != null) out[c] = row[i];
  });
  return out;
}
