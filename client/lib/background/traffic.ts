import * as Location from "expo-location";
import { getSettings } from "@/lib/storage";
import { fetchNearbyAircraft } from "@/lib/opensky";
import { checkProximityAlerts } from "@/lib/proximityAlarm";
import { notifyProximity } from "@/lib/background/notifications";

/**
 * Eine Runde Verkehrsprüfung im Hintergrund: Position holen, Flugzeuge abfragen,
 * Annäherung prüfen, bei Warnung/kritisch eine Benachrichtigung auslösen.
 * Gibt einen kurzen Status für die Dienst-Benachrichtigung zurück.
 */
let lastAlertKey = "";

export async function runTrafficCheck(): Promise<string> {
  const settings = await getSettings();
  const pa = settings.proximityAlarm;
  if (!pa || !pa.enabled) return "Verkehrsüberwachung aus";

  let lat: number;
  let lon: number;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    lat = pos.coords.latitude;
    lon = pos.coords.longitude;
  } catch {
    return "Kein Standort";
  }

  const radiusKm = Math.max(pa.radiusKm ?? 5, pa.ta?.radiusKm ?? 3, pa.ra?.radiusKm ?? 1);
  let states;
  try {
    const r = await fetchNearbyAircraft(lat, lon, radiusKm, 60);
    states = r.states;
  } catch {
    return "Verkehr: Abruf fehlgeschlagen";
  }

  const alerts = checkProximityAlerts(states, lat, lon, pa, null);
  const critical = alerts.filter((a) => a.level === "critical");
  const warning = alerts.filter((a) => a.level === "warning");
  const top = critical[0] ?? warning[0];

  if (top) {
    const levelLabel = top.level === "critical" ? "KRITISCH" : "Warnung";
    const key = `${top.level}:${top.aircraft.icao24}`;
    if (key !== lastAlertKey) {
      lastAlertKey = key;
      const call = top.aircraft.callsign?.trim();
      const ttc = top.ttcSec != null ? `, ~${Math.round(top.ttcSec)} s` : "";
      await notifyProximity(
        `Verkehr ${levelLabel}: Flugzeug nähert sich`,
        `${top.distanceKm.toFixed(1)} km · ${Math.round(top.altitudeM)} m${ttc}${call ? ` · ${call}` : ""}`,
      );
    }
    return `${critical.length} kritisch / ${warning.length} Warnung · ${alerts.length} nah`;
  }

  lastAlertKey = "";
  return states.length > 0 ? `${states.length} Flugzeuge in Reichweite` : "Keine Flugzeuge in der Nähe";
}
