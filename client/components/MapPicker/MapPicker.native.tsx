import React, { forwardRef, useImperativeHandle, useRef, useState, useMemo, useCallback } from "react";
import { StyleSheet, View, Platform, useColorScheme, Pressable, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import MapView, { Marker, MapPressEvent, Region, Circle, WMSTile, UrlTile, Polyline } from "@/components/maps";
import { buildCombinedWmsTileUrl, getAllLayerNames } from "@/lib/geozones";

type MapStyle = "osm" | "satellite" | "hybrid";

interface MapLocation {
  latitude: number;
  longitude: number;
}

interface MapPickerProps {
  initialRegion?: Region;
  selectedLocation?: MapLocation | null;
  locationName?: string;
  onMapPress?: (latitude: number, longitude: number) => void;
  onMapLongPress?: (latitude: number, longitude: number) => void;
  onRegionChangeComplete?: (region: Region) => void;
  style?: any;
  radiusMeters?: number;
  geozoneLayers?: string[];
  showCenterPin?: boolean;
  hideMarker?: boolean;
  showMapStyleSwitcher?: boolean;
  routeWaypoints?: MapLocation[];
  onWaypointPress?: (index: number) => void;
  onWaypointDragEnd?: (index: number, latitude: number, longitude: number) => void;
}

export interface MapPickerRef {
  animateToRegion: (region: Region, duration?: number) => void;
}

const MAP_STYLE_OPTIONS: { id: MapStyle; label: string }[] = [
  { id: "osm", label: "Standard" },
  { id: "satellite", label: "Satellit" },
  { id: "hybrid", label: "Hybrid" },
];

const MapPicker = forwardRef<MapPickerRef, MapPickerProps>(
  ({ initialRegion, selectedLocation, locationName, onMapPress, onMapLongPress, onRegionChangeComplete, style, radiusMeters, geozoneLayers, showCenterPin, hideMarker, showMapStyleSwitcher = true, routeWaypoints, onWaypointPress, onWaypointDragEnd }, ref) => {
    const mapRef = useRef<MapView>(null);
    const colorScheme = useColorScheme();
    const isDark = colorScheme === "dark";
    const [currentRegion, setCurrentRegion] = useState<Region | null>(null);
    const [mapStyle, setMapStyle] = useState<MapStyle>("osm");

    const osmTileUrl = isDark
      ? "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
      : "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png";

    const layers = useMemo(() => {
      if (geozoneLayers && geozoneLayers.length > 0) return geozoneLayers;
      return getAllLayerNames();
    }, [geozoneLayers]);

    const combinedWmsUrl = useMemo(() => {
      return buildCombinedWmsTileUrl(layers);
    }, [layers]);

    const currentZoom = useMemo(() => {
      const delta = currentRegion?.latitudeDelta ?? initialRegion?.latitudeDelta ?? 5;
      if (delta <= 0) return 15;
      return Math.round(Math.log2(360 / delta));
    }, [currentRegion?.latitudeDelta, initialRegion?.latitudeDelta]);

    const geozonesVisible = currentZoom >= 11;

    useImperativeHandle(ref, () => ({
      animateToRegion: (region: Region, duration: number = 500) => {
        mapRef.current?.animateToRegion(region, duration);
      },
    }));

    const handlePress = useCallback((event: MapPressEvent) => {
      if (onMapPress) {
        const { latitude, longitude } = event.nativeEvent.coordinate;
        onMapPress(latitude, longitude);
      }
    }, [onMapPress]);

    const handleLongPress = useCallback((event: import("@/components/maps").LongPressEvent) => {
      if (onMapLongPress) {
        const { latitude, longitude } = event.nativeEvent.coordinate;
        onMapLongPress(latitude, longitude);
      }
    }, [onMapLongPress]);

    const regionThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleRegionChangeComplete = useCallback((region: Region) => {
      if (regionThrottle.current) clearTimeout(regionThrottle.current);
      regionThrottle.current = setTimeout(() => {
        regionThrottle.current = null;
        setCurrentRegion(region);
        if (onRegionChangeComplete) onRegionChangeComplete(region);
      }, 200);
    }, [onRegionChangeComplete]);

    const resolvedMapType = mapStyle === "osm"
      ? (Platform.OS === "ios" ? "mutedStandard" : "standard")
      : mapStyle === "satellite"
        ? "satellite"
        : "hybrid";

    const showOsmTile = mapStyle === "osm";

    return (
      <View style={[styles.map, style]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion}
          onPress={handlePress}
          onLongPress={handleLongPress}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass
          rotateEnabled={false}
          mapType={resolvedMapType}
        >
          <UrlTile
            urlTemplate={osmTileUrl}
            maximumZ={19}
            zIndex={-3}
            tileSize={256}
            opacity={showOsmTile ? 1 : 0}
            shouldReplaceMapContent={showOsmTile}
          />
          {combinedWmsUrl ? (
            <WMSTile
              urlTemplate={combinedWmsUrl}
              zIndex={-1}
              opacity={geozonesVisible ? (showOsmTile ? (isDark ? 0.55 : 0.85) : 0.92) : 0}
              tileSize={256}
            />
          ) : null}
          {!hideMarker && selectedLocation && (!routeWaypoints || routeWaypoints.length === 0) ? (
            <Marker
              coordinate={selectedLocation}
              title="Flugstandort"
              description={locationName || "Ausgewählter Standort"}
            />
          ) : null}
          {routeWaypoints && routeWaypoints.length >= 2 ? (
            <Polyline
              coordinates={routeWaypoints}
              strokeColor="rgba(0, 122, 255, 0.85)"
              strokeWidth={3}
            />
          ) : null}
          {routeWaypoints && routeWaypoints.length > 0
            ? routeWaypoints.map((wp, idx) => (
                <Marker
                  key={`wp-${idx}-${wp.latitude}-${wp.longitude}`}
                  coordinate={wp}
                  title={`Wegpunkt ${idx + 1}`}
                  description={
                    idx === 0
                      ? "Start"
                      : idx === routeWaypoints.length - 1
                      ? "Ziel"
                      : "Zwischenpunkt"
                  }
                  pinColor={
                    idx === 0
                      ? "#34C759"
                      : idx === routeWaypoints.length - 1
                      ? "#FF3B30"
                      : "#007AFF"
                  }
                  onPress={() => onWaypointPress?.(idx)}
                  draggable={!!onWaypointDragEnd}
                  onDragEnd={(e) => {
                    const { latitude, longitude } = e.nativeEvent.coordinate;
                    onWaypointDragEnd?.(idx, latitude, longitude);
                  }}
                />
              ))
            : null}
          {selectedLocation && radiusMeters ? (
            <Circle
              center={selectedLocation}
              radius={radiusMeters}
              strokeColor="rgba(0, 122, 255, 0.6)"
              fillColor="rgba(0, 122, 255, 0.08)"
              strokeWidth={2}
            />
          ) : null}
        </MapView>
        {showCenterPin ? (
          <View style={styles.centerPin} pointerEvents="none">
            <Feather name="map-pin" size={32} color="#FF3B30" />
          </View>
        ) : null}
        {showMapStyleSwitcher ? (
          <View style={switchStyles.container}>
            {MAP_STYLE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                style={[
                  switchStyles.segment,
                  mapStyle === opt.id ? switchStyles.segmentActive : undefined,
                ]}
                onPress={() => setMapStyle(opt.id)}
              >
                <Text style={[
                  switchStyles.segmentLabel,
                  mapStyle === opt.id ? switchStyles.segmentLabelActive : undefined,
                ]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  }
);

MapPicker.displayName = "MapPicker";

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  centerPin: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -16,
    marginTop: -32,
    zIndex: 10,
  },
});

const switchStyles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 10,
    alignSelf: "center",
    flexDirection: "row",
    backgroundColor: "rgba(20, 30, 48, 0.82)",
    borderRadius: 20,
    padding: 3,
    zIndex: 15,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 17,
  },
  segmentActive: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },
  segmentLabel: {
    color: "rgba(255, 255, 255, 0.55)",
    fontSize: 12,
    fontWeight: "600",
  },
  segmentLabelActive: {
    color: "#FFFFFF",
  },
});

export default MapPicker;
