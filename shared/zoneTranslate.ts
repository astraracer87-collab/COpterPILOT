// Übersetzung der Behördentexte (Zonennamen und Beschreibungen) ins Deutsche –
// vollständig offline, ohne externen Übersetzungsdienst.
//
// Reihenfolge je Zeile:
//  1. Mitgeliefertes Wörterbuch (shared/data/zoneTranslationsDe.json): exakte
//     Zeile (Leerraum vereinheitlicht).
//  2. Etikett-Zeilen „<Etikett>: <Wert>“: deutsches Etikett der App bleibt, der
//     Wert wird übersetzt; fremde Feldnamen der Quellen (SI/SK/CY …) werden über
//     eine Feldtabelle eingedeutscht.
//  3. Satzmuster für formelhafte, wechselnde Texte (NOTAMs, Aktivierungen,
//     Kontaktzeilen …): shared/zoneTranslatePatterns.ts – mit Platzhaltern für
//     Kennungen, Höhen, Zeiten, Koordinaten, Radien und Namen.
//  4. Zeile in Abschnitte („ · “, Sätze) zerlegen und jeden Abschnitt einzeln
//     über 1–3 übersetzen.
//  5. Sonst bleibt der Originaltext stehen; nur in der Anzeige (Option
//     `markUntranslated`) mit dem Zusatz „(nicht übersetzt)“.
//
// Ein optionaler Laufzeit-Cache (addRuntimeTranslations) bleibt für Tests und
// gerätelokale Ergänzungen erhalten; ein Übersetzungsdienst wird nicht genutzt.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

import { ORIGINAL_TEXT_HEADING } from "./geozoneKit/messages";
import { translateLineByPattern, translateNameByPattern, translateFieldLabel, isProperNameLabel, isGermanLabel, transliterateCyrillic, translateNotamGloss, isProperDesignation } from "./zoneTranslatePatterns";

type Dict = { lines: Record<string, string>; names: Record<string, string>; knownNames?: Set<string> };

let bundled: Dict | null = null;
const runtime = new Map<string, string>();

function dict(): Dict {
  if (!bundled) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const raw = require("./data/zoneTranslationsDe.json") as { lines?: Record<string, string>; names?: Record<string, string>; unchangedNames?: string[] };
      // unchangedNames: geprüfte Eigennamen, die keine Übersetzung brauchen
      bundled = { lines: raw.lines ?? {}, names: raw.names ?? {}, knownNames: new Set(raw.unchangedNames ?? []) };
    } catch {
      bundled = { lines: {}, names: {} };
    }
  }
  return bundled;
}

/** Schlüssel: Leerraum vereinheitlicht, damit Zeilenumbrüche/Leerzeichen egal sind. */
export function translationKey(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** Zusatz in der Anzeige für Zeilen ohne deutsche Fassung. */
export const NOT_TRANSLATED_MARK = "(nicht übersetzt)";

// --- Deutsch-Erkennung -------------------------------------------------------

// kommen auch im Dänischen/Norwegischen/Französischen vor). Deutsch ab zwei
// starken Wörtern bzw. einem starken + einem schwachen. und mehrdeutige Kurzwörter (Gewicht 1,
// kommen auch im Dänischen/Norwegischen/Französischen vor). Deutsch ab zwei
// starken Wörtern bzw. einem starken + einem schwachen.
const GERMAN_STRONG = new Set(
  (
    "und nicht für über keine kein keinen laut auf aus bis vom zum zur beim einer eine einem eines ist sind wird werden " +
    "oder nur mit bei nach ohne siehe gilt gelten erlaubt zulässig verboten beachten prüfen bitte genehmigung betrieb flug flüge " +
    "drohnen drohnenflug drohnenflüge höhe hinweis hinweise behörde gebiet gebiete grenze grenzen zeitplan aktiviert aktivierung " +
    "flughafen flugplatz sperrgebiet beschränkung beschränkungsgebiet gefahrengebiet kontrollzone luftraum uhr täglich derzeit dauerhaft " +
    "vorsorglich gültig außer innerhalb außerhalb zwischen während sowie bzw ggf liegen liegt vorher erforderlich " +
    "genehmigungspflichtig benachrichtigung anmeldung zuständige zuständig stelle flugsicherung luftfahrzeuge unbemannte " +
    "meeresspiegel einflug eigene gefahr bekanntmachung mittels sensibles ständig zeitweise gesperrt sonstiges " +
    "durchgehend beschränkter zusätzlich zivil geplant aktiv"
  )
    .split(/\s+/)
    .filter(Boolean),
);
const GERMAN_WEAK = new Set("der die das den dem des im zu".split(" "));
const GERMAN_SUFFIX = /^[a-zäöüß]{4,}(ung|ungen|keit|heit|schaft|gebiet|gebiete|zonen|platz|anlage|pflicht|pflichtig|lich|liche|lichen|licher|liches|isch|ische|ischen|ischer|isches|zone)$/;

// Häufige deutsche Wörter aus den deutschen Fassungen des Wörterbuchs, die in
// keinem Quelltext vorkommen (einmalig erzeugt, siehe docs/zonen-uebersetzung.md).
const GERMAN_LEXICON =
  "von naturschutzgebiet für bis die ist gilt modellflugzeugen modellbooten verboten verbot während grenzen " +
  "zwischen eines dieser erlaubt oder luftraumabschnitt uhr nur auch flüge sind über hindernisses " +
  "hubschrauberlandeplatz eine polizei nach luftraumzone dem nicht außerhalb sowie telefon jetzt unter " +
  "eingerichtet botschaft auf werden verkehr unbefristet höchstens sommerzeit vollständiger schwedischen zur " +
  "jahres möglicherweise justizvollzugsanstalt höhe vom vogelschutzgebiet motorisierter zum bemerkungen " +
  "luftfahrzeuge nähe sichtweite fliegen bedingungen hindernis betriebszeiten kraftwerk aus einschließlich " +
  "kategorie modellflugplatz markiert flug nationalpark jedoch gemäß oberhalb zeitpunkt verantwortlichen " +
  "jederzeit siehe landschaftsschutzgebiet flugsicherungsdienstleisters übungsgebiet erforderlich montag " +
  "wassermotorrädern fotografieren festgelegten unmittelbarer abstand aufstellen aufgestellt beliebigen " +
  "horizontaler überschreiten baulichen ersuchen kann unbemannter surfbrettern tarnvorrichtungen polizeibehörde " +
  "können dies informationen sonnenuntergang mittwoch errichtet müssen seitlichen flugbetrieb betreiber " +
  "besonderen sonnenaufgang mindestens durch sondergenehmigung bemannte motoren fluggenehmigung einer umfasst " +
  "beantragen luftfahrt erteilt erhältlich ein wasser innerhalb einzelfallprüfung militärisches zonenbehörde " +
  "zeitplan eisenbahntunnel werktags tierschutzgebiet erhebung schutzgebiet kontrollzone verkehrsbehörde stunden " +
  "muss freitag donnerstag dienstag gültig ausnahmegenehmigungen als polizeistation habitat artenmanagement hafen " +
  "einem streitkräfte gericht beleuchtet früherer aktiviert geplanten späterer weitere antrag wird schutz " +
  "tätigkeiten märz allen flugplatzes gesetz montags mai darf zugang speziellen estnischen freitags " +
  "hubschrauberlandestelle tiefflüge donnerstags wochentagen vorherige vogelreservat mittwochs nachts " +
  "rechtweisende peilung ausgenommene andere luftraum entfernung sein dienstags ölplattform straßentunnel tags " +
  "offenen unfällen geräte samstags republik beantragt militärischer modellflugzeuge ähnlichem gebiets einzuholen " +
  "reservat sich dezember motorbetriebener betreffenden beteiligter windsurfen arrestanstalt pistenmittellinie " +
  "obergrenze erlauben offene landeplatz keine fuß unbemannten hubschrauber ferngesteuerter feiertags sonntags " +
  "biotopschutzgebiet anderer behörden unbemannte militärkaserne zuständigen diesem rettungsdienst abstimmung " +
  "anflug stellen finden süd drohne brandbekämpfung luftrettung schriftliche genutzt tieffluggebiet naturdenkmal " +
  "zonenverwalter zolls tagen stattfinden bohrinsel worden dürfen betroffen sofern küstenwache grenzkontrolle " +
  "benachrichtigung bereich grenzschutzbehörde abteilung drohnenflüge aktivierung verkehrs küstenwachaufgaben " +
  "schwedischer einholen windsurfbrettern betriebsgenehmigung zelten benötigen ihrer zugvögel einflug sollte " +
  "küstenwachstation rettungshubschrauber flugverkehrskontrolle hinter verlängerten kommunikationsbehörde täglich " +
  "senden gebieten informationssystem zivilluftfahrtbehörde brutvögel fernpiloten abflug luftfahrzeugsysteme " +
  "sobald wenn meiden beim höher akteure übung schloss sicherheit informieren nutzen lärm werktage risiko " +
  "zugangsbedingung erfolgen zudem überdeckt militärgebiet naturpark teil umkreis beteiligte staatlichen " +
  "tierschutz neues umstände nachricht dringenden fällen beginnen arbeitstage militärischen hafengebiet " +
  "nebenstelle verwendung zulässig ausgestellt luft vogelschutz schriftlicher beschränkenden verbotszone distanz " +
  "schwerer unfälle artikel metern vorschriften überfliegen gelten standort fliegerhorst landungen pflicht " +
  "kreisbogen uhrzeigersinn temporäre gelände voraus örtlichen genannte hubschraubern bewertung bevor samstag " +
  "minuten erteilen modellboote luftfahrzeugs schwedische mobilkran feiertagen reservierung absprache " +
  "zentralkrankenhaus rangierbahnhof schutzlandschaft begrenzt feuerwache zunächst jeglicher gelbe einsatz " +
  "veröffentlichten flugzeugen brütende greifvögel hindernishöhe schriftlich sicherheitsorganisation kräne einen " +
  "weiss beteiligten mehr direkten fernidentifizierung windenergieanlagen erfordern luftaufnahmen rettungs " +
  "rettungsdienste ausschließlich verfahren beschränkungen beschränkungsgebiet bestimmten eisbohrer einfliegen " +
  "kooperationsvereinbarung kooperationsvereinbarungen geschlossen einrichtung windenergieanlage " +
  "echtzeitaktivierung befeuert gesonderter allgemeinen betriebe aufnahmen platzrunde testbetrieb militärzone " +
  "küste flugverkehrskontrollstelle vermeiden pflanzenschutz außer folgenden diese militär bau hindernisse " +
  "folgetag vorankündigung verschmutzung darüber grenzschutz fernpilot stützpunkt rote rettungseinsatz piste " +
  "hauptstation verbotenes durchführungsverordnung kommission fluges beginn vorgeschrieben wegen seefahrtsbehörde " +
  "flügen luftfahrzeugen höhenbeschränkung kompetenzzeugnis liegt befindet zonen anweisungen zivilen " +
  "ausnahmegenehmigung militärluftfahrzeuge vögel neue pflanzen verfügbar zugehörigem zeitweilig untergrenze " +
  "leiters einhalten regelung einhaltung darin deren mündung grenzschutzstation windrad haben hindernisbefeuerung " +
  "weniger folgende zusätzlich geografischen sonntag ausrüstung luftverkehrs wurde gebiete darfst heranfliegen " +
  "erfolgt unterhalb flugbeschränkungsgebiete dass verlegt kontaktaufnahme ferngesteuerte einzureichen zeit " +
  "mausernde luftfahrzeug rahmen genehmigungsanträge bedingt berechtigt koordinierungsarten koordinieren " +
  "betriebsanweisungen befreiungen wasserkraftwerk stadtgericht grüne hoch rettungswache königliche drohnenflug " +
  "markierung klasse erfüllt anforderungen vorgeschriebenen weise durchgeführt ausdrücklich geändert vorheriger " +
  "öffentlicher pistenhöhe sprengungen ausleger unterliegen eisbohrern militärflüge gefängnis landung dazu gehört " +
  "registratur grenzschutzbezirk finnische festgelegter sicherheitszone niedrig wasserflugplatz lokalpolizei " +
  "totengedenkens beiderseits blinkend buchstabe gesamten jedes gestattet ausgerüstet einzelheiten anderen " +
  "verteidigung gleitschirmfliegen bitte luftraums aufgaben eingeholt beispiel grenze schießbetrieb betreiben " +
  "beabsichtigten luftraumzonen zeitraum erweitert gefahrenzone zwei kategorien pflanzenschutzgebiet " +
  "bodenempfänger bordempfänger ganztägig genehmigt leiter koordination leitstelle dessen lagezentrum " +
  "verkehrsinfrastrukturbehörde gesonderte kernkraftwerk werksgelände werk gefahrenabwehr drei " +
  "sicherheitsdienstes leichte ermessen trainingsplatzrunde pipeline streitkräften rettungsbehörde umweltbehörde " +
  "angrenzenden werke telefonzentrale flugverfahren hohe lissabon vereinigten marinestützpunkt südwestküste " +
  "zentrum ministerium strafvollzug außenlöschbehälter domäne universitätskrankenhaus zeitweiliges " +
  "seenotrettungshubschrauber uusikaupunki beobachter linie fall startmasse erreichbar ende scharfer munition " +
  "ausnahme zivile flugplatzverkehrszone strafvollzugsbehörde ausgenommenen öffnungszeiten geplante richten " +
  "hierfür blaue kontaktieren hubschrauberlandeplatzes keinen schutzregelungen einsätze kontaktdaten gefahr " +
  "beschreibung aufsichtsbehörde erklärt unten drohnenverbot gerät lichtshow mehrere erlaubenden webbasiert " +
  "fahrzeuge motorbetriebenen fluganmeldung erfordert planen motorisierten eisfreien nachtmarkiert " +
  "sicherheitsleiter höhenbeschränkungen wert erhöht vogelschutzgebiete flugs beträgt genehmigungsanfragen " +
  "österbotten diensthabenden erkunden objekten landesverteidigung generalstabs pääesikunta regeln werktagen " +
  "drohnentests bekanntgegeben polizeiverwaltung luftwaffe gemeldet modellflugplätze abweichung gewähren setzen " +
  "diensten warteverfahren residenz flugbeschränkungen polizeilichen säpo zuständigkeitsbereich " +
  "verteidigungsministeriums inlandsnachrichtendienst steuer zollbehörde wahrnehmung gesetzlichen " +
  "luftnahunterstützung gefahrengebiete niedrigere angabe offen flugplatzbetreiber grenzschutzes festzulegen " +
  "kontaktperson windräder kalt sicherungsverwahrung hämeenlinna hauptquartier solarpark kalanti windkraftanlagen " +
  "ressourcenmanagement wenden befeuerung deutschen luftraumklasse gekennzeichnet anhangs delegierten verordnung " +
  "privat gebauten sinne höchstzulässige nutzlast betriebsgeschwindigkeit registriertes melden flugleitung " +
  "aktivierten strecke lebensrettungseinsätze verwaltbares betrieben rechtsmedizinbehörde oben anträge " +
  "rettungsdiensten anlage gesamte zustimmung geflogen durchfliegen fluginformationsdienst tagebau gefährlich " +
  "koordinaten kontrollierter örtliche daher angezeigt verantwortung anderweitig zusätzliche angaben abflugsektor " +
  "sprengung unterstützung verlängerte spätestens mögliche besonders botschaften etwa gesendet forensisch klinik " +
  "dez bezieht vermüllung liegenschaftsleiter eis alternativ bereitschaftsleiter motorbetriebene drohnenabwehr " +
  "lappland finnischen kainuu finnischer meerbusen sicherheitschef zentrale kreis entscheidung anzeige " +
  "medizinische eigenen hafens sicherheitsabteilung telefonnummer regulierter gründen abgesagt erlaubnis " +
  "kommunikation jeden zonierung entsprechendes privileg flugaktivitäten betreibers vermessungsbehörde " +
  "lantmäteriet königshofs krankentransporte hoher medizinischer priorität gegen erwarten beschriebenen " +
  "offizielle schweden entspricht ausdehnung flugbeschränkungsgebiets geltenden höchsten zusammenhang speziell " +
  "zusätzlichen anwendbare koordinierungsart erlaubender luftfahrtgesetz jeweiligen abgesprochen einzuhalten " +
  "gegenstände wärtsilä gefängnisses absatz ahvenanmaa kraftwerksgelände festung staaten arabischen emirate " +
  "botschafters knickpunkten frankreichs königreichs volksrepublik karjala universitätsklinikum " +
  "konverterplattform stab hauptpolizeistation zentrales südlich öllager " +
  "mittelpunkt funkfeuer filiale nordwestküste weinbaukultur flugbeschränkungszone sofort nähert zurück " +
  "mobiltelefon einhundertfünfzig sensibilisierungssystems tief zoll rennstrecke luftraumreservierung vorliegt " +
  "allgemeine koordinierte genehmigungspflichtig staatliche provinzialregierung kommunalen " +
  "feuerwehr auftrag aktiver bemannter geringer stunde kunstflug flugverkehrsdienste angekündigt unkontrollierten " +
  "landenden startenden dafür zeitlich beschränkungsgebieten archäologische untersuchung anfragen wasserflugzeug " +
  "steg niemals aber hindernisfreien flächen";
// Typisch deutsche Wortbestandteile in Komposita („Funkpflichtzone“,
// „Forschungsreaktor“, „Referenzhöhe“) – nur in Wörtern ab 7 Buchstaben.
const GERMAN_MORPHEME =
  /(garde|boden|lager|zentrum|anstalt|gemeinschaft|verein|haus|bergwerk|abfüll|flug|gebiet|verkehr|kraftwerk|anlage|platz|sperr|verbot|pflicht|genehmig|beschränk|gefahr|schutz|betrieb|bezirk|gelände|drohne|aktivität|kontroll|sicherheit|gesellschaft|behörde|übung|abwehr|reaktor|wärme|heiz|rüstung|leitung|straße|wache|polizei|gericht|gefängnis|kaserne|krankenhaus|botschaft|hafen|infrastruktur|radioaktiv|abfäll|fallschirm|segelflug|artillerie|schieß|spreng|militär|luftraum|nahverkehr|zivil|staatlich|naturschutz|höhe|zeiten|bereich|erhöht|besonder|sonstig|ballungs|transponder|kommunikation|tiefflug|abgetrennt|reserviert|präsident|eingeschränkt|vorsicht|auflage|einsatz|landeplatz|hubschrauber|luftsport|zone[nm]it)/;
let germanWords: Set<string> | null = null;
function isGermanWord(w: string): boolean {
  if (!germanWords) germanWords = new Set(GERMAN_LEXICON.split(" "));
  return GERMAN_STRONG.has(w) || germanWords.has(w) || GERMAN_SUFFIX.test(w) || (w.length >= 7 && GERMAN_MORPHEME.test(w));
}

/** Grobe Erkennung, ob ein Text schon deutsch ist (dann nicht übersetzen). */
export function looksGerman(s: string): boolean {
  const raw = String(s ?? "");
  if (/ß/.test(raw)) return true;
  // Klammerzusätze („(Restricted Area, AIP)“) zählen nicht mit, wenn Text übrig bleibt
  const noParen = raw.replace(/\([^)]*\)/g, " ");
  if (noParen !== raw && /[a-zäöü]{3}/i.test(noParen) && germanScore(noParen)) return true;
  return germanScore(raw);
}

function germanScore(str: string): boolean {
  const words = str.match(/[A-Za-zÄÖÜäöüßÀ-ÿĀ-žΑ-ωА-я]+/g);
  if (!words) return false;
  let hits = 0;
  let weak = 0;
  let n = 0;
  for (const word of words) {
    if (word.length < 2) continue;
    // Kennungen/Abkürzungen in Großschrift (EGR1U001, FRZ, RWY) zählen nicht
    if (word.length > 1 && word === word.toUpperCase()) continue;
    const w = word.toLowerCase();
    n++;
    if (isGermanWord(w)) hits++;
    else if (GERMAN_WEAK.has(w)) weak++;
  }
  if (hits === 0) return false;
  // kurze deutsche Wendungen („Dauerhaft aktiv (H24)“, „Botschaft“)
  if (n <= 3) return true;
  return (hits >= 2 || (hits >= 1 && weak >= 1)) && hits + weak >= n * 0.25;
}

/** Namen: schon deutsch, sobald ein deutsches Gattungswort vorkommt („Flugfeld X“). */
export function containsGermanWord(s: string): boolean {
  if (/ß/.test(s)) return true;
  for (const word of s.match(/[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*/g) ?? []) {
    if (word === word.toUpperCase()) continue;
    const w = word.toLowerCase();
    if (isGermanWord(w) || w.split("-").some((p) => p.length >= 4 && isGermanWord(p))) return true;
  }
  return false;
}

// --- Kennungen, Kontakte ----------------------------------------------------

/** Reine Kennung ohne Wörter (z. B. „EHD06“, „TMZ B2“, „GLV XII“) – nichts zu übersetzen. */
export function isCodeOnly(s: string): boolean {
  return !/[A-Za-zÀ-ÿĀ-žΑ-ωА-я]*[a-zà-ÿā-žα-ωа-я]{3,}/.test(s) && !/\b[A-ZÀ-ÝĀ-ŽΑ-ΩА-Я]{5,}\b/.test(s);
}

const CONTACT_TOKEN =
  /(?:[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/\S+|www\.\S+|\+?\d[\d\s()./-]{5,}\d|\b(?:tel|tel\.|phone|fax|e-?mail|email|mob|gsm|ext)\b\.?:?)/gi;

/** Nur Kontaktangaben (E-Mail, URL, Telefon) und Satzzeichen. */
export function isContactOnly(s: string): boolean {
  const rest = s.replace(CONTACT_TOKEN, " ").replace(/[\s,;:/|()\-–·.]+/g, "");
  return rest.length === 0 || (rest.length <= 3 && s.length > 6);
}

/** Wert ist Fließtext (mehrere Wörter), nicht nur Name/Kennung/Zahl. */
const PROSE_STOP = new Set(
  (
    "the and for with will are shall must not only from this that within area areas flight flights take place permitted prohibited " +
    "allowed required permission authorisation authorization contact operations operation activated activity during unless " +
    "de la el los las del en por para con sin zona y o es se un una " +
    "og i til på med av er ikke skal for som fra kan " +
    "di il della dei per con non sono e " +
    "na w z do i nie jest od po się " +
    "je se v na za do ne pri ali in iz " +
    "ir su be yra ne"
  ).split(" "),
);
const NAME_CONNECTORS = new Set("and und och og del des der den van von dei della the for".split(" "));

/** Name/Bezeichnung ohne Fließtext („Vattenfall Vattenkraft AB“, „Torp Tower“). */
export function isNameLike(s: string): boolean {
  const t = s.trim();
  if (!t || isProse(t) || t.split(/\s+/).length > 6) return false;
  // NOTAM-Großschrift ist kein Name (dafür gibt es das NOTAM-Glossar)
  if (!/[a-zà-ÿā-ž]/.test(t) && (t.match(/[A-ZÀ-ÝĀ-Ž]{3,}/g) ?? []).length > 2) return false;
  // kleingeschriebene Wörter (außer Bindewörtern) deuten auf Text, nicht auf Namen
  for (const w of t.match(/(?<![\w-])[a-zà-ÿā-ž]{3,}(?![\w-])/g) ?? []) if (!NAME_CONNECTORS.has(w)) return false;
  if (/\s(?:on|or|at|to|by|is|be|til|fra|er|på)\s/.test(` ${t} `)) return false;
  return /^[A-ZÀ-ÝĀ-Ž0-9„"'(]/.test(t);
}

export function isProse(s: string): boolean {
  const words = s.match(/[A-Za-zÀ-ÿĀ-žΑ-ωА-я]{2,}/g) ?? [];
  let n = 0;
  for (const w of words) {
    if (PROSE_STOP.has(w.toLowerCase()) || (/^[a-zà-ÿā-žα-ωа-я]{3,}$/.test(w))) n++;
    if (n >= 3) return true;
  }
  return false;
}

// --- Zeilen ------------------------------------------------------------------

/** Ergebnis der Zeilenprüfung. */
export type LineKind = "empty" | "dict" | "pattern" | "label" | "german" | "code" | "none";
export interface LineInfo {
  /** deutsche Fassung (bzw. Original, wenn nichts zu übersetzen/gefunden) */
  text: string;
  /** deutsch, übersetzt oder ohne Übersetzungsbedarf */
  ok: boolean;
  /** Text wurde tatsächlich übersetzt (Wörterbuch/Muster/Feldname) */
  translated: boolean;
  kind: LineKind;
}

let linesLower: Map<string, string> | null = null;
const looseKey = (k: string) => k.toLowerCase().replace(/[\s.;:,]+$/, "");
const lookupLine = (k: string): string | null => {
  const d = dict();
  const hit = d.lines[k] ?? runtime.get(k);
  if (hit) return hit;
  // Groß-/Kleinschreibung und Satzzeichen am Ende egal („Electronic/optical hazards.“)
  if (!linesLower) {
    linesLower = new Map();
    for (const [key, v] of Object.entries(d.lines)) linesLower.set(looseKey(key), v);
  }
  return linesLower.get(looseKey(k)) ?? null;
};

// Zeilen wie „Hinweis Traficom (fi): <Text>“ – das Etikett ist schon deutsch,
// übersetzt wird der Teil nach dem Doppelpunkt.
const LABEL_SPLIT = /^([^:]{1,60}?):\s*(\S.*)$/;
const BULLET = /^([–·•\-*]\s+)(.+)$/;

const cache = new Map<string, LineInfo>();
const CACHE_MAX = 20000;

function remember(k: string, info: LineInfo): LineInfo {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(k, info);
  return info;
}

/** Prüft/übersetzt eine Zeile (siehe Kopfkommentar). */
export function translateLineInfo(line: string): LineInfo {
  const k = translationKey(line);
  if (!k) return { text: line, ok: true, translated: false, kind: "empty" };
  return infoForKey(k);
}

/** Wie translateLineInfo für einen bereits normalisierten Schlüssel. */
function infoForKey(k: string): LineInfo {
  const hit = cache.get(k);
  if (hit) return hit;
  const r = lineInfoUncached(k, 0);
  // „übersetzt“ nur, wenn sich der Text wirklich ändert
  if (r.translated && translationKey(r.text) === k) r.translated = false;
  return remember(k, r);
}

function ok(text: string, kind: LineKind, translated: boolean): LineInfo {
  return { text, ok: true, translated, kind };
}

function lineInfoUncached(k: string, depth: number): LineInfo {
  // Teilstücke (Abschnitte, Platzhalter) wiederholen sich oft – mitcachen
  if (depth > 0) {
    const hit = cache.get(k);
    if (hit) return hit;
    const r = lineInfoCore(k, depth);
    // an der Rekursionsgrenze gescheiterte Teile nicht merken
    if (r.ok || depth < 5) remember(k, r);
    return r;
  }
  return lineInfoCore(k, depth);
}

function lineInfoCore(k: string, depth: number): LineInfo {
  const direct = lookupLine(k);
  if (direct) return ok(direct, "dict", direct !== k);
  if (isCodeOnly(k) || isContactOnly(k)) {
    // NOTAM-Kürzel („MAX HGT 300FT AGL“) trotzdem eindeutschen
    const g = /[A-Z]{3}/.test(k) ? translateNotamGloss(k) : null;
    if (g) return ok(g, "pattern", true);
    // kyrillische Abkürzungen („ГД ГВА“) lesbar umschreiben
    if (/[А-яЁё]/.test(k)) return ok(transliterateCyrillic(k), "pattern", true);
    return ok(k, "code", false);
  }
  if (depth > 6) return { text: k, ok: false, translated: false, kind: "none" };

  const b = k.match(BULLET);
  if (b) {
    const r = lineInfoUncached(b[2], depth + 1);
    return { ...r, text: b[1] + r.text };
  }

  const m = k.match(LABEL_SPLIT);
  if (m && !/^(https?|www|tel|mailto)$/i.test(m[1]) && !/^\d{1,2}$/.test(m[1].trim())) {
    const label = m[1];
    const value = m[2];
    if (isGermanLabel(label)) {
      const v = lineInfoUncached(value, depth + 1);
      if (v.ok) return { text: `${label}: ${v.text}`, ok: true, translated: v.translated, kind: v.translated ? "label" : "german" };
      // Namen, Kennungen, Kontakte, Höhen hinter deutschem Etikett: Gattungswörter
      // per Namensmuster eindeutschen, sonst unverändert
      if (isProperNameLabel(label)) {
        const n = translateZoneNameInfo(value);
        return n.translated ? ok(`${label}: ${n.text}`, "label", true) : ok(k, "german", false);
      }
      // sonst weiter mit Satzmustern / Deutsch-Erkennung der ganzen Zeile
    }
  }

  const p = translateLineByPattern(k, (s) => {
    const r = lineInfoUncached(translationKey(s), depth + 1);
    return r.ok ? r.text : null;
  });
  if (p != null) return ok(p, "pattern", p !== k);
  // Fremde Feldnamen der Quellen („Subject:“, „Omejitev:“, „Označenie / Identification:“)
  if (m && !isGermanLabel(m[1])) {
    const de = translateFieldLabel(m[1]);
    if (de) {
      const v = lineInfoUncached(m[2], depth + 1);
      if (v.ok) return ok(`${de}: ${v.text}`, "label", true);
      if (isProperNameLabel(de) || isNameLike(m[2])) return ok(`${de}: ${translateZoneNameInfo(m[2]).text}`, "label", true);
    }
  }
  if (looksGerman(k)) return ok(k, "german", false);
  // Bulgarische Eigennamen/Personen (kyrillisch, kein Fließtext): umschreiben
  if (/[А-яЁё]/.test(k) && !isProse(k) && k.split(/\s+/).length <= 6) return ok(transliterateCyrillic(k), "pattern", true);

  // Abschnittsweise: erst „ · “/„ | “/„ / “, dann Satzgrenzen
  // Ebenen: „ · “/„ | “ → Sätze → „ / “ (Aufzählungen, zweisprachige Texte)
  let segs = splitSegments(k, MAJOR_SEP);
  if (segs.length <= 1) segs = splitSegments(k, SENTENCE_SEP);
  if (segs.length <= 1) segs = splitSegments(k, SLASH_SEP);
  if (segs.length > 1) {
    const out: string[] = [];
    let all = true;
    let any = false;
    for (const part of segs) {
      if (part.sep) {
        out.push(part.text);
        continue;
      }
      const r = lineInfoUncached(part.text, depth + 1);
      out.push(r.text);
      // Abschnitt ohne Fließtext (Organisation, Ortsname, Kennung) bleibt stehen
      if (!r.ok && !isNameLike(part.text)) all = false;
      if (r.translated) any = true;
    }
    if (all) return ok(out.join(""), any ? "pattern" : "german", any);
    if (any) return { text: out.join(""), ok: false, translated: true, kind: "none" };
  }
  return { text: k, ok: false, translated: false, kind: "none" };
}

const MAJOR_SEP = /\s+[·|]\s+/g;
const SLASH_SEP = /\s+\/\s+/g;
// Satzende: Punkt/!/?/; + Leerraum + Großbuchstabe/Ziffer/Klammer
const SENTENCE_SEP = /(?<=[.!?;])\s+(?=[A-ZÀ-ÝĀ-Ž(„"'\[\d])/g;

/** Zerlegt eine Zeile an Trennern (Trenner bleiben als eigene Teile erhalten). */
function splitSegments(k: string, re: RegExp): { text: string; sep: boolean }[] {
  const out: { text: string; sep: boolean }[] = [];
  re.lastIndex = 0;
  let last = 0;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(k))) {
    const seg = k.slice(last, mm.index);
    if (seg) out.push({ text: seg, sep: false });
    out.push({ text: mm[0], sep: true });
    last = mm.index + mm[0].length;
  }
  const tail = k.slice(last);
  if (tail) out.push({ text: tail, sep: false });
  return out.filter((p) => p.sep || p.text.trim());
}

/** Übersetzt eine Zeile (oder gibt sie unverändert zurück). */
export function translateLineDe(line: string): string {
  const r = translateLineInfo(line);
  return r.translated ? r.text : line;
}

export interface TextTranslation {
  text: string;
  /** mindestens eine Zeile wurde übersetzt (Original sollte mit angezeigt werden) */
  changed: boolean;
  /** Der Text enthält bereits einen Block „Originaltext der Behörde:“ */
  originalIncluded: boolean;
  /** Zeilen ohne deutsche Fassung (Schlüssel) */
  untranslated: string[];
}

export interface TranslateTextOptions {
  /** Anzeige: Zeilen ohne deutsche Fassung mit „(nicht übersetzt)“ kennzeichnen. */
  markUntranslated?: boolean;
}

/** Überschrift vor den übersetzten Zeilen des Originalblocks. */
export const TRANSLATED_ORIGINAL_HEADING = "Behördentext (deutsch):";
/** Hinweis, wenn der Originalblock gar nicht übersetzt werden konnte. */
export const ORIGINAL_NOT_TRANSLATED_LINE = `Behördentext ${NOT_TRANSLATED_MARK} – siehe Originaltext unten.`;

/**
 * Übersetzt einen mehrzeiligen Text zeilenweise.
 *
 * Enthält der Text schon einen Block „Originaltext der Behörde:“ (deutsche
 * Meldung der Normalisierer), bleibt dieser unverändert; seine übersetzten
 * Zeilen kommen davor unter „Behördentext (deutsch):“ – das Original wird so
 * nicht doppelt angehängt (`originalIncluded`).
 */
export function translateTextDe(text: string, opts: TranslateTextOptions = {}): TextTranslation {
  const lines = String(text ?? "").split("\n");
  const hIdx = lines.findIndex((l) => l.trim() === ORIGINAL_TEXT_HEADING);
  const untranslated: string[] = [];
  let changed = false;
  const mapLine = (l: string, mark: boolean): string => {
    const k = translationKey(l);
    if (!k) return l;
    const r = infoForKey(k);
    if (!r.ok) untranslated.push(k);
    if (r.translated) {
      changed = true;
      return r.ok || !mark ? r.text : `${r.text} ${NOT_TRANSLATED_MARK}`;
    }
    return !r.ok && mark ? `${l} ${NOT_TRANSLATED_MARK}` : l;
  };
  if (hIdx < 0) {
    const out = lines.map((l) => mapLine(l, !!opts.markUntranslated)).join("\n");
    return { text: out, changed, originalIncluded: false, untranslated };
  }
  // Text vor dem Originalblock ist die deutsche Meldung des Normalisierers:
  // übersetzen, wo möglich, aber nie als „nicht übersetzt“ kennzeichnen.
  const head = lines.slice(0, hIdx).map((l) => mapLine(l, false));
  const orig = lines.slice(hIdx + 1);
  const infos = orig.map((l) => {
    const k = translationKey(l);
    return k ? infoForKey(k) : null;
  });
  let anyTranslated = false;
  let anyMissing = false;
  infos.forEach((r, i) => {
    if (!r) return;
    if (r.translated) anyTranslated = true;
    if (!r.ok) {
      anyMissing = true;
      untranslated.push(translationKey(orig[i]));
    }
  });
  const block: string[] = [];
  if (anyTranslated) {
    block.push(TRANSLATED_ORIGINAL_HEADING);
    const seen = new Set<string>();
    infos.forEach((r, i) => {
      if (!r) return;
      const t = r.translated ? r.text : orig[i];
      // zweisprachige Quellen (NO/SK: Landessprache + Englisch) ergeben dieselbe Zeile
      if (seen.has(translationKey(t))) return;
      seen.add(translationKey(t));
      block.push(!r.ok && opts.markUntranslated ? `${t} ${NOT_TRANSLATED_MARK}` : t);
    });
  } else if (anyMissing && opts.markUntranslated) {
    block.push(ORIGINAL_NOT_TRANSLATED_LINE);
  }
  // vor die Leerzeile(n) vor der Überschrift einfügen
  let insertAt = head.length;
  while (insertAt > 0 && !head[insertAt - 1].trim()) insertAt--;
  const outHead = block.length ? [...head.slice(0, insertAt), ...block, ...head.slice(insertAt)] : head;
  if (block.length && insertAt === head.length) outHead.push("");
  return {
    text: [...outHead, lines[hIdx], ...orig].join("\n"),
    changed: changed || anyTranslated,
    originalIncluded: true,
    untranslated,
  };
}

// --- Namen ---------------------------------------------------------------------

export interface NameInfo {
  text: string;
  ok: boolean;
  translated: boolean;
}

const nameCache = new Map<string, NameInfo>();

/** Prüft/übersetzt einen Zonennamen (Eigennamen bleiben, Gattungswörter werden deutsch). */
export function translateZoneNameInfo(name: string): NameInfo {
  const k = translationKey(name);
  if (!k) return { text: name, ok: true, translated: false };
  const hit = nameCache.get(k);
  if (hit) return hit;
  const d = dict();
  let r: NameInfo;
  const direct = d.names[k] ?? runtime.get(`name:${k}`);
  if (direct) r = { text: direct, ok: true, translated: direct !== k };
  else if (d.knownNames?.has(k) || isCodeOnly(k)) r = { text: k, ok: true, translated: false };
  else {
    // Teilnamen rekursiv (Wörterbuch, Muster, Eigennamen) – nur echte Teilstücke
    const sub = (s: string): string | null => {
      const t = translationKey(s);
      if (!t || t === k) return null;
      const x = translateZoneNameInfo(t);
      return x.ok ? x.text : null;
    };
    const p = translateNameByPattern(k, sub);
    if (p) r = { text: p.text, ok: true, translated: p.text !== k };
    // schon deutsch (Normalisierer) bzw. Kennung + Eigenname
    else if (containsGermanWord(k) || isProperDesignation(k)) r = { text: k, ok: true, translated: false };
    else r = { text: k, ok: false, translated: false };
  }
  if (nameCache.size >= CACHE_MAX) nameCache.clear();
  nameCache.set(k, r);
  return r;
}

/** Übersetzt einen Zonennamen (Eigennamen bleiben, Gattungswörter werden deutsch). */
export function translateZoneNameDe(name: string): string {
  const r = translateZoneNameInfo(name);
  return r.translated ? r.text : name;
}

/** Ist dieser Text bereits übersetzt bzw. braucht er keine Übersetzung? */
export function hasGermanFor(text: string, kind: "line" | "name" = "line"): boolean {
  const k = translationKey(text);
  if (!k) return true;
  if (kind === "name") return translateZoneNameInfo(k).ok;
  return translateLineInfo(k).ok;
}

/** Laufzeit-Übersetzungen eintragen (gerätelokaler Cache, Tests). */
export function addRuntimeTranslations(entries: Record<string, string>, kind: "line" | "name" = "line"): void {
  for (const [orig, de] of Object.entries(entries)) {
    if (!de) continue;
    runtime.set(kind === "name" ? `name:${translationKey(orig)}` : translationKey(orig), de);
  }
  cache.clear();
  nameCache.clear();
}

/** Nur für Tests: mitgeliefertes Wörterbuch ersetzen. */
export function __setBundledForTests(d: Dict | null): void {
  bundled = d;
  linesLower = null;
  runtime.clear();
  cache.clear();
  nameCache.clear();
}
