/**
 * Client-Portierung von server/germanEnergyInfrastructure.ts: fragt die
 * öffentlichen Energie-Infrastrukturquellen (OSM/Overpass, DIPUL-WFS, RIVM,
 * BFE/GeoAdmin, Geoportail.lu, IGN France) direkt vom Gerät ab – der frühere
 * Server-Proxy entfällt. Nicht portiert: MaStR (Server-Datenbank) und NGI
 * Belgien (GeoPackage-Download).
 */
import {
  classifyOfficialInfrastructureMatch,
  distanceMetersBetween,
  distanceMetersToGeoJsonGeometry,
  getEnergyInfrastructureCountry,
  isSupplementalEnergyInfrastructureItem,
  type GeoJsonGeometryLike,
  type GermanEnergyInfrastructureItem,
  type GermanEnergyInfrastructureResponse,
  type InfrastructureKind,
  type InfrastructureSourceStatus,
} from "../../shared/germanEnergyInfrastructure";
import {
  isIgnFranceWindQueryComplete,
  isIgnFranceWfsTimestampFresh,
  isIgnFranceLineVoltageComparable,
  normalizeBfeFeatures,
  normalizeIgnFrancePowerFeatures,
  normalizeIgnFranceWindFeatures,
  normalizeLuxembourgFeatures,
  isOsmInfrastructureComparable,
  normalizeRivmWindFeatures,
  type OfficialAssetFeature,
} from "../../shared/energyInfrastructureFeeds";

// MaStR (Marktstammdatenregister) wurde serverseitig je Bundesland komplett
// geladen und in der Datenbank zwischengespeichert – das ist auf dem RC nicht
// sinnvoll. Ohne Server bleibt die Quelle "nicht verfügbar"; Windkraftanlagen
// kommen weiterhin aus OpenStreetMap + DIPUL.
type MastrWindTurbine = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  estimatedTipHeightM: number;
  hubHeightM: number;
  rotorDiameterM: number;
  operatorMastrNumber?: string | null;
  operatorProfileUrl?: string | null;
  sourceRecordUrl?: string | null;
  operatorName?: string | null;
};
type CachedMastrWindState = {
  stateName: string;
  status: "available" | "stale" | "unavailable";
  updatedAt: string | null;
  features: MastrWindTurbine[];
};
async function getMastrWindTurbinesForStates(_stateNames: string[]): Promise<CachedMastrWindState[]> {
  return [];
}

// NGI Belgien wurde serverseitig als GeoPackage (ZIP + SQLite) geladen – auf dem
// Gerät nicht portierbar, daher immer "nicht verfügbar".
async function fetchNgiBelgiumPower(_bbox: unknown): Promise<OfficialAssetResult> {
  return { status: "unavailable", updatedAt: null, features: [] };
}

const DIPUL_WFS_URL = "https://uas-betrieb.de/geoservices/dipul/ows";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const RIVM_WFS_URL = "https://data.rivm.nl/geo/alo/wfs";
const GEOADMIN_IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";
const LUXEMBOURG_WFS_URL = "https://wms.inspire.geoportail.lu/geoserver/us/ows";
const IGN_FRANCE_WFS_URL = "https://data.geopf.fr/wfs/ows";
const WFS_FEATURE_LIMIT = 500;
const IGN_FRANCE_FEATURE_LIMIT = 1000;
const IGN_FRANCE_WIND_FEATURE_LIMIT = 5000;
const OSM_CACHE_TTL_MS = 15 * 60 * 1000;
const OFFICIAL_ASSET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type GeoJsonFeature = {
  id?: string | number;
  geometry?: GeoJsonGeometryLike | null;
  properties?: Record<string, unknown>;
};

type DipulResult = {
  status: "available" | "partial" | "unavailable";
  updatedAt: string | null;
  features: GeoJsonFeature[];
};

type OsmFeature = {
  id: string;
  kind: InfrastructureKind;
  name: string;
  geometry: GeoJsonGeometryLike;
  comparisonEligible: boolean;
  taggedHeightM: number | null;
  voltage: string | null;
  operatorName: string | null;
  operatorContact: {
    email: string | null;
    phone: string | null;
    website: string | null;
  } | null;
};

type OsmResult = {
  status: "available" | "unavailable";
  updatedAt: string | null;
  features: OsmFeature[];
};

const osmCache = new Map<string, { expiresAt: number; result: OsmResult }>();

type OfficialAssetResult = {
  status: "available" | "partial" | "stale" | "unavailable";
  updatedAt: string | null;
  features: OfficialAssetFeature[];
};

let cachedRivmWind: { expiresAt: number; result: OfficialAssetResult } | null = null;
const bfeCache = new Map<string, {
  expiresAt: number;
  wind: OfficialAssetResult;
  power: OfficialAssetResult;
}>();
const actLuxembourgCache = new Map<string, {
  expiresAt: number;
  powerLines: OfficialAssetResult;
  powerMasts: OfficialAssetResult;
}>();
const ignFrancePowerCache = new Map<string, {
  expiresAt: number;
  result: OfficialAssetResult;
}>();
const ignFranceWindCache = new Map<string, {
  expiresAt: number;
  result: OfficialAssetResult;
}>();

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRivmWind(): Promise<OfficialAssetResult> {
  if (cachedRivmWind && cachedRivmWind.expiresAt > Date.now()) {
    return cachedRivmWind.result;
  }
  const fetchedAt = new Date().toISOString();
  try {
    const params = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: "alo:rivm_windturbines_vermogen_actueel",
      outputFormat: "application/json",
      count: "10000",
      srsName: "EPSG:4326",
    });
    const response = await fetchJson(
      `${RIVM_WFS_URL}?${params}`,
      { headers: { Accept: "application/json" } },
      30_000,
    ) as { features?: unknown; numberMatched?: unknown };
    if (!Array.isArray(response.features)) {
      throw new Error("RIVM-WFS lieferte keine GeoJSON-Featureliste");
    }
    const features = normalizeRivmWindFeatures(response.features);
    const matched = Number(response.numberMatched);
    const result: OfficialAssetResult = {
      status: Number.isFinite(matched) && matched > features.length ? "partial" : "available",
      updatedAt: fetchedAt,
      features,
    };
    cachedRivmWind = { expiresAt: Date.now() + OFFICIAL_ASSET_CACHE_TTL_MS, result };
    return result;
  } catch (error) {
    console.warn("[RIVM energy infrastructure] WFS query failed:", error instanceof Error ? error.message : error);
    if (cachedRivmWind) {
      return { ...cachedRivmWind.result, status: "stale" };
    }
    return { status: "unavailable", updatedAt: null, features: [] };
  }
}

async function fetchBfeLayer(
  layerId: string,
  bbox: ReturnType<typeof searchBbox>,
  kind: "wind" | "power",
): Promise<OfficialAssetResult> {
  const fetchedAt = new Date().toISOString();
  const params = new URLSearchParams({
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: "esriGeometryEnvelope",
    layers: `all:${layerId}`,
    mapExtent: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    imageDisplay: "1000,1000,96",
    tolerance: "0",
    sr: "4326",
    returnGeometry: "true",
    geometryFormat: "geojson",
    lang: "de",
    limit: "1000",
  });
  try {
    const response = await fetchJson(
      `${GEOADMIN_IDENTIFY_URL}?${params}`,
      { headers: { Accept: "application/geo+json,application/json" } },
      15_000,
    ) as { results?: unknown };
    if (!Array.isArray(response.results)) {
      throw new Error("GeoAdmin lieferte keine Trefferliste");
    }
    const features = normalizeBfeFeatures(response.results, kind);
    return {
      status: response.results.length >= 1000 ? "partial" : "available",
      updatedAt: fetchedAt,
      features,
    };
  } catch (error) {
    console.warn(`[BFE energy infrastructure] ${kind} query failed:`, error instanceof Error ? error.message : error);
    return { status: "unavailable", updatedAt: null, features: [] };
  }
}

async function fetchBfeInfrastructure(
  latitude: number,
  longitude: number,
  radiusKm: number,
): Promise<{ wind: OfficialAssetResult; power: OfficialAssetResult }> {
  const cacheKey = `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${radiusKm.toFixed(1)}`;
  const cached = bfeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { wind: cached.wind, power: cached.power };
  }
  const bbox = searchBbox(latitude, longitude, radiusKm);
  const [wind, power] = await Promise.all([
    fetchBfeLayer("ch.bfe.windenergieanlagen", bbox, "wind"),
    fetchBfeLayer("ch.bfe.elektrische-anlagen_ueber_36", bbox, "power"),
  ]);
  const staleWind = wind.status === "unavailable" && cached ? { ...cached.wind, status: "stale" as const } : wind;
  const stalePower = power.status === "unavailable" && cached ? { ...cached.power, status: "stale" as const } : power;
  bfeCache.set(cacheKey, {
    expiresAt: Date.now() +
      (staleWind.status === "stale" || stalePower.status === "stale" ? 60_000 : OFFICIAL_ASSET_CACHE_TTL_MS),
    wind: staleWind,
    power: stalePower,
  });
  return { wind: staleWind, power: stalePower };
}

async function fetchLuxembourgLayer(
  typeName: string,
  bbox: ReturnType<typeof searchBbox>,
  kind: "power_line" | "power_mast",
): Promise<OfficialAssetResult> {
  const fetchedAt = new Date().toISOString();
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: typeName,
    count: String(WFS_FEATURE_LIMIT),
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north},EPSG:4326`,
  });
  try {
    const response = await fetchJson(
      `${LUXEMBOURG_WFS_URL}?${params}`,
      { headers: { Accept: "application/json" } },
      15_000,
    ) as { features?: unknown; numberMatched?: unknown; totalFeatures?: unknown };
    if (!Array.isArray(response.features)) {
      throw new Error("Geoportail.lu-WFS lieferte keine GeoJSON-Featureliste");
    }
    const features = normalizeLuxembourgFeatures(response.features, kind);
    const total = Number(response.numberMatched ?? response.totalFeatures);
    return {
      status: response.features.length >= WFS_FEATURE_LIMIT ||
        (Number.isFinite(total) && total > features.length)
        ? "partial"
        : "available",
      updatedAt: fetchedAt,
      features,
    };
  } catch (error) {
    console.warn(`[Geoportail.lu energy infrastructure] ${kind} query failed:`, error instanceof Error ? error.message : error);
    return { status: "unavailable", updatedAt: null, features: [] };
  }
}

async function fetchLuxembourgInfrastructure(
  latitude: number,
  longitude: number,
  radiusKm: number,
): Promise<{ powerLines: OfficialAssetResult; powerMasts: OfficialAssetResult }> {
  const bbox = searchBbox(latitude, longitude, radiusKm);
  const cacheKey = `${bbox.west.toFixed(4)}:${bbox.south.toFixed(4)}:${bbox.east.toFixed(4)}:${bbox.north.toFixed(4)}`;
  const cached = actLuxembourgCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { powerLines: cached.powerLines, powerMasts: cached.powerMasts };
  }
  const [powerLines, powerMasts] = await Promise.all([
    fetchLuxembourgLayer("us:US.ElectricityNetwork_UtilityLink", bbox, "power_line"),
    fetchLuxembourgLayer("us:US.ElectricityNetwork_Pole", bbox, "power_mast"),
  ]);
  const staleLines = powerLines.status === "unavailable" && cached
    ? { ...cached.powerLines, status: "stale" as const }
    : powerLines;
  const staleMasts = powerMasts.status === "unavailable" && cached
    ? { ...cached.powerMasts, status: "stale" as const }
    : powerMasts;
  actLuxembourgCache.set(cacheKey, {
    expiresAt: Date.now() +
      (staleLines.status === "stale" || staleMasts.status === "stale"
        ? 60_000
        : OFFICIAL_ASSET_CACHE_TTL_MS),
    powerLines: staleLines,
    powerMasts: staleMasts,
  });
  return { powerLines: staleLines, powerMasts: staleMasts };
}

async function fetchIgnFrancePower(
  bbox: ReturnType<typeof searchBbox>,
): Promise<OfficialAssetResult> {
  const cacheKey = `${bbox.west.toFixed(4)}:${bbox.south.toFixed(4)}:${bbox.east.toFixed(4)}:${bbox.north.toFixed(4)}`;
  const cached = ignFrancePowerCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const fetchedAt = new Date().toISOString();
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: "BDTOPO_V3:ligne_electrique",
    OUTPUTFORMAT: "application/json",
    SRSNAME: "EPSG:4326",
    COUNT: String(IGN_FRANCE_FEATURE_LIMIT),
    BBOX: `${bbox.west},${bbox.south},${bbox.east},${bbox.north},EPSG:4326`,
  });
  try {
    const response = await fetchJson(
      `${IGN_FRANCE_WFS_URL}?${params}`,
      { headers: { Accept: "application/json" } },
      15_000,
    ) as {
      features?: unknown;
      numberMatched?: unknown;
      totalFeatures?: unknown;
    };
    if (!Array.isArray(response.features)) {
      throw new Error("IGN BD TOPO WFS lieferte keine GeoJSON-Featureliste");
    }
    const features = normalizeIgnFrancePowerFeatures(response.features);
    const matched = Number(response.numberMatched ?? response.totalFeatures);
    const status =
      response.features.length >= IGN_FRANCE_FEATURE_LIMIT ||
      !Number.isFinite(matched) ||
      matched > response.features.length ||
      features.length < response.features.length
        ? "partial"
        : "available";
    const result: OfficialAssetResult = { status, updatedAt: fetchedAt, features };
    ignFrancePowerCache.set(cacheKey, {
      expiresAt: Date.now() + OFFICIAL_ASSET_CACHE_TTL_MS,
      result,
    });
    return result;
  } catch (error) {
    console.warn("[IGN France energy infrastructure] WFS query failed:", error instanceof Error ? error.message : error);
    if (cached) return { ...cached.result, status: "stale" };
    return { status: "unavailable", updatedAt: null, features: [] };
  }
}

async function fetchIgnFranceWind(
  bbox: ReturnType<typeof searchBbox>,
): Promise<OfficialAssetResult> {
  const cacheKey = `${bbox.west.toFixed(4)}:${bbox.south.toFixed(4)}:${bbox.east.toFixed(4)}:${bbox.north.toFixed(4)}`;
  const cached = ignFranceWindCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: "BDTOPO_V3:construction_ponctuelle",
    OUTPUTFORMAT: "application/json",
    SRSNAME: "EPSG:4326",
    COUNT: String(IGN_FRANCE_WIND_FEATURE_LIMIT),
    BBOX: `${bbox.west},${bbox.south},${bbox.east},${bbox.north},EPSG:4326`,
  });
  try {
    const response = await fetchJson(
      `${IGN_FRANCE_WFS_URL}?${params}`,
      { headers: { Accept: "application/json" } },
      15_000,
    ) as {
      features?: unknown;
      numberMatched?: unknown;
      totalFeatures?: unknown;
      timeStamp?: unknown;
    };
    if (!Array.isArray(response.features)) {
      throw new Error("IGN BD TOPO WFS lieferte keine GeoJSON-Featureliste für Windanlagen");
    }
    const features = normalizeIgnFranceWindFeatures(response.features);
    const matched = Number(response.numberMatched ?? response.totalFeatures);
    const sourceTimestamp = typeof response.timeStamp === "string"
      ? response.timeStamp
      : null;
    const queriedAt = isIgnFranceWfsTimestampFresh(sourceTimestamp, Date.now())
      ? sourceTimestamp
      : null;
    const complete = isIgnFranceWindQueryComplete(
      response.features,
      matched,
      IGN_FRANCE_WIND_FEATURE_LIMIT,
      features,
    );
    const status = !queriedAt ? "stale" : complete ? "available" : "partial";
    const result: OfficialAssetResult = {
      status,
      updatedAt: sourceTimestamp,
      features,
    };
    ignFranceWindCache.set(cacheKey, {
      expiresAt: Date.now() +
        (status === "available" ? OFFICIAL_ASSET_CACHE_TTL_MS : 60_000),
      result,
    });
    return result;
  } catch (error) {
    console.warn("[IGN France wind infrastructure] WFS query failed:", error instanceof Error ? error.message : error);
    if (cached) return { ...cached.result, status: "stale" };
    return { status: "unavailable", updatedAt: null, features: [] };
  }
}

function stateNamesTouchingSearchArea(
  _latitude: number,
  _longitude: number,
  _radiusKm: number,
): string[] {
  // Nur für MaStR relevant (siehe oben) – ohne Server nicht benötigt.
  return [];
}

function searchBbox(latitude: number, longitude: number, radiusKm: number) {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
  return {
    south: latitude - latDelta,
    west: longitude - lonDelta,
    north: latitude + latDelta,
    east: longitude + lonDelta,
    wfs: [
      longitude - lonDelta,
      latitude - latDelta,
      longitude + lonDelta,
      latitude + latDelta,
      "EPSG:4326",
    ].join(","),
  };
}

async function fetchDipulLayer(
  layer: "windkraftanlagen" | "stromleitungen",
  bbox: string,
): Promise<DipulResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const params = new URLSearchParams({
      SERVICE: "WFS",
      VERSION: "2.0.0",
      REQUEST: "GetFeature",
      TYPENAMES: `dipul:${layer}`,
      OUTPUTFORMAT: "application/json",
      SRSNAME: "EPSG:4326",
      BBOX: bbox,
      COUNT: String(WFS_FEATURE_LIMIT),
    });
    const result = await fetchJson(
      `${DIPUL_WFS_URL}?${params}`,
      { headers: { Accept: "application/json" } },
      8000,
    ) as {
      features?: unknown;
      numberMatched?: number | string;
      totalFeatures?: number | string;
    };
    if (!Array.isArray(result.features)) throw new Error("WFS lieferte keine GeoJSON-Featureliste");
    const features = result.features.filter(
      (feature): feature is GeoJsonFeature =>
        !!feature && typeof feature === "object" && !Array.isArray(feature),
    );
    const numberMatched = Number(result.numberMatched ?? result.totalFeatures);
    const partial =
      features.length >= WFS_FEATURE_LIMIT ||
      (Number.isFinite(numberMatched) && numberMatched > features.length);
    return {
      status: partial ? "partial" : "available",
      updatedAt: fetchedAt,
      features,
    };
  } catch (error) {
    console.warn(`[DIPUL infrastructure] ${layer} query failed:`, error instanceof Error ? error.message : error);
    return { status: "unavailable", updatedAt: null, features: [] };
  }
}

function parseTaggedHeight(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function fetchOpenStreetMap(
  latitude: number,
  longitude: number,
  radiusKm: number,
): Promise<OsmResult> {
  const cacheKey = `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${radiusKm.toFixed(1)}`;
  const cached = osmCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const fetchedAt = new Date().toISOString();
  const bbox = searchBbox(latitude, longitude, radiusKm);
  const query =
    `[out:json][timeout:15];(` +
    `node["power"~"^(tower|pole|portal)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `way["power"~"^(line|minor_line)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `node["power"~"^(generator|plant)$"]["generator:source"~"wind",i](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `way["power"~"^(generator|plant)$"]["generator:source"~"wind",i](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `node["power"~"^(generator|plant)$"]["plant:source"~"wind",i](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `way["power"~"^(generator|plant)$"]["plant:source"~"wind",i](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `);out center body geom;`;

  try {
    const result = await fetchJson(
      OVERPASS_URL,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "CopterPilot/1.0",
        },
        body: `data=${encodeURIComponent(query)}`,
      },
      18_000,
    ) as { elements?: unknown };
    if (!Array.isArray(result.elements)) throw new Error("Overpass lieferte keine Elementliste");

    const features: OsmFeature[] = [];
    const seen = new Set<string>();
    for (const raw of result.elements) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const element = raw as {
        type?: string;
        id?: number;
        lat?: number;
        lon?: number;
        tags?: Record<string, unknown>;
        center?: { lat?: number; lon?: number };
        geometry?: Array<{ lat?: number; lon?: number }>;
      };
      const tags = element.tags ?? {};
      const power = String(tags.power ?? "");
      const isLine = element.type === "way" && (power === "line" || power === "minor_line");
      const isMast = element.type === "node" && ["tower", "pole", "portal"].includes(power);
      const windSource = String(tags["generator:source"] ?? tags["plant:source"] ?? "")
        .split(/[;,]/)
        .map((value) => value.trim().toLowerCase());
      const isWindTurbine =
        (element.type === "node" || element.type === "way") &&
        (power === "generator" || power === "plant") &&
        windSource.includes("wind");
      if (!isLine && !isMast && !isWindTurbine) continue;

      const id = `osm:${element.type}/${element.id ?? ""}`;
      if (!element.id || seen.has(id)) continue;
      seen.add(id);

      let geometry: GeoJsonGeometryLike | null = null;
      if (isMast && Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
        geometry = { type: "Point", coordinates: [element.lon, element.lat] };
      } else if (
        isWindTurbine &&
        element.type === "node" &&
        Number.isFinite(element.lat) &&
        Number.isFinite(element.lon)
      ) {
        geometry = { type: "Point", coordinates: [element.lon, element.lat] };
      } else if (
        isWindTurbine &&
        Number.isFinite(element.center?.lat) &&
        Number.isFinite(element.center?.lon)
      ) {
        geometry = { type: "Point", coordinates: [element.center!.lon, element.center!.lat] };
      } else if (isLine && Array.isArray(element.geometry) && element.geometry.length > 1) {
        const coordinates = element.geometry
          .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
          .map((point) => [point.lon!, point.lat!]);
        if (coordinates.length > 1) geometry = { type: "LineString", coordinates };
      }
      if (!geometry) continue;

      const defaultName = isWindTurbine
        ? "Windkraftanlage"
        : isLine
          ? "Stromleitung"
          : power === "portal"
            ? "Leitungsmast (Portal)"
            : "Strommast";
      const email = String(tags["contact:email"] ?? tags.email ?? "").trim() || null;
      const phone = String(tags["contact:phone"] ?? tags.phone ?? "").trim() || null;
      const website = String(tags["contact:website"] ?? tags.website ?? "").trim() || null;
      features.push({
        id,
        kind: isWindTurbine ? "wind_turbine" : isLine ? "power_line" : "power_mast",
        name: String(tags.name ?? defaultName),
        geometry,
        comparisonEligible: isOsmInfrastructureComparable(
          isWindTurbine ? "wind_turbine" : isLine ? "power_line" : "power_mast",
          power,
        ),
        taggedHeightM: parseTaggedHeight(tags.height),
        voltage: tags.voltage ? String(tags.voltage) : null,
        operatorName: String(tags.operator ?? "").trim() || null,
        operatorContact: email || phone || website ? { email, phone, website } : null,
      });
    }
    const fetched = { status: "available" as const, updatedAt: fetchedAt, features };
    osmCache.set(cacheKey, { expiresAt: Date.now() + OSM_CACHE_TTL_MS, result: fetched });
    return fetched;
  } catch (error) {
    console.warn("[OSM energy infrastructure] query failed:", error instanceof Error ? error.message : error);
    const unavailable = { status: "unavailable" as const, updatedAt: null, features: [] };
    osmCache.set(cacheKey, { expiresAt: Date.now() + 60_000, result: unavailable });
    return unavailable;
  }
}

function nearestDipulDistance(
  latitude: number,
  longitude: number,
  features: GeoJsonFeature[],
): number | null {
  const distances = features
    .map((feature) =>
      distanceMetersToGeoJsonGeometry(latitude, longitude, feature.geometry),
    )
    .filter((distance): distance is number => distance !== null && Number.isFinite(distance));
  return distances.length ? Math.min(...distances) : null;
}

function lineSamples(geometry: GeoJsonGeometryLike): Array<[number, number]> {
  if (!["LineString", "MultiLineString"].includes(geometry.type) ||
    !Array.isArray(geometry.coordinates)) return [];
  const rawLines = geometry.type === "LineString"
    ? [geometry.coordinates]
    : geometry.coordinates;
  const samples: Array<[number, number]> = [];
  for (const rawLine of rawLines) {
    if (!Array.isArray(rawLine)) continue;
    const coordinates = rawLine.filter(
      (value): value is [number, number] =>
        Array.isArray(value) &&
        Number.isFinite(value[0]) &&
        Number.isFinite(value[1]),
    );
    for (let i = 1; i < coordinates.length; i++) {
      const [lonA, latA] = coordinates[i - 1];
      const [lonB, latB] = coordinates[i];
      const distance = distanceMetersBetween(latA, lonA, latB, lonB);
      const steps = Math.min(100, Math.max(1, Math.ceil(distance / 40)));
      for (let step = 0; step <= steps; step++) {
        const fraction = step / steps;
        samples.push([
          lonA + (lonB - lonA) * fraction,
          latA + (latB - latA) * fraction,
        ]);
      }
    }
  }
  return samples;
}

function nearestAssetDistanceToOsmGeometry(
  geometry: GeoJsonGeometryLike,
  features: GeoJsonFeature[],
): number | null {
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    const [longitude, latitude] = geometry.coordinates;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return nearestDipulDistance(latitude as number, longitude as number, features);
    }
  }
  const distances = lineSamples(geometry).map(([longitude, latitude]) =>
    nearestDipulDistance(latitude, longitude, features),
  );
  const valid = distances.filter((distance): distance is number => distance !== null);
  return valid.length ? Math.min(...valid) : null;
}

function matchableSourceStatus(
  status: "available" | "partial" | "stale" | "unavailable",
): "available" | "partial" | "unavailable" {
  if (status === "available") return "available";
  if (status === "partial") return "partial";
  return "unavailable";
}

function aggregateMastrStatus(
  rows: Awaited<ReturnType<typeof getMastrWindTurbinesForStates>>,
): InfrastructureSourceStatus {
  const usable = rows.filter((row) => row.status !== "unavailable");
  if (usable.length === 0) return { status: "unavailable", updatedAt: null };
  const anyStale = usable.some((row) => row.status === "stale");
  const incomplete = usable.length < rows.length;
  const times = usable.map((row) => row.updatedAt).filter((value): value is string => !!value);
  const oldest = times.sort()[0] ?? null;
  return {
    status: anyStale ? "stale" : incomplete ? "partial" : "available",
    updatedAt: oldest,
  };
}

export async function queryEnergyInfrastructure(
  countryIso: string,
  latitude: number,
  longitude: number,
  requestedRadiusKm: number,
): Promise<GermanEnergyInfrastructureResponse> {
  const country = getEnergyInfrastructureCountry(countryIso);
  if (!country) throw new Error(`Unsupported infrastructure country: ${countryIso}`);
  const isGermany = country.iso === "DE";
  const searchRadiusKm = Math.min(5, Math.max(0.5, requestedRadiusKm));
  const radiusMeters = searchRadiusKm * 1000;
  const bbox = searchBbox(latitude, longitude, searchRadiusKm);
  const stateNames = isGermany
    ? stateNamesTouchingSearchArea(latitude, longitude, searchRadiusKm)
    : [];

  const [mastrStates, dipulWind, dipulPower, osm, rivmWind, bfe, actLuxembourg, ignFrancePower, ignFranceWind, ngiBelgiumPower] = await Promise.all([
    isGermany ? getMastrWindTurbinesForStates(stateNames) : Promise.resolve([]),
    isGermany
      ? fetchDipulLayer("windkraftanlagen", bbox.wfs)
      : Promise.resolve({ status: "unavailable" as const, updatedAt: null, features: [] }),
    isGermany
      ? fetchDipulLayer("stromleitungen", bbox.wfs)
      : Promise.resolve({ status: "unavailable" as const, updatedAt: null, features: [] }),
    fetchOpenStreetMap(latitude, longitude, searchRadiusKm),
    country.iso === "NL"
      ? fetchRivmWind()
      : Promise.resolve({ status: "unavailable" as const, updatedAt: null, features: [] }),
    country.iso === "CH"
      ? fetchBfeInfrastructure(latitude, longitude, searchRadiusKm)
      : Promise.resolve({
          wind: { status: "unavailable" as const, updatedAt: null, features: [] },
          power: { status: "unavailable" as const, updatedAt: null, features: [] },
        }),
    country.iso === "LU"
      ? fetchLuxembourgInfrastructure(latitude, longitude, searchRadiusKm)
      : Promise.resolve({
          powerLines: { status: "unavailable" as const, updatedAt: null, features: [] },
          powerMasts: { status: "unavailable" as const, updatedAt: null, features: [] },
        }),
    country.iso === "FR"
      ? fetchIgnFrancePower(searchBbox(
          latitude,
          longitude,
          searchRadiusKm + 0.1,
        ))
      : { status: "unavailable" as const, updatedAt: null, features: [] },
    country.iso === "FR"
      ? fetchIgnFranceWind(searchBbox(
          latitude,
          longitude,
          searchRadiusKm + 0.1,
        ))
      : { status: "unavailable" as const, updatedAt: null, features: [] },
    country.iso === "BE"
      ? fetchNgiBelgiumPower(bbox)
      : { status: "unavailable" as const, updatedAt: null, features: [] },
  ]);

  const items: GermanEnergyInfrastructureItem[] = [];
  const verifiedAssetFeatures = [
    ...rivmWind.features,
    ...bfe.wind.features,
    ...bfe.power.features,
    ...actLuxembourg.powerLines.features,
    ...actLuxembourg.powerMasts.features,
    ...ignFranceWind.features,
    ...ignFrancePower.features,
    ...ngiBelgiumPower.features,
  ];
  for (const feature of verifiedAssetFeatures) {
    const distanceMeters = distanceMetersToGeoJsonGeometry(latitude, longitude, feature.geometry);
    if (distanceMeters === null || distanceMeters > radiusMeters) continue;
    items.push({
      id: feature.id,
      kind: feature.kind,
      name: feature.name,
      source: feature.source,
      geometry: feature.geometry,
      distanceMeters,
      // This is a record in an official asset inventory, not a finding about an
      // aviation restriction. Keep the flight-zone comparison explicitly unknown.
      officialMatch: "unknown",
      ...(feature.taggedHeightM === null ? {} : { taggedHeightM: feature.taggedHeightM }),
      ...(feature.hubHeightM === null ? {} : { hubHeightM: feature.hubHeightM }),
      ...(feature.rotorDiameterM === null ? {} : { rotorDiameterM: feature.rotorDiameterM }),
      ...(feature.hubHeightM !== null && feature.rotorDiameterM !== null
        ? { estimatedTipHeightM: feature.hubHeightM + feature.rotorDiameterM / 2 }
        : {}),
      ...(feature.operatorName ? { operatorName: feature.operatorName } : {}),
      ...(feature.voltage ? { voltage: feature.voltage } : {}),
    });
  }

  const nearbyMastr = mastrStates.flatMap((state) => state.features)
    .map((turbine) => {
      const distanceMeters = distanceMetersBetween(
        latitude,
        longitude,
        turbine.latitude,
        turbine.longitude,
      );
      return { turbine, distanceMeters };
    })
    .filter(({ distanceMeters }) => distanceMeters <= radiusMeters);

  for (const { turbine, distanceMeters } of nearbyMastr) {
    const dipulDistanceMeters = nearestDipulDistance(
      turbine.latitude,
      turbine.longitude,
      dipulWind.features,
    );
    items.push({
      id: `mastr:${turbine.id}`,
      kind: "wind_turbine",
      name: turbine.name,
      source: "MaStR",
      geometry: { type: "Point", coordinates: [turbine.longitude, turbine.latitude] },
      distanceMeters,
      officialMatch: classifyOfficialInfrastructureMatch(
        dipulDistanceMeters,
        dipulWind.status,
        100,
      ),
      ...(dipulDistanceMeters === null ? {} : { officialMatchDistanceMeters: dipulDistanceMeters }),
      estimatedTipHeightM: turbine.estimatedTipHeightM,
      hubHeightM: turbine.hubHeightM,
      rotorDiameterM: turbine.rotorDiameterM,
      ...(turbine.operatorMastrNumber
        ? { operatorMastrNumber: turbine.operatorMastrNumber }
        : {}),
      ...(turbine.operatorProfileUrl ? { operatorProfileUrl: turbine.operatorProfileUrl } : {}),
      ...(turbine.sourceRecordUrl ? { sourceRecordUrl: turbine.sourceRecordUrl } : {}),
      ...(turbine.operatorName ? { operatorName: turbine.operatorName } : {}),
    });
  }

  const nearbyOsm = osm.features
    .map((feature) => ({
      feature,
      distanceMeters: distanceMetersToGeoJsonGeometry(latitude, longitude, feature.geometry),
    }))
    .filter(
      (entry): entry is { feature: OsmFeature; distanceMeters: number } =>
        entry.distanceMeters !== null && entry.distanceMeters <= radiusMeters,
    );

  for (const { feature, distanceMeters } of nearbyOsm) {
    let comparisonFeatures: GeoJsonFeature[] = [];
    let comparisonStatus: "available" | "partial" | "unavailable" = "unavailable";
    if (isGermany && feature.kind !== "power_mast") {
      const layer = feature.kind === "wind_turbine" ? dipulWind : dipulPower;
      comparisonFeatures = layer.features;
      comparisonStatus = layer.status;
    } else if (country.iso === "NL" && feature.kind === "wind_turbine") {
      comparisonFeatures = rivmWind.features.map((entry) => ({ geometry: entry.geometry }));
      comparisonStatus = matchableSourceStatus(rivmWind.status);
    } else if (country.iso === "CH") {
      const layer = feature.kind === "wind_turbine" ? bfe.wind : bfe.power;
      comparisonFeatures = layer.features
        .filter((entry) => entry.kind === feature.kind)
        .map((entry) => ({ geometry: entry.geometry }));
      comparisonStatus = matchableSourceStatus(layer.status);
    } else if (country.iso === "LU" && feature.kind !== "wind_turbine") {
      const layer = feature.kind === "power_line"
        ? actLuxembourg.powerLines
        : actLuxembourg.powerMasts;
      comparisonFeatures = layer.features.map((entry) => ({ geometry: entry.geometry }));
      comparisonStatus = matchableSourceStatus(layer.status);
    } else if (country.iso === "FR" && feature.kind === "wind_turbine") {
      comparisonFeatures = ignFranceWind.features.map((entry) => ({ geometry: entry.geometry }));
      comparisonStatus = matchableSourceStatus(ignFranceWind.status);
    } else if (country.iso === "FR" && feature.kind === "power_line") {
      comparisonFeatures = ignFrancePower.features.map((entry) => ({ geometry: entry.geometry }));
      comparisonStatus = matchableSourceStatus(ignFrancePower.status);
    } else if (country.iso === "BE" && feature.comparisonEligible) {
      comparisonFeatures = ngiBelgiumPower.features
        .filter((entry) => entry.kind === feature.kind)
        .map((entry) => ({ geometry: entry.geometry }));
      comparisonStatus = matchableSourceStatus(ngiBelgiumPower.status);
    }
    const hasComparableLayer =
      country.comparableOfficialAssetKinds.includes(feature.kind) &&
      feature.comparisonEligible &&
      !(country.iso === "FR" &&
        feature.kind === "power_line" &&
        !isIgnFranceLineVoltageComparable(feature.voltage));
    const officialDistanceMeters = hasComparableLayer
      ? nearestAssetDistanceToOsmGeometry(feature.geometry, comparisonFeatures)
      : null;
    const limit = feature.kind === "power_line" ? 40 : 50;
    items.push({
      id: feature.id,
      kind: feature.kind,
      name: feature.name,
      source: "OpenStreetMap",
      geometry: feature.geometry,
      distanceMeters,
      officialMatch: hasComparableLayer
        ? classifyOfficialInfrastructureMatch(officialDistanceMeters, comparisonStatus, limit)
        : "unknown",
      ...(officialDistanceMeters === null ? {} : { officialMatchDistanceMeters: officialDistanceMeters }),
      ...(feature.kind === "wind_turbine" ? { taggedHeightM: feature.taggedHeightM } : {}),
      ...(feature.kind === "power_mast" ? { taggedHeightM: feature.taggedHeightM } : {}),
      ...(feature.voltage ? { voltage: feature.voltage } : {}),
      ...(feature.operatorName ? { operatorName: feature.operatorName } : {}),
      ...(feature.operatorContact ? { operatorContact: feature.operatorContact } : {}),
    });
  }

  const supplementalItems = items.filter(isSupplementalEnergyInfrastructureItem);
  const counts = {
    windTurbines: supplementalItems.filter((item) => item.kind === "wind_turbine").length,
    powerLines: supplementalItems.filter((item) => item.kind === "power_line").length,
    powerMasts: supplementalItems.filter((item) => item.kind === "power_mast").length,
  };
  const limited = [
    ...supplementalItems.filter((item) => item.kind === "wind_turbine").sort((a, b) => a.distanceMeters - b.distanceMeters),
    ...supplementalItems.filter((item) => item.kind === "power_line").sort((a, b) => a.distanceMeters - b.distanceMeters),
    ...supplementalItems.filter((item) => item.kind === "power_mast").sort((a, b) => a.distanceMeters - b.distanceMeters),
  ].sort((a, b) => a.distanceMeters - b.distanceMeters);

  return {
    country,
    searchRadiusKm,
    features: limited,
    counts,
    sources: {
      mastr: aggregateMastrStatus(mastrStates),
      officialWind: { status: dipulWind.status, updatedAt: dipulWind.updatedAt },
      officialPower: { status: dipulPower.status, updatedAt: dipulPower.updatedAt },
      openStreetMap: { status: osm.status, updatedAt: osm.updatedAt },
      rivm: { status: rivmWind.status, updatedAt: rivmWind.updatedAt },
      bfeWind: { status: bfe.wind.status, updatedAt: bfe.wind.updatedAt },
      bfePower: { status: bfe.power.status, updatedAt: bfe.power.updatedAt },
      actLuxembourg: {
        status: actLuxembourg.powerLines.status === "available" &&
          actLuxembourg.powerMasts.status === "available"
          ? "available"
          : actLuxembourg.powerLines.status === "unavailable" &&
              actLuxembourg.powerMasts.status === "unavailable"
            ? "unavailable"
            : "partial",
        updatedAt: [actLuxembourg.powerLines.updatedAt, actLuxembourg.powerMasts.updatedAt]
          .filter((value): value is string => !!value)
          .sort()[0] ?? null,
      },
      ignFrancePower: {
        status: ignFrancePower.status,
        updatedAt: ignFrancePower.updatedAt,
      },
      ignFranceWind: {
        status: ignFranceWind.status,
        updatedAt: ignFranceWind.updatedAt,
      },
      ngiBelgiumPower: {
        status: ngiBelgiumPower.status,
        updatedAt: ngiBelgiumPower.updatedAt,
      },
    },
  };
}
