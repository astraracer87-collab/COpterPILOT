import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import NotamRestrictionMap, { type NotamRestrictionMapProps } from "../NotamRestrictionMap.native";

jest.mock("../TrafficMapView.native", () => ({
  MAIN_MAP_HTML: "<html>shared-main-map</html>",
}));

jest.mock("react-native-webview", () => {
  const React = require("react");
  const { View } = require("react-native");
  const inject = jest.fn();
  const WebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: inject }));
    return React.createElement(View, { testID: "web-map", ...props });
  });
  return { __esModule: true, WebView, __injectJavaScript: inject };
});

const { __injectJavaScript: injectJavaScript } = require("react-native-webview");
const outer: [number, number][] = [[52, 13], [52, 14], [53, 14], [52, 13]];
const hole: [number, number][] = [[52.2, 13.2], [52.2, 13.4], [52.4, 13.4], [52.2, 13.2]];
const props: NotamRestrictionMapProps = {
  centerLat: 52,
  centerLon: 13,
  latDelta: 2,
  lonDelta: 2,
  countryIso: "DE",
  mapType: "standard",
  overlays: [
    {
      id: "notam-polygon",
      groups: [[outer, hole]],
      fillColor: "rgba(255,149,0,0.15)",
      strokeColor: "rgba(255,149,0,0.7)",
      strokeWidth: 2,
    },
    {
      id: "notam-circle",
      center: [52, 13],
      radiusM: 1000,
      fillColor: "red",
      strokeColor: "red",
      strokeWidth: 2,
    },
  ],
  onMapPress: jest.fn(),
  onLongPress: jest.fn(),
};

let tree: ReactTestRenderer;
const map = () => tree.root.findByProps({ testID: "web-map" });
const renderMap = (overrides: Partial<NotamRestrictionMapProps> = {}) => {
  act(() => {
    tree = renderer.create(<NotamRestrictionMap {...props} {...overrides} />);
  });
};

beforeEach(() => injectJavaScript.mockClear());
afterEach(() => {
  if (tree) act(() => tree.unmount());
});

it("uses the same Leaflet map document as the main traffic map", () => {
  renderMap();
  expect(map().props.source.html).toBe("<html>shared-main-map</html>");
  expect(map().props.javaScriptEnabled).toBe(true);
  expect(map().props.scrollEnabled).toBe(false);
});

it("applies the map state from native load completion if iOS misses the early ready message", () => {
  renderMap();

  act(() => map().props.onLoadEnd());

  expect(injectJavaScript).toHaveBeenCalledTimes(1);
  const script = injectJavaScript.mock.calls[0][0] as string;
  const stateText = script.match(/window\.__apply\((.*)\);/)?.[1];
  expect(stateText).toBeTruthy();
  const state = JSON.parse(stateText!);
  expect(state.base).toBe("standard");
  expect(state.nt).toHaveLength(2);
  expect(script).toContain('window.__hasBaseTile("standard")');
});

it("sends NOTAM areas to the shared map, preserving holes and converting point-radius areas", () => {
  renderMap();
  act(() => map().props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "baseTileLoaded", base: "standard" }) } }));

  expect(injectJavaScript).toHaveBeenCalledTimes(1);
  const script = injectJavaScript.mock.calls[0][0] as string;
  const stateText = script.match(/window\.__apply\((.*)\);true;/)?.[1];
  expect(stateText).toBeTruthy();
  const state = JSON.parse(stateText!);

  expect(state.geo).toEqual([]);
  expect(state.markers).toEqual([]);
  expect(state.vz).toEqual([]);
  expect(state.nt[0]).toEqual({
    r: [outer, hole],
    f: "rgba(255,149,0,0.15)",
    s: "rgba(255,149,0,0.7)",
    w: 2,
  });
  expect(state.nt[1].f).toBe("red");
  expect(state.nt[1].r).toHaveLength(1);
  expect(state.nt[1].r[0]).toHaveLength(49);
  expect(state.nt[1].r[0][0][0]).toBeCloseTo(52 + 1000 / 111_000, 2);
});

it("renders a normal one-ring NOTAM polygon in the Leaflet layer", () => {
  const source = readFileSync(join(__dirname, "../TrafficMapView.native.tsx"), "utf8");
  const start = source.indexOf("  function setNotams(arr){");
  const end = source.indexOf("\n  // ---- Vektor-Geozonen", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const polygon = jest.fn();
  const addTo = jest.fn();
  polygon.mockReturnValue({ addTo });
  const clearLayers = jest.fn();
  const setNotams = new Function(
    "L",
    "notamLayer",
    `var notamSig = ""; ${source.slice(start, end)}; return setNotams;`,
  )({ polygon }, { clearLayers }) as (items: unknown[]) => void;

  setNotams([{ r: [outer], f: "orange", s: "orange", w: 2 }]);

  expect(clearLayers).toHaveBeenCalledTimes(1);
  expect(polygon).toHaveBeenCalledWith([outer], expect.objectContaining({
    color: "orange",
    fillColor: "orange",
    smoothFactor: 0,
  }));
  expect(addTo).toHaveBeenCalledTimes(1);
});

it("uses a focused center, updates the map style and forwards map gestures", () => {
  const onMapPress = jest.fn();
  const onLongPress = jest.fn();
  renderMap({ focusLat: 48, focusLon: 11, mapType: "satellite", onMapPress, onLongPress });
  act(() => map().props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "baseTileLoaded", base: "satellite" }) } }));

  const stateText = (injectJavaScript.mock.calls[0][0] as string).match(/window\.__apply\((.*)\);true;/)?.[1];
  const state = JSON.parse(stateText!);
  expect(state.center).toEqual([48, 11]);
  expect(state.base).toBe("satellite");
  expect(state.zoom).toBe(11);

  act(() => map().props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "mapPress", lat: 48, lon: 11 }) } }));
  act(() => map().props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "longPress", lat: 49, lon: 12 }) } }));
  expect(onMapPress).toHaveBeenCalledWith(48, 11);
  expect(onLongPress).toHaveBeenCalledWith(49, 12);
});

it("preserves grayscale as a real base style and waits for its tile", () => {
  renderMap({ mapType: "grayscale" });
  act(() => map().props.onLoadEnd());

  const script = injectJavaScript.mock.calls[0][0] as string;
  const stateText = script.match(/window\.__apply\((.*)\);/)?.[1];
  expect(JSON.parse(stateText!).base).toBe("grayscale");
  expect(script).toContain('window.__hasBaseTile("grayscale")');
});

it("keeps the loading state until an actual base-map tile has loaded", () => {
  renderMap();
  act(() => map().props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "ready" }) } }));
  expect(tree.root.findByProps({ testID: "notam-map-loading" })).toBeTruthy();

  act(() => map().props.onMessage({ nativeEvent: { data: JSON.stringify({ type: "baseTileLoaded", base: "standard" }) } }));
  expect(tree.root.findAllByProps({ testID: "notam-map-loading" })).toHaveLength(0);
});

it("shows a retry action if the shared WebView fails to initialize", () => {
  renderMap();
  act(() => map().props.onError());
  expect(tree.root.findByProps({ testID: "notam-map-retry" })).toBeTruthy();
  act(() => tree.root.findByProps({ testID: "notam-map-retry" }).props.onPress());
  expect(tree.root.findByProps({ testID: "web-map" })).toBeTruthy();
});