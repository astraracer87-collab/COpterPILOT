// ArcGIS-REST-FeatureServer-Abfragen (Umbau B6) – gemeinsam für CY, SI, SK
// und den ES-Rückfall.
//
//  - `query?…&f=geojson`, WGS84 (outSR=4326), alle Felder, volle Präzision
//    (außer `geometryPrecision` wird gesetzt), eine Seite je Aufruf.
//  - Paging über resultOffset/resultRecordCount; der Offset rückt um die
//    tatsächlich gelieferte Zahl vor (Server dürfen weniger liefern als
//    angefragt und setzen dann `exceededTransferLimit`).
//  - `exceededTransferLimit` steht je nach Server-Version oben oder unter
//    `properties`; ein ArcGIS-Fehlerobjekt (HTTP 200 + {error}) wird geworfen.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

export type FetchJson = (url: string, timeoutMs?: number) => Promise<any>;

export interface ArcgisQueryOptions {
  offset?: number;
  count?: number;
  /** z. B. "OBJECTID ASC" – stabile Reihenfolge über Seiten. */
  orderByFields?: string;
  /** Nachkommastellen der Geometrie (Standard: volle Präzision). */
  geometryPrecision?: number;
  /** SQL-Filter (Standard "1=1"). */
  where?: string;
}

/** Query-URL eines Layers (`<layerUrl>/query?…&f=geojson`). */
export function arcgisQueryUrl(layerUrl: string, opts: ArcgisQueryOptions = {}): string {
  const params = new URLSearchParams({ where: opts.where || "1=1", outFields: "*", outSR: "4326", returnGeometry: "true" });
  if (opts.geometryPrecision != null) params.set("geometryPrecision", String(opts.geometryPrecision));
  if (opts.orderByFields) params.set("orderByFields", opts.orderByFields);
  params.set("resultOffset", String(opts.offset ?? 0));
  params.set("resultRecordCount", String(opts.count ?? 1000));
  params.set("f", "geojson");
  return `${layerUrl}/query?${params.toString()}`;
}

/** Eine `f=geojson`-Seite lesen; ArcGIS-Fehlerobjekt → Error. */
export function arcgisPage(body: any): { features: any[]; exceeded: boolean } {
  if (body && typeof body === "object" && body.error) {
    const e = body.error;
    throw new Error(`ArcGIS-Fehler ${e.code ?? ""}: ${e.message ?? "unbekannt"}`.trim());
  }
  const features = Array.isArray(body?.features) ? body.features : [];
  const exceeded = body?.exceededTransferLimit === true || body?.properties?.exceededTransferLimit === true;
  return { features, exceeded };
}

export interface ArcgisPagedOptions {
  /** URL der Seite ab `offset` mit `count` Features. */
  pageUrl: (offset: number, count: number) => string;
  fetchJson: FetchJson;
  pageSize?: number;
  maxPages?: number;
  timeoutMs?: number;
}

/**
 * Alle Rohfeatures seitenweise laden. Ende: leere Seite oder (ohne
 * `exceededTransferLimit`) eine Seite kleiner als `pageSize`; höchstens
 * `maxPages` Seiten.
 */
export async function fetchArcgisPaged(o: ArcgisPagedOptions): Promise<any[]> {
  const pageSize = o.pageSize ?? 1000;
  const maxPages = o.maxPages ?? 20;
  const all: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { features, exceeded } = arcgisPage(await o.fetchJson(o.pageUrl(all.length, pageSize), o.timeoutMs));
    all.push(...features);
    if (features.length === 0) break;
    if (!exceeded && features.length < pageSize) break;
  }
  return all;
}
