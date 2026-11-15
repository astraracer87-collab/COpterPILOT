// Vereinigtes Königreich (GB) – Normalisierung der UK-AIP-KML (Google My Maps
// „UK AIP“, von den britischen Behörden bereitgestellt; Inhalt: AIP ENR 5.1
// Danger/Prohibited/Restricted Areas inkl. der drohnenspezifischen
// Flugplatz-FRZ, Gefängnis- und National-Security-Act-Zonen). Siehe
// docs/uk-geozones-integration.md.
//
// Ausgabe: GeoJSON-Features mit den Properties, die parseEd269ToGeozoneInfo in
// client/lib/ed269.ts liest (restriction, name, lowerMeters/upperMeters,
// lowerReference/upperReference, message, extendedProperties.localizedMessages …).
//
// Schema der Quelle (live geprüft 2026-11-15, 1069 Placemarks):
//   - Folder-Name = Gebietsart: Prohibited → PROHIBITED,
//     Restricted → REQ_AUTHORISATION, Danger → CONDITIONAL.
//   - <description> ist CDATA-HTML-Freitext: seitliche Grenzen (DMS), dann
//     „Upper limit: 1000 FT ALT<br>Lower limit: SFC <Bemerkung>…“ und durch
//     Leerzeilen getrennte Abschnitte „Activity:“, „Service:“, „Contact:“,
//     „SUA Authority:“ sowie freie Bemerkungen (FRZ/HMP/NSA, Ausnahmen, SI …).
//   - Geometrie: Polygon; bei 3D-Gebieten MultiGeometry aus zwei identischen
//     Polygonen (Boden/Decke) plus LineStrings. Die LineStrings sind in den
//     Live-Daten ausnahmslos senkrechte Wandkanten A→B→A (nur 2 verschiedene
//     Punkte) – also keine Flächen. Regel: geschlossene LineStrings mit ≥ 3
//     verschiedenen Punkten werden als Polygon übernommen (kmlClosedLineRing),
//     offene/entartete Linien verworfen; doppelte Ringe werden entfernt.
//
// Höhen: SFC/GND = 0 m AGL; „FT ALT“/„FT AMSL“/„FT MSL“ → MSL;
// „FT AGL“/„FT SFC“/„FT GND“ → AGL; FL → STD (Druckhöhe, ft·100); „M“ = Meter;
// UNL = unbegrenzt (keine Obergrenze).
//
// Höhenfilter (Zonen, die für Drohnen nicht erreichbar sind, entfallen):
//   - Untergrenze mit Bezug AGL > 500 ft (152,4 m)  → verworfen
//   - Untergrenze MSL/STD > 3800 m (≈ 12 467 ft, also oberhalb ~FL125) → verworfen
//   (UK-Gelände max. ~1345 m + 120 m Flughöhe liegt weit darunter; die feinere
//   Ausblendung nach Geländehöhe übernimmt die App über lowerReference = MSL.)
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import {
  decodeXmlEntities,
  kmlClosedLineRing,
  parseKmlPlacemarks,
  type KmlCoord,
  type KmlPlacemark,
} from "./geozoneKit/kml";
import { FT_M, normalizeVRef, parseHeight } from "./geozoneKit/heights";
import { round1 } from "./geozoneKit/text";
import { localizedExtendedProperties, messageWithOriginal, pushHints } from "./geozoneKit/messages";

export const GB_GEOZONE_SOURCE_LABEL = "UK AIP (CAA)";
export const GB_ATTRIBUTION = "UK AIP (CAA) – Danger, Prohibited und Restricted Areas";
export const UK_AIP_MAP_ID = "1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d";
/** Unkomprimierte KML (forcekml=1, ~2 MB). */
export const UK_AIP_KML_URL = `https://www.google.com/maps/d/kml?mid=${UK_AIP_MAP_ID}&forcekml=1`;
/** CAA-Kundenportal (ACOMS) für Genehmigungsanträge. */
export const UK_CAA_PORTAL_URL = "https://portal.caa.co.uk";

/** Untergrenze AGL oberhalb davon → nicht drohnenrelevant (500 ft). */
export const UK_MAX_LOWER_AGL_M = 500 * FT_M;
/** Untergrenze MSL/STD oberhalb davon → nicht drohnenrelevant (≈ FL125). */
export const UK_MAX_LOWER_MSL_M = 3800;
/** Seitliche Grenzbeschreibung (DMS-Liste) bis zu dieser Länge in den Originaltext übernehmen. */
const UK_MAX_LATERAL_TEXT = 600;

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

export type UkReference = "AGL" | "MSL" | "STD";

export interface UkLimit {
  /** Meter; undefined bei unbegrenzt. */
  meters?: number;
  unlimited?: boolean;
  reference?: UkReference;
  /** Originalwert in Fuß bzw. Flugfläche (für die Anzeige). */
  feet?: number;
  flightLevel?: number;
  /** Originaltext des Grenzwerts, z. B. "2000 FT ALT". */
  raw: string;
}

// Grenzwert am Textanfang (danach folgt bei „Lower limit“ oft schon die Bemerkung).
const LIMIT_RE =
  /^\s*(?:(SFC|GND)\b|(UNL(?:IMITED)?)\b|FL\s*(\d{1,3})\b|(\d[\d,]*(?:\.\d+)?)\s*(FT|FEET|M)\b\.?(?:\s*(ALT|AMSL|MSL|AGL|SFC|GND)\b)?)/i;

/**
 * Höhenangabe am Anfang eines Textes lesen ("SFC", "2000 FT ALT", "FL100",
 * "UNL", "400 FT AGL", "150 M AMSL"). Gibt den Wert und den Rest zurück.
 */
export function parseUkLimitPrefix(text: string | undefined): { limit: UkLimit | null; rest: string } {
  const s = String(text ?? "");
  const m = s.match(LIMIT_RE);
  if (!m) return { limit: null, rest: s.trim() };
  const raw = m[0].trim();
  const rest = s.slice(m[0].length).replace(/^[\s.]+/, "").trim();
  if (m[1]) return { limit: { meters: 0, reference: "AGL", raw }, rest };
  if (m[2]) return { limit: { unlimited: true, raw }, rest };
  if (m[3]) {
    const fl = Number(m[3]);
    return { limit: { meters: round1(parseHeight(fl, "FL")?.m ?? 0), reference: "STD", flightLevel: fl, raw }, rest };
  }
  const n = Number(m[4].replace(/,/g, ""));
  if (!Number.isFinite(n)) return { limit: null, rest: s.trim() };
  const isFt = !/^M$/i.test(m[5]);
  // Bezug: AGL/SFC/GND → AGL, sonst (ALT/AMSL/MSL bzw. ohne Angabe) MSL.
  const reference: UkReference = normalizeVRef(m[6]).ref === "AGL" ? "AGL" : "MSL";
  const meters = round1(parseHeight(n, isFt ? "ft" : "m")?.m ?? n);
  return { limit: { meters, reference, feet: isFt ? n : undefined, raw }, rest };
}

export function parseUkLimit(text: string | undefined): UkLimit | null {
  return parseUkLimitPrefix(text).limit;
}

function fmtNum(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Deutsche Anzeige eines Grenzwerts. */
export function formatUkLimitDe(l: UkLimit | null | undefined): string {
  if (!l) return "unbekannt";
  if (l.unlimited) return "unbegrenzt";
  if (l.meters === 0) return "Boden (GND)";
  if (l.flightLevel != null) return `FL${l.flightLevel} (≈ ${fmtNum(l.meters ?? 0)} m, Standarddruck)`;
  const base = l.feet != null ? `${fmtNum(l.feet)} ft` : `${fmtNum(l.meters ?? 0)} m`;
  const approx = l.feet != null ? ` (≈ ${fmtNum(l.meters ?? 0)} m)` : "";
  return l.reference === "AGL" ? `${base} über Grund${approx}` : `${base} MSL${approx}`;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** CDATA-HTML → Klartext; Leerzeilen (Abschnittsgrenzen) bleiben erhalten. */
export function ukDescriptionText(html: string | undefined): string {
  if (!html) return "";
  const s = html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(s)
    .replace(/ /g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Wiederkehrende Aktivitäten (alle in den Live-Daten vorkommenden Varianten).
// Schlüssel normalisiert (klein, „&“ → and, ohne Satzzeichen/Klammerkürzel).
const ACTIVITY_DE: Record<string, string> = {
  "ordnance munitions and explosives": "Munition und Sprengstoff",
  "ordnance munitions explosives": "Munition und Sprengstoff",
  "para dropping": "Fallschirmabsprünge",
  "unmanned aircraft system": "Unbemannte Luftfahrzeuge (UAS)",
  "unmanned aircraft systems": "Unbemannte Luftfahrzeuge (UAS)",
  "high energy manoeuvres": "Flugmanöver mit hoher Energie",
  "electronic optical hazards": "Elektronische/optische Gefahren",
  "electrical optical hazards": "Elektrische/optische Gefahren",
  "optical hazards": "Optische Gefahren",
  "electronic hazards": "Elektronische Gefahren",
  "target towing": "Zielschlepp",
  balloons: "Ballone",
  "test and evaluation": "Erprobung und Bewertung",
  "spaceflight activities": "Raumfahrtaktivitäten",
};

function activityKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\((?:uas|ome)\)/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Aktivitäts-Freitext ("A / B / Electronic/Optical Hazards.") → Einzelphrasen. */
export function splitUkActivities(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .split(/\s+\/\s+/)
    .map((p) => p.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

/** Aktivitätsphrase übersetzen (unbekannte bleiben englisch). */
export function translateUkActivity(phrase: string): { de: string; known: boolean } {
  const de = ACTIVITY_DE[activityKey(phrase)];
  return de ? { de, known: true } : { de: phrase, known: false };
}

/** Dienst-/Kontaktzeilen: gängige Floskeln eindeutschen, Namen/Frequenzen bleiben. */
function germanizeServiceText(s: string): string {
  return s
    .replace(/\bwhen open\b/gi, "wenn besetzt")
    .replace(/\bat other times,?\s*/gi, "sonst ")
    .replace(/\bon (\d{3}\.\d{2,3})\b(?!\s*MHz)/g, "auf $1 MHz")
    .replace(/\bon (\d{3}\.\d{2,3})\b/g, "auf $1")
    .replace(/\bvia\b/g, "über")
    .replace(/\bPre-flight information\b/gi, "Vorabinformation")
    .replace(/\bBooking\b/g, "Buchung")
    .replace(/\bRefer to Statutory Instrument\.?/gi, "siehe Statutory Instrument (SI)")
    .replace(/\s+\./g, ".")
    .replace(/\.$/, "")
    .trim();
}

// Satzweise Übersetzung der wiederkehrenden Bemerkungen. null = unbekannt.
type SentenceRule = [RegExp, (m: RegExpMatchArray) => string];

function limitDe(raw: string): string {
  const l = parseUkLimit(raw);
  return l ? formatUkLimitDe(l) : raw.trim();
}

const SENTENCE_RULES: SentenceRule[] = [
  [/^FRZ Active H24\.?$/i, () => "Flugbeschränkungszone (FRZ) des Flugplatzes – durchgehend aktiv (H24)."],
  [/^FRZ and associated RPZs Active H24\.?$/i, () => "Flugbeschränkungszone (FRZ) mit zugehörigen Runway Protection Zones (RPZ) – durchgehend aktiv (H24)."],
  [/^HMP Restricted airspace active H24\.?$/i, () => "Luftraumbeschränkung über einer Justizvollzugsanstalt (HMP) – durchgehend aktiv (H24)."],
  [/^National Security Act \(Prohibited Place\) Restricted Airspace active H24\.?$/i, () => "Luftraumbeschränkung nach dem National Security Act (geschützter Ort) – durchgehend aktiv (H24)."],
  [/^Restricted airspace active H24\.?$/i, () => "Beschränkter Luftraum – durchgehend aktiv (H24)."],
  [/^Unmanned Aircraft Restriction\.?$/i, () => "Beschränkung für unbemannte Luftfahrzeuge."],
  [/^H24\.?$/i, () => "Durchgehend aktiv (H24)."],
  [/^National Police Air Service activity\.?$/i, () => "Flugbetrieb des National Police Air Service (Polizeihubschrauber)."],
  [
    /^Unmanned aircraft flights? not permitted unless permission has been granted by the relevant Air Traffic Service unit or aerodrome operator\.?$/i,
    () => "Flüge mit unbemannten Luftfahrzeugen nur mit Genehmigung der zuständigen Flugverkehrsdienststelle oder des Flugplatzbetreibers.",
  ],
  [
    /^(?:Small )?(?:unmanned aircraft|UAS) flights? (?:is |are )?not permitted (?:unless permission has been granted by|except with the permission of|unless permitted by) (.+?)\.?$/i,
    (m) => `Flüge mit unbemannten Luftfahrzeugen nur mit Genehmigung von: ${germanizeServiceText(m[1])}.`,
  ],
  [
    /^For (?:additional )?contact details( and opening hours)?,? see (UK MIL )?AIP, Part (\d+) ?[-–] ?(Aerodromes|Heliports), Section (AD [\d.]*\d)\.?$/i,
    (m) =>
      `Kontaktdaten${m[1] ? " und Öffnungszeiten" : ""}: siehe ${m[2] ? "UK MIL AIP" : "AIP"} Teil ${m[3]} (${/heli/i.test(m[4]) ? "Hubschrauberlandeplätze" : "Flugplätze"}), Abschnitt ${m[5]}.`,
  ],
  [
    /^ATC must be contacted during opening hours and informed of flights (\d+) hours in advance of operation\.?$/i,
    (m) => `Die Flugverkehrskontrolle (ATC) ist während der Öffnungszeiten zu kontaktieren und ${m[1]} Stunden vor dem Flug zu informieren.`,
  ],
  [
    /^ATC must be contacted during operational hours with a minimum of (\d+) hours notice provided prior to the unmanned aircraft flight within the FRZ\.?$/i,
    (m) => `Die Flugverkehrskontrolle (ATC) ist während der Betriebszeiten mindestens ${m[1]} Stunden vor dem UAS-Flug in der FRZ zu kontaktieren.`,
  ],
  [
    /^Information relating to flight within the FRZ and an on-line application form is available on the aerodrome's website (\S+?)\.?$/i,
    (m) => `Informationen und Online-Antrag für Flüge in der FRZ auf der Webseite des Flugplatzes: ${m[1]}`,
  ],
  [
    /^Exemptions to be sought via NATS Non-Standard Flight \(NSF\) application online\.?$/i,
    () => "Ausnahmen online über einen NATS-Antrag für Non-Standard Flights (NSF) beantragen.",
  ],
  [/^NSF: Online Application: (\S+?)\.?$/i, (m) => `Online-Antrag NATS Non-Standard Flight (NSF): ${m[1]}`],
  [
    /^This coastline definition is a generalisation of the geographic feature; operators must not use this as a definitive boundary/i,
    () => "Die Küstenlinie ist generalisiert und keine verbindliche Grenze – Betreiber müssen selbst sicherstellen, innerhalb bzw. außerhalb des Gebiets zu bleiben.",
  ],
  [
    /^Requests for permission to fly an unmanned aircraft are to be made to (?:the )?(.+?)\.?$/i,
    (m) => `Genehmigungsanfragen für Flüge mit unbemannten Luftfahrzeugen an: ${germanizeServiceText(m[1])}.`,
  ],
  [
    /^Requests are to be made at least (\d+) (hours|working days|days) prior to the intended commencement of (?:a|the) flight\.?$/i,
    (m) => `Anfragen mindestens ${m[1]} ${/hour/i.test(m[2]) ? "Stunden" : /working/i.test(m[2]) ? "Werktage" : "Tage"} vor dem geplanten Flugbeginn stellen.`,
  ],
  [
    /^Permissions? to fly UAS within the Restricted Area (?:are|is) to be obtained from (.+?)\.?$/i,
    (m) => `Genehmigungen für UAS-Flüge im Gebiet über: ${germanizeServiceText(m[1])}.`,
  ],
  [/^Application via CAA Customer Portal ?[-–] ?ACOMS:? ?(\S+?)\.?$/i, (m) => `Antrag über das CAA-Kundenportal (ACOMS): ${m[1]}`],
  [/^AMC ?[-–]? ?Manageable\.?$/i, () => "AMC-verwaltet (Aktivierung/Freigabe über das Luftraummanagement)."],
  [/^AMC ?[-–]? ?Manageable above (.+?)\.?$/i, (m) => `Oberhalb ${limitDe(m[1])} AMC-verwaltet (Luftraummanagement).`],
  [/^ASM Protocols apply\.?$/i, () => "ASM-Verfahren (Luftraummanagement) gelten."],
  [
    /^Vertical Limit:? OCNL notified\s+(?:to altitudes\s+)?(?:up\s+)?(?:to\s+)?(.+?)(?:\s+by NOTAM)?\.?$/i,
    (m) => `Gelegentlich per NOTAM bis ${limitDe(m[1])} erweitert.`,
  ],
  [
    /^Vertical Limit:? ((?:FL ?\d+)|(?:[\d,]+ ?FT(?: ALT| AMSL| AGL)?))(.*?)\.?$/i,
    (m) => {
      const rest = m[2].trim().replace(/^H24$/i, "durchgehend (H24)");
      return `Vertikale Grenze: ${limitDe(m[1])}${rest ? ` – ${rest}` : ""}.`;
    },
  ],
  [/^New SI issued on activation\.?$/i, () => "Bei Aktivierung wird eine neue Rechtsverordnung (SI) erlassen."],
  [
    /^In the event of an emergency which requires airborne assistance the HRA will be cleared of military low flying aircraft\.?$/i,
    () => "Bei Notfällen mit Luftunterstützung wird das Gebiet (HRA) vom militärischen Tiefflug geräumt.",
  ],
  [
    /^When active, entry of non-participating aircraft is prohibited unless flying in accordance with an authori[sz]ation given by (.+?)\.?$/i,
    (m) => `Wenn aktiv: Einflug nicht beteiligter Luftfahrzeuge verboten, außer mit Genehmigung von: ${germanizeServiceText(m[1])}.`,
  ],
  [/^UAS BVLOS will not be conducted above (.+?)\.?$/i, (m) => `UAS-Flüge außerhalb der Sichtweite (BVLOS) des Betreibers finden nicht oberhalb ${limitDe(m[1])} statt.`],
  [/^Contact(?: online)?:? (\S+@\S+?)(?: or (.+?))?\.?$/i, (m) => `Kontakt: ${m[1]}${m[2] ? ` oder ${m[2]}` : ""}.`],
  [/^Contact(?: online)?: (.+?)\.?$/i, (m) => `Kontakt: ${germanizeServiceText(m[1])}.`],
];

/** Einen Satz übersetzen; null, wenn keine Regel passt. */
export function translateUkSentence(sentence: string): string | null {
  const s = sentence.replace(/\s+/g, " ").trim();
  if (!s) return null;
  for (const [re, fn] of SENTENCE_RULES) {
    const m = s.match(re);
    if (m) return fn(m);
  }
  return null;
}

/** Absatz in Sätze teilen (ohne Lookbehind – Hermes-kompatibel). */
function sentences(paragraph: string): string[] {
  return paragraph
    .replace(/\s*\n\s*/g, " ")
    .replace(/([.;])\s+(?=[A-Z(])/g, "$1\u0000")
    .split("\u0000")
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Beschreibung zerlegen
// ---------------------------------------------------------------------------

export interface UkParsedDescription {
  lateral: string;
  upper: UkLimit | null;
  lower: UkLimit | null;
  activities: string[];
  service?: string;
  contact?: string;
  authority?: string;
  /** Rechtsgrundlagen (SI …). */
  legal: string[];
  siteElevation?: UkLimit | null;
  emails: string[];
  urls: string[];
  /** Freie Bemerkungen (englisch), absatzweise. */
  remarks: string[];
  /** Englischer Behördentext ab „Upper limit“ (ohne Koordinatenliste). */
  englishText: string;
}

const SECTION_RE = /^(Activity|Service|Contact(?: online)?|SUA Authority|Danger Area Authority|SUAAIS|SUACS|SUACS \/ SUAAIS)\s*:\s*/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\bhttps?:\/\/[^\s)<>,]+[^\s)<>,.]/g;

export function parseUkDescription(html: string | undefined): UkParsedDescription {
  const text = ukDescriptionText(html);
  const out: UkParsedDescription = {
    lateral: "",
    upper: null,
    lower: null,
    activities: [],
    legal: [],
    emails: [],
    urls: [],
    remarks: [],
    englishText: "",
  };
  const upIdx = text.search(/Upper limit\s*:/i);
  out.lateral = (upIdx >= 0 ? text.slice(0, upIdx) : text).trim();
  if (upIdx < 0) return out;
  const vertical = text.slice(upIdx);
  out.englishText = vertical;

  const upM = vertical.match(/Upper limit\s*:\s*([^\n]*)/i);
  out.upper = parseUkLimit(upM?.[1]);
  const loIdx = vertical.search(/Lower limit\s*:/i);
  let body = "";
  if (loIdx >= 0) {
    const afterLower = vertical.slice(loIdx).replace(/^Lower limit\s*:\s*/i, "");
    const { limit, rest } = parseUkLimitPrefix(afterLower);
    out.lower = limit;
    body = rest;
  }

  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const services: string[] = [];
  const contacts: string[] = [];
  for (const para of paragraphs) {
    const sec = para.match(SECTION_RE);
    if (sec) {
      const label = sec[1].toLowerCase();
      const value = para.slice(sec[0].length).replace(/\s*\n\s*/g, " ").trim();
      if (label === "activity") {
        out.activities.push(...splitUkActivities(value));
      } else if (label.startsWith("contact")) {
        contacts.push(value);
      } else if (label.endsWith("authority")) {
        out.authority = value.replace(/\.$/, "");
      } else if (label === "service") {
        services.push(value);
      } else {
        services.push(`${sec[1]}: ${value}`);
      }
      continue;
    }
    // Absätze ohne Abschnittsetikett: zeilenweise (HMP/NSA-Zonen stehen ohne Leerzeilen).
    const remarkLines: string[] = [];
    for (const line of para.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      const elev = l.match(/^Site elevation\s*:\s*(.+)$/i);
      if (elev) {
        out.siteElevation = parseUkLimit(elev[1]);
        continue;
      }
      const mail = l.match(/^(.{2,60}?)\s+email\s*:\s*(\S+@\S+)$/i);
      if (mail) {
        contacts.push(`${mail[1].trim()}: ${mail[2]}`);
        continue;
      }
      if (/^(?:Guernsey )?SI\b[\s:]/.test(l) && l.length <= 120 && !/permitted/i.test(l)) {
        out.legal.push(l.replace(/^SI\s*:\s*/, "").replace(/\.$/, ""));
        continue;
      }
      if (/^\d{3,4}\/\d{4}\.?$/.test(l) && out.legal.length > 0) {
        out.legal[out.legal.length - 1] += ` ${l.replace(/\.$/, "")}`;
        continue;
      }
      remarkLines.push(l);
    }
    if (remarkLines.length > 0) out.remarks.push(remarkLines.join("\n"));
  }
  // Rechtsgrundlagen auch mitten im Text („… SI 1980/949.“) erfassen.
  for (const r of out.remarks) {
    for (const m of r.matchAll(/\b(?:Guernsey )?SI \d{1,4}\/\d{3,4}(?: \d{1,4}\/\d{4})*/g)) {
      if (!out.legal.some((x) => x.includes(m[0].replace(/^Guernsey /, "")))) out.legal.push(m[0]);
    }
  }
  if (services.length) out.service = services.join(" ");
  if (contacts.length) out.contact = contacts.join(" ");
  out.emails = [...new Set(vertical.match(EMAIL_RE) ?? [])];
  out.urls = [...new Set(vertical.match(URL_RE) ?? [])];
  return out;
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

export type UkFolder = "Danger" | "Prohibited" | "Restricted";

export type UkFeature = { type: "Feature"; id?: string; geometry: any; properties: Record<string, any> };

export type UkDropReason = "no_geometry" | "lower_agl" | "lower_msl" | "unknown_folder";

export interface UkNormalizeResult {
  features: UkFeature[];
  dropped: { name: string; reason: UkDropReason; lower?: string }[];
}

const RESTRICTION_BY_FOLDER: Record<UkFolder, "PROHIBITED" | "REQ_AUTHORISATION" | "CONDITIONAL"> = {
  Prohibited: "PROHIBITED",
  Restricted: "REQ_AUTHORISATION",
  Danger: "CONDITIONAL",
};

const TYPE_DE: Record<UkFolder, string> = {
  Prohibited: "Sperrgebiet (Prohibited Area, AIP ENR 5.1)",
  Restricted: "Flugbeschränkungsgebiet (Restricted Area, AIP ENR 5.1)",
  Danger: "Gefahrengebiet (Danger Area, AIP ENR 5.1)",
};

function ukFolder(pm: KmlPlacemark): UkFolder | null {
  for (const f of [...pm.folders].reverse()) {
    const k = f.trim().toLowerCase();
    if (k.startsWith("prohibited")) return "Prohibited";
    if (k.startsWith("restricted")) return "Restricted";
    if (k.startsWith("danger")) return "Danger";
  }
  // Rückfall: Kennung EGP/EGR/EGD im Namen.
  const m = (pm.name ?? "").match(/^EG([PRD])/i);
  if (m) return m[1].toUpperCase() === "P" ? "Prohibited" : m[1].toUpperCase() === "R" ? "Restricted" : "Danger";
  return null;
}

function ringKey(r: KmlCoord[]): string {
  return r.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(" ");
}

/** Polygone (inkl. geschlossener LineStrings), doppelte Ringe entfernt → GeoJSON. */
export function ukPlacemarkGeometry(pm: KmlPlacemark): { type: "Polygon" | "MultiPolygon"; coordinates: any } | null {
  const polys: KmlCoord[][][] = pm.polygons.map((p) => p.rings);
  for (const line of pm.lineStrings ?? []) {
    const ring = kmlClosedLineRing(line);
    if (ring) polys.push([ring]);
  }
  const seen = new Set<string>();
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const out: number[][][][] = [];
  for (const rings of polys) {
    const key = rings.map(ringKey).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rings.map((r) => r.map((c) => [round(c[0]), round(c[1])])));
  }
  if (out.length === 0) return null;
  return out.length === 1 ? { type: "Polygon", coordinates: out[0] } : { type: "MultiPolygon", coordinates: out };
}

function designatorOf(name: string): string | undefined {
  const m = name.match(/^(EG[DPR][0-9A-Z]+)\b/i);
  return m ? m[1].toUpperCase() : undefined;
}

/** Deutsche, strukturierte Beschreibung + englischer Originaltext. */
export function buildUkMessageDe(folder: UkFolder, d: UkParsedDescription, isFrz: boolean): string {
  const lines: string[] = [];
  lines.push(`Typ: ${isFrz ? "Flugbeschränkungszone (FRZ) um einen Flugplatz – Restricted Area" : TYPE_DE[folder]}`);
  lines.push(`Höhe laut AIP: ${formatUkLimitDe(d.lower)} bis ${formatUkLimitDe(d.upper)}`);
  if (d.activities.length > 0) {
    const de = [...new Set(d.activities.map((a) => translateUkActivity(a).de))];
    lines.push(`Aktivität: ${de.join(", ")}`);
  }
  const hints: string[] = [];
  let untranslated = false;
  let exemptions = false;
  for (const para of d.remarks) {
    for (const s of sentences(para)) {
      const de = translateUkSentence(s);
      if (de) {
        if (!hints.includes(de)) hints.push(de);
      } else if (/^(?:Flight|Flights) (?:is )?(?:not )?permitted\b/i.test(s)) {
        exemptions = true;
      } else if (/^(?:Guernsey )?SI\b/.test(s)) {
        // Rechtsgrundlage – separat ausgegeben
      } else {
        untranslated = true;
      }
    }
  }
  if (exemptions) hints.push("Ausnahmen bzw. Bedingungen für bestimmte Flüge (z. B. Behörden, Rettungsdienste, mit Erlaubnis) – Wortlaut im Originaltext.");
  if (untranslated) hints.push("Weitere Bestimmungen nur im englischen Originaltext (siehe unten).");
  pushHints(lines, hints);
  if (d.service) lines.push(`Funk/Dienst: ${germanizeServiceText(d.service)}`);
  if (d.contact) lines.push(`Kontakt: ${germanizeServiceText(d.contact)}`);
  if (d.authority) lines.push(`Zuständig: ${d.authority}`);
  if (d.legal.length > 0) lines.push(`Rechtsgrundlage: ${[...new Set(d.legal)].join(", ")}`);
  if (d.siteElevation && d.siteElevation.meters != null) {
    lines.push(`Geländehöhe am Standort: ${formatUkLimitDe({ ...d.siteElevation, reference: "MSL" })}`);
  }
  lines.push(`Quelle: ${GB_GEOZONE_SOURCE_LABEL} – nur zur Information, nicht zur Navigation. Kurzfristige Beschränkungen (NOTAMs) und aktuelle Aktivierungen sind in dieser Karte nicht enthalten – vor dem Flug zusätzlich prüfen.`);
  // Seitliche Grenzen (Koordinatenliste) nur, wenn kurz – lange Listen zeigt die Karte.
  const original = [d.lateral && d.lateral.length <= UK_MAX_LATERAL_TEXT ? d.lateral : "", d.englishText].filter(Boolean).join("\n");
  return messageWithOriginal(lines, original);
}

export interface UkNormalizeOptions {
  /** Untergrenzen-Schwellen überschreiben (Meter). */
  maxLowerAglMeters?: number;
  maxLowerMslMeters?: number;
}

/** Einzelnen Placemark normalisieren; liefert Feature oder Verwerfungsgrund. */
export function normalizeUkPlacemark(
  pm: KmlPlacemark,
  opts: UkNormalizeOptions = {},
): { feature: UkFeature } | { dropped: UkDropReason; lower?: string } {
  const folder = ukFolder(pm);
  if (!folder) return { dropped: "unknown_folder" };
  const geometry = ukPlacemarkGeometry(pm);
  if (!geometry) return { dropped: "no_geometry" };
  const d = parseUkDescription(pm.description);

  const lowerMeters = d.lower?.meters ?? 0;
  const lowerRef: UkReference = d.lower?.reference ?? "AGL";
  const maxAgl = opts.maxLowerAglMeters ?? UK_MAX_LOWER_AGL_M;
  const maxMsl = opts.maxLowerMslMeters ?? UK_MAX_LOWER_MSL_M;
  if (lowerRef === "AGL" && lowerMeters > maxAgl) return { dropped: "lower_agl", lower: d.lower?.raw };
  if (lowerRef !== "AGL" && lowerMeters > maxMsl) return { dropped: "lower_msl", lower: d.lower?.raw };

  const name = (pm.name ?? "").replace(/\s+/g, " ").trim() || designatorOf(pm.name ?? "") || "Geozone";
  const designator = designatorOf(name);
  const isFrz = /\bFRZ\b/.test(d.englishText);
  const message = buildUkMessageDe(folder, d, isFrz);

  const props: Record<string, any> = {
    identifier: designator ?? name,
    name,
    restriction: RESTRICTION_BY_FOLDER[folder],
    lowerMeters,
    lowerReference: lowerRef,
    upperReference: d.upper?.reference ?? (d.upper?.unlimited ? "MSL" : "AGL"),
    message,
    extendedProperties: localizedExtendedProperties(message, d.englishText, "en"),
    country: "GBR",
    source: GB_GEOZONE_SOURCE_LABEL,
    ukZoneType: folder,
    ukFrz: isFrz || undefined,
    ukLowerLimit: d.lower?.raw,
    ukUpperLimit: d.upper?.raw,
  };
  if (d.upper?.meters != null) props.upperMeters = d.upper.meters;
  if (d.activities.length > 0) props.ukActivities = d.activities;
  if (d.authority) props.ukAuthority = d.authority;
  const email = d.emails[0];
  if (email) props.contactEmail = email;
  const portal = d.urls.find((u) => /portal\.caa\.co\.uk|airportal\.aero/i.test(u));
  if (portal) {
    props.applicationUrl = portal;
    props.applicationUrlLabel = /caa\.co\.uk/i.test(portal) ? "Antrag (CAA-Portal ACOMS)" : "Antrag (Air Portal)";
  }
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { feature: { type: "Feature", id: String(props.identifier), geometry, properties: props } };
}

/** Placemarks → Features + Liste der verworfenen Zonen (mit Grund). */
export function normalizeUkPlacemarks(pms: KmlPlacemark[], opts: UkNormalizeOptions = {}): UkNormalizeResult {
  const features: UkFeature[] = [];
  const dropped: UkNormalizeResult["dropped"] = [];
  const ids = new Map<string, number>();
  for (const pm of pms) {
    const r = normalizeUkPlacemark(pm, opts);
    if ("dropped" in r) {
      dropped.push({ name: pm.name ?? "?", reason: r.dropped, lower: r.lower });
      continue;
    }
    // Kennungen eindeutig halten (falls ein Gebiet mehrfach vorkommt).
    const id = String(r.feature.properties.identifier);
    const n = (ids.get(id) ?? 0) + 1;
    ids.set(id, n);
    if (n > 1) {
      r.feature.properties.identifier = `${id}#${n}`;
      r.feature.id = `${id}#${n}`;
    }
    features.push(r.feature);
  }
  return { features, dropped };
}

/** KML-Text → Features + Verwerfungsstatistik. */
export function normalizeUkKmlWithStats(kml: string, opts: UkNormalizeOptions = {}): UkNormalizeResult {
  return normalizeUkPlacemarks(parseKmlPlacemarks(kml), opts);
}

/** KML-Text → normalisierte Features. */
export function normalizeUkKml(kml: string, opts: UkNormalizeOptions = {}): UkFeature[] {
  return normalizeUkKmlWithStats(kml, opts).features;
}
