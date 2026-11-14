import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import {
  onSubscriptionRequired,
  SUBSCRIPTION_REQUIRED_MESSAGE,
} from "@/lib/subscriptionLock";

/**
 * Zeigt bei einem global abgefangenen 402 (fehlendes Abo) eine kurze,
 * freundliche Meldung und stößt eine Neubewertung des Abo-Status an. Wird der
 * Status dann als inaktiv bestätigt, schaltet das AuthGate automatisch auf den
 * PaywallScreen (= die Paketauswahl) — das mobile Pendant zum Web-Redirect auf
 * „/pakete". So fühlt sich die Sperre stets bewusst an: keine rohen
 * Fehler-Toasts oder leeren Zustände.
 */
export default function SubscriptionLockNotice() {
  const { refreshSubscription } = useAuth();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = onSubscriptionRequired(() => {
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 5000);
      // Abo-Status neu laden — bei bestätigter Sperre greift das Paywall-Gate
      // im AuthGate und zeigt die Paketauswahl.
      refreshSubscription().catch(() => undefined);
    });
    return () => {
      unsubscribe();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [refreshSubscription]);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { top: insets.top + Spacing.sm, opacity },
      ]}
      testID="notice-subscription-required"
    >
      <View style={styles.card}>
        <View style={styles.iconContainer}>
          <Feather name="credit-card" size={20} color="#FFFFFF" />
        </View>
        <View style={styles.textContainer}>
          <ThemedText style={styles.title}>
            {SUBSCRIPTION_REQUIRED_MESSAGE}
          </ThemedText>
          <ThemedText style={styles.detail}>
            Bitte wähle ein Paket, um diese Funktion zu nutzen.
          </ThemedText>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 1000,
    elevation: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "#0A4D8C",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  },
  detail: {
    ...Typography.small,
    color: "rgba(255,255,255,0.9)",
    marginTop: 2,
  },
});
