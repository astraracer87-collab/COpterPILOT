/**
 * Kartenschicht auf Basis von MapLibre – ersetzt react-native-maps.
 *
 * react-native-maps nutzt auf Android Google Maps und braucht dafür die Google
 * Play Services. Die fehlen auf DJI-Fernsteuerungen (RC Pro 2 u. a.), die Karte
 * bliebe dort leer. Diese Datei bildet die von der App genutzten Teile der
 * react-native-maps-API (MapView, Marker, Circle, Polygon, Polyline, WMSTile,
 * UrlTile) mit MapLibre nach, damit die Screens kaum geändert werden müssen.
 */
import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle, type LayoutChangeEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  Map as MLMap,
  Camera as MLCamera,
  GeoJSONSource,
  Layer,
  RasterSource,
  UserLocation,
  ViewAnnotation,
  type CameraRef,
  type MapRef,
  type ViewState,
} from "@maplibre/maplibre-react-native";
import * as Location from "@/lib/location";
import { FALLBACK_MAP, FALLBACK_SATELLITE, GLYPHS_URL, HYBRID_LABELS, type LngLatBox } from "@/lib/mapSources";
import { BASE_ANCHORS, CountryBaseLayers, ObstacleLayer } from "./MapLayers";

// ---------------------------------------------------------------------------
// Typen (kompatibel zu react-native-maps)
// ---------------------------------------------------------------------------

export type LatLng = { latitude: number; longitude: number };
export type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };
export type Camera = { center: LatLng; heading: number; pitch: number; zoom: number; altitude?: number };
export type MapPressEvent = { nativeEvent: { coordinate: LatLng } };
export type LongPressEvent = MapPressEvent;
export type MarkerDragStartEndEvent = MapPressEvent;
export type MapType = "standard" | "satellite" | "hybrid" | "terrain" | "mutedStandard" | "hybridFlyover" | "satelliteFlyover" | "none";

export interface MapViewHandle {
  animateToRegion: (region: Region, duration?: number) => void;
  animateCamera: (camera: Partial<Camera>, opts?: { duration?: number }) => void;
  getCamera: () => Promise<Camera>;
  fitToCoordinates: (coords: LatLng[], opts?: { edgePadding?: { top: number; right: number; bottom: number; left: number }; animated?: boolean }) => void;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const RASTER_ANCHOR = "cp-raster-top";

export function isSatelliteType(mapType: MapType | undefined): boolean {
  return mapType === "satellite" || mapType === "hybrid" || mapType === "hybridFlyover" || mapType === "satelliteFlyover";
}

/**
 * Grundstil: Online-Ersatzkarte (CARTO/Esri) ganz unten, darüber Ankerebenen für
 * die amtlichen Länderkarten (MapLayers.tsx), darüber Kachel-Overlays (Geozonen).
 */
function buildStyle(mapType: MapType | undefined) {
  const satellite = isSatelliteType(mapType);
  const hybrid = mapType === "hybrid" || mapType === "hybridFlyover";
  const base = satellite ? FALLBACK_SATELLITE : FALLBACK_MAP;
  const anchor = (id: string) => ({ id, type: "background", layout: { visibility: "none" }, paint: { "background-opacity": 0 } });
  const sources: Record<string, any> = {
    base: { type: "raster", tiles: [base.tiles], tileSize: 256, maxzoom: base.maxzoom, attribution: base.attribution },
  };
  const layers: any[] = [
    { id: "background", type: "background", paint: { "background-color": satellite ? "#1b2630" : "#e8eef2" } },
    { id: "base", type: "raster", source: "base" },
    ...BASE_ANCHORS.map(anchor),
  ];
  if (hybrid) {
    sources.labels = { type: "raster", tiles: [HYBRID_LABELS], tileSize: 256, maxzoom: 19 };
    layers.push({ id: "labels", type: "raster", source: "labels" });
  }
  // Kachel-Overlays (WMS/URL) werden unter RASTER_ANCHOR eingefügt, Kreise/Polygone/Linien darüber.
  layers.push(anchor(RASTER_ANCHOR));
  return { version: 8 as const, glyphs: GLYPHS_URL, sources, layers };
}

function regionToBounds(r: Region): [number, number, number, number] {
  const dLat = Math.min(Math.max(r.latitudeDelta, 0.0005), 170) / 2;
  const dLon = Math.min(Math.max(r.longitudeDelta, 0.0005), 350) / 2;
  return [r.longitude - dLon, Math.max(r.latitude - dLat, -85), r.longitude + dLon, Math.min(r.latitude + dLat, 85)];
}

function viewStateToRegion(v: Pick<ViewState, "center" | "bounds">): Region {
  const [w, s, e, n] = v.bounds;
  return {
    latitude: v.center[1],
    longitude: v.center[0],
    latitudeDelta: Math.abs(n - s),
    longitudeDelta: Math.abs(e - w),
  };
}

function regionToZoom(r: Region): number {
  const delta = Math.max(r.longitudeDelta, 0.0001);
  return Math.max(0, Math.min(20, Math.log2(360 / delta)));
}

function toLngLat(c: LatLng): [number, number] {
  return [c.longitude, c.latitude];
}

function validCoord(c: LatLng | null | undefined): c is LatLng {
  return !!c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude);
}

/** Kreis als Polygon (64 Punkte) – MapLibre kennt keine Kreise in Metern. */
function circleRing(center: LatLng, radiusM: number, steps = 64): [number, number][] {
  const R = 6371008.8;
  const lat1 = (center.latitude * Math.PI) / 180;
  const lon1 = (center.longitude * Math.PI) / 180;
  const d = radiusM / R;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return ring;
}

function anchorFromXY(a?: { x: number; y: number }): any {
  if (!a) return "bottom";
  const col = a.x < 0.25 ? "left" : a.x > 0.75 ? "right" : "";
  const row = a.y < 0.25 ? "top" : a.y > 0.75 ? "bottom" : "";
  if (!row && !col) return "center";
  if (!row) return col;
  if (!col) return row;
  return `${row}-${col}`;
}

function safeId(raw: string): string {
  return "cp" + raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

const MapContext = createContext<{ zoom: number } | null>(null);

// ---------------------------------------------------------------------------
// MapView
// ---------------------------------------------------------------------------

export interface MapViewProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  initialRegion?: Region;
  region?: Region;
  mapType?: MapType;
  mapPadding?: { top: number; right: number; bottom: number; left: number };
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  showsCompass?: boolean;
  showsScale?: boolean;
  rotateEnabled?: boolean;
  pitchEnabled?: boolean;
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  onPress?: (e: MapPressEvent) => void;
  onLongPress?: (e: LongPressEvent) => void;
  onRegionChange?: (r: Region) => void;
  onRegionChangeComplete?: (r: Region) => void;
  onMapReady?: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  // Von react-native-maps übernommene Props ohne Wirkung
  provider?: any;
  loadingEnabled?: boolean;
  toolbarEnabled?: boolean;
  showsPointsOfInterest?: boolean;
  showsBuildings?: boolean;
  showsTraffic?: boolean;
  showsIndoors?: boolean;
  userInterfaceStyle?: "light" | "dark";
  testID?: string;
}

const DEFAULT_REGION: Region = { latitude: 51.1657, longitude: 10.4515, latitudeDelta: 8, longitudeDelta: 8 };

const MapViewImpl = forwardRef<MapViewHandle, MapViewProps>(function MapView(props, ref) {
  const {
    style,
    children,
    initialRegion,
    region,
    mapType,
    mapPadding,
    showsUserLocation,
    showsMyLocationButton,
    showsCompass,
    showsScale,
    rotateEnabled = true,
    pitchEnabled = false,
    scrollEnabled = true,
    zoomEnabled = true,
    onPress,
    onLongPress,
    onRegionChange,
    onRegionChangeComplete,
    onMapReady,
    onLayout,
  } = props;

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const startRegion = useRef<Region>(region ?? initialRegion ?? DEFAULT_REGION).current;
  const [zoom, setZoom] = useState(() => regionToZoom(startRegion));
  const [view, setView] = useState<LngLatBox | null>(() => regionToBounds(startRegion));
  const mapStyle = useMemo(() => buildStyle(mapType), [mapType]);

  const animateToRegion = useCallback((r: Region, duration = 500) => {
    if (!r || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return;
    try {
      cameraRef.current?.fitBounds(regionToBounds(r), {
        duration: Math.max(0, duration),
        easing: duration > 1 ? "ease" : undefined,
        padding: mapPadding,
      });
    } catch {}
  }, [mapPadding]);

  // Kontrollierte "region"-Prop wie bei react-native-maps
  const lastRegionKey = useRef<string>("");
  React.useEffect(() => {
    if (!region) return;
    const key = `${region.latitude.toFixed(6)},${region.longitude.toFixed(6)},${region.latitudeDelta.toFixed(5)}`;
    if (key === lastRegionKey.current) return;
    lastRegionKey.current = key;
    animateToRegion(region, 0);
  }, [region, animateToRegion]);

  useImperativeHandle(ref, () => ({
    animateToRegion,
    animateCamera: (cam, opts) => {
      const c = cam.center;
      if (!c) return;
      try {
        cameraRef.current?.easeTo({
          center: toLngLat(c),
          zoom: cam.zoom,
          bearing: cam.heading,
          duration: opts?.duration ?? 500,
        });
      } catch {}
    },
    getCamera: async () => {
      const m = mapRef.current;
      if (!m) return { center: { latitude: startRegion.latitude, longitude: startRegion.longitude }, heading: 0, pitch: 0, zoom };
      const [center, z, bearing, pitch] = await Promise.all([m.getCenter(), m.getZoom(), m.getBearing(), m.getPitch()]);
      return { center: { latitude: center[1], longitude: center[0] }, heading: bearing, pitch, zoom: z };
    },
    fitToCoordinates: (coords, opts) => {
      const valid = coords.filter(validCoord);
      if (valid.length === 0) return;
      const lats = valid.map((c) => c.latitude);
      const lons = valid.map((c) => c.longitude);
      try {
        cameraRef.current?.fitBounds(
          [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
          { padding: opts?.edgePadding, duration: opts?.animated === false ? 0 : 500 },
        );
      } catch {}
    },
  }), [animateToRegion, startRegion, zoom]);

  const handlePress = useCallback((e: any) => {
    const ll = e?.nativeEvent?.lngLat;
    if (!onPress || !ll) return;
    onPress({ nativeEvent: { coordinate: { latitude: ll[1], longitude: ll[0] } } });
  }, [onPress]);

  const handleLongPress = useCallback((e: any) => {
    const ll = e?.nativeEvent?.lngLat;
    if (!onLongPress || !ll) return;
    onLongPress({ nativeEvent: { coordinate: { latitude: ll[1], longitude: ll[0] } } });
  }, [onLongPress]);

  const handleChanging = useCallback((e: any) => {
    const v = e?.nativeEvent as ViewState | undefined;
    if (!v?.bounds) return;
    onRegionChange?.(viewStateToRegion(v));
  }, [onRegionChange]);

  const handleChanged = useCallback((e: any) => {
    const v = e?.nativeEvent as ViewState | undefined;
    if (!v?.bounds) return;
    setZoom(v.zoom);
    setView([v.bounds[0], v.bounds[1], v.bounds[2], v.bounds[3]]);
    onRegionChangeComplete?.(viewStateToRegion(v));
  }, [onRegionChangeComplete]);

  const goToMyLocation = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      cameraRef.current?.easeTo({
        center: [pos.coords.longitude, pos.coords.latitude],
        zoom: Math.max(zoom, 13),
        duration: 600,
      });
    } catch {}
  }, [zoom]);

  return (
    <View style={style} onLayout={onLayout}>
      <MapContext.Provider value={{ zoom }}>
        <MLMap
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={mapStyle as any}
          contentInset={mapPadding}
          dragPan={scrollEnabled}
          touchZoom={zoomEnabled}
          doubleTapZoom={zoomEnabled}
          touchRotate={rotateEnabled}
          touchPitch={pitchEnabled}
          compass={!!showsCompass}
          compassHiddenFacingNorth
          scaleBar={!!showsScale}
          logo={false}
          attribution
          attributionPosition={{ bottom: 4, left: 4 }}
          onPress={handlePress}
          onLongPress={handleLongPress}
          onRegionIsChanging={handleChanging}
          onRegionDidChange={handleChanged}
          onDidFinishLoadingMap={onMapReady ? () => onMapReady() : undefined}
        >
          <MLCamera ref={cameraRef} initialViewState={{ bounds: regionToBounds(startRegion) }} />
          {showsUserLocation ? <UserLocation heading accuracy /> : null}
          <CountryBaseLayers view={view} satellite={isSatelliteType(mapType)} />
          <ObstacleLayer view={view} zoom={zoom} />
          {children}
        </MLMap>
      </MapContext.Provider>
      {showsMyLocationButton ? (
        <Pressable onPress={goToMyLocation} style={styles.locateButton} hitSlop={8}>
          <Feather name="crosshair" size={20} color="#007AFF" />
        </Pressable>
      ) : null}
    </View>
  );
});

type MapViewComponent = typeof MapViewImpl;
const MapView: MapViewComponent = MapViewImpl;
// Erlaubt weiterhin `useRef<MapView>(null)` wie bei react-native-maps.
type MapView = MapViewHandle;
export default MapView;
export { MapView };

// ---------------------------------------------------------------------------
// Kachel-Overlays
// ---------------------------------------------------------------------------

export interface UrlTileProps {
  urlTemplate: string;
  maximumZ?: number;
  minimumZ?: number;
  maximumNativeZ?: number;
  tileSize?: number;
  opacity?: number;
  zIndex?: number;
  flipY?: boolean;
  shouldReplaceMapContent?: boolean;
  [key: string]: any;
}

function RasterOverlay({ tiles, minzoom, maxzoom, tileSize, opacity, scheme }: {
  tiles: string;
  minzoom?: number;
  maxzoom?: number;
  tileSize?: number;
  opacity: number;
  scheme?: "xyz" | "tms";
}) {
  const id = safeId(useId());
  // Neue URL → Quelle neu aufbauen (MapLibre aktualisiert Kachel-URLs nicht zuverlässig)
  const key = useMemo(() => {
    let h = 0;
    for (let i = 0; i < tiles.length; i++) h = (h * 31 + tiles.charCodeAt(i)) | 0;
    return `${id}-${h}`;
  }, [id, tiles]);
  if (!tiles || opacity <= 0) return null;
  return (
    <RasterSource
      key={key}
      id={`${key}-src`}
      tiles={[tiles]}
      tileSize={tileSize ?? 256}
      minzoom={minzoom}
      maxzoom={maxzoom}
      scheme={scheme}
    >
      <Layer
        type="raster"
        id={`${key}-layer`}
        beforeId={RASTER_ANCHOR}
        paint={{ "raster-opacity": Math.min(1, Math.max(0, opacity)), "raster-fade-duration": 0 }}
      />
    </RasterSource>
  );
}

export function UrlTile({ urlTemplate, maximumZ, minimumZ, maximumNativeZ, tileSize, opacity = 1, flipY }: UrlTileProps) {
  return (
    <RasterOverlay
      tiles={urlTemplate}
      minzoom={minimumZ}
      maxzoom={maximumNativeZ ?? maximumZ}
      tileSize={tileSize}
      opacity={opacity}
      scheme={flipY ? "tms" : "xyz"}
    />
  );
}

/** WMS-Kacheln: react-native-maps nutzt {minX},{minY},{maxX},{maxY}, MapLibre {bbox-epsg-3857}. */
export function WMSTile({ urlTemplate, maximumZ, minimumZ, tileSize = 256, opacity = 1 }: UrlTileProps) {
  const tiles = useMemo(
    () =>
      urlTemplate
        .replace("{minX},{minY},{maxX},{maxY}", "{bbox-epsg-3857}")
        .replace(/\{width\}/g, String(tileSize))
        .replace(/\{height\}/g, String(tileSize)),
    [urlTemplate, tileSize],
  );
  return <RasterOverlay tiles={tiles} minzoom={minimumZ} maxzoom={maximumZ} tileSize={tileSize} opacity={opacity} />;
}

// ---------------------------------------------------------------------------
// Vektor-Overlays
// ---------------------------------------------------------------------------

interface ShapeStyle {
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  lineDashPattern?: number[];
  zIndex?: number;
  tappable?: boolean;
  onPress?: (e?: any) => void;
  [key: string]: any;
}

function ShapeOverlay({
  geometry,
  strokeColor,
  strokeWidth = 1,
  fillColor,
  lineDashPattern,
  onPress,
  fill,
}: ShapeStyle & { geometry: GeoJSON.Geometry; fill: boolean }) {
  const id = safeId(useId());
  const data = useMemo<GeoJSON.Feature>(() => ({ type: "Feature", properties: {}, geometry }), [geometry]);
  const handlePress = useCallback((e: any) => {
    if (!onPress) return;
    e?.stopPropagation?.();
    onPress(e);
  }, [onPress]);
  const dash = lineDashPattern && lineDashPattern.length >= 2 && strokeWidth > 0
    ? lineDashPattern.map((v) => Math.max(0.1, v / strokeWidth))
    : undefined;
  return (
    <GeoJSONSource id={`${id}-src`} data={data} onPress={onPress ? handlePress : undefined}>
      {fill && fillColor ? (
        <Layer type="fill" id={`${id}-fill`} paint={{ "fill-color": fillColor }} />
      ) : null}
      {strokeColor && strokeWidth > 0 ? (
        <Layer
          type="line"
          id={`${id}-line`}
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={dash
            ? { "line-color": strokeColor, "line-width": strokeWidth, "line-dasharray": dash }
            : { "line-color": strokeColor, "line-width": strokeWidth }}
        />
      ) : null}
    </GeoJSONSource>
  );
}

export interface CircleProps extends ShapeStyle {
  center: LatLng;
  radius: number;
}

export function Circle({ center, radius, ...rest }: CircleProps) {
  const lat = center?.latitude;
  const lon = center?.longitude;
  const geometry = useMemo<GeoJSON.Polygon | null>(
    () => (Number.isFinite(lat) && Number.isFinite(lon) && radius > 0
      ? { type: "Polygon", coordinates: [circleRing({ latitude: lat, longitude: lon }, radius)] }
      : null),
    [lat, lon, radius],
  );
  if (!geometry) return null;
  return <ShapeOverlay geometry={geometry} fill {...rest} />;
}

export interface PolygonProps extends ShapeStyle {
  coordinates: LatLng[];
  holes?: LatLng[][];
}

export function Polygon({ coordinates, holes, ...rest }: PolygonProps) {
  const geometry = useMemo<GeoJSON.Polygon | null>(() => {
    const ring = (coordinates || []).filter(validCoord).map(toLngLat);
    if (ring.length < 3) return null;
    const close = (r: [number, number][]) =>
      r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]];
    const holeRings = (holes || [])
      .map((h) => h.filter(validCoord).map(toLngLat))
      .filter((h) => h.length >= 3)
      .map(close);
    return { type: "Polygon", coordinates: [close(ring), ...holeRings] };
  }, [coordinates, holes]);
  if (!geometry) return null;
  return <ShapeOverlay geometry={geometry} fill {...rest} />;
}

export interface PolylineProps extends ShapeStyle {
  coordinates: LatLng[];
}

export function Polyline({ coordinates, ...rest }: PolylineProps) {
  const geometry = useMemo<GeoJSON.LineString | null>(() => {
    const pts = (coordinates || []).filter(validCoord).map(toLngLat);
    return pts.length >= 2 ? { type: "LineString", coordinates: pts } : null;
  }, [coordinates]);
  if (!geometry) return null;
  return <ShapeOverlay geometry={geometry} fill={false} {...rest} />;
}

// ---------------------------------------------------------------------------
// Marker
// ---------------------------------------------------------------------------

export interface MarkerProps {
  coordinate: LatLng;
  title?: string;
  description?: string;
  pinColor?: string;
  anchor?: { x: number; y: number };
  draggable?: boolean;
  onPress?: (e?: any) => void;
  onDragEnd?: (e: MarkerDragStartEndEvent) => void;
  children?: React.ReactNode;
  zIndex?: number;
  tracksViewChanges?: boolean;
  [key: string]: any;
}

function DefaultPin({ color }: { color: string }) {
  return (
    <View style={styles.pinWrap} pointerEvents="none">
      <View style={[styles.pinHead, { backgroundColor: color }]}>
        <View style={styles.pinDot} />
      </View>
      <View style={[styles.pinTip, { borderTopColor: color }]} />
    </View>
  );
}

export function Marker({
  coordinate,
  title,
  description,
  pinColor = "#FF3B30",
  anchor,
  draggable,
  onPress,
  onDragEnd,
  children,
}: MarkerProps) {
  const id = safeId(useId());
  const handleDragEnd = useCallback((e: any) => {
    const ll = e?.nativeEvent?.lngLat;
    if (!ll || !onDragEnd) return;
    onDragEnd({ nativeEvent: { coordinate: { latitude: ll[1], longitude: ll[0] } } });
  }, [onDragEnd]);
  if (!validCoord(coordinate)) return null;
  const hasChildren = React.Children.count(children) > 0;
  const content = hasChildren
    ? <View collapsable={false}>{children}</View>
    : <DefaultPin color={pinColor} />;
  return (
    <ViewAnnotation
      id={id}
      lngLat={toLngLat(coordinate)}
      anchor={hasChildren ? anchorFromXY(anchor ?? { x: 0.5, y: 0.5 }) : "bottom"}
      title={title}
      snippet={description}
      draggable={!!draggable}
      onPress={onPress ? () => onPress() : undefined}
      onDragEnd={onDragEnd ? handleDragEnd : undefined}
    >
      {content}
    </ViewAnnotation>
  );
}

/** Callouts werden nicht nativ unterstützt – Inhalt wird ignoriert. */
export function Callout(_props: { children?: React.ReactNode; [key: string]: any }) {
  return null;
}

export function useMapZoom(): number {
  return useContext(MapContext)?.zoom ?? 0;
}

export const PROVIDER_DEFAULT = undefined;
export const PROVIDER_GOOGLE = undefined;

const styles = StyleSheet.create({
  locateButton: {
    position: "absolute",
    right: 12,
    bottom: 24,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pinWrap: { alignItems: "center", width: 30, height: 40 },
  pinHead: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  pinDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  pinTip: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
});
