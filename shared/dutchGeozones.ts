// Niederländische Geozonen aus GoDrone (LVNL / Altitude Angel) –
// Normalisierung auf das ED-269-nahe Format der App (analog belgianGeozones.ts).
// Siehe docs/godrone-api-integration.md.
//
// Bewusst frei von React-Native-Importen, damit die Normalisierung unter
// tsx/Node testbar bleibt.

export const GODRONE_GEOZONE_SOURCE_LABEL = "LVNL / GoDrone (Altitude Angel)";
export const GODRONE_ATTRIBUTION = "© LVNL / Altitude Angel";

export type GodroneAltitude = { datum?: string | null; meters?: number | null; feet?: number | null } | null | undefined;

export type GodroneFeature = {
  type: "Feature";
  id?: string | number;
  geometry: { type: string; coordinates: any } | null;
  properties: Record<string, any>;
  bbox?: [number, number, number, number];
};

/** Höhe in Metern; null/„Unlimited“ = unbegrenzt (undefined), Sfc = 0. */
export function godroneAltitudeMeters(alt: GodroneAltitude): number | undefined {
  if (!alt) return undefined;
  const datum = String(alt.datum ?? "").toLowerCase();
  if (datum === "unlimited") return undefined;
  if (datum === "sfc" && (alt.meters == null || alt.meters === 0)) return 0;
  const m = Number(alt.meters);
  if (!Number.isFinite(m)) return undefined;
  if (m >= 1e7) return undefined; // 1e8 = unbegrenzt
  return Math.round(m * 10) / 10;
}

/** Lesbarer Höhenbezug. */
export function godroneAltitudeReference(alt: GodroneAltitude): string | null {
  const datum = String(alt?.datum ?? "").toLowerCase();
  if (datum === "agl") return "über Grund (AGL)";
  if (datum === "msl") return "über MSL (AMSL)";
  if (datum === "sps") return "Flugfläche (STD)";
  if (datum === "sfc") return "ab Boden (SFC)";
  if (datum === "unlimited") return "unbegrenzt";
  return null;
}

/**
 * Einstufung nach docs/godrone-api-integration.md §3.5.
 * Unbekannte Kategorien werden vorsichtig als „bedingt“ (Warnung) behandelt.
 */
export function godroneRestriction(props: Record<string, any>): string {
  const dc = String(props?.detailedCategory ?? "").toLowerCase();
  // Verbote
  if (dc === "uas:zone:prohibited" || dc === "aa:unmanned_airspace:prohibited") return "PROHIBITED";
  if (dc === "other:ifr_areas") return "PROHIBITED"; // Tiefflugrouten: verboten für die Open Category
  if (dc === "type:p" || dc === "type:atz_p" || dc === "class:tfr") return "PROHIBITED";
  // Genehmigung / Freigabe nötig
  if (dc === "uas:zone:authorization" || dc === "uas:zone:conditional") return "REQ_AUTHORISATION";
  if (dc === "type:ctr" || dc === "type:atz" || dc === "type:htz") return "REQ_AUTHORISATION";
  // Beschränkt (Sperr-/Übungsgebiete)
  if (dc === "type:r" || dc === "lvnl:restricted" || dc === "type:tsa" || dc === "type:tra" || dc === "type:protect") return "RESTRICTED";
  if (dc === "type:ras" || dc === "type:nas") return "RESTRICTED";
  // Naturschutz
  if (dc === "lvnl:natura2000" || dc.includes("nature")) return "NATURE";
  // Bedingt / Warnung
  if (dc === "aa:unmanned_airspace:limitedallowed") return "CONDITIONAL";
  if (dc === "type:d" || dc === "type:d_other") return "CONDITIONAL";
  if (dc.startsWith("risk:")) return "CONDITIONAL";
  if (dc === "class:nav_warning") return "CONDITIONAL";
  // Reine Luftraum-Information (Untergrenze meist weit über 120 m)
  if (dc.startsWith("class:") || dc === "type:tma" || dc === "type:tma_p" || dc === "type:cta" || dc === "type:class" || dc === "other:atc_area") {
    return "NO_RESTRICTION";
  }
  return "CONDITIONAL";
}

const TYPE_LABELS: Record<string, string> = {
  "uas:zone:prohibited": "UAS-Zone – verboten",
  "uas:zone:conditional": "UAS-Zone – nur unter Bedingungen",
  "type:ctr": "Kontrollzone (CTR)",
  "type:tsa": "Zeitweise reserviertes Gebiet (TSA)",
  "type:ras": "Luftraum (RAS)",
  "type:nas": "Luftraum (NAS)",
  "other:ifr_areas": "Tiefflugrouten/-gebiete (verboten für die Open Category)",
  "class:a": "Luftraum Klasse A",
  "class:c": "Luftraum Klasse C",
  "class:nav_warning": "Luftfahrthindernis / Warnung",
  "risk:increasedaerialactivity:airport": "Erhöhter Flugbetrieb (Hubschrauber-/Flugplatz)",
  "risk:increasedaerialactivity:helicopter": "Erhöhter Hubschrauberbetrieb",
  "risk:increasedaerialactivity:unusualactivity": "Besondere Flugaktivität",
  "aa:unmanned_airspace:prohibited": "Drohnenflug verboten",
  "aa:unmanned_airspace:limitedallowed": "Drohnenflug eingeschränkt erlaubt",
  "uas:zone:authorization": "UAS-Zone – Genehmigung nötig",
  "lvnl:natura2000": "Natura 2000 (Naturschutz)",
  "lvnl:restricted": "Beschränktes Gebiet (LVNL)",
  "type:atz": "Flugplatzverkehrszone (ATZ)",
  "type:atz_p": "Flugplatzverkehrszone (ATZ, verboten)",
  "type:htz": "Hubschrauber-Verkehrszone (HTZ)",
  "type:p": "Luftsperrgebiet (P)",
  "type:r": "Flugbeschränkungsgebiet (R)",
  "type:d": "Gefahrengebiet (D)",
  "type:d_other": "Gefahrengebiet",
  "type:tra": "Zeitweise reserviertes Gebiet (TRA)",
  "type:protect": "Schutzgebiet",
  "type:tma": "Nahverkehrsbereich (TMA)",
  "type:cta": "Kontrollbezirk (CTA)",
  "class:tfr": "Temporäre Flugbeschränkung",
  "other:atc_area": "Flugsicherungsbereich",
};

function typeLabel(props: Record<string, any>): string | null {
  const dc = String(props?.detailedCategory ?? "").toLowerCase();
  if (TYPE_LABELS[dc]) return TYPE_LABELS[dc];
  const disp = props?.display;
  if (disp?.detailedCategory) return String(disp.detailedCategory);
  return null;
}

/** Kreis (Mittelpunkt + Radius in Metern) als Polygon mit `steps` Segmenten. */
export function circlePolygon(lon: number, lat: number, radiusM: number, steps = 48): number[][][] {
  const R = 6371008.8;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const d = radiusM / R;
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return [ring];
}

/** Douglas-Peucker-Vereinfachung eines Rings (Toleranz in Grad). */
function simplifyRing(ring: number[][], tol: number): number[][] {
  if (ring.length <= 8) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

/** Vereinfacht Polygone (ca. 5 m Toleranz) – v. a. die sehr detailreichen Naturschutzgebiete. */
// Standard: KEINE Vereinfachung – die Zonen behalten die volle Genauigkeit der
// Originaldaten (Wunsch des Product Owners). Toleranz > 0 nur bei Bedarf.
export function simplifyGeometry(g: { type: string; coordinates: any }, tolDeg = 0): { type: string; coordinates: any } {
  if (!(tolDeg > 0)) return g;
  if (g.type === "Polygon") return { type: g.type, coordinates: g.coordinates.map((r: number[][]) => simplifyRing(r, tolDeg)) };
  if (g.type === "MultiPolygon") {
    return { type: g.type, coordinates: g.coordinates.map((poly: number[][][]) => poly.map((r) => simplifyRing(r, tolDeg))) };
  }
  return g;
}

function stripHtml(s: string): string {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+\n/g, "\n").trim();
}

function buildMessage(props: Record<string, any>): string | null {
  const lines: string[] = [];
  const sections = Array.isArray(props?.display?.sections) ? props.display.sections : [];
  for (const s of sections) {
    const text = s?.text ? stripHtml(String(s.text)) : "";
    if (!text) continue;
    const title = String(s?.displayTitle ?? s?.title ?? "").trim();
    lines.push(title && title !== "Summary" ? `${title}: ${text}` : text);
  }
  const utm = props?.utmStatus;
  if (utm) {
    const title = utm?.title ?? utm?.utm?.title ?? utm?.utm?.displayName;
    if (title) lines.push(String(title));
    const url = utm?.utm?.externalUrl ?? utm?.externalUrl;
    if (url) lines.push(String(url));
  }
  return lines.length ? lines.join("\n") : null;
}

/**
 * Wandelt ein GoDrone-Feature in das App-Format. Bodengefahren (OSM-Objekte)
 * und Grenzen werden verworfen; Punkte mit Radius werden zu Kreis-Polygonen.
 */
export function normalizeGodroneFeature(f: GodroneFeature): GodroneFeature | null {
  if (!f || !f.geometry) return null;
  const p: Record<string, any> = f.properties || {};
  const category = String(p.category ?? "").toLowerCase();
  if (category === "groundhazard" || category === "boundary") return null;

  let geometry = f.geometry;
  if (geometry.type === "Point") {
    const r = Number(p.radius);
    const c = geometry.coordinates;
    if (!Number.isFinite(r) || r <= 0 || !Array.isArray(c)) return null;
    geometry = { type: "Polygon", coordinates: circlePolygon(Number(c[0]), Number(c[1]), r) };
  } else if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return null;
  }

  const restriction = godroneRestriction(p);
  const designator = String(p.designator ?? "").trim();
  const rawName = String(p.name ?? "").trim();
  const name = rawName || designator || "Geozone";
  const lowerMeters = godroneAltitudeMeters(p.altitudeFloor) ?? 0;
  const upperMeters = godroneAltitudeMeters(p.altitudeCeiling);
  const label = typeLabel(p);
  const ref = godroneAltitudeReference(p.altitudeCeiling ?? p.altitudeFloor);

  const detail: string[] = [];
  if (label) detail.push(`Typ: ${label}`);
  if (designator && designator !== name) detail.push(`Code: ${designator}`);
  if (ref) detail.push(`Höhenbezug: ${ref}`);
  const msg = buildMessage(p);
  if (msg) detail.push(msg);

  const out: Record<string, any> = {
    identifier: p.airspaceId ?? f.id ?? designator,
    uniqueIdentifier: f.id != null ? String(f.id) : undefined,
    name,
    restriction,
    lowerMeters,
    country: "NLD",
    detailedCategory: p.detailedCategory,
    airspaceType: p.airspaceType ?? null,
    airspaceClass: p.airspaceClass ?? null,
    hazardFactorName: p.hazardFactorName ?? null,
    source: GODRONE_GEOZONE_SOURCE_LABEL,
  };
  if (upperMeters != null) out.upperMeters = upperMeters;
  if (label) out.typeLabel = label;
  if (detail.length) out.message = detail.join("\n");
  if (p.altitudeFloor?.datum) out.lowerReference = String(p.altitudeFloor.datum).toUpperCase();
  if (p.altitudeCeiling?.datum) out.upperReference = String(p.altitudeCeiling.datum).toUpperCase();
  // Gültigkeit: AIRAC-Ende bzw. operationalTo
  const end = p.operationalTo ?? (p.airac?.to ? `${p.airac.to}T00:00:00Z` : null);
  if (end) {
    const ts = new Date(end).getTime();
    if (Number.isFinite(ts)) out.validEndTs = ts;
  }
  if (p.airac?.from) {
    const ts = new Date(`${p.airac.from}T00:00:00Z`).getTime();
    if (Number.isFinite(ts)) out.validStartTs = ts;
  }

  return { type: "Feature", id: f.id, geometry: simplifyGeometry(geometry), properties: out };
}

/** Entfernt Doppelte über `feature.id` (Kacheln überlappen). */
export function dedupeGodroneFeatures(features: GodroneFeature[]): GodroneFeature[] {
  const seen = new Set<string>();
  const out: GodroneFeature[] = [];
  for (const f of features || []) {
    const key = String(f?.id ?? f?.properties?.uniqueIdentifier ?? "");
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(f);
  }
  return out;
}

/** true, wenn die Antwort die Luftraum-Ebene wegen zu großer Box weggelassen hat. */
export function godroneAirspaceExcluded(body: any): boolean {
  const ex = Array.isArray(body?.excludedData) ? body.excludedData : [];
  return ex.some((e: any) => String(e?.detail?.name ?? "").toLowerCase() === "airspace");
}

/** Abfrage-Kacheln (1°×1°) für die Niederlande, nur Kacheln mit Landanteil. */
export const NL_QUERY_BOUNDS = { w: 3.3, s: 50.7, e: 7.3, n: 53.6 };
