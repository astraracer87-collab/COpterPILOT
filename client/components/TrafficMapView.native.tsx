import { DroneImage } from "@/components/DroneImage";
import { LEAFLET_CSS, LEAFLET_JS } from "@/lib/leafletBundle";
import { useIsNight } from "@/hooks/useIsNight";
import { RC_LEAFLET_JS, RC_WEBVIEW_FILE_PROPS, useRcLeaflet } from "@/lib/leafletRc";
import { openLink } from "@/lib/webBrowser";
import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { View, StyleSheet, Text, Platform, Pressable, ActivityIndicator, LayoutChangeEvent, Modal, useColorScheme, Linking, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import * as WebBrowser from "@/lib/webBrowser";
import { Feather } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import * as Location from "@/lib/location";
import { BorderRadius } from "@/constants/theme";
import type { GermanEnergyInfrastructureItem } from "../../shared/germanEnergyInfrastructure";
import type { EnergyFacility100mPoint } from "../../shared/germanEnergyInfrastructure";
import { getCategoryLabel, type AircraftCategory, type DataSource } from "@/lib/opensky";
import { zoneActivityAt } from "@/lib/ed269";
import { collapseStackedTempZonesForMap } from "../../shared/geozoneTemporary";
import { buildGeozoneCacheTileUrl, buildGeozoneTileUrls, getGeozoneTileAttribution, buildVectorGeozoneTileUrl, isRasterTiledVectorCountry, queryGeozoneFeatureInfo, queryEd269CachedFeaturesWithStatus, getCountryGeozoneConfig, getViewportCountries, separateTempRestrictions, GEOZONE_TILE_MIN_ZOOM, getVectorMinZoom, loadsFullCountryVectorZones, GEOZONE_VECTOR_MAX_RADIUS_KM, GEOZONE_VECTOR_MAX_FEATURES, type GeozoneFeatureInfo } from "@/lib/geozones";
import { isVectorZoneDrawSuppressed } from "@/lib/geozoneZoom";
import { agencyTagColor } from "@/lib/agencyTag";
import { simplifyRingGroup, smoothRingGroup } from "@/lib/ringSimplify";
import { clipRingGroupToCircle } from "@/lib/circleClip";
import { findNearbyCtrAirports, CTR_AIRPORTS } from "@/lib/ctrData";
import { MAJOR_EU_AIRPORTS } from "@/lib/euAirports";
import { fetchAirportStationsInArea, type AirportStation } from "@/lib/aviationWeather";
import { getCtrBandRings, getCtrLegendEntries, getCtrProvisionalNote } from "@/lib/ctrAltitude";
import { fetchTerrainEstimate } from "@/lib/elevation";
import { partitionByReachability, DEFAULT_REACHABLE_ALTITUDE_M, type TerrainEstimate } from "../../shared/geozoneAltitudeFilter";
import { splitCountriesByAccess, countryName } from "../../shared/countryEntitlements";
import { useAuth } from "@/lib/auth";
import { windFacilitiesAsGeozones, supplementalLinesAsGeozones, supplementalInfrastructureAsGeozones, infrastructureMapGeometry } from "@/lib/energyInfrastructureZones";
import { getGermanWindFacility100mPoints } from "../../shared/germanEnergyInfrastructure";
import { zoneMapColors } from "../../shared/dipulLayerStyles";
import { useTiledGeozoneIsos } from "@/lib/geozoneTiles/useTiledGeozones";
import CtrInfoCard from "@/components/CtrInfoCard";
import AirportWeatherSheet from "@/components/AirportWeatherSheet";
import { geozoneTruncationHint } from "../../shared/checks/builders";
import { isGeozoneSourceEnabled, usageIsoOf } from "@/lib/countryUsage";
import { useCountryUsageMap } from "@/lib/useCountryUsage";
import { DisabledCountryPopup, disabledCountryAt, tapToScreen, type DisabledCountryTap } from "@/components/maps/DisabledCountriesHint";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Liefert die Ringe einer Geozone als Polygon-Gruppen ([Außenring, …Löcher]).
// Bevorzugt polygonGroups (erhält Donut-Löcher); fällt sonst auf die flache
// polygonRings-Liste zurück, wobei jeder Ring ein eigenes lochfreies Polygon wird.
function ringGroupsForZone(z: GeozoneFeatureInfo): [number, number][][][] {
  if (z.polygonGroups && z.polygonGroups.length > 0) return z.polygonGroups;
  return (z.polygonRings ?? []).map((ring) => [ring]);
}

// Ring-Vereinfachung (RDP) ausgelagert nach client/lib/ringSimplify.ts, damit die
// Donut-/Loch-erhaltende Logik RN-frei unter tsx testbar ist (siehe
// client/lib/__tests__/belgianAirportDonut.test.ts).

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
  registration?: string;
  aircraftType?: string;
  aircraftDesc?: string;
  operator?: string;
  cn?: string;
  originIata?: string;
  destIata?: string;
  flightNumber?: string;
  agencyTag?: string;
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
  /** Sichtflug-Reichweite (VLOS) als blauer, gestrichelter Kreis */
  vlosRadiusM?: number;
  onLongPress?: (lat: number, lon: number) => void;
  wind?: WindData | null;
  sourceStatus?: Record<DataSource, "ok" | "error" | "timeout">;
  geozoneLayers?: string[];
  countryIso?: string;
  highlightedZones?: GeozoneFeatureInfo[];
  additionalGeozones?: GeozoneFeatureInfo[];
  energyInfrastructure?: GermanEnergyInfrastructureItem[];
  windRestrictionPoints?: EnergyFacility100mPoint[];
  energyTilesEnabled?: boolean;
  energyTilesShowSupplemental?: boolean;
  mapStyle?: "standard" | "satellite" | "osm" | "grayscale";
  onMapStyleChange?: (style: "standard" | "satellite" | "osm" | "grayscale") => void;
  onCenterGps?: () => void;
  onSettingsPress?: () => void;
  /** Drohnenwahl neben GPS/Einstellungen: Bild + VLOS-Reichweite */
  dronePill?: { manufacturer?: string; model?: string; label: string; onPress: () => void };
  settingsActive?: boolean;
  bottomPadding?: number;
  infoBubbleBottomInset?: number;
  topInset?: number;
  weatherAlerts?: { label: string; value: string; color: string }[];
  onHeadingChange?: (heading: number | null) => void;
  disableGeozoneQuery?: boolean;
  /** Kein echter Standort (Karte zeigt nur einen Ersatz-Mittelpunkt): kein
   *  Piloten-Punkt, keine Radar-Ringe, kein Blickrichtungs-Fächer. */
  hideUserPosition?: boolean;
  /** Hervorhebung betroffener Zonen endet an diesem Kreis um den Standort
   *  (Standard: TA-Kreis, sonst Alarmkreis). 0 = nicht zuschneiden. */
  highlightClipRadiusM?: number;
  lockPan?: boolean;
  // C: aktuelle Viewport-Bbox melden (für Server-Side bbox-Filter).
  onViewportChange?: (bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number }) => void;
  // Höhen-Filter für Vektor-Geozonen (AT/BE/DK): erreichbare/geplante Flughöhe
  // in AGL-Metern. Zonen, deren Untergrenze darüber liegt, werden ausgeblendet.
  maxReachableAltitudeM?: number;
  // Sicherheits-Schalter: hebt den Höhen-Filter auf (zeigt alle Vektor-Zonen).
  showAllGeozones?: boolean;
}

// Lokaler Region-Typ (ehemals aus react-native-maps). Die Karte wird jetzt im
// WebView (Leaflet) gerendert; die Region wird per postMessage zurückgemeldet.
type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

function snapHeading(deg: number): number {
  return Math.round(deg);
}

const SourceDots = React.memo(function SourceDots({ sources, sourceStatus }: { sources?: DataSource[]; sourceStatus?: Record<DataSource, "ok" | "error" | "timeout"> }) {
  // Nur die aktuell aktiven Quellen anzeigen — muss synchron zu
  // ENABLED_SOURCES im Server-Aggregator und in client/lib/trafficStatus.ts bleiben.
  const allSources: DataSource[] = ["ogn", "airplaneslive", "adsblol"];
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
        <Text style={compassStyles.windSpeed}>
          {typeof wind.speed === "number" && Number.isFinite(wind.speed) ? `${wind.speed.toFixed(1)} m/s` : "NV"}
        </Text>
        <Text style={compassStyles.windDir}>
          {typeof wind.direction === "number" && Number.isFinite(wind.direction)
            ? `${wind.directionLabel || ""} ${wind.direction}°`.trim()
            : "NV"}
        </Text>
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

// ---------------------------------------------------------------------------
// Leaflet-Karten-Dokument (im WebView). Die Karte wird einmal erstellt; der
// React-Native-Wrapper schiebt den kompletten Zustand per
// window.__apply(stateJson) hinein und erhält Region/Tap/Long-Press/Marker-Tap
// per ReactNativeWebView.postMessage zurück. Bewusst KEINE Template-Literale /
// ${...} im Inneren, damit dieser RN-Template-String nichts interpoliert.
// ---------------------------------------------------------------------------
export const MAIN_MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>${LEAFLET_CSS}</style>
<script>${LEAFLET_JS}</script>
<script>${RC_LEAFLET_JS}</script>
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #1A1F2E; }
  #map { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .leaflet-container { background: #1A1F2E; outline: none; }
  .acm { display: flex; flex-direction: column; align-items: center; }
  .actag { color: #fff; font-size: 7px; font-weight: 900; letter-spacing: 0.5px; padding: 0 4px; border-radius: 3px; margin-bottom: 1px; }
  .acicon { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }
  .acalt { background: rgba(0,0,0,0.7); color: #fff; font-size: 9px; font-weight: 700; padding: 0 4px; border-radius: 3px; margin-top: 2px; line-height: 13px; }
  .gz-popup .leaflet-popup-content-wrapper { background: rgba(20,30,48,0.97); color: #fff; border-radius: 10px; border: 1px solid rgba(74,144,217,0.4); }
  .gz-popup .leaflet-popup-tip { background: rgba(20,30,48,0.97); }
  .gz-popup .leaflet-popup-content { margin: 8px 10px; }
  .gz-popup a.leaflet-popup-close-button { color: #8E8E93; }
  .gzp { width: 210px; }
  .gzph { display: flex; align-items: center; font-size: 12px; font-weight: 700; color: #fff; padding-bottom: 5px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.15); }
  .gzc { background: rgba(255,255,255,0.06); border-radius: 6px; padding: 6px; margin-bottom: 4px; border-left: 2px solid #4A90D9; }
  .gzc-tmp { border-left-color: #FF9500; }
  .gzb { display: inline-block; background: #4A90D9; border-radius: 3px; padding: 1px 5px; margin-bottom: 3px; font-size: 8px; font-weight: 800; letter-spacing: 0.3px; color: #fff; }
  .gzb-tmp { background: #FF9500; }
  .gzph-tmp { color: #FFB14D; }
  .gzn { color: #fff; font-size: 11px; font-weight: 700; margin-bottom: 2px; }
  .gzr { display: flex; gap: 4px; padding: 1px 0; }
  .gzk { color: #8E9AB0; font-size: 9px; font-weight: 600; min-width: 60px; }
  .gzv { color: #C8D0E0; font-size: 9px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gzm { color: #8E9AB0; font-size: 9px; text-align: center; margin-top: 2px; }
  .gzap { color: #C8D0E0; font-size: 9px; font-weight: 500; line-height: 1.35; white-space: normal; margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); }
  .gzlink { display: block; color: #4A90D9; font-size: 9px; font-weight: 700; margin-top: 4px; text-decoration: none; white-space: normal; word-break: break-word; }
  .gzl { color: #C8D0E0; font-size: 11px; font-weight: 600; padding: 2px 4px; }
  .ctrpin { background: rgba(20,30,48,0.85); color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.6); white-space: nowrap; }
  .basemap-grayscale .leaflet-tile { filter: grayscale(1) contrast(1.04) brightness(1.03); }
  /* Nacht (Sonnenuntergang bis -aufgang): Grundkarte dunkel, Ebenen darüber unverändert */
  .basemap-night .leaflet-tile { filter: invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.9) saturate(0.8); }
  .basemap-grayscale.basemap-night .leaflet-tile { filter: grayscale(1) invert(1) brightness(0.9) contrast(0.9); }
  .ctrh { font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 3px; }
  .ctrs { font-size: 10px; color: #8E9AB0; }
  .apm { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: rgba(20,30,48,0.82); border: 1.5px solid rgba(74,144,217,0.9); border-radius: 10px; color: #4A90D9; font-size: 12px; font-weight: 800; font-family: Georgia, serif; font-style: italic; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
</style>
</head>
<body>
<div id="map"></div>
<script>
(function(){
  function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(m){ return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[m]; }); }

  var map = L.map("map", { zoomControl: false, attributionControl: true, zoomSnap: 1, fadeAnimation: false, maxZoom: 19, minZoom: 3 }).setView([51, 10], 6);
  window.__rcMap = map;

  // ---- Basis-Ebene ----
  var baseLayer = null, baseKey = "";
  var activeBaseStyle = "", baseTileReadyStyle = "", baseTileErrorStyle = "";
  function setBase(style, dark){
    var key = style + "|" + (dark ? 1 : 0);
    if (key === baseKey && baseLayer) return;
    baseKey = key;
    activeBaseStyle = style;
    baseTileReadyStyle = "";
    baseTileErrorStyle = "";
    if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
    var url;
    if (style === "satellite") {
      url = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    } else if (style === "osm") {
      url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    } else {
      url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    }
    baseLayer = window.__rc.makeBase(style, url, {
      maxZoom: 19,
      keepBuffer: 1,
      updateWhenIdle: false,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
      className: (style === "grayscale" ? "basemap-grayscale " : "") + (dark && style !== "satellite" ? "basemap-night" : ""),
    });
    var layerStyle = style;
    baseLayer.on("tileload", function(){
      if (activeBaseStyle !== layerStyle || baseTileReadyStyle === layerStyle) return;
      baseTileReadyStyle = layerStyle;
      post({ type: "baseTileLoaded", base: layerStyle });
    });
    baseLayer.on("tileerror", function(){
      if (activeBaseStyle !== layerStyle || baseTileErrorStyle === layerStyle) return;
      baseTileErrorStyle = layerStyle;
      post({ type: "baseTileError", base: layerStyle });
    });
    baseLayer.addTo(map);
    baseLayer.bringToBack();
  }
  window.__hasBaseTile = function(style){ return baseTileReadyStyle === style; };
  // Sofort eine sichtbare Grundkarte anlegen. Die erste native ready-Nachricht
  // kann auf iOS verloren gehen; die NOTAM-WebView setzt ihren endgültigen
  // Mittelpunkt/Stil anschließend zusätzlich über den nativen onLoadEnd-Pfad.
  setBase("standard", false);

  // ---- Geozonen-Ebenen (serverseitig komponierte XYZ-Kacheln) ----
  // Inkrementelles Diffing pro Land-URL: beim Grenz-Panning ändert sich nur das
  // Länder-Set (z. B. LU+DE+FR -> LU+DE). Statt ALLE Ebenen abzureißen und neu
  // zu laden (sichtbares Flackern + erneutes langsames WMS-Laden), behalten wir
  // unveränderte Länder-Kacheln bei und entfernen/ergänzen nur die Differenz.
  var geoLayers = {};  // url -> { layer, sig }
  function setGeo(arr){
    arr = arr || [];
    var next = {};
    for (var j = 0; j < arr.length; j++) next[arr[j].u] = arr[j];
    // Entfernen: Ebenen, die weg sind ODER deren Eigenschaften sich geändert haben.
    for (var url in geoLayers){
      if (!geoLayers.hasOwnProperty(url)) continue;
      if (!next[url] || geoLayers[url].sig !== JSON.stringify(next[url])){
        map.removeLayer(geoLayers[url].layer);
        delete geoLayers[url];
      }
    }
    // Ergänzen: neue Ebenen, die noch nicht (oder nicht mehr) existieren.
    for (var u in next){
      if (!next.hasOwnProperty(u) || geoLayers[u]) continue;
      var g = next[u];
      var tl = L.tileLayer(g.u, {
        opacity: g.p,
        minZoom: ` + String(GEOZONE_TILE_MIN_ZOOM) + `,
        maxZoom: 19,
        maxNativeZoom: g.mnz || 19,
        tileSize: 256,
        zIndex: g.primary ? 5 : 4,
        updateWhenIdle: true,
        keepBuffer: 1,
        attribution: g.a || ""
      });
      // Transiente Kachel-Fehler (Server liefert 504, wenn der Upstream-WMS
      // gedrosselt hat) selbst heilen: Leaflet laedt eine fehlgeschlagene
      // Kachel sonst NIE nach -> dauerhaftes Loch im Overlay (z. B. fehlende
      // rechte Haelfte bei Calais/FR). Bis zu 3 Wiederholungen mit Cache-Bust.
      tl.on('tileerror', function(ev){
        try {
          var img = ev && ev.tile; if (!img) return;
          var n = img._gzRetry || 0; if (n >= 3) return;
          img._gzRetry = n + 1;
          if (!img._gzBase) img._gzBase = (img.src || '').split('&_r=')[0];
          var base = img._gzBase; if (!base) return;
          var sep = base.indexOf('?') >= 0 ? '&' : '?';
          setTimeout(function(){ img.src = base + sep + '_r=' + Date.now(); }, 700 * (n + 1));
        } catch (e) {}
      });
      tl.addTo(map);
      geoLayers[u] = { layer: tl, sig: JSON.stringify(g) };
    }
  }

  // Nur Treffer, die ein verfügbarer amtlicher Anlagenlayer als fehlend bestätigt.
  var energyLayer = L.layerGroup().addTo(map);
  var energySig = "";
  function setEnergy(arr, windBuffers){
    var sig = JSON.stringify([arr || [], windBuffers || []]);
    if (sig === energySig) return;
    energySig = sig;
    energyLayer.clearLayers();
    for (var b = 0; windBuffers && b < windBuffers.length; b++){
      var buffer = windBuffers[b];
      if (!buffer || !Number.isFinite(buffer.latitude) || !Number.isFinite(buffer.longitude)) continue;
      var consentText = "<div class='gzn'>" + esc(buffer.name || "Windkraftanlage") + "</div>" +
        "<div class='gzap'>100-m-Prüfkreis</div>" +
        "<div class='gzap'>Datenquelle: " + esc(buffer.source || "unbekannt") + "</div>" +
        "<div class='gzap'>Sofern § 21h Abs. 3 Nr. 3 LuftVO anwendbar ist, ist innerhalb dieses Abstands die ausdrückliche Zustimmung der zuständigen Stelle oder des Betreibers erforderlich.</div>" +
        "<div class='gzap'>Karten-Näherung ab Anlagenpunkt; rechtlich maßgeblich ist die Anlagenbegrenzung.</div>";
      L.circle([buffer.latitude, buffer.longitude], {
        radius: 100, color: "#FF9500", weight: 2, opacity: 0.95,
        fillColor: "#FF9500", fillOpacity: 0.15, interactive: true
      }).bindPopup(consentText).addTo(energyLayer);
      L.circleMarker([buffer.latitude, buffer.longitude], {
        radius: 6, color: "#FFFFFF", weight: 2, fillColor: "#7B2CBF",
        fillOpacity: 1, interactive: true
      }).bindPopup(consentText).addTo(energyLayer);
    }
    for (var i = 0; arr && i < arr.length; i++){
      var item = arr[i];
      if (!item || item.officialMatch !== "not_found" || !item.geometry) continue;
      var kind = item.kind === "wind_turbine" ? "Windkraftanlage" :
        item.kind === "power_line" ? "Stromleitung" : "Strommast";
      var details = "<div class='gzn'>" + esc(kind) + "</div><div class='gzr'><span class='gzk'>Quelle</span><span class='gzv'>" + esc(item.source) + "</span></div>" +
        "<div class='gzr'><span class='gzk'>Amtlicher Abgleich</span><span class='gzv'>Nicht gefunden</span></div>";
      if (item.name) details += "<div class='gzap'>" + esc(item.name) + "</div>";
      if (Number.isFinite(item.taggedHeightM)) details += "<div class='gzap'>Höhe laut Quelle: " + esc(Math.round(item.taggedHeightM)) + " m</div>";
      if (item.voltage) details += "<div class='gzap'>Spannung: " + esc(item.voltage) + "</div>";
      if (item.geometry.type === "Point" && Array.isArray(item.geometry.coordinates) && item.geometry.coordinates.length >= 2){
        var lon = Number(item.geometry.coordinates[0]), lat = Number(item.geometry.coordinates[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)){
          L.circleMarker([lat, lon], { radius: 6, color: "#FFFFFF", weight: 1.5, fillColor: item.kind === "wind_turbine" ? "#7B2CBF" : "#C2410C", fillOpacity: 0.95 }).bindPopup(details).addTo(energyLayer);
        }
      } else if (item.geometry.type === "LineString" && Array.isArray(item.geometry.coordinates)){
        var coords = item.geometry.coordinates.filter(function(p){ return Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])); }).map(function(p){ return [Number(p[1]), Number(p[0])]; });
        if (coords.length >= 2) L.polyline(coords, { color: "#C2410C", weight: 4, opacity: 0.9, dashArray: "7 5" }).bindPopup(details).addTo(energyLayer);
      }
    }
  }

  // ---- Standort-Marker ----
  var userMarker = null;
  function setUser(u){
    if (!u || u.length < 2) { if (userMarker) { map.removeLayer(userMarker); userMarker = null; } return; }
    if (userMarker) { userMarker.setLatLng([u[0], u[1]]); }
    else {
      if (!map.getPane("userpos")) { map.createPane("userpos"); map.getPane("userpos").style.zIndex = 645; map.getPane("userpos").style.pointerEvents = "none"; }
      userMarker = L.circleMarker([u[0], u[1]], { pane: "userpos", renderer: L.svg({ pane: "userpos" }), radius: 7, color: "#FFFFFF", weight: 2, fillColor: "#007AFF", fillOpacity: 1, interactive: false }).addTo(map);
    }
  }

  // ---- Kreise (Scan/TA/RA) + Sichtfeld-Kegel ----
  // Eigene Ebene ÜBER allen Zonen, mit weißem Halo, damit der eigene Umkreis im Zonen-Gewirr auffällt.
  map.createPane("rings");
  map.getPane("rings").style.zIndex = 640;
  map.getPane("rings").style.pointerEvents = "none";
  var ringRenderer = L.svg({ pane: "rings" });
  var ringLayer = L.layerGroup().addTo(map);
  var ringSig = "";
  function ring(center, radius, color, weight, dash, fillOpacity){
    // Halo (weiß, breiter) unter der farbigen Linie
    L.circle(center, { pane: "rings", renderer: ringRenderer, radius: radius, color: "#FFFFFF", opacity: 0.95, weight: weight + 4, fill: false, interactive: false }).addTo(ringLayer);
    L.circle(center, { pane: "rings", renderer: ringRenderer, radius: radius, color: color, opacity: 1, weight: weight, dashArray: dash || null, fillColor: color, fillOpacity: fillOpacity, interactive: false }).addTo(ringLayer);
  }
  function setRings(center, c, fov){
    var sig = JSON.stringify([center, c, fov]);
    if (sig === ringSig) return;
    ringSig = sig;
    ringLayer.clearLayers();
    if (center && center.length >= 2) {
      if (c && c.scan) ring(center, c.scan, "#7B2FBE", 3.5, null, 0.04);
      if (c && c.ta) ring(center, c.ta, "#FF8A00", 3, "10 6", 0.04);
      if (c && c.ra) ring(center, c.ra, "#E0201A", 3.5, null, 0.08);
      // Sichtflug-Reichweite (VLOS) der gewählten Drohne – Prüfradius der Geozonen
      if (c && c.vlos) ring(center, c.vlos, "#0A84FF", 3, "4 6", 0);
    }
    if (fov && fov.length > 2) {
      L.polygon(fov, { pane: "rings", renderer: ringRenderer, color: "#007AFF", opacity: 0.9, weight: 2, fillColor: "#007AFF", fillOpacity: 0.45, interactive: false }).addTo(ringLayer);
    }
  }

  // ---- Markierte Zonen-Polygone ----
  var hzLayer = L.layerGroup().addTo(map);
  var hzSig = "";
  function setHz(arr){
    var sig = JSON.stringify(arr || []);
    if (sig === hzSig) return;
    hzSig = sig;
    hzLayer.clearLayers();
    if (!arr) return;
    for (var i = 0; i < arr.length; i++){
      var poly = arr[i]; // [Aussenring, ...Loecher]
      if (poly && poly.length >= 1 && poly[0] && poly[0].length >= 3) {
        L.polygon(poly, { color: "#FF3B30", opacity: 0.95, weight: 2.5, fillColor: "#FF3B30", fillOpacity: 0.18, interactive: false, smoothFactor: 0 }).addTo(hzLayer);
      }
    }
  }

  // NOTAM-Karte: dieselbe Leaflet-Basis wie die Hauptkarte, aber ausschließlich
  // die ausdrücklich übergebenen NOTAM-Polygone (keine Radar-/Geozonen-Layer).
  var notamLayer = L.layerGroup().addTo(map);
  var notamSig = "";
  function setNotams(arr){
    var sig = JSON.stringify(arr || []);
    if (sig === notamSig) return;
    notamSig = sig;
    notamLayer.clearLayers();
    for (var i = 0; arr && i < arr.length; i++){
      var item = arr[i];
      // item.r is [outerRing, ...holes]; validate the number of vertices in
      // the outer ring, not the number of rings. Most polygons have one ring.
      if (!item || !item.r || !item.r[0] || item.r[0].length < 3) continue;
      L.polygon(item.r, {
        color: item.s || "#FF9500",
        opacity: 1,
        weight: item.w || 2,
        fillColor: item.f || "#FF9500",
        fillOpacity: 1,
        interactive: false,
        smoothFactor: 0
      }).addTo(notamLayer);
    }
  }

  // ---- Vektor-Geozonen (ED-269, z. B. AT/BE) mit Tap-Popup ----
  // Die Polygone werden NICHT mehr einzeln per bindPopup angeklickt (das zeigte bei
  // sich ueberlagernden Zonen nur die oberste). Stattdessen sind sie nicht-interaktiv
  // und der Map-Klick-Handler ermittelt per Punkt-in-Polygon ALLE getroffenen Zonen
  // und zeigt sie gesammelt in einem Popup.
  var vzLayer = L.layerGroup().addTo(map);
  var vzSig = "";
  var vzData = [];
  var vzGen = 0;
  function setVz(arr){
    var sig = JSON.stringify(arr || []);
    if (sig === vzSig) return;
    vzSig = sig;
    vzData = arr || [];
    vzLayer.clearLayers();
    if (!arr) return;
    // in Paketen zeichnen (je 150 Zonen, dazwischen abgeben): die Karte bleibt
    // bedienbar; ein neuer Stand bricht ein laufendes Zeichnen ab.
    var gen = ++vzGen, i0 = 0;
    function vzStep(){
    if (gen !== vzGen) return;
    var iEnd = Math.min(arr.length, i0 + 150);
    for (var i = i0; i < iEnd; i++){
      var z = arr[i];
      if (!z || !z.r) continue;
      // hide=true: dauerhafte Zone eines Raster-Kachel-Landes (z. B. Belgien).
      // Sie wird vom Server als WMS-artige Kachel gezeichnet; hier NICHT zeichnen,
      // aber in vzData belassen, damit die Tap-Abfrage (vzHitsAt) sie weiterhin trifft.
      if (z.hide) continue;
      for (var p = 0; z.p && p < z.p.length; p++){
        L.circleMarker(z.p[p], {radius:5,color:z.s,weight:2,fillColor:z.s,fillOpacity:0.4,interactive:false}).addTo(vzLayer);
      }
      for (var l = 0; z.l && l < z.l.length; l++){
        L.polyline(z.l[l], {color:z.s,weight:2,opacity:0.95,interactive:false}).addTo(vzLayer);
      }
      for (var k = 0; k < z.r.length; k++){
        var poly = z.r[k]; // [Aussenring, ...Loecher] -> Leaflet sticht Loecher aus
        if (poly && poly.length >= 1 && poly[0] && poly[0].length >= 3) {
          // z.ia: zeitgesteuerte Zone, derzeit inaktiv -> abgeschwächt + fein gestrichelt.
          // z.tp: temporäre Zone (Gültigkeitsfenster) -> kräftiger Strich-Punkt-Rand.
          L.polygon(poly, { color: z.s || "rgba(142,142,147,0.9)", opacity: z.ia ? 0.45 : 0.95, weight: z.tp && !z.ia ? 3 : 2, dashArray: z.ia ? "6 4" : (z.tp ? "12 4 2 4" : null), fillColor: z.f || "rgba(142,142,147,0.18)", fillOpacity: z.ia ? 0.3 : 1, interactive: false, smoothFactor: 0 }).addTo(vzLayer);
        }
      }
    }
    i0 = iEnd;
    if (i0 < arr.length) setTimeout(vzStep, 0);
    }
    vzStep();
  }
  // Strahl-Methode (Ray-Casting): liegt [lat,lon] im Ring [[lat,lon],...]?
  function pointInRing(lat, lon, ring){
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++){
      var yi = ring[i][0], xi = ring[i][1];
      var yj = ring[j][0], xj = ring[j][1];
      var intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  // Punkt-in-Polygon mit Loch-Behandlung: drinnen, wenn im Aussenring UND in
  // keinem Loch. Ein Tap im Loch (hoeherer Kernbereich) zaehlt nicht als Treffer.
  function pointInPolyWithHoles(lat, lon, poly){
    if (!poly || !poly.length || !poly[0] || !pointInRing(lat, lon, poly[0])) return false;
    for (var h = 1; h < poly.length; h++){
      if (poly[h] && poly[h].length >= 3 && pointInRing(lat, lon, poly[h])) return false;
    }
    return true;
  }
  function vzHitsAt(lat, lon){
    var hits = [];
    for (var i = 0; i < vzData.length; i++){
      var z = vzData[i];
      if (!z || !z.r) continue;
      var hit = false;
      var tapPixel = map.latLngToLayerPoint([lat, lon]);
      for (var p = 0; z.p && p < z.p.length; p++){
        if (tapPixel.distanceTo(map.latLngToLayerPoint(z.p[p])) <= 12) hit = true;
      }
      for (var l = 0; z.l && l < z.l.length; l++){
        var line = z.l[l];
        for (var j = 1; j < line.length; j++){
          var a = map.latLngToLayerPoint(line[j-1]), b = map.latLngToLayerPoint(line[j]);
          var dx=b.x-a.x, dy=b.y-a.y, den=dx*dx+dy*dy;
          var t=den?Math.max(0,Math.min(1,((tapPixel.x-a.x)*dx+(tapPixel.y-a.y)*dy)/den)):0;
          if (Math.hypot(tapPixel.x-a.x-t*dx,tapPixel.y-a.y-t*dy)<=8) hit=true;
        }
      }
      for (var k = 0; k < z.r.length; k++){
        if (pointInPolyWithHoles(lat, lon, z.r[k])) { hit = true; break; }
      }
      if (hit) hits.push(z);
    }
    return hits;
  }
  function buildVzCombinedHtml(zones){
    var h = "<div class='gzp'><div class='gzph'>" + (zones.length > 1 ? "Geozonen (" + zones.length + ")" : "Geozone") + "</div>";
    var n = Math.min(zones.length, 6);
    for (var i = 0; i < n; i++){
      var z = zones[i];
      h += "<div class='gzc'><div class='gzn'>" + esc(z.t || "Geozone") + "</div>";
      if (z.vr) h += "<div class='gzr'><span class='gzk'>Gültig</span><span class='gzv'>" + esc(z.vr) + "</span></div>";
      if (z.sc) h += "<div class='gzr'><span class='gzk'>Aktiv</span><span class='gzv'>" + esc(z.sc) + (z.ia ? " (derzeit inaktiv)" : "") + "</span></div>";
      else if (z.ia) h += "<div class='gzr'><span class='gzk'>Status</span><span class='gzv'>derzeit inaktiv</span></div>";
      var d = z.d || [];
      for (var j = 0; j < d.length; j++){
        var line = d[j] || "";
        if (line.indexOf("Zone:") === 0) continue; // Name steht bereits als Kopf
        var parts = line.split(":");
        if (parts.length >= 2) {
          h += "<div class='gzr'><span class='gzk'>" + esc(parts[0].trim()) + "</span><span class='gzv'>" + esc(parts.slice(1).join(":").trim()) + "</span></div>";
        } else if (line.trim().length > 0) {
          h += "<div class='gzv'>" + esc(line) + "</div>";
        }
      }
      if (z.ap) h += "<div class='gzap'>" + esc(z.ap) + "</div>";
      var lk = z.lk || [];
      for (var m = 0; m < lk.length; m++){
        if (lk[m] && lk[m].url) {
          h += "<a class='gzlink' href='" + esc(lk[m].url) + "'>" + esc(lk[m].label || lk[m].url) + "</a>";
        }
      }
      h += "</div>";
    }
    if (zones.length > 6) h += "<div class='gzm'>+" + (zones.length - 6) + " weitere</div>";
    h += "</div>";
    return h;
  }

  // ---- CTR-Höhenband-Ringe (Innen-/Außenbereich, vorläufig) ----
  var ctrLayer = L.layerGroup().addTo(map);
  var ctrSig = "";
  function setCtr(arr){
    var sig = JSON.stringify(arr || []);
    if (sig === ctrSig) return;
    ctrSig = sig;
    ctrLayer.clearLayers();
    if (!arr) return;
    for (var i = 0; i < arr.length; i++){
      var a = arr[i];
      if (!a || a.lat == null || a.lon == null) continue;
      // Ein Tap auf Ring oder ICAO-Marker meldet die CTR an die RN-Seite
      // (analog markerPress), die dann die native Info-Karte oeffnet.
      var onCtrTap = (function(icao){ return function(ev){ L.DomEvent.stopPropagation(ev); post({ type: "ctrPress", icao: icao }); }; })(a.icao);
      var rings = a.rings || [];
      for (var k = 0; k < rings.length; k++){
        var r = rings[k];
        if (!(r.radiusM > 0)) continue;
        L.circle([a.lat, a.lon], { radius: r.radiusM, color: r.strokeColor, weight: 1.5, opacity: r.strokeOpacity, fillColor: r.fillColor, fillOpacity: r.fillOpacity, interactive: true })
          .bindTooltip(esc(r.label) + " \u2014 vorl\u00e4ufig", { sticky: true })
          .on("click", onCtrTap)
          .addTo(ctrLayer);
      }
      L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "", html: "<div class='ctrpin'>" + esc(a.icao) + "</div>", iconSize: [0, 0], iconAnchor: [0, 0] }) })
        .on("click", onCtrTap)
        .addTo(ctrLayer);
    }
  }

  // ---- Flughafen-Wetter-Marker (METAR/TAF, Info-Symbol) ----
  var airLayer = L.layerGroup().addTo(map);
  var airSig = "";
  function setAir(arr){
    var sig = JSON.stringify(arr || []);
    if (sig === airSig) return;
    airSig = sig;
    airLayer.clearLayers();
    if (!arr) return;
    for (var i = 0; i < arr.length; i++){
      var ap = arr[i];
      if (!ap || ap.lat == null || ap.lon == null) continue;
      var onAirTap = (function(icao){ return function(ev){ L.DomEvent.stopPropagation(ev); post({ type: "airportPress", icao: icao }); }; })(ap.icao);
      L.marker([ap.lat, ap.lon], { icon: L.divIcon({ className: "", html: "<div class='apm'>i</div>", iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 500 })
        .bindTooltip(esc(ap.icao) + " \u2014 Flugwetter", { sticky: true })
        .on("click", onAirTap)
        .addTo(airLayer);
    }
  }

  // ---- Trails ----
  var trailLayer = L.layerGroup().addTo(map);
  function applyTrails(arr){
    trailLayer.clearLayers();
    if (!arr) return;
    for (var i = 0; i < arr.length; i++){
      var t = arr[i];
      if (t.pts && t.pts.length >= 2) {
        L.polyline(t.pts, { color: t.col, weight: t.w, opacity: 0.9, interactive: false }).addTo(trailLayer);
      }
    }
  }

  // ---- Flugzeug-Marker-Icons ----
  function svgPlane(color){
    return "<svg width='34' height='34' viewBox='0 0 24 24'><path fill='" + color + "' d='M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z'/></svg>";
  }
  function svgGlider(color){
    return "<svg width='32' height='32' viewBox='0 0 64 64'><path fill='" + color + "' d='M32 3 C31 3 30.2 4.5 30 7 L29.5 16 L29.5 24 C28 24.5 18 26 4 29.5 C2 30.1 1 31 1 32 C1 32.8 2 33.2 4 33.2 L29.5 32 L29.5 50 C28.5 50.5 24 51.5 22 52.2 C20.5 52.7 20 53.2 20 53.8 C20 54.3 20.8 54.8 22 54.8 L29.5 54 L30 58 C30.2 59.5 31 61 32 61 C33 61 33.8 59.5 34 58 L34.5 54 L42 54.8 C43.2 54.8 44 54.3 44 53.8 C44 53.2 43.5 52.7 42 52.2 C40 51.5 35.5 50.5 34.5 50 L34.5 32 L60 33.2 C62 33.2 63 32.8 63 32 C63 31 62 30.1 60 29.5 C46 26 36 24.5 34.5 24 L34.5 16 L34 7 C33.8 4.5 33 3 32 3 Z'/></svg>";
  }
  function svgLight(color, sz){
    var s = sz || 32, cx = s / 2;
    var p = "<svg width='" + s + "' height='" + s + "' viewBox='0 0 " + s + " " + s + "'>";
    var fuseW = s * 0.10, fuseH = s * 0.70, fuseTop = s * 0.10;
    var wingW = s * 0.95, wingH = s * 0.13, wingTop = fuseTop + fuseH * 0.30;
    var tailW = s * 0.35, tailH = s * 0.06, tailTop = fuseTop + fuseH - tailH * 0.6;
    var propW = s * 0.22, propH = s * 0.03, propTop = fuseTop - propH;
    p += "<rect x='" + (cx - fuseW / 2) + "' y='" + fuseTop + "' width='" + fuseW + "' height='" + fuseH + "' rx='" + (fuseW * 0.3) + "' fill='" + color + "'/>";
    p += "<rect x='" + (cx - wingW / 2) + "' y='" + wingTop + "' width='" + wingW + "' height='" + wingH + "' rx='" + (wingH / 2) + "' fill='" + color + "'/>";
    p += "<rect x='" + (cx - tailW / 2) + "' y='" + tailTop + "' width='" + tailW + "' height='" + tailH + "' rx='" + (tailH / 2) + "' fill='" + color + "'/>";
    p += "<rect x='" + (cx - propW / 2) + "' y='" + (propTop > 0 ? propTop : 0) + "' width='" + propW + "' height='" + propH + "' rx='" + (propH / 2) + "' fill='" + color + "'/>";
    p += "</svg>";
    return p;
  }
  function svgHeli(color){
    var s = 34, cx = s / 2;
    var p = "<svg width='" + s + "' height='" + s + "' viewBox='0 0 " + s + " " + s + "'>";
    var bodyW = s * 0.18, bodyH = s * 0.32, bodyTop = s * 0.04, bodyCy = bodyTop + bodyH * 0.38;
    var bladeLen = s * 0.48, bladeW = s * 0.04;
    var tailW = s * 0.05, tailTop = bodyTop + bodyH * 0.80, tailH = s * 0.40, tailEnd = tailTop + tailH;
    var finLen = s * 0.18, finW = s * 0.04;
    p += "<g transform='rotate(45 " + cx + " " + bodyCy + ")'><rect x='" + (cx - bladeW / 2) + "' y='" + (bodyCy - bladeLen) + "' width='" + bladeW + "' height='" + (bladeLen * 2) + "' rx='" + (bladeW / 2) + "' fill='" + color + "'/></g>";
    p += "<g transform='rotate(-45 " + cx + " " + bodyCy + ")'><rect x='" + (cx - bladeW / 2) + "' y='" + (bodyCy - bladeLen) + "' width='" + bladeW + "' height='" + (bladeLen * 2) + "' rx='" + (bladeW / 2) + "' fill='" + color + "'/></g>";
    p += "<rect x='" + (cx - bodyW / 2) + "' y='" + bodyTop + "' width='" + bodyW + "' height='" + bodyH + "' rx='" + (bodyW / 2) + "' fill='" + color + "'/>";
    p += "<rect x='" + (cx - tailW / 2) + "' y='" + tailTop + "' width='" + tailW + "' height='" + tailH + "' fill='" + color + "'/>";
    p += "<rect x='" + (cx - finLen / 2) + "' y='" + (tailEnd - finW / 2) + "' width='" + finLen + "' height='" + finW + "' rx='" + (finW / 2) + "' fill='" + color + "'/>";
    p += "</svg>";
    return p;
  }
  function svgBalloon(color){
    return "<svg width='30' height='34' viewBox='0 0 30 34'><circle cx='15' cy='13' r='12' fill='" + color + "'/><path d='M10 23 L20 23 L17 31 L13 31 Z' fill='" + color + "'/></svg>";
  }
  function svgDrone(color){
    return "<svg width='32' height='32' viewBox='0 0 32 32'><circle cx='8' cy='8' r='5' fill='none' stroke='" + color + "' stroke-width='2'/><circle cx='24' cy='8' r='5' fill='none' stroke='" + color + "' stroke-width='2'/><circle cx='8' cy='24' r='5' fill='none' stroke='" + color + "' stroke-width='2'/><circle cx='24' cy='24' r='5' fill='none' stroke='" + color + "' stroke-width='2'/><rect x='12' y='12' width='8' height='8' rx='2' fill='" + color + "'/></svg>";
  }
  function svgGround(color){
    return "<svg width='28' height='28' viewBox='0 0 28 28'><rect x='6' y='8' width='16' height='12' rx='2' fill='" + color + "'/></svg>";
  }
  function iconSvg(cat, color){
    if (cat === "glider") return svgGlider(color);
    if (cat === "light") return svgLight(color, 32);
    if (cat === "ultralight") return svgLight(color, 26);
    if (cat === "helicopter") return svgHeli(color);
    if (cat === "balloon") return svgBalloon(color);
    if (cat === "drone") return svgDrone(color);
    if (cat === "ground") return svgGround(color);
    return svgPlane(color);
  }
  function buildIcon(d){
    var rot = d.c === "balloon" ? 0 : d.h;
    var tagH = d.w ? 12 : 0;
    var badgeH = d.a ? 15 : 0;
    var totalH = tagH + 40 + badgeH;
    var html = "<div class='acm' style='opacity:" + d.o + "'>";
    if (d.w) html += "<div class='actag' style='background:" + (d.al ? "#FF3B30" : "#FF9500") + "'>" + (d.al ? "RA" : "TA") + "</div>";
    html += "<div class='acicon' style='transform:rotate(" + rot + "deg)'>" + iconSvg(d.c, d.col) + "</div>";
    if (d.a) html += "<div class='acalt'>" + esc(d.a) + "</div>";
    html += "</div>";
    return L.divIcon({ className: "", html: html, iconSize: [44, totalH], iconAnchor: [22, tagH + 20] });
  }

  var markerLayer = L.layerGroup().addTo(map);
  var acMarkers = {};
  function applyMarkers(arr){
    var seen = {};
    if (arr) for (var i = 0; i < arr.length; i++){
      var d = arr[i];
      seen[d.id] = 1;
      var sig = d.lat + "," + d.lon + "," + d.h + "," + d.col + "," + d.a + "," + d.c + "," + (d.w ? 1 : 0) + "," + (d.al ? 1 : 0) + "," + d.o;
      var ex = acMarkers[d.id];
      if (ex && ex.sig === sig) continue;
      if (ex) {
        ex.m.setLatLng([d.lat, d.lon]);
        ex.m.setIcon(buildIcon(d));
        ex.sig = sig;
      } else {
        var m = L.marker([d.lat, d.lon], { icon: buildIcon(d), keyboard: false, zIndexOffset: d.w ? 1000 : 0 });
        m.on("click", (function(id){ return function(ev){ L.DomEvent.stopPropagation(ev); post({ type: "markerPress", id: id }); }; })(d.id));
        m.addTo(markerLayer);
        acMarkers[d.id] = { m: m, sig: sig };
      }
    }
    for (var id in acMarkers){ if (!seen[id]) { markerLayer.removeLayer(acMarkers[id].m); delete acMarkers[id]; } }
  }

  // ---- Geozonen-Tap-Popup ----
  var featPopup = null;
  function renderPopupGroup(arr, isTmp){
    if (!arr || arr.length === 0) return "";
    var head = isTmp
      ? (arr.length > 1 ? "NOTAM-Gebiete / Sperrungen (" + arr.length + ")" : "NOTAM-Gebiet / Sperrung")
      : (arr.length > 1 ? "Geozonen (" + arr.length + ")" : "Geozone");
    var h = "<div class='gzph" + (isTmp ? " gzph-tmp" : "") + "'>" + esc(head) + "</div>";
    var n = Math.min(arr.length, 4);
    for (var i = 0; i < n; i++){
      var fi = arr[i];
      h += "<div class='gzc" + (isTmp ? " gzc-tmp" : "") + "'><div class='gzb" + (isTmp ? " gzb-tmp" : "") + "'>" + esc(fi.layerLabel) + "</div><div class='gzn'>" + esc(fi.name) + "</div>";
      var det = (fi.details || "").split("\\n").filter(function(x){ return x.trim().length > 0; }).slice(0, 3);
      for (var j = 0; j < det.length; j++){
        var parts = det[j].split(":");
        if (parts.length >= 2) {
          h += "<div class='gzr'><span class='gzk'>" + esc(parts[0].trim()) + "</span><span class='gzv'>" + esc(parts.slice(1).join(":").trim()) + "</span></div>";
        } else {
          h += "<div class='gzv'>" + esc(det[j]) + "</div>";
        }
      }
      h += "</div>";
    }
    if (arr.length > 4) h += "<div class='gzm'>+" + (arr.length - 4) + " weitere</div>";
    return h;
  }
  function buildPopupHtml(items){
    var geo = [], tmp = [];
    for (var gi = 0; gi < items.length; gi++){
      var it = items[gi];
      if (it && it.cat === "notam") tmp.push(it); else geo.push(it);
    }
    var h = "<div class='gzp'>";
    h += renderPopupGroup(geo, false);
    h += renderPopupGroup(tmp, true);
    h += "</div>";
    return h;
  }
  window.__popup = function(d){ try { if (featPopup) map.closePopup(featPopup); featPopup = L.popup({ className: "gz-popup", maxWidth: 240, autoPan: false }).setLatLng([d.lat, d.lon]).setContent(buildPopupHtml(d.items)).openOn(map); } catch (e) {} };
  window.__popupLoading = function(d){ try { if (featPopup) map.closePopup(featPopup); featPopup = L.popup({ className: "gz-popup", maxWidth: 120, closeButton: false, autoPan: false }).setLatLng([d.lat, d.lon]).setContent("<div class='gzl'>Laden…</div>").openOn(map); } catch (e) {} };
  window.__popupClose = function(){ try { if (featPopup) { map.closePopup(featPopup); featPopup = null; } } catch (e) {} };

  // ---- Pan-Sperre ----
  function setLock(lock){
    if (lock) { map.dragging.disable(); map.touchZoom.disable(); map.doubleClickZoom.disable(); map.scrollWheelZoom.disable(); map.boxZoom.disable(); }
    else { map.dragging.enable(); map.touchZoom.enable(); map.doubleClickZoom.enable(); map.scrollWheelZoom.enable(); map.boxZoom.enable(); }
  }

  // Vektorzonen getrennt vom übrigen Zustand: die RN-Seite serialisiert sie nur
  // bei Änderung (nicht bei jedem Flugzeug-Update).
  window.__setVz = function(arr){ try { setVz(arr || []); } catch (e) { post({ type: "mapError", reason: String(e) }); } return true; };
  // ---- Zustand anwenden ----
  var lastFit = null;
  window.__apply = function(s){
    try {
      if (!map || !baseLayer) throw new Error("Map oder Grundkarte ist nicht initialisiert");
      setBase(s.base, s.dark);
      setGeo(s.geo || []);
      setUser(s.user);
      setRings(s.user, s.circles || {}, s.fov);
      setHz(s.hz);
      setNotams(s.nt || []);
      setEnergy(s.energy || [], s.windBuffers || []);
      // Vektorzonen kommen getrennt (window.__setVz), nur wenn sie sich ändern
      if (s.vz) setVz(s.vz);
      setCtr(s.ctr || []);
      setAir(s.air || []);
      applyTrails(s.trails || []);
      applyMarkers(s.markers || []);
      setLock(!!s.lockPan);
      if (s.fit !== lastFit) { lastFit = s.fit; map.setView(s.center, s.zoom, { animate: true }); }
      setTimeout(function(){ try { map.invalidateSize({ pan: false }); } catch (e) {} }, 0);
      return true;
    } catch (e) {
      post({ type: "mapError", reason: String(e) });
      return false;
    }
  };

  // ---- Region/Interaktion zurückmelden ----
  function reportRegion(){
    try {
      var c = map.getCenter(), b = map.getBounds();
      post({ type: "region", lat: c.lat, lon: c.lng, latDelta: Math.abs(b.getNorth() - b.getSouth()), lonDelta: Math.abs(b.getEast() - b.getWest()), zoom: map.getZoom() });
    } catch (e) {}
  }
  map.on("moveend", reportRegion);
  map.on("zoomend", reportRegion);
  map.on("click", function(e){
    // Vektor-Geozonen (AT/BE) lokal per Punkt-in-Polygon treffen – zeigt ALLE
    // ueberlagernden Zonen gesammelt; ansonsten WMS-GetFeatureInfo via mapPress.
    var hits = vzHitsAt(e.latlng.lat, e.latlng.lng);
    if (hits.length > 0) {
      try { if (featPopup) map.closePopup(featPopup); featPopup = L.popup({ className: "gz-popup", maxWidth: 260, autoPan: false }).setLatLng([e.latlng.lat, e.latlng.lng]).setContent(buildVzCombinedHtml(hits)).openOn(map); } catch (err) {}
      return;
    }
    post({ type: "mapPress", lat: e.latlng.lat, lon: e.latlng.lng });
  });

  // Long-Press: contextmenu feuert in iOS WKWebView nicht zuverlaessig auf
  // Touch-Halten, daher zusaetzlich eigene Touch-Erkennung. Beide Pfade laufen
  // ueber fireLongPress (debounced), damit es auf Android kein Doppel-Event gibt.
  var lastLp = 0;
  function fireLongPress(lat, lon){
    var now = Date.now();
    if (now - lastLp < 800) return;
    lastLp = now;
    post({ type: "longPress", lat: lat, lon: lon });
  }
  map.on("contextmenu", function(e){ fireLongPress(e.latlng.lat, e.latlng.lng); });

  (function(){
    var lpTimer = null, lpStart = null, lpMoved = false;
    var container = map.getContainer();
    function clearLp(){ if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } lpStart = null; lpMoved = false; }
    container.addEventListener("touchstart", function(ev){
      if (!ev.touches || ev.touches.length !== 1) { clearLp(); return; }
      // Nicht auf Flugzeug-/Standort-Markern ausloesen (sonst verschoebe ein
      // Halten auf einem Flieger versehentlich den Radar-Standpunkt).
      if (ev.target && ev.target.closest && ev.target.closest(".leaflet-marker-icon")) { clearLp(); return; }
      var t = ev.touches[0];
      var rect = container.getBoundingClientRect();
      lpStart = { x: t.clientX, y: t.clientY, pt: L.point(t.clientX - rect.left, t.clientY - rect.top) };
      lpMoved = false;
      lpTimer = setTimeout(function(){
        if (lpStart && !lpMoved) {
          try { var ll = map.containerPointToLatLng(lpStart.pt); fireLongPress(ll.lat, ll.lng); } catch (e) {}
        }
        clearLp();
      }, 500);
    }, { passive: true });
    container.addEventListener("touchmove", function(ev){
      if (!lpStart || !ev.touches || !ev.touches.length) return;
      var t = ev.touches[0];
      if (Math.abs(t.clientX - lpStart.x) > 12 || Math.abs(t.clientY - lpStart.y) > 12) { lpMoved = true; clearLp(); }
    }, { passive: true });
    container.addEventListener("touchend", clearLp, { passive: true });
    container.addEventListener("touchcancel", clearLp, { passive: true });
  })();

  post({ type: "ready" });
})();
</script>
</body>
</html>`;

// Formatiert das Gültigkeitsfenster temporärer Zonen (ms-Epoch) als deutsche
// "von … bis … Uhr"-Zeichenkette. null, wenn keine vollständige Gültigkeit.
function formatValidityRange(startTs?: number | null, endTs?: number | null): string | null {
  if (startTs == null || endTs == null) return null;
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    });
  return `von ${fmt(startTs)} bis ${fmt(endTs)} Uhr`;
}

// True, wenn die Zone ein Gültigkeitsfenster trägt (temporäre/NOTAM-Zone, z. B.
// belgische skeyes-COMMON-Zonen). Permanente Zonen haben null in beiden Feldern.
function isTempVectorZone(z: GeozoneFeatureInfo): boolean {
  // Kanonische Regel (shared/ed269Restriction ed269IsTemporary): eine Zone ist
  // temporär, sobald EIN Gültigkeits-Zeitstempel gesetzt ist (Start ODER Ende).
  // Muss identisch zur serverseitigen Kachel-Aussparung sein, sonst fallen Zonen
  // mit nur Start- oder nur End-Zeit aus Kachel UND Vektor heraus.
  return z.validStartTs != null || z.validEndTs != null;
}

export default function TrafficMapView({
  latitude, longitude, latDelta, lonDelta, locationName, markers, trails,
  fullScreen, alarmRadiusM, taRadiusM, scanRadiusM, vlosRadiusM, onLongPress, wind, sourceStatus,
  geozoneLayers, countryIso, highlightedZones, additionalGeozones = [], energyInfrastructure = [], windRestrictionPoints = [], energyTilesEnabled, energyTilesShowSupplemental, mapStyle = "grayscale", onMapStyleChange,
  onCenterGps, onSettingsPress, dronePill, settingsActive, bottomPadding = 0, infoBubbleBottomInset = 0, topInset = 0, weatherAlerts,
  onHeadingChange, disableGeozoneQuery = false, lockPan = false, onViewportChange,
  maxReachableAltitudeM = DEFAULT_REACHABLE_ALTITUDE_M, showAllGeozones = false,
  hideUserPosition = false, highlightClipRadiusM,
}: TrafficMapViewProps) {
  // Im Flug-Modus: Panning gesperrt → Geozone-Tap-Abfrage komplett aus.
  const geozoneQueryDisabled = disableGeozoneQuery || lockPan;
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isNight = useIsNight(latitude, longitude);

  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [disabledTap, setDisabledTap] = useState<DisabledCountryTap | null>(null);
  // Vollbild-Overlays (Modal) liegen unter der Android-Statusleiste: Kopfzeile
  // und Schließen-Knopf unter den Safe-Area-Rand (Uhr/Akku/Download-Anzeige).
  const safeInsets = useSafeAreaInsets();
  const overlayTopInset = Math.max(safeInsets.top, Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0);
  const [flightUrl, setFlightUrl] = useState<string | null>(null);
  const [flightCallsign, setFlightCallsign] = useState("");
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const [selectedCtrIcao, setSelectedCtrIcao] = useState<string | null>(null);
  const [selectedAirportIcao, setSelectedAirportIcao] = useState<string | null>(null);
  // Tier-2-Flughafen-Wetter-Stationen (live per AWC-Bbox geladen, ab Zoom 9).
  const [areaStations, setAreaStations] = useState<AirportStation[]>([]);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [ctrLegendOpen, setCtrLegendOpen] = useState(false);
  // Vektor-Geozonen aus dem zentralen Cache (ED-269, z. B. Österreich). Diese
  // Länder liefern kein WMS -- die Zonen werden im WebView als Leaflet-Polygone
  // mit Tap-Popup gerendert.
  const [vectorZones, setVectorZones] = useState<GeozoneFeatureInfo[]>([]);
  // Geländeschätzung (MSL) um das Kartenzentrum für die MSL->AGL-Umrechnung im
  // Höhen-Filter (Maximum/Minimum im Radius, B3); null = nicht bekannt.
  const [terrainEstimate, setTerrainEstimate] = useState<
    { lat: number; lon: number; radiusM: number; est: TerrainEstimate } | null
  >(null);
  // Pro-Land-Zwischenspeicher der zuletzt ERFOLGREICH geladenen Vektor-Zonen.
  // Verhindert, dass ein fehlgeschlagener/abgebrochener Re-Fetch beim Scrollen
  // die bereits gezeichneten Zonen löscht ("nach Scrollen keine Geozonen mehr").
  const vectorZonesByIsoRef = useRef<Record<string, GeozoneFeatureInfo[]>>({});
  // Länder, deren GESAMTER Landesbestand bereits geladen ist (z. B. BE). Ihre
  // Daten sind positionsunabhängig -> beim Pannen NICHT erneut 3,6 MB nachladen.
  const fullCountryLoadedRef = useRef<Set<string>>(new Set());
  // Länder, deren Zonenliste auf GEOZONE_VECTOR_MAX_FEATURES gekürzt wurde
  // (B7/S7: Hinweis „hineinzoomen“ statt stiller Kürzung).
  const truncatedIsosRef = useRef<Set<string>>(new Set());
  const [vectorZonesTruncated, setVectorZonesTruncated] = useState(false);
  const vzPublishSigRef = useRef<string>("");
  // Wird bei JEDER tatsächlichen Inhaltsänderung des Pro-Land-Caches erhöht.
  // Fließt in die Publish-Signatur ein, damit auch bbox-Länder (DK) mit gleicher
  // Zonenanzahl, aber anderem Inhalt zuverlässig neu gezeichnet werden.
  const vzVersionRef = useRef<number>(0);
  const [mapSize, setMapSize] = useState({ width: 400, height: 400 });
  const [currentRegion, setCurrentRegion] = useState<Region>({
    latitude, longitude, latitudeDelta: latDelta, longitudeDelta: lonDelta,
  });
  // settledRegion = Region am Gestenende; speist Geozonen-Sichtbarkeit + Länder-Set.
  const [settledRegion, setSettledRegion] = useState<Region>({
    latitude, longitude, latitudeDelta: latDelta, longitudeDelta: lonDelta,
  });

  const runJs = useCallback((code: string) => {
    try { webRef.current?.injectJavaScript(code + ";true;"); } catch {}
  }, []);

  // Ziel-Zoom aus latDelta (Leaflet nutzt Integer-Zoomstufen).
  const targetZoom = useMemo(() => {
    const z = Math.round(Math.log2(360 / Math.max(latDelta, 0.0001)));
    return Math.max(3, Math.min(18, z));
  }, [latDelta]);

  // fit zählt hoch, wenn sich die Eingabe-Position/Ausdehnung ändert → WebView
  // führt dann ein setView aus (mirror des früheren animateToRegion).
  const [fit, setFit] = useState(0);
  useEffect(() => { setFit((f) => f + 1); }, [latitude, longitude, latDelta, lonDelta]);

  const currentZoom = useMemo(() => {
    if (!currentRegion.latitudeDelta || currentRegion.latitudeDelta <= 0) return 15;
    return Math.round(Math.log2(360 / currentRegion.latitudeDelta));
  }, [currentRegion.latitudeDelta]);

  // RC: Länderkarten, Offline-Kacheln und Hindernisse
  useRcLeaflet(webRef, ready, settledRegion, Math.log2(360 / Math.max(settledRegion.longitudeDelta || 0.0001, 0.0001)));

  const settledZoom = useMemo(() => {
    if (!settledRegion.latitudeDelta || settledRegion.latitudeDelta <= 0) return 15;
    return Math.round(Math.log2(360 / settledRegion.latitudeDelta));
  }, [settledRegion.latitudeDelta]);

  // Legenden-Einträge: nur die Höhenbänder der Modelle, die tatsächlich für
  // Flughäfen in der Nähe gelten. Wenn z. B. nur DFS-4-Zonen-Flughäfen sichtbar
  // sind, erscheinen keine verwirrenden Innenbereich/Außenbereich-Einträge.
  // Die Legende ist bei zoom < 8 oder ohne Kontrollzonen-Layer ohnehin unsichtbar.
  const ctrLegendEntries = useMemo(() => {
    const ctrEnabled = !!geozoneLayers && geozoneLayers.includes("kontrollzonen");
    if (!ctrEnabled || settledZoom < 8) return getCtrLegendEntries();
    const nearby = findNearbyCtrAirports(latitude, longitude, 30)
      .filter((a) => !!a.avInfo)
      .slice(0, 4);
    if (nearby.length === 0) return getCtrLegendEntries();
    // Dedupliziere Staffelungen nach Signatur (fromDistanceKm:maxHeightAglM-Paare).
    const seen = new Set<string>();
    const stepsList = nearby
      .map((a) => a.avInfo!.heightSteps)
      .filter((steps) => {
        const key = steps.map((s) => `${s.fromDistanceKm}:${s.maxHeightAglM}`).join(",");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return getCtrLegendEntries(stepsList);
  }, [geozoneLayers, settledZoom, latitude, longitude]);

  // Geozonen-Overlay erst ab regionaler Zoomstufe; beim Rauszoomen ganz aus.
  const geozonesVisible = settledZoom >= GEOZONE_TILE_MIN_ZOOM;
  // Vektor-Zonen (ED-269) werden pro Land gegated: dichte Länder (z. B. DK) erst
  // ab GEOZONE_VECTOR_MIN_ZOOM (ihre bbox-Abfrage zieht sonst den gesamten
  // sichtbaren Bereich als ein riesiges JSON ins Timeout), kleine Länder (z. B.
  // BE, ~288 Zonen) bereits bei landesweiter Sicht (getVectorMinZoom). Ein Land
  // ist sichtbar, wenn der Zoom über SEINER Mindestschwelle liegt.
  const isVectorCountryVisible = useCallback(
    (iso: string) => settledZoom >= getVectorMinZoom(iso),
    [settledZoom],
  );
  // Länder mit Offline-Kachelspeicher (DE/FR/CZ) werden ab ihrer Vektor-
  // Schwelle als Polygone aus dem Speicher gezeichnet; darunter (Übersicht)
  // bleibt – sofern vorhanden – das WMS-Bild.
  const tiledIsos = useTiledGeozoneIsos();
  const geozoneLayersKey = geozoneLayers?.length ? geozoneLayers.join(",") : "";
  const isTiledVector = useCallback(
    (iso: string) => tiledIsos.has(iso) && isVectorCountryVisible(iso),
    [tiledIsos, isVectorCountryVisible],
  );

  // Zoom-abhängiger Marker-/Trail-Cap (wie zuvor).
  const markerCap = useMemo(() => {
    if (currentZoom >= 14) return 12;
    if (currentZoom >= 12) return 22;
    if (currentZoom >= 10) return 35;
    return 60;
  }, [currentZoom]);
  const trailCap = useMemo(() => Math.min(markerCap, 20), [markerCap]);

  // Länder-Set aus dem sichtbaren (settled) Viewport.
  const countryListKey = useMemo(() => {
    const isos = getViewportCountries(
      settledRegion.latitude,
      settledRegion.longitude,
      settledRegion.latitudeDelta,
      settledRegion.longitudeDelta,
    );
    if (isos.length === 0 && countryIso) return countryIso.toUpperCase();
    return isos.join(",");
  }, [settledRegion.latitude, settledRegion.longitude, settledRegion.latitudeDelta, settledRegion.longitudeDelta, countryIso]);

  // Länder-Berechtigung (Task #522): Nur freigeschaltete Länder zeigen Geozonen.
  // Auf Mobile tragen die Kachel-Requests KEIN Session-Cookie (react-native-maps
  // UrlTile), daher kann die Server-Gate-Prüfung dort nicht greifen — das Ausgrauen
  // gesperrter Nachbarländer muss hier clientseitig erfolgen.
  const { entitlement } = useAuth();
  // Länder-Nutzung „Aus“: keine Overlays/Abfragen, Hinweis mit „Land aktivieren (online)“
  const countryUsageMap = useCountryUsageMap();
  const { lockedSet, lockedNames } = useMemo(() => {
    const isos = countryListKey ? countryListKey.split(",").filter(Boolean) : [];
    const { locked } = splitCountriesByAccess(isos, entitlement);
    // LI folgt CH: ein Hinweis „Schweiz / Liechtenstein“
    const disabled = isos.filter((iso) => !isGeozoneSourceEnabled(iso));
    return {
      lockedSet: new Set([...locked, ...disabled]),
      lockedNames: locked.map((iso) => countryName(iso)),
      disabledIsos: [...new Set(disabled.map((iso) => usageIsoOf(iso)))],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryListKey, entitlement, countryUsageMap]);

  // Länder, deren Zonen gerade aus dem Kachelspeicher gezeichnet werden
  // (String-Schlüssel, damit die Kachel-Ebenen nur beim Wechsel neu entstehen).
  const tiledVectorKey = useMemo(
    () => (countryListKey ? countryListKey.split(",") : []).filter((iso) => isTiledVector(iso)).join(","),
    [countryListKey, isTiledVector],
  );

  // Eine serverseitig gecachte XYZ-Kachel-URL pro freigeschaltetem Land.
  const geozoneTileUrls = useMemo(() => {
    const tiledNow = new Set(tiledVectorKey ? tiledVectorKey.split(",") : []);
    const countries = (countryListKey ? countryListKey.split(",") : []).filter(
      (iso) => !lockedSet.has(iso) && !tiledNow.has(iso),
    );
    return countries.map((iso) => {
      // Vektor-Länder ohne WMS (z. B. Belgien) werden serverseitig zu PNG-Kacheln
      // rasterisiert und wie eine WMS-Kachel-Ebene eingebunden — robust statt
      // fragiler Client-Vektor-Polygone. Keine Layer-Auswahl (Server zeichnet alle
      // dauerhaften Zonen).
      if (isRasterTiledVectorCountry(iso)) {
        return { iso, url: buildVectorGeozoneTileUrl(iso) };
      }
      const config = getCountryGeozoneConfig(iso);
      const defaultLayers = config.layers.filter(l => l.defaultEnabled).map(l => l.wmsLayer);
      const fallbackLayers = defaultLayers.length > 0 ? defaultLayers : [config.layers[0]?.wmsLayer].filter(Boolean) as string[];
      const layerSet = (iso === countryIso && geozoneLayers && geozoneLayers.length > 0)
        ? geozoneLayers
        : fallbackLayers;
      return buildGeozoneTileUrls(layerSet, iso).map((url) => ({ iso, url }));
    }).flat().filter((t) => t.url);
  }, [countryListKey, geozoneLayers, countryIso, lockedSet, tiledVectorKey]);

  // ED-269-Vektorländer (ohne WMS, z. B. AT/BE/DK) aus dem sichtbaren Viewport
  // laden. Quelle ist settledRegion (Gestenende), damit sich die Polygone nicht
  // mitten in einer Pan-/Pinch-Geste neu mounten.
  //
  // WICHTIG: Diese Vektor-Zonen sind ein ANZEIGE-Overlay wie die WMS-Kacheln und
  // dürfen NICHT an geozoneQueryDisabled (= disableGeozoneQuery || lockPan)
  // hängen. Dieses Flag steuert nur das Tap-zum-Abfragen-Popup (siehe
  // handleMapPress). Die WMS-Kacheln (FR/DE/CH/LU/NL) werden unabhängig davon
  // gerendert; würden die Vektor-Zonen daran gekoppelt, erschienen auf dem
  // Radar (disableGeozoneQuery) und im Flight-Check (lockPan) WMS-Länder, aber
  // Belgien/Österreich/Dänemark blieben unsichtbar – genau der Fehler "in
  // Belgien keine Geozonen auf dem Radar". Gating erfolgt daher ausschließlich
  // über die pro-Land-Zoomschwelle (isVectorCountryVisible).
  useEffect(() => {
    // Nur die ED-269-Länder laden, die bei DIESEM Zoom sichtbar sind (pro-Land-
    // Schwelle). DK bleibt so bei weiter Sicht ungeladen (Timeout-Schutz), BE
    // wird bereits landesweit gezeichnet.
    const isos = (countryListKey ? countryListKey.split(",") : []).filter(
      (i) =>
        (getCountryGeozoneConfig(i).featureInfoType === "ed269-cached" || isTiledVector(i)) &&
        isVectorCountryVisible(i) &&
        !lockedSet.has(i),
    );

    // Cache der Länder vergessen, die NICHT mehr sichtbar sind (Zoom/Pan), damit
    // sie beim Wiedereintritt frisch geladen werden und keinen Speicher halten.
    for (const k of Object.keys(vectorZonesByIsoRef.current)) {
      if (!isos.includes(k)) {
        delete vectorZonesByIsoRef.current[k];
        fullCountryLoadedRef.current.delete(k);
        truncatedIsosRef.current.delete(k);
        vzVersionRef.current++;
      }
    }

    // Aktuell zwischengespeicherte Zonen aller sichtbaren Länder veröffentlichen.
    // Wird bei JEDEM Settle aufgerufen: liefert sofort die bereits geladenen
    // Zonen (kein Flackern beim Scrollen) und ersetzt sie NUR, wenn sich der
    // Inhalt wirklich geändert hat.
    const publish = () => {
      setVectorZonesTruncated(isos.some((iso) => truncatedIsosRef.current.has(iso)));
      const merged = isos.flatMap((iso) => vectorZonesByIsoRef.current[iso] || []);
      // Signatur = sichtbare Länder + Inhalts-Version. Letztere ändert sich bei
      // JEDER Cache-Aktualisierung, also auch wenn ein bbox-Land (DK) gleich viele,
      // aber andere Zonen liefert -> kein unterdrücktes Neuzeichnen.
      const sig = `${isos.join("|")}#${vzVersionRef.current}`;
      if (sig === vzPublishSigRef.current) return;
      vzPublishSigRef.current = sig;
      setVectorZones(merged);
    };

    if (isos.length === 0) {
      publish();
      return;
    }
    publish();

    let cancelled = false;
    // Nur Länder neu abfragen, die es brauchen: Länder mit vollem Landesbestand
    // (BE) sind positionsunabhängig und werden nach dem ersten Erfolg NICHT mehr
    // nachgeladen; bbox-Länder (DK) werden beim Pannen weiter aktualisiert.
    const toFetch = isos.filter((iso) =>
      loadsFullCountryVectorZones(iso) ? !fullCountryLoadedRef.current.has(iso) : true,
    );
    if (toFetch.length === 0) {
      return () => { cancelled = true; };
    }
    // bbox-Radius am sichtbaren Bereich (halbe Ausdehnung) ausrichten und auf
    // GEOZONE_VECTOR_MAX_RADIUS_KM deckeln, damit die Antwort selbst bei weiter
    // Sicht nicht zu einer landesweiten Massenabfrage anwächst (Dänemark).
    const radiusKm = Math.min(
      GEOZONE_VECTOR_MAX_RADIUS_KM,
      Math.max(
        5,
        ((settledRegion.latitudeDelta + settledRegion.longitudeDelta) / 2) * 111.32 * 0.5,
      ),
    );
    Promise.all(
      toFetch.map(async (iso) => {
        // Kleine Länder (BE) den gesamten Landesbestand laden, damit beim
        // Herauszoomen ALLE Zonen statt nur der zentrumsnahen erscheinen.
        const r = await queryEd269CachedFeaturesWithStatus(
          settledRegion.latitude,
          settledRegion.longitude,
          radiusKm,
          iso,
          GEOZONE_VECTOR_MAX_FEATURES,
          loadsFullCountryVectorZones(iso),
          undefined,
          // DE-Kachelspeicher: nur die gewählten dipul-Ebenen zeichnen
          iso === "DE" && iso === countryIso?.toUpperCase() && geozoneLayersKey ? { layers: geozoneLayersKey.split(",") } : undefined,
        ).catch(() => ({ zones: [] as GeozoneFeatureInfo[], truncated: false }));
        return { iso, res: r.zones, truncated: !!r.truncated };
      }),
    ).then((items) => {
      if (cancelled) return;
      for (const { iso, res, truncated } of items) {
        if (res.length > 0) {
          if (truncated) truncatedIsosRef.current.add(iso);
          else truncatedIsosRef.current.delete(iso);
          // Erfolg: Zonen übernehmen; volle Länder als geladen markieren.
          vectorZonesByIsoRef.current[iso] = res;
          vzVersionRef.current++;
          if (loadsFullCountryVectorZones(iso)) fullCountryLoadedRef.current.add(iso);
        }
        // Leeres Ergebnis (Fehler/Timeout): vorherige Zonen BEHALTEN und nicht
        // als geladen markieren -> nächster Settle versucht es erneut.
      }
      publish();
    });
    return () => { cancelled = true; };
  }, [countryListKey, isVectorCountryVisible, isTiledVector, lockedSet, countryIso, geozoneLayersKey, settledRegion.latitude, settledRegion.longitude, settledRegion.latitudeDelta, settledRegion.longitudeDelta]);

  // Hinweis "Hineinzoomen", wenn ein Vektor-Land (ED-269, z. B. DK) sichtbar ist,
  // dessen Zonen aber wegen zu weiter Sicht (< seiner Mindestschwelle) noch nicht
  // gezeichnet werden. Verhindert die Fehldeutung "hier gibt es keine Zonen".
  // Länder, die bereits sichtbar sind (z. B. BE landesweit), lösen ihn NICHT aus.
  const vectorZonesHiddenHint = useMemo(() => {
    const isos = countryListKey ? countryListKey.split(",") : [];
    return isos.some(
      (i) =>
        getCountryGeozoneConfig(i).featureInfoType === "ed269-cached" &&
        !isVectorCountryVisible(i),
    );
  }, [isVectorCountryVisible, countryListKey]);

  const onMapLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setMapSize({ width: Math.round(width), height: Math.round(height) });
  }, []);

  const onMarkerPress = useCallback((id: string) => {
    setSelectedCtrIcao(null);
    setSelectedAircraftId((prev) => (prev === id ? null : id));
  }, []);

  const onCtrPress = useCallback((icao: string) => {
    setSelectedAircraftId(null);
    setSelectedCtrIcao((prev) => (prev === icao ? null : icao));
  }, []);

  const onAirportPress = useCallback((icao: string) => {
    setSelectedAircraftId(null);
    setSelectedCtrIcao(null);
    setSelectedAirportIcao((prev) => (prev === icao ? null : icao));
  }, []);

  // Angetippte CTR (ICAO-Marker/Ring) → vollständiger Flughafen-Datensatz.
  const selectedCtr = useMemo(
    () => (selectedCtrIcao ? CTR_AIRPORTS.find((a) => a.icao === selectedCtrIcao) ?? null : null),
    [selectedCtrIcao],
  );

  // Angetippter Flughafen-Wetter-Marker → METAR/TAF-Fenster. Name aus CTR-Liste,
  // sonst aus den großen EU-Flughäfen bzw. den live geladenen Stationen.
  const selectedAirport = useMemo(() => {
    if (!selectedAirportIcao) return null;
    // Vorab bekannte METAR aus dem Marker mitgeben, damit das Wetter-Fenster sie
    // sofort anzeigen kann (nur die TAF wird dann im Hintergrund nachgeladen).
    const station = areaStations.find((a) => a.icao === selectedAirportIcao);
    const ctr = CTR_AIRPORTS.find((a) => a.icao === selectedAirportIcao);
    if (ctr) return { icao: ctr.icao, name: ctr.name, raw: station?.raw ?? null, observedAt: station?.observedAt ?? null };
    const major = MAJOR_EU_AIRPORTS.find((a) => a.icao === selectedAirportIcao);
    if (major) return { icao: major.icao, name: major.name, raw: station?.raw ?? null, observedAt: station?.observedAt ?? null };
    if (station) return { icao: station.icao, name: station.name, raw: station.raw ?? null, observedAt: station.observedAt ?? null };
    return { icao: selectedAirportIcao, name: selectedAirportIcao, raw: null, observedAt: null };
  }, [selectedAirportIcao, areaStations]);

  // Marker-Daten (kompaktes JSON für den WebView) — Heading aus Trail ableiten,
  // wenn keines vorhanden; Cap zoomabhängig.
  const renderableMarkers = useMemo(() => {
    const trailById = new Map<string, AircraftTrail>();
    if (trails) for (const t of trails) trailById.set(t.id, t);
    return markers.slice(0, markerCap).map((m) => {
      const isWarning = !!(m.isAlert || m.isApproaching);
      const iconColor = m.isAlert ? "#FF3B30" : m.isApproaching ? "#FF9500" : m.pinColor;
      const staleOpacity = m.isStale ? 0.7 : 1;
      const altShort = m.altitude ? m.altitude.replace(/ m AGL$/, "m") : "";
      let heading = m.heading ?? 0;
      if (m.heading == null || m.heading === 0) {
        const trail = trailById.get(m.id);
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
      return {
        id: m.id,
        lat: m.latitude,
        lon: m.longitude,
        c: (m.category || "unknown") as string,
        col: iconColor,
        h: snapHeading(heading),
        a: altShort,
        w: isWarning,
        al: !!m.isAlert,
        o: staleOpacity,
      };
    });
  }, [markers, trails, markerCap]);

  // Trail-Daten (kompaktes JSON), mit stabiler Signatur-Cache.
  const trailCacheRef = useRef<Map<string, { sig: string; data: { id: string; col: string; w: number; pts: [number, number][] } }>>(new Map());
  const renderableTrails = useMemo(() => {
    if (!trails || trails.length === 0) {
      if (trailCacheRef.current.size > 0) trailCacheRef.current.clear();
      return [] as { id: string; col: string; w: number; pts: [number, number][] }[];
    }
    const result: { id: string; col: string; w: number; pts: [number, number][] }[] = [];
    const seenIds = new Set<string>();
    const cappedTrails = trails.slice(0, trailCap);
    for (const trail of cappedTrails) {
      if (!trail.points || trail.points.length < 2) continue;
      seenIds.add(trail.id);
      const pts = trail.points.length > 30
        ? trail.points.filter((_: any, i: number) => i % 2 === 0 || i === trail.points.length - 1)
        : trail.points;
      const last = pts[pts.length - 1];
      const first = pts[0];
      const lenBucket = Math.floor(pts.length / 3);
      const sig = `${lenBucket}|${trail.color}|${trail.isAlert ? 1 : 0}|${first.latitude.toFixed(4)},${first.longitude.toFixed(4)}|${last.latitude.toFixed(4)},${last.longitude.toFixed(4)}`;
      const cached = trailCacheRef.current.get(trail.id);
      if (cached && cached.sig === sig) {
        result.push(cached.data);
        continue;
      }
      const data = {
        id: trail.id,
        col: trail.color,
        w: trail.isAlert ? 4 : 3,
        pts: pts.map((p) => [p.latitude, p.longitude] as [number, number]),
      };
      trailCacheRef.current.set(trail.id, { sig, data });
      result.push(data);
    }
    if (trailCacheRef.current.size > seenIds.size) {
      for (const id of trailCacheRef.current.keys()) {
        if (!seenIds.has(id)) trailCacheRef.current.delete(id);
      }
    }
    return result;
  }, [trails, trailCap]);

  // Sichtfeld-Kegel (Geräte-Heading) → [lat,lon]-Koordinaten.
  const fovCoords = useMemo<[number, number][] | null>(() => {
    if (deviceHeading == null) return null;
    const fovHalf = 30;
    const taRadDeg = (taRadiusM ?? 0) > 0 ? ((taRadiusM ?? 0) / 111320) * 0.75 : latDelta * 0.08;
    const fovLen = Math.min(taRadDeg, latDelta * 0.08);
    const a1 = ((deviceHeading - fovHalf) * Math.PI) / 180;
    const a2 = ((deviceHeading + fovHalf) * Math.PI) / 180;
    const cosLat = Math.cos((latitude * Math.PI) / 180);
    const steps = 12;
    const coords: [number, number][] = [[latitude, longitude]];
    for (let i = 0; i <= steps; i++) {
      const a = a1 + (a2 - a1) * (i / steps);
      coords.push([latitude + fovLen * Math.cos(a), longitude + (fovLen * Math.sin(a)) / cosLat]);
    }
    coords.push([latitude, longitude]);
    return coords;
  }, [deviceHeading, taRadiusM, latDelta, latitude, longitude]);

  // Markierte Zonen → gruppierte, vereinfachte Polygone ([Außenring, …Löcher]).
  // Starke Markierung nur INNERHALB des Prüfkreises (große Zonen wie ein
  // Autobahn-Korridor sollen nicht über die ganze Karte rot sein); außerhalb
  // bleibt die normale Zonendarstellung (Vektor-/Kachel-Ebene darunter).
  const hzClipRadiusM = highlightClipRadiusM ?? ((taRadiusM ?? 0) > 0 ? taRadiusM! : (alarmRadiusM ?? 0));
  const hzPolys = useMemo<[number, number][][][]>(() => {
    const out: [number, number][][][] = [];
    const clipCenter: [number, number] = [latitude, longitude];
    for (const z of (highlightedZones ?? [])) {
      const groups = ringGroupsForZone(z);
      if (groups.length === 0) continue;
      const totalPts = groups.reduce(
        (s, g) => s + g.reduce((a, r) => a + r.length, 0),
        0,
      );
      if (totalPts > 4000) continue;
      for (const group of groups) {
        let poly = smoothRingGroup(simplifyRingGroup(group));
        if (hzClipRadiusM > 0 && Number.isFinite(latitude) && Number.isFinite(longitude)) {
          poly = clipRingGroupToCircle(poly, clipCenter, hzClipRadiusM);
        }
        if (poly.length > 0) out.push(poly);
      }
    }
    return out;
  }, [highlightedZones, hzClipRadiusM, latitude, longitude]);

  // Geländeschätzung um das (gesetzte) Kartenzentrum laden, sobald MSL-
  // Vektorzonen sichtbar sind. Nur dann nötig — sonst keine Netzlast. Radius =
  // halbe sichtbare Ausdehnung (1–10 km): größer ist für den Filter immer
  // konservativer (höheres Maximum, tieferes Minimum). Ein Aufruf mit 17
  // Stützpunkten, gecacht (client/lib/elevation.ts fetchTerrainEstimate).
  const needsTerrain = useMemo(
    () => !showAllGeozones && vectorZones.some((z) => z.lowerReference === "MSL" || z.upper?.ref === "MSL"),
    [showAllGeozones, vectorZones],
  );
  const terrainRadiusM = Math.min(
    10000,
    Math.max(1000, ((settledRegion.latitudeDelta + settledRegion.longitudeDelta) / 2) * 111320 * 0.5),
  );
  useEffect(() => {
    if (!needsTerrain) return;
    let cancelled = false;
    const lat = settledRegion.latitude;
    const lon = settledRegion.longitude;
    fetchTerrainEstimate(lat, lon, terrainRadiusM)
      .then((est) => { if (!cancelled && est) setTerrainEstimate({ lat, lon, radiusM: terrainRadiusM, est }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [needsTerrain, settledRegion.latitude, settledRegion.longitude, terrainRadiusM]);
  // Schätzung nur verwenden, solange das Zentrum nahe am Messort liegt (≤ ¼
  // Radius) – sonst könnte ein altes Tal-Maximum im Gebirge Zonen ausblenden.
  // Bis zur neuen Messung bleiben MSL-Zonen dann sichtbar.
  const activeTerrain = useMemo(() => {
    const t = terrainEstimate;
    if (!t) return null;
    const dLatM = (settledRegion.latitude - t.lat) * 111320;
    const dLonM = (settledRegion.longitude - t.lon) * 111320 * Math.cos((t.lat * Math.PI) / 180);
    return Math.hypot(dLatM, dLonM) <= t.radiusM * 0.25 ? t.est : null;
  }, [terrainEstimate, settledRegion.latitude, settledRegion.longitude]);

  // Höhen-Filter: Vektorzonen ausblenden, deren Untergrenze (in AGL) über der
  // erreichbaren/geplanten Flughöhe liegt. Der Sicherheits-Schalter
  // (showAllGeozones) hebt die Filterung auf.
  const filteredVectorZones = useMemo(() => {
    if (showAllGeozones) return vectorZones;
    return partitionByReachability(vectorZones, {
      reachableAltitudeM: maxReachableAltitudeM,
      terrain: activeTerrain,
    }).visible;
  }, [vectorZones, showAllGeozones, maxReachableAltitudeM, activeTerrain]);

  // ED-269-Vektorzonen → kompaktes WebView-Format. r ist eine Liste von Polygonen,
  // jedes Polygon ist [Außenring, …Löcher], damit Leaflet Löcher aussticht.
  const vzPolys = useMemo(() => {
    // Radar/Live-Karte: Zeitbezug ist JETZT (zoneActivityAt, eine Prüfung für
    // Ausblenden und Abschwächen).
    const nowDate = new Date();
    const energyZones = countryIso === "DE" ? [
      ...windFacilitiesAsGeozones(
        windRestrictionPoints.length ? windRestrictionPoints : getGermanWindFacility100mPoints("DE", energyInfrastructure),
        energyInfrastructure,
      ),
      ...supplementalLinesAsGeozones(energyInfrastructure.filter((item) => item.officialMatch === "not_found")),
      ...additionalGeozones,
    ] : [...supplementalInfrastructureAsGeozones(countryIso, energyInfrastructure), ...additionalGeozones];
    const uniqueEnergyZones = [...new Map(energyZones.map((zone) => [zone.featureId, zone])).values()];
    // Gleiche Geometrie mehrerer temporärer Zonen (z. B. ES-NOTAM, mehrere
    // Zeiträume) nicht übereinander stapeln: nur die aktiven zeichnen.
    return collapseStackedTempZonesForMap([...filteredVectorZones, ...uniqueEnergyZones.filter((z) =>
      !lockedSet.has(z.country ?? "DE") && splitCountriesByAccess([z.country ?? "DE"], entitlement).locked.length === 0)],
      isTempVectorZone, (z) => zoneActivityAt(z, nowDate) !== "inactive")
      // Temporäre Zonen (mit Gültigkeitsfenster), die JETZT nicht aktiv sind,
      // werden auf dem Radar gar nicht gezeichnet. Permanente Zonen (ohne
      // Gültigkeitsfenster) bleiben immer sichtbar (zeitweise inaktive
      // abgeschwächt, siehe `ia`). Die NOTAM-Liste führt zukünftige Zonen
      // weiterhin (anderer Pfad). `unknown` zählt als aktiv.
      .map((z) => ({ z, activity: zoneActivityAt(z, nowDate) }))
      .filter(({ z, activity }) => !isTempVectorZone(z) || activity !== "inactive")
      .map(({ z, activity }) => {
        const polys: [number, number][][][] = [];
        for (const group of ringGroupsForZone(z)) {
          const poly = smoothRingGroup(simplifyRingGroup(group));
          if (poly.length > 0) polys.push(poly);
        }
        const details = (z.details || "")
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .slice(0, 6);
        const isTemp = isTempVectorZone(z);
        // Dauerhafte Zonen eines Raster-Kachel-Landes (z. B. Belgien) werden vom
        // Server als WMS-artige PNG-Kachel gezeichnet. Sie bleiben hier nur als
        // unsichtbares Polygon für die Tap-Abfrage (vzHitsAt) erhalten — `hide`
        // unterdrückt das doppelte Zeichnen. Temporäre Zonen sind NICHT in den
        // (24 h gecachten) Kacheln und werden weiterhin gezeichnet (Farbe nach
        // Einstufung, gestrichelter Rand als Temporär-Markierung).
        // Die deutschen 100-m-Windkraft-Pufferzonen (energy-zone:*) werden IMMER
        // gezeichnet: Früher wurden sie ab Zoom 12 zugunsten serverseitiger
        // Anlagen-Kacheln ausgeblendet — die gibt es in der RC-Version nicht mehr.
        const hide = isVectorZoneDrawSuppressed(z, isTemp);
        return {
          r: polys,
          p: infrastructureMapGeometry(z.infrastructureGeometry).points,
          l: infrastructureMapGeometry(z.infrastructureGeometry).lines,
          // Farbe immer nach Einstufung (Policy-Tabelle) – auch temporäre Zonen.
          // Temporär wird über das Strichmuster (tp) markiert, nicht mehr über
          // ein pauschales Orange.
          f: zoneMapColors(z).fill,
          s: zoneMapColors(z).stroke,
          tp: isTemp,
          hide,
          t: z.name,
          d: details,
          ap: z.applicationText,
          lk: z.links,
          // Gültigkeitszeitraum für das Tap-Popup temporärer Zonen.
          vr: isTemp ? formatValidityRange(z.validStartTs, z.validEndTs) : null,
          // Wiederkehrende Aktivzeiten (ED-269-Schedule) und ob die Zone gerade
          // inaktiv ist (abgeschwächte Darstellung, Hinweis im Popup).
          sc: z.scheduleText?.length ? z.scheduleText.join("; ") : null,
          ia: activity === "inactive",
        };
       }).filter((z) => z.r.length > 0 || z.p.length > 0 || z.l.length > 0);
   }, [filteredVectorZones, additionalGeozones, lockedSet, entitlement, countryIso, energyTilesEnabled, settledZoom, windRestrictionPoints, energyInfrastructure]);

  // Vorläufige CTR-Innen-/Außenbereich-Höhenbänder um nahe Flughafen-Referenzen
  // (geteilte, RN-freie Logik getCtrBandRings). Gekoppelt an den Kontrollzonen-
  // Layer (kontrollzonen): nur sichtbar, wenn der Nutzer ihn aktiviert hat und
  // hinreichend hineingezoomt ist. Während eines aktiven Flugs/Trackings hilft
  // die Einordnung Innen-/Außenbereich besonders. Zentrum ist der Radar-Standort.
  const ctrBands = useMemo(() => {
    const ctrEnabled = !!geozoneLayers && geozoneLayers.includes("kontrollzonen");
    if (!ctrEnabled || settledZoom < 8) {
      return [] as { icao: string; name: string; lat: number; lon: number; provisional: boolean; rings: { radiusM: number; strokeColor: string; fillColor: string; fillOpacity: number; strokeOpacity: number; label: string }[] }[];
    }
    return findNearbyCtrAirports(latitude, longitude, 30)
      .filter((a) => !!a.avInfo)
      .slice(0, 4)
      .map((a) => {
        const rings = getCtrBandRings(a.avInfo!.heightSteps).map((r) => ({
          radiusM: r.radiusM,
          strokeColor: r.strokeColor,
          fillColor: r.fillColor,
          fillOpacity: r.fillOpacity,
          strokeOpacity: r.strokeOpacity,
          label: r.label,
        }));
        return { icao: a.icao, name: a.name, lat: a.lat, lon: a.lon, provisional: a.avInfo!.geometryPerAip, rings };
      });
  }, [geozoneLayers, settledZoom, latitude, longitude]);

  // CTR-Legende nur, wenn die Position wirklich innerhalb eines CTR-Bands liegt.
  const ctrLegendRelevant = useMemo(() => ctrBands.some((a) => {
    const outer = a.rings.reduce((m, r) => Math.max(m, r.radiusM), 0);
    const dLat = ((a.lat - latitude) * Math.PI) / 180;
    const dLon = ((a.lon - longitude) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((latitude * Math.PI) / 180) * Math.cos((a.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h))) <= outer;
  }), [ctrBands, latitude, longitude]);

  // Flughafen-Wetter-Marker (METAR/TAF), zwei Stufen:
  //  - Tier 1 (immer): große europäische Flughäfen (MAJOR_EU_AIRPORTS) im
  //    sichtbaren Ausschnitt – auch bei niedrigem Zoom.
  //  - Tier 2 (ab Zoom 9): alle aktuell meldenden METAR-Stationen im Ausschnitt,
  //    live per AWC-Bbox geladen ("kleine Flughäfen beim Reinzoomen").
  const AREA_ZOOM_MIN = 9;
  const AIRPORT_MARKER_MIN_ZOOM = AREA_ZOOM_MIN;

  // Sichtbarer Ausschnitt (settled) als Bbox; etwas gepolstert für Stabilität.
  const viewBbox = useMemo(() => {
    const padLat = settledRegion.latitudeDelta * 0.6;
    const padLon = settledRegion.longitudeDelta * 0.6;
    return {
      minLat: settledRegion.latitude - padLat,
      maxLat: settledRegion.latitude + padLat,
      minLon: settledRegion.longitude - padLon,
      maxLon: settledRegion.longitude + padLon,
    };
  }, [settledRegion.latitude, settledRegion.longitude, settledRegion.latitudeDelta, settledRegion.longitudeDelta]);

  // Tier 2: meldende Stationen im Ausschnitt nachladen (nur ab Zoom-Schwelle).
  useEffect(() => {
    if (settledZoom < AREA_ZOOM_MIN) {
      setAreaStations([]);
      return;
    }
    let cancelled = false;
    fetchAirportStationsInArea([viewBbox.minLat, viewBbox.minLon, viewBbox.maxLat, viewBbox.maxLon])
      .then((s) => {
        if (!cancelled) setAreaStations(s);
      })
      .catch(() => {
        if (!cancelled) setAreaStations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [settledZoom, viewBbox.minLat, viewBbox.minLon, viewBbox.maxLat, viewBbox.maxLon]);

  const airportMarkers = useMemo(() => {
    // Unterhalb der Zonen-Zoomschwelle keine Flugwetter-„i“-Symbole: in der
    // Übersicht bedeckten Dutzende Marker die Karte (Gerät, 11/2026).
    if (settledZoom < AIRPORT_MARKER_MIN_ZOOM) return [];
    const inView = (lat: number, lon: number) =>
      lat >= viewBbox.minLat && lat <= viewBbox.maxLat && lon >= viewBbox.minLon && lon <= viewBbox.maxLon;
    const byIcao = new Map<string, { icao: string; lat: number; lon: number }>();
    // Tier 1: große Flughäfen immer.
    for (const a of MAJOR_EU_AIRPORTS) {
      if (inView(a.lat, a.lon)) byIcao.set(a.icao, { icao: a.icao, lat: a.lat, lon: a.lon });
    }
    // Tier 2: live geladene Stationen (Dedup gegen Tier 1, auf Ausschnitt filtern –
    // der Server liefert eine Obermenge des Bbox-Buckets).
    if (settledZoom >= AREA_ZOOM_MIN) {
      for (const s of areaStations) {
        if (!inView(s.lat, s.lon)) continue;
        if (!byIcao.has(s.icao)) byIcao.set(s.icao, { icao: s.icao, lat: s.lat, lon: s.lon });
      }
    }
    return Array.from(byIcao.values());
  }, [settledZoom, areaStations, viewBbox.minLat, viewBbox.minLon, viewBbox.maxLat, viewBbox.maxLon]);

  // Vollständiger Zustand, der in den WebView geschoben wird.
  const stateJson = useMemo(() => {
    const geo = geozonesVisible ? geozoneTileUrls.map(({ iso, url }) => ({
      u: url,
      p: mapStyle === "satellite"
        ? (iso === countryIso ? 0.85 : 0.65)
        : iso === countryIso
          ? (mapStyle === "osm" || mapStyle === "grayscale" ? (isDark ? 0.55 : 0.85) : 0.65)
          : (mapStyle === "osm" || mapStyle === "grayscale" ? (isDark ? 0.4 : 0.55) : 0.45),
      mnz: getCountryGeozoneConfig(iso).wmsMaxNativeZoom,
      a: getGeozoneTileAttribution(iso),
      primary: iso === countryIso,
    })) : [];
    const state = {
      fit,
      center: [latitude, longitude] as [number, number],
      zoom: targetZoom,
      base: mapStyle,
      // dunkle Grundkarte nach Sonnenuntergang am Kartenort (Satellit bleibt)
      dark: isNight,
      lockPan,
      geo,
      user: hideUserPosition ? null : ([latitude, longitude] as [number, number]),
      markers: renderableMarkers,
      trails: renderableTrails,
      circles: hideUserPosition ? {} : {
        scan: (scanRadiusM ?? 0) > 0 ? scanRadiusM : 0,
        ta: (taRadiusM ?? 0) > 0 ? taRadiusM : 0,
        ra: (alarmRadiusM ?? 0) > 0 ? alarmRadiusM : 0,
        vlos: (vlosRadiusM ?? 0) > 0 ? vlosRadiusM : 0,
      },
      fov: hideUserPosition ? null : fovCoords,
      hz: hzPolys,
      // vz (Vektorzonen) wird NICHT hier mitgeschickt, sondern getrennt per
      // window.__setVz – sonst würde jedes Flugzeug-/Positions-Update alle
      // Zonen-Polygone (MB) neu serialisieren (Reaktionsfähigkeit, 2026-11).
      ctr: ctrBands,
      air: airportMarkers,
      energy: [],
      windBuffers: [],
    };
    return JSON.stringify(state);
  }, [fit, hideUserPosition, latitude, longitude, targetZoom, mapStyle, isDark, isNight, lockPan, geozonesVisible, geozoneTileUrls, countryIso, renderableMarkers, renderableTrails, scanRadiusM, taRadiusM, alarmRadiusM, vlosRadiusM, fovCoords, hzPolys, ctrBands, airportMarkers, energyInfrastructure, windRestrictionPoints, energyTilesEnabled, energyTilesShowSupplemental]);

  useEffect(() => {
    if (!ready) return;
    runJs(`window.__apply(${stateJson})`);
  }, [stateJson, ready, runJs]);

  // Vektorzonen nur bei Inhaltsänderung serialisieren und senden (vzPolys:
  // gleiche Referenz bis sich Zonen/Filter ändern). Nach __apply, damit die
  // Karte steht; vzPolys ist bereits auf die sichtbaren Länder gefiltert.
  const vzJson = useMemo(() => JSON.stringify(vzPolys), [vzPolys]);
  useEffect(() => {
    if (!ready) return;
    runJs(`window.__setVz(${vzJson})`);
  }, [vzJson, ready, runJs]);

  const handleMapPress = useCallback((tapLat: number, tapLon: number) => {
    setSelectedAircraftId(null);
    setSelectedCtrIcao(null);
    setSelectedAirportIcao(null);
    // Tipp in ein Land mit deaktivierten Geozonen → kleines Popup an der Stelle
    const offIso = disabledCountryAt(tapLat, tapLon);
    setDisabledTap(offIso ? { iso: offIso, ...tapToScreen(tapLat, tapLon, currentRegion, mapSize) } : null);
    if (geozoneQueryDisabled) { runJs("window.__popupClose()"); return; }
    if (!geozoneLayers || geozoneLayers.length === 0) { runJs("window.__popupClose()"); return; }
    const approxZoom = Math.log2(360 / Math.max(currentRegion.latitudeDelta, 0.0001));
    if (approxZoom < 11) { runJs("window.__popupClose()"); return; }
    if (typeof tapLat !== "number" || typeof tapLon !== "number" || !isFinite(tapLat) || !isFinite(tapLon)) return;
    runJs(`window.__popupLoading(${JSON.stringify({ lat: tapLat, lon: tapLon })})`);
    queryGeozoneFeatureInfo(
      geozoneLayers,
      tapLat, tapLon,
      mapSize.width, mapSize.height,
      currentRegion.latitudeDelta, currentRegion.longitudeDelta,
      countryIso,
    ).then((results) => {
      if (results && results.length > 0) {
        // Gleiche Kategorisierung wie das seitliche Panel: befristete Sperrungen
        // (NOTAM-Gebiete / ED-R / LU-Temp) werden als "NOTAM-Gebiet / Sperrung"
        // beschriftet, nicht als "Geozone" — sonst widerspricht das Popup dem
        // Panel (das diese Objekte im NOTAM-Tab führt).
        const { geozones: permPop, tempRestrictions: tempPop } = separateTempRestrictions(results);
        const items = [
          ...permPop.map((z) => ({ ...z, cat: "geozone" as const })),
          ...tempPop.map((z) => ({ ...z, cat: "notam" as const })),
        ];
        runJs(`window.__popup(${JSON.stringify({ lat: tapLat, lon: tapLon, items })})`);
      } else {
        runJs("window.__popupClose()");
      }
    }).catch(() => {
      runJs("window.__popupClose()");
    });
  }, [geozoneQueryDisabled, geozoneLayers, currentRegion, mapSize, countryIso, runJs]);

  const onMessage = useCallback((e: any) => {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "ready") { setReady(true); return; }
    if (msg.type === "region") {
      const r: Region = { latitude: msg.lat, longitude: msg.lon, latitudeDelta: msg.latDelta, longitudeDelta: msg.lonDelta };
      if (!isFinite(r.latitude) || !isFinite(r.longitude) || !(r.latitudeDelta > 0) || !(r.longitudeDelta > 0)) return;
      setCurrentRegion(r);
      setSettledRegion(r);
      setDisabledTap(null); // Popup schließt beim Verschieben/Zoomen
      if (onViewportChange) {
        const hl = r.latitudeDelta / 2;
        const ho = r.longitudeDelta / 2;
        onViewportChange({ latMin: r.latitude - hl, latMax: r.latitude + hl, lonMin: r.longitude - ho, lonMax: r.longitude + ho });
      }
      return;
    }
    if (msg.type === "markerPress") { if (msg.id) onMarkerPress(msg.id); return; }
    if (msg.type === "ctrPress") { if (msg.icao) onCtrPress(msg.icao); return; }
    if (msg.type === "airportPress") { if (msg.icao) onAirportPress(msg.icao); return; }
    if (msg.type === "longPress") {
      if (onLongPress && isFinite(msg.lat) && isFinite(msg.lon)) onLongPress(msg.lat, msg.lon);
      return;
    }
    if (msg.type === "mapPress") { handleMapPress(msg.lat, msg.lon); return; }
  }, [onViewportChange, onMarkerPress, onCtrPress, onAirportPress, onLongPress, handleMapPress]);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    // Kompass-Sensor liefert Updates mit Sensorrate. Nur weitergeben, wenn sich
    // die Richtung um >= 3° geändert hat UND seit dem letzten Update >= 200 ms
    // vergangen sind (max. ~5x/s) — sonst rendern große Screens dauerhaft neu.
    let lastHeading: number | null = null;
    let lastEmit = 0;
    (async () => {
      try {
        const s = await Location.watchHeadingAsync((heading) => {
          if (cancelled) return;
          const h = heading.trueHeading >= 0 ? heading.trueHeading : heading.magHeading;
          if (!isFinite(h)) return;
          const now = Date.now();
          if (lastHeading !== null) {
            const diff = Math.abs(((h - lastHeading + 540) % 360) - 180);
            if (diff < 3 || now - lastEmit < 200) return;
          }
          lastHeading = h;
          lastEmit = now;
          setDeviceHeading(h);
          onHeadingChange?.(h);
        });
        if (cancelled) { s.remove(); return; }
        sub = s;
      } catch {}
    })();
    return () => { cancelled = true; if (sub) { sub.remove(); sub = null; } };
  }, [onHeadingChange]);

  return (
    <View style={fullScreen ? styles.mapViewFull : styles.mapView} onLayout={onMapLayout}>
      <WebView
        ref={webRef}
        source={{ html: MAIN_MAP_HTML, baseUrl: "file:///" }}
        originWhitelist={["*"]}
        {...RC_WEBVIEW_FILE_PROPS}
        style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "#1A1F2E" : "#E8ECF2" }]}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={(req) => {
          // Geozonen-Popups enthalten anklickbare Antrags-/Info-Links und
          // Kontakt-E-Mails. Diese extern öffnen (Browser bzw. Mail-App) statt im
          // Karten-WebView zu navigieren; das initiale HTML lädt ohne http-Schema.
          const u = req?.url || "";
          if (/^(https?|mailto|tel):/i.test(u)) {
            if (/^https?:/i.test(u)) {
              WebBrowser.openBrowserAsync(u).catch(() => {});
            } else {
              openLink(u).catch(() => {});
            }
            return false;
          }
          return true;
        }}
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
      {selectedAircraftId != null ? (() => {
        const sel = markers.find((m) => m.id === selectedAircraftId);
        if (!sel) return null;
        const isWarning = sel.isAlert || sel.isApproaching;
        const borderColor = sel.isAlert ? "#FF3B30" : sel.isApproaching ? "#FF9500" : "transparent";
        const bgColor = sel.isAlert ? "rgba(255,59,48,0.92)" : sel.isApproaching ? "rgba(255,149,0,0.92)" : "rgba(0,0,0,0.88)";
        const isOgnOnly = sel.sources != null && sel.sources.length === 1 && sel.sources[0] === "ogn";
        const categoryLabel = sel.category ? getCategoryLabel(sel.category) : null;
        return (
          <View style={[styles.infoBubbleOverlay, infoBubbleBottomInset > 0 ? { paddingBottom: 16 + infoBubbleBottomInset } : null]} pointerEvents="box-none">
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
              {(() => {
                const subParts: string[] = [];
                if (sel.registration && sel.registration !== sel.title) subParts.push(sel.registration);
                if (sel.aircraftDesc) subParts.push(sel.aircraftDesc);
                else if (sel.aircraftType) subParts.push(sel.aircraftType);
                else if (categoryLabel) subParts.push(categoryLabel);
                return subParts.length > 0 ? (
                  <Text style={[styles.infoBubbleDetail, { fontSize: 10, opacity: 0.85, marginBottom: 2 }]} numberOfLines={2}>
                    {subParts.join(" · ")}
                  </Text>
                ) : null;
              })()}
              {(sel.originIata || sel.destIata || sel.flightNumber) ? (
                <Text style={[styles.infoBubbleDetail, { fontSize: 10, opacity: 0.85, marginBottom: 2 }]} numberOfLines={1}>
                  {[sel.originIata, sel.destIata].filter((x) => x).join(" → ")}
                  {sel.flightNumber ? `   ${sel.flightNumber}` : ""}
                </Text>
              ) : null}
              {(sel.operator || sel.agencyTag) ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  {sel.agencyTag ? (
                    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: agencyTagColor(sel.agencyTag) }}>
                      <Text style={{ color: "#FFFFFF", fontSize: 9, fontWeight: "700" }}>{sel.agencyTag}</Text>
                    </View>
                  ) : null}
                  {sel.operator ? (
                    <Text style={[styles.infoBubbleDetail, { fontSize: 10, opacity: 0.75 }]} numberOfLines={1}>
                      {sel.operator}
                    </Text>
                  ) : null}
                </View>
              ) : null}
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
                {(() => {
                  const rawReg = (sel.registration || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
                  const rawCs = (sel.title || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9-]/g, "");
                  const lookupKey = rawReg.length >= 4 ? rawReg : rawCs;
                  if (!lookupKey) return null;
                  return (
                    <Pressable
                      style={styles.infoBubbleLink}
                      onPress={() => {
                        setFlightCallsign(lookupKey);
                        setFlightUrl(`https://de.flightaware.com/live/flight/${encodeURIComponent(lookupKey)}`);
                        setSelectedAircraftId(null);
                      }}
                    >
                      <Feather name="external-link" size={11} color="#4A90D9" />
                      <Text style={styles.infoBubbleLinkText}>FlightAware</Text>
                    </Pressable>
                  );
                })()}
              </View>
            </View>
          </View>
        );
      })() : null}
      {selectedCtr ? (
        <CtrInfoCard ctr={selectedCtr} onClose={() => setSelectedCtrIcao(null)} bottomInset={infoBubbleBottomInset} />
      ) : null}
      {selectedAirport ? (
        <AirportWeatherSheet
          icao={selectedAirport.icao}
          name={selectedAirport.name}
          initialMetarRaw={selectedAirport.raw}
          initialObservedAt={selectedAirport.observedAt}
          onClose={() => setSelectedAirportIcao(null)}
          bottomInset={infoBubbleBottomInset}
        />
      ) : null}
      {wind ? (
        <WindCompass wind={wind} deviceHeading={deviceHeading} topInset={topInset} weatherAlerts={weatherAlerts} />
      ) : null}
      {/* Bedien-Knöpfe (Standort, Einstellungen, VLOS/Drohne) IMMER sichtbar –
          unabhängig von Windrose/Wetter und davon, ob GPS-Koordinaten vorliegen.
          Unten links in der Ecke: VLOS-Knopf unten, die beiden Kreise darüber
          gleichmäßig auf die Breite des VLOS-Elements verteilt. */}
      {(onCenterGps || onSettingsPress || dronePill) ? (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", left: 10, bottom: (bottomPadding || 0) + 16, zIndex: 60, alignItems: "stretch", gap: 6 }}
        >
          {(onCenterGps || onSettingsPress) ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              {onCenterGps ? (
                <Pressable
                  onPress={onCenterGps}
                  testID="radar-center-gps"
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
                  testID="radar-map-settings"
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
          {dronePill ? (
            <Pressable
              testID="radar-drone-pill"
              onPress={dronePill.onPress}
              accessibilityRole="button"
              accessibilityLabel={`Drohne wählen, ${dronePill.label}`}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
                height: 36, paddingLeft: 4, paddingRight: 10, borderRadius: 18,
                borderWidth: 2, borderColor: "#0A84FF",
                backgroundColor: isDark ? "rgba(30,40,60,0.88)" : "rgba(255,255,255,0.92)",
                ...(Platform.OS === "ios" ? { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 } : { elevation: 4 }),
              }}
            >
              <DroneImage manufacturer={dronePill.manufacturer} model={dronePill.model} size={34} iconColor="#0A84FF" iconSize={22} />
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#0A84FF" }} numberOfLines={1}>{dronePill.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {ctrLegendRelevant ? (
        <View style={[ctrLegendStyles.container, { top: topInset + 16 }]} pointerEvents="box-none">
          <Pressable
            style={ctrLegendStyles.header}
            onPress={() => setCtrLegendOpen((v) => !v)}
            testID="button-ctr-legend-toggle"
          >
            <Feather
              name={ctrLegendOpen ? "chevron-down" : "chevron-up"}
              size={14}
              color="#FFFFFF"
            />
            <Text style={ctrLegendStyles.title}>{"CTR-H\u00f6henb\u00e4nder"}</Text>
          </Pressable>
          {ctrLegendOpen ? (
            <View style={ctrLegendStyles.body}>
              {ctrLegendEntries.map((entry) => (
                <View key={entry.label} style={ctrLegendStyles.row}>
                  <View
                    style={[
                      ctrLegendStyles.swatch,
                      {
                        borderColor: entry.strokeColor,
                        backgroundColor: hexToRgba(
                          entry.fillColor,
                          Math.max(entry.fillOpacity, 0.5),
                        ),
                      },
                    ]}
                  />
                  <Text style={ctrLegendStyles.label}>{entry.label}</Text>
                </View>
              ))}
              <Text style={ctrLegendStyles.note}>{getCtrProvisionalNote()}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {vectorZonesHiddenHint ? (
        <View
          style={[vectorHintStyles.container, { top: topInset + 16 }]}
          pointerEvents="none"
          testID="hint-zoom-geozones"
        >
          <Feather name="zoom-in" size={13} color="#FFFFFF" />
          <Text style={vectorHintStyles.text}>
            {"Hineinzoomen, um Geozonen anzuzeigen"}
          </Text>
        </View>
      ) : null}
      {vectorZonesTruncated && !vectorZonesHiddenHint ? (
        <View
          style={[vectorHintStyles.container, { top: topInset + 16 }]}
          pointerEvents="none"
          testID="hint-geozones-truncated"
        >
          <Feather name="zoom-in" size={13} color="#FFFFFF" />
          <Text style={vectorHintStyles.text}>{geozoneTruncationHint(GEOZONE_VECTOR_MAX_FEATURES)}</Text>
        </View>
      ) : null}
      {lockedNames.length > 0 ? (
        <View
          style={[lockedHintStyles.container, { top: topInset + (vectorZonesHiddenHint || vectorZonesTruncated ? 56 : 16) }]}
          pointerEvents="none"
          testID="hint-locked-countries"
        >
          <Feather name="lock" size={13} color="#FFFFFF" />
          <Text style={lockedHintStyles.text}>
            {lockedNames.length === 1
              ? `${lockedNames[0]}: Land freischalten`
              : `Land freischalten: ${lockedNames.join(", ")}`}
          </Text>
        </View>
      ) : null}
      {/* Deaktivierte Länder: kein Dauer-Banner mehr, nur Popup nach Tipp ins Land */}
      <DisabledCountryPopup tap={disabledTap} mapSize={mapSize} onClose={() => setDisabledTap(null)} />
      {onMapStyleChange ? (
        <View style={mapSwitchStyles.container}>
          {([
            { id: "standard" as const, label: "Standard" },
            { id: "satellite" as const, label: "Satellit" },
            { id: "osm" as const, label: "OSM" },
            { id: "grayscale" as const, label: "Graustufen" },
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
        <View style={[faStyles.container, { paddingBottom: safeInsets.bottom }]}>
          <View style={[faStyles.header, { paddingTop: 8 + overlayTopInset }]}>
            <Pressable
              onPress={() => setFlightUrl(null)}
              hitSlop={12}
              style={[faStyles.closeBtn, { top: 8 + overlayTopInset }]}
              accessibilityRole="button"
              accessibilityLabel="Schließen"
              testID="flightaware-close"
            >
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
        </View>
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
    paddingRight: 48,
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

const ctrLegendStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 16,
    right: 10,
    maxWidth: 220,
    backgroundColor: "rgba(20, 30, 48, 0.85)",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.25)",
    overflow: "hidden",
    zIndex: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  body: {
    paddingHorizontal: 10,
    paddingBottom: 9,
    gap: 5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1.5,
  },
  label: {
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 11,
    flexShrink: 1,
  },
  note: {
    color: "rgba(255, 255, 255, 0.65)",
    fontSize: 10,
    fontStyle: "italic",
    marginTop: 3,
  },
});

const vectorHintStyles = StyleSheet.create({
  container: {
    position: "absolute",
    alignSelf: "center",
    maxWidth: "80%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(20, 30, 48, 0.85)",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.25)",
    zIndex: 16,
  },
  text: {
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
});

const lockedHintStyles = StyleSheet.create({
  container: {
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
  text: {
    color: "rgba(255, 255, 255, 0.95)",
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
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
