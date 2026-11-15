/**
 * Review-Fix 4: Die Flächenabfrage für Planung/Pre-Check liefert zusätzlich die
 * Abdeckung. Fehlende Daten dürfen nicht als "keine Zonen" (grün) gelten.
 *
 * Jest statt tsx: geozones.ts hängt an React-Native-Modulen (AsyncStorage …).
 */
jest.mock("@/lib/network", () => ({ isOfflineNow: () => false }));
jest.mock("@/lib/offlineStore", () => ({ getOfflinePackFeatures: jest.fn(async () => null) }));

import { queryGeozonesInArea, queryGeozonesInAreaWithCoverage } from "@/lib/geozones";
import { __resetEd269StoreForTests } from "@/lib/geozoneDirect/ed269Store";

const AT_FEED = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[16.3, 48.15], [16.45, 48.15], [16.45, 48.25], [16.3, 48.25], [16.3, 48.15]]] },
      properties: { restriction: "PROHIBITED", name: "Wien-Zone" },
    },
  ],
};

const realFetch = global.fetch;
function mockFetch(impl: (url: string) => Promise<any>) {
  (global as any).fetch = jest.fn(async (input: any) => impl(typeof input === "string" ? input : String(input)));
}
const json = (body: any, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  __resetEd269StoreForTests();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  (global as any).fetch = realFetch;
  jest.restoreAllMocks();
});

describe("queryGeozonesInAreaWithCoverage", () => {
  it("leerer Gerätebestand (Download schlägt fehl) -> unavailable statt 'keine Zonen'", async () => {
    mockFetch(async () => json({}, false, 503));
    const r = await queryGeozonesInAreaWithCoverage(48.2, 16.37, 1, "AT");
    expect(r.zones).toEqual([]);
    expect(r.coverage).toBe("unavailable");
    expect(r.sources).toEqual([expect.objectContaining({ iso: "AT", status: "missing" })]);
  });

  it("CZ ohne Offline-Paket -> unavailable (missing), kein Netzabruf nötig", async () => {
    mockFetch(async () => json({}));
    const r = await queryGeozonesInAreaWithCoverage(50.08, 14.43, 1, "CZ");
    expect(r.zones).toEqual([]);
    expect(r.coverage).toBe("unavailable");
    expect(r.sources[0]).toEqual(expect.objectContaining({ iso: "CZ", status: "missing" }));
  });

  it("HU (keine automatische Prüfung) -> unavailable (unsupported)", async () => {
    mockFetch(async () => json({}));
    const r = await queryGeozonesInAreaWithCoverage(47.5, 19.04, 1, "HU");
    expect(r.coverage).toBe("unavailable");
    expect(r.sources[0]).toEqual(expect.objectContaining({ iso: "HU", status: "unsupported" }));
  });

  it("normaler gecachter Datensatz -> complete, Zonen mit Länderkennung", async () => {
    mockFetch(async () => json(JSON.parse(JSON.stringify(AT_FEED))));
    const r = await queryGeozonesInAreaWithCoverage(48.2, 16.37, 1, "AT");
    expect(r.coverage).toBe("complete");
    expect(r.sources).toEqual([expect.objectContaining({ iso: "AT", status: "ok" })]);
    expect(r.zones.map((z) => z.name)).toEqual(["Wien-Zone"]);
    expect(r.zones[0].country).toBe("AT");
  });

  it("alte Signatur queryGeozonesInArea liefert weiterhin ein Zonen-Array", async () => {
    mockFetch(async () => json(JSON.parse(JSON.stringify(AT_FEED))));
    const zones = await queryGeozonesInArea(48.2, 16.37, 1, "AT");
    expect(Array.isArray(zones)).toBe(true);
    expect(zones.map((z) => z.name)).toEqual(["Wien-Zone"]);
  });
});
