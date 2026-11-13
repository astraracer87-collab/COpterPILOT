import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import BriefingsScreen from "@/screens/BriefingsScreen";
import BriefingDetailScreen from "@/screens/BriefingDetailScreen";
import DipulMapScreen from "@/screens/DipulMapScreen";
import LocationMapScreen from "@/screens/LocationMapScreen";
import BrightSkyWeatherScreen from "@/screens/BrightSkyWeatherScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type BriefingsStackParamList = {
  Briefings: undefined;
  BriefingDetail: { briefingId: string };
  DipulMap: { latitude: number; longitude: number; title?: string; mapUrl?: string };
  LocationMap: { latitude: number; longitude: number; title?: string; radiusM?: number };
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
        options={{
          headerTitle: "Briefings",
        }}
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
