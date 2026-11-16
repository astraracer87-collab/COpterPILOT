/**
 * Gebietsübersicht der Flugplanung (PlanningAreaOverviewScreen): Reiter
 * Geozonen/NOTAMs/Hinweise am rechten Rand, Hinweis-Chip, Panels mit den
 * Einträgen im Umkreis, Offline-Hinweis „nicht verfügbar (offline)“ und
 * „Weiter“ zum nächsten Planungsschritt (Daten aus gemocktem useAreaOverview).
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 960, height: 540, scale: 2, fontScale: 1 }),
}));
const mockNavigate = jest.fn();
let mockParams: any = {
  droneId: "drone-1", latitude: 50.0, longitude: 8.0, radiusKm: 0.5, countryIso: "DE", locationName: "Testort", next: "datetime",
};
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, addListener: () => () => {} }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 56 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
  SafeAreaInsetsContext: require("react").createContext(null),
}));
jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: any) => React.createElement(View, props) };
});
let mockMapProps: any = null;
jest.mock("@/components/MapPicker", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MapPicker = React.forwardRef((props: any, ref: any) => {
    mockMapProps = props;
    React.useImperativeHandle(ref, () => ({ animateToRegion: jest.fn() }));
    return React.createElement(View, { testID: "mock-map-picker" });
  });
  MapPicker.displayName = "MapPicker";
  return { __esModule: true, default: MapPicker };
});
jest.mock("@/lib/dataSource", () => ({ useShowDataSources: () => false }));
jest.mock("@/lib/ed269", () => ({ ED269_SOURCE_LABELS: {} }));
jest.mock("@/lib/notams", () => ({
  formatAltitude: (s: string | null | undefined) => s ?? null,
  formatNotamDate: (n: number) => String(n),
  getNotamId: (n: any) => `${n.series}${n.number}`,
  getNotamTypeLabel: () => "Luftraum",
}));

const ring: [number, number][] = [[49.999, 7.999], [49.999, 8.001], [50.001, 8.001], [50.001, 7.999]];
let mockData: any;
function baseData() {
  return {
    offline: false,
    zonesState: "ok",
    zoneCoverage: "complete",
    zones: [{ layerLabel: "Wohngrundstücke", name: "Wohngebiet Test", details: "Zuständigkeit: Landesluftfahrtbehörde", polygonRings: [ring], restriction: "REQ_AUTHORISATION", country: "DE", altitudeLabel: "GND – 100 m AGL" }],
    tempZones: [],
    notamState: "ok",
    notamsLocal: [{ id: 7, series: "A", number: 1234, iteme: "CRANE ERECTED", startvalidity: 1, endvalidity: 2, lat: 50.0, lon: 8.0, radius: 1, itema: [] }],
    notamsWide: [],
    dipulState: "ok",
    dipul: [],
    obstaclesState: "ok",
    obstacles: { total: 1, byKind: [{ kind: "wind", label: "Windkraftanlage", count: 1, maxHeightM: 200 }], powerLines: 0, tallest: null },
    poiState: "ok",
    pois: [],
    hints: [
      { id: "osm:node1", level: "caution", poi: { id: "osm:node1", kind: "helipad", lat: 50.01, lon: 8.01, rescue: true, source: "osm" }, distanceM: 1200, bearing: 45, direction: "NO", insideRadius: false, title: "Rettungshubschrauber-Landeplatz Klinikum", distanceText: "1,2 km NO", text: "Vorsicht" },
      { id: "db:EDFE", level: "info", poi: { id: "db:EDFE", kind: "airfield", lat: 50.02, lon: 8.02, source: "airportdb" }, distanceM: 2400, bearing: 45, direction: "NO", insideRadius: false, title: "Flugplatz Egelsbach", distanceText: "2,4 km NO", text: "Info" },
    ],
  };
}
jest.mock("@/hooks/useAreaOverview", () => ({ useAreaOverview: () => mockData }));

import PlanningAreaOverviewScreen from "@/screens/PlanningAreaOverviewScreen";

function byTestId(tree: ReactTestRenderer, id: string) {
  return tree.root.find((n) => n.props.testID === id && typeof n.type !== "string");
}
function has(tree: ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => n.props.testID === id).length > 0;
}
function allText(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (typeof n === "string") { out.push(n); return; }
    (n.children || []).forEach(walk);
  };
  walk(tree.toJSON());
  return out.join(" ");
}
function render() {
  let tree!: ReactTestRenderer;
  act(() => { tree = renderer.create(<PlanningAreaOverviewScreen />); });
  return tree;
}

beforeEach(() => {
  mockData = baseData();
  mockNavigate.mockClear();
  mockParams = { ...mockParams, next: "datetime" };
});

describe("PlanningAreaOverviewScreen", () => {
  it("zeigt Karte mit Umkreis, Reiter und Hinweis-Chip", () => {
    const tree = render();
    expect(mockMapProps.radiusMeters).toBe(500);
    expect(mockMapProps.selectedLocation).toEqual({ latitude: 50.0, longitude: 8.0 });
    expect(mockMapProps.poiMarkers).toHaveLength(2);
    expect(mockMapProps.poiMarkers[0]).toMatchObject({ glyph: "H", caution: true });
    expect(mockMapProps.extraShapes).toHaveLength(1); // NOTAM-Kreis
    expect(has(tree, "area-tab-zones")).toBe(true);
    expect(has(tree, "area-tab-notams")).toBe(true);
    expect(has(tree, "area-tab-hints")).toBe(true);
    expect(allText(tree)).toContain("2 Hinweise in der Nähe");
  });

  it("Geozonen-Panel listet Zone mit Höhe; Tippen hebt sie auf der Karte hervor", () => {
    const tree = render();
    act(() => { byTestId(tree, "area-tab-zones").props.onPress(); });
    expect(has(tree, "area-panel-zones")).toBe(true);
    const text = allText(tree);
    expect(text).toContain("Wohngebiet Test");
    expect(text).toContain("GND – 100 m AGL");
    act(() => { byTestId(tree, "area-zone-0").props.onPress(); });
    expect(mockMapProps.highlightZones?.[0]?.name).toBe("Wohngebiet Test");
  });

  it("Hinweis-Chip öffnet das Hinweis-Panel mit Vorsicht/Info und Hindernissen", () => {
    const tree = render();
    act(() => { byTestId(tree, "area-hints-chip").props.onPress(); });
    expect(has(tree, "area-panel-hints")).toBe(true);
    const text = allText(tree);
    expect(text).toContain("Rettungshubschrauber-Landeplatz Klinikum");
    expect(text).toContain("1,2 km NO");
    expect(text).toContain("Vorsicht");
    expect(text).toContain("1 Windkraftanlage (bis 200 m)");
  });

  it("offline ohne Daten: „nicht verfügbar (offline)“ statt leerer Liste", () => {
    mockData = { ...baseData(), offline: true, notamState: "unavailable", notamsLocal: [], zonesState: "unavailable", zones: [] };
    const tree = render();
    act(() => { byTestId(tree, "area-tab-notams").props.onPress(); });
    expect(allText(tree)).toContain("NOTAMs: nicht verfügbar (offline)");
  });

  it("„Weiter“ führt mit denselben Parametern zum nächsten Schritt", () => {
    const tree = render();
    act(() => { byTestId(tree, "button-area-continue").props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith("PlanningDateTime", expect.objectContaining({ droneId: "drone-1", radiusKm: 0.5 }));
    expect(mockNavigate.mock.calls[0][1]).not.toHaveProperty("next");
  });
});
