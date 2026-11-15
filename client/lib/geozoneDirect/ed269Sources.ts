// Direkter Abruf der ED-269-/GeoJSON-Geozonen-Quellen pro Land –
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
import { ED269_FETCH_ISOS, getGeozoneSourceMeta, resolveGeozoneSourceIso } from "../../../shared/geozoneSourceMeta";
import { normalizeEstonianProps } from "../../../shared/estonianGeozones";
import { fetchSwitzerland } from "./switzerlandSource";
import { fetchFinland } from "./finlandSource";
import { fetchNorway } from "./norwaySource";
import { fetchIreland, fetchLuxembourg, fetchPortugal } from "./irelandLuxSource";
import { fetchPoland } from "./polandSource";
import { fetchItaly } from "./italySource";
import { fetchSlovakia } from "./slovakiaSource";
import { fetchLatvia } from "./latviaSource";
import { fetchBulgaria } from "./bulgariaSource";
import { fetchSlovenia } from "./sloveniaSource";
import { fetchCroatia } from "./croatiaSource";
import { fetchCyprus } from "./cyprusSource";
import { fetchIceland } from "./icelandSource";
import { fetchUnitedKingdom } from "./ukSource";
import { fetchRomania } from "./romaniaSource";
import { fetchMalta } from "./maltaSource";

export const LT_GEOZONE_SOURCE_LABEL = "Oro navigacija (ED-269)";
import { fetchSweden } from "./swedenSource";
import {
  NL_QUERY_BOUNDS,
  dedupeGodroneFeatures,
  godroneAirspaceExcluded,
  normalizeGodroneFeature,
  type GodroneFeature,
} from "../../../shared/dutchGeozones";
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

// Länder, deren Geozonen als ED-269-/GeoJSON-Vektordaten mit automatischem
// Abruf vorliegen (kein WMS) – aus der Quellen-Registry (kind "ed269-vector"
// bzw. "login"), kleingeschrieben. NL kommt aus GoDrone (LVNL); DE/FR/CZ nutzen
// den Kachelspeicher, HU/GR nur ein Bild-Overlay, GR optional den Datei-Import;
// MT seit 2026-11 online per DDP (maltaSource.ts).
export const ED269_DIRECT_COUNTRIES: readonly string[] = ED269_FETCH_ISOS.map((iso) => iso.toLowerCase());

export function isEd269DirectCountry(iso: string): boolean {
  return (ED269_DIRECT_COUNTRIES as readonly string[]).includes(String(iso || "").toLowerCase());
}

// Upstream-Endpunkte (identisch zu den Server-Defaults).
export const AT_GEOZONES_URL = "https://utm.dronespace.at/avm/utm/uas.geojson";
export const DK_GEOZONES_URL =
  "https://trafikstyrelsen.maps.arcgis.com/sharing/rest/content/items/980697acd04d4a9bb1fd34bbefab924a/data";
export const DK_LEGACY_GEOZONES_URL =
  "https://trafikstyrelsen.maps.arcgis.com/sharing/rest/content/items/f049a65ae2f34bd1b747895d555dac71/data";
// Feste offizielle Download-URL laut dronezoner.eu/API (täglich 03:00 CET);
// Nutzung frei mit Quellenangabe „Kilde: Trafikstyrelsen“ (schriftlich bestätigt).
export const DK_NATURE_ZONES_URL =
  "https://trafikstyrelsen.maps.arcgis.com/sharing/rest/content/items/ff657943724944faaf19807380f5e24a/data";
export const DK_NATURE_ZONES_FALLBACK_URL =
  "https://services-eu1.arcgis.com/Zvx25KS6sGRl9LIx/arcgis/rest/services/NaturOmraader2024v2/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson";
// Estland: öffentlich; Freigabe von EANS mündlich erteilt, schriftliche
// Bestätigung ausstehend (Stand 2026-11-15).
// Quelle: EANS (Lennuliiklusteeninduse AS) / Transpordiamet, utm.eans.ee
export const EE_GEOZONES_URL = "https://utm.eans.ee/avm/utm/uas.geojson";
// Litauen (Oro navigacija) – gleiche Frequentis-Plattform wie AT/EE, ohne Anmeldung.
export const LT_GEOZONES_URL = "https://utm.ans.lt/avm/utm/uas.geojson";
export const BE_SKEYES_UAS_ZONES_URL = "https://api-cis.skeyes.be/public/uas-zones";
export const BE_DRONEGUIDE_WFS_URL = "https://map.droneguide.be/ows";
export const NL_GODRONE_MAPDATA_URL = "https://api.godrone.nl/v2/mapdata/geojson";

// Öffentlicher API-Schlüssel von GoDrone (LVNL / Altitude Angel). Nutzung laut
// Betreiber erlaubt (siehe docs/godrone-api-integration.md). Austauschbar, falls
// er rotiert wird.
let godroneApiKey = "hOrnXF_XuIOko8taj9VCi9MUNP4pXVkR_dN-3B8V0";
export function setGodroneApiKey(key: string): void {
  if (key && key.trim()) godroneApiKey = key.trim();
}

// Browser-User-Agent: manche Anbieter (z. B. Austro Control / Dronespace)
// liefern ohne gängigen UA einen 403/Redirect statt der GeoJSON-Daten.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 60_000;

// Nachkommastellen für die Speicherung (5 ≈ 1,1 m) – verkleinert die mehrere
// MB großen Datensätze auf dem Gerät spürbar ohne sichtbare Formänderung.
// 7 Nachkommastellen ≈ 1 cm: volle Genauigkeit der Originaldaten bleibt erhalten
const VECTOR_COORD_DECIMALS = 7;

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
/**
 * Ohne Zeitfenster liefert Dronespace nur die gerade aktiven Zonen. Mit einem
 * Jahr Zeitfenster kommen alle Zonen inkl. zeitgesteuerter (z. B. MTMA)
 * – siehe docs/dronespace-at-api-integration.md §5.1.
 */
export function austriaGeozonesUrl(now: Date = new Date()): string {
  return frequentisAvmUrl(AT_GEOZONES_URL, now);
}

/** Frequentis-AVM-Plattform (AT, EE): Zeitfenster ein Jahr ab jetzt. */
export function frequentisAvmUrl(base: string, now: Date = new Date()): string {
  const end = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  return `${base}?start=${now.toISOString()}&end=${end.toISOString()}`;
}

async function fetchAustria(): Promise<GeoFeature[]> {
  const body = await fetchJson(austriaGeozonesUrl());
  const raw: GeoFeature[] = Array.isArray(body?.features) ? body.features : [];
  if (raw.length === 0) throw new Error("Austro Control lieferte keine Zonen");
  // MATZ/MCTR-Platzhalter: Registry-Flag frequentisPlaceholder (fetchEd269CountryFeatures)
  return finalize(raw, "at");
}

// ---------------------------------------------------------------------------
// Frequentis-AVM-Systemzonen (AT, EE, LT – Registry-Flag frequentisAvm)
// ---------------------------------------------------------------------------
/** Ab dieser bbox-Ausdehnung gilt ein PROHIBITED-Polygon als „Welt-Polygon“. */
export const FREQUENTIS_WORLD_SPAN_LON_DEG = 90;
export const FREQUENTIS_WORLD_SPAN_LAT_DEG = 45;

/** LT: weltumspannende Zone „Outside Lithuania“ (docs/lithuania-ans-api-integration.md §6). */
export function isLithuaniaOutsideZone(f: GeoFeature | null | undefined): boolean {
  const name = String((f?.properties as Record<string, unknown> | undefined)?.name ?? "").trim();
  return name.toLowerCase() === "outside lithuania";
}

/**
 * true für Features, die kein Pilot sehen soll: `hidden === true` (AT sys_*,
 * Landes-/Systemgeometrie) und PROHIBITED-Polygone mit Welt-bbox (> 90° Länge
 * oder > 45° Breite, z. B. „Outside Lithuania“). Wird schon beim Abruf
 * verworfen – vor der Nähe-Begrenzung (1200 nächste Zonen) der Abfrage.
 */
export function isFrequentisSystemFeature(f: GeoFeature | null | undefined): boolean {
  if (!f) return true;
  const p = (f.properties as Record<string, any>) || {};
  if (p.hidden === true) return true;
  if (isLithuaniaOutsideZone(f)) return true;
  const raw = p.originalRestriction ?? p.restriction;
  const restriction = String((raw && typeof raw === "object" ? raw.type : raw) ?? "").trim().toUpperCase();
  if (restriction !== "PROHIBITED") return false;
  const bb = Array.isArray(f.bbox) && f.bbox.length === 4 ? f.bbox : computeBbox(f.geometry);
  if (!bb) return false;
  return bb[2] - bb[0] > FREQUENTIS_WORLD_SPAN_LON_DEG || bb[3] - bb[1] > FREQUENTIS_WORLD_SPAN_LAT_DEG;
}

/** Frequentis-Systemfeatures verwerfen (siehe isFrequentisSystemFeature). */
export function dropFrequentisSystemFeatures(features: GeoFeature[]): GeoFeature[] {
  return features.filter((f) => !isFrequentisSystemFeature(f));
}

// ---------------------------------------------------------------------------
// Litauen (Oro navigacija) – Feed und Schema wie Österreich,
// siehe docs/lithuania-ans-api-integration.md.
// ---------------------------------------------------------------------------
async function fetchLithuania(): Promise<GeoFeature[]> {
  const body = await fetchJson(frequentisAvmUrl(LT_GEOZONES_URL));
  const raw: GeoFeature[] = Array.isArray(body?.features) ? body.features : [];
  if (raw.length === 0) throw new Error("Oro navigacija lieferte keine Zonen");
  // „Outside Lithuania“: weltumspannendes PROHIBITED-Polygon (Litauen als
  // Aussparung) – würde jede Nachbarregion rot färben (Doku §6, Falle 1).
  const kept = raw.filter((f) => !isLithuaniaOutsideZone(f));
  return finalize(kept, "lt").map((feature) => ({
    ...feature,
    properties: { ...((feature.properties as Record<string, any>) || {}), source: LT_GEOZONE_SOURCE_LABEL },
  }));
}

// ---------------------------------------------------------------------------
// Estland (EANS / Transpordiamet) – gleiche Plattform wie Dronespace AT
// ---------------------------------------------------------------------------
async function fetchEstonia(): Promise<GeoFeature[]> {
  const body = await fetchJson(frequentisAvmUrl(EE_GEOZONES_URL));
  const raw: GeoFeature[] = Array.isArray(body?.features) ? body.features : [];
  if (raw.length === 0) throw new Error("EANS lieferte keine Zonen");
  return finalize(raw, "ee").map((feature) => ({
    ...feature,
    properties: normalizeEstonianProps((feature.properties as Record<string, any>) || {}),
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
  for (const url of [DK_NATURE_ZONES_URL, DK_NATURE_ZONES_FALLBACK_URL]) {
    try {
      const body = await fetchJson(url);
      const raw = Array.isArray(body?.features) ? body.features : [];
      const nature = finalize(normalizeDanishNatureFeatures(raw) as unknown as GeoFeature[], "dk");
      if (nature.length > 0) {
        features = [...features, ...nature];
        break;
      }
    } catch (e) {
      console.warn("[geozoneDirect] DK: Naturschutzzonen nicht erreichbar:", url, (e as Error)?.message || e);
    }
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

// ---------------------------------------------------------------------------
// Niederlande (GoDrone – LVNL / Altitude Angel)
// ---------------------------------------------------------------------------

type Box = { w: number; s: number; e: number; n: number };

async function fetchGodroneBox(b: Box, depth = 0): Promise<GodroneFeature[]> {
  const url = `${NL_GODRONE_MAPDATA_URL}?n=${b.n}&e=${b.e}&s=${b.s}&w=${b.w}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let body: any;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", Authorization: `X-AA-ApiKey ${godroneApiKey}` },
    });
    if (res.status === 401 || res.status === 403) throw new Error("GoDrone-Schlüssel abgelehnt");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } finally {
    clearTimeout(timer);
  }
  // Box zu groß für die Luftraum-Ebene → vierteln und neu fragen
  if (godroneAirspaceExcluded(body) && depth < 3) {
    const mx = (b.w + b.e) / 2;
    const my = (b.s + b.n) / 2;
    const parts: Box[] = [
      { w: b.w, s: b.s, e: mx, n: my },
      { w: mx, s: b.s, e: b.e, n: my },
      { w: b.w, s: my, e: mx, n: b.n },
      { w: mx, s: my, e: b.e, n: b.n },
    ];
    const out: GodroneFeature[] = [];
    for (const p of parts) out.push(...(await fetchGodroneBox(p, depth + 1)));
    return out;
  }
  return Array.isArray(body?.features) ? body.features : [];
}

/** 1°×1°-Abfragekacheln über die Niederlande (§5 der Doku). */
export function netherlandsQueryBoxes(): Box[] {
  const boxes: Box[] = [];
  for (let w = NL_QUERY_BOUNDS.w; w < NL_QUERY_BOUNDS.e - 1e-9; w += 1) {
    for (let s = NL_QUERY_BOUNDS.s; s < NL_QUERY_BOUNDS.n - 1e-9; s += 1) {
      boxes.push({
        w: Math.round(w * 100) / 100,
        s: Math.round(s * 100) / 100,
        e: Math.round(Math.min(w + 1, NL_QUERY_BOUNDS.e) * 100) / 100,
        n: Math.round(Math.min(s + 1, NL_QUERY_BOUNDS.n) * 100) / 100,
      });
    }
  }
  return boxes;
}

async function fetchNetherlands(): Promise<GeoFeature[]> {
  const boxes = netherlandsQueryBoxes();
  const raw: GodroneFeature[] = [];
  let ok = 0;
  // höchstens 2 Abfragen gleichzeitig (Rate-Limits unbekannt)
  for (let i = 0; i < boxes.length; i += 2) {
    const batch = boxes.slice(i, i + 2);
    const res = await Promise.allSettled(batch.map((b) => fetchGodroneBox(b)));
    for (const r of res) {
      if (r.status === "fulfilled") {
        raw.push(...r.value);
        ok++;
      } else {
        console.warn("[geozoneDirect] NL: Kachel fehlgeschlagen:", (r.reason as Error)?.message || r.reason);
        if (String((r.reason as Error)?.message).includes("Schlüssel")) throw r.reason;
      }
    }
  }
  if (ok < boxes.length / 2) throw new Error("GoDrone (NL) nicht ausreichend erreichbar");
  const normalized = dedupeGodroneFeatures(raw)
    .map((f) => normalizeGodroneFeature(f))
    .filter((f): f is GodroneFeature => !!f);
  if (normalized.length === 0) throw new Error("GoDrone lieferte keine Zonen");
  return finalize(normalized as unknown as GeoFeature[], "nl");
}

/**
 * Abruf-Funktion je Vektor-Land (Schlüssel = Registry-ISO, Großbuchstaben).
 * Die Client-Registry (client/lib/geozoneSources/registry.ts) referenziert
 * diese Funktionen; ein Test prüft, dass jeder Schlüssel in der Registry steht
 * und jedes Land mit automatischem Abruf eine Funktion hat.
 */
export const ED269_FETCHERS: Readonly<Record<string, () => Promise<GeoFeature[]>>> = {
  AT: fetchAustria,
  DK: fetchDenmark,
  BE: fetchBelgium,
  NL: fetchNetherlands,
  EE: fetchEstonia,
  CH: fetchSwitzerland, // inkl. Liechtenstein (Alias LI)
  FI: fetchFinland,
  NO: fetchNorway,
  IE: fetchIreland,
  LU: fetchLuxembourg,
  SE: fetchSweden,
  PT: fetchPortugal,
  PL: fetchPoland,
  LT: fetchLithuania,
  IT: fetchItaly,
  GB: fetchUnitedKingdom,
  IS: fetchIceland,
  CY: fetchCyprus,
  HR: fetchCroatia,
  SI: fetchSlovenia,
  BG: fetchBulgaria,
  LV: fetchLatvia,
  SK: fetchSlovakia,
  RO: fetchRomania,
  MT: fetchMalta,
};

/** Gebündelte Basisdaten je Land (Registry-Flag bundledFallback). */
export const ED269_BUNDLED_FALLBACKS: Readonly<Record<string, () => GeoFeature[]>> = {
  BE: getBelgianBundledFeatures,
};

/**
 * Lädt den kompletten, normalisierten Geozonen-Bestand eines Vektor-Landes
 * direkt von den Upstream-Quellen (inkl. bbox je Feature, gekürzter
 * Koordinaten-Präzision und `_country`-Tag). Wirft bei Fehlschlag.
 */
export async function fetchEd269CountryFeatures(iso: string): Promise<GeoFeature[]> {
  const key = resolveGeozoneSourceIso(iso);
  const fetcher = ED269_DIRECT_COUNTRIES.includes(key.toLowerCase()) ? ED269_FETCHERS[key] : undefined;
  if (!fetcher) throw new Error(`Kein Vektor-Geozonen-Feed für ${iso}`);
  let features = await fetcher();
  const meta = getGeozoneSourceMeta(key);
  if (meta?.frequentisAvm) {
    // hidden (AT sys_*) und Welt-Polygone schon hier verwerfen, nicht erst in
    // der Anzeige: sonst verdrängen sie echte Zonen aus der 1200er-Liste.
    // (AT-Landesgrenze aus sys_1/sys_2 wird nicht separat gespeichert – kein Nutzer.)
    features = dropFrequentisSystemFeatures(features);
  }
  if (meta?.frequentisPlaceholder) {
    // Frequentis-AVM (AT/LT): MATZ/MCTR mit Platzhalter-Enddatum 2100 = dauerhaft
    features = features.map((feature) => ({
      ...feature,
      properties: normalizeAustrianEd269Placeholder((feature.properties as Record<string, any>) || {}),
    }));
  }
  return roundFeatureCoords(features);
}
