// Portugal (ANAC – DNT): echtes ED-269 (Kreise + Polygone, Höhen in m AGL).
// Siehe docs/anac-pt-api-integration.md. Bewusst frei von React-Native-Importen.
import { ed269ZonesToFeatures } from "./ed269Pure";

export const PT_ED269_URL = "https://dnt.anac.pt/index.php?action=download-json-ed269";
export const PT_GEOZONE_SOURCE_LABEL = "ANAC – DNT (ED-269)";

/** „PT-… EN-…“: den englischen Teil bevorzugen (wird danach ins Deutsche übersetzt). */
export function portugueseMessage(msg: string): string {
  const s = String(msg ?? "");
  const en = s.match(/EN-\s*([\s\S]*)$/);
  if (en) return en[1].trim();
  return s.replace(/^PT-\s*/, "").trim();
}

export function normalizePortugueseZones(body: any): any[] {
  const zones: any[] = Array.isArray(body?.features) ? body.features : Array.isArray(body) ? body : [];
  const prepared = zones.map((z) => ({ ...z, message: portugueseMessage(z?.message), messageOriginal: z?.message }));
  return ed269ZonesToFeatures({ features: prepared } as any, { source: PT_GEOZONE_SOURCE_LABEL }) as any[];
}
