import {
  terrainEstimateFromSamples,
  terrainSamplePoints,
  type TerrainEstimate,
} from "../../shared/geozoneAltitudeFilter";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { aircraftMslM, type AltitudeSource } from "./traffic/altitude";

const OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
// Hängt Open-Meteo (z. B. schlechter Empfang am Flugplatz), sollen Aufrufer
// nicht ewig warten — Timeout → catch → null bzw. Cache (bisheriges Verhalten
// bei Fehlern).
const ELEVATION_FETCH_TIMEOUT_MS = 8000;

const MAX_CACHE_SIZE = 2000;
const elevationCache = new Map<string, number>();

function pruneCache() {
  if (elevationCache.size <= MAX_CACHE_SIZE) return;
  const excess = elevationCache.size - Math.floor(MAX_CACHE_SIZE * 0.75);
  const iter = elevationCache.keys();
  for (let i = 0; i < excess; i++) {
    const next = iter.next();
    if (next.done) break;
    elevationCache.delete(next.value);
  }
}

function coordKey(lat: number, lon: number): string {
  return `${(Math.round(lat * 1000) / 1000).toFixed(3)},${(Math.round(lon * 1000) / 1000).toFixed(3)}`;
}

export async function fetchElevation(lat: number, lon: number): Promise<number | null> {
  const key = coordKey(lat, lon);
  const cached = elevationCache.get(key);
  if (cached != null) return cached;

  try {
    const response = await fetchWithTimeout(
      `${OPEN_METEO_ELEVATION_URL}?latitude=${lat}&longitude=${lon}`,
      {},
      ELEVATION_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const data = await response.json();
    const elev = data?.elevation?.[0];
    if (elev != null && typeof elev === "number") {
      elevationCache.set(key, elev);
      pruneCache();
      return elev;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchBatchElevations(
  coords: { lat: number; lon: number }[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (coords.length === 0) return result;

  const uniqueCoords: { lat: number; lon: number; key: string }[] = [];
  const needFetch: { lat: number; lon: number; key: string }[] = [];

  for (const c of coords) {
    const key = coordKey(c.lat, c.lon);
    const cached = elevationCache.get(key);
    if (cached != null) {
      result.set(key, cached);
    } else if (!uniqueCoords.some((u) => u.key === key)) {
      uniqueCoords.push({ ...c, key });
      needFetch.push({ ...c, key });
    }
  }

  if (needFetch.length === 0) return result;

  const MAX_BATCH = 100;
  for (let i = 0; i < needFetch.length; i += MAX_BATCH) {
    const batch = needFetch.slice(i, i + MAX_BATCH);
    const lats = batch.map((c) => c.lat.toFixed(4)).join(",");
    const lons = batch.map((c) => c.lon.toFixed(4)).join(",");

    try {
      const response = await fetchWithTimeout(
        `${OPEN_METEO_ELEVATION_URL}?latitude=${lats}&longitude=${lons}`,
        {},
        ELEVATION_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) continue;
      const data = await response.json();
      const elevations: number[] = data?.elevation ?? [];

      for (let j = 0; j < batch.length && j < elevations.length; j++) {
        const elev = elevations[j];
        if (elev != null && typeof elev === "number") {
          elevationCache.set(batch[j].key, elev);
          result.set(batch[j].key, elev);
        }
      }
      pruneCache();
    } catch {
      // continue silently
    }
  }

  return result;
}

export function getElevationFromCache(lat: number, lon: number): number | null {
  const key = coordKey(lat, lon);
  return elevationCache.get(key) ?? null;
}

export function getCachedElevationKey(lat: number, lon: number): string {
  return coordKey(lat, lon);
}

export function clearElevationCache(): void {
  elevationCache.clear();
  terrainEstimateCache.clear();
  // Leerer Cache → nächste Anreicherung darf sofort wieder abrufen.
  lastFullEnrichTime = 0;
}

// Drosselung der Sammelabfrage für den Live-Verkehr (AGL): höchstens ein
// Open-Meteo-Abruf je 15 s; dazwischen nur Cache (Position auf 3 Nachkomma-
// stellen ≈ 110 m gerundet). Genutzt vom Verkehrs-Aggregator
// (client/lib/traffic/aggregator.ts).
let lastFullEnrichTime = 0;
export const FULL_ENRICH_INTERVAL_MS = 15000;

export async function enrichAircraftWithElevation<T extends AltitudeSource>(
  aircraft: T[]
): Promise<(T & { aglAltitude: number | null; groundElevation: number | null })[]> {
  const now = Date.now();
  const useFullFetch = now - lastFullEnrichTime >= FULL_ENRICH_INTERVAL_MS;
  // Alles schon im Cache → kein Abruf nötig und das Intervall nicht verbrauchen
  // (sonst müssten neu hinzugekommene Positionen weitere 15 s warten).
  const needsFetch = aircraft.some((ac) => getElevationFromCache(ac.latitude, ac.longitude) == null);

  if (useFullFetch && needsFetch) {
    const coords = aircraft.map((ac) => ({ lat: ac.latitude, lon: ac.longitude }));
    try {
      await fetchBatchElevations(coords);
      lastFullEnrichTime = now;
    } catch {}
  }

  return aircraft.map((ac) => {
    const groundElev = getElevationFromCache(ac.latitude, ac.longitude);
    const mslAlt = aircraftMslM(ac);
    const agl = groundElev != null && mslAlt != null ? Math.max(0, mslAlt - groundElev) : null;
    return { ...ac, groundElevation: groundElev, aglAltitude: agl };
  });
}

// ---------------------------------------------------------------------------
// Geländeschätzung im Planungsradius (Höhenfilter, Umbau B3)
//
// Mittelpunkt + je 8 Punkte auf Radius und halbem Radius in EINEM Open-Meteo-
// Aufruf (die API nimmt mehrere Koordinaten). Einzelpunkte landen im
// Koordinaten-Cache oben, die Schätzung zusätzlich in einem eigenen Cache.
// Offline/Fehler: letzte Schätzung für denselben Ort, sonst was der Cache
// hergibt (nur Mittelpunkt -> shared/geozoneAltitudeFilter rechnet Mitte +
// 150 m), sonst null (MSL-Zonen bleiben dann sichtbar). Die Caches leben nur im
// Speicher (App-Neustart offline = keine Geländehöhe = nichts ausgeblendet).
// ---------------------------------------------------------------------------

const terrainEstimateCache = new Map<string, TerrainEstimate>();

function terrainKey(lat: number, lon: number, radiusM: number): string {
  return `${coordKey(lat, lon)}|${Math.round(Math.max(0, radiusM) / 100)}`;
}

export async function fetchTerrainEstimate(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<TerrainEstimate | null> {
  const key = terrainKey(lat, lon, radiusM);
  const points = terrainSamplePoints(lat, lon, radiusM);
  let values: (number | null)[];
  try {
    const map = await fetchBatchElevations(points);
    values = points.map((p) => map.get(coordKey(p.lat, p.lon)) ?? null);
  } catch {
    values = points.map((p) => getElevationFromCache(p.lat, p.lon));
  }
  const fresh = terrainEstimateFromSamples(values[0], values.slice(1));
  const cached = terrainEstimateCache.get(key) ?? null;
  // Eine vollständigere frühere Schätzung schlägt eine lückenhafte (offline).
  const best = cached && (!fresh || cached.samples > fresh.samples) ? cached : fresh;
  if (best) {
    terrainEstimateCache.set(key, best);
    if (terrainEstimateCache.size > 200) {
      const first = terrainEstimateCache.keys().next();
      if (!first.done) terrainEstimateCache.delete(first.value);
    }
  }
  return best;
}
