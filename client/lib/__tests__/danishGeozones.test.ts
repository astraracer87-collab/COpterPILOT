import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DANISH_GEOZONE_SOURCE_LABEL,
  groupDanishBufferRings,
} from "../../../shared/danishGeozones";

const DK = DANISH_GEOZONE_SOURCE_LABEL;

function ring(opts: {
  name: string;
  icao?: string;
  restriction?: string;
  puffer: string;
  typ?: string;
}) {
  const lines = [`Beschränkung: ${opts.restriction ?? "Verboten"}`, "Höhe: GND – unbegrenzt"];
  if (opts.typ) lines.push(`Typ: ${opts.typ}`);
  lines.push(`Pufferradius: ${opts.puffer}`);
  if (opts.icao) lines.push(`ICAO: ${opts.icao}`);
  lines.push("Kategorie: Dauerhaft");
  return { layerLabel: DK, name: opts.name, details: lines.join("\n") };
}

test("groups concentric DK rings of the same facility into one entry", () => {
  const items = [
    ring({ name: "EKRH - Rigshospitalet HEMS", icao: "EKRH", puffer: "1 km" }),
    ring({ name: "EKRH - Rigshospitalet HEMS", icao: "EKRH", puffer: "5 km" }),
    ring({ name: "EKRH - Rigshospitalet HEMS", icao: "EKRH", puffer: "10 km" }),
  ];
  const out = groupDanishBufferRings(items);
  assert.equal(out.length, 1);
  assert.match(out[0].details, /Pufferradius: 1 km – 10 km/);
});

test("keeps the outermost ring as base", () => {
  const items = [
    ring({ name: "EKCH - Kastrup", icao: "EKCH", puffer: "2 km" }),
    ring({ name: "EKCH - Kastrup", icao: "EKCH", puffer: "5 km" }),
  ];
  const out = groupDanishBufferRings(items);
  assert.equal(out.length, 1);
  assert.match(out[0].details, /Pufferradius: 2 km – 5 km/);
});

test("metres-only rings format without km", () => {
  const items = [
    ring({ name: "Some Embassy", icao: "", restriction: "Genehmigung erforderlich", puffer: "150 m" }),
    ring({ name: "Some Embassy", icao: "", restriction: "Genehmigung erforderlich", puffer: "300 m" }),
  ];
  const out = groupDanishBufferRings(items);
  assert.equal(out.length, 1);
  assert.match(out[0].details, /Pufferradius: 150 m – 300 m/);
});

test("different facilities are NOT merged", () => {
  const items = [
    ring({ name: "EKRH", icao: "EKRH", puffer: "1 km" }),
    ring({ name: "EKCH", icao: "EKCH", puffer: "2 km" }),
  ];
  const out = groupDanishBufferRings(items);
  assert.equal(out.length, 2);
});

test("different restrictions of the same facility stay separate", () => {
  const items = [
    ring({ name: "EKXX", icao: "EKXX", restriction: "Verboten", puffer: "1 km" }),
    ring({ name: "EKXX", icao: "EKXX", restriction: "Keine Beschränkung", puffer: "10 km" }),
  ];
  const out = groupDanishBufferRings(items);
  assert.equal(out.length, 2);
});

test("non-DK zones pass through unchanged and keep order", () => {
  const de = { layerLabel: "dipul Geozonen", name: "ED-R 4", details: "Beschränkung: Verboten" };
  const items = [
    de,
    ring({ name: "EKRH", icao: "EKRH", puffer: "1 km" }),
    ring({ name: "EKRH", icao: "EKRH", puffer: "10 km" }),
  ];
  const out = groupDanishBufferRings(items);
  assert.equal(out.length, 2);
  assert.equal(out[0], de);
  assert.match(out[1].details, /Pufferradius: 1 km – 10 km/);
});

test("single ring is left untouched", () => {
  const items = [ring({ name: "EKRH", icao: "EKRH", puffer: "3 km" })];
  const out = groupDanishBufferRings(items);
  assert.equal(out.length, 1);
  assert.match(out[0].details, /Pufferradius: 3 km(\n|$)/);
});

test("preserves extra fields on the base object (e.g. polygonRings)", () => {
  const a = { ...ring({ name: "EKRH", icao: "EKRH", puffer: "1 km" }), polygonRings: [[[1, 2]]] };
  const b = { ...ring({ name: "EKRH", icao: "EKRH", puffer: "10 km" }), polygonRings: [[[3, 4]]] };
  const out = groupDanishBufferRings([a, b]);
  assert.equal(out.length, 1);
  // base = outermost (10 km) ring -> its polygon survives
  assert.deepEqual((out[0] as any).polygonRings, [[[3, 4]]]);
});
