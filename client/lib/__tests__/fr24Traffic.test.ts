// FR24 als zusätzliche Live-Verkehrsquelle (docs/air-traffic-quellen.md §4):
// Parser (Fixture), Feed-URL/Bounding-Box, Merge/Dedupe mit ADS-B/OGN und
// Integration in den clientseitigen Aggregator inkl. Abschalten.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FR24_FEED_URL,
  FR24_MAX_DIST_NM,
  buildFr24FeedUrl,
  parseAdsbResponse,
  parseFr24Feed,
  parseOgnLxml,
} from "../traffic/sources";
import { mergeByIcao } from "../traffic/merge";
import {
  __resetTrafficAggregatorForTests,
  getAggregatorStatus,
  getNearbyAircraft,
  isTrafficSourceEnabled,
  setTrafficSourceEnabled,
} from "../traffic/aggregator";
import { clearElevationCache } from "../elevation";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../traffic/__tests__/fixtures/fr24-feed-hamburg.json"), "utf8"),
) as Record<string, unknown>;
const FIXTURE_TIME_MS = 1794731836 * 1000;

test("parseFr24Feed: Beispiel aus der Doku (§4.1)", () => {
  const data = {
    full_count: 12798,
    version: 4,
    "4294b831": ["4D2528", 53.3164, 9.4182, 79, 36975, 467, "", "F-BDWY1", "A21N", "9H-WNB", 1794731836, "LTN", "VNO", "W61902", 0, -64, "WZZ8409", 0, "WZZ"],
  };
  const s = parseFr24Feed(data);
  assert.equal(s.length, 1, "full_count/version übersprungen");
  const a = s[0];
  assert.equal(a.icao24, "4d2528");
  assert.equal(a.aircraftType, "A21N");
  assert.equal(a.registration, "9H-WNB");
  assert.equal(a.callsign, "WZZ8409");
  assert.ok(Math.abs((a.velocity ?? 0) - 240.25) < 0.1, `velocity ${a.velocity}`);
  assert.equal(a.baroAltitude, 11270);
  assert.ok(Math.abs((a.verticalRate ?? 0) - -64 * 0.00508) < 1e-9);
  assert.equal(a.trueTrack, 79);
  assert.equal(a.onGround, false);
  assert.equal(a.geoAltitude, null);
  assert.equal(a.category, "airplane");
  assert.deepEqual(a.sources, ["fr24"]);
  assert.equal(a.originIata, "LTN");
  assert.equal(a.destIata, "VNO");
  assert.equal(a.flightNumber, "W61902");
  assert.equal(a.operator, "WZZ");
  assert.equal(a.reportAgeMs, undefined, "ohne nowMs kein Alter");
});

test("parseFr24Feed: Fixture – stats übersprungen, Hubschrauber ohne Hex, Bodenfahrzeug", () => {
  const s = parseFr24Feed(fixture);
  assert.equal(s.length, 4);
  const heli = s.find((x) => x.registration === "D-HDIK")!;
  assert.equal(heli.icao24, "fr24-4294a911", "ohne Hex → synthetische fr24-ID");
  assert.equal(heli.category, "helicopter");
  const veh = s.find((x) => x.icao24 === "3c4b26")!;
  assert.equal(veh.onGround, true);
  assert.equal(veh.baroAltitude, 0);
  assert.equal(veh.category, "ground");
});

test("parseFr24Feed: Alter aus Feld 10, alte Positionen verworfen", () => {
  const fresh = parseFr24Feed(fixture, { nowMs: FIXTURE_TIME_MS + 5000 });
  assert.equal(fresh.length, 4);
  assert.equal(fresh.find((x) => x.icao24 === "4d2528")!.reportAgeMs, 5000);
  assert.equal(fresh.find((x) => x.icao24 === "3c6743")!.reportAgeMs, 7000);
  // Uhr des Geräts nachgehend → negatives Alter gilt als 0
  assert.equal(parseFr24Feed(fixture, { nowMs: FIXTURE_TIME_MS - 60_000 })[0].reportAgeMs, 0);
  assert.equal(parseFr24Feed(fixture, { nowMs: FIXTURE_TIME_MS + 10 * 60_000 }).length, 0);
});

test("parseFr24Feed: robust gegen kaputte Einträge", () => {
  const s = parseFr24Feed({
    "1": "kein Array",
    "2": ["ABCDEF", "53", 9.9],
    "3": ["ABCDEF", null, 9.9, 0, 0, 0, "", "", "", "", 0, "", "", "", 0, 0, ""],
    "4": ["ABCDEF", 53.1, 9.9, null, null, null, "", "", "", "", 0, "", "", "", 0, null, ""],
  });
  assert.equal(s.length, 1);
  assert.equal(s[0].baroAltitude, null);
  assert.equal(s[0].velocity, null);
  assert.equal(s[0].verticalRate, null);
  assert.equal(s[0].category, "unknown");
});

test("buildFr24FeedUrl: bounds = Nord,Süd,West,Ost und gekappte Box", () => {
  const url = new URL(buildFr24FeedUrl({ lat: 53.5, lon: 10, distNm: 20 }));
  assert.equal(`${url.origin}${url.pathname}`, FR24_FEED_URL);
  const [n, s, w, e] = url.searchParams.get("bounds")!.split(",").map(Number);
  assert.ok(n > 53.5 && s < 53.5 && w < 10 && e > 10);
  assert.ok(Math.abs(n - s - (2 * 20 * 1.852) / 111) < 0.01);
  for (const k of ["adsb", "mlat", "flarm", "estimated", "gliders"]) assert.equal(url.searchParams.get(k), "1");
  assert.equal(url.searchParams.get("limit"), "5000");
  // 250-NM-Kachel (ADS-B-Maximum) wird für FR24 auf FR24_MAX_DIST_NM gekappt
  const big = new URL(buildFr24FeedUrl({ lat: 53.5, lon: 10, distNm: 250 }));
  const [bn, bs] = big.searchParams.get("bounds")!.split(",").map(Number);
  assert.ok(Math.abs(bn - bs - (2 * FR24_MAX_DIST_NM * 1.852) / 111) < 0.01);
});

test("mergeByIcao: FR24 + ADS-B gleicher Hex → ein Eintrag, ADS-B-Position bleibt Basis", () => {
  const fr24 = parseFr24Feed(fixture);
  const adsb = parseAdsbResponse(
    { ac: [{ hex: "3c6743", flight: "DLH17 ", lat: 53.6305, lon: 9.9879, alt_baro: 2425, gs: 157, r: "D-AIZC", t: "A320" }] },
    "adsblol",
  );
  // Reihenfolge wie im Aggregator (ALL_DATA_SOURCES: fr24 zuletzt)
  const { merged } = mergeByIcao([{ states: adsb }, { states: fr24 }]);
  const hits = merged.filter((m) => m.icao24 === "3c6743");
  assert.equal(hits.length, 1, "keine Dublette");
  const m = hits[0];
  assert.deepEqual([...m.sources].sort(), ["adsblol", "fr24"]);
  assert.equal(m.latitude, 53.6305, "ADS-B-Position");
  assert.equal(m.originIata, "HAM", "FR24 ergänzt Start");
  assert.equal(m.destIata, "FRA", "FR24 ergänzt Ziel");
  assert.equal(m.flightNumber, "LH17");
  // Übrige FR24-Ziele bleiben erhalten
  assert.ok(merged.some((x) => x.icao24 === "4d2528"));
});

test("mergeByIcao: FR24-Ziel ohne Hex wird per Registrierung mit OGN/ADS-B dedupliziert", () => {
  const fr24 = parseFr24Feed(fixture);
  const ogn = parseOgnLxml(`<markers>
<m a="53.551,10.121,IK,D-HDIK,366,08:37:10,6,145,176,0.0,3,EDHL,3DDB66,ebe6e1f3"/>
</markers>`);
  const adsb = parseAdsbResponse(
    { ac: [{ hex: "3ddb66", flight: "CHX16", lat: 53.5513, lon: 10.1204, alt_baro: 1200, gs: 95, r: "D-HDIK", t: "EC35" }] },
    "adsbfi",
  );
  const { merged, droppedIds } = mergeByIcao([{ states: adsb }, { states: ogn }, { states: fr24 }]);
  const heli = merged.filter((m) => m.registration === "D-HDIK");
  assert.equal(heli.length, 1);
  assert.equal(heli[0].icao24, "3ddb66", "echter ICAO-Hex gewinnt");
  assert.deepEqual([...heli[0].sources].sort(), ["adsbfi", "fr24", "ogn"]);
  assert.ok(droppedIds.includes("fr24-4294a911"));
  assert.ok(droppedIds.includes("ogn_flr3ddb66"));
});

// ---- Aggregator-Integration -------------------------------------------------

const realFetch = globalThis.fetch;
const realNow = Date.now;

beforeEach(() => {
  __resetTrafficAggregatorForTests();
  clearElevationCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

function installFetch(calls: string[]): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith(FR24_FEED_URL)) {
      const h = new Headers(init?.headers);
      assert.match(h.get("User-Agent") ?? "", /Mozilla\/5\.0/, "Browser-UA für FR24");
      assert.ok(init?.signal, "mit Timeout-Signal");
      return new Response(JSON.stringify(fixture), { status: 200 });
    }
    if (url.includes("glidernet")) return new Response("<markers></markers>", { status: 200 });
    if (url.includes("open-meteo")) return new Response("{}", { status: 500 });
    const body = { ac: [{ hex: "3c6743", flight: "DLH17", lat: 53.6305, lon: 9.9879, alt_baro: 2425, gs: 157 }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

test("Aggregator: FR24 wird abgefragt, gemergt und im Status geführt", async () => {
  Date.now = () => FIXTURE_TIME_MS + 3000;
  const calls: string[] = [];
  installFetch(calls);
  const res = await getNearbyAircraft(53.6, 9.95, 50, 60);
  assert.ok(calls.some((u) => u.startsWith(FR24_FEED_URL + "?bounds=")));
  assert.equal(res.sourceStatus.fr24, "ok");
  const ids = res.aircraft.map((a) => a.icao24);
  assert.equal(new Set(ids).size, ids.length, "keine Dubletten");
  const dlh = res.aircraft.find((a) => a.icao24 === "3c6743")!;
  assert.ok(dlh.sources.includes("fr24") && dlh.sources.includes("adsblol"));
  assert.equal(dlh.originIata, "HAM");
  assert.ok(ids.includes("fr24-4294a911"), "FR24-only-Ziel (MLAT-Heli)");
  assert.ok(!ids.includes("3c4b26"), "Bodenfahrzeug ausgeblendet");
  const st = getAggregatorStatus();
  assert.ok(st.enabledSources.includes("fr24"));
  assert.ok(st.sourceLastOk.fr24 > 0);
  assert.equal(st.sourceIntervalsMs.fr24, 8000);

  // Poll-Intervall: direkt danach kein neuer FR24-Abruf
  const before = calls.filter((u) => u.startsWith(FR24_FEED_URL)).length;
  await getNearbyAircraft(53.6, 9.95, 50, 60);
  assert.equal(calls.filter((u) => u.startsWith(FR24_FEED_URL)).length, before);
});

test("Aggregator: FR24 abschaltbar – keine Abfrage, Snapshot sofort verworfen", async () => {
  Date.now = () => FIXTURE_TIME_MS + 3000;
  const calls: string[] = [];
  installFetch(calls);
  await getNearbyAircraft(53.6, 9.95, 50, 60);
  setTrafficSourceEnabled("fr24", false);
  assert.equal(isTrafficSourceEnabled("fr24"), false);
  assert.equal(getAggregatorStatus().sourceStatus.fr24, "error");
  assert.ok(!getAggregatorStatus().enabledSources.includes("fr24"));

  // Neue Region → Sofort-Poll aller aktiven Quellen, FR24 nicht dabei
  calls.length = 0;
  Date.now = () => FIXTURE_TIME_MS + 20_000;
  const res = await getNearbyAircraft(48.1, 11.5, 50, 60);
  assert.ok(calls.some((u) => u.includes("adsb.lol")));
  assert.ok(!calls.some((u) => u.startsWith(FR24_FEED_URL)));
  assert.ok(res.aircraft.every((a) => !a.sources.includes("fr24")));

  setTrafficSourceEnabled("fr24", true);
  assert.equal(isTrafficSourceEnabled("fr24"), true);
  calls.length = 0;
  await getNearbyAircraft(48.1, 11.5, 50, 60);
  assert.ok(calls.some((u) => u.startsWith(FR24_FEED_URL)), "nach Anschalten sofort fällig");
});

test("Aggregator: FR24 429 → Fehlerstatus, andere Quellen unberührt", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith(FR24_FEED_URL)) return new Response("", { status: 429 });
    if (url.includes("glidernet")) return new Response("<markers></markers>", { status: 200 });
    if (url.includes("open-meteo")) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ ac: [{ hex: "3c6743", lat: 53.6305, lon: 9.9879, alt_baro: 2425, gs: 157 }] }), { status: 200 });
  }) as typeof fetch;
  const res = await getNearbyAircraft(53.6, 9.95, 50, 60);
  assert.equal(res.sourceStatus.fr24, "error");
  assert.equal(res.sourceStatus.adsblol, "ok");
  assert.ok(res.aircraft.some((a) => a.icao24 === "3c6743"));
});
