import React from "react";
import { View, StyleSheet, Text } from "react-native";

const Stub = (props: any) => {
  const { children, style } = props || {};
  return <View style={[styles.stub, style]}>{children}</View>;
};

const NullStub = (_props: any) => null;

export const Marker = NullStub;
export const Circle = NullStub;
export const Polygon = NullStub;
export const Polyline = NullStub;
export const Callout = NullStub;
export const WMSTile = NullStub;
export const UrlTile = NullStub;
export const Overlay = NullStub;

export const PROVIDER_DEFAULT = "default";
export const PROVIDER_GOOGLE = "google";

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type LongPressEvent = any;
export type MapPressEvent = any;

class MapView extends React.Component<any> {
  animateToRegion() {}
  animateCamera() {}
  fitToCoordinates() {}
  fitToElements() {}
  fitToSuppliedMarkers() {}
  getCamera() { return Promise.resolve({}); }
  getMapBoundaries() { return Promise.resolve({ northEast: { latitude: 0, longitude: 0 }, southWest: { latitude: 0, longitude: 0 } }); }
  takeSnapshot() { return Promise.resolve(""); }
  setNativeProps() {}
  render() {
    return (
      <View style={[styles.stub, this.props.style]}>
        <Text style={styles.stubText}>Karte nur in Expo Go verfügbar</Text>
      </View>
    );
  }
}

(MapView as any).Marker = Marker;
(MapView as any).Circle = Circle;
(MapView as any).Polygon = Polygon;
(MapView as any).Polyline = Polyline;
(MapView as any).Callout = Callout;
(MapView as any).WMSTile = WMSTile;
(MapView as any).UrlTile = UrlTile;

export default MapView;

const styles = StyleSheet.create({
  stub: {
    flex: 1,
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5E7EB",
  },
  stubText: {
    color: "#6B7280",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 16,
  },
});
