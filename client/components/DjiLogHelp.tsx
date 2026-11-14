import React, { useState } from "react";
import { View, StyleSheet, Pressable, Platform, LayoutAnimation, UIManager } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const IOS_STEPS = [
  "Öffne die „Dateien“-App auf deinem iPhone/iPad.",
  "Tippe unten auf „Durchsuchen“ und dann auf „Auf meinem iPhone“.",
  "Öffne den Ordner deiner DJI-App (z. B. „DJI Fly“, „DJI GO 4“ oder „DJI Pilot“).",
  "Gehe in „FlightRecords“ bzw. „DJIFlightRecord“ und tippe auf die gewünschte .txt-Datei.",
];

const ANDROID_STEPS = [
  "Öffne einen Datei-Manager (z. B. „Files by Google“).",
  "Interner Speicher → „DJI“ → „dji.go.v5“ (DJI Fly) bzw. „dji.go.v4“ (DJI GO 4). Alternativ: „Android/data/dji.go.v5/files“.",
  "Öffne „FlightRecord“ und wähle die .txt-Datei aus.",
];

/**
 * Aufklappbare Hilfe, die geräteabhängig (iOS/Android) erklärt, wo die
 * DJI-Flugprotokolle liegen und wie der Pilot daran kommt. Die DJI-Logs liegen
 * im privaten App-Verzeichnis der DJI-App; iOS-Sandbox bzw. Androids Scoped
 * Storage erlauben kein automatisches Durchsuchen — daher führen wir den
 * Piloten zum Systemdialog und zeigen den passenden Pfad.
 */
export function DjiLogHelp() {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const isIOS = Platform.OS === "ios";
  const isAndroid = Platform.OS === "android";

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  const renderSteps = (steps: string[]) =>
    steps.map((step, i) => (
      <View key={i} style={styles.stepRow}>
        <View style={[styles.stepNumber, { backgroundColor: theme.primary + "15" }]}>
          <ThemedText style={[styles.stepNumberText, { color: theme.primary }]}>
            {i + 1}
          </ThemedText>
        </View>
        <ThemedText style={[styles.stepText, { color: theme.text }]}>{step}</ThemedText>
      </View>
    ));

  const renderPlatformBlock = (
    label: string,
    icon: "smartphone" | "tablet",
    steps: string[],
    current: boolean,
  ) => (
    <View style={styles.platformBlock}>
      <View style={styles.platformHeader}>
        <Feather name={icon} size={14} color={current ? theme.primary : theme.textSecondary} />
        <ThemedText
          style={[
            styles.platformLabel,
            { color: current ? theme.primary : theme.textSecondary },
          ]}
        >
          {label}
        </ThemedText>
        {current ? (
          <View style={[styles.badge, { backgroundColor: theme.primary + "15" }]}>
            <ThemedText style={[styles.badgeText, { color: theme.primary }]}>
              Dein Gerät
            </ThemedText>
          </View>
        ) : null}
      </View>
      {renderSteps(steps)}
    </View>
  );

  return (
    <Card style={styles.card}>
      <Pressable
        testID="button-dji-help-toggle"
        onPress={toggle}
        style={({ pressed }) => [styles.toggleRow, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
      >
        <Feather name="help-circle" size={16} color={theme.primary} />
        <ThemedText style={styles.toggleText}>Wo finde ich die DJI-Logs?</ThemedText>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={theme.textSecondary}
        />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
            DJI speichert für jeden Flug ein „FlightRecord“ als .txt-Datei in der
            DJI-App (DJI Fly, DJI GO 4 oder DJI Pilot). Wähle diese Datei über
            „DJI-Protokoll hochladen“ aus — ein automatisches Durchsuchen ist
            durch die App-Isolierung von iOS/Android nicht möglich.
          </ThemedText>

          <View style={[styles.fileTypeBox, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={styles.fileTypeRow}>
              <Feather name="check-circle" size={13} color={theme.statusGo} />
              <ThemedText style={[styles.fileTypeText, { color: theme.text }]}>
                <ThemedText style={styles.fileTypeStrong}>FlightRecord ….txt</ThemedText>
                {" — das brauchst du hier. Heißt z. B. "}
                „FlightRecord_2026-05-26_[21-44-21]….txt“ und wird automatisch
                ausgewertet (GPS-Track, Höhe, Dauer, Akku).
              </ThemedText>
            </View>
            <View style={styles.fileTypeRow}>
              <Feather name="x-circle" size={13} color={theme.textTertiary} />
              <ThemedText style={[styles.fileTypeText, { color: theme.textSecondary }]}>
                <ThemedText style={styles.fileTypeStrong}>….DAT</ThemedText>
                {" (z. B. „…_USR046_….DAT“) ist das rohe "}
                Fluglog des Flugcontrollers — sehr groß und DJI-proprietär. Es
                wird hier nicht ausgewertet; bitte die .txt-Datei nutzen.
              </ThemedText>
            </View>
          </View>

          {isIOS
            ? renderPlatformBlock("iOS (Dateien-App)", "smartphone", IOS_STEPS, true)
            : null}
          {isAndroid
            ? renderPlatformBlock("Android (Datei-Manager)", "smartphone", ANDROID_STEPS, true)
            : null}

          {/* Auf Web bzw. zur Vollständigkeit beide Plattformen zeigen. */}
          {!isIOS ? renderPlatformBlock("iOS (Dateien-App)", "smartphone", IOS_STEPS, false) : null}
          {!isAndroid
            ? renderPlatformBlock("Android (Datei-Manager)", "smartphone", ANDROID_STEPS, false)
            : null}

          <View style={[styles.tipBox, { backgroundColor: theme.backgroundSecondary }]}>
            <Feather name="info" size={13} color={theme.textSecondary} />
            <ThemedText style={[styles.tipText, { color: theme.textSecondary }]}>
              Fehlt der DJI-Ordner? Öffne in der DJI-App einmal die Flugliste, damit
              das Protokoll synchronisiert wird. Ab Android 11 ist „Android/data“
              teils gesperrt — kopiere die Datei dann vorab z. B. nach „Downloads“.
            </ThemedText>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  toggleText: {
    ...Typography.body,
    fontWeight: "600",
    flex: 1,
  },
  body: {
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  intro: {
    ...Typography.small,
    lineHeight: 18,
  },
  fileTypeBox: {
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  fileTypeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  fileTypeText: {
    ...Typography.caption,
    lineHeight: 16,
    flex: 1,
  },
  fileTypeStrong: {
    ...Typography.caption,
    fontWeight: "700",
  },
  platformBlock: {
    gap: Spacing.sm,
  },
  platformHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  platformLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  badgeText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  stepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumberText: {
    ...Typography.caption,
    fontWeight: "700",
  },
  stepText: {
    ...Typography.small,
    lineHeight: 18,
    flex: 1,
  },
  tipBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  tipText: {
    ...Typography.caption,
    lineHeight: 16,
    flex: 1,
  },
});
