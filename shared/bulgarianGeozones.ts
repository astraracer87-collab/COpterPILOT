// Bulgarien (BG) – Normalisierung der Drohnen-Geozonen der Главна дирекция
// „Гражданска въздухоплавателна администрация“ (ГД ГВА / CAA Bulgaria,
// Portal uas.caa.bg). Siehe docs/bulgaria-caa-api-integration.md.
//
// Ausgabe: GeoJSON-Features mit den Properties, die parseEd269ToGeozoneInfo in
// client/lib/ed269.ts liest (restriction, name, lowerMeters/upperMeters,
// lowerReference/upperReference, message, extendedProperties.localizedMessages,
// validStartTs/validEndTs, applicability, infoUrl, contactEmail …).
//
// Quelle: öffentlicher GeoServer-WFS https://uas.caa.bg/geoserver/caa-uas/wfs
// (ohne Authentifizierung). Live geprüft 2026-11-15:
//   - caa-uas:VGeoCAAZonesPublic     888 Zonen (Haupt-Datensatz, alle Polygon)
//   - caa-uas:VGeoBULATSAZonesPublic  16 Luftraumgebiete der Flugsicherung
//                                     BULATSA (3 davon is_deleted=true)
//   - caa-uas:VGeoAirspaceZonesPublic, caa-uas:VGeoFlightZonesPublic: leer
//     (0 Features, Schema unbekannt → generisch wie der Hauptlayer behandelt).
//
// Felder Hauptlayer (alle live erfasst): id, zone_id, name, zone_type (immer
// „Географска зона“), restriction_code (PROHIBITED 222 / REQ_AUTHORISATION 582 /
// CONDITIONAL 84), purpose (AUTHORIZATION 643 / INFORMATION 166 /
// NOTIFICATION 79), vertical_min_agl (0 oder 50) / vertical_max_agl (0, 50,
// 120, 150, 200, 250, 500, 1000, 3500, 8000 – Meter über Grund; die Texte
// „до височина 120 метра“ bestätigen die Einheit), buffer_wkt (nur 4 Zonen,
// Fläche als WKT in voller Präzision), message, restriction_conditions,
// information („Identifier: …; Country: BGR“ oder Freitext), applicant,
// contact_name/_email/_phone, immediate_period_start/_end, is_permanent (immer
// true), is_uspace (immer false), is_deleted (immer false), region, z_order.
// BULATSA-Layer: identifier (AIP-/NOTAM-Kennung), activation_status (ACTIVE),
// bflip_vertical_lower/_upper („GND“, „3000FT AMSL“, „FL165“, „5000FT“,
// „1200FT“), remark, source, immediate_period_start/_end.
//
// Einstufung (restriction) – vorsichtige Regeln, „die strengere Angabe gewinnt“:
//
//   | Layer   | restriction_code / Name     | Behördentext                          | App               | live |
//   |---------|-----------------------------|---------------------------------------|-------------------|------|
//   | CAA     | PROHIBITED                  | (egal)                                | PROHIBITED        | 222  |
//   | CAA     | REQ_AUTHORISATION           | normal (auch „… освен с тези на       | REQ_AUTHORISATION | 536  |
//   |         |                             |  заявителя“ = außer des Inhabers)     |                   |      |
//   | CAA     | REQ_AUTHORISATION           | „Забраняват се полетите … в           | PROHIBITED        |  46  |
//   |         |                             |  установената зона.“ (Flugverbot      |                   |      |
//   |         |                             |  ohne Ausnahme), „Зона (за сигурност) |                   |      |
//   |         |                             |  забранена …“, „UAS operations are    |                   |      |
//   |         |                             |  prohibited …“                        |                   |      |
//   | CAA     | CONDITIONAL                 | normal (Anmeldung beim Kontakt)       | CONDITIONAL       |  76  |
//   | CAA     | CONDITIONAL                 | Flugverbot (wie oben)                 | PROHIBITED        |   8  |
//   | CAA     | NO_RESTRICTION/leer/sonst.  | –                                     | REQ_AUTHORISATION |   0  |
//   | BULATSA | LBP… (Prohibited Area)      | –                                     | PROHIBITED        |   1  |
//   | BULATSA | LBR…, LBD…, MATZ, sonstige  | –                                     | REQ_AUTHORISATION |  12  |
//
// Ergebnis live (2026-11-15T03:00Z, nach Filtern; 901 Zonen = CAA 888 +
// BULATSA 13 von 16, 3 gelöscht): PROHIBITED 277, REQ_AUTHORISATION 548,
// CONDITIONAL 76.
// Der Originalwert bleibt in `originalRestriction`, die Begründung steht als
// „Hinweis zur Einstufung“ in der Beschreibung.
//
// Höhen: CAA-Layer aus vertical_min_agl/vertical_max_agl (Meter AGL; max ≤ min,
// z. B. 0/0, gilt als „keine Obergrenze“). BULATSA aus bflip_vertical_*
// (GND → 0 AGL, FLnnn → Druckhöhe, ft/m ohne Bezug → AMSL wie in der Luftfahrt
// üblich). buffer_wkt enthält KEINE Höhen, sondern die Fläche (siehe Geometrie).
// Zonen, deren Untergrenze weit über Drohnenhöhen liegt (> 500 ft AGL bzw.
// > FL125/12 500 ft AMSL), werden verworfen (live: keine – die höchste
// Untergrenze im CAA-Layer ist 50 m AGL, BULATSA-Zonen beginnen an GND bzw.
// 3000 ft AMSL und sind dann ohnehin gelöscht). AMSL-Untergrenzen unter FL125
// bleiben erhalten (Geländehöhe unbekannt; der Höhenfilter der App rechnet sie
// mit der Geländehöhe um).
//
// Gültigkeit: is_deleted=true → verworfen; immediate_period_end in der
// Vergangenheit → verworfen; ein Beginn in der Zukunft bzw. ein Ende werden zu
// validStartTs/validEndTs (+ applicability). Ein bereits vergangener Beginn bei
// dauerhaften Zonen wird nicht als Zeitfenster übernommen (sonst würde die App
// die Zone als „temporär“ führen). BULATSA-AIP-Gebiete tragen als Ende
// pauschal 2036-12-31 – ein Ende > 5 Jahre in der Zukunft gilt als
// Platzhalter für „dauerhaft“ und wird nur als Text („Gültig bis …“) gezeigt.
//
// Texte: Alle live vorkommenden bulgarischen (und englischen) Sätze, Etiketten,
// Antragsteller-Behörden und Dienstgrade werden über ein eingebautes
// Wörterbuch (Satzmuster mit Zahlen-Platzhaltern) ins Deutsche übertragen;
// Personen- und Ortsnamen werden nach dem amtlichen bulgarischen System
// (Streamlined System 2009) transliteriert, gängige Exonyme (Sofia, Russe,
// Schumen) verwendet. Der vollständige Originaltext steht unter
// „Originaltext der Behörde:“ (localizedMessages: „de“ zuerst, dann „bg“ –
// ed269.ts übersetzt daher nicht erneut und hängt das Original nicht doppelt an).
//
// Geometrie: Die GeoJSON-Ausgabe des Servers rundet auf 4 Nachkommastellen
// (≈ 10 m). Die volle Präzision liefert derselbe WFS als CSV (WKT in der Spalte
// `shape`, 14–15 Stellen). bulgariaSource.ts lädt daher zusätzlich das CSV
// (nur FID + shape) und ersetzt die Geometrie, wenn die WKT-Fläche zur
// GeoJSON-Fläche passt (Plausibilitätsprüfung über die bbox); sonst buffer_wkt,
// sonst die GeoJSON-Geometrie. Keine Vereinfachung.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar); keine
// Lookbehinds und keine \p{…}-Klassen (Hermes-kompatibel).
import { wktToAreaGeometry } from "./geozoneKit/wkt";
import { FT_M, mToFt, parseHeight } from "./geozoneKit/heights";
import { collapseWhitespace } from "./geozoneKit/text";
import {
  heightLineDe,
  localizedExtendedProperties,
  messageWithOriginal,
  originalBlock,
  pushHints,
  sourceLineDe,
} from "./geozoneKit/messages";
import { wfsGetFeatureUrl, wfsHasMore } from "./geozoneKit/wfs";

export const BG_GEOZONE_SOURCE_LABEL = "ГД ГВА / CAA Bulgaria";
export const BG_GEOZONE_ATTRIBUTION = "© ГД ГВА (CAA Bulgaria)";
export const BG_UAS_PORTAL_URL = "https://uas.caa.bg";
export const BG_WFS_URL = "https://uas.caa.bg/geoserver/caa-uas/wfs";
export const BG_CAA_ZONES_LAYER = "caa-uas:VGeoCAAZonesPublic";
export const BG_BULATSA_ZONES_LAYER = "caa-uas:VGeoBULATSAZonesPublic";
export const BG_AIRSPACE_ZONES_LAYER = "caa-uas:VGeoAirspaceZonesPublic";
export const BG_FLIGHT_ZONES_LAYER = "caa-uas:VGeoFlightZonesPublic";
/** Seitengröße für WFS-Paging (count/startIndex). Live: 888 Zonen → 1 Seite. */
export const BG_WFS_PAGE_SIZE = 1000;

/** 500 ft in Metern – Untergrenzen darüber (AGL) sind für Drohnen irrelevant. */
export const BG_MAX_LOWER_AGL_M = 500 * FT_M;
/** FL125 in Metern (Druckhöhe ≈ AMSL) – Untergrenzen darüber werden verworfen. */
export const BG_MAX_LOWER_MSL_M = 12_500 * FT_M;
/** Ende weiter als 5 Jahre in der Zukunft → Platzhalter für „dauerhaft“. */
const LONG_TERM_MS = 5 * 365 * 24 * 3600 * 1000;

export type BgRestriction = "PROHIBITED" | "REQ_AUTHORISATION" | "CONDITIONAL";
export type BgLayerKind = "caa" | "bulatsa";

export type BgFeature = {
  type: "Feature";
  id?: string;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: any };
  properties: Record<string, any>;
  bbox?: [number, number, number, number];
};

export type BgDropReason = "deleted" | "expired" | "no_geometry" | "duplicate" | "above_drone_heights";

export interface BgNormalizeResult {
  features: BgFeature[];
  dropped: { name: string; reason: BgDropReason }[];
}

// ---------------------------------------------------------------------------
// WFS-URLs, Paging, CSV (volle Geometrie-Präzision)
// ---------------------------------------------------------------------------

/** WFS-2.0-GetFeature-URL (Standard: GeoJSON, WGS84 lon/lat). */
export function bulgariaWfsUrl(
  layer: string,
  opts: { base?: string; count?: number; startIndex?: number; outputFormat?: string; propertyName?: string } = {},
): string {
  return wfsGetFeatureUrl({ ...opts, base: opts.base ?? BG_WFS_URL, layer });
}

/** CSV-Variante (nur FID, zone_id, shape) – liefert die Geometrie in voller Präzision. */
export function bulgariaWfsCsvUrl(layer: string, opts: { count?: number; startIndex?: number } = {}): string {
  return bulgariaWfsUrl(layer, { ...opts, outputFormat: "csv", propertyName: "zone_id,shape" });
}

/** Weitere GeoJSON-Seite nötig? (numberMatched/totalFeatures, sonst Seitengröße). */
export function bulgariaWfsHasMore(body: any, collected: number, pageSize: number): boolean {
  return wfsHasMore(body, collected, pageSize);
}

/** Minimaler RFC-4180-CSV-Parser (Anführungszeichen, "" und Zeilenumbrüche in Feldern). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/** WFS-CSV → Map FID („VGeoCAAZonesPublic.2“) → WKT der Spalte `shape`. */
export function parseBulgariaWfsCsv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const rows = parseCsv(text);
  if (rows.length === 0) return out;
  const header = rows[0].map((h) => h.trim());
  const iFid = header.indexOf("FID");
  const iShape = header.indexOf("shape");
  if (iFid < 0 || iShape < 0) return out;
  for (let r = 1; r < rows.length; r++) {
    const fid = (rows[r][iFid] ?? "").trim();
    const wkt = (rows[r][iShape] ?? "").trim();
    if (fid && wkt) out.set(fid, wkt);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------

function validCoords(c: unknown, depth: number): boolean {
  if (!Array.isArray(c)) return false;
  if (depth === 0) return c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));
  return c.length > 0 && c.every((x) => validCoords(x, depth - 1));
}

/** Nur Flächen; Koordinaten unverändert. */
export function bgAreaGeometry(geometry: any): BgFeature["geometry"] | null {
  if (!geometry || typeof geometry !== "object") return null;
  if (geometry.type === "Polygon" && validCoords(geometry.coordinates, 2)) {
    const rings = (geometry.coordinates as unknown[][]).filter((r) => r.length >= 4);
    return rings.length ? { type: "Polygon", coordinates: rings } : null;
  }
  if (geometry.type === "MultiPolygon" && validCoords(geometry.coordinates, 3)) {
    const polys = (geometry.coordinates as unknown[][][])
      .map((p) => p.filter((r) => r.length >= 4))
      .filter((p) => p.length > 0);
    if (polys.length === 0) return null;
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

export function bgGeometryBbox(geometry: { coordinates: unknown } | null | undefined): [number, number, number, number] | null {
  if (!geometry) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number, y = c[1] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else c.forEach(visit);
  };
  visit(geometry.coordinates);
  return isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/** Toleranz für den bbox-Abgleich (GeoJSON ist auf 1e-4° gerundet). */
const BBOX_TOLERANCE_DEG = 0.001;

function bboxMatches(a: number[] | null, b: number[] | null): boolean {
  if (!a || !b) return false;
  return a.every((v, i) => Math.abs(v - b[i]) <= BBOX_TOLERANCE_DEG);
}

/**
 * Präziseste plausible Geometrie: CSV-WKT (voll) > buffer_wkt > GeoJSON (4 Stellen).
 * Eine WKT-Fläche wird nur übernommen, wenn ihre bbox zur GeoJSON-bbox passt
 * (schützt vor vertauschter Achsfolge oder abweichenden Datensätzen).
 */
export function bgPreciseGeometry(raw: any, preciseWkt?: Map<string, string> | null): BgFeature["geometry"] | null {
  const base = bgAreaGeometry(raw?.geometry);
  const candidates: unknown[] = [];
  const fid = raw?.id != null ? String(raw.id) : "";
  if (preciseWkt && fid && preciseWkt.has(fid)) candidates.push(preciseWkt.get(fid));
  if (raw?.properties?.buffer_wkt) candidates.push(raw.properties.buffer_wkt);
  const baseBbox = base ? bgGeometryBbox(base) : null;
  for (const wkt of candidates) {
    const g = bgAreaGeometry(wktToAreaGeometry(wkt));
    if (!g) continue;
    if (!base || bboxMatches(bgGeometryBbox(g), baseBbox)) return g;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Transliteration (amtliches bulgarisches System, Streamlined System 2009)
// ---------------------------------------------------------------------------

const BG_TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
  ѝ: "i", ё: "yo", э: "e", ы: "y",
};
const CYR_RUN = /[Ѐ-ӿ]+/g;

function translitRun(run: string): string {
  const letters = run.replace(/[^Ѐ-ӿ]/g, "");
  const allCaps = letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  let out = "";
  for (let i = 0; i < run.length; i++) {
    const ch = run[i];
    const lower = ch.toLowerCase();
    let latin = BG_TRANSLIT[lower];
    if (latin == null) {
      out += ch;
      continue;
    }
    // Endung „-ия“ → „-ia“ (Gesetz über die Transliteration, Art. 4).
    if (lower === "я" && i === run.length - 1 && i > 0 && run[i - 1].toLowerCase() === "и") latin = "a";
    if (allCaps) out += latin.toUpperCase();
    else if (ch !== lower) out += latin.charAt(0).toUpperCase() + latin.slice(1);
    else out += latin;
  }
  return out;
}

/** Kyrillische Buchstaben in Lateinschrift; alles andere bleibt. */
export function transliterateBulgarian(s: string): string {
  return String(s ?? "").replace(CYR_RUN, (run) => translitRun(run));
}

/** Enthält der Text (noch) kyrillische Buchstaben? */
export function hasCyrillic(s: string): boolean {
  return /[Ѐ-ӿ]/.test(String(s ?? ""));
}

const clean = collapseWhitespace;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Phrase = { re: RegExp; de: string };
const CYR_WORD = "A-Za-z0-9\\u0400-\\u04FF";

function compilePhrases(entries: [string, string][]): Phrase[] {
  return [...entries]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([bg, de]) => {
      const key = escapeRe(bg).replace(/\s+/g, "\\s+");
      const start = /^[A-Za-z0-9Ѐ-ӿ]/.test(bg) ? `(^|[^${CYR_WORD}])` : "()";
      const end = /[A-Za-z0-9Ѐ-ӿ]$/.test(bg) ? `(?=$|[^${CYR_WORD}])` : "";
      return { re: new RegExp(`${start}${key}${end}`, "gi"), de };
    });
}

function applyPhrases(text: string, rules: Phrase[]): string {
  let s = text;
  for (const r of rules) s = s.replace(r.re, (_m, pre: string) => `${pre}${r.de}`);
  return s;
}

/** "…" bzw. «…» → „…“ */
function germanQuotes(s: string): string {
  return s.replace(/"([^"]*)"/g, "„$1“").replace(/«([^»]*)»/g, "„$1“");
}

// ---------------------------------------------------------------------------
// Zonennamen
// ---------------------------------------------------------------------------

// Gattungsbegriffe und Exonyme (alle live vorkommenden kyrillischen Namensteile;
// übrige Eigennamen werden transliteriert).
const NAME_PHRASES = compilePhrases([
  ["Вертолетно летище", "Hubschrauberflugplatz"],
  ["БВЛ", "Hubschrauberlandeplatz (BVL)"],
  ["Язовир", "Stausee"],
  ["Зона", "Zone"],
  ["МВнР", "Außenministerium (MVnR)"],
  ["ИРТ-2000", "Forschungsreaktor IRT-2000"],
  ["Алфа метал", "Alfa Metal"],
  ["Слънчев Бряг", "Slanchev Bryag (Sonnenstrand)"],
  ["Уни Хоспитал", "Uni Hospital"],
  ["Милениум-Център", "Millennium-Zentrum"],
  ["ТУНЕЛ", "Tunnel"],
  ["Д-р", "Dr."],
  ["София", "Sofia"],
  ["Русе", "Russe"],
  ["Шумен", "Schumen"],
]);

/** Zonennamen ins Deutsche: Gattungsbegriffe übersetzt, Eigennamen transliteriert. */
export function translateBgZoneName(name: string): string {
  let s = clean(name);
  if (!s) return s;
  // „ВП_Сливен“ (вертолетна площадка) → „Hubschrauberlandeplatz Sliven“
  s = s.replace(/^ВП_/, "Hubschrauberlandeplatz ");
  s = applyPhrases(s, NAME_PHRASES);
  s = germanQuotes(s);
  return transliterateBulgarian(s).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Kategorie (nur Anzeige; abgeleitet aus Namens-Präfix bzw. Text)
// ---------------------------------------------------------------------------

const CATEGORY_RULES: [RegExp, string][] = [
  [/^AEC-/, "Kernkraftwerk (AEC, Kosloduj)"],
  [/^ИРТ-2000/, "Forschungsreaktor"],
  [/^RAO\d/, "Lager für radioaktive Abfälle"],
  [/^HAIL\d/, "Hagelabwehr-Station"],
  [/^MIL_?\d/, "Militärisches Objekt"],
  [/^GAS \d/, "Gasinfrastruktur"],
  [/^NEK \d/, "Energieinfrastruktur (NEK – Nationale Elektrizitätsgesellschaft)"],
  [/^(TOPLO\d|Toplo )/i, "Fernwärme-/Heizkraftwerk"],
  [/^(Maritsa Iztok|Марица Изток|BOBOV DOL)/i, "Kraftwerk"],
  [/^(ARSENAL|VMZ|EMKO|Dunarit|AVIONAMS)\d/i, "Rüstungsbetrieb"],
  [/^LUK\d/, "Industrieanlage (Lukoil)"],
  [/^(PORT|Пристанище)/i, "Hafen"],
  [/^(VIK |SOF VODA)/i, "Wasserversorgung"],
  [/^(A1|А1|VIVACOM)\b/i, "Telekommunikationsanlage"],
  [/^SENSITIVE ?\d/, "Sensibles Objekt"],
  [/Embassy|Посолство/i, "Botschaft"],
  [/^МВнР/, "Ministerium"],
  [/^Вертолетно летище/, "Hubschrauberflugplatz"],
  [/^(БВЛ|ВП_)/, "Hubschrauberlandeplatz"],
  [/\(LB[A-Z]{2}\)/, "Flugplatz"],
];

export function bgZoneCategory(name: string): string | undefined {
  const n = clean(name);
  for (const [re, label] of CATEGORY_RULES) if (re.test(n)) return label;
  return undefined;
}

const BULATSA_CATEGORY: [RegExp, string][] = [
  [/^LBP/i, "Luftsperrgebiet (Prohibited Area, AIP)"],
  [/^LBR/i, "Flugbeschränkungsgebiet (Restricted Area, AIP)"],
  [/^LBD/i, "Gefahrengebiet (Danger Area, AIP/NOTAM)"],
  [/MATZ/i, "Militärische Flugplatz-Verkehrszone (MATZ)"],
];

// ---------------------------------------------------------------------------
// Sätze (Wörterbuch mit Zahlen-Platzhaltern) – alle Live-Varianten
// ---------------------------------------------------------------------------

const GDGVA = "der GD GVA (bulgarische Zivilluftfahrtbehörde)";

function unitDe(n: string, unit: string): string {
  const u = unit.toLowerCase().replace(/\s+/g, " ");
  const one = n === "1";
  if (/^раб(\.|отни)? ?дни$|^работни дни$|^раб\. дни$/.test(u)) return `${n} ${one ? "Arbeitstag" : "Arbeitstage"}`;
  if (/^месец(а|и)?$/.test(u)) return `${n} ${one ? "Monat" : "Monate"}`;
  if (/^седмиц(а|и)$/.test(u)) return `${n} ${one ? "Woche" : "Wochen"}`;
  return `${n} ${one ? "Tag" : "Tage"}`;
}

type SentenceRule = { re: RegExp; de: (m: RegExpMatchArray) => string };

const SENTENCE_RULES: SentenceRule[] = [
  {
    re: /^Полети в тази зона(?: над (\d+)\s*м(?:етра)?)? могат да се изпълн(?:яват|ят) само след (специално )?разрешение (?:от|на) ГД ГВА\.?$/i,
    de: (m) => `Flüge in dieser Zone${m[1] ? ` oberhalb von ${m[1]} m` : ""} dürfen nur nach ${m[2] ? "besonderer " : ""}Genehmigung ${GDGVA} durchgeführt werden.`,
  },
  {
    re: /^Минимал(?:ен|ният) интервал от време за подаване на заявление е (\d+) (работни дни|раб\. дни|дни|месеца?|седмици|седмица) преди планираната дата\.?$/i,
    de: (m) => `Der Antrag ist mindestens ${unitDe(m[1], m[2])} vor dem geplanten Datum einzureichen.`,
  },
  {
    re: /^Минимал(?:ен|ният) интервал от време, необходим между заявката за разрешение и започването на работа в зоната,? е (\d+) (работни дни|раб\. дни|дни|месеца?)\.?$/i,
    de: (m) => `Zwischen dem Genehmigungsantrag und dem Beginn der Tätigkeit in der Zone müssen mindestens ${unitDe(m[1], m[2])} liegen.`,
  },
  {
    re: /^Да се уведомява лицето за контакт за планираната дейност (\d+) (работни дни|раб\. дни|дни|месеца?) предварително\.?$/i,
    de: (m) => `Die Kontaktperson ist ${unitDe(m[1], m[2])} im Voraus über die geplante Tätigkeit zu benachrichtigen.`,
  },
  {
    re: /^Да се уведоми заявителят за планираната дейност\.?$/i,
    de: () => "Der Antragsteller (Zoneninhaber) ist über die geplante Tätigkeit zu benachrichtigen.",
  },
  {
    re: /^Забраняват се полетите с безпилотни летателни системи в установената зона, освен с тези на заявителя\.?$/i,
    de: () => "Flüge mit unbemannten Luftfahrzeugsystemen (UAS) sind in der festgelegten Zone verboten, ausgenommen die des Antragstellers (Zoneninhabers).",
  },
  {
    re: /^Забраняват се полетите с безпилотни летателни системи в установената зона\.?$/i,
    de: () => "Flüge mit unbemannten Luftfahrzeugsystemen (UAS) sind in der festgelegten Zone verboten.",
  },
  {
    re: /^Забраняват се полети с БЛС, изисква се предварително разрешение за полет от заявителя\.?$/i,
    de: () => "UAS-Flüge sind verboten; erforderlich ist eine vorherige Fluggenehmigung des Antragstellers (Zoneninhabers).",
  },
  {
    re: /^Полетът в зоната се извършва под условия\.?$/i,
    de: () => "Der Flug in der Zone erfolgt unter Auflagen.",
  },
  {
    re: /^Зона за сигурност,? забранена за полети на БЛС от земната повърхност до височина (\d+) метра\.?$/i,
    de: (m) => `Sicherheitszone: UAS-Flüge sind von der Erdoberfläche bis ${m[1]} m Höhe verboten.`,
  },
  {
    re: /^Зона,? забранена за полети на БЛС от земната повърхност до височина (\d+) метра\.?$/i,
    de: (m) => `Zone, in der UAS-Flüge von der Erdoberfläche bis ${m[1]} m Höhe verboten sind.`,
  },
  {
    re: /^Операторът на БЛС изисква предварително разрешение за полет чрез подаване на заявление в ГД ГВА\.?$/i,
    de: () => `Der UAS-Betreiber muss vorab eine Fluggenehmigung beantragen – per Antrag bei ${GDGVA}.`,
  },
  {
    re: /^Извършването на нерегламентирани полети на безпилотни и пилотирани въздухоплавателни средства над обекта създава преки рискове от:?$/i,
    de: () => "Nicht genehmigte Flüge unbemannter und bemannter Luftfahrzeuge über dem Objekt verursachen unmittelbare Risiken durch:",
  },
  {
    re: /^Заплаха за физическата и ядрената сигурност на съоръженията, критичната инфраструктура и персонала\.?$/i,
    de: () => "Gefährdung der physischen und nuklearen Sicherheit der Anlagen, der kritischen Infrastruktur und des Personals.",
  },
  {
    re: /^Риск от възникване на аварийни ситуации, нежелана намеса или смущения в работния процес на комплекса\.?$/i,
    de: () => "Risiko von Notfällen, unerwünschten Eingriffen oder Störungen des Betriebsablaufs der Anlage.",
  },
  {
    re: /^Зоната представлява обект, свързан със сигурността на страната\.?$/i,
    de: () => "Die Zone ist ein Objekt, das mit der Sicherheit des Landes in Zusammenhang steht.",
  },
  {
    re: /^Класифициран като стратегически обект от значение за националната сигурност\.?$/i,
    de: () => "Als strategisches Objekt von Bedeutung für die nationale Sicherheit eingestuft.",
  },
  {
    re: /^Центърът за управление на мрежата на Виваком е обект от критичната инфраструктура на Република България\.?$/i,
    de: () => "Das Netzleitzentrum von Vivacom ist ein Objekt der kritischen Infrastruktur der Republik Bulgarien.",
  },
  // Englische Texte im Feed
  { re: /^Warning!?$/i, de: () => "Achtung!" },
  { re: /^You are entering a restricted area!?$/i, de: () => "Sie fliegen in ein Beschränkungsgebiet ein!" },
  {
    re: /^UAS operations are prohibited in this area due to public safety and protection of diplomatic premises\.?$/i,
    de: () => "UAS-Betrieb ist in diesem Gebiet aus Gründen der öffentlichen Sicherheit und zum Schutz diplomatischer Einrichtungen verboten.",
  },
  {
    re: /^Flights only permitted with explicit authori[sz]ation from the competent Bulgarian authority\.?$/i,
    de: () => "Flüge nur mit ausdrücklicher Genehmigung der zuständigen bulgarischen Behörde.",
  },
];

/** Text in Sätze zerlegen (Zeilen, dann Satzende vor Großbuchstaben). */
export function splitBgSentences(text: string): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/([.!?])\s+(?=[A-ZА-Я])/g, "$1\n").split("\n"))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/** Einzelnen Satz übersetzen; null, wenn er nicht im Wörterbuch steht. */
export function translateBgSentence(sentence: string): string | null {
  const s = clean(sentence);
  if (!s) return null;
  for (const r of SENTENCE_RULES) {
    const m = s.match(r.re);
    if (m) return r.de(m);
  }
  return null;
}

export interface BgTranslatedText {
  /** Übersetzte Sätze (Reihenfolge wie im Original). */
  de: string[];
  /** Nicht übersetzbare Sätze (bleiben nur im Originaltext). */
  untranslated: string[];
}

export function translateBgText(text: string | null | undefined): BgTranslatedText {
  const de: string[] = [];
  const untranslated: string[] = [];
  for (const s of splitBgSentences(String(text ?? ""))) {
    const t = translateBgSentence(s);
    if (t) de.push(t);
    else untranslated.push(s);
  }
  return { de, untranslated };
}

/** Enthält der Text ein uneingeschränktes Flugverbot? (für die Einstufung) */
export function bgTextProhibits(text: string | null | undefined): boolean {
  return splitBgSentences(String(text ?? "")).some(
    (s) =>
      /^Забраняват се полетите с безпилотни летателни системи в установената зона\.?$/i.test(s) ||
      /^(Зона за сигурност,?|Зона,) забранена за полети на БЛС/i.test(s) ||
      /^UAS operations are prohibited/i.test(s),
  );
}

// ---------------------------------------------------------------------------
// Etiketten, Antragsteller, Kontaktpersonen
// ---------------------------------------------------------------------------

export const BG_ZONE_TYPE_DE: Record<string, string> = {
  "Географска зона": "Geografische UAS-Zone (GD GVA)",
  "Зона от РВД": "Luftraumgebiet der Flugverkehrskontrolle (BULATSA)",
};

export const BG_PURPOSE_DE: Record<string, string> = {
  AUTHORIZATION: "Genehmigung",
  AUTHORISATION: "Genehmigung",
  INFORMATION: "Information",
  NOTIFICATION: "Benachrichtigung (Anmeldung beim Kontakt)",
};

const TYPE_DE: Record<BgRestriction, string> = {
  PROHIBITED: "Flugverbotszone",
  REQ_AUTHORISATION: "Genehmigungspflichtige Zone",
  CONDITIONAL: "Zone mit Auflagen (Anmeldung erforderlich)",
};

const RESTRICTION_LABEL_DE: Record<string, string> = {
  PROHIBITED: "verboten",
  REQ_AUTHORISATION: "Genehmigung erforderlich",
  CONDITIONAL: "bedingt zulässig",
  RESTRICTED: "beschränkt",
  NO_RESTRICTION: "keine Beschränkung",
};

const APPLICANT_DE: Record<string, string> = {
  "ГД ГВА": "GD GVA (Generaldirektion Zivilluftfahrtverwaltung, CAA Bulgaria)",
  "ВВС": "Luftstreitkräfte (VVS)",
  "ВМС": "Seestreitkräfte (VMS)",
  "СВ": "Landstreitkräfte (SV)",
  "МО": "Verteidigungsministerium (MO)",
  "НВУ": "Nationale Militäruniversität (NVU)",
  "СКС": "Gemeinsames Streitkräftekommando (SKS)",
  "СКСО": "Gemeinsames Kommando für Spezialoperationen (SKSO)",
  "ВА": "Militärakademie (VA)",
  "КЛП": "Logistikkommando der Streitkräfte (KLP)",
  "Национална гвардейска част": "Nationalgarde-Einheit",
  "Пристанищен комплекс-Русе ЕАД": "Hafenkomplex Russe EAD",
  "A1 BULGARIA": "A1 Bulgaria",
  "VIVACOM": "Vivacom",
  "INRNE": "INRNE (Institut für Kernforschung und Kernenergie, Bulgarische Akademie der Wissenschaften)",
  "Embassy of the People's Republic of China in the Republic of Bulgaria": "Botschaft der Volksrepublik China in der Republik Bulgarien",
};

function applicantKey(s: string): string {
  return clean(s)
    .replace(/[„“"]/g, " ")
    .replace(/^А1/, "A1") // kyrillisches „А“ im Feed
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Antragsteller/Zoneninhaber ins Deutsche (unbekannte → transliteriert). */
export function translateBgApplicant(text: string | null | undefined): string {
  const raw = clean(text);
  if (!raw) return "";
  const de = APPLICANT_DE[applicantKey(raw)];
  return de ?? germanQuotes(transliterateBulgarian(raw));
}

const CONTACT_PHRASES = compilePhrases([
  ["ГД ГВА служител", "Mitarbeiter/in der GD GVA"],
  ["служител", "Mitarbeiter/in"],
  ["К-н III ранг", "Korvettenkapitän"],
  ["подполковник", "Oberstleutnant"],
  ["подп.", "Oberstleutnant"],
  ["полковник", "Oberst"],
  ["полк.", "Oberst"],
  ["майор", "Major"],
  ["м-р", "Major"],
  ["капитан", "Hauptmann"],
  ["к-н", "Hauptmann"],
  ["лейт.", "Leutnant"],
  ["оф. канд.", "Offiziersanwärter"],
  ["доц.", "Doz."],
  ["д-р", "Dr."],
  ["инж.", "Ing."],
]);

/** Kontaktperson: Dienstgrade/Titel deutsch, Namen transliteriert. */
export function translateBgContact(text: string | null | undefined): string {
  let s = clean(text);
  if (!s) return "";
  // Fehlendes Leerzeichen zwischen Vor- und Nachname („СтанчоСтанчев“).
  s = s.replace(/([а-я])([А-Я])/g, "$1 $2");
  s = applyPhrases(s, CONTACT_PHRASES);
  return transliterateBulgarian(s).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

export interface BgLimit {
  meters: number;
  reference: "AGL" | "MSL";
  /** Flugfläche (nur bei FLnnn). */
  fl?: number;
  /** Originalangabe. */
  raw: string;
}

/** BULATSA-Höhenangabe („GND“, „FL165“, „3000FT AMSL“, „5000FT“) → Meter. */
export function parseBgLimit(raw: unknown): BgLimit | null {
  const s = clean(raw).toUpperCase();
  if (!s) return null;
  if (s === "GND" || s === "SFC" || s === "0") return { meters: 0, reference: "AGL", raw: s };
  if (s === "UNL" || s === "UNLIMITED") return null;
  // BULATSA-Schreibweisen prüfen; Umrechnung/Bezug über den gemeinsamen Parser.
  // Ohne Angabe gilt ft AMSL (AIP-Konvention).
  const m = s.match(/^FL\s*(\d{1,3})$/);
  if (m) {
    const fl = Number(m[1]);
    return { meters: parseHeight(s)?.m ?? 0, reference: "MSL", fl, raw: s };
  }
  if (BG_LIMIT_RE.test(s)) {
    const h = parseHeight(s, "FT", "AMSL");
    if (h && h.m != null) return { meters: h.m, reference: h.ref === "AGL" ? "AGL" : "MSL", raw: s };
  }
  return null;
}

const BG_LIMIT_RE = /^\d+(?:[.,]\d+)?\s*(?:FT|F|M)?\s*(?:AMSL|MSL|AGL|AGND|GND|SFC|ALT|HGT)?$/;

export function formatBgLimitDe(l: BgLimit | null | undefined): string {
  if (!l) return "ohne Obergrenze";
  if (l.meters === 0 && l.reference === "AGL") return "Boden (GND)";
  if (l.fl != null) return `FL ${l.fl} (≈ ${Math.round(l.meters)} m AMSL)`;
  if (/FT|F\b/.test(l.raw) || !/M\b/.test(l.raw)) {
    const ft = Math.round(mToFt(l.meters));
    return `${ft} ft ${l.reference === "AGL" ? "über Grund" : "AMSL"} (≈ ${Math.round(l.meters)} m)`;
  }
  return `${Math.round(l.meters)} m ${l.reference === "AGL" ? "über Grund" : "AMSL"}`;
}

/** Liegt die Untergrenze weit über Drohnenhöhen (> 500 ft AGL bzw. > FL125)? */
export function bgLowerAboveDroneHeights(lower: BgLimit | null | undefined): boolean {
  if (!lower) return false;
  if (lower.reference === "AGL") return lower.meters > BG_MAX_LOWER_AGL_M + 1e-6;
  return lower.meters > BG_MAX_LOWER_MSL_M + 1e-6;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** CAA-Höhen aus vertical_min_agl/vertical_max_agl (Meter AGL); Texte als Rückfall. */
export function bgCaaHeights(p: Record<string, any>): { lower: BgLimit; upper: BgLimit | null } {
  const text = String(p?.message ?? "");
  let lo = num(p?.vertical_min_agl);
  let hi = num(p?.vertical_max_agl);
  if (lo == null) {
    const m = text.match(/над (\d+)\s*м/i);
    lo = m ? Number(m[1]) : 0;
  }
  if (hi == null) {
    const m = text.match(/до височина (\d+) метра/i);
    hi = m ? Number(m[1]) : null;
  }
  if (lo < 0) lo = 0;
  const lower: BgLimit = { meters: lo, reference: "AGL", raw: `${lo} M AGL` };
  const upper: BgLimit | null = hi != null && hi > lo ? { meters: hi, reference: "AGL", raw: `${hi} M AGL` } : null;
  return { lower, upper };
}

// ---------------------------------------------------------------------------
// Einstufung
// ---------------------------------------------------------------------------

export interface BgRestrictionDecision {
  restriction: BgRestriction;
  /** Wert im Feed (restriction_code) bzw. aus dem Namen abgeleitet (BULATSA). */
  source: string;
  escalated: boolean;
}

/** CAA-Layer: restriction_code + Behördentext (strengere Angabe gewinnt). */
export function decideBgRestriction(p: Record<string, any>): BgRestrictionDecision {
  const code = clean(p?.restriction_code ?? p?.restriction).toUpperCase().replace(/[\s-]+/g, "_");
  let base: BgRestriction;
  if (code === "PROHIBITED" || code === "FORBIDDEN" || code === "NO_FLY") base = "PROHIBITED";
  else if (code === "CONDITIONAL" || code === "CONDITIONS") base = "CONDITIONAL";
  else base = "REQ_AUTHORISATION"; // REQ_AUTHORISATION, RESTRICTED, NO_RESTRICTION, leer, unbekannt
  const prohibits = bgTextProhibits(p?.message) || bgTextProhibits(p?.restriction_conditions);
  if (base !== "PROHIBITED" && prohibits) return { restriction: "PROHIBITED", source: code || "?", escalated: true };
  return { restriction: base, source: code || "?", escalated: false };
}

/** BULATSA-Layer: Einstufung aus der AIP-Kennung im Namen. */
export function bgBulatsaRestriction(name: string): BgRestriction {
  return /^LBP/i.test(clean(name)) ? "PROHIBITED" : "REQ_AUTHORISATION";
}

// ---------------------------------------------------------------------------
// Gültigkeit
// ---------------------------------------------------------------------------

function parseTs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

export interface BgValidity {
  start: number | null;
  end: number | null;
  /** Ins Zeitfenster übernommene Werte (validStartTs/validEndTs). */
  validStartTs?: number;
  validEndTs?: number;
  expired: boolean;
  longTermEnd: boolean;
}

export function bgValidity(p: Record<string, any>, now: Date = new Date()): BgValidity {
  const nowMs = now.getTime();
  const start = parseTs(p?.immediate_period_start);
  const end = parseTs(p?.immediate_period_end);
  const permanent = p?.is_permanent === true || String(p?.is_permanent ?? "").toLowerCase() === "true";
  const out: BgValidity = { start, end, expired: end != null && end < nowMs, longTermEnd: false };
  if (end != null && end - nowMs > LONG_TERM_MS && (start == null || start <= nowMs)) {
    out.longTermEnd = true;
    return out;
  }
  if (start != null && (start > nowMs || !permanent || end != null)) out.validStartTs = start;
  if (end != null) out.validEndTs = end;
  return out;
}

function fmtDateDe(ms: number): string {
  // Sofia-Zeit ist hier nicht nötig: UTC mit Kennzeichnung, eindeutig.
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

// ---------------------------------------------------------------------------
// Beschreibung (deutsch, strukturiert) + Originaltext
// ---------------------------------------------------------------------------

function phoneDe(phone: string): string {
  return phone.replace(/\s{2,}/g, " / ").replace(/\s+/g, " ").trim();
}

function sourceLine(): string {
  return sourceLineDe(BG_GEOZONE_SOURCE_LABEL, BG_GEOZONE_ATTRIBUTION);
}

function validityLines(v: BgValidity): string[] {
  const lines: string[] = [];
  if (v.longTermEnd && v.end != null) lines.push(`Gültig: dauerhaft (laut Quelle bis ${fmtDateDe(v.end)})`);
  else if (v.validStartTs != null || v.validEndTs != null) {
    const parts: string[] = [];
    if (v.validStartTs != null) parts.push(`ab ${fmtDateDe(v.validStartTs)}`);
    if (v.validEndTs != null) parts.push(`bis ${fmtDateDe(v.validEndTs)}`);
    lines.push(`Gültig: ${parts.join(" ")}`);
  }
  return lines;
}


export interface BgMessage {
  message: string;
  original: string;
  untranslated: string[];
}

/** Deutsche Beschreibung einer CAA-Zone + bulgarischer Originaltext. */
export function buildBgCaaMessage(
  p: Record<string, any>,
  decision: BgRestrictionDecision,
  heights: { lower: BgLimit; upper: BgLimit | null },
  validity: BgValidity,
): BgMessage {
  const lines: string[] = [];
  const originalName = clean(p.name);
  const zoneType = clean(p.zone_type);
  lines.push(`Typ: ${TYPE_DE[decision.restriction]}`);
  const cat = bgZoneCategory(originalName);
  if (cat) lines.push(`Kategorie: ${cat}`);
  if (zoneType) lines.push(`Zonenart: ${BG_ZONE_TYPE_DE[zoneType] ?? transliterateBulgarian(zoneType)}`);
  const purpose = clean(p.purpose).toUpperCase();
  const codeLabel = RESTRICTION_LABEL_DE[decision.source] ?? decision.source;
  lines.push(`Einstufung der Behörde: ${codeLabel}${purpose ? ` – Zweck: ${BG_PURPOSE_DE[purpose] ?? purpose}` : ""}`);
  if (decision.escalated) {
    lines.push(
      "Hinweis zur Einstufung: Der Behördentext verbietet UAS-Flüge in der Zone ausdrücklich – vorsichtshalber als Verbotszone dargestellt.",
    );
  } else if (!["PROHIBITED", "REQ_AUTHORISATION", "CONDITIONAL"].includes(decision.source)) {
    lines.push("Hinweis zur Einstufung: Kategorie der Behörde unbekannt – vorsichtshalber als genehmigungspflichtig eingestuft.");
  }
  lines.push(heightLineDe(formatBgLimitDe(heights.lower), heights.upper ? formatBgLimitDe(heights.upper) : "ohne Obergrenze"));
  lines.push(...validityLines(validity));
  if (p.is_uspace === true) lines.push("U-Space: ja (U-Space-Luftraum)");

  const msg = translateBgText(p.message);
  const cond = translateBgText(p.restriction_conditions);
  const infoRaw = String(p.information ?? "").trim();
  const idMatch = infoRaw.match(/^Identifier:\s*([^;]+);\s*Country:\s*(\S+)\s*$/i);
  const info = idMatch ? { de: [], untranslated: [] } : translateBgText(infoRaw);
  const untranslated = [...msg.untranslated, ...cond.untranslated, ...info.untranslated];

  if (msg.de.length > 0) lines.push(`Bestimmung: ${msg.de.join(" ")}`);
  if (cond.de.length > 0) lines.push(`Bedingung: ${cond.de.join(" ")}`);
  if (info.de.length > 0) lines.push(`Information: ${info.de.join(" ")}`);
  const hints: string[] = [];
  if (untranslated.length > 0) hints.push("Weitere Bestimmungen nur im Originaltext der Behörde (siehe unten).");
  pushHints(lines, hints);
  if (idMatch) lines.push(`Kennung der Behörde: ${idMatch[1].trim()}`);
  const applicant = clean(p.applicant);
  if (applicant) lines.push(`Antragsteller/Zoneninhaber: ${translateBgApplicant(applicant)}`);
  const contact = clean(p.contact_name);
  if (contact) lines.push(`Kontaktperson: ${translateBgContact(contact)}`);
  const phone = clean(p.contact_phone);
  if (phone) lines.push(`Telefon: ${phoneDe(phone)} (Bulgarien, +359)`);
  const email = clean(p.contact_email);
  if (email) lines.push(`E-Mail: ${email}`);
  lines.push(`UAS-Portal: ${BG_UAS_PORTAL_URL}`);
  lines.push(sourceLine());

  const nameTranslated = translateBgZoneName(originalName) !== originalName;
  const textual = [p.message, p.restriction_conditions, idMatch ? null : p.information].some((t) => clean(t));
  const needsOriginal =
    nameTranslated || textual || hasCyrillic(applicant) || hasCyrillic(contact) || hasCyrillic(zoneType);
  const original = needsOriginal
    ? originalBlock([
        originalName,
        zoneType,
        p.message,
        p.restriction_conditions,
        idMatch ? null : p.information,
        hasCyrillic(applicant) ? applicant : null,
        hasCyrillic(contact) ? contact : null,
      ])
    : "";
  return { message: messageWithOriginal(lines, original), original, untranslated };
}

/** Deutsche Beschreibung eines BULATSA-Luftraumgebiets + Originaltext. */
export function buildBgBulatsaMessage(
  p: Record<string, any>,
  restriction: BgRestriction,
  lower: BgLimit | null,
  upper: BgLimit | null,
  validity: BgValidity,
): BgMessage {
  const lines: string[] = [];
  const name = clean(p.name);
  const zoneType = clean(p.zone_type);
  lines.push(`Typ: ${TYPE_DE[restriction]}`);
  const cat = BULATSA_CATEGORY.find(([re]) => re.test(name))?.[1];
  if (cat) lines.push(`Kategorie: ${cat}`);
  lines.push(`Zonenart: ${BG_ZONE_TYPE_DE[zoneType] ?? (zoneType ? transliterateBulgarian(zoneType) : "Luftraumgebiet (BULATSA)")}`);
  lines.push(
    restriction === "PROHIBITED"
      ? "Hinweis zur Einstufung: Luftsperrgebiet laut AIP – als Verbotszone dargestellt."
      : "Hinweis zur Einstufung: Luftraumgebiet der Flugsicherung – Einflug nur mit Freigabe/Genehmigung; vorsichtshalber als genehmigungspflichtig eingestuft.",
  );
  const lo = lower ? formatBgLimitDe(lower) : clean(p.bflip_vertical_lower) || "Boden (GND)";
  const up = upper ? formatBgLimitDe(upper) : clean(p.bflip_vertical_upper) || "ohne Obergrenze";
  lines.push(heightLineDe(lo, up, "Quelle"));
  if (!clean(p.bflip_vertical_upper).match(/AMSL|AGL|FL|GND|SFC/i) && upper && upper.fl == null) {
    lines.push("Hinweis: Obergrenze ohne Bezugsangabe – als AMSL (über Meeresspiegel) gewertet.");
  }
  lines.push(...validityLines(validity));
  const status = clean(p.activation_status).toUpperCase();
  if (status) lines.push(`Status: ${status === "ACTIVE" ? "aktiv" : status === "INACTIVE" ? "inaktiv" : status}`);
  const ident = clean(p.identifier);
  if (ident) lines.push(`Kennung: ${ident}`);
  const remark = translateBgText(p.remark);
  if (remark.de.length > 0) lines.push(`Bemerkung: ${remark.de.join(" ")}`);
  if (remark.untranslated.length > 0) {
    if (hasCyrillic(remark.untranslated.join(" "))) lines.push("Hinweis: Bemerkung nur im Originaltext der Behörde (siehe unten).");
    else lines.push(`Bemerkung: ${remark.untranslated.join(" ")}`);
  }
  lines.push(sourceLine());
  const original = originalBlock([
    hasCyrillic(name) ? name : null,
    zoneType,
    remark.de.length > 0 || hasCyrillic(String(p.remark ?? "")) ? p.remark : null,
  ]);
  return { message: messageWithOriginal(lines, original), original, untranslated: remark.untranslated };
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

function applicability(v: BgValidity): any[] | undefined {
  if (v.validStartTs == null && v.validEndTs == null) return undefined;
  return [
    {
      permanent: "NO",
      ...(v.validStartTs != null ? { startDateTime: new Date(v.validStartTs).toISOString() } : {}),
      ...(v.validEndTs != null ? { endDateTime: new Date(v.validEndTs).toISOString() } : {}),
    },
  ];
}

function finish(props: Record<string, any>): Record<string, any> {
  for (const k of Object.keys(props)) if (props[k] === undefined || props[k] === null || props[k] === "") delete props[k];
  return props;
}

export interface BgNormalizeOptions {
  now?: Date;
  /** FID → WKT (volle Präzision, aus dem WFS-CSV). */
  preciseWkt?: Map<string, string> | null;
  /** Präfix der Kennung (Standard „BG“; für die optionalen Layer z. B. „BG-AS“). */
  idPrefix?: string;
}

type Normalized = { feature: BgFeature } | { drop: BgDropReason };

function isDeleted(p: Record<string, any>): boolean {
  return p?.is_deleted === true || String(p?.is_deleted ?? "").toLowerCase() === "true";
}

/** Eine Zone aus VGeoCAAZonesPublic (bzw. gleich aufgebauten Layern) normalisieren. */
export function normalizeBgCaaFeature(raw: any, opts: BgNormalizeOptions = {}): Normalized {
  const p: Record<string, any> = raw?.properties ?? {};
  if (isDeleted(p)) return { drop: "deleted" };
  const validity = bgValidity(p, opts.now);
  if (validity.expired) return { drop: "expired" };
  const geometry = bgPreciseGeometry(raw, opts.preciseWkt);
  if (!geometry) return { drop: "no_geometry" };
  const heights = bgCaaHeights(p);
  if (bgLowerAboveDroneHeights(heights.lower)) return { drop: "above_drone_heights" };

  const zoneId = p.zone_id ?? p.id ?? raw?.id;
  const identifier = `${opts.idPrefix ?? "BG"}-${zoneId ?? "?"}`;
  const originalName = clean(p.name);
  const name = translateBgZoneName(originalName) || `Geozone ${zoneId ?? ""}`.trim();
  const decision = decideBgRestriction(p);
  const { message, original, untranslated } = buildBgCaaMessage(p, decision, heights, validity);
  const email = clean(p.contact_email);

  const props = finish({
    identifier,
    name,
    restriction: decision.restriction,
    originalRestriction: decision.restriction !== decision.source ? decision.source : undefined,
    restrictionEscalated: decision.escalated || undefined,
    lowerMeters: heights.lower.meters,
    lowerReference: "AGL",
    upperMeters: heights.upper?.meters,
    upperReference: "AGL",
    message,
    extendedProperties: localizedExtendedProperties(message, original, "bg"),
    validStartTs: validity.validStartTs,
    validEndTs: validity.validEndTs,
    applicability: applicability(validity),
    country: "BGR",
    source: BG_GEOZONE_SOURCE_LABEL,
    attribution: BG_GEOZONE_ATTRIBUTION,
    nameOriginal: originalName !== name ? originalName : undefined,
    category: bgZoneCategory(originalName),
    bgLayer: "caa" as BgLayerKind,
    bgZoneId: zoneId,
    bgPurpose: clean(p.purpose) || undefined,
    bgApplicant: clean(p.applicant) || undefined,
    bgUntranslated: untranslated.length > 0 ? untranslated.length : undefined,
    contactEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    infoUrl: BG_UAS_PORTAL_URL,
    infoUrlLabel: "UAS-Portal ГД ГВА (uas.caa.bg)",
  });
  const out: BgFeature = { type: "Feature", id: identifier, geometry, properties: props };
  const bb = bgGeometryBbox(geometry);
  if (bb) out.bbox = bb;
  return { feature: out };
}

/** Ein Gebiet aus VGeoBULATSAZonesPublic normalisieren. */
export function normalizeBgBulatsaFeature(raw: any, opts: BgNormalizeOptions = {}): Normalized {
  const p: Record<string, any> = raw?.properties ?? {};
  if (isDeleted(p)) return { drop: "deleted" };
  const validity = bgValidity(p, opts.now);
  if (validity.expired) return { drop: "expired" };
  const geometry = bgPreciseGeometry(raw, opts.preciseWkt);
  if (!geometry) return { drop: "no_geometry" };
  const lower = parseBgLimit(p.bflip_vertical_lower) ?? { meters: 0, reference: "AGL" as const, raw: "GND" };
  const upper = parseBgLimit(p.bflip_vertical_upper);
  if (bgLowerAboveDroneHeights(lower)) return { drop: "above_drone_heights" };

  const zoneId = p.zone_id ?? p.id ?? raw?.id;
  const identifier = `BG-ATS-${zoneId ?? "?"}`;
  const originalName = clean(p.name);
  const name = translateBgZoneName(originalName) || `Luftraumgebiet ${zoneId ?? ""}`.trim();
  const restriction = bgBulatsaRestriction(originalName);
  const { message, original, untranslated } = buildBgBulatsaMessage(p, restriction, lower, upper, validity);
  const props = finish({
    identifier,
    name,
    restriction,
    lowerMeters: lower.meters,
    lowerReference: lower.reference,
    upperMeters: upper && upper.meters > lower.meters ? upper.meters : undefined,
    upperReference: upper?.reference ?? "MSL",
    message,
    extendedProperties: localizedExtendedProperties(message, original, "bg"),
    validStartTs: validity.validStartTs,
    validEndTs: validity.validEndTs,
    applicability: applicability(validity),
    country: "BGR",
    source: BG_GEOZONE_SOURCE_LABEL,
    attribution: `${BG_GEOZONE_ATTRIBUTION} / BULATSA`,
    nameOriginal: originalName !== name ? originalName : undefined,
    bgLayer: "bulatsa" as BgLayerKind,
    bgZoneId: zoneId,
    bgIdentifier: clean(p.identifier) || undefined,
    bgActivationStatus: clean(p.activation_status) || undefined,
    bgLowerRaw: clean(p.bflip_vertical_lower) || undefined,
    bgUpperRaw: clean(p.bflip_vertical_upper) || undefined,
    bgUntranslated: untranslated.length > 0 ? untranslated.length : undefined,
    infoUrl: BG_UAS_PORTAL_URL,
    infoUrlLabel: "UAS-Portal ГД ГВА (uas.caa.bg)",
  });
  const out: BgFeature = { type: "Feature", id: identifier, geometry, properties: props };
  const bb = bgGeometryBbox(geometry);
  if (bb) out.bbox = bb;
  return { feature: out };
}

function rawList(body: any): any[] {
  return Array.isArray(body) ? body : Array.isArray(body?.features) ? body.features : [];
}

function normalizeList(
  body: any,
  kind: BgLayerKind,
  opts: BgNormalizeOptions,
  seen: Set<string>,
  result: BgNormalizeResult,
): void {
  for (const raw of rawList(body)) {
    const label = clean(raw?.properties?.name) || String(raw?.id ?? "?");
    const r = kind === "caa" ? normalizeBgCaaFeature(raw, opts) : normalizeBgBulatsaFeature(raw, opts);
    if ("drop" in r) {
      result.dropped.push({ name: label, reason: r.drop });
      continue;
    }
    const key = String(r.feature.properties.identifier);
    if (seen.has(key)) {
      result.dropped.push({ name: label, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    result.features.push(r.feature);
  }
}

/** CAA-Hauptlayer (FeatureCollection oder Feature-Liste); Dedupe über zone_id. */
export function normalizeBulgarianZonesWithStats(body: any, opts: BgNormalizeOptions = {}): BgNormalizeResult {
  const result: BgNormalizeResult = { features: [], dropped: [] };
  normalizeList(body, "caa", opts, new Set(), result);
  return result;
}

export function normalizeBulgarianZones(body: any, opts: BgNormalizeOptions = {}): BgFeature[] {
  return normalizeBulgarianZonesWithStats(body, opts).features;
}

/** BULATSA-Layer; Dedupe über zone_id. */
export function normalizeBulgarianBulatsaZonesWithStats(body: any, opts: BgNormalizeOptions = {}): BgNormalizeResult {
  const result: BgNormalizeResult = { features: [], dropped: [] };
  normalizeList(body, "bulatsa", opts, new Set(), result);
  return result;
}

export function normalizeBulgarianBulatsaZones(body: any, opts: BgNormalizeOptions = {}): BgFeature[] {
  return normalizeBulgarianBulatsaZonesWithStats(body, opts).features;
}

/** Zusammenführen (Dedupe über identifier; CAA-Zonen zuerst). */
export function mergeBulgarianFeatures(...lists: BgFeature[][]): BgFeature[] {
  const seen = new Set<string>();
  const out: BgFeature[] = [];
  for (const list of lists) {
    for (const f of list) {
      const key = String(f.properties?.identifier ?? f.id ?? "");
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(f);
    }
  }
  return out;
}
