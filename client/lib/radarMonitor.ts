/**
 * Hintergrund-Überwachung des Live-Radars (Product Owner): Solange das Radar
 * überwacht und die App im Hintergrund ist (z. B. DJI Fly im Vordergrund),
 * laufen Verkehrsabfrage und Warnungen weiter.
 *
 * Dieser Kern ist RN-frei und bekommt alles Plattform-Spezifische über
 * `RadarMonitorDeps` (radarMonitorNative.ts verdrahtet Android-Vordergrund-
 * dienst, Benachrichtigungen, GPS, Abrufe). So ist die Start/Stopp-Logik ohne
 * Gerät testbar.
 *
 * Ablauf:
 *  - `start(params)` (Radar-Screen im Fokus, Position bekannt, Einstellung
 *    „Im Hintergrund weiter überwachen“ an – Standard): startet den
 *    Vordergrunddienst mit der Daueranzeige „COpter Pilot – Luftraum-
 *    überwachung aktiv“. Der Dienst hält die JS-Laufzeit aktiv.
 *  - Schleife im Dienst: im Vordergrund macht der Radar-Screen die Arbeit
 *    (Schleife wartet nur und setzt ihren Alarmzustand zurück); im
 *    Hintergrund alle 2 s (wie im Vordergrund) Verkehr abfragen und mit der
 *    gemeinsamen Logik (radarAlertLogic.ts) bewerten, alle 120 s Gebiet
 *    (Geozonen/NOTAM). Alarme → Benachrichtigung mit Ton + Vibration und –
 *    wie im Vordergrund – Sprachalarm laut TA/RA-Einstellung.
 *  - GPS: folgt der Screen dem GPS (kein manuell gesetzter Standort), hält
 *    der Dienst eine Positionsüberwachung (LocationManager) offen.
 *  - Ende: `stop()` (Radar verlassen, Tippen auf die Daueranzeige →
 *    „Beenden“) oder automatisch nach 4 h mit Hinweis.
 */
import type { AircraftState } from "./opensky";
import type { ProximityAlarmSettings } from "./storage";
import {
  ALARM_SETTINGS_REFRESH_MS,
  AREA_CHECK_INTERVAL_MS,
  applyTrigger,
  checkApproachingAircraft,
  checkProximityAlerts,
  createAreaAlertState,
  decideAreaAlerts,
  decideProximityAlarm,
  proximityNotificationText,
  type AreaAlertState,
  type ProximityDecisionState,
  type RadarAreaSnapshot,
} from "./radarAlertLogic";

/** Abfrage-Intervall (gleich wie StandaloneLiveTrafficScreen: 2 s) */
export const RADAR_POLL_INTERVAL_MS = 2000;
/** Automatisches Ende der Hintergrund-Überwachung */
export const RADAR_MONITOR_MAX_RUNTIME_MS = 4 * 60 * 60 * 1000;

export const RADAR_MONITOR_TITLE = "COpter Pilot – Luftraumüberwachung aktiv";
export const RADAR_MONITOR_DESC = "Verkehr, Geozonen und NOTAM werden weiter geprüft. Tippen zum Öffnen oder Beenden.";
/** Deep Link der Daueranzeige (Tippen → App fragt „Überwachung beenden?“) */
export const RADAR_MONITOR_STOP_URL = "copterpilot://radar-monitor/stop";

export interface RadarMonitorParams {
  latitude: number;
  longitude: number;
  /** Position aus dem GPS fortschreiben (false bei manuell gesetztem Standort) */
  followGps: boolean;
  radiusKm: number;
  raRadiusKm: number;
  /** Land für Geozonen/NOTAM (Einstellung des Radars); undefined = automatisch */
  countryIso: string | undefined;
  pilotElevationMSL: number | null;
}

export type RadarNotificationKind = "traffic-critical" | "traffic-warning" | "zone" | "notam" | "stopped";

export interface RadarNotification {
  kind: RadarNotificationKind;
  title: string;
  body: string;
}

export interface RadarServiceStartOptions {
  title: string;
  description: string;
  linkingURI: string;
  /** Android-Diensttyp: „location“ mit GPS, sonst „dataSync“ */
  foregroundServiceType: "location" | "dataSync";
}

export interface RadarMonitorDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  isAppActive(): boolean;
  /** Einstellung „Im Hintergrund weiter überwachen“ (Standard an) */
  loadBackgroundEnabled(): Promise<boolean>;
  /** Darf der Dienst den Typ „location“ nutzen (Standort-Berechtigung erteilt)? */
  hasLocationPermission(): Promise<boolean>;
  loadAlarmSettings(): Promise<ProximityAlarmSettings>;
  fetchAircraft(lat: number, lon: number, radiusKm: number): Promise<AircraftState[]>;
  fetchArea(lat: number, lon: number, raRadiusKm: number, countryIso: string | undefined): Promise<RadarAreaSnapshot | null>;
  notify(n: RadarNotification): Promise<void>;
  /** Sprachalarm wie im Vordergrund (proximityAlarm.ts) */
  triggerSound(level: "warning" | "critical", settings: ProximityAlarmSettings, altitudeM: number | null): void;
  stopSound(): void;
  watchPosition(cb: (lat: number, lon: number) => void): Promise<() => void>;
  service: {
    start(task: () => Promise<void>, opts: RadarServiceStartOptions): Promise<void>;
    stop(): Promise<void>;
  };
  log?(msg: string): void;
}

export type RadarMonitorStopReason = "user" | "screen" | "timeout" | "disabled" | "error";

export interface RadarMonitorStatus {
  running: boolean;
  startedAt: number | null;
  lastStopReason: RadarMonitorStopReason | null;
  foregroundServiceType: "location" | "dataSync" | null;
}

// RN-freier Status für useProximityAlarm (ohne native Abhängigkeiten)
let activeFlag = false;
export function isBackgroundMonitorActive(): boolean {
  return activeFlag;
}

export interface RadarMonitor {
  start(params: RadarMonitorParams): Promise<boolean>;
  update(params: Partial<RadarMonitorParams>): void;
  stop(reason?: RadarMonitorStopReason): Promise<void>;
  status(): RadarMonitorStatus;
  /** Ein Durchlauf im Hintergrund (für Tests und die Dienst-Schleife) */
  tick(): Promise<void>;
  subscribe(l: (s: RadarMonitorStatus) => void): () => void;
}

export function createRadarMonitor(deps: RadarMonitorDeps): RadarMonitor {
  let params: RadarMonitorParams | null = null;
  let running = false;
  let startedAt: number | null = null;
  let lastStopReason: RadarMonitorStopReason | null = null;
  let serviceType: "location" | "dataSync" | null = null;
  let generation = 0;
  let decision: ProximityDecisionState = { currentLevel: "none", lastAlarmTime: 0 };
  let area: AreaAlertState = createAreaAlertState();
  let lastAreaCheck = 0;
  let settings: ProximityAlarmSettings | null = null;
  let settingsAt = 0;
  let wasActive = true;
  let gpsFix = false;
  const listeners = new Set<(s: RadarMonitorStatus) => void>();

  const status = (): RadarMonitorStatus => ({ running, startedAt, lastStopReason, foregroundServiceType: serviceType });
  const emit = () => {
    const s = status();
    for (const l of listeners) {
      try {
        l(s);
      } catch {
        /* Listener-Fehler ignorieren */
      }
    }
  };

  const resetAlarmState = () => {
    if (decision.currentLevel !== "none") deps.stopSound();
    decision = { currentLevel: "none", lastAlarmTime: 0 };
    // Gebiet: beim nächsten Wechsel in den Hintergrund frisch prüfen und
    // bereits bekannte Zonen nicht erneut melden (im Vordergrund sichtbar)
    lastAreaCheck = 0;
  };

  async function getSettings(now: number): Promise<ProximityAlarmSettings> {
    if (!settings || now - settingsAt >= ALARM_SETTINGS_REFRESH_MS) {
      settings = await deps.loadAlarmSettings();
      settingsAt = now;
    }
    return settings;
  }

  async function tick(): Promise<void> {
    const p = params;
    if (!running || !p) return;
    const now = deps.now();
    const s = await getSettings(now);

    // Verkehr
    if (s.enabled) {
      const aircraft = await deps.fetchAircraft(p.latitude, p.longitude, p.radiusKm);
      if (!running) return;
      const alerts = checkProximityAlerts(aircraft, p.latitude, p.longitude, s, p.pilotElevationMSL);
      const approaching = checkApproachingAircraft(aircraft, p.latitude, p.longitude, s, p.pilotElevationMSL);
      const d = decideProximityAlarm(decision, alerts, approaching, now);
      if (d.action === "trigger") {
        applyTrigger(decision, d, now);
        const text = proximityNotificationText(d);
        deps.triggerSound(d.level, s, d.altitudeM);
        await deps.notify({ kind: d.level === "critical" ? "traffic-critical" : "traffic-warning", ...text });
      } else if (d.action === "update" && d.downgrade) {
        // RA → TA: keine neue Meldung, nur Stufe senken (Vordergrund: nach 5 s)
        decision.currentLevel = "warning";
      } else if (d.action === "clear" && decision.currentLevel !== "none") {
        deps.stopSound();
        decision.currentLevel = "none";
      }
    } else if (decision.currentLevel !== "none") {
      deps.stopSound();
      decision.currentLevel = "none";
    }

    // Gebiet (Geozonen / NOTAM), gleiches Intervall wie im Vordergrund
    if (now - lastAreaCheck >= AREA_CHECK_INTERVAL_MS) {
      lastAreaCheck = now;
      const snap = await deps.fetchArea(p.latitude, p.longitude, p.raRadiusKm, p.countryIso).catch(() => null);
      if (snap && running) {
        for (const n of decideAreaAlerts(area, snap)) await deps.notify({ kind: n.kind, title: n.title, body: n.body });
      }
    }
  }

  async function loop(gen: number): Promise<void> {
    let unwatch: (() => void) | null = null;
    try {
      if (serviceType === "location") {
        unwatch = await deps
          .watchPosition((lat, lon) => {
            if (params && params.followGps) {
              params.latitude = lat;
              params.longitude = lon;
              gpsFix = true;
            }
          })
          .catch(() => null);
      }
      while (running && gen === generation) {
        const now = deps.now();
        if (startedAt != null && now - startedAt >= RADAR_MONITOR_MAX_RUNTIME_MS) {
          await deps
            .notify({
              kind: "stopped",
              title: "Luftraumüberwachung beendet",
              body: "Nach 4 Stunden automatisch beendet. Radar öffnen, um erneut zu überwachen.",
            })
            .catch(() => {});
          await stop("timeout");
          break;
        }
        const active = deps.isAppActive();
        if (active) {
          // Vordergrund: Radar-Screen prüft selbst
          if (!wasActive) resetAlarmState();
          wasActive = true;
        } else {
          if (wasActive) {
            // Gerade in den Hintergrund: Gebiet bekannt machen, ohne bereits
            // sichtbare Zonen erneut zu melden, dann regulär weiter
            area = createAreaAlertState();
            lastAreaCheck = 0;
          }
          wasActive = false;
          try {
            await tick();
          } catch (e) {
            deps.log?.(`[radarMonitor] tick: ${(e as Error)?.message ?? e}`);
          }
        }
        await deps.sleep(RADAR_POLL_INTERVAL_MS);
      }
    } finally {
      unwatch?.();
    }
  }

  // Jeder start/stop erhöht den Zähler; ein überholter Start (z. B. Radar
  // schon wieder verlassen, während die Einstellung gelesen wurde) bricht ab.
  let startToken = 0;

  async function start(p: RadarMonitorParams): Promise<boolean> {
    const token = ++startToken;
    const enabled = await deps.loadBackgroundEnabled();
    if (token !== startToken) return false;
    if (!enabled) {
      if (running) await stop("disabled");
      return false;
    }
    if (running) {
      update(p);
      return true;
    }
    params = { ...p };
    running = true;
    activeFlag = true;
    startedAt = deps.now();
    lastStopReason = null;
    decision = { currentLevel: "none", lastAlarmTime: 0 };
    area = createAreaAlertState();
    lastAreaCheck = 0;
    settings = null;
    wasActive = true;
    gpsFix = false;
    const gen = ++generation;
    // Android 14: Typ „location“ nur mit Standort-Berechtigung (sonst
    // SecurityException); ohne GPS-Verfolgung genügt „dataSync“.
    const locationOk = p.followGps && (await deps.hasLocationPermission());
    if (gen !== generation) return false; // inzwischen gestoppt
    serviceType = locationOk ? "location" : "dataSync";
    if (serviceType === "dataSync" && params) params.followGps = false;
    try {
      await deps.service.start(() => loop(gen), {
        title: RADAR_MONITOR_TITLE,
        description: RADAR_MONITOR_DESC,
        linkingURI: RADAR_MONITOR_STOP_URL,
        foregroundServiceType: serviceType,
      });
    } catch (e) {
      deps.log?.(`[radarMonitor] start: ${(e as Error)?.message ?? e}`);
      running = false;
      activeFlag = false;
      startedAt = null;
      serviceType = null;
      lastStopReason = "error";
      emit();
      return false;
    }
    if (gen !== generation) {
      // Während des Dienststarts gestoppt → Dienst sofort wieder beenden
      await deps.service.stop().catch(() => {});
      return false;
    }
    emit();
    return true;
  }

  function update(p: Partial<RadarMonitorParams>): void {
    if (!params) return;
    const next = { ...params };
    for (const [k, v] of Object.entries(p)) {
      if (v !== undefined) (next as Record<string, unknown>)[k] = v;
    }
    // GPS-Verfolgung kann nur beim Start (Diensttyp) eingeschaltet werden
    if (serviceType !== "location") next.followGps = false;
    // Bei GPS-Verfolgung schreibt der Dienst die Position selbst fort (die
    // Position des Screens ist nur ein einzelner Fix)
    if (params.followGps && next.followGps && gpsFix) {
      next.latitude = params.latitude;
      next.longitude = params.longitude;
    }
    if (!next.followGps) gpsFix = false;
    params = next;
  }

  async function stop(reason: RadarMonitorStopReason = "screen"): Promise<void> {
    startToken++;
    if (!running) return;
    running = false;
    activeFlag = false;
    generation++;
    lastStopReason = reason;
    if (decision.currentLevel !== "none") deps.stopSound();
    decision = { currentLevel: "none", lastAlarmTime: 0 };
    startedAt = null;
    serviceType = null;
    try {
      await deps.service.stop();
    } catch (e) {
      deps.log?.(`[radarMonitor] stop: ${(e as Error)?.message ?? e}`);
    }
    emit();
  }

  return {
    start,
    update,
    stop,
    status,
    tick,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function __resetBackgroundMonitorFlagForTests(): void {
  activeFlag = false;
}
