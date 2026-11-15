import { useState, useEffect, useRef, useCallback } from "react";
import { AppState } from "react-native";
import { getSettings, type ProximityAlarmSettings, DEFAULT_PROXIMITY_ALARM } from "@/lib/storage";
import {
  checkProximityAlerts,
  checkApproachingAircraft,
  triggerWarningAlarm,
  triggerCriticalAlarm,
  stopAlarmSound,
  speakClearOfConflict,
  shouldShowVisual,
  updateAlarmAltitude,
  type ProximityAlert,
  type ApproachingAircraft,
} from "@/lib/proximityAlarm";
import { decideProximityAlarm, filterDismissedThreats, ALARM_SETTINGS_REFRESH_MS } from "@/lib/radarAlertLogic";
import { isBackgroundMonitorActive } from "@/lib/radarMonitor";
import { recordBatchFromAlerts, isRecording, recordAircraftEvent, getRecording } from "@/lib/trafficRecorder";
import type { AircraftState } from "@/lib/opensky";

// Sperrzeiten/Schwellen: radarAlertLogic.ts (gemeinsam mit der Hintergrund-Überwachung)
const SETTINGS_REFRESH_MS = ALARM_SETTINGS_REFRESH_MS;

export function useProximityAlarm(
  aircraft: AircraftState[],
  userLat: number | null,
  userLon: number | null,
  maxAltitudeOverrideM?: number,
  pilotElevationMSL?: number | null,
  /** Optionaler Override für den RA-Alarmradius (rot). Wird genutzt, um den
   *  Planungs-Umkreis + Vorwarn-Aura als effektiven RA-Trigger zu setzen, statt
   *  des global eingestellten RA-Radius. TA wird automatisch auf
   *  max(userSetting, RA + 0.5 km) angehoben, damit die Ringe sinnvoll sortiert
   *  bleiben. */
  raRadiusOverrideKm?: number
) {
  const [alarmSettings, setAlarmSettings] = useState<ProximityAlarmSettings>(DEFAULT_PROXIMITY_ALARM);
  const [activeAlerts, setActiveAlerts] = useState<ProximityAlert[]>([]);
  const [approachingAircraft, setApproachingAircraft] = useState<ApproachingAircraft[]>([]);
  const [alarmActive, setAlarmActive] = useState(false);
  const [alarmLevel, setAlarmLevel] = useState<"none" | "warning" | "critical">("none");
  const [clearOfConflict, setClearOfConflict] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // ICAOs, die der User aktiv weggedrückt hat. Bleiben unterdrückt,
  // bis das jeweilige Flugzeug die Schutz-/Approach-Zone verlässt.
  const dismissedIcaos = useRef<Set<string>>(new Set());
  const lastAlarmTime = useRef<number>(0);
  const currentLevel = useRef<"none" | "warning" | "critical">("none");
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDelayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingClear = useRef(false);
  const downgradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDowngrade = useRef(false);
  const dismissedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      // Hintergrund-Überwachung übernimmt (radarMonitor.ts): Sprachalarm des
      // Screens beenden, sonst liefe er ohne neue Daten weiter.
      if (nextState === "background" && isBackgroundMonitorActive()) {
        stopAlarmSound();
        currentLevel.current = "none";
        pendingClear.current = false;
        pendingDowngrade.current = false;
      }
      if (nextState === "active") {
        stopAlarmSound();
        currentLevel.current = "none";
        lastAlarmTime.current = 0;
        setAlarmActive(false);
        setAlarmLevel("none");
        setActiveAlerts([]);
        setApproachingAircraft([]);
        setClearOfConflict(false);
        pendingClear.current = false;
        pendingDowngrade.current = false;
        setDismissed(false);
      }
    });
    return () => subscription.remove();
  }, []);

  const settingsJson = useRef("");
  useEffect(() => {
    const loadSettings = () => {
      getSettings().then((s) => {
        const base = s.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
        let next: ProximityAlarmSettings = maxAltitudeOverrideM != null
          ? { ...base, maxAltitudeM: maxAltitudeOverrideM }
          : base;
        if (raRadiusOverrideKm != null && raRadiusOverrideKm > 0) {
          const baseRa = next.ra ?? DEFAULT_PROXIMITY_ALARM.ra!;
          const baseTa = next.ta ?? DEFAULT_PROXIMITY_ALARM.ta!;
          const overriddenRa = { ...baseRa, radiusKm: raRadiusOverrideKm };
          const overriddenTaKm = Math.max(baseTa.radiusKm ?? 3, raRadiusOverrideKm + 0.5);
          const overriddenTa = { ...baseTa, radiusKm: overriddenTaKm };
          next = { ...next, ra: overriddenRa, ta: overriddenTa };
        }
        const json = JSON.stringify(next);
        if (json !== settingsJson.current) {
          settingsJson.current = json;
          setAlarmSettings(next);
        }
      });
    };
    loadSettings();
    const interval = setInterval(loadSettings, SETTINGS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [maxAltitudeOverrideM, raRadiusOverrideKm]);

  useEffect(() => {
    if (userLat == null || userLon == null) return;

    if (isRecording() && !alarmSettings.enabled) {
      const recording = getRecording();
      if (recording) {
        const R = 6371000;
        for (const ac of aircraft) {
          const dLat = ((ac.latitude - userLat) * Math.PI) / 180;
          const dLon = ((ac.longitude - userLon) * Math.PI) / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos((userLat * Math.PI) / 180) * Math.cos((ac.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
          const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (distM <= recording.outerRadiusM) {
            const zone = distM <= recording.innerRadiusM ? "inner" : "outer";
            recordAircraftEvent(ac, zone, distM / 1000);
          }
        }
      }
    }

    if (!alarmSettings.enabled) {
      setActiveAlerts([]);
      setApproachingAircraft([]);
      setAlarmLevel("none");
      currentLevel.current = "none";
      return;
    }

    const rawAlerts = checkProximityAlerts(aircraft, userLat, userLon, alarmSettings, pilotElevationMSL);
    const rawApproaching = checkApproachingAircraft(aircraft, userLat, userLon, alarmSettings, pilotElevationMSL);

    // Auto-Rehabilitation + Filter weggedrückter Bedrohungen (gemeinsame
    // Logik mit der Hintergrund-Überwachung, radarAlertLogic.ts).
    const { alerts, approaching } = filterDismissedThreats(rawAlerts, rawApproaching, dismissedIcaos.current);

    setActiveAlerts(alerts);
    setApproachingAircraft(approaching);

    if (isRecording() && (alerts.length > 0 || approaching.length > 0)) {
      const approachIcaos = new Set(approaching.map((a) => a.aircraft.icao24));
      const zoneAlerts = alerts.filter((a) => a.level === "warning" || a.level === "critical") as Array<{ aircraft: typeof alerts[0]["aircraft"]; distanceKm: number; level: "warning" | "critical" }>;
      recordBatchFromAlerts(zoneAlerts, approachIcaos, aircraft);
    }

    const now = Date.now();
    const decision = decideProximityAlarm(
      { currentLevel: currentLevel.current, lastAlarmTime: lastAlarmTime.current },
      alerts,
      approaching,
      now,
      dismissed,
    );
    const newLevel = decision.newLevel;

    if (newLevel !== "none") {
      setAlarmLevel(newLevel);
    }

    if (newLevel === "critical" && pendingDowngrade.current && !dismissed) {
      pendingDowngrade.current = false;
      if (downgradeTimer.current) {
        clearTimeout(downgradeTimer.current);
        downgradeTimer.current = null;
      }
    }

    if (decision.action === "trigger") {
      lastAlarmTime.current = now;
      setAlarmActive(true);
      setAlarmLevel(decision.level);
      currentLevel.current = decision.level;
      if (decision.level === "critical") {
        triggerCriticalAlarm(alarmSettings, decision.altitudeM);
      } else {
        triggerWarningAlarm(alarmSettings, decision.altitudeM);
      }
    } else if (decision.action === "update") {
      const closestAlt = decision.altitudeM;
      updateAlarmAltitude(closestAlt);
      if (decision.downgrade) {
        if (!pendingDowngrade.current) {
          pendingDowngrade.current = true;
          if (downgradeTimer.current) clearTimeout(downgradeTimer.current);
          downgradeTimer.current = setTimeout(() => {
            if (pendingDowngrade.current) {
              pendingDowngrade.current = false;
              stopAlarmSound();
              triggerWarningAlarm(alarmSettings, closestAlt);
              setAlarmLevel("warning");
              currentLevel.current = "warning";
            }
          }, 5000);
        }
      }
    } else if (decision.action === "clear") {
      if (pendingDowngrade.current) {
        pendingDowngrade.current = false;
        if (downgradeTimer.current) {
          clearTimeout(downgradeTimer.current);
          downgradeTimer.current = null;
        }
      }
      if (currentLevel.current !== "none" && !pendingClear.current) {
        pendingClear.current = true;
        stopAlarmSound();
        setAlarmActive(false);
        setAlarmLevel("none");
        if (clearDelayTimer.current) clearTimeout(clearDelayTimer.current);
        clearDelayTimer.current = setTimeout(() => {
          if (pendingClear.current) {
            pendingClear.current = false;
            setClearOfConflict(true);
            speakClearOfConflict();
            if (clearTimer.current) clearTimeout(clearTimer.current);
            clearTimer.current = setTimeout(() => {
              setClearOfConflict(false);
            }, 6000);
            currentLevel.current = "none";
          }
        }, 10000);
      } else if (!pendingClear.current) {
        setAlarmActive(false);
        setAlarmLevel("none");
        setDismissed(false);
        currentLevel.current = "none";
      }
    }

    if (newLevel !== "none" && pendingClear.current) {
      pendingClear.current = false;
      if (clearDelayTimer.current) {
        clearTimeout(clearDelayTimer.current);
        clearDelayTimer.current = null;
      }
    }
  }, [aircraft, userLat, userLon, alarmSettings, dismissed, pilotElevationMSL]);

  useEffect(() => {
    return () => {
      stopAlarmSound();
      currentLevel.current = "none";
      pendingClear.current = false;
      pendingDowngrade.current = false;
      if (clearTimer.current) clearTimeout(clearTimer.current);
      if (clearDelayTimer.current) clearTimeout(clearDelayTimer.current);
      if (downgradeTimer.current) clearTimeout(downgradeTimer.current);
      if (dismissedTimer.current) clearTimeout(dismissedTimer.current);
    };
  }, []);

  const dismissAlarm = useCallback(() => {
    stopAlarmSound();
    setAlarmActive(false);
    setClearOfConflict(false);
    setDismissed(true);
    // Aktuell gemeldete Bedrohungen ins Dismiss-Set legen,
    // damit sie beim nächsten Poll nicht wieder auftauchen.
    setActiveAlerts((prev) => {
      for (const a of prev) dismissedIcaos.current.add(a.aircraft.icao24);
      return [];
    });
    setApproachingAircraft((prev) => {
      for (const a of prev) dismissedIcaos.current.add(a.aircraft.icao24);
      return [];
    });
    setAlarmLevel("none");
    currentLevel.current = "none";
    lastAlarmTime.current = 0;
    pendingClear.current = false;
    pendingDowngrade.current = false;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (clearDelayTimer.current) clearTimeout(clearDelayTimer.current);
    if (downgradeTimer.current) clearTimeout(downgradeTimer.current);
    if (dismissedTimer.current) clearTimeout(dismissedTimer.current);
    // Globalen Dismiss-Flag nach 10 s wieder freigeben — das per-ICAO-Set
    // bleibt weiter aktiv und schützt vor erneutem Pop-up desselben Flugzeugs.
    dismissedTimer.current = setTimeout(() => {
      setDismissed(false);
    }, 10000);
  }, []);

  return {
    alarmSettings,
    activeAlerts,
    approachingAircraft,
    alarmActive,
    alarmLevel,
    clearOfConflict,
    dismissAlarm,
  };
}
