import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NavigatorScreenParams } from "@react-navigation/native";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import FlightCheckNavigator from "@/navigation/FlightCheckNavigator";
import FlightPlanningNavigator, { type FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { compactHeader } from "@/components/CompactStackHeader";
import WebPageScreen from "@/screens/WebPageScreen";

export type RootStackParamList = {
  Main: undefined;
  FlightCheck: { sessionId?: string; initialScreen?: "SessionResume" | "HoverCheck" | "DebriefingChecklist" } | undefined;
  FlightPlanning: NavigatorScreenParams<FlightPlanningParamList> | undefined;
  WebPage: { url: string; title?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={{ ...screenOptions, header: compactHeader }}>
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
      <Stack.Screen
        name="WebPage"
        component={WebPageScreen}
        options={{
          headerShown: true,
          headerTransparent: false,
          headerTitleAlign: "left",
          animation: "slide_from_right",
          title: "",
        }}
      />
    </Stack.Navigator>
  );
}
