// Brussels FIR: undatierte NOTAM-Gebiete (Droneguide geo_zone_fast) werden
// auch aus älteren Gerätespeichern verworfen, datierte bleiben.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEd269ToGeozoneInfo } from "../ed269";

const square = {
  type: "Polygon",
  coordinates: [[[6.1, 49.6], [6.2, 49.6], [6.2, 49.7], [6.1, 49.7], [6.1, 49.6]]],
};

describe("BE: undatierte NOTAMs", () => {
  it("verwirft ein NOTAM-Gebiet ohne Gültigkeit (z. B. G2219/26)", () => {
    const zones = parseEd269ToGeozoneInfo(
      [{ type: "Feature", geometry: square, properties: { name: "G2219/26", type: "NOTAM", _notamEligible: true, restriction: "PROHIBITED" } }],
      "BE",
    );
    assert.equal(zones.length, 0);
  });

  it("behält dauerhafte BE-Zonen ohne Gültigkeit", () => {
    const zones = parseEd269ToGeozoneInfo(
      [{ type: "Feature", geometry: square, properties: { name: "EBR01", type: "CTR", restriction: "REQ_AUTHORISATION" } }],
      "BE",
    );
    assert.equal(zones.length, 1);
  });
});
