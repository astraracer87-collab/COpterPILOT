import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isFlightWindowDuringNight } from "../solar";
import { getNightFlightRule } from "../countryInfo";

// Berlin als Referenzstandort. Die Tests laufen im tsx-Runner mit TZ=UTC, daher
// entsprechen die intern aus startMin/endMin gebauten Lokalzeiten direkt UTC.
// Am 21.12. (Wintersonnenwende) liegt die bürgerliche Nacht (Sonne < -6°) in
// Berlin etwa vor 06:35 UTC und nach 15:33 UTC; Sonnenhöchststand ~13.7° gegen
// 11:08 UTC. Die gewählten Fenster haben genug Abstand zu diesen Grenzen, um
// auch bei kleinen Modell-/Zeitzonenabweichungen stabil zu bleiben.
const BERLIN = { lat: 52.52, lng: 13.405 };
const WINTER = new Date(2025, 11, 21); // 21. Dezember 2025

function min(h: number, m = 0): number {
  return h * 60 + m;
}

describe("isFlightWindowDuringNight", () => {
  it("volles Nachtfenster (23:00–23:30) → anyNight & allNight true", () => {
    const r = isFlightWindowDuringNight(
      BERLIN.lat,
      BERLIN.lng,
      WINTER,
      min(23, 0),
      min(23, 30),
    );
    assert.equal(r.anyNight, true);
    assert.equal(r.allNight, true);
  });

  it("volles Tagfenster (10:00–12:00) → anyNight & allNight false", () => {
    const r = isFlightWindowDuringNight(
      BERLIN.lat,
      BERLIN.lng,
      WINTER,
      min(10, 0),
      min(12, 0),
    );
    assert.equal(r.anyNight, false);
    assert.equal(r.allNight, false);
  });

  it("Dämmerungs-Übergang (15:00–18:00) → teilweise Nacht (anyNight true, allNight false)", () => {
    const r = isFlightWindowDuringNight(
      BERLIN.lat,
      BERLIN.lng,
      WINTER,
      min(15, 0),
      min(18, 0),
    );
    assert.equal(r.anyNight, true);
    assert.equal(r.allNight, false);
  });

  it("Über-Mitternacht-Fenster (22:00–06:00, endMin<=startMin) wird auf den Folgetag verlängert → Winter-Tiefnacht", () => {
    const r = isFlightWindowDuringNight(
      BERLIN.lat,
      BERLIN.lng,
      WINTER,
      min(22, 0),
      min(6, 0),
    );
    assert.equal(r.anyNight, true);
    assert.equal(r.allNight, true);
  });

  it("Über-Mitternacht-Fenster bis in den hellen Vormittag (22:00–11:00) → teilweise (Tag-Anteil am Morgen)", () => {
    const r = isFlightWindowDuringNight(
      BERLIN.lat,
      BERLIN.lng,
      WINTER,
      min(22, 0),
      min(11, 0),
    );
    assert.equal(r.anyNight, true);
    assert.equal(r.allNight, false);
  });

  it("Sommer-Mittagsfenster ist niemals Nacht (Gegenprobe Saison)", () => {
    const summer = new Date(2025, 5, 21);
    const r = isFlightWindowDuringNight(
      BERLIN.lat,
      BERLIN.lng,
      summer,
      min(11, 0),
      min(13, 0),
    );
    assert.equal(r.anyNight, false);
    assert.equal(r.allNight, false);
  });
});

describe("getNightFlightRule – Block- vs. Hinweis-Länder", () => {
  // Im Planungs-Flow blockiert ein Land den "Weiter"-Schritt, wenn die Regel
  // "forbidden" oder "permit_required" ist; alle anderen sind nur Hinweise.
  const isBlock = (iso: string) => {
    const s = getNightFlightRule(iso).status;
    return s === "forbidden" || s === "permit_required";
  };

  it("NL blockiert (forbidden)", () => {
    assert.equal(getNightFlightRule("NL").status, "forbidden");
    assert.equal(isBlock("NL"), true);
  });

  it("FR blockiert (permit_required)", () => {
    assert.equal(getNightFlightRule("FR").status, "permit_required");
    assert.equal(isBlock("FR"), true);
  });

  it("DE/AT/CH sind nur Hinweise (allowed_with_lights)", () => {
    for (const iso of ["DE", "AT", "CH"]) {
      assert.equal(getNightFlightRule(iso).status, "allowed_with_lights", `${iso} sollte allowed_with_lights sein`);
      assert.equal(isBlock(iso), false, `${iso} sollte nicht blockieren`);
    }
  });

  it("GB wird auf UK gemappt und ist kein Blocker", () => {
    assert.equal(getNightFlightRule("GB").status, "allowed");
    assert.equal(isBlock("GB"), false);
  });

  it("unbekanntes/leeres ISO → sicherer Default (Hinweis, kein Blocker)", () => {
    assert.equal(getNightFlightRule(null).status, "allowed_with_lights");
    assert.equal(isBlock("ZZ"), false);
  });
});
