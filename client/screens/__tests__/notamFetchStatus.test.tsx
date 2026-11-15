/**
 * Review-Fix 5: fetchNotams markiert Fehlschläge (HTTP 401 ohne Token,
 * Netzwerkfehler) mit failed:true; notamCountOrUnknown liefert dann null
 * ("unbekannt") statt 0 ("keine").
 */
jest.mock("@/lib/network", () => ({ isOfflineNow: () => false }));
jest.mock("@/lib/offlineStore", () => ({ getOfflinePackNotams: jest.fn(async () => null) }));
jest.mock("@/lib/dataCache", () => ({
  getCached: jest.fn(async () => null),
  setCache: jest.fn(async () => {}),
  makeCacheKey: (...p: any[]) => p.join(":"),
}));

import { fetchNotams, notamCountOrUnknown } from "@/lib/notams";

const realFetch = global.fetch;
afterEach(() => {
  (global as any).fetch = realFetch;
});

describe("fetchNotams Fehlerstatus", () => {
  it("HTTP 401 -> failed, Anzahl unbekannt (null)", async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const r = await fetchNotams(52.5, 13.4);
    expect(r.failed).toBe(true);
    expect(r.error).toBe("HTTP 401");
    expect(notamCountOrUnknown(r)).toBeNull();
  });

  it("Netzwerkfehler ohne Cache -> failed", async () => {
    (global as any).fetch = jest.fn(async () => {
      throw new Error("network down");
    });
    const r = await fetchNotams(52.5, 13.4);
    expect(r.failed).toBe(true);
    expect(notamCountOrUnknown(r)).toBeNull();
  });

  it("erfolgreiche leere Antwort -> 0 (bekannt: keine NOTAMs)", async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ rows: [], total: 0 }) }));
    const r = await fetchNotams(52.5, 13.4);
    expect(r.failed).toBeUndefined();
    expect(notamCountOrUnknown(r)).toBe(0);
  });
});
