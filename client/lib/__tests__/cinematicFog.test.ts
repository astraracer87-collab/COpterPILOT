// Cinematic-Vorschau: Wolkenmeer-Score mit synthetischen Profilen, bestes
// Fenster, Benachrichtigungs-Auswahl, Spots und Abruf/Zwischenspeicher.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  applyDwdCrossCheck,
  buildCinematicForecastUrl,
  buildDwdStationUrl,
  compactPoint,
  dwdHourAt,
  parseDwdStationOverview,
  expandPoint,
  findBestWindow,
  formatWindow,
  parseOpenMeteoMulti,
  scoreHour,
  spreadCloudBaseAgl,
  valleyFogConfirmation,
  type HourScore,
  type LevelValue,
  type PointHour,
} from "../cinematicFog";
import { CINEMATIC_SPOTS, distanceKm, selectSpots } from "../cinematicSpots";
import {
  __setCinematicDepsForTests,
  CINEMATIC_BACKOFF_KEY,
  getCinematicForecast,
  nextBackoff,
  pickCinematicNotification,
  type CinematicSettings,
  type SpotForecast,
} from "../cinematicForecast";

// Sa 28.11.2026 10:00 UTC (11 Uhr MEZ) – Tag, Sonne deutlich über dem Horizont
const T0 = Date.UTC(2026, 10, 28, 10, 0, 0);
const SPOT = { latitude: 50.2325, longitude: 8.4572, elevationM: 879 };
const VALLEY_ELEV = 100;

function levels(rows: [number, number, number, number][]): LevelValue[] {
  return rows.map(([p, z, tC, rh]) => ({ p, z, tC, rh }));
}

/** Nebelmeer bis ~390 m, kräftige Inversion darüber, trocken */
function fogSeaValley(over: Partial<PointHour> = {}): PointHour {
  return {
    t: T0,
    rh2m: 100,
    t2m: 0.5,
    td2m: 0.4,
    cloudLow: 90,
    visibility: 300,
    precip: 0,
    levels: levels([
      [1000, 150, 0, 100],
      [975, 360, -1, 99],
      [950, 570, 2, 60],
      [925, 790, 3, 45],
      [900, 1020, 2, 40],
      [850, 1480, -1, 40],
      [800, 1950, -4, 40],
    ]),
    ...over,
  };
}

function summitHour(over: Partial<PointHour> = {}): PointHour {
  return { t: T0, levels: [], rh2m: 50, t2m: 3, visibility: 30000, precip: 0, wind: 2, gust: 4, directRad: 200, ...over };
}

describe("scoreHour – synthetische Profile", () => {
  it("Nebelmeer unter dem Gipfel → hoher Score", () => {
    const s = scoreHour(SPOT, fogSeaValley(), VALLEY_ELEV, summitHour(), 800);
    assert.ok(s.score >= 70, `Score ${s.score}`);
    assert.equal(s.label, "Wolkenmeer sehr wahrscheinlich");
    assert.ok(s.fogTopM! > 350 && s.fogTopM! < 450, `Obergrenze ${s.fogTopM}`);
    assert.ok(s.clearanceM! > 400);
    assert.ok(s.inversionStrengthK! >= 2);
    assert.equal(s.cloudBaseAglM, 12);
    assert.ok(s.reasons.some((r) => r.includes("Inversion")));
  });

  it("Gipfel im Nebel → 0", () => {
    const v = fogSeaValley({
      levels: levels([
        [1000, 150, 0, 100],
        [975, 360, -1, 100],
        [950, 570, -2, 99],
        [925, 790, -3, 98],
        [900, 1020, -2, 97],
        [850, 1480, 1, 50],
        [800, 1950, -2, 40],
      ]),
    });
    const s = scoreHour(SPOT, v, VALLEY_ELEV, summitHour({ visibility: 200, rh2m: 100 }), 800);
    assert.equal(s.score, 0);
    assert.ok(s.clearanceM! <= 0);
    assert.ok(s.reasons.some((r) => r.includes("Gipfel im Nebel")));
  });

  it("gut durchmischt, keine Inversion → niedrig", () => {
    const v: PointHour = {
      t: T0,
      rh2m: 70,
      t2m: 8,
      td2m: 2.9,
      cloudLow: 10,
      visibility: 20000,
      precip: 0,
      levels: levels([
        [1000, 150, 7.7, 70],
        [975, 360, 6.3, 70],
        [950, 570, 5, 70],
        [925, 790, 3.5, 70],
        [900, 1020, 2, 70],
        [850, 1480, -1, 70],
        [800, 1950, -4, 70],
      ]),
    };
    const s = scoreHour(SPOT, v, VALLEY_ELEV, summitHour(), 800);
    assert.ok(s.score < 20, `Score ${s.score}`);
    assert.equal(s.label, "Wolkenmeer unwahrscheinlich");
  });

  it("starker Wind am Gipfel → deutlich weniger", () => {
    const calm = scoreHour(SPOT, fogSeaValley(), VALLEY_ELEV, summitHour(), 800).score;
    const gusty = scoreHour(SPOT, fogSeaValley(), VALLEY_ELEV, summitHour({ gust: 12 }), 800, { maxGustMs: 10 }).score;
    const storm = scoreHour(SPOT, fogSeaValley(), VALLEY_ELEV, summitHour({ gust: 18 }), 800, { maxGustMs: 10 }).score;
    assert.ok(gusty < calm / 2, `${gusty} vs ${calm}`);
    assert.ok(storm < gusty);
    // Höheres Drohnenlimit → wieder gut
    const strongDrone = scoreHour(SPOT, fogSeaValley(), VALLEY_ELEV, summitHour({ gust: 12 }), 800, { maxGustMs: 20 }).score;
    assert.ok(strongDrone >= 70);
  });

  it("Fehlalarm: Inversion in der Höhe, Tal wolkenfrei (0 %), Spread 4 K, Sicht 26 km → < 25", () => {
    // Profil feucht an der untersten Druckfläche, Inversion darüber – aber Bodenwerte sprechen dagegen
    const base: PointHour = {
      t: T0,
      rh2m: 75,
      t2m: 5,
      td2m: 1,
      cloudLow: 0,
      visibility: 26000,
      precip: 0,
      levels: levels([
        [1000, 150, 4, 95],
        [975, 360, 3, 94],
        [950, 570, 6, 50],
        [925, 790, 7, 40],
        [900, 1020, 6, 35],
        [850, 1480, 3, 35],
        [800, 1950, 0, 35],
      ]),
    };
    assert.equal(spreadCloudBaseAgl(base.t2m, base.td2m), 488);
    assert.equal(valleyFogConfirmation(base), "none");
    const s = scoreHour(SPOT, base, VALLEY_ELEV, summitHour(), 800);
    assert.ok(s.score < 25, `Score ${s.score}`);
    assert.ok(s.reasons.some((r) => r.includes("Inversion vorhanden, aber kein Nebel darunter")), s.reasons.join(" | "));
    // Auch wenn das Bodenprofil eine Schicht erkennt (RH 2 m 90 %), bleibt der Score niedrig
    const s2 = scoreHour(SPOT, { ...base, rh2m: 90 }, VALLEY_ELEV, summitHour(), 800);
    assert.ok(s2.score < 25, `Score ${s2.score}`);
    assert.ok(s2.reasons.some((r) => r.includes("Inversion vorhanden, aber kein Nebel darunter")), s2.reasons.join(" | "));
  });

  it("Spread-Formel: (T − Td) × 122 m, nie negativ", () => {
    assert.equal(spreadCloudBaseAgl(10, 8), 244);
    assert.equal(spreadCloudBaseAgl(1, 1.2), 0);
    assert.equal(spreadCloudBaseAgl(null, 1), null);
  });

  it("Niederschlag am Gipfel → stark reduziert", () => {
    const s = scoreHour(SPOT, fogSeaValley(), VALLEY_ELEV, summitHour({ precip: 1.2 }), 800);
    assert.ok(s.score < 20);
  });

  it("Nacht → geringerer Score als am Tag", () => {
    const night = Date.UTC(2026, 10, 28, 1, 0, 0);
    const d = scoreHour(SPOT, fogSeaValley(), VALLEY_ELEV, summitHour(), 800).score;
    const n = scoreHour(SPOT, fogSeaValley({ t: night }), VALLEY_ELEV, summitHour({ t: night, directRad: 0 }), 800);
    assert.equal(n.light, "night");
    assert.ok(n.score < d);
  });
});

describe("findBestWindow", () => {
  const mk = (scores: number[]): HourScore[] =>
    scores.map((score, i) => ({ t: T0 + i * 3600_000, score } as HourScore));
  it("wählt das Fenster mit dem höchsten Spitzenwert", () => {
    const w = findBestWindow(mk([10, 75, 80, 60, 20, 90, 40]), 60)!;
    assert.equal(w.peakScore, 90);
    assert.equal(w.hours, 1);
    const w2 = findBestWindow(mk([10, 75, 85, 70, 20, 60]), 60)!;
    assert.equal(w2.startMs, T0 + 3600_000);
    assert.equal(w2.endMs, T0 + 4 * 3600_000);
    assert.equal(w2.hours, 3);
  });
  it("null ohne Stunde über der Schwelle", () => {
    assert.equal(findBestWindow(mk([10, 20]), 50), null);
  });
  it("Format „Sa 06–09 Uhr“", () => {
    const s = new Date(2026, 10, 28, 6).getTime();
    assert.equal(formatWindow({ startMs: s, endMs: s + 3 * 3600_000 }), "Sa 06–09 Uhr");
  });
});

describe("pickCinematicNotification", () => {
  const settings: CinematicSettings = { notifyEnabled: true, threshold: 70, maxDistanceKm: 150 };
  const spotFc = (id: string, scores: number[], dist = 20): SpotForecast => {
    const spot = { ...CINEMATIC_SPOTS.find((s) => s.id === id)!, distanceKm: dist };
    const hours = scores.map((score, i) => ({ t: T0 + i * 3600_000, score } as HourScore));
    return { spot, hours, best: null, peak: null, fetchedAt: T0 };
  };
  it("meldet den besten Spot einmal, danach nicht erneut", () => {
    const spots = [spotFc("grosser-feldberg", [50, 80, 85, 60]), spotFc("altkoenig", [72, 40])];
    const r1 = pickCinematicNotification(spots, settings, { sent: [] }, T0);
    assert.equal(r1.notification?.spotId, "grosser-feldberg");
    assert.ok(r1.notification!.body.includes("Großer Feldberg"));
    assert.ok(r1.notification!.body.includes("Score 85"));
    // nächste Stunde, Fenster leicht verschoben → kein zweites Mal für denselben Spot
    const shifted = [spotFc("grosser-feldberg", [80, 85, 60]), spotFc("altkoenig", [40, 40])];
    const r2 = pickCinematicNotification(shifted, settings, r1.state, T0 + 3600_000);
    assert.equal(r2.notification, null);
  });
  it("höchstens 2 Meldungen pro Tag", () => {
    let state = { sent: [] as { spotId: string; startMs: number; endMs: number; at: number }[] };
    const ids = ["grosser-feldberg", "brocken", "wasserkuppe"];
    const got: string[] = [];
    ids.forEach((id, i) => {
      const r = pickCinematicNotification([spotFc(id, [90, 90])], settings, state, T0 + i * 3600_000);
      state = r.state;
      if (r.notification) got.push(r.notification.spotId);
    });
    assert.deepEqual(got, ["grosser-feldberg", "brocken"]);
  });
  it("aus, unter Schwelle oder zu weit → nichts", () => {
    const spots = [spotFc("grosser-feldberg", [85])];
    assert.equal(pickCinematicNotification(spots, { ...settings, notifyEnabled: false }, { sent: [] }, T0).notification, null);
    assert.equal(pickCinematicNotification(spots, { ...settings, threshold: 90 }, { sent: [] }, T0).notification, null);
    assert.equal(pickCinematicNotification([spotFc("brocken", [95], 300)], settings, { sent: [] }, T0).notification, null);
  });
});

describe("Spots", () => {
  it("eindeutige IDs, plausible Koordinaten, Talpunkt in der Nähe", () => {
    const ids = new Set(CINEMATIC_SPOTS.map((s) => s.id));
    assert.equal(ids.size, CINEMATIC_SPOTS.length);
    for (const s of CINEMATIC_SPOTS) {
      assert.ok(s.latitude > 47 && s.latitude < 55 && s.longitude > 5.8 && s.longitude < 15.1, s.id);
      assert.ok(s.elevationM > 300 && s.elevationM < 1600, s.id);
      const d = distanceKm(s.latitude, s.longitude, s.valley.latitude, s.valley.longitude);
      assert.ok(d > 3 && d < 60, `${s.id}: ${d.toFixed(1)} km`);
    }
  });
  it("Auswahl nach Entfernung, Umkreis, Maximum", () => {
    const r = selectSpots({ latitude: 50.11, longitude: 8.68 }, 150, 12);
    assert.equal(r.outsideRadius, false);
    assert.ok(r.spots.length <= 12);
    assert.equal(r.spots[0].id, "altkoenig");
    assert.ok(r.spots.every((s, i) => i === 0 || s.distanceKm >= r.spots[i - 1].distanceKm));
    const far = selectSpots({ latitude: 54.3, longitude: 10.1 }, 50, 12);
    assert.equal(far.outsideRadius, true);
    assert.equal(far.spots.length, 3);
  });
});

describe("Open-Meteo: URL, Parsing, Kompaktform", () => {
  it("eine Abfrage für mehrere Punkte, ICON-D2, ohne boundary_layer_height", () => {
    const url = buildCinematicForecastUrl([
      { latitude: 50.1, longitude: 8.6 },
      { latitude: 50.2325, longitude: 8.4572 },
    ]);
    assert.ok(url.includes("latitude=50.1000,50.2325"));
    assert.ok(url.includes("models=icon_d2"));
    assert.ok(url.includes("geopotential_height_850hPa"));
    assert.ok(url.includes("dew_point_2m"));
    assert.ok(!url.includes("boundary_layer_height"));
  });
  it("Antwort parsen und verlustfrei kompakt speichern", () => {
    const raw = {
      latitude: 50.1,
      longitude: 8.6,
      elevation: 98,
      hourly: {
        time: [T0 / 1000, T0 / 1000 + 3600],
        temperature_1000hPa: [0.4, 0.2],
        relative_humidity_1000hPa: [99, 100],
        geopotential_height_1000hPa: [160.4, 158],
        temperature_975hPa: [null, -1],
        relative_humidity_975hPa: [null, 98],
        geopotential_height_975hPa: [null, 365],
        cloud_cover_low: [80, 90],
        dew_point_2m: [0, 0.1],
        temperature_2m: [0.3, 0.2],
      },
    };
    const [p] = parseOpenMeteoMulti(raw);
    assert.ok(p);
    assert.equal(p!.hours.length, 2);
    assert.equal(p!.hours[0].levels.length, 1);
    assert.equal(p!.hours[0].levels[0].z, 160);
    assert.equal(p!.hours[1].levels.length, 2);
    assert.equal(p!.hours[0].td2m, 0);
    const back = expandPoint(JSON.parse(JSON.stringify(compactPoint(p!))));
    assert.deepEqual(back, p);
  });
});

describe("getCinematicForecast – Abruf & Zwischenspeicher", () => {
  let mem: Map<string, string>;
  let calls: string[];
  let status: number;
  let clock: number;
  let dwdCalls: string[];
  let dwdBody: unknown;
  beforeEach(() => {
    dwdCalls = [];
    dwdBody = {};
    mem = new Map();
    calls = [];
    status = 200;
    clock = T0;
    __setCinematicDepsForTests({
      storage: { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => void mem.set(k, v) },
      now: () => clock,
      fetch: async (url) => {
        if (url.includes("warnwetter")) {
          dwdCalls.push(url);
          return { ok: true, status: 200, json: async () => dwdBody };
        }
        calls.push(url);
        const lats = new URL(url).searchParams.get("latitude")!.split(",");
        const lons = new URL(url).searchParams.get("longitude")!.split(",");
        const body = lats.map((la, i) => ({
          latitude: Number(la),
          longitude: Number(lons[i]),
          elevation: 100,
          hourly: {
            time: Array.from({ length: 30 }, (_, h) => T0 / 1000 + h * 3600),
            temperature_2m: Array(30).fill(1),
            dew_point_2m: Array(30).fill(1),
            relative_humidity_2m: Array(30).fill(100),
            cloud_cover_low: Array(30).fill(90),
          },
        }));
        return { ok: status === 200, status, json: async () => body };
      },
    });
  });
  afterEach(() => __setCinematicDepsForTests(null));

  it("EINE Abfrage für alle Punkte, danach 60 min aus dem Speicher", async () => {
    const r = await getCinematicForecast({ center: { latitude: 50.11, longitude: 8.68 } });
    assert.equal(calls.length, 1);
    assert.ok(r.spots.length > 3);
    assert.equal(r.stale, false);
    assert.equal(r.spots[0].hours.length, 24);
    clock += 30 * 60_000;
    await getCinematicForecast({ center: { latitude: 50.11, longitude: 8.68 } });
    assert.equal(calls.length, 1);
    clock += 31 * 60_000;
    await getCinematicForecast({ center: { latitude: 50.11, longitude: 8.68 } });
    assert.equal(calls.length, 2);
  });

  it("HTTP 429 → Rückzug, gespeicherte Daten bleiben als Stand", async () => {
    await getCinematicForecast({ center: { latitude: 50.11, longitude: 8.68 } });
    clock += 2 * 3600_000;
    status = 429;
    const r = await getCinematicForecast({ center: { latitude: 50.11, longitude: 8.68 } });
    assert.ok(r.error);
    assert.ok(r.rateLimitedUntil! > clock);
    assert.equal(r.stale, true);
    assert.ok(r.spots[0].hours.length > 0);
    assert.ok(mem.get(CINEMATIC_BACKOFF_KEY));
    // während des Rückzugs keine weitere Abfrage
    const n = calls.length;
    await getCinematicForecast({ center: { latitude: 50.11, longitude: 8.68 }, force: true });
    assert.equal(calls.length, n);
  });

  it("DWD-Stationen in EINER Abfrage; Widerspruch dämpft den Taunus", async () => {
    const hum = (v: number) => Array(30).fill(v * 10);
    dwdBody = {
      "10635": { forecast1: { start: T0, timeStep: 3600000, humidity: hum(97), temperature: hum(-5), dewPoint2m: hum(-5.4), sunshine: hum(0) } },
      "10637": { forecast1: { start: T0, timeStep: 3600000, humidity: hum(68), temperature: hum(1), dewPoint2m: hum(-4), sunshine: hum(30) } },
    };
    const r = await getCinematicForecast({ center: { latitude: 50.11, longitude: 8.68 }, radiusKm: 30 });
    assert.equal(dwdCalls.length, 1);
    assert.ok(dwdCalls[0].includes("stationIds=10635,10637"));
    assert.ok(r.dwdFetchedAt);
    const fb = r.spots.find((x) => x.spot.id === "grosser-feldberg")!;
    assert.ok(fb.hours.every((h) => h.dwd !== "confirms"));
  });

  it("Rückzug verdoppelt sich bis höchstens 6 h", () => {
    let b = nextBackoff(null, 0);
    assert.equal(b.until, 15 * 60_000);
    b = nextBackoff(b, 0);
    assert.equal(b.until, 30 * 60_000);
    for (let i = 0; i < 10; i++) b = nextBackoff(b, 0);
    assert.equal(b.until, 360 * 60_000);
  });
});

describe("DWD-Stationsvorhersage (Gegenprobe)", () => {
  it("parst Zehntelwerte und findet die Stunde", () => {
    const f = parseDwdStationOverview({
      "10635": { forecast1: { start: T0, timeStep: 3600000, humidity: [913, 970], temperature: [-50, -51], dewPoint2m: [-54, 32767], sunshine: [80, 0] } },
    });
    assert.equal(f["10635"].humidity[0], 91.3);
    assert.equal(f["10635"].dewPoint[1], null);
    const h = dwdHourAt(f["10635"], T0 + 3600_000)!;
    assert.equal(h.humidity, 97);
    assert.equal(h.sunshineMin, 0);
    assert.equal(dwdHourAt(f["10635"], T0 + 5 * 3600_000), null);
    assert.equal(buildDwdStationUrl(["10635", "10637"]).split("?")[1], "stationIds=10635,10637");
  });
  it("Live-Beispiel: Gipfel 96 % (in Wolken), Tal 68 % → widerspricht, kein Wolkenmeer", () => {
    const good = scoreHour(SPOT, fogSeaValley(), VALLEY_ELEV, summitHour(), 800);
    assert.ok(good.score >= 70);
    const r = applyDwdCrossCheck(
      good,
      { humidity: 96, temperature: -5, dewPoint: -5.5, sunshineMin: 0 },
      { humidity: 68, temperature: 1, dewPoint: -4, sunshineMin: 30 },
    );
    assert.equal(r.dwd, "contradicts");
    assert.ok(r.score < 40, `Score ${r.score}`);
    assert.ok(r.reasons.some((x) => x.startsWith("DWD-Stationsvorhersage widerspricht")));
  });
  it("Gipfel trocken mit Sonne, Tal gesättigt → bestätigt", () => {
    const good = scoreHour(SPOT, fogSeaValley(), VALLEY_ELEV, summitHour(), 800);
    const r = applyDwdCrossCheck(
      good,
      { humidity: 45, temperature: 4, dewPoint: -7, sunshineMin: 50 },
      { humidity: 99, temperature: 0, dewPoint: -0.2, sunshineMin: 0 },
    );
    assert.equal(r.dwd, "confirms");
    assert.ok(r.score >= good.score);
  });
});
