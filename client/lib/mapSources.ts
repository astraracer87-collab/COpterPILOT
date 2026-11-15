/**
 * Kartenquellen je Land – wie im KMZ-Tool amtliche Karten und Luftbilder.
 *
 * Nur amtliche Open-Data-Dienste dürfen auch für die Offline-Speicherung ganzer
 * Länder verwendet werden. CARTO (OpenStreetMap) und Esri sind nur für die
 * Online-Anzeige außerhalb dieser Länder bzw. als Lückenfüller gedacht; deren
 * Nutzungsbedingungen verbieten das massenhafte Herunterladen.
 *
 * WICHTIG: Die Kachel-Adressen hier werden 1:1 sowohl für die Anzeige als auch
 * für Offline-Pakete benutzt – nur dann findet MapLibre die gespeicherten Kacheln.
 */

import { getCountryBoundingBox } from "../../shared/countryDetection";

export type LngLatBox = [west: number, south: number, east: number, north: number];

export interface RasterDef {
  id: string;
  tiles: string;
  tileSize: number;
  maxzoom: number;
  minzoom?: number;
  attribution: string;
  /** Gebiet, in dem die Quelle Daten hat */
  bounds: LngLatBox;
  /** Geschätzte Größe einer Kachel in KB (für die Speicher-Abschätzung) */
  kbPerTile: number;
  /** Nur für dieses Bundesland gültig (Luftbilder der Länder) */
  region?: string;
}

export interface CountryMapProvider {
  iso: string;
  label: string;
  bounds: LngLatBox;
  map?: RasterDef;
  /** Luftbilder; bei mehreren (z. B. Bundesländer) werden alle mit ihrem Gebiet gezeigt */
  satellite?: RasterDef[];
}

const wms13 = (base: string, layer: string, format: "image/jpeg" | "image/png") =>
  `${base}${base.includes("?") ? "&" : "?"}SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:3857&FORMAT=${format}${format === "image/png" ? "&TRANSPARENT=TRUE" : ""}&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`;

const DOP_ATTR_DE = "Luftbild © GeoBasis-DE";

export const COUNTRY_MAP_PROVIDERS: CountryMapProvider[] = [
  {
    iso: "DE",
    label: "Deutschland",
    bounds: [5.86, 47.27, 15.05, 55.06],
    map: {
      id: "de-basemap",
      tiles: "https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png",
      tileSize: 256,
      maxzoom: 18,
      attribution: "© basemap.de / BKG",
      bounds: [5.86, 47.27, 15.05, 55.06],
      kbPerTile: 45,
    },
    // Amtliche Luftbilder (DOP) der Länder, die sie frei anbieten. PNG mit
    // Transparenz, damit sich die Länder an den Grenzen nicht überdecken.
    satellite: [
      {
        id: "de-dop-he",
        region: "Hessen",
        tiles: wms13("https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows", "he_dop20_rgb", "image/png"),
        tileSize: 256,
        maxzoom: 19,
        minzoom: 12,
        attribution: DOP_ATTR_DE + " / HVBG",
        bounds: [7.77, 49.39, 10.24, 51.66],
        kbPerTile: 110,
      },
      {
        id: "de-dop-rp",
        region: "Rheinland-Pfalz",
        tiles: wms13("https://geo4.service24.rlp.de/wms/rp_dop20.fcgi", "rp_dop20", "image/png"),
        tileSize: 256,
        maxzoom: 19,
        minzoom: 12,
        attribution: DOP_ATTR_DE + " / LVermGeoRP",
        bounds: [6.11, 48.97, 8.51, 50.94],
        kbPerTile: 110,
      },
      {
        id: "de-dop-nw",
        region: "Nordrhein-Westfalen",
        tiles: wms13("https://www.wms.nrw.de/geobasis/wms_nw_dop", "nw_dop_rgb", "image/png"),
        tileSize: 256,
        maxzoom: 19,
        minzoom: 12,
        attribution: DOP_ATTR_DE + " / Geobasis NRW",
        bounds: [5.86, 50.32, 9.46, 52.53],
        kbPerTile: 110,
      },
      {
        id: "de-dop-by",
        region: "Bayern",
        tiles: wms13("https://geoservices.bayern.de/od/wms/dop/v1/dop40", "by_dop40c", "image/png"),
        tileSize: 256,
        maxzoom: 18,
        minzoom: 12,
        attribution: DOP_ATTR_DE + " / LDBV Bayern",
        bounds: [8.97, 47.27, 13.84, 50.56],
        kbPerTile: 110,
      },
    ],
  },
  {
    iso: "AT",
    label: "Österreich",
    bounds: [9.53, 46.37, 17.16, 49.02],
    map: {
      id: "at-basemap",
      tiles: "https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png",
      tileSize: 256,
      maxzoom: 19,
      attribution: "© basemap.at",
      bounds: [9.53, 46.37, 17.16, 49.02],
      kbPerTile: 40,
    },
    satellite: [
      {
        id: "at-ortho",
        tiles: "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
        tileSize: 256,
        maxzoom: 19,
        attribution: "© basemap.at",
        bounds: [9.53, 46.37, 17.16, 49.02],
        kbPerTile: 25,
      },
    ],
  },
  {
    iso: "CH",
    label: "Schweiz",
    bounds: [5.95, 45.82, 10.49, 47.81],
    map: {
      id: "ch-swisstopo",
      tiles: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg",
      tileSize: 256,
      maxzoom: 18,
      attribution: "© swisstopo",
      bounds: [5.95, 45.82, 10.49, 47.81],
      kbPerTile: 35,
    },
    satellite: [
      {
        id: "ch-swissimage",
        tiles: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
        tileSize: 256,
        maxzoom: 19,
        attribution: "© swisstopo",
        bounds: [5.95, 45.82, 10.49, 47.81],
        kbPerTile: 28,
      },
    ],
  },
  {
    iso: "NL",
    label: "Niederlande",
    bounds: [3.36, 50.75, 7.23, 53.56],
    map: {
      id: "nl-brt",
      tiles: "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
      tileSize: 256,
      maxzoom: 19,
      attribution: "© Kadaster / PDOK",
      bounds: [3.36, 50.75, 7.23, 53.56],
      kbPerTile: 40,
    },
    satellite: [
      {
        id: "nl-luchtfoto",
        tiles: "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg",
        tileSize: 256,
        maxzoom: 19,
        attribution: "© Beeldmateriaal Nederland / PDOK",
        bounds: [3.36, 50.75, 7.23, 53.56],
        kbPerTile: 30,
      },
    ],
  },
  {
    iso: "FR",
    label: "Frankreich",
    bounds: [-5.15, 41.33, 9.56, 51.09],
    map: {
      id: "fr-planign",
      tiles:
        "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png",
      tileSize: 256,
      maxzoom: 19,
      attribution: "© IGN",
      bounds: [-5.15, 41.33, 9.56, 51.09],
      kbPerTile: 40,
    },
    satellite: [
      {
        id: "fr-ortho",
        tiles:
          "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
        tileSize: 256,
        maxzoom: 19,
        attribution: "© IGN",
        bounds: [-5.15, 41.33, 9.56, 51.09],
        kbPerTile: 25,
      },
    ],
  },
  {
    // Luxemburg: keine frei speicherbare Kachelkarte – Geozonen und Hindernisse offline,
    // Karte online über CARTO.
    iso: "LU",
    label: "Luxemburg",
    bounds: [5.73, 49.44, 6.53, 50.19],
  },
  // ---------------------------------------------------------------------------
  // Weitere Länder (live geprüft, Lizenz erlaubt Speicherung/Weitergabe; siehe
  // docs/offline-karten-quellen.md). Länder ohne Eintrag hier oder ohne `map`
  // zeigen die Karte nur online (CARTO/Esri dürfen nicht massenhaft geladen werden).
  // ---------------------------------------------------------------------------
  {
    iso: "LI",
    label: "Liechtenstein",
    bounds: [9.47, 47.05, 9.64, 47.27],
    // swisstopo-Landeskarten und SWISSIMAGE decken Liechtenstein mit ab; gleiche
    // Kachel-Adressen wie CH, damit gespeicherte Kacheln gemeinsam genutzt werden.
    map: {
      id: "li-swisstopo",
      tiles: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg",
      tileSize: 256,
      maxzoom: 18,
      attribution: "© swisstopo",
      bounds: [9.47, 47.05, 9.64, 47.27],
      kbPerTile: 35,
    },
    satellite: [
      {
        id: "li-swissimage",
        tiles: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
        tileSize: 256,
        maxzoom: 19,
        attribution: "© swisstopo",
        bounds: [9.47, 47.05, 9.64, 47.27],
        kbPerTile: 28,
      },
    ],
  },
  {
    // Kartverket Topografisk Norgeskart (Cache-WMTS, webmercator), CC BY 4.0.
    // Luftbilder („Norge i bilder“) sind nicht frei – nur online.
    iso: "NO",
    label: "Norwegen",
    bounds: [4.64, 57.96, 31.08, 71.19],
    map: {
      id: "no-kartverket-topo",
      tiles: "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png",
      tileSize: 256,
      maxzoom: 18,
      attribution: "© Kartverket (CC BY 4.0)",
      bounds: [4.64, 57.96, 31.08, 71.19],
      kbPerTile: 60,
    },
  },
  {
    // IGN España: Mapa base (IGNBaseTodo) und PNOA-Orthofotos, CC BY 4.0 (scne.es).
    // Nur Festland + Balearen (Kanaren liegen außerhalb der Länder-Box).
    iso: "ES",
    label: "Spanien",
    bounds: [-9.3, 35.95, 4.33, 43.79],
    map: {
      id: "es-ignbase",
      tiles:
        "https://www.ign.es/wmts/ign-base?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=IGNBaseTodo&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
      tileSize: 256,
      maxzoom: 19,
      attribution: "© Instituto Geográfico Nacional de España (CC BY 4.0)",
      bounds: [-9.3, 35.95, 4.33, 43.79],
      kbPerTile: 16,
    },
    satellite: [
      {
        id: "es-pnoa",
        tiles:
          "https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
        tileSize: 256,
        maxzoom: 19,
        attribution: "PNOA © Instituto Geográfico Nacional de España (CC BY 4.0)",
        bounds: [-9.3, 35.95, 4.33, 43.79],
        kbPerTile: 20,
      },
    ],
  },
  {
    // Maa- ja Ruumiamet (Estland): Grundkarte und Orthofoto im GMC-Raster
    // (= Web-Mercator), Open-Data-Lizenz (frei, auch kommerziell, Quellenangabe).
    iso: "EE",
    label: "Estland",
    bounds: [21.76, 57.52, 28.21, 59.68],
    map: {
      id: "ee-maaamet-kaart",
      tiles: "https://tiles.maaamet.ee/tm/wmts/1.0.0/kaart/default/GMC/{z}/{y}/{x}.png",
      tileSize: 256,
      maxzoom: 18,
      attribution: "Aluskaart © Maa- ja Ruumiamet",
      bounds: [21.76, 57.52, 28.21, 59.68],
      kbPerTile: 18,
    },
    satellite: [
      {
        id: "ee-maaamet-foto",
        tiles: "https://tiles.maaamet.ee/tm/wmts/1.0.0/foto/default/GMC/{z}/{y}/{x}.jpg",
        tileSize: 256,
        maxzoom: 18,
        attribution: "Ortofoto © Maa- ja Ruumiamet",
        bounds: [21.76, 57.52, 28.21, 59.68],
        kbPerTile: 20,
      },
    ],
  },
  {
    // NGI/IGN Belgien: CartoWeb-Topokarte (Web-Mercator, Zoom 7–17). Speichern
    // und Kopieren für diese App schriftlich vom NGI genehmigt (Product Owner,
    // 2026-11). Luftbilder sind in Belgien regional (Flandern/Wallonien) und
    // nicht enthalten.
    iso: "BE",
    label: "Belgien",
    bounds: [2.54, 49.49, 6.41, 51.51],
    map: {
      id: "be-ngi-cartoweb-topo",
      tiles: "https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png",
      tileSize: 256,
      minzoom: 7,
      maxzoom: 17,
      attribution: "Karte © NGI/IGN Belgien (CartoWeb)",
      bounds: [2.54, 49.49, 6.41, 51.51],
      kbPerTile: 15,
    },
  },
  {
    // ČÚZK (Tschechien): Základní topografické mapy und Ortofoto ČR als
    // Web-Mercator-Kacheln, Open Data CC BY 4.0. Kacheln erst ab Zoom 6.
    iso: "CZ",
    label: "Tschechien",
    bounds: [12.09, 48.55, 18.86, 51.06],
    map: {
      id: "cz-cuzk-ztm",
      tiles: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ZTM_WM/MapServer/tile/{z}/{y}/{x}",
      tileSize: 256,
      maxzoom: 18,
      minzoom: 6,
      attribution: "© ČÚZK (CC BY 4.0)",
      bounds: [12.09, 48.55, 18.86, 51.06],
      kbPerTile: 40,
    },
    satellite: [
      {
        id: "cz-cuzk-orto",
        tiles: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}",
        tileSize: 256,
        maxzoom: 19,
        minzoom: 6,
        attribution: "Ortofoto © ČÚZK (CC BY 4.0)",
        bounds: [12.09, 48.55, 18.86, 51.06],
        kbPerTile: 35,
      },
    ],
  },
  {
    // Polen: amtliche Orthofotomap (GUGiK, Geoportal-WMTS EPSG:3857), kostenfrei
    // und beliebig nutzbar. Eine topografische Karte gibt es nur in EPSG:2180 –
    // die Karte bleibt daher online.
    iso: "PL",
    label: "Polen",
    bounds: [14.12, 49.0, 24.15, 54.84],
    satellite: [
      {
        id: "pl-gugik-orto",
        tiles:
          "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
        tileSize: 256,
        maxzoom: 19,
        attribution: "Ortofotomapa © GUGiK",
        bounds: [14.12, 49.0, 24.15, 54.84],
        kbPerTile: 13,
      },
    ],
  },
  {
    // Kroatien (DGU, Državna geodetska uprava): TK25 und Digitales Orthofoto
    // per WMS in EPSG:3857. Speichern und Kopieren für diese App schriftlich von
    // der DGU genehmigt (Product Owner, 2026-11) – BEDINGUNG: Das „GEOPORTAL“-
    // Wasserzeichen im Orthofoto muss sichtbar bleiben. Kacheln werden daher
    // nie verändert, beschnitten oder überdeckt gespeichert/angezeigt.
    iso: "HR",
    label: "Kroatien",
    bounds: [13.49, 42.39, 19.45, 46.55],
    map: {
      id: "hr-dgu-tk25",
      tiles: wms13("https://geoportal.dgu.hr/services/tk/ows", "TK25_NOVI", "image/png"),
      tileSize: 256,
      minzoom: 8,
      maxzoom: 17,
      attribution: "TK25 © Državna geodetska uprava (DGU)",
      bounds: [13.49, 42.39, 19.45, 46.55],
      kbPerTile: 60,
    },
    satellite: [
      {
        id: "hr-dgu-dof",
        tiles: wms13("https://geoportal.dgu.hr/services/dof/ows", "DOF_LIDAR_2022_2023", "image/png"),
        tileSize: 256,
        minzoom: 8,
        maxzoom: 18,
        attribution: "DOF © Državna geodetska uprava (DGU) – Wasserzeichen „GEOPORTAL“ laut Genehmigung",
        bounds: [13.49, 42.39, 19.45, 46.55],
        kbPerTile: 60,
      },
    ],
  },
  {
    // Island: Grundkarte der Landesvermessung (LMÍ, jetzt Náttúrufræðistofnun)
    // über GeoServer-WMS in EPSG:3857, CC BY 4.0.
    iso: "IS",
    label: "Island",
    bounds: [-24.6, 63.2, -13.4, 66.6],
    map: {
      id: "is-lmi-grunnkort",
      tiles: wms13("https://gis.lmi.is/geoserver/wms", "nytt_grunnkort_samsett_naer_fjaer", "image/png"),
      tileSize: 256,
      maxzoom: 18,
      attribution: "© Náttúrufræðistofnun / Landmælingar Íslands (CC BY 4.0)",
      bounds: [-24.6, 63.2, -13.4, 66.6],
      kbPerTile: 55,
    },
  },
];

/**
 * Alle Länder der App (wie LICENSE_COUNTRIES in storage.ts). Jedes davon ist in
 * „Offline-Karten“ wählbar: Geozonen und Hindernisse gehen überall, Karte und
 * Luftbild nur dort, wo COUNTRY_MAP_PROVIDERS eine frei speicherbare Quelle hat.
 */
export const OFFLINE_APP_COUNTRIES: { iso: string; label: string }[] = [
  { iso: "DE", label: "Deutschland" },
  { iso: "AT", label: "Österreich" },
  { iso: "CH", label: "Schweiz" },
  { iso: "LU", label: "Luxemburg" },
  { iso: "NL", label: "Niederlande" },
  { iso: "BE", label: "Belgien" },
  { iso: "FR", label: "Frankreich" },
  { iso: "PL", label: "Polen" },
  { iso: "CZ", label: "Tschechien" },
  { iso: "DK", label: "Dänemark" },
  { iso: "IT", label: "Italien" },
  { iso: "ES", label: "Spanien" },
  { iso: "SE", label: "Schweden" },
  { iso: "PT", label: "Portugal" },
  { iso: "IE", label: "Irland" },
  { iso: "GB", label: "Vereinigtes Königreich" },
  { iso: "GR", label: "Griechenland" },
  { iso: "FI", label: "Finnland" },
  { iso: "HR", label: "Kroatien" },
  { iso: "BG", label: "Bulgarien" },
  { iso: "RO", label: "Rumänien" },
  { iso: "HU", label: "Ungarn" },
  { iso: "SK", label: "Slowakei" },
  { iso: "SI", label: "Slowenien" },
  { iso: "LT", label: "Litauen" },
  { iso: "LV", label: "Lettland" },
  { iso: "EE", label: "Estland" },
  { iso: "CY", label: "Zypern" },
  { iso: "MT", label: "Malta" },
  { iso: "NO", label: "Norwegen" },
  { iso: "IS", label: "Island" },
  { iso: "LI", label: "Liechtenstein" },
];

/**
 * Gebiet eines Landes für Offline-Pakete: Kartenquelle, sonst die gemeinsame
 * Länder-Box aus shared/countryDetection.ts.
 */
export function countryOfflineBounds(iso: string | null | undefined): LngLatBox | undefined {
  if (!iso) return undefined;
  const p = getMapProvider(iso);
  if (p) return p.bounds;
  const b = getCountryBoundingBox(iso);
  return b ? [b.minLon, b.minLat, b.maxLon, b.maxLat] : undefined;
}

/** Hinweis für Länder ohne frei speicherbare Grundkarte (Offline-Einstellungen). */
export function noOfflineBasemapNote(label: string, hasGeozones = true): string {
  return hasGeozones
    ? `Für ${label} gibt es keine frei speicherbare Grundkarte – offline werden Geozonen und Hindernisse gespeichert; die Karte wird online angezeigt.`
    : `Für ${label} gibt es keine frei speicherbare Grundkarte – offline werden Hindernisse gespeichert; die Karte wird online angezeigt.`;
}

/** Online-Ersatz außerhalb der Länder oben (nicht offline speicherbar). */
export const FALLBACK_MAP = {
  // CARTO verlangt seit 11/2026 einen API-Schlüssel („API KEY REQUIRED“) – Esri-Straßenkarte ohne Schlüssel.
  tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  attribution: "Esri, HERE, Garmin, © OpenStreetMap-Mitwirkende",
  maxzoom: 19,
};
export const FALLBACK_SATELLITE = {
  tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Esri World Imagery",
  maxzoom: 19,
};
export const HYBRID_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/** Schrift für Höhenangaben an Hindernissen */
export const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
export const LABEL_FONT = ["Open Sans Semibold"];

export function getMapProvider(iso: string | null | undefined): CountryMapProvider | undefined {
  if (!iso) return undefined;
  return COUNTRY_MAP_PROVIDERS.find((p) => p.iso === iso.toUpperCase());
}

export function boxesIntersect(a: LngLatBox, b: LngLatBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Quellen, die im sichtbaren Bereich liegen (Karte oder Luftbild) */
export function sourcesForView(view: LngLatBox, kind: "map" | "satellite"): RasterDef[] {
  const out: RasterDef[] = [];
  for (const p of COUNTRY_MAP_PROVIDERS) {
    if (!boxesIntersect(p.bounds, view)) continue;
    if (kind === "map" && p.map) out.push(p.map);
    if (kind === "satellite" && p.satellite) {
      for (const s of p.satellite) if (boxesIntersect(s.bounds, view)) out.push(s);
    }
  }
  return out;
}
