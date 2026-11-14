import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Render-seitiger Regressionstest für Task #559: runde Vektor-Geozonen (BE skeyes
// ED-269 sowie markierte/hervorgehobene Zonen) erschienen auf der Radarkarte trotz
// bereits verdichteter (geglätteter) Geometrie facettiert. Ursache war Leaflets
// Default-smoothFactor (1.0), der die ~289-Punkt-Kontur beim Zeichnen im
// Bildschirmraum wieder zu einem Vieleck vereinfacht. smoothFactor:0 zeichnet ALLE
// Stützpunkte -> runde Zonen bleiben rund, echte Polygone bleiben eckig (ihre
// Geometrie ist eckig). Beide Geozonen-Polygon-Layer (markiert = hzLayer, Vektor =
// vzLayer) müssen smoothFactor:0 setzen, sonst kehrt die Facettierung zurück.

const source = fs.readFileSync(
  path.join(__dirname, "..", "..", "components", "TrafficMapView.native.tsx"),
  "utf8",
);

// Holt das Options-Objekt-Literal eines L.polygon(...)-Aufrufs, der per .addTo(<layer>)
// an den angegebenen Layer gehängt wird.
function polygonOptionsFor(layer: string): string {
  const re = new RegExp(
    `L\\.polygon\\([^,]+,\\s*(\\{[^}]*\\})\\s*\\)\\.addTo\\(${layer}\\)`,
  );
  const m = source.match(re);
  assert.ok(m, `L.polygon(...).addTo(${layer}) sollte existieren`);
  return m![1];
}

test("markierte Geozonen (hzLayer) zeichnen mit smoothFactor:0", () => {
  const opts = polygonOptionsFor("hzLayer");
  assert.match(
    opts,
    /smoothFactor:\s*0/,
    "hzLayer-Polygone müssen smoothFactor:0 setzen, sonst facettiert Leaflet runde Zonen",
  );
});

test("Vektor-Geozonen (vzLayer) zeichnen mit smoothFactor:0", () => {
  const opts = polygonOptionsFor("vzLayer");
  assert.match(
    opts,
    /smoothFactor:\s*0/,
    "vzLayer-Polygone müssen smoothFactor:0 setzen, sonst facettiert Leaflet runde Zonen",
  );
});
