import React, { forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import type {
  EnergyFacility100mPoint,
  GermanEnergyInfrastructureItem,
} from "../../../shared/germanEnergyInfrastructure";

interface MapLocation {
  latitude: number;
  longitude: number;
}

interface MapPickerProps {
  initialRegion?: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  selectedLocation?: MapLocation | null;
  locationName?: string;
  onMapPress?: (latitude: number, longitude: number) => void;
  windFacilityPoints?: EnergyFacility100mPoint[];
  energyInfrastructureItems?: GermanEnergyInfrastructureItem[];
  style?: any;
}

export interface MapPickerRef {
  animateToRegion: (region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  }, duration?: number) => void;
}

const MapPicker = forwardRef<MapPickerRef, MapPickerProps>(
  ({ style }, ref) => {
    const { theme } = useTheme();
    
    useImperativeHandle(ref, () => ({
      animateToRegion: () => {},
    }));
    
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }, style]}>
        <Feather name="map" size={48} color={theme.textTertiary} />
        <ThemedText style={[styles.title, { color: theme.textSecondary }]}>
          Kartenansicht nur auf Mobilgeräten verfügbar
        </ThemedText>
        <ThemedText style={[styles.hint, { color: theme.textTertiary }]}>
          Nutze die Suche oder GPS-Ortung
        </ThemedText>
      </View>
    );
  }
);

MapPicker.displayName = "MapPicker";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  title: {
    ...Typography.body,
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  hint: {
    ...Typography.small,
    marginTop: Spacing.sm,
    textAlign: "center",
  },
});

export default MapPicker;
