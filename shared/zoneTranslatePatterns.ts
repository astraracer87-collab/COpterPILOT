// Musterbasierte Übersetzung formelhafter Behördentexte (NOTAMs, Aktivierungen,
// Kontaktzeilen, Feldnamen der Quellen, Gattungswörter in Zonennamen).
//
// Jede Regel ist eine Vorlage mit Platzhaltern, z. B.
//   "UNMANNED ACFT WILL TAKE PLACE IN {place} AREA"  →  "Betrieb unbemannter Luftfahrzeuge im Gebiet {place}"
// Platzhalter: {name} (beliebiger Text, unverändert), {name:typ} mit Typ
//   id     Kennung (EER26174UA, LED90A, A1234/26 …)
//   num    Zahl
//   hgt    Höhe („00120M AGL“, „300FT AGL“, „FL95“, „GND“, „SFC“, „UNL“) → deutsch formatiert
//   dist   Radius/Abstand („2NM“, „1.5 KM“, „500M“)
//   time   Uhrzeit(en) „0600-1400“, „0600“
//   date   Datum („16 NOV 2026“, „2026-11-15“, „15.11.2026“)
//   coord  Koordinate(n) („583745N 0250022E - …“)
//   q      Name in Anführungszeichen
//   contact Telefon/E-Mail/URL
//   tr     Teiltext, der selbst übersetzt wird (Wörterbuch/Muster) – sonst greift die Regel nicht
//   rest   Rest der Zeile (unverändert)
// Die Regeln sind geordnet (spezifische zuerst) und werden beim Laden einmal
// zu RegExp kompiliert. Rein, ohne React-Native-Importe.

export type Lookup = (s: string) => string | null;

type Kind = "text" | "id" | "num" | "hgt" | "dist" | "time" | "date" | "coord" | "q" | "contact" | "tr" | "rest";

const COORD1 = String.raw`\d{4,7}(?:[.,]\d+)?\s?[NS]\s?,?\s?\d{5,8}(?:[.,]\d+)?\s?[EW]`;
const TYPE_RE: Record<Kind, string> = {
  text: String.raw`.+?`,
  id: String.raw`[A-Z0-9][A-Z0-9./_\-]*`,
  num: String.raw`\d+(?:[.,]\d+)?`,
  hgt: String.raw`(?:\d{1,6}(?:[.,]\d+)?\s?(?:FT|M|FEET|METERS?|MTRS?)\.?(?:\s?(?:AGL|AMSL|MSL|SFC|GND|ALT|STD))?|FL\s?\d{2,3}|GND|SFC|UNL(?:TD)?|\d{1,6}\s?(?:AGL|AMSL|MSL))`,
  dist: String.raw`\d+(?:[.,]\d+)?\s?(?:NM|KM|M|MTR|METERS?)`,
  time: String.raw`(?:\d{4}\s?[-–]\s?\d{4}|\d{4}|\d{1,2}:\d{2}\s?[-–]\s?\d{1,2}:\d{2}|\d{1,2}:\d{2})`,
  date: String.raw`(?:\d{1,2}\s?[A-Z]{3}\s?\d{2,4}|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?|\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}/\d{1,2}/\d{2,4})`,
  coord: String.raw`\(?${COORD1}\)?(?:\s*[-–,]\s*\(?${COORD1}\)?)*`,
  q: String.raw`['"„“‘’][^'"„“”‘’]+['"“”‘’]`,
  contact: String.raw`(?:[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?://\S+|www\.\S+|\+?\(?\d[\d\s()./-]{5,}\d)(?:(?:\s*(?:,|;|/|or|and|og|eller|ou|o|lub|ali|arba|vai)\s*)(?:[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?://\S+|www\.\S+|\+?\(?\d[\d\s()./-]{5,}\d))*`,
  tr: String.raw`.+?`,
  rest: String.raw`.*`,
};

/** Höhenangabe deutsch formatieren („00120M AGL“ → „120 m AGL“, „FL95“ → „FL 95“). */
export function formatHeightDe(s: string): string {
  const t = s.trim().toUpperCase().replace(/\.$/, "");
  if (/^(GND|SFC)$/.test(t)) return "Boden (GND)";
  if (/^UNL(TD)?$/.test(t)) return "unbegrenzt (UNL)";
  const fl = t.match(/^FL\s?(\d{2,3})$/);
  if (fl) return `FL ${Number(fl[1])}`;
  const m = t.match(/^(\d{1,6}(?:[.,]\d+)?)\s?(FT|M|FEET|METERS?|MTRS?)?\.?\s?(AGL|AMSL|MSL|SFC|GND|ALT|STD)?$/);
  if (!m) return s.trim();
  const n = m[1].replace(/^0+(?=\d)/, "");
  const unit = !m[2] ? "" : /^(FT|FEET)$/.test(m[2]) ? " ft" : " m";
  const ref = m[3] === "ALT" ? " MSL" : m[3] ? ` ${m[3] === "SFC" || m[3] === "GND" ? "über Grund" : m[3]}` : "";
  return `${n}${unit}${ref}`;
}

function formatDistDe(s: string): string {
  const m = s.trim().toUpperCase().match(/^(\d+(?:[.,]\d+)?)\s?(NM|KM|M|MTR|METERS?)$/);
  if (!m) return s.trim();
  const unit = m[2] === "NM" ? "NM" : m[2] === "KM" ? "km" : "m";
  return `${m[1].replace(".", ",")} ${unit}`;
}

function formatTimeDe(s: string): string {
  const m = s.trim().match(/^(\d{2})(\d{2})\s?[-–]\s?(\d{2})(\d{2})$/);
  if (m) return `${m[1]}:${m[2]}–${m[3]}:${m[4]}`;
  const one = s.trim().match(/^(\d{2})(\d{2})$/);
  if (one) return `${one[1]}:${one[2]}`;
  return s.trim();
}

interface Compiled {
  id: string;
  re: RegExp;
  slots: { name: string; kind: Kind }[];
  de: string;
}

const PH = /\{(\w+)(?::(\w+))?\}/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Vorlage → RegExp (Leerraum flexibel, Groß-/Kleinschreibung egal, Satzzeichen am Ende optional). */
function compile(id: string, src: string, de: string, opts: { cs?: boolean; prefix?: boolean } = {}): Compiled {
  const slots: { name: string; kind: Kind }[] = [];
  let re = "";
  let last = 0;
  let m: RegExpExecArray | null;
  PH.lastIndex = 0;
  const lit = (s: string) => escapeRe(s).replace(/\s+/g, "\\s*").replace(/\\s\*$/, "\\s*").replace(/^\\s\*/, "\\s*");
  while ((m = PH.exec(src))) {
    re += lit(src.slice(last, m.index));
    const kind = (m[2] as Kind) || "text";
    slots.push({ name: m[1], kind });
    re += `(${TYPE_RE[kind]})`;
    last = m.index + m[0].length;
  }
  re += lit(src.slice(last));
  // Literal-Leerzeichen mindestens als Wortgrenze: „\s*“ zwischen zwei Wortzeichen → „\s+“
  re = re.replace(/(\w)\\s\*(\w)/g, "$1\\s+$2");
  const tail = opts.prefix ? "" : String.raw`\s*[.!;:,]*\s*$`;
  return { id, re: new RegExp(`^\\s*${re}${tail}`, opts.cs ? "u" : "iu"), slots, de };
}

function fill(c: Compiled, m: RegExpExecArray, lookup: Lookup): string | null {
  let out = c.de;
  for (let i = 0; i < c.slots.length; i++) {
    const { name, kind } = c.slots[i];
    const raw = (m[i + 1] ?? "").trim();
    let v: string | null = raw;
    if (kind === "hgt") v = formatHeightDe(raw);
    else if (kind === "dist") v = formatDistDe(raw);
    else if (kind === "time") v = formatTimeDe(raw);
    else if (kind === "tr") {
      v = raw ? lookup(raw) : "";
      if (v == null) return null;
      v = v.replace(/[.]$/, "");
    }
    out = out.split(`{${name}}`).join(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feldnamen (Etiketten) der App und der Quellen
// ---------------------------------------------------------------------------

/** Deutsche Etiketten der App/Normalisierer (Wert wird ggf. übersetzt). */
const GERMAN_LABEL_RE = new RegExp(
  "^(?:" +
    [
      "Typ", "Höhenbezug", "Code", "Kontakt\\w*", "Pufferradius", "ICAO", "Kategorie", "Rechtsgrundlage", "Höhe\\b.*", "Gültig\\w*", "Zuständig\\w*.*",
      "Gebietsnummer", "Quelle\\w*", "Quell-NOTAM", "Telefon", "E-Mail", "Website", "Webseite", "Aktiv\\w*", "Hinweis\\w*.*", "Bedingung\\w*.*", "Ausnahme\\w*",
      "Bemerkung\\w*", "Grund", "Zone", "Zonen\\w+", "Name", "Kennung.*", "Rufzeichen", "Funk.*", "Obergrenze", "Untergrenze", "Vertikale Grenze.*",
      "Geländehöhe.*", "Reservierte Höhe.*", "Reservierung\\w*.*", "Zeitplan.*", "Zeiten", "Zeitraum", "Beschreibung", "Beschränkung.*", "Koordination", "Position.*",
      "Antragsteller.*", "Antrag\\w*", "Aktivität\\w*", "Luftraumklasse", "Luftraum\\w*", "Nutzung", "Status.*", "Ebene", "ENAIRE-Ebene", "NOTAM.*", "Einstufung.*",
      "Zonenart", "Bestimmung", "UAS-Portal", "Erkennungssysteme", "Zugangsbedingung\\w*", "Genehmigung\\w*.*", "Vorab-Mitteilung", "Information(?:en)?",
      "Ordner", "Regel", "Verkehr.*", "Auflagen", "Zonentyp", "PANSA-Zonentyp", "Teil von", "Betreiber", "Behörde.*", "Kreis.*", "Radius", "Fläche",
      "Rechtsquelle", "Gesetz.*", "Kontaktperson", "Zonenverwalter", "Telefonnummer", "Gefahrengebiet.*", "Bedingungen/Antrag", "Luftsportgebiet",
      "Merkmal\\w*", "Zweck", "Anmerkung\\w*", "Gilt.*", "Vorlauf", "Max\\.? Flughöhe.*", "Flughöhe.*", "Mindestabstand", "Sperrzeit\\w*",
    ].join("|") +
    ")$",
);

export function isGermanLabel(label: string): boolean {
  return GERMAN_LABEL_RE.test(label.trim());
}

/** Etiketten, deren Wert ein Name/eine Kennung/ein Kontakt ist (nie übersetzt). */
const PROPER_LABEL_RE =
  /^(Name|Kennung.*|Zuständig\w*.*|Rufzeichen|Kontakt\w*|Zonenverwalter|Antragsteller.*|Koordination|Position.*|Funk.*|Obergrenze|Untergrenze|Höhe.*|Vertikale Grenze.*|Geländehöhe.*|Reservierte Höhe.*|Zeitplan.*|Zeiten|Zeitraum|Gültig\w*|Quelle\w*|Quell-NOTAM|NOTAM[- ]?ID|Telefon\w*|E-Mail|Website|Webseite|UAS-Portal|Antragsformular|Bedingungen\/Antrag|Information(?:en)?|Betreiber|Code|ICAO|Gebietsnummer|Ordner|Rechtsgrundlage|Rechtsquelle|Gesetz.*|Teil von|Luftraumklasse|Radius|Beschreibung)$/;

export function isProperNameLabel(label: string): boolean {
  return PROPER_LABEL_RE.test(label.trim());
}

/** Fremde Feldnamen der Quellen → deutsches Etikett (Schlüssel klein, ohne Satzzeichen). */
const FIELD_LABELS: Record<string, string> = {};
function fieldKey(label: string): string {
  return label.trim().toLowerCase().replace(/[\s_]+/g, " ").replace(/[.:]+$/, "");
}
export function addFieldLabels(map: Record<string, string>): void {
  for (const [k, v] of Object.entries(map)) FIELD_LABELS[fieldKey(k)] = v;
}

export function translateFieldLabel(label: string): string | null {
  return FIELD_LABELS[fieldKey(label)] ?? null;
}

// ---------------------------------------------------------------------------
// Satzregeln
// ---------------------------------------------------------------------------

const LINE_RULES: Compiled[] = [];
const NAME_RULES: Compiled[] = [];

/** Regeln registrieren: [quelle, deutsch] (ID = Sprache + laufende Nummer). */
function rules(lang: string, list: [string, string][], target: Compiled[] = LINE_RULES, opts: { cs?: boolean } = {}): void {
  list.forEach(([src, de], i) => target.push(compile(`${lang}${i + 1}`, src, de, opts)));
}

export function translateLineByPattern(line: string, lookup: Lookup): string | null {
  for (const c of LINE_RULES) {
    const m = c.re.exec(line);
    if (!m) continue;
    const out = fill(c, m, lookup);
    if (out != null) return out;
  }
  return null;
}

/** Name: Wörterbuch für Teile (lookupName), bekannte Eigennamen (isKnown). */
export function translateNameByPattern(
  name: string,
  lookupName: Lookup,
  isKnown: (s: string) => boolean,
): { text: string } | null {
  for (const c of NAME_RULES) {
    const m = c.re.exec(name);
    if (!m) continue;
    const out = fill(c, m, (s) => lookupName(s) ?? (isKnown(s) ? s : null));
    if (out != null) return { text: out };
  }
  return null;
}

/** Anzahl der Regeln (Zeilen, Namen, Feldnamen) – für Tests/Bericht. */
export function patternStats(): { lines: number; names: number; fields: number } {
  return { lines: LINE_RULES.length, names: NAME_RULES.length, fields: Object.keys(FIELD_LABELS).length };
}

/** Nur für Tests: welche Regel greift? */
export function matchingRuleId(line: string, lookup: Lookup = () => null): string | null {
  for (const c of LINE_RULES) {
    const m = c.re.exec(line);
    if (m && fill(c, m, lookup) != null) return c.id;
  }
  return null;
}

export { rules as __rules, NAME_RULES as __NAME_RULES };
