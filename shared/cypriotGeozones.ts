// Zypern (CY) – Normalisierung der Drohnen-Geozonen des Department of Civil
// Aviation / AMC Cyprus (drones.gov.cy, ArcGIS-Online-WebMap
// „CYPRUS GEO ZONES MAP ver09T2“). Siehe docs/cyprus-dca-api-integration.md.
//
// Ausgabe: GeoJSON-Features mit den Properties, die parseEd269ToGeozoneInfo in
// client/lib/ed269.ts liest (restriction, name, lowerMeters/upperMeters,
// lowerReference/upperReference, message, extendedProperties.localizedMessages,
// applicationUrl, infoUrl, contactEmail …).
//
// Quelle (live geprüft 2026-11-15):
//   FeatureServer …/UAV_areas_WFL1/FeatureServer – Sublayer laut ?f=json:
//     12  „Polygons“             141 Zonen (Polygon)  ← EINZIGER Layer der WebMap
//     204 „PIB_XML“              57 NOTAM-Datensätze (kein Geozonen-Layer, entfällt)
//     2   „GSP_stadium version 1“ 1 Punkt ohne Attribute (nicht in der WebMap)
//     3   „GSP_stadium_Buffer1“   1 Puffer 5 km um das GSP-Stadion (nicht in der WebMap)
//   Schema „KML-Import-Stil“: OBJECTID, Name („001 - Αγκυροβόλιο Μονής“),
//   FolderPath („CYPRUS GEO ZONES MAP ver09T2/RESTRICTED ZONES“), SymbolID
//   (nur Kartensymbol), PopupInfo (griechisches HTML, Zeilen mit <br>),
//   AltMode/Base/Clamped/Extruded (überall 0/0/-1/0 → keine Höhen),
//   Shape__Area/Shape__Length.
//
// Beschränkung (FolderPath, alle Live-Werte; Unterordner wie
// „RESTRICTED ZONES/014 - ΑΗΚ - Η“ entstehen aus „/“ im Zonennamen „Η/Σ“):
//
//   | FolderPath-Kategorie        | Anzahl | restriction        |
//   |-----------------------------|--------|--------------------|
//   | PROHIBITED ZONES            |     28 | PROHIBITED         |
//   | RESTRICTED ZONES (+ Unterordner) | 113 | REQ_AUTHORISATION |
//   | AUTHORI[SZ]ATION …          |      0 | REQ_AUTHORISATION  |
//   | DANGER / CONDITIONAL …      |      0 | CONDITIONAL        |
//   | unbekannt / fehlt           |      0 | REQ_AUTHORISATION (vorsichtiger Default) |
//
// Vorsichtsregel: Die strengere Angabe gewinnt. „Όροι Πρόσβασης: ΑΠΑΓΟΡΕΥΜΕΝΗ
// ΠΕΡΙΟΧΗ“ oder der Satz „Απαγορεύονται οι πτήσεις ΣμηΕΑ …“ (UAS-Flüge
// verboten) hebt eine Zone auf PROHIBITED an (live: 098 Ausreisezentrum
// „Limnes“ – Ordner RESTRICTED, Text verbietet UAS-Flüge). Ergebnis live:
// PROHIBITED 29, REQ_AUTHORISATION 112.
//
// Höhen: Der Datensatz enthält (live) keine Höhenangaben. Falls PopupInfo künftig
// Höhen nennt (ft/m, AGL/AMSL, SFC/GND, griechisch πόδια/μέτρα, „από το
// έδαφος“, „ΜΣΘ“), werden sie gelesen; sonst gilt die Zone ab Boden ohne
// Obergrenze (lowerMeters 0 AGL, kein upperMeters).
//
// Texte: Die Etiketten (Διαχειριστής Ζώνης, Τηλέφωνο Επικοινωνίας, …), alle
// wiederkehrenden Sätze und Behörden-/Funktionsbezeichnungen werden über ein
// eingebautes Wörterbuch ins Deutsche übertragen; Personen- und Ortsnamen
// werden transliteriert (ELOT 743, gängige Exonyme wie Nikosia/Limassol/
// Larnaka/Paphos/Famagusta). Der vollständige griechische Originaltext steht
// unter „Originaltext der Behörde:“.
//
// Geometrie: unverändert (volle Präzision, keine Vereinfachung).
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar); keine
// Lookbehinds und keine \p{…}-Klassen (Hermes-kompatibel).
import { decodeXmlEntities } from "./geozoneKit/kml";
import { parseHeight } from "./geozoneKit/heights";
import { round1 } from "./geozoneKit/text";
import { arcgisPage, arcgisQueryUrl } from "./geozoneKit/arcgis";
import {
  NO_HEIGHT_LINE_DE,
  heightLineDe,
  localizedExtendedProperties,
  messageWithOriginal,
  pushHints,
  sourceLineDe,
} from "./geozoneKit/messages";

export const CY_GEOZONE_SOURCE_LABEL = "DCA Cyprus (AMC)";
export const CY_GEOZONE_ATTRIBUTION = "© Department of Civil Aviation, Cyprus";
export const CY_FEATURE_SERVER =
  "https://services9.arcgis.com/1oNBJ7Sv4IbovWiG/arcgis/rest/services/UAV_areas_WFL1/FeatureServer";
/** Zonen-Layer („Polygons“) – einziger Layer der offiziellen WebMap. */
export const CY_ZONES_LAYER_ID = 12;
export const CY_ZONES_LAYER_URL = `${CY_FEATURE_SERVER}/${CY_ZONES_LAYER_ID}`;
/** UAS-Portal der DCA Cyprus. */
export const CY_DRONES_PORTAL_URL = "https://drones.gov.cy";

export type CyRestriction = "PROHIBITED" | "REQ_AUTHORISATION" | "CONDITIONAL";

// ---------------------------------------------------------------------------
// Griechisch: Akzente, Transliteration
// ---------------------------------------------------------------------------

const ACCENTS: Record<string, string> = {
  ά: "α", έ: "ε", ή: "η", ί: "ι", ό: "ο", ύ: "υ", ώ: "ω", ΐ: "ϊ", ΰ: "ϋ",
  Ά: "Α", Έ: "Ε", Ή: "Η", Ί: "Ι", Ό: "Ο", Ύ: "Υ", Ώ: "Ω",
};
const DIAERESIS: Record<string, string> = { ϊ: "ι", ϋ: "υ", Ϊ: "Ι", Ϋ: "Υ" };

/** Tonos entfernen (Diärese bleibt – wichtig für die Transliteration). */
export function stripGreekAccents(s: string): string {
  return s.replace(/[άέήίόύώΐΰΆΈΉΊΌΎΏ]/g, (c) => ACCENTS[c] ?? c);
}

/** Vergleichsschlüssel: ohne Tonos und Diärese. */
function greekLoose(s: string): string {
  return stripGreekAccents(s).replace(/[ϊϋΪΫ]/g, (c) => DIAERESIS[c] ?? c);
}

const GR_SINGLE: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k",
  λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t",
  υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o", ϊ: "i", ϋ: "y",
};
// Nach αυ/ευ/ηυ: „v“ vor Vokalen und stimmhaften Konsonanten, sonst „f“.
const VOICED_AFTER_U = "αεηιουωϊϋβγδζλμνρ";
const GREEK_RUN = /[\u0370-\u03FF\u1F00-\u1FFF]+/g;

function translitGreekRun(run: string): string {
  const src = stripGreekAccents(run);
  const lower = src.toLowerCase();
  const letters = src.replace(/[^\u0370-\u03FF]/g, "");
  const allCaps = letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  let out = "";
  const emit = (latin: string, srcIdx: number) => {
    const ch = src[srcIdx];
    const isUpper = ch !== ch.toLowerCase();
    if (allCaps) out += latin.toUpperCase();
    else if (isUpper) out += latin.charAt(0).toUpperCase() + latin.slice(1);
    else out += latin;
  };
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i];
    const n = lower[i + 1] ?? "";
    if (!(c in GR_SINGLE)) {
      out += src[i];
      continue;
    }
    const two = c + n;
    let latin: string | null = null;
    if (two === "ου") latin = "ou";
    else if (two === "αι" || two === "ει" || two === "οι" || two === "υι") latin = GR_SINGLE[c] + "i";
    else if ((c === "α" || c === "ε" || c === "η") && n === "υ") {
      const nn = lower[i + 2] ?? "";
      latin = GR_SINGLE[c] + (nn && VOICED_AFTER_U.includes(nn) ? "v" : "f");
    } else if (two === "μπ") latin = i === 0 ? "b" : "mp";
    else if (two === "ντ") latin = i === 0 ? "d" : "nt";
    else if (two === "γγ") latin = "ng";
    else if (two === "γκ") latin = i === 0 ? "g" : "gk";
    else if (two === "γξ") latin = "nx";
    else if (two === "γχ") latin = "nch";
    if (latin !== null) {
      emit(latin, i);
      i++;
      continue;
    }
    emit(GR_SINGLE[c], i);
  }
  return out;
}

/** Griechische Buchstaben in Lateinschrift (ELOT 743, vereinfacht); Rest bleibt. */
export function transliterateGreek(s: string): string {
  return String(s ?? "").replace(GREEK_RUN, (run) => translitGreekRun(run));
}

/** Enthält der Text (noch) griechische Buchstaben? */
export function hasGreek(s: string): boolean {
  return /[\u0370-\u03FF\u1F00-\u1FFF]/.test(s);
}

// ---------------------------------------------------------------------------
// Wörterbuch (Phrasen → Deutsch). Schlüssel mit Akzenten notiert; verglichen
// wird ohne Tonos/Diärese und ohne Groß-/Kleinschreibung.
// ---------------------------------------------------------------------------

type PhraseRule = { re: RegExp; de: string };

const WORD = "A-Za-z0-9\\u0370-\\u03FF\\u1F00-\\u1FFF";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePhrases(entries: [string, string][]): PhraseRule[] {
  return [...entries]
    .sort((a, b) => greekLoose(b[0]).length - greekLoose(a[0]).length)
    .map(([gr, de]) => {
      const key = escapeRe(greekLoose(gr)).replace(/\s+/g, "\\s*");
      const startBoundary = /^[A-Za-z0-9\u0370-\u03FF]/.test(gr) ? `(^|[^${WORD}])` : "()";
      const endBoundary = /[A-Za-z0-9\u0370-\u03FF]$/.test(gr) ? `(?=$|[^${WORD}])` : "";
      return { re: new RegExp(`${startBoundary}(${key})${endBoundary}`, "gi"), de };
    });
}

function applyPhrases(text: string, rules: PhraseRule[]): string {
  let s = greekLoose(text);
  for (const r of rules) s = s.replace(r.re, (_m, pre: string) => `${pre}${r.de}`);
  return s;
}

// Ortsnamen: gängige deutsche Exonyme bzw. Nominativ-Formen statt Genitiv.
const PLACE_ENTRIES: [string, string][] = [
  ["Λευκωσίας", "Nikosia"], ["Λευκωσία", "Nikosia"],
  ["Λεμεσού", "Limassol"], ["Λεμεσός", "Limassol"],
  ["Λάρνακας", "Larnaka"], ["Λάρνακα", "Larnaka"],
  ["Πάφου", "Paphos"], ["Πάφος", "Paphos"],
  ["Αμμοχώστου", "Famagusta"], ["Αμμόχωστος", "Famagusta"],
  ["Κερύνειας", "Kyrenia"], ["Μόρφου", "Morphou"],
  ["Τροόδους", "Troodos"], ["Κύπρου", "Zyperns"],
  ["Αγίας Νάπας", "Agia Napa"], ["Αγίου Δομετίου", "Agios Dometios"],
  ["Γερμασόγειας", "Germasogeia"], ["Λακατάμιας", "Lakatamia"],
  ["Ορόκλινης", "Oroklini"], ["Περιστερώνας", "Peristerona"],
  ["Πέρα Χωρίου Νήσου", "Pera Chorio Nisou"], ["Μενόγειας", "Menogeia"],
  ["Βασιλικού", "Vasiliko"], ["Ζυγίου", "Zygi"], ["Μονής", "Moni"],
  ["Δεκέλια", "Dekelia"], ["Ακουρσού", "Akoursos"],
];

// Zonennamen: Gattungsbegriffe (Eigennamen werden danach transliteriert).
const NAME_ENTRIES: [string, string][] = [
  ...PLACE_ENTRIES,
  ["Αγκυροβόλιο", "Ankerplatz"],
  ["ΑΗΚ - Η/Σ", "EAC-Kraftwerk"],
  ["ΑΗΚ- Η/Σ", "EAC-Kraftwerk"],
  ["ΑΗΚ -", "EAC-Anlage"],
  ["ΑΗΚ-", "EAC-Anlage"],
  ["ΑΗΚ", "EAC-Anlage"],
  ["Η/Σ", "Kraftwerk"],
  ["ΚΤΥ", "KTY"],
  ["Ζώνη", "Zone"],
  ["Δρόμος", "Straße"],
  ["Γενικό Νοσοκομείο", "Allgemeines Krankenhaus"],
  ["Διεθνής Αερολιμένας", "Internationaler Flughafen"],
  ["Δορυφορικός Σταθμός", "Satellitenbodenstation"],
  ["Κεντρικές Φυλακές", "Zentralgefängnis"],
  ["Λιμάνι", "Hafen"],
  ["Οικία Προέδρου Βουλής", "Residenz des Parlamentspräsidenten"],
  ["Πρεσβεία - Βρετανική Ύπατη Αρμοστεία", "Botschaft – Britische Hochkommission"],
  ["Πρεσβεία Αιγύπτου", "Botschaft Ägyptens"],
  ["Πρεσβεία ΗΠΑ", "Botschaft der USA"],
  ["Πρεσβεία Ιράν", "Botschaft Irans"],
  ["Πρεσβεία Ισραήλ", "Botschaft Israels"],
  ["Πρεσβεία Κατάρ", "Botschaft Katars"],
  ["Πρεσβεία Λαικής Δημοκρατίας Κίνας", "Botschaft der Volksrepublik China"],
  ["Πρεσβεία Ρωσίας", "Botschaft Russlands"],
  ["Πρεσβεία Ελλάδας", "Botschaft Griechenlands"],
  ["Πρεσβεία", "Botschaft"],
  ["Προαναχωρησιακό κέντρο", "Ausreisezentrum"],
  ["Προεδρική Κατοικία", "Präsidentenresidenz"],
  ["Διεύθυνση Υπηρεσιών Ψυχικής Υγείας", "Direktion der psychiatrischen Dienste"],
  ["Παλαιά ΑΔΕ", "Ehemalige Polizeidirektion"],
  ["ΑΔΕ", "Polizeidirektion"],
  ["Αρχηγείο Αστυνομίας", "Polizeipräsidium"],
  ["Κεντρικός Αστυν. Σταθμός", "Zentrale Polizeiwache"],
  ["Αστυν. Σταθμός", "Polizeiwache"],
  ["Αστυνομικός Σταθμός", "Polizeiwache"],
  ["Βουλή των Αντιπροσώπων", "Repräsentantenhaus (Parlament)"],
  ["Ενεργειακό Κέντρο", "Energiezentrum"],
  ["Κρατητήρια", "Haftanstalt"],
  ["Κτίριο Δ.Ε.Ε. & Δ.Α.Σ.", "Gebäude der Polizei-Direktion EU-Angelegenheiten und internationale Polizeizusammenarbeit (D.E.E. & D.A.S.)"],
  ["Προεδρικό Μέγαρο", "Präsidentenpalast"],
];

// Zonenverwalter: Behörden und Funktionsbezeichnungen (Personennamen → Transliteration).
const MANAGER_ENTRIES: [string, string][] = [
  ...PLACE_ENTRIES,
  ["Αρχή Λιμένων Κύπρου", "Hafenbehörde Zyperns (CPA)"],
  ["Γενικό Επιτελείο Εθνικής Φρουράς", "Generalstab der Nationalgarde"],
  ["Διεύθυνση Στρατιωτικών Πληροφοριών", "Direktion Militärischer Nachrichtendienst"],
  ["ΥΠΕΞ", "Außenministerium (MFA)"],
  ["Υπηρεσία ΣμηΕΑ", "UAS-Dienststelle"],
  ["ΤΠΑ", "Abteilung Zivilluftfahrt (DCA)"],
  ["Αστυνομικός Διευθυντής Επαρχίας", "Polizeidirektor des Bezirks"],
  ["Αστυνομικός Διευθυντής Τμήματος Διοίκησης και Ανθρώπινου Δυναμικού", "Polizeidirektor der Abteilung Verwaltung und Personal"],
  ["Αστυνομικός Διευθυντής Τμήματος Διοίκησης και Ανθρώπινου Δυναμικο", "Polizeidirektor der Abteilung Verwaltung und Personal"],
  ["Διοικητής ΜΜΑΔ", "Kommandant der Sondereinsatzeinheit (MMAD/ERU)"],
  ["Διοικητής Υπηρεσίας Αλλοδαπών & Μετανάστευσης", "Leiter des Dienstes für Ausländer und Migration"],
  ["Διευθυντής Δ.Ε.Ε. & Δ.Α.Σ.", "Direktor der Polizei-Direktion EU-Angelegenheiten und internationale Polizeizusammenarbeit (D.E.E. & D.A.S.)"],
  ["Διοικητής Μονάδας Προεδρικής Φρουράς", "Kommandant der Präsidentengarde"],
  ["Βοηθός Διευθυντής Δίκτυα", "stellv. Direktor Netze"],
  ["Β. Τοπογράφος Μηχανικός", "Vermessungsingenieur"],
];

// Genehmigungsstellen in den Bestimmungen.
const AUTHORITY_ENTRIES: [string, string][] = [
  ...PLACE_ENTRIES,
  ["Α.Η.Κ.", "Elektrizitätsbehörde Zyperns (EAC)"],
  ["Α.Η.Κ", "Elektrizitätsbehörde Zyperns (EAC)"],
  ["ΑΗΚ", "Elektrizitätsbehörde Zyperns (EAC)"],
  ["αρχή Λιμένων", "Hafenbehörde Zyperns (CPA)"],
  ["Αρχή Λιμένων Κύπρου", "Hafenbehörde Zyperns (CPA)"],
  ["ΥΠΕΞ", "Außenministerium (MFA)"],
  ["ΟΚΥπΥ", "Staatliche Gesundheitsdienste-Organisation (OKYpY/SHSO)"],
  ["CYTA", "CYTA (Telekommunikationsbehörde Zyperns)"],
  ["Τμήμα Κεντρικών Φυλακών", "Abteilung Zentralgefängnisse"],
  ["Φρουρά του Προέδρου της Βουλής", "Wache des Parlamentspräsidenten"],
  ["Προεδρική Φρουρά", "Präsidentengarde"],
  ["Διαχειριστή", "Zonenverwalter"],
  ["Διαχειριστής Ζώνης", "Zonenverwalter"],
  ["ΤΠΑ", "Abteilung Zivilluftfahrt (DCA)"],
];

const NAME_RULES = compilePhrases(NAME_ENTRIES);
const MANAGER_RULES = compilePhrases(MANAGER_ENTRIES);
const AUTHORITY_RULES = compilePhrases(AUTHORITY_ENTRIES);
const AUTHORITY_KEYS = new Set(AUTHORITY_ENTRIES.map(([gr]) => greekLoose(gr).toUpperCase().replace(/[\s.]+/g, "")));

function tidy(s: string): string {
  return s
    .replace(/«\s*/g, "„")
    .replace(/\s*»/g, "“")
    .replace(/\s+-\s+/g, " – ")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Zonennamen ins Deutsche: „001 - Αγκυροβόλιο Μονής“ → „001 – Ankerplatz Moni“. */
export function translateCyZoneName(name: string): string {
  const raw = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const m = raw.match(/^(\d{1,4})\s*-\s*(.*)$/);
  const num = m ? m[1] : "";
  let rest = m ? m[2] : raw;
  // „ΕΦ001“ = Anlage der Nationalgarde (Εθνική Φρουρά).
  rest = rest.replace(/(^|[^A-Za-z0-9\u0370-\u03FF])ΕΦ\s*(\d{2,4})/g, "$1Nationalgarde EF$2");
  // Abschnittsbuchstabe am Ende („… - Β“) ist ein Kennbuchstabe, kein Wort: Α/Β → A/B.
  rest = rest.replace(/\s-\s*([ΑΒ])$/, (_m, l: string) => ` - ${l === "Α" ? "A" : "B"}`);
  const de = tidy(transliterateGreek(applyPhrases(rest, NAME_RULES)));
  return num ? `${num} – ${de}` : de;
}

/** Zonenverwalter (Behörden übersetzt, Personennamen transliteriert). */
export function translateCyManager(text: string): string {
  return tidy(transliterateGreek(applyPhrases(text, MANAGER_RULES)));
}

/** Genehmigungsstelle aus einem Satz übersetzen. */
export function translateCyAuthority(text: string): string {
  return tidy(transliterateGreek(applyPhrases(text.replace(/\s*\.\s*$/, ""), AUTHORITY_RULES)));
}

// ---------------------------------------------------------------------------
// Sätze der Bestimmungen
// ---------------------------------------------------------------------------

type SentenceRule = [RegExp, (m: RegExpMatchArray) => string];

function weeksDe(n: number, unit: string): string {
  const u = greekLoose(unit).toLowerCase();
  if (/^ε?βδομαδ/.test(u)) return `${n} ${n === 1 ? "Woche" : "Wochen"}`;
  if (/^ημερ/.test(u)) return `${n} ${n === 1 ? "Tag" : "Tage"}`;
  if (/^εργασιμ/.test(u)) return `${n} ${n === 1 ? "Arbeitstag" : "Arbeitstage"}`;
  if (/^μην/.test(u)) return `${n} ${n === 1 ? "Monat" : "Monate"}`;
  return `${n} ${unit}`;
}

// Muster auf akzent-/diäresefreiem Text (siehe greekLoose), ohne Groß-/Kleinschreibung.
// Artikel: „τo“ kommt live mit lateinischem „o“ vor.
const ART = "(?:τ[oο]|τη|την|τον|τους|τις|της)";
const SENTENCE_RULES: SentenceRule[] = [
  [
    new RegExp(`^πτησεις\\s+s?σε\\s+αυτην\\s+την\\s+περιοχη\\s+μπορουν\\s+να\\s+πραγματοποιηθουν\\s+κατοπιν\\s+ειδικης\\s+αδειας\\s+απο\\s+${ART}\\s+(.+?)\\.?$`, "i"),
    (m) => `Flüge in diesem Gebiet nur mit Sondergenehmigung – zuständig: ${translateCyAuthority(m[1])}.`,
  ],
  [
    new RegExp(`^για\\s+πτησεις\\s+σε\\s+αυτην\\s+την\\s+περιοχη,?\\s+απαιτειται\\s+αδεια\\s+απο\\s+${ART}\\s+(.+?)\\s*\\.?$`, "i"),
    (m) => `Für Flüge in diesem Gebiet ist eine Genehmigung erforderlich – zuständig: ${translateCyAuthority(m[1])}.`,
  ],
  [
    /^υποβολη\s+αιτησης\s+τουλαχιστον\s+(\d+)\s+(\S+)\s+πριν\s+απο\s+την\s+προγραμματισμενη\s+ημερομηνια\.?$/i,
    (m) => `Antrag mindestens ${weeksDe(Number(m[1]), m[2])} vor dem geplanten Flugdatum stellen.`,
  ],
  [
    /^πτηση\s+σμηεα,?\s+μονο\s+κατοπιν\s+εγκρισης\s+του\s+διαχειριστη\.?$/i,
    () => "UAS-Flüge nur mit Zustimmung des Zonenverwalters.",
  ],
  [
    /^δυναται\s+να\s+λειτουργουν\s+ηλεκτρονικα\s+αντιμετρα\s+πτησης\s+σμηεα,?\s+που\s+πιθανον\s+να\s+προκαλεσουν\s+την\s+πτωση\s+αυτου\.?$/i,
    () => "Achtung: Elektronische Drohnenabwehr (Gegenmaßnahmen gegen UAS) kann in Betrieb sein und zum Absturz des UAS führen.",
  ],
  [
    /^απαγορευονται\s+οι\s+πτησεις\s+σμηεα\s+σε\s+αυτην\s+την\s+περιοχη[a-zα-ω]?\.?$/i,
    () => "UAS-Flüge sind in diesem Gebiet verboten.",
  ],
  [
    /^για\s+πληροφοριες\s+αναφορικα\s+με\s+τους\s+ορους\s+προσβασης\s+της\s+ζωνης\s+επισκ\S*\s+την\s+ιστοσελιδα\s+(\S+?)\.?$/i,
    (m) => `Informationen zu den Zugangsbedingungen der Zone: ${m[1]}`,
  ],
];

/** Text → Sätze (Abkürzungen wie „Α.Η.Κ“ ohne Leerzeichen bleiben zusammen). */
export function splitCySentences(text: string): string[] {
  return String(text ?? "")
    .replace(/\s*\n\s*/g, " ")
    .split(/\s*\.\s+/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Einen Satz übersetzen; null, wenn keine Regel passt. */
export function translateCySentence(sentence: string): string | null {
  const s = greekLoose(String(sentence ?? "")).replace(/\s+/g, " ").trim();
  if (!s) return null;
  for (const [re, fn] of SENTENCE_RULES) {
    const m = s.match(re);
    if (m) return fn(m);
  }
  // Abgeschnittener Satzrest, der nur die Genehmigungsstelle nennt (live: „ΟΚΥπΥ .“).
  if (AUTHORITY_KEYS.has(s.toUpperCase().replace(/[\s.]+/g, ""))) {
    return `Genehmigungsstelle: ${translateCyAuthority(s)}.`;
  }
  return null;
}

/** Spricht der Satz ein ausdrückliches UAS-Flugverbot aus? */
function isProhibitionSentence(sentence: string): boolean {
  return /^απαγορευονται\s+οι\s+πτησεις/i.test(greekLoose(sentence).trim());
}

// ---------------------------------------------------------------------------
// Höhen (live nicht vorhanden; für künftige Texte)
// ---------------------------------------------------------------------------

/** UNKNOWN: Text nennt keinen Bezug (nie still AGL, Product Owner). */
export type CyReference = "AGL" | "MSL" | "UNKNOWN";

export interface CyLimit {
  meters: number;
  reference: CyReference;
  feet?: number;
  raw: string;
}

const UNIT = "(ft|feet|foot|ποδια|ποδιων|ποδ\\.|m|μετρα|μετρων|μ\\.?)";
const REF =
  "(AGL|AMSL|MSL|SFC|GND|ΑΜΣΘ|ΜΣΘ|πανω\\s+απο\\s+το\\s+εδαφος|απο\\s+το\\s+εδαφος|απο\\s+την\\s+επιφανεια(?:\\s+του\\s+εδαφους)?|απο\\s+τη[νς]?\\s+μεση\\s+σταθμη(?:\\s+της)?\\s+θαλασσας)";
const VALUE_SRC = `(\\d{1,3}(?:[.,]\\d{3})+|\\d{1,5}(?:[.,]\\d+)?)\\s*${UNIT}(?![A-Za-z\\u0370-\\u03FF])(?:\\s*${REF})?`;

function toLimit(numRaw: string, unitRaw: string, refRaw: string | undefined, raw: string): CyLimit | null {
  const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(numRaw);
  const n = Number(grouped ? numRaw.replace(/[.,]/g, "") : numRaw.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const u = unitRaw.toLowerCase();
  const isFt = /^(ft|feet|foot|ποδ)/.test(u);
  const r = (refRaw ?? "").toUpperCase();
  // Ohne Bezugsangabe → UNKNOWN (Product Owner: nie still AGL).
  const reference: CyReference = /AMSL|MSL|ΜΣΘ|ΘΑΛΑΣΣ/.test(r) ? "MSL" : r ? "AGL" : "UNKNOWN";
  // Umrechnung über den gemeinsamen Parser.
  const meters = parseHeight(n, isFt ? "ft" : "m")?.m ?? n;
  return { meters: round1(meters), reference, feet: isFt ? n : undefined, raw: raw.trim() };
}

/**
 * Höhenangaben aus dem (griechischen/englischen) Text lesen:
 * „SFC – 400 ft AGL“, „έως 120 μέτρα από το έδαφος“, „0 - 60 m“, „above 500 ft AMSL“.
 * Ein einzelner Wert gilt als Obergrenze, außer er steht nach „über/above/πάνω από“.
 */
export function parseCyHeights(text: string): { lower?: CyLimit; upper?: CyLimit } {
  const s = greekLoose(String(text ?? "")).replace(/\s+/g, " ");
  // Bereich „SFC/GND/0/έδαφος – Wert“ oder „Wert – Wert“.
  const range = new RegExp(
    `(?:(SFC|GND|εδαφος|εδαφους)|${VALUE_SRC})\\s*(?:-|–|έως|εως|μεχρι|to|bis)\\s*${VALUE_SRC}`,
    "i",
  );
  const rm = s.match(range);
  if (rm) {
    const upper = toLimit(rm[5], rm[6], rm[7], rm[0]);
    let lower: CyLimit | null = null;
    if (rm[1]) lower = { meters: 0, reference: "AGL", raw: rm[1] };
    else lower = toLimit(rm[2], rm[3], rm[4] ?? rm[7], rm[0]);
    if (upper && lower) return { lower, upper };
  }
  const single = new RegExp(`(?:(πανω\\s+απο|above|over|ανω\\s+των)\\s+)?${VALUE_SRC}`, "i");
  const sm = s.match(single);
  if (sm) {
    const lim = toLimit(sm[2], sm[3], sm[4], sm[0].replace(/^(?:πανω\s+απο|above|over|ανω\s+των)\s+/i, ""));
    if (lim) {
      if (sm[1]) return { lower: lim };
      return { upper: lim };
    }
  }
  return {};
}

function fmtNum(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Deutsche Anzeige eines Grenzwerts. */
export function formatCyLimitDe(l: CyLimit | null | undefined): string {
  if (!l) return "unbekannt";
  if (l.meters === 0) return "Boden (GND)";
  const base = l.feet != null ? `${fmtNum(l.feet)} ft` : `${fmtNum(l.meters)} m`;
  const approx = l.feet != null ? ` (≈ ${fmtNum(l.meters)} m)` : "";
  if (l.reference === "UNKNOWN") return `${base}${approx} (Bezug unbekannt)`;
  return l.reference === "AGL" ? `${base} über Grund${approx}` : `${base} MSL${approx}`;
}

// ---------------------------------------------------------------------------
// PopupInfo zerlegen
// ---------------------------------------------------------------------------

/** HTML → Klartextzeilen (Leerraum je Zeile zusammengefasst, Leerzeilen entfernt). */
export function cyPopupText(html: string | null | undefined): string {
  if (!html) return "";
  const s = String(html)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(s)
    .replace(/ /g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

type CyLabel = "manager" | "phone" | "email" | "access" | "form";

const LABEL_RE =
  /(Διαχειριστ[ηή]ς\s+Ζ[ωώ]νης|Τηλ[εέ]φωνο\s+Επικοινων[ιί]ας|Ηλεκτρονικ[ηή]\s+Διε[υύ]θυνση|[ΌΟ]ροι\s+Πρ[οό]σβασης|['’΄`]?\s*(?:[EΕΈ])ντυπο\s+Α[ιί]τησης)\s*:\s*/g;

function labelKind(label: string): CyLabel {
  const k = greekLoose(label).toUpperCase();
  if (k.includes("ΔΙΑΧΕΙΡΙΣΤ")) return "manager";
  if (k.includes("ΤΗΛΕΦΩΝ")) return "phone";
  if (k.includes("ΗΛΕΚΤΡΟΝΙΚ")) return "email";
  if (k.includes("ΠΡΟΣΒΑΣ")) return "access";
  return "form";
}

export type CyAccess = "AUTHORISATION" | "PROHIBITED" | "OTHER";

export interface CyParsedPopup {
  manager?: string;
  phone?: string;
  email?: string;
  /** Normalisierte Zugangsbedingung (Όροι Πρόσβασης). */
  access?: CyAccess;
  accessRaw?: string;
  formUrl?: string;
  /** Freie Bestimmungen (griechisch), zeilenweise. */
  remarks: string[];
  /** Bereinigter griechischer Volltext. */
  greekText: string;
  lower?: CyLimit;
  upper?: CyLimit;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,)]/;

/** Zugangsbedingung normalisieren (live: ΕΞΟΥΣΙΟΔΟΤΗΣΗ, ΕΞΟΥΣΙΟΔΟΤΗ, ΑΠΑΓΟΡΕΥΜΕΝΗ ΠΕΡΙΟΧΗ, leer). */
export function normalizeCyAccess(raw: string | undefined): CyAccess | undefined {
  const k = greekLoose(String(raw ?? "")).toUpperCase().replace(/[^A-ZΑ-Ω ]+/g, " ").trim();
  if (!k) return undefined;
  if (/^ΕΞΟΥΣΙΟΔΟΤ/.test(k) || /AUTHORI[SZ]/.test(k) || /^ΑΔΕΙΑ/.test(k)) return "AUTHORISATION";
  if (/^ΑΠΑΓΟΡΕΥ/.test(k) || /PROHIBIT/.test(k)) return "PROHIBITED";
  return "OTHER";
}

export function parseCyPopup(html: string | null | undefined): CyParsedPopup {
  const greekText = cyPopupText(html);
  const out: CyParsedPopup = { remarks: [], greekText };
  for (const line of greekText.split("\n")) {
    const pieces: { kind: CyLabel | null; value: string }[] = [];
    let last = 0;
    let kind: CyLabel | null = null;
    LABEL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LABEL_RE.exec(line))) {
      pieces.push({ kind, value: line.slice(last, m.index) });
      kind = labelKind(m[1]);
      last = m.index + m[0].length;
    }
    pieces.push({ kind, value: line.slice(last) });
    for (const p of pieces) {
      const value = p.value.replace(/\s+/g, " ").trim();
      if (!p.kind) {
        if (value) out.remarks.push(value);
        continue;
      }
      if (!value) continue;
      switch (p.kind) {
        case "manager":
          out.manager = out.manager ? `${out.manager}; ${value}` : value;
          break;
        case "phone":
          out.phone = out.phone ? `${out.phone}; ${value}` : value;
          break;
        case "email": {
          const e = value.match(EMAIL_RE);
          if (e && !out.email) out.email = e[0];
          else if (!e) out.remarks.push(value);
          break;
        }
        case "access": {
          // Stichwort in Großbuchstaben, danach evtl. weiterer Text.
          const am = value.match(/^((?:[Α-ΩΆΈΉΊΌΎΏΪΫ]{2,}\s?)+)[.\s]*(.*)$/);
          const keyword = am ? am[1].trim() : value;
          out.accessRaw = keyword;
          out.access = normalizeCyAccess(keyword);
          if (am && am[2]) out.remarks.push(am[2]);
          break;
        }
        case "form": {
          const u = value.match(URL_RE);
          if (u && !out.formUrl) out.formUrl = u[0];
          else if (!u) out.remarks.push(value);
          break;
        }
      }
    }
  }
  const h = parseCyHeights(greekText);
  if (h.lower) out.lower = h.lower;
  if (h.upper) out.upper = h.upper;
  return out;
}

// ---------------------------------------------------------------------------
// Beschränkung
// ---------------------------------------------------------------------------

const SEVERITY: Record<CyRestriction, number> = { CONDITIONAL: 1, REQ_AUTHORISATION: 2, PROHIBITED: 3 };

/** Kategorie aus FolderPath („…/RESTRICTED ZONES[/Unterordner]“) → Beschränkung; null = unbekannt. */
export function cyRestrictionFromFolder(folderPath: string | null | undefined): CyRestriction | null {
  const parts = String(folderPath ?? "").split("/").map((p) => p.trim()).filter(Boolean);
  // Erster Teil ist der Kartenname („CYPRUS GEO ZONES MAP ver09T2“) – Kategorien danach suchen.
  for (const p of parts.length > 1 ? parts.slice(1) : parts) {
    const k = p.toUpperCase();
    if (/PROHIBITED|NO[\s_-]?FLY|ΑΠΑΓΟΡΕΥ/.test(k)) return "PROHIBITED";
    if (/RESTRICTED|AUTHORI[SZ]ATION|ΠΕΡΙΟΡΙΣ/.test(k)) return "REQ_AUTHORISATION";
    if (/DANGER|CONDITIONAL|INFORMATION|NOTICE/.test(k)) return "CONDITIONAL";
  }
  return null;
}

/** Kategorie-Bezeichnung aus FolderPath (zweiter Teil), z. B. „RESTRICTED ZONES“. */
export function cyFolderCategory(folderPath: string | null | undefined): string | undefined {
  const parts = String(folderPath ?? "").split("/").map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[1] : parts[0];
}

export interface CyRestrictionDecision {
  restriction: CyRestriction;
  folderRestriction: CyRestriction | null;
  /** true, wenn Zugangsbedingung/Text strenger war als der Ordner (oder Ordner unbekannt). */
  escalated: boolean;
}

export function decideCyRestriction(folderPath: string | null | undefined, popup: CyParsedPopup): CyRestrictionDecision {
  const folderRestriction = cyRestrictionFromFolder(folderPath);
  let r: CyRestriction = folderRestriction ?? "REQ_AUTHORISATION";
  const bump = (x: CyRestriction) => {
    if (SEVERITY[x] > SEVERITY[r]) r = x;
  };
  if (popup.access === "PROHIBITED") bump("PROHIBITED");
  if (popup.access === "AUTHORISATION") bump("REQ_AUTHORISATION");
  if (popup.remarks.some((rem) => splitCySentences(rem).some(isProhibitionSentence))) bump("PROHIBITED");
  return { restriction: r, folderRestriction, escalated: folderRestriction == null || r !== folderRestriction };
}

// ---------------------------------------------------------------------------
// Meldungstext
// ---------------------------------------------------------------------------

const TYPE_DE: Record<CyRestriction, string> = {
  PROHIBITED: "Verbotszone (PROHIBITED ZONE) – UAS-Flüge verboten",
  REQ_AUTHORISATION: "Beschränkte Zone (RESTRICTED ZONE) – UAS-Flüge nur mit Genehmigung",
  CONDITIONAL: "Zone mit Auflagen",
};

const ACCESS_DE: Record<CyAccess, string> = {
  AUTHORISATION: "Autorisierung erforderlich (ΕΞΟΥΣΙΟΔΟΤΗΣΗ)",
  PROHIBITED: "Verbotenes Gebiet (ΑΠΑΓΟΡΕΥΜΕΝΗ ΠΕΡΙΟΧΗ)",
  OTHER: "siehe Originaltext",
};

export interface CyTranslatedRemarks {
  hints: string[];
  untranslated: string[];
}

export function translateCyRemarks(remarks: string[]): CyTranslatedRemarks {
  const hints: string[] = [];
  const untranslated: string[] = [];
  for (const rem of remarks) {
    for (const s of splitCySentences(rem)) {
      const de = translateCySentence(s);
      if (de) {
        if (!hints.includes(de)) hints.push(de);
      } else if (!/^(?:https?:\/\/|www\.)\S+$/i.test(s)) {
        untranslated.push(s);
      }
    }
  }
  return { hints, untranslated };
}

function phoneDe(phone: string): string {
  return phone.replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
}

/** Deutsche, strukturierte Beschreibung + griechischer Originaltext. */
export function buildCyMessageDe(
  originalName: string,
  popup: CyParsedPopup,
  decision: CyRestrictionDecision,
  folderCategory?: string,
): string {
  const lines: string[] = [];
  lines.push(`Typ: ${TYPE_DE[decision.restriction]}`);
  if (decision.escalated && decision.folderRestriction && folderCategory) {
    const what =
      decision.restriction === "PROHIBITED"
        ? "der Behördentext verbietet UAS-Flüge ausdrücklich – vorsichtshalber als Verbotszone dargestellt"
        : "der Behördentext ist strenger – vorsichtshalber strengere Einstufung";
    lines.push(`Hinweis zur Einstufung: Ordner der Behörde „${folderCategory}“, ${what}.`);
  } else if (decision.folderRestriction == null) {
    lines.push("Hinweis zur Einstufung: Kategorie der Behörde unbekannt – vorsichtshalber als genehmigungspflichtig eingestuft.");
  }
  if (popup.access) lines.push(`Zugangsbedingung: ${ACCESS_DE[popup.access]}`);
  if (popup.lower || popup.upper) {
    const lo = popup.lower ? formatCyLimitDe(popup.lower) : "Boden (GND)";
    const up = popup.upper ? formatCyLimitDe(popup.upper) : "ohne Obergrenze";
    lines.push(heightLineDe(lo, up));
  } else {
    lines.push(NO_HEIGHT_LINE_DE);
  }
  const { hints, untranslated } = translateCyRemarks(popup.remarks);
  if (untranslated.length > 0) hints.push("Weitere Bestimmungen nur im griechischen Originaltext (siehe unten).");
  pushHints(lines, hints);
  if (popup.manager) lines.push(`Zonenverwalter: ${translateCyManager(popup.manager)}`);
  if (popup.phone) lines.push(`Telefon: ${phoneDe(popup.phone)} (Zypern, +357)`);
  if (popup.email) lines.push(`E-Mail: ${popup.email}`);
  if (popup.formUrl) lines.push(`Antragsformular: ${popup.formUrl}`);
  lines.push(sourceLineDe(CY_GEOZONE_SOURCE_LABEL, CY_GEOZONE_ATTRIBUTION));
  return messageWithOriginal(lines, cyOriginalText(originalName, popup));
}

/** Griechischer Originaltext: Zonenname + Popup-Text. */
function cyOriginalText(originalName: string, popup: CyParsedPopup): string {
  return [originalName, popup.greekText].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

export type CyFeature = { type: "Feature"; id?: string; geometry: any; properties: Record<string, any> };

export type CyDropReason = "no_geometry" | "duplicate";

export interface CyNormalizeResult {
  features: CyFeature[];
  dropped: { name: string; reason: CyDropReason }[];
}

function validCoords(c: unknown, depth: number): boolean {
  if (!Array.isArray(c)) return false;
  if (depth === 0) return c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));
  return c.length > 0 && c.every((x) => validCoords(x, depth - 1));
}

/** Nur Flächen; Koordinaten unverändert (volle Präzision). */
export function cyGeometry(geometry: any): { type: "Polygon" | "MultiPolygon"; coordinates: any } | null {
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

function zoneNumber(name: string): string | undefined {
  const m = name.match(/^(\d{1,4})\s*-/);
  return m ? m[1] : undefined;
}

/** Einzelnes ArcGIS-GeoJSON-Feature normalisieren; null bei fehlender Fläche. */
export function normalizeCyprusFeature(raw: any): CyFeature | null {
  const p: Record<string, any> = raw?.properties ?? {};
  const geometry = cyGeometry(raw?.geometry);
  if (!geometry) return null;
  const originalName = String(p.Name ?? "").replace(/\s+/g, " ").trim();
  const objectId = p.OBJECTID ?? raw?.id;
  const popup = parseCyPopup(p.PopupInfo);
  const decision = decideCyRestriction(p.FolderPath, popup);
  const folderCategory = cyFolderCategory(p.FolderPath);
  const name = translateCyZoneName(originalName) || `Geozone ${objectId ?? ""}`.trim();
  const num = zoneNumber(originalName);
  const identifier = num ? `CY-${num}` : `CY-OID${objectId ?? "?"}`;
  const message = buildCyMessageDe(originalName, popup, decision, folderCategory);

  const props: Record<string, any> = {
    identifier,
    name,
    restriction: decision.restriction,
    lowerMeters: popup.lower?.meters ?? 0,
    lowerReference: popup.lower?.reference ?? "AGL",
    upperReference: popup.upper?.reference ?? "AGL",
    message,
    // „el“ nur mit griechischem Popup-Text (ein Name allein ist kein Behördentext).
    extendedProperties: localizedExtendedProperties(message, popup.greekText ? cyOriginalText(originalName, popup) : "", "el"),
    country: "CYP",
    source: CY_GEOZONE_SOURCE_LABEL,
    nameOriginal: originalName || undefined,
    cyObjectId: objectId,
    cyFolder: folderCategory,
    cyFolderRestriction: decision.folderRestriction ?? undefined,
    cyRestrictionEscalated: decision.escalated || undefined,
    cyAccess: popup.access,
    cyAccessRaw: popup.accessRaw,
    cyManager: popup.manager,
    cyPhone: popup.phone,
    infoUrl: CY_DRONES_PORTAL_URL,
    infoUrlLabel: "UAS-Portal DCA Cyprus (drones.gov.cy)",
  };
  if (popup.upper) props.upperMeters = popup.upper.meters;
  if (popup.email) props.contactEmail = popup.email;
  if (popup.formUrl) {
    props.applicationUrl = popup.formUrl;
    const ext = (popup.formUrl.match(/\.([A-Za-z0-9]{2,5})(?:[?#]|$)/)?.[1] ?? "").toUpperCase();
    props.applicationUrlLabel = ext ? `Antragsformular (${ext})` : "Antragsformular";
  }
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", id: identifier, geometry, properties: props };
}

/** ArcGIS-Antwort (FeatureCollection) oder Feature-Liste → Features + Verwerfungsstatistik. */
export function normalizeCyprusZonesWithStats(body: any): CyNormalizeResult {
  const raws: any[] = Array.isArray(body) ? body : Array.isArray(body?.features) ? body.features : [];
  const features: CyFeature[] = [];
  const dropped: CyNormalizeResult["dropped"] = [];
  const seenOid = new Set<string>();
  const seenNameGeom = new Set<string>();
  const ids = new Map<string, number>();
  for (const raw of raws) {
    const p = raw?.properties ?? {};
    const label = String(p.Name ?? p.OBJECTID ?? "?");
    // Dedupe: OBJECTID (Seitenüberlappung) bzw. Name + identische Geometrie.
    const oid = p.OBJECTID ?? raw?.id;
    if (oid != null) {
      if (seenOid.has(String(oid))) {
        dropped.push({ name: label, reason: "duplicate" });
        continue;
      }
    }
    const ngKey = `${String(p.Name ?? "")}|${JSON.stringify(raw?.geometry?.coordinates ?? null)}`;
    if (seenNameGeom.has(ngKey)) {
      dropped.push({ name: label, reason: "duplicate" });
      continue;
    }
    const f = normalizeCyprusFeature(raw);
    if (!f) {
      dropped.push({ name: label, reason: "no_geometry" });
      continue;
    }
    if (oid != null) seenOid.add(String(oid));
    seenNameGeom.add(ngKey);
    const id = String(f.properties.identifier);
    const n = (ids.get(id) ?? 0) + 1;
    ids.set(id, n);
    if (n > 1) {
      f.properties.identifier = `${id}#${n}`;
      f.id = `${id}#${n}`;
    }
    features.push(f);
  }
  return { features, dropped };
}

export function normalizeCyprusZones(body: any): CyFeature[] {
  return normalizeCyprusZonesWithStats(body).features;
}

// ---------------------------------------------------------------------------
// ArcGIS-Abfrage (URL + Seitenauswertung)
// ---------------------------------------------------------------------------

/** Query-URL (GeoJSON, WGS84, alle Felder, volle Präzision, eine Seite). */
export function cyprusQueryUrl(offset = 0, count = 1000, layerUrl: string = CY_ZONES_LAYER_URL): string {
  return arcgisQueryUrl(layerUrl, { offset, count, orderByFields: "OBJECTID ASC" });
}

/**
 * Seite einer ArcGIS-`f=geojson`-Antwort lesen. `exceededTransferLimit` steht
 * je nach Server-Version oben oder unter `properties`; ein ArcGIS-Fehlerobjekt
 * (HTTP 200 + {error}) wird geworfen.
 */
export function cyprusArcgisPage(body: any): { features: any[]; exceeded: boolean } {
  return arcgisPage(body);
}
