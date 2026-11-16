// React-Native-freie, reine Geometrie-Helfer zur Vereinfachung von Polygon-
// Ringen für das Karten-Rendering. Wurde aus TrafficMapView.native.tsx extrahiert,
// damit die Donut-/Loch-erhaltende Logik unter tsx (Node-Test-Runner) getestet
// werden kann, ohne react-native zu importieren (siehe tsx-Test-Import-Limits).
//
// Wichtig für Donut-Zonen (z. B. belgische Flughafen-CTRs EBAW VLL1A/VLL2): die
// Loch-Ringe müssen nach der Vereinfachung gültig bleiben, sonst kann die Karte
// das Loch nicht aussparen und die Sichel füllt sich voll als Keil.

// Ramer-Douglas-Peucker: geometrie-erhaltende Vereinfachung eines offenen
// Polyzugs. Behält die Form (auch dünne Korridor-Verlängerungen) und hält Loch-
// Ringe gültig, statt – wie die alte Stride-Dezimierung (jeder N-te Punkt) –
// dünne Korridore zu kollabieren oder Ringe selbst-überschneidend zu machen.
export function rdpSimplify(pts: [number, number][], epsilon: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const seg = stack.pop();
    if (!seg) break;
    const [s, e] = seg;
    const ax = pts[s][0];
    const ay = pts[s][1];
    const bx = pts[e][0];
    const by = pts[e][1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const px = pts[i][0];
      const py = pts[i][1];
      let d: number;
      if (len2 === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > epsilon) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Vereinfacht einen einzelnen Ring geometrie-erhaltend (RDP bei >500 Punkten,
// Seam erhalten). Gibt [] zurück, wenn weniger als 3 gültige Punkte übrig
// bleiben. Wichtig für Donut-Loch-Ringe: die Form muss gültig bleiben, sonst
// kann Leaflet das Loch nicht aussparen.
export function simplifyRing(ring: [number, number][]): [number, number][] {
  if (!ring || ring.length < 3) return [];
  const clean: [number, number][] = [];
  for (const p of ring) {
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) clean.push([p[0], p[1]]);
  }
  if (clean.length < 3) return [];
  if (clean.length <= 500) return clean;
  const first = clean[0];
  const last = clean[clean.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  const open = closed ? clean.slice(0, clean.length - 1) : clean;
  // epsilon ~ 5 m in Grad: klein genug, um Korridore und Ringform zu erhalten.
  let simplified = rdpSimplify(open, 0.00005);
  if (simplified.length < 3) simplified = open;
  const out = closed ? [...simplified, simplified[0]] : simplified;
  return out.length >= 3 ? out : [];
}

// Vereinfacht eine Polygon-Gruppe ([Außenring, …Löcher]). Der Außenring muss
// gültig bleiben; ungültige Löcher werden verworfen. Gibt [] zurück, wenn der
// Außenring degeneriert.
export function simplifyRingGroup(group: [number, number][][]): [number, number][][] {
  if (!group || group.length === 0) return [];
  const outer = simplifyRing(group[0]);
  if (outer.length < 3) return [];
  const out: [number, number][][] = [outer];
  for (let i = 1; i < group.length; i++) {
    const hole = simplifyRing(group[i]);
    if (hole.length >= 3) out.push(hole);
  }
  return out;
}

// --- Glättung runder Konturen (Catmull-Rom mit Ecken-Erhalt) -----------------
//
// Kreisförmige Vektor-Geozonen (z. B. belgische CTR/RMZ um Flugplätze oder die
// runden Gefängnis-/Militärzonen) liegen im Quell-GeoJSON oft als grobe Polygone
// mit wenigen Stützpunkten vor und wirken dadurch eckig. smoothRing verdichtet
// solche Kreis-Approximationen per Catmull-Rom-Interpolation, lässt echte Vielecke
// (CTR/TMA/Häfen mit geraden Kanten und scharfen Ecken) aber komplett unverändert.
// Es verfälscht die Datengrundlage nicht – die Glättung dient nur der Darstellung.
//
// Klassifikation auf RING-Ebene statt pro Eckpunkt: ein einzelner Außenwinkel-
// Schwellwert kann einen groben Kreis-Stützpunkt (z. B. Siebeneck mit ~51°) nicht
// von einer echten, sanften Luftraum-Ecke (<62°) unterscheiden – er rundete echte
// Ecken und ließ grobe Kreise eckig. Die Rundheit (Isoperimetrie, 4*pi*A/U²) trennt
// beide sauber: 1.0 = Kreis, 0.785 = Quadrat, <0.6 = unregelmäßiges Vieleck.

// Sehr dichte runde Ringe (z. B. CTR mit 600 Stützpunkten) werden vor der
// Catmull-Rom-Glättung gleichmäßig nach Bogenlänge auf so viele Stützpunkte
// heruntergesampelt. Das entfernt die ungleichmäßige Facettierung, die die
// vorgelagerte RDP-Vereinfachung (simplifyRing) hinterlässt, und begrenzt die
// Arbeit – ohne den Ring (der danach wieder verdichtet wird) eckig zu machen.
const SMOOTH_RESAMPLE_TARGET = 96;
// Ziel-Auflösung (ungefähre Stützpunktzahl) eines geglätteten runden Rings. Höher
// als früher (war ~ceil(48/m)), damit auch grobe Sechs-/Achtecke sichtbar rund werden.
const SMOOTH_OUTPUT_RESOLUTION = 160;
// Rundheit (4*pi*A/U²) >= Schwelle -> als Kreis behandeln und glätten; darunter
// bleiben alle Stützpunkte exakt erhalten (echtes Vieleck, scharfe Ecken). Die
// Schwelle ist STÜTZPUNKT-ABHÄNGIG: grob gesampelte Kreise (wenige Punkte) haben
// systembedingt eine niedrigere Rundheit (Sehnen-Unterabtastung), daher dort
// toleranter. Empirisch an realen BE-Zonen kalibriert: die runden Gefängnis-/
// Stations-Zonen liegen ab ~0.74 (RUISELEDE 0.742, 6 Punkte = unterster Fall),
// echte Vielecke (Häfen 0.27, Übungsgebiete 0.10–0.74-) darunter. Dichte Ringe
// fordern die strengere 0.85, um echte sektorierte CTR (z. B. EBAW VLL2 0.726/191P)
// scharf zu lassen, während echte Großkreise (EBBR VLL2 0.986/601P) geglättet werden.
const SMOOTH_CIRCULARITY_MIN_FEW = 0.74;
const SMOOTH_CIRCULARITY_MIN_DENSE = 0.85;
const SMOOTH_FEW_VERTICES = 12;
const SMOOTH_DENSE_VERTICES = 28;

function circularityThreshold(m: number): number {
  if (m <= SMOOTH_FEW_VERTICES) return SMOOTH_CIRCULARITY_MIN_FEW;
  if (m >= SMOOTH_DENSE_VERTICES) return SMOOTH_CIRCULARITY_MIN_DENSE;
  const t = (m - SMOOTH_FEW_VERTICES) / (SMOOTH_DENSE_VERTICES - SMOOTH_FEW_VERTICES);
  return SMOOTH_CIRCULARITY_MIN_FEW + t * (SMOOTH_CIRCULARITY_MIN_DENSE - SMOOTH_CIRCULARITY_MIN_FEW);
}

// Verteilt `target` Stützpunkte gleichmäßig nach Bogenlänge entlang des
// geschlossenen Polygonzugs `open` (ohne Schluss-Duplikat). Glättet die
// ungleichmäßige Punktverteilung dichter/RDP-vereinfachter Ringe.
function resampleUniform(open: [number, number][], target: number): [number, number][] {
  const n = open.length;
  if (n < 3 || target < 3) return open.slice();
  const cum: number[] = [0];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = open[i];
    const b = open[(i + 1) % n];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cum.push(total);
  }
  if (total === 0) return open.slice();
  const out: [number, number][] = [];
  let seg = 0;
  for (let k = 0; k < target; k++) {
    const dist = (k / target) * total;
    while (seg < n && cum[seg + 1] < dist) seg++;
    if (seg >= n) seg = n - 1;
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const f = (dist - cum[seg]) / segLen;
    const a = open[seg];
    const b = open[(seg + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

function catmullRom(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const out: [number, number] = [0, 0];
  for (let d = 0; d < 2; d++) {
    const m1 = (p2[d] - p0[d]) * 0.5;
    const m2 = (p3[d] - p1[d]) * 0.5;
    out[d] = h00 * p1[d] + h10 * m1 + h01 * p2[d] + h11 * m2;
  }
  return out;
}

// Glättet einen einzelnen (geschlossenen) Ring. `lonIndex` gibt an, welche
// Koordinate der Längengrad ist (0 für GeoJSON [lng, lat], 1 für [lat, lng] wie
// in der nativen Leaflet-Brücke). Der Längengrad wird für die Winkelmessung mit
// cos(lat) auf Bodenmaß skaliert, damit schräge echte 90°-Ecken nicht
// fälschlich als sanfte Kurve geglättet werden.
export function smoothRing(
  ring: [number, number][],
  lonIndex: 0 | 1 = 1,
): [number, number][] {
  if (!ring || ring.length < 4) return ring ? [...ring] : [];
  const clean: [number, number][] = [];
  for (const p of ring) {
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) clean.push([p[0], p[1]]);
  }
  if (clean.length < 4) return clean;
  const first = clean[0];
  const last = clean[clean.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  // Offene, eindeutige Punktliste (keine aufeinanderfolgenden Duplikate).
  const src = closed ? clean.slice(0, clean.length - 1) : clean;
  const open: [number, number][] = [];
  for (const p of src) {
    const prev = open[open.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) open.push(p);
  }
  const m = open.length;
  // Zu wenige Punkte (Dreieck/Viereck): von echten Vielecken nicht unterscheidbar
  // -> unverändert. Dichte Ringe werden NICHT mehr pauschal übersprungen; ihre
  // Rundheit entscheidet (echte sektorierte CTR bleiben über die Schwelle scharf,
  // echte Großkreise werden unten gleichmäßig resampelt und geglättet).
  if (m < 5) return [...clean];

  const latIndex = lonIndex === 0 ? 1 : 0;
  let latSum = 0;
  for (const p of open) latSum += p[latIndex];
  const meanLat = latSum / m;
  // Längengrad auf Bodenmaß skalieren, sonst wirkt ein echter Kreis in rohen
  // Grad in Lon gestaucht (elliptisch) und die Rundheit fällt fälschlich.
  const scaleLon = Math.max(0.1, Math.cos((meanLat * Math.PI) / 180));

  // Rundheit (Isoperimetrie) auf bodenskalierten Koordinaten: 4*pi*A/U².
  let area2 = 0;
  let perimeter = 0;
  for (let i = 0; i < m; i++) {
    const a = open[i];
    const b = open[(i + 1) % m];
    const ax = lonIndex === 0 ? a[0] * scaleLon : a[0];
    const ay = lonIndex === 1 ? a[1] * scaleLon : a[1];
    const bx = lonIndex === 0 ? b[0] * scaleLon : b[0];
    const by = lonIndex === 1 ? b[1] * scaleLon : b[1];
    area2 += ax * by - bx * ay;
    perimeter += Math.hypot(bx - ax, by - ay);
  }
  const area = Math.abs(area2) / 2;
  const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
  // Echtes Vieleck (gerade Kanten, scharfe Ecken) -> unverändert lassen. Schwelle
  // ist stützpunkt-abhängig (wenige Punkte = toleranter, s. circularityThreshold).
  if (circularity < circularityThreshold(m)) return [...clean];

  // Kreis-Approximation: Stützpunkte gleichmäßig verteilen, dann verdichten.
  // Dichte/RDP-vereinfachte Ringe vorher nach Bogenlänge resamplen, damit ihre
  // ungleichmäßige Facettierung verschwindet (sonst bleibt ein großer Kreis eckig).
  const base = m > SMOOTH_RESAMPLE_TARGET ? resampleUniform(open, SMOOTH_RESAMPLE_TARGET) : open;
  const n = base.length;
  // Genug Unterteilungen pro Kante, damit auch ein grobes Sieben-/Achteck rund wirkt.
  let sub = Math.round(SMOOTH_OUTPUT_RESOLUTION / n);
  if (sub < 2) sub = 2;
  if (sub > 24) sub = 24;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = base[(i - 1 + n) % n];
    const p1 = base[i];
    const p2 = base[(i + 1) % n];
    const p3 = base[(i + 2) % n];
    out.push([p1[0], p1[1]]);
    for (let s = 1; s <= sub; s++) {
      out.push(catmullRom(p0, p1, p2, p3, s / (sub + 1)));
    }
  }
  if (out.length < 3) return [...clean];
  out.push([out[0][0], out[0][1]]); // Ring schließen
  return out;
}

// Glättet eine Polygon-Gruppe ([Außenring, …Löcher]). Jeder Ring (auch Löcher)
// wird einzeln geglättet, damit Donut-Löcher ihre runde Form behalten. Gibt []
// zurück, wenn der Außenring degeneriert.
// Ergebnis-Cache je Eingabe-Gruppe (Identität): Screens rendern dieselben
// Zonen bei jeder State-Änderung (z. B. Abhaken einer Bestätigung) neu – die
// Glättung (Resampling + Catmull-Rom) ist pro Ring teuer und lief dann jedes
// Mal erneut. Zonendaten sind unveränderlich; als Schutz gegen nachträglich
// veränderte Arrays werden Ringanzahl und Länge des Außenrings mitgeprüft.
// Das Ergebnis ist nur lesend zu verwenden.
type SmoothCacheEntry = { groupLen: number; outerLen: number; result: [number, number][][] };
const smoothCache: [WeakMap<object, SmoothCacheEntry>, WeakMap<object, SmoothCacheEntry>] = [
  new WeakMap(),
  new WeakMap(),
];

export function smoothRingGroup(
  group: [number, number][][],
  lonIndex: 0 | 1 = 1,
): [number, number][][] {
  if (!group || group.length === 0) return [];
  const cache = smoothCache[lonIndex];
  const hit = cache.get(group);
  const outerLen = group[0]?.length ?? 0;
  if (hit && hit.groupLen === group.length && hit.outerLen === outerLen) return hit.result;
  const result = smoothRingGroupUncached(group, lonIndex);
  cache.set(group, { groupLen: group.length, outerLen, result });
  return result;
}

function smoothRingGroupUncached(
  group: [number, number][][],
  lonIndex: 0 | 1,
): [number, number][][] {
  const outer = smoothRing(group[0], lonIndex);
  if (outer.length < 3) return [];
  const out: [number, number][][] = [outer];
  for (let i = 1; i < group.length; i++) {
    const hole = smoothRing(group[i], lonIndex);
    if (hole.length >= 3) out.push(hole);
  }
  return out;
}
