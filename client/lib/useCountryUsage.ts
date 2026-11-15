// React-Anbindung der Länder-Nutzung (countryUsage.ts): neue Belegung bei
// jeder Änderung bzw. nach dem Laden, damit Karten ihre Länderlisten neu bilden.
import { useMemo, useSyncExternalStore } from "react";
import { getCountryUsageMap, getCountryUsageVersion, onCountryUsageChange, type CountryUsage } from "./countryUsage";

export function useCountryUsageMap(): Record<string, CountryUsage> {
  const version = useSyncExternalStore(onCountryUsageChange, getCountryUsageVersion, getCountryUsageVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getCountryUsageMap(), [version]);
}
