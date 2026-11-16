/**
 * Karten-Overlays (MapLibre-Schicht @/components/maps): Ein Re-Render des
 * Screens mit inhaltlich gleichen, aber NEU erzeugten Koordinaten-Arrays (so
 * zeichnen die Screens ihre Zonen) darf die GeoJSON-Quelle nicht neu rendern –
 * sonst wird bei jedem Tap (z. B. Abhaken einer Bestätigung im Pre-Check) jedes
 * Polygon per JSON.stringify neu serialisiert.
 */
import React from "react";
import renderer, { act } from "react-test-renderer";

const mockSourceRenders: string[] = [];

jest.mock("@maplibre/maplibre-react-native", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Stub = (props: any) => React.createElement(View, null, props.children);
  return {
    Map: Stub,
    Camera: Stub,
    RasterSource: Stub,
    UserLocation: Stub,
    ViewAnnotation: Stub,
    Layer: () => null,
    GeoJSONSource: (props: any) => {
      mockSourceRenders.push(JSON.stringify(props.data));
      return React.createElement(View, null, props.children);
    },
  };
});
jest.mock("@/lib/location", () => ({}));
jest.mock("../maps/MapLayers", () => ({
  BASE_ANCHORS: [],
  CountryBaseLayers: () => null,
  GOOGLE_ANCHOR: "g",
  GoogleSatelliteLayer: () => null,
  ObstacleLayer: () => null,
}));

import { Polygon, Polyline } from "@/components/maps";

const ring = (): Array<{ latitude: number; longitude: number }> => [
  { latitude: 50, longitude: 8 },
  { latitude: 50.01, longitude: 8 },
  { latitude: 50.01, longitude: 8.01 },
  { latitude: 50, longitude: 8.01 },
];

function Overlays({ tick, shift = 0, onPress }: { tick: number; shift?: number; onPress?: () => void }) {
  // Jede Render-Runde erzeugt neue Arrays (wie `outer.map(...)` in den Screens).
  void tick;
  const coords = ring().map((p) => ({ latitude: p.latitude + shift, longitude: p.longitude }));
  return (
    <>
      <Polygon coordinates={coords} fillColor="rgba(1,2,3,0.2)" strokeColor="#f00" strokeWidth={2} onPress={onPress} />
      <Polyline coordinates={coords} strokeColor="#00f" strokeWidth={2} lineDashPattern={[4, 4]} />
    </>
  );
}

describe("maps: Overlays mit gleicher Geometrie rendern nicht neu", () => {
  beforeEach(() => {
    mockSourceRenders.length = 0;
  });

  it("überspringt GeoJSON-Quellen bei neuen, aber gleichen Koordinaten und inline-Handlern", () => {
    let tree!: renderer.ReactTestRenderer;
    const calls: number[] = [];
    act(() => {
      tree = renderer.create(<Overlays tick={0} onPress={() => calls.push(0)} />);
    });
    expect(mockSourceRenders).toHaveLength(2);

    act(() => {
      tree.update(<Overlays tick={1} onPress={() => calls.push(1)} />);
    });
    act(() => {
      tree.update(<Overlays tick={2} onPress={() => calls.push(2)} />);
    });
    // Keine weitere Quelle gerendert (kein erneutes Serialisieren).
    expect(mockSourceRenders).toHaveLength(2);

    act(() => tree.unmount());
  });

  it("rendert neu, sobald sich die Form ändert", () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Overlays tick={0} />);
    });
    expect(mockSourceRenders).toHaveLength(2);
    act(() => {
      tree.update(<Overlays tick={1} shift={0.5} />);
    });
    expect(mockSourceRenders).toHaveLength(4);
    act(() => tree.unmount());
  });
});
