import { useCallback } from "react";
import type { AircraftState, ServerAircraftTrail } from "@/lib/opensky";
import type { AircraftTrail } from "@/components/TrafficMapView";

const MAX_TOTAL_TRAILS = 25;

function altitudeColor(agl: number | null): string {
  if (agl == null) return "orange";
  if (agl < 150) return "red";
  if (agl < 500) return "orange";
  return "#42A5F5";
}

function effectiveAgl(ac: AircraftState): number | null {
  if (ac.aglAltitude != null) return ac.aglAltitude;
  return ac.geoAltitude ?? ac.baroAltitude ?? null;
}

function quickDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

export interface TrailUpdateResult {
  trails: AircraftTrail[];
  bufferedAircraft: AircraftState[];
}

/**
 * Thin server-trail adapter. The server-side aggregator already maintains a
 * 10-minute trail per aircraft (capped at ~120 points, with distance/time/turn
 * plausibility checks). This hook just filters/colors those trails based on
 * current view radius and altitude limit. Returned `bufferedAircraft` is kept
 * for API compat and is always empty — server's `maxAgeSec` already extends
 * visibility for briefly missing aircraft.
 */
export function useAircraftTrails() {
  const clearTrails = useCallback(() => {
    // No-op: trails live server-side and persist across mount/unmount.
  }, []);

  const updateTrails = useCallback((
    aircraft: AircraftState[],
    serverTrails: ServerAircraftTrail[],
    centerLat?: number | null,
    centerLon?: number | null,
    radiusKm?: number,
    maxAltitudeM?: number,
  ): TrailUpdateResult => {
    const hasCenter = centerLat != null && centerLon != null;
    const trailRadiusM = (radiusKm ?? 10) * 1000;
    const altLimit = maxAltitudeM != null ? maxAltitudeM : 500;

    const acById = new Map<string, AircraftState>();
    for (const ac of aircraft) acById.set(ac.icao24, ac);

    const candidates: { id: string; color: string; points: { latitude: number; longitude: number }[]; dist: number }[] = [];

    for (const trail of serverTrails) {
      if (!trail.points || trail.points.length < 2) continue;
      const ac = acById.get(trail.id);
      if (!ac) continue;
      if (ac.onGround) continue;

      const agl = effectiveAgl(ac);
      if (agl != null && agl > altLimit) continue;

      if (hasCenter) {
        const distToCenter = quickDistance(centerLat!, centerLon!, ac.latitude, ac.longitude);
        if (distToCenter > trailRadiusM) continue;
      }

      const allPts = trail.points.map((p) => ({ latitude: p.lat, longitude: p.lon }));
      // Trail ab dem letzten Eintritt in den Radar-Radius zuschneiden, damit
      // keine "verwaisten" Linien quer übers Kartenbild laufen.
      let pts = allPts;
      if (hasCenter) {
        let cutIdx = 0;
        for (let i = allPts.length - 1; i >= 0; i--) {
          const d = quickDistance(centerLat!, centerLon!, allPts[i].latitude, allPts[i].longitude);
          if (d > trailRadiusM) { cutIdx = i + 1; break; }
        }
        if (cutIdx > 0) pts = allPts.slice(cutIdx);
        if (pts.length < 2) continue;
      }
      const lastPt = pts[pts.length - 1];
      if (Math.abs(lastPt.latitude - ac.latitude) > 0.00001 || Math.abs(lastPt.longitude - ac.longitude) > 0.00001) {
        pts.push({ latitude: ac.latitude, longitude: ac.longitude });
      }

      const distToCenter = hasCenter ? quickDistance(centerLat!, centerLon!, ac.latitude, ac.longitude) : 0;
      candidates.push({
        id: trail.id,
        color: altitudeColor(agl),
        points: pts,
        dist: distToCenter,
      });
    }

    candidates.sort((a, b) => a.dist - b.dist);
    const trails: AircraftTrail[] = candidates.slice(0, MAX_TOTAL_TRAILS).map((c) => ({
      id: c.id,
      color: c.color,
      points: c.points,
    }));

    return { trails, bufferedAircraft: [] };
  }, []);

  return { updateTrails, clearTrails };
}
