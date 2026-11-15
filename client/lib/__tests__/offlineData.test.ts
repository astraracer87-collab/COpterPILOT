// Teil A: Offline-Speicher für Wetter/METAR/TAF/NOTAM/Kp – Schwellen (frisch,
// 6 h, 24 h), Speicher (LRU, Größenbegrenzung) und Wirkung in der Prüfkette
// (Offline-Daten höchstens CAUTION, zu alt = unbekannt).
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  OFFLINE_DATA_MAX_AGE_MS,
  assessOfflineData,
  bringOnlineHint,
  formatSourceStand,
  offlineCheckReason,
  offlineForecastLabel,
  offlineLocationKey,
  stillValidNotams,
  tafValidUntil,
} from "../../../shared/offlineDataPolicy";
import {
  __offlineCacheCountForTests,
  __setOfflineCacheStorageForTests,
  fetchWithOfflineCache,
  getOfflineResult,
  putOfflineResult,
  type OfflineCacheStorage,
} from "../offlineResultCache";
import { weatherChecks, evaluateFlight } from "../flightChecks";
import { aggregate, notamChecks } from "../../../shared/checks";

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 15, 12, 0);

function memoryStorage(): OfflineCacheStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async getItem(k) { return map.has(k) ? map.get(k)! : null; },
    async setItem(k, v) { map.set(k, v); },
    async removeItem(k) { map.delete(k); },
  };
}

describe("Offline-Policy: Schwellen", () => {
  it("Wetter: frisch nutzbar, ab 6 h deutlicher Hinweis (aged), ab 24 h nicht mehr (expired)", () => {
    assert.equal(assessOfflineData("weather", NOW - 1 * H, NOW).state, "usable");
    assert.equal(assessOfflineData("weather", NOW - 5.9 * H, NOW).state, "usable");
    assert.equal(assessOfflineData("weather", NOW - 6 * H, NOW).state, "aged");
    assert.equal(assessOfflineData("weather", NOW - 23.9 * H, NOW).state, "aged");
    const exp = assessOfflineData("weather", NOW - 24 * H, NOW);
    assert.equal(exp.state, "expired");
    assert.equal(exp.show, false);
    assert.equal(exp.useInVerdict, false);
  });

  it("METAR: älter als 2 h nur grau (nicht im Urteil); Kp mit Alter bis 24 h", () => {
    assert.equal(assessOfflineData("metar", NOW - 1.5 * H, NOW).useInVerdict, true);
    const grey = assessOfflineData("metar", NOW - 3 * H, NOW);
    assert.equal(grey.state, "grey");
    assert.equal(grey.show, true);
    assert.equal(grey.useInVerdict, false);
    assert.equal(assessOfflineData("kp", NOW - 20 * H, NOW).state, "usable");
    assert.equal(assessOfflineData("kp", NOW - 25 * H, NOW).state, "expired");
  });

  it("TAF bis zum Ende der Gültigkeit (auch über 24 h hinaus nicht, davor ja)", () => {
    const raw = "TAF EDDM 151100Z 1512/1618 25010KT 9999 SCT030";
    const end = tafValidUntil(raw, "2026-11-15T11:00:00Z");
    assert.equal(end, Date.UTC(2026, 10, 16, 18));
    assert.equal(assessOfflineData("taf", NOW - 2 * H, NOW, { validUntil: end }).show, true);
    assert.equal(assessOfflineData("taf", NOW - 2 * H, Date.UTC(2026, 10, 16, 18, 1), { validUntil: end }).show, false);
    // Monatswechsel: 3018/0124 → 1. des Folgemonats
    assert.equal(tafValidUntil("TAF EDDF 301700Z 3018/0124 …", "2026-11-30T17:00:00Z"), Date.UTC(2026, 11, 2, 0));
    assert.equal(tafValidUntil("kein TAF", NOW), null);
  });

  it("NOTAMs: nur noch gültige (endvalidity in Sekunden)", () => {
    const sec = Math.floor(NOW / 1000);
    const list = [{ id: 1, endvalidity: sec - 60 }, { id: 2, endvalidity: sec + 3600 }, { id: 3, endvalidity: null }];
    assert.deepEqual(stillValidNotams(list, NOW).map((n) => n.id), [2, 3]);
  });

  it("Standort-Schlüssel auf 0,05° gerundet; Texte deutsch", () => {
    assert.equal(offlineLocationKey(48.137, 11.576), "48.15_11.60");
    assert.equal(offlineLocationKey(48.131, 11.574), offlineLocationKey(48.142, 11.551));
    assert.equal(bringOnlineHint("weather"), "Gerät online bringen, um das Wetter zu prüfen");
    assert.match(offlineCheckReason(NOW - H, NOW), /^Offline-Daten \(Stand \d\d:\d\d\) – vor dem Start online neu prüfen$/);
    assert.match(offlineForecastLabel(NOW - H, NOW), /^Offline-Vorhersage von \d\d:\d\d$/);
    assert.equal(formatSourceStand("weather", { fetchedAt: NOW - 7 * H, cached: true }, NOW)?.tone, "warning");
    assert.equal(formatSourceStand("metar", { fetchedAt: NOW - 3 * H, cached: true }, NOW)?.tone, "grey");
    assert.equal(formatSourceStand("notam", { fetchedAt: NOW - H, cached: true }, NOW)?.tone, "offline");
    assert.equal(formatSourceStand("kp", { fetchedAt: NOW - 30 * H, cached: true }, NOW)?.text, "Kp-Index: Gerät online bringen, um den Kp-Index zu prüfen");
  });
});

describe("Offline-Speicher (offlineResultCache)", () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    __setOfflineCacheStorageForTests(storage);
  });
  afterEach(() => __setOfflineCacheStorageForTests(undefined));

  it("online: abrufen + speichern; offline: gespeicherter Stand mit fetchedAt; ≥ 24 h: Fehler", async () => {
    let t = NOW;
    const now = () => t;
    const live = await fetchWithOfflineCache("weather", "k", async () => ({ v: 1 }), { isOffline: () => false, now });
    assert.deepEqual(live, { data: { v: 1 }, fetchedAt: NOW, cached: false });
    t = NOW + 3 * H;
    const off = await fetchWithOfflineCache("weather", "k", async () => ({ v: 2 }), { isOffline: () => true, now });
    assert.deepEqual(off, { data: { v: 1 }, fetchedAt: NOW, cached: true });
    // Abruffehler online → ebenfalls gespeicherter Stand
    const failed = await fetchWithOfflineCache("weather", "k", async () => { throw new Error("503"); }, { isOffline: () => false, now });
    assert.equal(failed.cached, true);
    t = NOW + OFFLINE_DATA_MAX_AGE_MS;
    await assert.rejects(fetchWithOfflineCache("weather", "k", async () => { throw new Error("503"); }, { isOffline: () => false, now }), /503/);
    // dauerhaft gespeichert (neuer Prozess-Zustand, gleicher Speicher)
    __setOfflineCacheStorageForTests(storage);
    assert.equal((await getOfflineResult<{ v: number }>("weather", "k"))?.data.v, 1);
  });

  it("LRU je Art: höchstens maxEntries; zuletzt benutzte bleiben", async () => {
    for (let i = 0; i < 22; i++) await putOfflineResult("weather", `p${i}`, { i }, NOW);
    assert.equal(await __offlineCacheCountForTests("weather"), 20);
    assert.equal(await getOfflineResult("weather", "p0"), null);
    assert.equal(await getOfflineResult("weather", "p1"), null);
    assert.ok(await getOfflineResult("weather", "p21"));
    // Kp: genau ein Eintrag
    await putOfflineResult("kp", "global", { value: 3 }, NOW);
    await putOfflineResult("kp", "global2", { value: 4 }, NOW);
    assert.equal(await __offlineCacheCountForTests("kp"), 1);
  });

  it("zu große Einträge werden nicht gespeichert (Größenbegrenzung)", async () => {
    await putOfflineResult("kp", "global", { blob: "x".repeat(20_000) }, NOW);
    assert.equal(await getOfflineResult("kp", "global"), null);
  });
});

// ---------------------------------------------------------------------------
// Prüfkette
// ---------------------------------------------------------------------------

const LIMITS = { maxWind: 10, maxGusts: 12, maxRain: 0.5, minTemp: -10, maxTemp: 40, minCloudCeiling: 0, minVisibility: 0 };
function weather(fetchedAt: number | null, over: Record<string, number> = {}) {
  return {
    latitude: 48.1,
    longitude: 11.5,
    calculationTime: new Date(NOW).toISOString(),
    forecasts: [{
      timestamp: new Date(NOW).toISOString(),
      temperature: 15, humidity: 50, windSpeed: 2, windGust: 3, windDirection: 0,
      windAtAltitude: [], temperatureAtAltitude: [{ height: 2, value: 15 }],
      humidityAtAltitude: [{ height: 2, value: 50 }], cloudCoverAtAltitude: [],
      rain: 0, snow: 0, cloudCover: 10, pressure: 1013,
      ...over,
    }],
    ...(fetchedAt != null ? { offline: { fetchedAt, cached: true } } : {}),
  } as any;
}

describe("Prüfkette: Offline-Daten höchstens CAUTION, zu alt = unbekannt", () => {
  it("live → GO; Offline-Wetter (1 h) → CAUTION „Offline-Daten (Stand …) – vor dem Start online neu prüfen“", () => {
    assert.equal(aggregate(weatherChecks({ context: "planning", weather: weather(null), limits: LIMITS, now: NOW })).verdict, "go");
    const res = weatherChecks({ context: "planning", weather: weather(NOW - H), limits: LIMITS, now: NOW });
    const off = res.find((r) => r.id === "weather:offline:weather")!;
    assert.equal(off.severity, "caution");
    assert.match(off.title, /^Wetter – Offline-Daten \(Stand \d\d:\d\d\) – vor dem Start online neu prüfen$/);
    assert.equal(off.dataAge?.ageMs, H);
    assert.equal(res.some((r) => r.id === "weather:offline-wind-aged"), false);
    assert.equal(aggregate(res).verdict, "caution");
    assert.equal(aggregate(res).requiresConfirmation, false);
  });

  it("Offline-Wetter ≥ 6 h → zusätzlicher deutlicher Wind-/Böen-Befund mit Bestätigung", () => {
    const res = weatherChecks({ context: "precheck", weather: weather(NOW - 7 * H), limits: LIMITS, now: NOW });
    const wind = res.find((r) => r.id === "weather:offline-wind-aged")!;
    assert.equal(wind.severity, "caution");
    assert.equal(wind.emphasis, "warning");
    assert.equal(wind.requiresConfirmation, true);
    assert.match(wind.title, /^Wind-\/Böendaten älter als 6 h/);
    assert.equal(aggregate(res).verdict, "caution");
    assert.equal(aggregate(res).requiresConfirmation, true);
  });

  it("Offline-Wetter ≥ 24 h → nicht verwendet, unbekannt mit „Gerät online bringen, um das Wetter zu prüfen“", () => {
    const res = weatherChecks({ context: "planning", weather: weather(NOW - 25 * H, { windSpeed: 30 }), limits: LIMITS, now: NOW });
    assert.equal(res[0].id, "weather:unavailable");
    assert.equal(res[0].severity, "unknown");
    assert.match(res[0].title, /Gerät online bringen, um das Wetter zu prüfen/);
    // Der (zu alte) Starkwind wird NICHT bewertet
    assert.equal(res.some((r) => r.severity === "nogo"), false);
    assert.equal(aggregate(res).verdict, "caution");
  });

  it("Befunde aus Offline-Daten bleiben streng: Wind über Limit offline → NO-GO wie online", () => {
    const live = aggregate(weatherChecks({ context: "planning", weather: weather(null, { windSpeed: 30, windGust: 35 }), limits: LIMITS, now: NOW })).verdict;
    const off = aggregate(weatherChecks({ context: "planning", weather: weather(NOW - H, { windSpeed: 30, windGust: 35 }), limits: LIMITS, now: NOW })).verdict;
    assert.equal(off, live);
  });

  it("Kp offline < 24 h → CAUTION; ≥ 24 h → Wert nicht verwendet, unbekannt", () => {
    const ok = weatherChecks({ context: "planning", weather: weather(null), limits: LIMITS, kpIndex: 2, kpOfflineFetchedAt: NOW - 2 * H, now: NOW });
    assert.equal(ok.find((r) => r.id === "weather:offline:kp")?.severity, "caution");
    const old = weatherChecks({ context: "planning", weather: weather(null), limits: LIMITS, kpIndex: 7, kpOfflineFetchedAt: NOW - 30 * H, now: NOW });
    assert.equal(old.find((r) => r.id === "weather:offline-expired:kp")?.severity, "unknown");
    // Kp 7 (alt) wird nicht bewertet → kein NO-GO/Kp-Warnung aus altem Wert
    assert.equal(old.some((r) => /Kp/.test(r.title) && r.id.startsWith("weather:") && /^weather:\d+$/.test(r.id)), false);
  });

  it("METAR älter als 2 h → nur grau (Info), nicht bewertet; < 2 h offline → CAUTION und bewertet", () => {
    const metarTs: any = { name: "Test", icao: "EDDM", distanceKm: 5, hasThunderstorm: true, phenomenaText: "TS" };
    const grey = weatherChecks({ context: "precheck", weather: weather(null), limits: LIMITS, airportMetar: { ...metarTs, greyOnly: true, offline: { fetchedAt: NOW - 3 * H, cached: true } }, now: NOW });
    assert.equal(grey.find((r) => r.id === "weather:metar-grey")?.severity, "info");
    assert.equal(aggregate(grey).verdict, "go");
    const fresh = weatherChecks({ context: "precheck", weather: weather(null), limits: LIMITS, airportMetar: { ...metarTs, offline: { fetchedAt: NOW - H, cached: true } }, now: NOW });
    assert.equal(aggregate(fresh).verdict, "nogo"); // Gewitter bleibt NO-GO
    assert.equal(fresh.find((r) => r.id === "weather:offline:metar")?.severity, "caution");
  });

  it("NOTAMs offline → CAUTION (nie „keine NOTAMs“ als GO); fehlgeschlagen → unbekannt", () => {
    const off = notamChecks({ context: "planning", failed: false, count: 0, offlineFetchedAt: NOW - 3 * H, now: NOW });
    assert.equal(off[0].severity, "caution");
    assert.match(off[0].title, /^NOTAMs – Offline-Daten \(Stand/);
    assert.match(off[0].detail, /Keine noch gültigen NOTAMs/);
    assert.equal(notamChecks({ context: "planning", failed: true, count: null })[0].severity, "unknown");
    assert.equal(notamChecks({ context: "planning", failed: false, count: 0 })[0].severity, "info");
  });

  it("evaluateFlight: Offline-Wetter + Kp → Gesamturteil CAUTION statt GO", () => {
    const ev = evaluateFlight({
      context: "precheck",
      at: new Date(NOW),
      latitude: 48.1,
      longitude: 11.5,
      weather: weather(NOW - 2 * H),
      limits: LIMITS,
      kpIndex: 2,
      kpOfflineFetchedAt: NOW - 2 * H,
      stored: [],
      now: NOW,
    });
    assert.equal(ev.verdict === "go", false);
    assert.ok(ev.reasons.some((r) => r.id === "weather:offline:weather"));
  });
});
