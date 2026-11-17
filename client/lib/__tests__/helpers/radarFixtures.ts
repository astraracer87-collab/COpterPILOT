// Testdaten für die Radar-Warnlogik (radarAlertLogic / radarMonitor)
import type { AircraftState } from "../../opensky";
import type { ProximityAlarmSettings } from "../../storage";
import { geoidUndulationM } from "../../../../shared/geoid";

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
/** Standard: 300 m MSL (GNSS-Höhe wie bei ADS-B über dem Ellipsoid). */
export function ac(id: string, kmNorth: number, opts: Partial<AircraftState> = {}): AircraftState {
  const latitude = USER.lat + kmNorth / 111.2;
  return {
    icao24: id,
    callsign: id.toUpperCase(),
    originCountry: "DE",
    latitude,
    longitude: USER.lon,
    baroAltitude: 300,
    geoAltitude: 300 + geoidUndulationM(latitude, USER.lon),
    onGround: false,
    velocity: 0,
    trueTrack: null,
    verticalRate: 0,
    category: "light" as AircraftState["category"],
    sources: [],
    ...opts,
  } as AircraftState;
}

