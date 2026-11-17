// Interne Typen der clientseitigen Verkehrs-Aggregation.
import type { AircraftCategory, DataSource, SourceStatus } from "../opensky";

/** Rohmeldung einer einzelnen Quelle (vor Merge/Store). */
export interface RawState {
  icao24: string;
  callsign: string;
  originCountry: string;
  longitude: number;
  latitude: number;
  baroAltitude: number | null;
  geoAltitude: number | null;
  /** Höhe bereits über MSL (OGN/FLARM). */
  mslAltitude?: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  category: AircraftCategory;
  sources: DataSource[];
  registration?: string;
  aircraftType?: string;
  aircraftDesc?: string;
  operator?: string;
  cn?: string;
  military?: boolean;
  interesting?: boolean;
  pia?: boolean;
  ladd?: boolean;
  originIata?: string;
  destIata?: string;
  flightNumber?: string;
  /** Alter der Meldung beim Abruf in ms (z. B. OGN liefert das Alter je Position). */
  reportAgeMs?: number;
}

export interface SourceResult {
  states: RawState[];
  status: SourceStatus;
  /** 429/403 erhalten → exponentielles Backoff für diese Quelle. */
  rateLimited?: boolean;
}

export interface Tile { lat: number; lon: number; distNm: number; }
