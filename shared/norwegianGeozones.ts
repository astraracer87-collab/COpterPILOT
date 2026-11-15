// Norwegische Geozonen (Luftfartstilsynet / dronesoner.no) – reines ED-269 als
// NACKTES Array von UASZone-Objekten, siehe docs/geozonen-weitere-laender.md §3.
//
// Eigenheiten:
//  - Dateiname enthält das Build-Datum (täglich ~01 UTC), alte Dateien -> 404.
//    Den aktuellen Namen aus https://dronesoner.no/ (index.html) lesen.
//  - Bis zu 119 Volumes pro Zone, alle mit gleichen Höhen -> ein MultiPolygon
//    (erledigt shared/ed269Pure.ts).
//  - Default-Obergrenze 300 m AGL (= „unbegrenzt“ für Drohnen) bleibt als Wert.
//  - NOTAM-Zonen tragen applicability {permanent:"NO", start, end}; ohne
//    applicability ist die Zone dauerhaft.
//
// Einstufung (§3.5, am Text geschärft):
//  - reason NATURE -> NATURE (Verneområder; Verbot gilt teils nur saisonal,
//    steht dann im Text).
//  - REQ_AUTHORISATION mit ausdrücklichem Flugverbot im Text („All flyging …
//    forbudt“, „Droneforbud“, NOTAM „ALL FLYING PROHIBITED“) -> PROHIBITED.
//    Die übrigen SENSITIVE-Zonen (NSM-Kameraverbot, Botschaften, Öl-/Gas-
//    Sicherheitszonen, Gefängnisse mit Genehmigung) bleiben REQ_AUTHORISATION,
//    weil der Text dort „krever tillatelse“ sagt.
//  - CONDITIONAL bleibt CONDITIONAL.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

import { ed269ZonesToFeatures, type Ed269PureFeature } from "./ed269Pure";
import { normalizeEd269Restriction } from "./ed269Restriction";

export const NO_DRONESONER_BASE_URL = "https://dronesoner.no/";
export const NO_DRONESONER_DOWNLOAD_PREFIX = "https://dronesoner.no/Downloads/";
export const NO_GEOZONE_SOURCE_LABEL = "Luftfartstilsynet / dronesoner.no";
export const NO_GEOZONE_ATTRIBUTION = "Kilde: Luftfartstilsynet / dronesoner.no (NLOD 2.0)";

const NO_FILE_RE = /NOR_ED269_compliant_geozones_(\d{4}-\d{2}-\d{2})\.json/g;

/**
 * Liest den aktuellen ED-269-Dateinamen aus dem HTML von dronesoner.no. Bei
 * mehreren Treffern gewinnt das jüngste Datum. Liefert die volle URL oder null.
 */
export function norwayEd269UrlFromHtml(html: string): string | null {
  let best: string | null = null;
  for (const m of String(html ?? "").matchAll(NO_FILE_RE)) {
    if (!best || m[1] > best) best = m[1];
  }
  return best ? norwayEd269UrlForDate(best) : null;
}

/** URL der Tagesdatei für ein Datum (YYYY-MM-DD oder Date, UTC). */
export function norwayEd269UrlForDate(date: string | Date): string {
  const d = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  return `${NO_DRONESONER_DOWNLOAD_PREFIX}NOR_ED269_compliant_geozones_${d}.json`;
}

/** Rückfall-Kandidaten, falls index.html nicht lesbar ist: heute, gestern (UTC). */
export function norwayFallbackUrls(now: Date = new Date()): string[] {
  const day = 24 * 3600 * 1000;
  return [norwayEd269UrlForDate(now), norwayEd269UrlForDate(new Date(now.getTime() - day))];
}

// Ausdrückliches Flugverbot im (norwegischen/englischen) Text. Bewusst eng:
// „bruk av luftbårne sensorer … forbud“ oder „Wi-Fi … forbudt“ zählen NICHT.
const NO_FLIGHT_BAN_RE =
  /\ball flyging\b[^.]*\bforbudt\b|\bdroneforbud\b|\bflyging (?:med drone(?:r)? )?er forbudt\b|\ball flying prohibited\b/i;

function isNotam(zone: any): boolean {
  const app = zone?.applicability;
  return (
    (Array.isArray(app) && app.some((a: any) => String(a?.permanent ?? "").toUpperCase() === "NO")) ||
    /\bNOTAM\b/.test(String(zone?.message ?? ""))
  );
}

/** Einstufung nach §3.5 (siehe Kopfkommentar). */
export function norwegianRestriction(zone: any): string {
  const raw = normalizeEd269Restriction(String(zone?.restriction ?? ""));
  const reasons = (Array.isArray(zone?.reason) ? zone.reason : [zone?.reason]).map((r: any) =>
    String(r ?? "").toUpperCase(),
  );
  if (reasons.includes("NATURE")) return "NATURE";
  if (raw === "PROHIBITED") return "PROHIBITED";
  if (raw === "REQ_AUTHORISATION" && NO_FLIGHT_BAN_RE.test(String(zone?.message ?? ""))) return "PROHIBITED";
  return raw || "REQ_AUTHORISATION";
}

/** Wandelt das nackte dronesoner.no-Array in GeoJSON-Features um. */
export function normalizeNorwegianZones(body: unknown): Ed269PureFeature[] {
  return ed269ZonesToFeatures(body, {
    source: NO_GEOZONE_SOURCE_LABEL,
    restriction: norwegianRestriction,
    messagePrefix: (z) =>
      norwegianRestriction(z) === "NATURE"
        ? ["Naturschutzgebiet (Verneområde): Drohnenverbot laut Schutzvorschrift, gilt teils nur saisonal – Details im Text."]
        : [],
    messageSuffix: (z) => {
      const rc = Array.isArray(z?.restrictionConditions) ? z.restrictionConditions : [];
      return rc.includes("NO_PHOTOGRAPH") ? ["Foto-/Sensorverbot (NO_PHOTOGRAPH)."] : [];
    },
    extraProps: (z) => {
      const p: Record<string, any> = { attribution: NO_GEOZONE_ATTRIBUTION };
      if (isNotam(z)) {
        p.isNotam = true;
        p._notamEligible = true;
      }
      return p;
    },
  });
}
