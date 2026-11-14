import React, { useEffect, useState } from "react";
import { View, StyleSheet, FlatList, Pressable } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { COUNTRY_MAPS, CountryMapConfig, getCountryFlag } from "@/lib/countryMaps";
import { getSettings } from "@/lib/storage";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";

type RouteParams = RouteProp<FlightCheckParamList, "CountrySelect">;
type NavigationProp = NativeStackNavigationProp<FlightCheckParamList, "CountrySelect">;

const sortedCountries = [...COUNTRY_MAPS].sort((a, b) => a.nameDE.localeCompare(b.nameDE, "de"));

export default function CountrySelectScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const { droneId, sessionId, latitude, longitude } = route.params;
  const [preferredIso, setPreferredIso] = useState<string>("DE");
  useEffect(() => {
    getSettings().then((s) => setPreferredIso((s.preferredCountryIso || "DE").toUpperCase())).catch(() => {});
  }, []);

  const handleSelectCountry = (country: CountryMapConfig) => {
    navigation.navigate("Map", {
      latitude: latitude ?? getDefaultLatitude(country.iso),
      longitude: longitude ?? getDefaultLongitude(country.iso),
      droneId,
      sessionId,
      countryIso: country.iso,
    });
  };

  const sortedWithPreferred = React.useMemo(() => {
    const list = [...sortedCountries];
    list.sort((a, b) => {
      if (a.iso === preferredIso && b.iso !== preferredIso) return -1;
      if (b.iso === preferredIso && a.iso !== preferredIso) return 1;
      return a.nameDE.localeCompare(b.nameDE, "de");
    });
    return list;
  }, [preferredIso]);

  const renderCountry = ({ item }: { item: CountryMapConfig }) => {
    const isPreferred = item.iso === preferredIso;
    return (
      <Card
        style={[
          styles.countryCard,
          isPreferred ? { borderColor: theme.primary, borderWidth: 2 } : null,
        ]}
        onPress={() => handleSelectCountry(item)}
      >
        <View style={styles.countryRow}>
          <View style={styles.countryInfo}>
            <ThemedText style={{ fontSize: 26 }}>{getCountryFlag(item.iso)}</ThemedText>
            <ThemedText style={styles.countryName}>{item.nameDE}</ThemedText>
            <ThemedText style={[styles.countryCode, { color: theme.textSecondary }]}>
              {item.iso}
            </ThemedText>
            {isPreferred ? (
              <View style={{ backgroundColor: theme.primary + "22", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                <ThemedText style={{ ...Typography.small, color: theme.primary, fontWeight: "700" }}>
                  Aktuell
                </ThemedText>
              </View>
            ) : null}
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </View>
      </Card>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={sortedWithPreferred}
        keyExtractor={(item) => item.iso}
        renderItem={renderCountry}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
        ListHeaderComponent={
          <ThemedText style={[styles.headerText, { color: theme.textSecondary }]}>
            Wähle das Land, in dem du fliegen möchtest. Die passende Drohnen-Karte wird automatisch angezeigt.
          </ThemedText>
        }
      />
    </ThemedView>
  );
}

function getDefaultLatitude(iso: string): number {
  const defaults: Record<string, number> = {
    DE: 51.1657,
    AT: 47.5162,
    CH: 46.8182,
    FR: 46.2276,
    IT: 41.8719,
    ES: 40.4637,
    NL: 52.1326,
    BE: 50.5039,
    DK: 56.2639,
    IE: 53.1424,
    PL: 51.9194,
    CZ: 49.8175,
    PT: 39.3999,
    GR: 39.0742,
    FI: 61.9241,
    SE: 60.1282,
    NO: 60.472,
    LU: 49.8153,
  };
  return defaults[iso] || 50.0;
}

function getDefaultLongitude(iso: string): number {
  const defaults: Record<string, number> = {
    DE: 10.4515,
    AT: 14.5501,
    CH: 8.2275,
    FR: 2.2137,
    IT: 12.5674,
    ES: -3.7492,
    NL: 5.2913,
    BE: 4.4699,
    DK: 9.5018,
    IE: -7.6921,
    PL: 19.1451,
    CZ: 15.473,
    PT: -8.2245,
    GR: 21.8243,
    FI: 25.7482,
    SE: 18.6435,
    NO: 8.4689,
    LU: 6.1296,
  };
  return defaults[iso] || 10.0;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  headerText: {
    ...Typography.body,
    marginBottom: Spacing.lg,
    textAlign: "center",
  },
  countryCard: {
    padding: Spacing.lg,
  },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  countryInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  countryName: {
    ...Typography.body,
    fontWeight: "500",
  },
  countryCode: {
    ...Typography.small,
  },
});
