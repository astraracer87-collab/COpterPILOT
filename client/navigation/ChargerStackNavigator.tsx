/**
 * Akkus-Tab: eigener Stack (Live → Akkus → Historie → Vorgang, Einstellungen).
 *
 * Tab-Verhalten:
 *  - Öffnen des Tabs verbindet automatisch mit dem gekoppelten Ladegerät
 *    (ohne Kopplung zeigt die Live-Seite „Ladegerät koppeln“) und beendet ein
 *    Hintergrund-Loggen (die App ist ja sichtbar).
 *  - Verlassen des Tabs trennt ohne laufenden Ladevorgang; sonst entscheidet
 *    „Ladegerät im Hintergrund loggen“ (ggf. mit Rückfrage).
 */
import React, { useEffect } from "react";
import { compactHeader } from "@/components/CompactStackHeader";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import ChargerLiveScreen from "@/screens/charger/ChargerLiveScreen";
import ChargerBatteriesScreen from "@/screens/charger/ChargerBatteriesScreen";
import ChargerBatteryHistoryScreen from "@/screens/charger/ChargerBatteryHistoryScreen";
import ChargerSessionDetailScreen from "@/screens/charger/ChargerSessionDetailScreen";
import ChargerSettingsScreen from "@/screens/charger/ChargerSettingsScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import {
  connectCharger,
  isChargerPaired,
  onLeaveChargerArea,
} from "@/hooks/useCharger";
import {
  chargerController,
  installChargerMonitorLinking,
} from "@/lib/charger/chargerControllerNative";

export type ChargerStackParamList = {
  ChargerLive: undefined;
  ChargerBatteries: undefined;
  ChargerBatteryHistory: { batteryKey: string; label?: string };
  ChargerSessionDetail: { sessionId: string };
  ChargerSettings: undefined;
};

const Stack = createNativeStackNavigator<ChargerStackParamList>();

/** Fokus/Verlassen des Tabs (Navigation des Tab-Eintrags, nicht des inneren Stacks) */
function useChargerTabLifecycle() {
  const navigation = useNavigation();
  useEffect(() => {
    installChargerMonitorLinking();
    const onFocus = () => {
      void chargerController.stopBackground();
      const st = chargerController.snapshot().transport?.state;
      if (st && st !== "stopped" && st !== "idle") return;
      void isChargerPaired().then((paired) => {
        if (paired) void connectCharger();
      });
    };
    const unsubFocus = navigation.addListener("focus", onFocus);
    const unsubBlur = navigation.addListener(
      "blur",
      () => void onLeaveChargerArea(),
    );
    if (navigation.isFocused()) onFocus();
    return () => {
      unsubFocus();
      unsubBlur();
    };
  }, [navigation]);
}

export default function ChargerStackNavigator() {
  // Nicht transparent: Inhalt beginnt unter der Kopfzeile (kompakt im Querformat)
  const screenOptions = useScreenOptions({ transparent: false });
  useChargerTabLifecycle();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="ChargerLive"
        component={ChargerLiveScreen}
        options={{ header: compactHeader, headerTitle: "Ladegerät (ISDT MA331)" }}
      />
      <Stack.Screen
        name="ChargerBatteries"
        component={ChargerBatteriesScreen}
        options={{ headerTitle: "Akkus" }}
      />
      <Stack.Screen
        name="ChargerBatteryHistory"
        component={ChargerBatteryHistoryScreen}
        options={{ headerTitle: "Ladehistorie" }}
      />
      <Stack.Screen
        name="ChargerSessionDetail"
        component={ChargerSessionDetailScreen}
        options={{ headerTitle: "Ladevorgang" }}
      />
      <Stack.Screen
        name="ChargerSettings"
        component={ChargerSettingsScreen}
        options={{ headerTitle: "Ladegerät-Einstellungen" }}
      />
    </Stack.Navigator>
  );
}
