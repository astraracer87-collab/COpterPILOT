import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCached, setCache, makeCacheKey } from "@/lib/dataCache";
import { polygonGroupsIntersectCircle, polygonRingsIntersectCircle } from "@/lib/geozoneSpatial";
import {
  buildGeozoneCacheTileUrlFrom,
  buildGeozoneWmsTileTemplates,
} from "@/lib/geozoneTileUrl";
import {
  queryEd269CachedFeaturesWithStatusFrom,
  getCountriesInRadius as getCountriesInRadiusFrom,
  getViewportCountries as getViewportCountriesFrom,
  storedCoverageStatus,
  summarizeGeozoneCoverage,
  worseSourceStatus,
  type Ed269StatusResult,
  type GeozoneAreaResult,
  type GeozoneSourceCoverage,
  type GeozoneSourceStatus,
} from "@/lib/geozoneCoverage";
export type { GeozoneAreaResult, GeozoneSourceCoverage, GeozoneSourceStatus, GeozoneCoverage } from "@/lib/geozoneCoverage";
import { isLoggedInSync } from "@/lib/auth";
import { isOfflineNow } from "@/lib/network";
import { getOfflineResult, putOfflineResult } from "@/lib/offlineResultCache";
import { offlineLocationKey } from "../../shared/offlineDataPolicy";
import { awaitCountryUsage, COUNTRY_DISABLED_NOTE, isGeozoneSourceEnabled } from "@/lib/countryUsage";
import { disabledSourceCoverage, withPartialDatasetNote } from "@/lib/geozoneCoverage";
import {
  esPartialNote,
  withEsNotamActivations,
  hasTiledGeozones,
  queryTiledGeozones,
  queryTiledGeozonesAtPoint,
  queryEsTempZones,
  getTilePartMeta,
} from "@/lib/geozoneTiles/tileStore";
import { bboxAround, DIPUL_WOHN_LAYER, TILE_STORE_OPTIONAL_PARTS, type LngLatBBox } from "@/lib/geozoneTiles/tileStoreCore";
import { queryEsLiveZones } from "@/lib/geozoneTiles/esLive";
import { trackDownload } from "@/lib/downloadActivity";
import { geozoneTruncationHint } from "../../shared/checks/builders";
import {
  DIPUL_TEMP_WFS_LAYER,
  dipulWfsFeatureToGeoapiArea,
  enrichDipulTempGeometry,
  loadDipulLayer,
  type DipulFeatureStore,
} from "@/lib/dipulTempGeometry";
import {
  queryChRestIdentifyFrom,
  queryDipulWfsFeaturesFrom,
  DipulWfsAccessError,
  queryLuOgcFeaturesFrom,
  queryNlWfsFeaturesFrom,
  queryFrWmsFeaturesFrom,
  fetchLuTsaAsNotams,
  fetchAllLuZonesAsNotamsFrom,
  fetchAllLuZonesWithGeometryFrom,
  LU_TEMP_ZONE_LABEL,
} from "@/lib/geozoneQueries";
import {
  GEOZONE_REGULATORY_INFO,
  EDR_ZONE_CONTACTS,
  CTR_ZONE_CONTACTS,
  getContactsForLayerId,
  type GeozoneContact,
  type GeozoneRegulatoryInfo,
} from "@/lib/geozoneRegulatoryInfo";
import { groupDanishBufferRings } from "../../shared/danishGeozones";
import {
  filterActiveWmsLayers,
  defaultGeozoneSelection,
  mergeSelectionWithDefaults,
  migrateSelection,
  type GeozoneSelection,
  type OldLayerRef,
} from "../../shared/geozoneCategories";
import {
  GEOZONE_LAYERS,
  CH_GEOZONE_LAYERS,
  LU_GEOZONE_LAYERS,
  NL_GEOZONE_LAYERS,
  FR_GEOZONE_LAYERS,
  HU_GEOZONE_LAYERS,
  HU_GEOZONE_ATTRIBUTION,
  HU_GEOZONE_RASTER_HINT,
  fillGeozoneDatePlaceholders,
  getNativeLegacyLayerRefs,
  type GeozoneLayer,
} from "../../shared/geozoneLayerCatalog";

// Re-Export des geteilten Layer-Katalogs, damit bestehende Importe aus diesem
// Modul (GEOZONE_LAYERS, CH/LU/NL/FR-Listen, GeozoneLayer) stabil bleiben. Die
// Definitionen leben jetzt in der React-Native-freien shared/geozoneLayerCatalog.ts,
// sodass der Migrationstest dieselbe Quelle wie die App nutzt.
export {
  GEOZONE_LAYERS,
  CH_GEOZONE_LAYERS,
  LU_GEOZONE_LAYERS,
  NL_GEOZONE_LAYERS,
  FR_GEOZONE_LAYERS,
  HU_GEOZONE_LAYERS,
  HU_GEOZONE_ATTRIBUTION,
  HU_GEOZONE_RASTER_HINT,
  type GeozoneLayer,
};

// Re-export der zonenspezifischen Kontakttabellen, damit bestehende Importe
// aus diesem Modul weiterhin funktionieren (Quelle ist jetzt die geteilte
// Datenbasis geozoneRegulatoryInfo.ts).
export { EDR_ZONE_CONTACTS, CTR_ZONE_CONTACTS };

const GEOZONES_KEY = "@preflight/geozone_layers";
// Neuer, länderübergreifender Kategorie-Speicher (eine globale Auswahl statt
// pro Land). Server-Spiegel unter dem kanonischen Pseudo-ISO "GLOBAL".
const GEOZONE_CATEGORIES_KEY = "@preflight/geozone_categories";
const GEOZONE_GLOBAL_ISO = "GLOBAL";
const MAP_STYLE_KEY = "@preflight/map_style";

// Zoom-/Grenzkonstanten der Geozonen-Overlays leben jetzt in einem reinen,
// React-Native-freien Modul (`@/lib/geozoneZoom`), damit Web und Native
// DIESELBEN Werte teilen können (GEOZONE_VECTOR_MIN_ZOOM war zuvor hier und im
// Web als VECTOR_MIN_ZOOM dupliziert). Re-Export hält bestehende Importe aus
// diesem Modul stabil.
import {
  GEOZONE_TILE_MIN_ZOOM,
  GEOZONE_VECTOR_MIN_ZOOM,
  GEOZONE_VECTOR_COUNTRY_MIN_ZOOM,
  getVectorMinZoom,
  loadsFullCountryVectorZones,
  isRasterTiledVectorCountry,
  GEOZONE_VECTOR_MAX_RADIUS_KM,
  GEOZONE_VECTOR_MAX_FEATURES,
  COUNTRY_WMS_MAX_NATIVE_ZOOM,
} from "@/lib/geozoneZoom";
import { buildVectorGeozoneTileUrlFrom } from "@/lib/geozoneTileUrl";
import { deRestrictionForLayer, restrictionFromText } from "../../shared/restrictionPolicy";
import { buildCountryGeozoneConfigs, getSourceDataStatus } from "@/lib/geozoneSources/registry";
import type { CountryGeozoneConfig } from "@/lib/geozoneSources/wmsConfigs";
import { getGeozoneSourceMeta, resolveGeozoneSourceIso } from "../../shared/geozoneSourceMeta";
export {
  LEAFLET_WMS_BBOX_FN_JS,
  GEOZONE_TILE_BBOX_PLACEHOLDER,
  fillGeozoneTileTemplate,
} from "@/lib/geozoneTileUrl";
export {
  GEOZONE_TILE_MIN_ZOOM,
  GEOZONE_VECTOR_MIN_ZOOM,
  GEOZONE_VECTOR_COUNTRY_MIN_ZOOM,
  getVectorMinZoom,
  loadsFullCountryVectorZones,
  isRasterTiledVectorCountry,
  RASTER_TILED_VECTOR_ISOS,
  GEOZONE_VECTOR_MAX_RADIUS_KM,
  GEOZONE_VECTOR_MAX_FEATURES,
  COUNTRY_WMS_MAX_NATIVE_ZOOM,
} from "@/lib/geozoneZoom";

// Typen und WMS-Konfigurationen (DE/CH/LU/NL/FR/HU) leben React-Native-frei in
// geozoneSources/wmsConfigs.ts; die Länderliste kommt aus der Quellen-Registry.
export type { CountryIsoWithGeozones, CountryGeozoneConfig } from "@/lib/geozoneSources/wmsConfigs";

/**
 * Geozonen-Konfiguration je Land – aus der Quellen-Registry
 * (client/lib/geozoneSources/registry.ts): WMS-Länder mit ihrer WMS-
 * Konfiguration, alle übrigen Quellen als Vektor-Länder ("ed269-cached",
 * CZ ohne WMS: "tiles").
 */
export const COUNTRY_GEOZONE_CONFIGS: Record<string, CountryGeozoneConfig> = buildCountryGeozoneConfigs();

export function getCountryGeozoneConfig(countryIso?: string): CountryGeozoneConfig {
  // Aliase aus der Registry (Liechtenstein steckt im BAZL-Datensatz)
  const iso = countryIso ? resolveGeozoneSourceIso(countryIso) : undefined;
  if (iso && COUNTRY_GEOZONE_CONFIGS[iso]) {
    return COUNTRY_GEOZONE_CONFIGS[iso];
  }
  return COUNTRY_GEOZONE_CONFIGS.DE;
}

export function getCountryGeozoneLayers(countryIso?: string): GeozoneLayer[] {
  return getCountryGeozoneConfig(countryIso).layers;
}

export {
  GEOZONE_REGULATORY_INFO,
  type GeozoneContact,
  type GeozoneRegulatoryInfo,
};

export function getContactsForZone(layerLabelOrId: string, zoneName?: string, countryIso?: string | null): GeozoneContact[] {
  const allLayers = Object.values(COUNTRY_GEOZONE_CONFIGS).flatMap((c) => c.layers);
  const layer = allLayers.find((l) => l.label === layerLabelOrId || l.id === layerLabelOrId);
  const layerId = layer?.id ?? layerLabelOrId;
  return getContactsForLayerId(layerId, zoneName, countryIso);
}

export const ALWAYS_VISIBLE_LAYERS = new Set([
  "kontrollzonen",
  "flugbeschraenkungsgebiete",
  "temporaere_betriebseinschraenkungen",
  "flughaefen",
  "flugplaetze",
]);

export function getAlwaysVisibleLayers(countryIso?: string): Set<string> {
  const config = getCountryGeozoneConfig(countryIso);
  return new Set(config.alwaysVisibleLayerIds);
}

export const WMS_BASE_URL = "https://uas-betrieb.de/geoservices/dipul/wms";

function buildWmsGetMapUrl(
  baseUrl: string,
  version: string,
  layers: string[],
  opts?: { styles?: string; sldBody?: string },
): string {
  if (layers.length === 0) return "";
  const layerStr = layers.join(",");
  const crsParam = version === "1.3.0" ? "CRS" : "srs";
  const stylesParam = opts?.styles ?? "";
  let url = `${baseUrl}?SERVICE=WMS&VERSION=${version}&REQUEST=GetMap&LAYERS=${layerStr}&STYLES=${stylesParam}&${crsParam}=EPSG:3857&BBOX={minX},{minY},{maxX},{maxY}&WIDTH={width}&HEIGHT={height}&FORMAT=image/png&TRANSPARENT=true`;
  if (opts?.sldBody) {
    url += `&SLD_BODY=${encodeURIComponent(opts.sldBody)}`;
  }
  return url;
}

export function buildWmsTileUrl(layerName: string, countryIso?: string): string {
  const config = getCountryGeozoneConfig(countryIso);
  // Per-Layer-Override beachten, falls der Layer ein eigenes WMS verwendet
  // (z. B. NL Natura 2000 auf eigenem PDOK-Endpoint).
  const def = config.layers.find((l) => l.wmsLayer === layerName);
  // Reine XYZ-Kacheln (z. B. HU MyDroneSpace): Vorlage unverändert.
  if (def?.tileUrlTemplate) return fillGeozoneDatePlaceholders(def.tileUrlTemplate);
  const baseUrl = def?.wmsBaseUrl ?? config.wmsBaseUrl;
  const version = def?.wmsVersion ?? config.wmsVersion;
  return buildWmsGetMapUrl(baseUrl, version, [layerName], {
    styles: def?.wmsStyle,
    sldBody: def?.wmsSldBody,
  });
}

/**
 * Baut WMS-Tile-URLs für eine Liste von Layer-Namen. Gibt EIN URL pro
 * WMS-Endpoint zurück — d. h. Layer ohne Override teilen sich das
 * Standard-WMS des Landes (ein Eintrag), Layer mit eigenem `wmsBaseUrl`
 * (z. B. NL Natura 2000 auf PDOK-RVO) bekommen einen separaten Eintrag.
 * Caller rendern pro URL eine `WMSTile`-Kachel.
 */
export function buildCombinedWmsTileUrl(layers: string[], countryIso?: string): string[] {
  const config = getCountryGeozoneConfig(countryIso);
  if (layers.length === 0) return [];
  const layerByName = new Map<string, GeozoneLayer>();
  for (const l of config.layers) layerByName.set(l.wmsLayer, l);
  const groups = new Map<
    string,
    { baseUrl: string; version: string; layers: string[]; styles?: string; sldBody?: string }
  >();
  // XYZ-Layer (tileUrlTemplate) bekommen ihre eigene Vorlage und werden nie
  // mit WMS-Layern in einem GetMap gebündelt.
  const xyz: string[] = [];
  for (const name of layers) {
    const def = layerByName.get(name);
    if (def?.tileUrlTemplate) {
      const t = fillGeozoneDatePlaceholders(def.tileUrlTemplate);
      if (!xyz.includes(t)) xyz.push(t);
      continue;
    }
    const baseUrl = def?.wmsBaseUrl ?? config.wmsBaseUrl;
    const version = def?.wmsVersion ?? config.wmsVersion;
    // Layer mit eigenem Style/SLD bekommen einen eigenen Request, weil
    // STYLES/SLD_BODY pro Request gelten und Layer 1:1 zugeordnet sein muss.
    const styleKey = def?.wmsStyle ?? "";
    const sldKey = def?.wmsSldBody ?? "";
    const key = `${baseUrl}|${version}|${styleKey}|${sldKey}`;
    let g = groups.get(key);
    if (!g) {
      g = { baseUrl, version, layers: [], styles: def?.wmsStyle, sldBody: def?.wmsSldBody };
      groups.set(key, g);
    }
    g.layers.push(name);
  }
  const wms = Array.from(groups.values())
    .map((g) => buildWmsGetMapUrl(g.baseUrl, g.version, g.layers, { styles: g.styles, sldBody: g.sldBody }))
    .filter((u) => u.length > 0);
  return [...wms, ...xyz];
}

/**
 * Pflicht-Attribution der Kachel-Ebene(n) eines Landes (z. B. HU
 * "© HungaroControl / MyDroneSpace"), "" wenn keine gesetzt ist. Wird als
 * Leaflet-`attribution` an die Geozonen-Kachel-Ebene gehängt.
 */
export function getGeozoneTileAttribution(countryIso?: string): string {
  const iso = countryIso?.toUpperCase();
  if (!iso || !COUNTRY_GEOZONE_CONFIGS[iso]) return "";
  const parts = COUNTRY_GEOZONE_CONFIGS[iso].layers
    .map((l) => l.tileAttribution)
    .filter((a): a is string => !!a);
  return Array.from(new Set(parts)).join(" · ");
}

/** True, wenn das Land Geozonen als Kachel-Overlay hat (WMS oder XYZ). */
export function hasGeozoneTileOverlay(countryIso?: string): boolean {
  const iso = countryIso?.toUpperCase();
  const cfg = iso ? COUNTRY_GEOZONE_CONFIGS[iso] : undefined;
  if (!cfg) return false;
  if (cfg.layers.some((l) => !!l.tileUrlTemplate)) return true;
  return cfg.featureInfoType !== "none" && !!cfg.wmsBaseUrl;
}

/**
 * Direkte WMS-GetMap-Kachel-Vorlagen eines Landes (EPSG:3857, 256 px) mit
 * `{bbox}`-Platzhalter – ersetzt den früheren Server-Kachel-Cache. Pro
 * Vorlage legt die Karte EINE Kachel-Ebene an (mehrere bei NL-Natura-2000 oder
 * > 15 DE-Layern). Leaflet löst `{bbox}` über die Option
 * `bbox: __geozoneWmsBbox` auf (siehe LEAFLET_WMS_BBOX_FN_JS).
 */
export function buildGeozoneTileUrls(layers: string[], countryIso?: string): string[] {
  return buildGeozoneWmsTileTemplates(layers, countryIso);
}

/**
 * Früher: kombinierte Kachel-URL des Server-Caches. Jetzt die ERSTE direkte
 * WMS-Vorlage (mit `{bbox}`-Platzhalter); weitere Vorlagen desselben Landes
 * liefert buildGeozoneTileUrls(). "" ohne gültige Layer.
 */
export function buildGeozoneCacheTileUrl(layers: string[], countryIso?: string): string {
  return buildGeozoneCacheTileUrlFrom("", layers, countryIso);
}

/**
 * Früher: serverseitig rasterisierte Kacheln für Vektor-Geozonen-Länder (z. B.
 * Belgien). Ohne Backend nicht mehr verfügbar -> immer "". Diese Zonen müssen
 * als Vektor-Polygone gezeichnet werden (queryEd269CachedFeatures).
 */
export function buildVectorGeozoneTileUrl(countryIso: string): string {
  return buildVectorGeozoneTileUrlFrom("", countryIso);
}

/**
 * WMS-Tile-URLs für ALLE konfigurierten Länder (DE/CH/LU/NL). Wird im
 * Planungs-Karten-Picker genutzt, damit die Geozonen aller Länder gleichzeitig
 * als Overlay sichtbar sind — der Nutzer muss vorab kein Land wählen. Jede
 * WMS liefert nur in ihrem Gebiet Daten, der Rest ist transparent.
 * Hinweis: Ein Land kann mehrere WMS-Endpoints haben (z. B. NL: LVNL +
 * PDOK Natura 2000) — pro Endpoint kommt ein Eintrag heraus.
 */
export function buildAllCountryWmsTileUrls(): { iso: string; url: string }[] {
  const out: { iso: string; url: string }[] = [];
  for (const config of Object.values(COUNTRY_GEOZONE_CONFIGS)) {
    const enabled = config.layers.filter((l) => l.defaultEnabled).map((l) => l.wmsLayer);
    if (enabled.length === 0) continue;
    const urls = buildCombinedWmsTileUrl(enabled, config.iso);
    for (const url of urls) out.push({ iso: config.iso, url });
  }
  return out;
}

function getStorageKeyForCountry(countryIso?: string): string {
  const iso = countryIso?.toUpperCase() || "DE";
  if (iso === "DE") return GEOZONES_KEY;
  return `${GEOZONES_KEY}_${iso}`;
}

// Liste der FRÜHER pro Land/Layer gespeicherten Layer (für die einmalige
// Migration auf die Kategorie-Auswahl). id = alter Speicher-Schlüssel,
// iso + wmsLayer für die Kategorie-Auflösung. Quelle ist der geteilte,
// React-Native-freie Katalog (shared/geozoneLayerCatalog.ts) — derselbe, aus
// dem der Migrationstest seine Alt-Layer-Referenzen ableitet, damit beide
// nicht auseinanderdriften.
function getLegacyLayerRefs(): OldLayerRef[] {
  return getNativeLegacyLayerRefs();
}

// Liest die alten, pro Land getrennten AsyncStorage-Einträge und faltet sie zu
// einer kombinierten Alt-Auswahl zusammen (für die Migration). Liefert null,
// wenn gar keine alten Daten existieren.
async function readLegacyGeozoneSelection(): Promise<Record<string, boolean> | null> {
  const isos = Object.keys(COUNTRY_GEOZONE_CONFIGS);
  let found = false;
  const combined: Record<string, boolean> = {};
  for (const iso of isos) {
    try {
      const raw = await AsyncStorage.getItem(getStorageKeyForCountry(iso));
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed && typeof parsed === "object") {
        found = true;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "boolean") combined[k] = combined[k] || v;
        }
      }
    } catch {}
  }
  return found ? combined : null;
}

// Lädt die länderübergreifende Geozonen-Kategorie-Auswahl. Der Parameter
// countryIso wird NICHT mehr zur Speicherung verwendet (eine globale Auswahl);
// er bleibt nur aus Kompatibilität in der Signatur erhalten.
export async function loadGeozoneSettings(_countryIso?: string): Promise<GeozoneSelection> {
  // 1) Bei eingeloggtem User zuerst Server abfragen (geräteübergreifend).
  if (isLoggedInSync()) {
    try {
      const { apiGetGeozoneSettings } = await import("./api");
      const remote = await apiGetGeozoneSettings(GEOZONE_GLOBAL_ISO);
      if (remote && typeof remote === "object") {
        return mergeSelectionWithDefaults(remote);
      }
    } catch (e) {
      console.warn("[geozones] server load failed, using local fallback:", (e as Error)?.message);
    }
  }
  // 2) Neuer lokaler Kategorie-Speicher.
  try {
    const stored = await AsyncStorage.getItem(GEOZONE_CATEGORIES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, boolean>;
      return mergeSelectionWithDefaults(parsed);
    }
  } catch {}
  // 3) Einmalige Migration aus den alten pro-Land-Speichern.
  try {
    const legacy = await readLegacyGeozoneSelection();
    if (legacy) {
      const migrated = migrateSelection(legacy, getLegacyLayerRefs());
      await saveGeozoneSettings(migrated);
      return migrated;
    }
  } catch (e) {
    console.warn("[geozones] migration failed, using defaults:", (e as Error)?.message);
  }
  // 4) Defaults.
  return defaultGeozoneSelection();
}

export async function saveGeozoneSettings(settings: GeozoneSelection, _countryIso?: string): Promise<void> {
  if (isLoggedInSync()) {
    try {
      const { apiSaveGeozoneSettings } = await import("./api");
      await apiSaveGeozoneSettings(GEOZONE_GLOBAL_ISO, settings);
      // Lokalen Spiegel löschen, damit nach Logout keine stale Daten übrig bleiben.
      try { await AsyncStorage.removeItem(GEOZONE_CATEGORIES_KEY); } catch {}
      return;
    } catch (error) {
      console.error("[geozones] server save failed, falling back to local:", (error as Error)?.message);
    }
  }
  try {
    await AsyncStorage.setItem(GEOZONE_CATEGORIES_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving geozone settings:", error);
  }
}

export type MapStyleOption = "standard" | "satellite" | "osm" | "grayscale";

export const MAP_STYLES: { id: MapStyleOption; label: string; icon?: string }[] = [
  { id: "standard", label: "Standard", icon: "map" },
  { id: "satellite", label: "Satellit", icon: "globe" },
  { id: "osm", label: "OSM", icon: "layers" },
  { id: "grayscale", label: "Graustufen", icon: "sliders" },
];

export async function loadMapStyle(): Promise<MapStyleOption> {
  try {
    const stored = await AsyncStorage.getItem(MAP_STYLE_KEY);
    if (stored && MAP_STYLES.some((s) => s.id === stored)) {
      return stored as MapStyleOption;
    }
  } catch {}
  return "grayscale";
}

export async function saveMapStyle(style: MapStyleOption): Promise<void> {
  try {
    await AsyncStorage.setItem(MAP_STYLE_KEY, style);
  } catch {}
}

const RADAR_SETTINGS_KEY = "@preflight/radar_settings";
const RADAR_SETTINGS_VERSION_KEY = "@preflight/radar_settings_version";
const RADAR_SETTINGS_VERSION = "2";

export interface RadarDisplaySettings {
  radiusKm: number;
  showRadar: boolean;
  showTraffic: boolean;
  showWindsock: boolean;
  showGeozones: boolean;
  showEnergyInfrastructure: boolean;
  showWeatherOverlay: boolean;
  controlsExpanded: boolean;
  // Sicherheits-Schalter: hebt den Höhen-Filter auf und zeigt ALLE Vektor-
  // Geozonen (AT/BE/DK), auch solche oberhalb der erreichbaren Flughöhe.
  showAllGeozones: boolean;
}

const DEFAULT_RADAR_SETTINGS: RadarDisplaySettings = {
  radiusKm: 10,
  showRadar: true,
  showTraffic: true,
  showWindsock: true,
  showGeozones: true,
  showEnergyInfrastructure: true,
  showWeatherOverlay: false,
  controlsExpanded: false,
  showAllGeozones: false,
};

export async function loadRadarSettings(): Promise<RadarDisplaySettings> {
  try {
    const stored = await AsyncStorage.getItem(RADAR_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Ungültige Radar-Einstellungen");
      }
      const version = await AsyncStorage.getItem(RADAR_SETTINGS_VERSION_KEY);
      if (version !== RADAR_SETTINGS_VERSION) {
        // Zusatzanlagen waren zuvor standardmäßig ausgeschaltet. Einmalig
        // aktivieren, damit der neue App-Standard auch für Bestandsinstallationen
        // gilt; spätere manuelle Änderungen bleiben erhalten.
        parsed.showEnergyInfrastructure = true;
        await AsyncStorage.setItem(RADAR_SETTINGS_KEY, JSON.stringify(parsed));
        await AsyncStorage.setItem(RADAR_SETTINGS_VERSION_KEY, RADAR_SETTINGS_VERSION);
      }
      return { ...DEFAULT_RADAR_SETTINGS, ...parsed };
    }
    await AsyncStorage.setItem(RADAR_SETTINGS_VERSION_KEY, RADAR_SETTINGS_VERSION);
  } catch {}
  return { ...DEFAULT_RADAR_SETTINGS };
}

export async function saveRadarSettings(settings: Partial<RadarDisplaySettings>): Promise<void> {
  try {
    const current = await loadRadarSettings();
    const merged = { ...current, ...settings };
    await AsyncStorage.setItem(RADAR_SETTINGS_KEY, JSON.stringify(merged));
  } catch {}
}

export function getActiveLayerNames(settings: Record<string, boolean>, countryIso?: string): string[] {
  const config = getCountryGeozoneConfig(countryIso);
  const layers = config.layers;
  const wmsNames = layers.map((l) => l.wmsLayer);
  return filterActiveWmsLayers(config.iso, wmsNames, settings);
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

function lonToMercX(lon: number): number {
  return (lon / 180) * 20037508.34;
}

function latToMercY(lat: number): number {
  const r = degToRad(lat);
  return (Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) * 20037508.34;
}

export type GeozoneFeatureInfo = import("../../shared/geozoneFeatureInfo").GeozoneFeatureInfo;

// Die ED-269-Parselogik (Austro Control / skeyes Droneguide) lebt jetzt in einem
// reinen Modul ohne React-Native-Importe (`@/lib/ed269`), damit sie unter
// tsx/Node getestet werden kann. Re-Export für bestehende Importe aus diesem Modul.
export { parseEd269ToGeozoneInfo } from "@/lib/ed269";

// Holt die ED-269-Zonen (AT/BE/DK) für den sichtbaren Bereich und normalisiert
// sie. Quelle ist der Gerätecache (geozoneDirect/), der die Upstream-Feeds
// direkt lädt und regelmäßig aktualisiert – kein Backend, kein WMS.
export async function queryEd269CachedFeatures(
  lat: number,
  lon: number,
  radiusKm: number,
  iso: string,
  limit?: number,
  fullCountry?: boolean,
  maxValidityDays?: number,
  opts?: { layers?: string[] },
): Promise<GeozoneFeatureInfo[]> {
  const r = await queryEd269CachedFeaturesWithStatus(lat, lon, radiusKm, iso, limit, fullCountry, maxValidityDays, opts);
  return r.zones;
}

// Wie queryEd269CachedFeatures, liefert aber zusätzlich den Quellen-Status
// (ok/stale/missing/error) für die Abdeckungs-Information der Flächenabfrage.
export async function queryEd269CachedFeaturesWithStatus(
  lat: number,
  lon: number,
  radiusKm: number,
  iso: string,
  limit?: number,
  fullCountry?: boolean,
  maxValidityDays?: number,
  opts?: { layers?: string[] },
): Promise<Ed269StatusResult> {
  // Länder-Nutzung „Aus“: weder Speicher noch Live-Abfrage (Karte/Radar zeigen den Hinweis)
  await awaitCountryUsage();
  if (!isGeozoneSourceEnabled(iso)) return { zones: [], status: "disabled", note: COUNTRY_DISABLED_NOTE };
  // DE/FR/CZ mit Offline-Kachelspeicher: nur die Kacheln des Ausschnitts lesen
  // (nie das ganze Land, keine NOTAM-artige Gesamtabfrage).
  if (hasTiledGeozones(iso)) {
    if (fullCountry || maxValidityDays) return { zones: [], status: "ok" };
    const stats: { truncated?: boolean } = {};
    const tiled = await queryTiledGeozones(iso, bboxAround(lat, lon, radiusKm), { limit, layers: opts?.layers, stats });
    if (!tiled) return { zones: [], status: "missing", note: "Offline-Paket nicht lesbar" };
    // Keine stille Kürzung (B7/S7): Hinweis „hineinzoomen“.
    const trunc = stats.truncated && limit ? { truncated: true, note: geozoneTruncationHint(limit) } : {};
    // Temporäre DE-Zonen nur bewerten, wenn sie abgefragt wurden (Ebenen-Filter).
    const withTemp = !opts?.layers || opts.layers.length === 0 || opts.layers.includes("temporaere_betriebseinschraenkungen");
    const report = { zones: tiled, ...storedDataReport(iso, withTemp), ...trunc };
    if (String(iso).toUpperCase() === "ES") {
      // Teilbestand (eine ENAIRE-Ebene fehlte beim letzten Download) → „partial“ mit Hinweis
      const partial = withPartialDatasetNote({ status: report.status, ...(report.note ? { note: report.note } : {}) }, esPartialNote());
      return esSupplementMissingParts({ ...report, status: partial.status, ...(partial.note ? { note: partial.note } : {}) }, bboxAround(lat, lon, radiusKm));
    }
    return report;
  }
  // ES ohne Offline-Paket: online je Ausschnitt beim ENAIRE-MapServer (wie DE-WFS).
  if (getGeozoneSourceMeta(iso)?.liveVectorQuery) {
    if (fullCountry || maxValidityDays) return { zones: [], status: "ok" };
    return queryEsLiveWithStatus(lat, lon, radiusKm, limit);
  }
  // Offline-Quelle der ED-269-Länder ist allein der Gerätebestand
  // (geozoneDirect/ed269Store, auf dem Gerät gespeichert, Stand/„stale“ laut
  // Registry). Der frühere Rückfall auf die Features des Offline-Pakets ist
  // entfallen (B7/S6): das Paket wird aus genau diesem Bestand erzeugt, lieferte
  // offline aber „ok“ ohne Datenalter und hätte einen gelöschten Import (GR)
  // wiederbelebt. Kein Bestand = Abdeckungslücke ("missing").
  return queryEd269CachedFeaturesWithStatusFrom("", lat, lon, radiusKm, iso, limit, fullCountry, maxValidityDays);
}

// ---------------------------------------------------------------------------
// Spanien (ENAIRE insignias): Live-Pfad ohne Paket, Ergänzung fehlender Teile
// ---------------------------------------------------------------------------

const ES_PART_LABELS: Record<string, string> = { infra: "Infrastruktur", enp: "Naturschutz" };

/** Höchstens `limit` Zonen, die der Mitte nächsten zuerst (B7/S7: mit Hinweis). */
function nearestZones(zones: GeozoneFeatureInfo[], lat: number, lon: number, limit?: number): { zones: GeozoneFeatureInfo[]; truncated: boolean } {
  if (!limit || zones.length <= limit) return { zones, truncated: false };
  const d2 = (z: GeozoneFeatureInfo) => {
    const ring = z.polygonRings?.[0] ?? [];
    if (ring.length === 0) return Infinity;
    let a = 0;
    let b = 0;
    for (const [y, x] of ring) {
      a += y;
      b += x;
    }
    const dy = a / ring.length - lat;
    const dx = b / ring.length - lon;
    return dy * dy + dx * dx;
  };
  return { zones: [...zones].sort((p, q) => d2(p) - d2(q)).slice(0, limit), truncated: true };
}

/**
 * ES ohne Offline-Paket: online live je Ausschnitt (alle Teile + NOTAM) und
 * das Ergebnis je Standort für offline speichern; offline der gespeicherte
 * Stand (mit Alter), sonst Abdeckungslücke statt „keine Zonen“.
 */
async function queryEsLiveWithStatus(lat: number, lon: number, radiusKm: number, limit?: number): Promise<Ed269StatusResult> {
  const key = `ES_${offlineLocationKey(lat, lon)}_${Math.round(radiusKm * 10)}`;
  if (isOfflineNow()) {
    const stored = await getOfflineResult<GeozoneFeatureInfo[]>("geozones-live", key).catch(() => null);
    if (stored && Array.isArray(stored.data)) {
      const st = storedCoverageStatus("ES", stored.fetchedAt, stored.fetchedAt);
      return { zones: stored.data, status: st.status, fetchedAt: stored.fetchedAt, ...(st.note ? { note: st.note } : {}) };
    }
    return { zones: [], status: "missing", note: "Gerät offline – kein Offline-Paket und kein gespeicherter Stand" };
  }
  const bbox = bboxAround(lat, lon, radiusKm);
  let live: { zones: GeozoneFeatureInfo[]; failedLayers: string[] };
  try {
    live = await queryEsLiveZones(bbox);
  } catch (e: any) {
    return { zones: [], status: "error", note: `ENAIRE nicht erreichbar${e?.message ? ` (${e.message})` : ""}` };
  }
  const temp = await queryEsTempZones(bbox).catch(() => [] as GeozoneFeatureInfo[]);
  // statische NOTAM-Aktivierungen („Zone LED90A ist jetzt aktiv“) an den Sperrgebieten
  const liveZones = await withEsNotamActivations(live.zones).catch(() => live.zones);
  const all = [...liveZones, ...temp];
  putOfflineResult("geozones-live", key, all).catch(() => {});
  const { zones, truncated } = nearestZones(all, lat, lon, limit);
  const trunc = truncated && limit ? { truncated: true, note: geozoneTruncationHint(limit) } : {};
  if (live.failedLayers.length > 0) {
    return { zones, status: "partial", note: `Einige ENAIRE-Ebenen nicht erreichbar (${live.failedLayers.join(", ")})`, ...(truncated ? { truncated: true } : {}) };
  }
  return { zones, status: "ok", ...trunc };
}

/**
 * ES mit Paket ohne abwählbare Teile (Infrastruktur/Naturschutz): online live
 * ergänzen, offline „partial“ mit Hinweis (wie DE-Wohngrundstücke).
 */
async function esSupplementMissingParts(r: Ed269StatusResult, bbox: LngLatBBox): Promise<Ed269StatusResult> {
  const missing = TILE_STORE_OPTIONAL_PARTS.ES.filter((p) => getTilePartMeta("ES", p)?.complete !== true);
  if (missing.length === 0) return r;
  const labels = missing.map((p) => ES_PART_LABELS[p] ?? p).join(" und ");
  if (isOfflineNow()) {
    const status = worseSourceStatus(r.status, "partial");
    return { ...r, status, note: r.note ?? `${labels} nicht im Offline-Paket – offline nicht geprüft` };
  }
  try {
    const live = await queryEsLiveZones(bbox, missing as ("infra" | "enp")[]);
    return { ...r, zones: [...r.zones, ...live.zones] };
  } catch {
    return { ...r, status: worseSourceStatus(r.status, "partial"), note: r.note ?? `${labels} nicht im Offline-Paket und online nicht erreichbar` };
  }
}

/**
 * Abdeckungs-Meldung für einen gespeicherten Bestand (Kachelspeicher): Stand
 * und "stale" laut Registry-Policy (getSourceDataStatus).
 */
function storedDataReport(iso: string, withTemp = true): { status: GeozoneSourceStatus; fetchedAt?: number; note?: string } {
  const st = getSourceDataStatus(iso);
  // Teil A: DE führt die temporären Betriebseinschränkungen mit eigenem Stand
  // (getDeTempStatus); veraltet bzw. nie geladen → "partial".
  const stored = storedCoverageStatus(iso, st.fetchedAt, withTemp ? st.temporaryFetchedAt : undefined);
  return {
    status: stored.status,
    ...(st.fetchedAt != null ? { fetchedAt: st.fetchedAt } : {}),
    ...(stored.note ? { note: stored.note } : {}),
  };
}

export const TEMP_RESTRICTION_LAYER_LABEL = "Temporäre Beschränkungen";

export interface DipulTempRestriction {
  id: string;
  extRef: string;
  name: string;
  names: string[];
  genNames: string[];
  type: string;
  legalRef: string;
  legalExplanation: string;
  category: "military" | "notam" | "nature" | "other";
  lowerAlt: number;
  lowerAltRef: string;
  lowerAltUnit: string;
  upperAlt: number;
  upperAltRef: string;
  upperAltUnit: string;
  status: "active" | "upcoming";
  startTs: string | null;
  endTs: string | null;
  endTsIndefinite: boolean;
  validityUnknown?: boolean;
  recurRules: string[] | null;
  /** Concrete repeated activation windows, separate from the outer validity dates. */
  scheduleText?: string[];
  centerLat: number | null;
  centerLon: number | null;
  radiusM: number | null;
  polygonRings: [number, number][][] | null;
  // Gruppierte Ringe pro Polygon ([Außenring, Loch1, …]), damit Donut-Geometrien
  // (z. B. Zonen mit ausgesparten Innenbereichen) echte Löcher behalten. polygonRings
  // bleibt die flache Außenring-Liste für Treffer-/Schnitt-Tests. Ohne Löcher undefined.
  polygonGroups?: [number, number][][][] | null;
  kind?: "mil_low_flight_day";
  /** Grund, warum (noch) keine Fläche vorliegt (siehe dipulTempGeometry). */
  geometryNote?: string | null;
}

function pointInRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1];
    const yj = ring[j][0], xj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(lat: number, lon: number, rings: [number, number][][]): boolean {
  for (const ring of rings) {
    if (pointInRing(lat, lon, ring)) return true;
  }
  return false;
}

// Donut-bewusste Treffer-Erkennung: Ein Punkt liegt nur dann in einer Polygon-
// Gruppe, wenn er im Außenring (group[0]) UND in keinem der Löcher (group[1..])
// liegt. Dadurch wählt ein Tipp mitten in ein ausgespartes Loch die umgebende
// Zone NICHT mehr aus. Lochfreie Polygone (group nur mit Außenring) und
// Multipolygone (mehrere Gruppen, ODER-verknüpft) verhalten sich unverändert.
export function pointInPolygonGroups(lat: number, lon: number, groups: [number, number][][][]): boolean {
  for (const group of groups) {
    if (group.length === 0) continue;
    const [outer, ...holes] = group;
    if (!pointInRing(lat, lon, outer)) continue;
    let inHole = false;
    for (const hole of holes) {
      if (pointInRing(lat, lon, hole)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

// Bequeme, donut-bewusste Treffer-Erkennung für eine Zone: nutzt bevorzugt
// polygonGroups (Donut-Löcher) und fällt sonst auf die flache polygonRings-Liste
// zurück (über ringGroupsForZone). Sollte überall verwendet werden, wo Taps auf
// einer Karte Zonen auswerten.
export function pointInZone(lat: number, lon: number, zone: {
  polygonGroups?: [number, number][][][] | null;
  polygonRings?: [number, number][][] | null;
}): boolean {
  return pointInPolygonGroups(lat, lon, ringGroupsForZone(zone));
}

// Liefert die Ringe einer Zone als Polygon-Gruppen ([Außenring, …Löcher]).
// Bevorzugt polygonGroups (erhält Donut-Löcher); fällt sonst auf die flache
// polygonRings-Liste zurück, wobei jeder Ring ein eigenes lochfreies Polygon wird.
// Geeignet für GeozoneFeatureInfo und DipulTempRestriction (native + Leaflet/Web).
export function ringGroupsForZone(z: {
  polygonGroups?: [number, number][][][] | null;
  polygonRings?: [number, number][][] | null;
}): [number, number][][][] {
  if (z.polygonGroups && z.polygonGroups.length > 0) return z.polygonGroups;
  return (z.polygonRings ?? []).map((ring) => [ring]);
}

// dipul-Token-Realm: Nach der Ministeriums-Umbenennung (BMDV -> BMV) hat die
// DFS das anonyme Token-Realm umbenannt; der alte "bmdv"-Endpunkt liefert
// HTTP 500 ("no active token for 'BMDV'"). Realms werden der Reihe nach
// probiert, damit eine erneute Umbenennung nicht wieder alles bricht.
const DIPUL_TOKEN_REALMS = ["bmv", "bmdv"] as const;
const dipulTokenUrl = (realm: string) =>
  `https://uas-betrieb.dfs.de/api/token/v1/anonymous/${realm}/token`;
const DIPUL_GEOAPI_URL = "https://dipul-service.dfs.de/api/geoapi/dipul/v4/affectedAreas";

let cachedToken: { token: string; expiry: number } | null = null;

async function getDipulToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiry) return cachedToken.token;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    let lastError: Error | null = null;
    for (const realm of DIPUL_TOKEN_REALMS) {
      try {
        const resp = await fetch(dipulTokenUrl(realm), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!resp.ok) {
          lastError = new Error(`Token request failed (${realm}: HTTP ${resp.status})`);
          continue;
        }
        const data = await resp.json();
        const token = data.token as string;
        if (!token) {
          lastError = new Error(`Token request returned no token (${realm})`);
          continue;
        }
        const expMs = data.expiration ? new Date(data.expiration).getTime() - 30000 : Date.now() + 240000;
        cachedToken = { token, expiry: expMs };
        return token;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastError ?? new Error("Token request failed");
  } finally {
    clearTimeout(timeout);
  }
}

const LUFT_VO_21H_EXPLANATIONS: Record<string, { explanation: string; category: "military" | "notam" | "nature" | "other" }> = {
  "1": { explanation: "Flugplätze und Flughäfen", category: "other" },
  "2": { explanation: "Kontrollzonen", category: "other" },
  "3": { explanation: "Industrieanlagen, Kraftwerke und JVA", category: "other" },
  "4": { explanation: "Verfassungsorgane, Behörden und Botschaften", category: "other" },
  "5": { explanation: "Bundesfernstraßen, Bundeswasserstraßen und Bahnanlagen", category: "other" },
  "6": { explanation: "Naturschutzgebiete", category: "nature" },
  "7": { explanation: "Wohngrundstücke", category: "other" },
  "8": { explanation: "Menschenansammlungen", category: "other" },
  "9": { explanation: "Einsatzorte von Polizei und Rettungskräften", category: "other" },
  "10": { explanation: "Krankenhäuser", category: "other" },
  "11": { explanation: "Militärische Anlagen und Organisationen", category: "military" },
};

function parse21hNumber(legalRef: string): string | null {
  const m = legalRef.match(/Abs\.\s*3\s*\(?(\d+)/);
  if (m) return m[1];
  const m2 = legalRef.match(/Nr\.\s*(\d+)/);
  if (m2) return m2[1];
  const m3 = legalRef.match(/\((\d+)\.\)/);
  if (m3) return m3[1];
  const m4 = legalRef.match(/\((\d+)\)/);
  if (m4) return m4[1];
  return null;
}

const TYPE_CODE_TO_21H: Record<string, string> = {
  FLUGPLATZ: "1", HUBSCHRAUBERLANDEPLATZ: "1", SEGELFLUGGELAENDE: "1",
  KONTROLLZONE: "2",
  INDUSTRIEANLAGE: "3", KRAFTWERK: "3", JVA: "3",
  VERFASSUNGSORGAN: "4", BOTSCHAFT: "4", POLIZEI: "4", SICHERHEITSBEHOERDE: "4",
  BUNDESFERNSTRASSE: "5", BUNDESWASSERSTRASSE: "5", BAHNANLAGE: "5", BUNDESAUTOBAHN: "5",
  NATURSCHUTZGEBIET: "6", NATIONALPARK: "6", LANDSCHAFTSSCHUTZGEBIET: "6", VOGELSCHUTZGEBIET: "6",
  WOHNGEBIET: "7",
  MENSCHENANSAMMLUNG: "8", FREIBAD: "8",
  FEUERWEHR: "9", KATASTROPHENSCHUTZ: "9", UNFALL: "9",
  KRANKENHAUS: "10",
  MILITAERISCHE_ANLAGE: "11",
};

function classifyLegalRef(legalRef: string, name: string, typeCode?: string): { explanation: string; category: "military" | "notam" | "nature" | "other" } {
  if (legalRef.includes("§ 17") && legalRef.includes("LuftVO")) {
    return { explanation: "Flugbeschränkungsgebiet (militärisch)", category: "military" };
  }
  if (legalRef.includes("§ 21h") && legalRef.includes("LuftVO")) {
    if (legalRef.includes("Abs. 4")) {
      return { explanation: "Erprobungszentrum / Sondergebiet", category: "other" };
    }
    const tcNum = typeCode ? TYPE_CODE_TO_21H[typeCode] || TYPE_CODE_TO_21H[typeCode.toUpperCase()] : null;
    if (tcNum && LUFT_VO_21H_EXPLANATIONS[tcNum]) {
      return LUFT_VO_21H_EXPLANATIONS[tcNum];
    }
    const num = parse21hNumber(legalRef);
    if (num && LUFT_VO_21H_EXPLANATIONS[num]) {
      return LUFT_VO_21H_EXPLANATIONS[num];
    }
    return { explanation: "Geografisches UAS-Gebiet (§ 21h LuftVO)", category: "other" };
  }
  if (legalRef.includes("§ 29") && legalRef.includes("Luftverkehrsgesetz")) {
    return { explanation: "Allg. Beschränkung per NOTAM (LuftVG)", category: "notam" };
  }
  if (legalRef.includes("§ 21a") || legalRef.includes("§ 21b")) {
    return { explanation: "UAS-Betriebsbeschränkung", category: "other" };
  }
  if (name.startsWith("ED-R")) {
    return { explanation: "Restricted Area", category: "military" };
  }
  if (name.toLowerCase().startsWith("notam")) {
    return { explanation: "Temporäre NOTAM-Beschränkung", category: "notam" };
  }
  return { explanation: "Temporäre Betriebseinschränkung", category: "other" };
}

export interface DipulTempRestrictionsResult {
  active: DipulTempRestriction[];
  upcoming: DipulTempRestriction[];
  /** Teil A: aus dem gespeicherten Stand (Gerät offline bzw. Dienst nicht erreichbar). */
  offline?: { fetchedAt: number; cached: boolean };
}

/** Teil A: gespeicherte temporäre DE-Beschränkungen – nur noch gültige, mit Stand. */
function cachedTempRestrictions(data: DipulTempRestrictionsResult, fetchedAt: number): DipulTempRestrictionsResult {
  const now = Date.now();
  const valid = (r: DipulTempRestriction) => r.endTsIndefinite || !r.endTs || new Date(r.endTs).getTime() > now;
  return {
    active: (data.active ?? []).filter(valid),
    upcoming: (data.upcoming ?? []).filter(valid),
    offline: { fetchedAt, cached: true },
  };
}

async function fetchGeoapi(token: string, body: string, signal: AbortSignal): Promise<Response> {
  return fetch(`${DIPUL_GEOAPI_URL}?typeCode=U_NFZ&locale=de`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
  });
}

function parseGeoApiResponse(data: any): DipulTempRestrictionsResult {
  if (!data.affectedAreas || !Array.isArray(data.affectedAreas)) {
    return { active: [], upcoming: [] };
  }

  const now = new Date();
  const active: DipulTempRestriction[] = [];
  const upcoming: DipulTempRestriction[] = [];
  const seen = new Set<string>();

  for (const area of data.affectedAreas) {
    if (area.legalRef === "Test zone on prod") continue;

    const legalRef = area.legalRef || "";
    const areaTypeCode = area.typeCode || "";
    const { explanation, category } = classifyLegalRef(legalRef, "", areaTypeCode);

    const rawName = area.names?.[0] || area.genNames?.[0] || "";
    const name = (!rawName || rawName === "null" || rawName === "undefined")
      ? (explanation || area.typeCode || "Unbekannt")
      : rawName;
    const id = area.extRef || `${area.typeCode}-${name}-${area.startTs || ""}-${area.endTs || ""}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const startDate = area.startTs ? new Date(area.startTs) : null;
    const endDate = area.endTs ? new Date(area.endTs) : null;
    const endYear = endDate ? endDate.getFullYear() : 0;
    const endTsIndefinite = endYear >= 2099;
    const isActive = startDate && endDate ? startDate <= now && (endTsIndefinite || endDate >= now) : true;
    const isFuture = startDate ? startDate > now : false;

    let centerLon: number | null = null;
    let centerLat: number | null = null;
    let areaRadiusM: number | null = null;
    let polygonRings: [number, number][][] | null = null;
    // Gruppierte Ringe ([Außenring, …Löcher] je Polygon) für lochechtes Rendering.
    // polygonRings bleibt die flache Außenring-Liste (Treffer-/Schnitt-Tests).
    let polygonGroups: [number, number][][][] | null = null;
    if (area.geometry) {
      const geo = area.geometry;
      const toLatLng = (c: number[]) => [c[1], c[0]] as [number, number];
      if (geo.type === "Point" && Array.isArray(geo.coordinates)) {
        centerLon = geo.coordinates[0];
        centerLat = geo.coordinates[1];
      } else if (geo.type === "Polygon" && Array.isArray(geo.coordinates) && geo.coordinates[0]) {
        const ring = geo.coordinates[0] as number[][];
        let sumLon = 0, sumLat = 0;
        for (const c of ring) { sumLon += c[0]; sumLat += c[1]; }
        centerLon = sumLon / ring.length;
        centerLat = sumLat / ring.length;
        const outer = ring.map(toLatLng);
        polygonRings = [outer];
        const holes = (geo.coordinates as number[][][]).slice(1)
          .filter((h) => Array.isArray(h) && h.length >= 3)
          .map((h) => h.map(toLatLng));
        polygonGroups = [[outer, ...holes]];
      } else if (geo.type === "MultiPolygon" && Array.isArray(geo.coordinates)) {
        let sumLon = 0, sumLat = 0, count = 0;
        const rings: [number, number][][] = [];
        const groups: [number, number][][][] = [];
        for (const poly of geo.coordinates) {
          if (Array.isArray(poly) && poly[0]) {
            const outerRing = (poly[0] as number[][]).map(toLatLng);
            rings.push(outerRing);
            const holes = (poly as number[][][]).slice(1)
              .filter((h) => Array.isArray(h) && h.length >= 3)
              .map((h) => h.map(toLatLng));
            groups.push([outerRing, ...holes]);
            for (const c of poly[0] as number[][]) { sumLon += c[0]; sumLat += c[1]; count++; }
          }
        }
        if (count > 0) { centerLon = sumLon / count; centerLat = sumLat / count; }
        if (rings.length > 0) polygonRings = rings;
        if (groups.length > 0) polygonGroups = groups;
      }
    }
    if (centerLat == null && area.centerLat != null) centerLat = area.centerLat;
    if (centerLon == null && area.centerLon != null) centerLon = area.centerLon;
    if (area.properties?.subType === "Circle" && area.properties?.radius) {
      areaRadiusM = area.properties.radius;
    }
    if (area.radius) {
      areaRadiusM = area.radius;
    }

    const restriction: DipulTempRestriction = {
      id,
      extRef: area.extRef || "",
      name,
      names: area.names || [],
      genNames: area.genNames || [],
      type: area.typeCode || "U_NFZ",
      legalRef,
      legalExplanation: explanation,
      category,
      lowerAlt: area.lowerAlt ?? 0,
      lowerAltRef: area.lowerAltRef || "AGL",
      lowerAltUnit: area.lowerAltUnit || "m",
      upperAlt: area.upperAlt ?? 0,
      upperAltRef: area.upperAltRef || "AGL",
      upperAltUnit: area.upperAltUnit || "m",
      status: isFuture ? "upcoming" : "active",
      startTs: area.startTs || null,
      endTs: area.endTs || null,
      endTsIndefinite,
      recurRules: area.recurRules && Array.isArray(area.recurRules) ? area.recurRules : null,
      centerLat,
      centerLon,
      radiusM: areaRadiusM,
      polygonRings,
      polygonGroups,
    };

    if (isFuture) {
      upcoming.push(restriction);
    } else if (isActive) {
      active.push(restriction);
    }
  }

  active.sort((a, b) => {
    if (a.endTs && b.endTs) return new Date(a.endTs).getTime() - new Date(b.endTs).getTime();
    return 0;
  });
  upcoming.sort((a, b) => {
    if (a.startTs && b.startTs) return new Date(a.startTs).getTime() - new Date(b.startTs).getTime();
    return 0;
  });

  return { active, upcoming };
}

async function fetchDipulGeoapi(lon: number, lat: number, radiusM: number): Promise<DipulTempRestrictionsResult> {
  // Länder-Nutzung: Deutschland „Aus“ → keine dipul-Abfrage (die Abdeckung meldet „deaktiviert“)
  await awaitCountryUsage();
  if (!isGeozoneSourceEnabled("DE")) return { active: [], upcoming: [] };
  let token = await getDipulToken();

  const body = JSON.stringify({
    type: "Feature",
    properties: {
      subType: "Circle",
      radius: radiusM,
      altitude: { value: 120, altitudeReference: "AGL", unit: "m" },
    },
    geometry: { type: "Point", coordinates: [lon, lat] },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    let resp = await fetchGeoapi(token, body, controller.signal);

    if (resp.status === 401) {
      cachedToken = null;
      token = await getDipulToken();
      resp = await fetchGeoapi(token, body, controller.signal);
    }

    if (!resp.ok) throw new Error(`Geoapi returned ${resp.status}`);
    const data = await resp.json();
    clearTimeout(timeout);
    // Die geoapi liefert nur Sachdaten ohne Geometrie – exakte Flächen aus dem
    // dipul-WFS (temporaere_betriebseinschraenkungen, ED-R-Rückfall) ergänzen.
    return await enrichDipulTempGeometry(parseGeoApiResponse(data), { store: dipulLayerStore });
  } finally {
    clearTimeout(timeout);
  }
}

// Zuletzt erfolgreich geladene dipul-WFS-Layer (ohne Ablauf; Join über extRef,
// abgelaufene Gebiete stören daher nicht). Dient als Rückfall, wenn der
// Kartendienst gerade nicht antwortet, und zum Nachrüsten gespeicherter Listen.
const DIPUL_LAYER_STORE_PREFIX = "dipul_wfs_layer_v1:";
const dipulLayerStore: DipulFeatureStore = {
  async load(layer) {
    try {
      const raw = await AsyncStorage.getItem(DIPUL_LAYER_STORE_PREFIX + layer);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  async save(layer, features) {
    try {
      await AsyncStorage.setItem(DIPUL_LAYER_STORE_PREFIX + layer, JSON.stringify(features));
    } catch {
      // Speicher voll o. Ä. – nur der Offline-Rückfall fehlt dann
    }
  },
};

/**
 * Gespeicherte DE-Listen (auch aus älteren App-Versionen, die noch keine
 * Flächen kannten) mit Geometrie nachrüsten. Wirft nie.
 */
export async function reenrichDipulTempRestrictions<R extends DipulTempRestrictionsResult>(data: R): Promise<R> {
  try {
    return await enrichDipulTempGeometry(data, { store: dipulLayerStore });
  } catch {
    return data;
  }
}

/**
 * Rückfall, wenn die geoapi nicht antwortet: die Liste direkt aus dem
 * WFS-Layer temporaere_betriebseinschraenkungen aufbauen (gleiche extRefs,
 * Namen, Zeiten und Höhen – plus Fläche). Nur mit live geladenem Layer.
 */
async function fetchTempRestrictionsFromWfs(): Promise<DipulTempRestrictionsResult | null> {
  await awaitCountryUsage();
  if (!isGeozoneSourceEnabled("DE")) return null;
  const layer = await loadDipulLayer(DIPUL_TEMP_WFS_LAYER, { store: dipulLayerStore });
  if (layer.source !== "live" && layer.source !== "memory") return null;
  if (layer.features.length === 0) return null;
  const areas = layer.features.map(dipulWfsFeatureToGeoapiArea).filter(Boolean);
  return parseGeoApiResponse({ affectedAreas: areas });
}

function mergeMilLowFlight(
  data: DipulTempRestrictionsResult,
  extra: DipulTempRestriction[]
): DipulTempRestrictionsResult {
  if (extra.length === 0) return data;
  const existingIds = new Set(data.active.map((r) => r.id));
  const merged = [...data.active];
  for (const e of extra) if (!existingIds.has(e.id)) merged.push(e);
  return { active: merged, upcoming: data.upcoming };
}

export async function fetchAllTempRestrictions(): Promise<DipulTempRestrictionsResult> {
  const { getAllMilLowFlightRestrictions } = await import("@/lib/milLowFlight");
  try {
    const data = await fetchDipulGeoapi(10.4515, 51.1657, 600000);
    setCache("dipul_all", data).catch(() => {});
    return mergeMilLowFlight(data, getAllMilLowFlightRestrictions());
  } catch (err) {
    console.warn("[dipul geoapi] nicht erreichbar:", err instanceof Error ? err.message : err);
    const fromWfs = await fetchTempRestrictionsFromWfs().catch(() => null);
    if (fromWfs) {
      setCache("dipul_all", fromWfs).catch(() => {});
      return mergeMilLowFlight(fromWfs, getAllMilLowFlightRestrictions());
    }
    const cached = await getCached<DipulTempRestrictionsResult>("dipul_all");
    if (cached) {
      const data = await reenrichDipulTempRestrictions(cachedTempRestrictions(cached.data, cached.ts));
      return { ...mergeMilLowFlight(data, getAllMilLowFlightRestrictions()), offline: { fetchedAt: cached.ts, cached: true } };
    }
    throw err;
  }
}

export async function fetchNearbyTempRestrictions(lat: number, lon: number, radiusKm: number): Promise<DipulTempRestrictionsResult> {
  const { getNearbyMilLowFlightRestrictions } = await import("@/lib/milLowFlight");
  const radiusM = Math.max(radiusKm * 1000, 5000);
  const ck = makeCacheKey("dipul_nearby", lat, lon);
  const milExtra = getNearbyMilLowFlightRestrictions(lat, lon, Math.max(radiusKm, 5));
  try {
    const data = await fetchDipulGeoapi(lon, lat, radiusM);
    setCache(ck, data).catch(() => {});
    return mergeMilLowFlight(data, milExtra);
  } catch (err) {
    const cached = await getCached<DipulTempRestrictionsResult>(ck);
    if (cached) {
      const data = await reenrichDipulTempRestrictions(cachedTempRestrictions(cached.data, cached.ts));
      return { ...mergeMilLowFlight(data, milExtra), offline: { fetchedAt: cached.ts, cached: true } };
    }
    throw err;
  }
}

/**
 * Same as fetchNearbyTempRestrictions, but without merging the synthetic
 * mil low-flight polygons (which are always synthesised as `active`). Use
 * this when callers need to derive the *real* live activation status of
 * mil low-flight areas via deriveMilLowFlightStatuses /
 * classifyMilLowFlightHits, where the synthetic entries would otherwise
 * be misinterpreted as "currently active".
 */
export async function fetchNearbyTempRestrictionsRaw(lat: number, lon: number, radiusKm: number): Promise<DipulTempRestrictionsResult> {
  const radiusM = Math.max(radiusKm * 1000, 5000);
  const ck = makeCacheKey("dipul_nearby", lat, lon);
  try {
    const data = await fetchDipulGeoapi(lon, lat, radiusM);
    setCache(ck, data).catch(() => {});
    return data;
  } catch (err) {
    const cached = await getCached<DipulTempRestrictionsResult>(ck);
    if (cached) return reenrichDipulTempRestrictions(cachedTempRestrictions(cached.data, cached.ts));
    throw err;
  }
}

export const EDR_LAYER_LABEL = "Flugbeschränkungsgebiete (ED-R)";
// LU_TEMP_ZONE_LABEL ist jetzt in @/lib/geozoneQueries definiert (RN-frei);
// hier re-exportiert, damit bestehende Importe aus diesem Modul (z. B.
// NotamsScreen) unverändert funktionieren.
export { LU_TEMP_ZONE_LABEL };

export function buildDipulLink(name: string): string | null {
  if (!name || name.length < 3) return null;
  if (!name.match(/^ED-R\s/i)) return null;
  const slug = name
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return null;
  return `https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/${slug}/`;
}

export function separateTempRestrictions(zones: GeozoneFeatureInfo[]): {
  geozones: GeozoneFeatureInfo[];
  tempRestrictions: GeozoneFeatureInfo[];
} {
  const geozones: GeozoneFeatureInfo[] = [];
  const tempRestrictions: GeozoneFeatureInfo[] = [];
  const seenNames = new Set<string>();
  for (const z of zones) {
    if (z.layerLabel === TEMP_RESTRICTION_LAYER_LABEL || z.layerLabel === EDR_LAYER_LABEL || z.layerLabel === LU_TEMP_ZONE_LABEL) {
      const normName = z.name.replace(/^ED-R\s*/i, "").trim().toLowerCase();
      if (seenNames.has(normName)) continue;
      seenNames.add(normName);
      tempRestrictions.push(z);
    } else {
      geozones.push(z);
    }
  }
  return { geozones, tempRestrictions };
}

export function getAllDefaultEnabledLayerNames(countryIso?: string): string[] {
  const layers = getCountryGeozoneLayers(countryIso);
  return layers
    .filter((l) => l.defaultEnabled)
    .map((l) => l.wmsLayer);
}

export function getAllLayerNames(countryIso?: string): string[] {
  return getCountryGeozoneLayers(countryIso).map((l) => l.wmsLayer);
}

// Die vier länderspezifischen Live-Geozonen-Abfragen liegen jetzt im RN-freien
// Modul @/lib/geozoneQueries (unter tsx testbar). Hier dünne Wrapper, die die
// jeweilige Länder-Config injizieren, damit die internen Aufrufer unverändert
// bleiben.
async function queryChRestIdentify(
  lat: number,
  lon: number,
  radiusKm: number = 1,
): Promise<GeozoneFeatureInfo[]> {
  return queryChRestIdentifyFrom(COUNTRY_GEOZONE_CONFIGS.CH, lat, lon, radiusKm);
}

async function queryLuOgcFeatures(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<GeozoneFeatureInfo[]> {
  return queryLuOgcFeaturesFrom(lat, lon, radiusKm);
}

async function queryNlWfsFeatures(
  lat: number,
  lon: number,
  radiusKm: number,
  activeWmsLayers?: string[],
): Promise<GeozoneFeatureInfo[]> {
  return queryNlWfsFeaturesFrom(NL_GEOZONE_LAYERS, lat, lon, radiusKm, activeWmsLayers);
}

async function queryFrWmsFeatures(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<GeozoneFeatureInfo[]> {
  return queryFrWmsFeaturesFrom(COUNTRY_GEOZONE_CONFIGS.FR.wmsBaseUrl, lat, lon, radiusKm);
}

// dipul-Ebenen ohne WFS-Veröffentlichung (nur WMS-GetFeatureInfo, nur online).
const DIPUL_WMS_ONLY_LAYERS = ["modellflugplaetze", "haengegleiter"];

export interface DipulGeozoneSourceStatus {
  mode: "vector" | "mixed" | "legacy";
  approximateLayers: string[];
}

async function queryWmsFeatureInfoLayers(
  layers: string[],
  lat: number,
  lon: number,
  radiusKm: number,
  iso: string,
): Promise<GeozoneFeatureInfo[]> {
  if (layers.length === 0) return [];
  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos(degToRad(lat)));
  const dLat = radiusKm * kmToDegLat;
  const dLon = radiusKm * kmToDegLon;
  const sampleOffsets: [number, number][] = [
    [0, 0],
    [0, -1], [0, 1],
    [1, 0], [-1, 0],
    [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
  ];
  const mapSize = 512;
  const bboxLatDelta = dLat * 2.5;
  const bboxLonDelta = dLon * 2.5;
  const batches = await Promise.all(
    sampleOffsets.map(([oLat, oLon]) =>
      queryGeozoneFeatureInfo(
        layers,
        lat + oLat * dLat,
        lon + oLon * dLon,
        mapSize,
        mapSize,
        bboxLatDelta,
        bboxLonDelta,
        iso,
        true,
      ).catch(() => [] as GeozoneFeatureInfo[]),
    ),
  );
  const seen = new Set<string>();
  return batches.flat().filter((zone) => {
    const key = `${zone.layerLabel}|${zone.name}|${zone.details}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function queryDipulGeozones(
  lat: number,
  lon: number,
  radiusKm: number,
  onSourceStatus?: (status: DipulGeozoneSourceStatus) => void,
): Promise<GeozoneFeatureInfo[]> {
  const allLayers = getAllLayerNames("DE");
  try {
    const result = await queryDipulWfsFeaturesFrom("", GEOZONE_LAYERS, lat, lon, radiusKm);
    const vectorLayerNames = allLayers.filter((name) => !result.fallbackLayers.includes(name));
    const allVectorLayersFailed =
      vectorLayerNames.length > 0 && vectorLayerNames.every((name) => result.failedLayers.includes(name));
    const approximateLayerNames = [...new Set([
      ...result.failedLayers,
      ...result.fallbackLayers,
    ])];

    if (allVectorLayersFailed) {
      onSourceStatus?.({ mode: "legacy", approximateLayers: allLayers });
      const legacyZones = await queryWmsFeatureInfoLayers(allLayers, lat, lon, radiusKm, "DE");
      return legacyZones.map((zone) => ({
        ...zone,
        details: `${zone.details}\nGeometrieprüfung derzeit nur näherungsweise.`,
      }));
    }

    const approximatePermanentLayers = approximateLayerNames.filter(
      (name) => name !== "temporaere_betriebseinschraenkungen",
    );
    onSourceStatus?.({
      mode: approximatePermanentLayers.length > 0 ? "mixed" : "vector",
      approximateLayers: approximatePermanentLayers,
    });
    const fallbackZones = await queryWmsFeatureInfoLayers(
      approximateLayerNames,
      lat,
      lon,
      radiusKm,
      "DE",
    );
    const approximateLabels = new Set(
      GEOZONE_LAYERS
        .filter((layer) => approximatePermanentLayers.includes(layer.wmsLayer))
        .map((layer) => layer.label),
    );
    const markedFallbackZones = fallbackZones.map((zone) =>
      approximateLabels.has(zone.layerLabel)
        ? {
            ...zone,
            details: `${zone.details}\nGeometrieprüfung derzeit nur näherungsweise.`,
          }
        : zone,
    );
    return [...result.zones, ...markedFallbackZones];
  } catch (error) {
    if (error instanceof DipulWfsAccessError) throw error;
    console.warn("[Geozones] DIPUL WFS unavailable; using legacy WMS:", (error as Error)?.message);
    onSourceStatus?.({ mode: "legacy", approximateLayers: allLayers });
    const legacyZones = await queryWmsFeatureInfoLayers(allLayers, lat, lon, radiusKm, "DE");
    return legacyZones.map((zone) => ({
      ...zone,
      details: `${zone.details}\nGeometrieprüfung derzeit nur näherungsweise.`,
    }));
  }
}

const LU_SCAN_POINTS: [number, number][] = [
  [49.87, 6.15], [49.60, 6.13], [49.75, 6.35], [49.50, 5.98],
  [49.95, 6.00], [49.70, 5.85], [49.55, 6.35], [49.80, 5.95],
  [49.65, 6.30], [49.90, 6.30], [49.50, 6.15], [49.75, 6.00],
];

// Die LU-NOTAM-Aufbereitung (isLuZonePermanent, buildLuNotamFromWms,
// fetchLuTsaAsNotams) liegt jetzt im RN-freien Modul @/lib/geozoneQueries
// (unter tsx testbar). fetchLuTsaAsNotams wird hier unverändert re-exportiert;
// fetchAllLuZonesAsNotams ist ein dünner Wrapper, der Cache + Scan-Punkte
// injiziert.
export { fetchLuTsaAsNotams };

export function fetchAllLuZonesAsNotams() {
  // GeoJSON-Pfad: liefert dieselben temporären Zonen wie der Text-Pfad, zusätzlich
  // mit reprojizierter Geometrie, damit die Karte exakt die gelisteten Zonen
  // zeichnen kann (statt eines vollflächigen WMS-Overlays).
  return fetchAllLuZonesWithGeometryFrom(LU_SCAN_POINTS, { setCache, getCached });
}

/**
 * Bestimmt aus einem Viewport (Mittelpunkt + optionaler Ausdehnung) alle Länder
 * mit Geozone-Konfiguration (DE/CH/LU/NL/FR), deren Gebiet im sichtbaren Bereich
 * liegt — damit an einer Grenze BEIDE (bzw. alle sichtbaren) Länder ihr
 * WMS-Overlay laden und nicht nur das Mittelland.
 *
 * - Mit Ausdehnung (latDelta/lonDelta > 0): ein Raster (5x5) über den tatsächlich
 *   sichtbaren Bereich wird abgetastet; jedes dort gefundene unterstützte Land
 *   kommt in die Liste (Mittelland zuerst). Begrenzt auf `maxCountries`
 *   (Default 4), um nicht zu viele Overlays gleichzeitig zu mounten.
 * - Ohne Ausdehnung (Default 0): altes Verhalten — Mittelland plus ggf. EIN
 *   Nachbar, wenn die Mitte < `borderKm` (Default 20 km) von einer Grenze
 *   entfernt liegt (z. B. off-shore an der DE-Nordseeküste).
 *
 * Die Liste sollte aus einer SETTLED Region (Gestenende) berechnet werden, nicht
 * aus der laufenden Pan-Region — sonst würden die pro-Land gekeyten UrlTiles
 * mitten in der Geste neu mounten (iOS/MapKit-Crash).
 */
export function getViewportCountries(
  lat: number,
  lon: number,
  latDelta: number = 0,
  lonDelta: number = 0,
  borderKm: number = 20,
  maxCountries: number = 4,
): string[] {
  return getViewportCountriesFrom(
    Object.keys(COUNTRY_GEOZONE_CONFIGS),
    lat,
    lon,
    latDelta,
    lonDelta,
    borderKm,
    maxCountries,
  );
}

export function getCountriesInRadius(lat: number, lon: number, radiusKm: number, primaryIso?: string): string[] {
  return getCountriesInRadiusFrom(Object.keys(COUNTRY_GEOZONE_CONFIGS), lat, lon, radiusKm, primaryIso);
}

export const DE_WOHN_OFFLINE_MISSING_NOTE = "Wohngrundstücke offline nicht gespeichert – nicht geprüft";
export const DE_WOHN_LIVE_FAILED_NOTE = "Wohngrundstücke konnten nicht live geladen werden – nicht geprüft";

/**
 * DE-Kachelpaket ohne "wohn"-Teil, Gerät online: Wohngrundstücke live über den
 * DIPUL-WFS ergänzen. Schlägt das fehl, wird die DE-Abdeckung als "partial"
 * gemeldet (nie still "keine Wohngrundstücke").
 */
async function queryDipulWohnLive(
  lat: number,
  lon: number,
  radiusKm: number,
  report?: (s: { status: GeozoneSourceStatus; note?: string }) => void,
): Promise<GeozoneFeatureInfo[]> {
  const wohnLayers = GEOZONE_LAYERS.filter((l) => l.wmsLayer === DIPUL_WOHN_LAYER);
  try {
    const r = await queryDipulWfsFeaturesFrom("", wohnLayers, lat, lon, radiusKm);
    if (r.failedLayers.includes(DIPUL_WOHN_LAYER)) report?.({ status: "partial", note: DE_WOHN_LIVE_FAILED_NOTE });
    return r.zones;
  } catch {
    report?.({ status: "partial", note: DE_WOHN_LIVE_FAILED_NOTE });
    return [];
  }
}

async function queryGeozonesForCountry(
  lat: number,
  lon: number,
  radiusKm: number,
  iso: string,
  onDipulSourceStatus?: (status: DipulGeozoneSourceStatus) => void,
  // Abdeckungs-Information (Review-Fix 4): meldet missing/error/unsupported/
  // stale. Ohne Meldung gilt die Quelle als "ok" (bzw. "error", wenn die
  // Funktion wirft).
  report?: (s: { status: GeozoneSourceStatus; fetchedAt?: number; note?: string; truncated?: boolean }) => void,
): Promise<GeozoneFeatureInfo[]> {
  const config = getCountryGeozoneConfig(iso);
  const ed269 = (vIso: string) =>
    queryEd269CachedFeaturesWithStatus(lat, lon, radiusKm, vIso, GEOZONE_VECTOR_MAX_FEATURES).then((r) => {
      report?.(r);
      return r.zones;
    });

  // Offline-Kachelspeicher (DE/FR/CZ) hat Vorrang – auch online.
  if (hasTiledGeozones(config.iso)) {
    const tiled = await queryTiledGeozones(config.iso, bboxAround(lat, lon, radiusKm));
    if (tiled) {
      if (config.iso === "ES") {
        // abwählbare Teile (Infrastruktur/Naturschutz) online ergänzen bzw. offline melden
        const r = await esSupplementMissingParts({ zones: tiled, ...storedDataReport("ES") }, bboxAround(lat, lon, radiusKm));
        report?.(r);
        return r.zones;
      }
      // Datenalter des Pakets (Registry-Policy: ab 28 Tagen "stale" → CAUTION)
      report?.(storedDataReport(config.iso));
      if (config.iso !== "DE") return tiled;
      // Modellflugplätze/Hängegleiter gibt es nicht im dipul-WFS: online per WMS ergänzen
      onDipulSourceStatus?.({ mode: "vector", approximateLayers: [] });
      // Wohngrundstücke sind ein abwählbarer Paket-Teil ("wohn"). Fehlt er,
      // wurden sie bisher NIE geprüft — auch online nicht (Review-Fix 6).
      const hasWohnPart = getTilePartMeta("DE", "wohn")?.complete === true;
      if (isOfflineNow()) {
        if (!hasWohnPart) report?.({ status: "partial", note: DE_WOHN_OFFLINE_MISSING_NOTE });
        return tiled;
      }
      const [extra, wohn] = await Promise.all([
        queryWmsFeatureInfoLayers(DIPUL_WMS_ONLY_LAYERS, lat, lon, radiusKm, "DE").catch(() => []),
        hasWohnPart ? Promise.resolve([] as GeozoneFeatureInfo[]) : queryDipulWohnLive(lat, lon, radiusKm, report),
      ]);
      return [...tiled, ...extra, ...wohn];
    }
  }

  if (config.iso === "DE") {
    // Teil A: Land ohne Offline-Paket → online direkt (dipul-WFS) und das
    // Ergebnis je Standort zwischenspeichern; offline der gespeicherte Stand
    // (mit Alter), sonst Abdeckungslücke statt „keine Zonen“.
    // Schlüssel mit Länder-Präfix (Länder-Nutzung „Aus“ löscht je Land)
    const key = `DE_${offlineLocationKey(lat, lon)}_${Math.round(radiusKm * 10)}`;
    if (isOfflineNow()) {
      const stored = await getOfflineResult<GeozoneFeatureInfo[]>("geozones-live", key).catch(() => null);
      if (stored && Array.isArray(stored.data)) {
        const st = storedCoverageStatus("DE", stored.fetchedAt, stored.fetchedAt);
        report?.({ status: st.status, fetchedAt: stored.fetchedAt, ...(st.note ? { note: st.note } : {}) });
        return stored.data;
      }
      report?.({ status: "missing", note: "Gerät offline – kein Offline-Paket und kein gespeicherter Stand" });
      return [];
    }
    // Längere Live-Abfragen erscheinen in der Download-Anzeige (kurze < 1 s nicht)
    const zones = await trackDownload(
      { id: "de-live", iso: "DE", labelDe: "Geozonen für den Bereich", kind: "live" },
      () => queryDipulGeozones(lat, lon, radiusKm, onDipulSourceStatus),
    );
    putOfflineResult("geozones-live", key, zones).catch(() => {});
    return zones;
  }

  // CZ: Zonen nur aus dem Geozonen-Paket (bei aktivem Land automatisch geladen) -> bis dahin keine automatische Prüfung.
  if (config.featureInfoType === "tiles") {
    report?.({ status: "missing", note: "Geozonen-Paket noch nicht geladen (wird bei aktivem Land automatisch geladen, große Pakete im WLAN)" });
    return [];
  }

  if (config.iso === "CH") {
    // BAZL-Vektorzonen plus Zusatz-Ebenen (Ruhezonen, Wohngebiete) per REST
    const [vector, extra] = await Promise.all([
      ed269("CH").catch(() => { report?.({ status: "error" }); return [] as GeozoneFeatureInfo[]; }),
      queryChRestIdentify(lat, lon, radiusKm).catch(() => []),
    ]);
    return [...vector, ...extra];
  }

  if (config.iso === "LU") {
    // Vektor-Bestand; ohne Bestand greift der Live-OGC-Rückfall (wirft bei Fehler).
    const r = await queryEd269CachedFeaturesWithStatus(lat, lon, radiusKm, "LU", GEOZONE_VECTOR_MAX_FEATURES)
      .catch(() => ({ zones: [] as GeozoneFeatureInfo[], status: "error" as const }));
    if (r.zones.length > 0) {
      report?.(r);
      return r.zones;
    }
    return queryLuOgcFeatures(lat, lon, radiusKm);
  }

  if (config.iso === "NL") {
    // GoDrone-Vektorzonen plus Natur-Ebenen (Natura 2000 / NNN) aus PDOK
    const nlWmsLayers = config.layers.filter((l) => l.defaultEnabled).map((l) => l.wmsLayer);
    const [vector, nature] = await Promise.all([
      ed269(iso).catch(() => { report?.({ status: "error" }); return [] as GeozoneFeatureInfo[]; }),
      queryNlWfsFeatures(lat, lon, radiusKm, nlWmsLayers).catch(() => []),
    ]);
    return [...vector, ...nature];
  }

  if (config.featureInfoType === "wms-fr" && config.iso === "FR") {
    return queryFrWmsFeatures(lat, lon, radiusKm);
  }

  // Reine Bild-Overlays (z. B. HU): keine abfragbaren Zonen -> keine automatische Prüfung.
  if (config.featureInfoType === "none") {
    report?.({ status: "unsupported", note: "keine automatische Zonenabfrage" });
    return [];
  }

  if (config.featureInfoType === "ed269-cached") {
    // Planungs-/PDF-Pfad: der volle (Planungs-)Radius bleibt erhalten, aber die
    // Antwort wird serverseitig auf die dem Zentrum nächstgelegenen Zonen
    // gedeckelt (GEOZONE_VECTOR_MAX_FEATURES). Bei realistischen Planungsradien
    // (wenige km) liegt die Trefferzahl weit darunter -> keine Fidelity-Einbuße;
    // ein weiter Radius in einem dichten Land (z. B. Großraum Kopenhagen) kann
    // so aber nicht mehr eine landesweite Massenantwort ziehen, die in den
    // 12-s-Client-Abort läuft und die Zonen still verschwinden lässt.
    return ed269(iso);
  }

  const layers = getAllLayerNames(iso);
  if (layers.length === 0) {
    report?.({ status: "unsupported", note: "keine abfragbaren Ebenen" });
    return [];
  }

  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos(degToRad(lat)));
  const dLat = radiusKm * kmToDegLat;
  const dLon = radiusKm * kmToDegLon;

  const sampleOffsets: [number, number][] = [
    [0, 0],
    [0, -1], [0, 1],
    [1, 0], [-1, 0],
    [0.7, 0.7], [-0.7, 0.7],
    [0.7, -0.7], [-0.7, -0.7],
  ];

  const mapSize = 512;
  const bboxLatDelta = dLat * 2.5;
  const bboxLonDelta = dLon * 2.5;

  let failedSamples = 0;
  const results = await Promise.all(
    sampleOffsets.map(([oLat, oLon]) => {
      const sLat = lat + oLat * dLat;
      const sLon = lon + oLon * dLon;
      return queryGeozoneFeatureInfo(
        layers, sLat, sLon,
        mapSize, mapSize,
        bboxLatDelta, bboxLonDelta,
        iso,
      ).catch(() => {
        failedSamples++;
        return [] as GeozoneFeatureInfo[];
      });
    })
  );
  // Alle Abtastpunkte fehlgeschlagen -> Quelle nicht erreichbar (nicht "keine Zonen").
  if (failedSamples === sampleOffsets.length) report?.({ status: "error", note: "Abfrage fehlgeschlagen" });

  const seen = new Set<string>();
  const unique: GeozoneFeatureInfo[] = [];
  for (const batch of results) {
    if (!batch) continue;
    for (const z of batch) {
      const key = `${z.layerLabel}|${z.name}|${z.details}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(z);
    }
  }
  return unique;
}

export async function queryGeozonesInArea(
  lat: number,
  lon: number,
  radiusKm: number,
  countryIso?: string,
  onDipulSourceStatus?: (status: DipulGeozoneSourceStatus) => void,
): Promise<GeozoneFeatureInfo[]> {
  const r = await queryGeozonesInAreaWithCoverage(lat, lon, radiusKm, countryIso, onDipulSourceStatus);
  return r.zones;
}

/**
 * Wie queryGeozonesInArea, liefert aber zusätzlich, für welche Länder die
 * Abfrage tatsächlich Daten hatte (Review-Fix 4). Ein Abruffehler, ein
 * fehlender Datensatz (z. B. CZ ohne Offline-Paket, IT ohne d-flight-Login,
 * GR ohne Import) oder ein Land ohne automatische Prüfung (HU) erscheint als
 * Quelle mit status missing/error/unsupported und senkt `coverage` auf
 * "partial"/"unavailable" — statt still als "keine Zonen" (grün) zu gelten.
 */
export async function queryGeozonesInAreaWithCoverage(
  lat: number,
  lon: number,
  radiusKm: number,
  countryIso?: string,
  onDipulSourceStatus?: (status: DipulGeozoneSourceStatus) => void,
): Promise<GeozoneAreaResult> {
  const countries = getCountriesInRadius(lat, lon, radiusKm, countryIso);
  if (countries.length === 0) {
    // Standort außerhalb aller unterstützten Länder: keine automatische Prüfung.
    const iso = (countryIso || "").toUpperCase();
    const sources: GeozoneSourceCoverage[] = iso ? [{ iso, status: "unsupported" }] : [];
    return { zones: [], coverage: "unavailable", sources };
  }
  const primary = countries[0];
  const neighbors = countries.slice(1);
  const sources = new Map<string, GeozoneSourceCoverage>();
  const reporterFor = (iso: string) => (s: { status: GeozoneSourceStatus; fetchedAt?: number; note?: string; truncated?: boolean }) => {
    const prev = sources.get(iso) ?? { iso, status: "ok" as GeozoneSourceStatus };
    const status = worseSourceStatus(prev.status, s.status);
    const truncated = prev.truncated || s.truncated;
    sources.set(iso, {
      iso,
      status,
      fetchedAt: s.fetchedAt ?? prev.fetchedAt,
      note: status === s.status ? (s.note ?? prev.note) : prev.note,
      ...(truncated ? { truncated: true } : {}),
    });
  };
  for (const iso of countries) sources.set(iso, { iso, status: "ok" });
  // Länder-Nutzung „Aus“ (auch Nachbarländer im Umkreis): nicht abfragen,
  // Abdeckungslücke „deaktiviert“ (≥ CAUTION, Aktion „Land aktivieren“).
  await awaitCountryUsage();
  const disabled = new Set(countries.filter((iso) => !isGeozoneSourceEnabled(iso)));
  for (const iso of disabled) sources.set(iso, disabledSourceCoverage(iso));

  // Nicht-deutsche Zonen ohne country-Feld mit dem abgefragten Land taggen,
  // damit länderspezifische Regeln (§ 21h/AV, siehe de21hRule) sie sicher
  // zuordnen. Deutsche Zonen bleiben unverändert (historisch ohne Feld).
  const tag = (iso: string, zones: GeozoneFeatureInfo[]) =>
    iso === "DE" ? zones : zones.map((z) => (z.country ? z : { ...z, country: iso }));

  const NEIGHBOR_TIMEOUT = Symbol("timeout");
  const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | typeof NEIGHBOR_TIMEOUT> =>
    Promise.race([promise, new Promise<typeof NEIGHBOR_TIMEOUT>((resolve) => setTimeout(() => resolve(NEIGHBOR_TIMEOUT), ms))]);

  const primaryResult = disabled.has(primary) ? [] : tag(primary, await queryGeozonesForCountry(lat, lon, radiusKm, primary, onDipulSourceStatus, reporterFor(primary)).catch((e) => {
    if (e instanceof DipulWfsAccessError) throw e;
    console.warn(`[Geozones] Primary query failed for ${primary}:`, e?.message || e);
    reporterFor(primary)({ status: "error", note: String(e?.message || e) });
    return [] as GeozoneFeatureInfo[];
  }));

  let neighborResults: GeozoneFeatureInfo[] = [];
  const activeNeighbors = neighbors.filter((iso) => !disabled.has(iso));
  if (activeNeighbors.length > 0) {
    const settled = await Promise.allSettled(
      activeNeighbors.map(async (iso) => {
        const res = await withTimeout(
          queryGeozonesForCountry(lat, lon, radiusKm, iso, onDipulSourceStatus, reporterFor(iso)).catch((e) => {
            console.warn(`[Geozones] Neighbor query failed for ${iso}:`, e?.message || e);
            reporterFor(iso)({ status: "error", note: String(e?.message || e) });
            return [] as GeozoneFeatureInfo[];
          }),
          8000,
        );
        if (res === NEIGHBOR_TIMEOUT) {
          reporterFor(iso)({ status: "error", note: "Zeitüberschreitung" });
          return [] as GeozoneFeatureInfo[];
        }
        return tag(iso, res);
      }),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") neighborResults.push(...s.value);
    }
  }

  const sourceList = countries.map((iso) => sources.get(iso)!);
  return {
    zones: filterAndGroupAreaZones([...primaryResult, ...neighborResults], lat, lon, radiusKm),
    coverage: summarizeGeozoneCoverage(sourceList),
    sources: sourceList,
  };
}

function filterAndGroupAreaZones(
  all: GeozoneFeatureInfo[],
  lat: number,
  lon: number,
  radiusKm: number,
): GeozoneFeatureInfo[] {
  const seen = new Set<string>();
  const unique: GeozoneFeatureInfo[] = [];
  const radiusM = radiusKm * 1000;
  for (const z of all) {
    const key = `${z.layerLabel}|${z.name}|${z.details}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Strikter Geometrie-Filter: nur Zonen behalten, deren Polygon den
    // blauen Umkreis tatsächlich berührt/schneidet. Zonen ohne Polygon-
    // Geometrie (z. B. WMS-Endpoints, die nur Properties liefern) werden
    // konservativ beibehalten — der Sampling-Punkt lag dann in der Zone.
    if (z.polygonGroups && z.polygonGroups.length > 0) {
      if (!polygonGroupsIntersectCircle(z.polygonGroups, lat, lon, radiusM)) continue;
    } else if (z.polygonRings && z.polygonRings.length > 0) {
      if (!polygonRingsIntersectCircle(z.polygonRings, lat, lon, radiusM)) continue;
    }
    unique.push(z);
  }
  // Konzentrische DK-Pufferringe derselben Anlage zu einem Listeneintrag
  // zusammenfassen (Karte zeichnet die Ringe separat über queryEd269CachedFeatures).
  return groupDanishBufferRings(unique);
}

export async function queryGeozoneFeatureInfo(
  layers: string[],
  lat: number,
  lon: number,
  mapWidth: number,
  mapHeight: number,
  latDelta: number,
  lonDelta: number,
  countryIso?: string,
  // intern: Kachelspeicher überspringen (DE-WMS-Ergänzung)
  skipTiles?: boolean,
): Promise<GeozoneFeatureInfo[]> {
  const config = getCountryGeozoneConfig(countryIso);
  // Länder-Nutzung „Aus“: keine Abfrage am Tipp-Punkt
  if (!isGeozoneSourceEnabled(config.iso)) return [];

  // Offline-Kachelspeicher (DE/FR/CZ): Zonen am Tipp-Punkt lokal bestimmen.
  if (!skipTiles && hasTiledGeozones(config.iso)) {
    const deLayers = config.iso === "DE" ? layers : undefined;
    const tiled = await queryTiledGeozonesAtPoint(config.iso, lat, lon, { layers: deLayers });
    if (tiled) {
      if (config.iso !== "DE" || isOfflineNow()) return tiled;
      // Paket ohne "wohn"-Teil: Wohngrundstücke am Tipp-Punkt live (dipul-WMS)
      // ergänzen, statt sie stillschweigend wegzulassen (Review-Fix 6).
      const liveExtra = getTilePartMeta("DE", "wohn")?.complete === true
        ? DIPUL_WMS_ONLY_LAYERS
        : [...DIPUL_WMS_ONLY_LAYERS, DIPUL_WOHN_LAYER];
      const wmsOnly = liveExtra.filter((l) => layers.includes(l));
      if (wmsOnly.length === 0) return tiled;
      const extra = await queryGeozoneFeatureInfo(wmsOnly, lat, lon, mapWidth, mapHeight, latDelta, lonDelta, "DE", true).catch(() => []);
      return [...tiled, ...extra];
    }
  }
  if (config.featureInfoType === "tiles") return [];

  if (config.iso === "CH") {
    // Zusatz-Ebenen (Ruhezonen, Wohngebiete); die BAZL-Zonen sind Vektoren mit eigenem Popup.
    const radiusKmCh = Math.max(latDelta * 111.32, lonDelta * 111.32 * Math.cos(degToRad(lat))) / 2;
    return queryChRestIdentify(lat, lon, radiusKmCh);
  }

  if (config.featureInfoType === "ogc-features" && config.iso === "LU") {
    const radiusKm = Math.max(latDelta * 111.32, lonDelta * 111.32 * Math.cos(degToRad(lat))) / 2;
    return queryLuOgcFeatures(lat, lon, Math.max(radiusKm, 0.5));
  }

  if (config.iso === "NL") {
    // Natur-Ebenen (PDOK); die GoDrone-Zonen sind Vektoren mit eigenem Popup.
    const radiusKm = Math.max(latDelta * 111.32, lonDelta * 111.32 * Math.cos(degToRad(lat))) / 2;
    return queryNlWfsFeatures(lat, lon, Math.max(radiusKm, 0.5), layers);
  }

  if (config.featureInfoType === "wms-fr" && config.iso === "FR") {
    const radiusKm = Math.max(latDelta * 111.32, lonDelta * 111.32 * Math.cos(degToRad(lat))) / 2;
    return queryFrWmsFeatures(lat, lon, Math.max(radiusKm, 0.5));
  }

  if (config.featureInfoType === "none") return [];

  if (layers.length === 0) return [];

  const west = lon - lonDelta / 2;
  const east = lon + lonDelta / 2;
  const south = lat - latDelta / 2;
  const north = lat + latDelta / 2;

  const bboxMinX = lonToMercX(west);
  const bboxMinY = latToMercY(south);
  const bboxMaxX = lonToMercX(east);
  const bboxMaxY = latToMercY(north);

  const tapMercX = lonToMercX(lon);
  const tapMercY = latToMercY(lat);

  const pixelX = Math.round(((tapMercX - bboxMinX) / (bboxMaxX - bboxMinX)) * mapWidth);
  const pixelY = Math.round(((bboxMaxY - tapMercY) / (bboxMaxY - bboxMinY)) * mapHeight);

  const layerStr = layers.join(",");
  const bbox = `${bboxMinX},${bboxMinY},${bboxMaxX},${bboxMaxY}`;

  const crsParam = config.wmsVersion === "1.3.0" ? "CRS" : "srs";
  const url = `${config.wmsBaseUrl}?SERVICE=WMS&VERSION=${config.wmsVersion}&REQUEST=GetFeatureInfo`
    + `&LAYERS=${layerStr}&QUERY_LAYERS=${layerStr}`
    + `&${crsParam}=EPSG:3857&BBOX=${bbox}`
    + `&WIDTH=${mapWidth}&HEIGHT=${mapHeight}`
    + `&X=${pixelX}&Y=${pixelY}`
    + `&INFO_FORMAT=text/plain`
    + `&FEATURE_COUNT=20`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const layerLookup: Record<string, string> = {};
  for (const l of config.layers) {
    layerLookup[l.wmsLayer] = l.label;
  }

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return [];
    const text = await resp.text();

    if (!text || text.trim() === "no features were found") return [];

    return parsePlainTextFeatureInfo(text, layerLookup);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

const TYPE_CODE_LABELS: Record<string, string> = {
  MILITAERISCHE_ANLAGE: "Militärische Anlage oder Organisation",
  SICHERHEITSBEHOERDE: "Andere Sicherheitsbehörde",
  KRANKENHAUS: "Krankenhaus",
  INDUSTRIEANLAGE: "Industrieanlage",
  KRAFTWERK: "Kraftwerk",
  JVA: "Justizvollzugsanstalt",
  NATURSCHUTZGEBIET: "Naturschutzgebiet",
  NATIONALPARK: "Nationalpark",
  LANDSCHAFTSSCHUTZGEBIET: "Landschaftsschutzgebiet",
  VOGELSCHUTZGEBIET: "Vogelschutzgebiet",
  WOHNGEBIET: "Wohngebiet",
  MENSCHENANSAMMLUNG: "Menschenansammlung",
  FLUGPLATZ: "Flugplatz",
  HUBSCHRAUBERLANDEPLATZ: "Hubschrauberlandeplatz",
  SEGELFLUGGELAENDE: "Segelfluggelände",
  KONTROLLZONE: "Kontrollzone",
  FLUGBESCHRAENKUNGSGEBIET: "Flugbeschränkungsgebiet",
  ED_R: "Flugbeschränkungsgebiet (ED-R)",
  BUNDESFERNSTRASSE: "Bundesfernstraße",
  BUNDESWASSERSTRASSE: "Bundeswasserstraße",
  BAHNANLAGE: "Bahnanlage",
  BUNDESAUTOBAHN: "Bundesautobahn",
  BOTSCHAFT: "Botschaft / Konsulat",
  VERFASSUNGSORGAN: "Verfassungsorgan",
  POLIZEI: "Polizeidienststelle",
  FEUERWEHR: "Feuerwehr",
  KATASTROPHENSCHUTZ: "Katastrophenschutz",
  UNFALL: "Unfallstelle / Einsatzstelle",
};

function humanizeTypeCode(typeCode: string): string {
  const label = TYPE_CODE_LABELS[typeCode] || TYPE_CODE_LABELS[typeCode.toUpperCase()];
  if (label) return label;
  return typeCode
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/oe/g, "ö")
    .replace(/ue/g, "ü")
    .replace(/ae/g, "ä")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const DIPUL_WMS_LAYER_KEYS = new Set(GEOZONE_LAYERS.map((l) => l.wmsLayer));

function parsePlainTextFeatureInfo(text: string, layerLookup: Record<string, string>): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  const blocks = text.split(/Results for FeatureType '([^']+)':/);

  for (let i = 1; i < blocks.length; i += 2) {
    const rawFeatureType = blocks[i];
    const content = blocks[i + 1] || "";

    const layerKey = rawFeatureType.replace(/^[^:]+:/, "");
    const layerLabel = layerLookup[layerKey] || layerKey;

    const featureSections = content.split(/^-{4,}$/m).filter((s) => s.trim().length > 0);

    for (const section of featureSections) {
      const props: Record<string, string> = {};
      const lines = section.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const eqIdx = line.indexOf(" = ");
        if (eqIdx > 0) {
          const key = line.substring(0, eqIdx).trim();
          const val = line.substring(eqIdx + 3).trim();
          if (key && val && key !== "geom" && !val.startsWith("[GEOMETRY")) {
            props[key] = val;
          }
        }
      }

      if (Object.keys(props).length === 0) continue;

      const isNull = (v: string | undefined) => !v || v === "null" || v.trim() === "";
      let name = !isNull(props.name) ? props.name! : !isNull(props.bezeichnung) ? props.bezeichnung! : !isNull(props.NAME) ? props.NAME! : !isNull(props.BEZEICHNUNG) ? props.BEZEICHNUNG! : "";
      if (!name) {
        const tc = props.type_code || props.TYPE_CODE || "";
        if (tc) name = humanizeTypeCode(tc);
      }
      if (!name) {
        const legalRef = props.legal_ref || props.LEGAL_REF || props.rechtsgrundlage || "";
        if (legalRef) {
          const tc2 = props.type_code || props.TYPE_CODE || "";
          const classified = classifyLegalRef(legalRef, "", tc2);
          if (classified.explanation) name = classified.explanation;
        }
      }
      if (!name) name = layerLabel;

      const DETAIL_KEY_LABELS: Record<string, string> = {
        name: "Name", bezeichnung: "Bezeichnung",
        type_code: "Typ", legal_ref: "Rechtshinweis",
        lower_limit_altitude: "Untere Grenze", upper_limit_altitude: "Obere Grenze",
        lower_limit_alt_ref: "Untere Grenze Ref", upper_limit_alt_ref: "Obere Grenze Ref",
        lower_limit_unit: "Einheit (unten)", upper_limit_unit: "Einheit (oben)",
        external_reference: "Identifikation",
      };
      const detailParts: string[] = [];
      for (const [key, val] of Object.entries(props)) {
        if (val === "null") continue;
        const lk = key.toLowerCase();
        if (lk === "name" || lk === "bezeichnung") continue;
        let displayVal = val;
        if (lk === "type_code") displayVal = humanizeTypeCode(val);
        if (lk === "legal_ref" || lk === "rechtsgrundlage") {
          const tc = props.type_code || props.TYPE_CODE || "";
          const classified = classifyLegalRef(val, "", tc);
          if (classified.explanation) displayVal = `${val} – ${classified.explanation}`;
        }
        const displayKey = DETAIL_KEY_LABELS[lk] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        detailParts.push(`${displayKey}: ${displayVal}`);
      }

      const details = detailParts.join("\n");
      results.push({
        layerLabel,
        name,
        details,
        featureId: props.uuid || props.UUID || props.external_reference || props.id || undefined,
        // dipul-Layer: Einstufung aus dem Layer; andere WMS: Text-Rückfall.
        restriction: DIPUL_WMS_LAYER_KEYS.has(layerKey)
          ? deRestrictionForLayer(layerKey, `${name}\n${details}`)
          : restrictionFromText(`${name}\n${details}`),
      });
    }
  }

  return results;
}
