import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import * as Location from "@/lib/location";
import { Magnetometer } from "expo-sensors";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import {
  summarizeKpLocalSignalCheck,
  type KpLocalSignalSummary,
} from "@/lib/kpLocalSignalCheck";

const MEASUREMENT_DURATION_SECONDS = 30;
const MEASUREMENT_DURATION_MS = MEASUREMENT_DURATION_SECONDS * 1000;

type CheckPhase = "idle" | "preparing" | "running" | "complete" | "error";

interface KpLocalSignalCheckModalProps {
  visible: boolean;
  forecastKp: number;
  onClose: () => void;
}

type RemovableSubscription = { remove: () => void };

export default function KpLocalSignalCheckModal({
  visible,
  forecastKp,
  onClose,
}: KpLocalSignalCheckModalProps) {
  const { theme } = useTheme();
  const [phase, setPhase] = useState<CheckPhase>("idle");
  const [secondsLeft, setSecondsLeft] = useState(MEASUREMENT_DURATION_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<KpLocalSignalSummary | null>(null);
  const [magnetometerAvailable, setMagnetometerAvailable] = useState<boolean | null>(null);
  const gpsSamples = useRef<number[]>([]);
  const magneticSamples = useRef<number[]>([]);
  const locationSubscription = useRef<RemovableSubscription | null>(null);
  const magnetometerSubscription = useRef<RemovableSubscription | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);

  const stopMeasurements = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    locationSubscription.current?.remove();
    locationSubscription.current = null;
    magnetometerSubscription.current?.remove();
    magnetometerSubscription.current = null;
  }, []);

  const finishMeasurement = useCallback(() => {
    stopMeasurements();
    setSummary(summarizeKpLocalSignalCheck(gpsSamples.current, magneticSamples.current));
    setPhase("complete");
    setSecondsLeft(0);
  }, [stopMeasurements]);

  useEffect(() => {
    if (!visible) {
      cancelled.current = true;
      stopMeasurements();
      setPhase("idle");
      setError(null);
      setSummary(null);
      setSecondsLeft(MEASUREMENT_DURATION_SECONDS);
      return;
    }

    cancelled.current = false;
    return () => {
      cancelled.current = true;
      stopMeasurements();
    };
  }, [visible, stopMeasurements]);

  const cancelMeasurement = () => {
    cancelled.current = true;
    stopMeasurements();
    setPhase("idle");
    setSecondsLeft(MEASUREMENT_DURATION_SECONDS);
  };

  const closeModal = () => {
    cancelMeasurement();
    onClose();
  };

  const startMeasurement = async () => {
    cancelled.current = false;
    stopMeasurements();
    gpsSamples.current = [];
    magneticSamples.current = [];
    setSummary(null);
    setError(null);
    setMagnetometerAvailable(null);
    setPhase("preparing");

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled.current) return;
      if (permission.status !== "granted") {
        throw new Error("Ohne Standortfreigabe kann die GPS-Genauigkeit nicht gemessen werden.");
      }

      let hasMagnetometer = false;
      try {
        hasMagnetometer = await Magnetometer.isAvailableAsync();
      } catch {
        hasMagnetometer = false;
      }
      if (cancelled.current) return;
      setMagnetometerAvailable(hasMagnetometer);

      if (hasMagnetometer) {
        try {
          Magnetometer.setUpdateInterval(1000);
          magnetometerSubscription.current = Magnetometer.addListener(({ x, y, z }) => {
            const magnitude = Math.sqrt(x * x + y * y + z * z);
            if (Number.isFinite(magnitude)) magneticSamples.current.push(magnitude);
          });
        } catch {
          magnetometerSubscription.current = null;
          setMagnetometerAvailable(false);
        }
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        ({ coords }) => {
          if (coords.accuracy != null && Number.isFinite(coords.accuracy) && coords.accuracy >= 0) {
            gpsSamples.current.push(coords.accuracy);
          }
        },
      );
      if (cancelled.current) {
        subscription.remove();
        stopMeasurements();
        return;
      }

      locationSubscription.current = subscription;
      setSecondsLeft(MEASUREMENT_DURATION_SECONDS);
      setPhase("running");
      const endsAt = Date.now() + MEASUREMENT_DURATION_MS;
      timer.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        setSecondsLeft(remaining);
        if (remaining === 0) finishMeasurement();
      }, 250);
    } catch (cause) {
      stopMeasurements();
      setError(cause instanceof Error ? cause.message : "Die Messung konnte nicht gestartet werden.");
      setPhase("error");
    }
  };

  const primaryAction = phase === "running" || phase === "preparing"
    ? cancelMeasurement
    : startMeasurement;
  const primaryLabel = phase === "running" || phase === "preparing"
    ? "Messung abbrechen"
    : phase === "complete"
      ? "Erneut messen"
      : phase === "error"
        ? "Erneut versuchen"
        : "30-Sekunden-Messung starten";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={closeModal}
      presentationStyle="fullScreen"
    >
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText style={styles.title}>Vor-Ort-Signalcheck</ThemedText>
              <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
                NOAA-Prognose zum Flugzeitpunkt: Kp {forecastKp.toFixed(1)}
              </ThemedText>
            </View>
            <Pressable
              onPress={closeModal}
              accessibilityRole="button"
              accessibilityLabel="Signalcheck schließen"
              hitSlop={12}
              style={styles.closeButton}
            >
              <Feather name="x" size={22} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <Card style={styles.card}>
              <ThemedText style={styles.sectionTitle}>So misst der Check</ThemedText>
              <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                Führe die Messung am Startplatz mit freiem Blick zum Himmel durch. Lege das
                Smartphone ruhig auf eine nichtmetallische Fläche und halte es von Fahrzeugen,
                Lautsprechern, Magneten und größeren Metallteilen fern.
              </ThemedText>
              <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                Erfasst werden die vom Smartphone gemeldete GPS-Genauigkeit und die Schwankung
                des Magnetfelds über 30 Sekunden. Einzelne Satellitensignalstärken (C/N₀) sind
                auf dem iPhone nicht verfügbar.
              </ThemedText>
            </Card>

            <Card style={styles.card}>
              {phase === "preparing" ? (
                <View style={styles.statusRow}>
                  <ActivityIndicator color={theme.statusCaution} />
                  <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                    Sensoren werden vorbereitet …
                  </ThemedText>
                </View>
              ) : phase === "running" ? (
                <View style={styles.runningBlock}>
                  <ThemedText style={styles.sectionTitle}>Messung läuft</ThemedText>
                  <ThemedText style={[styles.countdown, { color: theme.statusCaution }]}>
                    Noch {secondsLeft} Sekunden
                  </ThemedText>
                  <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                    Bitte das Smartphone jetzt möglichst ruhig liegen lassen.
                  </ThemedText>
                  <ActivityIndicator color={theme.statusCaution} />
                </View>
              ) : phase === "error" ? (
                <ThemedText style={[styles.body, { color: theme.statusNoGo }]}>
                  {error}
                </ThemedText>
              ) : phase === "complete" && summary ? (
                <View style={styles.resultBlock}>
                  <ThemedText style={styles.sectionTitle}>Messwerte dieses Smartphones</ThemedText>
                  <View style={styles.resultRow}>
                    <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                      GPS-Messungen
                    </ThemedText>
                    <ThemedText style={styles.resultValue}>{summary.gpsSampleCount}</ThemedText>
                  </View>
                  <View style={styles.resultRow}>
                    <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                      Median der GPS-Genauigkeit
                    </ThemedText>
                    <ThemedText style={styles.resultValue}>
                      {summary.gpsMedianAccuracyMeters == null
                        ? "kein Fix"
                        : `${summary.gpsMedianAccuracyMeters.toFixed(1)} m`}
                    </ThemedText>
                  </View>
                  {magnetometerAvailable === false ? (
                    <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                      Magnetometer auf diesem Smartphone nicht verfügbar.
                    </ThemedText>
                  ) : (
                    <>
                      <View style={styles.resultRow}>
                        <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                          Magnetfeldmessungen
                        </ThemedText>
                        <ThemedText style={styles.resultValue}>{summary.magneticSampleCount}</ThemedText>
                      </View>
                      <View style={styles.resultRow}>
                        <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                          Mittlere Feldstärke
                        </ThemedText>
                        <ThemedText style={styles.resultValue}>
                          {summary.magneticMeanMicrotesla == null
                            ? "keine Messung"
                            : `${summary.magneticMeanMicrotesla.toFixed(1)} µT`}
                        </ThemedText>
                      </View>
                      <View style={styles.resultRow}>
                        <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                          Schwankungsbereich
                        </ThemedText>
                        <ThemedText style={styles.resultValue}>
                          {summary.magneticRangeMicrotesla == null
                            ? "keine Messung"
                            : `${summary.magneticRangeMicrotesla.toFixed(1)} µT`}
                        </ThemedText>
                      </View>
                    </>
                  )}
                </View>
              ) : (
                <View style={styles.idleBlock}>
                  <ThemedText style={styles.sectionTitle}>Bereit für die Messung</ThemedText>
                  <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
                    Die Standortfreigabe wird erst beim Start des Checks abgefragt.
                  </ThemedText>
                </View>
              )}
            </Card>

            <ThemedText style={[styles.disclaimer, { color: theme.textSecondary }]}>
              Dieser Check misst nur das Smartphone, nicht den GNSS-Empfänger der Drohne.
              Kp ist ein globaler Index; die Messwerte beweisen nicht, dass eine Abweichung
              durch geomagnetische Aktivität verursacht wurde. Vergleiche sie mit der
              Anzeige deiner Drohnen-App. Das Ergebnis ist keine Flugfreigabe.
            </ThemedText>

            <Pressable
              onPress={primaryAction}
              disabled={phase === "preparing"}
              accessibilityRole="button"
              testID="kp-local-signal-check-action"
              style={[
                styles.primaryButton,
                { backgroundColor: theme.statusCaution, opacity: phase === "preparing" ? 0.7 : 1 },
              ]}
            >
              <ThemedText style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                {primaryLabel}
              </ThemedText>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerText: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 21,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
  },
  closeButton: {
    padding: 8,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  card: {
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  runningBlock: {
    alignItems: "center",
    gap: 12,
  },
  countdown: {
    fontSize: 26,
    fontWeight: "800",
  },
  resultBlock: {
    gap: 12,
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  resultValue: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "right",
  },
  idleBlock: {
    gap: 8,
  },
  disclaimer: {
    fontSize: 12,
    lineHeight: 18,
  },
  primaryButton: {
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
