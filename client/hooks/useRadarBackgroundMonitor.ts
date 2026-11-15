/**
 * Radar-Screen ↔ Hintergrund-Überwachung: startet den Vordergrunddienst,
 * sobald das Radar im Fokus ist und eine Position hat (Einstellung „Im
 * Hintergrund weiter überwachen“, Standard an), hält Position/Radius/Land
 * aktuell und beendet ihn beim Verlassen des Radars. Der Wechsel der App in
 * den Hintergrund (z. B. DJI Fly) ist KEIN Verlassen: der Fokus bleibt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { installRadarMonitorLinking, radarMonitor } from "@/lib/radarMonitorNative";
import type { RadarMonitorParams, RadarMonitorStatus } from "@/lib/radarMonitor";

export interface UseRadarBackgroundMonitorInput {
  /** Radar überwacht (Zugriff vorhanden, Verkehr geladen) */
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  followGps: boolean;
  radiusKm: number;
  raRadiusKm: number;
  countryIso: string | undefined;
  pilotElevationMSL: number | null;
}

export function useRadarBackgroundMonitor(input: UseRadarBackgroundMonitorInput): RadarMonitorStatus {
  const [status, setStatus] = useState<RadarMonitorStatus>(() => radarMonitor.status());
  useEffect(() => radarMonitor.subscribe(setStatus), []);
  useEffect(() => installRadarMonitorLinking(), []);

  const ready = input.enabled && input.latitude != null && input.longitude != null;
  const { latitude, longitude, followGps, radiusKm, raRadiusKm, countryIso, pilotElevationMSL } = input;
  const params = useMemo<RadarMonitorParams | null>(
    () =>
      latitude == null || longitude == null
        ? null
        : { latitude, longitude, followGps, radiusKm, raRadiusKm, countryIso, pilotElevationMSL },
    [latitude, longitude, followGps, radiusKm, raRadiusKm, countryIso, pilotElevationMSL],
  );
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
    if (params) radarMonitor.update(params);
  }, [params]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return undefined;
      if (latest.current) void radarMonitor.start(latest.current);
      return () => {
        void radarMonitor.stop("screen");
      };
    }, [ready]),
  );

  return status;
}
