import React from "react";
import { getLogbookOrigin } from "@/lib/logbookOrigin";
import { compactHeader } from "@/components/CompactStackHeader";
import { HeaderBackButton } from "@react-navigation/elements";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HistoryScreen from "@/screens/HistoryScreen";
import BriefingDetailScreen from "@/screens/BriefingDetailScreen";
import DipulMapScreen from "@/screens/DipulMapScreen";
import LocationMapScreen from "@/screens/LocationMapScreen";
import DjiAnalyzeScreen from "@/screens/DjiAnalyzeScreen";
import DjiBulkImportScreen from "@/screens/DjiBulkImportScreen";
import LogbookEntryDetailScreen from "@/screens/LogbookEntryDetailScreen";
import BatteryDetailScreen from "@/screens/BatteryDetailScreen";
import BatteryStatsScreen from "@/screens/BatteryStatsScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type HistoryStackParamList = {
  History: undefined;
  BriefingDetail: { briefingId: string };
  DipulMap: { latitude: number; longitude: number; title?: string; mapUrl?: string };
  LocationMap: { latitude: number; longitude: number; title?: string; radiusM?: number; countryIso?: string };
  DjiAnalyze: undefined;
  /** autoImportAt: aus den Einstellungen – gemerkten Ordner sofort einlesen */
  DjiBulkImport: { autoImportAt?: number } | undefined;
  LogbookEntryDetail: {
    logbookEntryId?: string;
    sessionId?: string;
    focusSection?: "planning" | "preflight" | "hover" | "postLanding" | "debriefing" | "fluglog";
  };
  BatteryDetail: { droneId: string; batteryId: string };
  BatteryStats: undefined;
};

const Stack = createNativeStackNavigator<HistoryStackParamList>();

export default function HistoryStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={{ ...screenOptions, header: compactHeader }}>
      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={({ navigation }) => ({
          headerTitle: "Logbuch",
          // Logbuch steht nicht in der Tab-Leiste: zurück dorthin, wo es geöffnet wurde
          headerLeft: (props) => (
            <HeaderBackButton
              {...props}
              testID="logbook-back-to-settings"
              onPress={() => navigation.getParent()?.navigate(getLogbookOrigin())}
            />
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
        name="DjiAnalyze"
        component={DjiAnalyzeScreen}
        options={{
          headerTitle: "Fluglog auswerten",
        }}
      />
      <Stack.Screen
        name="DjiBulkImport"
        component={DjiBulkImportScreen}
        options={{
          headerTitle: "Mehrere Fluglogs",
        }}
      />
      <Stack.Screen
        name="LogbookEntryDetail"
        component={LogbookEntryDetailScreen}
        options={{
          headerTitle: "Flugdetails & Fluglog",
        }}
      />
      <Stack.Screen
        name="BatteryDetail"
        component={BatteryDetailScreen}
        options={{
          headerTitle: "Akku-Historie",
        }}
      />
      <Stack.Screen
        name="BatteryStats"
        component={BatteryStatsScreen}
        options={{
          headerTitle: "Akku-Statistik",
        }}
      />
    </Stack.Navigator>
  );
}
