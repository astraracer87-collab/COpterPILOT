import React, { forwardRef, useImperativeHandle } from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";

export interface DjiMapTrack {
  coords: { latitude: number; longitude: number }[];
  color: string;
  label?: string;
}

export interface DjiMapMarker {
  latitude: number;
  longitude: number;
  heading?: number;
  color?: string;
}

export interface DjiRadiusCircle {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export interface DjiTracksMapHandle {
  capture: () => Promise<string | null>;
  captureBoth: () => Promise<{ standard: string | null; satellite: string | null }>;
}

interface Props {
  tracks: DjiMapTrack[];
  height?: number;
  // Auf Web ohne native Karte ungenutzt — Signatur-Parität mit der nativen Variante.
  marker?: DjiMapMarker;
  radiusCircle?: DjiRadiusCircle;
  initialGeozonesOn?: boolean;
  onReady?: () => void;
}

const DjiTracksMap = forwardRef<DjiTracksMapHandle, Props>(function DjiTracksMap(
  { tracks, height = 280 },
  ref,
) {
  const { theme } = useTheme();
  const points = tracks.reduce((s, t) => s + t.coords.length, 0);
  // Auf Web ist kein nativer Karten-Snapshot möglich.
  useImperativeHandle(
    ref,
    () => ({
      capture: async () => null,
      captureBoth: async () => ({ standard: null, satellite: null }),
    }),
    [],
  );
  return (
    <View
      style={[
        styles.webFallback,
        { height, backgroundColor: theme.backgroundSecondary, borderColor: theme.border },
      ]}
    >
      <Feather name="map" size={28} color={theme.textTertiary} />
      <ThemedText style={[styles.text, { color: theme.textSecondary }]}>
        Kartenansicht nur in Expo Go verfügbar
        {points > 0 ? ` · ${points} GPS-Punkte` : ""}
      </ThemedText>
    </View>
  );
});

export default DjiTracksMap;

const styles = StyleSheet.create({
  webFallback: {
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  text: {
    ...Typography.small,
    textAlign: "center",
    paddingHorizontal: Spacing.lg,
  },
});
