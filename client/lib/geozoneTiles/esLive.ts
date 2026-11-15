// Spanien OHNE Offline-Paket: Zonen online direkt beim ENAIRE-insignias-
// MapServer je Ausschnitt abfragen (wie der DE-Live-Pfad über den dipul-WFS).
//
//  - je Layer `query?geometry=<w,s,e,n>&geometryType=esriGeometryEnvelope
//    &spatialRel=esriSpatialRelIntersects&outSR=4326&f=geojson`, paginiert,
//    volle Geometrie-Präzision
//  - Ergebnis (Rohfeatures) im Speicher 10 min je gerundetem Ausschnitt und
//    Layer-Satz zwischengespeichert; die Planung speichert die fertigen Zonen
//    zusätzlich je Standort für offline (geozones.ts, offlineResultCache)
//  - NOTAM für UAS kommen getrennt (tileStore getEsTempFeatures, ≤ 10 min)
//
// Bewusst frei von React-Native-Importen (unter tsx testbar; Netz injizierbar).
import type { GeozoneFeatureInfo } from "../geozones";
import {
  ES_INSIGNIAS_LAYERS,
  esInsigniasBboxUrl,
  tagEsInsigniasFeature,
  type EsInsigniasLayer,
  type EsTilePart,
} from "../../../shared/spanishGeozones";
import { arcgisPage } from "../../../shared/geozoneKit/arcgis";
import { TEMPORARY_ZONES_MAX_AGE_MS } from "../../../shared/geozoneSourceMeta";
import { esZoneFromStored } from "./tileZones";
import type { LngLatBBox } from "./tileStoreCore";
import { trackDownload } from "../downloadActivity";

export type EsFetchJson = (url: string, timeoutMs?: number) => Promise<any>;

const PAGE = 1000;
const MAX_PAGES = 5;
const TIMEOUT_MS = 30_000;
export const ES_LIVE_CACHE_MS = TEMPORARY_ZONES_MAX_AGE_MS;

async function defaultFetchJson(url: string, timeoutMs = TIMEOUT_MS): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/geo+json, application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let fetchJsonImpl: EsFetchJson = defaultFetchJson;
const cache = new Map<string, { at: number; features: any[]; failed: string[] }>();

/** Nur für Tests: Netz ersetzen und Cache leeren. */
export function __setEsLiveFetchForTests(f: EsFetchJson | null): void {
  fetchJsonImpl = f ?? defaultFetchJson;
  cache.clear();
}

/** Dauerhafte Zonen-Layer der gewählten Teile (ohne NOTAM). */
export function esLiveLayers(parts: EsTilePart[] = ["base", "infra", "enp"]): EsInsigniasLayer[] {
  return ES_INSIGNIAS_LAYERS.filter((l) => l.part !== "temp" && parts.includes(l.part));
}

async function fetchLayerBbox(l: EsInsigniasLayer, bbox: LngLatBBox): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { features, exceeded } = arcgisPage(await fetchJsonImpl(esInsigniasBboxUrl(l, bbox, offset, PAGE), TIMEOUT_MS));
    offset += features.length;
    for (const f of features) {
      const t = tagEsInsigniasFeature(f, l.key);
      if (t) out.push(t);
    }
    if (features.length === 0 || (!exceeded && features.length < PAGE)) break;
  }
  return out;
}

export interface EsLiveResult {
  zones: GeozoneFeatureInfo[];
  /** Layer, deren Abfrage fehlschlug (Abdeckung „partial“) */
  failedLayers: string[];
}

/**
 * Zonen der gewählten Teile im Ausschnitt live abfragen. Wirft, wenn ALLE
 * Layer fehlschlagen (z. B. offline/WAF) – sonst Teilergebnis mit failedLayers.
 */
export async function queryEsLiveZones(bbox: LngLatBBox, parts: EsTilePart[] = ["base", "infra", "enp"], now = Date.now()): Promise<EsLiveResult> {
  const layers = esLiveLayers(parts);
  if (layers.length === 0) return { zones: [], failedLayers: [] };
  // Ausschnitt nach außen auf ein 0,05°-Raster runden: kleine Kartenbewegungen
  // treffen so den Cache (Zonen außerhalb des Ausschnitts stören nicht).
  const G = 20;
  const q: LngLatBBox = [Math.floor(bbox[0] * G) / G, Math.floor(bbox[1] * G) / G, Math.ceil(bbox[2] * G) / G, Math.ceil(bbox[3] * G) / G];
  bbox = q;
  const key = `${layers.map((l) => l.key).join(",")}|${q.join(",")}`;
  let hit = cache.get(key);
  if (!hit || now - hit.at > ES_LIVE_CACHE_MS) {
    // Längere Live-Abfragen erscheinen in der Download-Anzeige (kurze < 1 s nicht)
    const results = await trackDownload(
      { id: "es-live", iso: "ES", labelDe: "Geozonen für den Kartenausschnitt", kind: "live" },
      () => Promise.allSettled(layers.map((l) => fetchLayerBbox(l, bbox))),
    );
    const failed = layers.filter((_, i) => results[i].status === "rejected").map((l) => l.key);
    if (failed.length === layers.length) {
      const reason = (results[0] as PromiseRejectedResult).reason;
      throw reason instanceof Error ? reason : new Error("ENAIRE nicht erreichbar");
    }
    const features = results.flatMap((x) => (x.status === "fulfilled" ? x.value : []));
    hit = { at: now, features, failed };
    cache.set(key, hit);
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  }
  const zones: GeozoneFeatureInfo[] = [];
  const at = new Date(now);
  for (const f of hit.features) {
    const z = esZoneFromStored(f, at);
    if (z) zones.push(z);
  }
  return { zones, failedLayers: hit.failed };
}
