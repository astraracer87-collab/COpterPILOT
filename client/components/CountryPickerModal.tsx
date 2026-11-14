import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, Typography } from "@/constants/theme";
import {
  COUNTRY_MAPS,
  getCountryFlag,
  getCountryMapConfig,
} from "@/lib/countryMaps";
import { getSettings, saveSettings, type Settings } from "@/lib/storage";

type Props = {
  visible: boolean;
  currentIso?: string | null;
  onClose: () => void;
  onSelect: (iso: string) => void | Promise<void>;
  testIDPrefix?: string;
};

/**
 * Bottom-Sheet zum Auswählen des Flugland-Codes. Wird sowohl im NOTAM-Tab
 * als auch im Radar genutzt. Sortierung:
 *   1) Favoriten (mit Stern markiert, vom Pilot gepinnt)
 *   2) Restliche Länder nach Nutzungs-Häufigkeit (Most-Used zuerst)
 *   3) Tie-Breaker: alphabetisch nach deutschem Namen
 * Bei jedem `onSelect` wird der Usage-Counter im Settings-Profil erhöht,
 * damit beliebte Länder beim nächsten Öffnen schneller erreichbar sind.
 */
export default function CountryPickerModal({ visible, currentIso, onClose, onSelect, testIDPrefix = "country" }: Props) {
  const { theme } = useTheme();
  const [favorites, setFavorites] = useState<string[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!visible) return;
    let active = true;
    (async () => {
      try {
        const s = await getSettings();
        if (!active) return;
        setFavorites((s.favoriteCountries || []).map((x) => x.toUpperCase()));
        setUsage(s.countryUsageCounts || {});
      } catch {
        // best-effort
      }
    })();
    return () => { active = false; };
  }, [visible]);

  const sortedCountries = useMemo(() => {
    const favSet = new Set(favorites.map((x) => x.toUpperCase()));
    const list = [...COUNTRY_MAPS];
    list.sort((a, b) => {
      const ua = (usage[a.iso.toUpperCase()] || 0);
      const ub = (usage[b.iso.toUpperCase()] || 0);
      if (ub !== ua) return ub - ua;
      return a.nameDE.localeCompare(b.nameDE, "de");
    });
    const favs = list.filter((c) => favSet.has(c.iso.toUpperCase()));
    const rest = list.filter((c) => !favSet.has(c.iso.toUpperCase()));
    return { favs, rest };
  }, [favorites, usage]);

  const toggleFavorite = async (iso: string) => {
    const up = iso.toUpperCase();
    const next = favorites.includes(up)
      ? favorites.filter((x) => x !== up)
      : [...favorites, up];
    setFavorites(next);
    try {
      const s = await getSettings();
      await saveSettings({ ...s, favoriteCountries: next });
    } catch {
      // ignore, UI bleibt korrekt bis nächster Reload
    }
  };

  const handlePick = async (iso: string) => {
    const up = iso.toUpperCase();
    // Usage-Counter vor onSelect erhöhen, damit der Aufrufer das frische
    // settings-Objekt schon mit dem neuen Zählerstand wegschreiben kann.
    try {
      const s = await getSettings();
      const counts = { ...(s.countryUsageCounts || {}) };
      counts[up] = (counts[up] || 0) + 1;
      const next: Settings = { ...s, countryUsageCounts: counts };
      await saveSettings(next);
      setUsage(counts);
    } catch {
      // ignore
    }
    await onSelect(up);
  };

  const renderRow = (iso: string, nameDE: string) => {
    const up = iso.toUpperCase();
    const isActive = (currentIso || "").toUpperCase() === up;
    const isFav = favorites.includes(up);
    return (
      <View
        key={iso}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: Spacing.md,
          paddingHorizontal: Spacing.md,
          borderRadius: BorderRadius.md,
          backgroundColor: isActive ? theme.primary + "20" : "transparent",
          gap: Spacing.md,
        }}
      >
        <Pressable
          onPress={() => handlePick(iso)}
          testID={`button-${testIDPrefix}-${iso}`}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.md }}
          hitSlop={4}
        >
          <ThemedText style={{ fontSize: 22 }}>{getCountryFlag(iso)}</ThemedText>
          <ThemedText style={{
            ...Typography.body,
            color: isActive ? theme.primary : theme.text,
            fontWeight: isActive ? "700" : "500",
            flex: 1,
          }}>
            {nameDE}
          </ThemedText>
          {isActive ? (
            <Feather name="check" size={18} color={theme.primary} />
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => toggleFavorite(iso)}
          hitSlop={12}
          testID={`button-${testIDPrefix}-fav-${iso}`}
          style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}
        >
          <Feather
            name="star"
            size={18}
            color={isFav ? "#F4B400" : theme.textTertiary}
            style={{
              // Gefüllter Stern erst ab fontWeight bold nicht möglich — Feather
              // hat nur Outline. Wir zeigen aktive Favoriten in Gelb, inaktive grau.
            }}
          />
        </Pressable>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: Spacing.md,
            paddingBottom: Spacing.xl,
            maxHeight: "78%",
          }}
        >
          <View style={{ alignItems: "center", marginBottom: Spacing.sm }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
          </View>
          <ThemedText style={{
            ...Typography.h3,
            color: theme.text,
            textAlign: "center",
            marginBottom: Spacing.xs,
            paddingHorizontal: Spacing.lg,
          }}>
            Land auswählen
          </ThemedText>
          <ThemedText style={{
            ...Typography.caption,
            color: theme.textTertiary,
            textAlign: "center",
            marginBottom: Spacing.md,
            paddingHorizontal: Spacing.lg,
          }}>
            Tippe auf den Stern, um ein Land als Favorit zu pinnen.
          </ThemedText>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md }}
            showsVerticalScrollIndicator={false}
          >
            {sortedCountries.favs.length > 0 ? (
              <>
                <ThemedText style={{
                  ...Typography.small,
                  color: theme.textSecondary,
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  paddingHorizontal: Spacing.sm,
                  marginBottom: 4,
                  marginTop: 4,
                }}>
                  FAVORITEN
                </ThemedText>
                {sortedCountries.favs.map((c) => renderRow(c.iso, c.nameDE))}
                <ThemedText style={{
                  ...Typography.small,
                  color: theme.textSecondary,
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  paddingHorizontal: Spacing.sm,
                  marginTop: Spacing.md,
                  marginBottom: 4,
                }}>
                  ALLE LÄNDER
                </ThemedText>
              </>
            ) : null}
            {sortedCountries.rest.map((c) => renderRow(c.iso, c.nameDE))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Helper zum Anzeigen der aktiven Länderbezeichnung — nutzbar in Buttons,
 * die das Picker-Modal öffnen.
 */
export function getCountryLabel(iso: string | null | undefined): string {
  const cfg = getCountryMapConfig(iso || "DE");
  return cfg?.nameDE || (iso || "DE").toUpperCase();
}
