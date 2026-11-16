/**
 * Daten der Gebietsübersicht (Flugplanung, Schritt nach dem Standort):
 * Geozonen, temporäre Beschränkungen/NOTAMs, Hindernisse und Luftfahrt-
 * Punkte im gewählten Umkreis – über die bestehenden Datenwege:
 *  - Geozonen: queryGeozonesInAreaWithCoverage (Kachelspeicher DE/FR/CZ,
 *    ED-269-Speicher, WFS/WMS je Land; offline aus dem Bestand)
 *  - NOTAMs/dipul: fetchAreaNotamData (wie Radar; offline gespeicherter Stand)
 *  - Hindernisse: loadObstaclesForBounds (Hindernis-Kachelspeicher)
 *  - Luftfahrt-Punkte: aviationPois.ts (OSM, gleicher Kachelspeicher-Weg)
 *    + Flughafenlisten der App (offline immer verfügbar)
 */
import { useEffect, useMemo, useState } from "react";
import {
  queryGeozonesInAreaWithCoverage,
  separateTempRestrictions,
  type DipulTempRestriction,
  type GeozoneFeatureInfo,
  type GeozoneCoverage,
} from "@/lib/geozones";
import type { NotamData } from "@/lib/notams";
import { notamCountOrUnknown } from "@/lib/notams";
import { fetchAreaNotamData } from "@/lib/radarAreaCheck";
import { getObstaclesEnabled, loadObstaclesForBounds } from "@/lib/obstacles";
import { loadAviationPoisAround } from "@/lib/aviationPois";
import { isOfflineNow } from "@/lib/network";
import { CTR_AIRPORTS } from "@/lib/ctrData";
import { MAJOR_EU_AIRPORTS } from "@/lib/euAirports";
import {
  airportPoisFromList,
  buildNearbyHints,
  filterZonesInRadius,
  HINT_THRESHOLDS,
  restrictionInRadius,
  splitNotamsForArea,
  summarizeObstaclesInRadius,
  type AviationPoi,
  type NearbyHint,
  type ObstacleSummary,
} from "@/lib/areaOverview";

export type LoadState = "loading" | "ok" | "partial" | "unavailable";

export interface AreaOverviewData {
  offline: boolean;
  zonesState: LoadState;
  zoneCoverage: GeozoneCoverage | null;
  /** dauerhafte Geozonen im Umkreis */
  zones: GeozoneFeatureInfo[];
  /** temporäre Zonen aus den Geozonen-Quellen (ED-R, aktivierbare UAS-Zonen …) */
  tempZones: GeozoneFeatureInfo[];
  notamState: LoadState;
  /** örtliche NOTAMs im Umkreis */
  notamsLocal: NotamData[];
  /** großräumige NOTAMs (FIR-weit) */
  notamsWide: NotamData[];
  dipulState: LoadState;
  dipul: DipulTempRestriction[];
  obstaclesState: LoadState | "disabled";
  obstacles: ObstacleSummary | null;
  poiState: LoadState;
  pois: AviationPoi[];
  hints: NearbyHint[];
}

const OFFLINE_AIRPORTS: AviationPoi[] = [
  ...airportPoisFromList(CTR_AIRPORTS.map((a) => ({ icao: a.icao, name: a.name, lat: a.lat, lon: a.lon, military: a.category === "military" }))),
  ...airportPoisFromList(MAJOR_EU_AIRPORTS),
];

export function useAreaOverview(latitude: number, longitude: number, radiusKm: number, countryIso: string | undefined): AreaOverviewData {
  const center = useMemo(() => ({ lat: latitude, lon: longitude }), [latitude, longitude]);
  const radiusM = radiusKm * 1000;
  const [offline] = useState(() => isOfflineNow());

  const [zonesState, setZonesState] = useState<LoadState>("loading");
  const [zoneCoverage, setZoneCoverage] = useState<GeozoneCoverage | null>(null);
  const [rawZones, setRawZones] = useState<GeozoneFeatureInfo[]>([]);
  const [notamState, setNotamState] = useState<LoadState>("loading");
  const [rawNotams, setRawNotams] = useState<NotamData[]>([]);
  const [dipulState, setDipulState] = useState<LoadState>("loading");
  const [rawDipul, setRawDipul] = useState<DipulTempRestriction[]>([]);
  const [obstaclesState, setObstaclesState] = useState<LoadState | "disabled">("loading");
  const [obstacleFc, setObstacleFc] = useState<GeoJSON.FeatureCollection | null>(null);
  const [poiState, setPoiState] = useState<LoadState>("loading");
  const [osmPois, setOsmPois] = useState<AviationPoi[]>([]);

  useEffect(() => {
    let cancelled = false;
    const iso = countryIso;
    setZonesState("loading");
    setNotamState("loading");
    setDipulState("loading");
    setPoiState("loading");
    setObstaclesState("loading");

    queryGeozonesInAreaWithCoverage(latitude, longitude, radiusKm, iso)
      .then((r) => {
        if (cancelled) return;
        setRawZones(r.zones);
        setZoneCoverage(r.coverage);
        setZonesState(r.coverage === "complete" ? "ok" : r.coverage === "partial" ? "partial" : "unavailable");
      })
      .catch(() => { if (!cancelled) { setRawZones([]); setZonesState("unavailable"); } });

    fetchAreaNotamData(latitude, longitude, radiusKm, iso)
      .then((a) => {
        if (cancelled) return;
        setRawNotams(a.combinedNotams);
        setNotamState(notamCountOrUnknown(a.notamResult) === null ? "unavailable" : "ok");
        setRawDipul(a.allDipul);
        // dipul (temporäre Betriebseinschränkungen) gibt es nur für Deutschland
        setDipulState(a.dipulFailed ? ((iso ?? "DE").toUpperCase() === "DE" ? "unavailable" : "ok") : "ok");
      })
      .catch(() => { if (!cancelled) { setNotamState("unavailable"); setDipulState("unavailable"); } });

    // Luftfahrt-Punkte: bis 5 km über den Umkreis hinaus (Flugplatz-Info-Schwelle)
    const extentKm = Math.max(HINT_THRESHOLDS.aerodromeInfoM / 1000, radiusKm + HINT_THRESHOLDS.helipadCautionM / 1000) + 0.5;
    loadAviationPoisAround(latitude, longitude, extentKm)
      .then((r) => {
        if (cancelled) return;
        setOsmPois(r.pois);
        setPoiState(r.unavailable ? "unavailable" : r.complete ? "ok" : "partial");
      })
      .catch(() => { if (!cancelled) setPoiState("unavailable"); });

    (async () => {
      if (!(await getObstaclesEnabled())) { if (!cancelled) setObstaclesState("disabled"); return; }
      const dLat = (radiusKm + 0.3) / 110.54;
      const dLon = (radiusKm + 0.3) / (111.32 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));
      try {
        const fc = await loadObstaclesForBounds(longitude - dLon, latitude - dLat, longitude + dLon, latitude + dLat, (partial) => {
          if (!cancelled) setObstacleFc(partial);
        });
        if (cancelled) return;
        setObstacleFc(fc);
        // leere Antwort offline = kein gespeicherter Bestand
        setObstaclesState(fc.features.length === 0 && isOfflineNow() ? "unavailable" : "ok");
      } catch {
        if (!cancelled) setObstaclesState("unavailable");
      }
    })();

    return () => { cancelled = true; };
  }, [latitude, longitude, radiusKm, countryIso]);

  const { zones, tempZones } = useMemo(() => {
    const inside = filterZonesInRadius(rawZones, center, radiusKm);
    const sep = separateTempRestrictions(inside);
    return { zones: sep.geozones, tempZones: sep.tempRestrictions };
  }, [rawZones, center, radiusKm]);

  const { notamsLocal, notamsWide } = useMemo(() => {
    const split = splitNotamsForArea(rawNotams, center, radiusM);
    return { notamsLocal: split.local, notamsWide: split.wide };
  }, [rawNotams, center, radiusM]);

  const dipul = useMemo(
    () => rawDipul.filter((r) => restrictionInRadius(r, center, radiusM)),
    [rawDipul, center, radiusM],
  );

  const obstacles = useMemo(
    () => (obstacleFc ? summarizeObstaclesInRadius(obstacleFc, center, radiusM) : null),
    [obstacleFc, center, radiusM],
  );

  const pois = useMemo(() => [...osmPois, ...OFFLINE_AIRPORTS], [osmPois]);
  const hints = useMemo(() => buildNearbyHints(center, radiusKm, pois), [center, radiusKm, pois]);

  return {
    offline,
    zonesState,
    zoneCoverage,
    zones,
    tempZones,
    notamState,
    notamsLocal,
    notamsWide,
    dipulState,
    dipul,
    obstaclesState,
    obstacles,
    poiState,
    pois,
    hints,
  };
}
