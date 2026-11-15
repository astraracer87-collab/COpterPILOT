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
