// AGL-Anreicherung im clientseitigen Verkehrs-Aggregator: gedrosselter
// Open-Meteo-Sammelabruf (enrichAircraftWithElevation, 15 s), Boden-Filter für
// rollende Flugzeuge, offline → AGL bleibt null.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  __awaitElevationEnrichmentForTests,
  __resetTrafficAggregatorForTests,
  getNearbyAircraft,
  setTrafficSourceEnabled,
} from "../traffic/aggregator";
import { clearElevationCache, FULL_ENRICH_INTERVAL_MS } from "../elevation";

const GROUND_M = 500;
const realFetch = globalThis.fetch;
const realNow = Date.now;
let now = 1_800_000_000_000;

// Rollendes Flugzeug: 1700 ft MSL (518 m) über 500 m Gelände = 18 m AGL, 20 kt.
const TAXI = { hex: "aaaaaa", flight: "TAXI1", lat: 48.6, lon: 10.6, alt_baro: 1700, gs: 20, t: "C172" };
// Überflug: 5000 ft MSL (1524 m) → 1024 m AGL.
const OVER = { hex: "bbbbbb", flight: "OVER1", lat: 48.62, lon: 10.62, alt_baro: 5000, gs: 120, t: "A320" };

function install(opts: { offline?: boolean }, counters: { elevation: number; elevationCoords: number[] }): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("open-meteo")) {
      counters.elevation++;
      assert.ok(init?.signal, "Open-Meteo mit Timeout");
      if (opts.offline) throw new TypeError("Network request failed");
      const n = new URL(url).searchParams.get("latitude")!.split(",").length;
      counters.elevationCoords.push(n);
      return new Response(JSON.stringify({ elevation: Array.from({ length: n }, () => GROUND_M) }), { status: 200 });
    }
    if (url.includes("glidernet")) return new Response("<markers></markers>", { status: 200 });
    return new Response(JSON.stringify({ ac: [TAXI, OVER] }), { status: 200 });
  }) as typeof fetch;
}

// Laufende (nicht abgewartete) Quellen-Abfragen und die Anreicherung abschließen.
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  await __awaitElevationEnrichmentForTests();
}

beforeEach(() => {
  __resetTrafficAggregatorForTests();
  clearElevationCache();
  // FR24 hier nicht relevant (eigener Test) → aus, damit nur ADS-B/OGN laufen.
  setTrafficSourceEnabled("fr24", false);
  now = 1_800_000_000_000;
  Date.now = () => now;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

test("AGL: gedrosselte Sammelabfrage, Boden-Filter greift, Labels mit AGL", async () => {
  const c = { elevation: 0, elevationCoords: [] as number[] };
  install({}, c);

  // 1. Aufruf: Daten da, Geländehöhe noch unbekannt → wie bisher null, Taxi sichtbar
  const r1 = await getNearbyAircraft(48.6, 10.6, 25, 60);
  assert.ok(r1.aircraft.some((a) => a.icao24 === "aaaaaa"));
  assert.ok(r1.aircraft.every((a) => a.aglAltitude == null));
  await settle();
  assert.equal(c.elevation, 1, "ein Sammelabruf");
  assert.deepEqual(c.elevationCoords, [2], "beide Ziele in EINEM Abruf");

  // 2. Aufruf (2 s später): AGL aus dem Cache, rollendes Flugzeug ausgeblendet
  now += 2000;
  const r2 = await getNearbyAircraft(48.6, 10.6, 25, 60);
  await settle();
  assert.ok(!r2.aircraft.some((a) => a.icao24 === "aaaaaa"), "AGL 18 m + 10 m/s → Boden-Filter");
  const over = r2.aircraft.find((a) => a.icao24 === "bbbbbb")!;
  assert.equal(over.groundElevation, GROUND_M);
  assert.equal(over.aglAltitude, Math.round(5000 * 0.3048) - GROUND_M);
  assert.equal(c.elevation, 1, "innerhalb 15 s kein weiterer Abruf");

  // Weitere Aufrufe innerhalb des Intervalls: weiterhin kein Abruf
  for (let i = 0; i < 4; i++) {
    now += 2000;
    await getNearbyAircraft(48.6, 10.6, 25, 60);
    await settle();
  }
  assert.equal(c.elevation, 1);

  // Nach Ablauf des Intervalls: nächster Abruf nur, wenn neue Positionen nicht
  // im Cache sind – Ziele stehen still → Cache-Treffer, kein Abruf nötig
  now += FULL_ENRICH_INTERVAL_MS;
  await getNearbyAircraft(48.6, 10.6, 25, 60);
  await settle();
  assert.equal(c.elevation, 1, "gerundete Position im Cache → kein Abruf");

  // Ziel bewegt sich in eine neue Cache-Zelle → beim nächsten fälligen Lauf ein Abruf
  OVER.lat = 48.65;
  now += FULL_ENRICH_INTERVAL_MS;
  await getNearbyAircraft(48.6, 10.6, 25, 60); // neue Position wird gepollt
  await settle();
  now += 2000;
  await getNearbyAircraft(48.6, 10.6, 25, 60);
  await settle();
  OVER.lat = 48.62;
  assert.equal(c.elevation, 2, "genau ein weiterer Abruf");
  assert.deepEqual(c.elevationCoords, [2, 1], "nur die neue Position wird abgefragt");
});

test("AGL: offline → bleibt null, kein Boden-Filter, Abruf gedrosselt", async () => {
  const c = { elevation: 0, elevationCoords: [] as number[] };
  install({ offline: true }, c);
  const r1 = await getNearbyAircraft(48.6, 10.6, 25, 60);
  await settle();
  now += 2000;
  const r2 = await getNearbyAircraft(48.6, 10.6, 25, 60);
  await settle();
  for (const r of [r1, r2]) {
    assert.ok(r.aircraft.some((a) => a.icao24 === "aaaaaa"), "ohne AGL kein Ausblenden");
    assert.ok(r.aircraft.every((a) => a.aglAltitude == null && a.groundElevation == null));
  }
  assert.equal(c.elevation, 1, "fehlgeschlagener Abruf wird nicht im 2-s-Takt wiederholt");
  now += FULL_ENRICH_INTERVAL_MS + 1;
  await getNearbyAircraft(48.6, 10.6, 25, 60);
  await settle();
  assert.equal(c.elevation, 2, "nach 15 s neuer Versuch");
});
