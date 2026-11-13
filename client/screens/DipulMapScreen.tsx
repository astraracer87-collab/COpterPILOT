import React, { useState, useLayoutEffect } from "react";
import { View, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { WebView } from "react-native-webview";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight, HeaderButton } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

interface DipulMapParams {
  latitude: number;
  longitude: number;
  title?: string;
  mapUrl?: string;
}

export default function DipulMapScreen() {
  const route = useRoute<RouteProp<{ params: DipulMapParams }, "params">>();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);

  const { latitude, longitude, title, mapUrl } = route.params || { latitude: 51.1657, longitude: 10.4515 };
  
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: title || "Drohnen-Karte",
      headerRight: () => (
        <HeaderButton onPress={() => navigation.goBack()}>
          <Feather name="x" size={22} color={theme.text} />
        </HeaderButton>
      ),
    });
  }, [navigation, title, theme.text]);
  
  const finalUrl = mapUrl || `https://maptool-dipul.dfs.de/@${longitude},${latitude},14z?language=de`;

  return (
    <ThemedView style={styles.container}>
      <WebView
        source={{ uri: finalUrl }}
        style={[styles.webview, { marginTop: headerHeight }]}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        scalesPageToFit
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
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  loadingText: {
    marginTop: Spacing.md,
  },
});
