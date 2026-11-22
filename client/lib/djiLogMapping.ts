import { canonicalDroneName } from "./djiLogCore";
/**
 * Abbildung der Worker-Ausgabe (Kennzahlen + kompakte Zeilen) auf die
 * bestehenden Datenstrukturen der App: DjiLogMeta / DjiAnalyzeResult, wie sie
 * früher der Server geliefert hat. Die Bildschirme (Wiedergabe, Tabelle,
 * Knüppel, Meldungen, Karte), storage.ts und pdfExport.ts bleiben unverändert.
 *
 * Gespeichert wird bewusst ausgedünnt (Logbuch-Einträge liegen gesammelt
 * auf dem Gerät): höchstens DJI_MAX_STORED_RECORDS Detailzeilen und
 * DJI_MAX_TRACK_POINTS GPS-Punkte je Log. Die Kennzahlen stammen exakt aus
 * allen Frames (Worker).
 *
 * RN-frei, unter Node testbar.
 */
import type { DroneProfile, LogbookEntry } from "./storage";
import type {
  DjiAnalyzeResult,
  DjiLogMessage,
  DjiLogMeta,
  DjiLogRecord,
  DjiTrackPoint,
} from "./djiLogCore";
import {
  DJI_ROW_COLUMNS,
  type DjiInspectInfo,
  type DjiLogDetailsInfo,
  type DjiParseSummary,
  type DjiRow,
} from "./djiLogWorkerProtocol";

export const DJI_MAX_STORED_RECORDS = 900;
export const DJI_MAX_TRACK_POINTS = 1200;
export const DJI_MAX_STORED_MESSAGES = 200;

const COL = Object.fromEntries(DJI_ROW_COLUMNS.map((c, i) => [c, i])) as Record<
  (typeof DJI_ROW_COLUMNS)[number],
  number
>;

function n(row: DjiRow, col: keyof typeof COL): number | undefined {
  const v = row[COL[col]];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Gleichmäßig auf höchstens max Elemente ausdünnen; erstes und letztes bleiben erhalten. */
export function downsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return items.slice();
  if (max <= 1) return items.slice(0, Math.max(0, max));
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

/**
 * Lesbarer Fluggerätename aus dem DJI-Produkttyp: "Mini4Pro" → "DJI Mini 4 Pro",
 * "MavicAir2S" → "DJI Mavic Air 2S". Unbekannt → Name aus der DJI-App.
 */
export function prettyDroneName(
  details: Pick<DjiLogDetailsInfo, "productType" | "aircraftName">,
): string | undefined {
  const pt = details.productType;
  // Bekannter numerischer Produktcode (z. B. 139 = Mini 5 Pro) hat Vorrang
  const coded = canonicalDroneName(pt ?? undefined);
  if (pt && coded && coded !== pt) return coded;
  const fromLog = canonicalDroneName(details.aircraftName?.trim());
  // Produkttyp nur verwenden, wenn er wie ein Modellname aussieht (enthält
  // Buchstaben). Rein numerische/unbekannte Typen (z. B. "139" einer noch nicht
  // gelisteten Mini 5 Pro) sagen nichts – dann lieber den Namen aus dem Log.
  const ptUsable =
    !!pt &&
    pt !== "None" &&
    !pt.startsWith("Unbekannt") &&
    /[A-Za-z]/.test(pt) &&
    !/^DJI\s*\d+$/i.test(pt.trim());
  if (!ptUsable && fromLog) return fromLog;
  if (ptUsable) {
    const spaced = pt!
      .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
      .replace(/([0-9])([A-Z][a-z])/g, "$1 $2")
      .replace(/RTK/g, " RTK")
      .replace(/\s+/g, " ")
      .trim();
    return spaced.startsWith("DJI") ? spaced : `DJI ${spaced}`;
  }
  const name = details.aircraftName?.trim();
  return name || undefined;
}

/** Zeile → DjiLogRecord (nur gesetzte Felder). */
export function rowToRecord(row: DjiRow): DjiLogRecord {
  const rec: DjiLogRecord = { t: n(row, "t") ?? 0 };
  const set = <K extends keyof DjiLogRecord>(
    k: K,
    v: DjiLogRecord[K] | undefined,
  ) => {
    if (v !== undefined) rec[k] = v;
  };
  const mode = row[COL.mode];
  if (typeof mode === "string" && mode) rec.mode = mode;
  set("sats", n(row, "sats"));
  set("heightM", n(row, "heightM"));
  set("vpsM", n(row, "vpsM"));
  set("altM", n(row, "altM"));
  set("hSpeedMs", n(row, "hSpeedMs"));
  set("vSpeedMs", n(row, "vSpeedMs"));
  set("distM", n(row, "distM"));
  set("battPct", n(row, "battPct"));
  set("battV", n(row, "battV"));
  const cells = row[COL.cells];
  if (Array.isArray(cells) && cells.length > 0)
    rec.cells = cells.map((c) => (typeof c === "number" ? c : 0));
  set("aileron", n(row, "aileron"));
  set("elevator", n(row, "elevator"));
  set("throttle", n(row, "throttle"));
  set("rudder", n(row, "rudder"));
  set("pitch", n(row, "pitch"));
  set("roll", n(row, "roll"));
  set("yaw", n(row, "yaw"));
  set("lat", n(row, "lat"));
  set("lon", n(row, "lon"));
  return rec;
}

/** GPS-Punkte (mit Zeitstempel) aus den Zeilen. */
export function rowsToTrack(
  rows: readonly DjiRow[],
  maxPoints = DJI_MAX_TRACK_POINTS,
): DjiTrackPoint[] {
  const pts: DjiTrackPoint[] = [];
  for (const r of rows) {
    const lat = n(r, "lat");
    const lon = n(r, "lon");
    if (lat === undefined || lon === undefined) continue;
    const p: DjiTrackPoint = { lat, lon };
    const alt = n(r, "heightM");
    if (alt !== undefined) p.alt = alt;
    const ts = n(r, "ts");
    if (ts !== undefined) p.ts = ts;
    pts.push(p);
  }
  return downsample(pts, maxPoints);
}

function mapMessages(summary: DjiParseSummary): DjiLogMessage[] {
  return summary.messages.slice(0, DJI_MAX_STORED_MESSAGES).map((m) => {
    const out: DjiLogMessage = { text: m.text, kind: m.kind };
    if (typeof m.t === "number" && Number.isFinite(m.t)) out.t = m.t;
    return out;
  });
}

function roundTo(v: number | undefined, d: number): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function stripUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[])
    if (o[k] === undefined) delete o[k];
  return o;
}

export interface DjiFileRef {
  fileName: string;
  /** stabile lokale Kennung (früher: Objektpfad im Server-Speicher) */
  objectPath: string;
  sizeBytes?: number;
}

/** Vollständig ausgewertetes Log → DjiLogMeta (inkl. ausgedünnter Detaildaten). */
export function buildParsedMeta(
  file: DjiFileRef,
  summary: DjiParseSummary,
  rows: readonly DjiRow[],
  opts: { parsedAt?: string; keychainSource?: "cache" | "api" } = {},
): DjiLogMeta {
  const { stats, details, battery } = summary;
  const track = rowsToTrack(rows);
  const records = downsample(rows, DJI_MAX_STORED_RECORDS).map(rowToRecord);
  const totalDistance =
    typeof stats.distanceM === "number" && stats.distanceM > 0
      ? stats.distanceM
      : typeof details.totalDistance === "number" && details.totalDistance > 0
        ? Math.round(details.totalDistance)
        : stats.distanceM;
  const maxAlt =
    typeof stats.maxHeightM === "number" ? stats.maxHeightM : details.maxHeight;
  const meta: DjiLogMeta = {
    status: stats.empty ? "error" : "parsed",
    fileName: file.fileName,
    objectPath: file.objectPath,
    sizeBytes: file.sizeBytes,
    parsedAt: opts.parsedAt ?? new Date().toISOString(),
    uploadedAt: opts.parsedAt ?? new Date().toISOString(),
    version: summary.version,
    droneName: prettyDroneName(details),
    maxAltitudeM: roundTo(maxAlt, 1),
    durationSec: roundTo(stats.durationSec ?? details.totalTime, 1),
    totalDistanceM: totalDistance,
    batteryStartPercent: stats.batteryStartPercent,
    batteryEndPercent: stats.batteryEndPercent,
    batteryMinPercent: stats.batteryMinPercent,
    trackPointCount: track.length,
    message: stats.empty
      ? "Das Protokoll enthält keine verwertbaren Flugdaten."
      : undefined,
    track,
    records,
    messages: mapMessages(summary),
    aircraftSn: battery.aircraftSn ?? details.aircraftSn,
    aircraftName: details.aircraftName,
    batterySn: battery.batterySn ?? details.batterySn,
    batteryCycleCount: battery.cycleCount,
    batteryHealthPercent: battery.healthPercent,
    minCellV: stats.minCellV,
    minCellEstimated:
      stats.minCellV !== undefined ? !!stats.minCellEstimated : undefined,
    maxBatteryTempC: stats.maxTempC,
    maxDistanceFromHomeM: stats.maxDistFromHomeM,
    startTs: stats.startTs ?? parseTs(details.startTime),
    endTs: stats.endTs,
    keychainSource: opts.keychainSource,
  };
  return stripUndefined(meta);
}

function parseTs(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Verschlüsseltes Log ohne Schlüssel (kein API-Schlüssel, offline, Kontingent
 * …): Basis-Kennzahlen aus dem unverschlüsselten Details-Block.
 */
export function buildUndecryptableMeta(
  file: DjiFileRef,
  info: Pick<DjiInspectInfo, "version" | "details">,
  message: string,
  opts: { parsedAt?: string } = {},
): DjiLogMeta {
  const d = info.details;
  const start = parseTs(d.startTime);
  const track: DjiTrackPoint[] =
    typeof d.latitude === "number" &&
    typeof d.longitude === "number" &&
    !(Math.abs(d.latitude) < 1e-6 && Math.abs(d.longitude) < 1e-6)
      ? [
          {
            lat: d.latitude,
            lon: d.longitude,
            ...(start !== undefined ? { ts: start } : {}),
          },
        ]
      : [];
  return stripUndefined<DjiLogMeta>({
    status: "undecryptable",
    fileName: file.fileName,
    objectPath: file.objectPath,
    sizeBytes: file.sizeBytes,
    parsedAt: opts.parsedAt ?? new Date().toISOString(),
    uploadedAt: opts.parsedAt ?? new Date().toISOString(),
    version: info.version,
    droneName: prettyDroneName(d),
    maxAltitudeM: roundTo(d.maxHeight, 1),
    durationSec: roundTo(d.totalTime, 1),
    trackPointCount: track.length,
    message,
    track,
    aircraftSn: d.aircraftSn,
    aircraftName: d.aircraftName,
    batterySn: d.batterySn,
    startTs: start,
  });
}

export function toAnalyzeResult(meta: DjiLogMeta): DjiAnalyzeResult {
  return { meta, track: meta.track ?? [] };
}

/** Lokale, stabile Kennung eines Logs (ersetzt den Server-Objektpfad). */
export function localObjectPath(fingerprint: string): string {
  return `local-dji:${fingerprint}`;
}

function localDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Neuer Logbuch-Eintrag aus einem ausgewerteten Log (ohne id/createdAt). */
export function logbookEntryFromDjiLog(
  meta: DjiLogMeta,
  drone: Pick<DroneProfile, "id" | "name" | "classMark"> | null,
  now = Date.now(),
): Omit<LogbookEntry, "id" | "createdAt"> {
  const firstPt = meta.track?.find(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon),
  );
  const start =
    meta.startTs ??
    meta.track?.find((p) => typeof p.ts === "number")?.ts ??
    now;
  const end =
    meta.endTs ??
    (meta.durationSec ? start + meta.durationSec * 1000 : undefined);
  return {
    sessionId: `dji-log:${meta.objectPath}`,
    droneId: drone?.id ?? "",
    droneName: drone?.name ?? meta.droneName ?? "DJI-Drohne",
    droneClass: drone?.classMark ?? "legacy",
    flightDate: localDate(start),
    latitude: firstPt?.lat ?? 0,
    longitude: firstPt?.lon ?? 0,
    takeoffTime: new Date(start).toISOString(),
    landingTime: end ? new Date(end).toISOString() : undefined,
    flightDurationMinutes: meta.durationSec
      ? Math.max(1, Math.round(meta.durationSec / 60))
      : undefined,
    maxAltitude:
      meta.maxAltitudeM != null ? Math.round(meta.maxAltitudeM) : undefined,
    incidentOccurred: false,
    maintenanceRequired: false,
    notes: `Aus DJI-Flugprotokoll importiert (${meta.fileName}).`,
    djiLogs: [meta],
  };
}
