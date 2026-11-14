import React, { useRef, useState, useEffect } from "react";
import { View, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Shadows, Colors } from "@/constants/theme";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import {
  getMapConfigOrFallback,
  buildMapUrl,
  type CountryMapConfig,
} from "@/lib/countryMaps";

type RouteParams = RouteProp<FlightPlanningParamList, "PlanningMap">;
type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningMap">;

export default function PlanningMapScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const webViewRef = useRef<WebView>(null);
  const [countryConfig, setCountryConfig] = useState<CountryMapConfig | null>(null);

  const { droneId, latitude, longitude, locationName, countryIso } = route.params;

  useEffect(() => {
    setCountryConfig(getMapConfigOrFallback(countryIso));
  }, [countryIso]);

  const mapUrl = countryConfig ? buildMapUrl(countryConfig, latitude, longitude) : "";
  const countryName = countryConfig?.nameDE || "EASA Drohnen-Portal";

  const handleDone = () => {
    navigation.navigate("PlanningRestrictions", { 
      droneId, 
      latitude, 
      longitude, 
      locationName,
      countryIso: countryIso || countryConfig?.iso,
      mapUrl: mapUrl || undefined,
    });
  };

  return (
    <ThemedView style={styles.container}>
      {Platform.OS === "web" ? (
        <View style={[styles.webFallback, { paddingTop: headerHeight + Spacing.xl }]}>
          <ThemedText style={styles.webFallbackTitle}>Drohnen-Karte</ThemedText>
          <ThemedText style={[styles.webFallbackText, { color: theme.textSecondary }]}>
            Die Karte ist in Expo Go auf dem Gerät verfügbar.
          </ThemedText>
          <ThemedText style={[styles.webFallbackText, { color: theme.primary }]}>
            {countryName}
          </ThemedText>
          <ThemedText style={[styles.webFallbackText, { color: theme.textSecondary }]}>
            Standort: {latitude.toFixed(4)}, {longitude.toFixed(4)}
          </ThemedText>
          <Button
            title="Weiter"
            onPress={handleDone}
            style={{ marginTop: Spacing.xl }}
          />
        </View>
      ) : (
        <>
          <WebView
            setSupportMultipleWindows={false}
            ref={webViewRef}
            source={{ uri: mapUrl }}
            style={[styles.webView, { marginTop: headerHeight }]}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
                <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
                  Lade Karte ({countryName})...
                </ThemedText>
              </View>
            )}
          />
          <View style={[styles.fabContainer, { bottom: insets.bottom + Spacing.xl }]}>
            <Button
              title="Fertig"
              onPress={handleDone}
              style={[styles.doneButton, Shadows.fab]}
            />
          </View>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webView: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.light.backgroundRoot,
  },
  loadingText: {
    marginTop: Spacing.md,
  },
  fabContainer: {
    position: "absolute",
    right: Spacing.xl,
  },
  doneButton: {
    paddingHorizontal: Spacing["2xl"],
  },
  webFallback: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  webFallbackTitle: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: Spacing.md,
  },
  webFallbackText: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
});
