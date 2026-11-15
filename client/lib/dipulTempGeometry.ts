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
  /**
   * Warum (noch) keine Fläche vorliegt – nur gesetzt, wenn die Anreicherung
   * erfolglos war (Kartendienst nicht erreichbar bzw. dipul hat keine Fläche).
   */
  geometryNote?: string | null;
}

/**
 * Optionaler dauerhafter Speicher für die zuletzt erfolgreich geladenen
 * WFS-Layer (App: AsyncStorage). Damit lassen sich auch gespeicherte bzw.
 * offline angezeigte Listen nachträglich mit Flächen versehen.
 */
export interface DipulFeatureStore {
  load(layer: string): Promise<any[] | null>;
  save(layer: string, features: any[]): Promise<void>;
}

export interface DipulLayerResult {
  features: any[];
  /** live = gerade geladen, memory = Sitzungs-Cache, stored = gespeicherter Stand, none = nichts verfügbar */
  source: "live" | "memory" | "stored" | "none";
  error?: string;
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

const refKey = (s: unknown) => String(s ?? "").trim().toLowerCase();

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
    const ref = refKey(featureRef(f));
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
    let f = (r.extRef && byRef.get(refKey(r.extRef))) || null;
    if (!f) for (const n of names) { f = byName.get(normName(n)) || null; if (f) break; }
    if (!f && /^\s*ED-R\b/i.test(r.name)) {
      for (const n of names) { f = edrByName.get(edrBaseName(n)) || null; if (f) break; }
    }
    if (!f) return r;
    const geom = geometryFromGeoJson(f.geometry, r.radiusM ?? featureRadius(f));
    if (!geom) return r;
    return { ...r, ...geom, radiusM: r.radiusM ?? geom.radiusM, geometryNote: null };
  });
}

async function fetchLayerOnce(layer: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<{ features: any[] | null; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(dipulWfsLayerUrl(layer), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return { features: null, error: `HTTP ${resp.status}` };
    let data: any;
    try {
      data = await resp.json();
    } catch {
      return { features: null, error: "Antwort ist kein GeoJSON" };
    }
    if (!Array.isArray(data?.features)) return { features: null, error: "Antwort ohne Features" };
    return { features: data.features };
  } catch (e) {
    const aborted = controller.signal.aborted || (e as any)?.name === "AbortError";
    return { features: null, error: aborted ? `Zeitüberschreitung (${Math.round(timeoutMs / 1000)} s)` : String((e as any)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Ein Layer, mit einem zweiten Versuch (Mobilfunk/kurze Aussetzer). */
async function fetchLayerFeatures(layer: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<{ features: any[] | null; error?: string }> {
  let last: { features: any[] | null; error?: string } = { features: null };
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await fetchLayerOnce(layer, fetchImpl, timeoutMs);
    if (last.features) return last;
  }
  console.warn(`[dipul WFS] ${layer} nicht geladen: ${last.error ?? "unbekannt"}`);
  return last;
}

const LAYER_TTL_MS = 5 * 60 * 1000;
const layerCache = new Map<string, { ts: number; features: any[] }>();

/**
 * Lädt einen dipul-WFS-Layer (Sitzungs-Cache 5 min). Schlägt der Abruf fehl,
 * wird – falls vorhanden – der zuletzt gespeicherte Stand aus `store` genutzt.
 * Wirft nie.
 */
export async function loadDipulLayer(
  layer: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; store?: DipulFeatureStore } = {},
): Promise<DipulLayerResult> {
  const hit = layerCache.get(layer);
  if (hit && Date.now() - hit.ts < LAYER_TTL_MS) return { features: hit.features, source: "memory" };
  const { features, error } = await fetchLayerFeatures(layer, opts.fetchImpl ?? fetch, opts.timeoutMs ?? 20000);
  if (features && features.length > 0) {
    layerCache.set(layer, { ts: Date.now(), features });
    opts.store?.save(layer, features).catch(() => {});
    return { features, source: "live" };
  }
  if (features) return { features, source: "live" };
  try {
    const stored = await opts.store?.load(layer);
    if (Array.isArray(stored) && stored.length > 0) return { features: stored, source: "stored", error };
  } catch {
    // Speicher nicht lesbar → wie „nichts verfügbar“
  }
  return { features: [], source: "none", error: error ?? "nicht erreichbar" };
}

/** Nur für Tests: Layer-Cache leeren. */
export function clearDipulTempGeometryCache(): void {
  layerCache.clear();
}

export const DIPUL_NOTE_UNREACHABLE = (err?: string) =>
  `Fläche nicht geladen: dipul-Kartendienst (uas-betrieb.de) nicht erreichbar${err ? ` – ${err}` : ""}. ` +
  "Beim nächsten Aktualisieren wird es erneut versucht.";
export const DIPUL_NOTE_NO_GEOMETRY =
  "dipul veröffentlicht zu diesem Eintrag derzeit keine Fläche (weder unter „Temporäre Betriebseinschränkungen“ " +
  "noch bei den Flugbeschränkungsgebieten). Lage bitte im NOTAM-Text bzw. auf dipul.de prüfen.";

const isEdr = (r: DipulGeometryTarget) => /^\s*ED-R\b/i.test(r.name);

/**
 * Lädt bei Bedarf die dipul-WFS-Layer und ergänzt fehlende Geometrien in
 * active/upcoming. Wirft nie – bei Netzfehlern wird der gespeicherte Stand
 * (store) genutzt; Einträge, die danach noch keine Fläche haben, bekommen
 * eine `geometryNote` mit dem Grund.
 */
export async function enrichDipulTempGeometry<T extends DipulGeometryTarget, R extends { active: T[]; upcoming: T[] }>(
  result: R,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; store?: DipulFeatureStore } = {},
): Promise<R> {
  const all = (r: { active: T[]; upcoming: T[] }) => [...r.active, ...r.upcoming];
  if (all(result).every(hasDipulGeometry)) return result;
  try {
    const temp = await loadDipulLayer(DIPUL_TEMP_WFS_LAYER, opts);
    let out: { active: T[]; upcoming: T[] } = {
      active: attachDipulTempGeometry(result.active, temp.features),
      upcoming: attachDipulTempGeometry(result.upcoming, temp.features),
    };
    if (all(out).some((r) => !hasDipulGeometry(r) && isEdr(r))) {
      const edr = await loadDipulLayer(DIPUL_EDR_WFS_LAYER, opts);
      out = {
        active: attachDipulTempGeometry(out.active, [], edr.features),
        upcoming: attachDipulTempGeometry(out.upcoming, [], edr.features),
      };
    }
    const note = (r: T): T => {
      if (hasDipulGeometry(r)) return r;
      const geometryNote = temp.source === "none" ? DIPUL_NOTE_UNREACHABLE(temp.error) : DIPUL_NOTE_NO_GEOMETRY;
      return r.geometryNote === geometryNote ? r : { ...r, geometryNote };
    };
    return { ...result, active: out.active.map(note), upcoming: out.upcoming.map(note) };
  } catch {
    return result;
  }
}

const wfsUnit = (u: unknown) => {
  const s = String(u ?? "").toLowerCase();
  return s === "ft" || s === "feet" ? "ft" : s === "fl" ? "FL" : "m";
};

/**
 * WFS-Feature aus `temporaere_betriebseinschraenkungen` → Eintrag im Format
 * der geoapi (`affectedAreas[]`), inklusive Geometrie. Damit kann die Liste
 * auch dann live aufgebaut werden, wenn die geoapi nicht antwortet.
 */
export function dipulWfsFeatureToGeoapiArea(f: any): Record<string, unknown> | null {
  const p = f?.properties ?? {};
  const extRef = featureRef(f);
  const name = p.name ?? p.generated_name_de ?? p.generated_name_en;
  if (!extRef || !name) return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    extRef,
    typeCode: p.type_code || "U_NFZ",
    names: [String(name)],
    genNames: [String(p.generated_name_de ?? name)],
    legalRef: p.legal_ref ?? "",
    lowerAlt: num(p.lower_limit_altitude),
    lowerAltRef: p.lower_limit_alt_ref || "AGL",
    lowerAltUnit: wfsUnit(p.lower_limit_unit),
    upperAlt: num(p.upper_limit_altitude),
    upperAltRef: p.upper_limit_alt_ref || "AGL",
    upperAltUnit: wfsUnit(p.upper_limit_unit),
    startTs: p.start_time ?? null,
    endTs: p.end_time ?? null,
    geometry: f.geometry ?? null,
  };
}
