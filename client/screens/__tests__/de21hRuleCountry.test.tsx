
import { de21hRule, isDe21hZoneAvEligible, isGermanGeozone, find21hRuleForLayer } from "@/lib/storage";

// Jest-Variante (storage.ts ist nicht unter tsx/node importierbar: react-native).
const assert = {
  equal: (a: unknown, b: unknown, _msg?: string) => expect(a).toBe(b),
  notEqual: (a: unknown, b: unknown, _msg?: string) => expect(a).not.toBe(b),
};
import { czZoneFromStored } from "@/lib/geozoneTiles/tileZones";

// Review-Fix 2: Deutsche § 21h-Regeln / Landes-AV dürfen NUR auf deutsche
// Zonen angewendet werden. Die CZ-Kachelspeicher-Kategorien sind deutsche
// Bezeichnungen ("Bahnanlagen", "Kontrollzonen / ATZ", "Energieanlagen",
// "Naturschutz") und matchten bisher per Substring die § 21h-Regeln.

function czStored(name: string, authority = "", type = "REQ_AUTHORISATION") {
  return {
    geometry: {
      type: "Polygon",
      coordinates: [[[14.4, 50.0], [14.41, 50.0], [14.41, 50.01], [14.4, 50.01], [14.4, 50.0]]],
      layer: { lower: 0, upper: 120, uom: "m", lowerReference: "AGL", upperReference: "AGL" },
    },
    properties: {
      identifier: "CZ-TEST",
      name: [{ lang: "cs", text: name }],
      type,
      zoneAuthority: authority ? [{ name: [{ lang: "cs", text: authority }] }] : [],
    },
  };
}

describe("de21hRule / isDe21hZoneAvEligible", () => {
  it("CZ 'Bahnanlagen' (Kachelspeicher) ist nie § 21h und nie AV-gedeckt", () => {
    const z = czZoneFromStored(czStored("Železniční trať Praha"));
    expect(z).toBeTruthy();
    assert.equal(z!.layerLabel, "Bahnanlagen");
    assert.equal(z!.country, "CZ");
    // Ohne Länderprüfung würde die Label-Erkennung greifen …
    assert.notEqual(find21hRuleForLayer(z!.layerLabel), null);
    // … mit dem DE-Prädikat nicht.
    assert.equal(de21hRule(z!), null);
    assert.equal(isDe21hZoneAvEligible(z!), false);
  });

  it("CZ 'Kontrollzonen / ATZ' ist nie § 21h und nie AV-gedeckt", () => {
    const z = czZoneFromStored(czStored("CTR Praha"));
    expect(z).toBeTruthy();
    assert.equal(z!.layerLabel, "Kontrollzonen / ATZ");
    assert.equal(de21hRule(z!), null);
    assert.equal(isDe21hZoneAvEligible(z!), false);
  });

  it("CZ 'Energieanlagen' / 'Naturschutz' sind nie § 21h", () => {
    const energy = czZoneFromStored(czStored("Elektrická stanice"));
    const nature = czZoneFromStored(czStored("CHKO Křivoklátsko"));
    assert.equal(energy!.layerLabel, "Energieanlagen");
    assert.equal(nature!.layerLabel, "Naturschutz");
    assert.equal(de21hRule(energy!), null);
    assert.equal(de21hRule(nature!), null);
  });

  it("DE-Äquivalente (ohne country-Feld = dipul/DE-Kachelspeicher) bleiben § 21h", () => {
    const bahn = { layerLabel: "Bahnanlagen", name: "DB-Strecke", details: "" };
    const ctr = { layerLabel: "Kontrollzonen", name: "CTR Frankfurt", details: "" };
    assert.equal(de21hRule(bahn)?.avEligible, true);
    assert.equal(isDe21hZoneAvEligible(bahn), true);
    assert.notEqual(de21hRule(ctr), null);
    assert.equal(isDe21hZoneAvEligible(ctr), false, "CTR ist nie AV-fähig");
  });

  it("explizit country 'DE' (bzw. 'de') zählt als deutsch", () => {
    const bahn = { layerLabel: "Bahnanlagen", country: "de" };
    assert.equal(isGermanGeozone(bahn), true);
    assert.equal(isDe21hZoneAvEligible(bahn), true);
  });

  it("andere Länder mit deutsch klingenden Labels: kein § 21h", () => {
    for (const iso of ["AT", "CH", "NL", "PL", "FR"]) {
      assert.equal(de21hRule({ layerLabel: "Natura 2000", country: iso }), null, iso);
      assert.equal(isDe21hZoneAvEligible({ layerLabel: "Wohngrundstücke", country: iso }), false, iso);
    }
  });

  it("ohne country-Feld entscheidet das Fallback-Land", () => {
    assert.equal(de21hRule({ layerLabel: "Bahnanlagen" }, "CZ"), null);
    assert.notEqual(de21hRule({ layerLabel: "Bahnanlagen" }, "DE"), null);
  });
});
