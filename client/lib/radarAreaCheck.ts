/**
 * Gebietsprüfung des Live-Radars (Wetter/Kp, NOTAM, Temporärbeschränkungen,
 * Geozonen im RA-Radius) – gemeinsam für den Radar-Screen (Reiter-
 * Markierungen, Seitenleiste) und die Hintergrund-Überwachung
 * (radarMonitorNative.ts → Benachrichtigungen). Bewertung:
 * computeRadarAreaFlags in radarAlertLogic.ts.
 */
import { fetchWeather, type WeatherData } from "@/lib/weather";
import { fetchKpIndex, fetchKpTimeline, getKpForHour, type KpIndexData, type KpTimeEntry } from "@/lib/kpindex";
import { fetchNotams, getNotamSeverity, notamCountOrUnknown, type NotamData } from "@/lib/notams";
import {
  fetchLuTsaAsNotams,
  fetchNearbyTempRestrictionsRaw,
  queryGeozonesInArea,
  separateTempRestrictions,
  type DipulTempRestriction,
  type GeozoneFeatureInfo,
} from "@/lib/geozones";
import { getActiveOrUpcomingNearbyMilLowFlight } from "@/lib/milLowFlight";
import { computeRadarAreaFlags, type RadarAreaFlags, type RadarAreaSnapshot } from "@/lib/radarAlertLogic";

export interface RadarAreaData {
  weatherData: WeatherData | null;
  kp: KpIndexData | null;
  kpTimeline: KpTimeEntry[];
  notamResult: { notams: NotamData[]; failed?: boolean; offline?: { fetchedAt: number; cached: boolean } };
  combinedNotams: NotamData[];
  tempRestrictions: GeozoneFeatureInfo[];
  allDipul: DipulTempRestriction[];
  permZones: GeozoneFeatureInfo[];
  notamUnknown: boolean;
  currentKpValue: number | null;
  flags: RadarAreaFlags;
}

export async function fetchRadarAreaData(lat: number, lon: number, raRadiusKm: number, countryIso: string | undefined): Promise<RadarAreaData> {
  const [weatherData, kp, kpTl, notamResult, zones, dipulResult, luTsaNotams] = await Promise.all([
    fetchWeather(lat, lon, 1440).catch(() => null),
    fetchKpIndex().catch(() => null),
    fetchKpTimeline().catch(() => [] as KpTimeEntry[]),
    fetchNotams(lat, lon).catch(() => ({ notams: [] as NotamData[], total: 0, queriedCodes: [] as string[], failed: true })),
    queryGeozonesInArea(lat, lon, raRadiusKm, countryIso).catch((e) => {
      console.warn("[checkAlerts] geozone query failed:", e?.message || e);
      return [] as GeozoneFeatureInfo[];
    }),
    fetchNearbyTempRestrictionsRaw(lat, lon, raRadiusKm).catch(() => ({ active: [] as DipulTempRestriction[], upcoming: [] as DipulTempRestriction[] })),
    countryIso === "LU" ? fetchLuTsaAsNotams(lat, lon, raRadiusKm).catch(() => []) : Promise.resolve([]),
  ]);
  const milNearby = getActiveOrUpcomingNearbyMilLowFlight(dipulResult, lat, lon, raRadiusKm);
  dipulResult.active = [...dipulResult.active, ...milNearby.active];
  dipulResult.upcoming = [...dipulResult.upcoming, ...milNearby.upcoming];
  const combinedNotams = [...notamResult.notams, ...(luTsaNotams as unknown as NotamData[])];
  const { geozones: permZones, tempRestrictions } = separateTempRestrictions(zones);
  const allDipul = [...dipulResult.active, ...dipulResult.upcoming];
  const f = weatherData?.forecasts?.[0];
  const currentKpValue = kpTl.length > 0 ? getKpForHour(kpTl, new Date()) : kp?.value ?? null;
  // Fehlgeschlagene NOTAM-Abfrage ist KEIN „alles frei“
  const notamUnknown = notamCountOrUnknown(notamResult) === null;
  const flags = computeRadarAreaFlags({
    forecast: f,
    kpValue: currentKpValue,
    notamUnknown,
    highNotamCount: combinedNotams.filter((n) => getNotamSeverity(n) === "high").length,
    tempRestrictionCount: tempRestrictions.length,
    activeDipulCount: allDipul.filter((d) => d.status === "active").length,
    geozoneCount: permZones.length,
  });
  return {
    weatherData,
    kp,
    kpTimeline: kpTl,
    notamResult: notamResult as RadarAreaData["notamResult"],
    combinedNotams,
    tempRestrictions,
    allDipul,
    permZones,
    notamUnknown,
    currentKpValue,
    flags,
  };
}

const zoneKey = (z: GeozoneFeatureInfo) => `${z.featureId ?? ""}|${z.layerLabel}|${z.name}`;

/** Neutrale Form für die Hintergrund-Meldungen (decideAreaAlerts) */
export function radarAreaSnapshot(d: RadarAreaData): RadarAreaSnapshot {
  const notams = [
    ...d.combinedNotams
      .filter((n) => getNotamSeverity(n) === "high")
      .map((n) => ({ key: `notam:${n.series}${n.number}/${n.year ?? ""}:${n.id}`, label: `NOTAM ${n.series}${n.number}${n.year ? `/${String(n.year).slice(-2)}` : ""}` })),
    ...d.tempRestrictions.map((z) => ({ key: `temp:${zoneKey(z)}`, label: z.name || z.layerLabel })),
    ...d.allDipul.filter((r) => r.status === "active").map((r) => ({ key: `dipul:${r.id}`, label: r.name })),
  ];
  return {
    flags: d.flags,
    zones: d.permZones.map((z) => ({ key: zoneKey(z), label: z.name || z.layerLabel })),
    notams,
    notamUnknown: d.notamUnknown,
  };
}
