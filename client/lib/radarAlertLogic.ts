/**
 * Gemeinsame Warnlogik des Live-Radars – RN-frei, damit Radar-Screen
 * (useProximityAlarm / StandaloneLiveTrafficScreen) und Hintergrund-
 * Überwachung (radarMonitor.ts) exakt dieselben Schwellen und Sperrzeiten
 * verwenden:
 *
 *  - Verkehr: checkProximityAlerts (TA/RA-Radius, TTC-Zeitschwellen,
 *    AGL-Limit) und checkApproachingAircraft (Anflug im Erfassungsradius),
 *    Entscheidung decideProximityAlarm (Sperrzeit 3 s bzw. 9 s für reinen
 *    Anflug, Eskalation auf RA sofort, Herabstufung, Entwarnung).
 *  - Gebiet: computeRadarAreaFlags (Wetter/Kp, NOTAM inkl. „unbekannt“,
 *    Temporärbeschränkungen, Geozonen im RA-Radius) und decideAreaAlerts
 *    (Hintergrund: Meldung nur für neu hinzugekommene Zonen/NOTAMs).
 */
import type { AircraftState } from "./opensky";
import type { ProximityAlarmSettings } from "./storage";

// ---------------------------------------------------------------------------
// Verkehr: Erkennung (unverändert aus proximityAlarm.ts übernommen)
// ---------------------------------------------------------------------------

export type AlertLevel = "approach" | "warning" | "critical";

export interface ProximityAlert {
  aircraft: AircraftState;
  distanceKm: number;
  altitudeM: number;
  level: AlertLevel;
  ttcSec?: number;
  isApproaching: boolean;
}

export interface ApproachingAircraft {
  aircraft: AircraftState;
  distanceKm: number;
  altitudeM: number;
  bearingDiff: number;
  ttcSec?: number;
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function bearingFromTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function angleDifference(a: number, b: number): number {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

function computeTTC(
  acLat: number,
  acLon: number,
  acTrack: number | null,
  acVelocity: number | null,
  userLat: number,
  userLon: number
): number | undefined {
  if (acTrack == null || acVelocity == null || acVelocity < 1) return undefined;
  const dist = haversineDistance(userLat, userLon, acLat, acLon);
  const bearingToUser = bearingFromTo(acLat, acLon, userLat, userLon);
  const bearingDiff = angleDifference(acTrack, bearingToUser);
  if (bearingDiff > 90) return undefined;
  const closingSpeedKmS = (acVelocity / 1000) * Math.cos((bearingDiff * Math.PI) / 180);
  if (closingSpeedKmS <= 0) return undefined;
  return dist / closingSpeedKmS;
}

export function checkApproachingAircraft(
  aircraft: AircraftState[],
  userLat: number,
  userLon: number,
  settings: ProximityAlarmSettings,
  pilotElevationMSL?: number | null
): ApproachingAircraft[] {
  if (!settings.enabled) return [];

  const approaching: ApproachingAircraft[] = [];
  const detectionRadiusKm = settings.radiusKm;

  for (const ac of aircraft) {
    if (ac.trueTrack == null) continue;

    const mslAlt = ac.geoAltitude ?? ac.baroAltitude;
    if (mslAlt == null) continue;
    if (ac.onGround && mslAlt < 100) continue;

    const relativeAlt = pilotElevationMSL != null ? mslAlt - pilotElevationMSL : mslAlt;
    // Hartes AGL-Limit aus den User-Settings: alles oberhalb wird gar nicht
    // erst geprüft (eine Drohne in 250 m AGL hat mit Verkehr in 500 m/800 m
    // schlicht nichts zu tun).
    if (relativeAlt > settings.maxAltitudeM) continue;

    const dist = haversineDistance(userLat, userLon, ac.latitude, ac.longitude);
    if (dist > detectionRadiusKm) continue;

    const bearingToUser = bearingFromTo(ac.latitude, ac.longitude, userLat, userLon);
    const bearingDiff = angleDifference(ac.trueTrack, bearingToUser);

    if (bearingDiff < 45) {
      const ttcSec = computeTTC(ac.latitude, ac.longitude, ac.trueTrack, ac.velocity, userLat, userLon);
      approaching.push({
        aircraft: ac,
        distanceKm: dist,
        altitudeM: relativeAlt,
        bearingDiff,
        ttcSec,
      });
    }
  }

  return approaching.sort((a, b) => a.distanceKm - b.distanceKm);
}

export function checkProximityAlerts(
  aircraft: AircraftState[],
  userLat: number,
  userLon: number,
  settings: ProximityAlarmSettings,
  pilotElevationMSL?: number | null
): ProximityAlert[] {
  if (!settings.enabled) return [];

  const alerts: ProximityAlert[] = [];
  const taRadiusKm = settings.ta?.radiusKm ?? 3;
  const raRadiusKm = settings.ra?.radiusKm ?? 1;
  const taTimeOn = settings.tcasTimeEnabled && (settings.taTimeEnabled ?? true);
  const raTimeOn = settings.tcasTimeEnabled && (settings.raTimeEnabled ?? true);
  const taTriggerSec = taTimeOn ? (settings.taTimeSec ?? 40) : undefined;
  const raTriggerSec = raTimeOn ? (settings.raTimeSec ?? 30) : undefined;

  for (const ac of aircraft) {
    const mslAlt = ac.geoAltitude ?? ac.baroAltitude;
    if (mslAlt == null) continue;
    if (ac.onGround && mslAlt < 100) continue;

    const relativeAlt = pilotElevationMSL != null ? mslAlt - pilotElevationMSL : mslAlt;
    // Hartes AGL-Limit aus den User-Settings (siehe checkApproachingAircraft).
    if (relativeAlt > settings.maxAltitudeM) continue;

    const dist = haversineDistance(userLat, userLon, ac.latitude, ac.longitude);
    const ttcSec = computeTTC(ac.latitude, ac.longitude, ac.trueTrack, ac.velocity, userLat, userLon);

    let level: AlertLevel | null = null;

    if (dist <= raRadiusKm) {
      level = "critical";
    } else if (raTriggerSec != null && ttcSec != null && ttcSec <= raTriggerSec && dist <= taRadiusKm) {
      level = "critical";
    } else if (dist <= taRadiusKm) {
      level = "warning";
    } else if (taTriggerSec != null && ttcSec != null && ttcSec <= taTriggerSec && dist <= taRadiusKm * 1.5) {
      level = "warning";
    }

    if (level) {
      let approaching = false;
      if (ac.trueTrack != null) {
        const bearingToUser = bearingFromTo(ac.latitude, ac.longitude, userLat, userLon);
        const bearingDiff = angleDifference(ac.trueTrack, bearingToUser);
        approaching = bearingDiff < 90;
      }
      alerts.push({
        aircraft: ac,
        distanceKm: dist,
        altitudeM: relativeAlt,
        level,
        ttcSec,
        isApproaching: approaching,
      });
    }
  }

  return alerts.sort((a, b) => a.distanceKm - b.distanceKm);
}


// ---------------------------------------------------------------------------
// Verkehr: Entscheidung (Sperrzeiten), gemeinsam für Vorder- und Hintergrund
// ---------------------------------------------------------------------------

/** Mindestabstand zwischen zwei Alarmen (TA/RA) */
export const ALARM_COOLDOWN_MS = 3000;
/** Reiner Anflug (noch kein TA/RA): dreifache Sperrzeit */
export const APPROACH_COOLDOWN_MS = ALARM_COOLDOWN_MS * 3;
/** Einstellungen werden so oft neu gelesen (Vorder- und Hintergrund) */
export const ALARM_SETTINGS_REFRESH_MS = 5000;

export type ProximityLevel = "none" | "warning" | "critical";

export interface ProximityDecisionState {
  /** Zuletzt ausgelöste Stufe */
  currentLevel: ProximityLevel;
  /** Zeitpunkt des letzten Alarms (ms) */
  lastAlarmTime: number;
}

export type ProximityDecision =
  /** Alarm auslösen (neu oder Eskalation auf RA) */
  | { action: "trigger"; level: "warning" | "critical"; reason: "alert" | "approach"; altitudeM: number | null; newLevel: ProximityLevel; approaching: boolean; alert?: ProximityAlert; approach?: ApproachingAircraft }
  /** Alarm läuft weiter: Höhe aktualisieren; `downgrade` = RA → TA */
  | { action: "update"; altitudeM: number | null; downgrade: boolean; newLevel: ProximityLevel; approaching: boolean }
  /** Keine Bedrohung mehr → Entwarnung */
  | { action: "clear"; newLevel: ProximityLevel }
  | { action: "none"; newLevel: ProximityLevel };

/**
 * Entscheidet anhand der (bereits um weggedrückte Flugzeuge bereinigten)
 * Treffer, ob ein Alarm ausgelöst wird. Ändert `state` nicht – der Aufrufer
 * setzt `currentLevel`/`lastAlarmTime` bei „trigger“ (siehe applyTrigger).
 */
export function decideProximityAlarm(
  state: ProximityDecisionState,
  alerts: ProximityAlert[],
  approaching: ApproachingAircraft[],
  now: number,
  dismissed = false,
): ProximityDecision {
  const critical = alerts.find((a) => a.level === "critical");
  const warning = alerts.find((a) => a.level === "warning");
  const newLevel: ProximityLevel = critical ? "critical" : warning ? "warning" : "none";

  if (newLevel !== "none" && !dismissed) {
    const escalated = newLevel === "critical" && state.currentLevel !== "critical";
    const closest = critical ?? warning;
    const altitudeM = closest?.altitudeM ?? null;
    const approachingThreat = alertsApproaching(alerts);
    if ((now - state.lastAlarmTime > ALARM_COOLDOWN_MS && state.currentLevel === "none") || escalated) {
      return { action: "trigger", level: newLevel, reason: "alert", altitudeM, newLevel, approaching: approachingThreat, alert: closest };
    }
    if (state.currentLevel !== "none") {
      return { action: "update", altitudeM, downgrade: state.currentLevel === "critical" && newLevel === "warning", newLevel, approaching: approachingThreat };
    }
    return { action: "none", newLevel };
  }
  if (newLevel === "none" && approaching.length > 0 && !dismissed) {
    if (state.currentLevel === "none" && now - state.lastAlarmTime > APPROACH_COOLDOWN_MS) {
      return { action: "trigger", level: "warning", reason: "approach", altitudeM: approaching[0]?.altitudeM ?? null, newLevel, approaching: true, approach: approaching[0] };
    }
    return { action: "none", newLevel };
  }
  if (newLevel === "none") return { action: "clear", newLevel };
  return { action: "none", newLevel };
}

/**
 * Nähert sich mindestens ein TA/RA-Treffer? Ohne Kursangabe (trueTrack null)
 * ist die Richtung unbekannt → vorsichtshalber wie „nähert sich“.
 */
export function alertsApproaching(alerts: ProximityAlert[]): boolean {
  return alerts.some((a) => a.isApproaching || a.aircraft.trueTrack == null);
}

// ---------------------------------------------------------------------------
// Verkehr: Alarmton (welcher Ton, wie oft, Vibration) – Vorder- und Hintergrund
// ---------------------------------------------------------------------------

export type AlarmToneKind = "critical" | "warning" | "soft";

export interface AlarmTonePlan {
  /** Abzuspielender Ton (null = stumm, z. B. „Akustisch“ aus) */
  tone: AlarmToneKind | null;
  /** Wiederholung solange der Alarm anhält (ms); null = nur einmal */
  repeatMs: number | null;
  /** Vibrationsmuster (react-native Vibration), null = keine */
  vibrate: number[] | null;
  /** Zusätzliche Sprachansage (expo-speech, nur wenn eine TTS-Engine da ist) */
  speak: boolean;
}

/** RA: alle 3 s wiederholen */
export const ALARM_TONE_REPEAT_CRITICAL_MS = 3000;
/** TA (nähert sich): alle 6 s wiederholen */
export const ALARM_TONE_REPEAT_WARNING_MS = 6000;
export const VIBRATE_CRITICAL = [0, 500, 150, 500, 150, 500];
export const VIBRATE_WARNING = [0, 400, 200, 400];
export const VIBRATE_SOFT = [0, 150];

/**
 * Welcher Ton zu einem Verkehrsalarm gehört:
 *  - RA (critical): lauter, schneller Piepton, alle 3 s, Sprachansage.
 *  - TA, Flugobjekt nähert sich (oder Richtung unbekannt / reiner Anflug):
 *    lauter Doppelton, alle 6 s, Sprachansage.
 *  - TA, Flugobjekt entfernt sich: ein einzelner leiser Ton, keine
 *    Wiederholung, keine Sprachansage (Banner bleibt sichtbar).
 * „Akustisch“/„Vibration“ je Stufe aus den TCAS-Einstellungen (Standard an).
 */
export function decideAlarmTone(
  level: "warning" | "critical",
  approaching: boolean,
  settings?: Pick<ProximityAlarmSettings, "ta" | "ra"> | null,
): AlarmTonePlan {
  const lvl = level === "critical" ? settings?.ra : settings?.ta;
  const audio = lvl?.audio ?? true;
  const haptic = lvl?.haptic ?? true;
  if (level === "critical") {
    return {
      tone: audio ? "critical" : null,
      repeatMs: audio ? ALARM_TONE_REPEAT_CRITICAL_MS : null,
      vibrate: haptic ? VIBRATE_CRITICAL : null,
      speak: audio,
    };
  }
  if (approaching) {
    return {
      tone: audio ? "warning" : null,
      repeatMs: audio ? ALARM_TONE_REPEAT_WARNING_MS : null,
      vibrate: haptic ? VIBRATE_WARNING : null,
      speak: audio,
    };
  }
  return { tone: audio ? "soft" : null, repeatMs: null, vibrate: haptic ? VIBRATE_SOFT : null, speak: false };
}

/** Zustand nach einem ausgelösten Alarm */
export function applyTrigger(state: ProximityDecisionState, d: ProximityDecision, now: number): void {
  if (d.action !== "trigger") return;
  state.currentLevel = d.level;
  state.lastAlarmTime = now;
}

/**
 * Weggedrückte Flugzeuge: bleiben unterdrückt, bis sie keine Bedrohung mehr
 * sind (dann werden sie aus `dismissedIcaos` entfernt). Gibt die gefilterten
 * Listen zurück.
 */
export function filterDismissedThreats(
  rawAlerts: ProximityAlert[],
  rawApproaching: ApproachingAircraft[],
  dismissedIcaos: Set<string>,
): { alerts: ProximityAlert[]; approaching: ApproachingAircraft[] } {
  if (dismissedIcaos.size === 0) return { alerts: rawAlerts, approaching: rawApproaching };
  const stillThreat = new Set<string>();
  for (const a of rawAlerts) stillThreat.add(a.aircraft.icao24);
  for (const a of rawApproaching) stillThreat.add(a.aircraft.icao24);
  for (const icao of Array.from(dismissedIcaos)) {
    if (!stillThreat.has(icao)) dismissedIcaos.delete(icao);
  }
  if (dismissedIcaos.size === 0) return { alerts: rawAlerts, approaching: rawApproaching };
  return {
    alerts: rawAlerts.filter((a) => !dismissedIcaos.has(a.aircraft.icao24)),
    approaching: rawApproaching.filter((a) => !dismissedIcaos.has(a.aircraft.icao24)),
  };
}

/** Deutscher Meldungstext eines Verkehrsalarms (Hintergrund-Benachrichtigung) */
export function proximityNotificationText(d: Extract<ProximityDecision, { action: "trigger" }>): { title: string; body: string } {
  const ac = d.alert?.aircraft ?? d.approach?.aircraft;
  const dist = d.alert?.distanceKm ?? d.approach?.distanceKm;
  const name = ac ? (ac.callsign?.trim() || ac.registration || ac.icao24.toUpperCase()) : "Luftfahrzeug";
  const parts = [name];
  if (dist != null) parts.push(`${dist.toFixed(1).replace(".", ",")} km`);
  if (d.altitudeM != null && Number.isFinite(d.altitudeM)) parts.push(`${Math.round(d.altitudeM / 10) * 10} m relativ`);
  const title =
    d.level === "critical"
      ? "RA – Luftfahrzeug sehr nah!"
      : d.reason === "approach"
        ? "Luftfahrzeug im Anflug"
        : "TA – Verkehr in der Nähe";
  return { title, body: parts.join(" · ") };
}

// ---------------------------------------------------------------------------
// Gebiet: Wetter, NOTAM, Geozonen (Reiter-Markierungen im Radar)
// ---------------------------------------------------------------------------

/** Abfrage-Intervall der Gebietsprüfung (Vorder- und Hintergrund) */
export const AREA_CHECK_INTERVAL_MS = 120000;

export interface RadarForecastLike {
  windSpeed: number;
  windGust?: number;
  rain: number;
  snow: number;
  temperature: number;
  cloudCover: number;
  visibility?: number;
}

export interface RadarAreaFlagInput {
  forecast: RadarForecastLike | null | undefined;
  kpValue: number | null | undefined;
  /** NOTAM-Abfrage fehlgeschlagen → kein „alles frei“ */
  notamUnknown: boolean;
  highNotamCount: number;
  tempRestrictionCount: number;
  activeDipulCount: number;
  geozoneCount: number;
}

export interface RadarAreaFlags {
  wetter: boolean;
  notam: boolean;
  geozone: boolean;
  weatherStatus: "ok" | "caution" | "critical" | "unknown";
}

/** Gleiche Schwellen wie bisher in StandaloneLiveTrafficScreen.checkAlerts */
export function computeRadarAreaFlags(i: RadarAreaFlagInput): RadarAreaFlags {
  const f = i.forecast ?? null;
  const kp = i.kpValue ?? null;
  const isCritical =
    !!(f && (f.windSpeed > 10 || (f.windGust != null && f.windGust > 12) || f.rain > 0.5 || f.snow > 0.5 || f.temperature < -5 || (f.visibility != null && f.visibility < 500))) ||
    !!(kp != null && kp >= 6);
  const isCaution =
    (!isCritical &&
      !!(f && (f.windSpeed > 7 || (f.windGust != null && f.windGust > 9) || f.rain > 0.1 || f.snow > 0.1 || f.temperature < 0 || f.cloudCover > 80 || (f.visibility != null && f.visibility < 1000)))) ||
    (!isCritical && !!(kp != null && kp >= 3));
  const weatherStatus = !f ? "unknown" : isCritical ? "critical" : isCaution ? "caution" : "ok";
  return {
    wetter: isCritical,
    notam: i.notamUnknown || i.highNotamCount > 0 || i.tempRestrictionCount > 0 || i.activeDipulCount > 0,
    geozone: i.geozoneCount > 0,
    weatherStatus,
  };
}

export interface RadarAreaItem {
  key: string;
  label: string;
}

/** Ergebnis einer Gebietsprüfung in neutraler Form (Vorder-/Hintergrund) */
export interface RadarAreaSnapshot {
  flags: RadarAreaFlags;
  /** Geozonen im RA-Radius (lösen den Reiter „Geozone“ aus) */
  zones: RadarAreaItem[];
  /** NOTAM hoher Schwere, Temporärbeschränkungen, aktive dipul-Beschränkungen */
  notams: RadarAreaItem[];
  notamUnknown: boolean;
}

export interface AreaAlertState {
  zoneKeys: Set<string>;
  notamKeys: Set<string>;
  notamUnknown: boolean;
}

export function createAreaAlertState(): AreaAlertState {
  return { zoneKeys: new Set(), notamKeys: new Set(), notamUnknown: false };
}

export interface AreaNotification {
  kind: "zone" | "notam";
  title: string;
  body: string;
}

function listLabels(items: RadarAreaItem[], max = 3): string {
  const names = items.map((i) => i.label).filter(Boolean);
  const head = names.slice(0, max).join(", ");
  return names.length > max ? `${head} und ${names.length - max} weitere` : head;
}

/**
 * Hintergrund: Meldung nur, wenn eine Geozone bzw. ein NOTAM / eine
 * Beschränkung NEU dazukommt (gleiche Auslöser wie die Reiter-Markierung im
 * Vordergrund). Verschwundene Einträge werden vergessen, damit ein erneutes
 * Auftauchen wieder gemeldet wird. NOTAM-Status „unbekannt“ wird einmal je
 * Ausfall gemeldet.
 */
export function decideAreaAlerts(state: AreaAlertState, snap: RadarAreaSnapshot): AreaNotification[] {
  const out: AreaNotification[] = [];
  const newZones = snap.zones.filter((z) => !state.zoneKeys.has(z.key));
  if (snap.flags.geozone && newZones.length > 0) {
    out.push({
      kind: "zone",
      title: newZones.length === 1 ? "Geozone im Warnradius" : `${newZones.length} Geozonen im Warnradius`,
      body: listLabels(newZones),
    });
  }
  state.zoneKeys = new Set(snap.zones.map((z) => z.key));

  const newNotams = snap.notams.filter((n) => !state.notamKeys.has(n.key));
  if (newNotams.length > 0) {
    out.push({
      kind: "notam",
      title: newNotams.length === 1 ? "NOTAM / Beschränkung aktiv" : `${newNotams.length} NOTAM / Beschränkungen aktiv`,
      body: listLabels(newNotams),
    });
  } else if (snap.notamUnknown && !state.notamUnknown) {
    out.push({ kind: "notam", title: "NOTAM-Status unbekannt", body: "NOTAM-Abfrage fehlgeschlagen – bitte manuell prüfen." });
  }
  state.notamKeys = new Set(snap.notams.map((n) => n.key));
  state.notamUnknown = snap.notamUnknown;
  return out;
}

// ---------------------------------------------------------------------------
// Verkehr: Quittieren („Quittieren“ auf der Einblendung über anderen Apps bzw.
// Wegdrücken des Banners im Radar) – gemeinsam für Vorder- und Hintergrund
// ---------------------------------------------------------------------------

/** Rang einer Bedrohung: reiner Anflug < TA < RA */
export const THREAT_RANK = { approach: 1, warning: 2, critical: 3 } as const;

/**
 * Quittierte Konflikte je Luftfahrzeug (Schlüssel = ICAO24) mit dem höchsten
 * quittierten Rang. Ein quittiertes Luftfahrzeug bleibt still, solange es
 * nicht eskaliert (TA → RA, Anflug → TA). Verlässt es den Warnbereich, wird
 * der Eintrag vergessen (nächstes Auftauchen warnt wieder).
 */
export interface AlertAckState {
  acked: Map<string, number>;
}

export function createAlertAckState(): AlertAckState {
  return { acked: new Map() };
}

/**
 * Gemeinsamer Zustand für Radar-Screen (useProximityAlarm) und Hintergrund-
 * Überwachung (radarMonitor): Quittieren im einen gilt auch im anderen.
 */
export const sharedAlertAcks: AlertAckState = createAlertAckState();

/** Schlüssel eines Konflikts (gleiches Luftfahrzeug = gleicher Konflikt) */
export function alertKey(ac: Pick<AircraftState, "icao24">): string {
  return ac.icao24;
}

function rankOfAlert(a: ProximityAlert): number {
  return THREAT_RANK[a.level];
}

/** Alle gemeldeten Bedrohungen quittieren (mit ihrem aktuellen Rang). */
export function acknowledgeThreats(state: AlertAckState, alerts: ProximityAlert[], approaching: ApproachingAircraft[]): void {
  const put = (key: string, rank: number) => {
    const prev = state.acked.get(key) ?? 0;
    if (rank > prev) state.acked.set(key, rank);
  };
  for (const a of alerts) put(alertKey(a.aircraft), rankOfAlert(a));
  for (const a of approaching) put(alertKey(a.aircraft), THREAT_RANK.approach);
}

/**
 * Filtert quittierte Bedrohungen heraus. Eskaliert ein quittiertes
 * Luftfahrzeug (höherer Rang als quittiert), bleibt es drin und löst erneut
 * aus. Luftfahrzeuge, die keine Bedrohung mehr sind, werden vergessen
 * („Reset bei Entwarnung“).
 */
export function filterAcknowledged(
  state: AlertAckState,
  rawAlerts: ProximityAlert[],
  rawApproaching: ApproachingAircraft[],
): { alerts: ProximityAlert[]; approaching: ApproachingAircraft[] } {
  if (state.acked.size === 0) return { alerts: rawAlerts, approaching: rawApproaching };
  const stillThreat = new Set<string>();
  for (const a of rawAlerts) stillThreat.add(alertKey(a.aircraft));
  for (const a of rawApproaching) stillThreat.add(alertKey(a.aircraft));
  for (const key of Array.from(state.acked.keys())) {
    if (!stillThreat.has(key)) state.acked.delete(key);
  }
  if (state.acked.size === 0) return { alerts: rawAlerts, approaching: rawApproaching };
  return {
    alerts: rawAlerts.filter((a) => (state.acked.get(alertKey(a.aircraft)) ?? 0) < rankOfAlert(a)),
    approaching: rawApproaching.filter((a) => (state.acked.get(alertKey(a.aircraft)) ?? 0) < THREAT_RANK.approach),
  };
}

// ---------------------------------------------------------------------------
// Verkehr: Einblendung über anderen Apps (Hintergrund, plugins/withAlertOverlay.js)
// ---------------------------------------------------------------------------

/** ra = rot, ta = gelb, clear = grün („Clear of conflict“), info = grau */
export type AlertOverlayLevel = "ra" | "ta" | "clear" | "info";

export interface AlertOverlayContent {
  level: AlertOverlayLevel;
  title: string;
  text: string;
  /** Richtung Pilot → Luftfahrzeug (Grad, 0 = Nord) für den Pfeil */
  bearingDeg?: number | null;
  /** Nach so vielen ms selbst ausblenden (Test, „Clear of conflict“) */
  autoHideMs?: number;
  /** Test-Einblendung (Quittieren meldet nichts an die Überwachung) */
  test?: boolean;
}

const COMPASS_8 = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];

/** 8-teilige Himmelsrichtung (deutsch) */
export function compassPoint(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return COMPASS_8[Math.round(d / 45) % 8]!;
}

/** Richtung Pilot → Luftfahrzeug (Grad, 0 = Nord) */
export function bearingToAircraft(userLat: number, userLon: number, ac: Pick<AircraftState, "latitude" | "longitude">): number {
  return bearingFromTo(userLat, userLon, ac.latitude, ac.longitude);
}

function aircraftName(ac: AircraftState): string {
  return ac.callsign?.trim() || ac.registration || ac.icao24.toUpperCase();
}

/**
 * Inhalt der Einblendung zur nächstgelegenen (gefilterten) Bedrohung:
 * großer Titel, Detailzeile mit Kennung, Entfernung, Höhe relativ und
 * Richtung. `null`, wenn es keine Bedrohung gibt.
 */
export function threatOverlayContent(
  alerts: ProximityAlert[],
  approaching: ApproachingAircraft[],
  userLat: number,
  userLon: number,
): AlertOverlayContent | null {
  const critical = alerts.find((a) => a.level === "critical");
  const warning = alerts.find((a) => a.level === "warning");
  const closest = critical ?? warning;
  const appr = closest ? undefined : approaching[0];
  const ac = closest?.aircraft ?? appr?.aircraft;
  if (!ac) return null;
  const dist = closest?.distanceKm ?? appr!.distanceKm;
  const alt = closest?.altitudeM ?? appr!.altitudeM;
  const bearing = bearingToAircraft(userLat, userLon, ac);
  const parts = [aircraftName(ac), `${dist.toFixed(1).replace(".", ",")} km`];
  if (alt != null && Number.isFinite(alt)) {
    const r = Math.round(alt / 10) * 10;
    parts.push(`${r > 0 ? "+" : ""}${r} m relativ`);
  }
  parts.push(`aus ${compassPoint(bearing)} (${String(Math.round(bearing) % 360).padStart(3, "0")}°)`);
  let title: string;
  if (critical) title = "RA – Flugobjekt sehr nah!";
  else if (warning) title = alertsApproaching(alerts) ? "TRAFFIC – Flugobjekt nähert sich" : "TRAFFIC – Flugobjekt in der Nähe";
  else title = "TRAFFIC – Flugobjekt im Anflug";
  return { level: critical ? "ra" : "ta", title, text: parts.join(" · "), bearingDeg: bearing };
}

/** Entwarnung (grün), blendet sich nach 5 s selbst aus */
export const CLEAR_OF_CONFLICT_OVERLAY: AlertOverlayContent = {
  level: "clear",
  title: "Clear of conflict",
  text: "Kein Verkehr mehr im Warnbereich.",
  autoHideMs: 5000,
};
