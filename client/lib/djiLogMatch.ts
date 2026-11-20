// Zuordnung ausgewerteter DJI-Flugprotokolle zu vorhandenen Logbuch-Einträgen
// (gemeinsam für den Sammel-Import und den automatischen Import).
import { dronesCompatible, type DjiAnalysisGroup } from "./djiLogCore";
import type { LogbookEntry } from "./storage";

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type EntryMatch = {
  entry: LogbookEntry;
  timeDiffMs: number | null;
  distKm: number | null;
  droneOk: boolean;
  droneMatch: boolean;
  score: number;
  isSuggested: boolean;
  isStrong: boolean;
};

export function computeMatches(
  group: DjiAnalysisGroup,
  entries: LogbookEntry[],
): EntryMatch[] {
  const scored: EntryMatch[] = entries.map((e) => {
    const entryStart = e.takeoffTime
      ? Date.parse(e.takeoffTime)
      : e.flightDate
        ? Date.parse(e.flightDate)
        : NaN;
    const haveTimes = group.startTs != null && Number.isFinite(entryStart);
    const timeDiffMs = haveTimes ? Math.abs(group.startTs! - entryStart) : null;
    let distKm: number | null = null;
    if (
      group.startLat != null &&
      group.startLon != null &&
      Number.isFinite(e.latitude) &&
      Number.isFinite(e.longitude)
    ) {
      distKm = haversineKm(group.startLat, group.startLon, e.latitude, e.longitude);
    }
    // Drohnen-Abgleich: passt das Fluggerät des Logs zu dem des Eintrags?
    const droneOk = dronesCompatible(group.droneName, e.droneName);
    const droneKnown = !!group.droneName && !!e.droneName;
    const droneMatch = droneKnown && droneOk;
    let score = 0;
    if (timeDiffMs != null) score += Math.max(0, 200 - timeDiffMs / 3_600_000);
    if (distKm != null) score += Math.max(0, 100 - distKm * 5);
    if (droneMatch) score += 150; // gleiche Drohne stark bevorzugen
    const closeInTime = timeDiffMs != null && timeDiffMs <= 3 * 3_600_000;
    const closeInSpace = distKm != null && distKm <= 2;
    const isStrong =
      droneOk &&
      timeDiffMs != null &&
      timeDiffMs <= 60 * 60 * 1000 &&
      distKm != null &&
      distKm <= 0.5;
    return {
      entry: e,
      timeDiffMs,
      distKm,
      droneOk,
      droneMatch,
      score,
      // Bei bekannter, aber NICHT passender Drohne nicht vorschlagen.
      isSuggested: droneOk && (closeInTime || closeInSpace),
      isStrong,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
