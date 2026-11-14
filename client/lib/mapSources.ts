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
];

/** Online-Ersatz außerhalb der Länder oben (nicht offline speicherbar). */
export const FALLBACK_MAP = {
  tiles: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
  attribution: "© OpenStreetMap-Mitwirkende © CARTO",
  maxzoom: 20,
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
