import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { MAIN_MAP_HTML } from "./TrafficMapView.native";
import { simplifyRingGroup } from "@/lib/ringSimplify";

export interface NotamMapOverlay {
  id: string;
  // Gruppen enthalten je Polygon [Außenring, ...Löcher].
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
  countryIso?: string | null;
  mapType: "standard" | "satellite" | "osm" | "grayscale";
  overlays: NotamMapOverlay[];
  pin?: { latitude: number; longitude: number } | null;
  onMapPress: (latitude: number, longitude: number) => void;
  onLongPress: (latitude: number, longitude: number) => void;
}

const MAP_READY_TIMEOUT_MS = 15000;

function validPoint(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function circleAsRing(center: [number, number], radiusM: number, steps = 48): [number, number][] {
  const [lat, lon] = center;
  const angularRadius = radiusM / 6_371_000;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const bearing = 2 * Math.PI * i / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularRadius) +
      Math.cos(lat1) * Math.sin(angularRadius) * Math.cos(bearing),
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(lat1),
      Math.cos(angularRadius) - Math.sin(lat1) * Math.sin(lat2),
    );
    ring.push([lat2 * 180 / Math.PI, ((lon2 * 180 / Math.PI + 540) % 360) - 180]);
  }
  ring.push(ring[0]);
  return ring;
}

export default function NotamRestrictionMap({
  centerLat,
  centerLon,
  latDelta,
  lonDelta,
  focusLat,
  focusLon,
  mapType,
  overlays,
  onMapPress,
  onLongPress,
}: NotamRestrictionMapProps) {
  const colorScheme = useColorScheme();
  const webRef = useRef<WebView>(null);
  const loadFailedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const focused = focusLat != null && focusLon != null && validPoint(focusLat, focusLon);
  const center = focused ? [focusLat as number, focusLon as number] : [centerLat, centerLon];
  const regionLatDelta = focused ? 0.15 : latDelta;
  const regionLonDelta = focused ? 0.15 : lonDelta;
  const validRegion =
    validPoint(center[0], center[1]) &&
    Number.isFinite(regionLatDelta) &&
    Number.isFinite(regionLonDelta) &&
    regionLatDelta > 0 &&
    regionLonDelta > 0;
  const zoom = Math.max(3, Math.min(18, Math.round(Math.log2(360 / Math.max(regionLatDelta, 0.0001)))));
  const fitKey = `${center[0]}:${center[1]}:${regionLatDelta}:${regionLonDelta}`;
  const baseStyle = mapType === "satellite"
    ? "satellite"
    : mapType === "grayscale"
      ? "grayscale"
      : "standard";

  // Ausschließlich Geometrien aus der NOTAM-Liste zeichnen. Kreise und alle
  // Geozonen-/Radar-Layer der Hauptkarte bleiben in diesem Kartenmodus aus.
  const notamPolygons = useMemo(() => {
    const result: { r: [number, number][][]; f: string; s: string; w: number }[] = [];
    for (const overlay of overlays) {
      let hasPolygon = false;
      for (const group of overlay.groups ?? []) {
        const validRings = group
          .map((ring) => ring.filter(([lat, lon]) => validPoint(lat, lon)))
          .filter((ring) => ring.length >= 3);
        const rings = simplifyRingGroup(validRings);
        if (!rings.length) continue;
        hasPolygon = true;
        result.push({
          r: rings,
          f: overlay.fillColor,
          s: overlay.strokeColor,
          w: overlay.strokeWidth,
        });
      }
      // Punktgeometrien aus dipul tragen ihre Position in center/radiusM.
      // Web zeichnet diesen Fall als Kreis; die native Leaflet-Karte erhält
      // dieselbe Fläche als Polygon, damit Punkt-NOTAMs nicht verschwinden.
      if (!hasPolygon && overlay.center && validPoint(overlay.center[0], overlay.center[1])) {
        const radiusM = Number.isFinite(overlay.radiusM) && (overlay.radiusM ?? 0) > 0
          ? overlay.radiusM!
          : 5000;
        result.push({
          r: [circleAsRing(overlay.center, radiusM)],
          f: overlay.fillColor,
          s: overlay.strokeColor,
          w: overlay.strokeWidth,
        });
      }
    }
    return result;
  }, [overlays]);

  const stateJson = useMemo(() => JSON.stringify({
    fit: fitKey,
    center,
    zoom,
    base: baseStyle,
    dark: colorScheme === "dark",
    lockPan: false,
    geo: [],
    user: null,
    markers: [],
    trails: [],
    circles: {},
    fov: null,
    hz: [],
    nt: notamPolygons,
    vz: [],
    ctr: [],
    air: [],
  }), [fitKey, center[0], center[1], zoom, mapType, colorScheme, notamPolygons]);

  useEffect(() => {
    if (!validRegion || ready || loadError) return;
    const timeout = setTimeout(() => setLoadError(true), MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [validRegion, ready, loadError, attempt]);

  useEffect(() => {
    if (!ready || !validRegion) return;
    webRef.current?.injectJavaScript(`window.__apply(${stateJson});true;`);
  }, [ready, validRegion, stateJson]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let message: { type?: string; lat?: number; lon?: number; base?: string };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === "baseTileLoaded") {
      const expectedBase = baseStyle;
      if (message.base !== expectedBase) return;
      loadFailedRef.current = false;
      setLoadError(false);
      setReady(true);
      return;
    }
    // HTML-DOM initialisiert heißt noch nicht, dass die Kacheln sichtbar sind.
    // Der native Ladezustand endet erst mit der ersten geladenen Basiskarte.
    if (message.type === "ready" || message.type === "baseTileError") return;
    if (message.type === "mapError") {
      loadFailedRef.current = true;
      setReady(false);
      setLoadError(true);
      return;
    }
    if (message.type !== "mapPress" && message.type !== "longPress") return;
    if (message.lat == null || message.lon == null || !validPoint(message.lat, message.lon)) return;
    if (message.type === "mapPress") onMapPress(message.lat, message.lon);
    else onLongPress(message.lat, message.lon);
  }, [onMapPress, onLongPress, mapType]);

  // onLoadEnd heißt nur, dass das HTML-Dokument geladen wurde — nicht, dass
  // Leaflet und die Grundkartenkacheln sichtbar sind. Deshalb wenden wir den
  // Zustand direkt an, prüfen den Leaflet-Start und warten auf eine echte Kachel.
  // Das fängt sowohl die verlorene frühe iOS-Bridge-Nachricht als auch fehlende
  // Leaflet-/Tile-Loads ab, statt einen leeren WebView als bereit zu markieren.
  const handleLoadEnd = useCallback(() => {
    if (loadFailedRef.current) return;
    const base = baseStyle;
    webRef.current?.injectJavaScript(`(function(){
      var tries = 0;
      function applyWhenReady(){
        try {
          if (typeof window.__apply !== "function" || typeof window.__hasBaseTile !== "function") {
            if (tries++ < 20) { setTimeout(applyWhenReady, 250); return; }
            if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({type:"mapError"}));
            return;
          }
          var applied = window.__apply(${stateJson});
          if (!applied) return;
          if (window.__hasBaseTile(${JSON.stringify(base)})) {
            if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({type:"baseTileLoaded",base:${JSON.stringify(base)}}));
          }
        } catch (e) {
          if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({type:"mapError"}));
        }
      }
      applyWhenReady();
    })();true;`);
  }, [mapType, stateJson]);

  const handleError = useCallback(() => {
    loadFailedRef.current = true;
    setReady(false);
    setLoadError(true);
  }, []);

  const retry = useCallback(() => {
    loadFailedRef.current = false;
    setReady(false);
    setLoadError(false);
    setAttempt((current) => current + 1);
  }, []);

  return (
    <View style={{ flex: 1, position: "relative" }} testID="notam-map-host">
      {validRegion && !loadError ? (
        <WebView
          key={attempt}
          ref={webRef}
          source={{ html: MAIN_MAP_HTML }}
          originWhitelist={["*"]}
          style={[StyleSheet.absoluteFill, { backgroundColor: colorScheme === "dark" ? "#1A1F2E" : "#E8ECF2" }]}
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          onError={handleError}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          overScrollMode="never"
          androidLayerType="hardware"
          setSupportMultipleWindows={false}
          automaticallyAdjustContentInsets={false}
          bounces={false}
          allowsInlineMediaPlayback
        />
      ) : null}
      {!ready && !loadError ? (
        <View pointerEvents="none" style={styles.status} testID="notam-map-loading">
          <ActivityIndicator color="#0A84FF" />
          <Text style={styles.statusText}>Karte wird geladen…</Text>
        </View>
      ) : null}
      {loadError || !validRegion ? (
        <View style={styles.status}>
          <Text style={styles.statusText}>
            {validRegion ? "Karte konnte nicht geladen werden." : "Ungültiger Kartenausschnitt."}
          </Text>
          {validRegion ? (
            <Pressable onPress={retry} style={styles.retryButton} testID="notam-map-retry">
              <Text style={styles.retryText}>Karte erneut laden</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  status: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#1C1C1E",
  },
  statusText: { color: "#FFFFFF", textAlign: "center", paddingHorizontal: 24 },
  retryButton: { backgroundColor: "#0A84FF", borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12 },
  retryText: { color: "#FFFFFF", fontWeight: "600" },
});