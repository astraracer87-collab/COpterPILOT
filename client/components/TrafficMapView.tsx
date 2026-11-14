import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Typography, BorderRadius, Spacing } from "@/constants/theme";

import type { AircraftCategory, DataSource } from "@/lib/opensky";
import type { GeozoneFeatureInfo } from "@/lib/geozones";
import type { GermanEnergyInfrastructureItem } from "../../shared/germanEnergyInfrastructure";
import type { EnergyFacility100mPoint } from "../../shared/germanEnergyInfrastructure";

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
  highlightedZones?: GeozoneFeatureInfo[];
  additionalGeozones?: GeozoneFeatureInfo[];
  energyInfrastructure?: GermanEnergyInfrastructureItem[];
  windRestrictionPoints?: EnergyFacility100mPoint[];
  energyTilesEnabled?: boolean;
  energyTilesShowSupplemental?: boolean;
  maxReachableAltitudeM?: number;
  showAllGeozones?: boolean;
  mapStyle?: "standard" | "satellite" | "osm" | "grayscale";
  onMapStyleChange?: (style: "standard" | "satellite" | "osm" | "grayscale") => void;
  onCenterGps?: () => void;
  onSettingsPress?: () => void;
  settingsActive?: boolean;
  bottomPadding?: number;
  infoBubbleBottomInset?: number;
  topInset?: number;
  weatherAlerts?: any;
  onHeadingChange?: (h: number | null) => void;
  disableGeozoneQuery?: boolean;
  lockPan?: boolean;
  onViewportChange?: (bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number }) => void;
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
