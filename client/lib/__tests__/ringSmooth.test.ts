import { test } from "node:test";
import assert from "node:assert/strict";

import { smoothRing, smoothRingGroup } from "../ringSimplify";

// Regressionstest für Task #319: kreisförmige Vektor-Geozonen (BE/AT/DK) sollen
// optisch rund erscheinen, ohne echte Ecken oder Donut-Löcher zu verfälschen.
// smoothRing verdichtet runde Konturen per Catmull-Rom-Interpolation und hält
// scharfe Ecken (Vier-/Fünfecke) sowie bereits dichte Ringe unverändert.

// Shoelace-Absolutfläche eines Rings (nur Größenvergleich, keine Geodäsie).
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

// Größter Außenwinkel (Richtungsänderung in Grad) entlang eines geschlossenen
// Rings, mit cos(lat)-Skalierung des Längengrads (Bodenmaß).
function maxTurnDeg(ring: [number, number][], latIndex: 0 | 1, lonIndex: 0 | 1): number {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  const pts = closed ? ring.slice(0, ring.length - 1) : ring;
  const m = pts.length;
  let latSum = 0;
  for (const p of pts) latSum += p[latIndex];
  const k = Math.cos(((latSum / m) * Math.PI) / 180);
  let max = 0;
  for (let i = 0; i < m; i++) {
    const prev = pts[(i - 1 + m) % m];
    const cur = pts[i];
    const next = pts[(i + 1) % m];
    const sx = lonIndex === 0 ? k : 1;
    const sy = lonIndex === 1 ? k : 1;
    const ax = (cur[0] - prev[0]) * sx;
    const ay = (cur[1] - prev[1]) * sy;
    const bx = (next[0] - cur[0]) * sx;
    const by = (next[1] - cur[1]) * sy;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) continue;
    let dot = (ax * bx + ay * by) / (la * lb);
    dot = dot < -1 ? -1 : dot > 1 ? 1 : dot;
    const deg = (Math.acos(dot) * 180) / Math.PI;
    if (deg > max) max = deg;
  }
  return max;
}

// Grobes N-Eck als Kreis-Approximation um (lat0, lon0). Format wählbar.
function circle(
  n: number,
  lat0: number,
  lon0: number,
  rDeg: number,
  format: "latlon" | "lnglat",
): [number, number][] {
  const k = Math.cos((lat0 * Math.PI) / 180);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const lat = lat0 + rDeg * Math.cos(a);
    const lon = lon0 + (rDeg * Math.sin(a)) / k;
    out.push(format === "latlon" ? [lat, lon] : [lon, lat]);
  }
  out.push([out[0][0], out[0][1]]);
  return out;
}

// Unregelmäßiges N-Eck (Radien pro Stützpunkt skaliert) im latlon-Format, um
// gezielt eine bestimmte Rundheit zu erzeugen (grob gesampelte reale Zonen sind
// nie perfekt rund). cos(lat)-Skalierung des Längengrads wie in der Implementierung.
function irregularRing(
  n: number,
  lat0: number,
  lon0: number,
  rDeg: number,
  radii: number[],
): [number, number][] {
  const k = Math.cos((lat0 * Math.PI) / 180);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const rr = rDeg * radii[i % radii.length];
    out.push([lat0 + rr * Math.cos(a), lon0 + (rr * Math.sin(a)) / k]);
  }
  out.push([out[0][0], out[0][1]]);
  return out;
}

// Rundheit (4*pi*A/U²) eines geschlossenen latlon-Rings mit cos(lat)-Skalierung –
// identisch zur Klassifikation in smoothRing, damit Tests die Bänder treffen.
function circularityLatLon(ring: [number, number][]): number {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  const open = closed ? ring.slice(0, ring.length - 1) : ring;
  const m = open.length;
  let latSum = 0;
  for (const p of open) latSum += p[0];
  const k = Math.max(0.1, Math.cos(((latSum / m) * Math.PI) / 180));
  let area2 = 0;
  let per = 0;
  for (let i = 0; i < m; i++) {
    const a = open[i];
    const b = open[(i + 1) % m];
    const ax = a[0];
    const ay = a[1] * k;
    const bx = b[0];
    const by = b[1] * k;
    area2 += ax * by - bx * ay;
    per += Math.hypot(bx - ax, by - ay);
  }
  const area = Math.abs(area2) / 2;
  return per > 0 ? (4 * Math.PI * area) / (per * per) : 0;
}

test("grobes Achteck (Kreis) wird verdichtet und runder", () => {
  const oct = circle(8, 51, 4, 0.02, "latlon");
  const before = maxTurnDeg(oct, 0, 1);
  const out = smoothRing(oct, 1);
  const after = maxTurnDeg(out, 0, 1);
  assert.ok(out.length > oct.length * 2, `Achteck sollte verdichtet werden (${oct.length} -> ${out.length})`);
  assert.ok(after < before, `Konturen sollten runder werden (max Knick ${before.toFixed(1)}° -> ${after.toFixed(1)}°)`);
  // Fläche nähert sich dem echten Kreis (leichte Aufwölbung der Sehnen), bleibt
  // aber in plausibler Größenordnung.
  const ratio = ringAbsArea(out) / ringAbsArea(oct);
  assert.ok(ratio > 1 && ratio < 1.15, `Flächenverhältnis plausibel (${ratio.toFixed(3)})`);
});

test("achsenparalleles Viereck bleibt scharf (unverändert)", () => {
  const sq: [number, number][] = [[51, 4], [51, 4.04], [51.03, 4.04], [51.03, 4], [51, 4]];
  const out = smoothRing(sq, 1);
  assert.deepEqual(out, sq, "echtes Viereck darf nicht geglättet werden");
});

test("um 45° gedrehtes Viereck bleibt scharf (cos-lat-Skalierung)", () => {
  // Ohne cos(lat)-Skalierung würde ein schräges 90°-Eck fälschlich als Kurve
  // gelesen und gerundet. Mit Skalierung bleibt der 90°-Knick erhalten.
  const k = Math.cos((51 * Math.PI) / 180);
  const rsq: [number, number][] = [];
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
    rsq.push([51 + 0.02 * dx, 4 + (0.02 * dy) / k]);
  }
  rsq.push([rsq[0][0], rsq[0][1]]);
  const out = smoothRing(rsq, 1);
  assert.equal(out.length, rsq.length, "gedrehtes Viereck darf nicht verdichtet werden");
});

test("echtes Vieleck (>=5 Punkte, geringe Rundheit) bleibt scharf (unverändert)", () => {
  // L-/Hafen-/CTR-artiges Polygon mit echten Ecken: niedrige Rundheit -> die
  // frühere Pro-Eckpunkt-Heuristik rundete sanfte Ecken (<62°) fälschlich; die
  // Rundheits-Klassifikation lässt das Polygon jetzt komplett unverändert.
  const lshape: [number, number][] = [
    [51.0, 4.0],
    [51.0, 4.06],
    [51.02, 4.06],
    [51.02, 4.03],
    [51.05, 4.03],
    [51.05, 4.0],
    [51.0, 4.0],
  ];
  const out = smoothRing(lshape, 1);
  assert.deepEqual(out, lshape, "echtes Vieleck darf nicht geglättet werden");
});

test("Dreieck bleibt unverändert (zu wenige Punkte)", () => {
  const tri: [number, number][] = [[51, 4], [51.03, 4], [51.015, 4.04], [51, 4]];
  const out = smoothRing(tri, 1);
  assert.deepEqual(out, tri);
});

test("4-Punkt-Kreisnäherung bleibt unverändert (zu wenige Punkte, bewusst)", () => {
  // Eine als Raute gesampelte Kreisnäherung (4 Punkte) wird NICHT geglättet:
  // m<5 ist von echten Vierecken nicht unterscheidbar -> bewusst unverändert.
  const diamond: [number, number][] = [
    [51.02, 4.0],
    [51.0, 4.03],
    [50.98, 4.0],
    [51.0, 3.97],
    [51.02, 4.0],
  ];
  const out = smoothRing(diamond, 1);
  assert.deepEqual(out, diamond, "4-Punkt-Ring darf nicht verdichtet werden");
});

test("Stadion/Kapsel (gerade Seiten + runde Enden) bleibt formstabil", () => {
  // Catmull-Rom hält kollineare Stützpunkte kollinear, daher dürfen gerade Seiten
  // nicht aufwölben. Fläche bleibt nahe am Original (kein Ballooning).
  const k = Math.cos((51 * Math.PI) / 180);
  const capsule: [number, number][] = [];
  // gerade Unterseite (mehrere kollineare Punkte)
  for (let i = 0; i <= 4; i++) capsule.push([51.0, 4.0 + (0.06 * i) / 4 / k]);
  // rundes rechtes Ende
  for (let i = 1; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI;
    capsule.push([51.0 + 0.02 + 0.02 * Math.sin(a), 4.06 / k + (0.02 * Math.cos(a)) / k]);
  }
  // gerade Oberseite
  for (let i = 4; i >= 0; i--) capsule.push([51.04, 4.0 + (0.06 * i) / 4 / k]);
  // rundes linkes Ende
  for (let i = 1; i < 6; i++) {
    const a = Math.PI / 2 + (i / 6) * Math.PI;
    capsule.push([51.0 + 0.02 + 0.02 * Math.sin(a), (0.02 * Math.cos(a)) / k]);
  }
  capsule.push([capsule[0][0], capsule[0][1]]);
  const out = smoothRing(capsule, 1);
  assert.ok(out.length >= 4, "Ergebnis bleibt gültiger geschlossener Ring");
  assert.equal(out[0][0], out[out.length - 1][0], "Ring bleibt geschlossen (lat)");
  assert.equal(out[0][1], out[out.length - 1][1], "Ring bleibt geschlossen (lon)");
  const ratio = ringAbsArea(out) / ringAbsArea(capsule);
  assert.ok(ratio > 0.95 && ratio < 1.12, `Fläche bleibt plausibel (kein Ballooning, ${ratio.toFixed(3)})`);
});

test("grob gesampelter Kreis knapp unter alter 0.85-Schwelle wird gerundet", () => {
  // Reale Gefängnis-/Stationszonen (6–8 Punkte) liegen bei Rundheit ~0.74–0.85
  // und blieben unter der festen alten 0.85-Schwelle eckig. Die stützpunkt-
  // abhängige Schwelle (für wenige Punkte toleranter) rundet sie jetzt.
  const coarse = irregularRing(7, 51, 4, 0.02, [1.2, 0.78, 1.15, 0.8, 1.18, 0.79, 1.1]);
  const c = circularityLatLon(coarse);
  assert.ok(c >= 0.74 && c < 0.85, `Testform liegt im Zielband (c=${c.toFixed(3)})`);
  const before = maxTurnDeg(coarse, 0, 1);
  const out = smoothRing(coarse, 1);
  const after = maxTurnDeg(out, 0, 1);
  assert.ok(out.length > coarse.length * 2, `Kreis sollte verdichtet werden (${coarse.length} -> ${out.length})`);
  assert.ok(after < before, `Konturen sollten runder werden (max Knick ${before.toFixed(1)}° -> ${after.toFixed(1)}°)`);
});

test("dichter Großkreis (>60 Punkte, hohe Rundheit) wird geglättet statt übersprungen", () => {
  // EBBR VLL2 (601 Punkte, Rundheit 0.986) wurde früher über SMOOTH_MAX_VERTICES
  // komplett übersprungen und blieb durch die vorgelagerte RDP-Vereinfachung
  // facettiert. Jetzt wird er gleichmäßig resampelt und geglättet.
  const dense = circle(120, 51, 4, 0.02, "latlon");
  const out = smoothRing(dense, 1);
  assert.ok(out.length > 60, `dichter Kreis wird geglättet (${out.length} Punkte)`);
  assert.equal(out[0][0], out[out.length - 1][0], "Ring bleibt geschlossen (lat)");
  assert.equal(out[0][1], out[out.length - 1][1], "Ring bleibt geschlossen (lon)");
  const ratio = ringAbsArea(out) / ringAbsArea(dense);
  assert.ok(ratio > 0.95 && ratio < 1.1, `Fläche bleibt plausibel (${ratio.toFixed(3)})`);
  const after = maxTurnDeg(out, 0, 1);
  assert.ok(after < 8, `geglätteter Großkreis ist sehr rund (max Knick ${after.toFixed(1)}°)`);
});

test("echtes Vieleck im neuen Toleranzband (wenige Punkte, c~0.66) bleibt scharf", () => {
  // Die abgesenkte Schwelle für wenige Punkte (0.74) darf echte eckige Zonen
  // knapp darunter (Militär-/Hafenpolygone ~0.56–0.74) NICHT runden.
  const poly = irregularRing(8, 51, 4, 0.02, [1.25, 0.72, 1.2, 0.74, 1.22, 0.73, 1.18, 0.75]);
  const c = circularityLatLon(poly);
  assert.ok(c >= 0.55 && c < 0.74, `Testform liegt im Mittelband unter der Schwelle (c=${c.toFixed(3)})`);
  const out = smoothRing(poly, 1);
  assert.deepEqual(out, poly, "Mittelband-Vieleck darf nicht geglättet werden");
});

test("GeoJSON-Reihenfolge [lng, lat] wird über lonIndex 0 korrekt geglättet", () => {
  const octG = circle(8, 51, 4, 0.02, "lnglat");
  const before = maxTurnDeg(octG, 1, 0);
  const out = smoothRing(octG, 0);
  const after = maxTurnDeg(out, 1, 0);
  assert.ok(out.length > octG.length * 2, "GeoJSON-Kreis sollte verdichtet werden");
  assert.ok(after < before, "GeoJSON-Konturen sollten runder werden");
});

test("Donut: Außenring und Loch werden beide geglättet und bleiben gültig", () => {
  const outer = circle(16, 51, 4, 0.02, "latlon");
  const hole = circle(10, 51, 4, 0.008, "latlon");
  const grp = smoothRingGroup([outer, hole], 1);
  assert.equal(grp.length, 2, "Donut behält Außenring + Loch");
  assert.ok(grp[0].length > outer.length, "Außenring wird verdichtet");
  assert.ok(grp[1].length > hole.length, "Loch wird verdichtet");
  assert.ok(grp[1].length >= 3, "Loch-Ring bleibt gültig (>=3 Punkte)");
});
