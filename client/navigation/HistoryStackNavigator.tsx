import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HistoryScreen from "@/screens/HistoryScreen";
import BriefingDetailScreen from "@/screens/BriefingDetailScreen";
import DipulMapScreen from "@/screens/DipulMapScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type HistoryStackParamList = {
  History: undefined;
  BriefingDetail: { briefingId: string };
  DipulMap: { latitude: number; longitude: number; title?: string; mapUrl?: string };
};

const Stack = createNativeStackNavigator<HistoryStackParamList>();

export default function HistoryStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={{
          headerTitle: "Logbuch",
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
    </Stack.Navigator>
  );
}
