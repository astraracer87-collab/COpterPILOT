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
import { Spacing, Shadows, Colors, Typography } from "@/constants/theme";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import {
  getCountryMapConfig,
  getDefaultMapConfig,
  buildMapUrl,
  detectCountryFromCoordinates,
  type CountryMapConfig,
} from "@/lib/countryMaps";

type RouteParams = RouteProp<FlightCheckParamList, "Map">;
type NavigationProp = NativeStackNavigationProp<FlightCheckParamList, "Map">;

export default function MapScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [detectingCountry, setDetectingCountry] = useState(true);
  const [countryConfig, setCountryConfig] = useState<CountryMapConfig | null>(null);
  const [countryName, setCountryName] = useState<string>("");
  const webViewRef = useRef<WebView>(null);

  const { latitude, longitude, droneId, sessionId, countryIso } = route.params;

  useEffect(() => {
    function detectCountry() {
      if (countryIso) {
        const config = getCountryMapConfig(countryIso);
        if (config) {
          setCountryConfig(config);
          setCountryName(config.nameDE);
          setDetectingCountry(false);
          return;
        }
      }
      
      const detectedIso = detectCountryFromCoordinates(latitude, longitude);
      
      if (detectedIso) {
        const config = getCountryMapConfig(detectedIso);
        if (config) {
          setCountryConfig(config);
          setCountryName(config.nameDE);
        } else {
          setCountryConfig(getDefaultMapConfig());
          setCountryName("Deutschland");
        }
      } else {
        setCountryConfig(getDefaultMapConfig());
        setCountryName("Unbekanntes Land");
      }
      setDetectingCountry(false);
    }
    detectCountry();
  }, [latitude, longitude, countryIso]);

  const mapUrl = countryConfig ? buildMapUrl(countryConfig, latitude, longitude) : "";

  const handleDone = () => {
    navigation.navigate("Restrictions", { latitude, longitude, droneId, sessionId });
  };

  if (detectingCountry) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: headerHeight }]}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
            Ermittle Standort...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {Platform.OS === "web" ? (
        <View style={[styles.webFallback, { paddingTop: headerHeight + Spacing.xl }]}>
          <ThemedText style={styles.webFallbackTitle}>Drohnen-Karte</ThemedText>
          <ThemedText style={[styles.webFallbackText, { color: theme.textSecondary }]}>
            Die Karte ist in Expo Go auf dem Gerät verfügbar.
          </ThemedText>
          <ThemedText style={[styles.countryText, { color: theme.primary }]}>
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
          <View style={[styles.countryBanner, { top: headerHeight, backgroundColor: theme.primary + "15" }]}>
            <ThemedText style={[styles.countryBannerText, { color: theme.primary }]}>
              {countryName} • {latitude.toFixed(4)}, {longitude.toFixed(4)}
            </ThemedText>
          </View>
          <WebView
            setSupportMultipleWindows={false}
            ref={webViewRef}
            source={{ uri: mapUrl }}
            style={[styles.webView, { marginTop: headerHeight + 36 }]}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
                <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
                  Lade Karte für {countryName}...
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
    ...StyleSheet.absoluteFillObject,
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
  countryText: {
    ...Typography.h3,
    marginBottom: Spacing.md,
  },
  countryBanner: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  countryBannerText: {
    ...Typography.small,
    fontWeight: "600",
  },
});
