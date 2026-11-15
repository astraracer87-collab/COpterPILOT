// Deutsche Geozonen: Kartenfarbe nach Zonenart wie in der dipul-Karte (statt
// pauschal Orange nach Einstufung); Einstufung bleibt am Rand sichtbar; andere
// Länder unverändert.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DIPUL_LAYER_STYLES, dipulZoneColors, normalizeDipulLayerKey, zoneMapColors } from "../../../shared/dipulLayerStyles";
import { GEOZONE_LAYERS } from "../../../shared/geozoneLayerCatalog";
import { RESTRICTION_POLICY } from "../../../shared/restrictionPolicy";
import { czZoneFromStored, deZoneFromStored } from "../geozoneTiles/tileZones";

const square = { type: "Polygon", coordinates: [[[8, 50], [8.01, 50], [8.01, 50.01], [8, 50.01], [8, 50]]] };
const de = (layer: string, props: Record<string, unknown> = {}) => deZoneFromStored({ id: `${layer}.1`, geometry: square, properties: { name: "Z", ...props } })!;

describe("dipul-Farben je Ebene", () => {
  it("jede DE-Katalog-Ebene hat eine dipul-Farbe", () => {
    for (const l of GEOZONE_LAYERS) assert.ok(DIPUL_LAYER_STYLES[l.wmsLayer], l.wmsLayer);
  });
  it("Zonenarten bekommen ihre dipul-Füllfarbe (nicht mehr alle orange)", () => {
    const expect: Record<string, string> = {
      flughaefen: "rgba(207,43,43,",
      naturschutzgebiete: "rgba(103,161,71,",
      nationalparks: "rgba(103,161,71,",
      wohngrundstuecke: "rgba(240,203,81,",
      freibaeder: "rgba(240,203,81,",
      industrieanlagen: "rgba(42,40,105,",
      kraftwerke: "rgba(42,40,105,",
      bundesautobahnen: "rgba(150,158,166,",
      bahnanlagen: "rgba(40,44,48,",
      binnenwasserstrassen: "rgba(52,147,225,",
      krankenhaeuser: "rgba(229,111,7,",
      justizvollzugsanstalten: "rgba(229,111,7,",
    };
    for (const [layer, prefix] of Object.entries(expect)) {
      const z = de(layer);
      assert.ok(z.fillColor?.startsWith(prefix), `${layer}: ${z.fillColor}`);
      assert.notEqual(z.fillColor, RESTRICTION_POLICY.REQ_AUTHORISATION.fill, layer);
    }
    const fills = new Set(Object.keys(expect).map((l) => de(l).fillColor));
    assert.ok(fills.size >= 7, "verschiedene Farben");
  });
  it("Kontrollzonen nach type_code_detail (U_CONTROL_ZONE_1…4)", () => {
    assert.ok(de("kontrollzonen", { type_code_detail: "U_CONTROL_ZONE_1" }).fillColor?.startsWith("rgba(102,0,4,"));
    assert.ok(de("kontrollzonen", { type_code_detail: "U_CONTROL_ZONE_4" }).fillColor?.startsWith("rgba(167,67,167,"));
    assert.ok(de("kontrollzonen").fillColor?.startsWith("rgba(207,43,43,"));
  });
  it("Einstufung bleibt: Verbot/Sperrgebiet roter Policy-Rand, Einstufung unverändert", () => {
    const edr = de("flugbeschraenkungsgebiete");
    assert.equal(edr.restriction, "RESTRICTED");
    assert.equal(edr.strokeColor, RESTRICTION_POLICY.RESTRICTED.stroke);
    const temp = de("temporaere_betriebseinschraenkungen");
    assert.equal(temp.restriction, "PROHIBITED");
    assert.equal(temp.strokeColor, RESTRICTION_POLICY.PROHIBITED.stroke);
    const wohn = de("wohngrundstuecke");
    assert.equal(wohn.restriction, "REQ_AUTHORISATION");
    assert.ok(wohn.strokeColor?.startsWith("rgba(240,203,81,"));
  });
  it("Modellflug/Hängegleiter: nur Info-Fläche (fast transparent)", () => {
    const z = de("modellflugplaetze");
    assert.match(z.fillColor!, /,0\.06\)$/);
  });
  it("Schlüssel aus ID, dipul:-Präfix und Katalog-Label", () => {
    assert.equal(normalizeDipulLayerKey("dipul:naturschutzgebiete"), "naturschutzgebiete");
    assert.equal(normalizeDipulLayerKey("kontrollzonen.12"), "kontrollzonen");
    assert.equal(normalizeDipulLayerKey("Kontrollzonen (CTR)"), "kontrollzonen");
    assert.equal(dipulZoneColors("unbekannt"), null);
  });
  it("ältere gespeicherte DE-Zonen ohne Farbe: zoneMapColors nimmt die dipul-Farbe über das Label", () => {
    const c = zoneMapColors({ country: "DE", layerLabel: "Naturschutzgebiete", name: "NSG" });
    assert.ok(c.fill.startsWith("rgba(103,161,71,"));
  });
  it("andere Länder unverändert (Policy- bzw. Quellfarbe)", () => {
    const cz = czZoneFromStored({ geometry: { ...square, layer: { lower: 0, upper: 120, uom: "m" } }, properties: { identifier: "LKR1", type: "REQ_AUTHORIZATION" } })!;
    assert.equal(cz.fillColor, RESTRICTION_POLICY.REQ_AUTHORISATION.fill);
    assert.equal(zoneMapColors({ country: "AT", restriction: "PROHIBITED" }).fill, RESTRICTION_POLICY.PROHIBITED.fill);
    assert.equal(zoneMapColors({ country: "AT", fillColor: "#123456", strokeColor: "#654321" }).fill, "#123456");
  });
});
