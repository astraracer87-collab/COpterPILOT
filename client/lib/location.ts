/**
 * Standort-Schicht für Geräte ohne Google Play Services (z. B. DJI RC Pro 2).
 *
 * expo-location nutzt auf Android den "Fused Location Provider" aus den
 * Google Play Services. Auf DJI-Fernsteuerungen fehlen diese, Positionsabfragen
 * schlagen dort fehl oder hängen. Auf Android läuft die Position deshalb über
 * @react-native-community/geolocation mit dem Android-LocationManager (reines GPS),
 * Geocoding über Nominatim (OpenStreetMap). Kompass/Heading kommt weiterhin aus
 * expo-location (reine Sensoren, keine Play Services nötig).
 *
 * Die exportierten Funktionen haben dieselbe Form wie bei expo-location, damit
 * Screens nur den Import tauschen müssen:
 *   import * as Location from "@/lib/location";
 */
import { PermissionsAndroid, Platform } from "react-native";
import { useCallback, useEffect, useState } from "react";
import * as ExpoLocation from "expo-location";
import Geolocation from "@react-native-community/geolocation";
import { loadLastKnownPosition, saveLastKnownPosition } from "./mapFallbackCenter";

export {
  Accuracy,
  PermissionStatus,
  watchHeadingAsync,
} from "expo-location";
export type {
  LocationObject,
  LocationSubscription,
  LocationHeadingObject,
  LocationGeocodedAddress,
  LocationGeocodedLocation,
} from "expo-location";

const isAndroid = Platform.OS === "android";

if (isAndroid) {
  Geolocation.setRNConfiguration({
    skipPermissionRequests: true,
    locationProvider: "android",
  });
}

type PermissionResponse = {
  status: ExpoLocation.PermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
  expires: "never";
};

function toResponse(granted: boolean, canAskAgain = true): PermissionResponse {
  return {
    status: granted ? ExpoLocation.PermissionStatus.GRANTED : ExpoLocation.PermissionStatus.DENIED,
    granted,
    canAskAgain,
    expires: "never",
  };
}

// Hat der Nutzer nur den „ungefähren“ Standort erlaubt (Android 12+: nur
// COARSE), darf der LocationManager kein GPS benutzen – dann nur Netzwerk-Ortung.
let fineGranted: boolean | null = null;

export async function getForegroundPermissionsAsync(): Promise<PermissionResponse> {
  if (!isAndroid) return ExpoLocation.getForegroundPermissionsAsync() as Promise<PermissionResponse>;
  const fine = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  fineGranted = fine;
  if (fine) return toResponse(true);
  // „Ungefährer Standort“ zählt ebenfalls als erteilt (früher: Radar blieb dann
  // dauerhaft bei „Standort freigeben“ stehen).
  const coarse = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
  return toResponse(coarse);
}

export async function requestForegroundPermissionsAsync(): Promise<PermissionResponse> {
  if (!isAndroid) return ExpoLocation.requestForegroundPermissionsAsync() as Promise<PermissionResponse>;
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ]);
  const fine = result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const coarse = result[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION];
  fineGranted = fine === PermissionsAndroid.RESULTS.GRANTED;
  const granted = fine === PermissionsAndroid.RESULTS.GRANTED || coarse === PermissionsAndroid.RESULTS.GRANTED;
  const neverAsk = fine === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
  return toResponse(granted, !neverAsk);
}

/** Ersatz für den Hook aus expo-location. */
export function useForegroundPermissions(): [
  PermissionResponse | null,
  () => Promise<PermissionResponse>,
  () => Promise<PermissionResponse>,
] {
  const [status, setStatus] = useState<PermissionResponse | null>(null);
  const request = useCallback(async () => {
    const r = await requestForegroundPermissionsAsync();
    setStatus(r);
    return r;
  }, []);
  const get = useCallback(async () => {
    const r = await getForegroundPermissionsAsync();
    setStatus(r);
    return r;
  }, []);
  useEffect(() => {
    get().catch(() => {});
  }, [get]);
  return [status, request, get];
}

type GeoPosition = {
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number | null;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
};

function toLocationObject(p: GeoPosition): ExpoLocation.LocationObject {
  return {
    coords: {
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      altitude: p.coords.altitude ?? null,
      accuracy: p.coords.accuracy ?? null,
      altitudeAccuracy: p.coords.altitudeAccuracy ?? null,
      heading: p.coords.heading ?? null,
      speed: p.coords.speed ?? null,
    },
    timestamp: p.timestamp,
  };
}

let lastKnown: ExpoLocation.LocationObject | null = null;

function remember(loc: ExpoLocation.LocationObject): ExpoLocation.LocationObject {
  lastKnown = loc;
  saveLastKnownPosition(loc.coords.latitude, loc.coords.longitude, loc.timestamp).catch(() => {});
  return loc;
}

/** Deutsche Fehlermeldung zu den Codes des LocationManagers (1 = keine Berechtigung, 2 = kein Anbieter, 3 = Zeitüberschreitung). */
export function locationErrorMessageDe(err: unknown): string {
  const e = err as { code?: number; message?: string } | null;
  const msg = String(e?.message ?? "");
  if (e?.code === 1 || /permission/i.test(msg)) return "Keine Standort-Berechtigung";
  if (/no location provider/i.test(msg) || e?.code === 2) {
    return "Ortung am Gerät ausgeschaltet oder kein GPS-Empfang (Einstellungen → Standort prüfen)";
  }
  if (e?.code === 3 || /timed? ?out|zeitüberschreitung/i.test(msg)) return "Kein GPS-Fix (Zeitüberschreitung) – freie Sicht zum Himmel nötig";
  return msg || "Standort nicht verfügbar";
}

class LocationError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

/**
 * Einzelabfrage über den Android-LocationManager. Zusätzlich zum nativen
 * Timeout ein JS-Wächter: kommt (z. B. nach einem Fehler im nativen Modul)
 * gar kein Rückruf, hängt die Abfrage nicht für immer.
 */
function androidPosition(highAccuracy: boolean, timeoutMs: number, maximumAge = 15000): Promise<ExpoLocation.LocationObject> {
  return new Promise((resolve, reject) => {
    let done = false;
    const guard = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new LocationError("Location request timed out", 3));
    }, timeoutMs + 2000);
    try {
      Geolocation.getCurrentPosition(
        (pos) => {
          if (done) return;
          done = true;
          clearTimeout(guard);
          resolve(remember(toLocationObject(pos as GeoPosition)));
        },
        (err) => {
          if (done) return;
          done = true;
          clearTimeout(guard);
          reject(new LocationError(err?.message || "Standort nicht verfügbar", err?.code));
        },
        { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge },
      );
    } catch (e: any) {
      if (done) return;
      done = true;
      clearTimeout(guard);
      reject(new LocationError(e?.message || "Standort nicht verfügbar", 2));
    }
  });
}

/** Letzte Position, die Android selbst kennt (getLastKnownLocation), ohne auf einen neuen Fix zu warten. */
function androidCachedPosition(maxAgeMs: number): Promise<ExpoLocation.LocationObject | null> {
  // maximumAge groß → das native Modul liefert sofort getLastKnownLocation();
  // gibt es keine, startet es eine Einzelabfrage, die nach 1,5 s abbricht.
  return androidPosition(fineGranted !== false, 1500, Math.max(1000, Math.min(maxAgeMs, 365 * 24 * 3600 * 1000))).catch(() => null);
}

async function storedPosition(maxAgeMs?: number): Promise<ExpoLocation.LocationObject | null> {
  const p = await loadLastKnownPosition().catch(() => null);
  if (!p) return null;
  if (maxAgeMs != null && Date.now() - p.timestamp > maxAgeMs) return null;
  return {
    coords: { latitude: p.latitude, longitude: p.longitude, altitude: null, accuracy: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: p.timestamp,
  };
}

export async function getCurrentPositionAsync(
  options: ExpoLocation.LocationOptions = {},
): Promise<ExpoLocation.LocationObject> {
  if (!isAndroid) return remember(await ExpoLocation.getCurrentPositionAsync(options));
  const wantsHigh = (options.accuracy ?? ExpoLocation.Accuracy.Balanced) >= ExpoLocation.Accuracy.High;
  // Ganz frische Position (< 10 s) direkt verwenden
  if (lastKnown && Date.now() - lastKnown.timestamp < 10000) return lastKnown;
  if (fineGranted == null) await getForegroundPermissionsAsync().catch(() => null);
  let firstErr: unknown = null;
  if (fineGranted !== false) {
    try {
      // GPS ohne Netzwerk-Ortung (keine Play Services) braucht beim Kaltstart
      // u. U. lange; danach liefern Watch bzw. erneute Abfrage den Fix.
      return await androidPosition(true, wantsHigh ? 25000 : 15000);
    } catch (e) {
      firstErr = e;
    }
  }
  try {
    // Netzwerk-Ortung – fehlt ohne Play Services oft; dann fällt das native
    // Modul selbst auf GPS zurück.
    return await androidPosition(false, 8000);
  } catch (e) {
    firstErr = firstErr ?? e;
  }
  if (lastKnown) return lastKnown;
  const cached = await androidCachedPosition(30 * 60 * 1000);
  if (cached) return cached;
  throw new LocationError(locationErrorMessageDe(firstErr), (firstErr as any)?.code);
}

/**
 * Letzte bekannte Position: Speicher der Sitzung → Android (getLastKnownLocation)
 * → auf dem Gerät gespeicherte Position (auch aus früheren Sitzungen).
 * `maxAge` (ms) wie bei expo-location.
 */
export async function getLastKnownPositionAsync(
  options?: ExpoLocation.LocationLastKnownOptions,
): Promise<ExpoLocation.LocationObject | null> {
  const maxAge = options?.maxAge;
  const fresh = (l: ExpoLocation.LocationObject | null) => !!l && (maxAge == null || Date.now() - l.timestamp <= maxAge);
  if (!isAndroid) {
    const l = await ExpoLocation.getLastKnownPositionAsync(options).catch(() => null);
    if (l) return remember(l);
    return storedPosition(maxAge);
  }
  if (fresh(lastKnown)) return lastKnown;
  const cached = await androidCachedPosition(maxAge ?? 365 * 24 * 3600 * 1000);
  if (fresh(cached)) return cached;
  return storedPosition(maxAge);
}

export async function watchPositionAsync(
  options: ExpoLocation.LocationOptions,
  callback: (location: ExpoLocation.LocationObject) => void,
): Promise<ExpoLocation.LocationSubscription> {
  if (!isAndroid) return ExpoLocation.watchPositionAsync(options, (loc) => callback(remember(loc)));
  if (fineGranted == null) await getForegroundPermissionsAsync().catch(() => null);
  const id = Geolocation.watchPosition(
    (pos) => {
      callback(remember(toLocationObject(pos as GeoPosition)));
    },
    () => {},
    {
      // Nur „ungefährer Standort“ erlaubt → Netzwerk-Anbieter (GPS verweigert Android dann)
      enableHighAccuracy: fineGranted !== false,
      distanceFilter: options.distanceInterval ?? 0,
      interval: options.timeInterval ?? 2000,
      fastestInterval: 1000,
    },
  );
  return { remove: () => Geolocation.clearWatch(id) };
}

// ---------------------------------------------------------------------------
// Geocoding über Nominatim (OpenStreetMap)
// ---------------------------------------------------------------------------

const NOMINATIM = "https://nominatim.openstreetmap.org";
const NOMINATIM_HEADERS = { "User-Agent": "COpterPilot-RC/1.0", Accept: "application/json" };

async function fetchJson(url: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: NOMINATIM_HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function reverseGeocodeAsync(location: {
  latitude: number;
  longitude: number;
}): Promise<ExpoLocation.LocationGeocodedAddress[]> {
  if (!isAndroid) {
    try {
      return await ExpoLocation.reverseGeocodeAsync(location);
    } catch {
      // weiter mit Nominatim
    }
  }
  const data = await fetchJson(
    `${NOMINATIM}/reverse?format=json&addressdetails=1&accept-language=de&zoom=16&lat=${location.latitude}&lon=${location.longitude}`,
  );
  const a = data?.address;
  if (!a) return [];
  const city = a.city || a.town || a.village || a.municipality || a.hamlet || null;
  return [
    {
      city,
      district: a.city_district || a.suburb || a.county || null,
      streetNumber: a.house_number || null,
      street: a.road || a.pedestrian || a.path || null,
      region: a.state || null,
      subregion: a.county || null,
      country: a.country || null,
      postalCode: a.postcode || null,
      name: data.name || a.road || city || null,
      isoCountryCode: a.country_code ? String(a.country_code).toUpperCase() : null,
      timezone: null,
      formattedAddress: data.display_name || null,
    },
  ];
}

export async function geocodeAsync(address: string): Promise<ExpoLocation.LocationGeocodedLocation[]> {
  if (!isAndroid) {
    try {
      const r = await ExpoLocation.geocodeAsync(address);
      if (r.length > 0) return r;
    } catch {
      // weiter mit Nominatim
    }
  }
  const data = await fetchJson(
    `${NOMINATIM}/search?format=json&limit=5&accept-language=de&q=${encodeURIComponent(address)}`,
  );
  if (!Array.isArray(data)) return [];
  return data
    .map((d: any) => ({ latitude: parseFloat(d.lat), longitude: parseFloat(d.lon) }))
    .filter((d) => isFinite(d.latitude) && isFinite(d.longitude));
}
