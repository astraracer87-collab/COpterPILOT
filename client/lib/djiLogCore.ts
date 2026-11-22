/**
 * RN-freie Kernlogik für DJI-Flugprotokolle: Typen, Konstanten und reine
 * Auswerte-/Gruppierungs-Funktionen OHNE Expo-/React-Native-Abhängigkeiten.
 *
 * Wichtig: Dieses Modul darf NICHTS aus `expo`, `expo-*`, `react-native` oder
 * `./api-client` (zieht AsyncStorage → react-native) importieren, damit es im
 * Web-Bundle (web/, Vite) verwendbar ist. Die Expo-/Upload-gebundenen Helfer
 * leben in `./djiLog.ts` und re-exportieren von hier.
 */

export const MAX_DJI_LOG_BYTES = 15 * 1024 * 1024;

export interface DjiLogRecord {
  t: number;
  mode?: string;
  sats?: number;
  heightM?: number;
  vpsM?: number;
  altM?: number;
  hSpeedMs?: number;
  vSpeedMs?: number;
  distM?: number;
  battPct?: number;
  battV?: number;
  cells?: number[];
  aileron?: number;
  elevator?: number;
  throttle?: number;
  rudder?: number;
  pitch?: number;
  roll?: number;
  yaw?: number;
  lat?: number;
  lon?: number;
}

export interface DjiLogMessage {
  t?: number;
  text: string;
  kind: "tip" | "warn" | "serious";
}

export interface DjiTrackPoint {
  lat: number;
  lon: number;
  alt?: number;
  ts?: number;
}

export interface DjiLogMeta {
  status: "parsed" | "undecryptable" | "error";
  fileName: string;
  objectPath: string;
  sizeBytes?: number;
  uploadedAt?: string;
  parsedAt?: string;
  version?: number;
  droneName?: string;
  maxAltitudeM?: number;
  durationSec?: number;
  totalDistanceM?: number;
  batteryStartPercent?: number;
  batteryEndPercent?: number;
  batteryMinPercent?: number;
  trackPointCount?: number;
  message?: string;
  track?: DjiTrackPoint[];
  records?: DjiLogRecord[];
  messages?: DjiLogMessage[];
  /** Welcher Akku in diesem Log steckte (Verweis auf DroneBattery.id). */
  batteryId?: string;
  batteryLabel?: string;
  // --- ab der Auswertung auf dem Gerät (alle optional, ältere Daten haben sie nicht) ---
  /** Seriennummer des Fluggeräts laut Log. */
  aircraftSn?: string;
  /** Vom Piloten vergebener Name des Fluggeräts (DJI-App). */
  aircraftName?: string;
  /** Seriennummer des Akkus laut Log. */
  batterySn?: string;
  /** Ladezyklen des Akkus laut Log (falls geloggt). */
  batteryCycleCount?: number;
  /** Akku-Gesundheit in % laut Log (falls geloggt). */
  batteryHealthPercent?: number;
  /** Niedrigste Zellspannung im Flug (V). */
  minCellV?: number;
  /** true, wenn nur aus der Gesamtspannung geschätzt. */
  minCellEstimated?: boolean;
  /** Höchste Akkutemperatur im Flug (°C). */
  maxBatteryTempC?: number;
  /** Größte Entfernung vom Startpunkt (m). */
  maxDistanceFromHomeM?: number;
  /** Erste/letzte gültige GPS-Position (bleibt in der leichten Listenkopie). */
  startLat?: number;
  startLon?: number;
  endLat?: number;
  endLon?: number;
  /** Start/Ende laut Log (ms seit Epoch). */
  startTs?: number;
  endTs?: number;
  /** Herkunft der Entschlüsselungs-Schlüssel (nur v13+). */
  keychainSource?: "cache" | "api";
}

export interface DjiAnalyzeResult {
  meta: DjiLogMeta;
  track: DjiTrackPoint[];
}

/** Obergrenze Flugdauer (Sekunden), bis zu der ein Start als Test gelten kann. */
export const TEST_START_MAX_DURATION_SEC = 120;
/** Obergrenze zurückgelegte Strecke (Meter), bis zu der ein Start als Test gilt. */
export const TEST_START_MAX_DISTANCE_M = 50;

/**
 * Heuristik: Ein Log ist vermutlich ein Test-/Einstellstart (Sensor-
 * Kalibrierung, kurzer Schwebe-/Funktionstest), wenn der Flug sehr kurz war
 * (<= 2 min) UND praktisch keine Strecke zurückgelegt wurde (<= 50 m). Solche
 * Starts sollen beim Import NICHT als Flug erfasst werden.
 *
 * Defensiv: nur einstufen, wenn beide Kennzahlen vorhanden sind. Fehlt eine
 * (z. B. verschlüsseltes/undecodierbares Log), im Zweifel NICHT als Test werten
 * — lieber importieren als einen echten Flug verlieren.
 */
export function isLikelyTestStart(meta: DjiLogMeta): boolean {
  if (meta.status !== "parsed") return false;
  const dur = meta.durationSec;
  const dist = meta.totalDistanceM;
  if (typeof dur !== "number" || typeof dist !== "number") return false;
  return dur <= TEST_START_MAX_DURATION_SEC && dist <= TEST_START_MAX_DISTANCE_M;
}

export interface DjiBulkProgress {
  done: number;
  total: number;
  fileName: string;
}

export interface DjiBulkError {
  fileName: string;
  error: string;
}

export interface DjiBulkResult {
  results: DjiAnalyzeResult[];
  errors: DjiBulkError[];
}

export interface DjiAnalysisGroup {
  /** Stabile ID (kleinster Startzeitpunkt oder Index). */
  id: string;
  items: DjiAnalyzeResult[];
  startTs?: number; // epoch ms, frühester Start der Gruppe
  startLat?: number;
  startLon?: number;
  droneName?: string; // Fluggerät der Gruppe (alle Logs derselben Drohne)
  aircraftSn?: string; // Seriennummer des Fluggeräts (für zuverlässige Gruppierung)
}

/**
 * Normalisiert einen Fluggerätenamen für Vergleiche: Kleinschreibung, nur
 * a-z0-9, und der Hersteller-Präfix "dji" wird entfernt — so wird "DJI Neo 2"
 * zu "neo2" und ist mit "Neo 2" vergleichbar.
 */
/**
 * Numerische DJI-Produktcodes, die der Log-Parser noch nicht als Namen kennt
 * („DJI 139“) → Modellname. 139 = DJI Mini 5 Pro.
 */
export const DJI_PRODUCT_CODE_NAMES: Record<string, string> = {
  "139": "DJI Mini 5 Pro",
};

/** „DJI 139“ / „139“ → „DJI Mini 5 Pro“; alle anderen Namen unverändert. */
export function canonicalDroneName(name?: string): string | undefined {
  if (!name) return name;
  const m = /^\s*(?:DJI\s*)?(\d{2,4})\s*$/i.exec(name);
  return m && DJI_PRODUCT_CODE_NAMES[m[1]] ? DJI_PRODUCT_CODE_NAMES[m[1]] : name;
}

export function normalizeDroneName(name?: string): string {
  const n = (canonicalDroneName(name) ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return n.replace(/^dji/, "");
}

/**
 * Zwei Fluggerätenamen gelten nur dann als gleich, wenn ihre normalisierten
 * Formen exakt übereinstimmen (z. B. "Neo 2" == "DJI Neo 2", aber
 * "Air 3" != "Air 3 S" und "Mini 3" != "Mini 3 Pro"). Fehlt ein Name, wird
 * Kompatibilität angenommen (unbekannt).
 */
export function dronesCompatible(a?: string, b?: string): boolean {
  const na = normalizeDroneName(a);
  const nb = normalizeDroneName(b);
  if (!na || !nb) return true;
  return na === nb;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Startort (erster gültiger GPS-Punkt) + Startzeit (absolutes ts) einer Auswertung. */
/** Seriennummer normalisieren (Groß/klein, Sonderzeichen egal). */
function normSn(s?: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Gleiches Fluggerät? Bevorzugt über die Seriennummer (zuverlässig, auch bei
 * noch unbekannten Modellen wie „DJI 139“). Hat eine Seite keine Seriennummer,
 * entscheidet der Modellname.
 */
export function sameAircraft(aName?: string, aSn?: string, bName?: string, bSn?: string): boolean {
  const sa = normSn(aSn);
  const sb = normSn(bSn);
  if (sa && sb) return sa === sb;
  return dronesCompatible(aName, bName);
}

export function startInfoOf(r: DjiAnalyzeResult): {
  lat?: number;
  lon?: number;
  ts?: number;
} {
  const track = r.track && r.track.length > 0 ? r.track : r.meta.track;
  const tp = track?.find((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  return { lat: tp?.lat, lon: tp?.lon, ts: tp?.ts };
}

/**
 * Gruppiert mehrere Auswertungen nach Startort (Standard < 2 km) UND Startzeit
 * (Standard < 3 h) — typischerweise ein Flug mit mehreren Akkus. Auswertungen
 * ohne GPS-Startpunkt landen jeweils in einer eigenen Gruppe.
 */
export function groupDjiAnalyses(
  items: DjiAnalyzeResult[],
  opts?: { maxKm?: number; maxHours?: number },
): DjiAnalysisGroup[] {
  const maxKm = opts?.maxKm ?? 2;
  const maxMs = (opts?.maxHours ?? 3) * 3600 * 1000;

  const withInfo = items.map((r) => ({ r, info: startInfoOf(r) }));
  withInfo.sort((a, b) => (a.info.ts ?? Infinity) - (b.info.ts ?? Infinity));

  const groups: DjiAnalysisGroup[] = [];

  for (const { r, info } of withInfo) {
    let placed = false;
    const sn = r.meta.aircraftSn;
    for (const g of groups) {
      // Regel: nur dieselbe Drohne zusammenfassen – bevorzugt über die
      // Seriennummer (zuverlässig, auch bei unbekannten Modellen), sonst Name.
      const droneOk = sameAircraft(g.droneName, g.aircraftSn, r.meta.droneName, sn);
      if (!droneOk) continue;
      // Zeit-Nähe: beide Startzeiten vorhanden und ≤ Fenster auseinander.
      const timeOk =
        g.startTs != null && info.ts != null ? Math.abs(g.startTs - info.ts) <= maxMs : false;
      if (!timeOk) continue;
      // Ort: Bei gesicherter gleicher Seriennummer (dasselbe Fluggerät) reicht
      // die Zeit-Nähe – aufeinanderfolgende Flüge/Akkuwechsel gehören zusammen,
      // auch wenn der Startpunkt etwas abweicht. Ohne Seriennummer bleibt die
      // zusätzliche Ortsnähe als Sicherung.
      const haveBothSn = !!normSn(sn) && !!normSn(g.aircraftSn);
      const distOk =
        haveBothSn ||
        (g.startLat != null &&
          g.startLon != null &&
          info.lat != null &&
          info.lon != null &&
          haversineKm(g.startLat, g.startLon, info.lat, info.lon) <= maxKm);
      if (!distOk) continue;
      g.items.push(r);
      if (info.ts != null && (g.startTs == null || info.ts < g.startTs)) g.startTs = info.ts;
      if (g.startLat == null && info.lat != null) { g.startLat = info.lat; g.startLon = info.lon; }
      if (!g.droneName && r.meta.droneName) g.droneName = r.meta.droneName;
      if (!g.aircraftSn && sn) g.aircraftSn = sn;
      placed = true;
      break;
    }
    if (!placed) {
      groups.push({
        id: `g-${groups.length}-${normSn(sn) || normalizeDroneName(r.meta.droneName) || "drone"}-${info.ts ?? "nots"}`,
        items: [r],
        startTs: info.ts,
        startLat: info.lat,
        startLon: info.lon,
        droneName: r.meta.droneName,
        aircraftSn: sn,
      });
    }
  }

  return groups;
}
