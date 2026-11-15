import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectCountryFromCoordinates } from "../countryMaps";
import { parseEd269ToGeozoneInfo } from "../ed269";
import { zoneActivityAt } from "../../../shared/ed269Restriction";

describe("detectCountryFromCoordinates – Österreich (AT_POLYGON)", () => {
  const austrianCities: { name: string; lat: number; lon: number }[] = [
    { name: "Wien", lat: 48.2082, lon: 16.3738 },
    { name: "Innsbruck (Tirol)", lat: 47.2692, lon: 11.4041 },
    { name: "Salzburg", lat: 47.8095, lon: 13.055 },
    { name: "Bregenz (Vorarlberg)", lat: 47.5031, lon: 9.7471 },
    { name: "Feldkirch (Vorarlberg)", lat: 47.2382, lon: 9.5985 },
    { name: "Graz", lat: 47.0707, lon: 15.4395 },
    { name: "Linz", lat: 48.3069, lon: 14.2858 },
    { name: "Klagenfurt", lat: 46.6247, lon: 14.305 },
    { name: "Lienz (Osttirol)", lat: 46.8295, lon: 12.77 },
    // AT-Leiblachtal-Dörfer nördlich von Bregenz: fielen früher als dokumentierter
    // Tradeoff der abgesenkten AT-Polygon-Westkante auf DE. Mit der amtlichen
    // Grenzgeometrie werden sie korrekt als AT erkannt.
    { name: "Hörbranz (Vorarlberg)", lat: 47.5556, lon: 9.7503 },
    { name: "Hohenweiler (Vorarlberg)", lat: 47.5667, lon: 9.7667 },
    { name: "Möggers (Vorarlberg)", lat: 47.5667, lon: 9.7833 },
    // Kleinwalsertal (nur über DE erreichbar, aber österreichisch).
    { name: "Riezlern (Kleinwalsertal)", lat: 47.383, lon: 10.183 },
    { name: "Hirschegg (Kleinwalsertal)", lat: 47.35, lon: 10.165 },
    { name: "Mittelberg (Kleinwalsertal)", lat: 47.328, lon: 10.15 },
    // Jungholz: österreichische Exklave, vollständig von Deutschland umschlossen,
    // nur über den Sorgschrofen-Bergpunkt mit Österreich verbunden. Wird über das
    // separate JUNGHOLZ_POLYGON (vor dem Haupt-AT-Ring) erkannt.
    { name: "Jungholz (Tirol, Exklave)", lat: 47.575, lon: 10.45 },
    { name: "Jungholz Ortskern", lat: 47.5713, lon: 10.4477 },
  ];

  for (const c of austrianCities) {
    it(`erkennt ${c.name} als AT`, () => {
      assert.equal(detectCountryFromCoordinates(c.lat, c.lon), "AT");
    });
  }
});

describe("detectCountryFromCoordinates – Nachbarstädte (kein AT)", () => {
  const neighbours: { name: string; lat: number; lon: number; expected: string }[] = [
    { name: "München", lat: 48.1351, lon: 11.582, expected: "DE" },
    { name: "Passau", lat: 48.5667, lon: 13.4319, expected: "DE" },
    { name: "Zürich", lat: 47.3769, lon: 8.5417, expected: "CH" },
    { name: "Bratislava", lat: 48.1486, lon: 17.1077, expected: "SK" },
    { name: "Vaduz", lat: 47.141, lon: 9.5209, expected: "LI" },
    { name: "Bozen / Bolzano (Südtirol)", lat: 46.4983, lon: 11.3548, expected: "IT" },
    { name: "Ljubljana", lat: 46.0569, lon: 14.5058, expected: "SI" },
    // Deutsche Bodensee-/Allgäu-Orte nahe Bregenz: dürfen NICHT als AT (LOVV)
    // gelten, obwohl sie dicht an Vorarlberg liegen. Lindau wurde früher vom
    // groben AT_POLYGON verschluckt; die amtliche Grenzgeometrie schließt es korrekt aus.
    { name: "Lindau (Bayern)", lat: 47.546, lon: 9.684, expected: "DE" },
    { name: "Wasserburg am Bodensee (Bayern)", lat: 47.557, lon: 9.638, expected: "DE" },
    { name: "Sigmarszell (Bayern)", lat: 47.567, lon: 9.745, expected: "DE" },
    { name: "Scheidegg (Allgäu)", lat: 47.578, lon: 9.852, expected: "DE" },
    { name: "Lindenberg im Allgäu", lat: 47.603, lon: 9.896, expected: "DE" },
    // Oberallgäu-Orte um Oberstdorf: liegen knapp nördlich der amtlichen
    // AT-Grenze und wurden früher vom groben AT_POLYGON als AT (LOVV) verschluckt.
    { name: "Oberstdorf (Bayern)", lat: 47.41, lon: 10.28, expected: "DE" },
    { name: "Fischen im Allgäu", lat: 47.45, lon: 10.28, expected: "DE" },
    { name: "Sonthofen", lat: 47.515, lon: 10.282, expected: "DE" },
    { name: "Bad Hindelang", lat: 47.51, lon: 10.37, expected: "DE" },
    // Balderschwang liegt deutsch am Talschluss über dem Kleinwalsertal und wurde
    // früher vom groben AT_POLYGON mitgeschluckt. Die amtliche Grenzgeometrie trennt
    // es jetzt sauber vom benachbarten Kleinwalsertal (Riezlern).
    { name: "Balderschwang (Bayern)", lat: 47.457, lon: 10.119, expected: "DE" },
    // Deutsche Nachbarorte rund um die Jungholz-Exklave: liegen unmittelbar
    // außerhalb des JUNGHOLZ_POLYGON und müssen DE bleiben.
    { name: "Wertach (Bayern, N von Jungholz)", lat: 47.595, lon: 10.41, expected: "DE" },
    { name: "Pfronten (Bayern, O von Jungholz)", lat: 47.578, lon: 10.55, expected: "DE" },
  ];

  for (const c of neighbours) {
    it(`erkennt ${c.name} NICHT als AT (sondern ${c.expected})`, () => {
      const iso = detectCountryFromCoordinates(c.lat, c.lon);
      assert.notEqual(iso, "AT");
      assert.equal(iso, c.expected);
    });
  }
});

describe("detectCountryFromCoordinates – CH/DE/LI-Grenze (CH_POLYGON)", () => {
  // Schweizer Rheintal-/Bodensee-Orte: müssen mit der amtlichen CH-Grenzgeometrie
  // korrekt als CH erkannt werden (zuvor griff die grobe DE-Heuristik lat >= 47.55).
  const swiss: { name: string; lat: number; lon: number }[] = [
    { name: "Zürich", lat: 47.3769, lon: 8.5417 },
    { name: "Genf", lat: 46.2044, lon: 6.1432 },
    { name: "Basel", lat: 47.5596, lon: 7.5886 },
    { name: "Schaffhausen", lat: 47.697, lon: 8.6349 },
    { name: "Kreuzlingen", lat: 47.6505, lon: 9.1757 },
    { name: "St. Gallen", lat: 47.4245, lon: 9.3767 },
    { name: "Rorschach", lat: 47.4783, lon: 9.4936 },
    { name: "Buchs SG", lat: 47.1667, lon: 9.4667 },
    { name: "Bern", lat: 46.948, lon: 7.4474 },
    { name: "Lugano", lat: 46.0037, lon: 8.9511 },
  ];
  for (const c of swiss) {
    it(`erkennt ${c.name} als CH`, () => {
      assert.equal(detectCountryFromCoordinates(c.lat, c.lon), "CH");
    });
  }

  // Deutsche Bodensee-/Allgäu-/Hochrhein-Orte: dürfen NICHT als CH gelten, obwohl
  // sie innerhalb der früheren groben CH-Box (bis lat 47.81, lon 10.49) lagen. Die
  // amtliche Grenzgeometrie schließt sie korrekt aus (vormals zwei DE-Klauseln nötig).
  const german: { name: string; lat: number; lon: number }[] = [
    { name: "Lindau (Bodensee)", lat: 47.546, lon: 9.684 },
    { name: "Konstanz", lat: 47.6603, lon: 9.1758 },
    { name: "Friedrichshafen", lat: 47.6516, lon: 9.4797 },
    { name: "Singen (Hohentwiel)", lat: 47.7592, lon: 8.8403 },
    { name: "Lörrach", lat: 47.6167, lon: 7.6614 },
    { name: "Waldshut-Tiengen", lat: 47.6231, lon: 8.2147 },
    { name: "Büsingen (Enklave)", lat: 47.6967, lon: 8.6886 },
    { name: "Balderschwang (Allgäu)", lat: 47.457, lon: 10.119 },
  ];
  for (const c of german) {
    it(`erkennt ${c.name} als DE (nicht CH)`, () => {
      assert.equal(detectCountryFromCoordinates(c.lat, c.lon), "DE");
    });
  }

  it("erkennt Vaduz als LI (nicht CH)", () => {
    assert.equal(detectCountryFromCoordinates(47.141, 9.5209), "LI");
  });

  it("erkennt Como (IT) nicht als CH", () => {
    assert.notEqual(detectCountryFromCoordinates(45.8081, 9.0852), "CH");
  });
});

describe("detectCountryFromCoordinates – Tessiner Südzipfel (Mendrisiotto/Chiasso)", () => {
  // Schweizer Grenzorte am südlichen Tessiner Zipfel: müssen mit der feiner
  // aufgelösten CH-Grenzgeometrie (~100 m) als CH erkannt werden. Zuvor verschluckte
  // die grobe (~2 km) Alpen-Vereinfachung die jagged CH/IT-Grenze und Chiasso fiel
  // aus dem Polygon.
  const swiss: { name: string; lat: number; lon: number }[] = [
    { name: "Chiasso", lat: 45.8317, lon: 9.0317 },
    { name: "Mendrisio", lat: 45.87, lon: 8.98 },
    { name: "Balerna", lat: 45.845, lon: 9.005 },
    { name: "Stabio", lat: 45.847, lon: 8.937 },
  ];
  for (const c of swiss) {
    it(`erkennt ${c.name} als CH`, () => {
      assert.equal(detectCountryFromCoordinates(c.lat, c.lon), "CH");
    });
  }

  // Italienische Nachbarorte (Provinz Como) dürfen NICHT als CH gelten, obwohl sie
  // dicht an der jagged Grenze liegen.
  const italian: { name: string; lat: number; lon: number }[] = [
    { name: "Como", lat: 45.8081, lon: 9.0852 },
    { name: "Cernobbio", lat: 45.84, lon: 9.075 },
    { name: "Maslianico", lat: 45.836, lon: 9.046 },
  ];
  for (const c of italian) {
    it(`erkennt ${c.name} nicht als CH`, () => {
      assert.notEqual(detectCountryFromCoordinates(c.lat, c.lon), "CH");
    });
  }
});

describe("detectCountryFromCoordinates – Enklave Campione d'Italia (CH_CAMPIONE_HOLE)", () => {
  // Campione d'Italia ist eine italienische Enklave, vollständig von Schweizer
  // Tessin (am Luganersee) umschlossen. Mit dem fein abgeleiteten Loch im
  // CH_POLYGON müssen Punkte innerhalb der Enklave als IT (nicht CH) gelten.
  const italian: { name: string; lat: number; lon: number }[] = [
    { name: "Campione d'Italia (Ortskern)", lat: 45.9696, lon: 8.9706 },
    { name: "Campione (Casino)", lat: 45.9686, lon: 8.9712 },
    { name: "Campione (Nord)", lat: 45.978, lon: 8.967 },
    { name: "Campione (Süd)", lat: 45.964, lon: 8.972 },
  ];
  for (const c of italian) {
    it(`erkennt ${c.name} als IT (nicht CH)`, () => {
      const iso = detectCountryFromCoordinates(c.lat, c.lon);
      assert.notEqual(iso, "CH");
      assert.equal(iso, "IT");
    });
  }

  // Die umliegenden Schweizer Orte am Luganersee dürfen NICHT vom Loch erfasst
  // werden und müssen weiterhin als CH gelten.
  const swiss: { name: string; lat: number; lon: number }[] = [
    { name: "Lugano", lat: 46.0037, lon: 8.9511 },
    { name: "Bissone", lat: 45.9543, lon: 8.9706 },
    { name: "Melide", lat: 45.9544, lon: 8.9476 },
  ];
  for (const c of swiss) {
    it(`erkennt ${c.name} als CH (nicht im Campione-Loch)`, () => {
      assert.equal(detectCountryFromCoordinates(c.lat, c.lon), "CH");
    });
  }
});

describe("detectCountryFromCoordinates – Enklave Büsingen am Hochrhein (CH_BUESINGEN_HOLE)", () => {
  // Büsingen am Hochrhein ist eine deutsche Enklave, vollständig von Schweizer
  // Gebiet (bei Schaffhausen) umschlossen. Mit dem fein abgeleiteten Loch im
  // CH_POLYGON müssen Punkte innerhalb der Enklave als DE (nicht CH) gelten.
  const german: { name: string; lat: number; lon: number }[] = [
    { name: "Büsingen (Ortskern)", lat: 47.6967, lon: 8.6886 },
    { name: "Büsingen (Nord)", lat: 47.705, lon: 8.688 },
    { name: "Büsingen (Ost)", lat: 47.6955, lon: 8.703 },
    { name: "Büsingen (Süd)", lat: 47.689, lon: 8.679 },
  ];
  for (const c of german) {
    it(`erkennt ${c.name} als DE (nicht CH)`, () => {
      const iso = detectCountryFromCoordinates(c.lat, c.lon);
      assert.notEqual(iso, "CH");
      assert.equal(iso, "DE");
    });
  }

  // Die umliegenden Schweizer Orte dürfen NICHT vom Loch erfasst werden und
  // müssen weiterhin als CH gelten.
  const swiss: { name: string; lat: number; lon: number }[] = [
    { name: "Schaffhausen", lat: 47.697, lon: 8.6349 },
    { name: "Thayngen (Kt. SH, N der Enklave)", lat: 47.748, lon: 8.705 },
    { name: "Ramsen (Kt. SH, O der Enklave)", lat: 47.7133, lon: 8.8156 },
  ];
  for (const c of swiss) {
    it(`erkennt ${c.name} als CH (nicht im Büsingen-Loch)`, () => {
      assert.equal(detectCountryFromCoordinates(c.lat, c.lon), "CH");
    });
  }
});

describe("parseEd269ToGeozoneInfo – Restriction -> Farbe/Label", () => {
  const ring = [
    [16.0, 48.0],
    [16.1, 48.0],
    [16.1, 48.1],
    [16.0, 48.0],
  ];
  const makeFeature = (props: Record<string, any>) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: props,
  });

  it("PROHIBITED -> rot + 'Flugverbot'", () => {
    const [z] = parseEd269ToGeozoneInfo([makeFeature({ restriction: "PROHIBITED" })], "at");
    assert.equal(z.restriction, "PROHIBITED");
    assert.equal(z.fillColor, "rgba(255,59,48,0.20)");
    assert.equal(z.strokeColor, "rgba(255,59,48,0.95)");
    assert.match(z.details, /Beschränkung: Flugverbot/);
  });

  it("REQ_AUTHORISATION -> orange + 'Genehmigung erforderlich'", () => {
    const [z] = parseEd269ToGeozoneInfo([makeFeature({ restriction: "REQ_AUTHORISATION" })], "AT");
    assert.equal(z.fillColor, "rgba(255,149,0,0.18)");
    assert.equal(z.strokeColor, "rgba(255,149,0,0.95)");
    assert.match(z.details, /Genehmigung erforderlich/);
  });

  it("CONDITIONAL -> gelb + 'Bedingt zulässig'", () => {
    const [z] = parseEd269ToGeozoneInfo([makeFeature({ restriction: "CONDITIONAL" })], "AT");
    assert.equal(z.fillColor, "rgba(255,204,0,0.18)");
    assert.match(z.details, /Bedingt zulässig/);
  });

  it("NO_RESTRICTION -> grün + 'Keine Beschränkung'", () => {
    const [z] = parseEd269ToGeozoneInfo([makeFeature({ restriction: "NO_RESTRICTION" })], "AT");
    assert.equal(z.fillColor, "rgba(52,199,89,0.15)");
    assert.match(z.details, /Keine Beschränkung/);
  });

  it("unbekannte Restriction -> UNKNOWN (grau) + Rohwert nur zur Anzeige", () => {
    const [z] = parseEd269ToGeozoneInfo([makeFeature({ restriction: "WHATEVER" })], "AT");
    assert.equal(z.restriction, "UNKNOWN");
    assert.equal(z.restrictionRaw, "WHATEVER");
    assert.equal(z.fillColor, "rgba(142,142,147,0.18)");
    assert.match(z.details, /Beschränkung: Einstufung unbekannt \(WHATEVER\)/);
  });

  it("zeigt österreichische Rechtsgrundlage, Behörde, Bedingungen und offizielle Links", () => {
    const [z] = parseEd269ToGeozoneInfo([makeFeature({
      restriction: "CONDITIONAL",
      extendedProperties: {
        legalBasis: "Luftverkehrsregeln 2014, § 18b Abs. 4",
        legalBasisURL: "https://ris.bka.gv.at/rule",
        localizedMessages: [{
          language: "de-AT",
          message: "Zustimmungspflichtig",
        }],
        authorityRequirementConditions: [{
          condition: "EXCLUDED/LOS=VLOS/ALTITUDE_AGL_MAX=30/MTOM_G_MAX=249",
        }],
      },
      regulationExemption: "YES",
      zoneAuthority: [{
        name: "Austro Control",
        email: "dronespace@austrocontrol.at",
        purpose: "AUTHORIZATION",
        siteURL: "https://www.dronespace.at",
      }],
    })], "AT");

    assert.match(z.details, /Luftverkehrsregeln 2014, § 18b Abs\. 4/);
    assert.match(z.details, /Zustimmungspflichtig/);
    assert.match(z.details, /Zuständige Stelle: Austro Control/);
    // P3: Bedingungscode nur als Infotext, nie als Freigabe (Beschränkung bleibt)
    assert.match(
      z.details,
      /Bedingungscode der Behörde \(nur Information, keine Freigabe – Bedeutung nicht bestätigt\): EXCLUDED\/LOS=VLOS\/ALTITUDE_AGL_MAX=30\/MTOM_G_MAX=249 \(Sichtverbindung \(VLOS\) · max\. 30 m über Grund · Startmasse max\. 249 g\)/,
    );
    assert.equal(z.restriction, "CONDITIONAL");
    assert.doesNotMatch(z.details, /Ausnahmen|regulationExemption/);
    assert.deepEqual(z.links, [
      { label: "Rechtsgrundlage öffnen", url: "https://ris.bka.gv.at/rule" },
      { label: "Webseite: Austro Control", url: "https://www.dronespace.at/" },
      { label: "E-Mail: dronespace@austrocontrol.at", url: "dronespace@austrocontrol.at" },
    ]);
  });
  it("Bedingungscode mit Behörde (echter Wert aus dem AT-Feed 2026-11-15) ändert die Einstufung nie", () => {
    const [z] = parseEd269ToGeozoneInfo([makeFeature({
      restriction: "REQ_AUTHORISATION",
      extendedProperties: {
        authorityRequirementConditions: [{
          authority: "Austro Control GmbH - Drone Competence Center - Auto",
          condition: "INCLUDED/LOS=VLOS/ALTITUDE_AGL_MAX=121/MTOM_G_MAX=25000",
        }],
      },
    })], "AT");
    assert.equal(z.restriction, "REQ_AUTHORISATION");
    assert.match(z.details, /Austro Control GmbH - Drone Competence Center - Auto: INCLUDED\/LOS=VLOS\/ALTITUDE_AGL_MAX=121\/MTOM_G_MAX=25000 \(Sichtverbindung \(VLOS\) · max\. 121 m über Grund · Startmasse max\. 25 kg\)/);
    assert.match(z.details, /keine Freigabe/);
  });

  it("wertet regulationExemption YES nicht als Freigabe oder Ausnahme", () => {
    const [z] = parseEd269ToGeozoneInfo([
      makeFeature({ restriction: "REQ_AUTHORISATION", regulationExemption: "YES" }),
    ], "AT");
    assert.equal(z.restriction, "REQ_AUTHORISATION");
    assert.match(z.details, /Genehmigung erforderlich/);
    assert.doesNotMatch(z.details, /Ausnahme|regulationExemption/);
  });

  it("übernimmt die Kennzeichnung einer belgischen Droneguide-NOTAM-Zone", () => {
    const [z] = parseEd269ToGeozoneInfo([
      makeFeature({ restriction: "PROHIBITED", _notamEligible: true }),
    ], "BE");
    assert.equal(z.notamEligible, true);
  });

  it("zeigt MATZ/MCTR mit dem Austro-Control-Enddatum 2100 nicht als temporäre NOTAMs", () => {
    const [z] = parseEd269ToGeozoneInfo([
      makeFeature({
        name: "MATZ LOXA",
        applicability: [{
          permanent: "NO",
          startDateTime: "2022-01-01T00:00:00.000Z",
          endDateTime: "2100-12-31T23:59:59.000Z",
          schedule: [],
        }],
      }),
    ], "AT");
    assert.equal(z.validStartTs, null);
    assert.equal(z.validEndTs, null);
    assert.equal(z.notamEligible, false);
  });

  it("behält echte befristete österreichische Zonen in der NOTAM-Liste", () => {
    const [z] = parseEd269ToGeozoneInfo([
      makeFeature({
        name: "MCTR LOXX",
        applicability: [{
          permanent: "NO",
          startDateTime: "2026-01-01T00:00:00.000Z",
          endDateTime: "2027-01-01T00:00:00.000Z",
          schedule: [],
        }],
      }),
    ], "AT");
    assert.equal(z.validEndTs, new Date("2027-01-01T00:00:00.000Z").getTime());
    assert.equal(z.notamEligible, true);
  });
});

describe("parseEd269ToGeozoneInfo – Höhenlabel", () => {
  const ring = [
    [16.0, 48.0],
    [16.1, 48.0],
    [16.1, 48.1],
    [16.0, 48.0],
  ];
  const makeFeature = (props: Record<string, any>) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: props,
  });

  it("SFC/UNL -> 'GND – unbegrenzt' (B3: Höhen mit Bezug)", () => {
    const [z] = parseEd269ToGeozoneInfo(
      [makeFeature({ restriction: "PROHIBITED", lower: "SFC", upper: "UNL" })],
      "AT",
    );
    assert.equal(z.altitudeLabel, "GND – unbegrenzt");
  });

  it("Meterwerte ohne Bezug -> Bezug unbekannt sichtbar (B3)", () => {
    const [z] = parseEd269ToGeozoneInfo(
      [makeFeature({ restriction: "PROHIBITED", lowerMeters: 50, upperMeters: 120 })],
      "AT",
    );
    assert.equal(z.altitudeLabel, "50 m (Bezug unbekannt) – 120 m (Bezug unbekannt)");
    assert.equal(z.lowerReference, "UNKNOWN");
    assert.equal(z.lowerMeters, 50);
    assert.equal(z.upperMeters, 120);
  });

  it("fehlende Höhen -> 'GND – unbegrenzt'", () => {
    const [z] = parseEd269ToGeozoneInfo([makeFeature({ restriction: "PROHIBITED" })], "AT");
    assert.equal(z.altitudeLabel, "GND – unbegrenzt");
    assert.equal(z.lowerMeters, undefined);
    assert.equal(z.upperMeters, undefined);
  });
});

describe("parseEd269ToGeozoneInfo – Geometrie & Filterung", () => {
  it("dreht [lon, lat] in das interne [lat, lon]-Format", () => {
    const feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [16.0, 48.0],
            [16.5, 48.0],
            [16.5, 48.5],
            [16.0, 48.0],
          ],
        ],
      },
      properties: { restriction: "PROHIBITED" },
    };
    const [z] = parseEd269ToGeozoneInfo([feature], "AT");
    assert.ok(z.polygonRings && z.polygonRings.length === 1);
    assert.deepEqual(z.polygonRings![0][0], [48.0, 16.0]);
    assert.deepEqual(z.polygonRings![0][1], [48.0, 16.5]);
  });

  it("erhält Donut-Geometrie als Gruppe [Außenring, Loch] (Polygon mit Loch)", () => {
    const outer = [
      [16.0, 48.0],
      [17.0, 48.0],
      [17.0, 49.0],
      [16.0, 49.0],
      [16.0, 48.0],
    ];
    const hole = [
      [16.4, 48.4],
      [16.6, 48.4],
      [16.6, 48.6],
      [16.4, 48.6],
      [16.4, 48.4],
    ];
    const feature = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [outer, hole] },
      properties: { restriction: "PROHIBITED", name: "EBAW VLL1A" },
    };
    const [z] = parseEd269ToGeozoneInfo([feature], "BE");
    // polygonRings bleibt flach (Außen + Loch hintereinander).
    assert.equal(z.polygonRings!.length, 2);
    // polygonGroups gruppiert: ein Polygon mit [Außenring, Loch].
    assert.ok(z.polygonGroups && z.polygonGroups.length === 1);
    assert.equal(z.polygonGroups![0].length, 2);
    assert.deepEqual(z.polygonGroups![0][0][0], [48.0, 16.0]);
    assert.deepEqual(z.polygonGroups![0][1][0], [48.4, 16.4]);
  });

  it("erhält MultiPolygon als getrennte Gruppen je Teilpolygon", () => {
    const polyA = [[
      [16.0, 48.0],
      [16.2, 48.0],
      [16.2, 48.2],
      [16.0, 48.0],
    ]];
    const polyB = [[
      [17.0, 49.0],
      [17.2, 49.0],
      [17.2, 49.2],
      [17.0, 49.0],
    ]];
    const feature = {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [polyA, polyB] },
      properties: { restriction: "PROHIBITED", name: "Multi" },
    };
    const [z] = parseEd269ToGeozoneInfo([feature], "BE");
    assert.ok(z.polygonGroups && z.polygonGroups.length === 2);
    assert.equal(z.polygonGroups![0].length, 1);
    assert.equal(z.polygonGroups![1].length, 1);
  });

  it("filtert hidden:true-Features heraus", () => {
    const ring = [
      [16.0, 48.0],
      [16.1, 48.0],
      [16.1, 48.1],
      [16.0, 48.0],
    ];
    const visible = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { restriction: "PROHIBITED", name: "Sichtbar" },
    };
    const hidden = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { restriction: "PROHIBITED", name: "Versteckt", hidden: true },
    };
    const out = parseEd269ToGeozoneInfo([visible, hidden], "AT");
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "Sichtbar");
  });

  it("verwirft nur länger als 1 Tag abgelaufene Zonen; kürzlich abgelaufene bleiben (inaktiv)", () => {
    const ring = [
      [16.0, 48.0],
      [16.1, 48.0],
      [16.1, 48.1],
      [16.0, 48.0],
    ];
    const now = Date.now();
    const twoDaysAgo = now - 2 * 86400000;
    const hourAgo = now - 3600000;
    const future = now + 86400000;
    const expired = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { restriction: "PROHIBITED", name: "Abgelaufen", validStartTs: twoDaysAgo - 86400000, validEndTs: twoDaysAgo },
    };
    const justEnded = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { restriction: "PROHIBITED", name: "Gerade beendet", validStartTs: twoDaysAgo, validEndTs: hourAgo },
    };
    const stillValid = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { restriction: "PROHIBITED", name: "Gültig", validStartTs: hourAgo, validEndTs: future },
    };
    const out = parseEd269ToGeozoneInfo([expired, justEnded, stillValid], "BE");
    assert.deepEqual(out.map((z) => z.name), ["Gerade beendet", "Gültig"]);
    // Ob aktiv, entscheidet zoneActivityAt – nicht das Parsen.
    assert.equal(zoneActivityAt(out[0], new Date(now)), "inactive");
    assert.equal(zoneActivityAt(out[1], new Date(now)), "active");
  });

  it("behält dauerhafte Zonen (kein validEndTs / permanent)", () => {
    const ring = [
      [16.0, 48.0],
      [16.1, 48.0],
      [16.1, 48.1],
      [16.0, 48.0],
    ];
    const permanentNoEnd = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { restriction: "PROHIBITED", name: "Dauerhaft" },
    };
    const permanentFlag = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { restriction: "PROHIBITED", name: "Permanent-Flag", permanent: true, applicability: [{ startDateTime: "2020-01-01T00:00:00Z", endDateTime: "2020-02-01T00:00:00Z" }] },
    };
    const out = parseEd269ToGeozoneInfo([permanentNoEnd, permanentFlag], "AT");
    assert.equal(out.length, 2);
  });

  it("filtert abgelaufene applicability-Zonen (AT endDateTime in der Vergangenheit)", () => {
    const ring = [
      [16.0, 48.0],
      [16.1, 48.0],
      [16.1, 48.1],
      [16.0, 48.0],
    ];
    const expiredApp = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        restriction: "PROHIBITED",
        name: "Abgelaufene Übung",
        applicability: [{ startDateTime: "2020-01-01T00:00:00Z", endDateTime: "2020-02-01T00:00:00Z" }],
      },
    };
    const out = parseEd269ToGeozoneInfo([expiredApp], "AT");
    assert.equal(out.length, 0);
  });

  it("zeigt wiederkehrende Aktivzeiten getrennt vom äußeren Gültigkeitszeitraum", () => {
    const ring = [
      [16.0, 48.0],
      [16.1, 48.0],
      [16.1, 48.1],
      [16.0, 48.0],
    ];
    const out = parseEd269ToGeozoneInfo(
      [
        {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          restriction: "PROHIBITED",
          name: "Geplante Sperre",
          applicability: [{
            permanent: "NO",
            startDateTime: "2026-01-01T00:00:00Z",
            endDateTime: "2027-01-01T00:00:00Z",
            schedule: [{
              daysOfWeek: ["MONDAY", "WEDNESDAY", "FRIDAY"],
              startTime: "08:30:00",
              endTime: "10:45:00",
            }],
          }],
        },
        },
      ],
      "AT",
    );

    assert.equal(out.length, 1);
    assert.equal(out[0].validStartTs, Date.parse("2026-01-01T00:00:00Z"));
    assert.equal(out[0].validEndTs, Date.parse("2027-01-01T00:00:00Z"));
    assert.deepEqual(out[0].scheduleText, ["Mo, Mi, Fr · 08:30–10:45 UTC"]);
    assert.equal(out[0].notamEligible, true);
  });

  it("setzt country (großgeschrieben) und Standard-LayerLabel", () => {
    const ring = [
      [16.0, 48.0],
      [16.1, 48.0],
      [16.1, 48.1],
      [16.0, 48.0],
    ];
    const [z] = parseEd269ToGeozoneInfo(
      [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [ring] },
          properties: { restriction: "PROHIBITED" },
        },
      ],
      "at",
    );
    assert.equal(z.country, "AT");
    assert.equal(z.layerLabel, "Austro Control (ED-269)");
  });
});
