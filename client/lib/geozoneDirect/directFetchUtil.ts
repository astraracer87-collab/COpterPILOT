// Kleine, React-Native-freie Abruf-/Nachbearbeitungshelfer für die neuen
// Pure-ED-269-Quellen (FI, NO). Absichtlich unabhängig von ed269Sources.ts,
// damit kein Import-Zyklus entsteht, wenn ed269Sources.ts diese Quellen
// einbindet. Verhalten entspricht fetchJson/finalize dort.
import type { GeoFeature } from "./ed269Sources";

export const DIRECT_FETCH_TIMEOUT_MS = 60_000;

async function fetchTextWithTimeout(url: string, accept: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: accept },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Body innerhalb des Timeouts vollständig lesen.
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function directFetchJson(url: string, timeoutMs: number = DIRECT_FETCH_TIMEOUT_MS): Promise<any> {
  return JSON.parse(await fetchTextWithTimeout(url, "application/json", timeoutMs));
}

export async function directFetchText(url: string, timeoutMs: number = DIRECT_FETCH_TIMEOUT_MS): Promise<string> {
  return await fetchTextWithTimeout(url, "text/html,*/*", timeoutMs);
}

export function featureBbox(
  geometry: { type: string; coordinates: unknown } | null | undefined,
): [number, number, number, number] | null {
  if (!geometry) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number, y = c[1] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else c.forEach(visit);
  };
  visit(geometry.coordinates);
  if (!isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

/** bbox ergänzen + Land taggen (wie finalize() in ed269Sources.ts). */
export function finalizeDirectFeatures(features: GeoFeature[], country: string): GeoFeature[] {
  const out: GeoFeature[] = [];
  for (const f of features) {
    if (!f || !f.geometry) continue;
    if (!f.bbox) {
      const bb = featureBbox(f.geometry);
      if (bb) f.bbox = bb;
    }
    f.properties = { ...(f.properties || {}), _country: country };
    out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Teil-Abdeckung eines Abrufs (z. B. SI: eine Ebene fehlt, NO: eine /data/-Datei)
// ---------------------------------------------------------------------------

/**
 * Begleitinformation eines Länder-Abrufs, ohne die Rückgabe (GeoFeature[]) zu
 * ändern: ein Fetcher hängt sie mit `withFetchCoverage` an sein Ergebnis-Array.
 * ed269Store übernimmt `partialNote` in den Bestand (Abdeckung „partial“ mit
 * diesem deutschen Hinweis → Befund unbekannt, ≥ CAUTION) und übernimmt aus
 * dem vorherigen Bestand die Zonen, für die `keepPrevious` true liefert (die
 * ausgefallene Teilquelle verschwindet so nicht still).
 */
export interface DirectFetchCoverage {
  partialNote?: string;
  keepPrevious?: (props: Record<string, unknown>) => boolean;
}

const FETCH_COVERAGE = new WeakMap<object, DirectFetchCoverage>();

/** Begleitinformation an ein Ergebnis-Array hängen (leer/undefined = nichts). */
export function withFetchCoverage<T extends object>(features: T, cov: DirectFetchCoverage | null | undefined): T {
  if (cov && (cov.partialNote || cov.keepPrevious)) FETCH_COVERAGE.set(features, cov);
  return features;
}

/** Begleitinformation eines Ergebnis-Arrays (falls angehängt). */
export function fetchCoverageOf(features: object | null | undefined): DirectFetchCoverage | undefined {
  return features ? FETCH_COVERAGE.get(features) : undefined;
}

/**
 * Neue Features + aus dem vorherigen Bestand übernommene (keepPrevious) –
 * ohne Doppelungen über `identifier`. Übernommene Zonen tragen
 * `_carriedOver: true` (Stand des vorherigen Abrufs).
 */
export function mergeCarriedOverFeatures(
  features: GeoFeature[],
  previous: readonly GeoFeature[] | null | undefined,
  keepPrevious: ((props: Record<string, unknown>) => boolean) | undefined,
): GeoFeature[] {
  if (!keepPrevious || !previous || previous.length === 0) return features;
  const ids = new Set(features.map((f) => String((f.properties as any)?.identifier ?? "")).filter(Boolean));
  const carried: GeoFeature[] = [];
  for (const f of previous) {
    const p = (f?.properties ?? {}) as Record<string, unknown>;
    if (!keepPrevious(p)) continue;
    const id = String(p.identifier ?? "");
    if (id && ids.has(id)) continue;
    carried.push({ ...f, properties: { ...p, _carriedOver: true } });
  }
  return carried.length ? [...features, ...carried] : features;
}
