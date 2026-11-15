import React, { useEffect, useRef, useState, useCallback } from "react";
import { StyleSheet, View, Text, Pressable, ScrollView, Platform, BackHandler, ActivityIndicator, AppState, type AppStateStatus } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { navigationRef } from "@/navigation/navigationRef";
import { startZoneTranslation } from "@/lib/zoneTranslationStore";
import { initDflightAccessFlag } from "@/lib/geozoneDirect/dflightAuth";
import { initEd269ImportFlags } from "@/lib/geozoneDirect/ed269Store";
import { startGeozoneTileStore } from "@/lib/geozoneTiles/tileStore";
import { startCountryUsage } from "@/lib/countryUsageData";
import { CountryUsagePrompt } from "@/components/CountryUsagePrompt";
import { DownloadActivityBar } from "@/components/DownloadActivityBar";
import { BlockingWorkOverlay } from "@/components/BlockingWorkOverlay";
import { rootTouchHandlers } from "@/lib/backgroundWork";

// Übersetzungs-Cache der Behördentexte laden (offline) und neue Texte nachziehen
startZoneTranslation();
initDflightAccessFlag();
// Nur per Datei importierbare Länder (GR): „eigene Daten“, sobald ein Import vorliegt
initEd269ImportFlags();
// Offline-Geozonen DE/FR/CZ (Kachelspeicher): Bestand bekannt machen, AIRAC-Aktualisierung
startGeozoneTileStore();
// Länder-Nutzung (Aus/Online/Offline): laden bzw. migrieren, Offline-Länder automatisch aktualisieren
startCountryUsage();
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";

import RootStackNavigator from "@/navigation/RootStackNavigator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/lib/auth";
import { NetworkProvider } from "@/lib/network";
import { OfflineBanner } from "@/components/OfflineBanner";
import { rescheduleExpiryWarnings } from "@/lib/expiryWarnings";

SplashScreen.preventAutoHideAsync();

const DISCLAIMER_KEY = "@preflight/disclaimer_accepted";

function DisclaimerScreen({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[disclaimerStyles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      <View style={disclaimerStyles.iconRow}>
        <Feather name="alert-triangle" size={36} color="#F59E0B" />
      </View>
      <Text style={disclaimerStyles.title}>Wichtiger Hinweis</Text>
      <ScrollView style={disclaimerStyles.scroll} contentContainerStyle={disclaimerStyles.scrollContent}>
        <Text style={disclaimerStyles.text}>
          Diese App/Website ist informativer Natur und wurde entwickelt, um Piloten bei der Flugplanung und -durchf{"\u00FC"}hrung zu unterst{"\u00FC"}tzen. Sie kann in Verbindung mit anderen Informationsquellen vor dem Flug verwendet werden, die erforderlich sind, um alle Anforderungen zu erf{"\u00FC"}llen, und ist nicht als einzige Informationsquelle zu betrachten, um alle Ma{"\u00DF"}nahmen vor dem Flug zu erf{"\u00FC"}llen.
        </Text>
        <Text style={disclaimerStyles.text}>
          Aufgrund von Verz{"\u00F6"}gerungen bei der Systemverarbeitung werden k{"\u00FC"}rzlich eingegebene NOTAMs m{"\u00F6"}glicherweise nicht angezeigt. Ebenso kann es vorkommen, dass Flugobjekte ohne Transponder oder nicht f{"\u00FC"}r das Radar sichtbar sich im Luftraum bewegen. Bitte zu jeder Zeit sicherstellen, dass eine direkte Sichtverbindung zum Flugger{"\u00E4"}t besteht.
        </Text>
        <Text style={disclaimerStyles.textBold}>
          Diese App erhebt keinen Anspruch auf Vollst{"\u00E4"}ndigkeit und entbindet nicht von der Verantwortung, die man als Pilot tr{"\u00E4"}gt!
        </Text>
      </ScrollView>
      <View style={disclaimerStyles.buttonRow}>
        <Pressable onPress={onDecline} style={disclaimerStyles.declineBtn}>
          <Text style={disclaimerStyles.declineText}>Ablehnen</Text>
        </Pressable>
        <Pressable onPress={onAccept} style={disclaimerStyles.acceptBtn}>
          <Feather name="check" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={disclaimerStyles.acceptText}>Akzeptieren</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function App() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    async function prepare() {
      try {
        const accepted = await AsyncStorage.getItem(DISCLAIMER_KEY);
        setDisclaimerAccepted(accepted === "true");
        // Hinweis: die Server-Migration läuft jetzt explizit nach dem Login,
        // nicht mehr blind beim App-Start (sonst würde sie einen anonymen
        // Nutzer mit dem Server kollidieren lassen).
      } catch (error) {
        console.error(error);
        setDisclaimerAccepted(false);
      } finally {
        setAppIsReady(true);
      }
    }
    prepare();
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) {
      await SplashScreen.hideAsync();
    }
  }, [appIsReady]);

  const handleAccept = useCallback(async () => {
    await AsyncStorage.setItem(DISCLAIMER_KEY, "true");
    setDisclaimerAccepted(true);
  }, []);

  const handleDecline = useCallback(() => {
    if (Platform.OS !== "web") {
      BackHandler.exitApp();
    }
  }, []);

  if (!appIsReady) {
    return null;
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NetworkProvider>
            <SafeAreaProvider>
              {/* Berührungen melden: schwere Hintergrundarbeit pausiert während der Bedienung */}
              <GestureHandlerRootView style={styles.root} onLayout={onLayoutRootView} {...rootTouchHandlers}>
                <KeyboardProvider>
                  <AuthGate
                    disclaimerAccepted={!!disclaimerAccepted}
                    onAcceptDisclaimer={handleAccept}
                    onDeclineDisclaimer={handleDecline}
                  />
                  <OfflineBanner />
                  {/* nur für nicht zerlegbare, lange Arbeit (runBlocking) – fängt alle Berührungen ab */}
                  <BlockingWorkOverlay />
                  <StatusBar style="auto" />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </SafeAreaProvider>
          </NetworkProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

/**
 * RC-Version: kein Login und keine Paywall. Nach dem Hinweis geht es direkt
 * in die App; alle Daten bleiben auf dem Gerät.
 */
function AuthGate({
  disclaimerAccepted,
  onAcceptDisclaimer,
  onDeclineDisclaimer,
}: {
  disclaimerAccepted: boolean;
  onAcceptDisclaimer: () => void | Promise<void>;
  onDeclineDisclaimer: () => void;
}) {
  // Ablauf-Erinnerungen (AlphaTango / Lizenzen / Versicherung) lokal planen
  useEffect(() => {
    const t = setTimeout(() => {
      rescheduleExpiryWarnings().catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  if (!disclaimerAccepted) {
    return (
      <DisclaimerScreen
        onAccept={() => { void onAcceptDisclaimer(); }}
        onDecline={onDeclineDisclaimer}
      />
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <RootStackNavigator />
      <CountryUsagePrompt />
      {/* App-weite Download-Anzeige (über der Navigation, Safe-Area) */}
      <DownloadActivityBar />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  gateLoading: {
    alignItems: "center",
    justifyContent: "center",
  },
});

const disclaimerStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0E1A",
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  iconRow: {
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 20,
    letterSpacing: 0.5,
  },
  scroll: {
    maxHeight: "60%",
    marginBottom: 24,
  },
  scrollContent: {
    paddingBottom: 12,
  },
  text: {
    fontSize: 15,
    lineHeight: 23,
    color: "rgba(200, 210, 230, 0.9)",
    marginBottom: 16,
  },
  textBold: {
    fontSize: 15,
    lineHeight: 23,
    color: "#F59E0B",
    fontWeight: "700",
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  declineBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255, 60, 60, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(255, 60, 60, 0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  declineText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FF3B30",
  },
  acceptBtn: {
    flex: 2,
    flexDirection: "row",
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: "#1B8A2A",
    alignItems: "center",
    justifyContent: "center",
  },
  acceptText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
