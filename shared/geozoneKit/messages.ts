// Gemeinsamer Aufbau der deutschen Zonen-Meldungen (Umbau B6).
//
// Muster aller übersetzenden Normalisierer (CY, SI, SK, BG, UK, HR, CH …):
//  - `message` = deutsche, strukturierte Zeilen; der Behördentext steht – falls
//    vorhanden – GENAU EINMAL am Ende unter „Originaltext der Behörde:“
//    (nach einer Leerzeile),
//  - `extendedProperties.localizedMessages` = [{ language: "de", message },
//    { language: <Quellsprache>, message: <Originaltext> }] – „de“ zuerst,
//    damit client/lib/ed269.ts die deutsche Fassung anzeigt und den
//    Originaltext nicht ein zweites Mal anhängt.
//
// Bewusst frei von React-Native-Importen (Mobile, Web, Server, tsx-Tests).

/** Überschrift des Originaltext-Blocks (einzige Stelle im Normalisierer-Code). */
export const ORIGINAL_TEXT_HEADING = "Originaltext der Behörde:";

/** Platzhalter, wenn eine Behördenangabe nicht sicher übersetzt werden kann. */
export const SEE_ORIGINAL_DE = "siehe Originaltext";

/** Standardzeile ohne Höhenangabe der Behörde. */
export const NO_HEIGHT_LINE_DE = "Höhe laut Behörde: keine Angabe – Zone gilt ab Boden ohne Obergrenze.";

export type LocalizedMessage = { language: string; message: string };

/**
 * Originaltext-Block anhängen: Leerzeile, Überschrift, Text (bzw. Zeilen).
 * Leerer Text → nichts, außer `always` (SI/SK hängen immer an).
 */
export function appendOriginalText(
  lines: string[],
  original: string | readonly string[] | null | undefined,
  opts: { always?: boolean } = {},
): string[] {
  const parts = Array.isArray(original) ? (original as readonly string[]) : original ? [original as string] : [];
  if (parts.length === 0 && !opts.always) return lines;
  lines.push("", ORIGINAL_TEXT_HEADING, ...(parts.length ? parts : [String(original ?? "")]));
  return lines;
}

/** Zeilen + Originaltext-Block → fertige Meldung. */
export function messageWithOriginal(
  lines: string[],
  original: string | readonly string[] | null | undefined,
  opts: { always?: boolean } = {},
): string {
  return appendOriginalText(lines, original, opts).join("\n");
}

/**
 * localizedMessages: deutsche Meldung zuerst, dann der Originaltext in der
 * Quellsprache (entfällt, wenn leer – außer `always`).
 */
export function localizedMessages(
  message: string,
  original: string | null | undefined,
  language: string,
  opts: { always?: boolean; deLanguage?: string } = {},
): LocalizedMessage[] {
  const out: LocalizedMessage[] = [{ language: opts.deLanguage ?? "de", message }];
  if (original || opts.always) out.push({ language, message: original ?? "" });
  return out;
}

/** `extendedProperties`-Objekt mit localizedMessages (siehe localizedMessages). */
export function localizedExtendedProperties(
  message: string,
  original: string | null | undefined,
  language: string,
  opts: { always?: boolean; deLanguage?: string } = {},
): { localizedMessages: LocalizedMessage[] } {
  return { localizedMessages: localizedMessages(message, original, language, opts) };
}

/** Ein Hinweis → „Hinweis: …“, mehrere → „Hinweise:“ + Spiegelstriche. */
export function pushHints(lines: string[], hints: readonly string[]): string[] {
  if (hints.length === 1) lines.push(`Hinweis: ${hints[0]}`);
  else if (hints.length > 1) lines.push("Hinweise:", ...hints.map((h) => `– ${h}`));
  return lines;
}

/**
 * Quellenzeile „Quelle: <was> – <Attribution>. Nur zur Information, nicht zur
 * Navigation; <prüfen> zusätzlich prüfen.“ (`check` Standard „NOTAMs“).
 */
export function sourceLineDe(what: string, attribution: string, check = "NOTAMs"): string {
  return `Quelle: ${what} – ${attribution}. Nur zur Information, nicht zur Navigation; ${check} zusätzlich prüfen.`;
}

/** „Höhe laut <Behörde|Quelle|AIP>: <unten> bis <oben>“. */
export function heightLineDe(lower: string, upper: string, by = "Behörde"): string {
  return `Höhe laut ${by}: ${lower} bis ${upper}`;
}

/** Textteile für den Originalblock: getrimmt, CRLF → LF, leer/doppelt entfällt. */
export function originalBlock(parts: readonly (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const s = String(p ?? "").replace(/\r\n/g, "\n").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.join("\n");
}
