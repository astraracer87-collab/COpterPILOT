/**
 * Übersetzung der Behördentexte – vollständig offline, ohne Übersetzungsdienst.
 *
 * Alle Texte werden über das mitgelieferte Wörterbuch
 * (shared/data/zoneTranslationsDe.json) und die Satzmuster für formelhafte,
 * wechselnde Texte (shared/zoneTranslatePatterns.ts: NOTAMs, Aktivierungen,
 * Kontaktzeilen, Feldnamen) übersetzt – direkt beim Anzeigen in
 * client/lib/ed269.ts (shared/zoneTranslate.ts). Was beides nicht abdeckt,
 * bleibt im Original stehen und ist in der Anzeige mit „(nicht übersetzt)“
 * gekennzeichnet.
 *
 * Früher konnten neue Texte per DeepL nachübersetzt werden. Das entfällt
 * (PO-Vorgabe: kein externer Übersetzungsdienst). Ein alter DeepL-Cache auf dem
 * Gerät wird nicht mehr gelesen. Dieses Modul enthält keinen DeepL-Code mehr;
 * die Übersetzung hängt von keiner Funktion hier ab.
 */
import { onEd269Downloaded } from "@/lib/geozoneDirect/ed269Store";
import type { GeoFeature } from "@/lib/geozoneDirect/ed269Sources";
import { hasGermanFor, translationKey } from "../../shared/zoneTranslate";
import { shouldYield, yieldToUi } from "../../shared/yieldingWork";

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
}

/** Sammelt Texte eines Länder-Datensatzes, die weder Wörterbuch noch Muster abdecken. */
export function missingTexts(features: GeoFeature[]): { lines: string[]; names: string[] } {
  const lines = new Set<string>();
  const names = new Set<string>();
  for (const f of features) collectMissing(f, lines, names);
  return { lines: [...lines], names: [...names] };
}

/** Wie missingTexts, in Zeitscheiben (CH ≈ 30 ms Node am Stück). Ergebnis identisch. */
export async function missingTextsYielding(features: GeoFeature[]): Promise<{ lines: string[]; names: string[] }> {
  const lines = new Set<string>();
  const names = new Set<string>();
  for (const f of features) {
    collectMissing(f, lines, names);
    if (shouldYield()) await yieldToUi("translate-scan");
  }
  return { lines: [...lines], names: [...names] };
}

function collectMissing(f: GeoFeature, lines: Set<string>, names: Set<string>): void {
  const p: any = f.properties || {};
  const name = String(p.name ?? "").trim();
  if (name && !hasGermanFor(name, "name")) names.add(translationKey(name));
  const loc = p.extendedProperties?.localizedMessages;
  const msg =
    (Array.isArray(loc) &&
      (loc.find((m: any) => String(m?.language ?? "").toLowerCase().startsWith("de")) ??
        loc.find((m: any) => String(m?.language ?? "").toLowerCase().startsWith("en")) ??
        loc[0])?.message) ||
    p.message ||
    "";
  for (const line of stripHtml(String(msg)).split("\n")) {
    const k = translationKey(line);
    if (k && /[A-Za-zÀ-ÿ]{3}/.test(k) && !hasGermanFor(k, "line")) lines.add(k);
  }
}

let started = false;
/**
 * Beim App-Start einmal aufrufen. Nur Entwickler-Diagnose: meldet nach einem
 * Länder-Download (__DEV__), wie viele Texte ohne deutsche Fassung angezeigt
 * werden – als Hinweis, das Wörterbuch bzw. die Muster zu ergänzen.
 */
export function startZoneTranslation(): void {
  if (started) return;
  started = true;
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  onEd269Downloaded(async (iso, features) => {
    const { lines, names } = await missingTextsYielding(features);
    if (lines.length || names.length) {
      console.log(`[zoneTranslate] ${iso}: ${lines.length} Zeilen, ${names.length} Namen ohne deutsche Fassung`, lines.slice(0, 5));
    }
  });
}
