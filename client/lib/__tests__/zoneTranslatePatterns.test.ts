// Musterbasierte Übersetzung (shared/zoneTranslatePatterns.ts) – echte Beispiele
// je Land aus den Live-Daten/Fixtures (Stand 15.11.2026). Die Tabelle läuft
// OHNE Wörterbuch: alles hier kommt allein aus den Satzmustern, Feldnamen und
// dem NOTAM-Glossar.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  NOT_TRANSLATED_MARK,
  TRANSLATED_ORIGINAL_HEADING,
  __setBundledForTests,
  hasGermanFor,
  translateLineInfo,
  translateTextDe,
  translateZoneNameInfo,
} from "../../../shared/zoneTranslate";
import { formatHeightDe, patternStats, translateNotamGloss, transliterateCyrillic } from "../../../shared/zoneTranslatePatterns";
import { parseEd269ToGeozoneInfo } from "../ed269";

const LINES: [string, string, string][] = [
  [
    "EE",
    "TEMPORARY RESTRICTED AREA EER26174UA ESTABLISHED FOR UNMANNED AIRCRAFT SYSTEM ACTIVITIES WITHIN: 583745N 0250022E - 584941N 0253409E - 583745N 0250022E. PERMISSION FOR ENTERING THE AREA SHALL BE OBTAINED FROM TEL +372 56 502 880. [Schedule: DAILY 0700-1600]",
    "Temporäres Beschränkungsgebiet EER26174UA eingerichtet für den Betrieb unbemannter Luftfahrzeugsysteme innerhalb: 583745N 0250022E - 584941N 0253409E - 583745N 0250022E. Genehmigung für den Einflug ist einzuholen bei Tel. +372 56 502 880. [Zeitplan: täglich 07:00–16:00]",
  ],
  [
    "EE",
    "RESTRICTED AREA EER15D ACTIVATED. VERTICAL LIMITS CHANGED DURING ACTIVATION. PERMISSION FOR ENTERING THE AREA SHALL BE OBTAINED FROM TEL +372 7173701. [Schedule: 16 20 1100-1330]",
    "Beschränkungsgebiet EER15D aktiviert. Vertikale Grenzen während der Aktivierung geändert. Genehmigung für den Einflug ist einzuholen bei Tel. +372 7173701. [Zeitplan: 16 20 11:00–13:30]",
  ],
  ["NO", "Aktiv iflg. NOTAM 13.11.2026 08:17–14.11.2026 20:00 (lokal tid).", "Aktiv laut NOTAM 13.11.2026 08:17–14.11.2026 20:00 (Ortszeit)"],
  [
    "NO",
    "UNMANNED ACFT (BLOS) WILL TAKE PLACE IN SKI AREA PSN 594300N 0105000E, RADIUS 2NM. MAX HGT 400FT AGL. · CTC TEL +47 99999999 · LOWER: GND · UPPER: 400FT AMSL",
    "Flugbetrieb unbemannter Luftfahrzeuge (BLOS) im Gebiet SKI Position 594300N 0105000E, Radius 2NM. max. Höhe 400FT AGL. · Kontakt Tel. +47 99999999 · Untergrenze: GND · Obergrenze: 400FT AMSL",
  ],
  [
    "NO",
    "TEMPO DANGER AREA 'KVITFJELL' ACTIVATED FOR UNMANNED ACFT IN PSN 693532N 0180811E, RADIUS 2,5NM. · CTC NORCE +47 46681795 · LOWER: GND · UPPER: 4500FT AMSL",
    "Temporäres Gefahrengebiet 'KVITFJELL' aktiviert für unbemannte Luftfahrzeuge an Position 693532N 0180811E, Radius 2,5NM. · Kontakt NORCE +47 46681795 · Untergrenze: GND · Obergrenze: 4500FT AMSL",
  ],
  [
    "NO",
    "MIL UNMANNED ACFT (BLOS/VLOS) WILL TAKE PLACE EAST OF END407 PSN: 690528N 0191119E - 690552N 0191015E",
    "Militärischer Flugbetrieb unbemannter Luftfahrzeuge (BLOS/VLOS) östlich von END407 Position 690528N 0191119E - 690552N 0191015E",
  ],
  ["NO", "Sanntidsaktivering. Status AVBL FM Farris APP. Ikke-deltakende TFC vil gis prioritet.", "Echtzeitaktivierung. Status erhältlich bei Farris APP. Nicht beteiligter Verkehr erhält Vorrang."],
  ["DK", "E) DRONE OPERATIONS WILL TAKE PLACE AT PSN: 5542N01233E", "E) Drohnenflüge finden statt an Position 5542N01233E"],
  ["DK", "D) DAILY 0800-1400", "D) täglich 08:00–14:00 UTC"],
  ["DK", "Q) EKDK/QWULW/IV/BO /AW/000/004/5509N00712E006", "Q) EKDK/QWULW/IV/BO /AW/000/004/5509N00712E006"],
  ["ES", "E) UAS OPERATIONS WILL TAKE PLACE WI RADIUS OF 2KM CENTRED ON 432800N0034800W.", "E) UAS-Flüge finden statt im Umkreis von 2KM um 432800N0034800W"],
  ["ES", "Zona prohibida. Prohibido el vuelo de UAS salvo autorización expresa.", "Sperrgebiet. UAS-Flüge verboten, außer mit ausdrücklicher Genehmigung."],
  [
    "ES",
    "Operaciones en zona urbana: requiere comunicación previa al Ministerio del Interior con una antelación mínima de 5 días naturales.",
    "Betrieb in städtischem Gebiet: vorherige Mitteilung an das Innenministerium mindestens 5 Kalendertage im Voraus erforderlich.",
  ],
  ["IT", "UAS ACTIVITY PROHIBITED WI 2KM RADIUS CENTERED 404900N 0141500E", "UAS-Betrieb verboten im Umkreis von 2 km um 404900N 0141500E"],
  ["IT", "Operazioni consentite fino a 60 m AGL", "Betrieb bis 60 m AGL erlaubt"],
  ["PL", "RPA sector, flights up to 100 m AGL after notification.", "RPA-Sektor: Flüge bis 100 m AGL nach vorheriger Meldung."],
  ["PL", "DRA-P – zakaz lotów BSP.", "DRA-P – Drohnenflüge (BSP) verboten."],
  ["RO", "E) TEMPORARY RESTRICTED AREA FOR IFR, VFR AND UNMANNED ACFT FLT", "E) Temporäres Beschränkungsgebiet für IFR-, VFR- und unbemannte Flüge"],
  ["RO", "D) DAILY 1730-0530", "D) täglich 17:30–05:30 UTC"],
  ["SK", "Obmedzenie / Restriction: Prevádzka civilných letov UAS je zakázaná / Operations of civil UAS are prohibited.", "Beschränkung: Ziviler UAS-Betrieb verboten."],
  ["SK", "ZAKÁZANÁ PREVÁDZKA UAS / PROHIBITED UAS OPERATION", "UAS-Betrieb verboten"],
  ["SK", "Doba platnosti / Validity period: stála permanent", "Gültigkeit: ständig"],
  ["HR", "Rezervacija iz mobilne aplikacije ( 45° 21' 3\" N, 19° 0' 19\" E )", "Reservierung aus der mobilen App (45° 21' 3\" N, 19° 0' 19\" E)"],
  ["HR", "Aktivität: Paraglider (englischer Originaltext)", "Aktivität: Gleitschirmflug (aus dem Englischen)"],
  [
    "LT",
    "Prohibited geographical zone. Flights within the T62 zone are permitted only after obtaining permission from the Lithuanian Armed Forces.",
    "Geografische Verbotszone. Flüge in der Zone T62 nur mit Genehmigung der litauischen Streitkräfte",
  ],
  ["LT", "Skrydžio paraiška turi būti pateikta ne vėliau kaip prieš 5 d.d. iki skrydžio.", "Der Flugantrag ist spätestens 5 Arbeitstage vor dem Flug zu stellen."],
  [
    "LT",
    "DRONES FLT ACT WILL TAKE PLACE WI 2350M RADIUS CENTRED ON 545509N 0240408E (PALEMONAS). OPS CTC +370 624 72 991",
    "Drohnenflüge finden statt im Umkreis von 2350M um 545509N 0240408E (PALEMONAS). Kontakt Einsatzleitung: +370 624 72 991",
  ],
  ["SI", "OMEJITEV: dovoljeno do višine 50 m AGL (nad terenom)", "Beschränkung: erlaubt bis 50 m AGL (über Grund)"],
  ["SI", "Subject: Aerodrome Ajdovscina", "Bezeichnung: Flugplatz Ajdovscina"],
  ["SI", "Izjeme_zaprto: Odprto 24/7", "Ausnahmen (geschlossen): geöffnet 24/7"],
  ["BG", "майор Иван Минков", "Major Ivan Minkov"],
  ["BG", "Забраняват се полетите с безпилотни летателни системи в установената зона.", "Flüge mit unbemannten Luftfahrzeugsystemen in der festgelegten Zone sind verboten."],
  ["BG", "Да се уведомява лицето за контакт за планираната дейност 3 дни предварително", "Die Kontaktperson ist 3 Tage vorher über die geplante Tätigkeit zu informieren."],
  ["CY", "Ηλεκτρονική Διεύθυνση: UAVsec@eac.com.cy", "E-Mail: UAVsec@eac.com.cy"],
  ["GB", "Unmanned aircraft flight not permitted unless permission has been granted by NSA RAF FELTWELL.", "Flüge mit unbemannten Luftfahrzeugen nur mit Genehmigung von: NSA RAF FELTWELL."],
  ["GB", "Vertical Limit 10,000 FT ALT.", "Vertikale Grenze: 10,000 ft MSL"],
  ["GB", "Site elevation: 104 FT AMSL", "Geländehöhe am Standort: 104 ft AMSL"],
  ["GB", "Service: SUAAIS: London Information on 124.750 MHz.", "Funk/Dienst: SUAAIS: London Information auf 124.750 MHz"],
  ["MT", "Fort St.Elmo - Contact venues@heritagemalta.org", "Fort St.Elmo – Kontakt: venues@heritagemalta.org"],
  ["FR", "Hinweis: Altitude de référence de l'aérodrome : 281 m", "Hinweis: Bezugshöhe des Flugplatzes: 281 m"],
  ["CZ", "Hinweis der Behörde: lower limit FL95,upper limit FL225", "Hinweis der Behörde: Untergrenze FL 95, Obergrenze FL 225"],
  ["CH", "UNMANNED ACFT ACT WILL TAKE PLACE ON GRAND ST. BERNARD", "Flugbetrieb unbemannter Luftfahrzeuge am GRAND ST. BERNARD"],
];

const NAMES: [string, string, string][] = [
  ["CH", "Protected natural object Sunnenrain", "Geschütztes Naturobjekt Sunnenrain"],
  ["CH", "LSMA Alpnach (Airport perimeter)", "LSMA Alpnach (Flugplatzperimeter)"],
  ["CZ", "Grid ATZ 924013", "Höhenraster ATZ 924013"],
  ["IS", "Vopnafjörður flugvöllur", "Flugplatz Vopnafjörður"],
  ["NO", "Hovden TIZ (Del 1)", "Hovden TIZ (Teil 1)"],
  ["BG", "Бургас (LBBG)-0000685", "Burgas (LBBG)-0000685"],
  ["LU", "EL-UAS-H1-1 – Hélistation HRS (Site Kirchberg)", "EL-UAS-H1-1 – Hubschrauberlandeplatz HRS (Site Kirchberg)"],
  ["RO", "Zona UAS RZ 1001", "UAS-Zone RZ 1001"],
  ["MT", "St Luke's Helipad", "Hubschrauberlandeplatz St Luke's"],
];

describe("Satzmuster ohne Wörterbuch (echte Texte je Land)", () => {
  before(() => __setBundledForTests({ lines: {}, names: {} }));
  after(() => __setBundledForTests(null));

  for (const [iso, src, want] of LINES) {
    it(`${iso}: ${src.slice(0, 60)}`, () => {
      const r = translateLineInfo(src);
      assert.equal(r.ok, true, `nicht übersetzt: ${src}`);
      assert.equal(r.text, want);
    });
  }
  for (const [iso, src, want] of NAMES) {
    it(`Name ${iso}: ${src}`, () => {
      const r = translateZoneNameInfo(src);
      assert.equal(r.ok, true);
      assert.equal(r.text, want);
    });
  }

  it("Kennung + Eigenname bleibt unverändert, gilt aber als erledigt", () => {
    for (const n of ["EGR1U025A HALTON", "ATZ VARAZDIN", "POPOV (TRA)", "LSZH Zürich", "EYP33 BELMONTAS"]) {
      const r = translateZoneNameInfo(n);
      assert.equal(r.ok, true, n);
      assert.equal(r.text, n);
    }
    // Gattungswörter in Großschrift werden nicht als Eigenname durchgewunken
    assert.equal(translateZoneNameInfo("CENTRAL NUCLEAR DE ALMARAZ").ok, false);
  });

  it("unbekanntes Englisch bleibt im NOTAM-Glossar unübersetzt (kein halbes Deutsch)", () => {
    assert.equal(translateNotamGloss("UNMANNED ACFT WILL TAKE PLACE IN SKI AREA FOR SOME UNKNOWN PURPOSE"), null);
    assert.equal(translateLineInfo("Pilots should consider the weather before departure.").ok, false);
  });

  it("Platzhalter: Höhen, Umschrift", () => {
    assert.equal(formatHeightDe("00120M AGL"), "120 m AGL");
    assert.equal(formatHeightDe("FL095"), "FL 95");
    assert.equal(formatHeightDe("GND"), "Boden (GND)");
    assert.equal(formatHeightDe("400FT"), "400 ft");
    assert.equal(transliterateCyrillic("Пловдив"), "Plovdiv");
  });

  it("Regelwerk ist geladen", () => {
    const s = patternStats();
    assert.ok(s.lines > 300 && s.names > 50 && s.fields > 80, JSON.stringify(s));
  });
});

describe("Anzeige: Kennzeichnung und Originalblock", () => {
  before(() => __setBundledForTests({ lines: {}, names: {} }));
  after(() => __setBundledForTests(null));

  it("nichts übersetzbar: Original mit „(nicht übersetzt)“, kein zweiter Originalblock", () => {
    const r = translateTextDe("Pilots should consider the weather before departure.", { markUntranslated: true });
    assert.equal(r.changed, false);
    assert.equal(r.text, `Pilots should consider the weather before departure. ${NOT_TRANSLATED_MARK}`);
    const [z] = parseEd269ToGeozoneInfo(
      [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[[6, 61], [6.1, 61], [6.1, 61.1], [6, 61]]] }, properties: { name: "EYP33 BELMONTAS", restriction: "PROHIBITED", message: "Pilots should consider the weather before departure." } }] as any,
      "LT",
    );
    assert.match(z.details, /\(nicht übersetzt\)/);
    assert.doesNotMatch(z.details, /Originaltext der Behörde/);
  });

  it("ohne Kennzeichnung (Standard) bleibt der Text unverändert", () => {
    const r = translateTextDe("Pilots should consider the weather before departure.");
    assert.equal(r.text, "Pilots should consider the weather before departure.");
    assert.deepEqual(r.untranslated, ["Pilots should consider the weather before departure."]);
  });

  it("übersetzte Zeilen: Original wird angehängt", () => {
    const [z] = parseEd269ToGeozoneInfo(
      [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[[6, 61], [6.1, 61], [6.1, 61.1], [6, 61]]] }, properties: { name: "Zona UAS RZ 1001", restriction: "RESTRICTED", message: "D) DAILY 1730-0530" } }] as any,
      "RO",
    );
    assert.equal(z.name, "UAS-Zone RZ 1001");
    assert.match(z.details, /D\) täglich 17:30–05:30 UTC/);
    assert.match(z.details, /Originaltext der Behörde:\nZona UAS RZ 1001\nD\) DAILY 1730-0530/);
    assert.equal(z.details.split("Originaltext der Behörde:").length, 2, "genau ein Originalblock");
  });

  it("deutsche Meldung mit Originalblock: Übersetzung davor, Original genau einmal", () => {
    const message = ["Typ: Flugbeschränkungsgebiet", "", "Originaltext der Behörde:", "Omejitev: Prepovedano", "Ime: Abakian-Pince Marof"].join("\n");
    const r = translateTextDe(message, { markUntranslated: true });
    assert.equal(r.originalIncluded, true);
    assert.equal(
      r.text,
      ["Typ: Flugbeschränkungsgebiet", TRANSLATED_ORIGINAL_HEADING, "Beschränkung: verboten", "Name: Abakian-Pince Marof", "", "Originaltext der Behörde:", "Omejitev: Prepovedano", "Ime: Abakian-Pince Marof"].join("\n"),
    );
    const [z] = parseEd269ToGeozoneInfo(
      [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[14, 46], [14.1, 46], [14.1, 46.1], [14, 46]]] },
          properties: { name: "Abakian-Pince Marof", restriction: "PROHIBITED", extendedProperties: { localizedMessages: [{ language: "de", message }, { language: "sl", message: "Omejitev: Prepovedano" }] } },
        },
      ] as any,
      "SI",
    );
    assert.equal(z.details.split("Originaltext der Behörde:").length, 2, "genau ein Originalblock");
    assert.match(z.details, /Behördentext \(deutsch\):\nBeschränkung: verboten/);
  });

  it("Originalblock gar nicht übersetzbar: ein Hinweis statt einer Kopie", () => {
    const message = ["Typ: Gefahrengebiet", "", "Originaltext der Behörde:", "Pilots should consider the weather before departure."].join("\n");
    const r = translateTextDe(message, { markUntranslated: true });
    assert.match(r.text, /Behördentext \(nicht übersetzt\) – siehe Originaltext unten\./);
    assert.equal(r.text.split("Pilots should consider").length, 2);
  });

  it("hasGermanFor berücksichtigt Muster und Feldnamen", () => {
    assert.equal(hasGermanFor("D) DAILY 0800-1400"), true);
    assert.equal(hasGermanFor("Subject: Aerodrome Ajdovscina"), true);
    assert.equal(hasGermanFor("Grid ATZ 924013", "name"), true);
    assert.equal(hasGermanFor("Pilots should consider the weather before departure."), false);
  });
});
