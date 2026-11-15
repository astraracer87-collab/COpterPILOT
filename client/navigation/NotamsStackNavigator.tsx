import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import NotamsScreen from "@/screens/NotamsScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type NotamsStackParamList = {
  Notams: { latitude?: number; longitude?: number; locationName?: string } | undefined;
};

const Stack = createNativeStackNavigator<NotamsStackParamList>();

export default function NotamsStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Notams"
        component={NotamsScreen}
        options={{
          headerTitle: "NOTAMs",
          // Kompakte eigene Kopfzeile im Bildschirm (Querformat): kein Stack-Header,
          // damit die Karte den Platz bekommt.
          headerShown: false,
        }}
      />
    </Stack.Navigator>
  );
}
