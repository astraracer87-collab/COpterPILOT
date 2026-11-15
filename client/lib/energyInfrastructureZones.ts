import type { GeozoneFeatureInfo } from "../../shared/geozoneFeatureInfo";
import { getInfrastructureFlightGuidance, infrastructureFlightGuidanceText, infrastructureFlightGuidanceLinks } from "../../shared/energyInfrastructureFlightRules";
import { getGermanWindFacility100mPoints, distanceMetersBetween, type EnergyFacility100mPoint, type GermanEnergyInfrastructureItem, type GeoJsonGeometryLike } from "../../shared/germanEnergyInfrastructure";
import { RESTRICTION_POLICY } from "../../shared/restrictionPolicy";

export type InfrastructureMapGeometry = {
  points: [number, number][];
  lines: [number, number][][];
  polygons: [number, number][][][];
};

/** Real source geometry, in Leaflet order. Never invent a foreign safety radius. */
export function infrastructureMapGeometry(geometry?: GeoJsonGeometryLike): InfrastructureMapGeometry {
  const out: InfrastructureMapGeometry = { points: [], lines: [], polygons: [] };
  const position = (p: unknown): [number, number] | null =>
    Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" &&
    Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90
      ? [p[1], p[0]] : null;
  const line = (value: unknown): [number, number][] =>
    Array.isArray(value) ? value.map(position).filter((p): p is [number, number] => p !== null) : [];
  const polygon = (value: unknown) => {
    if (!Array.isArray(value)) return;
    const rings = value.map(line);
    if (rings[0]?.length >= 3) out.polygons.push(rings.filter((ring) => ring.length >= 3));
  };
  const visit = (g?: GeoJsonGeometryLike) => {
    if (!g) return;
    const coordinates = g.coordinates;
    switch (g.type) {
      case "Point": { const p = position(coordinates); if (p) out.points.push(p); break; }
      case "MultiPoint": out.points.push(...line(coordinates)); break;
      case "LineString": { const points = line(coordinates); if (points.length >= 2) out.lines.push(points); break; }
      case "MultiLineString":
        if (Array.isArray(coordinates)) for (const raw of coordinates) {
          const points = line(raw); if (points.length >= 2) out.lines.push(points);
        }
        break;
      case "Polygon": polygon(coordinates); break;
      case "MultiPolygon": if (Array.isArray(coordinates)) coordinates.forEach(polygon); break;
      case "GeometryCollection": g.geometries?.forEach(visit); break;
    }
  };
  visit(geometry);
  return out;
}

/** All countries share presentation, but only Germany has the established §21h adapter. */
export function supplementalInfrastructureAsGeozones(
  countryIso: string | null | undefined,
  items: GermanEnergyInfrastructureItem[] = [],
): GeozoneFeatureInfo[] {
  const iso = countryIso?.toUpperCase();
  if (!iso) return [];
  if (iso === "DE") return [
    ...windFacilitiesAsGeozones(getGermanWindFacility100mPoints("DE", items), items),
    ...supplementalLinesAsGeozones(items.filter((item) => item.officialMatch === "not_found")),
  ];
  const grouped: GermanEnergyInfrastructureItem[][] = [];
  for (const item of items.filter((record) => record.officialMatch === "not_found")) {
    const candidate = infrastructureMapGeometry(item.geometry);
    if (!candidate.points.length && !candidate.lines.length && !candidate.polygons.length) continue;
    const existing = grouped.find((records) => {
      const first = records[0];
      if (first.kind !== item.kind) return false;
      if (item.geometry.type === "Point" && first.geometry.type === "Point") {
        const p = infrastructureMapGeometry(first.geometry).points[0], q = candidate.points[0];
        return p && q && distanceMetersBetween(p[0], p[1], q[0], q[1]) <= (first.source === item.source ? 10 : 100);
      }
      return JSON.stringify(first.geometry) === JSON.stringify(item.geometry);
    });
    if (existing) existing.push(item); else grouped.push([item]);
  }
  return grouped.map((records) => {
    const item = records.find((record) => record.source !== "OpenStreetMap") ?? records[0];
    const geometry = infrastructureMapGeometry(item.geometry);
    const label = item.kind === "wind_turbine" ? "Windkraftanlagen" : item.kind === "power_line" ? "Stromleitungen" : "Strommasten";
    const type = item.kind === "wind_turbine" ? "Windkraftanlage" : item.kind === "power_line" ? "Stromleitung" : "Strommast";
    const height = item.estimatedTipHeightM ?? item.taggedHeightM ??
      records.map((record) => record.estimatedTipHeightM ?? record.taggedHeightM).find((height) => Number.isFinite(height));
    const operatorName = item.operatorName ?? records.find((record) => record.operatorName)?.operatorName;
    const links: { label: string; url: string }[] = [];
    for (const [label, url] of [
      ["Anlagendetails", item.sourceRecordUrl],
      ["Betreiberprofil", item.operatorProfileUrl],
      ["Betreiber-Webseite", item.operatorContact?.website],
    ]) if (url && /^https?:\/\//i.test(url)) links.push({ label: label!, url });
    const flightGuidance = getInfrastructureFlightGuidance(iso, item.kind);
    if (flightGuidance) links.push(...infrastructureFlightGuidanceLinks(flightGuidance));
    return {
      featureId: `energy-zone:${iso}:${item.id}`,
      country: iso,
      layerLabel: label,
      name: item.name || type,
      informationalOnly: true,
      // Reiner Infrastrukturhinweis: Policy "nur Info" (Farbe bleibt Hinweis-Blau).
      restriction: "NO_RESTRICTION" as const,
      infrastructureFlightGuidance: flightGuidance,
      infrastructureGeometry: item.geometry,
      polygonGroups: geometry.polygons,
      polygonRings: geometry.polygons.flat(),
      strokeColor: "rgba(0,122,255,0.85)",
      fillColor: "rgba(0,122,255,0.15)",
      details: [
        `Typ: ${type}`,
        `Quelle: ${[...new Set(records.map((record) => record.source))].join(" · ")}`,
        "Einordnung: Infrastrukturhinweis",
        "Geometrie: Anlagenposition bzw. Verlauf laut Quelle",
        ...(Number.isFinite(height) ? [`Anlagenhöhe: ${Math.round(height!)} m`] : []),
        ...(operatorName ? [`Betreiber: ${operatorName}`] : []),
        ...(item.voltage ? [`Spannung: ${item.voltage}`] : []),
        ...(item.operatorContact?.email ? [`E-Mail: ${item.operatorContact.email}`] : []),
        ...(item.operatorContact?.phone ? [`Telefon: ${item.operatorContact.phone}`] : []),
      ].join("\n"),
      applicationText: flightGuidance
        ? infrastructureFlightGuidanceText(flightGuidance)
        : "Ergänzende Anlagendaten, keine amtlich festgelegte Zonengrenze. Maßgeblich bleiben die Geozonen und Regeln des jeweiligen Landes.",
      links,
    };
  });
}

/** Source records become ordinary zone data, not a second warning-card model. */
export function windFacilitiesAsGeozones(
  facilities: EnergyFacility100mPoint[],
  items: GermanEnergyInfrastructureItem[] = [],
): GeozoneFeatureInfo[] {
  return facilities.map((facility) => {
    const records = items.filter((item) => (facility.sourceIds ?? [facility.id]).includes(item.id));
    const record = records.find((item) => item.source === "MaStR") ?? records[0];
    const ring: [number, number][] = Array.from({ length: 65 }, (_, i) => {
      const angle = i * Math.PI * 2 / 64;
      return [
        facility.latitude + 100 * Math.cos(angle) / 111320,
        facility.longitude + 100 * Math.sin(angle) / (111320 * Math.cos(facility.latitude * Math.PI / 180)),
      ];
    });
    const height = record?.estimatedTipHeightM ?? record?.taggedHeightM;
    const sources = facility.sources ?? [facility.source];
    const details = [
      "Typ: Windkraftanlage",
      "Rechtshinweis: § 21h Abs. 3 Nr. 3 LuftVO",
      "Untere Grenze: 0 m AGL",
      `Quelle: ${sources.join(" · ")}`,
      "Geometrie: 100-m-Näherung ab Anlagenpunkt; maßgeblich ist die Anlagenbegrenzung",
      ...(Number.isFinite(height) ? [`Anlagenhöhe: ${Math.round(height!)} m`] : []),
      ...(record?.operatorName ? [`Betreiber: ${record.operatorName}`] : []),
      ...(record?.sourceRecordUrl ? [`Anlagendetails: ${record.sourceRecordUrl}`] : []),
      ...(record?.operatorProfileUrl ? [`Betreiberprofil: ${record.operatorProfileUrl}`] : []),
    ];
    return {
      featureId: `energy-zone:${facility.id}`,
      layerLabel: "Windkraftanlagen",
      name: facility.name,
      country: "DE",
      restriction: "REQ_AUTHORISATION",
      lowerMeters: 0,
      polygonRings: [ring],
      polygonGroups: [[ring]],
      strokeColor: RESTRICTION_POLICY.REQ_AUTHORISATION.stroke,
      fillColor: RESTRICTION_POLICY.REQ_AUTHORISATION.fill,
      details: details.join("\n"),
    };
  });
}

/** 100 m is a check extent, not a claim that OSM is an official legal boundary. */
export function supplementalLinesAsGeozones(items: GermanEnergyInfrastructureItem[]): GeozoneFeatureInfo[] {
  return items.filter((item) => item.kind === "power_line" && item.geometry.type === "LineString")
    .map((item) => {
      const coords = (Array.isArray(item.geometry.coordinates) ? item.geometry.coordinates as number[][] : [])
        .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
      const groups: [number, number][][][] = [];
      for (let i = 1; i < coords.length; i++) {
        const [ax, ay] = coords[i - 1], [bx, by] = coords[i];
        const lonScale = 111320 * Math.cos((ay + by) * Math.PI / 360);
        const heading = Math.atan2((by - ay) * 111320, (bx - ax) * lonScale);
        const ring: [number, number][] = [];
        for (const [lon, lat, start] of [[bx, by, heading - Math.PI / 2], [ax, ay, heading + Math.PI / 2]]) {
          for (let n = 0; n <= 12; n++) {
            const angle = start + n * Math.PI / 12;
            ring.push([lat + 100 * Math.sin(angle) / 111320, lon + 100 * Math.cos(angle) / lonScale]);
          }
        }
        ring.push(ring[0]);
        groups.push([ring]);
      }
      return {
        featureId: `energy-zone:${item.id}`,
        layerLabel: "Stromleitungen",
        name: item.name || "Stromleitung",
        country: "DE",
        restriction: "REQ_AUTHORISATION" as const,
        lowerMeters: 0,
        polygonGroups: groups,
        polygonRings: groups.map((group) => group[0]),
        strokeColor: RESTRICTION_POLICY.REQ_AUTHORISATION.stroke,
        fillColor: RESTRICTION_POLICY.REQ_AUTHORISATION.fill,
        details: [
          "Typ: Stromleitung",
          "Rechtshinweis: § 21h Abs. 3 Nr. 3 LuftVO",
          "Untere Grenze: 0 m AGL",
          `Quelle: ${item.source}`,
          ...(item.voltage ? [`Spannung: ${item.voltage}`] : []),
          ...(item.operatorName ? [`Betreiber: ${item.operatorName}`] : []),
          "Geometrie: 100-m-Näherung ab Leitungsverlauf; maßgeblich sind Anlagenbegrenzung und rechtliche Einstufung",
        ].join("\n"),
      };
    }).filter((zone) => zone.polygonGroups.length > 0);
}
