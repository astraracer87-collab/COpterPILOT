#!/usr/bin/env node
// Wandelt die offizielle Bundeswehr/Luftwaffe-KML der 7 Tieffluggebiete
// (LFA, 250 ft AGL — LFA 4 nicht vergeben, LFA 8 in Sektoren a–d unterteilt)
// aus data/lfa-de.kml in eine GeoJSON-FeatureCollection um.
//
// Quelle: Bundeswehr/Luftwaffe — "LFA vereinfacht" (KML, ETRS89/WGS84).
// Diese Daten sind die kanonischen Polygone, die auch in der offiziellen
// Bekanntmachung der Luftwaffe (PDF) abgebildet sind.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../data/lfa-de.kml");
// Spiegelkopie für die Mobile-App (Metro-Bundler bündelt JSON-Imports).
const OUT_CLIENT = path.resolve(__dirname, "../client/data/lfa-de.json");

function extractPlacemarks(xml) {
  const out = [];
  const pmRe = /<Placemark\b[\s\S]*?<\/Placemark>/g;
  let m;
  while ((m = pmRe.exec(xml))) {
    const block = m[0];
    const nameMatch = block.match(/<name>\s*([\s\S]*?)\s*<\/name>/);
    const ringMatches = [...block.matchAll(/<outerBoundaryIs>\s*<LinearRing>\s*<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/g)];
    if (!nameMatch || ringMatches.length === 0) continue;
    out.push({
      name: nameMatch[1].trim(),
      rings: ringMatches.map((r) => parseCoords(r[1])),
    });
  }
  return out;
}

function parseCoords(raw) {
  // KML-Koordinaten: "lon,lat[,alt] lon,lat[,alt] ..."
  const ring = [];
  for (const tok of raw.trim().split(/\s+/)) {
    const parts = tok.split(",");
    if (parts.length < 2) continue;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) ring.push([lon, lat]);
  }
  // Polygon schließen
  if (ring.length >= 3) {
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  }
  return ring;
}

function bboxOf(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

const LFA_NAMES = {
  "1": "Niedersachsen / Emsland",
  "2": "Niederrhein",
  "3": "Sauerland / Nordhessen",
  "5": "Nordheide",
  "6": "Schleswig-Holstein",
  "7": "Bayern (Hohenfels-Umfeld)",
};

function lfaIdFromName(name) {
  // "LFA 8 - Sector a"  →  { id: "8a", base: "8", sector: "a" }
  // "LFA 6"            →  { id: "6",  base: "6", sector: null }
  const sm = name.match(/LFA\s+8\s*[-–]\s*Sector\s*([a-d])/i);
  if (sm) return { id: `8${sm[1].toLowerCase()}`, base: "8", sector: sm[1].toLowerCase() };
  const m = name.match(/LFA\s+(\d+)/i);
  if (!m) return null;
  return { id: m[1], base: m[1], sector: null };
}

function build() {
  const xml = fs.readFileSync(SRC, "utf8");
  const placemarks = extractPlacemarks(xml);
  const features = [];
  for (const pm of placemarks) {
    const meta = lfaIdFromName(pm.name);
    if (!meta) continue;
    for (const ring of pm.rings) {
      if (ring.length < 4) continue;
      const displayName =
        meta.sector
          ? `LFA 8${meta.sector} „Mecklenburg-Vorpommern"`
          : `LFA ${meta.base} „${LFA_NAMES[meta.base] ?? ""}"`;
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        bbox: bboxOf(ring),
        properties: {
          _country: "de",
          _source: "bundeswehr-luftwaffe-kml",
          _kind: "lfa",
          id: `LFA-${meta.id}`,
          lfa: meta.id,
          name: displayName,
          altitudeFt: 250,
          description: "Tieffluggebiet 250 ft AGL — Bundeswehr-Tiefflug",
        },
      });
    }
  }

  const fc = {
    type: "FeatureCollection",
    metadata: {
      source: "Bundeswehr/Luftwaffe — LFA vereinfacht (KML)",
      altitudeFt: 250,
      generatedAt: new Date().toISOString(),
    },
    features,
  };

  // Guardrails — bei einer Quell-Änderung lieber laut scheitern als
  // stillschweigend leere oder verzerrte Polygone ausliefern.
  const EXPECTED_IDS = ["LFA-1","LFA-2","LFA-3","LFA-5","LFA-6","LFA-7","LFA-8a","LFA-8b","LFA-8c","LFA-8d"];
  // Aus der KML stammen detaillierte Kurven mit hoher Punktdichte für die
  // 6 Hauptgebiete; LFA-8-Sektoren sind echte 4-Eck-Polygone.
  const MIN_VERTICES = { "LFA-1": 50, "LFA-2": 30, "LFA-3": 50, "LFA-5": 50, "LFA-6": 50, "LFA-7": 50, "LFA-8a": 4, "LFA-8b": 4, "LFA-8c": 4, "LFA-8d": 4 };
  const SANE_BOX = [5.5, 47.0, 15.5, 55.5]; // DE Festland
  const errors = [];
  const gotIds = features.map((f) => f.properties.id);
  for (const id of EXPECTED_IDS) {
    if (!gotIds.includes(id)) errors.push(`fehlt: ${id}`);
  }
  for (const f of features) {
    const id = f.properties.id;
    const ring = f.geometry.coordinates[0];
    const min = MIN_VERTICES[id];
    if (min && ring.length < min) errors.push(`${id}: nur ${ring.length} Vertices (<${min})`);
    if (ring.length < 4) errors.push(`${id}: Ring zu klein (${ring.length})`);
    const [w, s, e, n] = f.bbox;
    if (w < SANE_BOX[0] || s < SANE_BOX[1] || e > SANE_BOX[2] || n > SANE_BOX[3]) {
      errors.push(`${id}: bbox außerhalb DE [${f.bbox.map((x) => x.toFixed(2)).join(",")}]`);
    }
    if (e - w < 0.05 || n - s < 0.05) errors.push(`${id}: bbox degeneriert`);
  }
  if (errors.length) {
    console.error("LFA-Validierung fehlgeschlagen:");
    for (const e of errors) console.error("  -", e);
    process.exit(1);
  }
  const json = JSON.stringify(fc, null, 2);
  fs.mkdirSync(path.dirname(OUT_CLIENT), { recursive: true });
  fs.writeFileSync(OUT_CLIENT, json);
  console.log(`OK: ${features.length} LFA-Polygone aus KML (server + client gespiegelt)`);
  for (const f of features) {
    console.log(`  ${f.properties.id}: ${f.geometry.coordinates[0].length} Punkte, bbox=${f.bbox.map((n) => n.toFixed(2)).join(",")}`);
  }
}

build();
