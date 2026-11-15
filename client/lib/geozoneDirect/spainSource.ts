// Direkter Abruf der spanischen Geozonen (ENAIRE, AIS Data Service for UAS
// Geographical Zones, ED-318) – siehe docs/enaire-es-api-integration.md.
//
//  - PRIMÄR: offizielle ED-318-Downloads im AIP (aip.enaire.es/recursos/
//    descargas/ZGUAS/: ZGUAS_Aero.zip, ZGUAS_Infra.zip, ZGUAS_Urbano.zip),
//    jede .json im ZIP als ED-318 (shared/ed318Pure.ts). ⚠️ Aus der Sandbox
//    geo-gesperrt (403) – Dateiinhalt nicht live verifiziert.
//  - Rückfall, wenn KEIN ZIP Zonen liefert: ArcGIS/WFS wie folgt.
//  - ArcGIS REST FeatureServer, je Layer `query?…&f=geojson`,
//    paginiert über resultOffset/resultRecordCount + exceededTransferLimit.
//  - Layer-IDs werden über `FeatureServer?f=json` ermittelt; schlägt das fehl,
//    gelten die dokumentierten Rückfall-IDs (0/1/2, ⚠️ live zu verifizieren).
//  - Rückfall je Layer: OGC WFS 2.0 GetFeature mit outputFormat=GEOJSON.
//
// Keine Authentifizierung. ⚠️ servais.enaire.es blockt Nicht-EU-/Datacenter-
// IPs per WAF (403) – aus der App (EU-Geräte) erreichbar.
// Pflicht-Attribution: „© ENAIRE“ (ES_GEOZONE_ATTRIBUTION).
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar).
import type { GeoFeature } from "./ed269Sources";
import { strFromU8, unzipSync } from "fflate";
import { directFetchJson, finalizeDirectFeatures } from "./directFetchUtil";
import {
  ES_AIP_ZIP_LAYERS,
  ES_GEOZONE_ATTRIBUTION,
  ES_GEOZONE_SOURCE_LABEL,
  ES_LAYERS,
  esArcgisPage,
  esLayerIdsFromService,
  normalizeSpanishEd318,
  normalizeSpanishFeatures,
  type EsEd318Raw,
  type EsLayer,
  type EsRawFeature,
} from "../../../shared/spanishGeozones";
import { ed318ExtractZones } from "../../../shared/ed318Pure";

export { ES_GEOZONE_SOURCE_LABEL, ES_GEOZONE_ATTRIBUTION };

/** Offizielles AIP-Download-Verzeichnis der ED-318-Dateien (ZIP je Layer). */
export const ES_AIP_ZGUAS_BASE = "https://aip.enaire.es/recursos/descargas/ZGUAS/";
// ZGUAS_Infra.zip ist ~18 MB (entpackt deutlich mehr) – großzügig, auch für
// langsame Mobilfunkverbindungen der Fernsteuerung.
const ZIP_TIMEOUT_MS = 240_000;

export const ES_ENAIRE_FS =
  "https://servais.enaire.es/insigniads/rest/services/NSF_SRV/SRV_UAS_ZG_data_V2/FeatureServer";
export const ES_ENAIRE_WFS =
  "https://servais.enaire.es/insigniads/services/NSF_SRV/SRV_UAS_ZG_data_V2/MapServer/WFSServer";

/** Rückfall-Layer-IDs, falls die Layer-Liste nicht lesbar ist (Annahme: Reihenfolge wie Doku §2). */
export const ES_FALLBACK_LAYER_IDS: Record<EsLayer, number> = {
  ZGUAS_Aero: 0,
  ZGUAS_Urbano: 1,
  ZGUAS_Infraestructuras: 2,
};

// ArcGIS-Default-maxRecordCount ist 1000/2000; der Server darf weniger liefern
// (dann exceededTransferLimit=true) – der Offset rückt um die tatsächliche Zahl vor.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const PAGE_TIMEOUT_MS = 90_000;

/** ArcGIS-Query-URL (GeoJSON, WGS84, alle Felder, eine Seite). */
export function spainQueryUrl(layerId: number, offset = 0, count = PAGE_SIZE): string {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    outSR: "4326",
    returnGeometry: "true",
    geometryPrecision: "6",
    resultOffset: String(offset),
    resultRecordCount: String(count),
    f: "geojson",
  });
  return `${ES_ENAIRE_FS}/${layerId}/query?${params.toString()}`;
}

/** WFS-2.0-GetFeature-URL (GeoJSON erzwungen, eine Seite). */
export function spainWfsUrl(typeName: string, startIndex = 0, count = PAGE_SIZE): string {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName,
    outputFormat: "GEOJSON",
    count: String(count),
  });
  if (startIndex > 0) params.set("startIndex", String(startIndex));
  return `${ES_ENAIRE_WFS}?${params.toString()}`;
}

/** Layer-IDs ermitteln; fehlende Layer (oder Fehler) → dokumentierte Rückfall-IDs. */
export async function discoverSpainLayerIds(): Promise<Record<EsLayer, number>> {
  let found: Partial<Record<EsLayer, number>> = {};
  try {
    found = esLayerIdsFromService(await directFetchJson(`${ES_ENAIRE_FS}?f=json`));
  } catch (e) {
    console.warn("[geozoneDirect] ES: Layer-Liste nicht lesbar, nutze Rückfall-IDs:", (e as Error)?.message || e);
  }
  const out = { ...ES_FALLBACK_LAYER_IDS };
  for (const layer of ES_LAYERS) if (found[layer] != null) out[layer] = found[layer]!;
  return out;
}

async function fetchArcgisLayer(layerId: number): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { features, exceeded } = esArcgisPage(await directFetchJson(spainQueryUrl(layerId, all.length), PAGE_TIMEOUT_MS));
    all.push(...features);
    if (features.length === 0) break;
    if (!exceeded && features.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchWfsLayer(typeName: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await directFetchJson(spainWfsUrl(typeName, all.length), PAGE_TIMEOUT_MS);
    const feats = Array.isArray(body?.features) ? body.features : [];
    all.push(...feats);
    const total = Number(body?.numberMatched ?? body?.totalFeatures);
    if (feats.length < PAGE_SIZE) break;
    if (Number.isFinite(total) && all.length >= total) break;
  }
  return all;
}

async function loadLayer(layer: EsLayer, layerId: number): Promise<EsRawFeature[]> {
  try {
    const feats = await fetchArcgisLayer(layerId);
    if (feats.length > 0) return feats.map((feature) => ({ layer, feature }));
    console.warn(`[geozoneDirect] ES: ${layer} (FeatureServer/${layerId}) leer, versuche WFS`);
  } catch (e) {
    console.warn(`[geozoneDirect] ES: ${layer} über FeatureServer fehlgeschlagen, versuche WFS:`, (e as Error)?.message || e);
  }
  const feats = await fetchWfsLayer(layer);
  return feats.map((feature) => ({ layer, feature }));
}

async function fetchBytes(url: string, timeoutMs: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { Accept: "application/zip,*/*" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ZIP-Bytes → rohe ED-318-Zonen aller .json/.geojson-Dateien. Die Dateien
 * werden einzeln entpackt und geparst (Speicher der Fernsteuerung schonen).
 * Unlesbare Einzeldateien werden übersprungen.
 */
export function spainZonesFromZip(bytes: Uint8Array, layer: EsLayer): EsEd318Raw[] {
  if (!(bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error("keine ZIP-Datei");
  const names: string[] = [];
  unzipSync(bytes, {
    filter: (f) => {
      if (/\.(geo)?json$/i.test(f.name) && !/(^|\/)__MACOSX\//.test(f.name)) names.push(f.name);
      return false;
    },
  });
  const out: EsEd318Raw[] = [];
  for (const name of names) {
    try {
      const files = unzipSync(bytes, { filter: (f) => f.name === name });
      const text = strFromU8(files[name]).replace(/^\uFEFF/, "");
      for (const zone of ed318ExtractZones(JSON.parse(text))) out.push({ layer, zone });
    } catch (e) {
      console.warn(`[geozoneDirect] ES: ${name} nicht lesbar:`, (e as Error)?.message || e);
    }
  }
  return out;
}

/** Lädt die drei AIP-ZIPs; einzelne dürfen fehlen. Liefert die rohen Zonen. */
export async function fetchSpainAipZones(): Promise<EsEd318Raw[]> {
  const results = await Promise.allSettled(
    ES_AIP_ZIP_LAYERS.map(async ({ file, layer }) => spainZonesFromZip(await fetchBytes(ES_AIP_ZGUAS_BASE + file, ZIP_TIMEOUT_MS), layer)),
  );
  const raw: EsEd318Raw[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") raw.push(...r.value);
    else console.warn(`[geozoneDirect] ES: ${ES_AIP_ZIP_LAYERS[i].file} nicht ladbar:`, (r.reason as Error)?.message || r.reason);
  });
  return raw;
}

/**
 * Primär: ED-318-ZIPs aus dem AIP. Liefern sie keine gültigen Zonen (alle
 * ZIPs fehlgeschlagen/leer), folgt der ArcGIS-/WFS-Rückfall; wirft, wenn
 * auch der nichts liefert.
 */
export async function loadSpain(now: Date = new Date()): Promise<GeoFeature[]> {
  try {
    const zones = await fetchSpainAipZones();
    if (zones.length > 0) {
      const features = normalizeSpanishEd318(zones, now) as unknown as GeoFeature[];
      if (features.length > 0) return finalizeDirectFeatures(features, "es");
      console.warn("[geozoneDirect] ES: AIP-ZIPs ohne gültige Zonen, nutze ArcGIS-Rückfall");
    } else {
      console.warn("[geozoneDirect] ES: AIP-ZIPs nicht verfügbar, nutze ArcGIS-Rückfall");
    }
  } catch (e) {
    console.warn("[geozoneDirect] ES: AIP-ZIPs fehlgeschlagen, nutze ArcGIS-Rückfall:", (e as Error)?.message || e);
  }
  return loadSpainArcgis(now);
}

/**
 * Rückfall: alle drei ENAIRE-Layer über ArcGIS/WFS, normalisiert (Dedupe über
 * `Identifier`, auch layerübergreifend), mit bbox und `_country: "es"`.
 * Einzelne Layer dürfen fehlen; wirft, wenn KEIN Layer Daten liefert.
 */
export async function loadSpainArcgis(now: Date = new Date()): Promise<GeoFeature[]> {
  const ids = await discoverSpainLayerIds();
  const results = await Promise.allSettled(ES_LAYERS.map((layer) => loadLayer(layer, ids[layer])));
  const raw: EsRawFeature[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") raw.push(...r.value);
    else console.warn(`[geozoneDirect] ES: Layer ${ES_LAYERS[i]} nicht erreichbar:`, (r.reason as Error)?.message || r.reason);
  });
  if (raw.length === 0) throw new Error("ENAIRE lieferte keine Zonen");
  const features = normalizeSpanishFeatures(raw, now) as unknown as GeoFeature[];
  if (features.length === 0) throw new Error("ENAIRE lieferte keine gültigen Zonen");
  return finalizeDirectFeatures(features, "es");
}

export async function fetchSpain(): Promise<GeoFeature[]> {
  return loadSpain(new Date());
}
