import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { ANDROID_BLOCKED_STEPS } from "@/components/DjiLogHelp";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  DJI_DOWNLOAD_FLIGHTRECORDS_PATH,
  DJI_FLY_FLIGHTRECORD_PATH,
  checkDjiLogFolderAccess,
  chooseDjiLogFolder,
  clearDjiLogFolder,
  folderLabelFromUri,
  getDjiLogAutoCheck,
  getDjiLogFolder,
  isAndroidDataFolder,
  isFolderImportSupported,
  refreshDjiLogNewHint,
  setDjiLogAutoCheck,
  subscribeDjiLogFolder,
  type DjiLogFolderAccess,
} from "@/lib/djiLogFolder";

type Status =
  | { kind: "none" }
  | { kind: "checking" }
  | { kind: "result"; access: DjiLogFolderAccess };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Statuszeile zur Freigabe (auch für Tests exportiert). */
export function djiLogFolderStatusText(access: DjiLogFolderAccess): string {
  if (!access.ok) return "Zugriff verloren – Ordner bitte erneut wählen.";
  if (access.count === 0) return "Zugriff OK · keine Flugprotokolle (.txt) gefunden";
  return `Zugriff OK · ${plural(access.count, "Protokoll", "Protokolle")} (.txt) · ${access.newCount} noch nicht importiert`;
}

/**
 * Einstellungen: Speicherort der DJI-Flugprotokolle (SAF-Ordnerfreigabe).
 * Derselbe gemerkte Ordner wie im Logbuch („Mehrere Logs / Ordner“).
 */
export function DjiLogFolderCard() {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const supported = isFolderImportSupported();
  const [folderUri, setFolderUri] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [autoCheck, setAutoCheckState] = useState(false);
  const checkSeq = useRef(0);

  const check = useCallback(async (uri: string | null) => {
    const seq = ++checkSeq.current;
    if (!uri) {
      setStatus({ kind: "none" });
      return;
    }
    setStatus({ kind: "checking" });
    const access = await checkDjiLogFolderAccess(uri).catch(
      (e): DjiLogFolderAccess => ({ ok: false, count: 0, newCount: 0, error: String(e) }),
    );
    if (seq === checkSeq.current) setStatus({ kind: "result", access });
  }, []);

  useEffect(() => {
    let alive = true;
    getDjiLogFolder()
      .then((uri) => {
        if (!alive) return;
        setFolderUri(uri);
        if (supported) void check(uri);
      })
      .catch(() => {});
    getDjiLogAutoCheck()
      .then((v) => alive && setAutoCheckState(v))
      .catch(() => {});
    // Logbuch ändert den Ordner → hier mitziehen
    const unsub = subscribeDjiLogFolder((uri) => {
      if (!alive) return;
      setFolderUri(uri);
      if (supported) void check(uri);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [check, supported]);

  const pick = useCallback(
    async (initial: "djiFly" | "download"): Promise<string | null> => {
      setBusy(true);
      try {
        const uri = await chooseDjiLogFolder(initial);
        if (uri) {
          setRefused(false);
          setFolderUri(uri);
          await check(uri);
          refreshDjiLogNewHint().catch(() => {});
        } else if (initial === "djiFly") {
          // abgebrochen oder von Android 11 verweigert (Android/data gesperrt)
          setRefused(true);
        }
        return uri;
      } catch (e) {
        if (initial === "djiFly") setRefused(true);
        Alert.alert("Ordner", e instanceof Error ? e.message : "Ordner konnte nicht geöffnet werden.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [check],
  );

  const suggest = useCallback(async () => {
    const uri = await pick("djiFly");
    if (uri) return;
    Alert.alert(
      "DJI-Fly-Ordner nicht freigegeben",
      `Android 11 gibt „${DJI_FLY_FLIGHTRECORD_PATH}“ oft nicht frei. Protokolle per PC/USB nach „${DJI_DOWNLOAD_FLIGHTRECORDS_PATH}“ kopieren und diesen Ordner wählen?`,
      [
        { text: "Abbrechen", style: "cancel" },
        { text: `${DJI_DOWNLOAD_FLIGHTRECORDS_PATH} wählen`, onPress: () => void pick("download") },
      ],
    );
  }, [pick]);

  const remove = useCallback(async () => {
    await clearDjiLogFolder();
    setFolderUri(null);
    setStatus({ kind: "none" });
  }, []);

  const importNow = useCallback(() => {
    // Logbuch → „Mehrere Logs / Ordner“, gemerkter Ordner wird sofort eingelesen
    (navigation as unknown as { navigate(r: string, p: unknown): void }).navigate("HistoryTab", {
      screen: "DjiBulkImport",
      params: { autoImportAt: Date.now() },
      initial: false,
    });
  }, [navigation]);

  const toggleAuto = useCallback((v: boolean) => {
    setAutoCheckState(v);
    setDjiLogAutoCheck(v)
      .then(() => refreshDjiLogNewHint())
      .catch(() => {});
  }, []);

  const access = status.kind === "result" ? status.access : null;
  const lost = access != null && !access.ok;
  const showBlockedHelp = refused || (lost && folderUri != null && isAndroidDataFolder(folderUri));

  const button = (
    testID: string,
    icon: React.ComponentProps<typeof Feather>["name"],
    label: string,
    onPress: () => void,
    variant: "primary" | "plain" | "danger" | "go" = "plain",
    disabled = false,
  ) => {
    const colors =
      variant === "primary"
        ? { bg: theme.primary, fg: "#FFFFFF" }
        : variant === "danger"
          ? { bg: "rgba(255,59,48,0.12)", fg: "#FF3B30" }
          : variant === "go"
            ? { bg: theme.statusGoBackground, fg: theme.statusGo }
            : { bg: theme.backgroundSecondary, fg: theme.text };
    const off = disabled || busy;
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={off}
        accessibilityRole="button"
        accessibilityState={{ disabled: off }}
        style={[styles.btn, { backgroundColor: colors.bg, opacity: off ? 0.5 : 1 }]}
      >
        <Feather name={icon} size={16} color={colors.fg} />
        <ThemedText style={[styles.btnText, { color: colors.fg }]}>{label}</ThemedText>
      </Pressable>
    );
  };

  return (
    <Card style={styles.card} testID="card-dji-log-folder">
      <ThemedText style={styles.title}>DJI-Flugprotokolle – Speicherort</ThemedText>
      <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
        {`DJI Fly speichert die Flugprotokolle in „${DJI_FLY_FLIGHTRECORD_PATH}“. Gib den Ordner einmal frei – das Logbuch („Mehrere Logs / Ordner“) liest dann nur noch neue Protokolle ein.`}
      </ThemedText>

      {!supported ? (
        <ThemedText style={[styles.small, { marginTop: Spacing.md }]} testID="text-dji-folder-unsupported">
          Die Ordner-Freigabe gibt es nur auf Android. Einzelne Protokolle lassen sich im Logbuch über „Fluglog auswerten“
          wählen.
        </ThemedText>
      ) : (
        <>
          <View style={[styles.row, { marginTop: Spacing.md }]}>
            <Feather name="folder" size={18} color={folderUri ? theme.primary : theme.textTertiary} />
            <ThemedText style={[styles.rowLabel, { flex: 1 }]} numberOfLines={2} testID="text-dji-folder-path">
              {folderUri ? folderLabelFromUri(folderUri) : "Kein Ordner freigegeben"}
            </ThemedText>
          </View>

          {folderUri ? (
            <View style={[styles.row, { marginTop: Spacing.xs }]}>
              {status.kind === "checking" ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Feather
                  name={lost ? "alert-triangle" : "check-circle"}
                  size={16}
                  color={lost ? theme.statusNoGo : theme.statusGo}
                />
              )}
              <ThemedText
                style={[styles.small, { flex: 1, color: lost ? theme.statusNoGo : theme.text }]}
                testID="text-dji-folder-status"
              >
                {status.kind === "checking" ? "Prüfe Zugriff …" : access ? djiLogFolderStatusText(access) : ""}
              </ThemedText>
              <Pressable
                testID="button-dji-folder-recheck"
                onPress={() => void check(folderUri)}
                disabled={status.kind === "checking"}
                accessibilityLabel="Zugriff erneut prüfen"
                hitSlop={8}
              >
                <Feather name="refresh-cw" size={16} color={theme.primary} />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.btnWrap}>
            {button("button-dji-folder-choose", "folder-plus", "Ordner wählen / freigeben", () => void pick("djiFly"), "primary")}
            {button("button-dji-folder-suggest", "compass", "DJI-Fly-Ordner vorschlagen", () => void suggest())}
            {folderUri
              ? button("button-dji-folder-import", "download", "Jetzt neue Logs importieren", importNow, "go", lost)
              : null}
            {folderUri ? button("button-dji-folder-remove", "x-circle", "Freigabe entfernen", () => void remove(), "danger") : null}
          </View>

          {showBlockedHelp ? (
            <View
              style={[styles.helpBox, { backgroundColor: theme.statusCautionBackground }]}
              testID="box-dji-folder-blocked"
            >
              <ThemedText style={[styles.small, { fontWeight: "700", color: theme.statusCaution }]}>
                {lost ? "Zugriff auf den Ordner verloren" : "DJI-Fly-Ordner nicht freigegeben?"}
              </ThemedText>
              {ANDROID_BLOCKED_STEPS.map((step, i) => (
                <View key={i} style={styles.step}>
                  <ThemedText style={[styles.small, { fontWeight: "700", color: theme.statusCaution }]}>{i + 1}.</ThemedText>
                  <ThemedText style={[styles.small, { flex: 1 }]}>{step}</ThemedText>
                </View>
              ))}
              <View style={{ alignSelf: "flex-start" }}>
                {button(
                  "button-dji-folder-download",
                  "download",
                  `„${DJI_DOWNLOAD_FLIGHTRECORDS_PATH}“ wählen`,
                  () => void pick("download"),
                )}
              </View>
            </View>
          ) : null}

          <View style={[styles.row, { marginTop: Spacing.md }]}>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.rowLabel}>Neue Logs beim App-Start automatisch prüfen</ThemedText>
              <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
                Still, ohne Benachrichtigung – das Logbuch zeigt nur die Zahl neuer Protokolle an.
              </ThemedText>
            </View>
            <Switch testID="switch-dji-folder-autocheck" value={autoCheck} onValueChange={toggleAuto} />
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.lg },
  title: { ...Typography.body, fontWeight: "700", marginBottom: Spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rowLabel: { ...Typography.body, fontWeight: "600" },
  small: { ...Typography.small },
  step: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  btnWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.md },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: { fontWeight: "700" },
  helpBox: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: BorderRadius.sm, gap: 6 },
});
