import React, { useState, useLayoutEffect, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { useHeaderHeight, HeaderButton } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

function injectCoordinates(url: string, lat?: number, lon?: number): string {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return url;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // map.geo.admin.ch unterstützt crosshair + WGS84-Suche.
    if (host.endsWith("map.geo.admin.ch")) {
      parsed.searchParams.set("crosshair", "marker");
      parsed.searchParams.set("swisssearch", `${lat.toFixed(5)},${lon.toFixed(5)}`);
      return parsed.toString();
    }
    // Géoportail FR: ?c=lon,lat&z=13
    if (host.endsWith("geoportail.gouv.fr")) {
      parsed.searchParams.set("c", `${lon.toFixed(5)},${lat.toFixed(5)}`);
      parsed.searchParams.set("z", "13");
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export default function PlanningExternalMapScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<FlightPlanningParamList, "PlanningExternalMap">>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const [loading, setLoading] = useState(true);

  const { url, title, latitude, longitude } = route.params;

  const uri = useMemo(
    () => injectCoordinates(url, latitude, longitude),
    [url, latitude, longitude],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: title,
      headerRight: () => (
        <HeaderButton onPress={() => navigation.goBack()}>
          <Feather name="x" size={22} color={theme.text} />
        </HeaderButton>
      ),
    });
  }, [navigation, theme.text, title]);

  return (
    <ThemedView style={styles.container}>
      <WebView
        setSupportMultipleWindows={false}
        source={{ uri }}
        style={[styles.webview, { marginTop: headerHeight }]}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        scalesPageToFit
        geolocationEnabled
      />
      {loading ? (
        <View style={[styles.loadingOverlay, { paddingTop: headerHeight }]}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
            Karte wird geladen...
          </ThemedText>
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  loadingText: {
    marginTop: Spacing.md,
  },
});
