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
 *    gemeinsamen Logik (radarAlertLogic.ts) bewerten. Alarme → Alarmton
 *    (+ Ansage) laut TA/RA-Einstellung wie im Vordergrund und eine
 *    Einblendung über anderen Apps (rot RA / gelb TA / grün „Clear of
 *    conflict“, Knopf „Quittieren“). Ohne Einblendungs-Berechtigung als
 *    Rückfall EINE Benachrichtigung mit fester ID (wird ersetzt, nie
 *    gestapelt, bei Entwarnung entfernt). Geozonen/NOTAM sind Vorflug-
 *    Informationen und werden im Hintergrund NICHT gemeldet.
 *  - Quittieren (Einblendung oder Banner im Radar, gemeinsamer Zustand
 *    `sharedAlertAcks`): Ton und Einblendung aus für DIESEN Konflikt (gleiches
 *    Luftfahrzeug); ein neues Luftfahrzeug oder TA → RA warnt erneut.
 *  - GPS: folgt der Screen dem GPS (kein manuell gesetzter Standort), hält
 *    der Dienst eine Positionsüberwachung (LocationManager) offen.
 *  - Ende: `stop()` (Radar verlassen, Tippen auf die Daueranzeige →
 *    „Beenden“) oder automatisch nach 4 h mit Hinweis.
 */
import type { AircraftState } from "./opensky";
import type { ProximityAlarmSettings } from "./storage";
import {
  ALARM_SETTINGS_REFRESH_MS,
  acknowledgeThreats,
  applyTrigger,
  checkApproachingAircraft,
  checkProximityAlerts,
  CLEAR_OF_CONFLICT_OVERLAY,
  decideProximityAlarm,
  filterAcknowledged,
  proximityNotificationText,
  sharedAlertAcks,
  threatOverlayContent,
  type AlertAckState,
  type AlertOverlayContent,
  type ApproachingAircraft,
  type ProximityAlert,
  type ProximityDecisionState,
} from "./radarAlertLogic";
import { clearTrafficAlerts, publishTrafficAlerts, summarizeTrafficAlerts } from "./trafficAlertStore";

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

export type RadarNotificationKind = "traffic-critical" | "traffic-warning" | "stopped";

export interface RadarNotification {
  kind: RadarNotificationKind;
  title: string;
  body: string;
}

/** Feste Benachrichtigungs-IDs: jede Art höchstens einmal, wird ersetzt statt gestapelt */
export const RADAR_TRAFFIC_NOTIFICATION_ID = "radar-traffic";
export const RADAR_STATUS_NOTIFICATION_ID = "radar-status";

export function radarNotificationId(kind: RadarNotificationKind): string {
  return kind === "stopped" ? RADAR_STATUS_NOTIFICATION_ID : RADAR_TRAFFIC_NOTIFICATION_ID;
}

/** Einblendung über anderen Apps (natives Modul „AlertOverlay“, lib/alertOverlay.ts) */
export interface RadarOverlayDeps {
  /** Berechtigung „Über anderen Apps einblenden“ erteilt und Modul vorhanden */
  canShow(): Promise<boolean>;
  /** Einblenden (bzw. bestehende aktualisieren); false = fehlgeschlagen → Rückfall */
  show(c: AlertOverlayContent): Promise<boolean>;
  /** Bestehende Einblendung aktualisieren (Text/Farbe), ohne neu hinzuzufügen */
  update(c: AlertOverlayContent): Promise<boolean>;
  hide(): void;
  /** Rückfall zum Ereignis: wurde seit der letzten Abfrage „Quittieren“ getippt? */
  takeDismissed(): Promise<boolean>;
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
  /**
   * Rückfall-Benachrichtigung mit fester ID je Art (radarNotificationId):
   * ersetzt eine vorhandene, stapelt nie. Verkehr nur ohne Einblendung.
   */
  notify(n: RadarNotification): Promise<void>;
  /** Benachrichtigung mit dieser festen ID entfernen */
  cancelNotification?(id: string): Promise<void>;
  /** Einblendung über anderen Apps; fehlt sie, gilt der Rückfall */
  overlay?: RadarOverlayDeps;
  /** Quittierte Konflikte (Standard: gemeinsamer Zustand mit dem Radar-Screen) */
  acks?: AlertAckState;
  /**
   * Alarmton (+ Sprachansage, falls TTS vorhanden) wie im Vordergrund
   * (proximityAlarm.ts). `approaching` false = TA „entfernt sich“ (leiser
   * Einzelton, siehe decideAlarmTone).
   */
  triggerSound(level: "warning" | "critical", settings: ProximityAlarmSettings, altitudeM: number | null, approaching: boolean): void;
  /** Laufender Alarm: Höhe/Richtung aktualisieren (TA „entfernt sich“ → „nähert sich“ wird laut) */
  updateSound?(altitudeM: number | null, approaching: boolean): void;
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
  /**
   * „Quittieren“ (Einblendung): Ton aus, Einblendung weg, aktuelle Konflikte
   * gelten als quittiert, bis sie eskalieren oder enden.
   */
  acknowledge(): void;
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
  const acks = deps.acks ?? sharedAlertAcks;
  /** Zuletzt gemeldete (gefilterte) Bedrohungen – werden beim Quittieren übernommen */
  let lastThreats: { alerts: ProximityAlert[]; approaching: ApproachingAircraft[] } = { alerts: [], approaching: [] };
  /** Wie wird der laufende Verkehrsalarm angezeigt? */
  let shownVia: "none" | "overlay" | "notification" = "none";
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

  /** Einblendung bzw. Rückfall-Benachrichtigung des Verkehrsalarms entfernen */
  const endPresentation = () => {
    if (shownVia === "overlay") safe(() => deps.overlay?.hide());
    if (shownVia === "notification") void deps.cancelNotification?.(RADAR_TRAFFIC_NOTIFICATION_ID)?.catch(() => {});
    shownVia = "none";
  };

  const resetAlarmState = () => {
    if (decision.currentLevel !== "none") deps.stopSound();
    decision = { currentLevel: "none", lastAlarmTime: 0 };
    lastThreats = { alerts: [], approaching: [] };
    // App im Vordergrund: dort zeigt der Radar-Screen sein eigenes Banner
    // (und meldet selbst an den Radar-Tab)
    endPresentation();
    clearTrafficAlerts("background");
  };

  function safe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      deps.log?.(`[radarMonitor] overlay: ${(e as Error)?.message ?? e}`);
    }
  }

  async function overlayOk(): Promise<boolean> {
    if (!deps.overlay) return false;
    try {
      return await deps.overlay.canShow();
    } catch {
      return false;
    }
  }

  /** Neuer Alarm / Eskalation: Einblendung, sonst EINE Benachrichtigung (feste ID) */
  async function presentTrigger(content: AlertOverlayContent | null, n: RadarNotification): Promise<void> {
    if (content && (await overlayOk())) {
      let ok = false;
      try {
        ok = await deps.overlay!.show(content);
      } catch {
        ok = false;
      }
      if (ok) {
        if (shownVia === "notification") void deps.cancelNotification?.(RADAR_TRAFFIC_NOTIFICATION_ID)?.catch(() => {});
        shownVia = "overlay";
        return;
      }
    }
    shownVia = "notification";
    await deps.notify(n);
  }

  /** Laufender Alarm: Einblendung aktualisieren (Benachrichtigung bleibt unverändert, kein erneuter Hinweis) */
  async function presentUpdate(content: AlertOverlayContent | null): Promise<void> {
    if (shownVia !== "overlay" || !content) return;
    try {
      if (!(await deps.overlay!.update(content))) shownVia = "none";
    } catch {
      shownVia = "none";
    }
  }

  /** Entwarnung: Einblendung grün „Clear of conflict“ (blendet sich selbst aus), Benachrichtigung weg */
  async function presentClear(): Promise<void> {
    if (shownVia === "overlay") {
      try {
        if (!(await deps.overlay!.update(CLEAR_OF_CONFLICT_OVERLAY))) safe(() => deps.overlay?.hide());
      } catch {
        safe(() => deps.overlay?.hide());
      }
    } else if (shownVia === "notification") {
      await deps.cancelNotification?.(RADAR_TRAFFIC_NOTIFICATION_ID).catch(() => {});
    }
    shownVia = "none";
  }

  function acknowledge(): void {
    acknowledgeThreats(acks, lastThreats.alerts, lastThreats.approaching);
    lastThreats = { alerts: [], approaching: [] };
    if (decision.currentLevel !== "none") deps.stopSound();
    // lastAlarmTime 0: ein NEUES Luftfahrzeug warnt sofort
    decision = { currentLevel: "none", lastAlarmTime: 0 };
    endPresentation();
  }

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
    // Rückfall zum Ereignis „alertOverlayDismissed“: Merker des nativen Moduls
    if (deps.overlay) {
      const dismissed = await deps.overlay.takeDismissed().catch(() => false);
      if (dismissed) acknowledge();
    }
    const now = deps.now();
    const s = await getSettings(now);

    // Verkehr
    if (s.enabled) {
      const aircraft = await deps.fetchAircraft(p.latitude, p.longitude, p.radiusKm);
      if (!running) return;
      const rawAlerts = checkProximityAlerts(aircraft, p.latitude, p.longitude, s, p.pilotElevationMSL);
      const rawApproaching = checkApproachingAircraft(aircraft, p.latitude, p.longitude, s, p.pilotElevationMSL);
      // Quittierte Konflikte bleiben still, bis sie eskalieren oder enden
      const { alerts, approaching } = filterAcknowledged(acks, rawAlerts, rawApproaching);
      lastThreats = { alerts, approaching };
      // Radar-Tab: alle Luftfahrzeuge in TA/RA, auch quittierte
      publishTrafficAlerts("background", summarizeTrafficAlerts(rawAlerts, acks));
      const d = decideProximityAlarm(decision, alerts, approaching, now);
      if (d.action === "trigger") {
        applyTrigger(decision, d, now);
        const text = proximityNotificationText(d);
        deps.triggerSound(d.level, s, d.altitudeM, d.approaching);
        await presentTrigger(threatOverlayContent(alerts, approaching, p.latitude, p.longitude), {
          kind: d.level === "critical" ? "traffic-critical" : "traffic-warning",
          ...text,
        });
      } else if (d.action === "update" && d.downgrade) {
        // RA → TA: keine neue Meldung, nur Stufe senken (Vordergrund: nach 5 s)
        decision.currentLevel = "warning";
        await presentUpdate(threatOverlayContent(alerts, approaching, p.latitude, p.longitude));
      } else if (d.action === "update") {
        deps.updateSound?.(d.altitudeM, d.approaching);
        await presentUpdate(threatOverlayContent(alerts, approaching, p.latitude, p.longitude));
      } else if (d.action === "clear" && decision.currentLevel !== "none") {
        deps.stopSound();
        decision.currentLevel = "none";
        await presentClear();
      }
    } else if (decision.currentLevel !== "none") {
      deps.stopSound();
      decision.currentLevel = "none";
      endPresentation();
    }
    if (!s.enabled) clearTrafficAlerts("background");
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
          await stop("timeout");
          // Wichtig (der Pilot verlässt sich auf die Überwachung): Einblendung,
          // sonst EINE Benachrichtigung mit fester ID
          const n: RadarNotification = {
            kind: "stopped",
            title: "Luftraumüberwachung beendet",
            body: "Nach 4 Stunden automatisch beendet. Radar öffnen, um erneut zu überwachen.",
          };
          let shown = false;
          if (!deps.isAppActive() && (await overlayOk())) {
            shown = await deps.overlay!.show({ level: "info", title: n.title, text: n.body, autoHideMs: 30000 }).catch(() => false);
          }
          if (!shown) await deps.notify(n).catch(() => {});
          break;
        }
        const active = deps.isAppActive();
        if (active) {
          // Vordergrund: Radar-Screen prüft selbst
          if (!wasActive) resetAlarmState();
          wasActive = true;
        } else {
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
    lastThreats = { alerts: [], approaching: [] };
    shownVia = "none";
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
    lastThreats = { alerts: [], approaching: [] };
    endPresentation();
    clearTrafficAlerts("background");
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
    acknowledge,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function __resetBackgroundMonitorFlagForTests(): void {
  activeFlag = false;
}
