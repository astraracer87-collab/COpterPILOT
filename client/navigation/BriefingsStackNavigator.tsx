import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import BriefingsScreen from "@/screens/BriefingsScreen";
import BriefingDetailScreen from "@/screens/BriefingDetailScreen";
import DipulMapScreen from "@/screens/DipulMapScreen";
import LocationMapScreen from "@/screens/LocationMapScreen";
import BrightSkyWeatherScreen from "@/screens/BrightSkyWeatherScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { Pressable, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { setLogbookOrigin } from "@/lib/logbookOrigin";

export type BriefingsStackParamList = {
  Briefings: undefined;
  BriefingDetail: { briefingId: string };
  DipulMap: { latitude: number; longitude: number; title?: string; mapUrl?: string };
  LocationMap: { latitude: number; longitude: number; title?: string; radiusM?: number; countryIso?: string };
  BrightSkyWeather: { latitude: number; longitude: number; locationName?: string };
};

const Stack = createNativeStackNavigator<BriefingsStackParamList>();

export default function BriefingsStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Briefings"
        component={BriefingsScreen}
        options={({ navigation }) => ({
          headerTitle: "Briefings",
          // Logbuch (Flug-Historie) auch von hier aus erreichbar
          headerRight: () => (
            <Pressable
              testID="briefings-open-logbook"
              accessibilityRole="button"
              accessibilityLabel="Logbuch öffnen"
              hitSlop={8}
              onPress={() => {
                setLogbookOrigin("BriefingsTab");
                navigation.getParent()?.navigate("HistoryTab", { screen: "History" });
              }}
              style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "rgba(74,144,217,0.15)" }, pressed && { opacity: 0.6 }]}
            >
              <Feather name="book-open" size={18} color="#4A90D9" />
              <Text style={{ color: "#4A90D9", fontWeight: "700", fontSize: 15 }}>Logbuch</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="BriefingDetail"
        component={BriefingDetailScreen}
        options={{
          headerTitle: "Briefing Details",
        }}
      />
      <Stack.Screen
        name="DipulMap"
        component={DipulMapScreen}
        options={{
          headerTitle: "dipul Karte",
        }}
      />
      <Stack.Screen
        name="LocationMap"
        component={LocationMapScreen}
        options={{
          headerTitle: "Standort",
        }}
      />
      <Stack.Screen
        name="BrightSkyWeather"
        component={BrightSkyWeatherScreen}
        options={{
          headerTitle: "DWD Wetter",
        }}
      />
    </Stack.Navigator>
  );
}
