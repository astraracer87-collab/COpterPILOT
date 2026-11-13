import { useRef, useCallback } from "react";
import type { AircraftState } from "@/lib/opensky";
import type { AircraftTrail } from "@/components/TrafficMapView";

const MAX_TRAIL_POINTS = 60;
const MIN_DISTANCE_M = 150;
const MIN_TIME_MS = 10000;
const TRAIL_MAX_AGE_MS = 300000;
const MAX_TRAIL_LENGTH_M = 50000;
const MAX_TURN_DEG = 90;
const DISQUALIFY_GRACE_MS = 45000;
const MAX_TOTAL_TRAILS = 25;

function altitudeColor(alt: number | null): string {
  if (alt == null) return "orange";
  if (alt < 150) return "red";
  if (alt < 500) return "orange";
  return "#42A5F5";
}

function quickDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;
  const angle = Math.atan2(dLon * Math.cos((lat2 * Math.PI) / 180), dLat) * (180 / Math.PI);
  return (angle + 360) % 360;
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

interface TrailPoint {
  lat: number;
  lon: number;
  t: number;
}

export interface TrailUpdateResult {
  trails: AircraftTrail[];
  bufferedAircraft: AircraftState[];
}

export function useAircraftTrails() {
  const trailsRef = useRef<Map<string, TrailPoint[]>>(new Map());
  const lastQualifiedRef = useRef<Map<string, number>>(new Map());
  const lastAircraftRef = useRef<Map<string, AircraftState>>(new Map());

  const clearTrails = useCallback(() => {
    trailsRef.current.clear();
    lastQualifiedRef.current.clear();
    lastAircraftRef.current.clear();
  }, []);

  const updateTrails = useCallback((
    aircraft: AircraftState[],
    centerLat?: number | null,
    centerLon?: number | null,
    radiusKm?: number,
    maxAltitudeM?: number
  ): TrailUpdateResult => {
    const now = Date.now();

    for (const [id, lastQ] of lastQualifiedRef.current) {
      if (now - lastQ > DISQUALIFY_GRACE_MS) {
        trailsRef.current.delete(id);
        lastQualifiedRef.current.delete(id);
        lastAircraftRef.current.delete(id);
      }
    }

    const hasCenter = centerLat != null && centerLon != null;
    const trailRadiusM = (radiusKm ?? 10) * 1000;
    const altLimit = maxAltitudeM != null ? maxAltitudeM : Infinity;

    const qualifiedIds = new Set<string>();

    for (const ac of aircraft) {
      lastAircraftRef.current.set(ac.icao24, ac);

      if (ac.onGround) continue;

      const acAlt = ac.geoAltitude ?? ac.baroAltitude;
      if (acAlt != null && acAlt > altLimit) continue;

      if (hasCenter) {
        const distToCenter = quickDistance(centerLat!, centerLon!, ac.latitude, ac.longitude);
        if (distToCenter > trailRadiusM) {
          continue;
        }
      }

      qualifiedIds.add(ac.icao24);
      lastQualifiedRef.current.set(ac.icao24, now);

      let existing = trailsRef.current.get(ac.icao24) || [];
      existing = existing.filter((p) => now - p.t < TRAIL_MAX_AGE_MS);

      const lastPoint = existing.length > 0 ? existing[existing.length - 1] : null;

      const distMoved = lastPoint ? quickDistance(lastPoint.lat, lastPoint.lon, ac.latitude, ac.longitude) : Infinity;
      const timeSinceLast = lastPoint ? now - lastPoint.t : Infinity;

      if (!lastPoint || distMoved >= MIN_DISTANCE_M || timeSinceLast >= MIN_TIME_MS) {
        let accept = true;

        if (existing.length >= 2 && distMoved < 2000) {
          const prev = existing[existing.length - 2];
          const last = existing[existing.length - 1];
          const prevBearing = bearing(prev.lat, prev.lon, last.lat, last.lon);
          const newBearing = bearing(last.lat, last.lon, ac.latitude, ac.longitude);
          const turn = angleDiff(prevBearing, newBearing);

          if (turn > MAX_TURN_DEG && distMoved < 500) {
            if (ac.trueTrack != null) {
              const headingDiff = angleDiff(newBearing, ac.trueTrack);
              if (headingDiff > 90) {
                accept = false;
              }
            } else {
              accept = false;
            }
          }
        }

        if (accept) {
          existing.push({ lat: ac.latitude, lon: ac.longitude, t: now });
          if (existing.length > MAX_TRAIL_POINTS) {
            existing.shift();
          }
        }
      }

      if (existing.length >= 2) {
        let totalLen = 0;
        let cutIndex = 0;
        for (let i = existing.length - 1; i > 0; i--) {
          totalLen += quickDistance(existing[i].lat, existing[i].lon, existing[i - 1].lat, existing[i - 1].lon);
          if (totalLen > MAX_TRAIL_LENGTH_M) {
            cutIndex = i;
            break;
          }
        }
        if (cutIndex > 0) {
          existing = existing.slice(cutIndex);
        }
      }

      trailsRef.current.set(ac.icao24, existing);
    }

    for (const id of trailsRef.current.keys()) {
      if (!qualifiedIds.has(id)) {
        const lastQ = lastQualifiedRef.current.get(id) ?? 0;
        if (now - lastQ > DISQUALIFY_GRACE_MS) {
          trailsRef.current.delete(id);
          lastQualifiedRef.current.delete(id);
          lastAircraftRef.current.delete(id);
        }
      }
    }

    if (trailsRef.current.size > MAX_TOTAL_TRAILS) {
      const sortedEntries = [...trailsRef.current.entries()].sort((a, b) => {
        const aLast = a[1].length > 0 ? a[1][a[1].length - 1].t : 0;
        const bLast = b[1].length > 0 ? b[1][b[1].length - 1].t : 0;
        return bLast - aLast;
      });
      const keep = new Set(sortedEntries.slice(0, MAX_TOTAL_TRAILS).map(([id]) => id));
      for (const id of trailsRef.current.keys()) {
        if (!keep.has(id)) {
          trailsRef.current.delete(id);
          lastQualifiedRef.current.delete(id);
          lastAircraftRef.current.delete(id);
        }
      }
    }

    const bufferedAircraft: AircraftState[] = [];
    const currentAircraftIds = new Set(aircraft.map((ac) => ac.icao24));
    for (const [id, lastQ] of lastQualifiedRef.current) {
      if (!qualifiedIds.has(id) && now - lastQ <= DISQUALIFY_GRACE_MS) {
        const lastAc = lastAircraftRef.current.get(id);
        if (lastAc && !currentAircraftIds.has(id)) {
          bufferedAircraft.push({ ...lastAc, isStale: true });
        }
      }
    }

    const trails: AircraftTrail[] = [];
    const allRelevantIds = new Set([...qualifiedIds]);
    for (const [id, lastQ] of lastQualifiedRef.current) {
      if (now - lastQ <= DISQUALIFY_GRACE_MS) allRelevantIds.add(id);
    }

    const trailCandidates: { id: string; ac: AircraftState | undefined; pts: { latitude: number; longitude: number }[]; dist: number }[] = [];

    for (const id of allRelevantIds) {
      const trail = trailsRef.current.get(id);
      if (!trail || trail.length < 2) continue;

      const ac = aircraft.find((a) => a.icao24 === id) ?? lastAircraftRef.current.get(id);
      const pts = trail.map((p) => ({ latitude: p.lat, longitude: p.lon }));

      if (ac) {
        const lastPt = pts[pts.length - 1];
        const lastStored = trail[trail.length - 1];
        if (Math.abs(lastPt.latitude - ac.latitude) > 0.00001 || Math.abs(lastPt.longitude - ac.longitude) > 0.00001) {
          let canExtend = true;
          if (trail.length >= 2) {
            const prev = trail[trail.length - 2];
            const prevB = bearing(prev.lat, prev.lon, lastStored.lat, lastStored.lon);
            const newB = bearing(lastStored.lat, lastStored.lon, ac.latitude, ac.longitude);
            if (angleDiff(prevB, newB) > MAX_TURN_DEG && quickDistance(lastStored.lat, lastStored.lon, ac.latitude, ac.longitude) < 500) {
              canExtend = false;
            }
          }
          if (canExtend) {
            pts.push({ latitude: ac.latitude, longitude: ac.longitude });
          }
        }
        const distToCenter = (centerLat != null && centerLon != null) ? quickDistance(centerLat, centerLon, ac.latitude, ac.longitude) : 0;
        trailCandidates.push({ id, ac, pts, dist: distToCenter });
      }
    }

    trailCandidates.sort((a, b) => a.dist - b.dist);
    for (const c of trailCandidates.slice(0, MAX_TOTAL_TRAILS)) {
      trails.push({
        id: c.id,
        color: altitudeColor(c.ac!.geoAltitude ?? c.ac!.baroAltitude),
        points: c.pts,
      });
    }

    return { trails, bufferedAircraft };
  }, []);

  return { updateTrails, clearTrails };
}
