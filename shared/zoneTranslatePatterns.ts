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

type Kind = "text" | "id" | "num" | "hgt" | "dist" | "time" | "date" | "coord" | "q" | "contact" | "tr" | "rest" | "sched" | "name" | "svc" | "mail" | "bgid";

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
  sched: String.raw`.+?`,
  name: String.raw`.+?`,
  mail: String.raw`[\w.+-]+@[\w-]+(?:[.,][\w-]+)+(?:\s*(?:[;/,]|and)?\s*[\w.+-]+@[\w-]+(?:\.[\w-]+)+)*`,
  bgid: String.raw`\d{7}`,
  svc: String.raw`[A-Z][\w/ ]*?(?:Information|Radar|APP|Approach|Zone|Range|Military|Mil|ATC|Control|Tower|TWR|Ops)`,
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
  /** Pflichtwort (klein) für eine schnelle Vorprüfung per includes() */
  must: string | null;
  slots: { name: string; kind: Kind }[];
  de: string;
}

const PH = /\{(\w+)(?::(\w+))?\}/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Literalteil einer Vorlage → RegExp-Quelltext. Zeichen werden maskiert, außer
 * den bewusst erlaubten Regex-Bausteinen: „(?:…|…)“, „[…]“, „?“ und
 * Backslash-Escapes („\\(“). Leerraum ist flexibel.
 */
function literalRe(s: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      out += ch + s[++i];
    } else if (s.startsWith("(?:", i)) {
      out += "(?:";
      depth++;
      i += 2;
    } else if (ch === ")" && depth > 0) {
      out += ")";
      depth--;
    } else if (ch === "|" && depth > 0) {
      out += "|";
    } else if (ch === "[") {
      const end = s.indexOf("]", i + 1);
      if (end < 0) throw new Error(`Vorlage: „[“ ohne „]“ in ${s}`);
      out += s.slice(i, end + 1);
      i = end;
    } else if (ch === "?") {
      out += "?";
    } else if (/\s/.test(ch)) {
      while (i + 1 < s.length && /\s/.test(s[i + 1])) i++;
      out += "\\s*";
    } else {
      out += escapeRe(ch);
    }
  }
  if (depth !== 0) throw new Error(`Vorlage: Klammer nicht geschlossen in ${s}`);
  return out;
}

/** Vorlage → RegExp (Leerraum flexibel, Groß-/Kleinschreibung egal, Satzzeichen am Ende optional). */
function compile(id: string, src: string, de: string, opts: { cs?: boolean; prefix?: boolean } = {}): Compiled {
  const slots: { name: string; kind: Kind }[] = [];
  let re = "";
  let last = 0;
  let m: RegExpExecArray | null;
  PH.lastIndex = 0;
  while ((m = PH.exec(src))) {
    re += literalRe(src.slice(last, m.index));
    const kind = (m[2] as Kind) || "text";
    if (!(kind in TYPE_RE)) throw new Error(`Vorlage ${id}: unbekannter Platzhaltertyp ${kind}`);
    slots.push({ name: m[1], kind });
    re += `(${TYPE_RE[kind]})`;
    last = m.index + m[0].length;
  }
  re += literalRe(src.slice(last));
  const must = mandatoryWord(src);
  // Leerraum zwischen zwei Wortzeichen ist Pflicht
  re = re.replace(/([\wÀ-ž])\\s\*(?=[\wÀ-ž])/g, "$1\\s+");
  const tail = opts.prefix ? "" : String.raw`\s*[.!;:,]*\s*$`;
  return { id, re: new RegExp(`^\\s*${re}${tail}`, opts.cs ? "u" : "iu"), slots, de, must };
}

/** Längstes Wort (≥ 4 Buchstaben), das in jedem Treffer vorkommen muss. */
function mandatoryWord(src: string): string | null {
  // Platzhalter, optionale Teile, Gruppen und Klassen entfernen
  let t = src.replace(PH, " ");
  t = t.replace(/\\./g, " ");
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t.replace(/\(\?:[^()]*\)\??/g, " ");
  }
  t = t.replace(/\[[^\]]*\]/g, " ").replace(/\S\?/g, " ");
  let best: string | null = null;
  for (const w of t.split(/[^A-Za-zÀ-žΑ-ωА-я]+/)) if (w.length >= 4 && (!best || w.length > best.length)) best = w;
  return best ? best.toLowerCase() : null;
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
    } else if (kind === "sched") {
      v = translateScheduleDe(raw);
      if (v == null) return null;
    } else if (kind === "name") {
      v = transliterateCyrillic(raw);
    }
    out = out.split(`{${name}}`).join(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zeitpläne, Wochentage, Monate (NOTAM-Abkürzungen)
// ---------------------------------------------------------------------------

const SCHED_WORDS: Record<string, string> = {
  DAILY: "täglich", MON: "Mo", TUE: "Di", WED: "Mi", THU: "Do", FRI: "Fr", SAT: "Sa", SUN: "So",
  JAN: "Jan.", FEB: "Feb.", MAR: "März", APR: "Apr.", MAY: "Mai", JUN: "Juni", JUL: "Juli", AUG: "Aug.",
  SEP: "Sep.", OCT: "Okt.", NOV: "Nov.", DEC: "Dez.", SR: "SR", SS: "SS", H24: "H24", HJ: "HJ", HN: "HN",
  EXC: "außer", AND: "und", TO: "bis", UTC: "UTC", EVERY: "jeden", WEEKDAYS: "werktags", "WEEKENDS": "an Wochenenden",
  "PH": "Feiertage", "HOL": "Feiertage", "LT": "Ortszeit",
};

/** Zeitplan „DAILY 0700-1359, MON-FRI 0800-1600“ → deutsch; null bei unbekannten Wörtern. */
export function translateScheduleDe(s: string): string | null {
  let bad = false;
  const out = s.replace(/[A-Za-z][A-Za-z0-9]*/g, (w) => {
    const de = SCHED_WORDS[w.toUpperCase()];
    if (de == null) {
      bad = true;
      return w;
    }
    return de;
  });
  return bad ? null : out.replace(/(\d{2})(\d{2})-(\d{2})(\d{2})/g, "$1:$2–$3:$4");
}

// ---------------------------------------------------------------------------
// Kyrillisch (Bulgarisch) → lateinisch (amtliche bulgarische Umschrift)
// ---------------------------------------------------------------------------

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
};

/** Bulgarische Namen lesbar machen („Пловдив“ → „Plovdiv“); andere Schriften bleiben. */
export function transliterateCyrillic(s: string): string {
  if (!/[А-яЁё]/.test(s)) return s;
  return s.replace(/[А-яЁё]/g, (ch) => {
    const lower = ch.toLowerCase();
    const t = CYR[lower] ?? ch;
    if (ch === lower) return t;
    return t.charAt(0).toUpperCase() + t.slice(1);
  });
}

// ---------------------------------------------------------------------------
// NOTAM-Englisch (Großbuchstaben): Glossar mit Namensplätzen
// ---------------------------------------------------------------------------
// Formelhafte NOTAM-Texte („TEMPO DANGER AREA 'X' ESTABLISHED DUE UNMANNED
// ACFT. PSN … RADIUS 2NM. MAX HGT 400FT AGL“) werden Phrase für Phrase
// übersetzt. Namen stehen nur an festen Stellen (in Anführungszeichen, nach
// „IN … AREA“, nach Gebietskennungen …). Bleibt danach ein englisches Wort
// übrig, gilt der Text als nicht übersetzt (kein halbes Deutsch).

const T0 = "\u0001"; // übersetzt: Anfang
const T1 = "\u0002"; // übersetzt: Ende
const N0 = "\u0003"; // Name: Anfang
const N1 = "\u0004"; // Name: Ende

type Gloss = { re: RegExp; de: string };
const GLOSS: Gloss[] = [];

/** de: deutscher Text; {1},{2} … = Namen aus den Klammergruppen (unverändert). */
function gloss(list: [string, string][]): void {
  for (const [src, de] of list) GLOSS.push({ re: new RegExp(src, "g"), de });
}

function applyGloss(text: string): string {
  let s = text;
  for (const g of GLOSS) {
    s = s.replace(g.re, (...m: any[]) => {
      const groups = m.slice(1, -2);
      return g.de
        .split(/(\{\d\})/)
        .map((part) => {
          const gm = part.match(/^\{(\d)\}$/);
          if (gm) {
            const v = groups[Number(gm[1]) - 1];
            return v ? `${N0}${v}${N1}` : "";
          }
          return part ? `${T0}${part}${T1}` : "";
        })
        .join("");
    });
  }
  return s;
}

/** Abkürzungen/Codes, die im deutschen NOTAM-Text stehen bleiben. */
const NOTAM_KEEP = new Set(
  (
    "AGL AMSL MSL SFC GND UNL FL FT NM KM M MHZ KHZ UTC LT H24 HJ HN SR SS BLOS VLOS BVLOS EVLOS UAS UAV RPAS ATC ATS TWR APP ACC FIS AFIS " +
    "FIR CTR CTA TMA ATZ TIZ TIA MATZ MCTR RMZ TMZ TSA TRA AMC AUP UUP NOTAM AIP SUP AIC ENR AD HEMS SAR IFR VFR VMC IMC QNH QFE " +
    "ICAO EASA LAF KOP PSS VAT ANS UTM SVC CAA DFS NATS RAF MOD HMNB NSA HMS USAF DME VOR NDB ILS RWY THR TEL TFC AVBL FM"
  ).split(" "),
);

export function translateNotamGloss(text: string): string | null {
  if (/[a-zà-ÿ]/.test(text) || !/[A-Z]{3}/.test(text)) return null;
  const g = applyGloss(text);
  if (!g.includes(T0)) return null;
  // Rest prüfen: alles außerhalb übersetzter Teile und Namen
  const rest = g
    .replace(new RegExp(`${T0}[^${T1}]*${T1}|${N0}[^${N1}]*${N1}`, "g"), " ")
    .replace(new RegExp(TYPE_RE.coord, "g"), " ")
    .replace(new RegExp(TYPE_RE.contact, "g"), " ");
  for (const w of rest.match(/[A-ZÀ-ÝÆØÅ][A-ZÀ-ÝÆØÅ]+/g) ?? []) {
    if (NOTAM_KEEP.has(w)) continue;
    if (/^[A-Z]{1,4}\d/.test(w)) continue;
    return null;
  }
  const out = g
    .replace(new RegExp(`[${T0}${T1}${N0}${N1}]`, "g"), "")
    .replace(/\s+([,.:;)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
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
  return label
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .replace(/[.:]+$/, "")
    .trim()
    .replace(/(?<=[a-z])\d+$/, "");
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
  const low = line.toLowerCase();
  for (const c of LINE_RULES) {
    if (c.must && !low.includes(c.must)) continue;
    const m = c.re.exec(line);
    if (!m) continue;
    const out = fill(c, m, lookup);
    if (out != null) return out;
  }
  return translateNotamGloss(line);
}

/** Name: Wörterbuch für Teile (lookupName), bekannte Eigennamen (isKnown). */
export function translateNameByPattern(
  name: string,
  lookupName: Lookup,
  isKnown: (s: string) => boolean = () => false,
): { text: string } | null {
  const low = name.toLowerCase();
  for (const c of NAME_RULES) {
    if (c.must && !low.includes(c.must)) continue;
    const m = c.re.exec(name);
    if (!m) continue;
    const out = fill(c, m, (s) => lookupName(s) ?? (isKnown(s) ? s : null));
    if (out != null) return { text: out };
  }
  // Bulgarische Eigennamen: lesbar umschreiben
  if (/[А-яЁё]/.test(name)) return { text: transliterateCyrillic(name) };
  return null;
}

// Luftraum-Kennungen und Gebietsarten am Namensanfang/-ende: der Rest ist ein
// Eigenname („EGR1U025A HALTON“, „END130 Eina B“, „ATZ VARAZDIN“, „POPOV (TRA)“).
const DESIGNATOR_START =
  /^(?:[A-Z]{2,5}\s?[A-Z]?\s?\d+[A-Z0-9]*|EL-UAS-[\w-]+|(?:ATZ|CTR|TMA|TIZ|TIA|URG|ULG|UTR|TRA|TSA|RMZ|TMZ|MCTR|MATZ|CTA|FIZ|NOTAM|LZ|EP|EK|EN|ES|EF|EY|EV|EE|LH|LK|LJ|LD|LB|LR|LO|LS|LI|LE|LP|EG|EI|EB|EH)\b)/;
const DESIGNATOR_END = /(?:\s|-)(?:CTR|TMA|ATZ|TIZ|TIA|URG|ULG|UTR|RMZ|TMZ|AWY|\((?:TRA|TSA|D|R|P|TRA\/TSA)\))$/;
// Gattungswörter in Großschrift, die übersetzt gehören (sonst gilt Großschrift als Eigenname)
const GENERIC_UPPER =
  /\b(ZONA|ZONE|AREA|CAMPO|TIRO|CENTRAL|NUCLEAR|URBANA|EJERCICIO|EXHIBICI[OÓ]N|A[EÉ]REA|PROTECCI[OÓ]N|FERROVIARIA|CONTROL|AIRPORT|AIRFIELD|HOSPITAL|PRISON|EMBASSY|BARRACKS|RESERVE|PARK|PORT|HARBOUR|LUCHTHAVEN|GEVANGENIS|ZIEKENHUIS|FLUGPLATZ|AEROPUERTO|AEROPORTO|HELIPORT|POWER|STATION|RANGE|EXERCISE|PRISION|PRISIÓN|CÁRCEL|CARCEL|ESTRECHO|PELIGROSA|RESTRINGIDA|PROHIBIDA)\b/;

/** Name ist eine Bezeichnung aus Kennung + Eigenname (keine Übersetzung nötig). */
export function isProperDesignation(name: string): boolean {
  const n = name.trim();
  if (GENERIC_UPPER.test(n)) return false;
  if (DESIGNATOR_START.test(n) || DESIGNATOR_END.test(n)) return true;
  // reine Großschrift (Ortsname, Firmenname) ohne Gattungswörter
  return !/[a-zà-ÿā-ž]/.test(n) && n.split(/\s+/).length <= 6;
}

/** Anzahl der Regeln (Zeilen, Namen, Feldnamen) – für Tests/Bericht. */
export function patternStats(): { lines: number; names: number; fields: number } {
  return { lines: LINE_RULES.length, names: NAME_RULES.length, fields: Object.keys(FIELD_LABELS).length };
}

/** Nur für Tests: welche Regel greift? */
export function matchingRuleId(line: string, lookup: Lookup = () => null): string | null {
  const low = line.toLowerCase();
  for (const c of LINE_RULES) {
    if (c.must && !low.includes(c.must)) continue;
    const m = c.re.exec(line);
    if (m && fill(c, m, lookup) != null) return c.id;
  }
  return null;
}

// ===========================================================================
// Regelwerk
// ===========================================================================

// --- Feldnamen der Quellen (Originalblöcke SI/SK/CY/GB/LT/NO …) -------------
addFieldLabels({
  // Englisch
  "Site elevation": "Geländehöhe am Standort",
  "Upper limit": "Obergrenze",
  "Lower limit": "Untergrenze",
  "Upper": "Obergrenze",
  "Lower": "Untergrenze",
  "Vertical Limit": "Vertikale Grenze",
  "Vertical Limits": "Vertikale Grenzen",
  "Contact": "Kontakt",
  "Contacts": "Kontakt",
  "Contact online": "Kontakt online",
  "Email": "E-Mail",
  "E-mail": "E-Mail",
  "Phone": "Telefon",
  "Tel": "Telefon",
  "Service": "Funk/Dienst",
  "Activity": "Aktivität",
  "Activation": "Aktivierung",
  "SUA Authority": "Zuständige Stelle (SUA)",
  "SUAAIS": "Funk/Dienst (SUAAIS)",
  "SUACS": "Funk/Dienst (SUACS)",
  "SI": "Rechtsgrundlage (SI)",
  "NSF": "NSF (Non-Standard Flight)",
  "Note": "Bemerkung",
  "Notes": "Bemerkungen",
  "Remark": "Bemerkung",
  "Remarks": "Bemerkungen",
  "Reason": "Grund",
  "Subject": "Bezeichnung",
  "Zone": "Zone",
  "Name": "Name",
  "Exception": "Ausnahme",
  "Exceptions": "Ausnahmen",
  "Exempt": "Ausnahme",
  "Except closed": "Ausnahmen (geschlossen)",
  "Exceptions outs": "Ausnahmen (außerhalb der Betriebszeit)",
  "Exceptions oper": "Ausnahmen (Betrieb)",
  "Exceptions specific": "Ausnahmen (spezielle Kategorie)",
  "Exceptionsopen": "Ausnahmen (offene Kategorie)",
  "Exceptions open specific": "Ausnahmen (offene/spezielle Kategorie)",
  "Exceptions open specific cat": "Ausnahmen (offene/spezielle Kategorie)",
  "Regulation": "Rechtsgrundlage",
  "Regul": "Rechtsgrundlage",
  "Restriction": "Beschränkung",
  "Restrict": "Beschränkung",
  "Restric": "Beschränkung",
  "UAS restriction": "UAS-Beschränkung",
  "UAS restrictions": "UAS-Beschränkung",
  "UAS restriction1": "UAS-Beschränkung",
  "UAS restri": "UAS-Beschränkung",
  "Contact approval": "Genehmigung bei",
  "Check NOTAM": "NOTAM prüfen",
  "Further information": "Weitere Informationen",
  "Geographical zone owner‘s contacts": "Kontakt des Zoneninhabers",
  "Geographical zone owner's contacts": "Kontakt des Zoneninhabers",
  "For inquiries, contact the zone owner": "Anfragen an den Zoneninhaber",
  "Status": "Status",
  "Type": "Typ",
  "Min": "Untergrenze",
  "Max": "Obergrenze",
  "Aerial sporting area": "Luftsportgebiet",
  "Permanently active · Note": "Ständig aktiv · Bemerkung",
  "Operaciones en zona urbana": "Betrieb in städtischem Gebiet",
  "Centro de Operaciones del aeropuerto (CEOPS TFN)": "Betriebszentrale des Flughafens (CEOPS TFN)",
  // Norwegisch
  "Merknad": "Bemerkung",
  "Stadig aktivt · Merknad": "Ständig aktiv · Bemerkung",
  "Luftsportsområde": "Luftsportgebiet",
  // Slowenisch
  "Ime": "Name",
  "Ime znamen": "Name",
  "Naziv": "Bezeichnung",
  "Obmocje": "Gebiet",
  "Letalisce": "Flugplatz",
  "Kontakt": "Kontakt",
  "Kontakt Co": "Kontakt",
  "Omejitev": "Beschränkung",
  "Omejitve": "Beschränkungen",
  "UAS omejit": "UAS-Beschränkung",
  "UAS omejitve": "UAS-Beschränkung",
  "Razlog": "Grund",
  "Izjema": "Ausnahme",
  "Izjeme": "Ausnahmen",
  "Izjeme deluje": "Ausnahmen (in Betrieb)",
  "Izjeme obratuje": "Ausnahmen (in Betrieb)",
  "Izjeme ne obr": "Ausnahmen (außer Betrieb)",
  "Izjeme zaprto": "Ausnahmen (geschlossen)",
  "Izjeme za": "Ausnahmen",
  "Izjeme posebna": "Ausnahmen (spezielle Kategorie)",
  "Izjeme odprta posebna": "Ausnahmen (offene/spezielle Kategorie)",
  "Izjeme odprta posebna kat": "Ausnahmen (offene/spezielle Kategorie)",
  "Zakonodaja": "Rechtsgrundlage",
  "Zakon": "Rechtsgrundlage",
  "Informacije": "Informationen",
  "Obrazec": "Antragsformular",
  "glej NOTAM": "NOTAM prüfen",
  "Visina": "Höhe",
  // Slowakisch (zweisprachige Etiketten)
  "Označenie / Identification": "Kennung",
  "Obmedzenie / Restriction": "Beschränkung",
  "Doba platnosti / Validity period": "Gültigkeit",
  "Výška / Height": "Höhe",
  "NAME TXT": "Name",
  "IDENT TXT": "Kennung",
  "airspace": "Luftraum",
  "airspace type": "Luftraumart",
  "label": "Bezeichnung",
  "label2": "Bezeichnung",
  "base": "Untergrenze",
  "top": "Obergrenze",
  "top ": "Obergrenze",
  "ACTIVITY CODE": "Aktivität",
  "TYPE CODE": "Typ",
  "MIL CODE": "Nutzung",
  "startdate": "Beginn",
  "enddate": "Ende",
  "lastupdate": "Letzte Aktualisierung",
  "activity": "Aktivität",
  // Griechisch (Zypern)
  "Ηλεκτρονική Διεύθυνση": "E-Mail",
  "'Eντυπο Αίτησης": "Antragsformular",
  "Έντυπο Αίτησης": "Antragsformular",
  "Όροι Πρόσβασης": "Zugangsbedingungen",
  "Τηλέφωνο": "Telefon",
});

// --- NOTAM-Englisch: Glossar (längere Wendungen zuerst) --------------------
const NM = String.raw`([A-Z0-9ÆØÅÄÖÜ][A-Z0-9ÆØÅÄÖÜ'\-/ ]*?)`; // Name (lazy)
const AREA_ID = String.raw`([A-Z]{1,4}\s?[RDP]?\s?\d+[A-Z]{0,2}(?:\s+\(?[A-Z0-9'\-]+\)?){0,3}?|'[^']+'|[A-Z0-9]+ '[^']+'|TSA \d+[A-Z]?|TRA [A-Z0-9 ]+?)`;
gloss([
  [String.raw`\[SCHEDULE:`, "[Zeitplan:"],
  [String.raw`'([^']+)'`, "'{1}'"],
  // Gebiete mit Kennung/Namen
  [String.raw`\b(?:TEMPO|TEMPORARY) RESTRICTED AREA ${AREA_ID}(?= (?:ACTIVATED|ESTABLISHED|FOR)\b)`, "temporäres Beschränkungsgebiet {1}"],
  [String.raw`\b(?:TEMPO|TEMPORARY) DANGER AREA ${AREA_ID}(?= (?:ACTIVATED|ESTABLISHED|FOR)\b)`, "temporäres Gefahrengebiet {1}"],
  [String.raw`\b(?:TEMPO|TEMPORARY) RESERVED AREA ${AREA_ID}(?= (?:ACTIVATED|ESTABLISHED)\b)`, "temporär reserviertes Gebiet {1}"],
  [String.raw`\bRESTRICTED AREA ${AREA_ID}(?= (?:ACTIVATED|ESTABLISHED)\b)`, "Beschränkungsgebiet {1}"],
  [String.raw`\bDANGER AREA ${AREA_ID}(?= (?:ACTIVATED|ESTABLISHED)\b)`, "Gefahrengebiet {1}"],
  [String.raw`\bPROHIBITED AREA ${AREA_ID}(?= (?:ACTIVATED|ESTABLISHED)\b)`, "Sperrgebiet {1}"],
  [String.raw`^(LED\d+[A-Z]?|TSA \d+[A-Z]?|[A-Z]{2}[RDP]\d+[A-Z]?) ACTIVATED`, "{1} aktiviert"],
  [String.raw`\b(?:TEMPO|TEMPORARY) RESTRICTED AREA\b`, "temporäres Beschränkungsgebiet"],
  [String.raw`\b(?:TEMPO|TEMPORARY) DANGER AREA\b`, "temporäres Gefahrengebiet"],
  [String.raw`\b(?:TEMPO|TEMPORARY) RESERVED AREA\b`, "temporär reserviertes Gebiet"],
  [String.raw`\b(?:TEMPO|TEMPORARY) SEGREGATED AREA\b`, "temporär abgetrenntes Gebiet"],
  [String.raw`\bRESTRICTED AREA\b`, "Beschränkungsgebiet"],
  [String.raw`\bDANGER AREA\b`, "Gefahrengebiet"],
  [String.raw`\bPROHIBITED AREA\b`, "Sperrgebiet"],
  // Wer fliegt
  [String.raw`\bMIL UNMANNED ACFT (\([A-Z/]+\) )?WILL TAKE PLACE FOR MIL ACTIVITY\b`, "militärischer Flugbetrieb unbemannter Luftfahrzeuge {1}"],
  [String.raw`\bMIL UNMANNED ACFT (\([A-Z/]+\) )?WILL TAKE PLACE\b`, "militärischer Flugbetrieb unbemannter Luftfahrzeuge {1}"],
  [String.raw`\bUNMANNED ACFT (\([A-Z/]+\) )?WILL TAKE PLACE FOR MIL ACTIVITY\b`, "militärischer Flugbetrieb unbemannter Luftfahrzeuge {1}"],
  [String.raw`\bUNMANNED POLICE ACFT (\([A-Z/]+\) )?WILL TAKE PLACE\b`, "Flugbetrieb unbemannter Polizei-Luftfahrzeuge {1}"],
  [String.raw`\bUNMANNED (?:ACFT|AIRCRAFT) (\([A-Z/]+\) )?(?:ACT )?WILL TAKE PLACE\b`, "Flugbetrieb unbemannter Luftfahrzeuge {1}"],
  [String.raw`\bUNMANNED ACFT ACT\b`, "Flugbetrieb unbemannter Luftfahrzeuge"],
  [String.raw`\bDRONES? (?:FLT ACT|FLIGHTS|OPERATIONS|FLYING) WILL TAKE PLACE\b`, "Drohnenflüge finden statt"],
  [String.raw`\bUAS (?:FLYING|FLIGHTS|OPERATIONS|ACTIVITY|ACT) WILL TAKE PLACE\b`, "UAS-Flüge finden statt"],
  [String.raw`\bDRONE CARGO FLIGHTS\b`, "Drohnen-Frachtflüge"],
  [String.raw`\bDRONES WILL OPERATE AT A MAX HEIGHT OF\b`, "Drohnen fliegen bis zu einer max. Höhe von"],
  [String.raw`\bDRONE OPERATOR CONTACT TEL:?`, "Kontakt Drohnenbetreiber, Tel.:"],
  [String.raw`\bDRONE WILL BE LANDED IN CASE OF HEMS ACTIVITY\b`, "Die Drohne wird bei Einsätzen von Rettungshubschraubern (HEMS) gelandet"],
  [String.raw`\bWILL TAKE PLACE\b`, "findet statt"],
  [String.raw`(?<=[\u0002\u0004])\s+([A-Z][A-Z0-9ÆØÅÄÖÜ'\- ]*?)(?=,?\s+PSN\b)`, " – {1}"],
  [String.raw`\b(?:AT|IN) PSN:?`, "an Position"],
  [String.raw`\b(?:AT|IN) ${NM}(?=,?\s+PSN\b)`, "bei {1}"],
  [String.raw`\bON ([A-Z][A-Z .'\-]*)$`, "am {1}"],
  [String.raw`\bREAL TIME ACTIVATION BY ${NM}(?=\s*$)`, "Echtzeitaktivierung durch {1}"],
  [String.raw`\bVIA ([A-Z]{4} (?:TWR|APP|TWR/APP|ACC))\b`, "über {1}"],
  [String.raw`\bOR ([A-Z]+ (?:ACC|APP|TWR|RADAR|CONTROL))\b`, "oder {1}"],
  [String.raw`\bFOR UNMANNED AIRCRAFT SYSTEM ACTIVITIES\b`, "für den Betrieb unbemannter Luftfahrzeugsysteme"],
  [String.raw`\bFOR IFR, VFR AND UNMANNED ACFT FLT\b`, "für IFR-, VFR- und unbemannte Flüge"],
  [String.raw`\b(?:FOR|DUE) UNMANNED ACFT \(([A-Z/]+)\) ACT\b`, "für Flugbetrieb unbemannter Luftfahrzeuge ({1})"],
  [String.raw`\bFOR UNMANNED ACFT\b`, "für unbemannte Luftfahrzeuge"],
  [String.raw`\bDUE (?:TO )?UNMANNED ACFT\b`, "wegen unbemannter Luftfahrzeuge"],
  [String.raw`\bDUE SATELLITE LASER RANGING\b`, "wegen Satelliten-Laserentfernungsmessung"],
  [String.raw`\bFOR POWER LINE GOODS TRANSPORTATION\b`, "für Lastentransport an Stromleitungen"],
  [String.raw`\bFOR MIL ACTIVITY\b`, "für militärische Aktivität"],
  [String.raw`\bALL NON-PARTICIPATING\b`, "alle nicht beteiligten"],
  // Wo
  [String.raw`\b(?:IN|AT) THE ${NM} AREA\b`, "im Gebiet {1}"],
  [String.raw`\b(?:IN|AT) ${NM} AREA\b`, "im Gebiet {1}"],
  [String.raw`\b(EAST|WEST|NORTH|SOUTH) OF ([A-Z]{1,4}\d+[A-Z]?)\b`, "{1}|{2}"],
  [String.raw`\bWI(?:THIN)? (\d+(?:[.,]\d+)?\s?(?:NM|KM|M)) RADIUS (?:CENTRED|CENTERED)(?: ON)?\b`, "im Umkreis von {1} um"],
  [String.raw`\bWI(?:THIN)? RADIUS OF (\d+(?:[.,]\d+)?\s?(?:NM|KM|M)) (?:CENTRED|CENTERED)(?: ON)?\b`, "im Umkreis von {1} um"],
  [String.raw`\bWITHIN THE LATERAL LIMITS:?`, "innerhalb der seitlichen Grenzen:"],
  [String.raw`\bWITHIN:`, "innerhalb:"],
  [String.raw`\bWITHIN\b`, "innerhalb"],
  [String.raw`\bPSN:?`, "Position"],
  [String.raw`\bRADIUS\b`, "Radius"],
  [String.raw`\bMAX HGT\b`, "max. Höhe"],
  [String.raw`\bUP TO\b`, "bis"],
  [String.raw`\((\d{6}N 0\d{6}E)\)`, "({1})"],
  // Was / Status
  [String.raw`\bESTABLISHED\b`, "eingerichtet"],
  [String.raw`\bACTIVATED\b`, "aktiviert"],
  [String.raw`\bVERTICAL LIMITS CHANGED DURING ACTIVATION\b`, "vertikale Grenzen während der Aktivierung geändert"],
  [String.raw`\bPERMISSION FOR ENTERING THE AREA SHALL BE OBTAINED FROM\b`, "Genehmigung für den Einflug ist einzuholen bei"],
  [String.raw`\bINFO ABOUT ACTIVATION AVAILABLE FROM\b`, "Informationen zur Aktivierung unter"],
  [String.raw`\bREAL TIME ACTIVATION (\d+) MIN VIA\b`, "Echtzeitaktivierung mit {1} Min. Vorlauf über"],
  [String.raw`\bREAL TIME ACTIVATION BY\b`, "Echtzeitaktivierung durch"],
  [String.raw`\bREAL[ -]TIME ACTIVATION\b`, "Echtzeitaktivierung"],
  [String.raw`\bFOR REAL TIME STATUS\b`, "Echtzeitstatus:"],
  [String.raw`\b(?:OPR|OPERATOR) WILL MONITOR FREQ:?`, "Betreiber hört Frequenz"],
  [String.raw`\bOPS CTC:?`, "Kontakt Einsatzleitung:"],
  [String.raw`\bCTC OPR\b`, "Kontakt Betreiber"],
  [String.raw`\bCTC TEL\b`, "Kontakt Tel."],
  [String.raw`\bCTC ([A-Z][A-Z0-9 ]*?) TEL\b`, "Kontakt {1}, Tel."],
  [String.raw`\bCTC ([A-Z][A-Z0-9]*)\b`, "Kontakt {1}"],
  [String.raw`\bCTC\b`, "Kontakt"],
  [String.raw`\bTEL\b`, "Tel."],
  [String.raw`\bUAS FLIGHTS PROHIBITED\b`, "UAS-Flüge verboten"],
  [String.raw`\bUAS ACTIVITY PROHIBITED\b`, "UAS-Betrieb verboten"],
  [String.raw`\bUAS FLT NOT AFFECTED BY OTHER RESTRICTIONS\b`, "UAS-Flüge von anderen Beschränkungen nicht betroffen"],
  [String.raw`\bUAS FLT NOT AFFECTED BY\b`, "UAS-Flüge nicht betroffen von"],
  [String.raw`\bOTHER RESTRICTIONS\b`, "anderen Beschränkungen"],
  [String.raw`\bUAV FLT RESTRICTED\b`, "UAV-Flüge eingeschränkt"],
  [String.raw`\bUAS OPERATIONS IN SUPPORT OF\b`, "UAS-Betrieb zur Unterstützung von"],
  [String.raw`\bMILITARY EXERCISES?\b`, "Militärübung"],
  [String.raw`\bFIRING EXERCISES?\b`, "Schießübung"],
  [String.raw`\bFRNG AND BLASTING\b`, "Schießen und Sprengungen"],
  [String.raw`\bFRNG\b`, "Schießen"],
  [String.raw`\bBLASTING\b`, "Sprengungen"],
  [String.raw`\bAT ${NM}(?=[.,]|$)`, "bei {1}"],
  [String.raw`\bIN ${NM}(?=[.,]|$)`, "in {1}"],
  [String.raw`\bAND\b`, "und"],
  [String.raw`\bOR\b`, "oder"],
  [String.raw`\bVIA\b`, "über"],
  [String.raw`\bMIN\b`, "Min."],
  [String.raw`\bDAILY\b`, "täglich"],
  [String.raw`\bACTIVATION\b`, "Aktivierung"],
  [String.raw`\bAUTHORIZED\b`, "genehmigt"],
  [String.raw`\bAVBL[_ ]FOR[_ ]ACTIVATION\b`, "für Aktivierung verfügbar"],
  [String.raw`\bACTIVE\b`, "aktiv"],
  [String.raw`\bOTHER\b`, "Sonstiges"],
  [String.raw`\(([A-Z][A-Z0-9 ,\-]*)\)`, "({1})"],
]);

// --- Satzregeln: NOTAM-Struktur ----------------------------------------------
rules("notam", [
  ["Q) {x:rest}", "Q) {x}"],
  ["({id:id} NOTAM{k:id}", "({id} NOTAM{k}"],
  ["{id:id} NOTAM{k:id}", "{id} NOTAM{k}"],
  ["D) DAILY {t:time}", "D) täglich {t} UTC"],
  ["D) DAILY SR-SS", "D) täglich von Sonnenaufgang bis Sonnenuntergang"],
  ["D) {s:sched}", "D) {s}"],
  ["E) {x:tr}", "E) {x}"],
  ["FUENTE INF){x:rest}", "Quelle: {x}"],
  ["{a:coord}-UKRAINIAN BORDER-{b:coord}", "{a} – ukrainische Grenze – {b}"],
  ["\\[Schedule: {s:sched}\\]", "[Zeitplan: {s}]"],
  ["\\[Schedule: {s:sched}", "[Zeitplan: {s}"],
  ["NOTAM ID: {x:rest}", "NOTAM-ID: {x}"],
  ["AIRAC {d:date}", "AIRAC {d}"],
  ["Restriction: N/A, Type: {t:id}, Min: {a:hgt}, Max: {b:hgt}", "Beschränkung: keine Angabe, Typ: {t}, Untergrenze: {a}, Obergrenze: {b}"],
]);

// --- Norwegisch / Dänisch (dronesoner.no, dronezoner.dk) --------------------
rules("no", [
  ["Aktiv iflg. NOTAM {a} (lokal tid)", "Aktiv laut NOTAM {a} (Ortszeit)"],
  ["Aktivert via NOTAM", "Aktiviert per NOTAM"],
  ["Activated via NOTAM", "Aktiviert per NOTAM"],
  ["MIL-aktivitet / MIL activity", "Militärische Aktivität"],
  ["MIL-aktivitet", "Militärische Aktivität"],
  ["MIL activity", "Militärische Aktivität"],
  ["MIL-aktivitet Real time activation, {n:num} MIN notice. / MIL activity Real time activation, {m:num} MIN notice", "Militärische Aktivität, Echtzeitaktivierung mit {n} Min. Vorlauf"],
  ["MIL activity Real time activation, {n:num} MIN notice", "Militärische Aktivität, Echtzeitaktivierung mit {n} Min. Vorlauf"],
  ["MIL-aktivitet. AMC manageable område. / MIL activity. AMC manageable area", "Militärische Aktivität. AMC-verwaltetes Gebiet."],
  ["Real time activation, {n:num} MIN notice", "Echtzeitaktivierung mit {n} Min. Vorlauf"],
  ["Real time activation, {n:num} MIN notice. Written approval from CAA Norway is required before activation", "Echtzeitaktivierung mit {n} Min. Vorlauf. Vor der Aktivierung ist eine schriftliche Genehmigung der norwegischen Luftfahrtbehörde (CAA Norway) erforderlich."],
  ["Real-time activation. Status AVBL FM {u}. Non-participating TFC will be given priority", "Echtzeitaktivierung. Status erhältlich bei {u}. Nicht beteiligter Verkehr erhält Vorrang."],
  ["Sanntidsaktivering. Status AVBL FM {u}. Ikke-deltakende TFC vil gis prioritet. / Real-time activation. Status AVBL FM {v}. Non-participating TFC will be given priority", "Echtzeitaktivierung. Status erhältlich bei {u}. Nicht beteiligter Verkehr erhält Vorrang."],
  ["Sanntidsaktivering. Status AVBL FM {u}. Ikke-deltakende TFC vil gis prioritet", "Echtzeitaktivierung. Status erhältlich bei {u}. Nicht beteiligter Verkehr erhält Vorrang."],
  ["Status AVBL FM {u}", "Status erhältlich bei {u}"],
  ["Real-time activated danger area. The area must be considered active unless you have obtained information from air traffic services that it is not active. It is activated at short notice (typically {n:num} min) and will likely not appear on NOTAM", "Echtzeit-aktiviertes Gefahrengebiet. Das Gebiet ist als aktiv zu betrachten, solange die Flugverkehrsdienste nicht mitgeteilt haben, dass es inaktiv ist. Es wird kurzfristig aktiviert (typisch {n} Min.) und erscheint wahrscheinlich nicht als NOTAM."],
  ["Sanntidsaktivert fareområde. Området skal anses som aktivt med mindre du har innhentet informasjon fra lufttrafikktjenesten om at det ikke er aktivt. Aktiveres på kort varsel (typisk {n:num} min) og kommer sannsynligvis ikke på NOTAM", "Echtzeit-aktiviertes Gefahrengebiet. Das Gebiet ist als aktiv zu betrachten, solange die Flugverkehrsdienste nicht mitgeteilt haben, dass es inaktiv ist. Es wird kurzfristig aktiviert (typisch {n} Min.) und erscheint wahrscheinlich nicht als NOTAM."],
  ["Kan aktiveres via NOTAM (opp til {h}). Sjekk alltid gjeldende NOTAM på ippc.no før flyging. Når aktivt er all flyging forbudt, inkludert droner/modellfly, med mindre særskilt tillatelse er gitt av Forsvaret eller Luftfartstilsynet. {rest:tr}", "Kann per NOTAM aktiviert werden (bis {h}). Vor dem Flug immer die geltenden NOTAMs auf ippc.no prüfen. Bei Aktivierung ist jeder Flugbetrieb verboten, auch Drohnen/Modellflugzeuge, sofern keine Sondergenehmigung der Streitkräfte (Forsvaret) oder der Luftfahrtbehörde (Luftfartstilsynet) vorliegt. {rest}"],
  ["Området kan aktiveres via NOTAM. Sjekk alltid gjeldende NOTAM på ippc.no før flyging. Tillatelse kreves når aktivt", "Das Gebiet kann per NOTAM aktiviert werden. Vor dem Flug immer die geltenden NOTAMs auf ippc.no prüfen. Bei Aktivierung ist eine Genehmigung erforderlich."],
  ["Permanent restriksjonsområde som kan aktiveres. Sjekk NOTAM på IPPC.no", "Dauerhaftes Beschränkungsgebiet, das aktiviert werden kann. NOTAMs auf IPPC.no prüfen."],
  ["Restriksjonsområdet aktiveres én gang årlig i inntil tre sammenhengende døgn i forbindelse med {e}. Sjekk NOTAM på IPPC.no", "Das Beschränkungsgebiet wird einmal jährlich für bis zu drei zusammenhängende Tage anlässlich {e} aktiviert. NOTAMs auf IPPC.no prüfen."],
  ["Aerial sporting area: radius {r:num} NM around the airfield, from ground level up to {h:hgt}. Parachuting and other aerial sports ({c}). · · Activity mainly takes place in daylight and VMC", "Luftsportgebiet: Radius {r} NM um den Flugplatz, vom Boden bis {h}. Fallschirmspringen und anderer Luftsport ({c}). · · Betrieb überwiegend bei Tageslicht und Sichtwetterbedingungen (VMC)."],
  ["Luftsportsområde: radius {r:num} NM rundt flyplassen, fra bakken opp til {h:hgt}. Fallskjermhopping og annen luftsport ({c}). · · Aktiviteten foregår i hovedsak i dagslys og under VMC", "Luftsportgebiet: Radius {r} NM um den Flugplatz, vom Boden bis {h}. Fallschirmspringen und anderer Luftsport ({c}). · · Betrieb überwiegend bei Tageslicht und Sichtwetterbedingungen (VMC)."],
  ["{a:num} meter til {b:num} meter / {c:hgt} til {d:hgt}", "{a} m bis {b} m / {c} bis {d}"],
  ["Note: {x:tr}", "Bemerkung: {x}"],
]);

// --- Englisch (GB AIP/AIXM, LT, MT, IT, IS …) --------------------------------
rules("gb", [
  ["Vertical Limit {h:hgt}", "Vertikale Grenze: {h}"],
  ["Vertical Limit {h:hgt} H24", "Vertikale Grenze: {h}, durchgehend (H24)"],
  ["Vertical Limit {h:hgt} {s:sched}", "Vertikale Grenze: {h} ({s})"],
  ["Vertical Limit: {h:hgt}", "Vertikale Grenze: {h}"],
  ["Vertical Limit {h:hgt}. Vertical Limit OCNL notified to altitudes up to {u:hgt} by NOTAM", "Vertikale Grenze: {h}. Gelegentlich per NOTAM bis {u} erweitert."],
  ["Vertical Limit {h:hgt} {s:sched}. Vertical Limit OCNL notified to altitudes up to {u:hgt} by NOTAM", "Vertikale Grenze: {h} ({s}). Gelegentlich per NOTAM bis {u} erweitert."],
  ["Vertical Limit:? OCNL notified to altitudes up to {u:hgt} by NOTAM", "Vertikale Grenze: gelegentlich per NOTAM bis {u} erweitert."],
  ["Vertical Limit OCNL notified to altitudes up to {u:hgt}", "Vertikale Grenze: gelegentlich bis {u} erweitert."],
  ["Vertical Limit OCNL notified to {u:hgt}", "Vertikale Grenze: gelegentlich bis {u} erweitert."],
  ["Vertical Limit OCNL notified up to {u:hgt} by NOTAM", "Vertikale Grenze: gelegentlich per NOTAM bis {u} erweitert."],
  ["Vertical Limit {h:hgt} Mon-Fri {s:sched}, Fri {a} - Mon {b}. Vertical Limit OCNL notified to altitudes up to {u:hgt} by NOTAM", "Vertikale Grenze: {h} Mo–Fr {s}, Fr {a} – Mo {b}. Gelegentlich per NOTAM bis {u} erweitert."],
  ["Vertical Limit {h:hgt} Mon-{d:id} {s:sched}", "Vertikale Grenze: {h} ({d}) {s}"],
  ["Upper limit: {h:hgt}", "Obergrenze: {h}"],
  ["Lower limit: {h:hgt}", "Untergrenze: {h}"],
  ["Lower limit: {h:hgt} {x:tr}", "Untergrenze: {h}. {x}"],
  ["Upper limit: {h:hgt} {x:tr}", "Obergrenze: {h}. {x}"],
  ["Site elevation: {h:hgt}", "Geländehöhe am Standort: {h}"],
  ["AMC - Manageable", "AMC-verwaltet (Luftraummanagement)"],
  ["AMC Manageable", "AMC-verwaltet (Luftraummanagement)"],
  ["AMC – Manageable", "AMC-verwaltet (Luftraummanagement)"],
  ["AMC - Manageable. ASM Protocols apply", "AMC-verwaltet (Luftraummanagement); ASM-Verfahren gelten."],
  ["AMC – Manageable above {h:hgt}", "Oberhalb {h} AMC-verwaltet (Luftraummanagement)."],
  ["ASM Protocols apply", "ASM-Verfahren (Luftraummanagement) gelten."],
  ["Unmanned aircraft flights? (?:is )?not permitted unless permission has been granted by {w}", "Flüge mit unbemannten Luftfahrzeugen nur mit Genehmigung von: {w}."],
  ["{p:id} email: {c:contact}", "{p} E-Mail: {c}"],
  ["NSA {p} email: {c:contact}", "NSA {p} – E-Mail: {c}"],
  ["HMPPS email: {c:contact}", "HMPPS (Strafvollzugsbehörde) – E-Mail: {c}"],
  ["FRZ Active H24. {x:tr}", "Flugbeschränkungszone (FRZ) durchgehend aktiv (H24). {x}"],
  ["FRZ and associated RPZs Active H24. {x:tr}", "Flugbeschränkungszone (FRZ) mit zugehörigen Runway Protection Zones (RPZ) durchgehend aktiv (H24). {x}"],
  ["UAS flight is not permitted unless permission has been granted by {w} via {v}", "UAS-Flüge nur mit Genehmigung von {w} über {v}."],
  ["For (?:additional )?contact details,? see {r}", "Kontaktdaten siehe {r}."],
  ["For contact details and opening hours see {r}", "Kontaktdaten und Öffnungszeiten siehe {r}."],
  ["ATC must be contacted during operational hours with a minimum of {n:num} hours notice provided prior to the unmanned aircraft flight within the FRZ", "Die Flugverkehrskontrolle ist während der Betriebszeiten mindestens {n} Stunden vor dem Flug unbemannter Luftfahrzeuge in der FRZ zu kontaktieren."],
  ["ATC must be contacted during opening hours and informed of flights {n:num} hours in advance of operation", "Die Flugverkehrskontrolle ist während der Öffnungszeiten zu kontaktieren und {n} Stunden vor dem Betrieb über die Flüge zu informieren."],
  ["Requests for permission to fly an unmanned aircraft are to be made to the Duty Operations Manager (Tel: {c:contact} or Email:", "Anträge auf Genehmigung eines Flugs mit unbemannten Luftfahrzeugen sind an den Duty Operations Manager zu richten (Tel.: {c} oder E-Mail:"],
  ["Information relating to flight within the FRZ and an on-line application form is available on the aerodrome's website {c:contact}", "Informationen zu Flügen in der FRZ und ein Online-Antragsformular gibt es auf der Website des Flugplatzes: {c}"],
  ["{c:contact}). Requests are to be made at least {n:num} hours prior to the intended commencement of a flight", "{c}). Anträge mindestens {n} Stunden vor dem geplanten Flugbeginn stellen."],
  ["Contact: Pre-flight information / Booking: {w}", "Kontakt: Vorfluginformation / Buchung: {w}"],
  ["Contact: Pre-flight information: {w}", "Kontakt: Vorfluginformation: {w}"],
  ["Contact: Booking: {w}", "Kontakt: Buchung: {w}"],
  ["Contact: Refer to Statutory Instrument", "Kontakt: siehe Rechtsverordnung (Statutory Instrument)."],
  ["Contact: {w}", "Kontakt: {w}"],
  ["Activation: Status: ACTIVE", "Aktivierung: Status aktiv"],
  ["Activation: Status: {s:id} / {x:tr} / OTHER", "Aktivierung: Status {s} / {x} / Sonstiges"],
  ["Activation: Status: {s:id} / {x:tr} / {y:tr}", "Aktivierung: Status {s} / {x} / {y}"],
  ["Activation: Status: {s:id} / {x:tr}", "Aktivierung: Status {s} / {x}"],
  ["Activation: {x:tr}", "Aktivierung: {x}"],
  ["Activated by NOTAM", "Aktivierung per NOTAM"],
  ["activity periods to be published by NOTAM", "Aktivitätszeiten werden per NOTAM veröffentlicht"],
  ["See above", "Siehe oben"],
  ["SS-SR UTC", "Sonnenuntergang bis Sonnenaufgang (UTC)"],
  ["Not available Sat/Sun/PH", "Nicht verfügbar Sa/So/Feiertage"],
  ["Mon-Sat SR to SS", "Mo–Sa Sonnenaufgang bis Sonnenuntergang"],
  ["{s:sched}; and as activated by NOTAM", "{s}; zusätzlich bei Aktivierung per NOTAM"],
  ["{s:sched} and as activated by NOTAM", "{s}; zusätzlich bei Aktivierung per NOTAM"],
  ["{s:sched}. September ?- ?April inclusive {t:sched}; and as activated by NOTAM", "{s}. September bis einschließlich April {t}; zusätzlich bei Aktivierung per NOTAM"],
  ["{s:sched}; and as Activated by NOTAM", "{s}; zusätzlich bei Aktivierung per NOTAM"],
  ["Not permanently active. Periods when restrictions in place promulgated by J Series NOTAM", "Nicht dauerhaft aktiv. Zeiträume der Beschränkung werden per NOTAM der J-Serie veröffentlicht"],
  ["Not from {s:sched} or {t:sched}; except under specially agreed arrangements", "Nicht {s} bzw. {t}; außer nach besonderer Vereinbarung"],
  ["For notifiable upper limit extension, not available from {s:sched} or {t:sched}; except under specially agreed arrangements", "Erweiterung der Obergrenze nicht verfügbar {s} bzw. {t}; außer nach besonderer Vereinbarung"],
  ["{s:sched}. / OTHER", "{s} / Sonstiges"],
  ["Activity: {x:tr}", "Aktivität: {x}"],
  ["Service: {x:tr}", "Funk/Dienst: {x}"],
  ["SUAAIS: {x:tr}", "SUAAIS: {x}"],
  ["SUACS: {x:tr}", "SUACS: {x}"],
  ["SUACS / SUAAIS: {x:tr}", "SUACS/SUAAIS: {x}"],
  ["SUACS not available during notified operating hours", "SUACS während der bekanntgegebenen Betriebszeiten nicht verfügbar"],
  ["SUACS. {x:tr}", "SUACS. {x}"],
  ["{u:svc} on {f:num} MHz when open; at other times {v:svc} on {g:num} MHz", "{u} auf {f} MHz, wenn besetzt; sonst {v} auf {g} MHz"],
  ["{u:svc} on {f:num} when open; at other times {v:svc} on {g:num} MHz", "{u} auf {f} MHz, wenn besetzt; sonst {v} auf {g} MHz"],
  ["{u:svc} on {f:num} when open; at other times,? {v:svc} via {w} on {g:num} MHz", "{u} auf {f} MHz, wenn besetzt; sonst {v} über {w} auf {g} MHz"],
  ["{u:svc} on {f:num} when open; at other times SUAAIS: {v:svc} on {g:num} MHz", "{u} auf {f} MHz, wenn besetzt; sonst SUAAIS: {v} auf {g} MHz"],
  ["{u:svc} on {f:num} when open; at other times SUAAIS: {v:svc} via {w} on {g:num} MHz", "{u} auf {f} MHz, wenn besetzt; sonst SUAAIS: {v} über {w} auf {g} MHz"],
  ["{u:svc} on {f:num} when open", "{u} auf {f} MHz, wenn besetzt"],
  ["{u:svc} on {f:num} MHz when open", "{u} auf {f} MHz, wenn besetzt"],
  ["{u:svc} on {f:num} when open, {v:svc} on {g:num} MHz thereafter", "{u} auf {f} MHz, wenn besetzt, danach {v} auf {g} MHz"],
  ["{u:svc} on {f:num} MHz or {v:svc} on {g:num} MHz", "{u} auf {f} MHz oder {v} auf {g} MHz"],
  ["{u:svc} on {f:num} MHz and {v:svc} on {g:num} MHz", "{u} auf {f} MHz und {v} auf {g} MHz"],
  ["{u:svc} on {f:num} MHz or {g:num} MHz as appropriate or through {w}, as appropriate", "{u} auf {f} MHz bzw. {g} MHz oder über {w}, je nach Lage"],
  ["{u:svc} on {f:num} MHz or {g:num} MHz as appropriate", "{u} auf {f} MHz bzw. {g} MHz, je nach Lage"],
  ["{u:svc} on {f:num} MHz / {g:num} MHz, or {v:svc} on {h:num} MHz", "{u} auf {f} MHz / {g} MHz oder {v} auf {h} MHz"],
  ["{u:svc} on channel {f:num}", "{u} auf Kanal {f}"],
  ["{u:svc} on {f:num} MHz", "{u} auf {f} MHz"],
  ["{u:svc} on {f:num}", "{u} auf {f} MHz"],
  ["Below {a:hgt} {u:svc} on channel {f:num}. At/above {b:hgt} {v:svc} on {g:num} MHz", "Unterhalb {a}: {u} auf Kanal {f}. Ab {b}: {v} auf {g} MHz"],
  ["{u:svc} {f:num} MHz", "{u} {f} MHz"],
  ["{u:svc} {f:num}", "{u} {f} MHz"],
  ["SUA Authority: {w}", "Zuständige Stelle (SUA): {w}"],
  ["SI {a:id}(?:,| and| &) SI {b:id}(?: \\(Amendment\\))?", "Rechtsverordnungen SI {a} und SI {b}"],
  ["SI {a:id}", "Rechtsverordnung SI {a}"],
  ["Guernsey SI {a:id}", "Rechtsverordnung Guernsey SI {a}"],
  ["New SI issued on activation", "Bei Aktivierung wird eine neue Rechtsverordnung (SI) erlassen."],
  ["See also ENR {a:id}, paragraph {b:id}", "Siehe auch ENR {a}, Absatz {b}."],
  ["A circle, {r:num} NM radius, centred at {c:coord}", "Kreis mit Radius {r} NM um {c}"],
  ["{c:coord} thence clockwise by the arc of a circle radius {r:num} NM centred on {d:coord} to", "{c}, dann im Uhrzeigersinn auf einem Kreisbogen mit Radius {r} NM um {d} bis"],
  ["{c:coord} following the line of latitude to -", "{c}, entlang des Breitenkreises bis –"],
  ["HMP Restricted airspace active H24", "Beschränkter Luftraum um Justizvollzugsanstalt (HMP), durchgehend aktiv (H24)."],
  ["Restricted airspace active H24", "Beschränkter Luftraum, durchgehend aktiv (H24)."],
  ["National Security Act \\(Prohibited Place\\) Restricted Airspace active H24", "Beschränkter Luftraum nach dem National Security Act (geschützter Ort), durchgehend aktiv (H24)."],
  ["Restricted airspace active H24. Contact {c:contact} for further details", "Beschränkter Luftraum, durchgehend aktiv (H24). Weitere Auskünfte: {c}."],
  ["Restricted airspace active H24. Small unmanned aircraft flight not permitted except with the permission of the Isle of Man CAA. Contact {c:contact}", "Beschränkter Luftraum, durchgehend aktiv (H24). Flüge kleiner unbemannter Luftfahrzeuge nur mit Genehmigung der Luftfahrtbehörde der Isle of Man (CAA). Kontakt: {c}."],
  ["Unmanned Aircraft Restriction. H24. National Police Air Service activity", "Beschränkung für unbemannte Luftfahrzeuge, durchgehend (H24): Flugbetrieb des National Police Air Service (Polizeihubschrauber)."],
  ["UAS BVLOS will not be conducted above {h:hgt}", "UAS-Flüge außerhalb der Sichtweite (BVLOS) finden nicht oberhalb von {h} statt."],
  ["Only available HN", "Nur nachts verfügbar (HN)."],
  ["Only available above {h:hgt} for QinetiQ managed activity", "Nur oberhalb {h} für von QinetiQ verwaltete Aktivitäten verfügbar."],
  ["Flight permitted for the purpose of landing at or taking off from the helicopter landing area at {p}, with the permission of the person in charge of the installation and in accordance with any conditions to which that permission is subject", "Flüge zum Landen auf bzw. Starten von dem Hubschrauberlandeplatz in {p} sind mit Genehmigung der für die Anlage verantwortlichen Person und gemäß deren Auflagen erlaubt."],
  ["Pilots will be required to comply with ATC instructions whilst crossing {a:id} and will be provided with a Deconfliction Service. Pilots who are unable to comply with ATC instructions should not request a crossing clearance", "Beim Durchfliegen von {a} sind die Anweisungen der Flugverkehrskontrolle zu befolgen; es wird ein Deconfliction Service erbracht. Wer die Anweisungen nicht befolgen kann, sollte keine Durchflugfreigabe beantragen."],
  ["Pilots will be required to comply with ATC instructions whilst crossing {a:id} and will be provided with an appropriate Flight Information Service. Pilots who may be unable to comply with ATC instructions should not request a crossing clearance", "Beim Durchfliegen von {a} sind die Anweisungen der Flugverkehrskontrolle zu befolgen; es wird ein geeigneter Fluginformationsdienst erbracht. Wer die Anweisungen nicht befolgen kann, sollte keine Durchflugfreigabe beantragen."],
  ["On no account should negative contact on {f:num} MHz be taken as non-activity of the range", "Fehlender Funkkontakt auf {f} MHz bedeutet keinesfalls, dass auf dem Übungsplatz kein Betrieb stattfindet."],
  ["{a:id} is contained within {b:id} \\(activated by NOTAM\\)", "{a} liegt innerhalb von {b} (Aktivierung per NOTAM)."],
  ["May be activated at the same time as {a:id} and/or {b:id} as a separate activity", "Kann gleichzeitig mit {a} und/oder {b} als eigene Aktivität aktiviert werden."],
  ["When active, entry of non-participating aircraft is prohibited unless flying in accordance with an authorisation given by {w}, Tel: {c:contact}", "Wenn aktiv: Einflug nicht beteiligter Luftfahrzeuge verboten, außer mit Genehmigung von {w}, Tel.: {c}."],
  ["Lower limit: {h:hgt} When active, entry of non-participating aircraft is prohibited unless flying in accordance with an authorisation given by {w}, Tel: {c:contact}", "Untergrenze: {h}. Wenn aktiv: Einflug nicht beteiligter Luftfahrzeuge verboten, außer mit Genehmigung von {w}, Tel.: {c}."],
  ["Application via CAA Customer Portal - ACOMS: {c:contact}", "Antrag über das CAA-Kundenportal (ACOMS): {c}"],
  ["NSF: Online Application: {c:contact}", "NSF: Online-Antrag: {c}"],
  ["Exemptions to be sought via NATS Non-Standard Flight \\(NSF\\) application online", "Ausnahmen online über einen NATS-Antrag für Non-Standard Flights (NSF) beantragen."],
  ["Permissions to fly UAS within the Restricted Area are to be obtained from {w} via email: {c:contact} or telephone: {d:contact}", "Genehmigungen für UAS-Flüge im Beschränkungsgebiet sind bei {w} einzuholen: E-Mail {c} oder Telefon {d}."],
  ["Clearance for emergency service aircraft will be given by {w}", "Freigaben für Luftfahrzeuge der Rettungsdienste erteilt {w}."],
  ["Flight Permitted by:", "Flüge erlaubt für:"],
  ["Flight permitted by:", "Flüge erlaubt für:"],
  ["Flight permitted by;", "Flüge erlaubt für:"],
  ["Flight permitted by any aircraft -", "Flüge erlaubt für jedes Luftfahrzeug –"],
  ["Flight permitted by any unmanned aircraft:", "Flüge erlaubt für jedes unbemannte Luftfahrzeug:"],
  ["Flight Permitted by any unmanned aircraft operated by or on behalf of:", "Flüge erlaubt für jedes unbemannte Luftfahrzeug, das betrieben wird von oder im Auftrag von:"],
  ["any (?:unmanned )?aircraft operated by,? or on behalf of,? {w}", "jedes Luftfahrzeug, das von oder im Auftrag von {w} betrieben wird"],
  ["any (?:unmanned )?aircraft operating for or on behalf of {w}", "jedes Luftfahrzeug, das für oder im Auftrag von {w} betrieben wird"],
  ["any aircraft flying in the service of {w}", "jedes Luftfahrzeug im Dienst von {w}"],
  ["any aircraft in the service of {w}", "jedes Luftfahrzeug im Dienst von {w}"],
  ["any (?:unmanned )?aircraft flying in accordance with (?:the|a) permission (?:of|issued by) {w}", "jedes Luftfahrzeug mit Genehmigung von {w}"],
  ["any aircraft flying in accordance with an agreed exemption issued by, or with the permission of, {w}", "jedes Luftfahrzeug mit vereinbarter Ausnahme oder Genehmigung von {w}"],
  ["any aircraft flying in accordance with an Enhanced Non-Standard Flight clearance issued by the appropriate ATC unit", "jedes Luftfahrzeug mit einer Enhanced-Non-Standard-Flight-Freigabe der zuständigen Flugverkehrskontrollstelle"],
  ["any aircraft flying in accordance with a Special Flight Notification issued by the appropriate ATC unit", "jedes Luftfahrzeug mit einer Special Flight Notification der zuständigen Flugverkehrskontrollstelle"],
  ["any aircraft approaching to, or departing from, {p}", "jedes Luftfahrzeug im An- oder Abflug auf {p}"],
  ["any aircraft operating with the written permission of the Secretary of State", "jedes Luftfahrzeug mit schriftlicher Genehmigung des zuständigen Ministers (Secretary of State)"],
  ["any helicopter flying on Helicopter Route {r:id}", "jeder Hubschrauber auf der Hubschrauberroute {r}"],
  ["any aircraft (?:either )?operated by a member of the Royal Family", "jedes Luftfahrzeug, das von einem Mitglied der königlichen Familie geführt wird"],
  ["any aircraft landing in the grounds of {p} at the invitation of the person in charge of the household there, provided that {w} has been informed in advance of such intended landing", "jedes Luftfahrzeug, das auf Einladung der Haushaltsleitung auf dem Gelände von {p} landet, sofern {w} vorab über die Landung informiert wurde"],
  ["operating in the service of {w}", "im Dienst von {w}"],
  ["operating with the permission of {w}", "mit Genehmigung von {w}"],
  ["flying in accordance with the permission of {w}", "mit Genehmigung von {w}"],
  ["a Police Air Support Unit", "eine Polizei-Luftunterstützungseinheit"],
  ["a member of the Royal Family", "ein Mitglied der königlichen Familie"],
  ["an Emergency Medical Service", "ein Rettungsdienst"],
  ["\\(i\\) the National Police Air Service", "(i) der National Police Air Service (Polizeihubschrauber)"],
  ["\\(ii\\) the Helicopter Emergency Medical Service", "(ii) der Rettungshubschrauberdienst (HEMS)"],
  ["\\(iii\\) The King’s Helicopter Flight; or", "(iii) The King’s Helicopter Flight (königliche Hubschrauberstaffel) oder"],
  ["\\(iv\\) the Maritime and Coastguard Agency for the purpose of search and rescue only", "(iv) die Küstenwache (Maritime and Coastguard Agency) ausschließlich für Such- und Rettungseinsätze"],
  ["Operated by a member of the Royal Family,?", "Geführt von einem Mitglied der königlichen Familie"],
  ["High energy manoeuvres related to display flying training only", "Flugmanöver mit hoher Energie nur im Rahmen von Kunstflugtraining für Flugvorführungen."],
  ["Microlight access to {p} obtained from {w}", "Zugang für Ultraleichtflugzeuge nach {p} über {w}."],
  ["In the event of an emergency which requires airborne assistance the HRA will be cleared of military low flying aircraft", "Bei einem Notfall mit Bedarf an Luftunterstützung wird das HRA von militärischen Tiefflügen freigehalten."],
  ["Flight permitted at not less than {h:hgt} above mean sea level for the purpose of landing at {p}", "Flüge in mindestens {h} über dem Meeresspiegel zur Landung in {p} erlaubt."],
  ["Flight permitted at a height of not less than {h:hgt} above ground level whilst operating under and in accordance with a clearance from the air traffic control unit at {p}", "Flüge in mindestens {h} über Grund mit Freigabe der Flugverkehrskontrolle {p} erlaubt."],
  ["Flight at a height of not less than {h:hgt} amsl whilst conducting an instrument approach procedure at {p}", "Flüge in mindestens {h} MSL während eines Instrumentenanflugs auf {p}."],
]);

// --- Litauen (Englisch/Litauisch) --------------------------------------------
rules("lt", [
  ["Prohibited geographical zone", "Geografische Verbotszone."],
  ["Prohibited geographical zone. {x:tr}", "Geografische Verbotszone. {x}"],
  ["Flights within the {z:id} zone are permitted only after obtaining permission from the Lithuanian Armed Forces", "Flüge in der Zone {z} nur mit Genehmigung der litauischen Streitkräfte."],
  ["Flights within this zone are permitted only after obtaining permission from the Lithuanian Armed Forces \\({z:id}\\) and authorization from the Lithuanian Air Force", "Flüge in dieser Zone nur mit Genehmigung der litauischen Streitkräfte ({z}) und Freigabe der litauischen Luftwaffe."],
  ["Flights within this zone are permitted only after obtaining permission from {w} and authorization from the Lithuanian Air Force", "Flüge in dieser Zone nur mit Genehmigung von {w} und Freigabe der litauischen Luftwaffe."],
  ["Flights within this zone are permitted only after obtaining permission from the Lithuanian Air Force", "Flüge in dieser Zone nur mit Genehmigung der litauischen Luftwaffe."],
  ["Flights within this zone are permitted only after obtaining (?:permission|authorization) from {w}", "Flüge in dieser Zone nur mit Genehmigung von {w}."],
  ["Flights within this zone are allowed only with a non-objection from {w} and authorization from the Lithuanian Air Force \\(LAF\\)", "Flüge in dieser Zone nur mit Unbedenklichkeitserklärung von {w} und Freigabe der litauischen Luftwaffe (LAF)."],
  ["Flights are only possible with permission from the responsible authorities", "Flüge nur mit Genehmigung der zuständigen Stellen möglich."],
  ["Flights are only possible with permission from the responsible authorities. Contact: {c:contact}", "Flüge nur mit Genehmigung der zuständigen Stellen möglich. Kontakt: {c}"],
  ["Flights are only permitted with authorization from the responsible authority", "Flüge nur mit Genehmigung der zuständigen Stelle."],
  ["Flights require authorization from the responsible authority", "Flüge erfordern eine Genehmigung der zuständigen Stelle."],
  ["Flights are permitted only with a non-objection from VAT and a permit from the Air Force", "Flüge nur mit Unbedenklichkeitserklärung des Staatsgrenzschutzes (VAT) und Genehmigung der Luftwaffe."],
  ["Flights are permitted only with authorization from the Public Security Service \\(PSS\\)", "Flüge nur mit Genehmigung des Dienstes für öffentliche Sicherheit (PSS)."],
  ["Flights are permitted only after authorization from {w}", "Flüge nur nach Freigabe durch {w}."],
  ["Flights are permitted according to the requirements of the open or specific category", "Flüge gemäß den Anforderungen der offenen bzw. speziellen Kategorie erlaubt."],
  ["UAS flights are permitted only after authorization from {w}. An additional authorization from the Commander of the Lithuanian Air Force Aviation Base is required for this zone and must be sent by email to {c:contact}", "UAS-Flüge nur nach Freigabe durch {w}. Für diese Zone ist zusätzlich eine Genehmigung des Kommandeurs des Luftwaffenstützpunkts der litauischen Luftwaffe erforderlich, die per E-Mail an {c} zu senden ist."],
  ["The geographical zone boundarie?s? (?:are|is) (?:defined as a )?{r:num} km radius from coordinates \\[{a}\\]", "Die Grenze der geografischen Zone ist ein Radius von {r} km um die Koordinaten [{a}]."],
  ["Lithuanian Armed Forces \\({z:id}\\)", "Litauische Streitkräfte ({z})"],
  ["Lithuanian Armed Forces", "Litauische Streitkräfte"],
  ["Lithuanian Air Force", "Litauische Luftwaffe"],
  ["Karinės oro pajėgos", "Litauische Luftwaffe"],
  ["State Security Department of the Republic of Lithuania", "Staatssicherheitsdepartement der Republik Litauen"],
  ["Dignitary Protection Service of the Republic of Lithuania", "Personenschutzdienst der Republik Litauen"],
  ["Ignalina Nuclear Power Plant", "Kernkraftwerk Ignalina"],
  ["Būtingė Oil Terminal", "Ölterminal Būtingė"],
  ["Contacts \\({a:num}/{b:num}\\):", "Kontakte ({a}/{b}):"],
  ["Contacts:", "Kontakte:"],
  ["Kontaktai", "Kontakte"],
  ["Further information:", "Weitere Informationen:"],
  ["Email: Not specified in the source", "E-Mail: in der Quelle nicht angegeben"],
  ["Tel. {a:contact},? mobile {b:contact}", "Tel. {a}, mobil {b}"],
  ["For inquiries, contact the zone owner: {c:rest}", "Anfragen an den Zoneninhaber: {c}"],
  ["Geographical zone owner‘s contacts: {c:rest}", "Kontakt des Zoneninhabers: {c}"],
  ["Restrictions for UAS in military areas", "Beschränkungen für UAS in militärischen Gebieten."],
  ["Separate authorization is required for filming or photography", "Für Film- oder Fotoaufnahmen ist eine gesonderte Genehmigung erforderlich."],
  ["Flight applications (?:for this (?:geographical )?zone )?cannot be submitted through the UTM system(?: in this geographical zone)?", "Fluganträge für diese Zone können nicht über das UTM-System gestellt werden."],
  ["Šioje geografinėje zonoje skrydžio paraiškų per UTM sistemą pateikti negalima", "Fluganträge für diese geografische Zone können nicht über das UTM-System gestellt werden."],
  ["The UAS operator must submit a (?:flight )?request in the UTM system (?:no later than|at least) {n:num} working days before the flight", "Der UAS-Betreiber muss den Flugantrag spätestens {n} Arbeitstage vor dem Flug im UTM-System stellen."],
  ["A request must be submitted in the UTM system no later than {n:num} working days before the flight", "Der Antrag ist spätestens {n} Arbeitstage vor dem Flug im UTM-System zu stellen."],
  ["The flight request must be submitted no later than {n:num} working days before the planned flight", "Der Flugantrag ist spätestens {n} Arbeitstage vor dem geplanten Flug zu stellen."],
  ["The coordinating authority must be contacted for a permit no later than {n:num} working days before the planned flight", "Die koordinierende Stelle ist spätestens {n} Arbeitstage vor dem geplanten Flug wegen einer Genehmigung zu kontaktieren."],
  ["Skrydžio paraiška turi būti pateikta ne vėliau kaip prieš {n:num} d.d. iki skrydžio", "Der Flugantrag ist spätestens {n} Arbeitstage vor dem Flug zu stellen."],
  ["Within {n:num} minutes after (?:the flight|landing), select „End Flight“ in the UTM system", "Innerhalb von {n} Minuten nach dem Flug bzw. der Landung im UTM-System „End Flight“ wählen."],
  ["At least {n:num} minutes before the flight, select „Request Take[ -]off“ in the UTM system. After landing, select [„\"]End Flight[“\"] in the UTM system within {m:num} minutes", "Mindestens {n} Minuten vor dem Flug im UTM-System „Request Take-off“ wählen. Nach der Landung innerhalb von {m} Minuten „End Flight“ wählen."],
  ["At least {n:num} minutes before the flight, select „Request Take off“ in the UTM system. Upon receiving a UTM message with ATC instructions, follow them and select „Acknowledge“. Take off is allowed only after final approval", "Mindestens {n} Minuten vor dem Flug im UTM-System „Request Take-off“ wählen. Nach Eingang einer UTM-Nachricht mit Anweisungen der Flugverkehrskontrolle diese befolgen und „Acknowledge“ wählen. Start erst nach endgültiger Freigabe."],
  ["At least {n:num} minutes before the flight, (?:the UAS operator must )?select „Request Take-off“ in the UTM system. The ATC communicates with the remote pilot by phone or via the UTM system. {x:tr}", "Mindestens {n} Minuten vor dem Flug im UTM-System „Request Take-off“ wählen. Die Flugverkehrskontrolle verständigt sich mit dem Fernpiloten per Telefon oder über das UTM-System. {x}"],
  ["Follow all UTM messages and ATC instructions, then select „Acknowledge“ once completed. Take-off is allowed only after final approval", "Alle UTM-Nachrichten und Anweisungen der Flugverkehrskontrolle befolgen und danach „Acknowledge“ wählen. Start erst nach endgültiger Freigabe."],
  ["The UAS operator must monitor UTM messages, follow ATC instructions, and select „Acknowledge“ once completed. Take-off is allowed only after final approval", "Der UAS-Betreiber muss die UTM-Nachrichten verfolgen, die Anweisungen der Flugverkehrskontrolle befolgen und danach „Acknowledge“ wählen. Start erst nach endgültiger Freigabe."],
  ["After submitting a flight application through the UTM system, the permission issued by the coordinating authority must be sent to {c:contact}", "Nach dem Flugantrag im UTM-System ist die Genehmigung der koordinierenden Stelle an {c} zu senden."],
  ["Before requesting take-off through the system, the UAS pilot must obtain approval by phone from the responsible authorities. During the flight, UTM notifications must be monitored and all instructions followed", "Vor der Startanfrage im System muss der UAS-Pilot telefonisch die Zustimmung der zuständigen Stellen einholen. Während des Flugs UTM-Meldungen beobachten und alle Anweisungen befolgen."],
  ["Before submitting a request, the UAS pilot must contact PSS and obtain flight authorization. Once granted, the request shall be submitted in the UTM system and PSS requirements must be followed", "Vor dem Antrag muss der UAS-Pilot den Dienst für öffentliche Sicherheit (PSS) kontaktieren und eine Fluggenehmigung einholen. Danach ist der Antrag im UTM-System zu stellen; die Vorgaben des PSS sind einzuhalten."],
  ["Before take-off, the UAS pilot must call and obtain approval from the responsible organization before requesting take-off authorization. During the flight, UTM notifications must be monitored and all instructions followed", "Vor dem Start muss der UAS-Pilot die zuständige Organisation anrufen und deren Zustimmung einholen, bevor er die Startfreigabe beantragt. Während des Flugs UTM-Meldungen beobachten und alle Anweisungen befolgen."],
  ["Before take-off, the UAS pilot must call the responsible organizations, obtain their verbal approval and only then request take-off authorization through the system. During the flight, UTM notifications must be monitored and all instructions followed", "Vor dem Start muss der UAS-Pilot die zuständigen Organisationen anrufen, deren mündliche Zustimmung einholen und erst dann die Startfreigabe im System beantragen. Während des Flugs UTM-Meldungen beobachten und alle Anweisungen befolgen."],
  ["The UAS operator must register in the UTM system \\(utm.ans.lt or the Lithuania Drone Map app\\) and submit a flight request. The (?:flight )?request is approved electronically and must be submitted no later than {n:num} working days before the planned flight", "Der UAS-Betreiber muss sich im UTM-System (utm.ans.lt oder App „Lithuania Drone Map“) registrieren und einen Flugantrag stellen. Der Antrag wird elektronisch genehmigt und ist spätestens {n} Arbeitstage vor dem geplanten Flug zu stellen."],
  ["The UAS operator must register in the UTM system and submit a flight request. {x:tr}", "Der UAS-Betreiber muss sich im UTM-System registrieren und einen Flugantrag stellen. {x}"],
  ["A flight (?:application|request) cannot exceed {n} hours", "Ein Flugantrag darf höchstens {n} Stunden umfassen."],
  ["The flight request duration cannot exceed {n:num} hours", "Ein Flugantrag darf höchstens {n} Stunden umfassen."],
  ["Approval of the request in the UTM system does not constitute take[ -]off authorization", "Die Genehmigung des Antrags im UTM-System ist keine Startfreigabe."],
  ["The (?:remote pilot|operator) must provide two phone numbers", "Es sind zwei Telefonnummern anzugeben."],
  ["The remote pilot must read and comply with the VAT procedures and Air Force instructions", "Der Fernpilot muss die Verfahren des Staatsgrenzschutzes (VAT) und die Anweisungen der Luftwaffe lesen und einhalten."],
  ["To coordinate a flight and obtain permissions, the remote pilot must contact the coordinating authority directly", "Zur Flugabstimmung und für Genehmigungen muss sich der Fernpilot direkt an die koordinierende Stelle wenden."],
  ["To coordinate a flight and obtain permissions, the remote pilot must contact the coordinating authority directly and comply with its requirements", "Zur Flugabstimmung und für Genehmigungen muss sich der Fernpilot direkt an die koordinierende Stelle wenden und deren Vorgaben einhalten."],
  ["To coordinate a flight and obtain permissions, the remote pilot must contact the coordinating authority directly and comply with the procedures established by the Lithuanian Air Force", "Zur Flugabstimmung und für Genehmigungen muss sich der Fernpilot direkt an die koordinierende Stelle wenden und die Verfahren der litauischen Luftwaffe einhalten."],
  ["For flight coordination and permit issuance, the remote pilot must comply with the procedures established by the Lithuanian Air Force", "Für Flugabstimmung und Genehmigungen gelten die Verfahren der litauischen Luftwaffe."],
  ["Dėl skrydžio suderinimo ir leidimų gavimo nuotolinis pilotas privalo kreiptis į derinančiąją instituciją bei vadovautis KOP nustatyta tvarka", "Zur Flugabstimmung und für Genehmigungen muss sich der Fernpilot an die koordinierende Stelle wenden und die Verfahren der litauischen Luftwaffe (KOP) einhalten."],
  ["To coordinate the flight and obtain the required permissions, the remote pilot must directly contact the relevant authority using the contact details provided below no later than {n:num} working days before the flight", "Zur Flugabstimmung und für die nötigen Genehmigungen muss sich der Fernpilot spätestens {n} Arbeitstage vor dem Flug direkt an die zuständige Stelle wenden (Kontaktdaten unten)."],
  ["Draudžiama geografinė zona. Skrydžiai šioje zonoje leidžiami tik gavus {w} neprieštaravimą ir Karinių oro pajėgų \\(KOP\\) leidimą", "Geografische Verbotszone. Flüge in dieser Zone nur mit Unbedenklichkeitserklärung von {w} und Genehmigung der litauischen Luftwaffe (KOP)."],
  ["AD CLSD TO FLT OPS, EXC IN CASES WHERE FLIGHT OPS ARE PERMITTED, SUBJECT TO OBTAINING PRIOR AUTHORIZATION BY PHONE: {c:contact})", "Flugplatz für Flugbetrieb geschlossen, außer wenn Flugbetrieb nach vorheriger telefonischer Genehmigung erlaubt ist: {c})"],
  ["UAS registration and remote pilot qualification documents, UAS Remote ID, and for flights over terminals, approval from its administrations must be sent to {c:contact} and {d:contact}. Requests are approved in the UTM system, however, pilot must follow the instructions in the official e-mail from Port and LAF", "UAS-Registrierung, Kompetenznachweis des Fernpiloten, Remote-ID und – bei Flügen über Terminals – die Zustimmung der Terminalverwaltung sind an {c} und {d} zu senden. Anträge werden im UTM-System genehmigt; der Pilot muss jedoch die Anweisungen in der offiziellen E-Mail von Hafen und Luftwaffe (LAF) befolgen."],
]);

// --- Malta (Kontaktzeilen „<Ort> - Contact <E-Mail>“) ---------------------------
rules("mt", [
  ["{p} -? ?(?:Please contact|please contact|Contact|contact|Contacts|Contcat)(?: -|:)? ?{c:mail}", "{p} – Kontakt: {c}"],
  ["{p} -? ?(?:Please contact|please contact|Contact|contact)(?: -|:)? ?{who} - {c:contact}", "{p} – Kontakt: {who}, {c}"],
  ["{p} -? ?(?:Contact|contact) {who} {c:contact}", "{p} – Kontakt: {who}, {c}"],
  ["{p} - No objection required -? ?(?:email )?{c:mail}", "{p} – Unbedenklichkeitserklärung erforderlich – Kontakt: {c}"],
  ["{p} - No [Oo]bjection required - email {c:contact}", "{p} – Unbedenklichkeitserklärung erforderlich – Kontakt: {c}"],
  ["{p} - No objection required {c:contact}", "{p} – Unbedenklichkeitserklärung erforderlich – Kontakt: {c}"],
  ["{p}\\. No objection (?:required )?from {w} (?:required )?-? ?(?:Contact|contact) {c:contact}", "{p}. Unbedenklichkeitserklärung von {w} erforderlich – Kontakt: {c}"],
  ["{p} - please contact {c:contact} for permission and upload with (?:your|flight) submission", "{p} – Genehmigung bei {c} einholen und mit dem Flugantrag hochladen"],
  ["{p} - please upload permit from:? {c:contact}", "{p} – Genehmigung von {c} mit dem Antrag hochladen"],
  ["{p} - Please contact Drones at ERA on {c:contact}", "{p} – Kontakt: Drohnenstelle der Umweltbehörde ERA, {c}"],
  ["{p} Contact ERA {c:contact}", "{p} – Kontakt: Umweltbehörde ERA, {c}"],
  ["{p} - {c:mail}", "{p} – Kontakt: {c}"],
  ["{p} {c:mail}", "{p} – Kontakt: {c}"],
  ["{p} - (?:AFM )?Coordination needed {c:contact}", "{p} – Abstimmung mit den Streitkräften (AFM) erforderlich, Kontakt: {c}"],
  ["{p}\\. Operations subject to no objection from AFM\\. Contact {c:contact}", "{p}. Betrieb nur mit Unbedenklichkeitserklärung der Streitkräfte (AFM). Kontakt: {c}"],
  ["{p} - Operations allowed only if no objection provided by AFM - Contact {c:contact}", "{p} – Betrieb nur mit Unbedenklichkeitserklärung der Streitkräfte (AFM). Kontakt: {c}"],
  ["{p} - No objection required {c:contact}", "{p} – Unbedenklichkeitserklärung erforderlich – Kontakt: {c}"],
  ["Helipad - no objection contact is {who} - {c:contact}", "Hubschrauberlandeplatz – Unbedenklichkeitserklärung bei {who}, {c}"],
  ["{p}\\. Requests will be reviewed by the Drones Unit", "{p}. Anträge werden von der Drohnenstelle geprüft."],
  ["{p} Highly Restricted Area {q}", "{p} Hochbeschränktes Gebiet {q}"],
  ["{p} - Auto Authorisation Limit {h:hgt}", "{p} – automatische Freigabe bis {h}"],
  ["{p} Auto Authorisation of maximum {h:hgt}", "{p} – automatische Freigabe bis max. {h}"],
  ["LUQA-Central-Requests with altitude above {h:hgt} need to be approved by MATS. - Email MATS on {c:contact} \\(and copy {d:contact}\\) advising request number\\(TM{x}\\)and date/time/coord/altitude and scope", "LUQA-Central: Anträge über {h} müssen von MATS (Flugsicherung Malta) genehmigt werden – E-Mail an {c} (Kopie an {d}) mit Antragsnummer (TM…), Datum/Uhrzeit/Koordinaten/Höhe und Zweck."],
  ["Valletta Special Permit Zone. Recreational Operations not allowed. Commercial Operations are authorised subject to Special Permit criteria are met. Email {c:contact}", "Sondergenehmigungszone Valletta. Freizeitbetrieb nicht erlaubt. Gewerblicher Betrieb erlaubt, wenn die Kriterien der Sondergenehmigung erfüllt sind. E-Mail: {c}"],
]);

// --- Italien (d-flight) ----------------------------------------------------
rules("it", [
  ["Altezza massima {h:hgt}", "Maximale Höhe {h}"],
  ["Max height {h:hgt}", "Maximale Höhe {h}"],
  ["Operazioni consentite fino a {h:hgt}", "Betrieb bis {h} erlaubt"],
  ["Operations allowed up to {h:hgt}", "Betrieb bis {h} erlaubt"],
  ["Operazioni consentite previa autorizzazione", "Betrieb nur mit vorheriger Genehmigung erlaubt."],
  ["Operazioni UAS non consentite", "UAS-Betrieb nicht erlaubt"],
  ["UAS operations not allowed", "UAS-Betrieb nicht erlaubt"],
  ["Nessuna operazione", "Kein Betrieb"],
  ["No operations", "Kein Betrieb"],
  ["Divieto di sorvolo", "Überflugverbot"],
  ["Divieto temporaneo di sorvolo UAS", "Temporäres Überflugverbot für UAS"],
  ["Contattare {w}", "{w} kontaktieren."],
  ["UAS ACTIVITY PROHIBITED WI {r:dist} RADIUS CENTERED {c:coord}", "UAS-Betrieb verboten im Umkreis von {r} um {c}"],
  ["ATM09 / ARANCIONE", "ATM09 / Orange"],
  ["ATM09 / GIALLO", "ATM09 / Gelb"],
  ["ATM09 / ROSSO", "ATM09 / Rot"],
]);

// --- Spanien (ENAIRE) ------------------------------------------------------
rules("es", [
  ["Operaciones en zona urbana: comunicación previa al Ministerio del Interior", "Betrieb in städtischem Gebiet: vorherige Mitteilung an das Innenministerium."],
  ["Operaciones en zona urbana: requiere comunicación previa al Ministerio del Interior con una antelación mínima de {n:num} días naturales", "Betrieb in städtischem Gebiet: vorherige Mitteilung an das Innenministerium mindestens {n} Kalendertage im Voraus erforderlich."],
  ["Coordinación previa con ENAIRE", "Vorherige Abstimmung mit ENAIRE."],
  ["Exhibición aérea. Prohibido el vuelo de UAS", "Flugvorführung. UAS-Flüge verboten."],
  ["Infraestructura crítica. Prohibido el vuelo de UAS", "Kritische Infrastruktur. UAS-Flüge verboten."],
  ["Infraestructura ferroviaria \\(CIDETRA\\). Se requiere autorización del gestor de la infraestructura", "Eisenbahninfrastruktur (CIDETRA). Genehmigung des Infrastrukturbetreibers erforderlich."],
  ["Zona prohibida. Prohibido el vuelo de UAS salvo autorización expresa", "Sperrgebiet. UAS-Flüge verboten, außer mit ausdrücklicher Genehmigung."],
  ["Zona peligrosa activa en horario publicado. Fuera de horario sin restricción adicional", "Gefahrengebiet, aktiv zu den veröffentlichten Zeiten. Außerhalb dieser Zeiten keine zusätzliche Beschränkung."],
  ["Zona de control de aeródromo. Las operaciones UAS requieren coordinación previa con el proveedor de servicios de tránsito aéreo y autorización conforme al RD {r:id}", "Flugplatzkontrollzone. UAS-Betrieb erfordert vorherige Abstimmung mit der Flugsicherung und eine Genehmigung nach RD {r}."],
  ["SITA: {a:id}; TEL: {c:contact}; Email: {d:contact}", "SITA: {a}; Tel.: {c}; E-Mail: {d}"],
]);

// --- Polen (PANSA) ---------------------------------------------------------
rules("pl", [
  ["{n:num} km zone around aerodrome", "{n}-km-Zone um den Flugplatz."],
  ["DRA-I Radio Mandatory Zone", "DRA-I Funkpflichtzone"],
  ["DRA-P Drone Restricted Area – Prohibited", "DRA-P Drohnen-Beschränkungsgebiet – Flugverbot"],
  ["DRA-P new type", "DRA-P (neuer Typ)"],
  ["DRA-P – drone flights prohibited", "DRA-P – Drohnenflüge verboten."],
  ["DRA-P – zakaz lotów BSP", "DRA-P – Drohnenflüge (BSP) verboten."],
  ["DRA-R RPA sector", "DRA-R RPA-Sektor"],
  ["DRA-R Temporary Reserved Area", "DRA-R temporär reserviertes Gebiet"],
  ["RPA sector, flights up to {h:hgt} after notification", "RPA-Sektor: Flüge bis {h} nach vorheriger Meldung."],
  ["Temporary reserved area", "Temporär reserviertes Gebiet."],
  ["NOTAM {n:id} \\(PANSA\\) · Zone {z}", "NOTAM {n} (PANSA) · Zone {z}"],
  ["{a} · TIMESLICE \\({h}\\)", "{a} · Zeitscheibe ({h})"],
]);

// --- Rumänien ----------------------------------------------------------------
rules("ro", [
  ["ROMATSA {c:contact}For flights up to {h:hgt} in this zone, drone pilots shall contact TWR at the abovementioned phone", "ROMATSA {c} – Für Flüge bis {h} in dieser Zone müssen Drohnenpiloten den Tower (TWR) unter der oben genannten Telefonnummer kontaktieren."],
  ["ROMATSA {c:contact}", "ROMATSA {c}"],
]);

// --- Slowakei (zweisprachig SK/EN) --------------------------------------------
rules("sk", [
  ["ZAKÁZANÁ PREVÁDZKA UAS / PROHIBITED UAS OPERATION", "UAS-Betrieb verboten"],
  ["PODMIENENÁ PREVÁDZKA UAS / CONDITIONAL UAS OPERATION", "UAS-Betrieb unter Bedingungen"],
  ["Počas prevádzkových hodín stanovišťa riadenia letovej prevádzky \\(TWR\\) {p} During operations hours of the {q} air traffic control Tower \\(TWR\\)", "Während der Betriebszeiten des Kontrollturms (TWR) {p}"],
  ["[Ss]tála permanent", "ständig"],
  ["Civilná prevádzka UAS je povolená len v osobitnej kategórii UAS\\.? / Civil UAS operations are permitted only in the specific category of UAS", "Ziviler UAS-Betrieb nur in der speziellen Kategorie erlaubt."],
  ["Civilná prevádzka UAS je povolená len v osobitnej kategórii UAS s výnimkou atypického vzdušného priestoru\\. / Civil UAS operations are permitted only in the specific category of UAS, with the exception of atypica{x:rest}", "Ziviler UAS-Betrieb nur in der speziellen Kategorie erlaubt, ausgenommen im atypischen Luftraum."],
  ["Prevádzka civilných letov UAS je zakázaná / Operations of civil UAS are prohibited", "Ziviler UAS-Betrieb verboten."],
  ["Let povolený iba s predhadzujúcim povolením kritického subjektu / Flight permitted only with the prior authorization of the critical entity", "Flug nur mit vorheriger Genehmigung des Betreibers der kritischen Infrastruktur erlaubt."],
  ["Let UAS povolený na základe predchádzajúceho súhlasu správcu príslušného chráneného objektu / UAS flight permitted only with the prior approval of the operator of the relevant protected facility", "UAS-Flug nur mit vorheriger Zustimmung des Betreibers des betreffenden geschützten Objekts erlaubt."],
  ["Let UAS je povolený iba na základe predchádzajúceho súhlasu Ministerstva obrany Slovenskej republiky, ktoré sú vybavené systémom diaľkovej identifikácie\\. / {x:rest}", "UAS-Flug nur mit vorheriger Zustimmung des Verteidigungsministeriums der Slowakischen Republik erlaubt; das UAS muss mit Fernidentifizierung (Remote ID) ausgestattet sein."],
  ["Civilná prevádzka UAS v zemepisnej oblasti je povolená len pre lety UAS vykonávaných na účely plnenia pracovných úloh Národnej zoologickej záhrady Bojnice a po jej predchádzajúcom súhlase{x:rest}", "Ziviler UAS-Betrieb in diesem Gebiet nur für Flüge zur Erfüllung von Aufgaben des Nationalen Zoologischen Gartens Bojnice und mit dessen vorheriger Zustimmung erlaubt."],
  ["{l:hgt} - {u:hgt}", "{l} – {u}"],
  ["{l:num} - {u:hgt}", "{l} – {u}"],
  ["Hosted/Reservation_\\(Public\\){n:num} „Airspace activation“ \\(LPS SR\\)", "Hosted/Reservation_(Public){n} „Luftraumaktivierung“ (LPS SR)"],
  ["VFRM_popup/MapServer/{n:num} „Airspace“ \\(LPS SR\\)", "VFRM_popup/MapServer/{n} „Luftraum“ (LPS SR)"],
]);

// --- Slowenien (Werte der Feldnamen) ---------------------------------------------
rules("si", [
  ["[Pp]repovedano", "verboten"],
  ["[Ff]orbidden", "verboten"],
  ["[Pp]rohibited", "verboten"],
  ["dovoljeno do višine {h:hgt} \\(nad terenom\\)", "erlaubt bis {h} (über Grund)"],
  ["allowed up to a height of {h:hgt} \\(above ground level\\)", "erlaubt bis {h} (über Grund)"],
  ["dovoljenje za modelarske aktivnosti za člane modelskega kluba", "Genehmigung für Modellflugaktivitäten für Mitglieder des Modellflugclubs"],
  ["permit for modeling activities for members of the modeling club", "Genehmigung für Modellflugaktivitäten für Mitglieder des Modellflugclubs"],
  ["varnost in varovanje", "Sicherheit und Schutz"],
  ["[Vv]arovanje", "Schutz"],
  ["safety and security", "Sicherheit und Schutz"],
  ["[Ss]ecurity", "Sicherheit"],
  ["[Oo]pen {a:num}/{b:num}", "geöffnet {a}/{b}"],
  ["[Oo]dprto {a:num}/{b:num}", "geöffnet {a}/{b}"],
  ["izven obratovalnega časa veljajo splošna UAS pravila", "außerhalb der Betriebszeiten gelten die allgemeinen UAS-Regeln"],
  ["outside operational hours, general UAS rules apply", "außerhalb der Betriebszeiten gelten die allgemeinen UAS-Regeln"],
  ["operations prohibited within a radius of {r:dist} from RWY, closer with approval by aerodrome operator only", "Betrieb im Umkreis von {r} um die Piste verboten; näher nur mit Zustimmung des Flugplatzbetreibers"],
  ["prepovedane operacije v radiju {r:dist} od vzletno pristajalne steze, znotraj tega radija pa le ob soglasju letališča", "Betrieb im Umkreis von {r} um die Piste verboten; innerhalb dieses Radius nur mit Zustimmung des Flugplatzes"],
  ["[Aa]pproval from {w}", "Zustimmung von {w}"],
  ["[Aa]pproval from heliport \\+ valid certificate for subcategory {k:id}", "Zustimmung des Hubschrauberlandeplatzes + gültiges Zeugnis für die Unterkategorie {k}"],
  ["Dovoljenje upravljalca heliporta \\+ veljaven certifikat podkategorije {k:id}", "Genehmigung des Hubschrauberlandeplatz-Betreibers + gültiges Zeugnis für die Unterkategorie {k}"],
  ["approval from operator", "Zustimmung des Betreibers"],
  ["approval from airfield operator", "Zustimmung des Flugplatzbetreibers"],
  ["approval from aerodrome operator \\(see contact\\)", "Zustimmung des Flugplatzbetreibers (siehe Kontakt)"],
  ["approval from TNP \\(see information\\)", "Genehmigung des Triglav-Nationalparks (TNP) (siehe Informationen)"],
  ["dovoljenje TNP \\(glej info\\)", "Genehmigung des Triglav-Nationalparks (TNP) (siehe Informationen)"],
  ["soglasje upravljalca letališča \\(glej kontakt\\)", "Zustimmung des Flugplatzbetreibers (siehe Kontakt)"],
  ["dovoljenje upravljalca vzletisca", "Genehmigung des Flugplatzbetreibers"],
  ["soglasje uporabnika območja", "Zustimmung des Gebietsnutzers"],
  ["specific category only: approval SloveniaControl", "nur spezielle Kategorie: Zustimmung von Slovenia Control"],
  ["specific category: approval SloveniaControl", "spezielle Kategorie: Zustimmung von Slovenia Control"],
  ["posebna kategorija: soglasje KZPS", "spezielle Kategorie: Zustimmung der Flugsicherung (KZPS)"],
  ["Nuclear Safety Administration approval", "Zustimmung der Behörde für nukleare Sicherheit"],
  ["dovoljenje uprave za jedrsko var.", "Genehmigung der Behörde für nukleare Sicherheit"],
  ["[Aa]uthorisation (?:of operation|or operations|of operations) by {w}", "Genehmigung oder Betrieb durch {w}"],
  ["(?:[Pp]redhodna odobritev ali operacije|Predhodna odobritev) {w}", "vorherige Zustimmung oder Betrieb durch {w}"],
  ["Dovoljenje {w}", "Genehmigung von {w}"],
  ["Lastne potrebe ali predhodna odobritev", "Eigenbedarf oder vorherige Zustimmung"],
  ["For operational needs with prior approval", "Für betriebliche Zwecke mit vorheriger Zustimmung"],
  ["Act on Critical Infrastructure", "Gesetz über kritische Infrastruktur"],
  ["Zakon o kritični infrastrukturi", "Gesetz über kritische Infrastruktur"],
  ["Act on the Execution of Criminal Sanctions \\({k:id}\\)", "Gesetz über den Vollzug strafrechtlicher Sanktionen ({k})"],
  ["Zakon o izvrševanju kazenskih sankcij \\({k:id}\\)", "Gesetz über den Vollzug strafrechtlicher Sanktionen ({k})"],
  ["Official [Gg]azette RS,? {x:rest}", "Amtsblatt der Republik Slowenien {x}"],
  ["Uradni list RS,? {x:rest}", "Amtsblatt der Republik Slowenien {x}"],
  ["[Ss]klep Vlade (?:RS|Republike Slovenije),? {x:rest}", "Regierungsbeschluss der Republik Slowenien {x}"],
  ["Sklep Vlade RS, št. {a}; {b:tr}", "Regierungsbeschluss der Republik Slowenien Nr. {a}; {b}"],
  ["Private Security Act \\({a}\\); Decree on obligatory setting-up of security service \\({b}\\)", "Gesetz über private Sicherheitsdienste ({a}); Verordnung über die Pflicht zur Einrichtung eines Sicherheitsdienstes ({b})"],
  ["Zakon o zasebnem varovanju \\(Uradni list RS, št\\.{a}\\); ?Uredb[ae] o obveznem organiziranju varovanja \\(Uradni list RS, št\\. {b}\\)", "Gesetz über private Sicherheitsdienste (Amtsblatt der RS Nr. {a}); Verordnung über die Pflicht zur Einrichtung eines Sicherheitsdienstes (Amtsblatt der RS Nr. {b})"],
  ["Aerodrome IFR", "Flugplatz (IFR)"],
  ["Aerodrome VFR", "Flugplatz (VFR)"],
  ["[Aa]irfield", "Flugplatz"],
  ["Danger area", "Gefahrengebiet"],
  ["Heliport", "Hubschrauberlandeplatz"],
  ["ModelarskeCone", "Modellflugzonen"],
  ["Nuclear power plant - prohibited", "Kernkraftwerk – Flugverbot"],
  ["Public interest sites - heliports", "Einrichtungen von öffentlichem Interesse – Hubschrauberlandeplätze"],
  ["Restricted - Area", "Beschränkungsgebiet"],
  ["Coal mine {w}", "Kohlebergwerk {w}"],
  ["Port of Koper - {n:num}", "Hafen Koper – {n}"],
  ["TEŠ power plant", "Kraftwerk TEŠ (Šoštanj)"],
  ["Triglav National Park", "Triglav-Nationalpark"],
  ["Prohibited areas - Nuclear power plant", "Sperrgebiete – Kernkraftwerk"],
  ["{w} \\(hospital\\)", "{w} (Krankenhaus)"],
  ["{x:id} restricted", "{x} Beschränkungsgebiet"],
  ["{x} - Danger area", "{x} – Gefahrengebiet"],
]);

// --- Bulgarien (Originalblöcke) -------------------------------------------------
rules("bg", [
  ["Да се уведомява лицето за контакт за планираната дейност {n:num} дни предварително", "Die Kontaktperson ist {n} Tage vorher über die geplante Tätigkeit zu informieren."],
  ["Да се уведоми заявителят за планираната дейност", "Der Antragsteller ist über die geplante Tätigkeit zu informieren."],
  ["Полети в тази зона могат да се изпълняват само след разрешение от ГД ГВА. Минимален интервал от време за подаване на заявление е {n:num} работни дни {x:rest}", "Flüge in dieser Zone nur mit Genehmigung der Generaldirektion Zivilluftfahrt (GD GVA). Antrag mindestens {n} Arbeitstage vorher stellen."],
  ["Полети в тази зона могат да се изпълняват само след разрешение от ГД ГВА. Минимален интервал от време за подаване на заявление е {n:num} месец{x:rest}", "Flüge in dieser Zone nur mit Genehmigung der Generaldirektion Zivilluftfahrt (GD GVA). Antrag mindestens {n} Monat(e) vorher stellen."],
  ["Полети в тази зона над {h:hgt} могат да се изпълняват само след разрешение от ГД ГВА. Минимален интервал от време за подаване на заявление е {n:num} работни {x:rest}", "Flüge in dieser Zone oberhalb {h} nur mit Genehmigung der Generaldirektion Zivilluftfahrt (GD GVA). Antrag mindestens {n} Arbeitstage vorher stellen."],
  ["Полети в тази зона могат да се изпълнят само след (?:специално )?разрешение на ГД ГВА. {x:rest}", "Flüge in dieser Zone nur mit (Sonder-)Genehmigung der Generaldirektion Zivilluftfahrt (GD GVA); Antrag rechtzeitig vorher stellen."],
  ["Забраняват се полетите с безпилотни летателни системи в установената зона", "Flüge mit unbemannten Luftfahrzeugsystemen in der festgelegten Zone sind verboten."],
  ["Забраняват се полетите с безпилотни летателни системи в установената зона, освен с тези на заявителя", "Flüge mit unbemannten Luftfahrzeugsystemen in der festgelegten Zone sind verboten, ausgenommen die des Antragstellers."],
  ["Забраняват се полети с БЛС, изисква се предварително разрешение за полет от заявителя. Полетът в зоната се извършва под условия", "UAS-Flüge sind verboten; eine vorherige Fluggenehmigung des Antragstellers ist erforderlich. Flüge in der Zone nur unter Auflagen."],
  ["Зона(?: за сигурност)?, забранена за полети на БЛС от земната повърхност до височина {n:num} метра", "Zone (Sicherheitszone) mit UAS-Flugverbot vom Boden bis {n} m Höhe."],
  ["Зона за сигурност забранена за полети на БЛС от земната повърхност до височина {n:num} метра", "Sicherheitszone mit UAS-Flugverbot vom Boden bis {n} m Höhe."],
  ["Операторът на БЛС изисква предварително разрешение за полет чрез подаване на заявление в ГД ГВА", "Der UAS-Betreiber benötigt eine vorherige Fluggenehmigung; Antrag bei der Generaldirektion Zivilluftfahrt (GD GVA)."],
  ["Зоната представлява обект, свързан със сигурността на страната", "Die Zone ist ein Objekt der nationalen Sicherheit."],
  ["Класифициран като стратегически обект от значение за националната сигурност", "Als strategisches Objekt von Bedeutung für die nationale Sicherheit eingestuft."],
  ["Заплаха за физическата и ядрената сигурност на съоръженията, критичната инфраструктура и персонала", "Gefahr für die physische und nukleare Sicherheit der Anlagen, der kritischen Infrastruktur und des Personals."],
  ["Извършването на нерегламентирани полети на безпилотни и пилотирани въздухоплавателни средства над обекта създава преки рискове от:", "Ungenehmigte Flüge unbemannter und bemannter Luftfahrzeuge über dem Objekt bergen unmittelbare Risiken durch:"],
  ["Риск от възникване на аварийни ситуации, нежелана намеса или смущения в работния процес на комплекса", "Risiko von Notfällen, unerwünschten Eingriffen oder Störungen im Betriebsablauf der Anlage."],
  ["Центърът за управление на мрежата на Виваком е обект от критичната инфраструктура на Република България", "Das Netzwerk-Kontrollzentrum von Vivacom ist ein Objekt der kritischen Infrastruktur der Republik Bulgarien."],
  ["Географска зона", "Geografische Zone"],
  ["Зона от РВД", "Zone der Flugverkehrsdienste (ATS)"],
  ["Национална гвардейска част", "Nationalgardeeinheit"],
  ["ГД ГВА служител", "Mitarbeiter der GD GVA (Zivilluftfahrtbehörde)"],
  ["служител", "Mitarbeiter"],
  ["Warning! You are entering a restricted area!", "Achtung! Sie fliegen in ein Beschränkungsgebiet ein!"],
  ["UAS operations are prohibited in this area due to public safety and protection of diplomatic premises", "UAS-Betrieb in diesem Gebiet verboten (öffentliche Sicherheit, Schutz diplomatischer Einrichtungen)."],
  ["Flights only permitted with explicit authorisation from the competent Bulgarian authority", "Flüge nur mit ausdrücklicher Genehmigung der zuständigen bulgarischen Behörde."],
  // Dienstgrade + Name (umschrieben)
  ["(?:майор|м-р) {n:name}", "Major {n}"],
  ["(?:подполковник|подп\\.) {n:name}", "Oberstleutnant {n}"],
  ["(?:полковник|полк\\.) доц\\. д-р инж\\. {n:name}", "Oberst Doz. Dr.-Ing. {n}"],
  ["(?:полковник|полк\\.) {n:name}", "Oberst {n}"],
  ["(?:капитан|к-н) III ранг {n:name}", "Kapitänleutnant {n}"],
  ["К-н III ранг {n:name}", "Kapitänleutnant {n}"],
  ["(?:капитан|к-н) {n:name}", "Hauptmann {n}"],
  ["лейт\\. {n:name}", "Leutnant {n}"],
  ["оф\\. канд\\. {n:name}", "Offiziersanwärter {n}"],
  ["Вертолетно летище {n:name}", "Hubschrauberlandeplatz {n}"],
  ["БВЛ {n:name}", "Hubschrauberlandeplatz (Krankenhaus) {n}"],
  ["ВП_{n:name}", "Militärflugplatz {n}"],
  // Zonenname mit CAA-Registriernummer („Burgas (LBBG)-0000685“) – Eigenname
  ["{n:name}-{k:bgid}", "{n}-{k}"],
  ["Язовир {n:name}", "Stausee {n}"],
  ["Зона {n:name}", "Zone {n}"],
]);

// --- Kroatien ----------------------------------------------------------------
rules("hr", [
  ["Rezervacija iz mobilne aplikacije \\( {p} \\)", "Reservierung aus der mobilen App ({p})"],
  ["Reservation from mobile app \\( {p} \\)", "Reservierung aus der mobilen App ({p})"],
  ["Manned balloons", "Bemannte Ballone"],
  ["Paraglider", "Gleitschirmflug"],
  ["UAS operations", "UAS-Betrieb"],
  ["Other activities that require the establishment of a structure in the airspace", "Sonstige Aktivitäten, die eine Luftraumstruktur erfordern"],
  ["{x:tr} \\(englischer Originaltext\\)", "{x} (aus dem Englischen)"],
]);

// --- Zypern (Griechisch) -----------------------------------------------------
rules("cy", [
  ["Για πληροφορίες αναφορικά με τους όρους πρόσβασης της ζώνης επισκευθείτε την ιστοσελίδα {c:contact}", "Informationen zu den Zugangsbedingungen der Zone: {c}"],
  ["Για πτήσεις σε αυτήν την περιοχή, απαιτείται άδεια από τη {w}. Υποβολή αίτησης τουλάχιστον {n:num} βδομάδες πριν από την προγραμματισμένη ημερομηνία{x:rest}", "Für Flüge in diesem Gebiet ist eine Genehmigung von {w} erforderlich. Antrag mindestens {n} Wochen vor dem geplanten Flugdatum stellen."],
  ["ΕΞΟΥΣΙΟΔΟΤΗΣΗ", "Autorisierung erforderlich"],
  ["ΕΞΟΥΣΙΟΔΟΤΗΣΗ {x:tr}", "Autorisierung erforderlich – {x}"],
]);

// --- Frankreich (Géoplateforme, „remarque“) -------------------------------------
rules("fr", [
  ["Altitude de référence de l'(?:aérodrome|hélistation|hydrobase) : {n:num} m", "Bezugshöhe des Flugplatzes: {n} m"],
  ["Altitude de référence de (?:l'aérodrome|l'hélistation|la plateforme) : voir le fond topographique", "Bezugshöhe des Flugplatzes: siehe topografische Karte"],
  ["Notification préalable obligatoire pour les aéronefs de masse supérieure à {n:num}g", "Vorherige Meldung für Luftfahrzeuge über {n} g Pflicht."],
]);

// --- Tschechien (ŘLP ED-318, „Hinweis der Behörde“) ---------------------------
rules("cz", [
  ["lower limit {a:hgt},upper limit {b:hgt}", "Untergrenze {a}, Obergrenze {b}"],
  ["upper limit {b:hgt}", "Obergrenze {b}"],
  ["lower limit {a:hgt}", "Untergrenze {a}"],
]);

// --- Schweden (ED-318 „reason“/Behördenrollen) -----------------------------------
rules("se", [
  ["Permission", "Genehmigung"],
  ["Assessment", "Vorab-Prüfung"],
  ["Information", "Information"],
  ["Test site", "Testgelände"],
  ["AUTHORIZED", "Genehmigt"],
]);

// --- Namen: Gattungswörter (Eigennamen bleiben) ----------------------------------
rules("name-ch", [
  ["Protected natural object {n}", "Geschütztes Naturobjekt {n}"],
  ["Cantonal wildlife reserve {n}", "Kantonales Wildschutzgebiet {n}"],
  ["Federal Game Reserve {n}", "Eidgenössisches Jagdbanngebiet {n}"],
  ["Water Bird and Migratory Bird Reserves {n}", "Wasser- und Zugvogelreservat {n}"],
  ["Water and migratory bird reserve {n}", "Wasser- und Zugvogelreservat {n}"],
  ["Wildlife refuge {n}", "Wildruhezone {n}"],
  ["Wildlife rest area {n}", "Wildruhezone {n}"],
  ["Nature reserve {n}", "Naturschutzgebiet {n}"],
  ["Substation {n}", "Unterwerk {n}"],
  ["Power plant {n}", "Kraftwerk {n}"],
  ["Nuclear power plant {n}", "Kernkraftwerk {n}"],
  ["Prison {n}", "Gefängnis {n}"],
  ["{n} \\(Airport perimeter\\)", "{n} (Flugplatzperimeter)"],
  ["{n} Heliport", "Heliport {n}"],
  ["{n} Hospital Heliport", "Spital-Heliport {n}"],
], NAME_RULES);

rules("name-en", [
  ["Aerodrome {n}", "Flugplatz {n}"],
  ["{n} Airport", "Flughafen {n}"],
  ["{n} Airfield", "Flugplatz {n}"],
  ["{n} hospital", "Krankenhaus {n}"],
  ["{n} Hospital", "Krankenhaus {n}"],
  ["{n} - Embassy", "{n} – Botschaft"],
  ["{n} - Residence", "{n} – Residenz"],
  ["{n} Nature Reserve", "Naturschutzgebiet {n}"],
  ["{n} Temples", "Tempel {n}"],
  ["{n} Catacombs", "Katakomben {n}"],
  ["{n} civil protection", "Zivilschutz {n}"],
  ["Control zone \\(CTR {n}\\)", "Kontrollzone (CTR {n})"],
  ["Security area {n}", "Sicherheitsbereich {n}"],
  ["Port of {n}", "Hafen {n}"],
], NAME_RULES);

rules("name-is", [
  ["{n} flugvöllur", "Flugplatz {n}"],
  ["{n} Sendiráð", "Botschaft {n}"],
  ["Fangelsið {n} Fangelsi", "Gefängnis {n}"],
  ["{n} sjúkrahús", "Krankenhaus {n}"],
], NAME_RULES);

rules("name-cz", [
  ["Grid {k:id} {n:id}", "Höhenraster {k} {n}"],
  ["Vnější zóna {n}", "Äußere Zone {n}"],
  ["Vnitřní zóna {n}", "Innere Zone {n}"],
  ["{n} zone {k:id}", "{n} Zone {k}"],
  ["Letiště {n}", "Flugplatz {n}"],
  ["Kasárna {n}", "Kaserne {n}"],
  ["Střelnice {n}", "Schießstand {n}"],
  ["Věznice {n}", "Justizvollzugsanstalt {n}"],
  ["Nemocnice {n}", "Krankenhaus {n}"],
  ["Elektrárna {n}", "Kraftwerk {n}"],
  ["Rozvodna {n}", "Umspannwerk {n}"],
  ["Silnice {n}", "Straße {n}"],
  ["Dálnice {n}", "Autobahn {n}"],
], NAME_RULES);

rules("name-gen", [
  ["{n:name}-{k:bgid}", "{n}-{k}"],
  ["{d} – {x:tr}", "{d} – {x}"],
  ["Aerodrome public de {n}", "Öffentlicher Flugplatz {n}"],
  ["Aérodrome d'{n}", "Flugplatz {n}"],
  ["Aérodrome de {n}", "Flugplatz {n}"],
  ["Hélistation {n}", "Hubschrauberlandeplatz {n}"],
  ["Héliport {n}", "Hubschrauberlandeplatz {n}"],
  ["Hôpital régional {n}", "Regionalspital {n}"],
  ["Hôpital {n}", "Spital {n}"],
  ["Tribunal régional {n}", "Regionalgericht {n}"],
  ["Tribunal {n}", "Gericht {n}"],
  ["Prison {n}", "Gefängnis {n}"],
  ["{n} Helipad", "Hubschrauberlandeplatz {n}"],
  ["{n} Heliport", "Hubschrauberlandeplatz {n}"],
  ["{n} Barracks", "Kaserne {n}"],
  ["{n} - Embassy", "{n} – Botschaft"],
  ["{n} Embassy", "Botschaft {n}"],
  ["{n} - Residence(?: of (?:the )?Ambassador)?", "{n} – Residenz des Botschafters"],
  ["{n} Residence", "Residenz {n}"],
  ["{n} Power Station", "Kraftwerk {n}"],
  ["Power Station", "Kraftwerk"],
  ["{n} Installation", "Anlage {n}"],
  ["{n} Museum", "Museum {n}"],
  ["{n} Prison", "Gefängnis {n}"],
  ["{n} - ZONA URBANA", "{n} – Stadtgebiet"],
  ["{n} - ZONA DE CONTROL", "{n} – Kontrollzone"],
  ["{n} \\(NOTAM {k:id}\\)", "{n} (NOTAM {k})"],
  ["Campo volo modellistico", "Modellflugplatz"],
  ["Parco Nazionale {n}", "Nationalpark {n}"],
  ["Evento {n}", "Veranstaltung {n}"],
  ["{n} - Settore {k:id}", "{n} – Sektor {k}"],
  ["UTR: Reservation from mobile app", "UTR: Reservierung aus der mobilen App"],
  ["TRA: Snimanje iz zraka \\({n}\\)", "TRA: Luftaufnahmen ({n})"],
], NAME_RULES);

rules("name-bg", [
  ["Вертолетно летище {n:name}", "Hubschrauberlandeplatz {n}"],
  ["БВЛ {n:name}", "Hubschrauberlandeplatz (Krankenhaus) {n}"],
], NAME_RULES);

export { rules as __rules, NAME_RULES as __NAME_RULES };
