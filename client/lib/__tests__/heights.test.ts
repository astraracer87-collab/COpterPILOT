// Umbau B3: gemeinsamer Höhenparser, Bezug im Modell/Label, Höhenfilter mit
// UNKNOWN-Schutz und Gelände-Maximum.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  FT_M,
  formatHeightDe,
  formatHeightRangeDe,
  heightFromMeters,
  normalizeVRef,
  parseHeight,
  parseHeightRange,
  withSourceText,
} from "../../../shared/heights";
import {
  STD_DATUM_MARGIN_M,
  TERRAIN_CENTER_ONLY_MARGIN_M,
  isZoneReachable,
  partitionByReachability,
  terrainEstimateFromSamples,
  terrainSamplePoints,
} from "../../../shared/geozoneAltitudeFilter";
import { ed269LimitMeters, parseEd269ToGeozoneInfo } from "../ed269";
import { ed269VolumeLimitMeters, ed269VerticalReference } from "../../../shared/ed269Pure";
import { ed318Altitude } from "../../../shared/ed318Pure";
import { normalizeEd318Collection } from "../../../shared/swedishGeozones";
import { czZoneFromStored } from "../geozoneTiles/tileZones";
import { dipulZoneFromFeature } from "../geozoneQueries";
import { clearElevationCache, fetchTerrainEstimate } from "../elevation";

const FIX = path.join(__dirname, "fixtures");
const NOW = new Date("2026-11-15T12:00:00Z");
const near = (a: number | null | undefined, b: number, eps = 0.01) =>
  assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe("parseHeight – Schreibweisen aller Normalisierer", () => {
  // [Eingabe, uom, ref] → [m, ref, text]
  const table: [unknown, unknown, unknown, number | null, string, string][] = [
    // Zahlen + Einheit/Bezug getrennt (ED-269/ED-318, dipul, CZ-Layer)
    [120, "M", "AGL", 120, "AGL", "120 m AGL"],
    [120, "m", undefined, 120, "UNKNOWN", "120 m"],
    [1500, "FT", "AMSL", 1500 * FT_M, "MSL", "1500 ft AMSL"],
    [1500, "F", "MSL", 1500 * FT_M, "MSL", "1500 ft AMSL"],
    [1500, "FEET", "ALT", 1500 * FT_M, "MSL", "1500 ft AMSL"],
    [95, "FL", "STD", 9500 * FT_M, "MSL", "FL95"],
    [65, undefined, "STD", 6500 * FT_M, "MSL", "FL65"], // ED-318: STD ohne Einheit = FL
    [500, "M", "WGS84", 500, "MSL", "500 m WGS84"],
    [300, "M", "HEI", 300, "AGL", "300 m AGL"], // SK
    [300, "M", "AGND", 300, "AGL", "300 m AGL"], // ES
    [300, "M", "HGT", 300, "AGL", "300 m AGL"], // BG
    [300, "M", "SFC", 300, "AGL", "300 m AGL"],
    [0, "M", undefined, 0, "AGL", "GND"],
    [0, "M", "AMSL", 0, "MSL", "0 m AMSL"],
    [500, "M", "FOO", 500, "UNKNOWN", "500 m"],
    // Klartext
    ["GND", undefined, undefined, 0, "AGL", "GND"],
    ["SFC", undefined, undefined, 0, "AGL", "GND"],
    ["0 SFC", undefined, undefined, 0, "AGL", "GND"],
    ["0", undefined, undefined, 0, "AGL", "GND"],
    ["UNL", undefined, undefined, null, "UNKNOWN", "UNL"],
    ["UNLTD", undefined, undefined, null, "UNKNOWN", "UNL"],
    ["UNLIMITED", undefined, undefined, null, "UNKNOWN", "UNL"],
    ["GND_UNL", undefined, undefined, null, "UNKNOWN", "UNL"],
    ["1500 FT AMSL", undefined, undefined, 1500 * FT_M, "MSL", "1500 ft AMSL"],
    ["500FT AMSL", undefined, undefined, 500 * FT_M, "MSL", "500 ft AMSL"],
    ["FL95", undefined, undefined, 9500 * FT_M, "MSL", "FL95"],
    ["FL 65", undefined, undefined, 6500 * FT_M, "MSL", "FL65"],
    ["120 m AGL", undefined, undefined, 120, "AGL", "120 m AGL"],
    ["120m agl", undefined, undefined, 120, "AGL", "120 m AGL"],
    ["120 m n.p.t.", undefined, undefined, 120, "AGL", "120 m AGL"], // PL
    ["300 m n.p.m.", undefined, undefined, 300, "MSL", "300 m AMSL"], // PL
    ["150,5 m", undefined, "AGL", 150.5, "AGL", "150.5 m AGL"],
    ["2500", "ft", "MSL", 2500 * FT_M, "MSL", "2500 ft AMSL"],
    ["1000 ft STD", undefined, undefined, 1000 * FT_M, "MSL", "1000 ft AMSL"],
    // BE skeyes-Objekt
    [{ value: 1500, unit: "F", reference: "AMSL" }, undefined, undefined, 1500 * FT_M, "MSL", "1500 ft AMSL"],
    [{ value: 45, unit: "FL", reference: "STD" }, undefined, undefined, 4500 * FT_M, "MSL", "FL45"],
  ];
  for (const [v, uom, ref, m, r, text] of table) {
    it(`${JSON.stringify(v)} ${uom ?? ""} ${ref ?? ""}`.trim(), () => {
      const h = parseHeight(v, uom, ref)!;
      assert.ok(h, "lesbar");
      if (m == null) assert.equal(h.m, null);
      else near(h.m, m);
      assert.equal(h.ref, r);
      assert.equal(h.text, text);
    });
  }

  it("unlesbar/leer → null", () => {
    assert.equal(parseHeight(null), null);
    assert.equal(parseHeight(""), null);
    assert.equal(parseHeight("irgendwas"), null);
    assert.equal(parseHeight(Number.NaN), null);
  });

  it("STD/FL und WGS84 tragen das Datum (Druckhöhe bzw. ellipsoidisch ≈ MSL)", () => {
    assert.equal(parseHeight("FL95")!.datum, "STD");
    assert.equal(parseHeight(500, "M", "WGS84")!.datum, "WGS84");
    assert.equal(parseHeight(500, "M", "AMSL")!.datum, undefined);
    assert.deepEqual(normalizeVRef("n.p.t."), { ref: "AGL" });
    assert.deepEqual(normalizeVRef(""), { ref: "UNKNOWN" });
  });
});

describe("parseHeightRange", () => {
  it("GND – 2500 ft AMSL", () => {
    const r = parseHeightRange("GND – 2500 ft AMSL");
    assert.equal(r.lower!.text, "GND");
    near(r.upper!.m, 2500 * FT_M);
    assert.equal(r.upper!.ref, "MSL");
  });
  it("0-150m n.p.t. (PL): Bezug/Einheit am Ende gelten für beide", () => {
    const r = parseHeightRange("0-150m n.p.t.");
    assert.equal(r.lower!.m, 0);
    assert.equal(r.upper!.m, 150);
    assert.equal(r.upper!.ref, "AGL");
  });
  it("50-120 m AGL: Untergrenze erbt den Bezug", () => {
    const r = parseHeightRange("50-120 m AGL");
    assert.equal(r.lower!.m, 50);
    assert.equal(r.lower!.ref, "AGL");
  });
  it("SFC/FL95 und 1000 ft AMSL – FL 65", () => {
    assert.equal(parseHeightRange("SFC/FL95").upper!.text, "FL95");
    const r = parseHeightRange("1000 ft AMSL – FL 65");
    assert.equal(r.lower!.text, "1000 ft AMSL");
    assert.equal(r.upper!.text, "FL65");
  });
  it("ohne Trenner: nur Obergrenze", () => {
    const r = parseHeightRange("FL95");
    assert.equal(r.lower, null);
    assert.equal(r.upper!.text, "FL95");
  });
});

describe("formatHeightDe – Label mit Bezug", () => {
  it("Schreibweisen", () => {
    assert.equal(formatHeightDe(parseHeight("1500 ft AMSL")), "1500 ft AMSL (457 m)");
    assert.equal(formatHeightDe(parseHeight("GND")), "GND");
    assert.equal(formatHeightDe(parseHeight("FL95")), "FL95");
    assert.equal(formatHeightDe(parseHeight("120 m AGL")), "120 m AGL");
    assert.equal(formatHeightDe(parseHeight("UNL")), "unbegrenzt");
    assert.equal(formatHeightDe(parseHeight(500, "M", "WGS84")), "500 m AMSL (WGS84)");
    assert.equal(formatHeightDe(parseHeight(50, "M")), "50 m (Bezug unbekannt)");
    assert.equal(formatHeightDe(heightFromMeters(1981.2, "STD", "upper")), "1981 m AMSL (STD)");
  });
  it("Bereich", () => {
    assert.equal(formatHeightRangeDe(parseHeight("GND"), parseHeight("1500 ft AMSL")), "GND – 1500 ft AMSL (457 m)");
    assert.equal(formatHeightRangeDe(undefined, undefined), "GND – unbegrenzt");
  });
  it("withSourceText übernimmt ft-Schreibweise nur bei passenden Metern", () => {
    const h = heightFromMeters(457.2, "AMSL", "upper");
    assert.equal(formatHeightDe(withSourceText(h, parseHeight("1500 ft AMSL"))), "1500 ft AMSL (457 m)");
    assert.equal(formatHeightDe(withSourceText(h, parseHeight("2000 ft AMSL"))), "457 m AMSL");
    // Quelle mit anderem Bezug wird nicht übernommen
    assert.equal(withSourceText(h, parseHeight("1500 ft AGL")).ref, "MSL");
  });
});

describe("ersetzte Einzelparser rufen parseHeight", () => {
  it("ed269LimitMeters kennt jetzt FL", () => {
    near(ed269LimitMeters(95, "FL"), 9500 * FT_M);
    assert.equal(ed269LimitMeters("SFC", "M"), 0);
    assert.equal(ed269LimitMeters("UNL", "M"), undefined);
    near(ed269LimitMeters(1000, "FT"), 304.8);
  });
  it("ed269Pure: Meter/FL, Unbegrenzt-Schwelle, Bezüge", () => {
    assert.equal(ed269VolumeLimitMeters(65, "FL"), 1981.2);
    assert.equal(ed269VolumeLimitMeters(660, "FL"), undefined);
    assert.equal(ed269VolumeLimitMeters("GND", "M"), 0);
    assert.equal(ed269VerticalReference("SFC"), "AGL");
    assert.equal(ed269VerticalReference("ALT"), "AMSL");
    assert.equal(ed269VerticalReference("STD"), "STD");
  });
  it("ed318Altitude: fehlender Bezug ist UNKNOWN statt AGL", () => {
    assert.equal(ed318Altitude(300, "M")!.reference, "UNKNOWN");
    assert.equal(ed318Altitude(300, "M", "AGL")!.reference, "AGL");
    assert.equal(ed318Altitude(95, "FL", "STD")!.text, "FL 95");
  });
});

describe("Modell: upperReference/lower/upper und Label", () => {
  it("SE-Fixture ESU209 „0 AGL / 1500 ft AMSL“ behält upperReference MSL und zeigt ihn", () => {
    const se = JSON.parse(fs.readFileSync(path.join(FIX, "se-ed318-sample.json"), "utf8"));
    const feats = normalizeEd318Collection(se, NOW);
    const f = feats.filter((x: any) => x.properties.identifier === "ESU209");
    const [info] = parseEd269ToGeozoneInfo(f as any, "SE");
    assert.equal(info.upperReference, "MSL");
    assert.equal(info.lowerReference, "AGL");
    assert.equal(info.upper!.ref, "MSL");
    assert.equal(info.upperMeters, 457.2);
    assert.equal(info.altitudeLabel, "GND – 1500 ft AMSL (457 m)");
    assert.match(info.details, /Höhe: GND – 1500 ft AMSL \(457 m\)/);
  });

  it("AT (Frequentis): Bezug aus Anzeige-String bzw. properties.geometry, 10000 m = UNL", () => {
    const geom = { type: "Polygon", coordinates: [[[16, 48], [16.1, 48], [16.1, 48.1], [16, 48]]] };
    const [a, b] = parseEd269ToGeozoneInfo(
      [
        { type: "Feature", geometry: geom, properties: { restriction: "REQ_AUTHORISATION", lowerMeters: 150, upperMeters: 10000, lower: "150 M AGL", upper: "UNL" } },
        { type: "Feature", geometry: geom, properties: { restriction: "REQ_AUTHORISATION", lowerMeters: 300, upperMeters: 600, geometry: { uomDimensions: "M", lowerVerticalReference: "AMSL", upperVerticalReference: "AMSL" } } },
      ],
      "AT",
    );
    assert.equal(a.lowerReference, "AGL");
    assert.equal(a.altitudeLabel, "150 m AGL – unbegrenzt");
    assert.equal(a.upperMeters, 10000); // Kompatibilitätsfeld unverändert
    assert.equal(b.lowerReference, "MSL");
    assert.equal(b.upperReference, "MSL");
    assert.equal(b.altitudeLabel, "300 m AMSL – 600 m AMSL");
  });

  it("CZ: FL/STD-Grenzen werden als Flugfläche (MSL) gelesen, FL660 = unbegrenzt", () => {
    const square = { type: "Polygon", coordinates: [[[14, 50], [14.1, 50], [14.1, 50.1], [14, 50.1], [14, 50]]] };
    const z = czZoneFromStored({
      geometry: { ...square, layer: { lower: 65, lowerReference: "STD", upper: 95, upperReference: "STD", uom: "FL" } },
      properties: { identifier: "LKTSA1", type: "RESTRICTED" },
    })!;
    near(z.lowerMeters, 6500 * FT_M);
    assert.equal(z.lowerReference, "MSL");
    assert.equal(z.lower!.datum, "STD");
    assert.equal(z.upperReference, "MSL");
    assert.equal(z.altitudeLabel, "FL65 – FL95");
    const unl = czZoneFromStored({
      geometry: { ...square, layer: { lower: 0, lowerReference: "AGL", upper: 660, upperReference: "STD", uom: "FL" } },
      properties: { identifier: "LKX", type: "RESTRICTED" },
    })!;
    assert.equal(unl.upperMeters, undefined);
    assert.equal(unl.altitudeLabel, "GND – unbegrenzt");
    // ft AMSL
    const ft = czZoneFromStored({
      geometry: { ...square, layer: { lower: 0, lowerReference: "AGL", upper: 2500, upperReference: "AMSL", uom: "ft" } },
      properties: { identifier: "LKY", type: "RESTRICTED" },
    })!;
    assert.equal(ft.altitudeLabel, "GND – 2500 ft AMSL (762 m)");
  });

  it("DE dipul: Einheit/Bezug getrennt → Height + Label", () => {
    const z = dipulZoneFromFeature(
      {
        id: "flugbeschraenkungsgebiete.1",
        geometry: { type: "Polygon", coordinates: [[[8, 50], [8.1, 50], [8.1, 50.1], [8, 50.1], [8, 50]]] },
        properties: {
          name: "ED-R 1",
          lower_limit_altitude: 0, lower_limit_unit: "FT", lower_limit_alt_ref: "GND",
          upper_limit_altitude: 2500, upper_limit_unit: "FT", upper_limit_alt_ref: "MSL",
        },
      },
      { id: "x", wmsLayer: "flugbeschraenkungsgebiete", label: "Flugbeschränkungsgebiete", defaultEnabled: true } as any,
    )!;
    assert.equal(z.lower!.text, "GND");
    assert.equal(z.upperReference, "MSL");
    assert.equal(z.altitudeLabel, "GND – 2500 ft AMSL (762 m)");
  });
});

describe("Höhenfilter: UNKNOWN nie ausblenden, Gelände-Maximum", () => {
  it("Untergrenze mit unbekanntem Bezug bleibt sichtbar (auch weit über der Flughöhe)", () => {
    assert.equal(isZoneReachable({ lowerMeters: 3000, lowerReference: "" }, { reachableAltitudeM: 120 }), true);
    assert.equal(isZoneReachable({ lowerMeters: 3000, lowerReference: "UNKNOWN" }, { reachableAltitudeM: 120 }), true);
    assert.equal(isZoneReachable({ lower: parseHeight(3000, "M")! }, { reachableAltitudeM: 120, terrainElevationM: 0 }), true);
    // Aus parseEd269ToGeozoneInfo ohne Bezugsfeld
    const [info] = parseEd269ToGeozoneInfo(
      [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[[16, 48], [16.1, 48], [16.1, 48.1], [16, 48]]] }, properties: { restriction: "PROHIBITED", lowerMeters: 900, upperMeters: 1200 } }],
      "AT",
    );
    assert.equal(info.lowerReference, "UNKNOWN");
    const part = partitionByReachability([info], { reachableAltitudeM: 120, terrainElevationM: 200 });
    assert.equal(part.hiddenAbove.length, 0);
  });

  it("AGL-Untergrenze über der Flughöhe wird weiterhin ausgeblendet", () => {
    assert.equal(isZoneReachable({ lower: parseHeight("300 m AGL")! }, { reachableAltitudeM: 120 }), false);
  });

  it("Gebirge: MSL-Untergrenze 2000 m, Mitte 1700 m, Maximum 1950 m → 120 m AGL erreichbar", () => {
    const terrain = terrainEstimateFromSamples(1700, [1800, 1950, 1600, 1750])!;
    assert.equal(terrain.maxM, 1950);
    const zone = { lower: parseHeight(2000, "M", "AMSL")! };
    assert.equal(isZoneReachable(zone, { reachableAltitudeM: 120, terrain }), true);
    // Nur nach der Mitte (alt) wäre sie ausgeblendet worden: 2000 − 1700 = 300 > 120
  });

  it("nur Mittelpunkt bekannt: Mitte + Marge", () => {
    const zone = { lowerMeters: 2000, lowerReference: "MSL" };
    // 2000 − (1700 + 150) = 150 > 120 → aus; bei 1750: 100 ≤ 120 → sichtbar
    assert.equal(TERRAIN_CENTER_ONLY_MARGIN_M, 150);
    assert.equal(isZoneReachable(zone, { reachableAltitudeM: 120, terrainElevationM: 1700 }), false);
    assert.equal(isZoneReachable(zone, { reachableAltitudeM: 120, terrainElevationM: 1750 }), true);
    // ohne Gelände: sichtbar
    assert.equal(isZoneReachable(zone, { reachableAltitudeM: 120 }), true);
  });

  it("Flugfläche als Untergrenze: Druckhöhen-Marge", () => {
    const fl = { lower: parseHeight("FL75")! }; // 2286 m
    const terrain = terrainEstimateFromSamples(1900, [1950, 1900])!; // max 1950 (+30)
    // 2286 − 300 − 1980 = 6 ≤ 120 → sichtbar; ohne Marge wäre es 306 m → aus
    assert.equal(STD_DATUM_MARGIN_M, 300);
    assert.equal(isZoneReachable(fl, { reachableAltitudeM: 120, terrain }), true);
  });

  it("Obergrenze: nur MSL-Zonen sicher unter dem Gelände fallen weg, AGL nie", () => {
    const terrain = terrainEstimateFromSamples(1500, [1450, 1600, 1520])!; // min 1450
    assert.equal(isZoneReachable({ lowerMeters: 0, upper: parseHeight(1000, "M", "AMSL")! }, { reachableAltitudeM: 120, terrain }), false);
    assert.equal(isZoneReachable({ lowerMeters: 0, upper: parseHeight(1400, "M", "AMSL")! }, { reachableAltitudeM: 120, terrain }), true);
    // nur Mittelpunkt → nie über die Obergrenze ausblenden
    assert.equal(isZoneReachable({ lowerMeters: 0, upper: parseHeight(1000, "M", "AMSL")! }, { reachableAltitudeM: 120, terrainElevationM: 1500 }), true);
    // CZ „Höhengrenze 0 m AGL“ (Flug nur mit Genehmigung) bleibt
    assert.equal(isZoneReachable({ lowerMeters: 0, upper: parseHeight(0, "M", "AGL")! }, { reachableAltitudeM: 120, terrain }), true);
  });

  it("Stützpunkte: Mitte + 2 × 8 im Radius", () => {
    const pts = terrainSamplePoints(47, 11, 1000);
    assert.equal(pts.length, 17);
    assert.deepEqual(pts[0], { lat: 47, lon: 11 });
    assert.ok(Math.abs(pts[1].lat - 47 - 1000 / 111320) < 1e-9);
    assert.equal(terrainSamplePoints(47, 11, 0).length, 1);
  });

  it("fetchTerrainEstimate: ein Aufruf, Cache, offline nur Cache", async () => {
    clearElevationCache();
    const realFetch = globalThis.fetch;
    let calls = 0;
    (globalThis as any).fetch = async (url: string) => {
      calls++;
      const n = new URL(url).searchParams.get("latitude")!.split(",").length;
      const elevation = Array.from({ length: n }, (_, i) => 1700 + i * 10);
      return { ok: true, json: async () => ({ elevation }) };
    };
    try {
      const t = (await fetchTerrainEstimate(47, 11, 1000))!;
      assert.equal(calls, 1);
      assert.equal(t.samples, 17);
      assert.equal(t.centerM, 1700);
      assert.equal(t.maxM, 1860);
      (globalThis as any).fetch = async () => { throw new Error("offline"); };
      const again = (await fetchTerrainEstimate(47, 11, 1000))!;
      assert.equal(again.maxM, 1860);
      // unbekannter Ort offline → null (MSL-Zonen bleiben sichtbar)
      assert.equal(await fetchTerrainEstimate(48, 12, 1000), null);
    } finally {
      (globalThis as any).fetch = realFetch;
      clearElevationCache();
    }
  });
});
