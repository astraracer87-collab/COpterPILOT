import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  dedupeGodroneFeatures,
  godroneAirspaceExcluded,
  godroneAltitudeMeters,
  godroneRestriction,
  normalizeGodroneFeature,
} from "../../../shared/dutchGeozones";
import { parseEd269ToGeozoneInfo } from "../ed269";

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "godrone-amsterdam.json"), "utf8"),
);

describe("GoDrone (NL) – Normalisierung", () => {
  it("Höhen: Unlimited/null = unbegrenzt, Sfc = 0, sonst Meter", () => {
    assert.equal(godroneAltitudeMeters(null), undefined);
    assert.equal(godroneAltitudeMeters({ datum: "Unlimited", meters: 1e8 }), undefined);
    assert.equal(godroneAltitudeMeters({ datum: "Sfc", meters: 0 }), 0);
    assert.equal(godroneAltitudeMeters({ datum: "Agl", meters: 120 }), 120);
  });

  it("Einstufung nach detailedCategory", () => {
    assert.equal(godroneRestriction({ detailedCategory: "uas:zone:prohibited" }), "PROHIBITED");
    assert.equal(godroneRestriction({ detailedCategory: "uas:zone:conditional" }), "REQ_AUTHORISATION");
    assert.equal(godroneRestriction({ detailedCategory: "type:ctr" }), "REQ_AUTHORISATION");
    assert.equal(godroneRestriction({ detailedCategory: "type:tsa" }), "RESTRICTED");
    assert.equal(godroneRestriction({ detailedCategory: "other:ifr_areas" }), "PROHIBITED");
    assert.equal(godroneRestriction({ detailedCategory: "class:a" }), "NO_RESTRICTION");
    assert.equal(godroneRestriction({ detailedCategory: "unbekannt:neu" }), "CONDITIONAL");
  });

  it("Punkt mit Radius wird Kreis-Polygon, Bodengefahren entfallen", () => {
    const heli = fixture.features.find((f: any) => f.geometry.type === "Point");
    const n = normalizeGodroneFeature(heli)!;
    assert.equal(n.geometry!.type, "Polygon");
    assert.equal(n.geometry!.coordinates[0].length, 49);
    assert.equal(n.properties.restriction, "CONDITIONAL");
    assert.equal(
      normalizeGodroneFeature({ type: "Feature", geometry: { type: "Point", coordinates: [4.9, 52.3] }, properties: { category: "groundHazard" } }),
      null,
    );
  });

  it("CTR: Name, Höhen, Gültigkeit, Text", () => {
    const ctr = fixture.features.find((f: any) => f.properties.detailedCategory === "type:ctr");
    const n = normalizeGodroneFeature(ctr)!;
    assert.equal(n.properties.name, "SCHIPHOL CTR");
    assert.equal(n.properties.lowerMeters, 0);
    assert.ok(n.properties.upperMeters > 900);
    assert.ok(Number.isFinite(n.properties.validEndTs));
    assert.match(n.properties.message, /Kontrollzone/);
  });

  it("Dedupe über id und Erkennung zu großer Boxen", () => {
    const f = fixture.features[0];
    assert.equal(dedupeGodroneFeatures([f, f]).length, 1);
    assert.equal(godroneAirspaceExcluded({ excludedData: [{ detail: { name: "Airspace" } }] }), true);
    assert.equal(godroneAirspaceExcluded(fixture), false);
  });

  it("alle Fixture-Zonen lassen sich in Geozonen-Infos umwandeln", () => {
    const zones = fixture.features.map((f: any) => normalizeGodroneFeature(f)).filter(Boolean);
    assert.ok(zones.length >= 8);
    const infos = parseEd269ToGeozoneInfo(zones, "NL");
    assert.ok(infos.length >= 1);
    for (const info of infos) assert.ok(info.name, "Info mit Namen");
    assert.ok(infos.some((i) => i.name === "SCHIPHOL CTR"));
  });
});
