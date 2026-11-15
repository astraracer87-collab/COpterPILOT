import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { BOOKABLE_COUNTRIES } from "../../shared/countryEntitlements";
import {
  downloadOfflinePack,
  deleteOfflinePack,
  getOfflineIndex,
  isPackStale,
  type OfflinePackMeta,
} from "@/lib/offlinePacks";

const SORTED_COUNTRIES = [...BOOKABLE_COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, "de"));

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function formatSize(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function OfflineMapsScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();

  const [index, setIndex] = useState<Record<string, OfflinePackMeta>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    setIndex(await getOfflineIndex());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const totalBytes = useMemo(
    () => Object.values(index).reduce((sum, m) => sum + (m.sizeBytes || 0), 0),
    [index]
  );

  const handleDownload = useCallback(
    async (iso: string) => {
      setBusy((b) => ({ ...b, [iso]: true }));
      try {
        await downloadOfflinePack(iso);
        await reload();
      } catch (err: any) {
        Alert.alert(
          "Download fehlgeschlagen",
          err?.message || "Das Offline-Paket konnte nicht geladen werden. Bitte Internetverbindung prüfen."
        );
      } finally {
        setBusy((b) => ({ ...b, [iso]: false }));
      }
    },
    [reload]
  );

  const handleDelete = useCallback(
    (iso: string, name: string) => {
      Alert.alert("Offline-Paket löschen", `Gespeicherte Daten für ${name} entfernen?`, [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: async () => {
            await deleteOfflinePack(iso);
            await reload();
          },
        },
      ]);
    },
    [reload]
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.lg,
        paddingBottom: tabBarHeight + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      scrollIndicatorInsets={{ bottom: tabBarHeight }}
    >
      <Card style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Feather name="info" size={18} color={theme.primary} />
          <ThemedText style={[styles.infoText, { color: theme.textSecondary }]}>
            Speichere Geozonen und NOTAMs eines Landes für die Offline-Nutzung. Der Karten-Hintergrund
            (Satellit/Standard) lässt sich technisch nicht offline speichern und ist ohne Internet nicht
            sichtbar. Pakete, die älter als 3 Tage sind, sollten aktualisiert werden.
          </ThemedText>
        </View>
      </Card>

      <View style={styles.summaryRow}>
        <ThemedText style={[styles.summaryText, { color: theme.textTertiary }]}>
          {Object.keys(index).length} Land/Länder gespeichert
        </ThemedText>
        <ThemedText style={[styles.summaryText, { color: theme.textTertiary }]}>
          {formatSize(totalBytes)} belegt
        </ThemedText>
      </View>

      {SORTED_COUNTRIES.map((country) => {
        const meta = index[country.iso];
        const stale = isPackStale(meta);
        const isBusy = !!busy[country.iso];

        return (
          <Card key={country.iso} style={styles.countryCard} testID={`card-offline-${country.iso}`}>
            <View style={styles.countryHeader}>
              <View style={styles.countryTitleWrap}>
                <ThemedText style={styles.countryName}>{country.name}</ThemedText>
                {meta ? (
                  <ThemedText style={[styles.metaLine, { color: theme.textTertiary }]}>
                    Stand: {formatDate(meta.cachedAt)}
                  </ThemedText>
                ) : (
                  <ThemedText style={[styles.metaLine, { color: theme.textTertiary }]}>
                    Nicht gespeichert
                  </ThemedText>
                )}
                {meta ? (
                  <ThemedText style={[styles.metaLine, { color: theme.textTertiary }]}>
                    {meta.featureCount} Zonen · {meta.notamsUnavailable ? "NOTAMs nicht verfügbar" : `${meta.notamCount} NOTAMs`} · {formatSize(meta.sizeBytes)}
                  </ThemedText>
                ) : null}
              </View>

              {meta ? (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: stale ? theme.statusCautionBackground : theme.statusGoBackground,
                    },
                  ]}
                  testID={`badge-offline-${country.iso}`}
                >
                  <ThemedText
                    style={[
                      styles.badgeText,
                      { color: stale ? theme.statusCaution : theme.statusGo },
                    ]}
                  >
                    {stale ? "Aktualisierung nötig" : "Aktuell"}
                  </ThemedText>
                </View>
              ) : null}
            </View>

            <View style={styles.actions}>
              {isBusy ? (
                <View style={styles.busyRow}>
                  <ActivityIndicator color={theme.primary} />
                  <ThemedText style={[styles.busyText, { color: theme.textSecondary }]}>
                    Wird geladen…
                  </ThemedText>
                </View>
              ) : (
                <>
                  <Button
                    title={meta ? "Aktualisieren" : "Herunterladen"}
                    variant={meta ? "secondary" : "primary"}
                    onPress={() => handleDownload(country.iso)}
                    style={styles.actionButton}
                    testID={`button-download-${country.iso}`}
                  />
                  {meta ? (
                    <Button
                      title="Löschen"
                      variant="secondary"
                      onPress={() => handleDelete(country.iso, country.name)}
                      style={styles.actionButton}
                      testID={`button-delete-${country.iso}`}
                    />
                  ) : null}
                </>
              )}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  infoCard: {
    marginBottom: Spacing.lg,
  },
  infoRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    alignItems: "flex-start",
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  summaryText: {
    fontSize: 12,
    fontWeight: "600",
  },
  countryCard: {
    marginBottom: Spacing.md,
  },
  countryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  countryTitleWrap: {
    flex: 1,
    gap: 2,
  },
  countryName: {
    fontSize: 16,
    fontWeight: "700",
  },
  metaLine: {
    fontSize: 12,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  actionButton: {
    flex: 1,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  busyText: {
    fontSize: 13,
  },
});
