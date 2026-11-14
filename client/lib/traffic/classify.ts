// Kategorie-Klassifizierung für Live-Verkehr (ADS-B-Kategorie, ICAO-Typkürzel,
// Luftfahrzeugkennzeichen DE/AT/CH). 1:1 aus dem früheren Server-Aggregator
// (server/aggregator.ts) übernommen, damit die Einstufung clientseitig
// identisch bleibt.
import type { AircraftCategory } from "../opensky";

export function parseAdsbCategory(cat: string | number | undefined | null): AircraftCategory {
  if (cat == null || cat === "") return "unknown";
  if (typeof cat === "number") {
    // OpenSky numeric categories (state[17]):
    // 0/1 = no info, 2 = Light (<15500 lbs), 3-6 = airliner sizes,
    // 7 = High Performance (>5g/400kt — jets), 8 = Rotorcraft,
    // 9 = Glider/Sailplane, 10 = LTA (balloon), 14 = UAV
    if (cat === 0 || cat === 1) return "unknown";
    if (cat === 2) return "light";
    if (cat >= 3 && cat <= 6) return "airplane";
    if (cat === 7) return "airplane";
    if (cat === 8) return "helicopter";
    if (cat === 9) return "glider";
    if (cat === 10) return "balloon";
    if (cat === 14) return "drone";
    return "unknown";
  }
  const c = String(cat).toUpperCase();
  if (c === "A7") return "helicopter";
  if (c === "A0" || c === "A1") return "light";
  if (c === "B1") return "glider";
  if (c === "B2") return "balloon";
  if (c === "B4") return "ultralight";
  if (c === "B6") return "drone";
  if (c === "C1" || c === "C2" || c === "C3") return "ground";
  if (c.startsWith("A")) return "airplane";
  return "unknown";
}

// ICAO Type Designators für Verkehrs-/Geschäftsjets und größere Turboprops.
// Wenn aircraftType passt, übersteuert das eine fehlerhafte/unklare ADS-B-Kategorie.
const AIRLINER_TYPE_REGEX = /^(A\d{2,3}|B7\d{1,2}|B73\d|B74\d|B75\d|B76\d|B77\d|B78\d|E1[79]\d|E2[79]\d|E29\d|E50\d|E55\d|MD\d{2}|CRJ\d|DH\d|AT\d{2}|AT4\d|AT7\d|F\d{2,3}|RJ\d{2,3}|SU\d{2}|IL\d{2}|TU\d{2,3}|YK\d{2}|BCS\d|BE\d{2}|BE\d{3}|C\d{3}|C\d{4}|GLF\d|GL\d{2,3}|H25\d|FA\d{2}|FA\d{2,3}|J328|D328|SF34|SB20|J41|JS41|RJ85|RJ1H|B461|B462|B463|L101|DC\d|DC\d{2}|MD11|MD80|MD81|MD82|MD83|MD87|MD88|MD90|B190|B350|B300|B250|B200|PC12|PC24|TBM\d|TBM7\d|TBM8\d|TBM9|EA50|HDJN|LJ\d{2}|LJ\d{2,3})$/;

// ICAO-Typenkürzel von gängigen Hubschraubern. Überstimmt fehlerhafte
// ADS-B-Kategorien (z. B. Küstenwache-AW139 als "light" gemeldet).
const HELICOPTER_TYPE_REGEX = /^(A109|A119|A139|A149|A169|A189|AW09|AW119|AW139|AW149|AW169|AW189|AS3[256]\d|AS3[256]\dB[12]?|AS50|AS55|AS65|AS32|AS3B|EC20|EC25|EC30|EC35|EC45|EC55|EC75|EC120|EC130|EC135|EC145|EC155|EC175|EC225|EC635|EC665|H1[2-9]\d|H21[5-9]|H225|H22[0-9]|BK117|MD5[0-9]\d|MD9\d{2}|MD600|MI[0-9]|MI1[0-9]|MI2[0-9]|MI[28]T|S6[14-9]|S7[0-9]|S9[0-9]|S30[0-9]|S31[0-9]|S32[0-9]|S33[0-9]|S64|S70|S76|S92|R22|R44|R66|B06|B06T|B105|B212|B214|B222|B230|B407|B412|B427|B429|B430|B47[0-9]|B505|UH1[A-Z]?|UH60|UH72|CH4[7-9]|CH53|TIGR|EH101|AW101|NH90|LYNX|WHIRL|ALH|DHRU|GAZL|HUGH|SCOR|EX[NT]|R\d{2}|H47|CO\d{2}|TWHK|EHST|EHJG|EHJC|ZG)$/;
// Hubschrauber-Stichwörter im Description-Feld (adsb.fi/.one liefern `desc`).
const HELICOPTER_DESC_REGEX = /\b(helicopter|helikopter|chopper|rotor(craft)?|h\/c)\b/i;

// Klassifizierung anhand des deutschen Luftfahrzeugkennzeichens (D-…).
// Quelle: https://de.wikipedia.org/wiki/Luftfahrzeugkennzeichen
//   D-A…   Flugzeuge > 20 t (airplane)
//   D-B…   Flugzeuge 14–20 t (airplane)
//   D-C…   Flugzeuge 5,7–14 t (airplane)
//   D-E…   einmot. Flugzeuge < 2 t (light, z.B. Cessna 172)
//   D-F…   einmot. Flugzeuge 2–5,7 t (airplane, z.B. PC-12)
//   D-G…   mehrmot. Flugzeuge < 2 t (airplane, z.B. DA42)
//   D-H…   Drehflügler / Hubschrauber (helicopter)
//   D-I…   mehrmot. Flugzeuge 2–5,7 t (airplane, z.B. Citation CJ1)
//   D-K…   Motorsegler (glider)
//   D-L…   Luftschiffe (balloon — Zeppelin NT, Prall-LS)
//   D-M…   motorisierte Luftsportgeräte / UL (ultralight)
//   D-N…   nichtmotorisierte Luftsportgeräte (glider — Hängegleiter)
//   D-O…   bemannte Ballone (balloon)
//   D-P…   unbemannte Luftfahrtsysteme (drone)
//   D-1234 vierstellige Zahl → Segelflugzeug (glider)
// Klassifizierung anhand österreichischer Luftfahrzeugkennzeichen (OE-…).
// Quelle: https://de.wikipedia.org/wiki/Luftfahrzeugkennzeichen#Österreich
//   OE-A, OE-C       einmot. <2t, 1–3 Sitze (light)
//   OE-B             Bundes-Luftfahrzeuge (airplane)
//   OE-D, OE-K       einmot. <2t, >3 Sitze (light)
//   OE-E             einmot. 2–5,7 t (airplane)
//   OE-F             mehrmot. <5,7 t (airplane)
//   OE-G             5,7–14 t (airplane)
//   OE-H             14–20 t (airplane)
//   OE-I, OE-L       >20 t (airplane)
//   OE-W             Wasser-/Amphibienflugzeuge (airplane)
//   OE-X             Hubschrauber (helicopter)
//   OE-Y             unbemannte Luftfahrzeuge (drone)
//   OE-0xxx, 5xxx, 9xxx  Segelflugzeuge / Motorsegler (glider)
//   OE-6xxx, 7xxx, 8xxx  Ultraleicht / Hängegleiter / Trikes (ultralight)
function categoryFromAustrianRegistration(reg: string): AircraftCategory | null {
  const r = reg.toUpperCase().replace(/\s/g, "");
  if (!r.startsWith("OE-") || r.length < 4) return null;
  const tail = r.slice(3);
  if (/^\d+$/.test(tail)) {
    const d = tail[0];
    if (d === "0" || d === "5" || d === "9") return "glider";
    if (d === "6" || d === "7" || d === "8") return "ultralight";
    return null;
  }
  const c = tail[0];
  switch (c) {
    case "A":
    case "C":
    case "D":
    case "K":
      return "light";
    case "B":
    case "E":
    case "F":
    case "G":
    case "H":
    case "I":
    case "L":
    case "W":
      return "airplane";
    case "X":
      return "helicopter";
    case "Y":
      return "drone";
    default:
      return null;
  }
}

// Klassifizierung anhand schweizerischer Luftfahrzeugkennzeichen (HB-…).
// Quelle: https://de.wikipedia.org/wiki/Luftfahrzeugkennzeichen#Schweiz
//   HB-A         zweimot. Turboprops 5,7–15 t / Verkehrsflugzeuge (airplane)
//   HB-B, HB-Q   Heißluft- und Gasballone (balloon)
//   HB-C, HB-T   einmot. Cessna <5,7 t (light)
//   HB-D, HB-E, HB-K, HB-N, HB-O, HB-P, HB-S, HB-U, HB-H
//                einmot. Flugzeuge <5,7 t (light)
//   HB-F         Schweizer Produktion (Pilatus PC-6/PC-12) (airplane — Turboprop)
//   HB-G, HB-L   zweimot. Flugzeuge <5,7 t (airplane)
//   HB-I, HB-J   Flugzeuge >15 t (airplane)
//   HB-V         Business-Jets <15 t (airplane)
//   HB-M         Kunstflugzeuge (light)
//   HB-R         Oldtimer / Spezielle (light)
//   HB-W         Ecolight (ultralight)
//   HB-X, HB-Z   Helikopter (helicopter)
//   HB-Y         Experimental (unbestimmt)
function categoryFromSwissRegistration(reg: string): AircraftCategory | null {
  const r = reg.toUpperCase().replace(/\s/g, "");
  if (!r.startsWith("HB-") || r.length < 4) return null;
  const c = r[3];
  switch (c) {
    case "B":
    case "Q":
      return "balloon";
    case "C":
    case "T":
    case "D":
    case "E":
    case "K":
    case "N":
    case "O":
    case "P":
    case "S":
    case "U":
    case "H":
    case "M":
    case "R":
      return "light";
    case "A":
    case "F":
    case "G":
    case "L":
    case "I":
    case "J":
    case "V":
      return "airplane";
    case "W":
      return "ultralight";
    case "X":
    case "Z":
      return "helicopter";
    default:
      return null;
  }
}

function categoryFromGermanRegistration(reg: string): AircraftCategory | null {
  const r = reg.toUpperCase().replace(/\s/g, "");
  if (!r.startsWith("D-") || r.length < 3) return null;
  const tail = r.slice(2);
  // D-xxxx (rein numerisch, typ. 4-stellig) → Segelflugzeug
  if (/^\d+$/.test(tail)) return "glider";
  const c = tail[0];
  switch (c) {
    case "A":
    case "B":
    case "C":
    case "F":
    case "G":
    case "I":
      return "airplane";
    case "E":
      return "light";
    case "H":
      return "helicopter";
    case "K":
    case "N":
      return "glider";
    case "L":
    case "O":
      return "balloon";
    case "M":
      return "ultralight";
    case "P":
      return "drone";
    default:
      return null;
  }
}

// Gängige ICAO-Typenkürzel von Kleinflugzeugen (Kolben-GA, Reise-/Schul-/
// Sportflugzeuge, leichte Zwillinge, Motorsegler). FR24/adsb liefern diese im
// Typfeld; ohne diese Zuordnung blieben identifizierte Maschinen wie eine
// Robin DR400 (DR40) als "unknown" und bekamen das generische Flugzeug-Symbol.
const LIGHT_TYPE_SET = new Set<string>([
  // Robin / CEA
  "DR40", "DR22", "DR25", "DR30", "R200", "DR21", "DR15", "R100",
  // Piper
  "PA28", "PA32", "PA34", "PA38", "PA18", "PA22", "PA24", "PA25", "PA46", "PA44", "PA27", "PA31", "PA12", "PA20",
  // Cessna pistons / Reims
  "C150", "C152", "C162", "C170", "C172", "C175", "C177", "C180", "C182", "C185", "C188", "C190", "C195",
  "C205", "C206", "C207", "C210", "C72R", "C77R", "C82R", "C82T", "C310", "C336", "C337", "C340", "C402",
  "C404", "C411", "C414", "C421", "P210", "T210", "F150", "F152", "F172", "F177", "F182", "FA72", "R172",
  // Diamond
  "DA40", "DA42", "DA50", "DA62", "DV20", "DIMO", "HK36", "S10", "S12",
  // Cirrus
  "SR20", "SR22", "S22T",
  // Beech pistons / light twins
  "BE19", "BE23", "BE24", "BE33", "BE35", "BE36", "BE55", "BE58", "BE76", "BE77", "BE95", "BE60",
  // Mooney
  "M20P", "M20T", "M20J", "M20K", "M20R", "M20S", "M20V",
  // Socata / Aerospatiale
  "TB9", "TB10", "TB20", "TB21", "TOBA", "TAMP", "RALY", "ST10",
  // Grumman American
  "AA1", "AA5", "AG5", "GA7",
  // Vans RV (amateur-built)
  "RV3", "RV4", "RV6", "RV7", "RV8", "RV9", "RV10", "RV12", "RV14",
  // Aquila
  "AT01", "AT03", "A210",
  // Maule
  "M5", "M6", "M7", "MX7",
  // Aerobatic / Sport
  "EA30", "E300", "S1", "PTS2", "PTSS", "CP10", "SU26", "SU29", "YK52", "YK18", "T6",
  // Motorsegler / Kit
  "SF25", "GLAS", "GLST", "LNC2", "LNC4", "COZY", "VELO", "KITF", "GP4",
]);

// Ultraleicht- / Microlight-Typen.
const ULTRALIGHT_TYPE_SET = new Set<string>([
  "C42", "CTLS", "CTSW", "FK9", "FK14", "FK12", "P92", "P2002", "P2008", "VL3", "MCR1", "MCR4", "WT9",
  "SHCK", "BRM1", "DYNA", "SAVG", "PIPI", "A22", "A32", "ZENI", "SKYR", "ULAC", "TL20", "TL30", "TL96",
  "SIRA", "KFOX", "ALTO", "FOXC", "JABI", "RANS", "TAUR", "SNGL", "VIRS", "ELA7", "ELA8", "ELA9",
  "GYRO", "MGYR", "CALI", "MTOS", "AUTO",
]);

// Distinktive Segelflug-Typkürzel (FR24-only-Gliders ohne OGN-Kategorie).
const GLIDER_TYPE_SET = new Set<string>([
  "LS3", "LS4", "LS6", "LS7", "LS8", "DG40", "DG80", "DG10", "DG1T", "DUOD", "ARCE", "JANU", "VENT",
  "DISC", "NIMB", "STD3", "SF27", "ASW2", "ASK2", "ASH2", "ASH3", "ASG2", "ASG3", "PIK2", "PEGA",
  "G103", "G102", "JS1", "JS3", "TWIN",
]);

// Typkürzel → Kategorie. Liefert die präzise Kategorie oder null, wenn das
// Kürzel nicht bekannt ist (dann greift ggf. der generische Flugzeug-Fallback).
function categoryFromTypeDesignator(t: string): AircraftCategory | null {
  if (!t) return null;
  if (t === "GLID") return "glider";
  if (t === "BALL" || t === "GASB" || t === "SHIP") return "balloon";
  if (t === "UAV" || t === "DRON" || t === "SUAV" || t === "RPAS") return "drone";
  if (LIGHT_TYPE_SET.has(t)) return "light";
  if (ULTRALIGHT_TYPE_SET.has(t)) return "ultralight";
  if (GLIDER_TYPE_SET.has(t)) return "glider";
  // Sichere Familien-Muster (keine Kollision mit Militär-/Verkehrsmustern).
  if (/^(DR[234]\d|P28[ABRSTU]|P32[RT]|PA(18|2[24578]|3[148]|44|46)|DA(4\d|50|62)|SR2[02]|M20[A-Z]|TB(9|1\d|2\d)|RV\d{1,2}|AA[15])$/.test(t)) return "light";
  return null;
}

// Plausibles ICAO-Typkürzel (2–4 alnum, beginnt mit Buchstaben; keine
// Platzhalter). Ist eines vorhanden, handelt es sich sicher um ein
// Luftfahrzeug → mindestens "Flugzeug" statt "Unbekannt".
function isPlausibleTypeDesignator(t: string): boolean {
  if (!/^[A-Z][A-Z0-9]{1,3}$/.test(t)) return false;
  return t !== "ZZZZ" && t !== "GRND" && t !== "UNKN" && t !== "NONE" && t !== "TWR";
}

export function refineCategoryByType(cat: AircraftCategory, aircraftType?: string, registration?: string, aircraftDesc?: string): AircraftCategory {
  // Hubschrauber-Typenkürzel haben Vorrang — auch über Registrierungsregeln.
  // ADS-B liefert AW139/EC135 etc. häufig als "light"; Description-Felder
  // (adsb.fi/.one) enthalten oft "Helicopter".
  if (aircraftType) {
    const t = aircraftType.toUpperCase().trim();
    if (t && HELICOPTER_TYPE_REGEX.test(t)) return "helicopter";
  }
  if (aircraftDesc && HELICOPTER_DESC_REGEX.test(aircraftDesc)) return "helicopter";
  // Registrierung ist die zuverlässigste Quelle für Land-spezifische Suffixe —
  // sie überstimmt fehlerhafte ADS-B-Kategorien (z.B. D-H… Hubschrauber).
  if (registration) {
    const fromReg = categoryFromGermanRegistration(registration)
      ?? categoryFromAustrianRegistration(registration)
      ?? categoryFromSwissRegistration(registration);
    if (fromReg) return fromReg;
  }
  if (aircraftType) {
    const t = aircraftType.toUpperCase().trim();
    if (t) {
      // Präzise Kategorie aus bekanntem Typkürzel (z.B. DR40 → Sportflugzeug)
      // hat Vorrang vor dem bewusst groben Airliner-Muster — das würde sonst
      // z.B. C172 (C\d{3}), BE33 (BE\d{2}) oder SU26/YK52 fälschlich als
      // "Flugzeug" statt Sportflugzeug einstufen. Setzt die Kategorie nur, wenn
      // ADS-B nichts Spezifischeres lieferte ("unknown") oder nur grob "airplane".
      const typed = categoryFromTypeDesignator(t);
      if (typed && (cat === "unknown" || cat === "airplane")) return typed;
      // Bekanntes GA-/Segelflug-/UL-Kürzel: präzise Kategorie NIEMALS durch das
      // bewusst grobe Airliner-Muster überschreiben — dessen Familien wie
      // C\d{3} / BE\d{2} / SU\d{2} / YK\d{2} kollidieren sonst mit C152, C172,
      // BE33, SU26, YK52 und würden ein korrektes "Sportflugzeug" zu "Flugzeug"
      // herabstufen, wenn ADS-B die Kategorie schon richtig lieferte.
      if (typed) return cat;
      if (AIRLINER_TYPE_REGEX.test(t)) return "airplane";
      // Typkürzel vorhanden, aber nicht zugeordnet → mindestens "Flugzeug",
      // damit identifizierte Maschinen nicht als "Unbekannt" erscheinen.
      if (cat === "unknown" && isPlausibleTypeDesignator(t)) return "airplane";
    }
  }
  return cat;
}
