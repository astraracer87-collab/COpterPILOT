/**
 * Länder-Nutzung „Aus“: Planung/Pre-Check (queryGeozonesInAreaWithCoverage)
 * fragen ein deaktiviertes Land nicht ab und melden es als Abdeckungslücke
 * „deaktiviert“ – auch als Nachbarland im Umkreis. Ein Tipp auf „Land
 * aktivieren (online)“ stellt es auf „Online“.
 *
 * Jest statt tsx: geozones.ts hängt an React-Native-Modulen.
 */
jest.mock("@/lib/network", () => ({ isOfflineNow: () => false }));
jest.mock("@/lib/offlineStore", () => ({
  getOfflinePackFeatures: jest.fn(async () => null),
  deleteOfflinePack: jest.fn(async () => {}),
  listOfflinePacks: jest.fn(async () => []),
}));
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));

import React from "react";
import renderer, { act } from "react-test-renderer";
import { queryGeozonesInAreaWithCoverage } from "@/lib/geozones";
import { __resetEd269StoreForTests } from "@/lib/geozoneDirect/ed269Store";
import { __resetCountryUsageForTests, __setCountryUsageForTests, getCountryUsage } from "@/lib/countryUsage";
import { __setCountryDataEnvForTests } from "@/lib/countryUsageData";
import { coverageChecks } from "../../../shared/checks";
import { EnableCountryButtons } from "@/components/EnableCountryButtons";

const realFetch = global.fetch;
let fetchCalls: string[] = [];

beforeEach(() => {
  __resetEd269StoreForTests();
  __resetCountryUsageForTests(null);
  fetchCalls = [];
  (global as any).fetch = jest.fn(async (input: any) => {
    fetchCalls.push(String(input));
    return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
  });
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  (global as any).fetch = realFetch;
  __resetCountryUsageForTests(undefined);
  __setCountryDataEnvForTests(null);
  jest.restoreAllMocks();
});

describe("Abdeckung bei deaktiviertem Land", () => {
  it("Standortland aus → kein Abruf, Quelle „disabled“, Befund mit deutschem Text und Aktion", async () => {
    __setCountryUsageForTests({ AT: "off" });
    const r = await queryGeozonesInAreaWithCoverage(48.2, 16.37, 1, "AT");
    expect(fetchCalls).toEqual([]);
    expect(r.zones).toEqual([]);
    expect(r.coverage).toBe("unavailable");
    expect(r.sources).toEqual([expect.objectContaining({ iso: "AT", status: "disabled" })]);
    const checks = coverageChecks({ context: "precheck", sources: r.sources, countryLabel: () => "Österreich" });
    expect(checks[0]).toMatchObject({
      severity: "unknown",
      title: "Geozonen für Österreich sind deaktiviert – Land aktivieren oder manuell prüfen.",
      action: { kind: "enable-country", iso: "AT", label: "Land aktivieren (online)" },
    });
  });

  it("Nachbarland im Umkreis aus → als „disabled“ gemeldet, nicht abgefragt", async () => {
    // Salzburg/Freilassing: AT und DE im 10-km-Umkreis; DE online (Abruf scheitert im Test), AT aus
    __setCountryUsageForTests({ DE: "online", AT: "off" });
    const r = await queryGeozonesInAreaWithCoverage(47.8, 12.98, 10, "AT");
    const byIso = Object.fromEntries(r.sources.map((s) => [s.iso, s.status]));
    expect(byIso.AT).toBe("disabled");
    expect(byIso.DE).toBeDefined();
    expect(byIso.DE).not.toBe("disabled");
    expect(r.coverage).not.toBe("complete");
  });

  it("„Land aktivieren (online)“ stellt das Land auf Online", async () => {
    __setCountryUsageForTests({ AT: "off" });
    __setCountryDataEnvForTests({ isOffline: () => true });
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<EnableCountryButtons isos={["AT"]} />);
    });
    const btn = tree.root.findByProps({ testID: "enable-country-AT" });
    await act(async () => {
      await btn.props.onPress();
    });
    expect(getCountryUsage("AT")).toBe("online");
    act(() => tree.unmount());
  });
});
