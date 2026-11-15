// Länderspezifische Live-Geozonen-Abfragen (CH REST, LU OGC/WMS, NL WFS/PDOK-WMS,
// FR DGAC-WMS) samt Antwort-Normalisierung und Übersetzungstabellen.
//
// Bewusst frei von React-Native-Imports (kein AsyncStorage/expo-constants),
// damit die reine URL-/Bbox-Konstruktion und die Antwort-Normalisierung unter
// dem tsx-Testrunner (web/run-tests.sh) ohne den nativen Modulgraphen geprüft
// werden kann – analog zu geozoneCoverage.ts / frZoneTypes.ts. geozones.ts
// importiert die `*From`-Varianten und injiziert die jeweilige Länder-Config
// (CH-Identify-URL/-Layers, NL-Layer, FR-WMS-Basis-URL), sodass die öffentliche
// API (und alle Aufrufer) unverändert bleibt.
import type { GeozoneFeatureInfo, GeozoneLayer } from "./geozones";
import { FR_ZONE_TYPES, classifyFrRestrictionType } from "./frZoneTypes";

// Label für aktivierbare (temporäre) LU-UAS-Zonen. Hier definiert (statt in
// geozones.ts), damit parseLuWmsToGeozoneInfo RN-frei bleibt; geozones.ts
// re-exportiert es für bestehende Importe (z. B. NotamsScreen).
export const LU_TEMP_ZONE_LABEL = "LU Aktivierbare UAS-Zonen";

// ---------------------------------------------------------------------------
// Schweiz (BAZL / geo.admin.ch REST identify)
// ---------------------------------------------------------------------------

export interface ChRestConfig {
  restIdentifyUrl?: string;
  restIdentifyLayers?: string[];
  layers: GeozoneLayer[];
}

export interface DipulWfsFeatureBatch {
  layer: string;
  features: unknown[];
}

export interface DipulWfsQueryResult {
  zones: GeozoneFeatureInfo[];
  failedLayers: string[];
  fallbackLayers: string[];
}

// Wird seit dem Direktabruf (kein App-Proxy, keine Anmeldung) nicht mehr
// geworfen; bleibt für bestehende instanceof-Prüfungen der Aufrufer erhalten.
export class DipulWfsAccessError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(status === 403
      ? "DIPUL-Geozonen für Deutschland sind für dieses Konto nicht freigeschaltet"
      : "Anmeldung für DIPUL-Geozonen erforderlich");
    this.name = "DipulWfsAccessError";
    this.status = status;
  }
}

function dipulPropertyText(properties: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = properties[key];
    if (value !== null && value !== undefined && String(value).trim() && String(value) !== "null") {
      return String(value).trim();
    }
  }
  return "";
}

function dipulRingToLatLng(rawRing: unknown): [number, number][] {
  if (!Array.isArray(rawRing)) return [];
  return rawRing
    .filter((point): point is number[] =>
      Array.isArray(point) && point.length >= 2 &&
      Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])),
    )
    // DIPUL GeoJSON follows GeoJSON coordinate order [longitude, latitude].
    .map((point) => [Number(point[1]), Number(point[0])]);
}

function dipulGeometryToGroups(geometry: any): [number, number][][][] {
  if (geometry?.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    const rings = geometry.coordinates.map(dipulRingToLatLng).filter((ring: [number, number][]) => ring.length >= 4);
    return rings.length > 0 ? [rings] : [];
  }
  if (geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .filter(Array.isArray)
      .map((polygon: unknown[]) =>
        polygon.map(dipulRingToLatLng).filter((ring: [number, number][]) => ring.length >= 4),
      )
      .filter((rings: [number, number][][]) => rings.length > 0);
  }
  return [];
}

export function dipulZoneFromFeature(
  rawFeature: any,
  layer: GeozoneLayer,
): GeozoneFeatureInfo | null {
  const properties =
    rawFeature?.properties && typeof rawFeature.properties === "object"
      ? rawFeature.properties as Record<string, unknown>
      : {};
  const polygonGroups = dipulGeometryToGroups(rawFeature?.geometry);
  if (polygonGroups.length === 0) return null;

  const typeCode = dipulPropertyText(properties, "type_code");
  const typeDetail = dipulPropertyText(properties, "type_code_detail");
  const legalRef = dipulPropertyText(properties, "legal_ref");
  const lowerAltitude = dipulPropertyText(properties, "lower_limit_altitude");
  const lowerUnit = dipulPropertyText(properties, "lower_limit_unit");
  const lowerRef = dipulPropertyText(properties, "lower_limit_alt_ref");
  const upperAltitude = dipulPropertyText(properties, "upper_limit_altitude");
  const upperUnit = dipulPropertyText(properties, "upper_limit_unit");
  const upperRef = dipulPropertyText(properties, "upper_limit_alt_ref");
  const externalReference = dipulPropertyText(properties, "external_reference");
  const name = dipulPropertyText(
    properties,
    "name",
    "generated_name_DE",
    "bezeichnung",
    "generated_name_EN",
  ) || layer.label;

  const details: string[] = [];
  if (typeCode) details.push(`Typ: ${typeCode.replace(/_/g, " ").toLowerCase()}`);
  if (typeDetail) details.push(`DIPUL-Klassifikation: ${typeDetail}`);
  if (legalRef) details.push(`Rechtshinweis: ${legalRef}`);
  if (lowerAltitude) {
    details.push(`Untere Grenze: ${lowerAltitude}${lowerUnit ? ` ${lowerUnit}` : ""}${lowerRef ? ` ${lowerRef}` : ""}`);
  }
  if (upperAltitude) {
    details.push(`Obere Grenze: ${upperAltitude}${upperUnit ? ` ${upperUnit}` : ""}${upperRef ? ` ${upperRef}` : ""}`);
  }
  if (externalReference) details.push(`Identifikation: ${externalReference}`);

  // Temporäre dipul-Zonen tragen start_time/end_time: als hartes
  // Gültigkeitsfenster für zoneActivityAt übernehmen (Live-WFS und
  // Kachel-Speicher nutzen beide diese Funktion).
  const parseTs = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const t = new Date(String(v)).getTime();
    return Number.isFinite(t) ? t : null;
  };
  const validStartTs = parseTs(properties.start_time);
  const validEndTs = parseTs(properties.end_time);

  const polygonRings = polygonGroups.flat();
  return {
    layerLabel: layer.label,
    name,
    details: details.join("\n"),
    featureId: String(rawFeature?.id || externalReference || "") || undefined,
    polygonRings,
    polygonGroups,
    country: "DE",
    ...(validStartTs != null || validEndTs != null ? { validStartTs, validEndTs } : {}),
  };
}

export function parseDipulWfsBatches(
  batches: DipulWfsFeatureBatch[],
  layers: GeozoneLayer[],
  initiallyFailedLayers: string[] = [],
): DipulWfsQueryResult {
  const layerByName = new Map(layers.map((layer) => [layer.wmsLayer, layer]));
  const failedLayers = new Set(initiallyFailedLayers);
  const zones: GeozoneFeatureInfo[] = [];

  for (const batch of batches) {
    const layer = layerByName.get(batch.layer);
    if (!layer || !Array.isArray(batch.features)) {
      failedLayers.add(batch.layer);
      continue;
    }
    for (const feature of batch.features) {
      const zone = dipulZoneFromFeature(feature, layer);
      if (zone) zones.push(zone);
      else failedLayers.add(batch.layer);
    }
  }

  const seen = new Set<string>();
  const uniqueZones = zones.filter((zone) => {
    const key = `${zone.layerLabel}|${zone.featureId || zone.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    zones: uniqueZones,
    failedLayers: [...failedLayers],
    fallbackLayers: [],
  };
}

// DIPUL-WFS (DFS / uas-betrieb.de) – öffentlich, ohne Anmeldung. Früher über
// den App-Proxy `/api/proxy/dipul-geozones` abgefragt; jetzt direkt.
export const DIPUL_WFS_URL = "https://uas-betrieb.de/geoservices/dipul/ows";
// Diese Layer bleiben beim bisherigen WMS-GetFeatureInfo-Pfad: der temporäre
// WFS-Layer ist nicht zuverlässig, die übrigen sind in den WFS-Capabilities
// nicht veröffentlicht.
export const DIPUL_WFS_EXCLUDED_LAYERS = new Set([
  "temporaere_betriebseinschraenkungen",
  "modellflugplaetze",
  "haengegleiter",
]);
// Ab so vielen Treffern gilt ein Layer als abgeschnitten -> WMS-Fallback.
export const DIPUL_WFS_MAX_FEATURES = 250;
const DIPUL_WFS_LAYER_TIMEOUT_MS = 6000;
const DIPUL_WFS_CONCURRENCY = 8;

async function fetchDipulWfsLayer(
  layer: string,
  bbox: string,
): Promise<unknown[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIPUL_WFS_LAYER_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      SERVICE: "WFS",
      VERSION: "2.0.0",
      REQUEST: "GetFeature",
      TYPENAMES: `dipul:${layer}`,
      OUTPUTFORMAT: "application/json",
      SRSNAME: "EPSG:4326",
      BBOX: bbox,
      COUNT: String(DIPUL_WFS_MAX_FEATURES),
    });
    const response = await fetch(`${DIPUL_WFS_URL}?${params}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json() as {
      features?: unknown[];
      numberMatched?: number | string;
      totalFeatures?: number | string;
    };
    if (!Array.isArray(data?.features)) return null;
    const matched = Number(data.numberMatched ?? data.totalFeatures);
    const truncated =
      (Number.isFinite(matched) && matched > data.features.length) ||
      data.features.length >= DIPUL_WFS_MAX_FEATURES;
    return truncated ? null : data.features;
  } catch (error) {
    console.warn(`[DIPUL WFS] layer ${layer} failed:`, error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fragt die permanenten DIPUL-Geozonen als GeoJSON direkt beim DIPUL-WFS ab
 * (ein GetFeature je Layer, max. 8 parallel). Layer, die fehlschlagen oder
 * abgeschnitten wären, landen in `failedLayers`; nicht per WFS abfragbare
 * Layer in `fallbackLayers` (Aufrufer nutzt dafür WMS-GetFeatureInfo).
 *
 * @param _apiBaseUrl Veraltet und ignoriert (früher die Backend-Basis-URL).
 */
export async function queryDipulWfsFeaturesFrom(
  _apiBaseUrl: string,
  layers: GeozoneLayer[],
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<DipulWfsQueryResult> {
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lon) || lon < -180 || lon > 180 ||
    !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 25
  ) {
    // Wie früher der Proxy (HTTP 400): Aufrufer fällt auf WMS zurück.
    throw new Error("DIPUL Vektordaten nicht verfügbar (400)");
  }

  // DIPUL-WFS erwartet die EPSG:4326-BBOX in lon,lat-Reihenfolge.
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const bbox = [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta, "EPSG:4326"].join(",");

  const allLayers = layers.map((layer) => layer.wmsLayer);
  const fallbackLayers = allLayers.filter((layer) => DIPUL_WFS_EXCLUDED_LAYERS.has(layer));
  const queue = allLayers.filter((layer) => !DIPUL_WFS_EXCLUDED_LAYERS.has(layer));
  const byLayer: DipulWfsFeatureBatch[] = [];
  const failedLayers: string[] = [];

  const worker = async () => {
    while (queue.length > 0) {
      const layer = queue.shift();
      if (!layer) return;
      const features = await fetchDipulWfsLayer(layer, bbox);
      if (features) byLayer.push({ layer, features });
      else failedLayers.push(layer);
    }
  };
  await Promise.all(Array.from({ length: DIPUL_WFS_CONCURRENCY }, () => worker()));

  const parsed = parseDipulWfsBatches(byLayer, layers, failedLayers);
  parsed.fallbackLayers = fallbackLayers;
  return parsed;
}

async function queryChRestIdentifySingle(
  config: ChRestConfig,
  lat: number,
  lon: number,
  radiusKm: number,
  layerLookup: Record<string, string>,
): Promise<GeozoneFeatureInfo[]> {
  if (!config.restIdentifyUrl || !config.restIdentifyLayers) return [];

  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
  const minLon = (lon - dLon).toFixed(5);
  const minLat = (lat - dLat).toFixed(5);
  const maxLon = (lon + dLon).toFixed(5);
  const maxLat = (lat + dLat).toFixed(5);
  const imgSize = 1000;

  const url = `${config.restIdentifyUrl}?geometry=${lon},${lat}`
    + `&geometryType=esriGeometryPoint`
    + `&layers=all:${config.restIdentifyLayers.join(",")}`
    + `&sr=4326&returnGeometry=false&tolerance=10`
    + `&mapExtent=${minLon},${minLat},${maxLon},${maxLat}&imageDisplay=${imgSize},${imgSize},96`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return parseChIdentifyResponse(data, layerLookup);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryChRestIdentifyFrom(
  config: ChRestConfig,
  lat: number,
  lon: number,
  radiusKm: number = 1,
): Promise<GeozoneFeatureInfo[]> {
  const layerLookup: Record<string, string> = {};
  for (const l of config.layers) {
    layerLookup[l.wmsLayer] = l.label;
  }

  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const dLat = radiusKm * kmToDegLat;
  const dLon = radiusKm * kmToDegLon;

  const sampleOffsets: [number, number][] = [
    [0, 0],
    [0, -1], [0, 1],
    [1, 0], [-1, 0],
    [0.7, 0.7], [-0.7, 0.7],
    [0.7, -0.7], [-0.7, -0.7],
  ];
  const samplePoints = sampleOffsets.map(([fy, fx]) => [lat + fy * dLat, lon + fx * dLon] as [number, number]);

  const results = await Promise.all(
    samplePoints.map(([sLat, sLon]) => queryChRestIdentifySingle(config, sLat, sLon, 0.5, layerLookup).catch(() => [] as GeozoneFeatureInfo[]))
  );

  const seen = new Set<string>();
  const allResults: GeozoneFeatureInfo[] = [];
  for (const zones of results) {
    for (const z of zones) {
      const key = `${z.layerLabel}|${z.name}|${z.details}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allResults.push(z);
    }
  }

  return allResults;
}

export function parseChIdentifyResponse(data: any, layerLookup: Record<string, string>): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  if (!data.results || !Array.isArray(data.results)) return results;

  for (const feature of data.results) {
    const attrs = feature.attributes || feature.properties || {};
    const layerId = feature.layerBodId || feature.layerName || "";
    const layerLabel = layerLookup[layerId] || layerId;

    const name = attrs.zone_name_de || attrs.zone_name || attrs.name_de || attrs.name || attrs.bezeichnung || layerLabel;

    const detailParts: string[] = [];

    const restriction = attrs.zone_restriction_de || attrs.zone_restriction;
    if (restriction) detailParts.push(`Einschränkung: ${restriction}`);

    const description = attrs.description_de || attrs.description;
    if (description && !restriction) detailParts.push(`Beschreibung: ${description}`);

    const message = attrs.zone_message_de || attrs.zone_message;
    if (message) detailParts.push(`Hinweis: ${message}`);

    const reason = attrs.zone_reason_id;
    if (reason) detailParts.push(`Grund: ${reason.replace(/_/g, " ")}`);

    const authNames = attrs.auth_name_de || attrs.auth_name;
    if (authNames) {
      const names = Array.isArray(authNames) ? authNames.filter(Boolean).join(", ") : String(authNames);
      if (names) detailParts.push(`Behörde: ${names}`);
    }

    const authService = attrs.auth_service_de || attrs.auth_service;
    if (authService) {
      const svc = Array.isArray(authService) ? authService.filter(Boolean).join(", ") : String(authService);
      if (svc) detailParts.push(`Dienst: ${svc}`);
    }

    const authEmails = attrs.auth_email || attrs.auth_contact;
    if (authEmails) {
      const emails = Array.isArray(authEmails) ? authEmails.filter(Boolean).join(", ") : String(authEmails);
      if (emails) detailParts.push(`E-Mail: ${emails}`);
    }

    const authPhones = attrs.auth_phone;
    if (authPhones) {
      const phones = Array.isArray(authPhones) ? authPhones.filter(Boolean).join(", ") : String(authPhones);
      if (phones) detailParts.push(`Telefon: ${phones}`);
    }

    const authUrls = attrs.auth_url_de || attrs.auth_url;
    if (authUrls) {
      const urls = Array.isArray(authUrls) ? authUrls.filter(Boolean).join(", ") : String(authUrls);
      if (urls) detailParts.push(`Info: ${urls}`);
    }

    if (attrs.air_vol_lower_limit != null || attrs.air_vol_upper_limit != null) {
      const lower = attrs.air_vol_lower_limit != null ? `${attrs.air_vol_lower_limit} m ${attrs.air_vol_lower_vref || ""}`.trim() : "SFC";
      const upper = attrs.air_vol_upper_limit != null ? `${attrs.air_vol_upper_limit} m ${attrs.air_vol_upper_vref || ""}`.trim() : "unbegrenzt";
      detailParts.push(`Höhe: ${lower} – ${upper}`);
    }

    if (attrs.time_permanent === "Yes") {
      detailParts.push("Gültigkeit: dauerhaft");
    } else if (attrs.time_start || attrs.time_end) {
      detailParts.push(`Gültigkeit: ${attrs.time_start || "?"} – ${attrs.time_end || "?"}`);
    }

    if (detailParts.length === 0 && !name) continue;

    results.push({
      layerLabel,
      name: String(name),
      details: detailParts.join("\n"),
      featureId: attrs.label || feature.id || undefined,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Luxemburg (geoportail.lu WMS GetFeatureInfo, text/plain)
// ---------------------------------------------------------------------------

export function parseLuWmsPlainText(text: string): Record<string, string>[] {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());
  const results: Record<string, string>[] = [];
  for (const block of blocks) {
    const props: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const idx = line.indexOf(" : ");
      if (idx < 0) continue;
      const key = line.substring(0, idx).trim();
      const val = line.substring(idx + 3).trim();
      props[key] = val;
    }
    if (Object.keys(props).length > 0) results.push(props);
  }
  return results;
}

export function luWmsDateToDisplay(dateStr: string): string {
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return dateStr;
  return `${m[1]}.${m[2]}.${m[3]}, ${m[4]}:${m[5]}`;
}

export function luWmsDateToMs(dateStr: string): number {
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss || "00"}`;
  const d = new Date(iso);
  return d.getTime();
}

export async function queryLuWmsFeatureInfo(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<Record<string, string>[]> {
  const lonToMercXLocal = (l: number) => (l * 20037508.34) / 180;
  const latToMercYLocal = (la: number) => {
    const r = Math.log(Math.tan(((90 + la) * Math.PI) / 360)) * 20037508.34 / Math.PI;
    return r;
  };
  const halfM = radiusKm * 1000;
  const cx = lonToMercXLocal(lon);
  const cy = latToMercYLocal(lat);

  const bbox = `${cx - halfM},${cy - halfM},${cx + halfM},${cy + halfM}`;
  const url = `https://wms.geoportail.lu/public_map_layers/service?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo`
    + `&LAYERS=1927,1928&QUERY_LAYERS=1927,1928`
    + `&SRS=EPSG:3857&BBOX=${bbox}`
    + `&WIDTH=256&HEIGHT=256&X=128&Y=128`
    + `&INFO_FORMAT=text/plain&FEATURE_COUNT=50`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return [];
    const text = await resp.text();
    if (!text || text.trim() === "no features were found") return [];
    return parseLuWmsPlainText(text);
  } catch (e: any) {
    console.warn("[Geozones] LU WMS FeatureInfo error:", e?.message || e);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryLuOgcFeaturesFrom(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<GeozoneFeatureInfo[]> {
  const lonToMercXLocal = (l: number) => (l * 20037508.34) / 180;
  const latToMercYLocal = (la: number) => Math.log(Math.tan(((90 + la) * Math.PI) / 360)) * 20037508.34 / Math.PI;

  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const dLat = radiusKm * kmToDegLat;
  const dLon = radiusKm * kmToDegLon;

  const sampleOffsets: [number, number][] = [
    [0, 0],
    [0, -0.7], [0, 0.7],
    [0.7, 0], [-0.7, 0],
    [0.5, 0.5], [-0.5, 0.5],
    [0.5, -0.5], [-0.5, -0.5],
  ];

  const localHalfM = 500;
  const imgSize = 256;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const results = await Promise.all(
      sampleOffsets.map(async ([oLat, oLon]) => {
        const sLat = lat + oLat * dLat;
        const sLon = lon + oLon * dLon;
        const cx = lonToMercXLocal(sLon);
        const cy = latToMercYLocal(sLat);
        const bbox = `${cx - localHalfM},${cy - localHalfM},${cx + localHalfM},${cy + localHalfM}`;
        const url = `https://wms.geoportail.lu/public_map_layers/service?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo`
          + `&LAYERS=1927,1928&QUERY_LAYERS=1927,1928`
          + `&SRS=EPSG:3857&BBOX=${bbox}`
          + `&WIDTH=${imgSize}&HEIGHT=${imgSize}&X=${imgSize / 2}&Y=${imgSize / 2}`
          + `&INFO_FORMAT=text/plain&FEATURE_COUNT=50`;
        try {
          const resp = await fetch(url, { signal: controller.signal });
          if (!resp.ok) return [];
          const text = await resp.text();
          if (!text || text.trim() === "no features were found") return [];
          return parseLuWmsPlainText(text);
        } catch {
          return [] as Record<string, string>[];
        }
      })
    );

    const seen = new Set<string>();
    const allRaw: Record<string, string>[] = [];
    for (const raw of results) {
      for (const wms of raw) {
        const key = `${wms["Zone Identifier"] || ""}-${wms["Lower limit (meter)"] || ""}-${wms["Upper limit (meter)"] || ""}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        allRaw.push(wms);
      }
    }
    return parseLuWmsToGeozoneInfo(allRaw);
  } catch (e: any) {
    console.warn("[Geozones] LU query error:", e?.message || e);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export function parseLuWmsToGeozoneInfo(features: Record<string, string>[]): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  const seen = new Set<string>();

  for (const wms of features) {
    const nomZone = wms["Zone Identifier"] || "";
    const description = wms["Description"] || "";
    const dedup = `${nomZone}-${wms["Lower limit (meter)"] || ""}-${wms["Upper limit (meter)"] || ""}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const rawName = nomZone || description || "UAS-Zone";
    const name = translateLuFrench(rawName);

    const detailParts: string[] = [];
    if (description) detailParts.push(`Beschreibung: ${translateLuFrench(description)}`);
    const nature = wms["Nature of proctection"];
    if (nature) {
      const reasonMap: Record<string, string> = { AERO: "Flugplatz", NATURE: "Naturschutz", MILITARY: "Militär", SENSITIVE: "Sensibel", PRIVACY: "Privatsphäre", TERR: "Gebietsschutz", NUCLEAR: "Kernanlage", PRISON: "Justizvollzug", HOSPITAL: "Krankenhaus", INDUSTRIAL: "Industrieanlage", OTHER: "Sonstige" };
      detailParts.push(`Grund: ${reasonMap[nature] || nature}`);
    }
    const minH = wms["Lower limit (meter)"];
    const maxH = wms["Upper limit (meter)"];
    if (minH || maxH) {
      detailParts.push(`Höhe: ${minH ? parseFloat(minH) : 0} – ${maxH ? parseFloat(maxH) : "?"} m`);
    }
    const resp = wms["Responsability"];
    if (resp) detailParts.push(`Zuständigkeit: ${translateLuFrench(resp)}`);
    const startDate = wms["Start date and time"];
    const endDate = wms["End date and time"];
    if (startDate || endDate) {
      detailParts.push(`Von: ${startDate ? luWmsDateToDisplay(startDate) : "?"}`);
      detailParts.push(`Bis: ${endDate ? luWmsDateToDisplay(endDate) : "?"}`);
    }
    const activite = wms["Activity"];
    if (activite) detailParts.push(`Status: ${LU_ACTIVITE_DE[activite] || activite}`);
    const durPrev = wms["Duration of previsualisation (hours)"];
    if (durPrev) detailParts.push(`Vorankündigung: ${parseFloat(durPrev)} Std.`);
    const remarks = wms["Remarks"];
    if (remarks) detailParts.push(`Hinweis: ${translateLuFrench(remarks)}`);

    const isInactive = activite ? /^(inactif|inactive|INACTIF|INACTIVE)$/i.test(activite) : false;
    let longDuration = false;
    if (startDate && endDate) {
      const startMs = luWmsDateToMs(startDate);
      const endMs = luWmsDateToMs(endDate);
      if (startMs > 0 && endMs > 0 && (endMs - startMs) > 365.25 * 24 * 3600 * 1000) {
        longDuration = true;
      }
    }
    const isPermanent = (longDuration || (activite ? /^permanent$/i.test(activite) : false)) && !isInactive;

    const layerLabel = isPermanent
      ? (minH && parseFloat(minH) >= 50 ? "UAS-Zonen 50–120 m" : "UAS-Zonen 0–50 m")
      : LU_TEMP_ZONE_LABEL;

    // Temporäre Zonen: Gültigkeitsfenster strukturiert mitgeben, damit
    // zoneActivityAt (Radar-Reiter, Karte, Planung) es auswertet – statt den
    // Detailtext („Status: Inaktiv“/„Von:“) zu parsen. Dauerhafte Zonen bleiben
    // ohne Fenster (immer aktiv, sicherheitshalber).
    const startMs = !isPermanent && startDate ? luWmsDateToMs(startDate) : NaN;
    const endMs = !isPermanent && endDate ? luWmsDateToMs(endDate) : NaN;
    const validity =
      startMs > 0 || endMs > 0
        ? { validStartTs: startMs > 0 ? startMs : null, validEndTs: endMs > 0 ? endMs : null }
        : {};

    results.push({
      layerLabel,
      name,
      details: detailParts.join("\n"),
      featureId: nomZone || undefined,
      ...validity,
    });
  }

  return results;
}

const LU_FR_DE_TRANSLATIONS: Record<string, string> = {
  "Aérodrome": "Flugplatz",
  "aérodrome": "Flugplatz",
  "Aeroport": "Flughafen",
  "aeroport": "Flughafen",
  "Héliport": "Hubschrauberlandeplatz",
  "héliport": "Hubschrauberlandeplatz",
  "Zone interdite": "Flugverbotszone",
  "zone interdite": "Flugverbotszone",
  "Zone restreinte": "Beschränktes Gebiet",
  "zone restreinte": "Beschränktes Gebiet",
  "Zone dangereuse": "Gefahrengebiet",
  "zone dangereuse": "Gefahrengebiet",
  "Réserve naturelle": "Naturschutzgebiet",
  "réserve naturelle": "Naturschutzgebiet",
  "Zone de protection": "Schutzzone",
  "zone de protection": "Schutzzone",
  "Zone de contrôle": "Kontrollzone",
  "zone de contrôle": "Kontrollzone",
  "Espace aérien contrôlé": "Kontrollierter Luftraum",
  "Zone militaire": "Militärgebiet",
  "zone militaire": "Militärgebiet",
  "Château": "Schloss",
  "château": "Schloss",
  "Centre pénitentiaire": "Justizvollzugsanstalt",
  "centre pénitentiaire": "Justizvollzugsanstalt",
  "Centre de rétention": "Abschiebungshaftanstalt",
  "centre de rétention": "Abschiebungshaftanstalt",
  "Centre de détention": "Haftanstalt",
  "centre de détention": "Haftanstalt",
  "Prison": "Gefängnis",
  "prison": "Gefängnis",
  "Établissement pénitentiaire": "Justizvollzugsanstalt",
  "établissement pénitentiaire": "Justizvollzugsanstalt",
  "Hôpital": "Krankenhaus",
  "hôpital": "Krankenhaus",
  "École": "Schule",
  "école": "Schule",
  "Centrale nucléaire": "Kernkraftwerk",
  "centrale nucléaire": "Kernkraftwerk",
  "Parc naturel": "Naturpark",
  "parc naturel": "Naturpark",
  "Site classé": "Denkmalgeschütztes Gebiet",
  "Ambassade": "Botschaft",
  "ambassade": "Botschaft",
  "Palais": "Palast",
  "palais": "Palast",
  "Hélistation": "Hubschrauberlandeplatz",
  "Site": "Standort",
  "hélistation": "Hubschrauberlandeplatz",
  "Hélipad": "Hubschrauberlandeplatz",
  "hélipad": "Hubschrauberlandeplatz",
  "Port de": "Hafen von",
  "port de": "Hafen von",
  "Gare": "Bahnhof",
  "gare": "Bahnhof",
  "Stade": "Stadion",
  "stade": "Stadion",
  "Caserne": "Kaserne",
  "caserne": "Kaserne",
  "Cimetière": "Friedhof",
  "cimetière": "Friedhof",
  "Église": "Kirche",
  "église": "Kirche",
  "Cathédrale": "Kathedrale",
  "cathédrale": "Kathedrale",
  "Musée": "Museum",
  "musée": "Museum",
  "Bibliothèque": "Bibliothek",
  "bibliothèque": "Bibliothek",
  "Mairie": "Rathaus",
  "mairie": "Rathaus",
  "Tribunal": "Gericht",
  "tribunal": "Gericht",
  "Poste de police": "Polizeiwache",
  "poste de police": "Polizeiwache",
  "Université": "Universität",
  "université": "Universität",
  "Lycée": "Gymnasium",
  "lycée": "Gymnasium",
};

export const LU_ACTIVITE_DE: Record<string, string> = {
  active: "Aktiv",
  inactive: "Inaktiv",
  permanent: "Dauerhaft",
  temporary: "Vorübergehend",
  ACTIVE: "Aktiv",
  INACTIVE: "Inaktiv",
  PERMANENT: "Dauerhaft",
  TEMPORARY: "Vorübergehend",
  Actif: "Aktiv",
  Inactif: "Inaktiv",
  ACTIF: "Aktiv",
  INACTIF: "Inaktiv",
  Permanent: "Dauerhaft",
  Temporaire: "Vorübergehend",
  TEMPORAIRE: "Vorübergehend",
};

const LU_SORTED_TRANSLATIONS = Object.entries(LU_FR_DE_TRANSLATIONS)
  .sort((a, b) => b[0].length - a[0].length);

export function translateLuFrench(text: string): string {
  let result = text;
  for (const [fr, de] of LU_SORTED_TRANSLATIONS) {
    if (result.includes(fr)) {
      result = result.replace(new RegExp(fr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), de);
    }
  }
  result = result
    .replace(/\bd'([A-ZÀÂÇÉÈÊËÎÏÔÙÛÜŸÆŒ])/g, "von $1")
    .replace(/\bde la\b/gi, "der")
    .replace(/\bde l'/gi, "des ")
    .replace(/\bdu\b/g, "des")
    .replace(/\bde\b/g, "von");
  return result;
}

// ---------------------------------------------------------------------------
// Niederlande (PDOK WFS/WMS GetFeatureInfo)
// ---------------------------------------------------------------------------

const NL_LOCALTYPE_DE: Record<string, string> = {
  Verboden: "Verboten (Prohibited)",
  Beperking: "Beschränkt (Restricted)",
  CTR: "Kontrollzone (CTR)",
  TMA: "Nahverkehrsbereich (TMA)",
  Natura2000: "Natura-2000-Schutzgebiet",
  Militair: "Militärgebiet",
  Laagvlieggebied: "Tieffluggebiet",
  Gevaarlijk: "Gefahrengebiet (Danger)",
};

function translateNlLocalType(localtype: string): string {
  return NL_LOCALTYPE_DE[localtype] || localtype;
}

const NL_WMS_TO_WFS_TYPENAME: Record<string, string> = {
  luchtvaartgebieden: "drone-no-flyzones:luchtvaartgebieden",
  luchtvaartgebieden_zonder_natura2000: "drone-no-flyzones:luchtvaartgebieden_zonder_natura2000",
  landingsite: "drone-no-flyzones:landingsite",
};

const NL_SPECIFIEK_DE: Record<string, string> = {
  Heliport: "Hubschrauberlandeplatz",
  Luchthaven: "Flughafen",
  Vliegveld: "Flugplatz",
};

const NL_SOURCE_DE: Record<string, string> = {
  "Gecontroleerde luchthavens en/of radioverplichting (Verboden voor open categorie)": "Kontrollierte Flughäfen und/oder Funkpflicht (Verboten für offene Kategorie)",
  "Gecontroleerde luchthavens (Verboden voor open categorie)": "Kontrollierte Flughäfen (Verboten für offene Kategorie)",
  "Radioverplichting (Verboden voor open categorie)": "Funkpflicht (Verboten für offene Kategorie)",
  "Verboden voor open categorie": "Verboten für offene Kategorie",
  "Beperkt voor open categorie": "Beschränkt für offene Kategorie",
  "Beperkt toegestaan": "Eingeschränkt erlaubt",
  "Toegestaan met beperkingen": "Erlaubt mit Einschränkungen",
  "Verboden in open categorie": "Verboten in offener Kategorie",
  "Laagvliegroute": "Tiefflugstrecke",
  "Laagvliegroute Defensie": "Tiefflugstrecke Verteidigung",
  "Laagvliegrouten en -gebieden": "Tiefflugrouten und -gebiete",
  "Havens en industriegebieden": "Häfen und Industriegebiete",
  "Schietrange": "Schießanlage",
  "Militair oefengebied": "Militärisches Übungsgebiet",
  "Vliegveld": "Flugplatz",
  "Zweefvliegterrein": "Segelfluggelände",
  "Modelvliegterrein": "Modellfluggelände",
  "Vliegbasis": "Luftwaffenstützpunkt",
  "Helikopterlandingsplaats": "Hubschrauberlandeplatz",
  "Luchthaven": "Flughafen",
};

// Reihenfolge ist wichtig: zuerst längere/spezifische Phrasen, dann
// einzelne Wörter, ganz zuletzt generische Konnektoren wie "en" -> "und".
const NL_WORD_DE: [RegExp, string][] = [
  [/\bGecontroleerde luchthavens\b/g, "Kontrollierte Flughäfen"],
  [/\bradioverplichting\b/gi, "Funkpflicht"],
  [/\bVerboden voor open categorie\b/gi, "Verboten für offene Kategorie"],
  [/\bBeperkt voor open categorie\b/gi, "Beschränkt für offene Kategorie"],
  [/\bBeperkt toegestaan\b/gi, "Eingeschränkt erlaubt"],
  [/\bToegestaan met beperkingen\b/gi, "Erlaubt mit Einschränkungen"],
  [/\bToegestaan\b/gi, "Erlaubt"],
  [/\bBeperkingen\b/gi, "Einschränkungen"],
  [/\bBeperking\b/gi, "Einschränkung"],
  [/\bBeperkt\b/gi, "Beschränkt"],
  [/\bVerboden\b/g, "Verboten"],
  [/\blaagvliegrouten\b/gi, "Tiefflugrouten"],
  [/\blaagvliegroute\b/gi, "Tiefflugstrecke"],
  [/\blaagvlieggebieden\b/gi, "Tieffluggebiete"],
  [/\blaagvlieggebied\b/gi, "Tieffluggebiet"],
  [/\bindustriegebieden\b/gi, "Industriegebiete"],
  [/\bindustriegebied\b/gi, "Industriegebiet"],
  [/\bhavens\b/gi, "Häfen"],
  [/\bhaven\b/gi, "Hafen"],
  [/-gebieden\b/gi, "-gebiete"],
  [/\bgebieden\b/gi, "Gebiete"],
  [/\bgebied\b/gi, "Gebiet"],
  [/\bmilitair\b/gi, "Militärisch"],
  [/\boefengebied\b/gi, "Übungsgebiet"],
  [/\bschietrange\b/gi, "Schießanlage"],
  [/\bgevaarlijk gebied\b/gi, "Gefahrengebiet"],
  [/\bluchthavens\b/gi, "Flughäfen"],
  [/\bluchthaven\b/gi, "Flughafen"],
  [/\bvliegveld\b/gi, "Flugplatz"],
  [/\bvliegbasis\b/gi, "Luftwaffenstützpunkt"],
  [/\bzweefvliegterrein\b/gi, "Segelfluggelände"],
  [/\bmodelvliegterrein\b/gi, "Modellfluggelände"],
  [/\bhelikopterlandingsplaats\b/gi, "Hubschrauberlandeplatz"],
  [/\bnatura\s*2000\b/gi, "Natura-2000"],
  [/\bbeschermd natuurgebied\b/gi, "Geschütztes Naturgebiet"],
  [/\bbestaande en nieuwe natuur\b/gi, "bestehende und neue Naturgebiete"],
  [/\bbestaande natuur\b/gi, "bestehende Naturgebiete"],
  [/\bnieuwe natuur\b/gi, "neue Naturgebiete"],
  [/\bnatuur\b/gi, "Natur"],
  [/\bnatuurnetwerk\s+nederland\b/gi, "Naturnetzwerk Niederlande"],
  [/\bnatuurgebied(en)?\b/gi, "Naturgebiet$1"],
  [/\bnatuurmonument(en)?\b/gi, "Naturdenkmal$1"],
  [/\bnatuurreservaat\b/gi, "Naturreservat"],
  [/\bnationaal park\b/gi, "Nationalpark"],
  [/\bduinen\b/gi, "Dünen"],
  [/\bbos\b/gi, "Wald"],
  [/\bmeer\b/gi, "See"],
  [/\briviere?n?\b/gi, "Fluss"],
  [/\bkust\b/gi, "Küste"],
  [/\bvallei\b/gi, "Tal"],
  [/\beiland\b/gi, "Insel"],
  [/\ben\/of\b/g, "und/oder"],
  [/\ben\b/g, "und"],
  [/\bvoor\b/g, "für"],
  [/\bmet\b/g, "mit"],
  [/\bopen categorie\b/gi, "offene Kategorie"],
];

function translateNlSource(source: string): string {
  if (!source) return source;
  const exact = NL_SOURCE_DE[source];
  if (exact) return exact;
  let result = source;
  for (const [pattern, replacement] of NL_WORD_DE) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export async function queryNlWfsFeaturesFrom(
  nlLayers: GeozoneLayer[],
  lat: number,
  lon: number,
  radiusKm: number,
  activeWmsLayers?: string[],
): Promise<GeozoneFeatureInfo[]> {
  const delta = radiusKm / 111.32;
  const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},EPSG:4326`;

  const wmsLayersToQuery = activeWmsLayers && activeWmsLayers.length > 0
    ? activeWmsLayers
    : ["luchtvaartgebieden"];

  // Pro Layer ein eigenes Timeout + AbortController, damit ein langsamer
  // PDOK-Endpoint (NNN/Natura2000 sind teilweise zäh) nicht alle anderen
  // Layer mit blockiert. Vorher liefen die Layer sequenziell mit gemeinsamem
  // 12s-Timeout — der Geozonen-Check konnte dadurch mehrere Minuten
  // erscheinen, wenn ein Layer hing.
  const PER_LAYER_TIMEOUT_MS = 8000;

  const queryOneLayer = async (wmsLayer: string): Promise<GeozoneFeatureInfo[]> => {
    const nlLayer = nlLayers.find((l) => l.wmsLayer === wmsLayer);
    const layerLabel = nlLayer?.label || "Flugverbotszone (NL)";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PER_LAYER_TIMEOUT_MS);
    try {
      if (nlLayer?.wmsBaseUrl) {
        return await queryNlPdokWmsFeatureInfo(
          nlLayer.wmsBaseUrl,
          nlLayer.wmsVersion || "1.3.0",
          wmsLayer,
          layerLabel,
          lat, lon, radiusKm,
          controller.signal,
        );
      }
      const typeName = NL_WMS_TO_WFS_TYPENAME[wmsLayer];
      if (!typeName) return [];
      const isLandingsite = wmsLayer === "landingsite";
      const url = `https://service.pdok.nl/lvnl/drone-no-flyzones/wfs/v1_0?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${encodeURIComponent(typeName)}&OUTPUTFORMAT=${encodeURIComponent("application/json")}&SRSNAME=EPSG:4326&BBOX=${encodeURIComponent(bbox)}&count=50`;
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return isLandingsite
        ? parseNlLandingsiteResponse(data, layerLabel)
        : parseNlGeozoneResponse(data, layerLabel);
    } catch (e: any) {
      console.warn(`[Geozones] NL layer ${wmsLayer} failed:`, e?.message || e);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  };

  const settled = await Promise.allSettled(wmsLayersToQuery.map(queryOneLayer));
  const allResults: GeozoneFeatureInfo[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") allResults.push(...s.value);
  }

  const seen = new Set<string>();
  return allResults.filter((z) => {
    const key = `${z.layerLabel}|${z.name}|${z.details}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// PDOK WMS GetFeatureInfo (z. B. NNN, Natura 2000) — Bbox in EPSG:3857,
// FORMAT=image/png + INFO_FORMAT=application/json, Tap-Pixel in der Mitte
// einer ~`radiusKm`-großen Box. Parsed siteNameSpelling/Properties zu
// `GeozoneFeatureInfo` mit Polygon-Ring für Hervorhebung.
async function queryNlPdokWmsFeatureInfo(
  wmsBaseUrl: string,
  wmsVersion: string,
  wmsLayer: string,
  layerLabel: string,
  lat: number,
  lon: number,
  radiusKm: number,
  signal: AbortSignal,
): Promise<GeozoneFeatureInfo[]> {
  // Mercator-Box um den Klickpunkt (radiusKm Halbkante). Kein Boden mehr
  // (vorher: max(radiusKm, 0.5)) — sonst werden Polygone gemeldet, die
  // den blauen Umkreis nie berühren. Polygon-Geometrie wird zusätzlich
  // post-gefiltert via polygonRingsIntersectCircle.
  const halfM = radiusKm * 1000;
  const cx = lon * 20037508.34 / 180;
  const cy = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI * 20037508.34;
  const minX = cx - halfM, maxX = cx + halfM, minY = cy - halfM, maxY = cy + halfM;
  const W = 512, H = 512;
  const crsParam = wmsVersion === "1.3.0" ? "CRS" : "SRS";
  const iParam = wmsVersion === "1.3.0" ? "I" : "X";
  const jParam = wmsVersion === "1.3.0" ? "J" : "Y";
  // Sampling: Mittelpunkt + 8 Kompasspunkte am Kreisrand (0.95 r) +
  // 4 Punkte auf halbem Radius. Reines 3x3-Innenraster verfehlte Polygone,
  // die den Umkreis am Rand schneiden, ohne den inneren ~176 m-Bereich zu
  // treffen (z. B. Natura 2000 Brouwersdam bei kleinem Flugradius).
  const buildSamplePoints = (radiusFactor: number): { i: number; j: number }[] => {
    const pts: { i: number; j: number }[] = [{ i: Math.round(W / 2), j: Math.round(H / 2) }];
    const rim = [0, 45, 90, 135, 180, 225, 270, 315];
    const mid = [0, 90, 180, 270];
    for (const deg of rim) {
      const r = deg * Math.PI / 180;
      pts.push({
        i: Math.round(W / 2 + (W / 2) * radiusFactor * 0.95 * Math.cos(r)),
        j: Math.round(H / 2 - (H / 2) * radiusFactor * 0.95 * Math.sin(r)),
      });
    }
    for (const deg of mid) {
      const r = deg * Math.PI / 180;
      pts.push({
        i: Math.round(W / 2 + (W / 2) * radiusFactor * 0.5 * Math.cos(r)),
        j: Math.round(H / 2 - (H / 2) * radiusFactor * 0.5 * Math.sin(r)),
      });
    }
    return pts;
  };
  const buildUrl = (bboxStr: string, i: number, j: number) =>
    `${wmsBaseUrl}?SERVICE=WMS&VERSION=${wmsVersion}&REQUEST=GetFeatureInfo`
    + `&LAYERS=${encodeURIComponent(wmsLayer)}&QUERY_LAYERS=${encodeURIComponent(wmsLayer)}`
    + `&${crsParam}=EPSG:3857&BBOX=${bboxStr}&WIDTH=${W}&HEIGHT=${H}`
    + `&${iParam}=${i}&${jParam}=${j}&FORMAT=image/png&INFO_FORMAT=application/json&FEATURE_COUNT=10`;
  const runSamples = async (bboxStr: string, points: { i: number; j: number }[]) => {
    const responses = await Promise.all(
      points.map((p) =>
        fetch(buildUrl(bboxStr, p.i, p.j), { signal, headers: { Accept: "application/json" } })
          .then((r) => (r.ok ? r.json() : { features: [] }))
          .catch(() => ({ features: [] })),
      ),
    );
    const merged: any[] = [];
    const seen = new Set<string>();
    for (const data of responses) {
      for (const f of data.features || []) {
        const p = f.properties || {};
        const fid = f.id || p.identificatie || p.id
          || `${p.siteNameSpelling || p.naam || p.NAAM || p.gebiedsnaam || p.title || ""}|${p.legalFoundationDocumentDate || ""}`;
        if (seen.has(fid)) continue;
        seen.add(fid);
        merged.push(f);
      }
    }
    return merged;
  };
  try {
    const primaryBbox = `${minX},${minY},${maxX},${maxY}`;
    let mergedFeatures = await runSamples(primaryBbox, buildSamplePoints(1));
    // Fallback: bei Null-Treffern einmal mit doppelter BBOX nachfragen.
    // polygonRingsIntersectCircle filtert anschließend strikt auf echten
    // Kreis-Schnitt, also entstehen keine False-Positives.
    if (mergedFeatures.length === 0) {
      const half2 = halfM * 2;
      const bbox2 = `${cx - half2},${cy - half2},${cx + half2},${cy + half2}`;
      mergedFeatures = await runSamples(bbox2, buildSamplePoints(1));
    }
    const data = { features: mergedFeatures };
    const out: GeozoneFeatureInfo[] = [];
    for (const f of data.features || []) {
      const p = f.properties || {};
      const rawName = p.siteNameSpelling || p.naam || p.NAAM || p.gebiedsnaam || p.title || layerLabel;
      const name = translateNlSource(String(rawName));
      const details: string[] = [];

      // Kurzbeschreibung des Layers (warum diese Zone für Drohnenpiloten relevant ist)
      if (/NNN|Natuurnetwerk/i.test(layerLabel)) {
        details.push(
          "Naturnetzwerk Niederlande (NNN): zusammenhängendes Naturschutzgebiet. "
          + "Drohnenflüge sind hier nur eingeschränkt erlaubt — Provinzgesetz beachten, "
          + "Mindestabstand zu Wildtieren wahren, keine Störung der Brutzeit.",
        );
      } else if (/Natura\s*2000/i.test(layerLabel)) {
        details.push(
          "Natura 2000 Schutzgebiet (EU Vogel-/FFH-Richtlinie). "
          + "Drohnenflüge ohne Genehmigung der Provinz sind verboten "
          + "(art. 2.1 Wet natuurbescherming).",
        );
      }

      // Klassifikations-Codes in lesbares Deutsch übersetzen
      const classMap: Record<string, string> = {
        natureConservation: "Naturschutz",
        ecological: "ökologische Hauptstruktur",
        environment: "Umweltschutz",
        habitatDirective: "FFH-Richtlinie",
        birdsDirective: "Vogelschutzrichtlinie",
        nationalPark: "Nationalpark",
        nationalLandscape: "Nationale Landschaft",
        recreation: "Erholungsgebiet",
        landscape: "Landschaftsschutz",
        cultural: "Kulturlandschaft",
      };
      if (p.siteProtectionClassification) {
        const codes = String(p.siteProtectionClassification).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
        const translated = codes.map((c) => classMap[c] || c).join(", ");
        details.push(`Schutzklasse: ${translated}`);
      }

      // Datum als DD.MM.YYYY formatieren
      if (p.legalFoundationDocumentDate) {
        const raw = String(p.legalFoundationDocumentDate).slice(0, 10);
        const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const dateFmt = m ? `${m[3]}.${m[2]}.${m[1]}` : raw;
        details.push(`Rechtsgrundlage vom ${dateFmt}`);
      }

      // Dokument-Link nur dann zeigen, wenn URL — als "Verordnung (PDF)" gekennzeichnet
      if (p.legalFoundationDocumentTitle && /^https?:/.test(String(p.legalFoundationDocumentTitle))) {
        details.push(`Verordnung (PDF/Link): ${p.legalFoundationDocumentTitle}`);
      }

      // Provinz / zuständige Stelle, falls vorhanden
      if (p.competentAuthority || p.bevoegdGezag) {
        details.push(`Zuständig: ${p.competentAuthority || p.bevoegdGezag}`);
      }

      // Pilot-Handlungsempfehlung
      details.push(
        "Vor dem Flug bei der Provinz (g-o.nl) prüfen, ob eine Ausnahmegenehmigung nötig ist.",
      );
      // Mercator-Polygon → WGS84 für Hervorhebung
      let polygonRings: [number, number][][] | undefined;
      const g = f.geometry;
      const mercToLatLon = (x: number, y: number): [number, number] => {
        const lonOut = (x / 20037508.34) * 180;
        const latOut = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360) / Math.PI - 90;
        return [latOut, lonOut];
      };
      if (g && Array.isArray(g.coordinates)) {
        if (g.type === "Polygon") {
          const ring = (g.coordinates[0] || []) as number[][];
          if (ring.length >= 3) polygonRings = [ring.map((c) => mercToLatLon(c[0], c[1]))];
        } else if (g.type === "MultiPolygon") {
          const rings: [number, number][][] = [];
          for (const poly of g.coordinates) {
            const outer = (poly?.[0] || []) as number[][];
            if (outer.length >= 3) rings.push(outer.map((c) => mercToLatLon(c[0], c[1])));
          }
          if (rings.length > 0) polygonRings = rings;
        }
      }
      out.push({
        layerLabel,
        name: String(name),
        details: details.join("\n"),
        featureId: f.id,
        polygonRings,
      });
    }
    return out;
  } catch (e: any) {
    if (e?.name !== "AbortError") console.warn(`[Geozones] NL PDOK WMS FeatureInfo (${wmsLayer}) error:`, e?.message || e);
    return [];
  }
}

export function parseNlGeozoneResponse(data: any, layerLabel: string): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  if (!data.features || !Array.isArray(data.features)) return results;

  for (const feature of data.features) {
    const props = feature.properties || {};
    const localtype = props.localtype || "";
    const sourceTxt = props.sourceTxt || "";
    const translatedType = translateNlLocalType(localtype);
    const translatedSource = translateNlSource(sourceTxt);

    const name = translatedSource || translatedType || "Flugverbotszone";

    const detailParts: string[] = [];
    detailParts.push(`Zonentyp: ${translatedType}`);
    if (translatedSource) detailParts.push(`Quelle: ${translatedSource}`);

    const fid = feature.id || (props.objectid != null ? `nl-${props.objectid}` : undefined);

    let polygonRings: [number, number][][] | undefined;
    const geo = feature.geometry;
    if (geo && Array.isArray(geo.coordinates)) {
      if (geo.type === "Polygon" && Array.isArray(geo.coordinates[0])) {
        const ring = geo.coordinates[0] as number[][];
        if (ring.length >= 3) {
          polygonRings = [ring.map((c) => [c[1], c[0]] as [number, number])];
        }
      } else if (geo.type === "MultiPolygon") {
        const rings: [number, number][][] = [];
        for (const poly of geo.coordinates) {
          if (Array.isArray(poly) && Array.isArray(poly[0])) {
            const outer = poly[0] as number[][];
            if (outer.length >= 3) rings.push(outer.map((c) => [c[1], c[0]] as [number, number]));
          }
        }
        if (rings.length > 0) polygonRings = rings;
      }
    }

    results.push({
      layerLabel,
      name,
      details: detailParts.join("\n"),
      featureId: fid,
      polygonRings,
    });
  }

  return results;
}

export function parseNlLandingsiteResponse(data: any, layerLabel: string): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  if (!data.features || !Array.isArray(data.features)) return results;

  for (const feature of data.features) {
    const props = feature.properties || {};
    const txtname = props.txtname || "Landeplatz";
    const specifiek = props.specifiek || "";
    const specifiekDe = NL_SPECIFIEK_DE[specifiek] || specifiek;

    const detailParts: string[] = [];
    if (specifiekDe) detailParts.push(`Typ: ${specifiekDe}`);

    results.push({
      layerLabel,
      name: txtname,
      details: detailParts.join("\n"),
      featureId: feature.id || undefined,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Frankreich (DGAC / Géoplateforme WMS GetFeatureInfo)
// ---------------------------------------------------------------------------

// Akzent-/Case-unabhängige Normalisierung für den Abgleich französischer Texte.
function normalizeFr(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Phrasen-Ersetzungen für unbekannte DGAC-`remarque`-Freitexte. Werden in
// Reihenfolge auf den Originaltext angewandt, damit auch nicht standardisierte
// Sätze weitgehend ins Deutsche übertragen werden, statt französisch
// stehenzubleiben. Längere/spezifischere Phrasen zuerst.
const FR_REMARQUE_PHRASES: { re: RegExp; de: string }[] = [
  { re: /en\s+espace\s+public/gi, de: "im öffentlichen Raum" },
  { re: /sauf\s+conform[ée]ment\s+[àa]\s+l['’]arr[êe]t[ée]\s+Espace/gi, de: "außer gemäß dem Erlass „Espace“" },
  { re: /altitude\s+de\s+r[ée]f[ée]rence\s+de\s+la\s+plateforme\s*:?\s*(\d+)\s*m/gi, de: "Referenzhöhe der Plattform: $1 m" },
  { re: /hauteur\s+maximale\s+de\s+vol\s+de\s+(\d+)\s*m(?:[èe]tres)?/gi, de: "maximale Flughöhe $1 m" },
  { re: /au-?dessus\s+de\s+l['’]espace\s+public/gi, de: "über öffentlichem Raum" },
  { re: /sauf\s+autorisation\s+pr[ée]fectorale/gi, de: "außer mit präfektoraler Genehmigung" },
  { re: /sauf\s+autorisation/gi, de: "außer mit Genehmigung" },
  { re: /pour\s+la\s+cat[ée]gorie\s+ouverte/gi, de: "für die offene Kategorie" },
  { re: /ou\s+l['’]a[ée]romod[ée]lisme/gi, de: "oder Modellflug" },
  { re: /l['’]a[ée]romod[ée]lisme/gi, de: "Modellflug" },
  { re: /a[ée]romod[ée]lisme/gi, de: "Modellflug" },
  { re: /interdiction\s+de\s+survol/gi, de: "Überflugverbot" },
  { re: /[ée]volution\s+interdite/gi, de: "Betrieb verboten" },
  { re: /vol\s+interdit/gi, de: "Flugverbot" },
  { re: /en\s+agglom[ée]ration/gi, de: "in geschlossenen Ortschaften" },
];

// Übersetzt das französische DGAC-Freitextfeld `remarque` ins Deutsche. Die
// DGAC-Datensätze nutzen überwiegend eine begrenzte Zahl standardisierter
// Sätze; diese werden 1:1 sauber formuliert. Unbekannte Texte werden satzweise
// per Phrasen-Ersetzung übertragen (Fallback: Originaltext, falls nichts greift).
export function translateFrRemarque(remarque: string): string {
  const v = (remarque || "").replace(/\*+\s*$/, "").trim();
  if (!v || v.toLowerCase() === "null") return "";
  const norm = normalizeFr(v);

  // 1) Standardisierte Komplettsätze (beste Formulierung).
  const priorNotification = norm.match(
    /notification prealable obligatoire pour les aeronefs de masse superieure a (\d+)\s*g/,
  );
  if (
    priorNotification &&
    norm.includes("sans prejudice") &&
    norm.includes("restrictions de survol")
  ) {
    return (
      `Eine vorherige Meldung ist für Luftfahrzeuge mit einer Masse über ${priorNotification[1]} g verpflichtend; ` +
      "die sonstigen geltenden Überflugbeschränkungen sind dennoch einzuhalten."
    );
  }
  const platformAltitude = norm.match(
    /altitude de reference de la plateforme\s*:?\s*(\d+)\s*m/,
  );
  if (platformAltitude) return `Referenzhöhe der Plattform: ${platformAltitude[1]} m.`;
  if (
    norm.includes("evolution interdite") &&
    norm.includes("espace public") &&
    norm.includes("agglomeration") &&
    norm.includes("arrete espace")
  ) {
    return "Im öffentlichen Raum in geschlossenen Ortschaften ist der Betrieb verboten, außer gemäß dem Erlass „Espace“.";
  }
  const onlyHeight = norm.match(/^hauteur maximale de vol de (\d+)\s*m(?:etres)?\.?$/);
  if (onlyHeight) return `Maximale Flughöhe ${onlyHeight[1]} m.`;
  if (
    norm.includes("evolution interdite") &&
    norm.includes("agglomeration") &&
    norm.includes("prefectoral")
  ) {
    return (
      "Betrieb über öffentlichem Raum in geschlossenen Ortschaften verboten – " +
      "außer mit präfektoraler Genehmigung (offene Kategorie oder Modellflug)."
    );
  }
  if (/^vol interdit\.?$/.test(norm)) return "Flugverbot.";

  // 2) Fallback: satzweise Phrasen-Ersetzung auf dem Originaltext.
  let out = v;
  for (const { re, de } of FR_REMARQUE_PHRASES) out = out.replace(re, de);
  return out;
}

// Übersetzt den Géoplateforme-Wert `limite` (Höhengrenze bzw. "Vol interdit")
// ins Deutsche. Der DGAC-Layer liefert teils nackte Zahlen ("50"), teils ganze
// Sätze ("Hauteur maximale de vol de 50 m"); beide Formen werden erkannt.
export function translateFrLimite(limite: string): string {
  const v = (limite || "").replace(/\*+\s*$/, "").trim();
  if (!v || v.toLowerCase() === "null") return "";
  const lower = normalizeFr(v);
  if (lower.includes("interdit")) return "Flugverbot";
  const m = lower.match(/(\d+)\s*m\b/) || lower.match(/^(\d+)(?:[.,]\d+)?$/);
  if (m) return `Maximale Flughöhe ${m[1]} m`;
  return translateFrRemarque(v);
}

// Name + Detailtext einer französischen Beschränkungszone (WMS- und WFS-Pfad).
function frZoneText(limite: string, remarque: string): { name: string; details: string } {
  const translatedLimit = translateFrLimite(limite);
  const typeKey = classifyFrRestrictionType(limite, remarque);
  const typeInfo = FR_ZONE_TYPES[typeKey];
  const details: string[] = [];
  details.push(`Zonentyp: ${typeInfo.label}`);
  if (translatedLimit) details.push(`Beschränkung: ${translatedLimit}`);
  const translatedRemarque = translateFrRemarque(remarque);
  if (translatedRemarque && translatedRemarque !== translatedLimit) {
    details.push(`Hinweis: ${translatedRemarque}`);
  }
  details.push(`Auflagen: ${typeInfo.auflage}`);
  details.push(`Kontakt: ${typeInfo.kontakt}`);
  details.push(
    "Quelle: DGAC / Géoplateforme. Vor dem Flug AlphaTango registrieren "
    + "und temporäre Sperrungen (NOTAM/SIA) prüfen.",
  );
  return { name: typeInfo.label, details: details.join("\n") };
}

export const FR_WFS_URL = "https://data.geopf.fr/wfs/ows";
export const FR_WFS_TYPENAME = "TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf";
export const FR_RESTRICTIONS_LAYER_LABEL = "Drohnen-Beschränkungen (DGAC)";

/**
 * Zone aus einem Feature des Géoplateforme-WFS (`carte_restriction_drones_lf`,
 * Felder `limite`/`remarque`, Geometrie in EPSG:4326 lon/lat). Genutzt vom
 * Offline-Kachelspeicher (geozoneTiles/). null ohne Flächengeometrie.
 */
export function frZoneFromWfsFeature(rawFeature: any): GeozoneFeatureInfo | null {
  const polygonGroups = dipulGeometryToGroups(rawFeature?.geometry);
  if (polygonGroups.length === 0) return null;
  const p = rawFeature?.properties && typeof rawFeature.properties === "object" ? rawFeature.properties : {};
  const limite = (p.limite ?? "").toString().trim();
  const remarque = (p.remarque ?? "").toString().trim();
  const { name, details } = frZoneText(limite, remarque);
  return {
    layerLabel: FR_RESTRICTIONS_LAYER_LABEL,
    name,
    details,
    featureId: String(rawFeature?.id || `${limite}|${remarque}`),
    polygonRings: polygonGroups.flat(),
    polygonGroups,
    country: "FR",
  };
}

// Frankreich (DGAC / Géoplateforme-WMS) GetFeatureInfo. Bbox in EPSG:3857,
// FORMAT=image/png + STYLES + INFO_FORMAT=application/json, Sampling aus
// Mittelpunkt + 8 Randpunkten einer ~`radiusKm`-Box. Liefert `GeozoneFeatureInfo`
// mit Polygon-Ring (für Hervorhebung + Umkreis-Filter). Schlägt der Dienst
// fehl oder liefert nichts, kommt eine leere Liste zurück (kein Crash).
export async function queryFrWmsFeaturesFrom(
  wmsBaseUrl: string,
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<GeozoneFeatureInfo[]> {
  const wmsLayer = "TRANSPORTS.DRONES.RESTRICTIONS";
  const layerLabel = "Drohnen-Beschränkungen (DGAC)";
  const halfM = Math.max(radiusKm, 0.5) * 1000;
  const cx = (lon * 20037508.34) / 180;
  const cy = (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) * 20037508.34;
  const minX = cx - halfM, maxX = cx + halfM, minY = cy - halfM, maxY = cy + halfM;
  const W = 512, H = 512;
  const mercToLatLon = (x: number, y: number): [number, number] => {
    const lonOut = (x / 20037508.34) * 180;
    const latOut = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360) / Math.PI - 90;
    return [latOut, lonOut];
  };
  const buildSamplePoints = (): { i: number; j: number }[] => {
    const pts: { i: number; j: number }[] = [{ i: Math.round(W / 2), j: Math.round(H / 2) }];
    const rim = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const deg of rim) {
      const r = (deg * Math.PI) / 180;
      pts.push({
        i: Math.round(W / 2 + (W / 2) * 0.95 * Math.cos(r)),
        j: Math.round(H / 2 - (H / 2) * 0.95 * Math.sin(r)),
      });
    }
    return pts;
  };
  const bboxStr = `${minX},${minY},${maxX},${maxY}`;
  const buildUrl = (i: number, j: number) =>
    `${wmsBaseUrl}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo`
    + `&LAYERS=${encodeURIComponent(wmsLayer)}&QUERY_LAYERS=${encodeURIComponent(wmsLayer)}`
    + `&STYLES=&CRS=EPSG:3857&BBOX=${bboxStr}&WIDTH=${W}&HEIGHT=${H}`
    + `&I=${i}&J=${j}&FORMAT=image/png&INFO_FORMAT=application/json&FEATURE_COUNT=10`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const points = buildSamplePoints();
    const responses = await Promise.all(
      points.map((p) =>
        fetch(buildUrl(p.i, p.j), { signal: controller.signal, headers: { Accept: "application/json" } })
          .then((r) => (r.ok ? r.json() : { features: [] }))
          .catch(() => ({ features: [] })),
      ),
    );
    const seen = new Set<string>();
    const out: GeozoneFeatureInfo[] = [];
    for (const data of responses) {
      for (const f of data.features || []) {
        const p = f.properties || {};
        const limite = (p.limite ?? "").toString().trim();
        const remarque = (p.remarque ?? "").toString().trim();
        const fid = f.id || `${limite}|${remarque}`;
        if (seen.has(fid)) continue;
        seen.add(fid);
        const { name, details } = frZoneText(limite, remarque);
        let polygonRings: [number, number][][] | undefined;
        const g = f.geometry;
        if (g && Array.isArray(g.coordinates)) {
          if (g.type === "Polygon") {
            const ring = (g.coordinates[0] || []) as number[][];
            if (ring.length >= 3) polygonRings = [ring.map((c) => mercToLatLon(c[0], c[1]))];
          } else if (g.type === "MultiPolygon") {
            const rings: [number, number][][] = [];
            for (const poly of g.coordinates) {
              const outer = (poly?.[0] || []) as number[][];
              if (outer.length >= 3) rings.push(outer.map((c) => mercToLatLon(c[0], c[1])));
            }
            if (rings.length > 0) polygonRings = rings;
          }
        }
        out.push({ layerLabel, name, details, featureId: fid, polygonRings });
      }
    }
    return out;
  } catch (e: any) {
    if (e?.name !== "AbortError") console.warn("[Geozones] FR WMS FeatureInfo error:", e?.message || e);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Luxemburg – NOTAM-Aufbereitung der temporären UAS-Zonen
// ---------------------------------------------------------------------------
// Die LU-WMS-FeatureInfo (siehe queryLuWmsFeatureInfo) liefert sowohl dauerhafte
// UAS-Zonen als auch aktivierbare/temporäre TSA. Für die NOTAM-Ansicht werden
// nur die nicht-dauerhaften Zonen in das NOTAM-ähnliche Format überführt, das
// die Clients (NotamsScreen, LiveTraffic) erwarten. Diese Logik ist RN-frei und
// daher unter dem tsx-Testrunner prüfbar; geozones.ts injiziert nur Cache und
// Scan-Punkte.

export interface LuNotam {
  id: number;
  series: string;
  number: number;
  type: string;
  itema: string[];
  iteme: string;
  startvalidity: number;
  endvalidity: number;
  fir: string;
  nom_zone: string;
  itemf?: string;
  itemg?: string;
  // Optionale Geometrie (nur über den GeoJSON-Pfad gefüllt): reprojizierte
  // Polygonringe [lat, lon] sowie der berechnete Zentroid. Erlaubt es der
  // Karte, exakt die gelisteten Zonen zu zeichnen (statt eines WMS-Overlays).
  polygonRings?: [number, number][][];
  centerLat?: number;
  centerLon?: number;
}

// Inverse Projektion EPSG:2169 (Luxembourg 1930 / Gauss, LUREF) -> WGS84.
// Der Geoportail-WMS liefert GetFeatureInfo-Geometrien immer in EPSG:2169,
// unabhängig vom angefragten SRS. Inverse Transverse Mercator (Hayford 1924)
// + 7-Parameter-Helmert-Datumsshift (Position-Vector-Konvention).
export function epsg2169ToWgs84(E: number, N: number): [number, number] {
  const D = Math.PI / 180;
  // Internationales Ellipsoid 1924 (Hayford)
  const a = 6378388.0;
  const f = 1 / 297.0;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const lat0 = 49.8333333333333 * D;
  const lon0 = 6.16666666666667 * D;
  const k0 = 1;
  const FE = 80000;
  const FN = 100000;
  // WGS84
  const aW = 6378137.0;
  const fW = 1 / 298.257223563;
  const e2W = 2 * fW - fW * fW;
  // towgs84 (Lux1930 -> WGS84), Position-Vector-Konvention
  const dx = -189.6806, dy = 18.3463, dz = -42.7695;
  const rx = (0.33746 / 3600) * D, ry = (-3.09264 / 3600) * D, rz = (2.53861 / 3600) * D;
  const ds = 0.4598e-6;

  const meridian = (phi: number) =>
    a * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi
      - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi)
      + ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi)
      - ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi));

  // Inverse Transverse Mercator
  const M = (N - FN) / k0 + meridian(lat0);
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 * e1 * e1) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 * e1 * e1 * e1) / 32) * Math.sin(4 * mu)
    + ((151 * e1 * e1 * e1) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 * e1 * e1 * e1) / 512) * Math.sin(8 * mu);
  const sp = Math.sin(phi1), cp = Math.cos(phi1), tp = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sp * sp);
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sp * sp, 1.5);
  const C1 = ep2 * cp * cp;
  const T1 = tp * tp;
  const Dd = (E - FE) / (N1 * k0);
  const latLux = phi1 - (N1 * tp / R1) * (
    (Dd * Dd) / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(Dd, 4) / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(Dd, 6) / 720);
  const lonLux = lon0 + (
    Dd
    - (1 + 2 * T1 + C1) * Math.pow(Dd, 3) / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(Dd, 5) / 120) / cp;

  // Geodätisch (Lux1930) -> geozentrisch (Hayford)
  const Nrad = a / Math.sqrt(1 - e2 * Math.sin(latLux) ** 2);
  const X = Nrad * Math.cos(latLux) * Math.cos(lonLux);
  const Y = Nrad * Math.cos(latLux) * Math.sin(lonLux);
  const Z = Nrad * (1 - e2) * Math.sin(latLux);

  // 7-Parameter-Helmert (Position-Vector) -> WGS84-geozentrisch
  const s = 1 + ds;
  const X2 = dx + s * (X - rz * Y + ry * Z);
  const Y2 = dy + s * (rz * X + Y - rx * Z);
  const Z2 = dz + s * (-ry * X + rx * Y + Z);

  // Geozentrisch -> geodätisch (WGS84)
  const b = aW * Math.sqrt(1 - e2W);
  const ep = (aW * aW - b * b) / (b * b);
  const p = Math.sqrt(X2 * X2 + Y2 * Y2);
  const th = Math.atan2(aW * Z2, b * p);
  const lon = Math.atan2(Y2, X2);
  const lat = Math.atan2(
    Z2 + ep * b * Math.sin(th) ** 3,
    p - e2W * aW * Math.cos(th) ** 3);
  return [lat / D, lon / D];
}

const LU_NATURE_REASON_DE: Record<string, string> = {
  AERO: "Flugplatz",
  NATURE: "Naturschutz",
  MILITARY: "Militär",
  SENSITIVE: "Sensibel",
  PRIVACY: "Privatsphäre",
  TERR: "Gebietsschutz",
  NUCLEAR: "Kernanlage",
  PRISON: "Justizvollzug",
  HOSPITAL: "Krankenhaus",
  INDUSTRIAL: "Industrieanlage",
  OTHER: "Sonstige",
};

// Eine Zone gilt als dauerhaft, wenn sie als "permanent" markiert ist, länger
// als ein Jahr läuft oder bereits seit über einem Jahr ohne Enddatum aktiv ist.
// Dauerhafte Zonen erscheinen NICHT als NOTAM (sie sind Teil der statischen
// Geozonen-Layer), sondern nur temporäre/aktivierbare Zonen.
export function isLuZonePermanent(wms: Record<string, string>): boolean {
  const activite = (wms["Activity"] || "").toLowerCase();
  if (activite === "permanent") return true;
  const startMs = wms["Start date and time"] ? luWmsDateToMs(wms["Start date and time"]) : 0;
  const endMs = wms["End date and time"] ? luWmsDateToMs(wms["End date and time"]) : 0;
  const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
  if (startMs > 0 && endMs > 0) {
    if (endMs - startMs > oneYearMs) return true;
  }
  if (startMs > 0 && endMs === 0) {
    if (Date.now() - startMs > oneYearMs) return true;
  }
  return false;
}

// Wandelt einen rohen LU-WMS-FeatureInfo-Datensatz in ein NOTAM-Objekt um.
// Liefert null, wenn kein Zonen-Identifier vorhanden oder die Zone dauerhaft
// ist. Der Freitext (iteme) ist vollständig auf Deutsch.
export function buildLuNotamFromWms(wms: Record<string, string>): LuNotam | null {
  const nomZone = wms["Zone Identifier"] || "";
  if (!nomZone) return null;

  if (isLuZonePermanent(wms)) return null;

  const minH = wms["Lower limit (meter)"] || "0";
  const maxH = wms["Upper limit (meter)"] || "";
  const startMs = wms["Start date and time"] ? luWmsDateToMs(wms["Start date and time"]) : 0;
  const endMs = wms["End date and time"] ? luWmsDateToMs(wms["End date and time"]) : 0;
  const desc = translateLuFrench(wms["Description"] || nomZone || "");
  const remarks = wms["Remarks"] ? translateLuFrench(wms["Remarks"]) : "";
  const activite = wms["Activity"] || "";
  const status = LU_ACTIVITE_DE[activite] || activite || "";
  const resp2 = wms["Responsability"] ? translateLuFrench(wms["Responsability"]) : "";
  const nature = wms["Nature of proctection"] || "";
  const durPrevStr = wms["Duration of previsualisation (hours)"] || "";
  const hasDurPrev = durPrevStr && parseFloat(durPrevStr) > 0;

  const textParts: string[] = [];
  textParts.push(`${desc} (${nomZone})`);
  if (nature) {
    textParts.push(`Art: ${LU_NATURE_REASON_DE[nature] || nature}`);
  }
  if (status) textParts.push(`Status: ${status}`);
  if (resp2) textParts.push(`Zuständigkeit: ${resp2}`);
  if (minH || maxH) textParts.push(`Höhe: ${parseFloat(minH)} – ${maxH ? parseFloat(maxH) : "?"} m`);
  if (wms["Start date and time"]) textParts.push(`Von: ${luWmsDateToDisplay(wms["Start date and time"])}`);
  if (wms["End date and time"]) textParts.push(`Bis: ${luWmsDateToDisplay(wms["End date and time"])}`);
  if (hasDurPrev) textParts.push(`Vorankündigung: ${parseFloat(durPrevStr)} Std.`);
  if (remarks) textParts.push(`Hinweis: ${remarks}`);

  return {
    id: -(Math.abs(nomZone.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 100 + parseFloat(minH))),
    series: "LU-TSA",
    number: 0,
    type: "N",
    itema: [nomZone || "ELLX"],
    iteme: textParts.join("\n"),
    startvalidity: startMs,
    endvalidity: endMs,
    fir: "ELLX",
    nom_zone: `${nomZone}-${minH}-${maxH}`,
    itemf: minH ? `${parseFloat(minH)} M AGL` : "GND",
    itemg: maxH ? `${parseFloat(maxH)} M AGL` : undefined,
  };
}

// Temporäre LU-Zonen rund um einen Punkt als NOTAMs. Dedupliziert über
// nom_zone. Leere Liste, wenn der WMS nichts liefert / fehlschlägt.
export async function fetchLuTsaAsNotams(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<LuNotam[]> {
  const rawFeatures = await queryLuWmsFeatureInfo(lat, lon, radiusKm);
  const results: LuNotam[] = [];
  const seen = new Set<string>();

  for (const wms of rawFeatures) {
    const r = buildLuNotamFromWms(wms);
    if (!r) continue;
    if (seen.has(r.nom_zone)) continue;
    seen.add(r.nom_zone);
    results.push(r);
  }

  return results;
}

// Scannt mehrere Punkte über Luxemburg und sammelt alle temporären Zonen als
// NOTAMs ein. Cache-Funktionen + Scan-Punkte werden injiziert, damit die Logik
// RN-frei bleibt (geozones.ts liefert AsyncStorage-basiertes setCache/getCached).
export async function fetchAllLuZonesAsNotamsFrom(
  scanPoints: [number, number][],
  cache: {
    setCache: (key: string, data: any) => Promise<any>;
    getCached: <T>(key: string) => Promise<{ data: T } | null>;
  },
): Promise<LuNotam[]> {
  try {
    const seen = new Set<string>();
    const results: LuNotam[] = [];

    const scanPoint = async (lat: number, lon: number) => {
      try {
        const raw = await queryLuWmsFeatureInfo(lat, lon, 10);
        for (const wms of raw) {
          const r = buildLuNotamFromWms(wms);
          if (!r) continue;
          if (seen.has(r.nom_zone)) continue;
          seen.add(r.nom_zone);
          results.push(r);
        }
      } catch {}
    };

    await Promise.all(scanPoints.map(([la, lo]) => scanPoint(la, lo)));

    if (results.length > 0) {
      cache.setCache("lu_zones_all", results).catch(() => {});
    }
    return results;
  } catch (err) {
    const cached = await cache.getCached<LuNotam[]>("lu_zones_all");
    if (cached) return cached.data;
    throw err;
  }
}

// Wie queryLuWmsFeatureInfo, aber INFO_FORMAT=application/json — liefert neben
// den Attributen auch die Geometrie. Der Geoportail-WMS gibt Koordinaten immer
// in EPSG:2169 zurück (ignoriert den SRS-Parameter); sie werden hier nach WGS84
// reprojiziert. Jedes Feature: { props (string-Werte), rings ([lat,lon][][]) }.
export async function queryLuWmsFeatureInfoGeo(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<{ props: Record<string, string>; rings: [number, number][][] }[]> {
  const lonToMercXLocal = (l: number) => (l * 20037508.34) / 180;
  const latToMercYLocal = (la: number) =>
    (Math.log(Math.tan(((90 + la) * Math.PI) / 360)) * 20037508.34) / Math.PI;
  const halfM = radiusKm * 1000;
  const cx = lonToMercXLocal(lon);
  const cy = latToMercYLocal(lat);
  const bbox = `${cx - halfM},${cy - halfM},${cx + halfM},${cy + halfM}`;
  const url = `https://wms.geoportail.lu/public_map_layers/service?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo`
    + `&LAYERS=1927,1928&QUERY_LAYERS=1927,1928`
    + `&SRS=EPSG:3857&BBOX=${bbox}`
    + `&WIDTH=256&HEIGHT=256&X=128&Y=128`
    + `&INFO_FORMAT=application/json&FEATURE_COUNT=50`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!resp.ok) return [];
    const json: any = await resp.json();
    const features = Array.isArray(json?.features) ? json.features : [];
    const out: { props: Record<string, string>; rings: [number, number][][] }[] = [];
    for (const feat of features) {
      const props: Record<string, string> = {};
      const rawProps = feat?.properties || {};
      for (const k of Object.keys(rawProps)) {
        const v = rawProps[k];
        props[k] = v == null ? "" : String(v);
      }
      const rings: [number, number][][] = [];
      const geom = feat?.geometry;
      const reprojectRing = (ring: any): [number, number][] =>
        (Array.isArray(ring) ? ring : [])
          .map((pt: any) => {
            if (!Array.isArray(pt) || pt.length < 2) return null;
            const [latW, lonW] = epsg2169ToWgs84(pt[0], pt[1]);
            return [latW, lonW] as [number, number];
          })
          .filter((p: any): p is [number, number] => p != null);
      if (geom && Array.isArray(geom.coordinates)) {
        if (geom.type === "Polygon") {
          for (const ring of geom.coordinates) {
            const r = reprojectRing(ring);
            if (r.length >= 3) rings.push(r);
          }
        } else if (geom.type === "MultiPolygon") {
          for (const poly of geom.coordinates) {
            for (const ring of poly || []) {
              const r = reprojectRing(ring);
              if (r.length >= 3) rings.push(r);
            }
          }
        }
      }
      out.push({ props, rings });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// Zentroid (Durchschnitt der Vertices) des ersten/größten Rings.
function ringsCentroid(rings: [number, number][][]): { lat: number; lon: number } | null {
  let best: [number, number][] | null = null;
  for (const ring of rings) {
    if (!best || ring.length > best.length) best = ring;
  }
  if (!best || best.length === 0) return null;
  let sLat = 0, sLon = 0;
  for (const [la, lo] of best) { sLat += la; sLon += lo; }
  return { lat: sLat / best.length, lon: sLon / best.length };
}

// Scannt Luxemburg punktweise und liefert temporäre Zonen MIT Geometrie. Nutzt
// denselben Permanent-Filter/Freitext-Aufbau wie der Text-Pfad (buildLuNotamFromWms)
// und hängt reprojizierte Polygonringe + Zentroid an.
export async function fetchAllLuZonesWithGeometryFrom(
  scanPoints: [number, number][],
  cache: {
    setCache: (key: string, data: any) => Promise<any>;
    getCached: <T>(key: string) => Promise<{ data: T } | null>;
  },
): Promise<LuNotam[]> {
  try {
    const seen = new Set<string>();
    const results: LuNotam[] = [];

    const scanPoint = async (lat: number, lon: number) => {
      try {
        const features = await queryLuWmsFeatureInfoGeo(lat, lon, 10);
        for (const { props, rings } of features) {
          const r = buildLuNotamFromWms(props);
          if (!r) continue;
          if (seen.has(r.nom_zone)) continue;
          seen.add(r.nom_zone);
          if (rings.length > 0) {
            r.polygonRings = rings;
            const c = ringsCentroid(rings);
            if (c) { r.centerLat = c.lat; r.centerLon = c.lon; }
          }
          results.push(r);
        }
      } catch {}
    };

    await Promise.all(scanPoints.map(([la, lo]) => scanPoint(la, lo)));

    if (results.length > 0) {
      cache.setCache("lu_zones_all", results).catch(() => {});
    }
    return results;
  } catch (err) {
    const cached = await cache.getCached<LuNotam[]>("lu_zones_all");
    if (cached) return cached.data;
    throw err;
  }
}
