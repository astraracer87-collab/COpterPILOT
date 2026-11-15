// Gemeinsame Text-/Zahlenhelfer der Länder-Normalisierer (Umbau B6).
//
// Ersetzt die bisherigen Kopien von cleanText/clean/round1/stripHtml in
// shared/*Geozones.ts und shared/ed318Pure.ts. Die Varianten unterschieden sich
// nur in Kleinigkeiten (Zeilenumbrüche erhalten? <br> → Umbruch? Tags
// entfernen oder durch Leerzeichen ersetzen?) – das steuern hier Optionen, damit
// jede Quelle exakt ihr bisheriges Ergebnis behält.
//
// Bewusst frei von React-Native-Importen (Mobile, Web, Server, tsx-Tests).

/** Auf eine Nachkommastelle runden (Meter-Angaben der Normalisierer). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Auf `decimals` Nachkommastellen runden (z. B. Koordinaten). */
export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Jeden Leerraum (auch Zeilenumbrüche) zu einem Leerzeichen; trim. null/undefined → "". */
export function collapseWhitespace(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

export interface CleanTextOptions {
  /** `<br>` → Zeilenumbruch (vor dem Entfernen der Tags). */
  br?: boolean;
  /** HTML-Tags entfernen ("strip") bzw. durch ein Leerzeichen ersetzen ("space"). */
  tags?: "strip" | "space";
  /**
   * Zeilenstruktur normieren (Standard true): Leerzeichen um Umbrüche weg,
   * höchstens eine Leerzeile. false = nur Leerzeichen/Tabs zusammenfassen.
   */
  paragraphs?: boolean;
}

/**
 * Mehrzeiligen Behördentext säubern: `\r` entfernen, Leerzeichen/Tabs
 * zusammenfassen, Umbrüche erhalten (optional `<br>`/Tags behandeln); trim.
 */
export function cleanText(v: unknown, opts: CleanTextOptions = {}): string {
  let s = String(v ?? "");
  if (opts.tags === "space") s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/\r/g, "");
  if (opts.br) s = s.replace(/<br\s*\/?\s*>/gi, "\n");
  if (opts.tags === "strip") s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/[ \t]+/g, " ");
  if (opts.paragraphs !== false) s = s.replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * HTML → Klartext für Anzeigen (ED-269-Meldungen): `<br>`/`</p>` → Umbruch,
 * Tags entfernen, die gängigen Entities dekodieren, höchstens eine Leerzeile.
 * (Früher doppelt als client/lib/ed269.ts `stripHtml` und
 * shared/ed269Pure.ts `stripEd269Html`.)
 */
export function stripHtml(s: string): string {
  return String(s ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
