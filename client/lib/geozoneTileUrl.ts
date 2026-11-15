// Reines, von React Native / Expo unabhängiges Helfer-Stück zum Bauen der
// Geozonen-Kachel-URLs. Bewusst frei von RN-/Expo-Importen, damit es
// deterministisch (unter tsx/Node) getestet werden kann.
//
// Früher zeigten die Kachel-URLs auf den eigenen Server-Cache
// (`/api/proxy/geozone-tiles/...`), der die WMS-Layer eines Landes zu EINER
// PNG-Kachel komponiert hat. Das Backend existiert nicht mehr: Die Karte lädt
// die Kacheln jetzt DIREKT als WMS-GetMap beim Anbieter (EPSG:3857, 256 px).
// Da ein Land mehrere WMS-Endpoints/Styles haben kann (z. B. NL Natura 2000)
// und der dipul-WMS an zu vielen Layern scheitert (siehe
// MAX_LAYERS_PER_GETMAP), entstehen pro Land ggf. MEHRERE Kachel-Vorlagen –
// die Karte legt pro Vorlage eine Kachel-Ebene übereinander (das ersetzt das
// frühere serverseitige PNG-Compositing).
//
// Platzhalter: `{bbox}` = "minX,minY,maxX,maxY" der Kachel in EPSG:3857 (Meter).
// Ausnahme: Layer mit `tileUrlTemplate` (reine XYZ-Kacheln, z. B. Ungarn)
// liefern ihre Vorlage mit {z}/{x}/{y} unverändert.
// Leaflet löst `{bbox}` über eine Funktions-Option auf (siehe
// LEAFLET_WMS_BBOX_FN_JS); andere Verbraucher nutzen fillGeozoneTileTemplate().
import {
  NATIVE_GEOZONE_LAYER_CATALOG,
  type GeozoneLayer,
} from "../../shared/geozoneLayerCatalog";

export const GEOZONE_TILE_SIZE = 256;
export const GEOZONE_TILE_BBOX_PLACEHOLDER = "{bbox}";

// Der dipul-WMS (uas-betrieb.de) bricht GetMap-Aufrufe mit zu vielen Layern ab
// ("internalError: Rendering process failed", empirisch ~28). Daher werden die
// Layer einer Endpoint-Gruppe in Pakete à max. 15 aufgeteilt (wie früher der
// Server, server/geozoneTilesCore.ts).
export const MAX_LAYERS_PER_GETMAP = 15;

// Standard-WMS je Land (Spiegel von COUNTRY_GEOZONE_CONFIGS in geozones.ts bzw.
// COUNTRY_WMS im früheren Server). Vektor-Länder (AT/BE/DK) haben KEIN WMS.
export const GEOZONE_COUNTRY_WMS: Record<string, { baseUrl: string; version: string }> = {
  DE: { baseUrl: "https://uas-betrieb.de/geoservices/dipul/wms", version: "1.1.1" },
  CH: { baseUrl: "https://wms.geo.admin.ch/", version: "1.3.0" },
  LU: { baseUrl: "https://wms.geoportail.lu/public_map_layers/service", version: "1.1.1" },
  NL: { baseUrl: "https://service.pdok.nl/lvnl/drone-no-flyzones/wms/v1_0", version: "1.3.0" },
  FR: { baseUrl: "https://data.geopf.fr/wms-r/wms", version: "1.3.0" },
};

const ORIGIN = 20037508.342789244; // halbe Web-Mercator-Weltgröße (m)

/** Kachel (z/x/y, XYZ-Schema) -> [minX, minY, maxX, maxY] in EPSG:3857. */
export function tileToBbox3857(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * ORIGIN) / Math.pow(2, z);
  const minX = -ORIGIN + x * size;
  const maxX = -ORIGIN + (x + 1) * size;
  const maxY = ORIGIN - y * size;
  const minY = ORIGIN - (y + 1) * size;
  return [minX, minY, maxX, maxY];
}

/** Ersetzt {bbox} (sowie ggf. {z}/{x}/{y}) einer Vorlage für eine konkrete Kachel. */
export function fillGeozoneTileTemplate(template: string, z: number, x: number, y: number): string {
  const bbox = tileToBbox3857(z, x, y).map((v) => v.toFixed(2)).join(",");
  return template
    .replace(/\{bbox\}/g, bbox)
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
}

/**
 * JavaScript-Quelltext (für das Leaflet-WebView-HTML) einer Funktion
 * `__geozoneWmsBbox(data)`, die aus Leaflets Template-Daten {x, y, z} die
 * EPSG:3857-bbox berechnet. Verwendung in Leaflet:
 *
 *   L.tileLayer(url, { ..., bbox: __geozoneWmsBbox })
 *
 * Leaflets Util.template ruft Funktions-Optionen mit den Kacheldaten auf
 * (`data.z` ist bereits die URL-Zoomstufe inkl. maxNativeZoom-Kappung).
 */
export const LEAFLET_WMS_BBOX_FN_JS =
  "function __geozoneWmsBbox(d){var O=20037508.342789244;var s=2*O/Math.pow(2,d.z);" +
  "return [(-O+d.x*s).toFixed(2),(O-(d.y+1)*s).toFixed(2),(-O+(d.x+1)*s).toFixed(2),(O-d.y*s).toFixed(2)].join(',');}";

type WmsGroup = { baseUrl: string; version: string; layers: string[]; styles?: string; sldBody?: string };

function catalogLayersFor(iso: string): GeozoneLayer[] {
  return NATIVE_GEOZONE_LAYER_CATALOG.find((c) => c.iso === iso)?.layers ?? [];
}

function buildGetMapTemplate(g: WmsGroup): string {
  const crsParam = g.version === "1.3.0" ? "CRS" : "SRS";
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: g.version,
    REQUEST: "GetMap",
    LAYERS: g.layers.join(","),
    STYLES: g.styles ?? "",
    [crsParam]: "EPSG:3857",
    WIDTH: String(GEOZONE_TILE_SIZE),
    HEIGHT: String(GEOZONE_TILE_SIZE),
    FORMAT: "image/png",
    TRANSPARENT: "true",
  });
  // SLD_BODY wird von URLSearchParams prozent-kodiert -> enthält keine
  // geschweiften Klammern, die Leaflet als Platzhalter missverstehen könnte.
  if (g.sldBody) params.set("SLD_BODY", g.sldBody);
  // BBOX bewusst NICHT über URLSearchParams (würde die Klammern kodieren).
  return `${g.baseUrl}${g.baseUrl.includes("?") ? "&" : "?"}${params.toString()}&BBOX=${GEOZONE_TILE_BBOX_PLACEHOLDER}`;
}

/**
 * Baut die direkten WMS-GetMap-Kachel-Vorlagen (mit `{bbox}`-Platzhalter) für
 * ein Land. Layer werden dedupliziert, sortiert, auf die im Katalog bekannten
 * Layer des Landes beschränkt (wie früher die Server-Allowlist), nach
 * Endpoint/Style/SLD gruppiert und in Pakete à MAX_LAYERS_PER_GETMAP geteilt.
 * Reihenfolge = Zeichenreihenfolge (spätere Vorlagen oben). XYZ-Layer
 * (`tileUrlTemplate`) kommen unverändert und einzeln ans Ende. Liefert [] für
 * Länder ohne WMS/XYZ-Layer oder ohne gültige Layer.
 */
export function buildGeozoneWmsTileTemplates(layers: string[], countryIso?: string): string[] {
  if (!layers || layers.length === 0) return [];
  const iso = (countryIso || "DE").toUpperCase();
  const catalog = catalogLayersFor(iso);
  const byName = new Map(catalog.map((l) => [l.wmsLayer, l] as const));
  const sorted = Array.from(new Set(layers.filter((l) => !!l && byName.has(l)))).sort();
  if (sorted.length === 0) return [];

  // Layer mit fertiger XYZ-Vorlage (z. B. HU MyDroneSpace) liefern genau diese
  // Vorlage – nie mit WMS-Layern in einem GetMap kombiniert.
  const xyz: string[] = [];
  const wmsNames: string[] = [];
  for (const name of sorted) {
    const t = byName.get(name)?.tileUrlTemplate;
    if (t) {
      if (!xyz.includes(t)) xyz.push(t);
    } else {
      wmsNames.push(name);
    }
  }
  const def = GEOZONE_COUNTRY_WMS[iso];
  if (!def) return xyz;

  const order: string[] = [];
  const groups = new Map<string, WmsGroup>();
  for (const name of wmsNames) {
    const l = byName.get(name);
    const baseUrl = l?.wmsBaseUrl ?? def.baseUrl;
    const version = l?.wmsVersion ?? def.version;
    const key = `${baseUrl}|${version}|${l?.wmsStyle ?? ""}|${l?.wmsSldBody ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { baseUrl, version, layers: [], styles: l?.wmsStyle, sldBody: l?.wmsSldBody };
      groups.set(key, g);
      order.push(key);
    }
    g.layers.push(name);
  }

  const out: string[] = [];
  for (const key of order) {
    const g = groups.get(key)!;
    for (let i = 0; i < g.layers.length; i += MAX_LAYERS_PER_GETMAP) {
      out.push(buildGetMapTemplate({ ...g, layers: g.layers.slice(i, i + MAX_LAYERS_PER_GETMAP) }));
    }
  }
  return [...out, ...xyz];
}

/**
 * Früher: kombinierte XYZ-Kachel-URL des Server-Caches. Jetzt: die ERSTE
 * direkte WMS-Vorlage des Landes (mit `{bbox}`-Platzhalter) – "" wenn keine
 * gültigen Layer. ACHTUNG: Ein Land kann mehrere Vorlagen benötigen (z. B. DE
 * mit > 15 Layern, NL mit Natura 2000); Karten sollten daher
 * buildGeozoneWmsTileTemplates() verwenden und pro Vorlage eine Ebene anlegen.
 *
 * @param _apiBase  Veraltet und ignoriert (früher die Backend-Basis-URL).
 */
export function buildGeozoneCacheTileUrlFrom(
  _apiBase: string,
  layers: string[],
  countryIso?: string,
): string {
  return buildGeozoneWmsTileTemplates(layers, countryIso)[0] ?? "";
}

/**
 * Früher: XYZ-Kachel-URL der SERVERSEITIG rasterisierten Vektor-Geozonen
 * (ED-269 ohne WMS, z. B. Belgien). Ohne Backend gibt es diese Kacheln nicht
 * mehr (der Droneguide-GeoServer hat seinen WMS-Dienst deaktiviert) – die
 * Zonen müssen als Vektor-Polygone (queryEd269CachedFeatures) gezeichnet
 * werden. Liefert daher immer "".
 */
export function buildVectorGeozoneTileUrlFrom(_apiBase: string, _countryIso: string): string {
  return "";
}
