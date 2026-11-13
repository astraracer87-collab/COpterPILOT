import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Typography, BorderRadius, Spacing } from "@/constants/theme";

import type { AircraftCategory, DataSource } from "@/lib/opensky";

export interface TrafficMarker {
  id: string;
  latitude: number;
  longitude: number;
  pinColor: string;
  title: string;
  description: string;
  heading?: number;
  altitude?: string;
  speed?: string;
  category?: AircraftCategory;
  sources?: DataSource[];
  isApproaching?: boolean;
  isAlert?: boolean;
  isStale?: boolean;
}

export interface WindData {
  direction: number;
  speed: number;
  directionLabel: string;
}

export interface TrailPoint {
  latitude: number;
  longitude: number;
}

export interface AircraftTrail {
  id: string;
  color: string;
  points: TrailPoint[];
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
  sourceStatus?: Record<string, string>;
  geozoneLayers?: string[];
  countryIso?: string;
  mapStyle?: "standard" | "satellite" | "osm";
  onMapStyleChange?: (style: "standard" | "satellite" | "osm") => void;
  onCenterGps?: () => void;
  onSettingsPress?: () => void;
  settingsActive?: boolean;
  bottomPadding?: number;
  topInset?: number;
  weatherAlerts?: any;
  onHeadingChange?: (h: number | null) => void;
  disableGeozoneQuery?: boolean;
}

export default function TrafficMapView(_props: TrafficMapViewProps) {
  const { theme } = useTheme();

  return (
    <View style={[styles.webFallback, { backgroundColor: theme.backgroundSecondary }]}>
      <Feather name="map" size={32} color={theme.textTertiary} />
      <ThemedText style={[styles.webFallbackText, { color: theme.textSecondary }]}>
        Kartenansicht nur in Expo Go verfügbar
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  webFallback: {
    height: 350,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  webFallbackText: {
    ...Typography.body,
    textAlign: "center",
    paddingHorizontal: Spacing.xl,
  },
});
