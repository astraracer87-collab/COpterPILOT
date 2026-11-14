import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import MapView, { Marker, Circle, WMSTile } from "@/components/maps";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import { useHeaderHeight, HeaderButton } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { useMapBasemapStyle } from "@/hooks/useMapBasemapStyle";
import { nativeMapBasemapProps } from "@/lib/mapBasemap";
import {
  buildCombinedWmsTileUrl,
  getCountriesInRadius,
  getCountryGeozoneConfig,
  loadGeozoneSettings,
  getActiveLayerNames,
  GEOZONE_TILE_MIN_ZOOM,
} from "@/lib/geozones";
import { splitCountriesByAccess, countryName } from "../../shared/countryEntitlements";
import { useAuth } from "@/lib/auth";

interface LocationMapParams {
  latitude: number;
  longitude: number;
  title?: string;
  radiusM?: number;
  countryIso?: string;
}

const PILOT_COLOR = "#007AFF";

export default function LocationMapScreen() {
  const route = useRoute<RouteProp<{ params: LocationMapParams }, "params">>();
  const navigation = useNavigation();
  const { theme, isDark } = useTheme();
  const headerHeight = useHeaderHeight();
  const mapRef = useRef<MapView | null>(null);
  const [mapStyle] = useMapBasemapStyle();

  const { latitude, longitude, title, radiusM, countryIso } = route.params || { latitude: 51.1657, longitude: 10.4515 };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: title || "Standort",
      headerRight: () => (
        <HeaderButton onPress={() => navigation.goBack()}>
          <Feather name="x" size={22} color={theme.text} />
        </HeaderButton>
      ),
    });
  }, [navigation, theme.text, title]);

  // Region passend zum Radius wählen — mind. 0.05° (~5 km Sichtbereich),
  // sonst etwa das 3,5-Fache des Radius, damit der Umkreis komplett sichtbar ist.
  const initialDelta = useMemo(() => {
    if (!radiusM || radiusM <= 0) return 0.05;
    const degPerKm = 1 / 111;
    const radiusKm = radiusM / 1000;
    return Math.max(0.02, radiusKm * degPerKm * 3.5);
  }, [radiusM]);

  // WMS-Overlays für die Default-Geozonen (CTR, ED-R, Tieffluggebiete,
  // NOTAMs, Naturschutz usw.) — pro Land aus den Pilot-Einstellungen.
  // Länder-Berechtigung: react-native-maps WMSTile sendet KEIN Session-Cookie,
  // daher kann das Server-Gate gesperrte Länder dort nicht leeren. Geozonen
  // gesperrter (Nachbar-)Länder müssen clientseitig ausgegraut werden.
  const { entitlement } = useAuth();
  const [wmsUrls, setWmsUrls] = useState<{ iso: string; url: string }[]>([]);
  const [lockedNames, setLockedNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = (radiusM ?? 1000) / 1000;
      const candidates = getCountriesInRadius(latitude, longitude, Math.max(r, 5), countryIso);
      const { unlocked, locked } = splitCountriesByAccess(candidates, entitlement);
      if (!cancelled) setLockedNames(locked.map((iso) => countryName(iso)));
      const countries = unlocked;
      const urls: { iso: string; url: string }[] = [];
      for (const iso of countries) {
        try {
          const settings = await loadGeozoneSettings(iso);
          const enabledLayers = getActiveLayerNames(settings, iso)
            .filter((name): name is string => typeof name === "string" && name.length > 0);
          if (enabledLayers.length > 0) {
            for (const url of buildCombinedWmsTileUrl(enabledLayers, iso)) {
              urls.push({ iso, url });
            }
          }
        } catch {
          // Land ohne WMS-Konfig — ignorieren.
        }
      }
      if (!cancelled) setWmsUrls(urls);
    })();
    return () => { cancelled = true; };
  }, [latitude, longitude, radiusM, countryIso, entitlement]);

  return (
    <ThemedView style={styles.container}>
      <MapView
        ref={mapRef}
        style={[styles.map, { marginTop: headerHeight }]}
        {...nativeMapBasemapProps(mapStyle, Platform.OS)}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta: initialDelta,
          longitudeDelta: initialDelta,
        }}
        showsUserLocation
        showsMyLocationButton
        showsCompass
        showsScale
      >
        {wmsUrls.map(({ iso, url }, i) => url ? (
          <WMSTile
            key={`wms-${iso}-${i}-${url}`}
            urlTemplate={url}
            zIndex={-1}
            minimumZ={GEOZONE_TILE_MIN_ZOOM}
            maximumNativeZ={getCountryGeozoneConfig(iso).wmsMaxNativeZoom}
            opacity={isDark ? 0.55 : 0.7}
            tileSize={256}
          />
        ) : null)}
        {radiusM != null && radiusM > 0 ? (
          <Circle
            center={{ latitude, longitude }}
            radius={radiusM}
            fillColor="rgba(0,122,255,0.12)"
            strokeColor={PILOT_COLOR}
            strokeWidth={2}
          />
        ) : null}
        <Marker
          coordinate={{ latitude, longitude }}
          title={title || "Flugstandort"}
          pinColor={PILOT_COLOR}
        />
      </MapView>

      {radiusM != null && radiusM > 0 ? (
        <View style={[styles.infoChip, { backgroundColor: theme.background + "EE", borderColor: theme.border, top: headerHeight + 12 }]}>
          <Feather name="target" size={12} color={PILOT_COLOR} />
          <ThemedText style={[styles.infoChipText, { color: theme.text }]}>
            Geplanter Umkreis: {radiusM >= 1000 ? `${(radiusM / 1000).toFixed(radiusM % 1000 === 0 ? 0 : 1)} km` : `${Math.round(radiusM)} m`}
          </ThemedText>
        </View>
      ) : null}

      {lockedNames.length > 0 ? (
        <View
          style={[styles.lockedHint, { top: headerHeight + (radiusM != null && radiusM > 0 ? 52 : 12) }]}
          pointerEvents="none"
          testID="hint-locked-countries"
        >
          <Feather name="lock" size={13} color="#FFFFFF" />
          <ThemedText style={styles.lockedHintText}>
            {lockedNames.length === 1
              ? `${lockedNames[0]}: Land freischalten`
              : `Land freischalten: ${lockedNames.join(", ")}`}
          </ThemedText>
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  infoChip: {
    position: "absolute",
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  infoChipText: {
    fontSize: 12,
    fontWeight: "600",
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
