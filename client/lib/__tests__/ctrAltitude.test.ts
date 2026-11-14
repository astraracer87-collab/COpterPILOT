import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getCtrClearance,
  getCtrInnerRadiusKm,
  describeHeightSteps,
  describeHeightStep,
  getCtrBandRings,
  describeCtrBand,
  DFS_CTR_HEIGHT_STEPS,
  DFS_CTR_HEIGHT_STEPS_PROVISIONAL,
  LEGACY_50M_HEIGHT_STEPS,
  DFS_CTR_MAX_HEIGHT_AGL_M,
  M_PER_KM,
  type CtrHeightStep,
} from "../ctrAltitude";

describe("getCtrClearance (offizielles DFS-Modell NfL 2026-1-3884)", () => {
  it("liefert Innenbereich (keine pauschale Höhe) im Nahbereich", () => {
    const r = getCtrClearance(0.5);
    assert.equal(r.area, "innen");
    assert.equal(r.maxHeightAglM, 0);
    assert.equal(r.distanceKm, 0.5);
    assert.equal(r.geometryPerAip, true);
  });

  it("liefert Innenbereich exakt unterhalb der Außenbereich-Näherungsgrenze", () => {
    const r = getCtrClearance(1.49);
    assert.equal(r.area, "innen");
    assert.equal(r.maxHeightAglM, 0);
  });

  it("liefert Außenbereich pauschal bis 100 m AGL ab der Grenze (inklusive)", () => {
    const r = getCtrClearance(1.5);
    assert.equal(r.area, "aussen");
    assert.equal(r.maxHeightAglM, 100);
  });

  it("hält im gesamten Außenbereich einheitlich 100 m AGL (keine Distanz-Staffel)", () => {
    assert.equal(getCtrClearance(3).maxHeightAglM, 100);
    assert.equal(getCtrClearance(5).maxHeightAglM, 100);
    assert.equal(getCtrClearance(50).maxHeightAglM, 100);
    assert.equal(getCtrClearance(50).area, "aussen");
  });

  it("überschreitet nie die absolute Obergrenze von 100 m AGL", () => {
    for (const step of DFS_CTR_HEIGHT_STEPS) {
      assert.ok(step.maxHeightAglM <= DFS_CTR_MAX_HEIGHT_AGL_M);
    }
  });

  it("behandelt ungültige/negative Distanzen als 0 (Innenbereich)", () => {
    assert.equal(getCtrClearance(-3).area, "innen");
    assert.equal(getCtrClearance(Number.NaN).area, "innen");
    assert.equal(getCtrClearance(Number.POSITIVE_INFINITY).area, "innen");
  });

  it("hält den deprecated Alias DFS_CTR_HEIGHT_STEPS_PROVISIONAL identisch", () => {
    assert.equal(DFS_CTR_HEIGHT_STEPS_PROVISIONAL, DFS_CTR_HEIGHT_STEPS);
  });
});

describe("getCtrClearance (Legacy-50-m-Modell)", () => {
  it("liefert 50 m im Außenbereich ab 1,5 km", () => {
    assert.equal(getCtrClearance(1.5, LEGACY_50M_HEIGHT_STEPS).maxHeightAglM, 50);
    assert.equal(getCtrClearance(10, LEGACY_50M_HEIGHT_STEPS).maxHeightAglM, 50);
  });

  it("liefert Innenbereich unter 1,5 km", () => {
    assert.equal(getCtrClearance(1.0, LEGACY_50M_HEIGHT_STEPS).area, "innen");
  });
});

describe("getCtrClearance (austauschbare Stützwerte)", () => {
  const customSteps: CtrHeightStep[] = [
    { fromDistanceKm: 0, maxHeightAglM: 0 },
    { fromDistanceKm: 2, maxHeightAglM: 60 },
    { fromDistanceKm: 6, maxHeightAglM: 120 },
  ];

  it("nutzt übergebene Schritte statt der Standardwerte", () => {
    assert.equal(getCtrClearance(1.9, customSteps).maxHeightAglM, 0);
    assert.equal(getCtrClearance(2, customSteps).maxHeightAglM, 60);
    assert.equal(getCtrClearance(7, customSteps).maxHeightAglM, 120);
  });

  it("respektiert das geometryPerAip-Flag", () => {
    assert.equal(getCtrClearance(2, customSteps, false).geometryPerAip, false);
  });

  it("sortiert unsortierte Schritte korrekt", () => {
    const unsorted: CtrHeightStep[] = [
      { fromDistanceKm: 6, maxHeightAglM: 120 },
      { fromDistanceKm: 0, maxHeightAglM: 0 },
      { fromDistanceKm: 2, maxHeightAglM: 60 },
    ];
    assert.equal(getCtrClearance(3, unsorted).maxHeightAglM, 60);
  });
});

describe("getCtrInnerRadiusKm", () => {
  it("liefert die Untergrenze des Außenbereichs (Näherung)", () => {
    assert.equal(getCtrInnerRadiusKm(), 1.5);
  });

  it("liefert 0, wenn alle Bänder Höhe 0 haben", () => {
    assert.equal(getCtrInnerRadiusKm([{ fromDistanceKm: 0, maxHeightAglM: 0 }]), 0);
  });
});

describe("describeHeightSteps", () => {
  it("beschreibt jedes Band mit Distanzbereich und Höhe", () => {
    const lines = describeHeightSteps();
    assert.equal(lines.length, DFS_CTR_HEIGHT_STEPS.length);
    assert.match(lines[0], /Innenbereich/);
    assert.match(lines[lines.length - 1], /100 m AGL/);
    assert.match(lines[lines.length - 1], /^ab /);
  });

  it("formatiert Dezimal-Kilometer mit Komma", () => {
    const step: CtrHeightStep = { fromDistanceKm: 1.5, maxHeightAglM: 100 };
    assert.match(describeHeightStep(step), /^ab 1,5 km/);
  });
});

describe("getCtrBandRings", () => {
  it("liefert einen Ring je Band, größter Ring zuerst", () => {
    const rings = getCtrBandRings();
    assert.equal(rings.length, DFS_CTR_HEIGHT_STEPS_PROVISIONAL.length);
    for (let i = 1; i < rings.length; i++) {
      assert.ok(rings[i - 1].radiusM > rings[i].radiusM, "absteigend sortiert");
    }
  });

  it("innerster Ring ist der Innenbereich mit dem Innenradius", () => {
    const rings = getCtrBandRings();
    const inner = rings[rings.length - 1];
    assert.equal(inner.area, "innen");
    assert.equal(inner.maxHeightAglM, 0);
    assert.equal(inner.radiusM, getCtrInnerRadiusKm() * M_PER_KM);
  });

  it("das letzte unbegrenzte Band erhält einen Außenradius > letzter Grenze", () => {
    const rings = getCtrBandRings();
    const outer = rings[0];
    assert.equal(outer.maxHeightAglM, DFS_CTR_MAX_HEIGHT_AGL_M);
    const lastBoundaryKm =
      DFS_CTR_HEIGHT_STEPS_PROVISIONAL[DFS_CTR_HEIGHT_STEPS_PROVISIONAL.length - 1]
        .fromDistanceKm;
    assert.ok(
      outer.radiusM > lastBoundaryKm * M_PER_KM,
      "Außenband reicht über die letzte Grenze hinaus",
    );
  });

  it("ordnet jedem Band eine eigene Farbe zu", () => {
    const colors = new Set(getCtrBandRings().map((r) => r.fillColor));
    assert.equal(colors.size, DFS_CTR_HEIGHT_STEPS_PROVISIONAL.length);
  });

  it("liefert keine Ringe bei leerer Staffelung", () => {
    assert.equal(getCtrBandRings([]).length, 0);
  });
});

describe("describeCtrBand", () => {
  it("kennzeichnet Innen- und Außenbereich", () => {
    assert.match(describeCtrBand("innen", 0), /Innenbereich/);
    assert.match(describeCtrBand("aussen", 50), /max\. 50 m AGL/);
  });
});

// ===========================================================================
// Neues 4-Zonen-Modell (NfL 2026-1-3960, gültig ab 06.08.2026, 15 DFS-Flughäfen)
// ===========================================================================
import {
  DFS_ZONEN_HEIGHT_STEPS,
  DFS_ZONEN_EFFECTIVE_DATE_ISO,
  describeStepHeight,
  getCtrLegendEntries,
  getCtrProvisionalNote,
  getDfsZonenEffectiveNote,
  isDfsZonenEffective,
} from "../ctrAltitude";

describe("getCtrClearance (4-Zonen-Modell NfL 2026-1-3960)", () => {
  it("Zone 1: keine pauschale Höhe, individuelle FVK-Freigabe", () => {
    const r = getCtrClearance(0.5, DFS_ZONEN_HEIGHT_STEPS);
    assert.equal(r.area, "innen");
    assert.equal(r.maxHeightAglM, 0);
    assert.equal(r.zoneLabel, "Zone 1");
  });
  it("Zone 2 (bis 4 km): max. 25 m, niedrigerer Wert zählt", () => {
    const r = getCtrClearance(3, DFS_ZONEN_HEIGHT_STEPS);
    assert.equal(r.maxHeightAglM, 25);
    assert.equal(r.zoneLabel, "Zone 2");
    assert.match(r.heightText, /niedrigere Wert/);
  });
  it("Zone 3 (4–6 km): max. 45 m, niedrigerer Wert zählt", () => {
    const r = getCtrClearance(5, DFS_ZONEN_HEIGHT_STEPS);
    assert.equal(r.maxHeightAglM, 45);
    assert.equal(r.zoneLabel, "Zone 3");
    assert.match(r.heightText, /niedrigere Wert/);
  });
  it("Zone 4 (ab 6 km): 100 m über Flugplatzhöhe oder 50 m AGL, höherer Wert", () => {
    const r = getCtrClearance(9, DFS_ZONEN_HEIGHT_STEPS);
    assert.equal(r.maxHeightAglM, 100);
    assert.equal(r.zoneLabel, "Zone 4");
    assert.match(r.heightText, /höhere Wert/);
    assert.match(r.heightText, /50 m/);
  });
  it("Stichtag ist der 6. August 2026", () => {
    assert.equal(DFS_ZONEN_EFFECTIVE_DATE_ISO, "2026-08-06");
  });
});

describe("Stichtags-Hinweise (datumsgesteuert)", () => {
  it("vor dem Stichtag: Hinweis sichtbar", () => {
    const before = new Date(2026, 7, 5); // 5.8.2026 (lokal)
    assert.equal(isDfsZonenEffective(before), false);
    assert.match(getDfsZonenEffectiveNote(before) ?? "", /g\u00fcltig ab 6\.8\.2026/);
    assert.match(getCtrProvisionalNote(before), /g\u00fcltig ab 6\.8\.2026/);
  });
  it("am Stichtag: Hinweis entf\u00e4llt", () => {
    const day = new Date(2026, 7, 6); // 6.8.2026 (lokal)
    assert.equal(isDfsZonenEffective(day), true);
    assert.equal(getDfsZonenEffectiveNote(day), null);
    assert.doesNotMatch(getCtrProvisionalNote(day), /g\u00fcltig ab/);
  });
  it("nach dem Stichtag: Hinweis entf\u00e4llt", () => {
    const after = new Date(2027, 0, 1);
    assert.equal(isDfsZonenEffective(after), true);
    assert.equal(getDfsZonenEffectiveNote(after), null);
  });
});

describe("Zonen-Darstellung (Ringe, Legende, Texte)", () => {
  it("beschreibt jedes Band mit Zonen-Label", () => {
    const lines = describeHeightSteps(DFS_ZONEN_HEIGHT_STEPS);
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^Zone 1/);
    assert.match(lines[3], /^Zone 4/);
  });
  it("describeStepHeight nennt für Zone 1 die individuelle Freigabe", () => {
    assert.match(describeStepHeight(DFS_ZONEN_HEIGHT_STEPS[0]), /individuelle FVK-Freigabe/);
  });
  it("Ringe: 4 Bänder mit eigenen Farben, größter zuerst", () => {
    const rings = getCtrBandRings(DFS_ZONEN_HEIGHT_STEPS);
    assert.equal(rings.length, 4);
    assert.equal(new Set(rings.map((r) => r.fillColor)).size, 4);
    assert.ok(rings[0].radiusM > rings[3].radiusM);
    assert.match(rings[3].label, /Zone 1/);
  });
  it("Default-Legende kombiniert alle Modelle (Zonen + DAS-Flachmodell + Legacy) ohne Duplikate", () => {
    const legend = getCtrLegendEntries();
    const labels = legend.map((e) => e.label);
    assert.match(labels[0], /Zone 1/);
    assert.match(labels[3], /Zone 4/);
    // DAS-Flachmodell (100 m) und Legacy (50 m) müssen ebenfalls vertreten sein
    assert.ok(labels.some((l) => /100 m AGL/.test(l)), "DAS-Flachmodell fehlt in der Legende");
    assert.ok(labels.some((l) => /50 m AGL/.test(l)), "Legacy-50m-Modell fehlt in der Legende");
    assert.equal(new Set(labels).size, labels.length, "Legenden-Labels müssen eindeutig sein");
  });
  it("Legende für ein einzelnes Modell zeigt nur dessen Bänder", () => {
    const legend = getCtrLegendEntries([DFS_ZONEN_HEIGHT_STEPS]);
    assert.equal(legend.length, 4);
    assert.match(legend[0].label, /Zone 1/);
    assert.match(legend[3].label, /Zone 4/);
  });
});
