// Übersetzung der Behördentexte (Zonennamen und Beschreibungen) ins Deutsche.
//
// 1. Mitgeliefertes Wörterbuch (shared/data/zoneTranslationsDe.json) mit allen
//    bekannten Texten – funktioniert offline, ohne Schlüssel.
// 2. Laufzeit-Cache für Texte, die erst später auftauchen (z. B. per DeepL
//    übersetzt, siehe client/lib/zoneTranslationStore.ts).
// 3. Sonst bleibt der Originaltext stehen.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

type Dict = { lines: Record<string, string>; names: Record<string, string> };

let bundled: Dict | null = null;
const runtime = new Map<string, string>();

function dict(): Dict {
  if (!bundled) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const raw = require("./data/zoneTranslationsDe.json") as Partial<Dict>;
      bundled = { lines: raw.lines ?? {}, names: raw.names ?? {} };
    } catch {
      bundled = { lines: {}, names: {} };
    }
  }
  return bundled;
}

/** Schlüssel: Leerraum vereinheitlicht, damit Zeilenumbrüche/Leerzeichen egal sind. */
export function translationKey(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

const GERMAN_HINT = /\b(der|die|das|und|ist|nicht|mit|für|zu|im|bei|des|den|dem|eine|einer|nur|oder|wird|werden|sind|Genehmigung|Betrieb|Flug|Drohnen|verboten)\b/gi;

/** Grobe Erkennung, ob ein Text schon deutsch ist (dann nicht übersetzen). */
export function looksGerman(s: string): boolean {
  const hits = String(s ?? "").match(GERMAN_HINT);
  return !!hits && hits.length >= 2;
}

/** Übersetzt eine Zeile (oder gibt sie unverändert zurück). */
export function translateLineDe(line: string): string {
  const k = translationKey(line);
  if (!k) return line;
  const d = dict();
  return d.lines[k] ?? runtime.get(k) ?? line;
}

/** Übersetzt einen mehrzeiligen Text zeilenweise. */
export function translateTextDe(text: string): { text: string; changed: boolean } {
  let changed = false;
  const out = String(text ?? "")
    .split("\n")
    .map((l) => {
      const t = translateLineDe(l);
      if (t !== l && translationKey(t) !== translationKey(l)) changed = true;
      return t;
    })
    .join("\n");
  return { text: out, changed };
}

/** Übersetzt einen Zonennamen (Eigennamen bleiben, Gattungswörter werden deutsch). */
export function translateZoneNameDe(name: string): string {
  const k = translationKey(name);
  if (!k) return name;
  const d = dict();
  return d.names[k] ?? runtime.get(`name:${k}`) ?? name;
}

/** Ist dieser Text bereits übersetzt bzw. braucht er keine Übersetzung? */
export function hasGermanFor(text: string, kind: "line" | "name" = "line"): boolean {
  const k = translationKey(text);
  if (!k || looksGerman(k)) return true;
  const d = dict();
  if (kind === "name") return k in d.names || runtime.has(`name:${k}`);
  return k in d.lines || runtime.has(k);
}

/** Laufzeit-Übersetzungen eintragen (z. B. aus dem DeepL-Cache des Geräts). */
export function addRuntimeTranslations(entries: Record<string, string>, kind: "line" | "name" = "line"): void {
  for (const [orig, de] of Object.entries(entries)) {
    if (!de) continue;
    runtime.set(kind === "name" ? `name:${translationKey(orig)}` : translationKey(orig), de);
  }
}

/** Nur für Tests: mitgeliefertes Wörterbuch ersetzen. */
export function __setBundledForTests(d: Dict | null): void {
  bundled = d;
  runtime.clear();
}
