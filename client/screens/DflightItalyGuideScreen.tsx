import { openLink } from "@/lib/webBrowser";
import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking, Alert } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, useFocusEffect, RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { DocumentField } from "@/components/DocumentField";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { DFLIGHT_ITALY_GUIDE } from "@/lib/dflightItalyGuide";
import { getDrones, updateDrone, DroneProfile } from "@/lib/storage";
import { DocumentRef } from "@/lib/documents";

type GuideRoute = RouteProp<{ Guide: { droneId?: string } | undefined }, "Guide">;

export default function DflightItalyGuideScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const route = useRoute<GuideRoute>();
  const guide = DFLIGHT_ITALY_GUIDE;

  const paramDroneId = route.params?.droneId;
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(paramDroneId ?? null);
  const [saving, setSaving] = useState(false);

  const loadDrones = useCallback(async () => {
    try {
      const list = await getDrones();
      setDrones(list);
      setSelectedDroneId((prev) => {
        if (paramDroneId && list.some((d) => d.id === paramDroneId)) return paramDroneId;
        if (prev && list.some((d) => d.id === prev)) return prev;
        return list.length === 1 ? list[0].id : prev;
      });
    } catch (e) {
      console.warn("[DflightGuide] loadDrones failed:", e);
    }
  }, [paramDroneId]);

  useFocusEffect(
    useCallback(() => {
      loadDrones();
    }, [loadDrones]),
  );

  const selectedDrone = drones.find((d) => d.id === selectedDroneId) ?? null;

  const handleDocChange = async (doc: DocumentRef | null) => {
    if (!selectedDroneId) return;
    setSaving(true);
    try {
      await updateDrone(selectedDroneId, { dflightDocument: doc });
      setDrones((prev) =>
        prev.map((d) => (d.id === selectedDroneId ? { ...d, dflightDocument: doc } : d)),
      );
    } catch (e: any) {
      Alert.alert("Fehler", e?.message || "QR-Code konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + Spacing["2xl"],
          paddingHorizontal: Spacing.lg,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={[styles.iconBadge, { backgroundColor: theme.primary + "18" }]}>
              <Feather name="grid" size={22} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.title}>{guide.title}</ThemedText>
              <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
                {guide.subtitle}
              </ThemedText>
            </View>
          </View>
          <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
            {guide.intro}
          </ThemedText>
        </Card>

        <SectionTitle theme={theme}>SCHRITT FÜR SCHRITT</SectionTitle>
        {guide.steps.map((step, i) => (
          <Card key={i} style={styles.stepCard} testID={`step-dflight-it-${i}`}>
            <View style={styles.stepHeader}>
              <View style={[styles.stepNumber, { backgroundColor: theme.primary }]}>
                <ThemedText style={styles.stepNumberText}>{i + 1}</ThemedText>
              </View>
              <ThemedText style={[styles.stepTitle, { color: theme.text }]}>
                {step.title}
              </ThemedText>
            </View>
            {step.details.map((d, j) => (
              <View key={j} style={[styles.bulletRow, { marginTop: Spacing.sm }]}>
                <ThemedText style={[styles.bulletDot, { color: theme.primary }]}>•</ThemedText>
                <ThemedText style={[styles.bulletText, { color: theme.text }]}>{d}</ThemedText>
              </View>
            ))}
          </Card>
        ))}

        <SectionTitle theme={theme}>WICHTIGE HINWEISE</SectionTitle>
        <Card style={styles.card}>
          {guide.notes.map((n, i) => (
            <View key={i} style={[styles.bulletRow, i > 0 && { marginTop: Spacing.sm }]}>
              <Feather name="info" size={15} color={theme.primary} style={{ marginTop: 3 }} />
              <ThemedText style={[styles.bulletText, { color: theme.text, marginLeft: 8 }]}>
                {n}
              </ThemedText>
            </View>
          ))}
        </Card>

        <SectionTitle theme={theme}>OFFIZIELLES PORTAL</SectionTitle>
        <Card style={styles.card}>
          <Pressable
            onPress={() => openLink(guide.portalUrl).catch(() => {})}
            style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
            testID="link-dflight-portal"
          >
            <Feather name="external-link" size={16} color={theme.primary} />
            <ThemedText style={[styles.linkLabel, { color: theme.primary }]}>
              {guide.portalLabel}
            </ThemedText>
          </Pressable>
        </Card>

        <SectionTitle theme={theme}>QR-CODE PRO DROHNE HINTERLEGEN</SectionTitle>
        <Card style={styles.card}>
          <ThemedText style={[styles.depositIntro, { color: theme.textSecondary }]}>
            Sobald der QR-Code erstellt ist, hier pro Drohne als PDF oder Foto
            hinterlegen. Damit gilt die D-Flight-Pflicht für Italien als erfüllt und
            der Compliance-Hinweis verschwindet automatisch.
          </ThemedText>

          {drones.length === 0 ? (
            <ThemedText style={[styles.depositHint, { color: theme.textTertiary }]}>
              Noch keine Drohne angelegt. Lege zuerst unter „Drohnen" eine Drohne an,
              um den QR-Code zu hinterlegen.
            </ThemedText>
          ) : (
            <>
              {drones.length > 1 ? (
                <View style={styles.droneChips}>
                  {drones.map((d) => {
                    const active = d.id === selectedDroneId;
                    const done = !!d.dflightDocument;
                    return (
                      <Pressable
                        key={d.id}
                        onPress={() => setSelectedDroneId(d.id)}
                        testID={`chip-dflight-drone-${d.id}`}
                        style={({ pressed }) => [
                          styles.droneChip,
                          {
                            backgroundColor: active ? theme.primary : theme.backgroundSecondary,
                            borderColor: active ? theme.primary : theme.border,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                      >
                        {done ? (
                          <Feather
                            name="check"
                            size={13}
                            color={active ? "#FFFFFF" : (theme.statusGo || "#34C759")}
                          />
                        ) : null}
                        <ThemedText
                          style={[
                            styles.droneChipText,
                            { color: active ? "#FFFFFF" : theme.text },
                          ]}
                        >
                          {d.name}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <ThemedText style={[styles.depositDroneName, { color: theme.text }]}>
                  {drones[0].name}
                </ThemedText>
              )}

              {selectedDrone ? (
                <>
                  {selectedDrone.dflightDocument ? (
                    <View
                      style={[
                        styles.doneBanner,
                        { backgroundColor: (theme.statusGo || "#34C759") + "18" },
                      ]}
                      testID="banner-dflight-done"
                    >
                      <Feather name="check-circle" size={16} color={theme.statusGo || "#34C759"} />
                      <ThemedText
                        style={[styles.doneBannerText, { color: theme.statusGo || "#34C759" }]}
                      >
                        QR-Code für {selectedDrone.name} hinterlegt — Italien-Pflicht erfüllt.
                      </ThemedText>
                    </View>
                  ) : null}
                  <DocumentField
                    testID="dflight-guide-doc"
                    label={`D-Flight QR-Code für ${selectedDrone.name}`}
                    hint="PDF oder Foto des QR-Codes aus dem D-Flight-Portal."
                    document={selectedDrone.dflightDocument}
                    onChange={handleDocChange}
                  />
                </>
              ) : (
                <ThemedText style={[styles.depositHint, { color: theme.textTertiary }]}>
                  Drohne auswählen, um den QR-Code zu hinterlegen.
                </ThemedText>
              )}
            </>
          )}
        </Card>

        <ThemedText style={[styles.disclaimer, { color: theme.textTertiary }]}>
          {guide.sourceNote}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function SectionTitle({ children, theme }: { children: React.ReactNode; theme: any }) {
  return (
    <ThemedText
      style={[
        styles.sectionTitle,
        { color: theme.textSecondary, marginTop: Spacing.lg, marginBottom: Spacing.xs },
      ]}
    >
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerCard: { padding: Spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...Typography.h4 },
  subtitle: { ...Typography.caption, marginTop: 2 },
  intro: { ...Typography.body, lineHeight: 20, marginTop: Spacing.md },
  card: { padding: Spacing.lg },
  stepCard: { padding: Spacing.lg, marginBottom: Spacing.sm },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  stepTitle: { ...Typography.body, fontWeight: "700", flex: 1 },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "800",
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.xs,
  },
  bulletRow: { flexDirection: "row", alignItems: "flex-start" },
  bulletDot: { fontWeight: "800", width: 14, lineHeight: 20 },
  bulletText: { ...Typography.body, flex: 1, lineHeight: 20 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 6,
  },
  linkLabel: { ...Typography.body, fontWeight: "600", flex: 1 },
  depositIntro: { ...Typography.body, lineHeight: 20, marginBottom: Spacing.md },
  depositHint: { ...Typography.caption, lineHeight: 18 },
  depositDroneName: { ...Typography.body, fontWeight: "700", marginBottom: Spacing.xs },
  droneChips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs, marginBottom: Spacing.xs },
  droneChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  droneChipText: { ...Typography.caption, fontWeight: "600" },
  doneBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: 10,
    marginTop: Spacing.md,
  },
  doneBannerText: { ...Typography.caption, fontWeight: "600", flex: 1, lineHeight: 18 },
  disclaimer: {
    fontSize: 11,
    fontStyle: "italic",
    marginTop: Spacing.lg,
    textAlign: "center",
  },
});
