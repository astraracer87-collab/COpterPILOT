import { useQuery } from "@tanstack/react-query";
import type { GermanEnergyInfrastructureResponse } from "../../shared/germanEnergyInfrastructure";
import { getEnergyInfrastructureCountry } from "../../shared/germanEnergyInfrastructure";
import { queryEnergyInfrastructure } from "@/lib/energyInfrastructureClient";

export function useGermanEnergyInfrastructure(
  latitude: number,
  longitude: number,
  radiusKm: number,
  countryIso: string,
  enabled = true,
) {
  const searchRadiusKm = Math.min(5, Math.max(0.5, radiusKm));
  const iso = String(countryIso ?? "").trim().toUpperCase();
  return useQuery<GermanEnergyInfrastructureResponse>({
    queryKey: ["energy-infrastructure", countryIso, latitude, longitude, searchRadiusKm],
    // Direkte Abfrage der öffentlichen Quellen (kein Server-Proxy mehr).
    queryFn: async () => {
      if (!getEnergyInfrastructureCountry(iso)) {
        throw new Error("Für dieses Land sind keine Anlagenquellen konfiguriert");
      }
      return queryEnergyInfrastructure(iso, latitude, longitude, searchRadiusKm);
    },
    enabled: enabled && Number.isFinite(latitude) && Number.isFinite(longitude),
    staleTime: 15 * 60 * 1000,
    // Keep the last nearby result visible while a new viewport is checked.
    // Never carry assets across a country boundary.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === countryIso ? previousData : undefined,
    retry: 0,
  });
}
