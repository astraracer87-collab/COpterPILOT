import { test } from "node:test";
import assert from "node:assert/strict";

import { smoothRingGroup } from "../ringSimplify";

// Performance (RC Pro 2): Screens zeichnen ihre Zonen bei jedem Render neu
// (z. B. beim Abhaken einer Bestätigung). smoothRingGroup cached das Ergebnis
// je Eingabe-Gruppe, damit die teure Glättung nicht jedes Mal erneut läuft.

function circleRing(n: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    ring.push([50 + 0.01 * Math.sin(a), 8 + 0.015 * Math.cos(a)]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

test("smoothRingGroup: gleiche Gruppe → identisches (gecachtes) Ergebnis", () => {
  const group = [circleRing(12)];
  const a = smoothRingGroup(group);
  const b = smoothRingGroup(group);
  assert.ok(a.length > 0);
  assert.equal(a, b);
});

test("smoothRingGroup: inhaltsgleiche, neue Gruppe liefert gleichen Inhalt", () => {
  const a = smoothRingGroup([circleRing(12)]);
  const b = smoothRingGroup([circleRing(12)]);
  assert.deepEqual(a, b);
});

test("smoothRingGroup: Cache je lonIndex getrennt und bei veränderter Gruppe neu berechnet", () => {
  const group = [circleRing(12)];
  const lon1 = smoothRingGroup(group, 1);
  const lon0 = smoothRingGroup(group, 0);
  assert.notEqual(lon1, lon0);
  // Gruppe nachträglich verändert (Loch ergänzt) → kein veralteter Treffer.
  group.push(circleRing(10).map(([la, lo]) => [50 + (la - 50) / 4, 8 + (lo - 8) / 4] as [number, number]));
  const after = smoothRingGroup(group, 1);
  assert.notEqual(after, lon1);
  assert.equal(after.length, 2);
});
