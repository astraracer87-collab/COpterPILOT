// Geometrie für temporäre dipul-Beschränkungen (DE, NOTAM-Reiter).
//
// Die dipul-geoapi (`/api/geoapi/dipul/v4/affectedAreas`) liefert seit 2026
// nur noch die Sachdaten (extRef, Namen, Zeiten, Höhen) – ohne `geometry`.
// Die exakte Fläche steht im dipul-WFS:
//   * `temporaere_betriebseinschraenkungen` – alle temporären Gebiete inkl.
//     ED-R, NOTAM-Gebiete und Veranstaltungen (Join über
//     properties.external_reference == extRef, Fallback Name),
//   * `flugbeschraenkungsgebiete` – Rückfall nur für ED-R-Einträge, die im
//     temporären Layer fehlen (Join über den Namen ohne „ED-R“/Nummer).
// RN-frei (unter tsx testbar); Kreise (Punkt + Radius) werden über
// shared/geozoneKit zu Polygonen verdichtet.

import { densifyCircle, type LonLat } from "../../shared/geozoneKit/aixm";

export const DIPUL_OWS_URL = "https://uas-betrieb.de/geoservices/dipul/ows";
export const DIPUL_TEMP_WFS_LAYER = "temporaere_betriebseinschraenkungen";
export const DIPUL_EDR_WFS_LAYER = "flugbeschraenkungsgebiete";

type Ring = [number, number][];

export interface DipulZoneGeometry {
  centerLat: number | null;
  centerLon: number | null;
  radiusM: number | null;
  polygonRings: Ring[] | null;
  polygonGroups: Ring[][] | null;
}

/** Felder einer Beschränkung, die dieses Modul liest bzw. ergänzt. */
export interface DipulGeometryTarget {
  centerLat: number | null;
  centerLon: number | null;
  radiusM: number | null;
  polygonRings: Ring[] | null;
  polygonGroups?: Ring[][] | null;
  extRef: string;
  name: string;
  names?: string[];
  genNames?: string[];
}

export function dipulWfsLayerUrl(layer: string): string {
  const p = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: `dipul:${layer}`,
    OUTPUTFORMAT: "application/json",
    SRSNAME: "EPSG:4326",
  });
  return `${DIPUL_OWS_URL}?${p}`;
}

const isLonLat = (c: unknown): c is number[] =>
  Array.isArray(c) &&
  c.length >= 2 &&
  Number.isFinite(c[0]) &&
  Number.isFinite(c[1]) &&
  Math.abs(c[0] as number) <= 180 &&
  Math.abs(c[1] as number) <= 90;

/** GeoJSON-Ring [lon,lat] → [lat,lon]; null, wenn nicht in WGS84 (z. B. EPSG:25832/3857). */
function toLatLonRing(ring: unknown): Ring | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  if (!ring.every(isLonLat)) return null;
  return (ring as number[][]).map((c) => [c[1], c[0]] as [number, number]);
}

function polygonToGroup(poly: unknown): Ring[] | null {
  if (!Array.isArray(poly)) return null;
  const outer = toLatLonRing(poly[0]);
  if (!outer) return null;
  const holes = poly.slice(1).map(toLatLonRing).filter((r): r is Ring => r != null);
  return [outer, ...holes];
}

/**
 * Wandelt eine GeoJSON-Geometrie (Point/Polygon/MultiPolygon/GeometryCollection)
 * in das Zonenformat ([lat,lon]-Ringe, gruppiert mit Löchern). Ein Punkt mit
 * Radius wird zum Kreis-Polygon; ein Punkt ohne Radius bleibt Mittelpunkt.
 */
export function geometryFromGeoJson(geo: any, radiusM?: number | null): DipulZoneGeometry | null {
  if (!geo || typeof geo !== "object") return null;
  const groups: Ring[][] = [];
  let point: number[] | null = null;
  const visit = (g: any) => {
    if (!g || typeof g !== "object") return;
    if (g.type === "Polygon") {
      const grp = polygonToGroup(g.coordinates);
      if (grp) groups.push(grp);
    } else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
      for (const poly of g.coordinates) {
        const grp = polygonToGroup(poly);
        if (grp) groups.push(grp);
      }
    } else if (g.type === "Point" && isLonLat(g.coordinates)) {
      point = point ?? (g.coordinates as number[]);
    } else if (g.type === "GeometryCollection" && Array.isArray(g.geometries)) {
      g.geometries.forEach(visit);
    }
  };
  visit(geo);
  const p = point as number[] | null;
  if (groups.length === 0 && p && radiusM != null && radiusM > 0) {
    const circle = toLatLonRing(densifyCircle([p[0], p[1]] as LonLat, radiusM));
    if (circle) groups.push([circle]);
  }
  if (groups.length > 0) {
    let sLat = 0, sLon = 0, n = 0;
    for (const g of groups) for (const [lat, lon] of g[0]) { sLat += lat; sLon += lon; n++; }
    return {
      centerLat: sLat / n,
      centerLon: sLon / n,
      radiusM: radiusM ?? null,
      polygonRings: groups.map((g) => g[0]),
      polygonGroups: groups,
    };
  }
  if (p) return { centerLat: p[1], centerLon: p[0], radiusM: radiusM ?? null, polygonRings: null, polygonGroups: null };
  return null;
}

/** Hat die Beschränkung bereits eine zeichenbare Fläche oder Position? */
export function hasDipulGeometry(r: Partial<DipulGeometryTarget>): boolean {
  if (r.polygonGroups?.some((g) => (g[0]?.length ?? 0) >= 3)) return true;
  if (r.polygonRings?.some((ring) => ring.length >= 3)) return true;
  return r.centerLat != null && r.centerLon != null && Number.isFinite(r.centerLat) && Number.isFinite(r.centerLon);
}

const normName = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** „ED-R 20 Greifswald/Lubmin“ → „greifswald lubmin“ (Name im ED-R-Layer). */
const edrBaseName = (s: string) => normName(s.replace(/^\s*ED-R\s*/i, "").replace(/^\d+[a-z]?\s+/i, ""));

function featureRef(f: any): string {
  const ref = f?.properties?.external_reference ?? f?.properties?.extRef;
  if (ref) return String(ref);
  const id = String(f?.id ?? "");
  return id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
}

function featureNames(f: any): string[] {
  const p = f?.properties ?? {};
  return [p.name, p.generated_name_de, p.generated_name_DE, p.generated_name_en, p.generated_name_EN]
    .filter((n) => n != null && n !== "")
    .map(String);
}

function featureRadius(f: any): number | null {
  const r = Number(f?.properties?.radius);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/**
 * Ergänzt fehlende Geometrien aus WFS-Features. Bestehende Geometrie bleibt
 * unverändert. Liefert neue Objekte für ergänzte Einträge, sonst die alten.
 */
export function attachDipulTempGeometry<T extends DipulGeometryTarget>(
  list: T[],
  tempFeatures: any[],
  edrFeatures: any[] = [],
): T[] {
  const byRef = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const f of tempFeatures ?? []) {
    if (!f?.geometry) continue;
    const ref = featureRef(f);
    if (ref && !byRef.has(ref)) byRef.set(ref, f);
    for (const n of featureNames(f)) {
      const k = normName(n);
      // Mehrdeutige Namen (z. B. drei „ED-R Wilhelmshaven“) nicht per Name joinen.
      if (byName.has(k) && byName.get(k) !== f) byName.set(k, null);
      else byName.set(k, f);
    }
  }
  const edrByName = new Map<string, any>();
  for (const f of edrFeatures ?? []) {
    if (!f?.geometry) continue;
    for (const n of featureNames(f)) {
      const k = edrBaseName(n);
      if (edrByName.has(k) && edrByName.get(k) !== f) edrByName.set(k, null);
      else edrByName.set(k, f);
    }
  }
  return list.map((r) => {
    if (hasDipulGeometry(r)) return r;
    const names = [r.name, ...(r.names ?? []), ...(r.genNames ?? [])].filter(Boolean);
    let f = (r.extRef && byRef.get(r.extRef)) || null;
    if (!f) for (const n of names) { f = byName.get(normName(n)) || null; if (f) break; }
    if (!f && /^\s*ED-R\b/i.test(r.name)) {
      for (const n of names) { f = edrByName.get(edrBaseName(n)) || null; if (f) break; }
    }
    if (!f) return r;
    const geom = geometryFromGeoJson(f.geometry, r.radiusM ?? featureRadius(f));
    if (!geom) return r;
    return { ...r, ...geom, radiusM: r.radiusM ?? geom.radiusM };
  });
}

async function fetchLayerFeatures(layer: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(dipulWfsLayerUrl(layer), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data?.features) ? data.features : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const LAYER_TTL_MS = 5 * 60 * 1000;
const layerCache = new Map<string, { ts: number; features: any[] }>();

async function cachedLayer(layer: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<any[]> {
  const hit = layerCache.get(layer);
  if (hit && Date.now() - hit.ts < LAYER_TTL_MS) return hit.features;
  const features = await fetchLayerFeatures(layer, fetchImpl, timeoutMs);
  if (features.length > 0) layerCache.set(layer, { ts: Date.now(), features });
  return features;
}

/** Nur für Tests: Layer-Cache leeren. */
export function clearDipulTempGeometryCache(): void {
  layerCache.clear();
}

/**
 * Lädt bei Bedarf die dipul-WFS-Layer und ergänzt fehlende Geometrien in
 * active/upcoming. Wirft nie – bei Netzfehlern bleibt das Ergebnis wie es ist.
 */
export async function enrichDipulTempGeometry<T extends DipulGeometryTarget, R extends { active: T[]; upcoming: T[] }>(
  result: R,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<R> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const missing = () => [...result.active, ...result.upcoming].filter((r) => !hasDipulGeometry(r));
  if (missing().length === 0) return result;
  try {
    const temp = await cachedLayer(DIPUL_TEMP_WFS_LAYER, fetchImpl, timeoutMs);
    let out = {
      ...result,
      active: attachDipulTempGeometry(result.active, temp),
      upcoming: attachDipulTempGeometry(result.upcoming, temp),
    };
    const stillEdr = [...out.active, ...out.upcoming].some((r) => !hasDipulGeometry(r) && /^\s*ED-R\b/i.test(r.name));
    if (stillEdr) {
      const edr = await cachedLayer(DIPUL_EDR_WFS_LAYER, fetchImpl, timeoutMs);
      out = {
        ...out,
        active: attachDipulTempGeometry(out.active, [], edr),
        upcoming: attachDipulTempGeometry(out.upcoming, [], edr),
      };
    }
    return out as R;
  } catch {
    return result;
  }
}
