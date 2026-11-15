// Zentrale Download-Anzeige (Product Owner): jeder Download meldet sich hier
// an, die App zeigt app-weit einen kleinen Balken (DownloadActivityBar), z. B.
// „Lädt: Deutschland – Geozonen 45 %“ bzw. „Lädt 3 Aufgaben …“. Keine
// Rückfrage vor Downloads – die Anzeige macht sichtbar, dass etwas lädt.
//
// - beginDownload(task) → id; progressDownload(id, …); endDownload(id)
// - trackDownload(task, fn): begin/end um eine asynchrone Funktion (auch bei Fehler)
// - Kurze Aufgaben (< DOWNLOAD_DISPLAY_DELAY_MS) werden erfasst, aber nicht
//   angezeigt (kein Flackern); getVisibleDownloads() liefert nur die länger
//   laufenden. Nach Ablauf der Verzögerung wird automatisch benachrichtigt.
// - Gleiche id zweimal begonnen (z. B. zwei Aufrufer warten auf denselben
//   Download) → ein Eintrag mit Zähler; erst das letzte end() beendet ihn.
//
// RN-frei (unter tsx testbar).

import { usageCountryLabel } from "./countryUsage";

export type DownloadKind =
  | "geozones"
  | "map"
  | "satellite"
  | "obstacles"
  | "import"
  | "live"
  | "other";

export interface DownloadTaskInput {
  /** Stabile Kennung (gleicher Download → gleiche id) */
  id: string;
  /** Land (ISO); wird im Text mit dem deutschen Namen gezeigt */
  iso?: string | null;
  /** Deutsche Bezeichnung des Inhalts, z. B. „Geozonen“, „Hindernisse“ */
  labelDe: string;
  kind: DownloadKind;
  totalBytes?: number;
  totalItems?: number;
}

export interface DownloadTask extends DownloadTaskInput {
  doneBytes?: number;
  doneItems?: number;
  /** 0..1, falls direkt gemeldet */
  fraction?: number;
  startedAt: number;
}

export interface DownloadProgress {
  doneBytes?: number;
  doneItems?: number;
  totalBytes?: number;
  totalItems?: number;
  fraction?: number;
}

/** Aufgaben, die kürzer laufen, werden nicht angezeigt (aber erfasst). */
export const DOWNLOAD_DISPLAY_DELAY_MS = 1000;

const tasks = new Map<string, DownloadTask & { refs: number }>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let version = 0;
let nowFn: () => number = () => Date.now();
let seq = 0;

function emit(): void {
  version += 1;
  for (const l of listeners) {
    try {
      l();
    } catch {}
  }
}

/** Zähler für useSyncExternalStore (ändert sich bei jeder Meldung). */
export function getDownloadActivityVersion(): number {
  return version;
}

export function subscribeDownloadActivity(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Download beginnen; liefert die id (bei leerer id eine eindeutige). */
export function beginDownload(input: DownloadTaskInput): string {
  const id = input.id || `dl-${++seq}`;
  const existing = tasks.get(id);
  if (existing) {
    existing.refs += 1;
    return id;
  }
  tasks.set(id, { ...input, id, iso: input.iso ? String(input.iso).toUpperCase() : undefined, startedAt: nowFn(), refs: 1 });
  // Sichtbar werden, sobald die Mindestdauer erreicht ist
  const t = setTimeout(() => {
    timers.delete(id);
    if (tasks.has(id)) emit();
  }, DOWNLOAD_DISPLAY_DELAY_MS);
  (t as any)?.unref?.();
  timers.set(id, t);
  emit();
  return id;
}

export function progressDownload(id: string, p: DownloadProgress): void {
  const t = tasks.get(id);
  if (!t) return;
  if (p.doneBytes != null) t.doneBytes = p.doneBytes;
  if (p.doneItems != null) t.doneItems = p.doneItems;
  if (p.totalBytes != null) t.totalBytes = p.totalBytes;
  if (p.totalItems != null) t.totalItems = p.totalItems;
  if (p.fraction != null) t.fraction = Math.max(0, Math.min(1, p.fraction));
  emit();
}

export function endDownload(id: string): void {
  const t = tasks.get(id);
  if (!t) return;
  t.refs -= 1;
  if (t.refs > 0) return;
  tasks.delete(id);
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  emit();
}

/** begin/end um eine asynchrone Funktion (end auch bei Fehler). */
export async function trackDownload<T>(input: DownloadTaskInput, fn: (id: string) => Promise<T>): Promise<T> {
  const id = beginDownload(input);
  try {
    return await fn(id);
  } finally {
    endDownload(id);
  }
}

/** Alle laufenden Aufgaben (auch kurze). */
export function getActiveDownloads(): DownloadTask[] {
  return [...tasks.values()].map(({ refs: _r, ...t }) => t);
}

/** Aufgaben, die mindestens DOWNLOAD_DISPLAY_DELAY_MS laufen (Anzeige). */
export function getVisibleDownloads(now: number = nowFn()): DownloadTask[] {
  return getActiveDownloads().filter((t) => now - t.startedAt >= DOWNLOAD_DISPLAY_DELAY_MS);
}

/** Fortschritt 0..1 oder null (unbekannt). */
export function downloadFraction(t: DownloadTask): number | null {
  if (t.fraction != null) return t.fraction;
  if (t.totalItems && t.totalItems > 0 && t.doneItems != null) return Math.min(1, t.doneItems / t.totalItems);
  if (t.totalBytes && t.totalBytes > 0 && t.doneBytes != null) return Math.min(1, t.doneBytes / t.totalBytes);
  return null;
}

/** Anzeigetext: „Lädt: Deutschland – Geozonen 45 %“ bzw. „Lädt 3 Aufgaben …“; null = nichts anzeigen. */
export function formatDownloadActivity(list: DownloadTask[]): string | null {
  if (list.length === 0) return null;
  if (list.length > 1) return `Lädt ${list.length} Aufgaben …`;
  const t = list[0];
  const country = t.iso ? usageCountryLabel(t.iso) : "";
  const f = downloadFraction(t);
  const pct = f != null ? ` ${Math.floor(f * 100)} %` : " …";
  return `Lädt: ${country ? `${country} – ` : ""}${t.labelDe}${pct}`;
}

/** Nur für Tests: Zustand leeren und Uhr ersetzen (null = Date.now). */
export function __resetDownloadActivityForTests(now?: (() => number) | null): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  tasks.clear();
  nowFn = now ?? (() => Date.now());
  emit();
}
