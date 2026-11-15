import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { estonianRestriction, normalizeEstonianProps } from "../../../shared/estonianGeozones";
import { frequentisAvmUrl, EE_GEOZONES_URL, isEd269DirectCountry } from "../geozoneDirect/ed269Sources";

const en = (message: string) => ({ extendedProperties: { localizedMessages: [{ language: "en-GB", message }] } });

describe("Estland (EANS) – Einstufung", () => {
  it("Feed-Wert PROHIBITED bleibt Verbot", () => {
    assert.equal(estonianRestriction({ identifier: "EEGZS1", restriction: "PROHIBITED" }), "PROHIBITED");
  });
  it("NOTAM-Zone: Verbot laut Text, sonst Genehmigung", () => {
    const meta = { metaData: { author: "EANS NOTAM PIB" } };
    assert.equal(estonianRestriction({ identifier: "A1234/26", restriction: "NO_RESTRICTION", ...meta, ...en("ALL AIRCRAFT (INCLUDING UNMANNED AIRCRAFT) ARE PROHIBITED") }), "PROHIBITED");
    assert.equal(estonianRestriction({ identifier: "A1235/26", restriction: "NO_RESTRICTION", ...meta, ...en("UAS OPS SUBJ TO COORDINATION") }), "REQ_AUTHORISATION");
  });
  it("Kennungen EERZ / EER / EED / EEGZ", () => {
    assert.equal(estonianRestriction({ identifier: "EERZ12", restriction: "NO_RESTRICTION" }), "REQ_AUTHORISATION");
    assert.equal(estonianRestriction({ identifier: "EER5", restriction: "NO_RESTRICTION", reason: "Nature" }), "NATURE");
    assert.equal(estonianRestriction({ identifier: "EER7", restriction: "NO_RESTRICTION", reason: "Sensitive" }), "REQ_AUTHORISATION");
    assert.equal(estonianRestriction({ identifier: "EED3", restriction: "NO_RESTRICTION" }), "CONDITIONAL");
    assert.equal(estonianRestriction({ identifier: "EEGZ1S", restriction: "REQ_AUTHORISATION" }), "REQ_AUTHORISATION");
    assert.equal(estonianRestriction({ identifier: "EEGZ4O", restriction: "NO_RESTRICTION" }), "CONDITIONAL");
  });
  it("normalizeEstonianProps behält Originalwert und Quelle", () => {
    const p = normalizeEstonianProps({ identifier: "EERZ1", restriction: "NO_RESTRICTION" });
    assert.equal(p.restriction, "REQ_AUTHORISATION");
    assert.equal(p.originalRestriction, "NO_RESTRICTION");
    assert.match(p.source, /EANS/);
  });
  it("Abruf mit Jahres-Zeitfenster, EE ist Vektor-Land", () => {
    const u = frequentisAvmUrl(EE_GEOZONES_URL, new Date("2026-11-15T00:00:00Z"));
    assert.equal(u, "https://utm.eans.ee/avm/utm/uas.geojson?start=2026-11-15T00:00:00.000Z&end=2027-11-15T00:00:00.000Z");
    assert.equal(isEd269DirectCountry("EE"), true);
  });
});
