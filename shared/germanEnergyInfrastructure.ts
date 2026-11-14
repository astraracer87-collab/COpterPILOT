export type GeoJsonGeometryLike = {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometryLike[];
};

export type MastrWindTurbine = {
  id: string;
  name: string;
  operatorName?: string | null;
  operatorMastrNumber?: string | null;
  operatorProfileUrl?: string | null;
  sourceRecordUrl?: string | null;
  latitude: number;
  longitude: number;
  hubHeightM: number | null;
  rotorDiameterM: number | null;
  estimatedTipHeightM: number | null;
};

export type InfrastructureKind = "wind_turbine" | "power_line" | "power_mast";
export type InfrastructureSource = "MaStR" | "OpenStreetMap" | "RIVM" | "BFE" | "ACT" | "IGN" | "NGI";

export type OfficialMatchStatus = "matched" | "not_found" | "unknown";

export type PublicOperatorContact = {
  email?: string | null;
  phone?: string | null;
  website?: string | null;
};

export type GermanEnergyInfrastructureItem = {
  id: string;
  kind: InfrastructureKind;
  name: string;
  source: InfrastructureSource;
  geometry: GeoJsonGeometryLike;
  distanceMeters: number;
  officialMatch: OfficialMatchStatus;
  officialMatchDistanceMeters?: number;
  estimatedTipHeightM?: number | null;
  hubHeightM?: number | null;
  rotorDiameterM?: number | null;
  operatorName?: string | null;
  operatorMastrNumber?: string | null;
  operatorProfileUrl?: string | null;
  sourceRecordUrl?: string | null;
  operatorContact?: PublicOperatorContact | null;
  taggedHeightM?: number | null;
  voltage?: string | null;
};

export function isSupplementalEnergyInfrastructureItem(
  item: Pick<GermanEnergyInfrastructureItem, "officialMatch">,
): boolean {
  return item.officialMatch !== "matched";
}

export function isVerifiedMissingEnergyInfrastructureItem(
  item: Pick<GermanEnergyInfrastructureItem, "officialMatch">,
): boolean {
  return item.officialMatch === "not_found";
}

export function getRadarEnergyInfrastructureItems(
  enabled: boolean,
  items: GermanEnergyInfrastructureItem[] | null | undefined,
  sources: Partial<GermanEnergyInfrastructureResponse["sources"]> | null | undefined,
  statusKeyByKind:
    | Partial<Record<InfrastructureKind, keyof GermanEnergyInfrastructureResponse["sources"]>>
    | null
    | undefined,
): GermanEnergyInfrastructureItem[] {
  if (!enabled || !items || !sources || !statusKeyByKind) return [];
  return items.filter((item) => {
    if (item.officialMatch !== "not_found") return false;
    const statusKey = statusKeyByKind[item.kind];
    return !!statusKey && sources[statusKey]?.status === "available";
  });
}

export type EnergyFacility100mPoint = {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  source: InfrastructureSource;
  distanceMeters: number;
  sources?: InfrastructureSource[];
  sourceIds?: string[];
};

export function getGermanWindFacility100mPoints(
  countryIso: string | null | undefined,
  items: GermanEnergyInfrastructureItem[] | null | undefined,
): EnergyFacility100mPoint[] {
  if (countryIso !== "DE" || !items) return [];
  const points: EnergyFacility100mPoint[] = [];
  for (const item of items) {
    if (item.kind !== "wind_turbine" || item.geometry.type !== "Point") continue;
    if (item.officialMatch === "matched") continue;
    // MaStR ist ein eigenes amtliches Anlagenregister. OSM-Punkte bleiben
    // dagegen verborgen, solange der vergleichbare amtliche Zonenabgleich
    // unbekannt ist; sie erscheinen erst als bestätigte DIPUL-Lücken.
    if (item.source !== "MaStR" && item.officialMatch !== "not_found") continue;
    const coordinates = item.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180
    ) continue;
    if (items.some((other) => {
      if (other.kind !== "wind_turbine" || other.officialMatch !== "matched" || other.geometry.type !== "Point") return false;
      const p = other.geometry.coordinates;
      return Array.isArray(p) && distanceMetersBetween(latitude, longitude, Number(p[1]), Number(p[0])) <= (other.source === item.source ? 10 : 100);
    })) continue;
    // Registerkoordinaten und der OSM-Anlagenmittelpunkt können voneinander
    // abweichen. Niemals zwei getrennte Registeranlagen nur wegen ihrer Nähe
    // zusammenlegen; größere Toleranz ausschließlich zwischen Datenquellen.
    const existingIndex = points
      .map((point, index) => ({ index, distance: distanceMetersBetween(point.latitude, point.longitude, latitude, longitude), point }))
      .filter(({ point, distance }) => distance <= (point.source === item.source ? 10 : 100))
      .sort((a, b) => a.distance - b.distance)[0]?.index ?? -1;
    const candidate = {
      id: item.id,
      latitude,
      longitude,
      name: item.name || "Windkraftanlage",
      source: item.source,
      distanceMeters: item.distanceMeters,
      sources: [item.source],
      sourceIds: [item.id],
    };
    if (existingIndex < 0) {
      points.push(candidate);
    } else {
      const existing = points[existingIndex];
      const canonical = candidate.source === "MaStR" && existing.source !== "MaStR" ? candidate : existing;
      points[existingIndex] = {
        ...canonical,
        sources: [...new Set([...(existing.sources ?? [existing.source]), item.source])],
        sourceIds: [...new Set([...(existing.sourceIds ?? [existing.id]), item.id])],
      };
    }
  }
  return points;
}

export function classifyOfficialInfrastructureMatch(
  nearestDistanceMeters: number | null,
  sourceStatus: "available" | "partial" | "unavailable",
  thresholdMeters: number,
): OfficialMatchStatus {
  if (sourceStatus === "unavailable") return "unknown";
  if (nearestDistanceMeters !== null && nearestDistanceMeters <= thresholdMeters) {
    return "matched";
  }
  return sourceStatus === "available" ? "not_found" : "unknown";
}
export type InfrastructureSourceStatus = {
  status: "available" | "stale" | "partial" | "unavailable";
  updatedAt: string | null;
};

export type GermanEnergyInfrastructureResponse = {
  country: EnergyInfrastructureCountry;
  searchRadiusKm: number;
  features: GermanEnergyInfrastructureItem[];
  /** Nearby asset records retained from official inventories and fallback sources. */
  counts: {
    windTurbines: number;
    powerLines: number;
    powerMasts: number;
  };
  sources: {
    mastr: InfrastructureSourceStatus;
    officialWind: InfrastructureSourceStatus;
    officialPower: InfrastructureSourceStatus;
    openStreetMap: InfrastructureSourceStatus;
    rivm: InfrastructureSourceStatus;
    bfeWind: InfrastructureSourceStatus;
    bfePower: InfrastructureSourceStatus;
    actLuxembourg: InfrastructureSourceStatus;
    ignFranceWind: InfrastructureSourceStatus;
    ignFrancePower: InfrastructureSourceStatus;
    ngiBelgiumPower: InfrastructureSourceStatus;
  };
};

export function hasIncompleteEnergyInfrastructureSources(
  response: Pick<GermanEnergyInfrastructureResponse, "country" | "sources">,
): boolean {
  if (!response.country.hasComparableOfficialAssetLayers) {
    return response.sources.openStreetMap.status !== "available";
  }
  const comparisonKeys = [
    ...new Set(Object.values(response.country.assetComparisonStatusKeyByKind ?? {})),
  ];
  return response.sources.openStreetMap.status !== "available" ||
    comparisonKeys.length === 0 ||
    comparisonKeys.some((key) => !key || response.sources[key].status !== "available");
}
function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function positiveOrNull(value: unknown): number | null {
  const parsed = numeric(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function normalizeMastrWindRecords(records: unknown[]): MastrWindTurbine[] {
  const result: MastrWindTurbine[] = [];
  const seen = new Set<string>();
  for (const value of records) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const energyId = String(row.EnergietraegerId ?? "");
    const energyName = String(row.EnergietraegerName ?? "").toLowerCase();
    const statusId = String(row.BetriebsStatusId ?? "");
    const statusName = String(row.BetriebsStatusName ?? "").toLowerCase();
    if (!(energyId === "2497" || energyName === "wind")) continue;
    if (!(statusId === "35" || statusName === "in betrieb")) continue;

    const latitude = numeric(row.Breitengrad);
    const longitude = numeric(row.Laengengrad);
    if (
      latitude === null || longitude === null ||
      latitude < 47 || latitude > 56 || longitude < 5 || longitude > 16
    ) continue;

    const id = String(row.MaStRNummer ?? row.Id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const hubHeightM = positiveOrNull(row.NabenhoeheWindenergieanlage);
    const rotorDiameterM = positiveOrNull(row.RotordurchmesserWindenergieanlage);
    const parkName = String(row.WindparkName ?? "").trim();
    const unitName = String(row.EinheitName ?? "").trim();
    const name = [parkName, unitName].filter(Boolean).join(" · ") || "Windenergieanlage";
    const operatorName = String(row.AnlagenbetreiberMaskedName ?? "").trim() || null;
    const operatorMastrNumber =
      String(row.AnlagenbetreiberMaStRNummer ?? "").trim() || null;
    const actorId = String(row.AnlagenbetreiberId ?? "").trim();
    const sourceRecordId = String(row.Id ?? "").trim();
    const operatorProfileUrl = /^\d+$/.test(actorId)
      ? `https://www.marktstammdatenregister.de/MaStR/Akteur/Marktakteur/DetailOeffentlich/${actorId}`
      : null;
    const sourceRecordUrl = /^\d+$/.test(sourceRecordId)
      ? `https://www.marktstammdatenregister.de/MaStR/Einheit/Detail/IndexOeffentlich/${sourceRecordId}`
      : null;

    result.push({
      id,
      name,
      operatorName,
      operatorMastrNumber,
      operatorProfileUrl,
      sourceRecordUrl,
      latitude,
      longitude,
      hubHeightM,
      rotorDiameterM,
      estimatedTipHeightM:
        hubHeightM !== null && rotorDiameterM !== null
          ? hubHeightM + rotorDiameterM / 2
          : null,
    });
  }
  return result;
}

export function distanceMetersBetween(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusM = 6_371_000;
  const dLat = toRadians(latitudeB - latitudeA);
  const dLon = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type EnergyInfrastructureViewport = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};
type Position = [number, number];

function position(value: unknown): Position | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = numeric(value[0]);
  const lat = numeric(value[1]);
  return lon === null || lat === null ? null : [lon, lat];
}

function pointInRing(lon: number, lat: number, ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  let previous = position(ring[ring.length - 1]);
  for (const raw of ring) {
    const current = position(raw);
    if (!current || !previous) {
      previous = current;
      continue;
    }
    const [x1, y1] = previous;
    const [x2, y2] = current;
    const crosses =
      (y1 > lat) !== (y2 > lat) &&
      lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1;
    if (crosses) inside = !inside;
    previous = current;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, rings: unknown): boolean {
  if (!Array.isArray(rings) || !pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false;
  }
  return true;
}

function distanceToLineMeters(
  latitude: number,
  longitude: number,
  coordinates: unknown,
): number | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
  const line: Position[] = coordinates
    .map(position)
    .filter((point): point is Position => point !== null);
  if (line.length === 0) return null;
  if (line.length === 1) return distanceMetersBetween(latitude, longitude, line[0][1], line[0][0]);

  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((latitude * Math.PI) / 180);
  const px = 0;
  const py = 0;
  let minimum = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [lonA, latA] = line[i - 1];
    const [lonB, latB] = line[i];
    const ax = (lonA - longitude) * metersPerDegreeLon;
    const ay = (latA - latitude) * metersPerDegreeLat;
    const bx = (lonB - longitude) * metersPerDegreeLon;
    const by = (latB - latitude) * metersPerDegreeLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    const x = ax + projection * dx;
    const y = ay + projection * dy;
    minimum = Math.min(minimum, Math.sqrt(x * x + y * y));
  }
  return Number.isFinite(minimum) ? minimum : null;
}

function minDistance(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? Math.min(...valid) : null;
}

export function distanceMetersToGeoJsonGeometry(
  latitude: number,
  longitude: number,
  geometry: GeoJsonGeometryLike | null | undefined,
): number | null {
  if (!geometry || typeof geometry.type !== "string") return null;
  const coordinates = geometry.coordinates;
  switch (geometry.type) {
    case "Point": {
      const point = position(coordinates);
      return point ? distanceMetersBetween(latitude, longitude, point[1], point[0]) : null;
    }
    case "MultiPoint":
      return Array.isArray(coordinates)
        ? minDistance(coordinates.map((item) => distanceMetersToGeoJsonGeometry(latitude, longitude, { type: "Point", coordinates: item })))
        : null;
    case "LineString":
      return distanceToLineMeters(latitude, longitude, coordinates);
    case "MultiLineString":
      return Array.isArray(coordinates)
        ? minDistance(coordinates.map((line) => distanceToLineMeters(latitude, longitude, line)))
        : null;
    case "Polygon": {
      if (!Array.isArray(coordinates)) return null;
      if (pointInPolygon(longitude, latitude, coordinates)) return 0;
      return minDistance(coordinates.map((ring) => distanceToLineMeters(latitude, longitude, ring)));
    }
    case "MultiPolygon":
      return Array.isArray(coordinates)
        ? minDistance(coordinates.map((polygon) => distanceMetersToGeoJsonGeometry(latitude, longitude, { type: "Polygon", coordinates: polygon })))
        : null;
    case "GeometryCollection":
      return Array.isArray(geometry.geometries)
        ? minDistance(geometry.geometries.map((item) => distanceMetersToGeoJsonGeometry(latitude, longitude, item)))
        : null;
    default:
      return null;
  }
}

export type InfrastructureDataSource = {
  id: string;
  statusKey?: keyof GermanEnergyInfrastructureResponse["sources"];
  /** A reviewed candidate source that is documented but not queried by the app. */
  referenceOnly?: boolean;
  label: string;
  url: string;
  license: string;
  coverage: string;
  updateStatus: string;
};

const OSM_SOURCE: InfrastructureDataSource = {
  id: "openStreetMap",
  label: "OpenStreetMap",
  url: "https://www.openstreetmap.org/copyright",
  license: "ODbL",
  coverage: "Gemeinschaftlich erfasste Windkraftanlagen, Stromleitungen und Masten; nicht vollständig und nicht amtlich.",
  updateStatus: "Laufend gemeinschaftlich bearbeitet; Abfrage- und Cache-Stand wird in der Trefferliste angezeigt.",
};

const COUNTRY_CONFIGS: Record<string, EnergyInfrastructureCountry> = {
  DE: {
    iso: "DE",
    name: "Deutschland",
    officialGeozoneSource: {
      label: "DIPUL",
      url: "https://www.dipul.de/homepage/de/aktuelle-meldungen/vektordaten-der-geografischen-gebiete-verfuegbar/",
    },
    hasComparableOfficialAssetLayers: true,
    comparisonNote: "Windkraft- und Stromleitungslayer aus DIPUL werden direkt räumlich abgeglichen.",
    comparableOfficialAssetKinds: ["wind_turbine", "power_line"],
    assetComparisonSourceLabel: "DIPUL-Anlagenlayer",
    assetComparisonSourceByKind: {
      wind_turbine: "DIPUL-Windkraftanlagen",
      power_line: "DIPUL-Stromleitungen",
    },
    assetComparisonStatusKeyByKind: {
      wind_turbine: "officialWind",
      power_line: "officialPower",
    },
    dataSources: [
      {
        id: "mastr",
        statusKey: "mastr",
        label: "Marktstammdatenregister (MaStR)",
        url: "https://www.marktstammdatenregister.de/",
        license: "Datenlizenz Deutschland – Namensnennung 2.0 (DL-DE-BY-2.0)",
        coverage: "Aktive Windenergieanlagen in Deutschland.",
        updateStatus: "Laufend gepflegt; Bundesland-Cache-Stand wird in der Trefferliste angezeigt.",
      },
      {
        id: "dipulWind",
        statusKey: "officialWind",
        label: "DIPUL – Windkraftanlagenlayer",
        url: "https://uas-betrieb.de/geoservices/dipul/ows",
        license: "Kein eigener Lizenztext im WFS abgerufen; Nutzungsbedingungen der Datenquelle beachten.",
        coverage: "Abfragbare DIPUL-Windkraftanlagengeometrien in Deutschland.",
        updateStatus: "Live-WFS-Abfrage; Abfragezeitpunkt und Verfügbarkeit werden angezeigt.",
      },
      {
        id: "dipulPower",
        statusKey: "officialPower",
        label: "DIPUL – Stromleitungslayer",
        url: "https://uas-betrieb.de/geoservices/dipul/ows",
        license: "Kein eigener Lizenztext im WFS abgerufen; Nutzungsbedingungen der Datenquelle beachten.",
        coverage: "Abfragbare DIPUL-Stromleitungsgeometrien in Deutschland.",
        updateStatus: "Live-WFS-Abfrage; Abfragezeitpunkt und Verfügbarkeit werden angezeigt.",
      },
      OSM_SOURCE,
    ],
  },
  AT: {
    iso: "AT",
    name: "Österreich",
    officialGeozoneSource: { label: "Austro Control / Dronespace", url: "https://utm.dronespace.at/avm/" },
    hasComparableOfficialAssetLayers: false,
    comparisonNote: "BEV DLM-Bauten bietet landesweite Stromleitungen und Strommasten als offenen GeoPackage-Download (CC BY 4.0). Ein verlässlicher Abgleich mit den Anlagen in Dronespace ist jedoch nicht bestätigt; der ED-269-Zonenexport ist kein Anlageninventar. Ein vollständiger nationaler Windanlagen-Abgleich ist ebenfalls nicht bestätigt. OSM-Treffer bleiben unknown und werden nicht als fehlende Anlagen eingeblendet.",
    comparableOfficialAssetKinds: [],
    dataSources: [
      {
        id: "bevDlmBauten",
        referenceOnly: true,
        label: "BEV – DLM-Bauten",
        url: "https://data.bev.gv.at/geonetwork/srv/api/records/a1ba3e91-42a3-475a-915c-61c216705233",
        license: "CC BY 4.0; laut Datensatzmetadaten keine Einschränkungen des öffentlichen Zugangs.",
        coverage: "Landesweite Vektordaten: BAU_2700_STROMLEITUNG_L und BAU_2800_STROMMAST_P. Kein bestätigtes vollständiges Windanlagenregister und kein Nachweis, dass diese Daten die Anlagenebene von Dronespace bilden.",
        updateStatus: "Recherche 12.10.2026: Metadaten und Downloadlinks für Stichtag 25.03.2025 geprüft, nicht als neuester Stand bestätigt. Objektarten werden jährlich bzw. im 3-jährigen Zyklus fortgeführt; kein vollständiger aktueller Anlagenabgleich integriert.",
      },
      {
        id: "netzNoePower",
        referenceOnly: true,
        label: "Netz NÖ – INSPIRE-Stromnetz",
        url: "https://geoportal.inspire.gv.at/metadatensuche/inspire/api/records/ab5bc2de-ec2d-400c-abd7-d326d6a97b0c",
        license: "Zugang laut INSPIRE-Metadaten beschränkt; Nutzungsbedingungen bzw. Freigabe auf Anfrage, keine offene Wiederverwendungslizenz bestätigt",
        coverage: "Hochspannungsleitungen, Hochdruck-Gasleitungen und Umspannwerke im Versorgungsgebiet Netz Niederösterreich; kein Österreich-weites Netz.",
        updateStatus: "Metadatenrevision 13.11.2025; kein Aktualisierungsturnus ausgewiesen.",
      },
      {
        id: "apgGridMap",
        referenceOnly: true,
        label: "APG – österreichisches Übertragungsnetz",
        url: "https://www.apg.at/stromnetz/stromnetz-oesterreich",
        license: "Netzkarte als PNG-Bild; keine offene Wiederverwendungslizenz für abfragbare Geometrien bestätigt.",
        coverage: "APG-Übertragungsnetz mit 110, 220 und 380 kV sowie 67 Umspannwerken; kein Vektordownload für vollständige räumliche Abfragen.",
        updateStatus: "Die Seite zeigt eine Netzkarte mit Stand Q4 2026; der verfügbare PNG-Download ist mit 03/2025 benannt. Kein Vektor-Aktualisierungsturnus ausgewiesen.",
      },
      {
        id: "jaoStaticGridModel",
        referenceOnly: true,
        label: "JAO – Core Static Grid Model",
        url: "https://www.jao.eu/static-grid-model",
        license: "Auf der Downloadseite ist keine ausdrückliche offene Wiederverwendungslizenz ausgewiesen.",
        coverage: "Zum Download angebotenes statisches Netzmodell der multinationalen Core Region; eine vollständige österreichische Anlagenebene mit räumlicher Abfrage ist nicht bestätigt.",
        updateStatus: "Die Versionsliste führt eine Ausgabe Q1 2026; kein verbindlicher Aktualisierungsturnus ausgewiesen.",
      },
      OSM_SOURCE,
    ],
  },
  BE: {
    iso: "BE",
    name: "Belgien",
    officialGeozoneSource: { label: "skeyes / Droneguide", url: "https://map.droneguide.be/" },
    hasComparableOfficialAssetLayers: true,
    comparisonNote: "NGI Top10Vector deckt landesweit Hochspannungsleitungen und Hochspannungsmasten ab. Verglichen werden nur OSM power=line und power=tower; Windanlagen bleiben ungeprüft, da kein vollständiges amtliches Register für ganz Belgien bestätigt ist. Die geprüften Windquellen aus Flandern, Wallonien und der Nordsee decken jeweils nur Teilgebiete oder Genehmigungsdaten ab; bei der Nordseequelle ist zudem die vollständige Live-Abfrage nicht bestätigt.",
    comparableOfficialAssetKinds: ["power_line", "power_mast"],
    assetComparisonSourceLabel: "NGI-Top10Vector-Hochspannungsnetz",
    assetComparisonSourceByKind: {
      power_line: "NGI Top10Vector – Hochspannungsleitungen",
      power_mast: "NGI Top10Vector – Hochspannungsmasten",
    },
    assetComparisonStatusKeyByKind: {
      power_line: "ngiBelgiumPower",
      power_mast: "ngiBelgiumPower",
    },
    dataSources: [
      {
        id: "ngiBelgiumPower",
        statusKey: "ngiBelgiumPower",
        label: "NGI – Top10Vector Hochspannungsnetz",
        url: "https://www.geo.be/catalog/details/c6c6d674-e3c5-47a9-8398-f4e1082d3e8e?l=en",
        license: "Creative Commons Attribution 4.0 International (CC BY 4.0); Namensnennung des National Geographic Institute",
        coverage: "Landesweite Vektordaten zu Hochspannungsleitungssegmenten und Hochspannungsmasten; keine Windanlagen oder Niederspannungsverteilung.",
        updateStatus: "Metadatenrevision 23.01.2026; jährlicher Aktualisierungszyklus laut NGI-Metadaten. Vollständiger GeoPackage-Download.",
      },
      {
        id: "northSeaWind",
        referenceOnly: true,
        label: "RBINS/BMDC – Windräder in der belgischen Nordsee",
        url: "https://www.geo.be/catalog/details/d409cd5d-3a54-4722-b255-2b4d4374d8ae?l=en",
        license: "CC BY 4.0; keine Bedingungen für Zugriff oder Nutzung",
        coverage: "Exakte Standorte gebauter Windräder nur im belgischen Teil der Nordsee; keine Onshore-Abdeckung.",
        updateStatus: "Metadatenrevision 19.08.2026, Veröffentlichung 08.10.2026; keine Aktualisierungsfrequenz angegeben. WFS-Capabilities bewirbt den Windrad-Layer, aber eine Live-GetFeature-Abfrage meldete trotz beworbenem Layer „Feature type unknown“; vollständige Abfrage nicht bestätigt. Metadaten vermerken zudem, dass Quelldaten aus Sicherheitsgründen zurückgehalten werden können.",
      },
      {
        id: "flemishWindPermits",
        referenceOnly: true,
        label: "Vlaanderen – Windturbine-Genehmigungspunkte",
        url: "https://www.vlaanderen.be/datavindplaats/catalogus/windturbines-omgevingsvergunningen",
        license: "Gratis Open Data Licentie Vlaanderen v1.2 (Mercator-WFS)",
        coverage: "Punktdaten zu Genehmigungsanträgen im Vlaams Gewest, nicht landesweit und kein vollständiges Register bestehender Windturbinen. Historische städtebauliche Genehmigungen vor dem 23.02.2017 liegen in einem separaten Layer; eine erteilte Genehmigung garantiert nicht, dass die Anlage gebaut wurde.",
        updateStatus: "Aktueller Genehmigungs-Layer kontinuierlich aktualisiert; historischer Layer monatlich. Vollständige GeoPackage-Downloads sind gelistet, aber die Daten sind für den belgienweiten Abgleich nicht ausreichend.",
      },
      {
        id: "walloniaEnergySources",
        referenceOnly: true,
        label: "SPW – Energiequellen in Wallonien",
        url: "https://geodata.wallonie.be/id/3dbbad78-420f-4403-9e1a-d531ead5046e",
        license: "SPW Services License; Dienstzugriff frei, Aufrufe dürfen nicht unverhältnismäßig sein",
        coverage: "Auf Wallonien begrenzter OGC-API-Dienst. Die Live-Collections-Abfrage listet Konzessionen für fossile Rohstoffe, aber keine Windturbinen-Punktkollektion.",
        updateStatus: "Metadatenstand 01.09.2026; Aktualisierung der Daten nicht angegeben. OGC API Features bietet Abfrage und Download, aber kein vollständiges belgisches Windturbinenregister.",
      },
      OSM_SOURCE,
    ],
  },
  CH: {
    iso: "CH",
    name: "Schweiz",
    officialGeozoneSource: { label: "BAZL / geo.admin.ch", url: "https://map.geo.admin.ch/?layers=ch.bazl.einschraenkungen-drohnen" },
    hasComparableOfficialAssetLayers: true,
    comparisonNote: "BFE-Layer gleichen Windanlagen, Leitungen und erfasste Mastpunkte im Stromnetz über 36 kV ab; niedrigere Spannungsebenen und nicht erfasste Masten bleiben ungeprüft.",
    comparableOfficialAssetKinds: ["wind_turbine", "power_line", "power_mast"],
    assetComparisonSourceLabel: "BFE-Anlagenlayer",
    assetComparisonSourceByKind: {
      wind_turbine: "BFE-Windenergieanlagen",
      power_line: "BFE-Stromnetzdaten >36 kV",
      power_mast: "BFE-Stromnetzdaten >36 kV (Mastpunkte)",
    },
    assetComparisonStatusKeyByKind: {
      wind_turbine: "bfeWind",
      power_line: "bfePower",
      power_mast: "bfePower",
    },
    dataSources: [
      {
        id: "bfeWind",
        statusKey: "bfeWind",
        label: "BFE – Windenergieanlagen",
        url: "https://www.bfe.admin.ch/en/wind-energy-plants",
        license: "Open Government Data Schweiz; Namensnennung Bundesamt für Energie (BFE)",
        coverage: "Erfasste Windenergieanlagen in der Schweiz; kein Vollständigkeitsnachweis für nicht registrierte Anlagen.",
        updateStatus: "GeoAdmin-Metadatenstand 19.02.2026; kein fester Aktualisierungsturnus ausgewiesen.",
      },
      {
        id: "bfePower",
        statusKey: "bfePower",
        label: "BFE – Elektrische Anlagen >36 kV",
        url: "https://www.bfe.admin.ch/en/electrical-installations",
        license: "Open Government Data Schweiz; Namensnennung Bundesamt für Energie (BFE)",
        coverage: "Komponenten des Stromnetzes über 36 kV, darunter Leitungen; keine vollständige Abdeckung niedriger Spannungsebenen.",
        updateStatus: "GeoAdmin-Metadaten werden laufend aktualisiert; abgerufener Stand wird angezeigt.",
      },
      OSM_SOURCE,
    ],
  },
  DK: {
    iso: "DK",
    name: "Dänemark",
    officialGeozoneSource: { label: "Trafikstyrelsen", url: "https://www.droneregler.dk/uas-geographical-zones" },
    hasComparableOfficialAssetLayers: false,
    comparisonNote: "Dronezoner verwendet einen öffentlich abfragbaren Windanlagenlayer, dessen Datenstand 22.09.2024 ist; aktuelle Vollständigkeit und Wiederverwendungslizenz sind nicht bestätigt. GeoDanmark bietet landesweite Windräder, Hochspannungsleitungen und Masten unter CC BY 4.0, der vollständige Download erfordert jedoch API-key/OAuth. Leitungs- und Mastlayer sind im geprüften Dronezoner-Infrastrukturdienst nicht vorhanden. OSM-Treffer bleiben unknown und werden nicht als fehlende Anlagen eingeblendet.",
    comparableOfficialAssetKinds: [],
    dataSources: [
      {
        id: "dronezonerWind",
        referenceOnly: true,
        label: "Trafikstyrelsen – Dronezoner Windturbines DK",
        url: "https://services-eu1.arcgis.com/Zvx25KS6sGRl9LIx/arcgis/rest/services/DRONEZONER_Infrastruktur_WFL1/FeatureServer/2",
        license: "Anonyme Query-Abfragen möglich; licenseInfo und copyrightText sind leer. Die Freigabe des separaten Dronezonen-Exports ist kein Lizenznachweis für diesen Anlagenlayer.",
        coverage: "Windanlagen-Punktlayer der amtlichen Dronezoner-Webkarte; im selben Dienst nur Straßen, Bahn und Windanlagen, keine Stromleitungen oder Masten. Keine bestätigte aktuelle Vollständigkeit.",
        updateStatus: "Recherche 12.10.2026: Webkarten-Verknüpfung und Layer-Metadaten live geprüft. dataLastEditDate 22.09.2024; Dienst hasStaticData=true. Kein verlässlicher aktueller Negativabgleich aktiviert.",
      },
      {
        id: "geoDanmarkInfrastructure",
        referenceOnly: true,
        label: "GeoDanmark – Windräder, Hochspannungsleitungen und Masten",
        url: "https://datafordeler.dk/dataoversigt/geodanmark-vektor/geodanmark-vektor-fildownload",
        license: "CC BY 4.0 mit GeoDanmark-Namensnennung; vollständiger Fildownload über registriertes IT-System mit API-key/OAuth.",
        coverage: "Landesweite Objektklassen Vindmoelle, Hoejspaendingsledning und Mast. Fachlicher Umfang und Zuordnung zu Dronezoner müssen vor einem Negativabgleich geprüft werden; keine Abdeckung sämtlicher OSM-Leitungen zugesichert.",
        updateStatus: "Recherche 12.10.2026: Download-Dokumentation und Lizenz geprüft. Landesweite Gesamtfortführung im 5-Jahreszyklus, jährliche Luftbilder und ausgewählte Aktualisierungen; ohne eingerichteten Zugang keine vollständige Live-Abfrage bestätigt.",
      },
      {
        id: "ensWindRegister",
        referenceOnly: true,
        label: "Energistyrelsen – Windkraftanlagenregister",
        url: "https://ens.dk/analyser-og-statistik/data-oversigt-over-energisektoren",
        license: "Für die öffentliche Excel-Datei ist keine eindeutige Wiederverwendungslizenz ausgewiesen; kein Abgleich aktiviert.",
        coverage: "Nationales Register dänischer Strom erzeugender Windkraftanlagen über 6 kW mit Koordinaten; die Behörde weist auf mögliche unvollständige oder ungenaue Daten hin.",
        updateStatus: "Das Register wird monatlich aktualisiert (mit etwa einem Monat Verzögerung); die aktuell verlinkten öffentlichen Excel-Dateien tragen weiterhin den Datenstand Januar 2022.",
      },
      {
        id: "kdsWindPower",
        referenceOnly: true,
        label: "Klimadatastyrelsen – Vindkraftanlæg",
        url: "https://dataforsyningen.dk/data/3814",
        license: "CC BY 4.0 gilt für freie geografische Daten; produktbezogene Zugangsbedingungen erfordern Dataforsyningen-Anmeldung und Token.",
        coverage: "Nationaler WMS-/GeoPackage-Datensatz mit Windkraftanlagen an Land und auf See; der WMS-Abfrageweg liefert keine vollständige Featureliste.",
        updateStatus: "Der vollständige Download erfordert laut Produktzugang Anmeldung und Token; kein frei abfragbarer WFS und kein dokumentierter Aktualisierungsturnus bestätigt.",
      },
      OSM_SOURCE,
    ],
  },
  FR: {
    iso: "FR",
    name: "Frankreich",
    officialGeozoneSource: { label: "Géoportail", url: "https://www.geoportail.gouv.fr/donnees/restrictions-uas-categorie-ouverte-et-aeromodelisme" },
    hasComparableOfficialAssetLayers: true,
    comparisonNote: "IGN BD TOPO® stellt landesweite Punktobjekte für Windanlagen und Leitungen des Hoch- und Höchstspannungsnetzes (>50 kV) bereit. OSM-Windanlagen und nur Leitungen mit expliziter Spannung über 50 kV werden verglichen; Masten und Leitungen mit niedrigerer oder unbekannter Spannung bleiben ungeprüft.",
    comparableOfficialAssetKinds: ["wind_turbine", "power_line"],
    assetComparisonSourceLabel: "IGN-BD-TOPO®-Anlagenlayer",
    assetComparisonSourceByKind: {
      wind_turbine: "IGN BD TOPO® – Windanlagen",
      power_line: "IGN BD TOPO® – Hochspannungsleitungen",
    },
    assetComparisonStatusKeyByKind: {
      wind_turbine: "ignFranceWind",
      power_line: "ignFrancePower",
    },
    dataSources: [
      {
        id: "ignFranceWind",
        statusKey: "ignFranceWind",
        label: "IGN – BD TOPO® Windanlagen",
        url: "https://data.geopf.fr/wfs/ows?SERVICE=WFS&REQUEST=GetCapabilities",
        license: "Licence Ouverte / Open Licence version 2.0 (Etalab)",
        coverage: "Landesweite BD-TOPO®-Punktobjekte der Klasse construction_ponctuelle mit nature=Eolienne; Abwesenheit wird nur bei vollständig abgerufener lokaler Abfrage bestätigt.",
        updateStatus: "Live-WFS-Abfrage; BD TOPO® wird quartalsweise aktualisiert. Nur ein höchstens 24 Stunden alter Dienstzeitstempel und eine vollständige Abfrage gelten als verlässlich.",
      },
      {
        id: "ignFrancePower",
        statusKey: "ignFrancePower",
        label: "IGN – BD TOPO® Stromleitungen",
        url: "https://data.geopf.fr/wfs/ows?SERVICE=WFS&REQUEST=GetCapabilities",
        license: "Licence Ouverte / Open Licence version 2.0 (Etalab)",
        coverage: "Landesweiter BD-TOPO®-Layer BDTOPO_V3:ligne_electrique für Stromleitungen des Hoch- und Höchstspannungsnetzes; keine Windanlagen oder Mastobjekte.",
        updateStatus: "Live-WFS-Abfrage; der Datenabrufzeitpunkt wird angezeigt. IGN BD TOPO® wird quartalsweise aktualisiert.",
      },
      OSM_SOURCE,
    ],
  },
  LU: {
    iso: "LU",
    name: "Luxemburg",
    officialGeozoneSource: { label: "Geoportail.lu", url: "https://map.geoportail.lu/" },
    hasComparableOfficialAssetLayers: true,
    comparisonNote: "Geoportail.lu stellt amtliche Stromleitungs- und Mastgeometrien bereit; Windanlagen bleiben ungeprüft.",
    comparableOfficialAssetKinds: ["power_line", "power_mast"],
    assetComparisonSourceLabel: "Geoportail.lu-Stromnetzlayer",
    assetComparisonSourceByKind: {
      power_line: "Geoportail.lu-Stromleitungen",
      power_mast: "Geoportail.lu-Strommasten",
    },
    assetComparisonStatusKeyByKind: {
      power_line: "actLuxembourg",
      power_mast: "actLuxembourg",
    },
    dataSources: [
      {
        id: "actLuxembourg",
        statusKey: "actLuxembourg",
        label: "Geoportail.lu – Stromnetz",
        url: "https://data.public.lu/en/datasets/inspire-annex-iii-utility-and-governmental-services-electricitynetwork-utilitylink-bd-l-tc-electricity-transmission-lines-from-the-official-carto-topographic-database-3",
        license: "Creative Commons Zero (CC0)",
        coverage: "Amtliche Stromleitungen und Strommasten in Luxemburg aus dem INSPIRE-Stromnetz; keine Vollständigkeitsgarantie.",
        updateStatus: "Katalogstand 12.06.2026; kein Aktualisierungsturnus ausgewiesen.",
      },
      OSM_SOURCE,
    ],
  },
  NL: {
    iso: "NL",
    name: "Niederlande",
    officialGeozoneSource: { label: "GoDrone", url: "https://map.godrone.nl/" },
    hasComparableOfficialAssetLayers: true,
    comparisonNote: "RIVM-Windanlagen werden mit der amtlichen Windanlagenquelle abgeglichen; Stromleitungen und Masten bleiben ungeprüft.",
    comparableOfficialAssetKinds: ["wind_turbine"],
    assetComparisonSourceLabel: "RIVM-Windanlagen-Datensatz",
    assetComparisonSourceByKind: {
      wind_turbine: "RIVM-Windanlagen-Datensatz",
    },
    assetComparisonStatusKeyByKind: {
      wind_turbine: "rivm",
    },
    dataSources: [
      {
        id: "rivm",
        statusKey: "rivm",
        label: "RIVM / Atlas Leefomgeving – Windturbines",
        url: "https://data.rivm.nl/geo/alo/wfs?service=WFS&request=GetCapabilities",
        license: "Publiek domein (Public Domain Mark 1.0)",
        coverage: "Windturbinen in den Niederlanden; Offshore-Positionen sind laut RIVM weniger genau.",
        updateStatus: "RIVM-WFS-Layer „actueel“; letzter Feature-Datenstand laut Abruf 11.01.2026, kein fester Turnus ausgewiesen.",
      },
      OSM_SOURCE,
    ],
  },
};

export const ENERGY_INFRASTRUCTURE_COUNTRIES = Object.keys(COUNTRY_CONFIGS);

export function getEnergyInfrastructureCountry(
  countryIso: string | null | undefined,
): EnergyInfrastructureCountry | null {
  if (!countryIso) return null;
  return COUNTRY_CONFIGS[countryIso.trim().toUpperCase()] ?? null;
}

export type EnergyInfrastructureCountry = {
  iso: string;
  name: string;
  officialGeozoneSource: { label: string; url: string };
  /** A comparable live-query feed is configured; each response still controls match status. */
  hasComparableOfficialAssetLayers: boolean;
  comparisonNote: string;
  /** Kinds with a live comparable official asset feed; all other kinds stay unknown. */
  comparableOfficialAssetKinds: InfrastructureKind[];
  /** Label for the asset-feed comparison, distinct from the aviation geozone source. */
  assetComparisonSourceLabel?: string;
  /** Kind-specific labels prevent implying that a partial feed compares every asset type. */
  assetComparisonSourceByKind?: Partial<Record<InfrastructureKind, string>>;
  /** Status keys for the official feed(s) required to compare each asset kind. */
  assetComparisonStatusKeyByKind?: Partial<
    Record<InfrastructureKind, keyof GermanEnergyInfrastructureResponse["sources"]>
  >;
  dataSources: InfrastructureDataSource[];
};

export type EnergyInfrastructureCenter = {
  latitude: number;
  longitude: number;
};

export function getEnergyInfrastructureCenterForViewport(
  current: EnergyInfrastructureCenter | null,
  bbox: EnergyInfrastructureViewport,
): EnergyInfrastructureCenter {
  const next = {
    latitude: (bbox.latMin + bbox.latMax) / 2,
    longitude: (bbox.lonMin + bbox.lonMax) / 2,
  };
  return !current ||
    distanceMetersBetween(current.latitude, current.longitude, next.latitude, next.longitude) >= 5_000
    ? next
    : current;
}
