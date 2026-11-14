import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Share,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import { Feather } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  DroneProfile,
  DroneFoundReport,
  getDrone,
} from "@/lib/storage";
import { isLoggedInSync } from "@/lib/auth";
import {
  apiEnableFound,
  apiDisableFound,
  apiRegenerateFoundToken,
  apiSetFoundConfig,
  apiGetFoundReports,
  apiMarkFoundReportRead,
  apiDeleteFoundReport,
  getApiUrl,
} from "@/lib/api";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";
import { markFoundReportsSeen } from "@/lib/foundNotifications";

type RouteParams = RouteProp<SettingsStackParamList, "DroneFoundLink">;

function buildPublicUrl(token: string): string {
  const base = getApiUrl().replace(/\/$/, "");
  return `${base}/found/${encodeURIComponent(token)}`;
}

export default function DroneFoundLinkScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const droneId = route.params?.droneId;

  const [drone, setDrone] = useState<DroneProfile | null>(null);
  const [reports, setReports] = useState<DroneFoundReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [customMessage, setCustomMessage] = useState("");

  const isOnline = isLoggedInSync();

  const load = useCallback(async () => {
    if (!droneId) return;
    try {
      const d = await getDrone(droneId);
      if (d) {
        setDrone(d);
        setDisplayName(d.foundDisplayName ?? "");
        setContactEmail(d.foundContactEmail ?? "");
        setContactPhone(d.foundContactPhone ?? "");
        setCustomMessage(d.foundCustomMessage ?? "");
      }
      if (isOnline && d?.foundEnabled) {
        try {
          const r = await apiGetFoundReports(droneId);
          setReports(r);
          await markFoundReportsSeen(r.map((x) => x.id));
        } catch (e) {
          console.warn("[found] reports load failed", e);
        }
      } else {
        setReports([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [droneId, isOnline]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const enable = useCallback(async () => {
    if (!droneId || !isOnline) {
      Alert.alert("Login erforderlich", "Lost & Found benötigt einen aktiven Account, damit der öffentliche Link erreichbar ist.");
      return;
    }
    setBusy(true);
    try {
      const updated = await apiEnableFound(droneId);
      setDrone(updated);
    } catch (e) {
      Alert.alert("Fehler", e instanceof Error ? e.message : "Aktivierung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }, [droneId, isOnline]);

  const disable = useCallback(async () => {
    if (!droneId) return;
    Alert.alert(
      "Lost & Found deaktivieren?",
      "Der QR-Code zeigt dann eine neutrale Fundseite, aber der Link bleibt funktionsfähig. Neue Funde werden nicht mehr Ihnen zugeordnet.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Deaktivieren",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              const updated = await apiDisableFound(droneId);
              setDrone(updated);
            } catch (e) {
              Alert.alert("Fehler", e instanceof Error ? e.message : "Fehler");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [droneId]);

  const regenerate = useCallback(async () => {
    if (!droneId) return;
    Alert.alert(
      "Neuen QR-Code erzeugen?",
      "Der alte QR-Code wird sofort ungültig. Bestehende Sticker müssen ersetzt werden.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Neu erzeugen",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              const updated = await apiRegenerateFoundToken(droneId);
              setDrone(updated);
            } catch (e) {
              Alert.alert("Fehler", e instanceof Error ? e.message : "Fehler");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [droneId]);

  const saveConfig = useCallback(async () => {
    if (!droneId) return;
    setBusy(true);
    try {
      const updated = await apiSetFoundConfig(droneId, {
        foundDisplayName: displayName.trim() || null,
        foundContactEmail: contactEmail.trim() || null,
        foundContactPhone: contactPhone.trim() || null,
        foundCustomMessage: customMessage.trim() || null,
      });
      setDrone(updated);
      Alert.alert("Gespeichert", "Anzeige-Daten wurden aktualisiert.");
    } catch (e) {
      Alert.alert("Fehler", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }, [droneId, displayName, contactEmail, contactPhone, customMessage]);

  const publicUrl = useMemo(() => {
    if (!drone?.foundToken) return null;
    return buildPublicUrl(drone.foundToken);
  }, [drone?.foundToken]);

  const copyLink = useCallback(async () => {
    if (!publicUrl) return;
    await Clipboard.setStringAsync(publicUrl);
    Alert.alert("Kopiert", "Lost & Found-Link wurde in die Zwischenablage kopiert.");
  }, [publicUrl]);

  const shareLink = useCallback(async () => {
    if (!publicUrl) return;
    try {
      await Share.share({ message: publicUrl, url: publicUrl });
    } catch {}
  }, [publicUrl]);

  const exportPdf = useCallback(async () => {
    if (!publicUrl || !drone) return;
    const safeName = (drone.foundDisplayName || drone.name || "Drohne").replace(/[<>&"]/g, "");
    const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
      body{font-family:-apple-system,BlinkMacSystemFont,Helvetica,sans-serif;margin:40px;text-align:center;color:#111;}
      h1{margin:0 0 6px;font-size:22px;color:#0A4D8C;}
      .sub{color:#555;margin-bottom:24px;}
      .qr{margin:30px auto;display:inline-block;padding:16px;border:1px solid #ddd;border-radius:12px;}
      .url{font-size:12px;color:#666;word-break:break-all;margin-top:18px;}
      .footer{margin-top:30px;font-size:11px;color:#999;}
    </style></head><body>
      <h1>Lost &amp; Found</h1>
      <div class="sub">${safeName}</div>
      <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&amp;data=${encodeURIComponent(publicUrl)}" width="280" height="280" /></div>
      <div>Wenn Sie diese Drohne gefunden haben:<br/>QR scannen oder Link öffnen.</div>
      <div class="url">${publicUrl}</div>
      <div class="footer">COpter Pilot — Lost &amp; Found</div>
    </body></html>`;
    try {
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "QR-Code teilen" });
      } else {
        Alert.alert("PDF erstellt", uri);
      }
    } catch (e) {
      Alert.alert("Fehler", e instanceof Error ? e.message : "PDF-Export fehlgeschlagen");
    }
  }, [publicUrl, drone]);

  const handleMarkRead = useCallback(async (r: DroneFoundReport) => {
    if (!droneId || r.readAt) return;
    try {
      await apiMarkFoundReportRead(droneId, r.id);
      setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, readAt: new Date().toISOString() } : x)));
    } catch {}
  }, [droneId]);

  const handleDelete = useCallback((r: DroneFoundReport) => {
    if (!droneId) return;
    Alert.alert("Meldung löschen?", "", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          try {
            await apiDeleteFoundReport(droneId, r.id);
            setReports((prev) => prev.filter((x) => x.id !== r.id));
          } catch (e) {
            Alert.alert("Fehler", e instanceof Error ? e.message : "Fehler");
          }
        },
      },
    ]);
  }, [droneId]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background, paddingTop: headerHeight }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (!drone) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background, paddingTop: headerHeight }]}>
        <ThemedText>Drohne nicht gefunden.</ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl, paddingHorizontal: Spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
    >
      <Card style={styles.card}>
        <View style={styles.row}>
          <Feather name="map-pin" size={20} color={theme.primary} />
          <ThemedText style={styles.title}>{drone.name}</ThemedText>
        </View>
        <ThemedText style={[styles.desc, { color: theme.textSecondary }]}>
          Generieren Sie einen öffentlichen QR-Code, den Sie auf Ihre Drohne kleben. Wer sie findet, kann Sie sofort kontaktieren — ohne Ihre eID oder Operator-Nummer offenzulegen.
        </ThemedText>

        {!isOnline ? (
          <View style={[styles.notice, { backgroundColor: "#F59E0B22", borderColor: "#F59E0B" }]}>
            <Feather name="info" size={16} color="#F59E0B" />
            <ThemedText style={[styles.noticeText, { color: theme.text }]}>
              Lost & Found benötigt einen Account. Bitte einloggen, damit der öffentliche Link erreichbar ist.
            </ThemedText>
          </View>
        ) : null}

        {drone.foundEnabled && drone.foundToken && publicUrl ? (
          <View style={styles.qrBox}>
            <View style={{ backgroundColor: "#FFF", padding: 16, borderRadius: BorderRadius.md }}>
              <QRCode value={publicUrl} size={220} />
            </View>
            <ThemedText style={[styles.url, { color: theme.textSecondary }]} selectable>
              {publicUrl}
            </ThemedText>

            <View style={styles.actionRow}>
              <Pressable onPress={copyLink} style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.backgroundSecondary }, pressed && styles.pressed]}>
                <Feather name="copy" size={18} color={theme.primary} />
                <ThemedText style={styles.iconBtnLabel}>Kopieren</ThemedText>
              </Pressable>
              <Pressable onPress={shareLink} style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.backgroundSecondary }, pressed && styles.pressed]}>
                <Feather name="share-2" size={18} color={theme.primary} />
                <ThemedText style={styles.iconBtnLabel}>Teilen</ThemedText>
              </Pressable>
              <Pressable onPress={exportPdf} style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.backgroundSecondary }, pressed && styles.pressed]}>
                <Feather name="file-text" size={18} color={theme.primary} />
                <ThemedText style={styles.iconBtnLabel}>PDF</ThemedText>
              </Pressable>
            </View>

            <Button title="Neuen QR-Code erzeugen" variant="secondary" onPress={regenerate} loading={busy} />
            <View style={{ height: Spacing.sm }} />
            <Button title="Lost & Found deaktivieren" variant="secondary" onPress={disable} loading={busy} />
          </View>
        ) : (
          <Button title="Lost & Found aktivieren" onPress={enable} loading={busy} disabled={!isOnline} />
        )}
      </Card>

      {drone.foundEnabled ? (
        <Card style={styles.card}>
          <ThemedText style={styles.sectionTitle}>Anzeige-Daten auf der Fundseite</ThemedText>
          <ThemedText style={[styles.desc, { color: theme.textSecondary }]}>
            Nur diese Felder werden öffentlich auf der Fundseite gezeigt.
          </ThemedText>
          <Field label="Anzeigename" value={displayName} onChange={setDisplayName} placeholder={drone.name} theme={theme} />
          <Field label="Kontakt E-Mail" value={contactEmail} onChange={setContactEmail} placeholder="kontakt@beispiel.de" keyboardType="email-address" theme={theme} />
          <Field label="Kontakt Telefon" value={contactPhone} onChange={setContactPhone} placeholder="+49 …" keyboardType="phone-pad" theme={theme} />
          <Field label="Nachricht an den Finder" value={customMessage} onChange={setCustomMessage} placeholder="Vielen Dank fürs Helfen!" multiline theme={theme} />
          <Button title="Speichern" onPress={saveConfig} loading={busy} />
        </Card>
      ) : null}

      {drone.foundEnabled ? (
        <Card style={styles.card}>
          <ThemedText style={styles.sectionTitle}>
            Meldungen ({reports.length})
          </ThemedText>
          {reports.length === 0 ? (
            <ThemedText style={[styles.desc, { color: theme.textSecondary }]}>
              Noch keine Meldungen.
            </ThemedText>
          ) : (
            reports.map((r) => (
              <ReportItem
                key={r.id}
                report={r}
                theme={theme}
                onMarkRead={() => handleMarkRead(r)}
                onDelete={() => handleDelete(r)}
              />
            ))
          )}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
  theme,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "email-address" | "phone-pad";
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  return (
    <View style={{ marginBottom: Spacing.md }}>
      <ThemedText style={[styles.label, { color: theme.textSecondary }]}>{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        multiline={!!multiline}
        style={[
          styles.input,
          multiline && { minHeight: 90, textAlignVertical: "top" },
          { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border },
        ]}
      />
    </View>
  );
}

function ReportItem({
  report,
  theme,
  onMarkRead,
  onDelete,
}: {
  report: DroneFoundReport;
  theme: ReturnType<typeof useTheme>["theme"];
  onMarkRead: () => void;
  onDelete: () => void;
}) {
  const unread = !report.readAt;
  const created = new Date(report.createdAt);
  return (
    <View style={[styles.reportRow, { borderTopColor: theme.border }]}>
      <View style={styles.reportHead}>
        <View style={{ flex: 1 }}>
          <ThemedText style={[styles.reportName]}>
            {unread ? "● " : ""}
            {report.finderName?.trim() || "Anonymer Finder"}
          </ThemedText>
          <ThemedText style={[styles.reportTs, { color: theme.textTertiary }]}>
            {created.toLocaleString("de-DE")}
          </ThemedText>
        </View>
        <Pressable onPress={onDelete} hitSlop={10}>
          <Feather name="trash-2" size={16} color={theme.textTertiary} />
        </Pressable>
      </View>
      {report.message ? (
        <ThemedText style={styles.reportMsg}>{report.message}</ThemedText>
      ) : null}
      {report.finderContact ? (
        <ThemedText style={[styles.reportMeta, { color: theme.textSecondary }]}>
          Kontakt: {report.finderContact}
        </ThemedText>
      ) : null}
      {report.lat != null && report.lon != null ? (
        <ThemedText style={[styles.reportMeta, { color: theme.textSecondary }]}>
          Fundort: {report.lat.toFixed(5)}, {report.lon.toFixed(5)}
        </ThemedText>
      ) : null}
      {unread ? (
        <Pressable onPress={onMarkRead} style={({ pressed }) => [styles.readBtn, pressed && styles.pressed]}>
          <Feather name="check" size={14} color={theme.primary} />
          <ThemedText style={[styles.readBtnText, { color: theme.primary }]}>
            Als gelesen markieren
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { padding: Spacing.lg, marginBottom: Spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.sm },
  title: { ...Typography.h3, fontSize: 18 },
  desc: { fontSize: 14, lineHeight: 20, marginBottom: Spacing.md },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  qrBox: { alignItems: "center", gap: Spacing.md },
  url: { fontSize: 12, textAlign: "center", paddingHorizontal: Spacing.sm },
  actionRow: { flexDirection: "row", gap: Spacing.sm, marginVertical: Spacing.sm, alignSelf: "stretch", justifyContent: "space-around" },
  iconBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
  },
  iconBtnLabel: { fontSize: 13, fontWeight: "600" },
  pressed: { opacity: 0.6 },
  sectionTitle: { ...Typography.h3, fontSize: 16, marginBottom: Spacing.sm },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 15,
  },
  reportRow: { paddingVertical: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  reportHead: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm },
  reportName: { fontSize: 15, fontWeight: "700" },
  reportTs: { fontSize: 12, marginTop: 2 },
  reportMsg: { fontSize: 14, marginTop: 6, lineHeight: 20 },
  reportMeta: { fontSize: 12, marginTop: 4 },
  readBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  readBtnText: { fontSize: 12, fontWeight: "600" },
});

