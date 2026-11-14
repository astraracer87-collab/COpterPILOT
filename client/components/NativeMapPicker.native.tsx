import React, { useMemo, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, Platform, useColorScheme } from "react-native";
import MapView, { Marker, UrlTile, WMSTile, Region } from "@/components/maps";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMapBasemapStyle } from "@/hooks/useMapBasemapStyle";
import { buildCombinedWmsTileUrl, getAllLayerNames, GEOZONE_TILE_MIN_ZOOM } from "@/lib/geozones";
import { GRAYSCALE_BASEMAP_TILE_URL, nativeMapBasemapProps } from "@/lib/mapBasemap";
import { detectCountryFromCoordinates } from "@/lib/countryMaps";
import { splitCountriesByAccess, countryName } from "../../shared/countryEntitlements";
import { useAuth } from "@/lib/auth";

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
  const [mapStyle] = useMapBasemapStyle();

  const osmTileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const layers = useMemo(() => getAllLayerNames(), []);
  const combinedWmsUrls = useMemo(() => buildCombinedWmsTileUrl(layers), [layers]);

  const currentZoom = useMemo(() => {
    const delta = currentRegion?.latitudeDelta ?? 0.5;
    if (delta <= 0) return 15;
    return Math.round(Math.log2(360 / delta));
  }, [currentRegion?.latitudeDelta]);

  const geozonesVisible = currentZoom >= 11;

  // Länder-Berechtigung: react-native-maps WMSTile sendet KEIN Session-Cookie,
  // daher kann das Server-Gate gesperrte Länder dort nicht leeren. Die Geozonen
  // des sichtbaren Landes dürfen nur erscheinen, wenn es freigeschaltet ist.
  const { entitlement } = useAuth();
  const viewportCountry = useMemo(() => {
    const lat = currentRegion?.latitude ?? initialLatitude;
    const lon = currentRegion?.longitude ?? initialLongitude;
    return detectCountryFromCoordinates(lat, lon) || "DE";
  }, [currentRegion?.latitude, currentRegion?.longitude, initialLatitude, initialLongitude]);
  const { geozonesUnlocked, lockedName } = useMemo(() => {
    const { unlocked, locked } = splitCountriesByAccess([viewportCountry], entitlement);
    return {
      geozonesUnlocked: unlocked.length > 0,
      lockedName: locked.length > 0 ? countryName(locked[0]) : null,
    };
  }, [viewportCountry, entitlement]);

  const insets = useSafeAreaInsets();

  const regionThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRegionChangeComplete = useCallback((region: Region) => {
    if (regionThrottle.current) clearTimeout(regionThrottle.current);
    regionThrottle.current = setTimeout(() => {
      regionThrottle.current = null;
      setCurrentRegion(region);
    }, 200);
  }, []);

  return (
    <View style={styles.container}>
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
      {...nativeMapBasemapProps(mapStyle, Platform.OS)}
    >
      <UrlTile
        urlTemplate={mapStyle === "grayscale" ? GRAYSCALE_BASEMAP_TILE_URL : osmTileUrl}
        maximumZ={19}
        zIndex={-3}
        tileSize={256}
        opacity={1}
        shouldReplaceMapContent={true}
      />
      {geozonesVisible && geozonesUnlocked ? combinedWmsUrls.map((url, i) => url ? (
        <WMSTile
          key={`wms-combined-${i}-${url}`}
          urlTemplate={url}
          zIndex={-1}
          minimumZ={GEOZONE_TILE_MIN_ZOOM}
          opacity={isDark ? 0.55 : 0.85}
          tileSize={256}
        />
      ) : null) : null}
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
    {lockedName ? (
      <View
        style={[styles.lockedHint, { top: insets.top + marginTop + 12 }]}
        pointerEvents="none"
        testID="hint-locked-countries"
      >
        <Feather name="lock" size={13} color="#FFFFFF" />
        <Text style={styles.lockedHintText}>{`${lockedName}: Land freischalten`}</Text>
      </View>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  lockedHint: {
    position: "absolute",
    alignSelf: "center",
    maxWidth: "80%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(120, 53, 15, 0.9)",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(251, 191, 36, 0.5)",
    zIndex: 16,
  },
  lockedHintText: {
    color: "rgba(255, 255, 255, 0.95)",
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
});
