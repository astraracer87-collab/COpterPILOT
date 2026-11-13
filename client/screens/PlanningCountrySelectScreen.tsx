import React, { useEffect, useState, useMemo } from "react";
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
import { COUNTRY_MAPS, CountryMapConfig } from "@/lib/countryMaps";
import { getSettings } from "@/lib/storage";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

type RouteParams = RouteProp<FlightPlanningParamList, "PlanningCountrySelect">;
type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningCountrySelect">;

const sortedCountries = [...COUNTRY_MAPS].sort((a, b) => a.nameDE.localeCompare(b.nameDE, "de"));

export default function PlanningCountrySelectScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const { droneId } = route.params;
  const [preferredIso, setPreferredIso] = useState<string>("DE");
  useEffect(() => {
    getSettings().then((s) => setPreferredIso((s.preferredCountryIso || "DE").toUpperCase())).catch(() => {});
  }, []);

  const handleSelectCountry = (country: CountryMapConfig) => {
    navigation.navigate("PlanningLocation", {
      droneId,
      countryIso: country.iso,
    });
  };

  const sortedWithPreferred = useMemo(() => {
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
