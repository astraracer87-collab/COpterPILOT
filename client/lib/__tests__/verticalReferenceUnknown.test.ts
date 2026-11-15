// Product Owner (Stand Länder-Nutzung): ein fehlender Höhenbezug ist UNKNOWN –
// nie still AGL. Betrifft die sechs in B6 mit ⚠️ markierten Stellen (ES
// esReference, SE ed318LayerAltitudes, CH verticalRef, CY Texthöhen ohne MSL,
// IE Layer-Bezug, SK DÚ-Obergrenze) und den ES-insignias-Pfad.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeEnaireInsigniasFeature, parseEsAltitude } from "../../../shared/spanishGeozones";
import { ed318LayerAltitudes } from "../../../shared/swedishGeozones";
import { normalizeSwissEd269Feature } from "../../../shared/swissGeozones";
import { formatCyLimitDe, parseCyHeights } from "../../../shared/cypriotGeozones";
import { normalizeIrishZones } from "../../../shared/irishLuxGeozones";
import { parseSkDuHeight } from "../../../shared/slovakGeozones";
import { parseEd269ToGeozoneInfo } from "../ed269";

const square = { type: "Polygon", coordinates: [[[9.5, 47.1], [9.51, 47.1], [9.51, 47.11], [9.5, 47.11], [9.5, 47.1]]] };

describe("Fehlender Höhenbezug → UNKNOWN (nie still AGL)", () => {
  it("ES parseEsAltitude: Wert ohne Bezug → UNKNOWN, mit Bezug wie bisher, 0 ohne Bezug = GND", () => {
    assert.deepEqual(parseEsAltitude(120, "M", ""), { meters: 120, reference: "UNKNOWN", text: "120 m (Bezug unbekannt)" });
    assert.equal(parseEsAltitude(120, "M", "AGL")?.reference, "AGL");
    assert.equal(parseEsAltitude(400, "FT", "AMSL")?.reference, "MSL");
    assert.deepEqual(parseEsAltitude(0, "M", null), { meters: 0, reference: "AGL", text: "GND" });
  });

  it("ES insignias: Zone ohne Höhenbezug → lower/upper UNKNOWN, Zone bleibt erhalten", () => {
    const f = normalizeEnaireInsigniasFeature({
      type: "Feature",
      id: "es_restringidas.7",
      geometry: { type: "Polygon", coordinates: [[[-3.7, 40.4], [-3.69, 40.4], [-3.69, 40.41], [-3.7, 40.41], [-3.7, 40.4]]] },
      properties: { _esLayer: "es_restringidas", OBJECTID: 7, NAME_TXT: "Zona X", RESTRICCION_LOWER: 50, RESTRICCION_UPPER: 120, RESTRICCION_UOM: "M" },
    }, new Date(Date.UTC(2026, 10, 15)));
    assert.ok(f, "Zone darf nicht verworfen werden");
    assert.equal(f!.properties.lowerReference, "UNKNOWN");
    assert.equal(f!.properties.upperReference, "UNKNOWN");
  });

  it("SE ed318LayerAltitudes: Schicht ohne Bezug → UNKNOWN (GND bleibt GND)", () => {
    const r = ed318LayerAltitudes({ uom: "m", lower: 0, upper: 120 });
    assert.deepEqual(r.lower, { meters: 0, reference: "AGL", text: "GND" });
    assert.equal(r.upper?.reference, "UNKNOWN");
    assert.equal(r.upper?.text, "120 m (Bezug unbekannt)");
    const withRef = ed318LayerAltitudes({ uom: "m", lower: 0, upper: 120, upperReference: "AGL" });
    assert.equal(withRef.upper?.reference, "AGL");
    const lowerNoRef = ed318LayerAltitudes({ uom: "ft", lower: 500, upper: 2000, upperReference: "AMSL" });
    assert.equal(lowerNoRef.lower?.reference, "UNKNOWN");
    assert.equal(lowerNoRef.upper?.reference, "MSL");
  });

  it("CH verticalRef: leerer/unbekannter Bezug → UNKNOWN, SFC → AGL", () => {
    const zone = (lowerRef: string | undefined, upperRef: string | undefined) => ({
      identifier: "T1",
      country: "CHE",
      name: "Test",
      restriction: "REQ_AUTHORISATION",
      restrictionConditions: [],
      geometry: [{ uomDimensions: "M", lowerLimit: 0, lowerVerticalReference: lowerRef, upperLimit: 120, upperVerticalReference: upperRef, horizontalProjection: square }],
    });
    const [none] = normalizeSwissEd269Feature(zone(undefined, ""));
    assert.equal(none.properties.lowerReference, "UNKNOWN");
    assert.equal(none.properties.upperReference, "UNKNOWN");
    const [sfc] = normalizeSwissEd269Feature(zone("SFC", "AMSL"));
    assert.equal(sfc.properties.lowerReference, "AGL");
    assert.equal(sfc.properties.upperReference, "AMSL");
    // Modell: UNKNOWN bleibt UNKNOWN (wird nie ausgeblendet)
    const [info] = parseEd269ToGeozoneInfo([{ ...none, properties: { ...none.properties } }] as any, "CH");
    assert.equal(info.upper?.ref ?? info.upperReference, "UNKNOWN");
  });

  it("CY Texthöhen: ohne MSL/AGL-Angabe → UNKNOWN, Anzeige „Bezug unbekannt“", () => {
    const r = parseCyHeights("0 - 60 m");
    assert.equal(r.upper?.reference, "UNKNOWN");
    assert.match(formatCyLimitDe(r.upper), /Bezug unbekannt/);
    assert.equal(parseCyHeights("SFC – 400 ft AGL").upper?.reference, "AGL");
    assert.equal(parseCyHeights("above 500 ft AMSL").lower?.reference, "MSL");
  });

  it("IE Layer ohne lower/upperReference → UNKNOWN", () => {
    const [f] = normalizeIrishZones({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { identifier: "EI1", name: "Z", restriction: "REQ_AUTHORISATION" }, geometry: { ...square, layer: { uom: "m", lower: 0, upper: 120 } } }],
    });
    assert.equal(f.properties.lowerReference, "UNKNOWN");
    assert.equal(f.properties.upperReference, "UNKNOWN");
  });

  it("SK DÚ-Obergrenze ohne Bezug → UNKNOWN (Untergrenze erbt), mit Bezug wie bisher", () => {
    const h = parseSkDuHeight("30 - 120m");
    assert.equal(h?.upperReference, "UNKNOWN");
    assert.equal(h?.lowerReference, "UNKNOWN");
    assert.match(h!.label, /Bezug unbekannt/);
    assert.equal(parseSkDuHeight("GND - 120m")?.lowerReference, "AGL");
    assert.equal(parseSkDuHeight("30 - 120m AGL")?.upperReference, "AGL");
    assert.equal(parseSkDuHeight("GND - 5000ft AMSL")?.upperReference, "MSL");
  });
});
