// Cinematic-Vorschau: Wolkenmeer-/Hochnebel-Score der nächsten 24 h für
// Gipfel in der Nähe (Hyperlapse/Cinematic über dem Nebelmeer) und die
// Benachrichtigungs-Einstellungen. Die Vorschau ist ein Filter – vor Ort
// zählen Sicht (VLOS), Luftraum und Geozonen.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  useWindowDimensions,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { formatHour, formatWindow, type HourScore } from "@/lib/cinematicFog";
import {
  DEFAULT_CINEMATIC_SETTINGS,
  DISTANCE_CHOICES,
  THRESHOLD_CHOICES,
  getCinematicForecast,
  loadCinematicSettings,
  saveCinematicSettings,
  type CinematicResult,
  type CinematicSettings,
  type SpotForecast,
  CINEMATIC_SOURCE_TEXT,
} from "@/lib/cinematicForecast";
import { requestCinematicNotificationPermission, resolveMaxGustMs } from "@/lib/cinematicNotify";

type Theme = ReturnType<typeof useTheme>["theme"];

function scoreColor(score: number, theme: Theme): string {
  if (score >= 70) return theme.statusGo;
  if (score >= 40) return theme.statusCaution;
  if (score >= 15) return theme.textTertiary;
  return theme.backgroundTertiary;
}

function formatStand(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())} Uhr`;
}

function de1(v: number): string {
  return v.toFixed(1).replace(".", ",");
}

export default function CinematicForecastScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const [settings, setSettings] = useState<CinematicSettings>(DEFAULT_CINEMATIC_SETTINGS);
  const [result, setResult] = useState<CinematicResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const gustRef = useRef<number | undefined>(undefined);

  const load = useCallback(async (s: CinematicSettings, opts: { force?: boolean; cacheOnly?: boolean } = {}) => {
    if (gustRef.current == null) gustRef.current = await resolveMaxGustMs();
    const r = await getCinematicForecast({ radiusKm: s.maxDistanceKm, maxGustMs: gustRef.current, ...opts });
    setResult(r);
    return r;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await loadCinematicSettings();
      if (!alive) return;
      setSettings(s);
      // Erst sofort aus dem Speicher, dann (falls nötig) abrufen
      await load(s, { cacheOnly: true }).catch(() => null);
      if (!alive) return;
      await load(s).catch(() => null);
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(settings, { force: true });
    } finally {
      setRefreshing(false);
    }
  }, [load, settings]);

  const updateSettings = useCallback(
    async (patch: Partial<CinematicSettings>) => {
      const next = { ...settings, ...patch };
      if (patch.notifyEnabled) {
        const ok = await requestCinematicNotificationPermission().catch(() => false);
        if (!ok) {
          Alert.alert(
            "Benachrichtigungen",
            "Benachrichtigungen sind für die App nicht erlaubt. Bitte in den Android-Einstellungen freigeben.",
          );
          return;
        }
      }
      setSettings(next);
      await saveCinematicSettings(next);
      if (patch.maxDistanceKm != null && patch.maxDistanceKm !== settings.maxDistanceKm) {
        setLoading(true);
        await load(next).catch(() => null);
        setLoading(false);
      }
    },
    [settings, load],
  );

  const openMap = useCallback(
    (f: SpotForecast) => {
      navigation.navigate("FlightPlanning", {
        screen: "PlanningLiveTraffic",
        params: { latitude: f.spot.latitude, longitude: f.spot.longitude, locationName: f.spot.name },
      });
    },
    [navigation],
  );

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      testID="cinematic-forecast-screen"
    >
      <View style={[styles.topRow, wide && styles.topRowWide]}>
        <Card style={[styles.card, wide && styles.topCol]}>
          <View style={styles.rowCenter}>
            <Feather name="sunrise" size={16} color={theme.primary} />
            <ThemedText style={styles.sectionTitle}>Wolkenmeer über dem Tal</ThemedText>
          </View>
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
            Gipfel, die in den nächsten 24 h über Nebel/Hochnebel ragen könnten.
            Untergrenze im Tal nach Spread-Formel (T − Td) × 122 m, Obergrenze aus dem Höhenprofil.
          </ThemedText>
          <ThemedText style={[styles.small, { color: theme.statusCaution, marginTop: Spacing.xs }]}>
            Nur eine Vorfilterung: Die Modellhöhe der Nebelobergrenze schwankt um ±100–200 m. Vor Ort Sicht
            (VLOS), Luftraum und Geozonen prüfen.
          </ThemedText>
          {result ? <StandLine result={result} theme={theme} /> : null}
        </Card>
        <Card style={[styles.card, wide && styles.topCol]}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.sectionTitle}>Benachrichtigen bei gutem Score</ThemedText>
              <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
                Prüft beim Start, bei Rückkehr in die App und stündlich (höchstens 2 Meldungen/Tag)
              </ThemedText>
            </View>
            <Switch
              testID="cinematic-notify-toggle"
              value={settings.notifyEnabled}
              onValueChange={(v) => void updateSettings({ notifyEnabled: v })}
            />
          </View>
          <ChipRow
            label="Ab Score"
            values={THRESHOLD_CHOICES as readonly number[]}
            selected={settings.threshold}
            format={(v) => String(v)}
            onSelect={(v) => void updateSettings({ threshold: v })}
            theme={theme}
            testPrefix="cinematic-threshold"
          />
          <ChipRow
            label="Umkreis"
            values={DISTANCE_CHOICES as readonly number[]}
            selected={settings.maxDistanceKm}
            format={(v) => `${v} km`}
            onSelect={(v) => void updateSettings({ maxDistanceKm: v })}
            theme={theme}
            testPrefix="cinematic-distance"
          />
        </Card>
      </View>

      {loading && !result?.spots.some((s) => s.hours.length > 0) ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
          <ThemedText style={[styles.small, { color: theme.textSecondary, marginTop: Spacing.sm }]}>
            Lade Höhenprofile …
          </ThemedText>
        </View>
      ) : null}

      {result?.outsideRadius ? (
        <ThemedText style={[styles.small, { color: theme.textSecondary, marginBottom: Spacing.sm }]}>
          Kein Spot im Umkreis von {settings.maxDistanceKm} km – die nächstgelegenen werden gezeigt.
        </ThemedText>
      ) : null}

      <View style={[styles.grid, wide && styles.gridWide]}>
        {(result?.spots ?? []).map((f) => (
          <SpotCard key={f.spot.id} f={f} theme={theme} wide={wide} onMap={() => openMap(f)} />
        ))}
      </View>
    </ScrollView>
  );
}

function StandLine({ result, theme }: { result: CinematicResult; theme: Theme }) {
  const lines: { text: string; color: string }[] = [];
  if (result.fetchedAt) {
    lines.push({
      text: `Stand ${formatStand(result.fetchedAt)}${result.stale ? " (gespeichert – nicht aktuell)" : ""}`,
      color: result.stale ? theme.statusCaution : theme.textTertiary,
    });
  } else if (!result.error) {
    lines.push({ text: "Noch keine Daten", color: theme.textTertiary });
  }
  if (result.dwdFetchedAt) {
    lines.push({ text: `DWD-Stationsvorhersage (Gegenprobe): Stand ${formatStand(result.dwdFetchedAt)}`, color: theme.textTertiary });
  }
  lines.push({ text: `Quelle: ${CINEMATIC_SOURCE_TEXT}`, color: theme.textTertiary });
  if (result.error) {
    const until = result.rateLimitedUntil ? ` (bis ${formatStand(result.rateLimitedUntil).slice(-9)})` : "";
    lines.push({ text: `${result.error}${until}`, color: theme.statusNoGo });
  }
  if (result.centerSource === "default") {
    lines.push({ text: "Kein Standort bekannt – Rhein-Main angenommen", color: theme.textTertiary });
  }
  return (
    <View style={{ marginTop: Spacing.xs }}>
      {lines.map((l) => (
        <ThemedText key={l.text} style={[styles.small, { color: l.color }]}>
          {l.text}
        </ThemedText>
      ))}
    </View>
  );
}

function ChipRow({
  label,
  values,
  selected,
  format,
  onSelect,
  theme,
  testPrefix,
}: {
  label: string;
  values: readonly number[];
  selected: number;
  format: (v: number) => string;
  onSelect: (v: number) => void;
  theme: Theme;
  testPrefix: string;
}) {
  return (
    <View style={[styles.rowCenter, { marginTop: Spacing.sm, flexWrap: "wrap" }]}>
      <ThemedText style={[styles.small, { color: theme.textSecondary, width: 64 }]}>{label}</ThemedText>
      {values.map((v) => {
        const on = v === selected;
        return (
          <Pressable
            key={v}
            testID={`${testPrefix}-${v}`}
            onPress={() => onSelect(v)}
            style={[
              styles.chip,
              { borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.primary + "22" : "transparent" },
            ]}
          >
            <ThemedText style={[styles.chipText, { color: on ? theme.primary : theme.text }]}>{format(v)}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function SpotCard({ f, theme, wide, onMap }: { f: SpotForecast; theme: Theme; wide: boolean; onMap: () => void }) {
  const { spot, hours, best, peak } = f;
  const defaultHour = best ? hours.find((h) => h.t === best.peakMs) ?? peak : peak;
  const [selT, setSelT] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const sel: HourScore | null = (selT != null ? hours.find((h) => h.t === selT) : null) ?? defaultHour ?? null;
  const top = peak?.score ?? 0;

  return (
    <Card style={[styles.card, wide && styles.gridItem, { borderLeftWidth: 4, borderLeftColor: scoreColor(top, theme) }]}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.spotName} numberOfLines={1}>
            {spot.name}
          </ThemedText>
          <ThemedText style={[styles.small, { color: theme.textSecondary }]} numberOfLines={1}>
            {spot.region} · {spot.elevationM} m · {Math.round(spot.distanceKm)} km
          </ThemedText>
        </View>
        <View style={[styles.badge, { backgroundColor: scoreColor(top, theme) + "33" }]}>
          <ThemedText style={[styles.badgeText, { color: top >= 15 ? scoreColor(top, theme) : theme.textSecondary }]}>
            {hours.length ? top : "–"}
          </ThemedText>
        </View>
      </View>

      <ThemedText style={[styles.windowText, { color: best ? theme.text : theme.textSecondary }]}>
        {hours.length === 0
          ? "Keine Daten"
          : best
            ? `${formatWindow(best)} · Score ${best.peakScore}`
            : `Kein gutes Fenster in 24 h${peak && peak.score > 0 ? ` (max. ${peak.score}, ${formatHour(peak.t)})` : ""}`}
      </ThemedText>

      {hours.length > 0 ? (
        <>
          <View style={styles.bar} accessibilityLabel="Score je Stunde">
            {hours.map((h) => (
              <Pressable
                key={h.t}
                onPress={() => setSelT(h.t)}
                hitSlop={{ top: 6, bottom: 6 }}
                style={[
                  styles.cell,
                  { backgroundColor: scoreColor(h.score, theme) },
                  sel?.t === h.t && { borderColor: theme.text, borderWidth: 1.5 },
                ]}
              />
            ))}
          </View>
          <View style={styles.barLabels}>
            {hours
              .filter((_, i) => i % 6 === 0)
              .map((h) => (
                <ThemedText key={h.t} style={[styles.tiny, { color: theme.textTertiary }]}>
                  {String(new Date(h.t).getHours()).padStart(2, "0")}
                </ThemedText>
              ))}
          </View>
        </>
      ) : null}

      {sel ? (
        <Pressable onPress={() => setExpanded((e) => !e)}>
          <ThemedText style={[styles.small, { color: theme.textSecondary, marginTop: Spacing.xs }]}>
            {formatHour(sel.t)} · Score {sel.score} · {sel.label}
          </ThemedText>
          <View style={styles.facts}>
            <Fact
              label="Untergrenze im Tal"
              value={sel.cloudBaseAglM != null ? (sel.cloudBaseAglM === 0 ? "Bodennebel" : `≈ ${sel.cloudBaseAglM} m`) : "–"}
              theme={theme}
            />
            <Fact label="Obergrenze" value={sel.fogTopM != null ? `≈ ${sel.fogTopM} m ü. NN` : "–"} theme={theme} />
            <Fact
              label="Gipfel darüber"
              value={sel.clearanceM != null ? `${sel.clearanceM > 0 ? "+" : ""}${sel.clearanceM} m` : "–"}
              theme={theme}
            />
            <Fact
              label="Inversion"
              value={sel.inversionStrengthK != null ? `${sel.inversionStrengthK >= 0 ? "+" : ""}${de1(sel.inversionStrengthK)} K` : "–"}
              theme={theme}
            />
            <Fact
              label="Wind/Böen"
              value={sel.windMs != null || sel.gustMs != null ? `${sel.windMs != null ? Math.round(sel.windMs) : "–"}/${sel.gustMs != null ? Math.round(sel.gustMs) : "–"} m/s` : "–"}
              theme={theme}
            />
            <Fact label="Gipfel" value={sel.summitTempC != null ? `${de1(sel.summitTempC)} °C${sel.summitRh != null ? ` · ${sel.summitRh} %` : ""}` : "–"} theme={theme} />
          </View>
          <ThemedText style={[styles.small, { color: theme.textSecondary }]} numberOfLines={expanded ? undefined : 2}>
            {sel.reasons.join(" · ")}
          </ThemedText>
        </Pressable>
      ) : null}

      <View style={[styles.rowBetween, { marginTop: Spacing.sm }]}>
        <ThemedText style={[styles.tiny, { color: theme.textTertiary, flex: 1 }]} numberOfLines={1}>
          Tal: {spot.valley.name}
        </ThemedText>
        <Pressable onPress={onMap} style={[styles.mapBtn, { borderColor: theme.border }]} testID={`cinematic-map-${spot.id}`}>
          <Feather name="map" size={13} color={theme.primary} />
          <ThemedText style={[styles.chipText, { color: theme.primary }]}>Karte</ThemedText>
        </Pressable>
      </View>
    </Card>
  );
}

function Fact({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return (
    <View style={styles.fact}>
      <ThemedText style={[styles.tiny, { color: theme.textTertiary }]}>{label}</ThemedText>
      <ThemedText style={styles.factValue}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing["3xl"] },
  center: { alignItems: "center", paddingVertical: Spacing.lg },
  topRow: { gap: Spacing.sm },
  topRowWide: { flexDirection: "row", alignItems: "stretch" },
  topCol: { flex: 1 },
  card: { padding: Spacing.md, marginBottom: Spacing.sm },
  grid: {},
  gridWide: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  gridItem: { width: "49.4%" },
  rowCenter: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: "700" },
  small: { fontSize: 12, lineHeight: 17 },
  tiny: { fontSize: 10, lineHeight: 13 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, marginRight: 6, marginTop: 2 },
  chipText: { fontSize: 12, fontWeight: "600" },
  spotName: { fontSize: 15, fontWeight: "700" },
  badge: { minWidth: 40, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignItems: "center" },
  badgeText: { fontSize: 16, fontWeight: "800" },
  windowText: { fontSize: 13, fontWeight: "600", marginTop: Spacing.xs },
  bar: { flexDirection: "row", gap: 2, marginTop: Spacing.sm, height: 14 },
  cell: { flex: 1, borderRadius: 2 },
  barLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 2, paddingRight: "20%" },
  facts: { flexDirection: "row", flexWrap: "wrap", marginTop: Spacing.xs, marginBottom: Spacing.xs },
  fact: { width: "33.3%", paddingVertical: 2 },
  factValue: { fontSize: 12, fontWeight: "600" },
  mapBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
});
