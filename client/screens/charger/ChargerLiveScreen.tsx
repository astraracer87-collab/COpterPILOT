/**
 * Akkus-Tab, Startseite: Live-Ansicht des ISDT MA331.
 * Kopfzeile mit Verbindung, Firmware und Hub-Modus; drei gleich breite
 * Schacht-Karten; USB-Ports; „Rohdaten kopieren“ (letzte Frames als Hex, um
 * unbekannte Felder gemeinsam zu prüfen).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { ChargerSlotCard } from "@/components/charger/ChargerSlotCard";
import { BatteryAssignModal } from "@/components/charger/BatteryAssignModal";
import {
  connectCharger,
  isChargerPaired,
  useChargerSnapshot,
} from "@/hooks/useCharger";
import { chargerController } from "@/lib/charger/chargerControllerNative";
import { batteryKey } from "@/lib/charger/batteryFingerprint";
import { HINT_TEXT, SEARCH_ENDED_TEXT, type TransportState } from "@/lib/charger/bleTransport";
import { LOCATION_OFF_HINT } from "@/lib/charger/blePermissions";
import { requestEnableBluetooth } from "@/lib/charger/bleManagerAdapter";
import {
  chargeTargetLabel,
  hubModeLabel,
  USB_PORT_LABELS,
  usbStateLabel,
} from "@/lib/charger/ma331Protocol";
import type { ChargerStackParamList } from "@/navigation/ChargerStackNavigator";

type Nav = NativeStackNavigationProp<ChargerStackParamList, "ChargerLive">;

export const TRANSPORT_STATE_LABEL: Record<TransportState, string> = {
  idle: "Nicht verbunden",
  "bluetooth-off": "Bluetooth aus",
  scanning: "Suche Ladegerät …",
  connecting: "Verbinde …",
  pairing: "Kopple …",
  "waiting-confirm": "Am Ladegerät bestätigen",
  connected: "Verbunden",
  reconnecting: "Neuer Versuch …",
  stopped: "Getrennt",
};

const n1 = (x: number) =>
  x.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

export default function ChargerLiveScreen() {
  const navigation = useNavigation<Nav>();
  const { theme } = useTheme();
  const snap = useChargerSnapshot();
  const [paired, setPaired] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [locationOff, setLocationOff] = useState(false);
  const [copied, setCopied] = useState(false);

  const t = snap.transport;
  const state: TransportState = t?.state ?? "idle";
  const connected = state === "connected";
  const running = !!t && state !== "stopped" && state !== "idle";
  // Suche nach 30 s ohne Fund beendet → „Erneut suchen“
  const searchEnded = state === "stopped" && t?.lastError === SEARCH_ENDED_TEXT;

  useEffect(() => {
    void isChargerPaired()
      .then(setPaired)
      .catch(() => setPaired(false));
  }, [connected]);

  const start = useCallback(async () => {
    setMessage(null);
    const r = await connectCharger();
    if (!r.ok) setMessage(r.message ?? "Verbinden nicht möglich");
    setLocationOff(!!r.locationOff);
  }, []);

  const copyRaw = useCallback(async () => {
    const text = chargerController.rawFramesText(60);
    const header = `COpter Pilot – ISDT ${t?.deviceName ?? "MA331"} Rohdaten (${new Date().toLocaleString("de-DE")})\nFirmware ${t?.hardware?.firmwareLabel ?? "?"}, Geräte-ID ${t?.hardware?.deviceIdHex || "?"}, MTU ${t?.mtu ?? "?"}\n`;
    await Clipboard.setStringAsync(header + (text || "(noch keine Frames)"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [t]);

  const status = connected ? snap.status : null;
  const slots = [0, 1, 2].map(
    (i) => status?.slots.find((s) => s.index === i) ?? null,
  );
  const hint =
    locationOff && !connected
      ? LOCATION_OFF_HINT
      : t?.hint
        ? HINT_TEXT[t.hint]
        : null;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Kopfzeile */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
          testID="charger-header"
        >
          <View
            style={[
              styles.dot,
              {
                backgroundColor: connected
                  ? "#34C759"
                  : running
                    ? "#FFD60A"
                    : theme.textTertiary,
              },
            ]}
          />
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.headTitle} numberOfLines={1}>
              {t?.deviceName ?? "ISDT MA331"} · {TRANSPORT_STATE_LABEL[state]}
            </ThemedText>
            <ThemedText
              style={[styles.headSub, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {connected
                ? `FW ${t?.hardware?.firmwareLabel ?? "…"} · Modus ${hubModeLabel(status?.mode ?? null)}${t?.settings ? ` · Ziel ${chargeTargetLabel(t.settings.chargeTarget)}` : ""}${snap.backgroundActive ? " · loggt im Hintergrund" : ""}`
                : t?.lastError
                  ? t.lastError
                  : "Einstellungen am Gerät über das Zahnrad"}
            </ThemedText>
          </View>
          {running ? (
            <HeaderButton
              icon="x-circle"
              label="Trennen"
              onPress={() => void chargerController.disconnect("interrupted")}
              testID="charger-disconnect"
            />
          ) : (
            <HeaderButton
              icon={searchEnded ? "refresh-cw" : "bluetooth"}
              label={searchEnded ? "Erneut suchen" : "Verbinden"}
              onPress={() => void start()}
              testID="charger-connect"
            />
          )}
          {state === "reconnecting" ? (
            <HeaderButton
              icon="refresh-cw"
              label="Jetzt"
              onPress={() => chargerController.retryNow()}
              testID="charger-retry"
            />
          ) : null}
          <HeaderButton
            icon="copy"
            label={copied ? "Kopiert" : "Rohdaten kopieren"}
            onPress={() => void copyRaw()}
            testID="charger-copy-raw"
          />
          <HeaderButton
            icon="list"
            label="Akkus"
            onPress={() => navigation.navigate("ChargerBatteries")}
            testID="charger-open-batteries"
          />
          <HeaderButton
            icon="settings"
            label=""
            onPress={() => navigation.navigate("ChargerSettings")}
            testID="charger-open-settings"
          />
        </View>

        {hint || message ? (
          <View
            style={[
              styles.hint,
              {
                backgroundColor: theme.statusCautionBackground,
                borderColor: theme.statusCaution,
              },
            ]}
            testID="charger-hint"
          >
            <Feather name="info" size={16} color={theme.statusCaution} />
            <ThemedText style={[styles.hintText]}>{message ?? hint}</ThemedText>
            {state === "bluetooth-off" ? (
              <HeaderButton
                icon="power"
                label="Einschalten"
                onPress={() => void requestEnableBluetooth()}
              />
            ) : null}
          </View>
        ) : null}

        {!connected && !running && paired === false ? (
          <Pressable
            onPress={() => void start()}
            style={[
              styles.pairCard,
              {
                borderColor: theme.primary,
                backgroundColor: theme.backgroundDefault,
              },
            ]}
            testID="charger-pair-card"
          >
            <Feather name="bluetooth" size={28} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.headTitle}>
                Ladegerät koppeln
              </ThemedText>
              <ThemedText
                style={[styles.headSub, { color: theme.textSecondary }]}
              >
                ISDT MA331 einschalten, Polying-App schließen und hier tippen.
                Beim ersten Mal die Kopplung am Ladegerät bestätigen.
              </ThemedText>
            </View>
            <Feather
              name="chevron-right"
              size={20}
              color={theme.textSecondary}
            />
          </Pressable>
        ) : null}

        {snap.parseError ? (
          <ThemedText style={[styles.small, { color: theme.statusNoGo }]}>
            Unerwarteter Frame: {snap.parseError} – bitte „Rohdaten kopieren“.
          </ThemedText>
        ) : null}

        {/* Schächte */}
        <View style={styles.slots}>
          {slots.map((s, i) => {
            const ident = snap.slots[i];
            const session = snap.activeSessions.find((x) => x.slot === i);
            return (
              <ChargerSlotCard
                key={i}
                index={i}
                slot={s}
                batteryLabel={ident?.battery?.label ?? null}
                sessionActive={!!session}
                onPressBattery={
                  ident?.battery
                    ? () => {
                        const b = ident.battery!;
                        navigation.navigate("ChargerBatteryHistory", {
                          batteryKey: batteryKey(b),
                          label: b.label,
                        });
                      }
                    : undefined
                }
              />
            );
          })}
        </View>

        {/* USB */}
        <View
          style={[
            styles.usbRow,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
          testID="charger-usb-row"
        >
          <Feather name="zap" size={14} color={theme.textSecondary} />
          {(
            status?.usb ??
            [0, 1, 2].map((index) => ({
              index,
              state: 0,
              voltageV: 0,
              powerW: 0,
            }))
          ).map((u) => (
            <View key={u.index} style={styles.usbCell}>
              <ThemedText
                style={[styles.small, { color: theme.textSecondary }]}
              >
                {USB_PORT_LABELS[u.index] ?? `USB ${u.index + 1}`}
              </ThemedText>
              <ThemedText style={[styles.small, { fontWeight: "600" }]}>
                {status && u.state !== 0
                  ? `${n1(u.voltageV)} V · ${n1(u.powerW)} W`
                  : status
                    ? usbStateLabel(u.state)
                    : "–"}
              </ThemedText>
            </View>
          ))}
        </View>
      </ScrollView>
      <BatteryAssignModal
        prompt={snap.prompt}
        occupiedKeys={occupiedKeysExcept(snap.slots, snap.prompt?.slot)}
        onAnswer={(slot, ref) => void chargerController.answerPrompt(slot, ref)}
      />
    </ThemedView>
  );
}

function occupiedKeysExcept(
  slots: Record<number, { battery: Parameters<typeof batteryKey>[0] | null }>,
  slot: number | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const [idx, s] of Object.entries(slots)) {
    if (Number(idx) !== slot && s?.battery) out.add(batteryKey(s.battery));
  }
  return out;
}

function HeaderButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityLabel={label || icon}
      style={({ pressed }) => [
        styles.hbtn,
        {
          borderColor: theme.border,
          backgroundColor: theme.backgroundSecondary,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Feather name={icon} size={15} color={theme.primary} />
      {label ? <ThemedText style={styles.hbtnText}>{label}</ThemedText> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.sm, gap: Spacing.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  headTitle: { fontSize: 15, fontWeight: "700" },
  headSub: { fontSize: 12 },
  hbtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  hbtnText: { fontSize: 12, fontWeight: "600" },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  hintText: { flex: 1, fontSize: 13 },
  pairCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
  },
  slots: { flexDirection: "row", alignItems: "stretch", gap: Spacing.sm },
  usbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
  },
  usbCell: { flex: 1 },
  small: { fontSize: 12 },
});
