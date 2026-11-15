// Testdaten für die Radar-Warnlogik (radarAlertLogic / radarMonitor)
import type { AircraftState } from "../../opensky";
import type { ProximityAlarmSettings } from "../../storage";

export const SETTINGS: ProximityAlarmSettings = {
  enabled: true,
  maxAltitudeM: 500,
  radiusKm: 5,
  ta: { visual: true, audio: true, haptic: true, radiusKm: 3 },
  ra: { visual: true, audio: true, haptic: true, radiusKm: 1 },
  tcasTimeEnabled: true,
  taTimeEnabled: true,
  taTimeSec: 40,
  raTimeEnabled: true,
  raTimeSec: 30,
} as ProximityAlarmSettings;

export const USER = { lat: 50, lon: 8 };
/** km nördlich des Piloten */
export function ac(id: string, kmNorth: number, opts: Partial<AircraftState> = {}): AircraftState {
  return {
    icao24: id,
    callsign: id.toUpperCase(),
    originCountry: "DE",
    latitude: USER.lat + kmNorth / 111.2,
    longitude: USER.lon,
    baroAltitude: 300,
    geoAltitude: 300,
    onGround: false,
    velocity: 0,
    trueTrack: null,
    verticalRate: 0,
    category: "light" as AircraftState["category"],
    sources: [],
    ...opts,
  } as AircraftState;
}

