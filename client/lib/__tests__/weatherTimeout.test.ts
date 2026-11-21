import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { fetchWithTimeout, withTimeout } from "../fetchWithTimeout";
import { fetchBrightSkyWeather, fetchCurrentWind } from "../brightsky";
import { fetchWeather } from "../weather";
import { fetchKpIndex } from "../kpindex";

// Review-Fix 8: Ein hängender DFS-Wetterabruf darf den Open-Meteo-Rückfall
// nicht blockieren. fetchWithTimeout bricht nach ~10 s ab.

const realFetch = globalThis.fetch;

// fetch, das nie antwortet – außer das AbortSignal feuert.
function hangingFetch(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
}

const OPEN_METEO = {
  hourly: {
    time: ["2026-11-15T12:00"],
    temperature_2m: [8],
    relative_humidity_2m: [70],
    wind_speed_10m: [3],
    wind_gusts_10m: [5],
    wind_direction_10m: [180],
  },
};

const flush = () => new Promise<void>((r) => setImmediate(r));

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

describe("fetchWithTimeout", () => {
  it("bricht einen hängenden Abruf nach dem Timeout mit AbortError ab", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = hangingFetch as any;
    const p = fetchWithTimeout("https://example.invalid/x", {}, 10000);
    mock.timers.tick(10000);
    await assert.rejects(p, (e: any) => e.name === "AbortError");
  });

  it("reicht eine schnelle Antwort durch", async () => {
    globalThis.fetch = (async () => ({ ok: true, status: 200 })) as any;
    const r = await fetchWithTimeout("https://example.invalid/x");
    assert.equal(r.status, 200);
  });
});

describe("withTimeout", () => {
  it("liefert nach Ablauf den Rückfallwert, sonst das Ergebnis", async () => {
    assert.equal(await withTimeout(new Promise<number>(() => {}), 10, "fallback"), "fallback");
    assert.equal(await withTimeout(Promise.resolve(1), 1000, "fallback"), 1);
    await assert.rejects(withTimeout(Promise.reject(new Error("x")), 1000, null), /x/);
  });
});

describe("BrightSky: hängender Dienst blockiert nicht", () => {
  it("fetchBrightSkyWeather wirft nach dem Timeout eine klare Meldung", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = hangingFetch as any;
    const p = fetchBrightSkyWeather(52.52, 13.4, "2026-11-15");
    mock.timers.tick(10000);
    await assert.rejects(p, /Zeitüberschreitung/);
  });

  it("fetchCurrentWind liefert nach dem Timeout null", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = hangingFetch as any;
    const p = fetchCurrentWind(52.52, 13.4);
    mock.timers.tick(10000);
    assert.equal(await p, null);
  });
});

describe("fetchWeather: hängender DFS-Dienst -> Open-Meteo-Rückfall", () => {
  it("liefert nach dem Timeout die Open-Meteo-Daten (DE-Standort)", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const urls: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      urls.push(String(url));
      if (String(url).includes("utm-service.dfs.de")) return hangingFetch(url, init);
      if (String(url).includes("open-meteo.com")) return { ok: true, status: 200, json: async () => OPEN_METEO } as any;
      throw new Error(`unerwartete URL ${url}`);
    }) as any;

    const p = fetchWeather(52.52, 13.4);
    await flush();
    assert.ok(urls.some((u) => u.includes("utm-service.dfs.de")), "DFS wurde zuerst angefragt");
    mock.timers.tick(10000);
    const data = await p;
    assert.ok(urls.some((u) => u.includes("open-meteo.com")), "Open-Meteo-Rückfall lief");
    assert.equal(data.forecasts.length, 1);
    assert.equal(data.forecasts[0].temperature, 8);
  });
});

describe("fetchKpIndex nutzt den Timeout", () => {
  it("wirft nach dem Timeout statt ewig zu hängen", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = hangingFetch as any;
    const p = fetchKpIndex();
    await flush();
    mock.timers.tick(10000);
    await assert.rejects(p);
  });
});
