import React, { useLayoutEffect } from "react";
import { View, StyleSheet, Platform } from "react-native";
import MapView, { Marker, Circle } from "@/components/maps";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import { useHeaderHeight, HeaderButton } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";

interface LocationMapParams {
  latitude: number;
  longitude: number;
  title?: string;
  radiusM?: number;
}

const PILOT_COLOR = "#007AFF";

export default function LocationMapScreen() {
  const route = useRoute<RouteProp<{ params: LocationMapParams }, "params">>();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();

  const { latitude, longitude, title, radiusM } = route.params || { latitude: 51.1657, longitude: 10.4515 };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: title || "Standort",
      headerRight: () => (
        <HeaderButton onPress={() => navigation.goBack()}>
          <Feather name="x" size={22} color={theme.text} />
        </HeaderButton>
      ),
    });
  }, [navigation, theme.text, title]);

  return (
    <ThemedView style={styles.container}>
      <MapView
        style={[styles.map, { marginTop: headerHeight }]}
        initialRegion={{
          latitude,
          longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation
        showsMyLocationButton
        showsCompass
        showsScale
      >
        <Marker
          coordinate={{ latitude, longitude }}
          title={title || "Flugstandort"}
          pinColor={PILOT_COLOR}
        />
        {radiusM != null ? (
          <Circle
            center={{ latitude, longitude }}
            radius={radiusM}
            fillColor="rgba(0,122,255,0.1)"
            strokeColor={PILOT_COLOR}
            strokeWidth={2}
          />
        ) : null}
      </MapView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
