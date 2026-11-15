// OGC-WFS-Abfragen (Umbau B6) – gemeinsam für IS, BG und den ES-Rückfall.
//
//  - GetFeature-URL (WFS 2.0: typeNames/count/startIndex, GeoJSON, EPSG:4326),
//  - Paging über count/startIndex: weiter, solange numberMatched/
//    totalFeatures mehr Treffer meldet; ohne diese Angabe entscheidet die
//    Seitengröße (volle Seite → weiter),
//  - Achsfolge: WFS 2.0 mit EPSG:4326 darf Breite/Länge (lat/lon) liefern.
//    `ensureLonLat` erkennt das an der Lage im erwarteten Gebiet und dreht nach
//    GeoJSON-Lon/Lat (nur, wenn sich die Wertebereiche nicht überschneiden).
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

export type FetchJson = (url: string, timeoutMs?: number) => Promise<any>;

export interface WfsGetFeatureOptions {
  base: string;
  layer: string;
  count?: number;
  startIndex?: number;
  /** Standard "application/json". */
  outputFormat?: string;
  /** outputFormat URL-kodieren (BG: ja; IS: historisch roh). Standard true. */
  encodeOutputFormat?: boolean;
  propertyName?: string;
}

/** WFS-2.0-GetFeature-URL (GeoJSON, WGS84). startIndex 0 entfällt. */
export function wfsGetFeatureUrl(o: WfsGetFeatureOptions): string {
  const fmt = o.outputFormat ?? "application/json";
  const params = [
    "service=WFS",
    "version=2.0.0",
    "request=GetFeature",
    `typeNames=${o.layer}`,
    "srsName=EPSG:4326",
    `outputFormat=${o.encodeOutputFormat === false ? fmt : encodeURIComponent(fmt)}`,
  ];
  if (o.propertyName) params.push(`propertyName=${o.propertyName}`);
  if (o.count != null) params.push(`count=${o.count}`);
  if (o.startIndex != null && o.startIndex > 0) params.push(`startIndex=${o.startIndex}`);
  return `${o.base}?${params.join("&")}`;
}

/** Gemeldete Gesamtzahl (numberMatched bzw. totalFeatures), sonst NaN. */
export function wfsMatched(body: any, order: "numberMatched" | "totalFeatures" = "numberMatched"): number {
  return Number(order === "numberMatched" ? body?.numberMatched ?? body?.totalFeatures : body?.totalFeatures ?? body?.numberMatched);
}

/**
 * Nach dieser Seite weiterladen? Leere Seite → nein; gemeldete Gesamtzahl →
 * bis sie erreicht ist; sonst volle Seite → ja.
 */
export function wfsHasMore(body: any, collected: number, pageSize: number): boolean {
  const got = Array.isArray(body?.features) ? body.features.length : 0;
  if (got === 0) return false;
  const matched = wfsMatched(body);
  if (Number.isFinite(matched) && matched >= 0) return collected < matched;
  return got >= pageSize;
}

/**
 * Strenge Variante (ES/SE): jede Seite kleiner als `pageSize` beendet das
 * Paging, auch wenn der Server mehr Treffer meldet; sonst bis zur
 * gemeldeten Gesamtzahl.
 */
export function wfsHasMoreStrict(body: any, collected: number, pageSize: number, order?: "numberMatched" | "totalFeatures"): boolean {
  const got = Array.isArray(body?.features) ? body.features.length : 0;
  if (got < pageSize) return false;
  const total = wfsMatched(body, order);
  return !(Number.isFinite(total) && collected >= total);
}

export interface WfsPagedOptions {
  /** URL der Seite ab `startIndex`. */
  pageUrl: (startIndex: number, count: number) => string;
  fetchJson: FetchJson;
  pageSize: number;
  maxPages: number;
  timeoutMs?: number;
  /** Abbruchregel (Standard wfsHasMore). */
  hasMore?: (body: any, collected: number, pageSize: number) => boolean;
}

/** Alle Features per count/startIndex-Paging (startIndex = bisher geladen). */
export async function fetchWfsPaged(o: WfsPagedOptions): Promise<any[]> {
  const hasMore = o.hasMore ?? wfsHasMore;
  const all: any[] = [];
  for (let page = 0; page < o.maxPages; page++) {
    const body = await o.fetchJson(o.pageUrl(all.length, o.pageSize), o.timeoutMs);
    const feats: any[] = Array.isArray(body?.features) ? body.features : [];
    all.push(...feats);
    if (!hasMore(body, all.length, o.pageSize)) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Achsfolge
// ---------------------------------------------------------------------------

export interface LonLatBounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

function firstPosition(c: any): [number, number] | null {
  let cur = c;
  while (Array.isArray(cur) && Array.isArray(cur[0])) cur = cur[0];
  if (Array.isArray(cur) && typeof cur[0] === "number" && typeof cur[1] === "number") return [cur[0], cur[1]];
  return null;
}

/** x/y aller Positionen tauschen (weitere Ordinaten bleiben). */
export function swapAxes(c: any): any {
  if (!Array.isArray(c)) return c;
  if (typeof c[0] === "number") return [c[1], c[0], ...c.slice(2)];
  return c.map(swapAxes);
}

/** Liegt die erste Position als (lat, lon) im Gebiet – also vertauscht? */
export function looksLatLon(coordinates: any, b: LonLatBounds): boolean {
  const p = firstPosition(coordinates);
  if (!p) return false;
  const [x, y] = p;
  return x >= b.minLat && x <= b.maxLat && y >= b.minLon && y <= b.maxLon;
}

/**
 * Geometrie in GeoJSON-Lon/Lat bringen, falls sie (erkennbar an der ersten
 * Position und den Gebietsgrenzen) als Lat/Lon geliefert wurde. Nur für
 * Gebiete, deren Lon- und Lat-Bereiche sich nicht überschneiden.
 */
export function ensureLonLat<T extends { type: string; coordinates: any }>(geometry: T, b: LonLatBounds): T {
  if (!geometry) return geometry;
  return looksLatLon(geometry.coordinates, b) ? { ...geometry, coordinates: swapAxes(geometry.coordinates) } : geometry;
}
