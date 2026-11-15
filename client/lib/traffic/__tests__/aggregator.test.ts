import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { parseOgnLxml, parseAdsbResponse } from "../sources";
import { mergeByIcao } from "../merge";
import { getNearbyAircraft, getAggregatorStatus, __resetTrafficAggregatorForTests } from "../aggregator";

// Echtzeilen-Muster von live.glidernet.org/lxml.php.
const OGN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<markers>
<m a="48.843948,10.398550,ZC,D-AIZC,9425,19:03:33,9,137,861,6.2,9,Lengfeld,3C6743,5a8acb20"/>
<m a="48.424530,10.928800,IK,D-HDIK,473,19:03:18,24,71,80,2.5,3,EDMA,3DDB66,ebe6e1f3"/>
<m a="47.779751,12.948270,_e4,f704abe4,2350,19:03:12,30,244,222,-0.3,3,EDNK,0,f704abe4"/>
<m a="48.394669,12.726420,_93,5c56d893,422,18:56:19,443,198,0,0.0,8,edme1,0,5c56d893"/>
</markers>`;

test("parseOgnLxml: Felder, Einheiten, Alter-Filter, anonyme Geräte", () => {
  const states = parseOgnLxml(OGN_XML);
  assert.equal(states.length, 3, "Meldung mit 443 s Alter wird verworfen");
  const jet = states.find((s) => s.icao24 === "ogn_flr3c6743")!;
  assert.equal(jet.registration, "D-AIZC");
  assert.equal(jet.cn, "ZC");
  assert.equal(jet.baroAltitude, 9425);
  assert.equal(jet.category, "airplane");
  assert.ok(Math.abs((jet.velocity ?? 0) - 861 / 3.6) < 0.01);
  assert.equal(jet.reportAgeMs, 9000);
  const heli = states.find((s) => s.icao24 === "ogn_flr3ddb66")!;
  assert.equal(heli.category, "helicopter");
  const anon = states.find((s) => s.icao24 === "ogn_f704abe4")!;
  assert.equal(anon.registration, undefined);
  assert.equal(anon.cn, undefined);
});

test("parseAdsbResponse akzeptiert 'ac' (adsb.lol) und 'aircraft' (adsb.fi)", () => {
  const ac = { hex: "3C6743", flight: "DLH1 ", lat: 48.8, lon: 10.4, alt_baro: 30000, gs: 450, category: "A3", r: "D-AIZC", t: "A320" };
  assert.equal(parseAdsbResponse({ ac: [ac] }, "adsblol").length, 1);
  const fi = parseAdsbResponse({ aircraft: [ac] }, "adsbfi");
  assert.equal(fi.length, 1);
  assert.equal(fi[0].icao24, "3c6743");
  assert.equal(fi[0].baroAltitude, Math.round(30000 * 0.3048));
});

test("mergeByIcao verschmilzt OGN (ICAO-adressiert) mit ADS-B gleichen Hex", () => {
  const ogn = parseOgnLxml(OGN_XML);
  const adsb = parseAdsbResponse({ ac: [{ hex: "3c6743", flight: "DLH1", lat: 48.84, lon: 10.39, alt_baro: 30900, gs: 465 }] }, "adsblol");
  const { merged, droppedIds } = mergeByIcao([{ states: adsb }, { states: ogn }]);
  const m = merged.find((s) => s.icao24 === "3c6743")!;
  assert.ok(m, "Eintrag unter ICAO-Hex vorhanden");
  assert.deepEqual([...m.sources].sort(), ["adsblol", "ogn"]);
  assert.ok(!merged.some((s) => s.icao24 === "ogn_flr3c6743"));
  assert.ok(droppedIds.includes("ogn_flr3c6743"));
});

beforeEach(() => __resetTrafficAggregatorForTests());

test("getNearbyAircraft: fragt Quellen direkt ab, dedupliziert und liefert Status", async () => {
  const calls: string[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("glidernet")) return new Response(OGN_XML, { status: 200 });
    if (url.includes("airplanes.live")) return new Response("{}", { status: 429 });
    if (url.includes("flightradar24")) return new Response(JSON.stringify({ full_count: 1, version: 4 }), { status: 200 });
    if (url.includes("open-meteo")) return new Response("{}", { status: 500 });
    const body = { ac: [{ hex: "3c6743", flight: "DLH1", lat: 48.6, lon: 10.6, alt_baro: 30000, gs: 450 }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const res = await getNearbyAircraft(48.6, 10.6, 50, 60);
    assert.ok(calls.some((u) => u.startsWith("https://api.adsb.lol/v2/point/48.6000/10.6000/")));
    assert.ok(calls.some((u) => u.startsWith("https://live.glidernet.org/lxml.php?a=0&b=")));
    assert.ok(!calls.some((u) => u.includes("opensky")));
    // FR24 ist seit 2026-11-15 Zusatzquelle (docs/air-traffic-quellen.md §4).
    assert.ok(calls.some((u) => u.startsWith("https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=")));
    const ids = res.aircraft.map((a) => a.icao24);
    assert.equal(new Set(ids).size, ids.length, "keine Dubletten");
    assert.ok(ids.includes("3c6743"));
    assert.equal(res.sourceStatus.adsblol, "ok");
    assert.equal(res.sourceStatus.airplaneslive, "error");
    assert.equal(res.sourceStatus.fr24, "ok");
    assert.equal(res.sourceStatus.opensky, "error");
    const st = getAggregatorStatus();
    assert.equal(st.started, true);
    assert.ok(st.sourceLastOk.ogn > 0);
    assert.equal(st.sourceLastOk.airplaneslive, 0);

    // Zweiter Aufruf direkt danach: Intervall nicht abgelaufen → kein neuer Abruf.
    const before = calls.length;
    await getNearbyAircraft(48.6, 10.6, 50, 60);
    assert.equal(calls.length, before);
  } finally {
    globalThis.fetch = origFetch;
  }
});
