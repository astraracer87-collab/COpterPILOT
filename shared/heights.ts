// Ein gemeinsamer Höhenparser für Geozonen-Grenzen (Umbau B3).
//
// Liest Zahlen und Klartext aller Quellen (ED-269/ED-318, WFS, Länder-
// Normalisierer): Meter, Fuß, Flugflächen, GND/SFC, UNL sowie die Höhenbezüge
// AGL/SFC/GND/HEI/AGND/HGT/n.p.t. (über Grund) und AMSL/MSL/ALT/WGS84/n.p.m./STD
// (über Meeresspiegel). Ein fehlender oder unbekannter Bezug wird NICHT mehr
// stillschweigend zu AGL, sondern bleibt "UNKNOWN" – der Höhenfilter blendet
// solche Zonen nie aus (shared/geozoneAltitudeFilter.ts).
//
// Bezugs-Näherungen (dokumentiert, bewusst einfach):
// - WGS84 (ellipsoidische Höhe) wird als MSL geführt. Die Geoidundulation
//   beträgt in Europa etwa +35 … +55 m (ellipsoidische Höhe liegt HÖHER als
//   MSL). `datum: "WGS84"` bleibt erhalten, damit der Filter für Untergrenzen
//   eine Sicherheitsmarge ansetzen kann.
// - STD/FL ist Druckhöhe (Standardatmosphäre, 1013,25 hPa), keine geometrische
//   Höhe. Sie wird als MSL geführt; bei tiefem Luftdruck/Kälte liegt die wahre
//   Höhe deutlich darunter (≈ 8 m pro hPa). `datum: "STD"` erlaubt dem Filter
//   eine Marge. FL n = n × 100 ft.
//
// Bewusst frei von React-Native-Importen (Mobile, Web, Server, tsx-Tests).

/** 1 ft in Metern (ICAO Annex 5) – einzige Stelle für den Faktor in neuem Code. */
export const FT_M = 0.3048;

export type VRef = "AGL" | "MSL" | "UNKNOWN";

export interface Height {
  /**
   * Meter (ungerundet) im Bezug `ref`. null = keine Zahl: bei einer
   * Untergrenze GND, bei einer Obergrenze unbegrenzt (UNL) – siehe `text`.
   */
  m: number | null;
  ref: VRef;
  /** Kurzer Quelltext in normierter Schreibweise („1500 ft AMSL“, „FL95“, „GND“, „UNL“). */
  text: string;
  /** Einheit der Quelle (für die Anzeige „1500 ft AMSL (457 m)“). */
  unit?: "m" | "ft" | "FL";
  /** Zahlenwert in der Quelleinheit. */
  value?: number;
  /** Ursprünglicher Bezug, wenn er nur näherungsweise MSL ist (siehe Kopf). */
  datum?: "STD" | "WGS84";
}

const AGL_WORDS = new Set(["AGL", "SFC", "GND", "HEI", "AGND", "HGT", "ASFC", "NPT"]);
const MSL_WORDS = new Set(["AMSL", "MSL", "ALT", "NPM", "QNH"]);
const WGS84_WORDS = new Set(["WGS84", "WGS-84", "W84", "WGS 84"]);

/** Höhenbezug normieren. Leer/unbekannt → "UNKNOWN" (nie still AGL). */
export function normalizeVRef(raw: unknown): { ref: VRef; datum?: "STD" | "WGS84" } {
  const r = canonRef(raw);
  if (!r) return { ref: "UNKNOWN" };
  if (AGL_WORDS.has(r)) return { ref: "AGL" };
  if (MSL_WORDS.has(r)) return { ref: "MSL" };
  if (WGS84_WORDS.has(r)) return { ref: "MSL", datum: "WGS84" };
  if (r === "STD" || r === "FL") return { ref: "MSL", datum: "STD" };
  return { ref: "UNKNOWN" };
}

function canonRef(raw: unknown): string {
  if (raw == null) return "";
  const s = String(raw).toUpperCase().replace(/ /g, " ").trim();
  // Polnisch „n.p.t.“ (nad poziomem terenu) / „n.p.m.“ (nad poziomem morza)
  const pl = s.match(/^N\.?\s*P\.?\s*([TM])\.?$/);
  if (pl) return pl[1] === "T" ? "NPT" : "NPM";
  return s;
}

/** Text (Großschreibung) normieren: NBSP, Mehrfach-Leerzeichen, polnische Bezüge. */
function canonText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/ /g, " ")
    .replace(/\bN\.?\s*P\.?\s*T\b\.?/g, "NPT")
    .replace(/\bN\.?\s*P\.?\s*M\b\.?/g, "NPM")
    .replace(/WGS[\s-]?84/g, "WGS84")
    .replace(/\s+/g, " ")
    .trim();
}

function unitOf(raw: unknown): "m" | "ft" | "FL" | undefined {
  const u = String(raw ?? "").toUpperCase().replace(/\./g, "").trim();
  if (!u) return undefined;
  if (u === "FT" || u === "F" || u === "FEET" || u === "FOOT") return "ft";
  if (u === "FL") return "FL";
  if (u === "M" || /^MET/.test(u) || u === "METROW") return "m";
  return undefined;
}

function fmtNum(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function refWord(ref: VRef, datum?: "STD" | "WGS84"): string {
  if (datum === "WGS84") return "WGS84";
  if (ref === "AGL") return "AGL";
  if (ref === "MSL") return "AMSL";
  return "";
}

function flHeight(fl: number): Height {
  return { m: fl * 100 * FT_M, ref: "MSL", text: `FL${fmtNum(fl)}`, unit: "FL", value: fl, datum: "STD" };
}

const GND_HEIGHT = (): Height => ({ m: 0, ref: "AGL", text: "GND" });
const UNL_HEIGHT = (): Height => ({ m: null, ref: "UNKNOWN", text: "UNL" });

const NUM_RE =
  /^(-?\d+(?:[.,]\d+)?) ?(FT|F|FEET|M|METERS?|METRES?|FL)?\.? ?(AGL|AMSL|MSL|SFC|GND|WGS84|W84|STD|ALT|HEI|AGND|HGT|ASFC|NPT|NPM|QNH)?$/;

/**
 * Einen Höhenwert lesen. `value` darf Zahl oder Text sein („1500 FT AMSL“,
 * „FL95“, „120 m AGL“, „300 m n.p.m.“, „GND“, „UNL“). `uom` (M/FT/FL) und
 * `ref` (AGL/AMSL/…) gelten, wenn der Text selbst keine Einheit bzw. keinen
 * Bezug nennt. Zahl ohne Einheit = Meter; Zahl ohne Einheit mit Bezug STD =
 * Flugfläche. 0 ohne Bezug = GND. null bei leer/unlesbar.
 */
export function parseHeight(value: unknown, uom?: unknown, ref?: unknown): Height | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return fromNumber(value, unitOf(uom), ref);
  }
  if (typeof value === "object") {
    // { value, unit, reference } (BE skeyes) bzw. { altitude, uom, reference }
    const o = value as Record<string, unknown>;
    const v = o.value ?? o.altitude ?? o.height;
    if (v == null) return null;
    return parseHeight(v, o.unit ?? o.uom ?? uom, o.reference ?? o.ref ?? ref);
  }
  const s = canonText(String(value));
  if (!s) return null;
  if (/^(0 ?)?(GND|SFC|AGND)$/.test(s)) return GND_HEIGHT();
  if (/^(UNL|UNLTD|UNLIM|UNLIMITED|GND_UNL)$/.test(s)) return UNL_HEIGHT();
  const fl = s.match(/^FL ?(\d{1,3})(?: ?STD)?$/);
  if (fl) return flHeight(Number(fl[1]));
  const m = s.match(NUM_RE);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return fromNumber(n, unitOf(m[2]) ?? unitOf(uom), m[3] ?? ref);
}

function fromNumber(n: number, unit: "m" | "ft" | "FL" | undefined, refRaw: unknown): Height {
  const { ref, datum } = normalizeVRef(refRaw);
  // 0 über Grund/ohne Bezug = GND, auch bei Layer-Einheit FL (CZ: „0 AGL“ neben „FL95“).
  if (n === 0 && ref !== "MSL") return GND_HEIGHT();
  if (unit === "FL" || (unit == null && datum === "STD")) return flHeight(n);
  const u = unit ?? "m";
  const word = refWord(ref, datum);
  return {
    m: u === "ft" ? n * FT_M : n,
    ref,
    text: `${fmtNum(n)} ${u}${word ? ` ${word}` : ""}`,
    unit: u,
    value: n,
    ...(datum ? { datum } : {}),
  };
}

/**
 * Bereich „GND – 2500 ft AMSL“, „0-150m n.p.t.“, „SFC/FL95“ → Unter-/Obergrenze.
 * Einheit/Bezug, die nur am Ende stehen („0-120 m AGL“), gelten für beide
 * Werte. Ohne Trenner wird der Text als Obergrenze gelesen (Untergrenze null).
 */
export function parseHeightRange(
  raw: unknown,
  uom?: unknown,
  ref?: unknown,
): { lower: Height | null; upper: Height | null } {
  if (raw == null) return { lower: null, upper: null };
  const s = canonText(String(raw));
  if (!s) return { lower: null, upper: null };
  // Trenner: Gedankenstrich/Halbgeviert, Schrägstrich oder „-“ zwischen Werten
  // (nicht das Minuszeichen einer Zahl am Anfang).
  const m = s.match(/^(.+?) ?(?:–|—|\/|-(?=\s|\d|[A-Z])| TO | BIS ) ?(.+)$/);
  if (!m || /^-?\d+(?:[.,]\d+)?$/.test(s)) return { lower: null, upper: parseHeight(s, uom, ref) };
  const lowerText = m[1].trim();
  const upperText = m[2].trim();
  const upper = parseHeight(upperText, uom, ref);
  const tail = upperText.match(NUM_RE);
  const tailUnit = tail?.[2] ?? uom;
  const tailRef = tail?.[3] ?? ref;
  const lower = parseHeight(lowerText, tailUnit, tailRef);
  if (!lower && !upper) return { lower: null, upper: parseHeight(s, uom, ref) };
  return { lower, upper };
}

/**
 * Height aus bereits umgerechneten Metern (Normalisierer-Properties
 * lowerMeters/upperMeters + Rohbezug). Fehlende Meter: Untergrenze → GND,
 * Obergrenze → UNL.
 */
export function heightFromMeters(
  meters: number | null | undefined,
  ref: unknown,
  side: "lower" | "upper",
): Height {
  if (meters == null || !Number.isFinite(meters)) {
    return side === "lower" ? { m: null, ref: "AGL", text: "GND" } : UNL_HEIGHT();
  }
  return fromNumber(meters, "m", ref);
}

/**
 * Anzeige-Text der Quelle übernehmen (Einheit ft/FL), wenn er zu den
 * entscheidenden Metern/Bezug passt (±1 m). Meter und Bezug aus `h` bleiben
 * maßgeblich; die Quelle ergänzt Einheit, Zahl und Datum.
 */
export function withSourceText(h: Height, src: Height | null | undefined): Height {
  if (!src) return h;
  const sameM =
    (h.m == null && src.m == null) ||
    (h.m != null && src.m != null && Math.abs(h.m - src.m) < 1) ||
    (h.m === 0 && src.m == null && src.text === "GND") ||
    (h.m == null && h.text === "GND" && src.m === 0);
  if (!sameM) return h;
  const refOk = src.ref === h.ref || h.ref === "UNKNOWN" || (h.m === 0 && src.m === 0);
  if (!refOk) return h;
  const ref = h.ref === "UNKNOWN" ? src.ref : h.ref;
  const datum = h.datum ?? src.datum;
  return { ...src, m: h.m ?? src.m, ref, ...(datum ? { datum } : {}) };
}

/** Ist die Höhe GND (Untergrenze am Boden)? */
export function isGround(h: Height | null | undefined): boolean {
  return !!h && (h.m === 0 || (h.m == null && h.text === "GND"));
}

/**
 * Deutsche Anzeige: „1500 ft AMSL (457 m)“, „120 m AGL“, „FL95“, „GND“,
 * „unbegrenzt“, „500 m AMSL (WGS84)“, „50 m (Bezug unbekannt)“.
 */
export function formatHeightDe(h: Height | null | undefined): string {
  if (!h) return "–";
  if (h.m == null) return h.text === "GND" ? "GND" : "unbegrenzt";
  if (h.m === 0 && h.ref !== "MSL") return "GND";
  if (h.unit === "FL" && h.value != null) return `FL${fmtNum(h.value)}`;
  const word = h.ref === "AGL" ? " AGL" : h.ref === "MSL" ? " AMSL" : "";
  const unknown = h.ref === "UNKNOWN";
  const wgs = h.datum === "WGS84" ? "WGS84" : "";
  const std = h.datum === "STD" ? "STD" : "";
  if (h.unit === "ft" && h.value != null) {
    const extras = [`${Math.round(h.m)} m`, wgs || std, unknown ? "Bezug unbekannt" : ""].filter(Boolean);
    return `${fmtNum(h.value)} ft${word} (${extras.join(", ")})`;
  }
  const extras = [wgs || std, unknown ? "Bezug unbekannt" : ""].filter(Boolean);
  return `${Math.round(h.m)} m${word}${extras.length ? ` (${extras.join(", ")})` : ""}`;
}

/** „GND – 1500 ft AMSL (457 m)“; fehlende Untergrenze = GND, fehlende Obergrenze = unbegrenzt. */
export function formatHeightRangeDe(lower: Height | null | undefined, upper: Height | null | undefined): string {
  const lo = lower ? formatHeightDe(lower) : "GND";
  const up = upper ? formatHeightDe(upper) : "unbegrenzt";
  return `${lo} – ${up}`;
}

/**
 * Obergrenzen ab `thresholdM` gelten als unbegrenzt (ED-269: ≥ FL600,
 * ED-318/CZ: ≥ 15 000 m, z. B. FL660).
 */
export function capUnlimited(h: Height | null, thresholdM: number): Height | null {
  if (!h || h.m == null || h.m < thresholdM) return h;
  return { ...h, m: null, text: "UNL" };
}
