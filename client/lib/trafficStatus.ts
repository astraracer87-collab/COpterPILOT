import { getAggregatorStatus } from "./traffic/aggregator";
import type { DataSource, SourceStatus } from "./opensky";

export interface TrafficStatus {
  started: boolean;
  pollIntervalMs: number;
  lastPollAt: number;
  lastSnapshotAt: number;
  latestSnapshotAgeSec: number;
  pollCycle: number;
  lastCycleDurationMs: number;
  avgCycleDurationMs: number;
  storedAircraft: number;
  sourceStatus: Record<DataSource, SourceStatus>;
  sourceLastOk: Record<DataSource, number>;
  ogn: { connected: boolean; total: number };
}

export const SOURCE_LABELS: Record<DataSource, string> = {
  opensky: "OpenSky",
  adsbfi: "adsb.fi",
  adsbone: "adsb.one",
  airplaneslive: "airplanes.live",
  adsblol: "adsb.lol",
  ogn: "OGN",
  fr24: "FR24",
};

// Muss synchron mit ENABLED_DATA_SOURCES in lib/traffic/aggregator.ts gehalten
// werden. Nur diese Quellen werden aktiv gepollt und sollten in der UI auftauchen.
export const ENABLED_SOURCES: DataSource[] = [
  "ogn",
  "airplaneslive",
  "adsblol",
  "adsbfi",
  "fr24",
];

export const ALL_SOURCES: DataSource[] = ENABLED_SOURCES;

/**
 * Status der Verkehrsquellen. Früher vom Server (/api/traffic/v2/status), jetzt
 * direkt aus dem clientseitigen Aggregator. Liefert null, solange noch keine
 * einzige Abfrage lief (kein Radar geöffnet) — dann gibt es nichts zu melden.
 */
export async function fetchTrafficStatus(_signal?: AbortSignal): Promise<TrafficStatus | null> {
  try {
    const s = getAggregatorStatus();
    if (!s.started) return null;
    return s;
  } catch {
    return null;
  }
}

// ---- Shared singleton poller ----------------------------------------------
// Eine einzige Status-Kadenz für die ganze App, unabhängig davon, wie viele
// SourceHealthIndicator-Instanzen montiert sind. Der Status wird nur noch lokal
// aus dem clientseitigen Aggregator gelesen (kein Netzwerkzugriff), daher
// genügt ein kurzes Intervall.

const POLL_INTERVAL_MS = 15_000;

type Listener = (s: TrafficStatus | null) => void;

let listeners = new Set<Listener>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
let cachedStatus: TrafficStatus | null = null;
let lastFetchAt = 0;

async function pollOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const s = await fetchTrafficStatus();
    lastFetchAt = Date.now();
    if (s) {
      cachedStatus = s;
      for (const l of listeners) l(s);
    }
  })();
  try { await inFlight; } finally { inFlight = null; }
}

export function subscribeTrafficStatus(listener: Listener): () => void {
  listeners.add(listener);
  // Immediately replay the cached value so new mounts don't have to wait.
  if (cachedStatus) listener(cachedStatus);
  // Kick off a fetch if we have nothing cached or it is stale.
  if (!cachedStatus || Date.now() - lastFetchAt > POLL_INTERVAL_MS) {
    pollOnce();
  }
  if (intervalHandle == null) {
    intervalHandle = setInterval(pollOnce, POLL_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalHandle != null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };
}

export function getCachedTrafficStatus(): TrafficStatus | null {
  return cachedStatus;
}

export interface DegradedSource {
  source: DataSource;
  status: SourceStatus;
  lastOk: number;
  ageMs: number | null;
}

/**
 * Returns the list of sources that are not currently OK and have not had
 * a successful poll within `thresholdMs`. `lastOk = 0` means "never".
 */
export function getDegradedSources(
  status: TrafficStatus,
  thresholdMs: number = 5 * 60 * 1000,
  now: number = Date.now(),
): DegradedSource[] {
  const out: DegradedSource[] = [];
  for (const src of ALL_SOURCES) {
    const st = status.sourceStatus?.[src];
    const lastOk = status.sourceLastOk?.[src] ?? 0;
    if (st === "ok") continue;
    const ageMs = lastOk > 0 ? now - lastOk : null;
    if (ageMs == null || ageMs >= thresholdMs) {
      out.push({ source: src, status: st ?? "error", lastOk, ageMs });
    }
  }
  return out;
}

export function formatLastOkRelative(lastOk: number, now: number = Date.now()): string {
  if (!lastOk || lastOk <= 0) return "noch nie";
  const ageSec = Math.max(0, Math.round((now - lastOk) / 1000));
  if (ageSec < 60) return `vor ${ageSec} s`;
  const ageMin = Math.round(ageSec / 60);
  if (ageMin < 60) return `vor ${ageMin} min`;
  const ageHr = Math.round(ageMin / 60);
  if (ageHr < 24) return `vor ${ageHr} h`;
  const ageDay = Math.round(ageHr / 24);
  return `vor ${ageDay} d`;
}

export function getStatusLabel(status: SourceStatus): string {
  switch (status) {
    case "ok": return "OK";
    case "timeout": return "Timeout";
    case "error": return "Fehler";
  }
}
