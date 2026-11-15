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
import { parseHeight } from "./heights";

export const NO_DRONESONER_BASE_URL = "https://dronesoner.no/";
export const NO_DRONESONER_DOWNLOAD_PREFIX = "https://dronesoner.no/Downloads/";
export const NO_GEOZONE_SOURCE_LABEL = "Luftfartstilsynet / dronesoner.no";
export const NO_GEOZONE_ATTRIBUTION = "Kilde: Luftfartstilsynet / dronesoner.no (NLOD 2.0); © OpenStreetMap contributors (ODbL)";

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
  return raw === "UNKNOWN" ? "REQ_AUTHORISATION" : raw;
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

// ---------------------------------------------------------------------------
// Zusätzliche Ebenen aus https://dronesoner.no/data/ (statische GeoJSON-Dateien
// der Karte, docs/norway-dronesoner-api-integration.md §2). Abgleich mit der
// ED-269-Tagesdatei live 2026-11-15 (1.389 Zonen):
//
//  | Datei                      | Feat. | in ED-269        | Übernahme                         |
//  |----------------------------|-------|------------------|-----------------------------------|
//  | forbud_notam               |     0 | –                | ja: NOTAM-Drohnenverbot (PROHIB.) |
//  | obs_fareomrader            |    24 | 17 (Name/Kennung)| fehlende 7 (NOTAM-aktiviert)      |
//  | obs_sanntid_fareomrader    |    47 | 10               | fehlende 37 (Echtzeit-aktiviert)  |
//  | obs_droneflyging           |    33 | 4                | fehlende 29 (gemeldete Flüge)     |
//  | obs_notam_soner            |    24 | 0                | ja: R-Gebiete „kann per NOTAM     |
//  |                            |       |                  | aktiviert werden“ (Achtung)       |
//  | luftrom_ctr_tiz            |    54 | 0                | ja: CTR/TIZ (Achtung, Luftraum)   |
//  | luftrom_rmz_tmz            |     3 | 0                | ja: RMZ/TMZ (Achtung)             |
//  | obs_flyplasser             |   162 | 162              | nur Fehlende (derzeit keine)      |
//
// Nicht übernommen: forbud_* (Flughäfen 5 km, Schutzgebiete, Restriktionen,
// Gefängnisse, NSM, Botschaften, Plattformen – vollständig in ED-269),
// obs_verneomrader (≈ 12 MB, Schutz OHNE Verbot), VFR-Meldepunkte (Punkte).
// Dedupe gegen ED-269 über den Namen (klein, Leerraum zusammengefasst) und die
// Gebietskennung (END104, EN R121 = ENR121). Botschaften in ED-269 stammen aus
// OpenStreetMap → Attribution „© OpenStreetMap contributors (ODbL)“.
//
// Zeit: aktiv_fra_iso/aktiv_til_iso → Gültigkeitsfenster (temporär, NOTAM);
// daglige_vinduer nur als Text (die Zone gilt vorsorglich im ganzen Fenster).
// Echtzeit-aktivierte Gefahrengebiete gelten laut Karte „als aktiv“ – sie sind
// eine Temporär-Ebene (_layer "obs_sanntid_fareomrader", geozoneTemporary).

export const NO_DATA_BASE_URL = "https://dronesoner.no/data/";
export const NO_NOTAM_STATUS_URL = `${NO_DATA_BASE_URL}notam_status.json`;
export const NO_OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";
export const NO_REALTIME_LAYER_ID = "obs_sanntid_fareomrader";

export type NoDataFile =
  | "forbud_notam"
  | "obs_fareomrader"
  | "obs_sanntid_fareomrader"
  | "obs_droneflyging"
  | "obs_notam_soner"
  | "luftrom_ctr_tiz"
  | "luftrom_rmz_tmz"
  | "obs_flyplasser";

export interface NoDataLayerDef {
  file: NoDataFile;
  /** NOTAM-basiert: neu laden, wenn notam_status.json sich ändert. */
  dynamic: boolean;
  restriction: "PROHIBITED" | "REQ_AUTHORISATION" | "CONDITIONAL";
  labelDe: string;
  noteDe: string;
}

export const NO_DATA_LAYERS: readonly NoDataLayerDef[] = [
  {
    file: "forbud_notam",
    dynamic: true,
    restriction: "PROHIBITED",
    labelDe: "NOTAM mit Drohnenverbot",
    noteDe: "Drohnenflug per NOTAM verboten (Karte „Krever tillatelse“) – nur mit Genehmigung laut NOTAM.",
  },
  {
    file: "obs_fareomrader",
    dynamic: true,
    restriction: "CONDITIONAL",
    labelDe: "Gefahrengebiet",
    noteDe: "Gefahrengebiet (Fareområde): gefährliche Aktivitäten möglich – besondere Vorsicht, NOTAM prüfen.",
  },
  {
    file: "obs_sanntid_fareomrader",
    dynamic: true,
    restriction: "CONDITIONAL",
    labelDe: "Echtzeit-aktiviertes Gefahrengebiet",
    noteDe: "Echtzeit-aktiviertes Gefahrengebiet: laut dronesoner.no als aktiv zu betrachten – Status bei der zuständigen Flugverkehrsstelle erfragen.",
  },
  {
    file: "obs_droneflyging",
    dynamic: true,
    restriction: "CONDITIONAL",
    labelDe: "Gemeldete Drohnenflüge",
    noteDe: "Per NOTAM gemeldete Drohnenflüge – Achtung, weitere unbemannte Luftfahrzeuge im Gebiet.",
  },
  {
    file: "obs_notam_soner",
    dynamic: false,
    restriction: "CONDITIONAL",
    labelDe: "Restriktionsgebiet (kann per NOTAM aktiviert werden)",
    noteDe: "Kann per NOTAM aktiviert werden – aktivierte Sperren erscheinen als eigene NOTAM-Zone; vor dem Flug NOTAM (ippc.no) prüfen.",
  },
  {
    file: "luftrom_ctr_tiz",
    dynamic: false,
    restriction: "CONDITIONAL",
    labelDe: "Luftraum CTR/TIZ",
    noteDe: "Kontrollzone (CTR) bzw. Verkehrsinformationszone (TIZ) laut AIP Norge – Drohnenregeln von Luftfartstilsynet beachten; die 5-km-Zone um Flughäfen ist eine eigene Zone.",
  },
  {
    file: "luftrom_rmz_tmz",
    dynamic: false,
    restriction: "CONDITIONAL",
    labelDe: "Funk-/Transponderpflichtzone (RMZ/TMZ)",
    noteDe: "Funk- und Transponderpflichtzone – Regeln von Luftfartstilsynet beachten.",
  },
  {
    file: "obs_flyplasser",
    dynamic: false,
    restriction: "CONDITIONAL",
    labelDe: "Flugplatz / Landeplatz",
    noteDe: "Kleiner Flug- oder Landeplatz (Luftsportgebiet) – besondere Vorsicht.",
  },
];

export function noDataFileUrl(file: NoDataFile): string {
  return `${NO_DATA_BASE_URL}${file}.geojson`;
}

function noStr(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function noHtmlText(v: unknown): string {
  return noStr(String(v ?? "").replace(/<br\s*\/?>/gi, " · ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"));
}

/** Name eines /data/-Features (uneinheitliche Feldnamen). */
export function norwayDataName(p: Record<string, any>): string {
  for (const k of ["navn", "Navn", "NAVN", "offisieltNavn", "name"]) {
    const v = noStr(p?.[k]);
    if (v) return v;
  }
  return "";
}

/** Gebietskennung (END104, EN R121 → ENR121, ENR409) aus einem Namen; sonst "". */
export function norwayAreaCode(name: string): string {
  const m = noStr(name).toUpperCase().match(/^(EN\s?D\s?\d+[A-Z]?|EN\s?R\s?\d+[A-Z]?|EN\s?P\s?\d+[A-Z]?)\b/);
  return m ? m[1].replace(/\s+/g, "") : "";
}

function noNameKey(name: string): string {
  return noStr(name).toLowerCase();
}

/** Dedupe-Schlüssel der ED-269-Zonen (Name + Gebietskennung). */
export function norwayEd269Keys(features: readonly { properties?: Record<string, any> }[]): Set<string> {
  const keys = new Set<string>();
  for (const f of features) {
    const name = noStr(f?.properties?.name);
    if (!name) continue;
    keys.add(`n:${noNameKey(name)}`);
    const code = norwayAreaCode(name);
    if (code) keys.add(`c:${code}`);
  }
  return keys;
}

/** Höhentext („GND“, „4000 FT AMSL“, „FL130“, „6000FT AMSL“, „MSL“) → Meter/Bezug; null = unbekannt. */
export function norwayLimit(text: unknown): { meters: number; reference: "AGL" | "MSL" | "STD" | "UNKNOWN"; text: string } | null {
  const t = noStr(text);
  if (!t) return null;
  if (/^MSL$/i.test(t)) return { meters: 0, reference: "AGL", text: t };
  const h = parseHeight(t.replace(/^FL\s+/i, "FL"));
  if (!h || h.m == null) return null;
  return { meters: h.m, reference: h.datum === "STD" ? "STD" : h.ref, text: t };
}

function noTs(v: unknown): number | null {
  const s = noStr(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function noUtc(ts: number): string {
  return `${new Date(ts).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export interface NorwayDataContext {
  now: number;
  /** oppdatert_iso aus notam_status.json (Stand der NOTAM-Dateien) */
  statusIso?: string;
}

/** Ein Feature einer /data/-Datei → App-Feature; null ohne Fläche bzw. abgelaufen. */
export function normalizeNorwayDataFeature(raw: any, def: NoDataLayerDef, index: number, ctx: NorwayDataContext): Ed269PureFeature | null {
  const g = raw?.geometry;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !Array.isArray(g.coordinates) || g.coordinates.length === 0) return null;
  const p: Record<string, any> = raw?.properties ?? {};
  const start = noTs(p.aktiv_fra_iso);
  const end = noTs(p.aktiv_til_iso);
  if (end != null && end < ctx.now) return null;
  const name = norwayDataName(p) || def.labelDe;
  const lower = norwayLimit(p.lower_limit);
  const upper = norwayLimit(p.upper_limit);
  const activation = noStr(p.activation_type);
  const byNotam = def.file === "forbud_notam" || def.file === "obs_droneflyging" || start != null || /notam/i.test(activation);
  const lines: string[] = [`Typ: ${def.labelDe}`, def.noteDe];
  if (activation) lines.push(`Aktivierung: ${/stadig/i.test(activation) ? "ständig aktiv" : /notam/i.test(activation) ? "per NOTAM" : activation}`);
  if (start != null || end != null) lines.push(`Gültig: ${start != null ? noUtc(start) : "offen"} – ${end != null ? noUtc(end) : "offen"}`);
  const windows = p.daglige_vinduer;
  if (windows) lines.push(`Tägliche Zeitfenster (UTC): ${typeof windows === "string" ? windows : JSON.stringify(windows)} – die Zone gilt vorsorglich im ganzen Gültigkeitszeitraum.`);
  if (p.lower_limit || p.upper_limit) lines.push(`Höhe laut Quelle: ${noStr(p.lower_limit) || "GND"} – ${noStr(p.upper_limit) || "unbegrenzt"}`);
  const icao = noStr(p.icao ?? p.icaoKode ?? p.ICAO);
  if (icao) lines.push(`ICAO: ${icao}`);
  if (p.luftromsklasse) lines.push(`Luftraumklasse: ${noStr(p.luftromsklasse)}`);
  if (p.kallesignal) lines.push(`Rufzeichen: ${noStr(p.kallesignal)}${p.radiofrekvens ? ` (${noStr(p.radiofrekvens)})` : ""}`);
  lines.push(
    `Quelle: ${NO_GEOZONE_SOURCE_LABEL} – Datei ${def.file}${def.dynamic && ctx.statusIso ? ` (NOTAM-Stand ${ctx.statusIso.slice(0, 16).replace("T", " ")} UTC)` : ""}. Nur zur Information; NOTAM (ippc.no) zusätzlich prüfen.`,
  );
  const original = [noHtmlText(p.info), noHtmlText(p.info_en), noStr(p.remarks)].filter(Boolean);
  if (original.length) lines.push("", "Originaltext der Behörde:", ...original);
  const idPart = noStr(p.id) || norwayAreaCode(name) || String(index);
  const props: Record<string, any> = {
    identifier: `NO-DATA-${def.file}-${idPart}${start != null ? `-${start}` : ""}`,
    name,
    restriction: def.restriction,
    lowerMeters: lower?.meters ?? 0,
    lowerReference: lower && lower.meters > 0 ? lower.reference : "AGL",
    upperMeters: upper?.meters,
    upperReference: upper ? upper.reference : undefined,
    message: lines.join("\n"),
    source: NO_GEOZONE_SOURCE_LABEL,
    attribution: NO_GEOZONE_ATTRIBUTION,
    noLayer: def.file,
    _layer: def.file === "obs_sanntid_fareomrader" ? NO_REALTIME_LAYER_ID : undefined,
  };
  if (start != null) props.validStartTs = start;
  if (end != null) props.validEndTs = end;
  if (start != null || end != null) {
    props.applicability = [{
      permanent: "NO",
      ...(start != null ? { startDateTime: new Date(start).toISOString() } : {}),
      ...(end != null ? { endDateTime: new Date(end).toISOString() } : {}),
    }];
  }
  if (byNotam) {
    props.isNotam = true;
    props._notamEligible = true;
  }
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", geometry: g, properties: props } as Ed269PureFeature;
}

/**
 * /data/-Ebenen → fehlende Zonen (ohne Doppelungen gegen ED-269 und
 * untereinander). `duplicates` zählt die verworfenen ED-269-Doppelungen je Datei.
 */
export function mergeNorwayDataLayers(
  ed269Features: readonly { properties?: Record<string, any> }[],
  byFile: Partial<Record<NoDataFile, any[]>>,
  ctx: NorwayDataContext,
): { features: Ed269PureFeature[]; duplicates: Partial<Record<NoDataFile, number>> } {
  const keys = norwayEd269Keys(ed269Features);
  const features: Ed269PureFeature[] = [];
  const duplicates: Partial<Record<NoDataFile, number>> = {};
  const ids = new Set<string>();
  const geoms = new Set<string>();
  for (const def of NO_DATA_LAYERS) {
    (byFile[def.file] ?? []).forEach((raw, i) => {
      const name = norwayDataName(raw?.properties ?? {});
      const code = norwayAreaCode(name);
      if ((name && keys.has(`n:${noNameKey(name)}`)) || (code && keys.has(`c:${code}`))) {
        duplicates[def.file] = (duplicates[def.file] ?? 0) + 1;
        return;
      }
      const f = normalizeNorwayDataFeature(raw, def, i, ctx);
      if (!f) return;
      const g = JSON.stringify(f.geometry?.coordinates);
      if (geoms.has(`${def.file}|${g}`)) return;
      geoms.add(`${def.file}|${g}`);
      let id = String(f.properties.identifier);
      while (ids.has(id)) id = `${id}#`;
      ids.add(id);
      f.properties.identifier = id;
      features.push(f);
    });
  }
  return { features, duplicates };
}
