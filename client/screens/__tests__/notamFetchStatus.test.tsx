/**
 * Review-Fix 5: fetchNotams markiert Fehlschläge (HTTP 401 ohne Token,
 * Netzwerkfehler) mit failed:true; notamCountOrUnknown liefert dann null
 * ("unbekannt") statt 0 ("keine").
 */
jest.mock("@/lib/network", () => ({ isOfflineNow: () => false }));
jest.mock("@/lib/offlineStore", () => ({ readPackData: jest.fn(async () => null) }));
// Teil A: Offline-Speicher der NOTAMs (hier leer)
jest.mock("@/lib/offlineResultCache", () => ({
  getOfflineResult: jest.fn(async () => null),
  putOfflineResult: jest.fn(async () => {}),
}));

import { fetchNotams, notamCountOrUnknown } from "@/lib/notams";
import { getOfflineResult } from "@/lib/offlineResultCache";

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

  it("Teil A: Netzwerkfehler mit gespeichertem Stand < 24 h -> nur noch gültige NOTAMs mit Stand, nicht failed", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    (getOfflineResult as jest.Mock).mockImplementationOnce(async () => ({
      fetchedAt: Date.now() - 3 * 3_600_000,
      data: { notams: [
        { id: 1, series: "A", number: 1, itema: ["EDMM"], iteme: "alt", startvalidity: nowSec - 7200, endvalidity: nowSec - 60 },
        { id: 2, series: "A", number: 2, itema: ["EDMM"], iteme: "gültig", startvalidity: nowSec - 7200, endvalidity: nowSec + 3600 },
      ] },
    }));
    (global as any).fetch = jest.fn(async () => {
      throw new Error("network down");
    });
    const r = await fetchNotams(48.1, 11.5);
    expect(r.failed).toBeUndefined();
    expect(r.notams.map((n) => n.id)).toEqual([2]);
    expect(r.offline?.cached).toBe(true);
    expect(notamCountOrUnknown(r)).toBe(1);
  });

  it("Teil A: gespeicherter Stand ≥ 24 h wird nicht verwendet -> failed", async () => {
    (getOfflineResult as jest.Mock).mockImplementationOnce(async () => ({
      fetchedAt: Date.now() - 25 * 3_600_000,
      data: { notams: [] },
    }));
    (global as any).fetch = jest.fn(async () => {
      throw new Error("network down");
    });
    const r = await fetchNotams(48.1, 11.5);
    expect(r.failed).toBe(true);
  });

  it("erfolgreiche leere Antwort -> 0 (bekannt: keine NOTAMs)", async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ rows: [], total: 0 }) }));
    const r = await fetchNotams(52.5, 13.4);
    expect(r.failed).toBeUndefined();
    expect(notamCountOrUnknown(r)).toBe(0);
  });
});
