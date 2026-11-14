import { getApiUrl } from "@/lib/query-client";
import { queryEd269CachedFeaturesFrom } from "@/lib/geozoneCoverage";
import { fetchNotams } from "@/lib/notams";
import { writePack, readPackData, type OfflinePackMeta } from "@/lib/offlineStore";
import { isOfflineNow } from "@/lib/network";
import { COUNTRY_BOUNDING_BOXES } from "../../shared/countryDetection";
import { BOOKABLE_COUNTRIES } from "../../shared/countryEntitlements";

// Orchestriert den Download eines Offline-Pakets für ein Land. Importiert die
// reinen Datenquellen direkt (geozoneCoverage + notams) und schreibt über den
// puren offlineStore — geozones.ts/notams.ts lesen ihrerseits NUR aus
// offlineStore, daher entsteht kein Import-Cycle.

function countryNameFor(iso: string): string {
  const up = iso.toUpperCase();
  return BOOKABLE_COUNTRIES.find((c) => c.iso === up)?.name ?? up;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function countryCenterAndRadius(iso: string): { lat: number; lon: number; radiusKm: number } {
  const box = COUNTRY_BOUNDING_BOXES.find((b) => b.iso === iso.toUpperCase());
  if (!box) return { lat: 51, lon: 10, radiusKm: 500 };
  const lat = (box.minLat + box.maxLat) / 2;
  const lon = (box.minLon + box.maxLon) / 2;
  const radiusKm = Math.ceil(haversineKm(lat, lon, box.maxLat, box.maxLon)) + 5;
  return { lat, lon, radiusKm };
}

/**
 * Lädt Geozonen-Vektordaten (gesamter Landesbestand) + NOTAMs für ein Land und
 * speichert sie als Offline-Paket. Fehler einer Einzelquelle brechen den
 * Download nicht ab (das Paket enthält dann eben weniger Daten); ein
 * vollständiger Fehlschlag (beide Quellen werfen) wird hochgereicht.
 */
export async function downloadOfflinePack(iso: string): Promise<OfflinePackMeta> {
  const up = iso.toUpperCase();

  // Download/Aktualisieren braucht echte Verbindung. Offline würden die
  // Datenquellen über ihren eigenen Offline-Fallback aus dem (alten) Paket
  // lesen und es danach mit denselben/leeren Daten überschreiben — das würde im
  // schlimmsten Fall gültige Geozonen vernichten. Daher hart abbrechen.
  if (isOfflineNow()) {
    throw new Error("Offline — zum Laden oder Aktualisieren wird eine Internetverbindung benötigt.");
  }

  const { lat, lon, radiusKm } = countryCenterAndRadius(up);

  let features: unknown[] = [];
  let featuresFailed = false;
  try {
    features = await queryEd269CachedFeaturesFrom(getApiUrl(), lat, lon, radiusKm, up, undefined, true);
  } catch {
    featuresFailed = true;
  }

  let notams: unknown[] = [];
  let notamsFailed = false;
  try {
    const res = await fetchNotams(lat, lon);
    notams = Array.isArray(res.notams) ? res.notams : [];
    if (res.error && notams.length === 0) notamsFailed = true;
  } catch {
    notamsFailed = true;
  }

  if (featuresFailed && notamsFailed) {
    throw new Error("Keine Verbindung — Offline-Paket konnte nicht geladen werden.");
  }

  // Teil-Fehlschlag darf vorhandene gültige Daten nicht überschreiben: für jede
  // fehlgeschlagene Quelle den alten Paket-Stand beibehalten statt leeren.
  if (featuresFailed || notamsFailed) {
    const prev = await readPackData(up);
    if (prev) {
      if (featuresFailed) features = Array.isArray(prev.features) ? prev.features : [];
      if (notamsFailed) notams = Array.isArray(prev.notams) ? prev.notams : [];
    }
  }

  return writePack(up, countryNameFor(up), {
    iso: up,
    cachedAt: Date.now(),
    features,
    notams,
  });
}

export {
  listOfflinePacks,
  getOfflineIndex,
  getOfflinePackMeta,
  deleteOfflinePack,
  getTotalOfflineBytes,
  isPackStale,
  STALE_AFTER_MS,
  type OfflinePackMeta,
} from "@/lib/offlineStore";
