// Länder-Nutzung (Product Owner): je Land „Aus“, „Online“ oder „Offline“.
//
// - off:     keine Geozonen-Abrufe, keine Hintergrund-Aktualisierung, keine
//            Live-Abfragen, keine Karten-/Hindernis-Pakete. Beim Umschalten
//            werden die herunterladbaren Daten gelöscht (countryUsageData.ts);
//            Datei-Importe bleiben auf dem Gerät, werden aber nicht genutzt.
//            Liegt ein geprüfter Ort in einem deaktivierten Land, meldet die
//            Abdeckung „deaktiviert“ (≥ CAUTION, manuelle Bestätigung).
// - online:  die Basis-Geozonen des Landes (ED-269-Landesdatei bzw. Teil
//            „base“ des Kachelspeichers DE/FR/CZ/ES) werden vollständig
//            geladen, gespeichert und automatisch aktuell gehalten (große
//            Pakete nur im WLAN, außer mobile Daten sind erlaubt). Karte,
//            Luftbild, Hindernisse und große Zusatzteile nur bei Netz (live).
// - offline: zusätzlich Karte, Luftbild, Hindernisse und große Zusatzteile
//            (DE-Wohngrundstücke, ES-Infrastruktur/Naturschutz) auf dem Gerät
//            (countryUsageData.ts: syncOfflineCountries).
// Liechtenstein hat keine eigene Einstellung: es folgt immer der Schweiz
// (USAGE_ALIASES, Anzeige „Schweiz / Liechtenstein“).
//
// Standard: DE = offline, alle anderen = aus; das Land der GPS-Position wird
// beim ersten Start einmalig vorgeschlagen. Bestehende Installationen: Länder
// mit gespeicherten Daten (Paket, Bestand, Import) starten als „offline“.
//
// Zentrale Quelle für alle Abrufpfade (ed269Store, geozones, revalidate,
// tileStore, Karten). Solange die Einstellung nicht geladen ist (App-Start
// noch nicht erfolgt, Tests), gilt jedes Land als aktiviert – asynchrone
// Abrufpfade warten mit `awaitCountryUsage()` auf einen laufenden Ladevorgang.
//
// RN-frei: AsyncStorage wird lazy geladen (unter tsx bleibt der Wert im Speicher).

import { OFFLINE_APP_COUNTRIES } from "./mapSources";
import { getOwnGeozoneSourceMeta, resolveGeozoneSourceIso } from "../../shared/geozoneSourceMeta";

export type CountryUsage = "off" | "online" | "offline";

export const COUNTRY_USAGE_VALUES: CountryUsage[] = ["off", "online", "offline"];

export const COUNTRY_USAGE_LABELS: Record<CountryUsage, string> = {
  off: "Aus",
  online: "Online",
  offline: "Offline",
};

/**
 * Länder ohne eigene Einstellung (Product Owner): Liechtenstein folgt immer
 * der Schweiz (gleicher BAZL-Datensatz, gleiche swisstopo-Kacheln). Intern
 * bleibt CH der Schlüssel, LI ist Alias.
 */
export const USAGE_ALIASES: Readonly<Record<string, string>> = { LI: "CH" };

/** Gemeinsamer Anzeigename je Einstellungs-Land (CH = „Schweiz / Liechtenstein“). */
export const USAGE_LABEL_OVERRIDES: Readonly<Record<string, string>> = { CH: "Schweiz / Liechtenstein" };

/** Einstellungs-Land eines Landes (LI → CH, sonst unverändert, Großbuchstaben). */
export function usageIsoOf(iso: string | null | undefined): string {
  const up = String(iso || "").toUpperCase();
  return USAGE_ALIASES[up] ?? up;
}

/** Alle Länder der Einstellung (Reihenfolge der Einstellungen; LI steckt in CH). */
export const USAGE_COUNTRIES: { iso: string; label: string }[] = OFFLINE_APP_COUNTRIES
  .filter((c) => !USAGE_ALIASES[c.iso])
  .map((c) => ({ iso: c.iso, label: USAGE_LABEL_OVERRIDES[c.iso] ?? c.label }));
const USAGE_ISOS = new Set(USAGE_COUNTRIES.map((c) => c.iso));

/** Standard für neue Installationen: Deutschland offline. */
export const DEFAULT_OFFLINE_ISOS: readonly string[] = ["DE"];

export const COUNTRY_USAGE_STORAGE_KEY = "@copterpilot/country_usage_v1";

interface StoredUsage {
  v: 1;
  usage: Record<string, CountryUsage>;
  /** Einmaliger Vorschlag des GPS-Landes erledigt */
  prompted: boolean;
}

type Storage = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };

let storageOverride: Storage | null | undefined;
function storage(): Storage | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage");
    return (mod?.default ?? mod) as Storage;
  } catch {
    return null;
  }
}

/** Liefert die Länder mit gespeicherten Daten (für die Migration bestehender Installationen). */
export type StoredDataProbe = () => Promise<string[]>;

let state: StoredUsage | null = null;
let loading: Promise<StoredUsage> | null = null;
const listeners = new Set<() => void>();
let version = 0;

/** Zähler, der sich bei jeder Änderung erhöht (useSyncExternalStore). */
export function getCountryUsageVersion(): number {
  return version;
}

function notify(): void {
  version += 1;
  for (const l of listeners) {
    try {
      l();
    } catch {}
  }
}

function isUsage(v: unknown): v is CountryUsage {
  return v === "off" || v === "online" || v === "offline";
}

/** Standardbelegung: DEFAULT_OFFLINE_ISOS + Länder mit Daten → offline, sonst aus. */
export function defaultCountryUsage(withData: readonly string[] = []): Record<string, CountryUsage> {
  const data = new Set(withData.map((i) => usageIsoOf(i)));
  const out: Record<string, CountryUsage> = {};
  for (const { iso } of USAGE_COUNTRIES) {
    out[iso] = DEFAULT_OFFLINE_ISOS.includes(iso) || data.has(iso) ? "offline" : "off";
  }
  return out;
}

function normalize(raw: unknown): StoredUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<StoredUsage>;
  if (r.v !== 1 || !r.usage || typeof r.usage !== "object") return null;
  const usage: Record<string, CountryUsage> = {};
  // Später hinzugekommene Länder: aus
  for (const { iso } of USAGE_COUNTRIES) usage[iso] = isUsage(r.usage[iso]) ? r.usage[iso] : "off";
  // Frühere eigene Einstellung eines Alias-Landes (LI): die stärkere Stufe gilt
  // für das gemeinsame Land (offline > online > aus).
  const rank: Record<CountryUsage, number> = { off: 0, online: 1, offline: 2 };
  for (const [alias, main] of Object.entries(USAGE_ALIASES)) {
    const a = (r.usage as Record<string, unknown>)[alias];
    if (isUsage(a) && usage[main] && rank[a] > rank[usage[main]]) usage[main] = a;
  }
  return { v: 1, usage, prompted: r.prompted === true };
}

async function persist(): Promise<void> {
  if (!state) return;
  try {
    await storage()?.setItem(COUNTRY_USAGE_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function defaultProbe(): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./countryUsageData");
    return mod.probeStoredDataIsos();
  } catch {
    return Promise.resolve([]);
  }
}

/**
 * Einstellung laden (einmal; Migration bei erstem Start nach dem Update bzw.
 * Neuinstallation). `probe` liefert die Länder mit gespeicherten Daten.
 */
export function loadCountryUsage(probe: StoredDataProbe = defaultProbe): Promise<StoredUsage> {
  if (state) return Promise.resolve(state);
  if (loading) return loading;
  loading = (async () => {
    let parsed: StoredUsage | null = null;
    try {
      const raw = await storage()?.getItem(COUNTRY_USAGE_STORAGE_KEY);
      parsed = raw ? normalize(JSON.parse(raw)) : null;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      let withData: string[] = [];
      try {
        withData = await probe();
      } catch {
        withData = [];
      }
      parsed = { v: 1, usage: defaultCountryUsage(withData), prompted: false };
      state = parsed;
      await persist();
    }
    state = parsed;
    notify();
    return parsed;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** Wartet auf einen laufenden Ladevorgang (startet selbst keinen). */
export async function awaitCountryUsage(): Promise<void> {
  if (loading) await loading.catch(() => {});
}

export function isCountryUsageLoaded(): boolean {
  return state != null;
}

/** Nutzung eines App-Landes; null = Einstellung noch nicht geladen bzw. kein App-Land. */
export function getCountryUsage(iso: string | null | undefined): CountryUsage | null {
  const up = usageIsoOf(iso);
  if (!state || !USAGE_ISOS.has(up)) return null;
  return state.usage[up] ?? "off";
}

/** Kopie der gesamten Belegung (leer, solange nicht geladen). */
export function getCountryUsageMap(): Record<string, CountryUsage> {
  return state ? { ...state.usage } : {};
}

/** Land aktiviert (online/offline)? Nicht geladen bzw. unbekanntes Land → true. */
export function isCountryEnabled(iso: string | null | undefined): boolean {
  return getCountryUsage(iso) !== "off";
}

/** Einstellungs-Länder, deren Zonen im Datensatz dieser Quelle stecken (CH → CH; LI folgt CH). */
export function countriesOfSource(sourceIso: string | null | undefined): string[] {
  const src = resolveGeozoneSourceIso(sourceIso);
  const meta = getOwnGeozoneSourceMeta(src);
  return [...new Set([src, ...(meta?.aliases ?? [])].map((i) => usageIsoOf(i)))].filter((i) => USAGE_ISOS.has(i));
}

/**
 * Darf die Geozonen-Quelle dieses Landes genutzt werden? Ein gemeinsamer
 * Datensatz ist aktiv, solange eines seiner Einstellungs-Länder aktiviert ist
 * (LI folgt immer CH). Nicht geladen bzw. Quelle ohne App-Land → true.
 */
export function isGeozoneSourceEnabled(iso: string | null | undefined): boolean {
  if (!state) return true;
  const own = String(iso || "").toUpperCase();
  const list = countriesOfSource(own);
  if (list.length === 0) return true;
  return list.some((c) => getCountryUsage(c) !== "off");
}

/** Wird die Quelle von einem Offline-Land genutzt (Daten dauerhaft speichern)? */
export function isGeozoneSourceOffline(iso: string | null | undefined): boolean {
  if (!state) return true;
  const list = countriesOfSource(iso);
  if (list.length === 0) return true;
  return list.some((c) => getCountryUsage(c) === "offline");
}

export function countriesWithUsage(usage: CountryUsage): string[] {
  if (!state) return [];
  return USAGE_COUNTRIES.map((c) => c.iso).filter((iso) => state!.usage[iso] === usage);
}

/** Nutzung setzen und speichern (ohne Datenbereinigung – siehe applyCountryUsage). */
export async function setCountryUsage(iso: string, usage: CountryUsage): Promise<void> {
  const up = usageIsoOf(iso);
  if (!USAGE_ISOS.has(up) || !isUsage(usage)) return;
  if (!state) await loadCountryUsage();
  if (!state) return;
  if (state.usage[up] === usage) return;
  state = { ...state, usage: { ...state.usage, [up]: usage } };
  await persist();
  notify();
}

/** Einmaliger Vorschlag des GPS-Landes noch offen? */
export function needsCountryPrompt(): boolean {
  return !!state && !state.prompted;
}

export async function markCountryPromptDone(): Promise<void> {
  if (!state) await loadCountryUsage();
  if (!state || state.prompted) return;
  state = { ...state, prompted: true };
  await persist();
}

/** Benachrichtigung bei geänderter Nutzung (auch nach dem Laden). */
export function onCountryUsageChange(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Deutscher Ländername der Einstellung (CH und LI: „Schweiz / Liechtenstein“). */
export function usageCountryLabel(iso: string | null | undefined): string {
  const up = usageIsoOf(iso);
  return USAGE_COUNTRIES.find((c) => c.iso === up)?.label ?? up;
}

// Text der Abdeckungslücke und Aktion (eine Quelle: Prüfkette)
export { countryDisabledWarning, ENABLE_COUNTRY_ACTION_LABEL } from "../../shared/checks/builders";

export const COUNTRY_DISABLED_NOTE = "Land in den Einstellungen deaktiviert";

/** Nur für Tests: Speicher ersetzen (undefined = Standard) und Zustand leeren. */
export function __resetCountryUsageForTests(st?: Storage | null): void {
  storageOverride = st;
  state = null;
  loading = null;
}

/** Nur für Tests: Belegung direkt setzen (null = nicht geladen). */
export function __setCountryUsageForTests(usage: Record<string, CountryUsage> | null, prompted = true): void {
  state = usage ? { v: 1, usage: { ...defaultCountryUsage(), ...usage }, prompted } : null;
  notify();
}
