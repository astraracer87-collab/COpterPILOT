import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assessGeozoneAltitudeConflict,
  classifyGeozoneAltitude,
  isZoneReachable,
} from "../../../shared/geozoneAltitudeFilter";
import { ed269MaxFlightHeightAglM, parseEd269ToGeozoneInfo } from "../ed269";

// Review-Fix 3: ED-269-Volumen [lower, upper] beschreibt, WO die Beschränkung
// gilt. Eine Zone GND–150 m ist kein "Höhenlimit bis 150 m" — sie darf nie über
// ihre Obergrenze als unkritisch ("cleared") gelten.

const gnd150 = (restriction: string, extra: Record<string, unknown> = {}) => ({
  name: "Testzone",
  layerLabel: "ED-269",
  details: "Beschränkung: Test",
  altitudeLabel: "GND – 150 m AGL",
  restriction,
  lowerMeters: 0,
  upperMeters: 150,
  lowerReference: "AGL",
  ...extra,
});

describe("assessGeozoneAltitudeConflict: keine Freigabe über die Volumen-Obergrenze", () => {
  for (const r of ["CONDITIONAL", "RESTRICTED", "NATURE", ""]) {
    it(`GND–150 m ${r || "(leer)"} wird bei 40/100/150 m nie freigegeben`, () => {
      for (const planned of [40, 100, 150]) {
        const a = assessGeozoneAltitudeConflict(gnd150(r), planned);
        assert.equal(a.clearedByAltitude, false, `geplant ${planned} m`);
        assert.equal(a.needsClimbQuestion, false);
        assert.equal(a.kind, "unknown");
      }
    });
  }

  it("Wortlaut 'Höhenbeschränkung' ohne Zahl + upperMeters gibt ebenfalls nicht frei", () => {
    const a = assessGeozoneAltitudeConflict(gnd150("CONDITIONAL", { layerLabel: "Höhenbeschränkung" }), 50);
    assert.equal(a.clearedByAltitude, false);
  });

  it("PROHIBITED bleibt Flugverbot", () => {
    assert.equal(classifyGeozoneAltitude(gnd150("PROHIBITED")).kind, "noFly");
  });
});

describe("explizite Flughöhen-Freigaben", () => {
  it("Text 'Maximale Flughöhe 100 m' (2a) gibt bei 80 m frei, bei 120 m Steig-Frage", () => {
    const zone = { name: "Zone FR", details: "Maximale Flughöhe 100 m", restriction: "CONDITIONAL" };
    assert.equal(assessGeozoneAltitudeConflict(zone, 80).clearedByAltitude, true);
    const high = assessGeozoneAltitudeConflict(zone, 120);
    assert.equal(high.clearedByAltitude, false);
    assert.equal(high.needsClimbQuestion, true);
  });

  it("CTR mit maxFlightHeightAglM 50: 40 m freigegeben, 60 m nicht", () => {
    const ctr = {
      name: "ARLANDA CTR",
      layerLabel: "Kontrollzone",
      details: "CTR",
      restriction: "CONDITIONAL",
      lowerMeters: 0,
      upperMeters: 1500,
      lowerReference: "MSL",
      maxFlightHeightAglM: 50,
    };
    const low = assessGeozoneAltitudeConflict(ctr, 40);
    assert.equal(low.clearedByAltitude, true);
    assert.equal(low.ceilingM, 50);
    const high = assessGeozoneAltitudeConflict(ctr, 60);
    assert.equal(high.clearedByAltitude, false);
    assert.equal(high.needsClimbQuestion, true);
  });

  it("maxFlightHeightAglM sticht keine strukturierte Genehmigungspflicht (HR CTR)", () => {
    const ctr = { name: "CTR Zagreb", restriction: "REQ_AUTHORISATION", maxFlightHeightAglM: 50 };
    assert.equal(assessGeozoneAltitudeConflict(ctr, 40).clearedByAltitude, false);
  });
});

describe("ed269MaxFlightHeightAglM (Mapping in parseEd269ToGeozoneInfo)", () => {
  it("liest openCategoryMaxAglMeters (SE/HR-Normalisierer) und maxFlightHeightAglM", () => {
    assert.equal(ed269MaxFlightHeightAglM({ openCategoryMaxAglMeters: 50 }), 50);
    assert.equal(ed269MaxFlightHeightAglM({ maxFlightHeightAglM: "10" }), 10);
    assert.equal(ed269MaxFlightHeightAglM({ upper: 150 }), undefined);
    assert.equal(ed269MaxFlightHeightAglM({ openCategoryMaxAglMeters: 0 }), undefined);
  });

  it("parseEd269ToGeozoneInfo übernimmt das Feld in GeozoneFeatureInfo", () => {
    const feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[18.0, 59.6], [18.1, 59.6], [18.1, 59.7], [18.0, 59.7], [18.0, 59.6]]],
      },
      properties: { name: "ARLANDA CTR", restriction: "CONDITIONAL", openCategoryMaxAglMeters: 50 },
    };
    const [info] = parseEd269ToGeozoneInfo([feature], "SE");
    assert.equal(info.maxFlightHeightAglM, 50);
    assert.equal(assessGeozoneAltitudeConflict(info, 40).clearedByAltitude, true);
    assert.equal(assessGeozoneAltitudeConflict(info, 60).clearedByAltitude, false);
  });
});

describe("isZoneReachable (Volumen-Untergrenze) unverändert", () => {
  it("Untergrenze über geplanter Höhe -> nicht erreichbar", () => {
    assert.equal(isZoneReachable({ lowerMeters: 300, lowerReference: "AGL" }, { reachableAltitudeM: 120 }), false);
    assert.equal(isZoneReachable({ lowerMeters: 0 }, { reachableAltitudeM: 120 }), true);
  });
});
