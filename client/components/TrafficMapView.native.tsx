import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { View, StyleSheet, Text, Platform, Pressable, ActivityIndicator, ScrollView, LayoutChangeEvent, Modal, SafeAreaView, useColorScheme } from "react-native";
import MapView, { Marker, Polyline, Circle, Polygon, WMSTile, UrlTile, Region } from "@/components/maps";
import { WebView } from "react-native-webview";
import { MaterialCommunityIcons, Feather, FontAwesome6 } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import * as Location from "@/lib/location";
import { BorderRadius } from "@/constants/theme";
import { getCategoryLabel, type AircraftCategory, type DataSource } from "@/lib/opensky";
import { buildCombinedWmsTileUrl, queryGeozoneFeatureInfo, getCountryGeozoneConfig, getCountriesInRadius, type GeozoneFeatureInfo } from "@/lib/geozones";

export interface TrafficMarker {
  id: string;
  latitude: number;
  longitude: number;
  pinColor: string;
  title: string;
  description: string;
  heading?: number;
  altitude?: string;
  altitudeDual?: string;
  speed?: string;
  category?: AircraftCategory;
  sources?: DataSource[];
  isApproaching?: boolean;
  isAlert?: boolean;
  isStale?: boolean;
}

export interface TrailPoint {
  latitude: number;
  longitude: number;
}

export interface AircraftTrail {
  id: string;
  color: string;
  points: TrailPoint[];
  isAlert?: boolean;
}

export interface WindData {
  direction: number;
  speed: number;
  directionLabel: string;
}

interface TrafficMapViewProps {
  latitude: number;
  longitude: number;
  latDelta: number;
  lonDelta: number;
  locationName?: string;
  markers: TrafficMarker[];
  trails?: AircraftTrail[];
  fullScreen?: boolean;
  alarmRadiusM?: number;
  taRadiusM?: number;
  scanRadiusM?: number;
  onLongPress?: (lat: number, lon: number) => void;
  wind?: WindData | null;
  sourceStatus?: Record<DataSource, "ok" | "error" | "timeout">;
  geozoneLayers?: string[];
  countryIso?: string;
  mapStyle?: "standard" | "satellite" | "osm";
  onMapStyleChange?: (style: "standard" | "satellite" | "osm") => void;
  onCenterGps?: () => void;
  onSettingsPress?: () => void;
  settingsActive?: boolean;
  bottomPadding?: number;
  topInset?: number;
  weatherAlerts?: { label: string; value: string; color: string }[];
  onHeadingChange?: (heading: number | null) => void;
  disableGeozoneQuery?: boolean;
}

function snapHeading(deg: number): number {
  return Math.round(deg);
}

function GliderIcon({ color, size }: { color: string; size: number }) {
  const s = size;
  return (
    <Svg width={s} height={s} viewBox="0 0 64 64">
      <Path
        d={`M32 3 C31 3 30.2 4.5 30 7 L29.5 16 L29.5 24
            C28 24.5 18 26 4 29.5
            C2 30.1 1 31 1 32
            C1 32.8 2 33.2 4 33.2
            L29.5 32 L29.5 50
            C28.5 50.5 24 51.5 22 52.2
            C20.5 52.7 20 53.2 20 53.8
            C20 54.3 20.8 54.8 22 54.8
            L29.5 54 L30 58
            C30.2 59.5 31 61 32 61
            C33 61 33.8 59.5 34 58
            L34.5 54 L42 54.8
            C43.2 54.8 44 54.3 44 53.8
            C44 53.2 43.5 52.7 42 52.2
            C40 51.5 35.5 50.5 34.5 50
            L34.5 32 L60 33.2
            C62 33.2 63 32.8 63 32
            C63 31 62 30.1 60 29.5
            C46 26 36 24.5 34.5 24
            L34.5 16 L34 7
            C33.8 4.5 33 3 32 3 Z`}
        fill={color}
      />
    </Svg>
  );
}

function HelicopterTopIcon({ color, size }: { color: string; size: number }) {
  const s = size;
  const cx = s / 2;
  const bodyW = s * 0.18;
  const bodyH = s * 0.32;
  const bodyTop = s * 0.04;
  const bodyCy = bodyTop + bodyH * 0.38;
  const bladeLen = s * 0.48;
  const bladeW = s * 0.04;
  const tailW = s * 0.05;
  const tailTop = bodyTop + bodyH * 0.80;
  const tailH = s * 0.40;
  const tailEnd = tailTop + tailH;
  const finLen = s * 0.18;
  const finW = s * 0.04;
  const hubR = s * 0.03;
  return (
    <View style={{ width: s, height: s, position: "relative" }}>
      {[45, -45].map((angle) => (
        <View key={angle} style={{
          position: "absolute", width: bladeW, height: bladeLen * 2,
          backgroundColor: color,
          left: cx - bladeW / 2, top: bodyCy - bladeLen,
          borderRadius: bladeW / 2,
          transform: [{ rotate: `${angle}deg` }],
        }} />
      ))}
      <View style={{
        position: "absolute",
        left: cx - bodyW / 2, top: bodyTop,
        width: bodyW, height: bodyH,
        backgroundColor: color,
        borderTopLeftRadius: bodyW / 2,
        borderTopRightRadius: bodyW / 2,
        borderBottomLeftRadius: bodyW * 0.35,
        borderBottomRightRadius: bodyW * 0.35,
      }} />
      <View style={{
        position: "absolute",
        left: cx - hubR, top: bodyCy - hubR,
        width: hubR * 2, height: hubR * 2,
        borderRadius: hubR,
        borderWidth: s * 0.02,
        borderColor: color,
        backgroundColor: "transparent",
      }} />
      <View style={{
        position: "absolute",
        left: cx - tailW / 2, top: tailTop,
        width: tailW, height: tailH,
        backgroundColor: color,
      }} />
      <View style={{
        position: "absolute",
        left: cx - finLen / 2,
        top: tailEnd - finW / 2,
        width: finLen, height: finW,
        backgroundColor: color,
        borderRadius: finW / 2,
      }} />
    </View>
  );
}

function LightAircraftIcon({ color, size }: { color: string; size: number }) {
  const s = size;
  const cx = s / 2;
  const fuseW = s * 0.10;
  const fuseH = s * 0.70;
  const fuseTop = s * 0.10;
  const wingW = s * 0.95;
  const wingH = s * 0.13;
  const wingTop = fuseTop + fuseH * 0.30;
  const tailW = s * 0.35;
  const tailH = s * 0.06;
  const tailTop = fuseTop + fuseH - tailH * 0.6;
  const propW = s * 0.22;
  const propH = s * 0.03;
  const propTop = fuseTop - propH;
  return (
    <View style={{ width: s, height: s, position: "relative" }}>
      <View style={{
        position: "absolute",
        left: cx - fuseW / 2, top: fuseTop,
        width: fuseW, height: fuseH,
        backgroundColor: color,
        borderTopLeftRadius: fuseW / 2,
        borderTopRightRadius: fuseW / 2,
        borderBottomLeftRadius: fuseW * 0.3,
        borderBottomRightRadius: fuseW * 0.3,
      }} />
      <View style={{
        position: "absolute",
        left: cx - wingW / 2, top: wingTop,
        width: wingW, height: wingH,
        backgroundColor: color,
        borderRadius: wingH / 2,
      }} />
      <View style={{
        position: "absolute",
        left: cx - tailW / 2, top: tailTop,
        width: tailW, height: tailH,
        backgroundColor: color,
        borderRadius: tailH / 2,
      }} />
      <View style={{
        position: "absolute",
        left: cx - propW / 2, top: propTop,
        width: propW, height: propH,
        backgroundColor: color,
        borderRadius: propH / 2,
      }} />
    </View>
  );
}

function AircraftIcon({ category, color, heading, mapBearing = 0 }: { category: AircraftCategory; color: string; heading: number; mapBearing?: number }) {
  const shouldRotate = category !== "balloon";
  const rot = shouldRotate ? heading - mapBearing : 0;

  if (category === "airplane") {
    return (
      <View style={[styles.aircraftIcon, { transform: [{ rotate: `${rot - 45}deg` }] }]}>
        <MaterialCommunityIcons name="airplane" size={40} color={color} />
      </View>
    );
  }

  if (category === "light" || category === "ultralight") {
    const sz = category === "light" ? 32 : 26;
    return (
      <View style={[styles.aircraftIcon, { transform: [{ rotate: `${rot}deg` }] }]}>
        <LightAircraftIcon color={color} size={sz} />
      </View>
    );
  }

  if (category === "glider") {
    return (
      <View style={[styles.aircraftIcon, { transform: [{ rotate: `${rot}deg` }] }]}>
        <GliderIcon color={color} size={32} />
      </View>
    );
  }

  if (category === "helicopter") {
    return (
      <View style={[styles.aircraftIcon, { transform: [{ rotate: `${rot}deg` }] }]}>
        <HelicopterTopIcon color={color} size={34} />
      </View>
    );
  }

  if (category === "balloon") {
    return (
      <View style={styles.aircraftIcon}>
        <MaterialCommunityIcons name="airballoon" size={34} color={color} />
      </View>
    );
  }

  if (category === "drone") {
    return (
      <View style={[styles.aircraftIcon, { transform: [{ rotate: `${rot}deg` }] }]}>
        <MaterialCommunityIcons name="quadcopter" size={34} color={color} />
      </View>
    );
  }

  if (category === "ground") {
    return (
      <View style={[styles.aircraftIcon, { transform: [{ rotate: `${rot}deg` }] }]}>
        <MaterialCommunityIcons name="truck" size={30} color={color} />
      </View>
    );
  }

  return (
    <View style={[styles.aircraftIcon, { transform: [{ rotate: `${rot - 45}deg` }] }]}>
      <MaterialCommunityIcons name="airplane" size={28} color={color} />
    </View>
  );
}


const SourceDots = React.memo(function SourceDots({ sources, sourceStatus }: { sources?: DataSource[]; sourceStatus?: Record<DataSource, "ok" | "error" | "timeout"> }) {
  const allSources: DataSource[] = ["opensky", "adsbfi", "adsbone", "airplaneslive", "adsblol"];
  return (
    <View style={styles.sourceRow}>
      {allSources.map((src) => {
        const connStatus = sourceStatus?.[src];
        const hasAircraft = sources?.includes(src);
        let dotColor: string;
        if (connStatus === "error" || connStatus === "timeout") {
          dotColor = "#FF3B30";
        } else if (hasAircraft) {
          dotColor = "#34C759";
        } else {
          dotColor = "#2196F3";
        }
        return <View key={src} style={[styles.sourceDot, { backgroundColor: dotColor }]} />;
      })}
    </View>
  );
});

function WindsockShape() {
  const slices = 40;
  const totalLen = 34;
  const openW = 22;
  const tipW = 9;
  const sliceLen = totalLen / slices;
  const stripeColors = ["#DC2626", "#FFFFFF", "#DC2626", "#FFFFFF", "#DC2626"];
  const slicesPerStripe = slices / stripeColors.length;
  const elements = [];
  for (let i = 0; i < slices; i++) {
    const t = (i + 0.5) / slices;
    const w = openW - t * (openW - tipW);
    const si = Math.min(Math.floor(i / slicesPerStripe), stripeColors.length - 1);
    elements.push(
      <View
        key={i}
        style={{
          width: w,
          height: sliceLen + 0.4,
          backgroundColor: stripeColors[si],
          marginTop: i === 0 ? 0 : -0.4,
        }}
      />
    );
  }
  return (
    <View style={{ alignItems: "center" }}>
      {elements}
    </View>
  );
}

function CompassNeedle({ heading }: { heading: number }) {
  const cx = 45, cy = 45;
  const needleLen = 36;
  const needleWidth = 5;
  const rad = ((heading - 90) * Math.PI) / 180;
  const tipX = cx + needleLen * Math.cos(rad);
  const tipY = cy + needleLen * Math.sin(rad);
  const tailRad = rad + Math.PI;
  const tailX = cx + needleLen * Math.cos(tailRad);
  const tailY = cy + needleLen * Math.sin(tailRad);
  const perpRad = rad + Math.PI / 2;
  const px = needleWidth * Math.cos(perpRad);
  const py = needleWidth * Math.sin(perpRad);
  return (
    <Svg width={90} height={90} style={StyleSheet.absoluteFill}>
      <Path
        d={`M${tipX},${tipY} L${cx + px},${cy + py} L${cx - px},${cy - py} Z`}
        fill="#FF3B30"
      />
      <Path
        d={`M${tailX},${tailY} L${cx + px},${cy + py} L${cx - px},${cy - py} Z`}
        fill="rgba(255,255,255,0.85)"
      />
    </Svg>
  );
}

function WindCompass({ wind, children, deviceHeading, topInset = 0, weatherAlerts }: { wind: WindData; children?: React.ReactNode; deviceHeading?: number | null; topInset?: number; weatherAlerts?: { label: string; value: string; color: string }[] }) {
  const sockRotation = wind.direction;
  const speedColor = wind.speed >= 10 ? "#FF3B30" : wind.speed >= 6 ? "#FF9500" : "#34C759";
  const needleAngle = deviceHeading != null ? (360 - deviceHeading) : null;
  return (
    <View style={[compassStyles.container, { top: topInset + 16 }]}>
      <View style={compassStyles.roseOuter}>
        <View style={compassStyles.rose}>
          {needleAngle != null ? (
            <CompassNeedle heading={needleAngle} />
          ) : null}
          <Text style={[compassStyles.cardinal, compassStyles.cardinalN]}>N</Text>
          <Text style={[compassStyles.cardinal, compassStyles.cardinalE]}>O</Text>
          <Text style={[compassStyles.cardinal, compassStyles.cardinalS]}>S</Text>
          <Text style={[compassStyles.cardinal, compassStyles.cardinalW]}>W</Text>
          <View style={compassStyles.compassTick0} />
          <View style={compassStyles.compassTick90} />
          <View style={compassStyles.compassTick180} />
          <View style={compassStyles.compassTick270} />
          <View style={[compassStyles.sockRotator, { transform: [{ rotate: `${sockRotation}deg` }] }]}>
            <View style={compassStyles.arrowTriangle} />
            <WindsockShape />
          </View>
        </View>
      </View>
      <View style={[compassStyles.windBadge, { borderLeftColor: speedColor }]}>
        <Text style={compassStyles.windSpeed}>{wind.speed.toFixed(1)} m/s</Text>
        <Text style={compassStyles.windDir}>{wind.directionLabel} {wind.direction}°</Text>
      </View>
      {weatherAlerts && weatherAlerts.length > 0 ? (
        <View style={compassStyles.alertsContainer}>
          {weatherAlerts.map((a, i) => (
            <View key={i} style={[compassStyles.alertBadge, { borderLeftColor: a.color }]}>
              <Text style={[compassStyles.alertLabel, { color: a.color }]}>{a.label}</Text>
              <Text style={[compassStyles.alertValue, { color: a.color }]}>{a.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const compassStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 10,
    left: 10,
    alignItems: "center",
    zIndex: 10,
  },
  roseOuter: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(200, 210, 230, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 5 },
      android: { elevation: 5 },
    }),
  },
  rose: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(180, 195, 220, 0.45)",
    borderWidth: 1.5,
    borderColor: "rgba(120, 150, 200, 0.3)",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardinal: {
    position: "absolute",
    fontSize: 13,
    fontWeight: "800",
    color: "rgba(70, 90, 130, 0.8)",
    zIndex: 5,
  },
  cardinalN: { top: 2, color: "#D97706", fontSize: 14, fontWeight: "900" },
  cardinalE: { right: 4, top: 34 },
  cardinalS: { bottom: 2 },
  cardinalW: { left: 4, top: 34 },
  compassTick0: {
    position: "absolute", top: 0, width: 2, height: 6,
    backgroundColor: "rgba(70, 90, 130, 0.4)",
  },
  compassTick90: {
    position: "absolute", right: 0, width: 6, height: 2,
    backgroundColor: "rgba(70, 90, 130, 0.4)",
  },
  compassTick180: {
    position: "absolute", bottom: 0, width: 2, height: 6,
    backgroundColor: "rgba(70, 90, 130, 0.4)",
  },
  compassTick270: {
    position: "absolute", left: 0, width: 6, height: 2,
    backgroundColor: "rgba(70, 90, 130, 0.4)",
  },
  sockRotator: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "flex-start",
    zIndex: 3,
  },
  arrowTriangle: {
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 8,
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: "#1F2937",
    marginBottom: -1,
  },
  windBadge: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "baseline",
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(100, 140, 200, 0.25)",
    borderLeftWidth: 3,
    gap: 4,
  },
  windSpeed: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
  },
  windDir: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(80, 100, 140, 0.8)",
  },
  alertsContainer: {
    marginTop: 4,
    gap: 2,
    alignItems: "flex-start",
  },
  alertBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderLeftWidth: 3,
    gap: 4,
  },
  alertLabel: {
    fontSize: 10,
    fontWeight: "700",
  },
  alertValue: {
    fontSize: 10,
    fontWeight: "800",
  },
});

export default function TrafficMapView({
  latitude, longitude, latDelta, lonDelta, locationName, markers, trails,
  fullScreen, alarmRadiusM, taRadiusM, scanRadiusM, onLongPress, wind, sourceStatus,
  geozoneLayers, countryIso, mapStyle = "standard", onMapStyleChange,
  onCenterGps, onSettingsPress, settingsActive, bottomPadding = 0, topInset = 0, weatherAlerts,
  onHeadingChange, disableGeozoneQuery = false,
}: TrafficMapViewProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const osmTileUrl = isDark
    ? "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"
    : "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png";
  const mapRef = useRef<MapView>(null);
  const [mapBearing, setMapBearing] = useState(0);
  const [flightUrl, setFlightUrl] = useState<string | null>(null);
  const [flightCallsign, setFlightCallsign] = useState("");
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const markerTapRef = useRef(false);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [featureInfo, setFeatureInfo] = useState<GeozoneFeatureInfo[] | null>(null);
  const [featureLoading, setFeatureLoading] = useState(false);
  const [tapCoord, setTapCoord] = useState<{ latitude: number; longitude: number } | null>(disableGeozoneQuery ? null : null);
  const [mapSize, setMapSize] = useState({ width: 400, height: 400 });
  const [currentRegion, setCurrentRegion] = useState<Region>({
    latitude, longitude, latitudeDelta: latDelta, longitudeDelta: lonDelta,
  });

  const currentZoom = useMemo(() => {
    if (!currentRegion.latitudeDelta || currentRegion.latitudeDelta <= 0) return 15;
    return Math.round(Math.log2(360 / currentRegion.latitudeDelta));
  }, [currentRegion.latitudeDelta]);
  const geozonesVisible = currentZoom >= 11;
  const wmsUrlsPerCountry = useMemo(() => {
    const radiusKm = Math.max((taRadiusM || 0) / 1000, (alarmRadiusM || 0) / 1000, 80);
    const gpsCountries = getCountriesInRadius(latitude, longitude, radiusKm, countryIso);
    const viewRadiusKm = Math.max(
      (currentRegion.latitudeDelta || 0) * 111.32 / 2,
      (currentRegion.longitudeDelta || 0) * 111.32 * Math.cos((currentRegion.latitude * Math.PI) / 180) / 2,
      50
    );
    const viewCountries = getCountriesInRadius(currentRegion.latitude, currentRegion.longitude, viewRadiusKm);
    const countries = [...gpsCountries];
    for (const vc of viewCountries) {
      if (!countries.includes(vc)) countries.push(vc);
    }

    return countries.map((iso) => {
      const config = getCountryGeozoneConfig(iso);
      const defaultLayers = config.layers.filter(l => l.defaultEnabled).map(l => l.wmsLayer);
      const fallbackLayers = defaultLayers.length > 0 ? defaultLayers : [config.layers[0]?.wmsLayer].filter(Boolean);
      if (iso === countryIso && geozoneLayers && geozoneLayers.length > 0) {
        return { iso, url: buildCombinedWmsTileUrl(geozoneLayers, iso) };
      }
      return { iso, url: buildCombinedWmsTileUrl(fallbackLayers, iso) };
    });
  }, [geozoneLayers, countryIso, latitude, longitude, taRadiusM, alarmRadiusM, currentRegion.latitude, currentRegion.longitude, currentRegion.latitudeDelta, currentRegion.longitudeDelta]);

  const onMapLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setMapSize({ width: Math.round(width), height: Math.round(height) });
  }, []);

  const bearingThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regionThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRegionChange = useCallback((region: Region) => {
    if (regionThrottle.current) return;
    regionThrottle.current = setTimeout(() => {
      regionThrottle.current = null;
      setCurrentRegion(region);
    }, 300);
  }, []);

  const onRegionDone = useCallback((region: Region) => {
    setCurrentRegion(region);
    if (bearingThrottle.current) return;
    bearingThrottle.current = setTimeout(() => {
      bearingThrottle.current = null;
      if (mapRef.current) {
        mapRef.current.getCamera().then((cam) => {
          const h = cam.heading ?? 0;
          setMapBearing((prev) => Math.abs(prev - h) > 3 ? h : prev);
        }).catch(() => {});
      }
    }, 300);
  }, []);

  const onMapPress = useCallback((e: any) => {
    if (markerTapRef.current) { markerTapRef.current = false; return; }
    setSelectedAircraftId(null);
    if (featureInfo) { setFeatureInfo(null); setTapCoord(null); }
    if (disableGeozoneQuery) return;
    if (!geozoneLayers || geozoneLayers.length === 0) return;
    const approxZoom = Math.log2(360 / Math.max(currentRegion.latitudeDelta, 0.0001));
    if (approxZoom < 11) return;
    const { latitude: tapLat, longitude: tapLon } = e.nativeEvent.coordinate;
    setTapCoord({ latitude: tapLat, longitude: tapLon });
    setFeatureLoading(true);
    setFeatureInfo(null);
    queryGeozoneFeatureInfo(
      geozoneLayers,
      tapLat, tapLon,
      mapSize.width, mapSize.height,
      currentRegion.latitudeDelta, currentRegion.longitudeDelta,
      countryIso,
    ).then((results) => {
      setFeatureInfo(results.length > 0 ? results : null);
    }).catch(() => {
      setFeatureInfo(null);
    }).finally(() => {
      setFeatureLoading(false);
    });
  }, [disableGeozoneQuery, geozoneLayers, mapSize, currentRegion, countryIso]);

  const animateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isFinite(latitude) || !isFinite(longitude) || !isFinite(latDelta) || !isFinite(lonDelta)) return;
    if (latDelta <= 0 || lonDelta <= 0 || latDelta > 90 || lonDelta > 180) return;
    if (animateTimerRef.current) clearTimeout(animateTimerRef.current);
    animateTimerRef.current = setTimeout(() => {
      try {
        mapRef.current?.animateToRegion({
          latitude,
          longitude,
          latitudeDelta: latDelta,
          longitudeDelta: lonDelta,
        }, 400);
      } catch {}
    }, 150);
    return () => { if (animateTimerRef.current) clearTimeout(animateTimerRef.current); };
  }, [latitude, longitude, latDelta, lonDelta]);

  const prevBottomPadding = useRef(bottomPadding);
  useEffect(() => {
    if (prevBottomPadding.current === bottomPadding) return;
    prevBottomPadding.current = bottomPadding;
    if (!mapRef.current) return;
    const timer = setTimeout(() => {
      try {
        mapRef.current?.animateToRegion({
          ...currentRegion,
        }, 300);
      } catch {}
    }, 50);
    return () => clearTimeout(timer);
  }, [bottomPadding]);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        sub = await Location.watchHeadingAsync((heading) => {
          const h = heading.trueHeading >= 0 ? heading.trueHeading : heading.magHeading;
          setDeviceHeading(h);
          onHeadingChange?.(h);
        });
      } catch {}
    })();
    return () => { if (sub) sub.remove(); };
  }, [onHeadingChange]);

  return (
    <View style={fullScreen ? styles.mapViewFull : styles.mapView}>
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFillObject}
      mapType={mapStyle === "osm" ? (Platform.OS === "ios" ? "mutedStandard" : "standard") : mapStyle === "satellite" ? "hybrid" : "standard"}
      mapPadding={{ top: 0, right: 0, bottom: bottomPadding, left: 0 }}
      initialRegion={{
        latitude,
        longitude,
        latitudeDelta: latDelta,
        longitudeDelta: lonDelta,
      }}
      showsUserLocation={false}
      showsCompass={false}
      rotateEnabled={false}
      onLayout={onMapLayout}
      onRegionChange={onRegionChange}
      onRegionChangeComplete={onRegionDone}
      onPress={onMapPress}
      onLongPress={onLongPress ? (e) => {
        try {
          const { latitude: lat, longitude: lon } = e.nativeEvent.coordinate;
          if (typeof lat === "number" && typeof lon === "number" && isFinite(lat) && isFinite(lon)) {
            onLongPress(lat, lon);
            setTimeout(() => {
              try {
                mapRef.current?.animateToRegion({
                  latitude: lat,
                  longitude: lon,
                  latitudeDelta: currentRegion.latitudeDelta,
                  longitudeDelta: currentRegion.longitudeDelta,
                }, 1);
              } catch {}
            }, 50);
          }
        } catch {}
      } : undefined}
    >
      <UrlTile
        urlTemplate={osmTileUrl}
        maximumZ={19}
        zIndex={-3}
        tileSize={256}
        opacity={mapStyle === "osm" ? 1 : 0}
        shouldReplaceMapContent={mapStyle === "osm"}
      />
      {wmsUrlsPerCountry.map(({ iso, url }) => url ? (
        <WMSTile
          key={`wms-${iso}-${url.length}`}
          urlTemplate={url}
          zIndex={iso === countryIso ? 1 : 0}
          minimumZ={5}
          maximumZ={19}
          opacity={geozonesVisible ? (iso === countryIso ? (mapStyle === "osm" ? (isDark ? 0.55 : 0.85) : 0.65) : (mapStyle === "osm" ? (isDark ? 0.4 : 0.55) : 0.45)) : 0}
          tileSize={256}
        />
      ) : null)}
      {(scanRadiusM ?? 0) > 0 ? (
        <Circle
          key="scan-circle"
          center={{ latitude, longitude }}
          radius={scanRadiusM ?? 0}
          strokeColor="rgba(175, 82, 222, 0.85)"
          fillColor="rgba(175, 82, 222, 0.06)"
          strokeWidth={2.5}
          zIndex={9}
        />
      ) : null}
      {(taRadiusM ?? 0) > 0 ? (
        <Circle
          key="ta-circle"
          center={{ latitude, longitude }}
          radius={taRadiusM ?? 0}
          strokeColor="rgba(255, 149, 0, 0.7)"
          fillColor="rgba(255, 149, 0, 0.06)"
          strokeWidth={1.5}
          zIndex={10}
        />
      ) : null}
      {(alarmRadiusM ?? 0) > 0 ? (
        <Circle
          key="ra-circle"
          center={{ latitude, longitude }}
          radius={alarmRadiusM ?? 0}
          strokeColor="rgba(255, 59, 48, 0.85)"
          fillColor="rgba(255, 59, 48, 0.10)"
          strokeWidth={2.5}
          zIndex={11}
        />
      ) : null}
      {deviceHeading != null ? (() => {
        const fovHalf = 30;
        const taRadDeg = (taRadiusM ?? 0) > 0 ? ((taRadiusM ?? 0) / 111320) * 0.75 : latDelta * 0.08;
        const fovLen = Math.min(taRadDeg, latDelta * 0.08);
        const headRad = (deviceHeading * Math.PI) / 180;
        const a1 = ((deviceHeading - fovHalf) * Math.PI) / 180;
        const a2 = ((deviceHeading + fovHalf) * Math.PI) / 180;
        const cosLat = Math.cos((latitude * Math.PI) / 180);
        const steps = 12;
        const coords = [{ latitude, longitude }];
        for (let i = 0; i <= steps; i++) {
          const a = a1 + (a2 - a1) * (i / steps);
          coords.push({
            latitude: latitude + fovLen * Math.cos(a),
            longitude: longitude + (fovLen * Math.sin(a)) / cosLat,
          });
        }
        coords.push({ latitude, longitude });
        return (
          <Polygon
            coordinates={coords}
            fillColor="rgba(0,122,255,0.55)"
            strokeColor="rgba(0,122,255,0.85)"
            strokeWidth={2}
            zIndex={15}
          />
        );
      })() : null}
      <Marker
        coordinate={{ latitude, longitude }}
        title="Radar-Standort"
        description={locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
        anchor={{ x: 0.5, y: 0.5 }}
      >
        <View style={styles.userMarker}>
          <View style={styles.userMarkerDot} />
        </View>
      </Marker>
      {trails ? trails.map((trail) =>
        trail.points.length >= 2 ? (
          <Polyline
            key={`trail-${trail.id}`}
            coordinates={trail.points.length > 30 ? trail.points.filter((_: any, i: number) => i % 2 === 0 || i === trail.points.length - 1) : trail.points}
            strokeColor={trail.color}
            strokeWidth={trail.isAlert ? 4 : 3}
            zIndex={10}
          />
        ) : null
      ) : null}
      {markers.map((m) => {
        const isWarning = m.isAlert || m.isApproaching;
        const iconColor = m.isAlert ? "#FF3B30" : m.isApproaching ? "#FF9500" : m.pinColor;
        const staleOpacity = m.isStale ? 0.7 : 1;
        const isSelected = selectedAircraftId === m.id;
        const altShort = m.altitude ? m.altitude.replace(/ m AGL$/, "m") : "";

        const TAG_H = isWarning ? 12 : 0;
        const ICON_H = 40;
        const BADGE_H = altShort ? 15 : 0;
        const markerH = TAG_H + ICON_H + BADGE_H;
        const iconCenterY = (TAG_H + ICON_H / 2) / markerH;

        let heading = m.heading ?? 0;
        if (m.heading == null || m.heading === 0) {
          const trail = trails ? trails.find((t) => t.id === m.id) : null;
          if (trail && trail.points.length >= 2) {
            const p1 = trail.points[trail.points.length - 2];
            const p2 = trail.points[trail.points.length - 1];
            const dLon = (p2.longitude - p1.longitude) * Math.PI / 180;
            const lat1 = p1.latitude * Math.PI / 180;
            const lat2 = p2.latitude * Math.PI / 180;
            const y = Math.sin(dLon) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
            heading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
          }
        }

        return (
          <Marker
            key={`ac-${m.id}`}
            coordinate={{ latitude: m.latitude, longitude: m.longitude }}
            anchor={{ x: 0.5, y: iconCenterY }}
            tracksViewChanges={false}
            zIndex={isSelected ? 200 : (isWarning ? 110 : (m.isStale ? 11 : 60))}
            onPress={() => { markerTapRef.current = true; setSelectedAircraftId(isSelected ? null : m.id); }}
          >
            <View style={styles.markerComposite}>
              {isWarning ? (
                <Text style={[styles.warningTag, { backgroundColor: m.isAlert ? "#FF3B30" : "#FF9500" }]}>
                  {m.isAlert ? "RA" : "TA"}
                </Text>
              ) : null}
              <View style={[styles.markerIconRoot, { opacity: staleOpacity }]}>
                <AircraftIcon
                  category={m.category || "unknown"}
                  color={iconColor}
                  heading={heading}
                  mapBearing={0}
                />
              </View>
              {altShort ? (
                <View style={[styles.altBadge, { opacity: staleOpacity }]}>
                  <Text style={styles.altBadgeText} numberOfLines={1}>
                    {altShort}
                  </Text>
                </View>
              ) : null}
            </View>
          </Marker>
        );
      })}
      {!disableGeozoneQuery && featureLoading && tapCoord ? (
        <Marker coordinate={tapCoord} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
          <View style={geoStyles.tapBubble}>
            <ActivityIndicator size="small" color="#4A90D9" />
          </View>
        </Marker>
      ) : null}
      {!disableGeozoneQuery && featureInfo && featureInfo.length > 0 && tapCoord ? (
        <Marker
          coordinate={tapCoord}
          anchor={{ x: 0.1, y: 1 }}
          tracksViewChanges={false}
          onPress={() => { setFeatureInfo(null); setTapCoord(null); }}
        >
          <View style={geoStyles.tapPopup}>
            <View style={geoStyles.tapPopupHeader}>
              <Feather name="layers" size={12} color="#4A90D9" />
              <Text style={geoStyles.tapPopupTitle}>Geozonen</Text>
              <Pressable onPress={() => { setFeatureInfo(null); setTapCoord(null); }} hitSlop={12}>
                <Feather name="x" size={14} color="#8E8E93" />
              </Pressable>
            </View>
            {featureInfo.slice(0, 4).map((fi, idx) => {
              const details = fi.details.split("\n").filter((d: string) => d.trim().length > 0);
              return (
                <View key={`${fi.layerLabel}-${idx}`} style={geoStyles.tapCard}>
                  <View style={geoStyles.tapCardBadge}>
                    <Text style={geoStyles.tapCardBadgeText}>{fi.layerLabel}</Text>
                  </View>
                  <Text style={geoStyles.tapCardName}>{fi.name}</Text>
                  {details.slice(0, 3).map((line: string, li: number) => {
                    const parts = line.split(":");
                    return parts.length >= 2 ? (
                      <View key={li} style={geoStyles.tapDetailRow}>
                        <Text style={geoStyles.tapDetailKey}>{parts[0].trim()}</Text>
                        <Text style={geoStyles.tapDetailVal} numberOfLines={1}>{parts.slice(1).join(":").trim()}</Text>
                      </View>
                    ) : (
                      <Text key={li} style={geoStyles.tapDetailVal} numberOfLines={1}>{line}</Text>
                    );
                  })}
                </View>
              );
            })}
            {featureInfo.length > 4 ? (
              <Text style={geoStyles.tapMoreText}>+{featureInfo.length - 4} weitere</Text>
            ) : null}
          </View>
        </Marker>
      ) : null}
    </MapView>
    {selectedAircraftId != null ? (() => {
      const sel = markers.find((m) => m.id === selectedAircraftId);
      if (!sel) return null;
      const isWarning = sel.isAlert || sel.isApproaching;
      const borderColor = sel.isAlert ? "#FF3B30" : sel.isApproaching ? "#FF9500" : "transparent";
      const bgColor = sel.isAlert ? "rgba(255,59,48,0.92)" : sel.isApproaching ? "rgba(255,149,0,0.92)" : "rgba(0,0,0,0.88)";
      const isOgnOnly = sel.sources != null && sel.sources.length === 1 && sel.sources[0] === "ogn";
      const categoryLabel = sel.category ? getCategoryLabel(sel.category) : null;
      return (
        <View style={styles.infoBubbleOverlay} pointerEvents="box-none">
          <Pressable style={styles.infoBubbleBackdrop} onPress={() => setSelectedAircraftId(null)} />
          <View style={[
            styles.infoBubbleCard,
            { backgroundColor: bgColor },
            isWarning ? { borderWidth: 1.5, borderColor } : undefined,
          ]}>
            <View style={styles.infoBubbleHeader}>
              <Text style={styles.infoBubbleCallsign} numberOfLines={1}>{sel.title || sel.id}</Text>
              <Pressable onPress={() => setSelectedAircraftId(null)} hitSlop={12}>
                <Feather name="x" size={16} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>
            {categoryLabel ? <Text style={[styles.infoBubbleDetail, { fontSize: 10, opacity: 0.7, marginBottom: 2 }]}>{categoryLabel}</Text> : null}
            <View style={styles.infoBubbleRow}>
              {sel.altitude ? <Text style={styles.infoBubbleDetail}>{sel.altitude}</Text> : null}
              {sel.speed ? <Text style={styles.infoBubbleDetail}>{sel.speed}</Text> : null}
            </View>
            {sel.altitudeDual ? <Text style={[styles.infoBubbleDetail, { fontSize: 9, opacity: 0.7 }]}>{sel.altitudeDual}</Text> : null}
            <View style={styles.infoBubbleFooter}>
              {isOgnOnly ? (
                <View style={styles.sourceRow}>
                  <View style={[styles.sourceDot, { backgroundColor: "#FF5722" }]} />
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 9 }}>OGN</Text>
                </View>
              ) : (
                <SourceDots sources={sel.sources} sourceStatus={sourceStatus} />
              )}
              {isOgnOnly || !(sel.title || "").trim() ? null : (
                <Pressable
                  style={styles.infoBubbleLink}
                  onPress={() => {
                    const cs = (sel.title || "").trim();
                    setFlightCallsign(cs);
                    setFlightUrl(`https://de.flightaware.com/live/flight/${encodeURIComponent(cs)}`);
                    setSelectedAircraftId(null);
                  }}
                >
                  <Feather name="external-link" size={11} color="#4A90D9" />
                  <Text style={styles.infoBubbleLinkText}>FlightAware</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      );
    })() : null}
    {wind ? (
      <WindCompass wind={wind} deviceHeading={deviceHeading} topInset={topInset} weatherAlerts={weatherAlerts}>
        {(onCenterGps || onSettingsPress) ? (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            {onCenterGps ? (
              <Pressable
                onPress={onCenterGps}
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: isDark ? "rgba(30,40,60,0.88)" : "rgba(255,255,255,0.92)",
                  alignItems: "center", justifyContent: "center",
                  ...(Platform.OS === "ios" ? { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 } : { elevation: 4 }),
                }}
              >
                <Feather name="navigation" size={18} color="#007AFF" />
              </Pressable>
            ) : null}
            {onSettingsPress ? (
              <Pressable
                onPress={onSettingsPress}
                style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: settingsActive ? "#007AFF" : isDark ? "rgba(30,40,60,0.88)" : "rgba(255,255,255,0.92)",
                  alignItems: "center", justifyContent: "center",
                  ...(Platform.OS === "ios" ? { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 } : { elevation: 4 }),
                }}
              >
                <Feather name="settings" size={18} color={settingsActive ? "#FFFFFF" : isDark ? "#FFFFFF" : "#333333"} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </WindCompass>
    ) : null}
    {onMapStyleChange ? (
      <View style={mapSwitchStyles.container}>
        {([
          { id: "standard" as const, label: "Standard" },
          { id: "satellite" as const, label: "Satellit" },
          { id: "osm" as const, label: "OSM" },
        ]).map((opt) => (
          <Pressable
            key={opt.id}
            style={[
              mapSwitchStyles.segment,
              mapStyle === opt.id ? mapSwitchStyles.segmentActive : undefined,
            ]}
            onPress={() => onMapStyleChange(opt.id)}
          >
            <Text style={[
              mapSwitchStyles.segmentLabel,
              mapStyle === opt.id ? mapSwitchStyles.segmentLabelActive : undefined,
            ]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
    ) : null}
    <Modal
      visible={flightUrl !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setFlightUrl(null)}
    >
      <SafeAreaView style={faStyles.container}>
        <View style={faStyles.header}>
          <Pressable onPress={() => setFlightUrl(null)} hitSlop={12} style={faStyles.closeBtn}>
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={faStyles.titleRow}>
            <Feather name="navigation" size={14} color="#4A90D9" />
            <Text style={faStyles.title} numberOfLines={1}>{flightCallsign}</Text>
          </View>
          <Text style={faStyles.subtitle}>FlightAware</Text>
        </View>
        {flightUrl ? (
          <WebView
            setSupportMultipleWindows={false}
            source={{ uri: flightUrl }}
            style={faStyles.webview}
            startInLoadingState
            renderLoading={() => (
              <View style={faStyles.loading}>
                <ActivityIndicator size="large" color="#4A90D9" />
                <Text style={faStyles.loadingText}>Flugdaten laden...</Text>
              </View>
            )}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  mapView: {
    height: 450,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  mapViewFull: {
    flex: 1,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  userMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0, 122, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  userMarkerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#007AFF",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  markerComposite: {
    alignItems: "center",
    minWidth: 44,
  },
  warningTag: {
    color: "#FFFFFF",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 1,
  },
  markerIconRoot: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  altBadge: {
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginTop: 2,
  },
  altBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
    textAlign: "center",
  },
  infoBubbleOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 16,
    zIndex: 300,
  } as any,
  infoBubbleBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  } as any,
  infoBubbleCard: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    minWidth: 140,
    maxWidth: 260,
    ...(Platform.OS === "ios" ? { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8 } : { elevation: 8 }),
  } as any,
  infoBubbleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    gap: 8,
    marginBottom: 2,
  } as any,
  infoBubbleCallsign: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    flex: 1,
  },
  infoBubbleDetail: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    opacity: 0.9,
  },
  infoBubbleRow: {
    flexDirection: "row",
    gap: 10,
    marginVertical: 2,
  } as any,
  infoBubbleFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 4,
    width: "100%",
  } as any,
  infoBubbleLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 4,
    gap: 4,
  } as any,
  infoBubbleLinkText: {
    color: "#4A90D9",
    fontSize: 10,
    fontWeight: "700",
  },
  aircraftIcon: {
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    overflow: "visible",
  },
  markerLabelFloat: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    alignItems: "center",
    minWidth: 60,
  },
  warningLabel: {
    color: "#FFFFFF",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 1,
    textAlign: "center",
  },
  labelCallsign: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    textAlign: "center",
  },
  labelDetail: {
    fontSize: 9,
    fontWeight: "600",
    textAlign: "center",
  },
  labelSpeed: {
    color: "#CCCCCC",
    fontSize: 8,
    fontWeight: "500",
    textAlign: "center",
  },
  sourceRow: {
    flexDirection: "row",
    gap: 3,
    marginTop: 2,
    justifyContent: "center",
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.5)",
  },
});

const geoStyles = StyleSheet.create({
  tapBubble: {
    backgroundColor: "rgba(20, 30, 48, 0.9)",
    borderRadius: 16,
    padding: 6,
  },
  tapPopup: {
    width: 220,
    backgroundColor: "rgba(20, 30, 48, 0.95)",
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "rgba(74, 144, 217, 0.3)",
  },
  tapPopupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
    paddingBottom: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.15)",
  },
  tapPopupTitle: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  tapCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 6,
    padding: 6,
    marginBottom: 4,
    borderLeftWidth: 2,
    borderLeftColor: "#4A90D9",
  },
  tapCardBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#4A90D9",
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginBottom: 3,
  },
  tapCardBadgeText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  tapCardName: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 2,
  },
  tapDetailRow: {
    flexDirection: "row",
    gap: 3,
    paddingVertical: 1,
  },
  tapDetailKey: {
    color: "#8E9AB0",
    fontSize: 9,
    fontWeight: "600",
    minWidth: 60,
  },
  tapDetailVal: {
    color: "#C8D0E0",
    fontSize: 9,
    fontWeight: "500",
    flex: 1,
  },
  tapMoreText: {
    color: "#8E9AB0",
    fontSize: 9,
    textAlign: "center",
    marginTop: 2,
  },
});

const faStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1A1F2E",
  },
  header: {
    backgroundColor: "rgba(25, 30, 45, 0.98)",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  closeBtn: {
    position: "absolute",
    top: 8,
    right: 16,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: "#8E8E93",
    fontSize: 12,
    fontWeight: "500",
    marginLeft: 22,
  },
  webview: {
    flex: 1,
    backgroundColor: "#1A1F2E",
  },
  loading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A1F2E",
  },
  loadingText: {
    color: "#8E8E93",
    fontSize: 14,
    marginTop: 12,
  },
});

const mapSwitchStyles = StyleSheet.create({
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
