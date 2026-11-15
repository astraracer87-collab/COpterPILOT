import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { __setBundledForTests, addRuntimeTranslations, hasGermanFor, looksGerman, translateTextDe, translateZoneNameDe } from "../../../shared/zoneTranslate";
import { parseEd269ToGeozoneInfo } from "../ed269";

describe("Übersetzung der Behördentexte", () => {
  afterEach(() => __setBundledForTests(null));

  it("übersetzt zeilenweise, unbekannte Zeilen bleiben", () => {
    __setBundledForTests({ lines: { "Droneflyging krever tillatelse fra flygeledelsen (tårnet).": "Drohnenflug erfordert eine Genehmigung der Flugsicherung (Tower)." }, names: {} });
    const r = translateTextDe("Droneflyging  krever tillatelse fra flygeledelsen (tårnet).\nUnbekannt xyz");
    assert.equal(r.changed, true);
    assert.equal(r.text, "Drohnenflug erfordert eine Genehmigung der Flugsicherung (Tower).\nUnbekannt xyz");
  });

  it("Zonennamen: Wörterbuch, sonst unverändert; Laufzeit-Cache greift", () => {
    __setBundledForTests({ lines: {}, names: { "Sandane lufthamn, Anda": "Flughafen Sandane, Anda" } });
    assert.equal(translateZoneNameDe("Sandane lufthamn, Anda"), "Flughafen Sandane, Anda");
    assert.equal(translateZoneNameDe("Oslo"), "Oslo");
    addRuntimeTranslations({ "Bergen lufthamn": "Flughafen Bergen" }, "name");
    assert.equal(translateZoneNameDe("Bergen lufthamn"), "Flughafen Bergen");
  });

  it("erkennt deutsche Texte", () => {
    assert.equal(looksGerman("Der Betrieb von Drohnen ist verboten."), true);
    assert.equal(looksGerman("Access prohibited."), false);
    assert.equal(hasGermanFor("Der Flug ist nur mit Genehmigung erlaubt."), true);
  });

  it("parseEd269ToGeozoneInfo zeigt Deutsch und das Original", () => {
    __setBundledForTests({
      lines: { "5 km-sone rundt lufthavn.": "5-km-Zone um den Flughafen." },
      names: { "Sandane lufthamn": "Flughafen Sandane" },
    });
    const [info] = parseEd269ToGeozoneInfo([
      { type: "Feature", geometry: { type: "Polygon", coordinates: [[[6, 61], [6.1, 61], [6.1, 61.1], [6, 61]]] }, properties: { name: "Sandane lufthamn", restriction: "REQ_AUTHORISATION", message: "5 km-sone rundt lufthavn.", lowerMeters: 0, upperMeters: 120 } },
    ] as any, "NO");
    assert.equal(info.name, "Flughafen Sandane");
    assert.match(info.details, /5-km-Zone um den Flughafen\./);
    assert.match(info.details, /Originaltext der Behörde:\nSandane lufthamn\n5 km-sone rundt lufthavn\./);
  });
});
