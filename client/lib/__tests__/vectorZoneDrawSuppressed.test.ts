import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isVectorZoneDrawSuppressed } from "../geozoneZoom";

// Review-Fix 7: Die deutschen 100-m-Windkraft-Pufferzonen (energy-zone:*)
// wurden auf der Radar-Karte ab Zoom 12 ausgeblendet, weil dort angeblich
// serverseitige Anlagen-Kacheln übernahmen — die gibt es in der RC-Version
// nicht (energyTileUrl war immer ""). Sie müssen immer gezeichnet werden.
describe("isVectorZoneDrawSuppressed", () => {
  it("DE-Windkraft-Pufferzone wird nie unterdrückt (unabhängig vom Zoom)", () => {
    const windBuffer = { featureId: "energy-zone:wind:123", layerLabel: "Windkraftanlagen", country: "DE" };
    assert.equal(isVectorZoneDrawSuppressed(windBuffer, false), false);
    assert.equal(isVectorZoneDrawSuppressed({ ...windBuffer, country: undefined }, false), false);
  });

  it("normale Vektorzonen und temporäre Zonen werden gezeichnet", () => {
    assert.equal(isVectorZoneDrawSuppressed({ country: "AT" }, false), false);
    assert.equal(isVectorZoneDrawSuppressed({ country: "BE" }, true), false);
  });
});
