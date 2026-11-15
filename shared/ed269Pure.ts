// Generischer Konverter für „reines“ ED-269 (UASZoneVersion-Objekte mit
// `geometry[]` = AirspaceVolumes) in GeoJSON-Features mit genau der
// Property-Form, die client/lib/ed269.ts (parseEd269ToGeozoneInfo) liest:
// restriction (normalisiert), name, identifier/zoneId, lowerMeters/upperMeters
// (Meter), lowerReference/upperReference, message, reason (deutsch),
// applicability, zoneAuthority, extendedProperties …
//
// Genutzt von Finnland (Traficom) und Norwegen (dronesoner.no); auch für CH
// gedacht. Die Volumen-/Kontakt-Logik ist aus shared/belgianGeozones.ts
// (skeyesGeometryToGeoJson, skeyesVolumeAltitudeMeters, skeyesContact)
// übernommen und verallgemeinert – die belgische Datei bleibt unverändert.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

import { normalizeEd269Restriction } from "./ed269Restriction";

export type Ed269PureFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, any>;
};

const FT_TO_M = 0.3048;
// ~FL600 (60 000 ft) – Werte darüber gelten als „unbegrenzt“ (CH nutzt 99999).
const UNLIMITED_M = 18288;
// Anzahl Segmente, mit denen ED-269-Kreise als Polygon angenähert werden.
export const ED269_CIRCLE_SEGMENTS = 48;

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

/**
 * ED-269-Höhenwert (lowerLimit/upperLimit + uomDimensions) in Meter.
 * `null`/leer/unlesbar -> undefined (der Aufrufer entscheidet: Untergrenze
 * = SFC/0, Obergrenze = unbegrenzt). FT -> m, FL -> 100 ft, sehr große Werte
 * (≥ FL600) -> unbegrenzt (undefined). Klartext SFC/GND -> 0, UNL -> undefined.
 */
export function ed269VolumeLimitMeters(limit: unknown, uom: unknown): number | undefined {
  if (limit == null || limit === "") return undefined;
  const s = String(limit).trim().toUpperCase();
  if (s === "SFC" || s === "GND") return 0;
  if (s === "UNL" || s === "UNLIMITED") return undefined;
  const value = Number(limit);
  if (!Number.isFinite(value)) return undefined;
  const u = String(uom ?? "").toUpperCase().trim();
  let meters: number;
  if (u === "FT" || u === "F" || u === "FEET") meters = value * FT_TO_M;
  else if (u === "FL") meters = value * 100 * FT_TO_M;
  else meters = value; // "M" bzw. Default: bereits Meter.
  if (meters >= UNLIMITED_M) return undefined;
  if (meters <= 0) return 0;
  return Math.round(meters * 10) / 10;
}

/** Höhenbezug normalisieren: AGL/SFC/GND -> "AGL", AMSL/MSL/ALT -> "AMSL". */
export function ed269VerticalReference(ref: unknown): string | undefined {
  const r = String(ref ?? "").trim().toUpperCase();
  if (!r) return undefined;
  if (r === "AGL" || r === "SFC" || r === "GND" || r === "HEI") return "AGL";
  if (r === "AMSL" || r === "MSL" || r === "ALT") return "AMSL";
  return r; // z. B. STD (Flugfläche) unverändert
}

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------

/**
 * Kreis (Mittelpunkt [lon, lat], Radius in Metern) als geschlossener
 * GeoJSON-Polygonring mit `segments` Segmenten (sphärische Näherung).
 */
export function ed269CircleToPolygon(
  center: [number, number],
  radiusM: number,
  segments: number = ED269_CIRCLE_SEGMENTS,
): number[][][] {
  const [lon, lat] = center;
  const R = 6371008.8;
  const d = radiusM / R;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const ring: number[][] = [];
  for (let i = 0; i < segments; i++) {
    const brg = (2 * Math.PI * i) / segments;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 =
      lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return [ring];
}

/**
 * horizontalProjection eines Volumens -> Liste von GeoJSON-Polygon-Koordinaten
 * (je Polygon: [Außenring, Löcher…]). Unterstützt Polygon, MultiPolygon und
 * Circle ({type:"Circle", center:[lon,lat], radius} – ED-269; tolerant auch
 * `coordinates` statt `center` und `radius` in Metern).
 */
export function ed269ProjectionToPolygons(hp: any): number[][][][] {
  if (!hp || typeof hp !== "object") return [];
  const type = String(hp.type ?? "");
  if (type === "Polygon" && Array.isArray(hp.coordinates)) return [hp.coordinates];
  if (type === "MultiPolygon" && Array.isArray(hp.coordinates)) return hp.coordinates.filter(Array.isArray);
  if (type === "Circle" || (type === "Point" && hp.radius != null)) {
    const c = Array.isArray(hp.center) ? hp.center : hp.coordinates;
    const radius = Number(hp.radius);
    if (!Array.isArray(c) || c.length < 2 || !Number.isFinite(radius) || radius <= 0) return [];
    const lon = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
    return [ed269CircleToPolygon([lon, lat], radius)];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

export const ED269_REASON_LABELS_DE: Record<string, string> = {
  AIR_TRAFFIC: "Luftverkehr",
  SENSITIVE: "Sensibles Gebiet",
  PRIVACY: "Privatsphäre",
  POPULATION: "Menschenansammlung / Bevölkerung",
  NATURE: "Naturschutz",
  NOISE: "Lärmschutz",
  FOREIGN_TERRITORY: "Fremdes Hoheitsgebiet",
  EMERGENCY: "Notfall / Einsatz",
  OTHER: "Sonstiges",
};

/** reason[] (ED-269-Codes) -> deutsche, kommagetrennte Bezeichnung. */
export function ed269ReasonLabel(reason: unknown): string | undefined {
  const list = Array.isArray(reason) ? reason : reason == null ? [] : [reason];
  const labels = list
    .map((r) => String(r ?? "").trim().toUpperCase())
    .filter(Boolean)
    .map((r) => ED269_REASON_LABELS_DE[r] ?? r);
  const uniq = [...new Set(labels)];
  return uniq.length > 0 ? uniq.join(", ") : undefined;
}

export function stripEd269Html(s: string): string {
  return String(s ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type Ed269Contact = { name?: string; contactName?: string; phone?: string; email?: string; url?: string };

/**
 * zoneAuthority[] -> erster brauchbarer Kontakt (wie skeyesContact in
 * belgianGeozones.ts). Name/Webseite zeigt ed269SourceInfo bereits an; hier
 * zählen vor allem Ansprechpartner, Telefon und E-Mail.
 */
export function ed269AuthorityContact(zoneAuthority: unknown): Ed269Contact | undefined {
  const list = Array.isArray(zoneAuthority) ? zoneAuthority : zoneAuthority ? [zoneAuthority] : [];
  const a: any = list.find(
    (x: any) => x && typeof x === "object" && (x.email || x.phone || x.siteURL || x.name || x.contactName),
  );
  if (!a) return undefined;
  const out: Ed269Contact = {};
  const name = String(a.name || a.service || "").trim();
  const contactName = String(a.contactName || "").trim();
  const phone = String(a.phone || "").trim();
  const email = String(a.email || "").trim();
  const url = String(a.siteURL || "").trim();
  if (name) out.name = name;
  if (contactName) out.contactName = contactName;
  if (phone) out.phone = phone;
  if (email) out.email = email;
  if (url) out.url = url;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Kontaktzeile „Ansprechpartner · Telefon · E-Mail“ (ohne reinen Behördennamen). */
export function ed269ContactLine(c: Ed269Contact | undefined): string | undefined {
  if (!c) return undefined;
  const parts = [c.contactName, c.phone, c.email].filter((p): p is string => !!p && p.length > 0);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// ---------------------------------------------------------------------------
// Konvertierung
// ---------------------------------------------------------------------------

export interface Ed269PureOptions {
  /** Quellenlabel, landet in properties.source. */
  source?: string;
  /**
   * Eigene Einstufung (Länderregeln). Erhält die Roh-Zone, liefert den
   * Restriction-Schlüssel. Default: normalizeEd269Restriction(zone.restriction).
   */
  restriction?: (zone: any) => string;
  /** Zusätzliche Textzeilen VOR der Original-Meldung (z. B. Länderhinweise). */
  messagePrefix?: (zone: any) => string[];
  /** Zusätzliche Textzeilen NACH der Original-Meldung. */
  messageSuffix?: (zone: any) => string[];
  /** Ersetzt/ergänzt applicability (z. B. FI: Verordnungsperiode entfernen). */
  applicability?: (zone: any) => any[] | undefined;
  /** Weitere Properties (werden zuletzt gemischt). */
  extraProps?: (zone: any) => Record<string, any>;
}

type VolumeGroup = {
  lowerMeters: number;
  upperMeters: number | undefined;
  lowerReference?: string;
  upperReference?: string;
  polygons: number[][][][];
};

/**
 * Gruppiert die Volumes nach identischen Höhen/Bezügen. Jede Gruppe wird ein
 * Feature (Polygon bzw. MultiPolygon). parseEd269ToGeozoneInfo kennt nur EIN
 * Höhenband pro Feature, daher werden Volumes mit unterschiedlichen Höhen
 * getrennt; gleiche Höhen (Norwegen: bis zu 119 Teilflächen) werden zu einem
 * MultiPolygon zusammengefasst.
 */
export function ed269GroupVolumes(volumes: unknown): VolumeGroup[] {
  if (!Array.isArray(volumes)) return [];
  const groups = new Map<string, VolumeGroup>();
  for (const v of volumes as any[]) {
    const polys = ed269ProjectionToPolygons(v?.horizontalProjection);
    if (polys.length === 0) continue;
    const lowerMeters = ed269VolumeLimitMeters(v?.lowerLimit, v?.uomDimensions) ?? 0;
    const upperMeters = ed269VolumeLimitMeters(v?.upperLimit, v?.uomDimensions);
    const lowerReference = ed269VerticalReference(v?.lowerVerticalReference);
    const upperReference = ed269VerticalReference(v?.upperVerticalReference);
    const key = [lowerMeters, upperMeters ?? "UNL", lowerReference ?? "", upperReference ?? ""].join("|");
    let g = groups.get(key);
    if (!g) {
      g = { lowerMeters, upperMeters, lowerReference, upperReference, polygons: [] };
      groups.set(key, g);
    }
    g.polygons.push(...polys);
  }
  return [...groups.values()];
}

/**
 * Wandelt EINE UASZoneVersion in ein oder mehrere GeoJSON-Features um.
 * Untergrenze null -> 0 (SFC), Obergrenze null -> unbegrenzt (upperMeters fehlt).
 */
export function ed269ZoneToFeatures(zone: any, opts: Ed269PureOptions = {}): Ed269PureFeature[] {
  if (!zone || typeof zone !== "object") return [];
  const groups = ed269GroupVolumes(zone.geometry);
  if (groups.length === 0) return [];

  const identifier = String(zone.identifier ?? "").trim();
  const name = String(zone.name ?? "").trim() || identifier || "Geozone";
  const rawRestriction =
    zone.restriction && typeof zone.restriction === "object" ? zone.restriction.type : zone.restriction;
  const restriction = opts.restriction
    ? opts.restriction(zone)
    : normalizeEd269Restriction(String(rawRestriction ?? ""));
  const contact = ed269AuthorityContact(zone.zoneAuthority);
  const contactLine = ed269ContactLine(contact);
  const reasonLabel = ed269ReasonLabel(zone.reason);

  const lines: string[] = [];
  if (opts.messagePrefix) lines.push(...opts.messagePrefix(zone).filter(Boolean));
  const original = stripEd269Html(String(zone.message ?? ""));
  if (original) lines.push(original);
  if (opts.messageSuffix) lines.push(...opts.messageSuffix(zone).filter(Boolean));
  if (contactLine) lines.push(`Kontakt: ${contactLine}`);
  const message = lines.join("\n");

  const applicability = opts.applicability ? opts.applicability(zone) : zone.applicability;

  const base: Record<string, any> = {
    identifier: identifier || undefined,
    name,
    type: zone.type ?? undefined,
    restriction,
  };
  if (String(rawRestriction ?? "") !== restriction) base.originalRestriction = rawRestriction ?? null;
  if (reasonLabel) base.reason = reasonLabel;
  if (Array.isArray(zone.reason) && zone.reason.length > 0) base.reasonCodes = zone.reason;
  if (message) base.message = message;
  if (Array.isArray(applicability) && applicability.length > 0) base.applicability = applicability;
  if (zone.zoneAuthority != null) base.zoneAuthority = zone.zoneAuthority;
  if (contact) base.contact = contact;
  if (contact?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) base.contactEmail = contact.email;
  if (zone.extendedProperties != null) base.extendedProperties = zone.extendedProperties;
  if (zone.restrictionConditions != null) base.restrictionConditions = zone.restrictionConditions;
  if (zone.otherReasonInfo != null) base.otherReasonInfo = zone.otherReasonInfo;
  if (zone.regulationExemption != null) base.regulationExemption = zone.regulationExemption;
  if (zone.country != null) base.zoneCountry = zone.country;
  if (opts.source) base.source = opts.source;
  const extra = opts.extraProps ? opts.extraProps(zone) : undefined;

  return groups.map((g, idx) => {
    const properties: Record<string, any> = { ...base, lowerMeters: g.lowerMeters };
    if (g.upperMeters != null) properties.upperMeters = g.upperMeters;
    if (g.lowerReference) properties.lowerReference = g.lowerReference;
    if (g.upperReference) properties.upperReference = g.upperReference;
    const id = identifier || name;
    properties.zoneId = groups.length > 1 ? `${id}#${idx + 1}` : id;
    if (extra) Object.assign(properties, extra);
    for (const k of Object.keys(properties)) if (properties[k] === undefined) delete properties[k];
    const geometry =
      g.polygons.length === 1
        ? { type: "Polygon", coordinates: g.polygons[0] }
        : { type: "MultiPolygon", coordinates: g.polygons };
    return { type: "Feature" as const, geometry, properties };
  });
}

/**
 * Wandelt eine Liste von UASZoneVersions um. Akzeptiert ein nacktes Array (NO),
 * `{features:[…]}` (FI/CH) oder `{items:[{zone}]}` (skeyes). Doppelte
 * zoneIds (gleiche Kennung mehrfach im Feed, z. B. FI EFUTUASC3 für Werktag/
 * Wochenende) werden mit „#n“ eindeutig gemacht, statt verworfen.
 */
export function ed269ZonesToFeatures(input: unknown, opts: Ed269PureOptions = {}): Ed269PureFeature[] {
  const zones = ed269ExtractZones(input);
  const out: Ed269PureFeature[] = [];
  const seen = new Map<string, number>();
  for (const z of zones) {
    for (const f of ed269ZoneToFeatures(z, opts)) {
      const id = String(f.properties.zoneId ?? "");
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n > 0) f.properties.zoneId = `${id}~${n + 1}`;
      out.push(f);
    }
  }
  return out;
}

/** Zonen-Array aus den üblichen Hüllen ziehen. */
export function ed269ExtractZones(input: unknown): any[] {
  if (Array.isArray(input)) return input.map((x: any) => (x && x.zone ? x.zone : x));
  const o = input as any;
  if (o && Array.isArray(o.features)) return o.features;
  if (o && Array.isArray(o.items)) return o.items.map((x: any) => (x && x.zone ? x.zone : x));
  return [];
}
