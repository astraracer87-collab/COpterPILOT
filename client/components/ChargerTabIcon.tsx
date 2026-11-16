/**
 * „Akkus“-Tab: immer derselbe Akku (Feather „battery“), Zustand des
 * Ladegeräts im kleinen runden Badge oben rechts – gleiche Größe und Lage wie
 * die Zähl-Badges von NOTAM- und Radar-Tab (lib/charger/chargerTabBadge.ts).
 * Kein Ring und keine gefüllte Fläche hinter dem Symbol, damit nichts wie die
 * Pille des aktiven Tabs aussieht.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  chargerTabBadge,
  type ChargerTabBadge,
} from "@/lib/charger/chargerTabBadge";
import { useChargerSnapshot } from "@/hooks/useCharger";
import type { ControllerSnapshot } from "@/lib/charger/chargerController";

export function badgeFromSnapshot(s: ControllerSnapshot): ChargerTabBadge {
  const connected = s.transport?.state === "connected";
  return chargerTabBadge({
    connected,
    connecting: !connected && s.connecting,
    slotStates: connected ? (s.status?.slots.map((x) => x.state) ?? []) : [],
  });
}

export function ChargerTabIconView({
  focused,
  badge,
}: {
  focused: boolean;
  badge: ChargerTabBadge;
}) {
  const { theme } = useTheme();
  const [pulse] = useState(() => new Animated.Value(1));
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current?.stop();
    animRef.current = null;
    if (badge.pulseMs != null) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 0.25,
            duration: badge.pulseMs,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: badge.pulseMs,
            useNativeDriver: true,
          }),
        ]),
      );
      animRef.current = loop;
      loop.start();
    } else pulse.setValue(1);
    return () => {
      animRef.current?.stop();
      animRef.current = null;
    };
  }, [badge.pulseMs, pulse]);

  return (
    <View
      style={{ alignItems: "center", justifyContent: "center" }}
      testID="charger-tab-icon"
    >
      <Feather
        name="battery"
        size={24}
        color={focused ? theme.primary : theme.textTertiary}
      />
      {badge.visible ? (
        <Animated.View
          testID={`charger-tab-badge-${badge.kind}`}
          style={{
            position: "absolute",
            top: -4,
            right: -10,
            minWidth: 18,
            height: 18,
            paddingHorizontal: badge.text ? 4 : 0,
            borderRadius: 9,
            backgroundColor: badge.color ?? undefined,
            alignItems: "center",
            justifyContent: "center",
            opacity: badge.pulseMs != null ? pulse : 1,
          }}
        >
          {badge.icon ? (
            <Feather name={badge.icon} size={11} color="#FFFFFF" />
          ) : null}
          {badge.text ? (
            <ThemedText
              testID="charger-tab-badge-text"
              style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "700" }}
            >
              {badge.text}
            </ThemedText>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

export function ChargerTabIcon({ focused }: { focused: boolean }) {
  const snap = useChargerSnapshot();
  return (
    <ChargerTabIconView focused={focused} badge={badgeFromSnapshot(snap)} />
  );
}
