import React, { useEffect } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { useNavigation, useRoute, CommonActions } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { getFlightSession, getDrone } from "@/lib/storage";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<FlightCheckParamList, "SessionResume">;
type RootNavProp = NativeStackNavigationProp<RootStackParamList>;
type RouteParams = RouteProp<FlightCheckParamList, "SessionResume">;

export default function SessionResumeScreen() {
  const navigation = useNavigation<NavigationProp>();
  const rootNav = useNavigation<RootNavProp>();
  const route = useRoute<RouteParams>();
  const { theme } = useTheme();
  const { sessionId } = route.params;

  useEffect(() => {
    loadSessionAndNavigate();
  }, [sessionId]);

  const loadSessionAndNavigate = async () => {
    try {
      const session = await getFlightSession(sessionId);
      if (!session) {
        rootNav.navigate("Main");
        return;
      }

      const drone = await getDrone(session.droneId);
      if (!drone) {
        rootNav.navigate("Main");
        return;
      }

      const { latitude, longitude, hasRestrictions, restrictionNotes, currentPhase } = session;
      const droneId = session.droneId;
      const limits = drone.limits;

      switch (currentPhase) {
        case "planning":
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [
                {
                  name: "Map",
                  params: { latitude, longitude, droneId },
                },
              ],
            })
          );
          break;

        case "preflight":
          if (session.planning) {
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [
                  {
                    name: "PreCheckOverview",
                    params: {
                      sessionId,
                      latitude,
                      longitude,
                      locationName: session.locationName,
                      droneId,
                    },
                  },
                ],
              })
            );
          } else {
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [
                  {
                    name: "Map",
                    params: { latitude, longitude, droneId, sessionId },
                  },
                ],
              })
            );
          }
          break;

        case "hover":
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [
                {
                  name: "HoverCheck",
                  params: { sessionId },
                },
              ],
            })
          );
          break;

        case "postlanding":
        case "debriefing":
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [
                {
                  name: "DebriefingChecklist",
                  params: { sessionId },
                },
              ],
            })
          );
          break;

        default:
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [
                {
                  name: "Map",
                  params: { latitude, longitude, droneId },
                },
              ],
            })
          );
      }
    } catch (error) {
      console.error("Failed to load session:", error);
      rootNav.navigate("Main");
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        <ActivityIndicator size="large" color={theme.primary} />
        <ThemedText style={[styles.text, { color: theme.textSecondary }]}>
          Session wird geladen...
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    gap: Spacing.lg,
  },
  text: {
    fontSize: 16,
  },
});
