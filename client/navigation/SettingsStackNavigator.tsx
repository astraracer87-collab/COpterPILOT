import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SettingsScreen from "@/screens/SettingsScreen";
import WeatherLimitsScreen from "@/screens/WeatherLimitsScreen";
import DronesScreen from "@/screens/DronesScreen";
import DroneSetupScreen from "@/screens/DroneSetupScreen";
import DipulWeatherScreen from "@/screens/DipulWeatherScreen";
import DroneHistoryScreen from "@/screens/DroneHistoryScreen";
import ResourceLinksScreen from "@/screens/ResourceLinksScreen";
import GlossaryScreen from "@/screens/GlossaryScreen";
import NaturschutzMapScreen from "@/screens/NaturschutzMapScreen";
import PilotProfileScreen from "@/screens/PilotProfileScreen";
import PilotLicenseCardScreen from "@/screens/PilotLicenseCardScreen";
import OfflineMapsScreen from "@/screens/OfflineMapsScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type SettingsStackParamList = {
  Settings: undefined;
  PilotProfile: undefined;
  PilotLicenseCard: undefined;
  WeatherLimits: undefined;
  Drones: undefined;
  DroneSetup: { droneId?: string };
  DipulWeather: undefined;
  DroneHistory: { droneId: string };
  ResourceLinks: undefined;
  Glossary: undefined;
  Naturschutz: undefined;
  OfflineMaps: undefined;
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerTitle: "Einstellungen",
        }}
      />
      <Stack.Screen
        name="OfflineMaps"
        component={OfflineMapsScreen}
        options={{
          headerTitle: "Karten & Offline",
        }}
      />
      <Stack.Screen
        name="WeatherLimits"
        component={WeatherLimitsScreen}
        options={{
          headerTitle: "Wettergrenzen",
        }}
      />
      <Stack.Screen
        name="Drones"
        component={DronesScreen}
        options={{
          headerTitle: "Meine Drohnen",
        }}
      />
      <Stack.Screen
        name="DroneSetup"
        component={DroneSetupScreen}
        options={{
          headerTitle: "Drohne einrichten",
        }}
      />
      <Stack.Screen
        name="DipulWeather"
        component={DipulWeatherScreen}
        options={{
          headerTitle: "Wetter (dipul)",
        }}
      />
      <Stack.Screen
        name="DroneHistory"
        component={DroneHistoryScreen}
        options={{
          headerTitle: "Drohnen-Historie",
        }}
      />
      <Stack.Screen
        name="ResourceLinks"
        component={ResourceLinksScreen}
        options={{
          headerTitle: "Nützliche Links",
        }}
      />
      <Stack.Screen
        name="Glossary"
        component={GlossaryScreen}
        options={{
          headerTitle: "Glossar",
        }}
      />
      <Stack.Screen
        name="Naturschutz"
        component={NaturschutzMapScreen}
        options={{
          headerTitle: "Naturschutzgebiete",
        }}
      />
      <Stack.Screen
        name="PilotProfile"
        component={PilotProfileScreen}
        options={{
          headerTitle: "Pilotenprofil",
        }}
      />
      <Stack.Screen
        name="PilotLicenseCard"
        component={PilotLicenseCardScreen}
        options={{
          headerTitle: "Mein Führerschein",
        }}
      />
    </Stack.Navigator>
  );
}
