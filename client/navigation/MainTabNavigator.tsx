import React, { useState, useRef, useEffect } from "react";
import { View, StyleSheet, Pressable, Alert, Modal, TouchableOpacity, Animated, useWindowDimensions } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "@/lib/noHaptics";
import BriefingsStackNavigator from "@/navigation/BriefingsStackNavigator";
import HistoryStackNavigator from "@/navigation/HistoryStackNavigator";
import NotamsStackNavigator from "@/navigation/NotamsStackNavigator";
import NdFilterStackNavigator from "@/navigation/NdFilterStackNavigator";
import RadarStackNavigator from "@/navigation/RadarStackNavigator";
import SettingsStackNavigator from "@/navigation/SettingsStackNavigator";
import ChargerStackNavigator, { type ChargerStackParamList } from "@/navigation/ChargerStackNavigator";
import { ChargerTabIcon } from "@/components/ChargerTabIcon";
import { ChargerLeaveDialog } from "@/components/charger/ChargerLeaveDialog";
import { useChargerAppStateHandling } from "@/hooks/useCharger";
import type { NavigatorScreenParams } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { getDrones } from "@/lib/storage";
import { RadarTabIcon, RadarTabLabel } from "@/components/RadarTabIcon";
import { subscribeActiveNotamCount } from "@/lib/notamAlertStore";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { setFlightPlanningMode } from "@/lib/flightPlanningMode";
import { MainTabBar, getMainTabBarHeight, withContentAboveTabBar } from "@/navigation/MainTabBar";

// Inhalt der Tabs endet oberhalb der (nicht mehr schwebenden) Tab-Leiste.
const BriefingsTabScreen = withContentAboveTabBar(BriefingsStackNavigator);
const RadarTabScreen = withContentAboveTabBar(RadarStackNavigator);
const NotamsTabScreen = withContentAboveTabBar(NotamsStackNavigator);
const HistoryTabScreen = withContentAboveTabBar(HistoryStackNavigator);
const NdFilterTabScreen = withContentAboveTabBar(NdFilterStackNavigator);
const ChargerTabScreen = withContentAboveTabBar(ChargerStackNavigator);
const SettingsTabScreen = withContentAboveTabBar(SettingsStackNavigator);

export type MainTabParamList = {
  BriefingsTab: undefined;
  RadarTab: undefined;
  NotamsTab: undefined;
  HistoryTab: undefined;
  NdFilterTab: undefined;
  ChargerTab: NavigatorScreenParams<ChargerStackParamList> | undefined;
  SettingsTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

interface ChooserModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectPlanning: () => void;
  onSelectPreflight: () => void;
}

function ChooserModal({ 
  visible, 
  onClose, 
  onSelectPlanning, 
  onSelectPreflight,
}: ChooserModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const isProcessingRef = useRef(false);

  const handlePlanning = () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    onSelectPlanning();
  };

  const handlePreflight = () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    onSelectPreflight();
  };
  
  React.useEffect(() => {
    if (visible) {
      isProcessingRef.current = false;
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <TouchableOpacity 
          style={styles.modalBackdrop} 
          activeOpacity={1} 
          onPress={onClose}
        />
        <View 
          style={[
            styles.modalSheet, 
            { 
              backgroundColor: theme.backgroundDefault,
              paddingBottom: insets.bottom + Spacing.lg,
            }
          ]}
        >
          <View style={styles.modalHandle} />
          
          <ThemedText style={styles.modalTitle}>Neuer Flug</ThemedText>
          <ThemedText style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
            Wähle den gewünschten Modus
          </ThemedText>


          <View style={styles.optionsContainer}>
            <TouchableOpacity
              onPress={handlePlanning}
              activeOpacity={0.7}
            >
              <Card style={styles.optionCard}>
                <View style={[styles.optionIcon, { backgroundColor: theme.statusCautionBackground }]}>
                  <Feather name="calendar" size={28} color={theme.statusCaution} />
                </View>
                <View style={styles.optionContent}>
                  <ThemedText style={styles.optionTitle}>Flugplanung</ThemedText>
                  <ThemedText style={[styles.optionDescription, { color: theme.textSecondary }]}>
                    Vorab-Checkliste (1 Tag zuvor)
                  </ThemedText>
                </View>
                <Feather name="chevron-right" size={20} color={theme.textTertiary} />
              </Card>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handlePreflight}
              activeOpacity={0.7}
            >
              <Card style={styles.optionCard}>
                <View style={[styles.optionIcon, { backgroundColor: theme.statusGoBackground }]}>
                  <Feather name="navigation" size={28} color={theme.statusGo} />
                </View>
                <View style={styles.optionContent}>
                  <ThemedText style={styles.optionTitle}>Pre-Flight Check</ThemedText>
                  <ThemedText style={[styles.optionDescription, { color: theme.textSecondary }]}>
                    Vor dem Start (am Abflugort)
                  </ThemedText>
                </View>
                <Feather name="chevron-right" size={20} color={theme.textTertiary} />
              </Card>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={onClose}
            style={[styles.cancelButton, { backgroundColor: theme.backgroundSecondary }]}
            activeOpacity={0.7}
          >
            <ThemedText style={[styles.cancelButtonText, { color: theme.textSecondary }]}>
              Abbrechen
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function TabBarIcon({ name, focused }: { name: keyof typeof Feather.glyphMap; focused: boolean }) {
  const { theme } = useTheme();
  return (
    <Feather
      name={name}
      size={24}
      color={focused ? theme.primary : theme.textTertiary}
    />
  );
}

function NotamsTabIcon({ focused }: { focused: boolean }) {
  const { theme } = useTheme();
  const [activeCount, setActiveCount] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const unsub = subscribeActiveNotamCount(setActiveCount);
    return unsub;
  }, []);

  useEffect(() => {
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }
    if (activeCount > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      animRef.current = loop;
      loop.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => {
      if (animRef.current) { animRef.current.stop(); animRef.current = null; }
    };
  }, [activeCount]);

  const isAlert = activeCount > 0;
  const alertColor = "#FF3B30";
  const iconColor = isAlert ? alertColor : (focused ? theme.primary : theme.textTertiary);
  const badgeText = activeCount > 99 ? "99+" : String(activeCount);

  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      {isAlert ? (
        <Animated.View style={{
          position: "absolute",
          width: 34,
          height: 34,
          borderRadius: 17,
          borderWidth: 2,
          borderColor: alertColor,
          backgroundColor: "transparent",
          opacity: pulseAnim.interpolate({ inputRange: [0.3, 1], outputRange: [0.35, 1] }),
        }} />
      ) : null}
      <Animated.View style={isAlert ? { opacity: pulseAnim } : undefined}>
        <Feather name="alert-circle" size={24} color={iconColor} />
      </Animated.View>
      {isAlert ? (
        <View style={{
          position: "absolute",
          top: -4,
          right: -10,
          minWidth: 18,
          height: 18,
          paddingHorizontal: 4,
          borderRadius: 9,
          backgroundColor: alertColor,
          alignItems: "center",
          justifyContent: "center",
        }}>
          <ThemedText style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "700" }}>
            {badgeText}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function FloatingFab() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [showChooser, setShowChooser] = useState(false);

  // Auswahl sofort öffnen; die Drohnen-Prüfung läuft danach (sonst wartet der
  // Tipp auf den Speicher, während z. B. ein Download läuft)
  const handlePress = async () => {
    setShowChooser(true);
    const drones = await getDrones().catch(() => [] as Awaited<ReturnType<typeof getDrones>>);
    if (drones.length === 0) {
      setShowChooser(false);
      Alert.alert(
        "Keine Drohne angelegt",
        "Bitte lege zuerst eine Drohne an, bevor du starten kannst.",
        [
          { text: "Abbrechen", style: "cancel" },
          { 
            text: "Drohne anlegen", 
            onPress: () => {
              navigation.navigate("Main", { screen: "SettingsTab", params: { screen: "DroneSetup", params: { droneId: undefined } } } as any);
            }
          },
        ]
      );
      return;
    }
  };

  const handleSelectPlanning = () => {
    setShowChooser(false);
    setFlightPlanningMode("planning");
    navigation.navigate("FlightPlanning" as any);
  };

  const handleSelectPreflight = () => {
    setShowChooser(false);
    setFlightPlanningMode("preflight");
    navigation.navigate("FlightPlanning" as any);
  };

  return (
    <>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.floatingFab,
          { bottom: getMainTabBarHeight(width > height, insets.bottom) + 16 },
          pressed && styles.fabButtonPressed,
        ]}
        testID="fab-new-check"
      >
        <Feather name="plus" size={28} color="#FFFFFF" />
      </Pressable>
      <ChooserModal
        visible={showChooser}
        onClose={() => setShowChooser(false)}
        onSelectPlanning={handleSelectPlanning}
        onSelectPreflight={handleSelectPreflight}
      />
    </>
  );
}

export default function MainTabNavigator() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [activeTab, setActiveTab] = useState<keyof MainTabParamList>("BriefingsTab");
  // Ladegerät: Home-Taste während eines Ladevorgangs → Einstellung befolgen
  useChargerAppStateHandling();

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        tabBar={(props) => <MainTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          // Schätzwert für die erste Messung; die eigene Leiste meldet ihre echte Höhe.
          tabBarStyle: { height: getMainTabBarHeight(landscape, insets.bottom) },
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textTertiary,
        }}
        screenListeners={{
          state: (e) => {
            const state = e.data.state;
            if (state) {
              const routeName = state.routes[state.index]?.name as keyof MainTabParamList;
              setActiveTab(routeName);
            }
          },
        }}
      >
        <Tab.Screen
          name="BriefingsTab"
          component={BriefingsTabScreen}
          options={{
            tabBarLabel: "Briefings",
            tabBarIcon: ({ focused }) => <TabBarIcon name="clipboard" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="RadarTab"
          component={RadarTabScreen}
          options={{
            tabBarLabel: ({ focused }) => <RadarTabLabel focused={focused} />,
            tabBarIcon: ({ focused }) => <RadarTabIcon focused={focused} />,
          }}
        />
        <Tab.Screen
          name="NotamsTab"
          component={NotamsTabScreen}
          options={{
            tabBarLabel: "NOTAMs",
            tabBarIcon: ({ focused }) => <NotamsTabIcon focused={focused} />,
          }}
        />
        <Tab.Screen
          name="HistoryTab"
          component={HistoryTabScreen}
          options={{
            tabBarLabel: "Logbuch",
            tabBarIcon: ({ focused }) => <TabBarIcon name="book" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="NdFilterTab"
          component={NdFilterTabScreen}
          options={{
            tabBarLabel: "ND-Filter",
            tabBarIcon: ({ focused }) => <TabBarIcon name="aperture" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="ChargerTab"
          component={ChargerTabScreen}
          options={{
            tabBarLabel: "Akkus",
            tabBarIcon: ({ focused }) => <ChargerTabIcon focused={focused} />,
          }}
        />
        <Tab.Screen
          name="SettingsTab"
          component={SettingsTabScreen}
          options={{
            tabBarLabel: "Einstellungen",
            tabBarIcon: ({ focused }) => <TabBarIcon name="settings" focused={focused} />,
          }}
        />
      </Tab.Navigator>
      {activeTab === "BriefingsTab" ? <FloatingFab /> : null}
      <ChargerLeaveDialog />
    </View>
  );
}

const styles = StyleSheet.create({
  fabButton: {
    top: -20,
    justifyContent: "center",
    alignItems: "center",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.light.primary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  floatingFab: {
    position: "absolute",
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light.primary,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },
  fabButtonPressed: {
    transform: [{ scale: 0.95 }],
    opacity: 0.9,
  },
  fabInner: {
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  overlayTouchable: {
    ...StyleSheet.absoluteFill,
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  modalSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: "#DDD",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    ...Typography.h2,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  modalSubtitle: {
    ...Typography.body,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  activeSessionsSection: {
    marginBottom: Spacing.lg,
  },
  sectionLabel: {
    ...Typography.caption,
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionLocation: {
    ...Typography.body,
    fontWeight: "600",
  },
  sessionTime: {
    ...Typography.small,
    marginTop: 2,
  },
  optionsContainer: {
    gap: Spacing.md,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
  },
  optionIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.lg,
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    ...Typography.body,
    fontWeight: "600",
    marginBottom: 2,
  },
  optionDescription: {
    ...Typography.small,
  },
  cancelButton: {
    marginTop: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButtonText: {
    ...Typography.body,
    fontWeight: "600",
  },
});
