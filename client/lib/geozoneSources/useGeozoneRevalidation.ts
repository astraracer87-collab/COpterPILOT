// Teil A: React-Anbindung der Hintergrund-Aktualisierung (revalidate.ts).
//
// useGeozoneRevalidation: stößt beim Öffnen und bei jedem Länderwechsel (GPS/
// Standort inkl. Nachbarn im Umkreis) die Prüfung der Bestände an und erhöht
// `dataVersion`, sobald neue Daten für eines der Länder eintreffen – der Screen
// lädt dann neu (dataVersion in den Effekt-Abhängigkeiten).
// useVerdictChangeWatch: vergleicht das Urteil vor und nach neuen Daten und
// liefert den Hinweis „Neue Geozonen-Daten – Prüfergebnis hat sich geändert“.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getCountriesInRadius } from "@/lib/geozones";
import {
  getPendingWifiUpdates,
  isRelevantGeozoneChange,
  onGeozoneDataChanged,
  revalidateGeozoneSources,
  triggerGeozoneRevalidation,
  type RevalidatePurpose,
} from "./revalidate";
import {
  INITIAL_VERDICT_WATCH,
  verdictWatchReducer,
  type FlightVerdict,
  type VerdictChange,
} from "../../../shared/checks";

export interface GeozoneRevalidationOptions {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  radiusKm?: number | null;
  countryIso?: string | null;
  purpose: RevalidatePurpose;
  enabled?: boolean;
}

export interface GeozoneRevalidationState {
  /** Erhöht sich bei neuen Geozonen-Daten der betroffenen Länder bzw. nach „Jetzt aktualisieren“. */
  dataVersion: number;
  /** „Jetzt aktualisieren“: alle Länder im Umkreis sofort prüfen/neu laden. */
  refreshNow: () => Promise<void>;
  refreshing: boolean;
  /** Länder mit neuer Fassung, die auf WLAN wartet. */
  pendingWifi: string[];
  isos: string[];
}

export function useGeozoneRevalidation(opts: GeozoneRevalidationOptions): GeozoneRevalidationState {
  const { latitude, longitude, purpose } = opts;
  const enabled = opts.enabled !== false && latitude != null && longitude != null;
  const radius = Math.max(opts.radiusKm ?? 1, 0.5);
  // Länder auf ~1 km gerundet bestimmen (GPS-Rauschen löst keinen Neustart aus).
  const rLat = latitude != null ? Math.round(latitude * 100) / 100 : null;
  const rLon = longitude != null ? Math.round(longitude * 100) / 100 : null;
  const isos = useMemo(
    () => (enabled && rLat != null && rLon != null ? getCountriesInRadius(rLat, rLon, radius, opts.countryIso ?? undefined) : []),
    [enabled, rLat, rLon, radius, opts.countryIso],
  );
  const key = isos.join(",");
  const [dataVersion, setDataVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingWifi, setPendingWifi] = useState<string[]>([]);
  const isosRef = useRef(isos);
  isosRef.current = isos;

  // Auslöser: Screen geöffnet bzw. Länderwechsel
  useEffect(() => {
    if (!enabled || isos.length === 0) return;
    let cancelled = false;
    revalidateGeozoneSources(isos, purpose)
      .then(() => { if (!cancelled) setPendingWifi(getPendingWifiUpdates().filter((i) => isos.includes(i))); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, purpose, enabled]);

  // Neue Daten → neu auswerten (mehrere Ereignisse kurz hintereinander zusammenfassen)
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = onGeozoneDataChanged((e) => {
      if (!isRelevantGeozoneChange(e, isosRef.current)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setDataVersion((v) => v + 1), 400);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  const refreshNow = useCallback(async () => {
    const list = isosRef.current;
    if (list.length === 0) return;
    setRefreshing(true);
    try {
      await revalidateGeozoneSources(list, "manual");
      setPendingWifi(getPendingWifiUpdates().filter((i) => list.includes(i)));
    } finally {
      setRefreshing(false);
      setDataVersion((v) => v + 1);
    }
  }, []);

  return { dataVersion, refreshNow, refreshing, pendingWifi, isos };
}

/** Nur auslösen (Radar/Karte): Prüfung bei Länderwechsel, ohne Neuauswertung. */
export function triggerRevalidationFor(isos: string[], purpose: RevalidatePurpose): void {
  triggerGeozoneRevalidation(isos, purpose);
}

/**
 * Hinweis bei geändertem Urteil nach neuen Geozonen-Daten. `verdict` = null
 * solange geladen wird; `loadedVersion` = dataVersion, auf der das angezeigte
 * Ergebnis beruht.
 */
export function useVerdictChangeWatch(
  verdict: FlightVerdict | null,
  loadedVersion: number,
  dataVersion: number,
): { change: VerdictChange | null; dismiss: () => void } {
  const [state, dispatch] = useReducer(verdictWatchReducer, INITIAL_VERDICT_WATCH);
  useEffect(() => {
    if (dataVersion > 0) dispatch({ type: "data-changed", version: dataVersion });
  }, [dataVersion]);
  useEffect(() => {
    if (verdict) dispatch({ type: "evaluated", verdict, version: loadedVersion });
  }, [verdict, loadedVersion]);
  const dismiss = useCallback(() => dispatch({ type: "dismiss" }), []);
  return { change: state.change, dismiss };
}
