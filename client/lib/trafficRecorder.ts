import type { AircraftState } from "@/lib/opensky";

export interface TrafficEvent {
  icao24: string;
  callsign: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
  speedKmh: number;
  heading: number | null;
  timestamp: number;
  zone: "inner" | "outer" | "approach";
}

export interface RecordedAircraftTrail {
  latitude: number;
  longitude: number;
  altitudeM: number;
  speedKmh: number;
  heading: number | null;
  timestamp: number;
}

export interface RecordedAircraft {
  icao24: string;
  callsign: string;
  firstSeen: number;
  lastSeen: number;
  minAltitudeM: number;
  maxAltitudeM: number;
  closestDistanceKm: number;
  zone: "inner" | "outer" | "approach";
  trail: RecordedAircraftTrail[];
}

export interface TrafficRecording {
  startTime: number;
  endTime: number | null;
  centerLatitude: number;
  centerLongitude: number;
  innerRadiusM: number;
  outerRadiusM: number;
  aircraft: RecordedAircraft[];
  mapSnapshotBase64?: string;
}

let recording: TrafficRecording | null = null;
const aircraftMap = new Map<string, RecordedAircraft>();

export function startRecording(
  latitude: number,
  longitude: number,
  innerRadiusM: number,
  outerRadiusM: number
): void {
  aircraftMap.clear();
  recording = {
    startTime: Date.now(),
    endTime: null,
    centerLatitude: latitude,
    centerLongitude: longitude,
    innerRadiusM,
    outerRadiusM,
    aircraft: [],
  };
}

export function stopRecording(): TrafficRecording | null {
  if (!recording) return null;
  recording.endTime = Date.now();
  recording.aircraft = Array.from(aircraftMap.values());
  const result = { ...recording };
  recording = null;
  aircraftMap.clear();
  return result;
}

export function isRecording(): boolean {
  return recording !== null;
}

export function getRecording(): TrafficRecording | null {
  if (!recording) return null;
  return {
    ...recording,
    aircraft: Array.from(aircraftMap.values()),
  };
}

export function setMapSnapshot(base64: string): void {
  if (recording) {
    recording.mapSnapshotBase64 = base64;
  }
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function recordAircraftEvent(
  aircraft: AircraftState,
  zone: "inner" | "outer" | "approach",
  distKm: number
): void {
  if (!recording) return;

  const now = Date.now();
  const altM = aircraft.geoAltitude ?? aircraft.baroAltitude ?? 0;
  const speedKmh = aircraft.velocity ? aircraft.velocity * 3.6 : 0;

  const existing = aircraftMap.get(aircraft.icao24);
  if (existing) {
    existing.lastSeen = now;
    existing.minAltitudeM = Math.min(existing.minAltitudeM, altM);
    existing.maxAltitudeM = Math.max(existing.maxAltitudeM, altM);
    existing.closestDistanceKm = Math.min(existing.closestDistanceKm, distKm);
    if (zone === "inner" || (zone === "outer" && existing.zone === "approach")) {
      existing.zone = zone;
    }
    if (aircraft.callsign && aircraft.callsign.trim()) {
      existing.callsign = aircraft.callsign.trim();
    }

    const lastTrail = existing.trail[existing.trail.length - 1];
    if (!lastTrail || now - lastTrail.timestamp > 2000) {
      existing.trail.push({
        latitude: aircraft.latitude,
        longitude: aircraft.longitude,
        altitudeM: altM,
        speedKmh: speedKmh,
        heading: aircraft.trueTrack ?? null,
        timestamp: now,
      });
    }
  } else {
    aircraftMap.set(aircraft.icao24, {
      icao24: aircraft.icao24,
      callsign: (aircraft.callsign || aircraft.icao24).trim(),
      firstSeen: now,
      lastSeen: now,
      minAltitudeM: altM,
      maxAltitudeM: altM,
      closestDistanceKm: distKm,
      zone,
      trail: [
        {
          latitude: aircraft.latitude,
          longitude: aircraft.longitude,
          altitudeM: altM,
          speedKmh: speedKmh,
          heading: aircraft.trueTrack ?? null,
          timestamp: now,
        },
      ],
    });
  }
}

export function recordBatchFromAlerts(
  alerts: Array<{
    aircraft: AircraftState;
    distanceKm: number;
    level: "warning" | "critical";
  }>,
  approachingIcaos: Set<string>,
  allAircraft: AircraftState[]
): void {
  if (!recording) return;

  for (const alert of alerts) {
    const zone = alert.level === "critical" ? "inner" : "outer";
    recordAircraftEvent(alert.aircraft, zone, alert.distanceKm);
  }

  for (const ac of allAircraft) {
    if (approachingIcaos.has(ac.icao24)) {
      const alertIcaos = new Set(alerts.map((a) => a.aircraft.icao24));
      if (!alertIcaos.has(ac.icao24)) {
        const dist = distanceKm(
          recording.centerLatitude,
          recording.centerLongitude,
          ac.latitude,
          ac.longitude
        );
        recordAircraftEvent(ac, "approach", dist);
      }
    }
  }
}
