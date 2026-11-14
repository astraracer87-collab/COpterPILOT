import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { cleanBelgianGeometry } from "../../../shared/belgianGeozones";
import { parseEd269ToGeozoneInfo } from "../ed269";
import { simplifyRingGroup } from "../ringSimplify";

// Regressionstest für Task #303: belgische Flughafen-CTRs (EBAW VLL1A/VLL2)
// müssen als Donut (Außenring mit ausgespartem Loch) gerendert werden, nicht als
// voll gefüllter Keil. Das Zusammenspiel dreier Heuristiken muss erhalten bleiben:
//   1. cleanBelgianGeometry / deSpike überspringt mehrringige Polygone (Donuts),
//   2. parseEd269ToGeozoneInfo weist Ring-Rollen flächenbasiert zu (größter Ring
//      = Außenring), unabhängig von der GeoJSON-Reihenfolge,
//   3. simplifyRing (RDP) hält den Loch-Ring gültig (keine Selbstüberschneidung,
//      kein Kollaps), sodass die Karte das Loch aussparen kann.

const ROOT = path.resolve(__dirname, "../../..");

// Beide hochgeladenen EBAW-Donut-Fixtures (jeweils eine GeoJSON-Feature-Datei).
const FIXTURES = [
  "attached_assets/EBAW_VLL1A_1782387246636.geojson",
  "attached_assets/EBAW_VLL2_1782387307149.geojson",
];

// Shoelace-Absolutfläche (planar) eines Rings im [lat, lon]-Format. Nur als
// Größenvergleich genutzt – keine geodätische Genauigkeit nötig.
function ringAbsArea(ring: [number, number][]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

// Ray-Casting: liegt der Punkt innerhalb des Rings (Löcher ignoriert)?
function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Punkt-in-Polygon MIT Löchern: innerhalb des Außenrings UND außerhalb aller
// Loch-Ringe. group = [Außenring, …Löcher].
function pointInPolygonWithHoles(
  pt: [number, number],
  group: [number, number][][],
): boolean {
  if (group.length === 0 || !pointInRing(pt, group[0])) return false;
  for (let i = 1; i < group.length; i++) {
    if (pointInRing(pt, group[i])) return false; // im Loch -> außerhalb der Zone
  }
  return true;
}

// Mittelpunkt eines Rings (Durchschnitt der eindeutigen Eckpunkte).
function ringCentroid(ring: [number, number][]): [number, number] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  const pts = closed ? ring.slice(0, ring.length - 1) : ring;
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p[0];
    sy += p[1];
  }
  return [sx / pts.length, sy / pts.length];
}

function loadDonutGroup(relPath: string): {
  rawOuter: [number, number][];
  rawHole: [number, number][];
  simplified: [number, number][][];
} {
  const feat = JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));

  // 1. De-Spike: mehrringige Polygone (Donuts) bleiben unangetastet.
  const cleaned = cleanBelgianGeometry(feat.geometry);

  // 2. Flächenbasierte Ring-Rollen-Zuweisung in parseEd269ToGeozoneInfo.
  const zones = parseEd269ToGeozoneInfo([{ ...feat, geometry: cleaned }], "BE");
  assert.equal(zones.length, 1, `${relPath}: genau eine Zone erwartet`);
  const groups = zones[0].polygonGroups ?? [];
  assert.equal(groups.length, 1, `${relPath}: genau eine Polygon-Gruppe erwartet`);
  const group = groups[0];
  assert.ok(
    group.length >= 2,
    `${relPath}: Donut erwartet (Außenring + mindestens ein Loch), erhalten ${group.length} Ring(e)`,
  );

  // 3. RDP-Vereinfachung (Donut-erhaltend).
  const simplified = simplifyRingGroup(group);

  return { rawOuter: group[0], rawHole: group[1], simplified };
}

for (const relPath of FIXTURES) {
  const name = path.basename(relPath);

  test(`${name}: Außenring ist flächengrößter Ring und enthält das Loch`, () => {
    const { rawOuter, rawHole } = loadDonutGroup(relPath);
    const outerArea = ringAbsArea(rawOuter);
    const holeArea = ringAbsArea(rawHole);
    assert.ok(
      outerArea > holeArea,
      `${name}: Außenring (${outerArea}) muss flächengrößer sein als das Loch (${holeArea})`,
    );
    // Jeder Loch-Eckpunkt muss innerhalb des Außenrings liegen (Loch ist enthalten).
    for (const p of rawHole) {
      assert.ok(
        pointInRing(p, rawOuter),
        `${name}: Loch-Eckpunkt [${p}] muss innerhalb des Außenrings liegen`,
      );
    }
  });

  test(`${name}: Vereinfachung erhält Loch und Außenring-Fläche (<5% Verlust)`, () => {
    const { rawOuter, rawHole, simplified } = loadDonutGroup(relPath);

    // Loch bleibt nach der Vereinfachung erhalten (gültiger Ring).
    assert.ok(
      simplified.length >= 2,
      `${name}: vereinfachte Gruppe muss Außenring + Loch behalten, erhalten ${simplified.length}`,
    );
    assert.ok(
      simplified[1].length >= 3,
      `${name}: vereinfachter Loch-Ring muss gültig bleiben (>=3 Punkte)`,
    );

    // Außenring-Fläche bleibt erhalten (kein Korridor-/Form-Kollaps).
    const beforeOuter = ringAbsArea(rawOuter);
    const afterOuter = ringAbsArea(simplified[0]);
    assert.ok(
      beforeOuter > 0 && (beforeOuter - afterOuter) / beforeOuter <= 0.05,
      `${name}: Außenring-Flächenverlust durch Vereinfachung zu groß (${beforeOuter} -> ${afterOuter})`,
    );

    // Loch-Fläche bleibt erhalten (Loch kollabiert nicht).
    const beforeHole = ringAbsArea(rawHole);
    const afterHole = ringAbsArea(simplified[1]);
    assert.ok(
      beforeHole > 0 && (beforeHole - afterHole) / beforeHole <= 0.05,
      `${name}: Loch-Flächenverlust durch Vereinfachung zu groß (${beforeHole} -> ${afterHole})`,
    );
  });

  test(`${name}: Punkt im Loch-Mittelpunkt zählt NICHT als in der Zone`, () => {
    const { simplified } = loadDonutGroup(relPath);
    const holeCenter = ringCentroid(simplified[1]);
    // Sanity: der Mittelpunkt liegt innerhalb des Loch-Rings selbst.
    assert.ok(
      pointInRing(holeCenter, simplified[1]),
      `${name}: Loch-Mittelpunkt [${holeCenter}] sollte im Loch-Ring liegen`,
    );
    // Kern der Donut-Prüfung: mit Löchern gilt der Mittelpunkt als AUSSERHALB der Zone.
    assert.equal(
      pointInPolygonWithHoles(holeCenter, simplified),
      false,
      `${name}: Loch-Mittelpunkt darf nicht als in der Zone gelten (Loch nicht ausgespart)`,
    );
  });
}
