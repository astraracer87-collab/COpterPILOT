import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, StyleSheet, Pressable, Platform, useWindowDimensions } from "react-native";
import MapView, { Polyline, Marker, Circle, UrlTile, PROVIDER_DEFAULT } from "@/components/maps";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useMapBasemapStyle } from "@/hooks/useMapBasemapStyle";
import { nativeMapBasemapProps } from "@/lib/mapBasemap";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  getCountryGeozoneConfig,
  loadGeozoneSettings,
  getActiveLayerNames,
  buildGeozoneCacheTileUrl,
  buildGeozoneTileUrls,
  buildVectorGeozoneTileUrl,
  isRasterTiledVectorCountry,
  GEOZONE_TILE_MIN_ZOOM,
} from "@/lib/geozones";
import { detectCountryFromCoordinates } from "@/lib/countryMaps";
import { entitlementGrantsCountry } from "../../shared/countryEntitlements";
import { useAuth } from "@/lib/auth";

export interface DjiMapTrack {
  coords: { latitude: number; longitude: number }[];
  color: string;
  label?: string;
}

export interface DjiMapMarker {
  latitude: number;
  longitude: number;
  heading?: number; // Grad, 0 = Norden
  color?: string;
}

export interface DjiRadiusCircle {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export interface DjiTracksMapHandle {
  /** Erzeugt einen Base64-JPEG-Snapshot der aktuellen Kartenansicht (ohne data:-Präfix). */
  capture: () => Promise<string | null>;
  /** Erzeugt nacheinander einen Karten- und einen Satelliten-Snapshot und stellt
   *  danach die ursprüngliche Ansicht wieder her. */
  captureBoth: () => Promise<{ standard: string | null; satellite: string | null }>;
}

interface Props {
  tracks: DjiMapTrack[];
  height?: number;
  /** Bewegter Drohnen-Pfeil für die Flugwiedergabe (Daumenkino). */
  marker?: DjiMapMarker;
  /** Flugwiedergabe: bereits geflogener Teil (wird kräftig über die blasse Route gezeichnet) */
  progressCoords?: { latitude: number; longitude: number }[];
  progressColor?: string;
  /** Optionaler Radius-Kreis (z. B. geplantes Fluggebiet). */
  radiusCircle?: DjiRadiusCircle;
  /** Geozonen-Overlay direkt eingeblendet starten (z. B. für Protokoll-Snapshots). */
  initialGeozonesOn?: boolean;
  /** Wird aufgerufen, sobald die Karte gerendert und eingepasst ist (für Auto-Snapshot). */
  onReady?: () => void;
}

function deltaForRadiusKm(radiusKm: number, latitude: number): { latitudeDelta: number; longitudeDelta: number } {
  const span = Math.max(0.3, radiusKm) * 2.6; // km, etwas Rand
  const latDelta = span / 111;
  const lonDelta = span / (111 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));
  return { latitudeDelta: latDelta, longitudeDelta: lonDelta };
}

/**
 * Gemeinsame Karte für alle DJI-Log-Segmente eines Fluges. Zeigt jeden Track
 * in eigener Farbe (chronologisch), Start-/Endmarker, optional einen Radius-Kreis,
 * und blendet auf Wunsch die dipul-Geozonen (WMS) für das Land des Fluges ein.
 * Über die Ref kann ein PNG-Snapshot (z. B. fürs Protokoll-PDF) erzeugt werden.
 */
const DjiTracksMap = forwardRef<DjiTracksMapHandle, Props>(function DjiTracksMap(
  { tracks: rawTracks, height: heightProp, marker, progressCoords, progressColor, radiusCircle, initialGeozonesOn = false, onReady },
  ref,
) {
  const { theme } = useTheme();
  // Ohne feste Höhe: groß (gut 60 % der Bildschirmhöhe), damit man den Flug erkennt
  const { height: winH } = useWindowDimensions();
  const height = heightProp ?? Math.max(280, Math.round(winH * 0.62));
  // Anzeige: höchstens ~800 Punkte je Flug (Logs haben bis 10 Punkte/s) –
  // sonst wird die Karte beim Verschieben/Zoomen zäh
  const tracks = useMemo(
    () =>
      rawTracks.map((t) => {
        const n = t.coords.length;
        if (n <= 800) return t;
        const step = n / 800;
        const out = [];
        for (let i = 0; i < 800; i++) out.push(t.coords[Math.floor(i * step)]);
        out.push(t.coords[n - 1]);
        return { ...t, coords: out };
      }),
    [rawTracks],
  );
  const mapRef = useRef<MapView>(null);
  const [geozonesOn, setGeozonesOn] = useState(initialGeozonesOn);
  const [mapStyle, setMapStyle] = useMapBasemapStyle();
  const mapStyleRef = useRef(mapStyle);
  mapStyleRef.current = mapStyle;
  const [wmsUrls, setWmsUrls] = useState<string[]>([]);
  // Marker-Bitmap nach erstem Frame "einfrieren" (Performance beim Bewegen).
  const [arrowReady, setArrowReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArrowReady(true), 60);
    return () => clearTimeout(t);
  }, []);

  const allCoords = useMemo(
    () => tracks.flatMap((t) => t.coords),
    [tracks],
  );

  const hasTrack = allCoords.length >= 2;

  const fallbackCenter = useMemo(() => {
    if (allCoords[0]) return allCoords[0];
    if (radiusCircle) return { latitude: radiusCircle.latitude, longitude: radiusCircle.longitude };
    return null;
  }, [allCoords, radiusCircle]);

  const countryIso = useMemo(() => {
    if (!fallbackCenter) return "DE";
    return detectCountryFromCoordinates(fallbackCenter.latitude, fallbackCenter.longitude) || "DE";
  }, [fallbackCenter]);

  // Länder-Berechtigung: react-native-maps UrlTile sendet KEIN Session-Cookie,
  // daher kann das Server-Gate gesperrte Länder dort nicht leeren. Geozonen für
  // ein nicht freigeschaltetes Land dürfen auch hier (Protokoll-/Track-Karte)
  // nicht erscheinen — Filterung erfolgt clientseitig.
  const { entitlement } = useAuth();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!entitlementGrantsCountry(entitlement, countryIso)) {
        if (!cancelled) setWmsUrls([]);
        return;
      }
      try {
        // Raster-Vektor-Land (z. B. Belgien): serverseitig rasterisierte PNG-Kachel
        // statt WMS (BE hat keine WMS-Layer -> WMS-Builder liefert "").
        if (isRasterTiledVectorCountry(countryIso)) {
          const vurl = buildVectorGeozoneTileUrl(countryIso);
          if (!cancelled) setWmsUrls(vurl ? [vurl] : []);
          return;
        }
        const settings = await loadGeozoneSettings(countryIso);
        const enabled = getActiveLayerNames(settings, countryIso);
        if (!cancelled) setWmsUrls(buildGeozoneTileUrls(enabled, countryIso));
      } catch {
        if (!cancelled) setWmsUrls([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countryIso, entitlement]);

  const fit = useCallback(() => {
    if (!mapRef.current) return;
    if (hasTrack) {
      mapRef.current.fitToCoordinates(allCoords, {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: false,
      });
    } else if (radiusCircle) {
      const delta = deltaForRadiusKm(radiusCircle.radiusKm, radiusCircle.latitude);
      mapRef.current.animateToRegion(
        {
          latitude: radiusCircle.latitude,
          longitude: radiusCircle.longitude,
          ...delta,
        },
        0,
      );
    }
  }, [hasTrack, allCoords, radiusCircle]);

  const capture = useCallback(async (): Promise<string | null> => {
    if (!mapRef.current) return null;
    try {
      const result = await mapRef.current.takeSnapshot({
        width: 700,
        height: 500,
        format: "jpg",
        quality: 0.6,
        result: "base64",
      });
      return typeof result === "string" && result.length > 0 ? result : null;
    } catch {
      return null;
    }
  }, []);

  // Nimmt nacheinander einen Karten- und einen Satelliten-Snapshot auf. Der
  // mapType wird kurz umgeschaltet (Kachel-Ladezeit abwarten) und danach auf die
  // Nutzerauswahl zurückgesetzt.
  const captureBoth = useCallback(async (): Promise<{
    standard: string | null;
    satellite: string | null;
  }> => {
    const previous = mapStyleRef.current;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const snapAs = async (style: "standard" | "satellite", delay: number) => {
      setMapStyle(style);
      await wait(delay);
      return capture();
    };
    try {
      const standard = await snapAs("standard", 450);
      const satellite = await snapAs("satellite", 1600);
      return { standard, satellite };
    } finally {
      setMapStyle(previous);
    }
  }, [capture, setMapStyle]);

  useImperativeHandle(ref, () => ({ capture, captureBoth }), [capture, captureBoth]);

  const handleMapReady = useCallback(() => {
    fit();
    if (onReady) setTimeout(onReady, 700);
  }, [fit, onReady]);

  if (!hasTrack && !radiusCircle) {
    return (
      <ThemedText style={[styles.empty, { color: theme.textSecondary }]}>
        Kein GPS-Track verfügbar (verschlüsseltes Log oder keine Positionsdaten).
      </ThemedText>
    );
  }

  const initialRegion = hasTrack
    ? {
        latitude: allCoords[0].latitude,
        longitude: allCoords[0].longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }
    : {
        latitude: radiusCircle!.latitude,
        longitude: radiusCircle!.longitude,
        ...deltaForRadiusKm(radiusCircle!.radiusKm, radiusCircle!.latitude),
      };

  const start = hasTrack ? allCoords[0] : null;
  const end = hasTrack ? allCoords[allCoords.length - 1] : null;

  return (
    <View style={[styles.wrapper, { height, borderColor: theme.border }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        {...nativeMapBasemapProps(mapStyle, Platform.OS)}
        initialRegion={initialRegion}
        onMapReady={handleMapReady}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {geozonesOn
          ? wmsUrls.map((url, i) => (
              <UrlTile
                key={`gz-${i}-${url}`}
                urlTemplate={url}
                zIndex={1}
                minimumZ={GEOZONE_TILE_MIN_ZOOM}
                maximumZ={19}
                maximumNativeZ={getCountryGeozoneConfig(countryIso).wmsMaxNativeZoom}
                opacity={0.6}
                tileSize={256}
              />
            ))
          : null}
        {radiusCircle ? (
          <Circle
            center={{ latitude: radiusCircle.latitude, longitude: radiusCircle.longitude }}
            radius={Math.max(50, radiusCircle.radiusKm * 1000)}
            strokeColor={theme.primary}
            strokeWidth={2}
            fillColor={theme.primary + "1A"}
            zIndex={2}
          />
        ) : null}
        {tracks.map((t, i) =>
          t.coords.length >= 2 ? (
            <Polyline
              key={`track-${i}`}
              coordinates={t.coords}
              strokeColor={t.color}
              strokeWidth={3}
              zIndex={3}
            />
          ) : null,
        )}
        {progressCoords && progressCoords.length >= 2 ? (
          <Polyline
            key="progress"
            coordinates={progressCoords}
            strokeColor={progressColor ?? theme.primary}
            strokeWidth={5}
            zIndex={4}
          />
        ) : null}
        {start ? <Marker coordinate={start} title="Start" pinColor="#34C759" /> : null}
        {end ? <Marker coordinate={end} title="Ende" pinColor="#FF3B30" /> : null}
        {marker ? (
          <Marker
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={marker.heading ?? 0}
            tracksViewChanges={!arrowReady}
            zIndex={4}
          >
            <View style={[styles.arrow, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Feather name="navigation-2" size={20} color={marker.color ?? theme.primary} />
            </View>
          </Marker>
        ) : null}
      </MapView>

      <View style={styles.toggleRow}>
        {([
          { id: "standard" as const, label: "Karte", testID: "button-dji-map-standard", icon: "map" as const },
          { id: "grayscale" as const, label: "Grau", testID: "button-dji-map-grayscale", icon: "sliders" as const },
          { id: "satellite" as const, label: "Satellit", testID: "button-dji-map-satellite", icon: "globe" as const },
        ]).map((option) => (
          <Pressable
            key={option.id}
            testID={option.testID}
            onPress={() => setMapStyle(option.id)}
            style={({ pressed }) => [
              styles.toggle,
              {
                backgroundColor: (mapStyle === option.id || (option.id === "standard" && mapStyle === "osm")) ? theme.primary : theme.background,
                borderColor: theme.border,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Feather
              name={option.icon}
              size={13}
              color={mapStyle === option.id || (option.id === "standard" && mapStyle === "osm") ? "#fff" : theme.primary}
            />
            <ThemedText
              style={[styles.toggleText, { color: mapStyle === option.id || (option.id === "standard" && mapStyle === "osm") ? "#fff" : theme.primary }]}
            >
              {option.label}
            </ThemedText>
          </Pressable>
        ))}
        <Pressable
          testID="button-dji-map-geozones"
          onPress={() => setGeozonesOn((v) => !v)}
          style={({ pressed }) => [
            styles.toggle,
            {
              backgroundColor: geozonesOn ? theme.primary : theme.background,
              borderColor: theme.border,
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Feather name="layers" size={13} color={geozonesOn ? "#fff" : theme.primary} />
          <ThemedText
            style={[styles.toggleText, { color: geozonesOn ? "#fff" : theme.primary }]}
          >
            Geozonen
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
});

export default DjiTracksMap;

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.xs,
    backgroundColor: "#E5E7EB",
  },
  empty: {
    ...Typography.small,
    marginTop: Spacing.xs,
  },
  toggleRow: {
    position: "absolute",
    top: Spacing.sm,
    right: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleText: {
    ...Typography.caption,
    fontWeight: "700",
  },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
