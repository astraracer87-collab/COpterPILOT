import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getFirForPosition, getFrenchFir } from "../firDetection";

// Repräsentative Standorte je Land. Die FIR-Boxen überschneiden sich an den
// Ländergrenzen leicht, daher prüfen wir bewusst Grenzfälle (Étaples,
// Strasbourg vs. Freiburg, Saarbrücken, Karlsruhe), die in der Vergangenheit
// das größte Fehlzuordnungs-Risiko trugen.

describe("getFirForPosition – Länder-FIR-Zuordnung", () => {
  it("ordnet deutsche Kernstandorte einer ED*-FIR zu", () => {
    const cases: Array<[string, number, number]> = [
      ["Berlin", 52.52, 13.405],
      ["München", 48.137, 11.575],
      ["Hamburg", 53.551, 9.993],
      ["Frankfurt", 50.11, 8.682],
      ["Leipzig", 51.34, 12.375],
      ["Stuttgart", 48.776, 9.182],
      ["Dortmund", 51.514, 7.466],
    ];
    for (const [name, lat, lon] of cases) {
      const fir = getFirForPosition(lat, lon);
      assert.ok(fir.startsWith("ED"), `${name} sollte ED* sein, war ${fir}`);
    }
  });

  it("ordnet die Schweiz LSAS zu", () => {
    assert.equal(getFirForPosition(47.376, 8.541), "LSAS"); // Zürich
    assert.equal(getFirForPosition(46.948, 7.447), "LSAS"); // Bern
    assert.equal(getFirForPosition(46.204, 6.143), "LSAS"); // Genf
  });

  it("ordnet Luxemburg ELLX zu", () => {
    assert.equal(getFirForPosition(49.611, 6.131), "ELLX"); // Stadt Luxemburg
    assert.equal(getFirForPosition(49.623, 6.204), "ELLX"); // Flughafen Findel
  });

  it("ordnet die Niederlande EHAA zu", () => {
    assert.equal(getFirForPosition(52.37, 4.895), "EHAA"); // Amsterdam
    assert.equal(getFirForPosition(51.924, 4.478), "EHAA"); // Rotterdam
    assert.equal(getFirForPosition(53.219, 6.567), "EHAA"); // Groningen
  });

  it("ordnet Frankreich einer LF*-FIR zu", () => {
    const cases: Array<[string, number, number]> = [
      ["Paris", 48.857, 2.352],
      ["Lyon", 45.764, 4.835],
      ["Marseille", 43.296, 5.37],
      ["Bordeaux", 44.838, -0.579],
      ["Toulouse", 43.605, 1.444],
      ["Nizza", 43.71, 7.262],
    ];
    for (const [name, lat, lon] of cases) {
      const fir = getFirForPosition(lat, lon);
      assert.ok(fir.startsWith("LF"), `${name} sollte LF* sein, war ${fir}`);
    }
  });
});

describe("getFirForPosition – Grenzfälle", () => {
  it("Étaples (Nordfrankreich, Küste) bleibt französisch (LF*)", () => {
    // 50.516, 1.631 – nahe der nördlichen Frankreich-Box; darf nicht
    // versehentlich einer deutschen oder niederländischen FIR zufallen.
    const fir = getFirForPosition(50.516, 1.631);
    assert.ok(fir.startsWith("LF"), `Étaples sollte LF* sein, war ${fir}`);
  });

  it("Strasbourg (FR) ist französisch, Freiburg (DE) ist deutsch", () => {
    const strasbourg = getFirForPosition(48.573, 7.752);
    assert.ok(
      strasbourg.startsWith("LF"),
      `Strasbourg sollte LF* sein, war ${strasbourg}`,
    );
    const freiburg = getFirForPosition(47.999, 7.842);
    assert.ok(
      freiburg.startsWith("ED"),
      `Freiburg sollte ED* sein, war ${freiburg}`,
    );
  });

  it("Saarbrücken (DE) bleibt deutsch trotz Nähe zur FR/LU-Grenze", () => {
    const fir = getFirForPosition(49.24, 6.997);
    assert.ok(fir.startsWith("ED"), `Saarbrücken sollte ED* sein, war ${fir}`);
  });

  it("Karlsruhe (DE) bleibt deutsch trotz Nähe zur FR-Grenze", () => {
    const fir = getFirForPosition(49.007, 8.404);
    assert.ok(fir.startsWith("ED"), `Karlsruhe sollte ED* sein, war ${fir}`);
  });

  it("südliches Baden-Württemberg bleibt deutsch (ED*), nicht CH/LSAS", () => {
    // Die grobe LSAS-Box (lat 45.8–47.9, lon 5.9–10.5) verschluckte den
    // deutschen Bodensee-/Hochrhein-Raum. getFirForPosition geht jetzt über die
    // Länder-Erkennung, die diese Orte korrekt als DE klassifiziert.
    const cases: Array<[string, number, number]> = [
      ["Konstanz", 47.66, 9.18],
      ["Friedrichshafen", 47.654, 9.479],
      ["Lörrach", 47.616, 7.661],
      ["Singen", 47.759, 8.84],
      ["Überlingen", 47.769, 9.16],
      ["Waldshut", 47.623, 8.215],
    ];
    for (const [name, lat, lon] of cases) {
      const fir = getFirForPosition(lat, lon);
      assert.ok(fir.startsWith("ED"), `${name} sollte ED* sein, war ${fir}`);
    }
  });

  it("Schweizer Kernstandorte bleiben trotz Korrektur LSAS", () => {
    // Die Bodensee-Korrektur darf keine echten CH-Standorte verlieren.
    const cases: Array<[string, number, number]> = [
      ["Zürich", 47.376, 8.541],
      ["Bern", 46.948, 7.447],
      ["Genf", 46.204, 6.143],
      ["Lausanne", 46.519, 6.633],
      ["Luzern", 47.05, 8.305],
      ["St. Gallen", 47.424, 9.377],
      ["Lugano", 46.004, 8.951],
    ];
    for (const [name, lat, lon] of cases) {
      assert.equal(getFirForPosition(lat, lon), "LSAS", `${name} sollte LSAS sein`);
    }
  });

  it("Genfer Umland in Frankreich fällt nicht der CH/LSAS zu", () => {
    // Westfranzösische Orte rund um Genf lagen früher in der LSAS-Box und
    // wurden so fälschlich der Schweizer FIR zugeordnet.
    const fir = getFirForPosition(46.5, 5.95); // Franche-Comté (Lons-le-Saunier-Umland)
    assert.ok(fir.startsWith("LF"), `Franche-Comté sollte LF* sein, war ${fir}`);
  });

  it("Haute-Savoie/Pays de Gex direkt um Genf wird FR (LF*), nicht CH/LSAS", () => {
    // Diese Orte liegen südlich/westlich von Genf unterhalb des früheren
    // FR-Ostpolygon-Südrands und fielen daher in die grobe CH-Box. Das
    // erweiterte Polygon (mit Genf-Aussparung) ordnet sie wieder Frankreich zu.
    const cases: Array<[string, number, number]> = [
      ["Annemasse", 46.1939, 6.2381],
      ["Saint-Julien-en-Genevois", 46.1432, 6.0839],
      ["Gex", 46.3333, 6.0578],
    ];
    for (const [name, lat, lon] of cases) {
      const fir = getFirForPosition(lat, lon);
      assert.ok(fir.startsWith("LF"), `${name} sollte LF* sein, war ${fir}`);
    }
  });

  it("Genf, Lausanne und das Schweizer Seeufer bleiben trotz Genf-Aussparung LSAS", () => {
    // Die Aussparung (GENEVA_HOLE) darf den Schweizer Kern um Genf nicht verlieren.
    const cases: Array<[string, number, number]> = [
      ["Genf", 46.2044, 6.1432],
      ["Carouge", 46.181, 6.139],
      ["Versoix", 46.283, 6.166],
      ["Meyrin", 46.234, 6.08],
      ["Nyon", 46.383, 6.239],
      ["Lausanne", 46.519, 6.633],
    ];
    for (const [name, lat, lon] of cases) {
      assert.equal(getFirForPosition(lat, lon), "LSAS", `${name} sollte LSAS sein`);
    }
  });

  it("Lindau & deutsche Bodensee-/Allgäu-Orte nahe Bregenz sind ED*, nicht LOVV", () => {
    // Das AT_POLYGON verschluckte früher das bayerische Lindau (47.546, 9.684)
    // am Ostufer des Bodensees und ordnete es der österreichischen FIR LOVV zu.
    const cases: Array<[string, number, number]> = [
      ["Lindau", 47.546, 9.684],
      ["Wasserburg am Bodensee", 47.557, 9.638],
      ["Sigmarszell", 47.567, 9.745],
      ["Scheidegg", 47.578, 9.852],
      ["Lindenberg im Allgäu", 47.603, 9.896],
    ];
    for (const [name, lat, lon] of cases) {
      const fir = getFirForPosition(lat, lon);
      assert.ok(fir.startsWith("ED"), `${name} sollte ED* sein, war ${fir}`);
    }
  });

  it("Vorarlberg/Bregenz bleibt österreichisch (LOVV)", () => {
    const cases: Array<[string, number, number]> = [
      ["Bregenz", 47.5031, 9.7471],
      ["Dornbirn", 47.412, 9.744],
      ["Feldkirch", 47.2382, 9.5985],
      ["Innsbruck", 47.2692, 11.4041],
    ];
    for (const [name, lat, lon] of cases) {
      assert.equal(getFirForPosition(lat, lon), "LOVV", `${name} sollte LOVV sein`);
    }
  });

  it("Oberstdorf & das Oberallgäu sind ED*, nicht LOVV", () => {
    // Das AT_POLYGON verschluckte früher das bayerische Oberstdorf (47.41/10.28)
    // unter seiner Oberkante und ordnete es der österreichischen FIR LOVV zu.
    const cases: Array<[string, number, number]> = [
      ["Oberstdorf", 47.41, 10.28],
      ["Fischen im Allgäu", 47.45, 10.28],
      ["Sonthofen", 47.515, 10.282],
      ["Bad Hindelang", 47.51, 10.37],
    ];
    for (const [name, lat, lon] of cases) {
      const fir = getFirForPosition(lat, lon);
      assert.ok(fir.startsWith("ED"), `${name} sollte ED* sein, war ${fir}`);
    }
  });

  it("das Kleinwalsertal bleibt österreichisch (LOVV)", () => {
    // Das nur über DE erreichbare, aber österreichische Kleinwalsertal bleibt über
    // die amtliche Grenzgeometrie LOVV. Riezlern auf dem Ortskern (47.383/10.183);
    // die amtliche Grenze verläuft hier sehr fein verzahnt knapp nördlich davon.
    const cases: Array<[string, number, number]> = [
      ["Riezlern", 47.383, 10.183],
      ["Hirschegg", 47.35, 10.165],
      ["Mittelberg", 47.328, 10.15],
    ];
    for (const [name, lat, lon] of cases) {
      assert.equal(getFirForPosition(lat, lon), "LOVV", `${name} sollte LOVV sein`);
    }
  });

  it("Balderschwang am Talschluss ist deutsch (ED*), nicht LOVV", () => {
    // Balderschwang (47.457/10.119) liegt deutsch oberhalb des Kleinwalsertals.
    // Die amtliche Grenzgeometrie trennt es sauber vom benachbarten Kleinwalsertal.
    const fir = getFirForPosition(47.457, 10.119);
    assert.ok(fir.startsWith("ED"), `Balderschwang sollte ED* sein, war ${fir}`);
  });

  it("die AT-Leiblachtal-Dörfer nördlich von Bregenz sind LOVV, nicht ED*", () => {
    // Hörbranz/Hohenweiler/Möggers fielen früher als dokumentierter Tradeoff der
    // abgesenkten AT-Polygon-Westkante auf DE. Mit der amtlichen Grenzgeometrie
    // werden sie korrekt als österreichisch (LOVV) erkannt, obwohl sie sehr nah an
    // den deutschen Allgäu-Orten (Sigmarszell u. a.) liegen.
    const cases: Array<[string, number, number]> = [
      ["Hörbranz", 47.5556, 9.7503],
      ["Hohenweiler", 47.5667, 9.7667],
      ["Möggers", 47.5667, 9.7833],
    ];
    for (const [name, lat, lon] of cases) {
      assert.equal(getFirForPosition(lat, lon), "LOVV", `${name} sollte LOVV sein`);
    }
  });

  it("Trier-Umland bleibt deutsch (ED*), nicht LU/ELLX", () => {
    const trier = getFirForPosition(49.7596, 6.6394);
    assert.ok(trier.startsWith("ED"), `Trier sollte ED* sein, war ${trier}`);
    const saarburg = getFirForPosition(49.606, 6.547);
    assert.ok(saarburg.startsWith("ED"), `Saarburg sollte ED* sein, war ${saarburg}`);
  });

  it("Luxemburger Kernstandorte bleiben ELLX", () => {
    assert.equal(getFirForPosition(49.611, 6.131), "ELLX"); // Stadt Luxemburg
    assert.equal(getFirForPosition(49.623, 6.204), "ELLX"); // Flughafen Findel
    assert.equal(getFirForPosition(49.815, 6.1), "ELLX"); // Diekirch-Umland (Norden)
  });

  it("westliches NRW bleibt deutsch (ED*), nicht NL/EHAA", () => {
    // Die grobe EHAA-Box (lon bis 7.21) reichte früher ins westliche NRW hinein,
    // sodass Köln/Düsseldorf/Aachen fälschlich der niederländischen FIR EHAA
    // zugeordnet wurden. getFirForPosition geht jetzt über die verfeinerte
    // NL-Erkennung, die diese Standorte wieder als DE klassifiziert.
    const cases: Array<[string, number, number]> = [
      ["Köln", 50.938, 6.96],
      ["Düsseldorf", 51.227, 6.773],
      ["Aachen", 50.776, 6.084],
    ];
    for (const [name, lat, lon] of cases) {
      const fir = getFirForPosition(lat, lon);
      assert.ok(fir.startsWith("ED"), `${name} sollte ED* sein, war ${fir}`);
    }
  });
});

describe("getFrenchFir – Bereichsabgrenzung", () => {
  it("liefert null klar außerhalb des französischen Luftraums", () => {
    assert.equal(getFrenchFir(52.52, 13.405), null); // Berlin
    assert.equal(getFrenchFir(53.551, 9.993), null); // Hamburg
    assert.equal(getFrenchFir(41.0, 2.0), null); // südlich von Frankreich
  });

  it("liefert eine LF*-FIR innerhalb Frankreichs", () => {
    const paris = getFrenchFir(48.857, 2.352);
    assert.ok(paris && paris.startsWith("LF"), `Paris war ${paris}`);
    const marseille = getFrenchFir(43.296, 5.37);
    assert.ok(marseille && marseille.startsWith("LF"), `Marseille war ${marseille}`);
  });
});
