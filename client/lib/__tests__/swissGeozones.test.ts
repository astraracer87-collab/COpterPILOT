import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CH_GEOZONE_SOURCE_LABEL,
  normalizeSwissActivityZones,
  normalizeSwissEd269,
  normalizeSwissEd269Feature,
  stripBom,
  swissActivityMeters,
  swissConditionKind,
  swissDailyPeriodToSchedule,
  swissLimitMeters,
  swissRestriction,
} from "../../../shared/swissGeozones";
import { parseEd269ToGeozoneInfo, ed269IsActiveAt } from "../ed269";

// Fixtures stammen aus Nov. 2026; Ablauf-Filter gegen diese Zeit statt der echten Uhr.
const FIXTURE_NOW_MS = Date.parse("2026-11-15T12:00:00Z");

// Gekürzte ECHTE Auszüge (data.geo.admin.ch, Stand 2026-11-14): 9 ED-269-Zonen
// (alle 3 aus Liechtenstein, eine CTR, temporäre Zonen, ein MultiPolygon-Fall)
// und 2 UAS-Aktivitätszonen (Datei mit BOM wie im Original).
const fixtures = path.join(__dirname, "fixtures");
const ed269 = JSON.parse(fs.readFileSync(path.join(fixtures, "bazl-ch-ed269-sample.json"), "utf8"));
const activityText = fs.readFileSync(path.join(fixtures, "bazl-ch-activity-sample.geojson"), "utf8");

const byId = (features: any[], id: string) => features.find((f) => f.properties.identifier === id);

function countPoints(coords: any): number {
  if (typeof coords[0] === "number") return 1;
  return coords.reduce((s: number, c: any) => s + countPoints(c), 0);
}

describe("BAZL (CH/FL) – Einstufung aus restrictionConditions", () => {
  it("drei bekannte Bedingungstexte", () => {
    assert.equal(swissConditionKind("The operation of unmanned aircraft is prohibited."), "PROHIBITED_ALL");
    assert.equal(
      swissConditionKind("The operation of unmanned aircraft weighing more than 250 g is prohibited."),
      "PROHIBITED_OVER_250G",
    );
    assert.equal(
      swissConditionKind(
        "The operation of unmanned aircraft weighing more than 250 g is prohibited from an altitude of 120 m above ground.",
      ),
      "PROHIBITED_OVER_250G_ABOVE_120M",
    );
    assert.equal(swissConditionKind("Something new."), "OTHER");
  });

  it("restriction: Verbot → PROHIBITED, >250 g (auch CTR) → REQ_AUTHORISATION, unbekannt nie schwächer", () => {
    const base = { restriction: "REQ_AUTHORISATION" };
    assert.equal(swissRestriction({ ...base, restrictionConditions: ["The operation of unmanned aircraft is prohibited."] }), "PROHIBITED");
    assert.equal(
      swissRestriction({ ...base, restrictionConditions: ["The operation of unmanned aircraft weighing more than 250 g is prohibited."] }),
      "REQ_AUTHORISATION",
    );
    assert.equal(swissRestriction({ ...base, restrictionConditions: ["Neuer Text"] }), "REQ_AUTHORISATION");
    assert.equal(swissRestriction({ restriction: "NO_RESTRICTION", restrictionConditions: [] }), "REQ_AUTHORISATION");
    // Strengste Bedingung gewinnt
    assert.equal(
      swissRestriction({
        ...base,
        restrictionConditions: [
          "The operation of unmanned aircraft weighing more than 250 g is prohibited.",
          "The operation of unmanned aircraft is prohibited.",
        ],
      }),
      "PROHIBITED",
    );
  });

  it("Höhen: 99999 = unbegrenzt, FT wird umgerechnet", () => {
    assert.equal(swissLimitMeters(99999, "M"), undefined);
    assert.equal(swissLimitMeters(120, "M"), 120);
    assert.equal(swissLimitMeters(1000, "FT"), 304.8);
    assert.equal(swissLimitMeters(null, "M"), undefined);
  });
});

describe("BAZL (CH/FL) – Normalisierung des echten Auszugs", () => {
  const features = normalizeSwissEd269(ed269);

  it("alle Zonen werden übernommen, Quelle gesetzt", () => {
    assert.equal(ed269.features.length, 9);
    assert.equal(features.length, 9);
    for (const f of features) {
      assert.equal(f.properties.source, CH_GEOZONE_SOURCE_LABEL);
      assert.ok(Array.isArray(f.bbox) && f.bbox.length === 4);
      assert.ok(f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon");
    }
  });

  it("Liechtenstein: country LI, Balzers >250 g, Schloss Vaduz verboten", () => {
    const balzers = byId(features, "LSXB001");
    assert.equal(balzers.properties.country, "LI");
    assert.equal(balzers.properties.countryIso3, "LIE");
    assert.equal(balzers.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(balzers.properties.exemptMaxMassGrams, 250);
    assert.match(balzers.properties.message, /verboten für Drohnen über 250 g/i);
    assert.equal(balzers.properties.upperMeters, undefined); // 99999
    assert.equal(byId(features, "LIE001").properties.restriction, "PROHIBITED");
    assert.equal(byId(features, "LIE001").properties.country, "LI");
    assert.equal(byId(features, "CTR0001").properties.country, "CH");
  });

  it("CTR: Untergrenze 120 m AGL, Genehmigung, Text erklärt die 120-m-Regel", () => {
    const ctr = byId(features, "CTR0001");
    assert.equal(ctr.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(ctr.properties.swissRestrictionKind, "PROHIBITED_OVER_250G_ABOVE_120M");
    assert.equal(ctr.properties.lowerMeters, 120);
    assert.equal(ctr.properties.lowerReference, "AGL");
    assert.match(ctr.properties.message, /ab 120 m über Grund verboten für Drohnen über 250 g/);
  });

  it("deutsche + englische Meldung, Gründe auf Deutsch, Originalwerte bleiben", () => {
    const vd = byId(features, "VD00042");
    assert.equal(vd.properties.reason, "Naturschutz");
    assert.deepEqual(vd.properties.reasonCodes, ["NATURE"]);
    assert.equal(vd.properties.restriction, "PROHIBITED");
    assert.equal(vd.properties.originalRestriction, "REQ_AUTHORISATION");
    assert.match(vd.properties.message, /kantonalen Fachstelle/);
    const msgs = vd.properties.extendedProperties.localizedMessages;
    assert.equal(msgs[0].language, "de-CH");
    assert.match(msgs[1].message, /prohibited/);
  });

  it("applicability: dailyPeriod-Platzhalter und Ganztagesfenster entfallen, Zeitraum bleibt", () => {
    const permanent = byId(features, "KTAG508");
    assert.deepEqual(permanent.properties.applicability, [{ permanent: "YES" }]);
    const temp = byId(features, "FR157");
    assert.deepEqual(temp.properties.applicability, [
      { permanent: "NO", startDateTime: "2026-03-26T00:00:00.000+01:00", endDateTime: "2032-12-31T23:59:00.000+01:00" },
    ]);
    assert.equal(ed269IsActiveAt(temp.properties, new Date("2026-01-01T00:00:00Z")), false);
    assert.equal(ed269IsActiveAt(temp.properties, new Date("2027-06-01T12:00:00Z")), true);
  });

  it("dailyPeriod mit echten Zeiten → schedule in UTC", () => {
    assert.deepEqual(
      swissDailyPeriodToSchedule([{ day: ["Any"], startTime: "07:00:00.000+01:00", endTime: "18:30:00.000+01:00" }]),
      [{ day: ["ANY"], startTime: "06:00Z", endTime: "17:30Z" }],
    );
    assert.deepEqual(swissDailyPeriodToSchedule([{ day: [""], startTime: "", endTime: "" }]), []);
    assert.deepEqual(
      swissDailyPeriodToSchedule([{ day: ["Any"], startTime: "00:00:00.00+01:00", endTime: "00:00:00.00+01:00" }]),
      [],
    );
  });

  it("zwei Volumen mit gleichen Höhen → ein MultiPolygon", () => {
    const ge = byId(features, "GE32");
    assert.equal(ge.geometry.type, "MultiPolygon");
    assert.equal(ge.geometry.coordinates.length, 2);
  });

  it("unterschiedliche Höhenbänder → getrennte Features", () => {
    const zone = JSON.parse(JSON.stringify(ed269.features.find((z: any) => z.identifier === "GE32")));
    zone.geometry[1].upperLimit = 150;
    const out = normalizeSwissEd269Feature(zone);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((f) => f.properties.identifier).sort(), ["GE32#1", "GE32#2"]);
    assert.ok(out.some((f) => f.properties.upperMeters === 150));
  });

  it("Geometrie behält die volle Genauigkeit, Ringe bleiben geschlossen", () => {
    const rawPts = ed269.features.reduce(
      (s: number, z: any) => s + z.geometry.reduce((a: number, g: any) => a + countPoints(g.horizontalProjection.coordinates), 0),
      0,
    );
    const outPts = features.reduce((s, f) => s + countPoints(f.geometry.coordinates), 0);
    assert.ok(outPts >= rawPts - 5, `${outPts} von ${rawPts} Punkten (keine Vereinfachung)`);
    for (const f of features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          assert.ok(ring.length >= 4);
          assert.deepEqual(ring[0], ring[ring.length - 1]);
          for (const [x, y] of ring) {
            assert.equal(Math.round(x * 1e7) / 1e7, x);
            assert.equal(Math.round(y * 1e7) / 1e7, y);
          }
        }
      }
    }
    // Ohne Vereinfachung bleibt die Punktzahl (bis auf Rundungsduplikate) erhalten.
    const unsimplified = normalizeSwissEd269(ed269, { simplifyToleranceDeg: 0, decimals: 7 });
    assert.ok(unsimplified.reduce((s, f) => s + countPoints(f.geometry.coordinates), 0) >= rawPts - 5);
  });

  it("parseEd269ToGeozoneInfo liest die normalisierten Zonen", () => {
    const infos = parseEd269ToGeozoneInfo(features, "CH", FIXTURE_NOW_MS);
    assert.equal(infos.length, 9);
    const ctr = infos.find((i) => i.featureId === "CTR0001")!;
    assert.equal(ctr.restriction, "REQ_AUTHORISATION");
    assert.equal(ctr.lowerMeters, 120);
    assert.equal(ctr.upperMeters, undefined);
    assert.match(ctr.details, /Kontrollzone \(CTR\)/);
    const vaduz = infos.find((i) => i.featureId === "LIE001")!;
    assert.equal(vaduz.restriction, "PROHIBITED");
    assert.ok(vaduz.applicationText && /Ausnahmebewilligung/.test(vaduz.applicationText));
  });
});

describe("BAZL – UAS-Aktivitätszonen", () => {
  it("BOM wird entfernt", () => {
    assert.equal(activityText.charCodeAt(0), 0xfeff);
    assert.doesNotThrow(() => JSON.parse(stripBom(activityText)));
  });

  it("Höhenangaben „115m / 377ft“, GND", () => {
    assert.equal(swissActivityMeters("115m / 377ft"), 115);
    assert.equal(swissActivityMeters("120m / 400 ft"), 120);
    assert.equal(swissActivityMeters("GND"), 0);
    assert.equal(swissActivityMeters("400ft"), 122);
    assert.equal(swissActivityMeters(""), undefined);
  });

  it("CONDITIONAL mit Zeitraum, Text-Zeitplan und AGL-Obergrenze", () => {
    const zones = normalizeSwissActivityZones(JSON.parse(stripBom(activityText)));
    assert.equal(zones.length, 2);
    const swi = byId(zones, "SWI033");
    assert.equal(swi.properties.restriction, "CONDITIONAL");
    assert.equal(swi.properties.isActivityZone, true);
    assert.equal(swi.properties.name, "Solothurn-Hägendorf");
    assert.equal(swi.properties.upperMeters, 115);
    assert.equal(swi.properties.upperLimitAmslText, "1123m / 3684ft");
    assert.deepEqual(swi.properties.applicability[0].schedule, ["1745-0630, daily"]);
    // großzügiger Zeitraum: Starttag 00:00 MESZ bis Endtag 23:59:59 MEZ (inklusive)
    assert.equal(ed269IsActiveAt(swi.properties, new Date("2026-12-01T22:00:00Z")), true);
    assert.equal(ed269IsActiveAt(swi.properties, new Date("2026-12-02T12:00:00Z")), false);
    const infos = parseEd269ToGeozoneInfo(zones, "CH", FIXTURE_NOW_MS);
    const info = infos.find((i) => i.featureId === "SWI033")!;
    assert.deepEqual(info.scheduleText, ["1745-0630, daily"]);
    assert.match(info.details, /UAS-Aktivitätszone/);
  });
});
