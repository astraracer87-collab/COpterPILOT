/**
 * Radar-Tab der unteren Leiste: Zähl-Badge wie beim NOTAM-Tab mit der Anzahl
 * der Luftfahrzeuge in TA/RA (lib/trafficAlertStore.ts – Vorder- und
 * Hintergrund), Badge- und Ringfarbe = stärkste Warnung (orange TA, rot RA).
 * RA blinkt schnell rot, TA pulsiert langsam orange; alles quittiert →
 * gedimmt und ruhig. Alarm als RING (keine gefüllte Fläche), damit er nicht
 * wie die Pille des aktiven Tabs aussieht; Badge klein und rund oben rechts.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { radarTabBadge, subscribeTrafficAlertState, type TrafficAlertState } from "@/lib/trafficAlertStore";

function useTrafficAlertState(): TrafficAlertState {
  const [state, setState] = useState<TrafficAlertState>({ level: "none", count: 0, acknowledged: 0 });
  useEffect(() => subscribeTrafficAlertState(setState), []);
  return state;
}

export function RadarTabIcon({ focused }: { focused: boolean }) {
  const { theme } = useTheme();
  const badge = radarTabBadge(useTrafficAlertState());
  const [pulseAnim] = useState(() => new Animated.Value(1));
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current?.stop();
    animRef.current = null;
    if (badge.pulseMs != null) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.2, duration: badge.pulseMs, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: badge.pulseMs, useNativeDriver: true }),
        ]),
      );
      animRef.current = loop;
      loop.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => {
      animRef.current?.stop();
      animRef.current = null;
    };
  }, [badge.pulseMs, pulseAnim]);

  const iconColor = badge.visible && badge.color ? badge.color : focused ? theme.primary : theme.textTertiary;
  const dimOpacity = badge.dimmed ? 0.5 : 1;

  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      {badge.visible ? (
        <Animated.View
          testID="radar-tab-alarm-ring"
          style={{
            position: "absolute",
            width: 34,
            height: 34,
            borderRadius: 17,
            borderWidth: 2,
            borderColor: badge.color ?? undefined,
            backgroundColor: "transparent",
            opacity: badge.dimmed ? 0.45 : pulseAnim.interpolate({ inputRange: [0.2, 1], outputRange: [0.35, 1] }),
          }}
        />
      ) : null}
      <Animated.View style={badge.pulseMs != null ? { opacity: pulseAnim } : badge.dimmed ? { opacity: dimOpacity } : undefined}>
        <Feather name="radio" size={24} color={iconColor} />
      </Animated.View>
      {badge.visible ? (
        <View
          testID="radar-tab-badge"
          style={{
            position: "absolute",
            top: -4,
            right: -10,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 9,
            backgroundColor: badge.color ?? undefined,
            opacity: dimOpacity,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ThemedText testID="radar-tab-badge-text" style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "700" }}>
            {badge.text}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

export function RadarTabLabel({ focused }: { focused: boolean }) {
  const { theme } = useTheme();
  const badge = radarTabBadge(useTrafficAlertState());
  const color = badge.visible && badge.color ? badge.color : focused ? theme.primary : theme.textTertiary;
  return (
    <ThemedText style={{ fontSize: 12, fontWeight: focused ? "700" : "500", color }} numberOfLines={1}>
      Radar
    </ThemedText>
  );
}
