// Direkter Abruf der ED-269-/GeoJSON-Geozonen-Quellen pro Land (AT/BE/DK) –
// Portierung des früheren Server-Tagesabgleichs (server/dataSync.ts:
// syncGeozonesForCountry). Das Backend existiert nicht mehr; die App lädt die
// öffentlichen Upstream-Feeds selbst (React Native kennt kein CORS).
//
// Bewusst frei von React-Native-/Expo-Importen, damit die Normalisierung unter
// tsx/Node testbar bleibt. Persistenz/Refresh liegt in ed269Store.ts.
import {
  normalizeDanishFeatures,
  normalizeDanishNatureFeatures,
} from "../../../shared/danishGeozones";
import { normalizeAustrianEd269Placeholder } from "../../../shared/ed269Restriction";
import {
  normalizeBelgianFeatures,
  normalizeDroneguideWfsFeatures,
  normalizeSkeyesApiZones,
  mergeBelgianGeozones,
} from "../../../shared/belgianGeozones";

export type GeoFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
  bbox?: [number, number, number, number];
};

// Länder, deren Geozonen als ED-269-/GeoJSON-Vektordaten vorliegen (kein WMS).
// DE/CH/LU/NL/FR haben keinen Vektor-Feed (der Server lieferte dort ebenfalls
// keine Zonen) und werden über ihre WMS-/WFS-Pfade abgefragt.
export const ED269_DIRECT_COUNTRIES = ["at", "be", "dk"] as const;

export function isEd269DirectCountry(iso: string): boolean {
  return (ED269_DIRECT_COUNTRIES as readonly string[]).includes(String(iso || "").toLowerCase());
}

// Upstream-Endpunkte (identisch zu den Server-Defaults).
export const AT_GEOZONES_URL = "https://utm.dronespace.at/avm/utm/uas.geojson";
export const DK_GEOZONES_URL =
  "https://trafikstyrelsen.maps.arcgis.com/sharing/rest/content/items/980697acd04d4a9bb1fd34bbefab924a/data";
export const DK_LEGACY_GEOZONES_URL =
  "https://trafikstyrelsen.maps.arcgis.com/sharing/rest/content/items/f049a65ae2f34bd1b747895d555dac71/data";
export const DK_NATURE_ZONES_URL =
  "https://services-eu1.arcgis.com/Zvx25KS6sGRl9LIx/arcgis/rest/services/NaturOmraader2024v2/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson";
export const BE_SKEYES_UAS_ZONES_URL = "https://api-cis.skeyes.be/public/uas-zones";
export const BE_DRONEGUIDE_WFS_URL = "https://map.droneguide.be/ows";

// Browser-User-Agent: manche Anbieter (z. B. Austro Control / Dronespace)
// liefern ohne gängigen UA einen 403/Redirect statt der GeoJSON-Daten.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 60_000;

// Nachkommastellen für die Speicherung (5 ≈ 1,1 m) – verkleinert die mehrere
// MB großen Datensätze auf dem Gerät spürbar ohne sichtbare Formänderung.
const VECTOR_COORD_DECIMALS = 5;

async function fetchJson(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function computeBbox(geometry: { type: string; coordinates: unknown } | null | undefined): [number, number, number, number] | null {
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

// bbox ergänzen + Land taggen (wie fetchGeozonesFromEnv auf dem Server).
function finalize(features: GeoFeature[], country: string): GeoFeature[] {
  const out: GeoFeature[] = [];
  for (const f of features) {
    if (!f || !f.geometry) continue;
    if (!f.bbox) {
      const bb = computeBbox(f.geometry);
      if (bb) f.bbox = bb;
    }
    f.properties = { ...(f.properties || {}), _country: country };
    out.push(f);
  }
  return out;
}

function roundCoordsInPlace(coords: unknown, factor: number): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    for (let i = 0; i < coords.length; i++) {
      if (typeof coords[i] === "number") coords[i] = Math.round((coords[i] as number) * factor) / factor;
    }
    return;
  }
  for (const c of coords) roundCoordsInPlace(c, factor);
}

// Kürzt JEDEN "coordinates"-Schlüssel im Objektbaum (auch die ED-269-Roh-
// geometrie, die Austro Control zusätzlich in den Properties mitliefert).
function roundAllCoordinateKeys(obj: unknown, factor: number): void {
  if (Array.isArray(obj)) {
    for (const item of obj) roundAllCoordinateKeys(item, factor);
    return;
  }
  if (obj && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (key === "coordinates") roundCoordsInPlace(rec[key], factor);
      else roundAllCoordinateKeys(rec[key], factor);
    }
  }
}

export function roundFeatureCoords(features: GeoFeature[], decimals: number = VECTOR_COORD_DECIMALS): GeoFeature[] {
  const factor = Math.pow(10, decimals);
  for (const f of features) {
    roundAllCoordinateKeys(f.geometry, factor);
    roundAllCoordinateKeys(f.properties, factor);
    if (Array.isArray(f?.bbox)) {
      f.bbox = f.bbox.map((v) => Math.round(v * factor) / factor) as [number, number, number, number];
    }
  }
  return features;
}

// ---------------------------------------------------------------------------
// Österreich (Austro Control / Dronespace)
// ---------------------------------------------------------------------------
async function fetchAustria(): Promise<GeoFeature[]> {
  const body = await fetchJson(AT_GEOZONES_URL);
  const raw: GeoFeature[] = Array.isArray(body?.features) ? body.features : [];
  if (raw.length === 0) throw new Error("Austro Control lieferte keine Zonen");
  return finalize(raw, "at").map((feature) => ({
    ...feature,
    properties: normalizeAustrianEd269Placeholder((feature.properties as Record<string, any>) || {}),
  }));
}

// ---------------------------------------------------------------------------
// Dänemark (Trafikstyrelsen + Naturområder)
// ---------------------------------------------------------------------------
async function fetchDenmark(): Promise<GeoFeature[]> {
  let features: GeoFeature[] = [];
  try {
    const body = await fetchJson(DK_GEOZONES_URL);
    const raw = Array.isArray(body?.features) ? body.features : [];
    features = finalize(normalizeDanishFeatures(raw) as unknown as GeoFeature[], "dk");
  } catch (e) {
    console.warn("[geozoneDirect] DK: aktueller Export nicht erreichbar:", (e as Error)?.message || e);
  }
  if (features.length === 0) {
    // Offizieller Droneguide-/Legacy-Export als Rückfallquelle.
    try {
      const body = await fetchJson(DK_LEGACY_GEOZONES_URL);
      const raw = Array.isArray(body?.features) ? body.features : [];
      features = finalize(normalizeDanishFeatures(raw) as unknown as GeoFeature[], "dk");
    } catch (e) {
      console.warn("[geozoneDirect] DK: auch der Fallback ist nicht erreichbar:", (e as Error)?.message || e);
    }
  }
  if (features.length === 0) {
    // Ohne Drohnenzonen keinen halben Datensatz speichern -> Fehler, damit ein
    // vorhandener Gerätebestand erhalten bleibt.
    throw new Error("Dänische Geozonen nicht erreichbar");
  }
  try {
    const body = await fetchJson(DK_NATURE_ZONES_URL);
    const raw = Array.isArray(body?.features) ? body.features : [];
    const nature = finalize(normalizeDanishNatureFeatures(raw) as unknown as GeoFeature[], "dk");
    if (nature.length > 0) features = [...features, ...nature];
  } catch (e) {
    console.warn("[geozoneDirect] DK: Naturschutzzonen nicht erreichbar:", (e as Error)?.message || e);
  }
  return features;
}

// ---------------------------------------------------------------------------
// Belgien (gebündelte Droneguide-Basis + Droneguide-WFS + skeyes-Live-API)
// ---------------------------------------------------------------------------

// Gebündelte BE-Basisdaten (aus server/data übernommen). Lazy geladen, damit
// das ~2 MB große JSON erst bei Bedarf ausgewertet wird.
function loadBelgianBundle(): GeoFeature[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundle = require("./belgian-geozones.json") as { features?: unknown[] };
    const raw = Array.isArray(bundle?.features) ? bundle.features : [];
    // Tiefe Kopie, damit normalize/finalize das gecachte Modul nicht mutieren.
    const copy = JSON.parse(JSON.stringify(raw)) as GeoFeature[];
    return finalize(normalizeBelgianFeatures(copy as any) as unknown as GeoFeature[], "be");
  } catch (e) {
    console.warn("[geozoneDirect] BE: Bundle nicht ladbar:", (e as Error)?.message || e);
    return [];
  }
}

// Nur die gebündelten belgischen Zonen (sofort, ohne Netz) – Rückfall beim
// allerersten Start ohne Verbindung.
export function getBelgianBundledFeatures(): GeoFeature[] {
  return roundFeatureCoords(loadBelgianBundle());
}

async function fetchBelgianDroneguideWfs(): Promise<GeoFeature[]> {
  const features: any[] = [];
  const pageSize = 300;
  for (let startIndex = 0; startIndex < 20 * pageSize; startIndex += pageSize) {
    const params = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: "geo_zone_fast",
      srsName: "EPSG:4326",
      outputFormat: "application/json",
      cql_filter: "type_code<>'TIME_ZONE'",
      count: String(pageSize),
      startIndex: String(startIndex),
    });
    const body = await fetchJson(`${BE_DRONEGUIDE_WFS_URL}?${params.toString()}`);
    const page = Array.isArray(body?.features) ? body.features : [];
    features.push(...page);
    if (page.length < pageSize) break;
  }
  if (features.length === 0) throw new Error("WFS lieferte keine Zonen");
  return finalize(normalizeDroneguideWfsFeatures(features) as unknown as GeoFeature[], "be");
}

async function fetchBelgianLiveZones(): Promise<GeoFeature[]> {
  const body = await fetchJson(BE_SKEYES_UAS_ZONES_URL);
  const items = Array.isArray(body?.items) ? body.items : [];
  return finalize(normalizeSkeyesApiZones(items) as unknown as GeoFeature[], "be");
}

async function fetchBelgium(): Promise<GeoFeature[]> {
  let features = loadBelgianBundle();
  let anyOnline = false;
  try {
    const wfs = await fetchBelgianDroneguideWfs();
    features = mergeBelgianGeozones(wfs as any, features as any) as unknown as GeoFeature[];
    anyOnline = true;
  } catch (e) {
    console.warn("[geozoneDirect] BE: Droneguide-WFS nicht erreichbar:", (e as Error)?.message || e);
  }
  try {
    const live = await fetchBelgianLiveZones();
    if (live.length > 0) {
      features = mergeBelgianGeozones(live as any, features as any) as unknown as GeoFeature[];
      anyOnline = true;
    }
  } catch (e) {
    console.warn("[geozoneDirect] BE: skeyes-Live-API nicht erreichbar:", (e as Error)?.message || e);
  }
  // Ohne jede Online-Quelle ist das Ergebnis nur das Bundle -> als Fehler
  // melden, damit ein (evtl. aktuellerer) Gerätebestand nicht überschrieben wird.
  if (!anyOnline) throw new Error("Belgische Online-Quellen nicht erreichbar");
  return features;
}

/**
 * Lädt den kompletten, normalisierten Geozonen-Bestand eines Vektor-Landes
 * direkt von den Upstream-Quellen (inkl. bbox je Feature, gekürzter
 * Koordinaten-Präzision und `_country`-Tag). Wirft bei Fehlschlag.
 */
export async function fetchEd269CountryFeatures(iso: string): Promise<GeoFeature[]> {
  const c = String(iso || "").toLowerCase();
  let features: GeoFeature[];
  if (c === "at") features = await fetchAustria();
  else if (c === "dk") features = await fetchDenmark();
  else if (c === "be") features = await fetchBelgium();
  else throw new Error(`Kein Vektor-Geozonen-Feed für ${iso}`);
  return roundFeatureCoords(features);
}
