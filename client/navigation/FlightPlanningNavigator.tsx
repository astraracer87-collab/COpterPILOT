import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { WeatherSnapshot, WeatherLimits } from "@/lib/storage";
import PlanningDroneSelectScreen from "@/screens/PlanningDroneSelectScreen";
import PlanningCountrySelectScreen from "@/screens/PlanningCountrySelectScreen";
import PlanningLocationScreen from "@/screens/PlanningLocationScreen";
import PlanningMapScreen from "@/screens/PlanningMapScreen";
import PlanningDateTimeScreen from "@/screens/PlanningDateTimeScreen";
import PlanningRestrictionsScreen from "@/screens/PlanningRestrictionsScreen";
import PlanningDetailsScreen from "@/screens/PlanningDetailsScreen";
import PlanningFpvSelectScreen from "@/screens/PlanningFpvSelectScreen";
import PlanningChecklistScreen from "@/screens/PlanningChecklistScreen";
import PlanningResultScreen from "@/screens/PlanningResultScreen";
import PlanningNotamsScreen from "@/screens/PlanningNotamsScreen";
import PlanningLiveTrafficScreen from "@/screens/PlanningLiveTrafficScreen";
import PlanningNotamMapScreen from "@/screens/PlanningNotamMapScreen";
import NaturschutzMapScreen from "@/screens/NaturschutzMapScreen";

export type FlightPlanningParamList = {
  PlanningDroneSelect: undefined;
  PlanningCountrySelect: {
    droneId: string;
  };
  PlanningLocation: {
    droneId: string;
    countryIso?: string;
  };
  PlanningMap: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
  };
  PlanningDateTime: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
    radiusKm: number;
    routeWaypoints?: { latitude: number; longitude: number }[];
  };
  PlanningRestrictions: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
    mapUrl?: string;
    radiusKm?: number;
    plannedDate?: string;
    plannedTime?: string;
    endTime?: string;
    routeWaypoints?: { latitude: number; longitude: number }[];
  };
  PlanningDetails: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
    mapUrl?: string;
    hasRestrictions?: boolean;
    restrictionStatus?: "approved" | "limited";
    restrictionNotes?: string;
    sessionId?: string;
    radiusKm?: number;
    plannedDate?: string;
    plannedTime?: string;
    endTime?: string;
    routeWaypoints?: { latitude: number; longitude: number }[];
  };
  PlanningFpvSelect: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
    mapUrl?: string;
    plannedDate: string;
    plannedTime: string;
    forecastWeather?: WeatherSnapshot;
    limits: WeatherLimits;
    maxAltitude?: number;
    sessionId: string;
  };
  PlanningChecklist: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
    mapUrl?: string;
    plannedDate: string;
    plannedTime: string;
    forecastWeather?: WeatherSnapshot;
    limits: WeatherLimits;
    maxAltitude?: number;
    isFpvFlight: boolean;
    sessionId: string;
    editMode?: boolean;
    existingChecked?: string[];
  };
  PlanningResult: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
    mapUrl?: string;
    plannedDate: string;
    plannedTime: string;
    forecastWeather?: WeatherSnapshot;
    limits: WeatherLimits;
    maxAltitude?: number;
    checklistCompleted: string[];
    checklistPresented?: string[];
    isFpvFlight: boolean;
    sessionId: string;
  };
  PlanningNotams: {
    latitude: number;
    longitude: number;
    locationName?: string;
    plannedDate?: string;
    plannedTime?: string;
    radiusKm?: number;
    routeWaypoints?: { latitude: number; longitude: number }[];
  };
  PlanningLiveTraffic: {
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
  };
  PlanningNotamMap: {
    latitude: number;
    longitude: number;
    restrictions?: import("@/lib/geozones").DipulTempRestriction[];
    routeWaypoints?: { latitude: number; longitude: number }[];
    milStatuses?: import("@/lib/milLowFlight").MilLowFlightAreaStatus[];
  };
  PlanningNaturschutz: undefined;
};

const Stack = createNativeStackNavigator<FlightPlanningParamList>();

export default function FlightPlanningNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="PlanningDroneSelect"
        component={PlanningDroneSelectScreen}
        options={({ navigation }) => ({
          headerTitle: "Flugplanung",
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
        name="PlanningCountrySelect"
        component={PlanningCountrySelectScreen}
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
        name="PlanningLocation"
        component={PlanningLocationScreen}
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
        name="PlanningDateTime"
        component={PlanningDateTimeScreen}
        options={({ navigation }) => ({
          headerTitle: "Datum & Zeit",
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
        name="PlanningMap"
        component={PlanningMapScreen}
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
        name="PlanningRestrictions"
        component={PlanningRestrictionsScreen}
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
        name="PlanningDetails"
        component={PlanningDetailsScreen}
        options={({ navigation }) => ({
          headerTitle: "Flugdetails",
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
        name="PlanningFpvSelect"
        component={PlanningFpvSelectScreen}
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
        name="PlanningChecklist"
        component={PlanningChecklistScreen}
        options={({ navigation }) => ({
          headerTitle: "Vorab-Checkliste",
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
        name="PlanningResult"
        component={PlanningResultScreen}
        options={{
          headerTitle: "Planung abgeschlossen",
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="PlanningNotams"
        component={PlanningNotamsScreen}
        options={({ navigation }) => ({
          headerTitle: "NOTAMs",
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
        name="PlanningLiveTraffic"
        component={PlanningLiveTrafficScreen}
        options={({ navigation }) => ({
          headerTitle: "Live Flugverkehr",
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
        name="PlanningNotamMap"
        component={PlanningNotamMapScreen}
        options={{
          headerTitle: "NOTAM-Karte",
        }}
      />
      <Stack.Screen
        name="PlanningNaturschutz"
        component={NaturschutzMapScreen}
        options={{
          headerTitle: "Naturschutzgebiete",
        }}
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
