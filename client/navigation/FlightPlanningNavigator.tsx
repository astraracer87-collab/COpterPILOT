import React, { useEffect } from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { setFlightPlanningMode } from "@/lib/flightPlanningMode";
import { decidePlanningBackAction } from "@/lib/manualRestrictionFlow";
import { WeatherSnapshot, WeatherLimits } from "@/lib/storage";
import PlanningDroneSelectScreen from "@/screens/PlanningDroneSelectScreen";
import PlanningCountrySelectScreen from "@/screens/PlanningCountrySelectScreen";
import PlanningLocationScreen from "@/screens/PlanningLocationScreen";
import PlanningCrossCheckScreen from "@/screens/PlanningCrossCheckScreen";
import PlanningMapScreen from "@/screens/PlanningMapScreen";
import PlanningDateTimeScreen from "@/screens/PlanningDateTimeScreen";
import PlanningRestrictionsScreen from "@/screens/PlanningRestrictionsScreen";
import PlanningDetailsScreen from "@/screens/PlanningDetailsScreen";
import PlanningFpvSelectScreen from "@/screens/PlanningFpvSelectScreen";
import PlanningChecklistScreen from "@/screens/PlanningChecklistScreen";
import PlanningResultScreen from "@/screens/PlanningResultScreen";
import PlanningNotamsScreen from "@/screens/PlanningNotamsScreen";
import StandaloneLiveTrafficScreen from "@/screens/StandaloneLiveTrafficScreen";
import PlanningNotamMapScreen from "@/screens/PlanningNotamMapScreen";
import PlanningZoneFocusScreen from "@/screens/PlanningZoneFocusScreen";
import NaturschutzMapScreen from "@/screens/NaturschutzMapScreen";
import GoDroneMapScreen from "@/screens/GoDroneMapScreen";
import PlanningExternalMapScreen from "@/screens/PlanningExternalMapScreen";
import DflightItalyGuideScreen from "@/screens/DflightItalyGuideScreen";

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
  /** Eigener Gegenprüfungs-Schritt (offizielle Staatskarte) zwischen Standort
   *  und Datum/Zeit — nur für Länder MIT eigenen Geozonen-Daten, wenn die
   *  Einstellung officialMapCrossCheck aktiv ist. */
  PlanningCrossCheck: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
    radiusKm: number;
    recommendedVlosM?: number;
    vlosExceeded?: boolean;
    vlosCharDimensionM?: number;
    vlosAltitudeCorrection?: boolean;
    vlosHorizontalLimitM?: number;
    /** Geplante Flughöhe (AGL, m) – bereits im Standort-Schritt gewählt. */
    maxAltitude?: number;
    /** Durchgereichte manuelle Einschränkungs-Bewertung (i.d.R. leer für
     *  Länder mit eigenen Daten, aber defensiv weitergegeben). */
    restrictionStatus?: "approved" | "limited";
    restrictionNotes?: string;
  };
  PlanningDateTime: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
    radiusKm: number;
    recommendedVlosM?: number;
    vlosExceeded?: boolean;
    vlosCharDimensionM?: number;
    vlosAltitudeCorrection?: boolean;
    vlosHorizontalLimitM?: number;
    routeWaypoints?: { latitude: number; longitude: number }[];
    sessionId?: string;
    /** Geplante Flughöhe (AGL, m) – bereits im Standort-Schritt gewählt. */
    maxAltitude?: number;
    /** Manuell im Standort-Schritt erfasste Einschränkungs-Bewertung für
     *  Länder ohne eigene Geozonen-Daten (Pilot prüft offizielle Karte selbst). */
    restrictionStatus?: "approved" | "limited";
    restrictionNotes?: string;
    /** Gegenprüfung der offiziellen Staatskarte für Länder MIT eigenen Daten
     *  (separat von restrictionStatus; beeinflusst die Auto-Erkennung nicht). */
    officialMapCrossCheck?: { blocking: boolean; note?: string };
    /** Direkteinstieg (Fortsetzen/Bearbeiten aus den Briefings): "Zurück"
     *  verlässt dann das ganze Modal statt auf einen nie gesehenen Schritt zu
     *  springen. Siehe decidePlanningBackAction. */
    directEntry?: boolean;
  };
  PlanningRestrictions: {
    droneId: string;
    latitude: number;
    longitude: number;
    locationName?: string;
    countryIso?: string;
    mapUrl?: string;
    radiusKm?: number;
    recommendedVlosM?: number;
    vlosExceeded?: boolean;
    vlosCharDimensionM?: number;
    vlosAltitudeCorrection?: boolean;
    vlosHorizontalLimitM?: number;
    plannedDate?: string;
    plannedTime?: string;
    endTime?: string;
    routeWaypoints?: { latitude: number; longitude: number }[];
    sessionId?: string;
    /** Geplante Flughöhe (AGL, m) – bereits im Standort-Schritt gewählt. */
    maxAltitude?: number;
    /** Manuell im Standort-Schritt erfasste Einschränkungs-Bewertung für
     *  Länder ohne eigene Geozonen-Daten — die Einschränkungs-Stufe fragt
     *  dann nicht erneut nach. */
    restrictionStatus?: "approved" | "limited";
    restrictionNotes?: string;
    /** Gegenprüfung der offiziellen Staatskarte (Länder mit eigenen Daten). */
    officialMapCrossCheck?: { blocking: boolean; note?: string };
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
    /** Höchstes Policy-Urteil der Geozonen (nogo = Flugverbot ohne Begründung). */
    restrictionVerdict?: "nogo" | "caution" | "info";
    /** Gegenprüfung der offiziellen Staatskarte (Länder mit eigenen Daten). */
    officialMapCrossCheck?: { blocking: boolean; note?: string };
    /** Pilot hat in FR mit MTOM >= 800 g bestätigt fortzufahren OBWOHL
     *  keine AlphaTango-ID an der Drohne hinterlegt war. */
    alphaTangoMissingAcknowledged?: boolean;
    sessionId?: string;
    radiusKm?: number;
    recommendedVlosM?: number;
    vlosExceeded?: boolean;
    vlosCharDimensionM?: number;
    vlosAltitudeCorrection?: boolean;
    vlosHorizontalLimitM?: number;
    plannedDate?: string;
    plannedTime?: string;
    endTime?: string;
    routeWaypoints?: { latitude: number; longitude: number }[];
    /** Geplante Flughöhe (AGL, m) – bereits im Standort-Schritt gewählt. */
    maxAltitude?: number;
    /** Direkteinstieg (Fortsetzen/Bearbeiten aus den Briefings): "Zurück"
     *  verlässt dann das ganze Modal. Siehe decidePlanningBackAction. */
    directEntry?: boolean;
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
    /** FPV-Modus: "spotter" (Standard, bis 120 m) oder "verband30m" (DMFV/DMO Art.16, max. 30 m, ohne Spotter). */
    fpvMode?: "spotter" | "verband30m";
    sessionId: string;
    editMode?: boolean;
    existingChecked?: string[];
    /** Direkteinstieg (Fortsetzen/Bearbeiten aus den Briefings): "Zurück"
     *  verlässt dann das ganze Modal. Siehe decidePlanningBackAction. */
    directEntry?: boolean;
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
    fpvMode?: "spotter" | "verband30m";
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
  PlanningZoneFocus: {
    zone: import("@/lib/geozones").GeozoneFeatureInfo;
    latitude: number;
    longitude: number;
    radiusKm?: number;
    countryIso?: string;
  };
  PlanningNaturschutz: undefined;
  PlanningGoDrone: {
    latitude?: number;
    longitude?: number;
  };
  PlanningExternalMap: {
    url: string;
    title: string;
    latitude?: number;
    longitude?: number;
  };
  PlanningDflightItalyGuide: { droneId?: string } | undefined;
};

const Stack = createNativeStackNavigator<FlightPlanningParamList>();

// "Zurück" für Screens, die auch per Direkteinstieg (Fortsetzen/Bearbeiten aus
// den Briefings) angesprungen werden können. Beim Direkteinstieg verlässt
// "Zurück" das ganze Modal statt auf einen nie gesehenen Schritt zu springen.
function PlanningHeaderBackButton({
  navigation,
  directEntry,
}: {
  navigation: any;
  directEntry?: boolean;
}) {
  const onPress = () => {
    const parent = navigation.getParent?.();
    const action = decidePlanningBackAction({
      directEntry: directEntry === true,
      hasParent: !!parent,
      parentCanGoBack: parent?.canGoBack?.() ?? false,
      selfCanGoBack: navigation.canGoBack?.() ?? false,
    });
    if (action === "parentGoBack") {
      parent?.goBack();
    } else if (action === "selfGoBack") {
      navigation.goBack();
    }
  };
  return (
    <Pressable onPress={onPress} style={navStyles.backButton} hitSlop={8}>
      <Text style={navStyles.backText}>Zurück</Text>
    </Pressable>
  );
}

export default function FlightPlanningNavigator() {
  const screenOptions = useScreenOptions();

  useEffect(() => {
    return () => {
      setFlightPlanningMode("planning");
    };
  }, []);

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
        name="PlanningCrossCheck"
        component={PlanningCrossCheckScreen}
        options={({ navigation }) => ({
          headerTitle: "Gegenprüfung",
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
        options={({ navigation, route }) => ({
          headerTitle: "Datum & Zeit",
          headerLeft: () => (
            <PlanningHeaderBackButton
              navigation={navigation}
              directEntry={route.params?.directEntry}
            />
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
        options={({ navigation, route }) => ({
          headerTitle: "Flugdetails",
          headerLeft: () => (
            <PlanningHeaderBackButton
              navigation={navigation}
              directEntry={route.params?.directEntry}
            />
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
        options={({ navigation, route }) => ({
          headerTitle: "Vorab-Checkliste",
          headerLeft: () => (
            <PlanningHeaderBackButton
              navigation={navigation}
              directEntry={route.params?.directEntry}
            />
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
        component={StandaloneLiveTrafficScreen}
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
        name="PlanningZoneFocus"
        component={PlanningZoneFocusScreen}
        options={({ navigation }) => ({
          headerTitle: "Zone auf Karte",
          headerTransparent: true,
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
        name="PlanningNaturschutz"
        component={NaturschutzMapScreen}
        options={{
          headerTitle: "Naturschutzgebiete",
        }}
      />
      <Stack.Screen
        name="PlanningGoDrone"
        component={GoDroneMapScreen}
        options={{
          headerTitle: "GoDrone",
        }}
      />
      <Stack.Screen
        name="PlanningExternalMap"
        component={PlanningExternalMapScreen}
        options={{
          headerTitle: "Karte",
        }}
      />
      <Stack.Screen
        name="PlanningDflightItalyGuide"
        component={DflightItalyGuideScreen}
        options={({ navigation }) => ({
          headerTitle: "D-Flight Italien",
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
