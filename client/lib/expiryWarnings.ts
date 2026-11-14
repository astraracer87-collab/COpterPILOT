import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DroneProfile, PilotProfile, getDrones, getPilotProfile } from "./storage";

/**
 * Verwaltet Vorab-Warnungen für ablaufende Dokumente: AlphaTango-
 * Registrierung pro Drohne, Pilotenlizenzen (A1/A3, A2, STS) und die
 * Haftpflichtversicherung.
 *
 * Warnkadenz vor Ablauf:
 *   - 90 .. 60 Tage:  monatlich  (1 Erinnerung)
 *   - 60 .. 30 Tage:  wöchentlich
 *   - 30 ..  0 Tage:  täglich
 *
 * Auch nach Ablauf werden für 30 Tage täglich Erinnerungen geplant, damit
 * der Pilot den Eintrag nicht "vergisst".
 *
 * Umsetzung: Wir cancel'n alle vorher von uns geplanten Notifications
 * und re-scheduln auf Basis der aktuellen Daten. Alle Warnungen zum
 * selben Tag werden zu EINER Notification mit kompletter Übersicht
 * konsolidiert.
 */

const NOTIF_IDS_KEY = "@expiry/scheduled_notif_ids";
const ANDROID_CHANNEL_ID = "expiry-warnings";
const NOTIF_HOUR = 9; // lokale Uhrzeit der Erinnerung
const MAX_SCHEDULED = 50; // iOS limit liegt bei 64 → Puffer lassen

export type ExpiryCategory = "alphaTango" | "license" | "allgemeinerlaubnis";
export type ExpiryStatus = "ok" | "info" | "warn" | "critical" | "expired" | "missing";

export interface ExpiryItem {
  /** Stabile ID (z.B. "drone:<id>:alphaTango", "pilot:licenseA2"). */
  id: string;
  category: ExpiryCategory;
  /** Anzeigename ("AlphaTango – Mavic 3", "Lizenz A2", "Haftpflicht"). */
  label: string;
  /** Zusatzinfo (z.B. Drohnenname, Ausstellungsland). */
  subtitle?: string;
  /** Rohes Datum wie eingegeben (TT.MM.JJJJ) oder undefined wenn unbekannt. */
  rawDate?: string;
  /** Geparstes Ablauf-Datum (lokale Mitternacht) oder null. */
  expiresAt: Date | null;
  /** Tage bis Ablauf (negativ = bereits abgelaufen). null wenn unbekannt. */
  daysUntilExpiry: number | null;
  /** Aggregierter Status für UI-Färbung. */
  status: ExpiryStatus;
}

// ───────────────────────────── Datums-Parsing ──────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Strikte Validierung: JS rollt sonst "31.02." stillschweigend in den März. */
function makeValidatedDate(year: number, monthIdx: number, day: number): Date | null {
  if (year < 1900 || year > 2200) return null;
  if (monthIdx < 0 || monthIdx > 11) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(year, monthIdx, day);
  if (
    isNaN(d.getTime()) ||
    d.getFullYear() !== year ||
    d.getMonth() !== monthIdx ||
    d.getDate() !== day
  ) {
    return null;
  }
  return startOfDay(d);
}

/** Akzeptiert "TT.MM.JJJJ", "TT/MM/JJJJ", "JJJJ-MM-TT". */
export function parseExpiryDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // ISO YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return makeValidatedDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // DD.MM.YYYY oder DD/MM/YYYY
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return makeValidatedDate(year, Number(m[2]) - 1, Number(m[1]));
  }
  return null;
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86400000);
}

function classify(daysUntil: number | null): ExpiryStatus {
  if (daysUntil === null) return "missing";
  if (daysUntil < 0) return "expired";
  if (daysUntil <= 30) return "critical";
  if (daysUntil <= 60) return "warn";
  if (daysUntil <= 90) return "info";
  return "ok";
}

// ───────────────────────────── Sammeln ──────────────────────────────────────

export async function collectExpiryItems(): Promise<ExpiryItem[]> {
  const [drones, pilot] = await Promise.all([
    getDrones({ includeArchived: false }).catch(() => [] as DroneProfile[]),
    getPilotProfile().catch(() => null as PilotProfile | null),
  ]);
  const now = new Date();
  const items: ExpiryItem[] = [];

  for (const d of drones) {
    // Nur Drohnen mit hinterlegter AlphaTango (Nummer oder Dokument) tracken
    if (!d.alphaTangoId && !d.alphaTangoDocument) continue;
    const exp = parseExpiryDate(d.alphaTangoExpirationDate);
    const days = exp ? daysBetween(now, exp) : null;
    items.push({
      id: `drone:${d.id}:alphaTango`,
      category: "alphaTango",
      label: `AlphaTango – ${d.name}`,
      subtitle: d.alphaTangoId ? `Nr. ${d.alphaTangoId}` : "Registrierung Frankreich",
      rawDate: d.alphaTangoExpirationDate,
      expiresAt: exp,
      daysUntilExpiry: days,
      status: classify(days),
    });
  }

  if (pilot) {
    const pushLicense = (key: "licenseA1A3" | "licenseA2" | "licenseSTS", label: string) => {
      if (!pilot[key]) return;
      const details =
        key === "licenseA1A3"
          ? pilot.licenseA1A3Details
          : key === "licenseA2"
            ? pilot.licenseA2Details
            : pilot.licenseSTSDetails;
      const exp = parseExpiryDate(details?.expirationDate);
      const days = exp ? daysBetween(now, exp) : null;
      items.push({
        id: `pilot:${key}`,
        category: "license",
        label,
        subtitle: details?.identificationNumber ? `eID ${details.identificationNumber}` : undefined,
        rawDate: details?.expirationDate,
        expiresAt: exp,
        daysUntilExpiry: days,
        status: classify(days),
      });
    };
    // In DE deckt das Fernpiloten-Zeugnis A2 die Kompetenz A1/A3 mit ab —
    // wir blenden A1/A3 dann aus, um keine zwei redundanten Ablauf-Einträge
    // für faktisch eine Lizenz zu zeigen. Diese Abdeckungs-Regel gilt
    // ausschließlich für deutsche LBA-Lizenzen. Sobald A2 in einem anderen
    // Land ausgestellt wurde (oder Land leer/unklar ist), wird A1/A3
    // wieder als eigenständig ablaufende Lizenz getrackt.
    const a2Country = (pilot.licenseA2Details?.country || "DE").toUpperCase();
    const a2CoversA1A3 = pilot.licenseA2 && a2Country === "DE";
    if (!a2CoversA1A3) {
      pushLicense("licenseA1A3", "Kompetenznachweis A1/A3");
    }
    pushLicense("licenseA2", "Fernpiloten-Zeugnis A2");
    pushLicense("licenseSTS", "STS-Theorieprüfung");

    // Geografische Allgemeinerlaubnisse (§ 21h LuftVO) — eine pro Bundesland.
    // Eine AV ohne Ablaufdatum gilt als unbefristet → Status "ok" (nicht
    // "missing"), konsistent mit isErlaubnisValid() im Pilotenprofil.
    const seenAv = new Set<string>();
    for (const e of pilot.allgemeinverfuegung || []) {
      if (!e || typeof e.bundesland !== "string") continue;
      const bl = e.bundesland.trim();
      if (!bl || seenAv.has(bl)) continue;
      seenAv.add(bl);
      const exp = parseExpiryDate(e.expirationDate);
      const days = exp ? daysBetween(now, exp) : null;
      items.push({
        id: `pilot:av:${bl}`,
        category: "allgemeinerlaubnis",
        label: `Allgemeinerlaubnis – ${bl}`,
        subtitle: "§ 21h LuftVO",
        rawDate: e.expirationDate,
        expiresAt: exp,
        daysUntilExpiry: days,
        status: exp ? classify(days) : "ok",
      });
    }
  }

  // Sortierung: kritisch zuerst, dann nach verbleibenden Tagen
  const order: Record<ExpiryStatus, number> = {
    expired: 0, critical: 1, warn: 2, info: 3, missing: 4, ok: 5,
  };
  items.sort((a, b) => {
    const o = order[a.status] - order[b.status];
    if (o !== 0) return o;
    const ad = a.daysUntilExpiry ?? 9999;
    const bd = b.daysUntilExpiry ?? 9999;
    return ad - bd;
  });
  return items;
}

// ───────────────────────────── Notification-Scheduling ─────────────────────

interface ScheduleTrigger {
  /** ISO-Datum (yyyy-mm-dd) der Erinnerung. */
  dateKey: string;
  /** Zeitpunkt (Date), zu dem ausgelöst wird. */
  fireAt: Date;
  /** Items, die an diesem Tag fällig sind. */
  items: { item: ExpiryItem; daysLeftAtFire: number }[];
}

/** Berechnet alle Warntermine für ein Item zwischen jetzt und Ablauf+30 Tage. */
function computeWarningDates(item: ExpiryItem, now: Date): Date[] {
  if (!item.expiresAt) return [];
  const expiry = startOfDay(item.expiresAt);
  const today = startOfDay(now);
  const out: Date[] = [];

  // Schritt 1: monatliche Marker bei 90 und 60 Tagen vor Ablauf
  for (const offset of [90, 60]) {
    const d = new Date(expiry);
    d.setDate(d.getDate() - offset);
    if (d.getTime() >= today.getTime()) out.push(d);
  }
  // Schritt 2: wöchentlich im Bereich (60, 30] Tage vor Ablauf
  for (let offset = 56; offset > 30; offset -= 7) {
    const d = new Date(expiry);
    d.setDate(d.getDate() - offset);
    if (d.getTime() > today.getTime() || daysBetween(today, d) === 0) out.push(d);
  }
  // Schritt 3: täglich im Bereich [30, 0] Tage vor Ablauf
  for (let offset = 30; offset >= 0; offset -= 1) {
    const d = new Date(expiry);
    d.setDate(d.getDate() - offset);
    if (d.getTime() >= today.getTime()) out.push(d);
  }
  // Schritt 4: nach Ablauf täglich 30 Tage lang weiter erinnern
  for (let offset = 1; offset <= 30; offset += 1) {
    const d = new Date(expiry);
    d.setDate(d.getDate() + offset);
    if (d.getTime() >= today.getTime()) out.push(d);
  }
  return out;
}

function fireTime(day: Date): Date {
  const d = new Date(day);
  d.setHours(NOTIF_HOUR, 0, 0, 0);
  return d;
}

function buildTriggers(items: ExpiryItem[], now: Date): ScheduleTrigger[] {
  const byDay = new Map<string, ScheduleTrigger>();
  for (const item of items) {
    const dates = computeWarningDates(item, now);
    for (const day of dates) {
      const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      let trig = byDay.get(dateKey);
      if (!trig) {
        trig = { dateKey, fireAt: fireTime(day), items: [] };
        byDay.set(dateKey, trig);
      }
      const daysLeftAtFire = daysBetween(day, item.expiresAt!);
      trig.items.push({ item, daysLeftAtFire });
    }
  }
  const list = Array.from(byDay.values()).filter((t) => t.fireAt.getTime() > now.getTime() + 60_000);
  list.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return list.slice(0, MAX_SCHEDULED);
}

function isSupported(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

let handlerConfigured = false;
let androidChannelConfigured = false;

function configureHandler() {
  if (handlerConfigured || !isSupported()) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowAlert: true,
    }),
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android" || androidChannelConfigured) return;
  androidChannelConfigured = true;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Ablauf-Erinnerungen",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (error) {
    console.warn("expiry ensureAndroidChannel failed", error);
  }
}

async function ensurePermissions(): Promise<boolean> {
  if (!isSupported()) return false;
  configureHandler();
  await ensureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return req.granted;
}

async function cancelPreviouslyScheduled(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_IDS_KEY);
    if (!raw) return;
    const ids = JSON.parse(raw) as string[];
    for (const id of ids) {
      try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
    }
  } catch {}
  await AsyncStorage.removeItem(NOTIF_IDS_KEY);
}

function buildNotificationBody(t: ScheduleTrigger): { title: string; body: string } {
  const expired = t.items.filter((x) => x.daysLeftAtFire < 0);
  const today = t.items.filter((x) => x.daysLeftAtFire === 0);
  const soon = t.items.filter((x) => x.daysLeftAtFire > 0);
  const lines: string[] = [];
  for (const x of expired) lines.push(`• ${x.item.label}: seit ${-x.daysLeftAtFire} Tag(en) abgelaufen`);
  for (const x of today) lines.push(`• ${x.item.label}: läuft HEUTE ab`);
  for (const x of soon) lines.push(`• ${x.item.label}: in ${x.daysLeftAtFire} Tag(en)`);
  let title = "Drohnen-Dokumente";
  if (expired.length > 0) title = "Dokumente abgelaufen!";
  else if (today.length > 0) title = "Dokumente laufen heute ab";
  else if (soon.some((x) => x.daysLeftAtFire <= 30)) title = "Bald ablaufende Dokumente";
  else if (soon.some((x) => x.daysLeftAtFire <= 60)) title = "Dokumente: bitte verlängern";
  else title = "Dokumente: Vorabhinweis";
  return { title, body: lines.join("\n") };
}

// Single-flight Lock: verhindert, dass zwei parallele Aufrufe (z.B. App-Start
// + Overview-Screen on-mount) sich gegenseitig cancel'n/überschreiben und
// dadurch verwaiste Notifications hinterlassen, die wir später nicht mehr
// stornieren können.
let inflight: Promise<number> | null = null;
let rerunRequested = false;

async function doReschedule(): Promise<number> {
  if (!isSupported()) return 0;
  const granted = await ensurePermissions();
  if (!granted) {
    await cancelPreviouslyScheduled();
    return 0;
  }
  const items = await collectExpiryItems();
  const triggers = buildTriggers(items, new Date());
  await cancelPreviouslyScheduled();
  const newIds: string[] = [];
  for (const t of triggers) {
    const { title, body } = buildNotificationBody(t);
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { type: "expiry_warning", dateKey: t.dateKey },
          ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: t.fireAt,
          ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
      });
      newIds.push(id);
    } catch (err) {
      console.warn("expiry schedule failed", err);
    }
  }
  await AsyncStorage.setItem(NOTIF_IDS_KEY, JSON.stringify(newIds));
  return newIds.length;
}

/**
 * Hauptfunktion: liest aktuelle Drohnen + Pilotenprofil, cancel't alte
 * Erinnerungen und plant die nächsten Warntermine. Idempotent und
 * concurrency-safe — parallele Aufrufe werden serialisiert, ein
 * nachfolgender Aufruf während eines laufenden wird einmal coalesziert.
 */
export async function rescheduleExpiryWarnings(): Promise<number> {
  if (inflight) {
    rerunRequested = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      let result = await doReschedule();
      while (rerunRequested) {
        rerunRequested = false;
        result = await doReschedule();
      }
      return result;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function describeStatus(item: ExpiryItem): string {
  if (item.status === "missing") return "Kein Ablaufdatum hinterlegt";
  const d = item.daysUntilExpiry;
  if (d === null) return item.status === "ok" ? "Unbefristet" : "";
  if (d < 0) return `Vor ${-d} Tag(en) abgelaufen`;
  if (d === 0) return "Läuft heute ab";
  if (d === 1) return "Läuft morgen ab";
  return `Noch ${d} Tag(e)`;
}
