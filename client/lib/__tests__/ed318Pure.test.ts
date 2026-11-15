import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ed318Altitude,
  ed318Applicability,
  ed318ExtractZones,
  ed318ParseZone,
  ed318Restriction,
  ed318Text,
  ed318ZonesToFeatures,
} from "../../../shared/ed318Pure";
import { parseEd269ToGeozoneInfo } from "../ed269";

const FIX = path.join(__dirname, "fixtures");
const NOW = new Date("2026-11-15T12:00:00Z");

// Aufbau wie die echte ŘLP-ED-318-Datei (CZ, aim_ed318): FeatureCollection,
// Höhe in geometry.layer, Texte als Sprach-Arrays, zoneAuthority[].name als Array.
const czLike = {
  type: "FeatureCollection",
  name: "ed_318",
  metadata: { validFrom: "2026-09-03T00:00:00Z", issued: "2026-10-19T09:23:26Z" },
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[13.49583, 50.44583], [13.49583, 50.45], [13.5, 50.45], [13.5, 50.44583], [13.49583, 50.44583]]],
        layer: { upper: 40, upperReference: "AGL", lower: 0, lowerReference: "AGL", uom: "m" },
      },
      properties: {
        identifier: "921206",
        country: "CZE",
        name: [{ text: "Grid ATZ 921206", lang: "cs-CZ" }],
        type: "CONDITIONAL",
        variant: "COMMON",
        zoneAuthority: [
          {
            name: [
              { text: "RIZENI LETOVEHO PROVOZU CESKE REPUBLIKY,S. P.", lang: "cs-CZ" },
              { text: "AIR NAVIGATION SERVICES OF THE CZECH REPUBLIC", lang: "en-GB" },
            ],
            purpose: "AUTHORIZATION",
          },
        ],
      },
    },
  ],
};

describe("ED-318 – Grundbausteine", () => {
  it("Texte: String oder Sprach-Array, Original zuerst", () => {
    assert.equal(ed318Text("abc"), "abc");
    assert.equal(ed318Text([{ text: "Zona", lang: "es-ES" }, { text: "Zone", lang: "en-GB" }]), "Zona");
    assert.equal(ed318Text([{ text: "Zona", lang: "es-ES" }, { text: "Zone", lang: "en-GB" }], ["en"]), "Zone");
    assert.equal(ed318Text(null), "");
  });

  it("Beschränkung: ED-318 type und ED-269 restriction (type=COMMON ignoriert)", () => {
    assert.equal(ed318Restriction(undefined, "REQ_AUTHORIZATION"), "REQ_AUTHORISATION");
    assert.equal(ed318Restriction("PROHIBITED", "COMMON"), "PROHIBITED");
    assert.equal(ed318Restriction(undefined, "COMMON"), null);
    assert.equal(ed318Restriction({ type: "CONDITIONAL" }), "CONDITIONAL");
  });

  it("Höhen: m/ft/FL, Bezüge, GND/UNL, Strings mit Einheit", () => {
    assert.deepEqual(ed318Altitude(120, "M", "AGL"), { meters: 120, reference: "AGL", text: "120 m AGL" });
    assert.deepEqual(ed318Altitude(0, "m", "AGL"), { meters: 0, reference: "AGL", text: "GND" });
    assert.equal(ed318Altitude(3000, "FT", "AMSL")?.meters, 914.4);
    assert.equal(ed318Altitude(500, "M", "WGS84")?.reference, "MSL");
    assert.equal(ed318Altitude(65, "FL", "STD")?.meters, 1981.2);
    assert.equal(ed318Altitude(660, "FL", "STD")?.unlimited, true);
    assert.equal(ed318Altitude("UNL")?.unlimited, true);
    assert.deepEqual(ed318Altitude("120 m AGL"), { meters: 120, reference: "AGL", text: "120 m AGL" });
    assert.equal(ed318Altitude("500FT AMSL")?.meters, 152.4);
    assert.equal(ed318Altitude(null), null);
  });

  it("Zeitfenster: abgelaufen → null, dauerhaft → undefined, Zeitplan bleibt", () => {
    assert.equal(ed318Applicability([{ startDateTime: "2025-01-01T00:00:00Z", endDateTime: "2025-02-01T00:00:00Z" }], NOW), null);
    assert.equal(ed318Applicability([{ startDateTime: "2025-01-01T00:00:00Z" }], NOW), undefined);
    assert.equal(ed318Applicability([{ permanent: "YES" }], NOW), undefined);
    const a = ed318Applicability(
      [{ startDateTime: "2026-01-01T00:00:00Z", endDateTime: "2027-01-01T00:00:00Z", schedule: [
        { day: ["MON"], startTime: "07:00Z", endTime: "19:00Z" },
        { day: ["TUE"], startTime: "07:00Z", endTime: "19:00Z" },
      ] }],
      NOW,
    )!;
    assert.deepEqual(a[0].schedule, [{ day: ["MON", "TUE"], startTime: "07:00Z", endTime: "19:00Z" }]);
  });

  it("Hüllen: FeatureCollection, Array, {UASZoneList}, {items:[{zone}]}", () => {
    assert.equal(ed318ExtractZones(czLike).length, 1);
    assert.equal(ed318ExtractZones([{ identifier: "A" }]).length, 1);
    assert.equal(ed318ExtractZones({ UASZoneList: [{ identifier: "A" }, { identifier: "B" }] }).length, 2);
    assert.equal(ed318ExtractZones({ items: [{ zone: { identifier: "A" } }] })[0].identifier, "A");
  });
});

describe("ED-318 – Zonen", () => {
  it("CZ-artiges Feature (layer, Sprach-Arrays, Behördenname als Array)", () => {
    const z = ed318ParseZone(czLike.features[0], NOW)!;
    assert.equal(z.identifier, "921206");
    assert.equal(z.name, "Grid ATZ 921206");
    assert.equal(z.restriction, "CONDITIONAL");
    assert.equal(z.authorities[0].name, "RIZENI LETOVEHO PROVOZU CESKE REPUBLIKY,S. P.");
    assert.equal(z.volumes[0].upper?.meters, 40);
    const [f] = ed318ZonesToFeatures(czLike, { idPrefix: "CZ", now: NOW });
    assert.equal(f.properties.zoneId, "CZ-921206");
    assert.equal(f.properties.upperMeters, 40);
    assert.equal(f.properties.lowerMeters, 0);
    assert.match(f.properties.message, /Flug unter Auflagen/);
    assert.match(f.properties.message, /Genehmigung: RIZENI/);
  });

  it("ED-269-artiges geometry[] mit Circle und mehreren Höhenbändern", () => {
    const zone = {
      identifier: "X1",
      name: [{ text: "Zona X", lang: "es-ES" }],
      type: "PROHIBITED",
      geometry: [
        { uomDimensions: "FT", lowerLimit: 0, lowerVerticalReference: "AGL", upperLimit: 400, upperVerticalReference: "AGL",
          horizontalProjection: { type: "Circle", center: [-3.7, 40.4], radius: 1000 } },
        { uomDimensions: "M", lowerLimit: 120, lowerVerticalReference: "AGL", upperLimit: 300, upperVerticalReference: "AMSL",
          horizontalProjection: { type: "Polygon", coordinates: [[[-3.8, 40.3], [-3.6, 40.3], [-3.6, 40.5], [-3.8, 40.3]]] } },
      ],
    };
    const feats = ed318ZonesToFeatures([zone], { now: NOW });
    assert.equal(feats.length, 2);
    assert.deepEqual(feats.map((f) => f.properties.zoneId), ["X1#1", "X1#2"]);
    assert.equal(feats[0].geometry.type, "Polygon");
    assert.equal((feats[0].geometry.coordinates as any)[0].length, 49); // Kreis, 48 Segmente
    assert.equal(feats[0].properties.upperMeters, 121.9);
    assert.equal(feats[1].properties.upperReference, "MSL");
    assert.equal(feats[0].properties.restriction, "PROHIBITED");
  });

  it("fehlende Beschränkung → vorsichtig REQ_AUTHORISATION + Hinweis", () => {
    const [f] = ed318ZonesToFeatures([{ ...czLike.features[0], properties: { identifier: "N", name: "N" } }], { now: NOW });
    assert.equal(f.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(f.properties.restrictionAssumed, true);
    assert.match(f.properties.message, /vorsichtshalber/);
  });

  it("echte Transportstyrelsen-Datei (SE-Fixture) → lesbare App-Zonen", () => {
    const se = JSON.parse(fs.readFileSync(path.join(FIX, "se-ed318-sample.json"), "utf8"));
    const feats = ed318ZonesToFeatures(se, { idPrefix: "SE", now: NOW, langPrefs: ["en"] });
    assert.ok(feats.length > 0);
    const f = feats.find((x) => x.properties.identifier === "ESU200")!;
    assert.equal(f.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(f.properties.name, "Stornorrforsen hydro power plant");
    assert.equal(f.properties.upperMeters, 150);
    const info = parseEd269ToGeozoneInfo(feats as any, "SE");
    assert.ok(info.length > 0 && info.every((z) => z.polygonRings && z.polygonRings.length > 0));
  });
});
