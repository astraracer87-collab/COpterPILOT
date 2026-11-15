// Ersatz-Mittelpunkt für Karten ohne Standort (Product Owner: „immer eine
// Karte zeigen“). Reihenfolge:
//   1. aktueller GPS-Standort
//   2. zuletzt bekannte Position (auf dem Gerät gespeichert, auch über
//      Neustarts – siehe saveLastKnownPosition)
//   3. Mitte des ersten aktiven Landes (Länder-Nutzung, Reihenfolge der
//      Einstellungen)
//   4. Deutschland
//
// RN-frei (unter tsx testbar): AsyncStorage wird lazy geladen, Speicher und
// Uhr sind für Tests ersetzbar.

export type MapCenterSource = "gps" | "last" | "country" | "default";

export interface StoredPosition {
  latitude: number;
  longitude: number;
  /** Zeitpunkt der Messung (ms) */
  timestamp: number;
}

export interface MapCenter {
  latitude: number;
  longitude: number;
  /** Ausdehnung (Grad Breite), passend zur Quelle */
  latitudeDelta: number;
  source: MapCenterSource;
  /** Land bei source = "country" bzw. "default" */
  iso?: string;
}

/** Ungefähre Landesmitte und Ausdehnung (Grad Breite) je Land der Länder-Nutzung. */
export const COUNTRY_CENTERS: Readonly<Record<string, { lat: number; lon: number; delta: number }>> = {
  DE: { lat: 51.16, lon: 10.45, delta: 8 },
  AT: { lat: 47.6, lon: 14.1, delta: 4 },
  CH: { lat: 46.8, lon: 8.23, delta: 3 },
  LI: { lat: 47.16, lon: 9.55, delta: 0.4 },
  LU: { lat: 49.76, lon: 6.09, delta: 1 },
  NL: { lat: 52.2, lon: 5.4, delta: 3 },
  BE: { lat: 50.64, lon: 4.67, delta: 2.5 },
  FR: { lat: 46.6, lon: 2.4, delta: 10 },
  PL: { lat: 52.1, lon: 19.4, delta: 7 },
  CZ: { lat: 49.8, lon: 15.47, delta: 3.5 },
  DK: { lat: 56.0, lon: 10.0, delta: 4 },
  IT: { lat: 42.8, lon: 12.6, delta: 10 },
  ES: { lat: 40.2, lon: -3.7, delta: 9 },
  SE: { lat: 62.0, lon: 15.0, delta: 14 },
  PT: { lat: 39.6, lon: -8.0, delta: 6 },
  IE: { lat: 53.4, lon: -8.0, delta: 4 },
  GB: { lat: 54.0, lon: -2.5, delta: 10 },
  GR: { lat: 39.0, lon: 22.9, delta: 7 },
  FI: { lat: 64.5, lon: 26.0, delta: 12 },
  HR: { lat: 45.1, lon: 15.5, delta: 4 },
  BG: { lat: 42.7, lon: 25.4, delta: 4 },
  RO: { lat: 45.9, lon: 24.9, delta: 6 },
  HU: { lat: 47.16, lon: 19.5, delta: 3.5 },
  SK: { lat: 48.7, lon: 19.6, delta: 2.5 },
  SI: { lat: 46.15, lon: 14.99, delta: 1.8 },
  LT: { lat: 55.2, lon: 23.9, delta: 3 },
  LV: { lat: 56.9, lon: 24.6, delta: 3 },
  EE: { lat: 58.6, lon: 25.0, delta: 3 },
  CY: { lat: 35.1, lon: 33.4, delta: 1.6 },
  MT: { lat: 35.92, lon: 14.4, delta: 0.5 },
  NO: { lat: 64.5, lon: 12.0, delta: 14 },
  IS: { lat: 64.9, lon: -18.6, delta: 5 },
};

export const DEFAULT_CENTER_ISO = "DE";
/** Ausdehnung um eine zuletzt bekannte Position (wie beim GPS-Standort ca. 20 km). */
export const LAST_KNOWN_DELTA = 0.2;

function validCoord(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

export function isValidStoredPosition(p: unknown): p is StoredPosition {
  const q = p as StoredPosition | null;
  return !!q && validCoord(q.latitude, q.longitude);
}

/** Mittelpunkt nach der Reihenfolge GPS → letzte Position → erstes aktives Land → Deutschland. */
export function resolveMapCenter(input: {
  gps?: { latitude: number; longitude: number } | null;
  lastKnown?: StoredPosition | null;
  /** aktive Länder (ISO) in der Reihenfolge der Einstellungen */
  activeCountries?: readonly string[];
  gpsDelta?: number;
}): MapCenter {
  const g = input.gps;
  if (g && validCoord(g.latitude, g.longitude)) {
    return { latitude: g.latitude, longitude: g.longitude, latitudeDelta: input.gpsDelta ?? LAST_KNOWN_DELTA, source: "gps" };
  }
  const l = input.lastKnown;
  if (l && isValidStoredPosition(l)) {
    return { latitude: l.latitude, longitude: l.longitude, latitudeDelta: LAST_KNOWN_DELTA, source: "last" };
  }
  for (const iso of input.activeCountries ?? []) {
    const c = COUNTRY_CENTERS[String(iso).toUpperCase()];
    if (c) return { latitude: c.lat, longitude: c.lon, latitudeDelta: c.delta, source: "country", iso: String(iso).toUpperCase() };
  }
  const d = COUNTRY_CENTERS[DEFAULT_CENTER_ISO];
  return { latitude: d.lat, longitude: d.lon, latitudeDelta: d.delta, source: "default", iso: DEFAULT_CENTER_ISO };
}

/** Unaufdringlicher Hinweis für die Karte; null bei echtem Standort. */
export function mapCenterHint(source: MapCenterSource): string | null {
  if (source === "gps") return null;
  if (source === "last") return "Kein Standort – Karte zeigt letzte bekannte Position";
  return "Kein Standort – Karte zeigt Landesübersicht";
}

// ---------------------------------------------------------------------------
// Speicher der zuletzt bekannten Position
// ---------------------------------------------------------------------------

export const LAST_POSITION_STORAGE_KEY = "@copterpilot/last_known_position_v1";

type KvStorage = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };

let storageOverride: KvStorage | null | undefined;
function storage(): KvStorage | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage");
    return (mod?.default ?? mod) as KvStorage;
  } catch {
    return null;
  }
}

let memoryPos: StoredPosition | null = null;
let loaded = false;
let lastWriteAt = 0;
let lastWritten: StoredPosition | null = null;

function distanceM(a: StoredPosition, b: StoredPosition): number {
  const dLat = (a.latitude - b.latitude) * 111320;
  const dLon = (a.longitude - b.longitude) * 111320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Zuletzt bekannte Position (Speicher → Gerät); null = noch nie ein Standort. */
export async function loadLastKnownPosition(): Promise<StoredPosition | null> {
  if (memoryPos || loaded) return memoryPos;
  try {
    const raw = await storage()?.getItem(LAST_POSITION_STORAGE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (isValidStoredPosition(p) && !memoryPos) {
      memoryPos = { latitude: p.latitude, longitude: p.longitude, timestamp: Number(p.timestamp) || 0 };
      lastWritten = memoryPos;
    }
  } catch {}
  loaded = true;
  return memoryPos;
}

/** Synchron: Position aus dem Speicher, falls schon geladen. */
export function peekLastKnownPosition(): StoredPosition | null {
  return memoryPos;
}

/**
 * Neue Position merken. Geschrieben wird gedrosselt (höchstens alle 60 s, außer
 * die Position hat sich um mehr als 500 m geändert), damit ein laufender
 * GPS-Watch den Speicher nicht dauernd beschreibt.
 */
export async function saveLastKnownPosition(latitude: number, longitude: number, timestamp: number = Date.now()): Promise<void> {
  if (!validCoord(latitude, longitude)) return;
  const p: StoredPosition = { latitude, longitude, timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() };
  memoryPos = p;
  const now = Date.now();
  const moved = lastWritten ? distanceM(p, lastWritten) : Infinity;
  if (lastWritten && now - lastWriteAt < 60_000 && moved < 500) return;
  lastWriteAt = now;
  lastWritten = p;
  try {
    await storage()?.setItem(LAST_POSITION_STORAGE_KEY, JSON.stringify(p));
  } catch {}
}

/** Nur für Tests: Speicher ersetzen und Zustand leeren (undefined = AsyncStorage). */
export function __resetLastKnownPositionForTests(st?: KvStorage | null): void {
  storageOverride = st;
  memoryPos = null;
  loaded = false;
  lastWriteAt = 0;
  lastWritten = null;
}
