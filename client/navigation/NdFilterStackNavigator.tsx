import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import NdFilterFinderScreen from "@/screens/NdFilterFinderScreen";
import DroneCinematicScreen from "@/screens/DroneCinematicScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type NdFilterStackParamList = {
  NdFilterFinder: {
    latitude?: number;
    longitude?: number;
    cloudCoverPercent?: number;
    rainMmPerH?: number;
    droneId?: string;
  } | undefined;
  DroneCinematic: {
    droneId?: string;
    model?: string;
    droneName?: string;
    initialView?: "settings" | "moves";
  };
};

const Stack = createNativeStackNavigator<NdFilterStackParamList>();

export default function NdFilterStackNavigator() {
  const screenOptions = useScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="NdFilterFinder"
        component={NdFilterFinderScreen}
        options={{ headerTitle: "ND-Filter Finder" }}
      />
      <Stack.Screen
        name="DroneCinematic"
        component={DroneCinematicScreen}
        options={{ headerTitle: "Cinematic-Einstellungen" }}
      />
    </Stack.Navigator>
  );
}
