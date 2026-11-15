import React from "react";
import type { RestrictionVerdict } from "../../shared/restrictionPolicy";
import { Pressable, Text, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useRoute, RouteProp } from "@react-navigation/native";
import DroneSelectScreen from "@/screens/DroneSelectScreen";
import CountrySelectScreen from "@/screens/CountrySelectScreen";
import LocationPickerScreen from "@/screens/LocationPickerScreen";
import ChecklistScreen from "@/screens/ChecklistScreen";
import MapScreen from "@/screens/MapScreen";
import RestrictionsScreen from "@/screens/RestrictionsScreen";
import WeatherScreen from "@/screens/WeatherScreen";
import ResultsScreen from "@/screens/ResultsScreen";
import SessionResumeScreen from "@/screens/SessionResumeScreen";
import DebriefingChecklistScreen from "@/screens/DebriefingChecklistScreen";
import FlightCheckScreen from "@/screens/FlightCheckScreen";
import FpvSelectScreen from "@/screens/FpvSelectScreen";
import PreCheckOverviewScreen from "@/screens/PreCheckOverviewScreen";
import StandaloneLiveTrafficScreen from "@/screens/StandaloneLiveTrafficScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import type { WeatherLimits, BatteryUsage } from "@/lib/storage";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

export type FlightCheckParamList = {
  SessionResume: { sessionId: string };
  PreCheckOverview: {
    sessionId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    droneId: string;
  };
  DroneSelect: undefined;
  CountrySelect: { droneId: string; sessionId?: string; latitude?: number; longitude?: number };
  LocationPicker: { latitude: number; longitude: number; droneId: string; sessionId?: string; countryIso?: string };
  Map: { latitude: number; longitude: number; droneId: string; sessionId?: string; countryIso?: string; pilotElevation?: number };
  Restrictions: { latitude: number; longitude: number; droneId: string; sessionId?: string };
  Weather: { latitude: number; longitude: number; hasRestrictions: boolean; restrictionStatus?: "approved" | "limited"; restrictionNotes?: string; restrictionVerdict?: RestrictionVerdict; droneId: string; sessionId?: string };
  FpvSelect: { 
    latitude: number; 
    longitude: number; 
    hasRestrictions: boolean; 
    restrictionStatus?: "approved" | "limited";
    restrictionNotes?: string;
    /** Höchstes Policy-Urteil der Geozonen (nogo = Flugverbot aktiv). */
    restrictionVerdict?: RestrictionVerdict;
    weatherData: any;
    droneId: string;
    limits: WeatherLimits;
    sessionId?: string;
    kpIndex?: number;
  };
  Checklist: { 
    latitude: number; 
    longitude: number; 
    hasRestrictions: boolean; 
    restrictionStatus?: "approved" | "limited";
    restrictionNotes?: string;
    /** Höchstes Policy-Urteil der Geozonen (nogo = Flugverbot aktiv). */
    restrictionVerdict?: RestrictionVerdict;
    weatherData: any;
    droneId: string;
    limits: WeatherLimits;
    sessionId?: string;
    isFpvFlight?: boolean;
    /** FPV-Modus: "spotter" (Standard, bis 120 m) oder "verband30m" (DMFV/DMO Art.16, max. 30 m, ohne Spotter). */
    fpvMode?: "spotter" | "verband30m";
    kpIndex?: number;
  };
  Results: { 
    latitude: number; 
    longitude: number; 
    hasRestrictions: boolean; 
    restrictionStatus?: "approved" | "limited";
    restrictionNotes?: string;
    /** Höchstes Policy-Urteil der Geozonen (nogo = Flugverbot aktiv). */
    restrictionVerdict?: RestrictionVerdict;
    weatherData: any;
    droneId: string;
    limits: WeatherLimits;
    sessionId?: string;
    checklistCompleted?: string[];
    checklistPresented?: string[];
    batteryUsage?: BatteryUsage[];
    isFpvFlight?: boolean;
    fpvMode?: "spotter" | "verband30m";
    kpIndex?: number;
  };
  DebriefingChecklist: {
    sessionId: string;
  };
  HoverCheck: {
    sessionId: string;
  };
  LiveRadar: undefined;
};

const Stack = createNativeStackNavigator<FlightCheckParamList>();

export default function FlightCheckNavigator() {
  const screenOptions = useScreenOptions();
  const route = useRoute<RouteProp<RootStackParamList, "FlightCheck">>();
  const sessionId = route.params?.sessionId;
  const initialScreen = route.params?.initialScreen;

  const getInitialRouteName = (): keyof FlightCheckParamList => {
    if (initialScreen === "DebriefingChecklist") return "DebriefingChecklist";
    if (initialScreen === "HoverCheck") return "HoverCheck";
    if (sessionId) return "SessionResume";
    return "DroneSelect";
  };

  const initialRoute = getInitialRouteName();
  
  return (
    <Stack.Navigator 
      key={`${sessionId}-${initialRoute}`}
      screenOptions={screenOptions}
      initialRouteName={initialRoute}
    >
      <Stack.Screen
        name="SessionResume"
        component={SessionResumeScreen}
        initialParams={sessionId ? { sessionId } : undefined}
        options={{
          headerTitle: "Laden...",
        }}
      />
      <Stack.Screen
        name="PreCheckOverview"
        component={PreCheckOverviewScreen}
        options={({ navigation }) => ({
          headerTitle: "Pre-Check",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.getParent()?.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="DroneSelect"
        component={DroneSelectScreen}
        options={({ navigation }) => ({
          headerTitle: "Drohne auswählen",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.getParent()?.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="CountrySelect"
        component={CountrySelectScreen}
        options={({ navigation }) => ({
          headerTitle: "Land auswählen",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="LocationPicker"
        component={LocationPickerScreen}
        options={({ navigation }) => ({
          headerTitle: "Standort wählen",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="Map"
        component={MapScreen}
        options={({ navigation }) => ({
          headerTitle: "Bitte Flugzone prüfen",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="Restrictions"
        component={RestrictionsScreen}
        options={({ navigation }) => ({
          headerTitle: "Einschränkungen",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="Weather"
        component={WeatherScreen}
        options={({ navigation }) => ({
          headerTitle: "Wetter",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="FpvSelect"
        component={FpvSelectScreen}
        options={({ navigation }) => ({
          headerTitle: "Flugmodus",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="Checklist"
        component={ChecklistScreen}
        options={({ navigation }) => ({
          headerTitle: "Pre-Check",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="Results"
        component={ResultsScreen}
        options={{
          headerTitle: "Bewertung",
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="DebriefingChecklist"
        component={DebriefingChecklistScreen}
        initialParams={sessionId ? { sessionId } : undefined}
        options={{
          headerTitle: "Debriefing",
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="HoverCheck"
        component={FlightCheckScreen}
        initialParams={sessionId ? { sessionId } : undefined}
        options={{
          headerTitle: "Flight-Check",
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="LiveRadar"
        component={StandaloneLiveTrafficScreen}
        options={({ navigation }) => ({
          headerTitle: "Live Radar",
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.goBack()}
              style={navStyles.backButton}
              hitSlop={8}
            >
              <Text style={navStyles.backText}>Zurück</Text>
            </Pressable>
          ),
        })}
      />
    </Stack.Navigator>
  );
}

const navStyles = StyleSheet.create({
  cancelButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  cancelText: {
    color: "#007AFF",
    fontSize: 17,
  },
  backButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  backText: {
    color: "#007AFF",
    fontSize: 17,
  },
});
