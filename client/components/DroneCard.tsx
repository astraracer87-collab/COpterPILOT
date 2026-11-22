import { openLink } from "@/lib/webBrowser";
import React from "react";
import { View, StyleSheet, Pressable, Alert, Linking, Platform, Image } from "react-native";
import { getDroneImage } from "@/lib/droneImage";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as WebBrowser from "@/lib/webBrowser";
import { ThemedText } from "./ThemedText";
import { Card } from "./Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors } from "@/constants/theme";
import {
  archiveDrone,
  deleteDrone,
  getComplianceStatus,
  DroneProfile,
  PilotProfile,
} from "@/lib/storage";
import { findPresetForDrone } from "@/lib/dronePresets";
import { getAlphaTangoFrStatus } from "@/lib/countryCompliance";
import { getCountryUsage } from "@/lib/countryUsage";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";
import type { DocumentRef } from "@/lib/documents";

const COMPLIANCE_COLORS = {
  green: Colors.light.statusGo,
  yellow: Colors.light.statusCaution,
  red: Colors.light.statusNoGo,
};

interface DroneCardProps {
  drone: DroneProfile;
  pilot: PilotProfile | null;
  isSelected: boolean;
  hasActiveBriefing: boolean;
  flightCount: number;
  navigation: NativeStackNavigationProp<SettingsStackParamList>;
  onSelect: () => void;
  /** Wird nach Archivieren/Löschen aufgerufen, damit der Screen neu lädt. */
  onChanged: () => void;
  onPreviewDoc: (doc: DocumentRef, label: string) => void;
}

/**
 * Gemeinsame Drohnen-Karte für die "Meine Drohnen"-Verwaltung UND die
 * Drohnen-Übersicht in den Einstellungen. So stehen alle Aktionen (Info,
 * Historie, Lost & Found, Bearbeiten, Archivieren) sowie die Dokument-Vorschau
 * direkt in der Übersicht zur Verfügung — ohne Umweg über "Alle verwalten".
 */
export function DroneCard({
  drone,
  pilot,
  isSelected,
  hasActiveBriefing,
  flightCount,
  navigation,
  onSelect,
  onChanged,
  onPreviewDoc,
}: DroneCardProps) {
  const { theme } = useTheme();

  const complianceStatus = getComplianceStatus(drone, pilot || undefined);
  const complianceColor = COMPLIANCE_COLORS[complianceStatus];
  // Nur relevant, wer in Frankreich fliegt (Land in den Einstellungen aktiviert)
  const alphaTangoFrStatus = (getCountryUsage("FR") ?? "off") !== "off" ? getAlphaTangoFrStatus(drone) : "not-required";
  const preset = findPresetForDrone(drone.name, drone.manufacturer, drone.model);
  const droneImage = getDroneImage(drone.manufacturer, drone.model ?? preset?.model);
  const hasDocsSection = !!(drone.alphaTangoDocument || drone.dflightDocument || preset?.manualUrl);

  const openManualUrl = async (url: string) => {
    if (Platform.OS === "web") {
      openLink(url);
    } else {
      await WebBrowser.openBrowserAsync(url);
    }
  };

  const handleArchive = () => {
    Alert.alert(
      "Drohne archivieren oder löschen?",
      `"${drone.name}"\n\n• Archivieren: verschwindet aus der Liste, Logbuch und Flugverlauf bleiben erhalten, jederzeit reaktivierbar.\n• Endgültig löschen: Drohne wird unwiderruflich entfernt. Historische Logbuch-Einträge bleiben bestehen, aber die Drohne selbst kann nicht wiederhergestellt werden.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Endgültig löschen",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDrone(drone.id);
            } catch (e) {
              Alert.alert("Löschen fehlgeschlagen", (e as Error)?.message || "Bitte später erneut versuchen.");
            }
            onChanged();
          },
        },
        {
          text: "Archivieren",
          onPress: async () => {
            await archiveDrone(drone.id);
            onChanged();
          },
        },
      ]
    );
  };

  return (
    <Card
      style={[
        styles.droneCard,
        isSelected && { borderColor: theme.primary, borderWidth: 2 },
      ]}
      onPress={onSelect}
      testID={`card-drone-${drone.id}`}
    >
      <View style={styles.droneHeader}>
        <View style={[styles.droneIconContainer, { backgroundColor: theme.backgroundSecondary }]}>
          {droneImage ? (
            <Image source={droneImage} style={styles.droneImage} resizeMode="contain" />
          ) : (
            <MaterialCommunityIcons name="quadcopter" size={24} color={theme.primary} />
          )}
        </View>
        <View style={styles.droneInfo}>
          <View style={styles.nameRow}>
            <ThemedText style={styles.droneName}>{drone.name}</ThemedText>
            {isSelected ? (
              <Feather name="check-circle" size={16} color={theme.primary} accessibilityLabel="Standard-Drohne" />
            ) : null}
            {hasActiveBriefing ? (
              <View style={[styles.selectedBadge, { backgroundColor: theme.statusCaution, flexDirection: "row", alignItems: "center", gap: 4 }]}>
                <Feather name="clipboard" size={11} color="#FFF" />
                <ThemedText style={styles.selectedText}>Briefing offen</ThemedText>
              </View>
            ) : null}
          </View>
          <ThemedText style={[styles.droneDetails, { color: theme.textSecondary }]}>
            {drone.classMark} | {drone.mtomGrams}g | {flightCount} {flightCount === 1 ? "Flug" : "Flüge"}
          </ThemedText>
          {drone.manufacturer || drone.model ? (
            <ThemedText style={[styles.droneModel, { color: theme.textTertiary }]}>
              {[drone.manufacturer, drone.model].filter(Boolean).join(" ")}
            </ThemedText>
          ) : null}
          {alphaTangoFrStatus !== "not-required" ? (
            <View style={styles.alphaTangoRow}>
              <View
                style={[
                  styles.alphaTangoBadge,
                  {
                    backgroundColor:
                      alphaTangoFrStatus === "required-done"
                        ? theme.statusGo
                        : theme.statusCaution,
                  },
                ]}
                testID={`status-alphatango-${drone.id}`}
              >
                <Feather
                  name={alphaTangoFrStatus === "required-done" ? "check" : "alert-triangle"}
                  size={11}
                  color="#FFF"
                />
                <ThemedText style={styles.alphaTangoBadgeText}>
                  {alphaTangoFrStatus === "required-done"
                    ? "AlphaTango (FR): erledigt"
                    : "AlphaTango (FR): offen"}
                </ThemedText>
              </View>
            </View>
          ) : null}
        </View>
        <View style={styles.droneActions}>
          <View style={[styles.complianceDot, { backgroundColor: complianceColor }]} />
          <Pressable
            onPress={() => navigation.navigate("DroneInfo", { droneId: drone.id })}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            testID={`button-info-${drone.id}`}
          >
            <Feather name="info" size={18} color={theme.primary} />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("DroneHistory", { droneId: drone.id })}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            testID={`button-history-${drone.id}`}
          >
            <Feather name="file-text" size={18} color={theme.textSecondary} />
          </Pressable>
          {/* Lost & Found (Finder-Link) benötigte den Server – in der RC-Version ausgeblendet. */}
          <Pressable
            onPress={() => navigation.navigate("DroneSetup", { droneId: drone.id })}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            testID={`button-edit-drone-${drone.id}`}
          >
            <Feather name="edit-2" size={18} color={theme.textSecondary} />
          </Pressable>
          <Pressable
            onPress={handleArchive}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            testID={`button-archive-${drone.id}`}
          >
            <Feather name="archive" size={18} color={theme.textSecondary} />
          </Pressable>
        </View>
      </View>
      {hasDocsSection ? (
        <View style={[styles.documentsSection, { borderTopColor: theme.border }]}>
          <ThemedText style={[styles.docsSectionTitle, { color: theme.primary }]}>
            Dokumente
          </ThemedText>
          {drone.alphaTangoDocument ? (
            <Pressable
              onPress={() => onPreviewDoc(drone.alphaTangoDocument!, "AlphaTango-Bestätigung")}
              style={({ pressed }) => [
                styles.documentRow,
                { backgroundColor: theme.backgroundSecondary },
                pressed && styles.pressed,
              ]}
              testID={`button-preview-alphatango-${drone.id}`}
            >
              <Feather name="file-text" size={18} color={theme.primary} />
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <ThemedText style={[styles.documentLabel, { color: theme.text }]}>
                  AlphaTango-Bestätigung
                </ThemedText>
                <ThemedText style={[styles.documentMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                  {drone.alphaTangoDocument.fileName}
                </ThemedText>
              </View>
              <Feather name="eye" size={18} color={theme.primary} />
            </Pressable>
          ) : null}
          {drone.dflightDocument ? (
            <Pressable
              onPress={() => onPreviewDoc(drone.dflightDocument!, "D-Flight-Bestätigung")}
              style={({ pressed }) => [
                styles.documentRow,
                { backgroundColor: theme.backgroundSecondary },
                pressed && styles.pressed,
              ]}
              testID={`button-preview-dflight-${drone.id}`}
            >
              <Feather name="file-text" size={18} color={theme.primary} />
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <ThemedText style={[styles.documentLabel, { color: theme.text }]}>
                  D-Flight-Bestätigung
                </ThemedText>
                <ThemedText style={[styles.documentMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                  {drone.dflightDocument.fileName}
                </ThemedText>
              </View>
              <Feather name="eye" size={18} color={theme.primary} />
            </Pressable>
          ) : null}
          {preset?.manualUrl ? (
            <Pressable
              onPress={() => openManualUrl(preset.manualUrl!)}
              style={({ pressed }) => [
                styles.documentRow,
                { backgroundColor: theme.backgroundSecondary },
                pressed && styles.pressed,
              ]}
              testID={`button-manual-${drone.id}`}
            >
              <Feather name="external-link" size={18} color={theme.primary} />
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <ThemedText style={[styles.documentLabel, { color: theme.text }]}>
                  {`${preset.manufacturer} ${preset.model} – Handbuch & Downloads`}
                </ThemedText>
                <ThemedText style={[styles.documentMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                  Hersteller-Seite öffnen
                </ThemedText>
              </View>
              <Feather name="chevron-right" size={18} color={theme.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  droneCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  droneHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  droneIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
    overflow: "hidden",
  },
  droneImage: {
    width: 54,
    height: 54,
  },
  droneInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  droneName: {
    ...Typography.h4,
  },
  selectedBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  selectedText: {
    ...Typography.caption,
    color: "#FFF",
    fontWeight: "600",
  },
  droneDetails: {
    ...Typography.body,
    marginTop: Spacing.xs,
  },
  droneModel: {
    ...Typography.small,
    marginTop: 2,
  },
  alphaTangoRow: {
    flexDirection: "row",
    marginTop: Spacing.xs,
  },
  alphaTangoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  alphaTangoBadgeText: {
    ...Typography.caption,
    color: "#FFF",
    fontWeight: "600",
  },
  droneActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  complianceDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  actionButton: {
    padding: Spacing.xs,
  },
  pressed: {
    opacity: 0.7,
  },
  documentsSection: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  docsSectionTitle: {
    ...Typography.caption,
    fontWeight: "700",
    marginBottom: Spacing.sm,
    letterSpacing: 0.5,
  },
  documentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
    marginTop: Spacing.xs,
  },
  documentLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  documentMeta: {
    fontSize: 11,
    marginTop: 2,
  },
});
