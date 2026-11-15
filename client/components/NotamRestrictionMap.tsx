import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { View, StyleSheet, Platform, useColorScheme } from "react-native";
import MapView, { Circle, Marker, Polygon, WMSTile, Region } from "@/components/maps";
import { buildCombinedWmsTileUrl, getCountriesInRadius } from "@/lib/geozones";
import { nativeMapBasemapProps } from "@/lib/mapBasemap";

// Generische Overlay-Beschreibung einer NOTAM-/Beschränkungs-Zone. Farben werden
// im Parent (NotamMapView) berechnet — identisch für native + web.
export interface NotamMapOverlay {
  id: string;
  // Gruppierte Ringe ([Außenring, …Löcher] je Polygon) für lochechtes Rendering.
  groups?: [number, number][][][];
  center?: [number, number];
  radiusM?: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface NotamRestrictionMapProps {
  centerLat: number;
  centerLon: number;
  latDelta: number;
  lonDelta: number;
  focusLat?: number;
  focusLon?: number;
  focusId?: string;
  countryIso?: string | null;
  mapType: "standard" | "satellite" | "osm" | "grayscale";
  overlays: NotamMapOverlay[];
  pin?: { latitude: number; longitude: number } | null;
  onMapPress: (latitude: number, longitude: number) => void;
  onLongPress: (latitude: number, longitude: number) => void;
}

const NOTAM_ONLY_LAYERS: Record<string, string[]> = {
  DE: ["temporaere_betriebseinschraenkungen"],
  // LU: kein WMS-Overlay — temporäre LU-Zonen werden als explizite Polygone (über
  // overlays/restrictions) gezeichnet. Die LU-Layer 1927/1928 sind Höhenbänder und
  // zeigen ALLE (auch permanente) Zonen, was zu mehr Zonen als in der Liste führte.
};

export default function NotamRestrictionMap({
  centerLat, centerLon, latDelta, lonDelta, focusLat, focusLon,
  countryIso, mapType, overlays, pin, onMapPress, onLongPress,
}: NotamRestrictionMapProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const mapRef = useRef<MapView>(null);

  const [currentRegion, setCurrentRegion] = useState<Region>({
    latitude: centerLat, longitude: centerLon, latitudeDelta: latDelta, longitudeDelta: lonDelta,
  });

  useEffect(() => {
    if (focusLat != null && focusLon != null && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: focusLat, longitude: focusLon, latitudeDelta: 0.15, longitudeDelta: 0.15,
      }, 500);
    }
  }, [focusLat, focusLon]);

  useEffect(() => {
    if (focusLat != null && focusLon != null) return; // Fokus-Animation hat Vorrang
    if (!mapRef.current) return;
    mapRef.current.animateToRegion({
      latitude: centerLat, longitude: centerLon, latitudeDelta: latDelta, longitudeDelta: lonDelta,
    }, 600);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerLat, centerLon, countryIso]);

  const wmsUrlsPerCountry = useMemo(() => {
    const viewRadiusKm = Math.max(
      (currentRegion.latitudeDelta || 0) * 111.32 / 2,
      (currentRegion.longitudeDelta || 0) * 111.32 * Math.cos((currentRegion.latitude * Math.PI) / 180) / 2,
      80,
    );
    const countries = getCountriesInRadius(currentRegion.latitude, currentRegion.longitude, viewRadiusKm);
    return countries
      .filter((iso) => NOTAM_ONLY_LAYERS[iso] && NOTAM_ONLY_LAYERS[iso].length > 0)
      .filter((iso) => !countryIso || iso === countryIso)
      .flatMap((iso) => buildCombinedWmsTileUrl(NOTAM_ONLY_LAYERS[iso], iso).map((url) => ({ iso, url })));
  }, [currentRegion.latitude, currentRegion.longitude, currentRegion.latitudeDelta, currentRegion.longitudeDelta, countryIso]);

  const handlePress = useCallback((e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    onMapPress(latitude, longitude);
  }, [onMapPress]);

  const handleLongPress = useCallback((e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    onLongPress(latitude, longitude);
  }, [onLongPress]);

  const basemapProps = nativeMapBasemapProps(mapType, Platform.OS);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        {...basemapProps}
        initialRegion={{
          latitude: focusLat ?? centerLat,
          longitude: focusLon ?? centerLon,
          latitudeDelta: focusLat != null ? 0.15 : latDelta,
          longitudeDelta: focusLon != null ? 0.15 : lonDelta,
        }}
        showsUserLocation
        showsMyLocationButton
        onPress={handlePress}
        onLongPress={handleLongPress}
        onRegionChangeComplete={(region) => setCurrentRegion(region)}
      >
        {wmsUrlsPerCountry.map(({ iso, url }, i) => url ? (
          <WMSTile
            key={`wms-notam-${iso}-${i}-${url}`}
            urlTemplate={url}
            zIndex={-1}
            opacity={isDark ? 0.5 : 0.65}
            tileSize={256}
          />
        ) : null)}
        {overlays.map((o) => (
          <React.Fragment key={o.id}>
            {o.groups && o.groups.length > 0 ? (
              o.groups.map((group, ri) => {
                const [outer, ...holes] = group;
                if (!outer || outer.length < 3) return null;
                return (
                  <Polygon
                    key={`${o.id}-poly-${ri}`}
                    coordinates={outer.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                    holes={holes.map((h) => h.map(([lat, lon]) => ({ latitude: lat, longitude: lon })))}
                    fillColor={o.fillColor}
                    strokeColor={o.strokeColor}
                    strokeWidth={o.strokeWidth}
                  />
                );
              })
            ) : o.center ? (
              <Circle
                center={{ latitude: o.center[0], longitude: o.center[1] }}
                radius={o.radiusM ?? 5000}
                fillColor={o.fillColor}
                strokeColor={o.strokeColor}
                strokeWidth={o.strokeWidth}
              />
            ) : null}
          </React.Fragment>
        ))}
        {pin ? (
          <Marker coordinate={pin} pinColor="#007AFF" zIndex={300} />
        ) : null}
      </MapView>
    </View>
  );
}
