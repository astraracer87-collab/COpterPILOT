// Lokale Abfrage eines (auf dem Gerät gespeicherten) ED-269-Geozonen-Bestands –
// Portierung von server/dataSync.ts: queryGeozones() samt
// featureValidityTs(). Liefert dieselbe Filter-Semantik wie der frühere
// Endpoint `/api/cached/geozones` (bbox, limit, maxValidityDays, abgelaufene
// Zonen ausblenden). Rein, ohne React-Native-Importe (unter tsx testbar).
import { isGeozoneExpired } from "../../../shared/geozoneAltitudeFilter";
import {
  ed269IsNotamEligible,
  normalizeAustrianEd269Placeholder,
} from "../../../shared/ed269Restriction";
import type { GeoFeature } from "./ed269Sources";

export type Ed269LocalQuery = {
  // [lonW, latS, lonE, latN]
  bbox?: [number, number, number, number];
  // Obergrenze (nur zusammen mit bbox): die dem bbox-Zentrum nächstgelegenen
  // Zonen bleiben erhalten.
  limit?: number;
  // Nur Zonen mit Gültigkeitsdauer < N Tagen (temporäre, NOTAM-artige Zonen).
  maxValidityDays?: number;
  now?: number;
};

function bboxIntersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

// Gültigkeits-Zeitstempel (ms) eines Features. Belgische (skeyes-live) Zonen
// tragen validStartTs/validEndTs direkt; generisch wird applicability[]
// (ED-269) ausgewertet. Permanente Zonen -> null/null.
export function featureValidityTs(props: Record<string, any>): {
  start: number | null;
  end: number | null;
} {
  props = normalizeAustrianEd269Placeholder(props);
  const ds = Number(props?.validStartTs);
  const de = Number(props?.validEndTs);
  // Achtung: Number(undefined) = NaN, Number(null) = 0 -> null explizit ausschließen.
  const hasStart = props?.validStartTs != null && Number.isFinite(ds);
  const hasEnd = props?.validEndTs != null && Number.isFinite(de);
  if (hasStart || hasEnd) {
    return { start: hasStart ? ds : null, end: hasEnd ? de : null };
  }
  if (props?.permanent === true || String(props?.permanent ?? "").toUpperCase() === "YES") {
    return { start: null, end: null };
  }
  const app = props?.applicability;
  if (Array.isArray(app) && app.length > 0) {
    if (app.some((a: any) => String(a?.permanent ?? "").toUpperCase() === "YES")) {
      return { start: null, end: null };
    }
    let min: number | null = null;
    let max: number | null = null;
    for (const a of app) {
      if (a?.startDateTime) {
        const s = new Date(a.startDateTime).getTime();
        if (!isNaN(s) && (min === null || s < min)) min = s;
      }
      if (a?.endDateTime) {
        const e = new Date(a.endDateTime).getTime();
        if (!isNaN(e) && (max === null || e > max)) max = e;
      }
    }
    return { start: min, end: max };
  }
  return { start: null, end: null };
}

/**
 * Filtert einen Länder-Bestand wie früher der Server-Endpoint. `country` ist
 * der ISO-Code (beliebige Schreibweise) für die NOTAM-Eignungsprüfung.
 */
export function queryEd269Features(
  features: GeoFeature[],
  country: string,
  q: Ed269LocalQuery = {},
): GeoFeature[] {
  let feats = features;
  const now = q.now ?? Date.now();
  if (q.bbox) {
    const bb = q.bbox;
    feats = feats.filter((f) => f.bbox && bboxIntersects(f.bbox, bb));
    if (q.limit && q.limit > 0 && feats.length > q.limit) {
      const cx = (bb[0] + bb[2]) / 2;
      const cy = (bb[1] + bb[3]) / 2;
      const dist2 = (f: GeoFeature): number => {
        const fb = f.bbox as [number, number, number, number];
        const dx = (fb[0] + fb[2]) / 2 - cx;
        const dy = (fb[1] + fb[3]) / 2 - cy;
        return dx * dx + dy * dy;
      };
      feats = [...feats].sort((a, b) => dist2(a) - dist2(b)).slice(0, q.limit);
    }
  }
  if (q.maxValidityDays && q.maxValidityDays > 0) {
    const maxMs = q.maxValidityDays * 86400000;
    feats = feats.filter((f) => {
      const props = (f.properties as Record<string, any>) || {};
      const v = featureValidityTs(props);
      return (
        (ed269IsNotamEligible(props, country) && (v.end == null || v.end >= now)) ||
        (v.start != null && v.end != null && v.end - v.start < maxMs && v.end >= now)
      );
    });
  } else {
    // Abgelaufene Zonen generell ausblenden; dauerhafte (end == null) bleiben.
    feats = feats.filter((f) => {
      const v = featureValidityTs((f.properties as Record<string, any>) || {});
      return !isGeozoneExpired(v.end, now);
    });
  }
  return feats;
}
