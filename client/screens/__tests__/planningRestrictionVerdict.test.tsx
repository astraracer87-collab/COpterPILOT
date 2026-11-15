/**
 * Fluss-Test (Review-Fix 1): Das Ergebnis der Einschränkungs-Stufe
 * (hasRestrictions / restrictionStatus / restrictionNotes) muss
 *   1) von PlanningDetails in der Flug-Session gespeichert werden (neue UND
 *      bestehende Session) und
 *   2) in PlanningResult in das Gesamturteil einfließen.
 *
 * Vorher schrieb PlanningDetails immer hasRestrictions:false und PlanningResult
 * rief assessWeather(..., false, undefined, ...) auf — eine Route mit
 * ungeklärter Geozone (keine AV, keine Ausnahme) ergab dadurch GO.
 *
 * Aufbau: Beide Screens werden direkt gerendert, die Storage-Schicht durch einen
 * In-Memory-Speicher ersetzt. Datum liegt > 24 h in der Zukunft, damit
 * PlanningDetails keine Wetterabfrage startet (geparkte Planung).
 */
import React from "react";
import { Alert } from "react-native";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

// --- In-Memory-Session-Speicher --------------------------------------------
const mockSessions: Record<string, any> = {};
let mockIdCounter = 0;
jest.mock("@/lib/storage", () => ({
  getDrone: jest.fn(async () => ({
    id: "drone-1",
    name: "Testdrohne",
    manufacturer: "DJI",
    model: "Mini",
    classMark: "C0",
    droneType: "standard",
    limits: { maxWind: 10, maxGusts: 12, maxRain: 0.5, minTemp: -10, maxTemp: 40, minCloudCeiling: 0, minVisibility: 0 },
  })),
  getDrones: jest.fn(async () => []),
  getPilotProfile: jest.fn(async () => null),
  getFlightSession: jest.fn(async (id: string) => mockSessions[id] ?? null),
  createFlightSession: jest.fn(async (s: any) => {
    const id = `s-${++mockIdCounter}`;
    mockSessions[id] = { ...s, id, createdAt: "", updatedAt: "" };
    return mockSessions[id];
  }),
  updateFlightSession: jest.fn(async (id: string, updates: any) => {
    mockSessions[id] = { ...(mockSessions[id] ?? {}), ...updates };
    return mockSessions[id];
  }),
}));

let mockRouteParams: any = {};
const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return {
    useNavigation: () => ({
      navigate: mockNavigate,
      addListener: () => () => {},
      getParent: () => ({ dispatch: mockDispatch, goBack: jest.fn() }),
      popToTop: jest.fn(),
      canGoBack: () => false,
      goBack: jest.fn(),
    }),
    useRoute: () => ({ params: mockRouteParams }),
    useFocusEffect: (cb: any) => React.useEffect(() => cb(), []),
    CommonActions: { reset: (x: any) => ({ type: "RESET", payload: x }) },
  };
});
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
  ImpactFeedbackStyle: { Light: 0, Medium: 1 },
  NotificationFeedbackType: { Success: 0, Warning: 1 },
}));
jest.mock("@/lib/weather", () => ({
  fetchWeatherForecastWithSource: jest.fn(async () => ({ data: null, source: null })),
  fetchHourlyForecasts: jest.fn(async () => ({ slots: [], source: null })),
}));
jest.mock("@/lib/kpindex", () => ({
  fetchKpIndex: jest.fn(async () => null),
  getKpLabel: () => "",
}));
let mockNotamResult: any = { notams: [], total: 0, queriedCodes: [] };
jest.mock("@/lib/notams", () => {
  const actual = jest.requireActual("@/lib/notams");
  return {
    fetchNotams: jest.fn(async () => mockNotamResult),
    notamCountOrUnknown: actual.notamCountOrUnknown,
    NOTAM_STATUS_UNKNOWN_TEXT: actual.NOTAM_STATUS_UNKNOWN_TEXT,
  };
});
jest.mock("@/lib/flightPlanningMode", () => ({
  getFlightPlanningMode: () => "planning",
  consumeFlightPlanningMode: () => "planning",
}));
jest.mock("@/components/HourlyForecastTable", () => () => null);
jest.mock("@/components/SunArcChart", () => () => null);
jest.mock("@/lib/dataSource", () => ({ useShowDataSources: () => false }));

import PlanningDetailsScreen from "../PlanningDetailsScreen";
import PlanningResultScreen from "../PlanningResultScreen";

let currentTree: ReactTestRenderer | null = null;
async function render(Comp: any): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(React.createElement(Comp));
  });
  // Effekte (Session-/Drohnen-Laden) abschließen lassen.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  currentTree = tree;
  return tree;
}

async function press(tree: ReactTestRenderer, label: string) {
  const btn = tree.root.find(
    (n) => typeof n.type !== "string" && n.props?.accessibilityLabel === label && typeof n.props.onPress === "function",
  );
  await act(async () => {
    await btn.props.onPress();
  });
}

const FUTURE_DATE = "2099-06-15";
const NOTES = "Ausnahmegenehmigung für: Bahnanlage X — Pilotnotiz";

const baseDetailsParams = {
  droneId: "drone-1",
  latitude: 52.52,
  longitude: 13.4,
  locationName: "Berlin",
  countryIso: "DE",
  plannedDate: FUTURE_DATE,
  plannedTime: "12:00",
  endTime: "13:00",
  maxAltitude: 100,
};

const resultParams = (sessionId: string) => ({
  droneId: "drone-1",
  latitude: 52.52,
  longitude: 13.4,
  locationName: "Berlin",
  plannedDate: FUTURE_DATE,
  plannedTime: "12:00",
  forecastWeather: {
    temperature: 20,
    windSpeed: 2,
    windGust: 3,
    rain: 0,
    cloudCover: 10,
    humidity: 50,
  },
  limits: { maxWind: 10, maxGusts: 12, maxRain: 0.5, minTemp: -10, maxTemp: 40, minCloudCeiling: 0, minVisibility: 0 },
  maxAltitude: 100,
  checklistCompleted: [],
  sessionId,
  isFpvFlight: false,
});

beforeEach(() => {
  mockNotamResult = { notams: [], total: 0, queriedCodes: [] };
  for (const k of Object.keys(mockSessions)) delete mockSessions[k];
  mockNavigate.mockClear();
  mockDispatch.mockClear();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  if (currentTree) {
    act(() => currentTree?.unmount());
    currentTree = null;
  }
});

async function planThroughDetailsAndResult(detailsParams: any): Promise<any> {
  mockRouteParams = { ...baseDetailsParams, ...detailsParams };
  const details = await render(PlanningDetailsScreen);
  await press(details, "In Übersicht speichern");
  act(() => details.unmount());
  currentTree = null;

  const sessionId = Object.keys(mockSessions)[0];
  expect(sessionId).toBeDefined();

  mockRouteParams = resultParams(sessionId);
  const result = await render(PlanningResultScreen);
  await press(result, "Planung speichern");
  return mockSessions[sessionId];
}

describe("Einschränkungs-Ergebnis erreicht das Gesamturteil", () => {
  it("hasRestrictions:true + ungeklärter Status → kein GO, Notizen in der Session", async () => {
    const session = await planThroughDetailsAndResult({
      hasRestrictions: true,
      restrictionStatus: undefined,
      restrictionNotes: NOTES,
    });
    expect(session.hasRestrictions).toBe(true);
    expect(session.restrictionStatus).toBeUndefined();
    expect(session.restrictionNotes).toBe(NOTES);
    expect(session.status).not.toBe("go");
    expect(session.status).toBe("caution");
    // Geozonen-Warnung wird als CAUTION-Grund protokolliert, nicht als GO.
    const geoReason = session.reasons.find((r: any) => /Geozonen/.test(r.message));
    expect(geoReason).toEqual(expect.objectContaining({ type: "caution" }));
    expect(session.reasons.every((r: any) => r.type !== "go")).toBe(true);
  });

  it("Kontrolle: keine Einschränkungen + gutes Wetter → GO", async () => {
    const session = await planThroughDetailsAndResult({
      hasRestrictions: false,
      restrictionNotes: undefined,
    });
    expect(session.hasRestrictions).toBe(false);
    expect(session.status).toBe("go");
  });

  it("hasRestrictions:true + Genehmigung (approved) → GO bleibt möglich", async () => {
    const session = await planThroughDetailsAndResult({
      hasRestrictions: true,
      restrictionStatus: "approved",
    });
    expect(session.restrictionStatus).toBe("approved");
    expect(session.status).toBe("go");
  });

  it("bestehende Session: Einschränkungs-Ergebnis wird ebenfalls gespeichert", async () => {
    mockSessions["existing"] = {
      id: "existing",
      droneId: "drone-1",
      hasRestrictions: false,
      restrictionStatus: "approved",
      status: "go",
      planning: { plannedDate: FUTURE_DATE, plannedTime: "12:00", checklistCompleted: [] },
    };
    mockRouteParams = {
      ...baseDetailsParams,
      sessionId: "existing",
      hasRestrictions: true,
      restrictionStatus: undefined,
      restrictionNotes: NOTES,
    };
    const details = await render(PlanningDetailsScreen);
    await press(details, "In Übersicht speichern");
    expect(mockSessions["existing"].hasRestrictions).toBe(true);
    // Veralteter "approved"-Status darf nicht stehen bleiben.
    expect(mockSessions["existing"].restrictionStatus).toBeUndefined();
    expect(mockSessions["existing"].restrictionNotes).toBe(NOTES);
  });
});

// B2: Policy-Urteil. Eine aktive Flugverbotszone (PROHIBITED) ohne
// dokumentierte Begründung ist NO-GO – auch wenn allgemein "Genehmigung liegt
// vor" gewählt wurde. Mit Begründung (Urteil caution) bleibt es beim bisherigen
// Einschränkungs-Pfad.
describe("Policy-Urteil (restrictionVerdict) erreicht das Gesamturteil", () => {
  const { RESTRICTION_NOGO_TEXT } = jest.requireActual("@/lib/assessment");

  function hasLabel(tree: ReactTestRenderer, label: string): boolean {
    return tree.root.findAll((n) => typeof n.type !== "string" && n.props?.accessibilityLabel === label).length > 0;
  }

  it("Flugverbot ohne Begründung → NO-GO, Speichern erst nach bewusster Übersteuerung", async () => {
    mockRouteParams = {
      ...baseDetailsParams,
      hasRestrictions: true,
      restrictionStatus: "approved",
      restrictionVerdict: "nogo",
      restrictionNotes: NOTES,
    };
    const details = await render(PlanningDetailsScreen);
    await press(details, "In Übersicht speichern");
    act(() => details.unmount());
    currentTree = null;
    const sessionId = Object.keys(mockSessions)[0];
    expect(mockSessions[sessionId].restrictionVerdict).toBe("nogo");

    mockRouteParams = resultParams(sessionId);
    const result = await render(PlanningResultScreen);
    // NO-GO-Banner statt "Planung speichern".
    expect(hasLabel(result, "Planung speichern")).toBe(false);
    expect(hasLabel(result, "Trotzdem durchführen")).toBe(true);

    // Bewusst übersteuern (Alert-Bestätigung) und speichern.
    (Alert.alert as jest.Mock).mockImplementation((_t: string, _m: string, buttons: any[]) => {
      buttons?.find((b) => b.style === "destructive")?.onPress?.();
    });
    await press(result, "Trotzdem durchführen");
    await press(result, "Planung speichern");
    const session = mockSessions[sessionId];
    expect(session.status).toBe("nogo");
    expect(session.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ type: "nogo", message: RESTRICTION_NOGO_TEXT })]));
    expect(session.planning.noGoOverride).toEqual(expect.objectContaining({ originalStatus: "nogo" }));
  });

  it("Flugverbot mit Begründung (caution) → kein NO-GO, mindestens CAUTION", async () => {
    const session = await planThroughDetailsAndResult({
      hasRestrictions: true,
      restrictionStatus: undefined,
      restrictionVerdict: "caution",
      restrictionNotes: "Flugverbot bewusst übersteuert: Zone X (Begründung: Sondergenehmigung)",
    });
    expect(session.restrictionVerdict).toBe("caution");
    expect(session.status).toBe("caution");
  });

  it("nur Info-Zonen (info) + gutes Wetter → GO", async () => {
    const session = await planThroughDetailsAndResult({
      hasRestrictions: false,
      restrictionVerdict: "info",
    });
    expect(session.status).toBe("go");
  });

  it("bestehende Session: veraltetes nogo wird bei neuer Einstufung überschrieben", async () => {
    mockSessions["old"] = {
      id: "old",
      droneId: "drone-1",
      hasRestrictions: true,
      restrictionVerdict: "nogo",
      status: "nogo",
      planning: { plannedDate: FUTURE_DATE, plannedTime: "12:00", checklistCompleted: [] },
    };
    mockRouteParams = { ...baseDetailsParams, sessionId: "old", hasRestrictions: false };
    const details = await render(PlanningDetailsScreen);
    await press(details, "In Übersicht speichern");
    expect(mockSessions["old"].restrictionVerdict).toBeUndefined();
  });
});

// Review-Fix 5: Fehlgeschlagene NOTAM-Abfrage (z. B. Autorouter HTTP 401 ohne
// Token) darf nicht als grünes "Keine im Umkreis" erscheinen und nicht als
// sauberes Ergebnis ins Urteil eingehen.
describe("NOTAM-Status unbekannt", () => {
  const soonDate = () => {
    const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  };

  function textOf(tree: ReactTestRenderer, testID: string): string {
    const node = tree.root.find((n) => n.props?.testID === testID && typeof n.type !== "string");
    const flat = (c: any): string => (Array.isArray(c) ? c.map(flat).join("") : c == null ? "" : typeof c === "object" ? flat(c.props?.children) : String(c));
    return flat(node.props.children);
  }

  it("HTTP 401 -> orange 'NOTAM-Status unbekannt', nicht 'Keine im Umkreis'; Session markiert", async () => {
    const { NOTAM_STATUS_UNKNOWN_TEXT } = jest.requireActual("@/lib/notams");
    mockNotamResult = { notams: [], total: 0, queriedCodes: ["EDWW"], error: "HTTP 401", failed: true };
    const { date, time } = soonDate();
    mockRouteParams = { ...baseDetailsParams, plannedDate: date, plannedTime: time, endTime: time, hasRestrictions: false };
    const details = await render(PlanningDetailsScreen);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(textOf(details, "notam-quick-status")).toBe(NOTAM_STATUS_UNKNOWN_TEXT);
    expect(textOf(details, "notam-quick-status")).not.toContain("Keine im Umkreis");
    await press(details, "Weiter zur Checkliste");
    const sessionId = Object.keys(mockSessions)[0];
    expect(mockSessions[sessionId].planning.notamStatusUnknown).toBe(true);
  });

  it("erfolgreiche Abfrage ohne NOTAMs -> 'Keine im Umkreis'", async () => {
    mockNotamResult = { notams: [], total: 0, queriedCodes: ["EDWW"] };
    const { date, time } = soonDate();
    mockRouteParams = { ...baseDetailsParams, plannedDate: date, plannedTime: time, endTime: time };
    const details = await render(PlanningDetailsScreen);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(textOf(details, "notam-quick-status")).toBe("Keine im Umkreis");
  });

  it("PlanningResult: notamStatusUnknown hebt GO auf CAUTION und protokolliert den Grund", async () => {
    const { NOTAM_STATUS_UNKNOWN_TEXT } = jest.requireActual("@/lib/notams");
    mockSessions["s-notam"] = {
      id: "s-notam",
      droneId: "drone-1",
      hasRestrictions: false,
      status: "caution",
      planning: { plannedDate: FUTURE_DATE, plannedTime: "12:00", checklistCompleted: [], notamStatusUnknown: true },
    };
    mockRouteParams = resultParams("s-notam");
    const result = await render(PlanningResultScreen);
    await press(result, "Planung speichern");
    expect(mockSessions["s-notam"].status).toBe("caution");
    expect(mockSessions["s-notam"].reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "caution", message: NOTAM_STATUS_UNKNOWN_TEXT })]),
    );
  });
});

// ---------------------------------------------------------------------------
// B4: Prüfkette. PlanningRestrictions baut Geozonen-/Abdeckungs-Befunde
// (dieselben Builder wie der Screen), PlanningDetails speichert sie zusammen
// mit dem NOTAM-Befund in der Session, PlanningResult ergänzt Wetter/Nacht,
// bildet das Urteil über aggregate() und speichert checkResults + verdict.
// ---------------------------------------------------------------------------
describe("Prüfkette (B4): CheckResults in der Session und Urteil", () => {
  const { classifyPlanningZones } = jest.requireActual("@/lib/restrictionPlanning");
  const checks = jest.requireActual("../../../shared/checks");
  const { RESTRICTION_NOGO_TEXT } = jest.requireActual("@/lib/assessment");

  const PROHIBITED_ZONE = {
    layerLabel: "Temporäre Betriebseinschränkungen",
    name: "Sperrzone Test",
    details: "",
    restriction: "PROHIBITED",
    country: "DE",
  };

  function restrictionStage(opts: {
    zones?: any[];
    overrideReason?: string;
    coverage?: any[];
    hasRestrictions?: boolean;
  }) {
    const cls = classifyPlanningZones(opts.zones ?? [], {
      isCoveredByAV: () => false,
      overrideReason: () => opts.overrideReason,
    });
    return [
      ...checks.geozoneChecks({
        context: "planning",
        classes: [cls],
        overrideOf: () => (opts.overrideReason ? { reason: opts.overrideReason, at: "2099-01-01T00:00:00.000Z" } : null),
        hasRestrictions: opts.hasRestrictions ?? (opts.zones ?? []).length > 0,
        restrictionStatus: undefined,
      }),
      ...checks.coverageChecks({
        context: "planning",
        sources: opts.coverage ?? [{ iso: "DE", status: "ok" }],
        primaryIso: "DE",
        countryLabel: (iso: string) => (iso === "DE" ? "Deutschland" : iso),
      }),
    ];
  }

  function hasLabel(tree: ReactTestRenderer, label: string): boolean {
    return tree.root.findAll((n) => typeof n.type !== "string" && n.props?.accessibilityLabel === label).length > 0;
  }

  async function planWithChecks(checkResults: any[], details: any = {}, result: any = {}) {
    mockRouteParams = {
      ...baseDetailsParams,
      hasRestrictions: checkResults.some((c) => c.category === "geozone" && c.severity !== "info"),
      checkResults,
      ...details,
    };
    const d = await render(PlanningDetailsScreen);
    await press(d, "In Übersicht speichern");
    act(() => d.unmount());
    currentTree = null;
    const sessionId = Object.keys(mockSessions)[0];
    // Session enthält die Befunde der Einschränkungs-Stufe schon nach Details.
    expect(mockSessions[sessionId].checkResults).toEqual(expect.arrayContaining(checkResults));
    mockRouteParams = { ...resultParams(sessionId), ...result };
    const tree = await render(PlanningResultScreen);
    return { sessionId, tree };
  }

  it("PROHIBITED ohne Override → NO-GO; Session enthält checkResults und verdict", async () => {
    const { sessionId, tree } = await planWithChecks(restrictionStage({ zones: [PROHIBITED_ZONE] }));
    expect(hasLabel(tree, "Trotzdem durchführen")).toBe(true);
    (Alert.alert as jest.Mock).mockImplementation((_t: string, _m: string, buttons: any[]) => {
      buttons?.find((b) => b.style === "destructive")?.onPress?.();
    });
    await press(tree, "Trotzdem durchführen");
    await press(tree, "Planung speichern");
    const s = mockSessions[sessionId];
    expect(s.status).toBe("nogo");
    expect(s.verdict).toBe("nogo");
    const prohibited = s.checkResults.find((c: any) => c.id === "geozone:prohibited");
    expect(prohibited).toEqual(expect.objectContaining({ severity: "nogo", context: "planning", zoneRefs: ["Sperrzone Test"], overridable: true }));
    expect(prohibited.overriddenBy).toBeUndefined();
    expect(s.reasons).toEqual(expect.arrayContaining([{ type: "nogo", message: RESTRICTION_NOGO_TEXT }]));
    // Wetter-/Nacht-Befunde ergänzt PlanningResult.
    expect(s.checkResults.some((c: any) => c.category === "weather")).toBe(true);
  });

  it("PROHIBITED mit Override → CAUTION, Begründung als overriddenBy und Grund gespeichert", async () => {
    const { sessionId, tree } = await planWithChecks(
      restrictionStage({ zones: [PROHIBITED_ZONE], overrideReason: "Sondergenehmigung Az. 1" }),
    );
    expect(hasLabel(tree, "Trotzdem durchführen")).toBe(false);
    await press(tree, "Planung speichern");
    const s = mockSessions[sessionId];
    expect(s.status).toBe("caution");
    expect(s.verdict).toBe("caution");
    const ov = s.checkResults.find((c: any) => c.id.startsWith("geozone:prohibited-override"));
    expect(ov).toEqual(expect.objectContaining({ severity: "nogo", overriddenBy: { reason: "Sondergenehmigung Az. 1", at: "2099-01-01T00:00:00.000Z" } }));
    expect(s.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "caution", message: expect.stringContaining("Begründung: Sondergenehmigung Az. 1") })]),
    );
    expect(s.reasons.some((r: any) => r.type === "nogo")).toBe(false);
  });

  it("Abdeckung nicht verfügbar → CAUTION mit Abdeckungs-Grund", async () => {
    const { sessionId, tree } = await planWithChecks(
      restrictionStage({ coverage: [{ iso: "DE", status: "missing" }] }),
    );
    await press(tree, "Planung speichern");
    const s = mockSessions[sessionId];
    expect(s.status).toBe("caution");
    expect(s.checkResults).toEqual(expect.arrayContaining([expect.objectContaining({ category: "coverage", severity: "unknown" })]));
    expect(s.reasons).toEqual(
      expect.arrayContaining([{ type: "caution", message: "Geozonen-Daten für Deutschland nicht verfügbar – Zonen bitte manuell prüfen." }]),
    );
  });

  it("DE ohne Wohngrundstücke (partial) → CAUTION", async () => {
    const { sessionId, tree } = await planWithChecks(
      restrictionStage({ coverage: [{ iso: "DE", status: "partial", note: "Wohngrundstücke offline nicht gespeichert – nicht geprüft" }] }),
    );
    await press(tree, "Planung speichern");
    expect(mockSessions[sessionId].status).toBe("caution");
    expect(mockSessions[sessionId].reasons[0].message).toContain("unvollständig: Wohngrundstücke offline nicht gespeichert");
  });

  it("NOTAM-Status unbekannt → CAUTION, NOTAM-Befund in der Session", async () => {
    const { NOTAM_STATUS_UNKNOWN_TEXT } = jest.requireActual("@/lib/notams");
    mockNotamResult = { notams: [], total: 0, queriedCodes: ["EDWW"], error: "HTTP 401", failed: true };
    const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    mockRouteParams = {
      ...baseDetailsParams,
      plannedDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      plannedTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      endTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      hasRestrictions: false,
      checkResults: restrictionStage({}),
    };
    const details = await render(PlanningDetailsScreen);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await press(details, "Weiter zur Checkliste");
    act(() => details.unmount());
    currentTree = null;
    const sessionId = Object.keys(mockSessions)[0];
    expect(mockSessions[sessionId].checkResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "notam:status", severity: "unknown", context: "planning" })]),
    );
    mockRouteParams = resultParams(sessionId);
    const result = await render(PlanningResultScreen);
    await press(result, "Planung speichern");
    expect(mockSessions[sessionId].status).toBe("caution");
    expect(mockSessions[sessionId].reasons).toEqual(
      expect.arrayContaining([{ type: "caution", message: NOTAM_STATUS_UNKNOWN_TEXT }]),
    );
  });

  it("alles frei → GO; Session enthält checkResults (Info-Befunde) und verdict go", async () => {
    const { sessionId, tree } = await planWithChecks(restrictionStage({}));
    await press(tree, "Planung speichern");
    const s = mockSessions[sessionId];
    expect(s.status).toBe("go");
    expect(s.verdict).toBe("go");
    const ids = s.checkResults.map((c: any) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["geozone:status", "weather:ok"]));
    expect(s.checkResults.every((c: any) => c.severity === "info")).toBe(true);
    expect(s.reasons).toEqual([{ type: "go", message: checks.ALL_CHECKS_CLEAR_TEXT }]);
  });

  it("Nacht in DE (Blinklicht-Pflicht) → CAUTION nach bestehender Regel", async () => {
    const { sessionId, tree } = await planWithChecks(restrictionStage({}), { plannedTime: "00:30" }, { plannedTime: "00:30" });
    await press(tree, "Planung speichern");
    const s = mockSessions[sessionId];
    expect(s.status).toBe("caution");
    expect(s.checkResults).toEqual(expect.arrayContaining([expect.objectContaining({ category: "night", severity: "caution" })]));
  });

  it("Nacht in FR (Préfecture-Freigabe) → NO-GO nach bestehender Regel; Land aus dem Standort", async () => {
    const paris = { latitude: 48.85, longitude: 2.35, locationName: "Paris" };
    // countryIso bewusst falsch ("DE"): die Nachtregel folgt dem Standort (I6).
    const { sessionId, tree } = await planWithChecks(
      restrictionStage({}),
      { ...paris, countryIso: "DE", plannedTime: "00:30" },
      { ...paris, countryIso: "DE", plannedTime: "00:30" },
    );
    expect(hasLabel(tree, "Trotzdem durchführen")).toBe(true);
    (Alert.alert as jest.Mock).mockImplementation((_t: string, _m: string, buttons: any[]) => {
      buttons?.find((b) => b.style === "destructive")?.onPress?.();
    });
    await press(tree, "Trotzdem durchführen");
    await press(tree, "Planung speichern");
    const s = mockSessions[sessionId];
    expect(s.status).toBe("nogo");
    expect(s.checkResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "night", severity: "nogo", title: expect.stringContaining("FR") })]),
    );
  });
});
