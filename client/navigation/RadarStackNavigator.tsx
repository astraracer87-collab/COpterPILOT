import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import StandaloneLiveTrafficScreen from "@/screens/StandaloneLiveTrafficScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { compactHeader } from "@/components/CompactStackHeader";

export type RadarStackParamList = {
  Radar: undefined;
};

const Stack = createNativeStackNavigator<RadarStackParamList>();

export default function RadarStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={{ ...screenOptions, header: compactHeader }}>
      <Stack.Screen
        name="Radar"
        component={StandaloneLiveTrafficScreen}
        options={{
          headerShown: false,
        }}
      />
    </Stack.Navigator>
  );
}
