// Lettische Geozonen (LGS – VAS „Latvijas gaisa satiksme“ / AIS Latvia) aus dem
// offiziellen ED-269-Export der Drohnen-Plattform drz.lv:
//   GET https://drz.lv/api/v1/export-history/UASZoneVersion
// (ohne Anmeldung, ~13 MB, Content-Type „application/data“, Inhalt JSON).
//
// Format: Standard-ED-269 {title, zoneCount, crC32Q, description, features[]}
// mit UASZoneVersion-Objekten (identifier, country "LVA", name, restriction
// REQ_AUTHORISATION/CONDITIONAL/PROHIBITED/NO_RESTRICTION, reason[], message
// (lettisch), zoneAuthority[], applicability[], geometry[] (nur Polygone,
// Höhen in m AGL/AMSL), extendedProperties {isSunsetSunriseZone,
// additionalProperties, messageEng}).
//
// Entscheidungen:
//  - Text: extendedProperties.messageEng (englisch, wird von der App per
//    Wörterbuch ins Deutsche übersetzt) ersetzt `message`; fehlt er, bleibt der
//    lettische Text. Das lettische Original bleibt als `messageLv` erhalten,
//    der englische als `messageEn`. Bewusst KEINE localizedMessages: die würde
//    parseEd269ToGeozoneInfo der `message` vorziehen und damit Kontaktzeile und
//    Länderhinweise verwerfen.
//  - Mehrere geometry[]-Einträge je Zone: ed269ZonesToFeatures gruppiert nach
//    Höhenband (gleiche Höhen -> ein MultiPolygon, unterschiedliche -> je ein
//    Feature mit zoneId „<id>#n“). Koordinaten bleiben unverändert (volle
//    Präzision).
//  - isSunsetSunriseZone („SR-SS“, z. B. Flugplatz Jūrmala/EVJA): die Zone gilt
//    nur zwischen Sonnenaufgang und Sonnenuntergang. Ein ganztägiger Zeitplan
//    (bzw. ein fehlender) wird durch einen ED-269-Eintrag mit
//    startTime/endTime „Sonnenaufgang“/„Sonnenuntergang“ (+ startEvent/endEvent
//    SR/SS, wie bei Spanien) ersetzt. Die Aktivitätsprüfung der App kann diese
//    Zeiten nicht berechnen und wertet die Zone daher vorsorglich ganztägig als
//    aktiv; zusätzlich steht ein deutscher Hinweis im Text. Konkrete
//    Uhrzeit-Zeitpläne bleiben unverändert (nur Hinweis).
//  - Abgelaufene Gültigkeitsfenster (endDateTime < jetzt) werden entfernt; hat
//    eine Zone danach kein Fenster mehr, wird sie verworfen. Zukünftige Fenster
//    bleiben (die App zeigt die Zone dann als zeitweise inaktiv).
//  - zoneAuthority.siteUrl (LV-Schreibweise) wird zusätzlich als siteURL
//    (ED-269) gesetzt, damit Webseiten-Links erscheinen; fehlendes Schema ->
//    https://.
//  - Zonennamen: Leerraum vereinheitlicht (der Feed enthält Doppel-/
//    Endleerzeichen).
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

import { ed269ExtractZones, ed269ZonesToFeatures, stripEd269Html, type Ed269PureFeature } from "./ed269Pure";

export const LV_ED269_URL = "https://drz.lv/api/v1/export-history/UASZoneVersion";
export const LV_GEOZONE_SOURCE_LABEL = "LGS / AIS Latvia (ED-269)";

/** Deutscher Hinweis für SR-SS-Zonen (LABEL_PREFIX-Form „Hinweis LGS (lv): …“). */
export const LV_SUNRISE_SUNSET_NOTE =
  "Hinweis LGS (lv): Zone nur zwischen Sonnenaufgang und Sonnenuntergang aktiv (SR–SS); die App wertet sie vorsorglich ganztägig.";

function parseTs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

function cleanText(v: unknown): string {
  return stripEd269Html(String(v ?? "")).trim();
}

/** „SR-SS“ o. Ä. -> true; null/leer/„NO“/false -> false. */
export function latvianIsSunriseSunsetZone(zone: any): boolean {
  const v = zone?.extendedProperties?.isSunsetSunriseZone;
  if (v === true) return true;
  if (v == null || v === false) return false;
  const s = String(v).trim().toUpperCase();
  return s !== "" && s !== "NO" && s !== "FALSE" && s !== "0";
}

/** Englischer Text (messageEng) bzw. Fallback lettisch. */
export function latvianMessage(zone: any): string {
  const en = cleanText(zone?.extendedProperties?.messageEng);
  return en || cleanText(zone?.message);
}

/** Zeitplan-Eintrag „ganztägig an jedem Tag“ (00:00–23:59[:59])? */
function isAllDaySchedule(schedule: unknown): boolean {
  if (!Array.isArray(schedule) || schedule.length === 0) return true;
  return schedule.every((s: any) => {
    const days = Array.isArray(s?.day) ? s.day.map((d: any) => String(d).toUpperCase()) : ["ANY"];
    if (!days.includes("ANY")) return false;
    const start = String(s?.startTime ?? "00:00").replace(/Z$/i, "");
    const end = String(s?.endTime ?? "24:00").replace(/Z$/i, "");
    return /^00:00(:00(\.0+)?)?$/.test(start) && /^(23:59(:59)?(\.0+)?|24:00(:00)?(\.0+)?)$/.test(end);
  });
}

const SR_SS_SCHEDULE = [
  { day: ["ANY"], startTime: "Sonnenaufgang", endTime: "Sonnenuntergang", startEvent: "SR", endEvent: "SS" },
];

/**
 * applicability aufbereiten: abgelaufene Fenster entfernen, nach Beginn
 * sortieren, SR-SS-Zeitplan einsetzen. Liefert null, wenn die Zone nur
 * abgelaufene Fenster hatte (-> verwerfen).
 */
export function latvianApplicability(zone: any, now: Date = new Date()): any[] | null {
  const app: any[] = Array.isArray(zone?.applicability) ? zone.applicability.filter((a: any) => a && typeof a === "object") : [];
  if (app.length === 0) return [];
  const nowMs = now.getTime();
  const live = app.filter((a) => {
    if (String(a.permanent ?? "").toUpperCase() === "YES") return true;
    const end = parseTs(a.endDateTime);
    return end == null || end >= nowMs;
  });
  if (live.length === 0) return null;
  const srss = latvianIsSunriseSunsetZone(zone);
  return live
    .map((a) => (srss && isAllDaySchedule(a.schedule) ? { ...a, schedule: SR_SS_SCHEDULE.map((s) => ({ ...s, day: [...s.day] })) } : a))
    .sort((a, b) => (parseTs(a.startDateTime) ?? -Infinity) - (parseTs(b.startDateTime) ?? -Infinity));
}

/** true, wenn alle Gültigkeitsfenster vor `now` geendet haben. */
export function latvianZoneExpired(zone: any, now: Date = new Date()): boolean {
  return latvianApplicability(zone, now) === null;
}

function normalizeAuthority(a: any): any {
  if (!a || typeof a !== "object") return a;
  const out = { ...a };
  const site = String(a.siteURL ?? a.siteUrl ?? "").trim();
  if (site) out.siteURL = /^https?:\/\//i.test(site) ? site : `https://${site}`;
  return out;
}

/** Eine Roh-Zone für ed269ZonesToFeatures vorbereiten (null = verwerfen). */
export function prepareLatvianZone(zone: any, now: Date = new Date()): any | null {
  if (!zone || typeof zone !== "object") return null;
  const applicability = latvianApplicability(zone, now);
  if (applicability === null) return null;
  const name = String(zone.name ?? "").replace(/\s+/g, " ").trim();
  const zoneAuthority = Array.isArray(zone.zoneAuthority)
    ? zone.zoneAuthority.map(normalizeAuthority)
    : zone.zoneAuthority
      ? [normalizeAuthority(zone.zoneAuthority)]
      : undefined;
  return {
    ...zone,
    name: name || zone.identifier,
    message: latvianMessage(zone),
    messageLv: cleanText(zone.message) || undefined,
    messageEn: cleanText(zone?.extendedProperties?.messageEng) || undefined,
    applicability,
    zoneAuthority,
  };
}

/**
 * Normalisiert den drz.lv-ED-269-Export in die Feature-Form der App
 * (shared/ed269Pure.ts). Länder-Tagging (_country "lv") und bbox ergänzt
 * finalizeDirectFeatures im Client.
 */
export function normalizeLatvianZones(body: unknown, now: Date = new Date()): Ed269PureFeature[] {
  const zones = ed269ExtractZones(body)
    .map((z) => prepareLatvianZone(z, now))
    .filter((z): z is any => z != null);
  return ed269ZonesToFeatures(zones, {
    source: LV_GEOZONE_SOURCE_LABEL,
    messageSuffix: (z) => (latvianIsSunriseSunsetZone(z) ? [LV_SUNRISE_SUNSET_NOTE] : []),
    extraProps: (z) => {
      const extra: Record<string, any> = {};
      if (z.messageLv) extra.messageLv = z.messageLv;
      if (z.messageEn) extra.messageEn = z.messageEn;
      if (latvianIsSunriseSunsetZone(z)) extra.sunriseSunset = String(z.extendedProperties?.isSunsetSunriseZone);
      if (z.region != null) extra.region = z.region;
      return extra;
    },
  });
}
