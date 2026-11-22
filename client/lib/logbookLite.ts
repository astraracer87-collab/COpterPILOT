// Leichte Logbuch-Listen ohne die ausgelagerten Blob-Dateien (Karten-Snapshots,
// DJI-Logs mit Track/Detailzeilen, GPS-Tracks) + sichere Pflege der aus
// DJI-Protokollen importierten Einträge (Doppelte, Akku-Tausch-Serien).
//
// Hintergrund: getLogbook() hat für JEDE Liste alle Blob-Dateien aller
// Einträge gelesen und geparst – auf der DJI RC Pro 2 (wenig RAM, langsamer
// Speicher) dauert das sehr lange und kann den Speicher sprengen.
//
// RN-frei (unter Node testbar).

import type { DjiLogMeta, GpsTrackPoint, LogbookEntry } from "./storage";
import { sameAircraft } from "./djiLogCore";
import { downsample } from "./djiLogMapping";
import { isBlobRef } from "./userBlobs";

/** Höchstzahl Punkte der Vorschau-Route (alle Segmente zusammen). */
export const TRACK_PREVIEW_MAX_POINTS = 60;
/** sessionId-Präfix der aus einem DJI-Protokoll angelegten Einträge. */
export const DJI_SESSION_PREFIX = "dji-log:";
/** Höchster Abstand Landung → nächster Start, der noch als Akku-Tausch gilt. */
export const DJI_MERGE_MAX_GAP_MS = 20 * 60 * 1000;
/** Logs werden nur zusammengeführt, wenn sie höchstens so weit auseinander liegen. */
export const DJI_MERGE_MAX_DISTANCE_M = 1000;

/** Vom DJI-Import automatisch gesetzte Notiz (logbookEntryFromDjiLog bzw. nach dem Zusammenführen). */
const AUTO_NOTE_RE = /^Aus DJI-Flugprotokoll(en)? importiert \([^\n]*\)\.$/;

const BASE64_SNAPSHOT_FIELDS = [
  "mapSnapshotBase64",
  "routeMapSnapshotBase64",
  "mapSatelliteSnapshotBase64",
  "routeMapSatelliteSnapshotBase64",
] as const;

// ---------------------------------------------------------------------------
// DJI-Log-Zusammenfassung (ohne Track/Detailzeilen/Meldungen)
// ---------------------------------------------------------------------------

const LITE_MARK = Symbol.for("copterpilot.liteDjiLog");

/** Metadaten eines DJI-Logs ohne die großen Teile (track/records/messages). */
export function summarizeDjiLog(l: DjiLogMeta): DjiLogMeta {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { track, records, messages, ...rest } = l;
  const ends = djiLogEnds(l);
  return ends ? { ...rest, startLat: ends.start.lat, startLon: ends.start.lon, endLat: ends.end.lat, endLon: ends.end.lon } : rest;
}

type LatLon = { lat: number; lon: number };

const gpsOk = (p: LatLon | undefined | null): p is LatLon =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(Math.abs(p.lat) < 0.01 && Math.abs(p.lon) < 0.01);

/** Erste und letzte gültige Position eines Logs (Track oder gespeicherte Felder). */
export function djiLogEnds(l: DjiLogMeta): { start: LatLon; end: LatLon } | null {
  const pts = validPoints(l.track).filter(gpsOk);
  if (pts.length > 0) return { start: pts[0], end: pts[pts.length - 1] };
  const s = { lat: l.startLat as number, lon: l.startLon as number };
  const e = { lat: l.endLat as number, lon: l.endLon as number };
  if (gpsOk(s)) return { start: s, end: gpsOk(e) ? e : s };
  return null;
}

/** Entfernung in Metern (Haversine). */
export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Logs eines Eintrags (chronologisch) in örtlich zusammenhängende Gruppen
 * teilen: ein Log gehört zur laufenden Gruppe, wenn es höchstens maxDistM von
 * ihr entfernt startet. Logs ohne Position bleiben in der laufenden Gruppe.
 */
export function groupDjiLogsByDistance<T extends DjiLogMeta>(
  logs: readonly T[],
  maxDistM = DJI_MERGE_MAX_DISTANCE_M,
): T[][] {
  const groups: { logs: T[]; last?: LatLon; anchor?: LatLon }[] = [];
  for (const l of logs) {
    const ends = djiLogEnds(l);
    const cur = groups[groups.length - 1];
    const near =
      !!cur &&
      (!ends ||
        l.manualAssigned === true ||
        (!cur.last && !cur.anchor) ||
        (!!cur.last && distanceM(cur.last, ends.start) <= maxDistM) ||
        (!!cur.anchor && distanceM(cur.anchor, ends.start) <= maxDistM));
    if (cur && near) {
      cur.logs.push(l);
      if (ends) {
        cur.last = ends.end;
        cur.anchor = cur.anchor ?? ends.start;
      }
    } else {
      groups.push({ logs: [l], last: ends?.end, anchor: ends?.start });
    }
  }
  return groups.map((g) => g.logs);
}

/**
 * Zusammenfassung als „unvollständig“ markieren (Symbol-Schlüssel: bleibt bei
 * `{...log}` erhalten, landet aber nie im gespeicherten JSON). storage.ts
 * verweigert das Speichern solcher Logs, damit eine leichte Liste nie die
 * vollständigen Protokolle überschreibt.
 */
export function markLiteDjiLog(l: DjiLogMeta): DjiLogMeta {
  return { ...l, [LITE_MARK]: true } as DjiLogMeta;
}

/**
 * In der leichten Kopie weggelassene, ausgelagerte Felder (Snapshots,
 * GPS-Track) – damit hasUserEnteredData sie auch ohne Datei erkennt.
 */
const DROPPED_FIELDS = Symbol.for("copterpilot.liteDroppedFields");

function droppedFieldsOf(e: unknown): readonly string[] {
  const v = e && typeof e === "object" ? (e as Record<symbol, unknown>)[DROPPED_FIELDS] : undefined;
  return Array.isArray(v) ? v : [];
}

export function isLiteDjiLog(l: unknown): boolean {
  return !!l && typeof l === "object" && (l as Record<symbol, unknown>)[LITE_MARK] === true;
}

// ---------------------------------------------------------------------------
// Vorschau-Route
// ---------------------------------------------------------------------------

function validPoints(track: unknown): { lat: number; lon: number }[] {
  if (!Array.isArray(track)) return [];
  const out: { lat: number; lon: number }[] = [];
  for (const p of track) {
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) out.push({ lat: p.lat, lon: p.lon });
  }
  return out;
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * Ausgedünnte Route (höchstens TRACK_PREVIEW_MAX_POINTS Punkte, auf ~1 m
 * gerundet) für Vorschaubilder: GPS-Track, sonst je DJI-Log ein Segment.
 */
export function computeTrackPreview(
  gpsTrack: unknown,
  djiLogs: readonly DjiLogMeta[] | undefined,
  max = TRACK_PREVIEW_MAX_POINTS,
): GpsTrackPoint[][] | undefined {
  let segments: { lat: number; lon: number }[][] = [];
  const gps = validPoints(gpsTrack);
  if (gps.length >= 2) segments = [gps];
  else
    for (const l of djiLogs ?? []) {
      const pts = validPoints(l?.track);
      if (pts.length >= 2) segments.push(pts);
    }
  if (segments.length === 0) return undefined;
  const total = segments.reduce((s, x) => s + x.length, 0);
  return segments.map((seg) =>
    downsample(seg, Math.max(2, Math.floor((max * seg.length) / total))).map((p) => ({
      lat: round5(p.lat),
      lon: round5(p.lon),
    })),
  );
}

// ---------------------------------------------------------------------------
// Abgeleitete Listenfelder (werden beim Speichern des Logbuchs gepflegt)
// ---------------------------------------------------------------------------

function inlineLogs(e: Pick<LogbookEntry, "djiLogs" | "djiLog">): DjiLogMeta[] {
  if (Array.isArray(e.djiLogs) && e.djiLogs.length > 0) return e.djiLogs;
  if (e.djiLog && typeof e.djiLog === "object") return [e.djiLog];
  return [];
}

/** DJI-Logs des Eintrags liegen (nur) als ausgelagerte Datei vor. */
export function djiLogsAreBlob(e: Pick<LogbookEntry, "djiLogs" | "djiLog">): boolean {
  if (isBlobRef(e.djiLogs)) return true;
  const hasInlineList = Array.isArray(e.djiLogs) && e.djiLogs.length > 0;
  return !hasInlineList && isBlobRef(e.djiLog);
}

/**
 * Pflegt djiLogsSummary/trackPreview eines (rohen) Eintrags vor dem Speichern:
 * neu berechnet, wenn die Quelldaten inline vorliegen; bei ausgelagerten
 * Quellen bleibt der vorhandene Wert stehen (die Datei ändert sich nur, wenn
 * der Wert inline neu geschrieben wird).
 */
export function withDerivedLogbookFields<T extends LogbookEntry>(e: T): T {
  if (!e || typeof e !== "object") return e;
  const next = { ...e };
  if (!djiLogsAreBlob(e)) {
    const logs = inlineLogs(e);
    if (logs.length > 0) next.djiLogsSummary = logs.map(summarizeDjiLog);
    else delete next.djiLogsSummary;
  }
  const gpsIsRef = isBlobRef(e.gpsTrack);
  const gpsInline = Array.isArray(e.gpsTrack) && validPoints(e.gpsTrack).length >= 2;
  if (gpsInline) {
    next.trackPreview = computeTrackPreview(e.gpsTrack, undefined);
  } else if (!gpsIsRef && !djiLogsAreBlob(e)) {
    const preview = computeTrackPreview(undefined, inlineLogs(e));
    if (preview) next.trackPreview = preview;
    else delete next.trackPreview;
  }
  return next;
}

/**
 * Leichte Kopie eines rohen (nicht hydrierten) Eintrags: Verweise auf
 * Blob-Dateien entfallen (nie ein `blobref:`-String als Bild/JSON), DJI-Logs
 * als ausgelagerte Datei werden durch die gespeicherte Zusammenfassung
 * ersetzt. `needsDjiHydration`: Altbestand ohne Zusammenfassung – der Aufrufer
 * muss nur die DJI-Logs dieses Eintrags lesen.
 */
export function toLiteLogbookEntry(raw: LogbookEntry): {
  entry: LogbookEntry;
  needsDjiHydration: boolean;
} {
  const e: LogbookEntry = { ...raw };
  const dropped: string[] = [];
  for (const f of BASE64_SNAPSHOT_FIELDS)
    if (isBlobRef(e[f])) {
      delete e[f];
      dropped.push(f);
    }
  if (e.trafficLog && isBlobRef(e.trafficLog.mapSnapshotBase64)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { mapSnapshotBase64: _drop, ...rest } = e.trafficLog;
    e.trafficLog = rest as LogbookEntry["trafficLog"];
  }
  if (isBlobRef(e.gpsTrack)) {
    delete e.gpsTrack;
    dropped.push("gpsTrack");
  }
  if (dropped.length > 0) (e as unknown as Record<symbol, unknown>)[DROPPED_FIELDS] = dropped;
  let needsDjiHydration = false;
  if (djiLogsAreBlob(raw)) {
    delete e.djiLog;
    if (raw.djiLogsSummary && raw.djiLogsSummary.length > 0) {
      e.djiLogs = raw.djiLogsSummary.map(markLiteDjiLog);
    } else {
      delete e.djiLogs;
      needsDjiHydration = true;
    }
  } else if (isBlobRef(e.djiLog)) {
    delete e.djiLog;
  }
  if (!e.trackPreview) {
    const preview = computeTrackPreview(e.gpsTrack, inlineLogs(e));
    if (preview) e.trackPreview = preview;
  }
  delete e.djiLogsSummary;
  return { entry: e, needsDjiHydration };
}

/** Vorschau-Segmente eines (leichten oder vollständigen) Eintrags. */
export function entryPreviewTracks(e: LogbookEntry): GpsTrackPoint[][] {
  if (e.trackPreview && e.trackPreview.length > 0) return e.trackPreview;
  return computeTrackPreview(e.gpsTrack, inlineLogs(e)) ?? [];
}

// ---------------------------------------------------------------------------
// Vom Nutzer ergänzte Daten?
// ---------------------------------------------------------------------------

/**
 * Felder, die der DJI-Import (logbookEntryFromDjiLog / assignDjiLog /
 * Akku-Verknüpfung) bzw. die App automatisch setzt. Sie verhindern weder das
 * Zusammenführen noch das Entfernen eines Doppels.
 */
const AUTO_FIELDS = new Set<string>([
  "id",
  "createdAt",
  "sessionId",
  "droneId",
  "droneName",
  "droneClass",
  "flightDate",
  "bundesland",
  "locationName",
  "latitude",
  "longitude",
  "takeoffTime",
  "landingTime",
  "flightDurationMinutes",
  "maxAltitude",
  "status",
  "djiLogs",
  "djiLog",
  "djiLogsSummary",
  "trackPreview",
  "shareToken",
  "wildlifeRescueAtFlight",
  "wildlifeRescueOrdinanceIds",
  // Karten-Snapshots erzeugt die Detailansicht beim Öffnen automatisch
  // (jederzeit neu erzeugbar) – sie zählen nicht als Nutzereingabe.
  ...BASE64_SNAPSHOT_FIELDS,
  // nur mit Wert false/leer unbedenklich (siehe unten)
  "incidentOccurred",
  "maintenanceRequired",
  "notes",
]);

function isEmptyValue(v: unknown): boolean {
  if (v == null || v === false || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** Eintrag stammt aus einem DJI-Protokoll-Import. */
export function isDjiImportEntry(e: Pick<LogbookEntry, "sessionId">): boolean {
  return typeof e.sessionId === "string" && e.sessionId.startsWith(DJI_SESSION_PREFIX);
}

/**
 * Nur durch den DJI-Import befüllt – keine vom Nutzer ergänzten Daten?
 * Blockierend ist jedes nicht-automatische Feld mit Inhalt, insbesondere:
 * eigene Notizen (≠ Import-Notiz), Vorfall (incidentOccurred/-Description),
 * Wartung (maintenanceRequired/-Notes), Debriefing, Planung, Pre-Check,
 * Schwebe-Check, Nach-Landung, GPS-Track, Verkehrslog,
 * Wetter, Geozonen/Beschränkungen, aktive Freigabe (shareEnabled).
 */
export function hasUserEnteredData(e: LogbookEntry): boolean {
  if (!isDjiImportEntry(e)) return true;
  if (e.incidentOccurred || e.maintenanceRequired) return true;
  // leichte Kopie: ausgelagerte Snapshots/GPS-Track wurden weggelassen
  if (droppedFieldsOf(e).some((f) => !(BASE64_SNAPSHOT_FIELDS as readonly string[]).includes(f))) return true;
  const notes = typeof e.notes === "string" ? e.notes.trim() : e.notes;
  if (!isEmptyValue(notes) && !(typeof notes === "string" && AUTO_NOTE_RE.test(notes))) return true;
  for (const [k, v] of Object.entries(e)) {
    if (AUTO_FIELDS.has(k)) continue;
    if (!isEmptyValue(v)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Gleiches Protokoll / Zusammenführen
// ---------------------------------------------------------------------------

/**
 * Gleiches Protokoll? Gleicher Dateiname, sonst gleicher Startzeitpunkt
 * (± 2 s) derselben Drohne. Fehlt die Seriennummer nur auf EINER Seite, reicht
 * der Zeitpunkt nicht (dann nur über den Dateinamen).
 */
export function sameDjiLog(
  a: Pick<DjiLogMeta, "fileName" | "startTs" | "aircraftSn">,
  b: Pick<DjiLogMeta, "fileName" | "startTs" | "aircraftSn">,
): boolean {
  const fa = (a.fileName || "").toLowerCase();
  const fb = (b.fileName || "").toLowerCase();
  if (fa && fa === fb) return true;
  if (a.startTs != null && b.startTs != null && Math.abs(a.startTs - b.startTs) <= 2000) {
    const sa = (a.aircraftSn || "").trim().toUpperCase();
    const sb = (b.aircraftSn || "").trim().toUpperCase();
    if (!sa && !sb) return true;
    return !!sa && !!sb && sa === sb;
  }
  return false;
}

/** Start/Ende eines Logs (ms); Ende fehlt → Start + Dauer, sonst Start. */
export function djiLogTimeRange(l: DjiLogMeta): { start: number; end: number } | null {
  const start = l.startTs;
  if (typeof start !== "number" || !Number.isFinite(start)) return null;
  let end = start;
  if (typeof l.endTs === "number" && Number.isFinite(l.endTs)) end = l.endTs;
  else if (typeof l.durationSec === "number" && l.durationSec > 0) end = start + l.durationSec * 1000;
  return { start, end: Math.max(start, end) };
}

export interface DjiMergePlan {
  keeperId: string;
  extraIds: string[];
}

/**
 * Plant das Zusammenführen getrennt importierter Flüge einer Akku-Tausch-
 * Serie (rein, ohne I/O). Zusammengeführt wird nur, wenn
 *  - beide Einträge aus dem DJI-Import stammen,
 *  - dasselbe Fluggerät (Seriennummer, sonst Name) und
 *  - die Lücke zwischen Landung des vorigen und Start des nächsten Fluges
 *    ≤ maxGapMs (Standard 20 min) ist,
 *  - und höchstens EIN Eintrag der Serie vom Nutzer ergänzte Daten trägt –
 *    dieser bleibt dann erhalten, sonst der früheste. Die anderen (reine
 *    Import-Einträge) werden aufgelöst.
 */
export function planDjiLogMerges(
  entries: readonly LogbookEntry[],
  getLogs: (e: LogbookEntry) => DjiLogMeta[],
  maxGapMs = DJI_MERGE_MAX_GAP_MS,
  maxDistM = DJI_MERGE_MAX_DISTANCE_M,
): DjiMergePlan[] {
  type Row = {
    e: LogbookEntry;
    sn?: string;
    name?: string;
    start: number;
    end: number;
    user: boolean;
    first?: LatLon;
    last?: LatLon;
  };
  const rows: Row[] = [];
  for (const e of entries) {
    if (!isDjiImportEntry(e)) continue;
    const logs = getLogs(e);
    if (logs.length === 0) continue;
    const ranges = logs.map(djiLogTimeRange);
    // Jedes Log braucht einen Zeitpunkt, sonst lässt sich die Lücke nicht prüfen.
    if (ranges.some((r) => r == null)) continue;
    const start = Math.min(...ranges.map((r) => r!.start));
    const end = Math.max(...ranges.map((r) => r!.end));
    const ordered = [...logs].sort((a, b) => (a.startTs ?? 0) - (b.startTs ?? 0));
    const firstEnds = ordered.map(djiLogEnds).find((x) => !!x);
    const lastEnds = [...ordered].reverse().map(djiLogEnds).find((x) => !!x);
    const prevSegs = (e.trackPreview ?? []).filter((seg) => seg.length > 0);
    const prevFirst = prevSegs[0]?.[0];
    const prevLastSeg = prevSegs[prevSegs.length - 1];
    const prevLast = prevLastSeg?.[prevLastSeg.length - 1];
    rows.push({
      first: firstEnds?.start ?? (gpsOk(prevFirst) ? prevFirst : undefined),
      last: lastEnds?.end ?? (gpsOk(prevLast) ? prevLast : undefined),
      e,
      sn: logs.find((l) => l.aircraftSn)?.aircraftSn,
      name: logs[0].droneName ?? e.droneName,
      start,
      end,
      user: hasUserEnteredData(e),
    });
  }
  rows.sort((a, b) => a.start - b.start);

  type Cluster = { members: Row[]; sn?: string; name?: string; end: number; hasUser: boolean; first?: LatLon; last?: LatLon };
  const clusters: Cluster[] = [];
  for (const row of rows) {
    let open: Cluster | undefined;
    for (let i = clusters.length - 1; i >= 0; i--) {
      if (sameAircraft(clusters[i].name, clusters[i].sn, row.name, row.sn)) {
        open = clusters[i];
        break;
      }
    }
    // Örtlich nah: Start dieses Logs ≤ 1 km vom letzten (oder ersten) Punkt der Serie
    const nearby =
      !!open &&
      (!row.first ||
        (!open.last && !open.first) ||
        (!!open.last && distanceM(open.last, row.first) <= maxDistM) ||
        (!!open.first && distanceM(open.first, row.first) <= maxDistM));
    const fits = !!open && nearby && row.start - open.end <= maxGapMs && (!row.user || !open.hasUser);
    if (open && fits) {
      open.members.push(row);
      if (row.last) open.last = row.last;
      if (!open.first && row.first) open.first = row.first;
      open.end = Math.max(open.end, row.end);
      open.hasUser = open.hasUser || row.user;
      if (!open.sn && row.sn) open.sn = row.sn;
    } else {
      clusters.push({ members: [row], sn: row.sn, name: row.name, end: row.end, hasUser: row.user, first: row.first, last: row.last });
    }
  }

  const plans: DjiMergePlan[] = [];
  for (const c of clusters) {
    if (c.members.length < 2) continue;
    const keeper = c.members.find((m) => m.user) ?? c.members[0];
    plans.push({
      keeperId: keeper.e.id,
      extraIds: c.members.filter((m) => m !== keeper).map((m) => m.e.id),
    });
  }
  return plans;
}

function localDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Änderungen am verbleibenden Eintrag nach dem Zusammenführen: alle Logs,
 * Start = frühester Start, Landung = späteste Landung, Flugdauer = Summe der
 * Einzeldauern, Höhe = Maximum; Drohne/Import-Notiz ergänzt.
 */
export function mergedKeeperPatch(
  keeper: LogbookEntry,
  extras: readonly LogbookEntry[],
  logs: readonly DjiLogMeta[],
): Partial<LogbookEntry> {
  const patch: Partial<LogbookEntry> = { djiLogs: [...logs], djiLog: undefined };
  const ranges = logs.map(djiLogTimeRange).filter((r): r is { start: number; end: number } => r != null);
  if (ranges.length > 0) {
    const start = Math.min(...ranges.map((r) => r.start));
    const end = Math.max(...ranges.map((r) => r.end));
    patch.takeoffTime = new Date(start).toISOString();
    if (end > start) patch.landingTime = new Date(end).toISOString();
    patch.flightDate = localDate(start);
  }
  let sumSec = 0;
  for (const l of logs) {
    if (typeof l.durationSec === "number" && l.durationSec > 0) sumSec += l.durationSec;
    else {
      const r = djiLogTimeRange(l);
      if (r) sumSec += (r.end - r.start) / 1000;
    }
  }
  if (sumSec > 0) patch.flightDurationMinutes = Math.max(1, Math.round(sumSec / 60));
  const alts = [
    keeper.maxAltitude,
    ...extras.map((x) => x.maxAltitude),
    ...logs.map((l) => (l.maxAltitudeM != null ? Math.round(l.maxAltitudeM) : undefined)),
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (alts.length > 0) patch.maxAltitude = Math.max(...alts);
  if (!keeper.droneId) {
    const withDrone = extras.find((x) => !!x.droneId);
    if (withDrone) {
      patch.droneId = withDrone.droneId;
      patch.droneName = withDrone.droneName;
      patch.droneClass = withDrone.droneClass;
    }
  }
  if (typeof keeper.notes === "string" && AUTO_NOTE_RE.test(keeper.notes.trim())) {
    const names = logs.map((l) => l.fileName).filter(Boolean);
    patch.notes =
      names.length > 1
        ? `Aus DJI-Flugprotokollen importiert (${names.join(", ")}).`
        : `Aus DJI-Flugprotokoll importiert (${names[0] ?? ""}).`;
  }
  return patch;
}
