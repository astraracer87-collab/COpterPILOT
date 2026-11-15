// WMS-/XYZ-Konfigurationen der Geozonen-Länder mit Kachel-Overlay (DE, CH,
// LU, NL, FR, HU) – unverändert aus client/lib/geozones.ts hierher verschoben,
// damit die Quellen-Registry (registry.ts) sie ohne React-Native-Importe
// referenzieren kann. COUNTRY_GEOZONE_CONFIGS (geozones.ts) wird aus der
// Registry gebaut: diese Einträge für WMS-Länder, eine Standard-Vektor-
// Konfiguration für alle übrigen Quellen.
import {
  GEOZONE_LAYERS,
  CH_GEOZONE_LAYERS,
  LU_GEOZONE_LAYERS,
  NL_GEOZONE_LAYERS,
  FR_GEOZONE_LAYERS,
  HU_GEOZONE_LAYERS,
  type GeozoneLayer,
} from "../../../shared/geozoneLayerCatalog";
import { COUNTRY_WMS_MAX_NATIVE_ZOOM } from "../geozoneZoom";

export type CountryIsoWithGeozones = "DE" | "CH" | "LU" | "NL" | "FR" | "AT" | "BE" | "DK" | "EE" | "FI" | "NO" | "SE" | "IE" | "PT" | "ES" | "PL" | "LT" | "IT" | "GB" | "IS" | "CY" | "HR" | "SI" | "HU" | "BG" | "LV" | "CZ" | "SK" | "RO";

export interface CountryGeozoneConfig {
  iso: CountryIsoWithGeozones;
  wmsBaseUrl: string;
  wmsVersion: string;
  layers: GeozoneLayer[];
  // "tiles": nur Offline-Kachelspeicher (geozoneTiles/, z. B. CZ ED-318)
  featureInfoType: "wms-plain" | "rest-json" | "ogc-features" | "wfs-json" | "wms-fr" | "ed269-cached" | "tiles" | "none";
  restIdentifyUrl?: string;
  restIdentifyLayers?: string[];
  alwaysVisibleLayerIds: string[];
  forceEnabledLayerIds: string[];
  // Höchste Zoomstufe, die der WMS-Server tatsächlich rendert. Wird als
  // `maximumNativeZ` an `WMSTile` übergeben, damit die Karte beim weiteren
  // Hineinzoomen die letzte echte Kachel hochskaliert, statt leere Kacheln
  // nachzuladen. Web-Mercator-Scale pro Zoom (256px): 559082264 / 2^z.
  // Beispiel FR (DGAC `TRANSPORTS.DRONES.RESTRICTIONS`): MinScaleDenominator
  // 17061.84. WMS-Scale z15 = 17062.4 (>= Grenze -> rendert noch), z16 = 8531
  // (< Grenze -> flächig leer). Empirisch bestätigt; letzte zuverlässig
  // gerenderte Stufe ist daher Zoom 15. Der konkrete Wert kommt aus dem
  // geteilten Modul (COUNTRY_WMS_MAX_NATIVE_ZOOM), siehe geozoneZoom.ts.
  wmsMaxNativeZoom?: number;
}

export const WMS_GEOZONE_CONFIGS = {
  DE: {
    iso: "DE",
    wmsBaseUrl: "https://uas-betrieb.de/geoservices/dipul/wms",
    wmsVersion: "1.1.1",
    layers: GEOZONE_LAYERS,
    featureInfoType: "wms-plain",
    alwaysVisibleLayerIds: ["kontrollzonen", "flugbeschraenkungsgebiete", "temporaere_betriebseinschraenkungen", "flughaefen", "flugplaetze"],
    forceEnabledLayerIds: ["flugplaetze"],
  },
  CH: {
    iso: "CH",
    wmsBaseUrl: "https://wms.geo.admin.ch/",
    wmsVersion: "1.3.0",
    layers: CH_GEOZONE_LAYERS,
    // Drohnen-Einschränkungen und Aktivitätszonen als Vektoren aus der BAZL-
    // ED-269-Datei (offline nutzbar); WMS/REST nur noch für Zusatz-Ebenen.
    featureInfoType: "ed269-cached",
    restIdentifyUrl: "https://api3.geo.admin.ch/rest/services/api/MapServer/identify",
    restIdentifyLayers: ["ch.bazl.landschaftsruhezonen", "ch.bazl.wohngebiete-aulav"],
    alwaysVisibleLayerIds: [],
    forceEnabledLayerIds: [],
  },
  LU: {
    iso: "LU",
    wmsBaseUrl: "https://wms.geoportail.lu/public_map_layers/service",
    wmsVersion: "1.1.1",
    layers: LU_GEOZONE_LAYERS,
    // Zonen als Vektoren (ED-269 CC0, sonst OGC-Features) – offline nutzbar.
    // Die WMS-Ebenen bleiben abschaltbar erhalten, standardmäßig aus.
    featureInfoType: "ed269-cached",
    alwaysVisibleLayerIds: [],
    forceEnabledLayerIds: [],
  },
  NL: {
    iso: "NL",
    wmsBaseUrl: "https://service.pdok.nl/lvnl/drone-no-flyzones/wms/v1_0",
    wmsVersion: "1.3.0",
    layers: NL_GEOZONE_LAYERS,
    // Zonen als Vektoren aus GoDrone (ED-269-Pfad); WMS nur noch für Natur-Ebenen.
    featureInfoType: "ed269-cached",
    alwaysVisibleLayerIds: ["nl_nnn"],
    forceEnabledLayerIds: [],
  },
  FR: {
    iso: "FR",
    wmsBaseUrl: "https://data.geopf.fr/wms-r/wms",
    wmsVersion: "1.3.0",
    layers: FR_GEOZONE_LAYERS,
    featureInfoType: "wms-fr",
    alwaysVisibleLayerIds: ["fr_restrictions"],
    forceEnabledLayerIds: ["fr_restrictions"],
    // DGAC-Layer rendert zuverlässig bis Web-Mercator-Zoom 15 (WMS-Scale
    // 17062.4 >= MinScaleDenominator 17061.84); erst ab Zoom 16 (Scale 8531 <
    // Grenze) kommen flächig leere Kacheln. maximumNativeZ=15 lässt WMSTile erst
    // ab z16 hochskalieren (geprüft: z15=echte Geometrie, z16=leer). Frühere
    // 14er-Grenze skalierte schon bei z15 die groben z14-Kacheln hoch -> Block-
    // Raster über FR. Wert aus dem geteilten Modul, damit Web nicht driftet.
    wmsMaxNativeZoom: COUNTRY_WMS_MAX_NATIVE_ZOOM.FR,
  },
  HU: {
    // Ungarn (HungaroControl / MyDroneSpace): NUR Bild-Overlay aus dem
    // öffentlichen WMTS (XYZ-Vorlage am Layer, kein WMS). Keine Zonenabfrage
    // (featureInfoType "none"); die Vektor-API braucht einen Login. HU steht
    // deshalb NICHT in OWN_MAP_DATA_COUNTRIES – der Hinweis zur manuellen
    // Prüfung bleibt (Registry: manualCheckOnly).
    iso: "HU",
    wmsBaseUrl: "",
    wmsVersion: "1.3.0",
    layers: HU_GEOZONE_LAYERS,
    featureInfoType: "none",
    alwaysVisibleLayerIds: ["hu_aixm"],
    forceEnabledLayerIds: [],
    wmsMaxNativeZoom: COUNTRY_WMS_MAX_NATIVE_ZOOM.HU,
  },
} satisfies Record<string, CountryGeozoneConfig>;
