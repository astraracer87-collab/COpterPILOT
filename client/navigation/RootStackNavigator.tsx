import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NavigatorScreenParams } from "@react-navigation/native";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import FlightCheckNavigator from "@/navigation/FlightCheckNavigator";
import FlightPlanningNavigator, { type FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type RootStackParamList = {
  Main: undefined;
  FlightCheck: { sessionId?: string; initialScreen?: "SessionResume" | "HoverCheck" | "DebriefingChecklist" } | undefined;
  FlightPlanning: NavigatorScreenParams<FlightPlanningParamList> | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Main"
        component={MainTabNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="FlightCheck"
        component={FlightCheckNavigator}
        options={{
          presentation: "modal",
          headerShown: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="FlightPlanning"
        component={FlightPlanningNavigator}
        options={{
          presentation: "modal",
          headerShown: false,
          gestureEnabled: false,
        }}
      />
    </Stack.Navigator>
  );
}
