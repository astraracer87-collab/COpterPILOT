import { detectCountryFromCoordinates, detectBundeslandFromCoordinates } from "@/lib/countryMaps";

/** Bundesland/Ausland eines Flugs für die Dokumentenzuordnung (AV nur im passenden Bundesland). */
export function flightDocScope(entry: { bundesland?: string | null; latitude?: number | null; longitude?: number | null }): {
  bundesland: string | null;
  outsideGermany: boolean;
} {
  const lat = entry.latitude;
  const lon = entry.longitude;
  const hasPos = typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
  const iso = hasPos ? detectCountryFromCoordinates(lat!, lon!) : null;
  if (iso && iso !== "DE") return { bundesland: null, outsideGermany: true };
  const bl = entry.bundesland || (hasPos && iso === "DE" ? detectBundeslandFromCoordinates(lat!, lon!) : null);
  return { bundesland: bl ?? null, outsideGermany: false };
}
