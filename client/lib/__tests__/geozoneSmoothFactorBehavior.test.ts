import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Verhaltensbasierter Regressionstest für Task #563 (Folge von #559/#560).
//
// Der bestehende Wächter (radarGeozoneSmoothFactor.test.ts) ist ein reiner
// Quelltext-Check: Er greppt TrafficMapView.native.tsx nach `smoothFactor: 0` auf
// den zwei BEKANNTEN Layern (hzLayer, vzLayer). Wenn jemand später einen NEUEN
// Geozonen-Polygon-Layer (oder eine andere Karten-Oberfläche, die Ringe zeichnet)
// hinzufügt und `smoothFactor: 0` vergisst, bleibt jener Regex-Test grün, während
// runde Zonen (BE-skeyes Modellflug-/Militärkreise) wieder als facettierte ~12-Ecke
// erscheinen.
//
// Dieser Test hat zwei Teile:
//  1. VERHALTEN: Er füttert ECHTE runde + eckige BE-Geometrie aus
//     fixtures/be-skeyes-round-angular-sample.json (Auszug aus dem belgischen
//     Datensatz) durch Leaflets ECHTES LineUtil.simplify – aus genau dem
//     Leaflet-Bundle, das die App in ihre WebView-Karten einbettet
//     (client/lib/leafletBundle.ts, Leaflet 1.9.4). Dieselbe Funktion ruft
//     Leaflet beim Zeichnen eines Polygons im Bildschirmraum auf. Beim Default-smoothFactor (1.0) kollabiert die runde 722-Punkt-
//     Kontur zu einem groben Vieleck; bei smoothFactor:0 bleiben ALLE Stützpunkte
//     erhalten. Das beweist, dass der Fehler real ist UND dass die Testgeometrie ihn
//     tatsächlich auslöst.
//  2. RENDER-PFAD-WÄCHTER: Er durchsucht ALLE Karten-Oberflächen (WebView-Leaflet) nach
//     Geozonen-Polygon-/geoJSON-Aufrufen und verlangt für jeden smoothFactor:0 —
//     unabhängig vom Layer/der Oberfläche. Ein neuer Geozonen-Layer ohne
//     smoothFactor:0 lässt diesen Test fehlschlagen.

// ---------------------------------------------------------------------------
// Leaflet braucht beim Import DOM-Globals (window/document/navigator). Wir
// stubben ein Minimal-DOM, BEVOR Leaflet geladen wird (dynamischer Import nach
// dem Setzen der Globals). LineUtil.simplify + CRS.latLngToPoint sind reine
// Mathematik und brauchen kein echtes DOM.
// ---------------------------------------------------------------------------
(globalThis as any).window = { devicePixelRatio: 1 };
(globalThis as any).document = {
  documentElement: { style: {} },
  createElement: () => ({
    style: {},
    getContext: () => null,
    setAttribute() {},
    appendChild() {},
  }),
};
try {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "node", platform: "node" },
    configurable: true,
  });
} catch {
  // navigator existiert in neueren Node-Versionen bereits read-only -> egal,
  // Leaflet liest daraus nur den userAgent für Browser-Feature-Detection.
}

// Leaflet wird erst HIER geladen, nachdem die DOM-Globals oben gesetzt sind.
// Quelle ist das in der App eingebettete Bundle (kein npm-Paket `leaflet`); der
// UMD-Wrapper erkennt `exports`/`module` und exportiert dorthin.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LEAFLET_JS } = require("../leafletBundle") as { LEAFLET_JS: string };
const leafletModule: { exports: any } = { exports: {} };
new Function("exports", "module", LEAFLET_JS)(leafletModule.exports, leafletModule);
const L: any = leafletModule.exports;
const LineUtil = L.LineUtil;
const CRS = L.CRS.EPSG3857;

const repoRoot = path.join(__dirname, "..", "..", "..");

type Ring = number[][]; // [[lng, lat], ...]

function readBelgianFeatures(): any[] {
  const raw = fs.readFileSync(
    path.join(__dirname, "fixtures", "be-skeyes-round-angular-sample.json"),
    "utf8",
  );
  const fc = JSON.parse(raw);
  return Array.isArray(fc) ? fc : fc.features || [];
}

function outerRing(feat: any): Ring | null {
  const g = feat?.geometry;
  if (!g) return null;
  if (g.type === "Polygon") return g.coordinates[0];
  if (g.type === "MultiPolygon") return g.coordinates[0][0];
  return null;
}

// Kreisförmigkeit (Isoperimetrie): 4πA / U². 1.0 = perfekter Kreis, ->0 = sehr
// eckig/zerklüftet. Planar via Äquirektangular-Projektion an mittlerer Breite.
function circularity(ring: Ring): number {
  const lat0 =
    (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  const k = Math.cos(lat0);
  const xy = ring.map((p) => [p[0] * k, p[1]]);
  let area2 = 0;
  let perim = 0;
  for (let i = 0; i < xy.length - 1; i++) {
    const a = xy[i];
    const b = xy[i + 1];
    area2 += a[0] * b[1] - b[0] * a[1];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const area = Math.abs(area2) / 2;
  if (perim === 0) return 0;
  return (4 * Math.PI * area) / (perim * perim);
}

// Zählt "echte Ecken" eines Rings: Stützpunkte, an denen der Richtungswechsel
// einen Schwellwert überschreitet. Ein Kreis hat viele kleine Wendungen (keine
// scharfen Ecken), ein eckiges Polygon wenige große.
function sharpCorners(ring: Ring, thresholdDeg = 25): number {
  const lat0 =
    (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  const k = Math.cos(lat0);
  const pts = ring.map((p) => [p[0] * k, p[1]]);
  const n = pts.length - 1; // letzter == erster
  let corners = 0;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const v1x = cur[0] - prev[0];
    const v1y = cur[1] - prev[1];
    const v2x = next[0] - cur[0];
    const v2y = next[1] - cur[1];
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    if (m1 === 0 || m2 === 0) continue;
    let cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
    cos = Math.max(-1, Math.min(1, cos));
    const turnDeg = (Math.acos(cos) * 180) / Math.PI;
    if (turnDeg >= thresholdDeg) corners++;
  }
  return corners;
}

// Projiziert einen Ring nach Leaflets Bildschirm-Pixelraum (wie Leaflet es vor
// dem Vereinfachen tut) und gibt die Punktzahl nach LineUtil.simplify(tol) zurück.
function simplifiedVertexCount(ring: Ring, tolerance: number, zoom: number): number {
  const pts = ring.map(([lng, lat]) => CRS.latLngToPoint(L.latLng(lat, lng), zoom));
  return LineUtil.simplify(pts, tolerance).length;
}

// ---------------------------------------------------------------------------
// Testgeometrie: eine ECHTE runde Zone und eine ECHTE eckige Zone aus dem
// belgischen Datensatz. Wir suchen sie programmatisch (statt Codes hart zu
// verdrahten), damit der Test auch nach einem Daten-Refresh sinnvoll bleibt.
// ---------------------------------------------------------------------------
const features = readBelgianFeatures();
const candidates = features
  .map((f) => {
    const ring = outerRing(f);
    return ring ? { ring, c: circularity(ring), len: ring.length } : null;
  })
  .filter((x): x is { ring: Ring; c: number; len: number } => x != null);

// Rundeste Zone mit vielen Stützpunkten (densifizierter Kreis -> anfällig fürs
// Facettieren).
const roundZone = candidates
  .filter((x) => x.len >= 100)
  .sort((a, b) => b.c - a.c)[0];

// Klar eckige Zone mit genügend Stützpunkten, um Ecken erkennen zu können.
const angularZone = candidates
  .filter((x) => x.len >= 8 && x.c < 0.4)
  .sort((a, b) => a.c - b.c)[0];

// Leaflet-Default-smoothFactor ist 1.0 (siehe Polyline-Defaultoptionen). Genau
// diesen Wert übergibt Leaflet als Toleranz an LineUtil.simplify, wenn ein Render-
// Pfad smoothFactor NICHT auf 0 setzt.
const DEFAULT_SMOOTH_FACTOR = 1.0;
const ZOOMS = [11, 13, 15]; // typische Radar-/Planungs-Zoomstufen

test("Testdaten enthalten eine echte runde und eine echte eckige BE-Zone", () => {
  assert.ok(
    roundZone,
    "Fixture sollte mind. eine runde Zone (>=100 Punkte) enthalten",
  );
  assert.ok(
    angularZone,
    "Fixture sollte mind. eine eckige Zone (Kreisförmigkeit < 0.4) enthalten",
  );
  assert.ok(
    roundZone.c > 0.95,
    `runde Test-Zone sollte nahezu kreisförmig sein (ist ${roundZone.c.toFixed(4)})`,
  );
});

test("Default-smoothFactor (1.0) facettiert runde Zonen -> Fehler ist real", () => {
  // Sanity: Wäre smoothFactor:0 wirkungslos, müsste auch der Default die Punkte
  // behalten. Wir verlangen, dass der Default die runde Kontur deutlich kollabiert
  // (< 50 % der Stützpunkte), sonst testet der nachfolgende smoothFactor:0-Beweis
  // nichts.
  for (const zoom of ZOOMS) {
    const kept = simplifiedVertexCount(roundZone.ring, DEFAULT_SMOOTH_FACTOR, zoom);
    assert.ok(
      kept < roundZone.len * 0.5,
      `Zoom ${zoom}: Default-smoothFactor sollte die runde ${roundZone.len}-Punkt-Zone ` +
        `kollabieren, behielt aber ${kept} Punkte (Fehler nicht reproduziert)`,
    );
  }
});

test("smoothFactor:0 bewahrt ALLE Stützpunkte runder Zonen (kein Facettieren)", () => {
  for (const zoom of ZOOMS) {
    const kept = simplifiedVertexCount(roundZone.ring, 0, zoom);
    assert.equal(
      kept,
      roundZone.len,
      `Zoom ${zoom}: smoothFactor:0 muss alle ${roundZone.len} Punkte der runden ` +
        `Zone behalten, behielt aber nur ${kept}`,
    );
  }
});

test("eckige Zonen behalten ihre Ecken (smoothFactor:0 verschluckt keine Korrektur)", () => {
  const originalCorners = sharpCorners(angularZone.ring);
  assert.ok(
    originalCorners >= 3,
    `eckige Test-Zone sollte erkennbare Ecken haben (hat ${originalCorners})`,
  );
  for (const zoom of ZOOMS) {
    const kept = simplifiedVertexCount(angularZone.ring, 0, zoom);
    // smoothFactor:0 vereinfacht gar nicht -> alle Punkte (inkl. aller Ecken) bleiben.
    assert.equal(
      kept,
      angularZone.ring.length,
      `Zoom ${zoom}: smoothFactor:0 sollte die eckige Zone unverändert lassen`,
    );
  }
});

// ---------------------------------------------------------------------------
// RENDER-PFAD-WÄCHTER: Jede Karten-Oberfläche, die Geozonen-Polygone zeichnet,
// muss smoothFactor:0 setzen — egal welcher Layer. Wir entdecken die Aufrufe
// automatisch (L.polygon / L.geoJSON), statt nur zwei bekannte Layer zu greppen.
// ---------------------------------------------------------------------------

// Leaflet-Kartenoberflächen, die Geozonen/Beschränkungen als Polygone zeichnen.
// (Die Web-App der Replit-Fassung – web/src/… – gehört nicht zu diesem Repo.)
const MAP_SURFACES = [
  "client/components/TrafficMapView.native.tsx",
  "client/components/MapPicker/MapPicker.native.tsx",
];

// Layer, die bewusst KEINE Geozonen zeichnen (TCAS-Ringe + Sichtfeld-Kegel).
// Dort ist smoothFactor:0 nicht erforderlich; Polygone, die an diese Layer
// gehängt werden, sind vom Wächter ausgenommen. Ein NEUER Geozonen-Layer taucht
// hier NICHT auf und muss daher smoothFactor:0 setzen.
const NON_GEOZONE_LAYERS = ["ringLayer"];

// Findet die Position aller Vorkommen von `needle` in `src`.
function allIndexes(src: string, needle: string): number[] {
  const out: number[] = [];
  let i = src.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = src.indexOf(needle, i + 1);
  }
  return out;
}

// Liest ab `openParenIdx` (Index der öffnenden Klammer eines Aufrufs) den
// vollständigen, klammer-balancierten Argument-Text bis zur passenden
// schließenden Klammer. Berücksichtigt Strings und verschachtelte Klammern.
function readBalancedArgs(src: string, openParenIdx: number): { args: string; end: number } {
  let depth = 0;
  let i = openParenIdx;
  let inStr: string | null = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0 && ch === ")") {
        return { args: src.slice(openParenIdx + 1, i), end: i };
      }
    }
  }
  return { args: src.slice(openParenIdx + 1), end: src.length };
}

// Prüft, ob smoothFactor:0 für einen Aufruf erreichbar ist: entweder direkt im
// Argument-Text, oder über eine Options-/Style-Variable, die im File mit
// smoothFactor:0 definiert ist.
function smoothFactorZeroReachable(callArgs: string, fileSrc: string): boolean {
  if (/smoothFactor\s*:\s*0\b/.test(callArgs)) return true;
  // Bezeichner im Argument-Text (z.B. `style`, `opts`) -> Definition mit
  // smoothFactor:0 suchen.
  const idents = new Set(callArgs.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []);
  for (const id of idents) {
    const defRe = new RegExp(
      `(?:const|let|var)\\s+${id}\\s*=\\s*\\{[^}]*smoothFactor\\s*:\\s*0\\b`,
    );
    if (defRe.test(fileSrc)) return true;
  }
  return false;
}

// Ermittelt das Statement-Ende (Karten-Anhängung) nach dem Aufruf, um den
// Ziel-Layer (.addTo(X)) zu erkennen.
function trailingContext(src: string, endIdx: number): string {
  // endIdx zeigt auf die schließende `)` des Aufrufs -> ab dem Folgezeichen lesen,
  // damit z.B. `.getBounds()` direkt am Anfang des Kontexts steht.
  return src.slice(endIdx + 1, Math.min(src.length, endIdx + 201));
}

type RenderCall = {
  file: string;
  kind: "L.polygon" | "L.geoJSON";
  args: string;
  trailing: string;
  line: number;
};

function collectRenderCalls(file: string, src: string): RenderCall[] {
  const calls: RenderCall[] = [];
  for (const kind of ["L.polygon", "L.geoJSON"] as const) {
    for (const idx of allIndexes(src, kind + "(")) {
      const openParen = idx + kind.length;
      const { args, end } = readBalancedArgs(src, openParen);
      const trailing = trailingContext(src, end);
      const line = src.slice(0, idx).split("\n").length;
      calls.push({ file, kind, args, trailing, line });
    }
  }
  return calls;
}

test("jeder Geozonen-Polygon-Render-Pfad setzt smoothFactor:0 (auto-entdeckt)", () => {
  let checked = 0;
  for (const rel of MAP_SURFACES) {
    const abs = path.join(repoRoot, rel);
    const src = fs.readFileSync(abs, "utf8");
    const calls = collectRenderCalls(rel, src);
    assert.ok(
      calls.length > 0,
      `${rel}: erwartet mind. einen L.polygon/L.geoJSON-Aufruf (Pfad/Patterns geändert?)`,
    );
    for (const call of calls) {
      // Nicht gerenderte geoJSON-Aufrufe (nur Bounds-Berechnung) überspringen.
      if (/^\s*\.getBounds\s*\(/.test(call.trailing)) continue;
      // Bewusst geozonen-fremde Layer (Ringe/Sichtfeld) sind ausgenommen.
      const onNonGeozoneLayer = NON_GEOZONE_LAYERS.some((ly) =>
        new RegExp(`\\.addTo\\(\\s*${ly}\\b`).test(call.trailing),
      );
      if (onNonGeozoneLayer) continue;

      checked++;
      assert.ok(
        smoothFactorZeroReachable(call.args, src),
        `${call.file}:${call.line}: ${call.kind}(...) zeichnet Geozonen-Geometrie ohne ` +
          `erreichbares smoothFactor:0 -> runde Zonen würden facettiert. Setze smoothFactor:0 ` +
          `in den Optionen/Style (oder hänge den Aufruf an einen geozonen-fremden Layer ` +
          `wie ${NON_GEOZONE_LAYERS.join("/")}).`,
      );
    }
  }
  // TrafficMapView: markiert (hzLayer), NOTAM, Vektor (vzLayer); MapPicker: Vektor.
  assert.ok(checked >= 4, `erwartet >=4 geprüfte Geozonen-Render-Pfade, geprüft: ${checked}`);
});
