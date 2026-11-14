import React, { useEffect, useRef, createContext, useContext } from "react";
import { View, StyleSheet, Pressable, Animated } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { ProximityAlert } from "@/lib/proximityAlarm";

interface Props {
  alerts: ProximityAlert[];
  alarmActive: boolean;
  alarmLevel?: "none" | "warning" | "critical";
  clearOfConflict?: boolean;
  maxAltitudeM?: number;
  onDismiss: () => void;
}

interface AlarmPulseContextType {
  pulseAnim: Animated.Value;
}

const AlarmPulseContext = createContext<AlarmPulseContextType | null>(null);

export function AlarmPulseProvider({
  alarmActive,
  alarmLevel = "none",
  clearOfConflict = false,
  children,
}: {
  alarmActive: boolean;
  alarmLevel?: "none" | "warning" | "critical";
  clearOfConflict?: boolean;
  children: React.ReactNode;
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isCritical = alarmLevel === "critical";
  const pulseDuration = isCritical ? 300 : 600;
  const showPulse = alarmActive || clearOfConflict;

  useEffect(() => {
    if (showPulse) {
      const minVal = clearOfConflict ? 0.3 : isCritical ? 0.1 : 0.4;
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: minVal,
            duration: pulseDuration,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: pulseDuration,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [showPulse, pulseAnim, isCritical, clearOfConflict, pulseDuration]);

  return (
    <AlarmPulseContext.Provider value={{ pulseAnim }}>
      {children}
    </AlarmPulseContext.Provider>
  );
}

function useAlarmPulse() {
  return useContext(AlarmPulseContext);
}

interface GlowProps extends Pick<Props, "alarmActive" | "alarmLevel" | "clearOfConflict"> {
  bearingToThreat?: number;
  bottomInset?: number;
}

export function ProximityAlarmGlow({ alarmActive, alarmLevel = "none", clearOfConflict = false, bearingToThreat, bottomInset = 0 }: GlowProps) {
  const ctx = useAlarmPulse();
  const isCritical = alarmLevel === "critical";
  const showGlow = alarmActive || clearOfConflict;

  if (!showGlow || !ctx) return null;

  const baseColor = clearOfConflict ? "27,138,42" : isCritical ? "204,0,0" : "230,168,23";
  const glowSize = isCritical ? 90 : 60;

  const edges = getGlowEdges(bearingToThreat, baseColor, glowSize, bottomInset);

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: ctx.pulseAnim,
        zIndex: 150,
      }}
      pointerEvents="none"
    >
      {edges.map((edge, i) => (
        <View key={i} style={edge} pointerEvents="none" />
      ))}
    </Animated.View>
  );
}

function getGlowEdges(bearing: number | undefined, rgb: string, size: number, bottomInset: number = 0) {
  const edges: any[] = [];
  const strong = `rgba(${rgb},0.7)`;
  const mid = `rgba(${rgb},0.25)`;
  const fade = `rgba(${rgb},0)`;

  if (bearing == null) {
    edges.push(
      { position: "absolute", top: 0, left: 0, right: 0, height: size * 0.6, background: undefined },
      { position: "absolute", bottom: bottomInset, left: 0, right: 0, height: size * 0.6 },
      { position: "absolute", top: 0, left: 0, bottom: bottomInset, width: size * 0.6 },
      { position: "absolute", top: 0, right: 0, bottom: bottomInset, width: size * 0.6 },
    );
    for (const e of edges) {
      e.backgroundColor = `rgba(${rgb},0.15)`;
    }
    return edges;
  }

  const b = ((bearing % 360) + 360) % 360;

  const topW = edgeWeight(b, 0);
  const rightW = edgeWeight(b, 90);
  const bottomW = edgeWeight(b, 180);
  const leftW = edgeWeight(b, 270);

  if (topW > 0.05) {
    edges.push({
      position: "absolute" as const,
      top: 0, left: 0, right: 0,
      height: size * topW,
      backgroundColor: "transparent",
      borderTopWidth: Math.max(2, Math.round(size * 0.5 * topW)),
      borderTopColor: interpolateAlpha(rgb, topW),
      shadowColor: `rgb(${rgb})`,
      shadowOffset: { width: 0, height: Math.round(8 * topW) },
      shadowOpacity: 0.6 * topW,
      shadowRadius: Math.round(20 * topW),
    });
  }
  if (bottomW > 0.05) {
    edges.push({
      position: "absolute" as const,
      bottom: bottomInset, left: 0, right: 0,
      height: size * bottomW,
      backgroundColor: "transparent",
      borderBottomWidth: Math.max(2, Math.round(size * 0.5 * bottomW)),
      borderBottomColor: interpolateAlpha(rgb, bottomW),
      shadowColor: `rgb(${rgb})`,
      shadowOffset: { width: 0, height: -Math.round(8 * bottomW) },
      shadowOpacity: 0.6 * bottomW,
      shadowRadius: Math.round(20 * bottomW),
    });
  }
  if (leftW > 0.05) {
    edges.push({
      position: "absolute" as const,
      top: 0, left: 0, bottom: bottomInset,
      width: size * leftW,
      backgroundColor: "transparent",
      borderLeftWidth: Math.max(2, Math.round(size * 0.5 * leftW)),
      borderLeftColor: interpolateAlpha(rgb, leftW),
      shadowColor: `rgb(${rgb})`,
      shadowOffset: { width: Math.round(8 * leftW), height: 0 },
      shadowOpacity: 0.6 * leftW,
      shadowRadius: Math.round(20 * leftW),
    });
  }
  if (rightW > 0.05) {
    edges.push({
      position: "absolute" as const,
      top: 0, right: 0, bottom: bottomInset,
      width: size * rightW,
      backgroundColor: "transparent",
      borderRightWidth: Math.max(2, Math.round(size * 0.5 * rightW)),
      borderRightColor: interpolateAlpha(rgb, rightW),
      shadowColor: `rgb(${rgb})`,
      shadowOffset: { width: -Math.round(8 * rightW), height: 0 },
      shadowOpacity: 0.6 * rightW,
      shadowRadius: Math.round(20 * rightW),
    });
  }

  return edges;
}

export function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const r1 = (lat1 * Math.PI) / 180;
  const r2 = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(r2);
  const x = Math.cos(r1) * Math.sin(r2) - Math.sin(r1) * Math.cos(r2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function edgeWeight(bearing: number, edgeAngle: number): number {
  const diff = Math.abs(((bearing - edgeAngle + 180) % 360) - 180);
  if (diff >= 90) return 0;
  return Math.cos((diff * Math.PI) / 180);
}

function interpolateAlpha(rgb: string, weight: number): string {
  const alpha = Math.min(0.85, 0.3 + 0.55 * weight);
  return `rgba(${rgb},${alpha.toFixed(2)})`;
}

export default function ProximityAlarmBanner({ alerts, alarmActive, alarmLevel = "none", clearOfConflict = false, maxAltitudeM, onDismiss }: Props) {
  const { theme } = useTheme();
  const ctx = useAlarmPulse();
  const fallbackAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = ctx?.pulseAnim ?? fallbackAnim;

  const isCritical = alarmLevel === "critical";

  if (clearOfConflict) {
    return (
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: "#1B8A2A",
            opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
            position: "absolute",
            bottom: 8,
            left: 12,
            right: 12,
            zIndex: 200,
            elevation: 10,
            shadowColor: "#1B8A2A",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: 12,
          },
        ]}
      >
        <View style={styles.content}>
          <View style={[styles.iconContainer, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
            <Feather name="check-circle" size={24} color="#FFFFFF" />
          </View>
          <View style={styles.textContainer}>
            <ThemedText style={styles.title}>CLEAR OF CONFLICT</ThemedText>
            <ThemedText style={styles.detail}>Kollisionsgefahr vorbei — Luftraum frei</ThemedText>
          </View>
          <Pressable onPress={onDismiss} hitSlop={16} style={styles.dismissBtn} testID="dismiss-clear-banner">
            <Feather name="x" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  if (alerts.length === 0) return null;

  const closest = alerts[0];
  const distText = closest.distanceKm < 1
    ? `${Math.round(closest.distanceKm * 1000)} m`
    : `${closest.distanceKm.toFixed(1)} km`;
  const altText = `${Math.round(closest.altitudeM)} m`;
  const limitText = maxAltitudeM != null ? ` (Grenze ${Math.round(maxAltitudeM)} m)` : "";
  const callsign = closest.aircraft.callsign || closest.aircraft.icao24;

  const bgColor = isCritical ? "#CC0000" : "#E6A817";
  const isApproaching = closest.isApproaching;
  const titleText = isCritical
    ? "CONFLICT — KOLLISIONSGEFAHR"
    : isApproaching
      ? "TRAFFIC — FLUGOBJEKT NÄHERT SICH"
      : "TRAFFIC — FLUGOBJEKT ENTFERNT SICH";

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: bgColor,
          opacity: alarmActive ? pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) : 1,
          position: "absolute",
          bottom: 8,
          left: 12,
          right: 12,
          zIndex: 200,
          elevation: 10,
          shadowColor: bgColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: alarmActive ? 16 : 8,
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Feather name={isCritical ? "alert-octagon" : "alert-triangle"} size={24} color="#FFFFFF" />
        </View>
        <View style={styles.textContainer}>
          <ThemedText style={styles.title}>
            {titleText}
          </ThemedText>
          <ThemedText style={styles.detail}>
            {callsign} - {distText} entfernt, {altText} Höhe{limitText}
          </ThemedText>
          {alerts.length > 1 ? (
            <ThemedText style={styles.moreText}>
              +{alerts.length - 1} weitere
            </ThemedText>
          ) : null}
        </View>
        <Pressable onPress={onDismiss} hitSlop={16} style={styles.dismissBtn} testID="dismiss-proximity-alarm">
          <Feather name="x" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    overflow: "hidden",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    ...Typography.callout,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  detail: {
    ...Typography.small,
    color: "rgba(255,255,255,0.9)",
    marginTop: 2,
  },
  moreText: {
    ...Typography.caption,
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
  },
  dismissBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: Spacing.sm,
  },
});
