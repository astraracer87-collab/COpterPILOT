/**
 * Einstellungen → Offline-Karten & Hindernisse
 * Länder auswählen und festlegen, was auf dem Gerät gespeichert wird:
 * Karte, Satellitenbilder (optional, sehr groß), Geozonen, Hindernisse.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import {
  DETAIL_LABELS,
  defaultConfig,
  deleteCountry,
  estimateSize,
  formatMB,
  freeDiskMB,
  loadOfflineConfigs,
  obstacleTilesStored,
  offlineCountries,
  packStatuses,
  pauseCountryDownload,
  startCountryDownload,
  type CountryOfflineConfig,
  type DetailLevel,
  type PackProgress,
} from "@/lib/offlineMaps";
import { getObstaclesEnabled, setObstaclesEnabled } from "@/lib/obstacles";
import { clearGoogleKey, getGoogleKey, setGoogleKey } from "@/lib/googleTiles";
import { clearDeeplKey, getDeeplKey, setDeeplKey } from "@/lib/zoneTranslationStore";

const LEVELS: DetailLevel[] = [11, 12, 13, 14, 15];
const KIND_LABEL: Record<string, string> = { map: "Karte", sat: "Satellit", geo: "Geozonen" };

type CountryState = {
  packs: Record<string, PackProgress>;
  obstacles: { done: number; total: number } | null;
  running: boolean;
};

function useSafeTabBarHeight(): number {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useBottomTabBarHeight();
  } catch {
    return 0;
  }
}

export default function OfflineMapsScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useSafeTabBarHeight();
  const countries = offlineCountries();
  const [configs, setConfigs] = useState<Record<string, CountryOfflineConfig>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, CountryState>>({});
  const [freeMB, setFreeMB] = useState<number | null>(null);
  const [obstaclesOn, setObstaclesOn] = useState(true);
  const [hasGoogle, setHasGoogle] = useState(false);
  const [googleInput, setGoogleInput] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleMsg, setGoogleMsg] = useState<string | null>(null);

  useEffect(() => {
    getGoogleKey().then((k) => setHasGoogle(!!k));
    getDeeplKey().then((k) => setHasDeepl(!!k));
  }, []);

  const [hasDeepl, setHasDeepl] = useState(false);
  const [deeplInput, setDeeplInput] = useState("");
  const [deeplBusy, setDeeplBusy] = useState(false);
  const [deeplMsg, setDeeplMsg] = useState<string | null>(null);
  const saveDeepl = async () => {
    setDeeplBusy(true);
    setDeeplMsg(null);
    const r = await setDeeplKey(deeplInput);
    setDeeplBusy(false);
    if (r.ok) {
      setHasDeepl(true);
      setDeeplInput("");
      setDeeplMsg("Gespeichert – neue Behördentexte werden beim nächsten Laden übersetzt.");
    } else {
      setDeeplMsg(r.error ?? "Schlüssel konnte nicht geprüft werden.");
    }
  };

  const saveGoogle = async () => {
    setGoogleBusy(true);
    setGoogleMsg(null);
    const r = await setGoogleKey(googleInput);
    setGoogleBusy(false);
    if (r.ok) {
      setHasGoogle(true);
      setGoogleInput("");
      setGoogleMsg("Gespeichert – im Satellitenmodus wird jetzt das Google-Bild gezeigt.");
    } else {
      setGoogleMsg(r.error ?? "Schlüssel konnte nicht geprüft werden.");
    }
  };
  const stopFlags = useRef<Record<string, boolean>>({});

  const patchState = useCallback((iso: string, fn: (s: CountryState) => CountryState) => {
    setState((prev) => ({ ...prev, [iso]: fn(prev[iso] ?? { packs: {}, obstacles: null, running: false }) }));
  }, []);

  const refresh = useCallback(async () => {
    const list = await loadOfflineConfigs();
    const map: Record<string, CountryOfflineConfig> = {};
    for (const c of countries) map[c.iso] = list.find((x) => x.iso === c.iso) ?? defaultConfig(c.iso);
    setConfigs(map);
    setSaved(new Set(list.map((x) => x.iso)));
    setFreeMB(await freeDiskMB());
    for (const c of list) {
      const packs = await packStatuses(c.iso);
      const obs = c.obstacles ? await obstacleTilesStored(c.iso) : null;
      patchState(c.iso, (s) => ({
        ...s,
        packs: Object.fromEntries(packs.map((p) => [p.key, p])),
        obstacles: obs,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchState]);

  useEffect(() => {
    refresh();
    getObstaclesEnabled().then(setObstaclesOn);
    return () => {
      for (const k of Object.keys(stopFlags.current)) stopFlags.current[k] = true;
    };
  }, [refresh]);

  const update = (iso: string, patch: Partial<CountryOfflineConfig>) =>
    setConfigs((prev) => ({ ...prev, [iso]: { ...prev[iso], ...patch } }));

  const start = async (iso: string) => {
    const c = configs[iso];
    if (!c) return;
    const est = estimateSize(c);
    if (freeMB != null && est.totalMB > freeMB * 0.9) {
      Alert.alert("Zu wenig Speicher", `Benötigt ca. ${formatMB(est.totalMB)}, frei sind ${formatMB(freeMB)}. Bitte Detailstufe verringern oder Satellit abwählen.`);
      return;
    }
    const go = async () => {
      stopFlags.current[iso] = false;
      patchState(iso, (s) => ({ ...s, running: true }));
      setSaved((prev) => new Set(prev).add(iso));
      try {
        await startCountryDownload(
          c,
          (p) => patchState(iso, (s) => ({ ...s, packs: { ...s.packs, [p.key]: p } })),
          (done, total) => patchState(iso, (s) => ({ ...s, obstacles: { done, total } })),
          () => !!stopFlags.current[iso],
        );
      } catch (e: any) {
        Alert.alert("Download", e?.message || "Download konnte nicht gestartet werden.");
      } finally {
        patchState(iso, (s) => ({ ...s, running: false }));
      }
    };
    if (est.totalMB > 2048) {
      Alert.alert(
        "Große Datenmenge",
        `Für ${countries.find((x) => x.iso === iso)?.label} werden ca. ${formatMB(est.totalMB)} gespeichert. Am besten im WLAN laden und die App dabei geöffnet lassen.`,
        [{ text: "Abbrechen", style: "cancel" }, { text: "Laden", onPress: go }],
      );
    } else {
      go();
    }
  };

  const pause = async (iso: string) => {
    stopFlags.current[iso] = true;
    await pauseCountryDownload(iso);
    patchState(iso, (s) => ({ ...s, running: false }));
  };

  const remove = (iso: string) => {
    Alert.alert("Offline-Daten löschen", "Alle gespeicherten Karten, Geozonen und Hindernisse dieses Landes vom Gerät löschen?", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          stopFlags.current[iso] = true;
          await deleteCountry(iso);
          patchState(iso, () => ({ packs: {}, obstacles: null, running: false }));
          refresh();
        },
      },
    ]);
  };

  const Seg = ({ value, onChange, disabled }: { value: DetailLevel; onChange: (v: DetailLevel) => void; disabled?: boolean }) => (
    <View style={[styles.seg, disabled && { opacity: 0.4 }]}>
      {LEVELS.map((l) => (
        <Pressable
          key={l}
          disabled={disabled}
          onPress={() => onChange(l)}
          style={[styles.segBtn, { backgroundColor: value === l ? theme.primary : theme.backgroundSecondary }]}
        >
          <ThemedText style={[styles.segText, { color: value === l ? "#FFFFFF" : theme.text }]}>{l}</ThemedText>
        </Pressable>
      ))}
    </View>
  );

  const Row = ({ label, sub, value, onChange, disabled }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
    <View style={[styles.row, disabled && { opacity: 0.4 }]}>
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.rowLabel}>{label}</ThemedText>
        {sub ? <ThemedText style={[styles.small, { color: theme.textSecondary }]}>{sub}</ThemedText> : null}
      </View>
      <Switch value={value && !disabled} onValueChange={onChange} disabled={disabled} trackColor={{ true: theme.primary }} />
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + Spacing.xl }]}>
        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>GOOGLE-SATELLITENBILD</ThemedText>
        <Card style={styles.card}>
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
            Mit eigenem Google-API-Schlüssel („Map Tiles API“ aktiviert, Abrechnung eingerichtet) zeigt der Satellitenmodus
            online das Google-Luftbild. Ohne Internet erscheinen die gespeicherten amtlichen Luftbilder. Der Schlüssel bleibt
            verschlüsselt auf diesem Gerät.
          </ThemedText>
          {hasGoogle ? (
            <View style={[styles.row, { marginTop: Spacing.md }]}>
              <Feather name="check-circle" size={18} color="#1B8A2A" />
              <ThemedText style={[styles.rowLabel, { flex: 1 }]}>Schlüssel gespeichert</ThemedText>
              <Pressable
                onPress={async () => { await clearGoogleKey(); setHasGoogle(false); setGoogleMsg(null); }}
                style={[styles.btn, { backgroundColor: "rgba(255,59,48,0.12)" }]}
              >
                <ThemedText style={[styles.btnText, { color: "#FF3B30" }]}>Entfernen</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
              <TextInput
                value={googleInput}
                onChangeText={setGoogleInput}
                placeholder="API-Schlüssel (AIza…)"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
              />
              <Pressable
                onPress={saveGoogle}
                disabled={googleBusy || googleInput.trim().length < 20}
                style={[styles.btn, { backgroundColor: theme.primary, alignSelf: "flex-start", opacity: googleBusy || googleInput.trim().length < 20 ? 0.5 : 1 }]}
              >
                {googleBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Feather name="key" size={16} color="#FFFFFF" />}
                <ThemedText style={[styles.btnText, { color: "#FFFFFF" }]}>Prüfen & speichern</ThemedText>
              </Pressable>
            </View>
          )}
          {googleMsg ? <ThemedText style={[styles.small, { marginTop: Spacing.sm }]}>{googleMsg}</ThemedText> : null}
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>ÜBERSETZUNG DER BEHÖRDENTEXTE</ThemedText>
        <Card style={styles.card}>
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
            Zonennamen und Beschreibungen ausländischer Behörden werden auf Deutsch angezeigt (das Original steht jeweils
            darunter). Alle bekannten Texte sind in der App enthalten. Für Texte, die Behörden später neu veröffentlichen,
            kann optional ein eigener DeepL-Schlüssel eingetragen werden; ohne Schlüssel erscheint dann der Originaltext.
          </ThemedText>
          {hasDeepl ? (
            <View style={[styles.row, { marginTop: Spacing.md }]}>
              <Feather name="check-circle" size={18} color="#1B8A2A" />
              <ThemedText style={[styles.rowLabel, { flex: 1 }]}>DeepL-Schlüssel gespeichert</ThemedText>
              <Pressable
                onPress={async () => { await clearDeeplKey(); setHasDeepl(false); setDeeplMsg(null); }}
                style={[styles.btn, { backgroundColor: "rgba(255,59,48,0.12)" }]}
              >
                <ThemedText style={[styles.btnText, { color: "#FF3B30" }]}>Entfernen</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
              <TextInput
                value={deeplInput}
                onChangeText={setDeeplInput}
                placeholder="DeepL-API-Schlüssel (optional)"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
              />
              <Pressable
                onPress={saveDeepl}
                disabled={deeplBusy || deeplInput.trim().length < 20}
                style={[styles.btn, { backgroundColor: theme.primary, alignSelf: "flex-start", opacity: deeplBusy || deeplInput.trim().length < 20 ? 0.5 : 1 }]}
              >
                {deeplBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Feather name="key" size={16} color="#FFFFFF" />}
                <ThemedText style={[styles.btnText, { color: "#FFFFFF" }]}>Prüfen & speichern</ThemedText>
              </Pressable>
            </View>
          )}
          {deeplMsg ? <ThemedText style={[styles.small, { marginTop: Spacing.sm }]}>{deeplMsg}</ThemedText> : null}
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>HINDERNISSE</ThemedText>
        <Card style={styles.card}>
          <Row
            label="Hindernisse auf der Karte"
            sub="Stromleitungen nach Spannung, Windräder, Masten, Türme, Schornsteine und Bahnstrecken aus OpenStreetMap – mit Höhe, soweit bekannt. Ab Zoomstufe 11."
            value={obstaclesOn}
            onChange={(v) => { setObstaclesOn(v); setObstaclesEnabled(v); }}
          />
          <View style={styles.legend}>
            {[
              ["#6a1b9a", "220/380 kV"],
              ["#8e24aa", "110 kV"],
              ["#ef6c00", "Mittelspannung"],
              ["#6d7a86", "Nieder/unbekannt"],
            ].map(([c, l]) => (
              <View key={l} style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: c }]} />
                <ThemedText style={[styles.small, { color: theme.textSecondary }]}>{l}</ThemedText>
              </View>
            ))}
          </View>
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>OFFLINE-LÄNDER</ThemedText>
        <ThemedText style={[styles.small, styles.intro, { color: theme.textSecondary }]}>
          Gespeicherte Länder funktionieren ohne Internet. Karten und Luftbilder stammen von den amtlichen Vermessungsämtern.
          {freeMB != null ? ` Freier Speicher: ${formatMB(freeMB)}.` : ""}
        </ThemedText>

        {countries.map((country) => {
          const c = configs[country.iso];
          if (!c) return null;
          const st = state[country.iso];
          const isSaved = saved.has(country.iso);
          const open = expanded === country.iso;
          const est = estimateSize(c);
          const packs = Object.values(st?.packs ?? {});
          const allDone =
            packs.length > 0 &&
            packs.every((p) => p.state === "complete" || p.percentage >= 100) &&
            (!c.obstacles || (st?.obstacles && st.obstacles.done >= st.obstacles.total));
          return (
            <Card key={country.iso} style={[styles.card, { marginTop: Spacing.sm }]}>
              <Pressable onPress={() => setExpanded(open ? null : country.iso)} style={styles.countryHead}>
                <Feather
                  name={isSaved ? (allDone ? "check-circle" : "download-cloud") : "circle"}
                  size={20}
                  color={isSaved ? (allDone ? "#1B8A2A" : theme.primary) : theme.textTertiary}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.rowLabel}>{country.label}</ThemedText>
                  <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
                    {isSaved ? (st?.running ? "Wird geladen …" : allDone ? "Offline verfügbar" : "Teilweise gespeichert") : `ca. ${formatMB(est.totalMB)}`}
                  </ThemedText>
                </View>
                <Feather name={open ? "chevron-up" : "chevron-down"} size={20} color={theme.textTertiary} />
              </Pressable>

              {open ? (
                <View style={{ marginTop: Spacing.md, gap: Spacing.md }}>
                  <Row
                    label="Karte"
                    sub={country.hasMap ? `amtliche Karte · ca. ${formatMB(est.mapMB)}` : "für dieses Land nur online"}
                    value={c.map}
                    onChange={(v) => update(country.iso, { map: v })}
                    disabled={!country.hasMap}
                  />
                  {c.map && country.hasMap ? (
                    <View>
                      <ThemedText style={[styles.small, { color: theme.textSecondary }]}>Detail: {DETAIL_LABELS[c.mapMaxZoom]}</ThemedText>
                      <Seg value={c.mapMaxZoom} onChange={(v) => update(country.iso, { mapMaxZoom: v })} />
                    </View>
                  ) : null}

                  <Row
                    label="Satellitenbilder"
                    sub={
                      country.hasSatellite
                        ? `${country.iso === "DE" ? "amtliche Luftbilder (Hessen, Rheinland-Pfalz, NRW, Bayern)" : "amtliche Luftbilder"} · ca. ${formatMB(est.satMB)}`
                        : "für dieses Land nur online"
                    }
                    value={c.satellite}
                    onChange={(v) => update(country.iso, { satellite: v })}
                    disabled={!country.hasSatellite}
                  />
                  {c.satellite && country.hasSatellite ? (
                    <View>
                      <ThemedText style={[styles.small, { color: theme.textSecondary }]}>Detail: {DETAIL_LABELS[c.satMaxZoom]}</ThemedText>
                      <Seg value={c.satMaxZoom} onChange={(v) => update(country.iso, { satMaxZoom: v })} />
                    </View>
                  ) : null}

                  <Row
                    label="Geozonen"
                    sub={country.hasGeozones ? `ab Zoom 11 · ca. ${formatMB(est.geoMB)}` : "für dieses Land keine Geozonen-Karte"}
                    value={c.geozones}
                    onChange={(v) => update(country.iso, { geozones: v })}
                    disabled={!country.hasGeozones}
                  />
                  {c.geozones && country.hasGeozones ? (
                    <View>
                      <ThemedText style={[styles.small, { color: theme.textSecondary }]}>Detail: {DETAIL_LABELS[c.geoMaxZoom]}</ThemedText>
                      <Seg value={c.geoMaxZoom} onChange={(v) => update(country.iso, { geoMaxZoom: v })} />
                    </View>
                  ) : null}

                  <Row
                    label="Hindernisse"
                    sub={`Leitungen, Windräder, Masten · ca. ${formatMB(est.obstaclesMB)}`}
                    value={c.obstacles}
                    onChange={(v) => update(country.iso, { obstacles: v })}
                  />

                  {isSaved && (packs.length > 0 || st?.obstacles) ? (
                    <View style={[styles.progressBox, { backgroundColor: theme.backgroundSecondary }]}>
                      {packs.map((p) => (
                        <ThemedText key={p.key} style={styles.small}>
                          {KIND_LABEL[p.kind] ?? p.kind}
                          {p.key.includes(":sat:") ? ` (${p.key.split(":")[2].replace(/^de-dop-/, "").toUpperCase()})` : ""}:{" "}
                          {p.state === "error" ? `Fehler – ${p.error ?? "erneut versuchen"}` : `${Math.floor(p.percentage)} % · ${formatMB(p.bytes / 1024 / 1024)}`}
                        </ThemedText>
                      ))}
                      {st?.obstacles ? (
                        <ThemedText style={styles.small}>
                          Hindernisse: {st.obstacles.done} von {st.obstacles.total} Gebieten
                        </ThemedText>
                      ) : null}
                    </View>
                  ) : null}

                  <ThemedText style={[styles.small, { color: theme.textSecondary }]}>Gesamt ca. {formatMB(est.totalMB)}</ThemedText>

                  <View style={styles.buttons}>
                    {st?.running ? (
                      <Pressable onPress={() => pause(country.iso)} style={[styles.btn, { backgroundColor: theme.backgroundSecondary }]}>
                        <ActivityIndicator size="small" color={theme.primary} />
                        <ThemedText style={[styles.btnText, { color: theme.text }]}>Pausieren</ThemedText>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => start(country.iso)} style={[styles.btn, { backgroundColor: theme.primary }]}>
                        <Feather name="download" size={16} color="#FFFFFF" />
                        <ThemedText style={[styles.btnText, { color: "#FFFFFF" }]}>{isSaved ? "Aktualisieren / fortsetzen" : "Speichern"}</ThemedText>
                      </Pressable>
                    )}
                    {isSaved ? (
                      <Pressable onPress={() => remove(country.iso)} style={[styles.btn, { backgroundColor: "rgba(255,59,48,0.12)" }]}>
                        <Feather name="trash-2" size={16} color="#FF3B30" />
                        <ThemedText style={[styles.btnText, { color: "#FF3B30" }]}>Löschen</ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </Card>
          );
        })}

        <ThemedText style={[styles.small, styles.intro, { color: theme.textSecondary, marginTop: Spacing.lg }]}>
          Hinweis: Hindernisse werden schonend nacheinander geladen und brauchen für ein großes Land eine Weile. Die App
          sollte dabei geöffnet bleiben. Außerhalb gespeicherter Länder lädt die Karte Hindernisse bei Bedarf aus dem Internet.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  sectionTitle: { ...Typography.caption, fontWeight: "600", marginBottom: Spacing.sm, marginLeft: Spacing.xs },
  intro: { marginHorizontal: Spacing.xs, marginBottom: Spacing.sm },
  card: { padding: Spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rowLabel: { ...Typography.body, fontWeight: "600" },
  small: { ...Typography.small },
  countryHead: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  seg: { flexDirection: "row", gap: 6, marginTop: 6 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  segText: { fontWeight: "700" },
  progressBox: { padding: Spacing.md, borderRadius: 10, gap: 4 },
  buttons: { flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap" },
  btn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  btnText: { fontWeight: "700" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: Spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendLine: { width: 22, height: 4, borderRadius: 2 },
});
