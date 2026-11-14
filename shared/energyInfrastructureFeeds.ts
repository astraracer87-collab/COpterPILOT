import type { GeoJsonGeometryLike, InfrastructureKind } from "./germanEnergyInfrastructure";

export type OfficialAssetFeature = {
  id: string;
  kind: InfrastructureKind;
  name: string;
  geometry: GeoJsonGeometryLike;
  source: "RIVM" | "BFE" | "ACT" | "IGN" | "NGI";
  taggedHeightM: number | null;
  hubHeightM: number | null;
  rotorDiameterM: number | null;
  operatorName: string | null;
  voltage: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validGeometry(value: unknown): GeoJsonGeometryLike | null {
  const geometry = asRecord(value);
  return geometry && typeof geometry.type === "string"
    ? geometry as GeoJsonGeometryLike
    : null;
}

function parseHeight(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isIgnFranceLineVoltageComparable(voltage: string | null | undefined): boolean {
  if (!voltage?.trim()) return false;
  const levels = voltage.split(/[;,/]/).map((raw) => {
    const value = raw.trim().replace(",", ".");
    const match = value.match(/^(\d+(?:\.\d+)?)\s*(kv|v)?$/i);
    if (!match) return null;
    const numericValue = Number(match[1]);
    return (match[2]?.toLowerCase() === "kv" ? numericValue : numericValue / 1000);
  });
  return levels.length > 0 && levels.every((level) => level !== null && level > 50);
}

export function isOsmInfrastructureComparable(
  kind: InfrastructureKind,
  powerTag: string,
): boolean {
  if (kind === "wind_turbine") return true;
  if (kind === "power_line") return powerTag === "line";
  return powerTag === "tower";
}

export function normalizeNgiBelgiumFeatures(
  rawLines: unknown[],
  rawPylons: unknown[],
): OfficialAssetFeature[] {
  const normalized: OfficialAssetFeature[] = [];
  const seen = new Set<string>();
  const isValidLineGeometry = (geometry: GeoJsonGeometryLike): boolean => {
    const lines = geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString"
        ? geometry.coordinates
        : null;
    return Array.isArray(lines) && lines.length > 0 && lines.every((line) =>
      Array.isArray(line) && line.length >= 2 && line.every((point) =>
        Array.isArray(point) &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]) &&
        Math.abs(Number(point[0])) <= 180 &&
        Math.abs(Number(point[1])) <= 90,
      ),
    );
  };

  for (const [kind, rows] of [["power_line", rawLines], ["power_mast", rawPylons]] as const) {
    for (const raw of rows) {
      const row = asRecord(raw);
      const properties = asRecord(row?.properties) ?? row ?? {};
      const geometry = validGeometry(row?.geometry);
      const validGeometryForKind = kind === "power_line"
        ? !!geometry && isValidLineGeometry(geometry)
        : geometry?.type === "Point" &&
          Array.isArray(geometry.coordinates) &&
          Number.isFinite(geometry.coordinates[0]) &&
          Number.isFinite(geometry.coordinates[1]) &&
          Math.abs(Number(geometry.coordinates[0])) <= 180 &&
          Math.abs(Number(geometry.coordinates[1])) <= 90;
      const featureId = String(row?.id ?? properties.fid ?? "").trim();
      if (!row || !geometry || !validGeometryForKind || !featureId) continue;
      const id = `ngi-be:${kind}:${featureId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      normalized.push({
        id,
        kind,
        name: kind === "power_line" ? "Hochspannungsleitung" : "Hochspannungsmast",
        geometry,
        source: "NGI",
        taggedHeightM: kind === "power_mast" ? parseHeight(properties.height) : null,
        hubHeightM: null,
        rotorDiameterM: null,
        operatorName: null,
        // NGI's nominaltension field uses small coded values rather than an
        // explicitly documented voltage unit, so do not present it as kV.
        voltage: null,
      });
    }
  }
  return normalized;
}

export function normalizeRivmWindFeatures(rawFeatures: unknown[]): OfficialAssetFeature[] {
  const normalized: OfficialAssetFeature[] = [];
  const seen = new Set<string>();
  for (const raw of rawFeatures) {
    const feature = asRecord(raw);
    const properties = asRecord(feature?.properties);
    const geometry = validGeometry(feature?.geometry);
    if (!feature || !properties || geometry?.type !== "Point") continue;
    const coordinates = geometry.coordinates;
    if (!Array.isArray(coordinates) || !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1]) || Math.abs(Number(coordinates[0])) > 180 ||
      Math.abs(Number(coordinates[1])) > 90) continue;
    const id = String(feature.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const hubHeightM = parseHeight(properties.ash);
    const rotorDiameterM = parseHeight(properties.diam);
    normalized.push({
      id: `rivm:${id}`,
      kind: "wind_turbine",
      name: String(properties.naam ?? properties.wt_type ?? "Windkraftanlage").trim() || "Windkraftanlage",
      geometry,
      source: "RIVM",
      taggedHeightM: hubHeightM,
      hubHeightM,
      rotorDiameterM,
      operatorName: null,
      voltage: null,
    });
  }
  return normalized;
}

export function normalizeBfeFeatures(
  rawResults: unknown[],
  kind: "wind" | "power",
): OfficialAssetFeature[] {
  const normalized: OfficialAssetFeature[] = [];
  const seen = new Set<string>();
  for (const raw of rawResults) {
    const result = asRecord(raw);
    const properties = asRecord(result?.properties) ?? {};
    const geometry = validGeometry(result?.geometry);
    if (!result || !geometry) continue;
    let featureKind: InfrastructureKind | null = null;
    if (kind === "wind" && geometry.type === "Point") featureKind = "wind_turbine";
    if (kind === "power" && ["LineString", "MultiLineString"].includes(geometry.type)) {
      featureKind = "power_line";
    }
    if (kind === "power" && geometry.type === "Point" && properties.masttyp) {
      featureKind = "power_mast";
    }
    if (!featureKind) continue;

    const featureId = String(result.featureId ?? result.id ?? "").trim();
    if (!featureId || seen.has(featureId)) continue;
    seen.add(featureId);
    const hubHeightM = parseHeight(properties.tur_hubheight);
    const rotorDiameterM = parseHeight(properties.tur_diameter);
    normalized.push({
      id: `bfe:${kind}:${featureId}`,
      kind: featureKind,
      name: String(
        properties.fac_name ??
          properties.bezeichnung ??
          (featureKind === "wind_turbine"
            ? "Windenergieanlage"
            : featureKind === "power_line"
              ? "Stromleitung"
              : "Strommast"),
      ).trim(),
      geometry,
      source: "BFE",
      taggedHeightM: parseHeight(properties.hoehe),
      hubHeightM,
      rotorDiameterM,
      operatorName: String(properties.fac_operator ?? properties.eigentuemer ?? "").trim() || null,
      voltage: String(properties.spannung ?? "").trim() || null,
    });
  }
  return normalized;
}

export function normalizeLuxembourgFeatures(
  rawFeatures: unknown[],
  kind: "power_line" | "power_mast",
): OfficialAssetFeature[] {
  const normalized: OfficialAssetFeature[] = [];
  const seen = new Set<string>();
  for (const raw of rawFeatures) {
    const feature = asRecord(raw);
    const properties = asRecord(feature?.properties) ?? {};
    const geometry = validGeometry(feature?.geometry);
    const expectedGeometry = kind === "power_line"
      ? ["LineString", "MultiLineString"].includes(geometry?.type ?? "")
      : geometry?.type === "Point";
    if (!feature || !geometry || !expectedGeometry) continue;
    const featureId = String(feature.id ?? properties.gml_id ?? "").trim();
    if (!featureId || seen.has(featureId)) continue;
    seen.add(featureId);
    normalized.push({
      id: `act-lu:${featureId}`,
      kind,
      name: String(properties.gml_description ??
        (kind === "power_line" ? "Stromleitung" : "Strommast")).trim(),
      geometry,
      source: "ACT",
      taggedHeightM: null,
      hubHeightM: null,
      rotorDiameterM: null,
      operatorName: null,
      voltage: null,
    });
  }
  return normalized;
}

export function normalizeIgnFrancePowerFeatures(rawFeatures: unknown[]): OfficialAssetFeature[] {
  const normalized: OfficialAssetFeature[] = [];
  const seen = new Set<string>();
  const isValidLine = (line: unknown): boolean =>
    Array.isArray(line) &&
    line.length >= 2 &&
    line.every((point) =>
      Array.isArray(point) &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]) &&
      Math.abs(Number(point[0])) <= 180 &&
      Math.abs(Number(point[1])) <= 90,
    );
  for (const raw of rawFeatures) {
    const feature = asRecord(raw);
    const properties = asRecord(feature?.properties) ?? {};
    const geometry = validGeometry(feature?.geometry);
    if (!feature || !geometry ||
      (geometry.type === "LineString" && !isValidLine(geometry.coordinates)) ||
      (geometry.type === "MultiLineString" &&
        (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0 ||
          !geometry.coordinates.every(isValidLine))) ||
      !["LineString", "MultiLineString"].includes(geometry.type)) continue;
    const featureId = String(feature.id ?? properties.cleabs ?? "").trim();
    if (!featureId || seen.has(featureId)) continue;
    seen.add(featureId);
    normalized.push({
      id: `ign-fr:${featureId}`,
      kind: "power_line",
      name: String(properties.gestionnaire ?? "Stromleitung").trim() || "Stromleitung",
      geometry,
      source: "IGN",
      taggedHeightM: null,
      hubHeightM: null,
      rotorDiameterM: null,
      operatorName: String(properties.gestionnaire ?? "").trim() || null,
      voltage: String(properties.voltage ?? "").trim() || null,
    });
  }
  return normalized;
}

export function normalizeIgnFranceWindFeatures(rawFeatures: unknown[]): OfficialAssetFeature[] {
  const normalized: OfficialAssetFeature[] = [];
  const seen = new Set<string>();
  for (const raw of rawFeatures) {
    const feature = asRecord(raw);
    const properties = asRecord(feature?.properties) ?? {};
    const geometry = validGeometry(feature?.geometry);
    const coordinates = geometry?.coordinates;
    const kind = String(properties.nature ?? "")
      .trim()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    if (
      !feature ||
      !geometry ||
      geometry.type !== "Point" ||
      kind !== "eolienne" ||
      !Array.isArray(coordinates) ||
      !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1]) ||
      Math.abs(Number(coordinates[0])) > 180 ||
      Math.abs(Number(coordinates[1])) > 90
    ) continue;
    const featureId = String(feature.id ?? properties.cleabs ?? "").trim();
    if (!featureId || seen.has(featureId)) continue;
    seen.add(featureId);
    const height = parseHeight(properties.hauteur);
    normalized.push({
      id: `ign-fr-wind:${featureId}`,
      kind: "wind_turbine",
      name: String(properties.toponyme ?? "Windkraftanlage").trim() || "Windkraftanlage",
      geometry,
      source: "IGN",
      taggedHeightM: height,
      hubHeightM: null,
      rotorDiameterM: null,
      operatorName: null,
      voltage: null,
    });
  }
  return normalized;
}

export function isIgnFranceWfsTimestampFresh(
  value: unknown,
  nowMs: number,
  maxAgeMs = 24 * 60 * 60 * 1000,
): value is string {
  if (typeof value !== "string") return false;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) &&
    timestampMs <= nowMs + 5 * 60 * 1000 &&
    timestampMs >= nowMs - maxAgeMs;
}

export function isIgnFranceWindQueryComplete(
  rawFeatures: unknown[],
  numberMatched: number,
  featureLimit: number,
  normalizedFeatures: OfficialAssetFeature[],
): boolean {
  if (
    !Number.isFinite(numberMatched) ||
    rawFeatures.length >= featureLimit ||
    numberMatched !== rawFeatures.length
  ) return false;
  const windFeatureCount = rawFeatures.filter((raw) => {
    const feature = asRecord(raw);
    const properties = asRecord(feature?.properties);
    return String(properties?.nature ?? "")
      .trim()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase() === "eolienne";
  }).length;
  return windFeatureCount === normalizedFeatures.length;
}
