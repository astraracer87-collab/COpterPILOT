// Teil A (Product Owner): Offline-Nutzung gespeicherter Wetter-, METAR/TAF-,
// NOTAM- und Kp-Daten. EINE Stelle für Schwellen und Texte.
//
//  - Gespeichert wird je Standort (gerundet auf 0,05°) das letzte erfolgreiche
//    Ergebnis mit Abrufzeit (client/lib/offlineResultCache.ts).
//  - Offline bzw. bei Abruffehler: Daten < 24 h werden angezeigt mit „Stand …“
//    (Vorhersage: „Offline-Vorhersage von HH:MM“); Wind/Böen älter als 6 h →
//    deutlicher Hinweis; METAR älter als 2 h nur grau (nicht im Urteil); TAF
//    bis zum Ende seiner Gültigkeit; NOTAMs nur noch gültige; Kp mit Alter.
//  - ≥ 24 h: nicht anzeigen, Hinweis „Gerät online bringen, um … zu prüfen“.
//  - Im Urteil zählen Offline-Daten höchstens als CAUTION („Offline-Daten
//    (Stand …) – vor dem Start online neu prüfen“): sie ergeben nie GO.
//    Befunde, die die Offline-Daten selbst auslösen (z. B. Wind über Limit),
//    bleiben so streng wie online (ein NO-GO wird nicht abgeschwächt).
//    Fehlend/zu alt = unbekannt.
//
// Reines Modul (kein React Native).

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Gespeicherte Daten älter als das werden nicht mehr gezeigt/verwendet. */
export const OFFLINE_DATA_MAX_AGE_MS = 24 * HOUR;
/** Wind-/Böendaten ab diesem Alter: deutlicher Hinweis. */
export const OFFLINE_WIND_WARN_AGE_MS = 6 * HOUR;
/** METAR ab diesem Alter nur grau (Information, nicht im Urteil). */
export const OFFLINE_METAR_GREY_AGE_MS = 2 * HOUR;
/** Rasterweite des Standort-Schlüssels (Grad). */
export const OFFLINE_LOCATION_STEP_DEG = 0.05;

export type OfflineDataKind = "weather" | "kp" | "metar" | "taf" | "notam";

/** Pilotenverständliche Bezeichnung je Datenart (für „Gerät online bringen, um … zu prüfen“). */
export const OFFLINE_KIND_LABEL: Record<OfflineDataKind, string> = {
  weather: "das Wetter",
  kp: "den Kp-Index",
  metar: "die METAR",
  taf: "die TAF",
  notam: "die NOTAMs",
};

/** Standort-Schlüssel (gerundet auf `step` Grad), z. B. „48.15_11.55“. */
export function offlineLocationKey(lat: number, lon: number, step: number = OFFLINE_LOCATION_STEP_DEG): string {
  const r = (v: number) => (Math.round(v / step) * step).toFixed(2);
  return `${r(lat)}_${r(lon)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** „HH:MM“ (Ortszeit), bei anderem Kalendertag „TT.MM. HH:MM“. */
export function formatStandTimeDe(fetchedAt: number, now: number = Date.now()): string {
  const d = new Date(fetchedAt);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? hm : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${hm}`;
}

/** Alter kurz: „vor 12 Min.“, „vor 5 h“. */
export function formatAgeShortDe(ageMs: number): string {
  const min = Math.max(0, Math.floor(ageMs / MIN));
  if (min < 60) return `vor ${Math.max(1, min)} Min.`;
  return `vor ${Math.floor(min / 60)} h`;
}

/** „Offline-Vorhersage von 14:05“ */
export function offlineForecastLabel(fetchedAt: number, now: number = Date.now()): string {
  return `Offline-Vorhersage von ${formatStandTimeDe(fetchedAt, now)}`;
}

/** „Stand 14:05 (vor 3 h)“ */
export function offlineStandLabel(fetchedAt: number, now: number = Date.now()): string {
  return `Stand ${formatStandTimeDe(fetchedAt, now)} (${formatAgeShortDe(now - fetchedAt)})`;
}

/** „Gerät online bringen, um das Wetter zu prüfen“ */
export function bringOnlineHint(kind: OfflineDataKind): string {
  return `Gerät online bringen, um ${OFFLINE_KIND_LABEL[kind]} zu prüfen`;
}

/** Grund im Urteil: „Offline-Daten (Stand 14:05) – vor dem Start online neu prüfen“ */
export function offlineCheckReason(fetchedAt: number, now: number = Date.now()): string {
  return `Offline-Daten (Stand ${formatStandTimeDe(fetchedAt, now)}) – vor dem Start online neu prüfen`;
}

/**
 * Bewertung gespeicherter Daten:
 *  - "expired": ≥ 24 h (bzw. TAF nach Gültigkeitsende) → nicht zeigen, unbekannt
 *  - "grey": METAR älter als 2 h → nur graue Information
 *  - "aged": Wetter mit Wind/Böen älter als 6 h → deutlicher Hinweis
 *  - "usable": anzeigen mit Stand
 */
export type OfflineDataState = "usable" | "aged" | "grey" | "expired";

export interface OfflineDataAssessment {
  state: OfflineDataState;
  ageMs: number;
  /** Anzeige-/Urteilsfähig (usable | aged | grey) */
  show: boolean;
  /** Darf ins Urteil eingehen (usable | aged; METAR „grey“ nicht) */
  useInVerdict: boolean;
}

export function assessOfflineData(
  kind: OfflineDataKind,
  fetchedAt: number,
  now: number = Date.now(),
  opts: { validUntil?: number | null } = {},
): OfflineDataAssessment {
  const ageMs = Math.max(0, now - fetchedAt);
  const expired =
    kind === "taf"
      ? opts.validUntil != null
        ? now >= opts.validUntil
        : ageMs >= OFFLINE_DATA_MAX_AGE_MS
      : ageMs >= OFFLINE_DATA_MAX_AGE_MS;
  if (expired) return { state: "expired", ageMs, show: false, useInVerdict: false };
  if (kind === "metar" && ageMs > OFFLINE_METAR_GREY_AGE_MS) return { state: "grey", ageMs, show: true, useInVerdict: false };
  if (kind === "weather" && ageMs >= OFFLINE_WIND_WARN_AGE_MS) return { state: "aged", ageMs, show: true, useInVerdict: true };
  return { state: "usable", ageMs, show: true, useInVerdict: true };
}

/** Nur noch gültige NOTAMs (endvalidity in Sekunden, wie autorouter). */
export function stillValidNotams<T extends { endvalidity?: number | null }>(notams: readonly T[], now: number = Date.now()): T[] {
  const nowSec = Math.floor(now / 1000);
  return notams.filter((n) => n.endvalidity == null || !Number.isFinite(n.endvalidity) || n.endvalidity > nowSec);
}

/**
 * Gültigkeitsende einer TAF („… 1512/1618 …“ = 15. 12 UTC bis 16. 18 UTC) in
 * ms, aus Ausgabezeit (`issuedAt`, ISO) bzw. Abrufzeit als Bezugsmonat. null,
 * wenn nicht erkennbar.
 */
export function tafValidUntil(raw: string | null | undefined, reference: string | number | null | undefined): number | null {
  if (!raw) return null;
  const m = /\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/.exec(raw);
  if (!m) return null;
  const refMs = typeof reference === "number" ? reference : reference ? new Date(reference).getTime() : NaN;
  if (!Number.isFinite(refMs)) return null;
  const ref = new Date(refMs);
  const fromDay = Number(m[1]);
  const toDay = Number(m[3]);
  const toHour = Number(m[4]);
  let year = ref.getUTCFullYear();
  let month = ref.getUTCMonth();
  // Beginn im Vormonat (Ausgabe am Monatsende, Bezug schon im neuen Monat)
  if (fromDay > ref.getUTCDate() + 1) month -= 1;
  // Ende im Folgemonat (Tag kleiner als Beginn)
  if (toDay < fromDay) month += 1;
  if (month < 0) { month += 12; year -= 1; }
  if (month > 11) { month -= 12; year += 1; }
  const ms = Date.UTC(year, month, toDay, toHour === 24 ? 0 : toHour) + (toHour === 24 ? 86_400_000 : 0);
  return Number.isFinite(ms) ? ms : null;
}

/** Herkunft eines Ergebnisses: live oder aus dem Offline-Speicher. */
export interface OfflineOrigin {
  /** Zeitpunkt des Abrufs (ms) */
  fetchedAt: number;
  /** true = aus dem Offline-Speicher (Gerät offline oder Abruf fehlgeschlagen) */
  cached: boolean;
}

export type StandTone = "normal" | "offline" | "warning" | "grey";

const STAND_LABEL: Record<OfflineDataKind, string> = {
  weather: "Wetter",
  kp: "Kp-Index",
  metar: "METAR",
  taf: "TAF",
  notam: "NOTAMs",
};

/**
 * Einheitliche „Stand“-Zeile je Quelle (Planung, Pre-Check, Radar), z. B.
 * „Wetter: Offline-Vorhersage von 14:05“, „NOTAMs: Stand 14:05 (vor 3 h) –
 * offline, nur noch gültige“, „METAR: Stand 09:20 (vor 3 h) – älter als 2 h,
 * nur zur Information“. Ohne Abrufzeit: null.
 */
export function formatSourceStand(
  kind: OfflineDataKind,
  origin: { fetchedAt: number; cached?: boolean } | null | undefined,
  now: number = Date.now(),
): { text: string; tone: StandTone } | null {
  if (!origin || !Number.isFinite(origin.fetchedAt)) return null;
  const label = STAND_LABEL[kind];
  if (!origin.cached) return { text: `${label}: Stand ${formatStandTimeDe(origin.fetchedAt, now)} (live)`, tone: "normal" };
  const a = assessOfflineData(kind, origin.fetchedAt, now);
  if (a.state === "expired") return { text: `${label}: ${bringOnlineHint(kind)}`, tone: "warning" };
  if (kind === "weather") {
    const base = `${label}: ${offlineForecastLabel(origin.fetchedAt, now)}`;
    return a.state === "aged"
      ? { text: `${base} – Wind/Böen älter als 6 h, vor dem Start prüfen`, tone: "warning" }
      : { text: base, tone: "offline" };
  }
  if (a.state === "grey") return { text: `${label}: ${offlineStandLabel(origin.fetchedAt, now)} – älter als 2 h, nur zur Information`, tone: "grey" };
  const suffix = kind === "notam" ? " – offline, nur noch gültige" : " – offline";
  return { text: `${label}: ${offlineStandLabel(origin.fetchedAt, now)}${suffix}`, tone: "offline" };
}
