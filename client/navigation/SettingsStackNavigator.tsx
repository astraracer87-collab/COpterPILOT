import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SettingsScreen from "@/screens/SettingsScreen";
import DronesScreen from "@/screens/DronesScreen";
import DroneSetupScreen from "@/screens/DroneSetupScreen";
import DroneInfoScreen from "@/screens/DroneInfoScreen";
import DroneFoundLinkScreen from "@/screens/DroneFoundLinkScreen";
import DipulWeatherScreen from "@/screens/DipulWeatherScreen";
import DroneHistoryScreen from "@/screens/DroneHistoryScreen";
import LogbookEntryDetailScreen from "@/screens/LogbookEntryDetailScreen";
import BatteryDetailScreen from "@/screens/BatteryDetailScreen";
import ResourceLinksScreen from "@/screens/ResourceLinksScreen";
import GlossaryScreen from "@/screens/GlossaryScreen";
import VlosInfoScreen from "@/screens/VlosInfoScreen";
import EasaReferenceScreen from "@/screens/EasaReferenceScreen";
import EasaRulesScreen from "@/screens/EasaRulesScreen";
import OfflineMapsScreen from "@/screens/OfflineMapsScreen";
import RcOfflineMapsScreen from "@/screens/RcOfflineMapsScreen";
import DataSourcesScreen from "@/screens/DataSourcesScreen";
import CountryInfoScreen from "@/screens/CountryInfoScreen";
import CountryDetailScreen from "@/screens/CountryDetailScreen";
import DflightItalyGuideScreen from "@/screens/DflightItalyGuideScreen";
import NaturschutzMapScreen from "@/screens/NaturschutzMapScreen";
import PilotProfileScreen from "@/screens/PilotProfileScreen";
import PilotLicenseCardScreen from "@/screens/PilotLicenseCardScreen";
import ExpiryOverviewScreen from "@/screens/ExpiryOverviewScreen";
import TcasSettingsScreen from "@/screens/TcasSettingsScreen";
import AccountScreen from "@/screens/AccountScreen";
import PrivacyPolicyScreen from "@/screens/PrivacyPolicyScreen";
import LegalDocumentScreen, { type LegalDocKey } from "@/screens/LegalDocumentScreen";
import MyDataScreen from "@/screens/MyDataScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type SettingsStackParamList = {
  Settings: { openCountryPicker?: boolean } | undefined;
  Account: undefined;
  MyData: undefined;
  PrivacyPolicy: undefined;
  LegalDocument: { doc: LegalDocKey };
  PilotProfile: undefined;
  PilotLicenseCard: undefined;
  ExpiryOverview: undefined;
  TcasSettings: undefined;
  Drones: undefined;
  DroneSetup: { droneId?: string };
  DroneInfo: { droneId: string };
  DroneFoundLink: { droneId: string };
  DipulWeather: undefined;
  DroneHistory: { droneId: string };
  LogbookEntryDetail: {
    sessionId?: string;
    logbookEntryId?: string;
    focusSection?: "planning" | "preflight" | "hover" | "postLanding" | "debriefing" | "fluglog";
  };
  BatteryDetail: { droneId: string; batteryId: string };
  ResourceLinks: undefined;
  Glossary: undefined;
  VlosInfo: undefined;
  EasaReference: undefined;
  EasaRules: undefined;
  OfflineMaps: undefined;
  RcOfflineMaps: undefined;
  DataSources: undefined;
  CountryInfo: undefined;
  CountryDetail: { iso: string };
  DflightItalyGuide: { droneId?: string } | undefined;
  Naturschutz: undefined;
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
        name="Account"
        component={AccountScreen}
        options={{
          headerTitle: "Konto",
        }}
      />
      <Stack.Screen
        name="MyData"
        component={MyDataScreen}
        options={{
          headerTitle: "Meine Daten",
        }}
      />
      <Stack.Screen
        name="PrivacyPolicy"
        component={PrivacyPolicyScreen}
        options={{
          headerTitle: "Datenschutz",
        }}
      />
      <Stack.Screen
        name="LegalDocument"
        component={LegalDocumentScreen}
        options={({ route }) => ({
          headerTitle:
            route.params?.doc === "imprint"
              ? "Impressum"
              : route.params?.doc === "withdrawal"
                ? "Widerrufsbelehrung"
                : "AGB",
        })}
      />
      <Stack.Screen
        name="TcasSettings"
        component={TcasSettingsScreen}
        options={{
          headerTitle: "TCAS - Proximity-Alarm",
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
        name="DroneInfo"
        component={DroneInfoScreen}
        options={{
          headerTitle: "Drohne",
        }}
      />
      <Stack.Screen
        name="DroneFoundLink"
        component={DroneFoundLinkScreen}
        options={{
          headerTitle: "Lost & Found",
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
        name="VlosInfo"
        component={VlosInfoScreen}
        options={{
          headerTitle: "VLOS — Sichtweite",
        }}
      />
      <Stack.Screen
        name="EasaReference"
        component={EasaReferenceScreen}
        options={{
          headerTitle: "EASA — EU-Drohnenregeln",
        }}
      />
      <Stack.Screen
        name="EasaRules"
        component={EasaRulesScreen}
        options={{
          headerTitle: "Easy Access Rules (UAS)",
        }}
      />
      <Stack.Screen
        name="RcOfflineMaps"
        component={RcOfflineMapsScreen}
        options={{ headerTitle: "Karten & Offline" }}
      />
      <Stack.Screen
        name="DataSources"
        component={DataSourcesScreen}
        options={{ headerTitle: "Datenquellen & Lizenzen" }}
      />
      <Stack.Screen
        name="OfflineMaps"
        component={OfflineMapsScreen}
        options={{
          headerTitle: "Offline-Karten",
        }}
      />
      <Stack.Screen
        name="CountryInfo"
        component={CountryInfoScreen}
        options={{
          headerTitle: "Länder",
        }}
      />
      <Stack.Screen
        name="CountryDetail"
        component={CountryDetailScreen}
        options={{
          headerTitle: "Rules & Regulations",
        }}
      />
      <Stack.Screen
        name="DflightItalyGuide"
        component={DflightItalyGuideScreen}
        options={{
          headerTitle: "D-Flight Italien",
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
      <Stack.Screen
        name="ExpiryOverview"
        component={ExpiryOverviewScreen}
        options={{
          headerTitle: "Ablaufende Dokumente",
        }}
      />
    </Stack.Navigator>
  );
}
