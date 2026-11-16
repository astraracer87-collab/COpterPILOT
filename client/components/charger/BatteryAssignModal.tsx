/**
 * „Welcher Akku ist das?“ – einmalige Zuordnung eines am Ladegerät erkannten
 * Akkus (Produktionsdatum + Zyklen) zu einem Akku der App oder „Neuer Akku“.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, Typography } from "@/constants/theme";
import type { BatteryPrompt } from "@/lib/charger/chargerController";
import type { BatteryRef } from "@/lib/charger/chargeSession";
import {
  createBatteryForCharger,
  listAllBatteries,
  refOf,
  type AppBattery,
} from "@/lib/charger/batteryAccounts";

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function BatteryAssignModal({
  prompt,
  onAnswer,
}: {
  prompt: BatteryPrompt | null;
  onAnswer: (slot: number, ref: BatteryRef | undefined) => void;
}) {
  if (!prompt) return null;
  // neue Frage → frischer Zustand (key)
  const key = `${prompt.slot}-${prompt.fingerprint.productionDate}-${prompt.fingerprint.cycles}`;
  return <AssignDialog key={key} prompt={prompt} onAnswer={onAnswer} />;
}

function AssignDialog({
  prompt,
  onAnswer,
}: {
  prompt: BatteryPrompt;
  onAnswer: (slot: number, ref: BatteryRef | undefined) => void;
}) {
  const { theme } = useTheme();
  const [batteries, setBatteries] = useState<AppBattery[]>([]);
  const [newName, setNewName] = useState(
    () => `Akku ${fmtDate(prompt.fingerprint.productionDate)}`,
  );
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listAllBatteries()
      .then((b) => !cancelled && setBatteries(b))
      .catch(() => !cancelled && setBatteries([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const candidateKeys = useMemo(
    () => new Set(prompt.candidates.map((c) => c.key)),
    [prompt],
  );
  const ordered = useMemo(
    () =>
      [...batteries].sort(
        (a, b) =>
          Number(candidateKeys.has(b.key)) - Number(candidateKeys.has(a.key)),
      ),
    [batteries, candidateKeys],
  );

  const slot = prompt.slot;

  const create = async () => {
    setBusy(true);
    try {
      const ref = await createBatteryForCharger(newName);
      onAnswer(slot, ref);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => onAnswer(slot, undefined)}
      supportedOrientations={["landscape", "portrait"]}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.box,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
          testID="battery-assign-modal"
        >
          <ThemedText style={styles.title}>Welcher Akku ist das?</ThemedText>
          <ThemedText style={[styles.sub, { color: theme.textSecondary }]}>
            Schacht {slot + 1} · Produktion{" "}
            {fmtDate(prompt.fingerprint.productionDate)} ·{" "}
            {prompt.fingerprint.cycles} Zyklen
            {prompt.reason === "ambiguous" ? " · mehrere Akkus passen" : ""}
          </ThemedText>
          <ScrollView
            style={{ maxHeight: 260 }}
            contentContainerStyle={{ gap: 6 }}
          >
            {ordered.map((b) => (
              <Pressable
                key={b.key}
                testID={`battery-assign-${b.key}`}
                onPress={() => onAnswer(slot, refOf(b))}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderColor: candidateKeys.has(b.key)
                      ? theme.primary
                      : theme.border,
                    backgroundColor: theme.backgroundSecondary,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Feather name="battery" size={16} color={theme.primary} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.rowTitle}>
                    {b.label}
                    {b.droneName ? ` · ${b.droneName}` : ""}
                  </ThemedText>
                  <ThemedText
                    style={[styles.rowSub, { color: theme.textSecondary }]}
                  >
                    {b.link
                      ? `zuletzt ${b.link.lastCycles} Zyklen, Prod. ${fmtDate(b.link.productionDate)}`
                      : "noch nicht am Ladegerät gesehen"}
                    {b.serialNumber ? ` · SN ${b.serialNumber}` : ""}
                  </ThemedText>
                </View>
                {candidateKeys.has(b.key) ? (
                  <ThemedText style={[styles.rowSub, { color: theme.primary }]}>
                    passt
                  </ThemedText>
                ) : null}
              </Pressable>
            ))}
            {ordered.length === 0 ? (
              <ThemedText
                style={[styles.rowSub, { color: theme.textSecondary }]}
              >
                Noch keine Akkus angelegt.
              </ThemedText>
            ) : null}
          </ScrollView>
          {creating ? (
            <View style={styles.newRow}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundSecondary,
                  },
                ]}
                placeholder="Name des Akkus"
                placeholderTextColor={theme.textTertiary}
                testID="battery-assign-new-name"
                disableFullscreenUI
              />
              <Pressable
                disabled={busy}
                onPress={() => void create()}
                style={[styles.btn, { backgroundColor: theme.primary }]}
                testID="battery-assign-create"
              >
                <ThemedText style={styles.btnText}>Anlegen</ThemedText>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.buttons}>
            <Pressable
              onPress={() => onAnswer(slot, undefined)}
              style={[
                styles.btn,
                { backgroundColor: theme.backgroundSecondary },
              ]}
              testID="battery-assign-later"
            >
              <ThemedText style={[styles.btnText, { color: theme.text }]}>
                Später
              </ThemedText>
            </Pressable>
            {!creating ? (
              <Pressable
                onPress={() => setCreating(true)}
                style={[styles.btn, { backgroundColor: theme.primary }]}
                testID="battery-assign-new"
              >
                <ThemedText style={styles.btnText}>Neuer Akku</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  box: {
    width: "100%",
    maxWidth: 620,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: { ...Typography.h4 },
  sub: { ...Typography.small },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
  },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 12 },
  newRow: { flexDirection: "row", gap: Spacing.sm, alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    height: 40,
    fontSize: 15,
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  btn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  btnText: { color: "#FFFFFF", fontWeight: "600", fontSize: 15 },
});
