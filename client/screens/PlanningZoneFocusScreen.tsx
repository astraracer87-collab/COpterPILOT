import { openLink } from "@/lib/webBrowser";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking, Platform } from "react-native";
import MapView, {
  Polygon,
  Marker,
  Circle,
  UrlTile,
  Polyline,
  PROVIDER_DEFAULT,
} from "@/components/maps";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useMapBasemapStyle } from "@/hooks/useMapBasemapStyle";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import {
  GeozoneFeatureInfo,
  ringGroupsForZone,
  getCountryGeozoneConfig,
  buildGeozoneCacheTileUrl,
  buildGeozoneTileUrls,
  buildVectorGeozoneTileUrl,
  isRasterTiledVectorCountry,
  loadGeozoneSettings,
  getActiveLayerNames,
  GEOZONE_TILE_MIN_ZOOM,
} from "@/lib/geozones";
import { smoothRingGroup, simplifyRingGroup } from "@/lib/ringSimplify";
import { nativeMapBasemapProps } from "@/lib/mapBasemap";
import { entitlementGrantsCountry } from "../../shared/countryEntitlements";
import { useAuth } from "@/lib/auth";
import { infrastructureMapGeometry } from "@/lib/energyInfrastructureZones";
import {
  getEnergyInfrastructureCountry,
  getGermanWindFacility100mPoints,
  getRadarEnergyInfrastructureItems,
  type GermanEnergyInfrastructureItem,
} from "../../shared/germanEnergyInfrastructure";
import { useGermanEnergyInfrastructure } from "@/lib/useGermanEnergyInfrastructure";

type RouteParams = RouteProp<FlightPlanningParamList, "PlanningZoneFocus">;

type LatLng = { latitude: number; longitude: number };

// Polygon-Gruppen einer Zone als geglättete/vereinfachte [Außenring, …Löcher]-
// Listen für die native Karte. Liefert leeres Array, wenn keine echte Geometrie
// vorliegt (z. B. reine WMS-Quellen wie DGAC).
function geometryGroups(zone: GeozoneFeatureInfo): { outer: LatLng[]; holes: LatLng[][] }[] {
  const groups = ringGroupsForZone(zone);
  const out: { outer: LatLng[]; holes: LatLng[][] }[] = [];
  for (const group of groups) {
    if (!group || group.length === 0) continue;
    const [outer, ...holes] = smoothRingGroup(simplifyRingGroup(group));
    if (!outer || outer.length < 3) continue;
    out.push({
      outer: outer.map(([la, lo]) => ({ latitude: la, longitude: lo })),
      holes: holes.map((h) => h.map(([la, lo]) => ({ latitude: la, longitude: lo }))),
    });
  }
  return out;
}

function regionForRadius(lat: number, lon: number, radiusKm: number) {
  const span = Math.max(0.3, radiusKm) * 2.6;
  const latitudeDelta = span / 111;
  const longitudeDelta = span / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { latitude: lat, longitude: lon, latitudeDelta, longitudeDelta };
}

function altitudeText(zone: GeozoneFeatureInfo): string | null {
  if (zone.altitudeLabel && zone.altitudeLabel.trim().length > 0) return zone.altitudeLabel;
  const hasLower = typeof zone.lowerMeters === "number";
  const hasUpper = typeof zone.upperMeters === "number";
  if (!hasLower && !hasUpper) return null;
  const lower = hasLower ? (zone.lowerMeters === 0 ? "GND" : `${Math.round(zone.lowerMeters!)} m`) : "GND";
  const upper = hasUpper ? `${Math.round(zone.upperMeters!)} m` : "unbegrenzt";
  const ref = zone.lowerReference ? ` ${zone.lowerReference}` : "";
  return `${lower}${ref} – ${upper}`;
}

export default function PlanningZoneFocusScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const [mapStyle] = useMapBasemapStyle();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { entitlement } = useAuth();
  const mapRef = useRef<MapView>(null);

  const { zone, latitude, longitude, radiusKm = 1, countryIso } = route.params;
  const zoneCountry = (zone.country || countryIso || "DE").toUpperCase();
  const hasGermanEnergyAccess =
    zoneCountry === "DE" && entitlementGrantsCountry(entitlement, "DE");
  const energyQuery = useGermanEnergyInfrastructure(
    latitude,
    longitude,
    Math.min(5, Math.max(0.5, radiusKm)),
    zoneCountry,
    hasGermanEnergyAccess,
  );
  const windFacilityPoints = useMemo(
    () => hasGermanEnergyAccess
      ? getGermanWindFacility100mPoints("DE", energyQuery.data?.features)
      : [],
    [hasGermanEnergyAccess, energyQuery.data?.features],
  );
  const energyItems = useMemo(() => {
    const country = getEnergyInfrastructureCountry("DE");
    return getRadarEnergyInfrastructureItems(
      hasGermanEnergyAccess,
      energyQuery.data?.features,
      energyQuery.data?.sources,
      country?.assetComparisonStatusKeyByKind,
    );
  }, [hasGermanEnergyAccess, energyQuery.data]);
  const [selectedEnergyItem, setSelectedEnergyItem] = useState<GermanEnergyInfrastructureItem | null>(null);

  const groups = useMemo(() => geometryGroups(zone), [zone]);
  const infrastructureShape = useMemo(() => infrastructureMapGeometry(zone.infrastructureGeometry), [zone.infrastructureGeometry]);
  const hasGeometry = groups.length > 0 || infrastructureShape.points.length > 0 || infrastructureShape.lines.length > 0;

  const highlightColor = zone.strokeColor || theme.statusCaution || "#FF9500";
  const fillColor = zone.fillColor || (highlightColor + "33");

  // Fallback (Quellen ohne Geometrie): Geozonen-WMS/Vektor-Kachel für das Land
  // einblenden, damit der Pilot wenigstens die Lage am Standort sieht. Genau wie
  // auf den übrigen Karten clientseitig auf freigeschaltete Länder gefiltert.
  const [wmsUrls, setWmsUrls] = useState<string[]>([]);
  useEffect(() => {
    if (hasGeometry) return;
    let cancelled = false;
    (async () => {
      if (!entitlementGrantsCountry(entitlement, zoneCountry)) {
        if (!cancelled) setWmsUrls([]);
        return;
      }
      try {
        if (isRasterTiledVectorCountry(zoneCountry)) {
          const vurl = buildVectorGeozoneTileUrl(zoneCountry);
          if (!cancelled) setWmsUrls(vurl ? [vurl] : []);
          return;
        }
        const settings = await loadGeozoneSettings(zoneCountry);
        const enabled = getActiveLayerNames(settings, zoneCountry);
        if (!cancelled) setWmsUrls(buildGeozoneTileUrls(enabled, zoneCountry));
      } catch {
        if (!cancelled) setWmsUrls([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasGeometry, zoneCountry, entitlement]);

  const initialRegion = useMemo(
    () => regionForRadius(latitude, longitude, radiusKm),
    [latitude, longitude, radiusKm],
  );

  const fit = useCallback(() => {
    if (!mapRef.current) return;
    if (hasGeometry) {
      const coords: LatLng[] = [{ latitude, longitude }];
      for (const g of groups) coords.push(...g.outer);
      for (const [latitude, longitude] of [...infrastructureShape.points, ...infrastructureShape.lines.flat()]) coords.push({latitude, longitude});
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: {
          top: headerHeight + Spacing.xl,
          right: Spacing.xl,
          bottom: Spacing.xl,
          left: Spacing.xl,
        },
        animated: false,
      });
    } else {
      mapRef.current.animateToRegion(regionForRadius(latitude, longitude, radiusKm), 0);
    }
  }, [hasGeometry, groups, infrastructureShape, latitude, longitude, radiusKm, headerHeight]);

  const alt = altitudeText(zone);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_DEFAULT}
          {...nativeMapBasemapProps(mapStyle, Platform.OS)}
          initialRegion={initialRegion}
          onMapReady={fit}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {!hasGeometry
            ? wmsUrls.map((url, i) => (
                <UrlTile
                  key={`gz-${i}-${url}`}
                  urlTemplate={url}
                  zIndex={1}
                  minimumZ={GEOZONE_TILE_MIN_ZOOM}
                  maximumZ={19}
                  maximumNativeZ={getCountryGeozoneConfig(zoneCountry).wmsMaxNativeZoom}
                  opacity={0.6}
                  tileSize={256}
                />
              ))
            : null}
          <Circle
            center={{ latitude, longitude }}
            radius={Math.max(50, radiusKm * 1000)}
            strokeColor={theme.primary}
            strokeWidth={2}
            fillColor={theme.primary + "1A"}
            zIndex={2}
          />
          {!hasGeometry && windFacilityPoints.map((point) => (
            <React.Fragment key={`wind-buffer-${point.id}`}>
              <Circle
                center={{ latitude: point.latitude, longitude: point.longitude }}
                radius={100}
                strokeColor="#D97706"
                strokeWidth={2}
                fillColor="rgba(245, 158, 11, 0.16)"
                zIndex={2}
              />
              <Marker
                coordinate={{ latitude: point.latitude, longitude: point.longitude }}
                pinColor="#7B2CBF"
                title={point.name}
                description={`100-m-Prüfkreis · Quelle: ${point.source}`}
                onPress={() => setSelectedEnergyItem(
                  energyItems.find((item) => item.id === point.id) ?? null,
                )}
              />
            </React.Fragment>
          ))}
          {!hasGeometry && energyItems.map((item) => {
            const coords = item.geometry.coordinates;
            if (item.geometry.type === "Point" && Array.isArray(coords) && coords.length >= 2) {
              const longitude = Number(coords[0]);
              const latitude = Number(coords[1]);
              if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
              const alreadyShownAsWind = windFacilityPoints.some((point) => point.id === item.id);
              if (alreadyShownAsWind) return null;
              return (
                <Marker
                  key={`energy-${item.id}`}
                  coordinate={{ latitude, longitude }}
                  pinColor={item.kind === "wind_turbine" ? "#7B2CBF" : "#C2410C"}
                  title={item.name || "Energieanlage"}
                  description={`${item.source} · Amtlicher Abgleich: nicht gefunden`}
                  onPress={() => setSelectedEnergyItem(item)}
                />
              );
            }
            if (item.geometry.type === "LineString" && Array.isArray(coords)) {
              const points = coords
                .filter((position): position is number[] =>
                  Array.isArray(position) &&
                  Number.isFinite(Number(position[0])) &&
                  Number.isFinite(Number(position[1])),
                )
                .map((position) => ({
                  latitude: Number(position[1]),
                  longitude: Number(position[0]),
                }));
              if (points.length < 2) return null;
              return (
                <Polyline
                  key={`energy-${item.id}`}
                  coordinates={points}
                  strokeColor="#C2410C"
                  strokeWidth={4}
                  tappable
                  onPress={() => setSelectedEnergyItem(item)}
                />
              );
            }
            return null;
          })}
          {infrastructureShape.points.map(([latitude, longitude], i) => (
            <Marker key={`asset-point-${i}`} coordinate={{latitude, longitude}} title={zone.name} pinColor="#007AFF" />
          ))}
          {infrastructureShape.lines.map((line, i) => (
            <Polyline key={`asset-line-${i}`} coordinates={line.map(([latitude, longitude]) => ({latitude, longitude}))} strokeColor={highlightColor} strokeWidth={2.5} />
          ))}
          {groups.map((g, i) => (
            <Polygon
              key={`zone-${i}`}
              coordinates={g.outer}
              holes={g.holes}
              strokeColor={highlightColor}
              strokeWidth={2.5}
              fillColor={fillColor}
              zIndex={3}
            />
          ))}
          <Marker coordinate={{ latitude, longitude }} title="Geplanter Standort" pinColor="#007AFF" />
        </MapView>
        {selectedEnergyItem ? (
          <View style={[styles.energyDetail, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Anlagendetails schließen"
              onPress={() => setSelectedEnergyItem(null)}
              style={styles.energyDetailClose}
            >
              <Feather name="x" size={17} color={theme.textSecondary} />
            </Pressable>
            <ThemedText style={[styles.energyDetailTitle, { color: theme.text }]}>
              {selectedEnergyItem.name || "Energieanlage"}
            </ThemedText>
            <ThemedText style={[styles.energyDetailText, { color: theme.textSecondary }]}>
              Quelle: {selectedEnergyItem.source} · Amtlicher Abgleich: nicht gefunden
            </ThemedText>
            {typeof selectedEnergyItem.taggedHeightM === "number" ? (
              <ThemedText style={[styles.energyDetailText, { color: theme.textSecondary }]}>
                Höhe laut Quelle: {Math.round(selectedEnergyItem.taggedHeightM)} m
              </ThemedText>
            ) : null}
            {selectedEnergyItem.voltage ? (
              <ThemedText style={[styles.energyDetailText, { color: theme.textSecondary }]}>
                Spannung: {selectedEnergyItem.voltage}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </View>

      <ScrollView
        style={styles.panel}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        <Card style={[styles.card, { borderLeftWidth: 3, borderLeftColor: highlightColor }]}>
          <View style={styles.headerRow}>
            <View style={[styles.badge, { backgroundColor: highlightColor }]}>
              <ThemedText style={styles.badgeText}>{zone.layerLabel || "Geozone"}</ThemedText>
            </View>
          </View>
          <ThemedText style={styles.zoneName}>{zone.name || "Unbenannte Zone"}</ThemedText>

          {zone.restriction ? (
            <View style={styles.dataRow}>
              <ThemedText style={[styles.dataLabel, { color: theme.textSecondary }]}>Beschränkung</ThemedText>
              <ThemedText style={[styles.dataValue, { color: theme.text }]}>{zone.restriction}</ThemedText>
            </View>
          ) : null}

          {alt ? (
            <View style={styles.dataRow}>
              <ThemedText style={[styles.dataLabel, { color: theme.textSecondary }]}>Höhe</ThemedText>
              <ThemedText style={[styles.dataValue, { color: theme.text }]}>{alt}</ThemedText>
            </View>
          ) : null}

          {zone.details ? (
            <ThemedText style={[styles.details, { color: theme.textTertiary }]}>{zone.details}</ThemedText>
          ) : null}

          {zone.applicationText ? (
            <View style={[styles.noteBox, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
              <ThemedText style={[styles.noteText, { color: theme.textSecondary }]}>{zone.applicationText}</ThemedText>
            </View>
          ) : null}

          {zone.links && zone.links.length > 0 ? (
            <View style={styles.linkColumn}>
              {zone.links
                .filter((l) => l && l.url && l.label)
                .map((l, i) => {
                  const isMail = /@/.test(l.url) && !/^https?:/i.test(l.url);
                  const href = isMail ? `mailto:${l.url}` : l.url;
                  return (
                    <Pressable
                      key={`link-${i}`}
                      onPress={() => { openLink(href).catch(() => {}); }}
                      style={[styles.linkButton, { backgroundColor: theme.primary + "15" }]}
                    >
                      <Feather name={isMail ? "mail" : "external-link"} size={14} color={theme.primary} />
                      <ThemedText style={[styles.linkText, { color: theme.primary }]}>{l.label}</ThemedText>
                    </Pressable>
                  );
                })}
            </View>
          ) : null}
        </Card>

        {!hasGeometry ? (
          <View style={[styles.fallbackNote, { backgroundColor: theme.statusCautionBackground || "rgba(255,149,0,0.1)", borderColor: theme.statusCaution || "#FF9500" }]}>
            <Feather name="info" size={14} color={theme.statusCaution || "#FF9500"} style={{ marginTop: 2 }} />
            <ThemedText style={[styles.fallbackText, { color: theme.textSecondary }]}>
              Für diese Quelle liegt kein exakter Zonenumriss vor. Die Karte zeigt
              deinen geplanten Standort und das Geozonen-Overlay des Landes – nicht
              die genaue Grenze dieser Zone.
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapWrapper: { height: "48%", width: "100%" },
  energyDetail: {
    position: "absolute",
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    paddingRight: 40,
  },
  energyDetailClose: { position: "absolute", top: 8, right: 8, padding: 4, zIndex: 1 },
  energyDetailTitle: { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  energyDetailText: { fontSize: 12, lineHeight: 17 },
  panel: { flex: 1 },
  card: { padding: Spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: Spacing.xs },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
  },
  badgeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  zoneName: { ...Typography.h4, marginBottom: Spacing.sm },
  dataRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 4, gap: Spacing.md },
  dataLabel: { fontSize: 13, fontWeight: "600" },
  dataValue: { fontSize: 13, flexShrink: 1, textAlign: "right" },
  details: { fontSize: 13, marginTop: Spacing.sm, lineHeight: 18 },
  noteBox: { marginTop: Spacing.sm, padding: Spacing.sm, borderRadius: BorderRadius.sm, borderWidth: 1 },
  noteText: { fontSize: 12, lineHeight: 17 },
  linkColumn: { marginTop: Spacing.sm, gap: 6 },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
    alignSelf: "flex-start",
  },
  linkText: { fontSize: 13, fontWeight: "600" },
  fallbackNote: {
    flexDirection: "row",
    gap: 8,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  fallbackText: { fontSize: 12, lineHeight: 17, flex: 1 },
});
