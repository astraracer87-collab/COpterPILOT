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

export async function getForegroundPermissionsAsync(): Promise<PermissionResponse> {
  if (!isAndroid) return ExpoLocation.getForegroundPermissionsAsync() as Promise<PermissionResponse>;
  const fine = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return toResponse(fine);
}

export async function requestForegroundPermissionsAsync(): Promise<PermissionResponse> {
  if (!isAndroid) return ExpoLocation.requestForegroundPermissionsAsync() as Promise<PermissionResponse>;
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ]);
  const fine = result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const coarse = result[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION];
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

function androidPosition(highAccuracy: boolean, timeoutMs: number): Promise<ExpoLocation.LocationObject> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (pos) => {
        const loc = toLocationObject(pos as GeoPosition);
        lastKnown = loc;
        resolve(loc);
      },
      (err) => reject(new Error(err?.message || "Standort nicht verfügbar")),
      { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 15000 },
    );
  });
}

export async function getCurrentPositionAsync(
  options: ExpoLocation.LocationOptions = {},
): Promise<ExpoLocation.LocationObject> {
  if (!isAndroid) return ExpoLocation.getCurrentPositionAsync(options);
  const wantsHigh = (options.accuracy ?? ExpoLocation.Accuracy.Balanced) >= ExpoLocation.Accuracy.High;
  try {
    // GPS kann ohne Netzwerk-Ortung (keine Play Services) beim Kaltstart dauern.
    return await androidPosition(true, wantsHigh ? 30000 : 20000);
  } catch (e) {
    try {
      return await androidPosition(false, 10000);
    } catch {
      if (lastKnown) return lastKnown;
      throw e;
    }
  }
}

export async function getLastKnownPositionAsync(): Promise<ExpoLocation.LocationObject | null> {
  if (!isAndroid) return ExpoLocation.getLastKnownPositionAsync();
  return lastKnown;
}

export async function watchPositionAsync(
  options: ExpoLocation.LocationOptions,
  callback: (location: ExpoLocation.LocationObject) => void,
): Promise<ExpoLocation.LocationSubscription> {
  if (!isAndroid) return ExpoLocation.watchPositionAsync(options, callback);
  const id = Geolocation.watchPosition(
    (pos) => {
      const loc = toLocationObject(pos as GeoPosition);
      lastKnown = loc;
      callback(loc);
    },
    () => {},
    {
      enableHighAccuracy: true,
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
