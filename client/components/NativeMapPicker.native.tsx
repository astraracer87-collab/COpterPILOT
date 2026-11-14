import React, { useMemo, useState, useCallback, useRef } from "react";
import { StyleSheet, Platform, useColorScheme } from "react-native";
import MapView, { Marker, UrlTile, WMSTile, Region } from "@/components/maps";
import { buildCombinedWmsTileUrl, getAllLayerNames } from "@/lib/geozones";

interface NativeMapPickerProps {
  initialLatitude: number;
  initialLongitude: number;
  markerLatitude: number;
  markerLongitude: number;
  onMarkerDragEnd: (lat: number, lon: number) => void;
  onMapPress: (lat: number, lon: number) => void;
  marginTop: number;
}

export default function NativeMapPicker({
  initialLatitude,
  initialLongitude,
  markerLatitude,
  markerLongitude,
  onMarkerDragEnd,
  onMapPress,
  marginTop,
}: NativeMapPickerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const [currentRegion, setCurrentRegion] = useState<Region | null>(null);

  const osmTileUrl = isDark
    ? "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
    : "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png";

  const layers = useMemo(() => getAllLayerNames(), []);
  const combinedWmsUrl = useMemo(() => buildCombinedWmsTileUrl(layers), [layers]);

  const currentZoom = useMemo(() => {
    const delta = currentRegion?.latitudeDelta ?? 0.5;
    if (delta <= 0) return 15;
    return Math.round(Math.log2(360 / delta));
  }, [currentRegion?.latitudeDelta]);

  const geozonesVisible = currentZoom >= 11;

  const regionThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRegionChangeComplete = useCallback((region: Region) => {
    if (regionThrottle.current) clearTimeout(regionThrottle.current);
    regionThrottle.current = setTimeout(() => {
      regionThrottle.current = null;
      setCurrentRegion(region);
    }, 200);
  }, []);

  return (
    <MapView
      style={[styles.map, { marginTop }]}
      initialRegion={{
        latitude: initialLatitude,
        longitude: initialLongitude,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      }}
      onPress={(e) => {
        const { latitude, longitude } = e.nativeEvent.coordinate;
        onMapPress(latitude, longitude);
      }}
      onRegionChangeComplete={handleRegionChangeComplete}
      showsUserLocation
      showsMyLocationButton
      rotateEnabled={false}
      mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
    >
      {combinedWmsUrl ? (
        <WMSTile
          urlTemplate={combinedWmsUrl}
          zIndex={-1}
          opacity={geozonesVisible ? (isDark ? 0.55 : 0.85) : 0}
          tileSize={256}
        />
      ) : null}
      <Marker
        coordinate={{ latitude: markerLatitude, longitude: markerLongitude }}
        draggable
        onDragEnd={(e) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          onMarkerDragEnd(latitude, longitude);
        }}
        title="Flugstandort"
        description="Ziehe den Marker zum gewünschten Standort"
      />
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
