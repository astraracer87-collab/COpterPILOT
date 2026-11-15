/**
 * B4: Pre-Check (PreCheckOverview → … → Results) nutzt dieselbe Prüfkette wie
 * die Planung. ResultsScreen liest die von PreCheckOverview gespeicherten
 * Befunde (Kontext "precheck"), ergänzt Wetter/Nacht (Zeitbezug JETZT),
 * bildet das Urteil über aggregate() und speichert checkResults + verdict.
 * Ohne gespeicherte Befunde gilt der Rückfall auf die Route-Params.
 */
import React from "react";
import { Alert } from "react-native";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

const mockSessions: Record<string, any> = {};
jest.mock("@/lib/storage", () => ({
  getDrones: jest.fn(async () => []),
  getSettings: jest.fn(async () => ({})),
  getFlightSession: jest.fn(async (id: string) => mockSessions[id] ?? null),
  createFlightSession: jest.fn(async (s: any) => {
    mockSessions["new"] = { ...s, id: "new" };
    return mockSessions["new"];
  }),
  updateFlightSession: jest.fn(async (id: string, updates: any) => {
    mockSessions[id] = { ...(mockSessions[id] ?? {}), ...updates };
    return mockSessions[id];
  }),
}));
jest.mock("@/lib/trafficRecorder", () => ({ startRecording: jest.fn() }));
jest.mock("@/lib/aviationWeather", () => ({
  fetchNearestAirportMetar: jest.fn(async () => null),
  fetchCtrAirportMetar: jest.fn(async () => null),
}));
jest.mock("@/lib/ctrData", () => ({
  findCtrForLocation: () => null,
  getCtrDistanceKm: () => 0,
  assessCtrVmc: () => null,
}));

let mockRouteParams: any = {};
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn(), getParent: () => ({ goBack: jest.fn() }) }),
  useRoute: () => ({ params: mockRouteParams }),
}));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/components/Button", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    Button: ({ title, onPress, disabled }: any) =>
      React.createElement(
        Pressable,
        { onPress: disabled ? undefined : onPress, disabled, accessibilityLabel: String(title) },
        React.createElement(Text, null, title),
      ),
  };
});
jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: any) => React.createElement(View, props) };
});
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 0, Medium: 1, Heavy: 2 },
  NotificationFeedbackType: { Success: 0, Warning: 1 },
}));

import ResultsScreen from "../ResultsScreen";
import { classifyPlanningZones } from "@/lib/restrictionPlanning";
import { geozoneChecks, coverageChecks, notamChecks, RESTRICTION_NOGO_TEXT } from "../../../shared/checks";

const LIMITS = { maxWind: 10, maxGusts: 12, maxRain: 0.5, minTemp: -10, maxTemp: 40, minCloudCeiling: 0, minVisibility: 0 };
const WEATHER = {
  latitude: 52.52,
  longitude: 13.4,
  calculationTime: "2026-06-15T10:00:00Z",
  forecasts: [{
    timestamp: "2026-06-15T10:00:00Z",
    temperature: 20, humidity: 50, windSpeed: 2, windGust: 3, windDirection: 0,
    windAtAltitude: [], temperatureAtAltitude: [{ height: 2, value: 20 }],
    humidityAtAltitude: [{ height: 2, value: 50 }], cloudCoverAtAltitude: [],
    rain: 0, snow: 0, cloudCover: 10, pressure: 1013,
  }],
};
const PROHIBITED = { layerLabel: "Temporäre Betriebseinschränkungen", name: "Sperrzone", details: "", restriction: "PROHIBITED", country: "DE" };

const baseParams = (sessionId?: string, extra: any = {}) => ({
  latitude: 52.52,
  longitude: 13.4,
  hasRestrictions: false,
  weatherData: WEATHER,
  droneId: "drone-1",
  limits: LIMITS,
  sessionId,
  checklistCompleted: [],
  ...extra,
});

function precheckChecks(zones: any[], opts: { coverage?: any[]; notamFailed?: boolean } = {}) {
  const cls = classifyPlanningZones(zones, { isCoveredByAV: () => false });
  return [
    ...geozoneChecks({ context: "precheck", classes: [cls], hasRestrictions: zones.length > 0, restrictionStatus: zones.length ? "limited" : undefined }),
    ...coverageChecks({ context: "precheck", sources: opts.coverage ?? [{ iso: "DE", status: "ok" }] }),
    ...notamChecks({ context: "precheck", failed: !!opts.notamFailed, count: opts.notamFailed ? null : 0 }),
  ];
}

let tree: ReactTestRenderer | null = null;
async function renderResults(): Promise<ReactTestRenderer> {
  await act(async () => {
    tree = renderer.create(React.createElement(ResultsScreen));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return tree!;
}
function hasLabel(t: ReactTestRenderer, label: string) {
  return t.root.findAll((n) => typeof n.type !== "string" && n.props?.accessibilityLabel === label).length > 0;
}
async function press(t: ReactTestRenderer, label: string) {
  const btn = t.root.find((n) => typeof n.type !== "string" && n.props?.accessibilityLabel === label && typeof n.props.onPress === "function");
  await act(async () => {
    await btn.props.onPress();
  });
}

beforeEach(() => {
  // Nur Date fälschen (Tag in Berlin), Timer bleiben echt.
  jest.useFakeTimers({ now: new Date("2026-06-15T10:00:00Z"), doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask"] });
  for (const k of Object.keys(mockSessions)) delete mockSessions[k];
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => {
  if (tree) act(() => tree?.unmount());
  tree = null;
  jest.useRealTimers();
});

describe("Pre-Check-Ergebnis über die Prüfkette", () => {
  it("gespeichertes Flugverbot (precheck) → NO-GO-Bestätigung, verdict + checkResults gespeichert", async () => {
    mockSessions["s1"] = { id: "s1", checkResults: precheckChecks([PROHIBITED]), planning: {} };
    mockRouteParams = baseParams("s1");
    const t = await renderResults();
    expect(hasLabel(t, "Trotzdem fortfahren")).toBe(true);
    // Bestätigen und speichern.
    await act(async () => {
      t.root.findAll((n) => typeof n.type !== "string" && n.props?.accessibilityLabel === "Trotzdem fortfahren")[0].props.onPress();
    });
    await press(t, "Ja, fortfahren");
    await press(t, "Briefing speichern");
    const s = mockSessions["s1"];
    expect(s.status).toBe("nogo");
    expect(s.verdict).toBe("nogo");
    expect(s.reasons).toEqual(expect.arrayContaining([{ type: "nogo", message: RESTRICTION_NOGO_TEXT }]));
    expect(s.checkResults.every((c: any) => c.context === "precheck")).toBe(true);
    expect(s.checkResults.some((c: any) => c.category === "weather")).toBe(true);
  });

  it("NOTAM unbekannt / Abdeckung fehlt (precheck) → CAUTION", async () => {
    for (const opts of [{ notamFailed: true }, { coverage: [{ iso: "DE", status: "missing" }] }]) {
      for (const k of Object.keys(mockSessions)) delete mockSessions[k];
      mockSessions["s2"] = { id: "s2", checkResults: precheckChecks([], opts), planning: {} };
      mockRouteParams = baseParams("s2");
      const t = await renderResults();
      await press(t, "Briefing speichern");
      expect(mockSessions["s2"].status).toBe("caution");
      act(() => t.unmount());
      tree = null;
    }
  });

  it("alles frei → GO; Planungs-Befunde der Session bleiben erhalten", async () => {
    const planningCheck = { id: "geozone:prohibited", category: "geozone", severity: "nogo", title: RESTRICTION_NOGO_TEXT, detail: "", context: "planning" };
    mockSessions["s3"] = { id: "s3", checkResults: [planningCheck, ...precheckChecks([])], planning: {} };
    mockRouteParams = baseParams("s3");
    const t = await renderResults();
    await press(t, "Briefing speichern");
    const s = mockSessions["s3"];
    expect(s.status).toBe("go");
    expect(s.verdict).toBe("go");
    // Planungs-Befund nicht überschrieben, zählt aber nicht im Pre-Check.
    expect(s.checkResults).toEqual(expect.arrayContaining([planningCheck]));
  });

  it("ohne gespeicherte Befunde: Rückfall auf Route-Params (restrictionVerdict nogo)", async () => {
    mockRouteParams = baseParams(undefined, { hasRestrictions: true, restrictionVerdict: "nogo" });
    const t = await renderResults();
    expect(hasLabel(t, "Trotzdem fortfahren")).toBe(true);
  });
});
