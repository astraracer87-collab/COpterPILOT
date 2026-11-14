import { useQuery } from "@tanstack/react-query";
import { apiJson } from "@/lib/api-client";
import type { GermanEnergyInfrastructureResponse } from "../../shared/germanEnergyInfrastructure";

export function useGermanEnergyInfrastructure(
  latitude: number,
  longitude: number,
  radiusKm: number,
  countryIso: string,
  enabled = true,
) {
  const searchRadiusKm = Math.min(5, Math.max(0.5, radiusKm));
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    radiusKm: String(searchRadiusKm),
    countryIso,
  });
  const route = `/api/proxy/german-energy-infrastructure?${params.toString()}`;
  return useQuery<GermanEnergyInfrastructureResponse>({
    queryKey: ["energy-infrastructure", countryIso, latitude, longitude, searchRadiusKm],
    queryFn: () =>
      apiJson<GermanEnergyInfrastructureResponse>(route, { timeoutMs: 30_000 }),
    enabled: enabled && Number.isFinite(latitude) && Number.isFinite(longitude),
    staleTime: 15 * 60 * 1000,
    // Keep the last nearby result visible while a new viewport is checked.
    // Never carry assets across a country boundary.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === countryIso ? previousData : undefined,
    retry: 0,
  });
}
