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

const BASE_URL = "https://map.godrone.nl";

export default function GoDroneMapScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<FlightPlanningParamList, "PlanningGoDrone">>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const [loading, setLoading] = useState(true);

  const uri = useMemo(() => {
    const lat = route.params?.latitude;
    const lon = route.params?.longitude;
    if (typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon)) {
      return `${BASE_URL}/#loc=${lat.toFixed(5)},${lon.toFixed(5)},13`;
    }
    return BASE_URL;
  }, [route.params?.latitude, route.params?.longitude]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: "GoDrone",
      headerRight: () => (
        <HeaderButton onPress={() => navigation.goBack()}>
          <Feather name="x" size={22} color={theme.text} />
        </HeaderButton>
      ),
    });
  }, [navigation, theme.text]);

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
