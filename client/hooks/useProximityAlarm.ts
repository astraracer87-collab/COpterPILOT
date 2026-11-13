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
import { recordBatchFromAlerts, isRecording, recordAircraftEvent, getRecording } from "@/lib/trafficRecorder";
import type { AircraftState } from "@/lib/opensky";

const ALARM_COOLDOWN_MS = 3000;
const SETTINGS_REFRESH_MS = 5000;

export function useProximityAlarm(
  aircraft: AircraftState[],
  userLat: number | null,
  userLon: number | null,
  maxAltitudeOverrideM?: number,
  pilotElevationMSL?: number | null
) {
  const [alarmSettings, setAlarmSettings] = useState<ProximityAlarmSettings>(DEFAULT_PROXIMITY_ALARM);
  const [activeAlerts, setActiveAlerts] = useState<ProximityAlert[]>([]);
  const [approachingAircraft, setApproachingAircraft] = useState<ApproachingAircraft[]>([]);
  const [alarmActive, setAlarmActive] = useState(false);
  const [alarmLevel, setAlarmLevel] = useState<"none" | "warning" | "critical">("none");
  const [clearOfConflict, setClearOfConflict] = useState(false);
  const [dismissed, setDismissed] = useState(false);
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
        const next: ProximityAlarmSettings = maxAltitudeOverrideM != null
          ? { ...base, maxAltitudeM: maxAltitudeOverrideM }
          : base;
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
  }, [maxAltitudeOverrideM]);

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

    const alerts = checkProximityAlerts(aircraft, userLat, userLon, alarmSettings, pilotElevationMSL);
    const approaching = checkApproachingAircraft(aircraft, userLat, userLon, alarmSettings, pilotElevationMSL);
    setActiveAlerts(alerts);
    setApproachingAircraft(approaching);

    if (isRecording() && (alerts.length > 0 || approaching.length > 0)) {
      const approachIcaos = new Set(approaching.map((a) => a.aircraft.icao24));
      const zoneAlerts = alerts.filter((a) => a.level === "warning" || a.level === "critical") as Array<{ aircraft: typeof alerts[0]["aircraft"]; distanceKm: number; level: "warning" | "critical" }>;
      recordBatchFromAlerts(zoneAlerts, approachIcaos, aircraft);
    }

    const hasCritical = alerts.some((a) => a.level === "critical");
    const hasWarning = alerts.some((a) => a.level === "warning");
    const newLevel = hasCritical ? "critical" : hasWarning ? "warning" : "none";

    if (newLevel !== "none") {
      setAlarmLevel(newLevel);
    }

    if (newLevel !== "none" && !dismissed) {
      const now = Date.now();
      const escalated = newLevel === "critical" && currentLevel.current !== "critical";
      if (newLevel === "critical" && pendingDowngrade.current) {
        pendingDowngrade.current = false;
        if (downgradeTimer.current) {
          clearTimeout(downgradeTimer.current);
          downgradeTimer.current = null;
        }
      }
      const closestAlert = hasCritical
        ? alerts.find((a) => a.level === "critical")
        : alerts.find((a) => a.level === "warning");
      const closestAlt = closestAlert?.altitudeM ?? null;

      if ((now - lastAlarmTime.current > ALARM_COOLDOWN_MS && currentLevel.current === "none") || escalated) {
        lastAlarmTime.current = now;
        setAlarmActive(true);
        setAlarmLevel(newLevel);
        currentLevel.current = newLevel;
        if (newLevel === "critical") {
          triggerCriticalAlarm(alarmSettings, closestAlt);
        } else {
          triggerWarningAlarm(alarmSettings, closestAlt);
        }
      } else if (currentLevel.current !== "none") {
        updateAlarmAltitude(closestAlt);
        if (currentLevel.current === "critical" && newLevel === "warning") {
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
      }
    } else if (newLevel === "none" && approaching.length > 0 && !dismissed) {
      const now = Date.now();
      if (currentLevel.current === "none" && now - lastAlarmTime.current > ALARM_COOLDOWN_MS * 3) {
        lastAlarmTime.current = now;
        setAlarmActive(true);
        setAlarmLevel("warning");
        currentLevel.current = "warning";
        const closestApproach = approaching[0];
        triggerWarningAlarm(alarmSettings, closestApproach?.altitudeM ?? null);
      }
    } else if (newLevel === "none") {
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
    currentLevel.current = "none";
    lastAlarmTime.current = 0;
    pendingClear.current = false;
    pendingDowngrade.current = false;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (clearDelayTimer.current) clearTimeout(clearDelayTimer.current);
    if (downgradeTimer.current) clearTimeout(downgradeTimer.current);
    if (dismissedTimer.current) clearTimeout(dismissedTimer.current);
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
