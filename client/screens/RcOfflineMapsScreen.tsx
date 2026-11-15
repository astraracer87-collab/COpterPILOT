/**
 * Einstellungen → Karten & Offline
 * Länder & Offline-Daten: je Land „Aus“ / „Online“ / „Offline“
 * (client/lib/countryUsage.ts). „Online“: Geozonen werden geladen und aktuell
 * gehalten; Karte und Zusatzdaten nur bei Netz. Schweiz und Liechtenstein
 * sind ein Eintrag („Schweiz / Liechtenstein“). Bei „Offline“ festlegen, was auf dem Gerät
 * gespeichert wird: Karte, Satellitenbilder (optional, sehr groß), Geozonen
 * (inkl. Teile wie DE-Wohngrundstücke, ES-Infrastruktur/Naturschutz),
 * Hindernisse. Gespeicherte Größe je Land und gesamt; „Alle deaktivierten
 * Länder bereinigen“. Datei-Importe bleiben auch bei „Aus“ erhalten.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";
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
  estimateSize,
  estimateUsageSizes,
  formatMB,
  formatUsageSizes,
  freeDiskMB,
  TILE_STORE_DOWNLOAD_MB,
  TILE_STORE_ES_PART_MB,
  loadOfflineConfigs,
  obstacleTilesStored,
  offlineCountries,
  packStatuses,
  pauseCountryDownload,
  startCountryDownload,
  storedCountrySizes,
  type CountryOfflineConfig,
  type CountryStoredSize,
  type DetailLevel,
  type PackProgress,
} from "@/lib/offlineMaps";
import { getObstaclesEnabled, setObstaclesEnabled } from "@/lib/obstacles";
import { openLink } from "@/lib/webBrowser";
import { clearDflightCredentials, getDflightCredentials, setDflightCredentials } from "@/lib/geozoneDirect/dflightAuth";
import { deleteEd269Dataset, loadStoredEd269Dataset, type Ed269ImportMeta } from "@/lib/geozoneDirect/ed269Store";
import { getTilePartMeta, hasTiledGeozones } from "@/lib/geozoneTiles/tileStore";
import { GEOZONE_IMPORT_FORMAT_LABELS, pickAndImportGeozoneFile } from "@/lib/geozoneDirect/geozoneFileImport";
import { RO_ROMATSA_DRONES_URL } from "../../shared/romanianGeozones";
import { MT_TMCAD_MAP_URL } from "../../shared/malteseGeozones";
import { resolveGeozoneSourceIso } from "../../shared/geozoneSourceMeta";
import { loadLargePacksOnMobile, setLargePacksOnMobile } from "@/lib/geozoneSources/largePackSetting";
import { COUNTRY_USAGE_LABELS, COUNTRY_USAGE_VALUES, getCountryUsage, loadCountryUsage, type CountryUsage } from "@/lib/countryUsage";
import { useCountryUsageMap } from "@/lib/useCountryUsage";
import {
  applyCountryUsage,
  cleanupDisabledCountries,
  getOfflineSyncState,
  onOfflineSyncChange,
  syncOfflineCountries,
  type OfflineSyncCountryState,
} from "@/lib/countryUsageData";

const LEVELS: DetailLevel[] = [11, 12, 13, 14, 15];
const KIND_LABEL: Record<string, string> = { map: "Karte", sat: "Satellit", geo: "Geozonen" };

// Hinweis je Land, warum/wie eine Geozonen-Datei importiert wird (Nur-Import-
// Land GR, Rückfall RO/MT).
const IMPORT_HINTS: Record<string, { text: string; url?: string; linkLabel?: string }> = {
  RO: {
    text:
      "Die Zonen werden automatisch von ROMATSA geladen (Drohnenzonen + NOTAM für UAS). Nur falls die Fernsteuerung den " +
      "ROMATSA-Server nicht erreicht: zone_restrictionate_uav.json am PC von flightplan.romatsa.ro herunterladen und hier " +
      "importieren (ein späterer erfolgreicher Online-Abruf ersetzt den Import).",
    url: RO_ROMATSA_DRONES_URL,
    linkLabel: "ROMATSA",
  },
  MT: {
    text:
      "Die Zonen werden automatisch von Transport Malta / iDronect geladen (öffentliche Karte, Zonennamen mit " +
      "Kontakt-E-Mails für Genehmigungsanfragen). Nur falls die Fernsteuerung den Server nicht erreicht: am PC " +
      "tmcad.idronect.com/map öffnen, warten bis die orangen Zonen erscheinen → F12 → Konsole → Skript " +
      "export_tmcad_geozonen.js einfügen (Doku: docs/tools/malta) → die geladene Datei malta_geozonen_roh_<Datum>.geojson " +
      "(oder malta_geozonen.geojson aus normalisieren.py) hier importieren (ein späterer erfolgreicher Online-Abruf " +
      "ersetzt den Import).",
    url: MT_TMCAD_MAP_URL,
    linkLabel: "Transport Malta / iDronect",
  },
  GR: {
    text:
      "Griechenland: Die Karte zeigt die DAGR-Zonen nur als Bild – keine automatische Prüfung. Optional am PC das Skript " +
      "dagr_geozonen.py ausführen (python dagr_geozonen.py --tage 30, Doku: docs/tools/greece) und die erzeugte " +
      "dagr_geozonen.geojson hier importieren. Nutzung nur im Rahmen der Datenfreigabe von HASP/HCAA.",
    url: "https://dagr.hasp.gov.gr",
    linkLabel: "HASP / DAGR",
  },
};

type ImportInfo = (Ed269ImportMeta & { count: number }) | null;

const USAGE_HINT: Record<CountryUsage, string> = {
  off: "Keine Abrufe und keine gespeicherten Daten. Liegt ein Flug in diesem Land, muss es aktiviert oder manuell geprüft werden.",
  online: "Geozonen werden geladen und aktuell gehalten; Karte und Zusatzdaten nur bei Netz. Große Geozonen-Pakete werden im WLAN geladen (außer mobile Daten sind erlaubt) – bis dahin wird online je Bereich abgefragt.",
  offline: "Wie Online, zusätzlich Karte, Luftbild, Hindernisse und große Zusatzpakete auf dem Gerät – alles automatisch aktuell gehalten (große Pakete nur im WLAN, außer mobile Daten sind erlaubt).",
};

function bytesToMB(b: number): number {
  return b / 1024 / 1024;
}

function formatDateTimeDe(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

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

/** Flaggen-Emoji aus dem ISO-Code; der gemeinsame Eintrag CH zeigt Schweiz und Liechtenstein. */
function flagOf(iso: string): string {
  const code = iso.toUpperCase() === "UK" ? "GB" : iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
function countryFlags(iso: string): string {
  return iso.toUpperCase() === "CH" ? `${flagOf("CH")} ${flagOf("LI")}` : flagOf(iso);
}

export default function OfflineMapsScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useSafeTabBarHeight();
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const countries = offlineCountries();
  const [configs, setConfigs] = useState<Record<string, CountryOfflineConfig>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, CountryState>>({});
  const [freeMB, setFreeMB] = useState<number | null>(null);
  const [obstaclesOn, setObstaclesOn] = useState(true);
  // Teil A: große Geozonen-Pakete (DE/FR/CZ, NL) sonst nur im WLAN aktualisieren
  const [largePacksMobile, setLargePacksMobile] = useState(false);
  useEffect(() => {
    loadLargePacksOnMobile().then(setLargePacksMobile).catch(() => {});
  }, []);

  // Italien (d-flight): eigener Zugang, nur verschlüsselt auf dem Gerät gespeichert
  const [dflightUser, setDflightUser] = useState<string | null>(null);
  const [dfUserInput, setDfUserInput] = useState("");
  const [dfPassInput, setDfPassInput] = useState("");
  const [dfBusy, setDfBusy] = useState(false);
  const [dfMsg, setDfMsg] = useState<string | null>(null);
  useEffect(() => {
    getDflightCredentials().then((c) => setDflightUser(c?.username ?? null)).catch(() => {});
  }, []);
  const saveDflight = async () => {
    setDfBusy(true);
    setDfMsg(null);
    const r = await setDflightCredentials(dfUserInput.trim(), dfPassInput);
    setDfBusy(false);
    if (r.ok) {
      setDflightUser(dfUserInput.trim().toLowerCase());
      setDfUserInput("");
      setDfPassInput("");
      setDfMsg("Anmeldung erfolgreich – die italienischen Geozonen werden beim nächsten Laden abgerufen.");
    } else {
      setDfMsg(r.error ?? "Anmeldung bei d-flight fehlgeschlagen.");
    }
  };

  const stopFlags = useRef<Record<string, boolean>>({});

  // Länder-Nutzung (Aus/Online/Offline), gespeicherte Größen, automatische Synchronisation
  const usageMap = useCountryUsageMap();
  const [sizes, setSizes] = useState<{ byIso: Record<string, CountryStoredSize>; totalBytes: number } | null>(null);
  const [syncState, setSyncState] = useState<Record<string, OfflineSyncCountryState>>(() => getOfflineSyncState());
  const [cleanupBusy, setCleanupBusy] = useState(false);
  useEffect(() => {
    loadCountryUsage().catch(() => {});
    return onOfflineSyncChange(() => setSyncState(getOfflineSyncState()));
  }, []);
  const usageOf = (iso: string): CountryUsage => usageMap[iso] ?? getCountryUsage(iso) ?? "off";

  // Geozonen-Datei-Import je Land (Vektor-/Nur-Import-Länder)
  const [importInfo, setImportInfo] = useState<Record<string, ImportInfo>>({});
  const [importBusy, setImportBusy] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<Record<string, string | null>>({});
  const loadImportInfo = useCallback(async (iso: string) => {
    try {
      const ds = await loadStoredEd269Dataset(iso);
      setImportInfo((prev) => ({ ...prev, [iso]: ds?.imported ? { ...ds.imported, count: ds.features.length } : null }));
    } catch {}
  }, []);
  useEffect(() => {
    if (expanded) loadImportInfo(expanded);
  }, [expanded, loadImportInfo]);
  const importFile = async (iso: string) => {
    setImportBusy(iso);
    setImportMsg((prev) => ({ ...prev, [iso]: null }));
    const r = await pickAndImportGeozoneFile(iso);
    setImportBusy(null);
    if (r.ok) {
      setImportMsg((prev) => ({ ...prev, [iso]: `${r.count} Zonen importiert (${GEOZONE_IMPORT_FORMAT_LABELS[r.format]}).` }));
      loadImportInfo(iso);
    } else if (!r.canceled) {
      setImportMsg((prev) => ({ ...prev, [iso]: r.error ?? "Import fehlgeschlagen." }));
    }
  };
  const removeImport = (iso: string) => {
    Alert.alert(
      "Import entfernen",
      "Die importierten Geozonen dieses Landes vom Gerät löschen? Diese Daten lassen sich nicht erneut herunterladen – zum Wiederherstellen muss die Datei erneut importiert werden.",
      [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Entfernen",
        style: "destructive",
        onPress: async () => {
          await deleteEd269Dataset(iso);
          setImportMsg((prev) => ({ ...prev, [iso]: null }));
          loadImportInfo(iso);
          refreshSizes();
        },
      },
    ]);
  };

  const patchState = useCallback((iso: string, fn: (s: CountryState) => CountryState) => {
    setState((prev) => ({ ...prev, [iso]: fn(prev[iso] ?? { packs: {}, obstacles: null, running: false }) }));
  }, []);

  const refreshSizes = useCallback(async () => {
    try {
      setSizes(await storedCountrySizes(offlineCountries().map((c) => c.iso)));
    } catch {}
  }, []);

  const refresh = useCallback(async () => {
    refreshSizes();
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
  }, [patchState, refreshSizes]);

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

  // Länder-Nutzung umschalten (mit Bestätigung, wenn Daten gelöscht werden)
  const changeUsage = (iso: string, next: CountryUsage) => {
    const prev = usageOf(iso);
    if (prev === next) return;
    const label = countries.find((x) => x.iso === iso)?.label ?? iso;
    const size = sizes?.byIso[iso];
    const deletable = size ? size.packBytes + size.datasetBytes + size.obstacleBytes : 0;
    const apply = async () => {
      if (next !== "offline") {
        stopFlags.current[iso] = true;
        await pauseCountryDownload(iso);
      }
      await applyCountryUsage(iso, next).catch(() => null);
      if (next !== "offline") patchState(iso, () => ({ packs: {}, obstacles: null, running: false }));
      if (next === "offline") setExpanded(iso);
      refresh();
    };
    if (next === "off") {
      Alert.alert(
        "Land deaktivieren",
        `${label}: Geozonen werden nicht mehr geladen und nicht mehr geprüft.` +
          (deletable > 0 ? ` Gespeicherte Daten (ca. ${formatMB(bytesToMB(deletable))}) werden gelöscht.` : "") +
          (size?.importBytes ? " Importierte Geozonen bleiben erhalten." : ""),
        [
          { text: "Abbrechen", style: "cancel" },
          { text: "Deaktivieren", style: "destructive", onPress: () => void apply() },
        ],
      );
      return;
    }
    // Offline → Online: nur die Offline-Zusätze werden gelöscht, Geozonen bleiben
    const geozoneBytes = (size?.datasetBytes ?? 0) + (getTilePartMeta(iso, "base")?.dataBytes ?? 0);
    const extras = Math.max(0, deletable - geozoneBytes);
    if (next === "online" && prev === "offline" && extras > 0) {
      Alert.alert(
        "Offline-Daten löschen",
        `${label}: Karte, Luftbild, Hindernisse und große Zusatzpakete (ca. ${formatMB(bytesToMB(extras))}) werden gelöscht. Die Geozonen bleiben gespeichert und aktuell.` +
          (size?.importBytes ? " Importierte Geozonen bleiben erhalten." : ""),
        [
          { text: "Abbrechen", style: "cancel" },
          { text: "Nur online", style: "destructive", onPress: () => void apply() },
        ],
      );
      return;
    }
    void apply();
  };

  const cleanupDisabled = () => {
    Alert.alert(
      "Deaktivierte Länder bereinigen",
      "Alle gespeicherten Daten deaktivierter Länder löschen? Mit einem aktiven Land geteilte Daten und importierte Geozonen bleiben erhalten.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Bereinigen",
          style: "destructive",
          onPress: async () => {
            setCleanupBusy(true);
            try {
              await cleanupDisabledCountries();
            } finally {
              setCleanupBusy(false);
              refresh();
            }
          },
        },
      ],
    );
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
        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>ÜBERSETZUNG DER BEHÖRDENTEXTE</ThemedText>
        <Card style={styles.card}>
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
            Zonennamen und Beschreibungen ausländischer Behörden werden auf Deutsch angezeigt, das Original steht jeweils
            darunter. Die Übersetzung erfolgt vollständig in der App (Wörterbuch und Satzmuster) – ohne externen Dienst und
            ohne Internet.
          </ThemedText>
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>ITALIEN – D-FLIGHT-ZUGANG</ThemedText>
        <Card style={styles.card}>
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
            Die italienischen Geozonen (ENAV / d-flight) gibt es nur mit einem eigenen, kostenlosen d-flight-Konto.
            Benutzername und Passwort werden nur auf diesem Gerät verschlüsselt gespeichert und ausschließlich an
            d-flight.it gesendet.
          </ThemedText>
          {dflightUser ? (
            <View style={[styles.row, { marginTop: Spacing.md }]}>
              <Feather name="check-circle" size={18} color="#1B8A2A" />
              <ThemedText style={[styles.rowLabel, { flex: 1 }]} numberOfLines={1}>Angemeldet als {dflightUser}</ThemedText>
              <Pressable
                onPress={async () => { await clearDflightCredentials(); setDflightUser(null); setDfMsg(null); }}
                style={[styles.btn, { backgroundColor: "rgba(255,59,48,0.12)" }]}
              >
                <ThemedText style={[styles.btnText, { color: "#FF3B30" }]}>Entfernen</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
              <TextInput
                value={dfUserInput}
                onChangeText={setDfUserInput}
                placeholder="d-flight-Benutzername (E-Mail)"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
              />
              <TextInput
                value={dfPassInput}
                onChangeText={setDfPassInput}
                placeholder="d-flight-Passwort"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType="password"
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
              />
              <Pressable
                onPress={saveDflight}
                disabled={dfBusy || !dfUserInput.trim() || !dfPassInput}
                style={[styles.btn, { backgroundColor: theme.primary, alignSelf: "flex-start", opacity: dfBusy || !dfUserInput.trim() || !dfPassInput ? 0.5 : 1 }]}
              >
                {dfBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Feather name="log-in" size={16} color="#FFFFFF" />}
                <ThemedText style={[styles.btnText, { color: "#FFFFFF" }]}>Anmelden & speichern</ThemedText>
              </Pressable>
            </View>
          )}
          {dfMsg ? <ThemedText style={[styles.small, { marginTop: Spacing.sm }]}>{dfMsg}</ThemedText> : null}
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>GEOZONEN AKTUALISIEREN</ThemedText>
        <Card style={styles.card}>
          <Row
            label="Große Pakete auch über mobile Daten laden"
            sub="Geozonen-Pakete Deutschland, Frankreich, Tschechien und der große Bestand der Niederlande werden sonst nur im WLAN neu geladen (vorher wird günstig auf eine neue Fassung geprüft). Kleine Länder werden online alle 6 Stunden, temporäre Beschränkungen bei jeder Prüfung (höchstens 10 Minuten alt) aktualisiert."
            value={largePacksMobile}
            onChange={(v) => { setLargePacksMobile(v); setLargePacksOnMobile(v).catch(() => {}); }}
          />
          <ThemedText style={[styles.small, { color: theme.textSecondary, marginTop: Spacing.sm }]}>
            Aktive Länder werden beim App-Start und alle 6 Stunden automatisch geprüft und aktualisiert (Online: Geozonen; Offline: alle gewählten Daten).
          </ThemedText>
          <Pressable
            onPress={() => { syncOfflineCountries("manual").then(() => refresh()).catch(() => {}); }}
            disabled={Object.values(syncState).some((x) => x.running)}
            style={[styles.btn, { backgroundColor: theme.backgroundSecondary, alignSelf: "flex-start", marginTop: Spacing.sm, opacity: Object.values(syncState).some((x) => x.running) ? 0.5 : 1 }]}
            testID="sync-offline-countries"
          >
            {Object.values(syncState).some((x) => x.running) ? <ActivityIndicator size="small" color={theme.primary} /> : <Feather name="refresh-cw" size={16} color={theme.primary} />}
            <ThemedText style={[styles.btnText, { color: theme.text }]}>Aktive Länder jetzt prüfen</ThemedText>
          </Pressable>
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

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]} testID="countries-section-title">LÄNDER & OFFLINE-DATEN</ThemedText>
        <ThemedText style={[styles.small, styles.intro, { color: theme.textSecondary }]}>
          Je Land festlegen: Aus (keine Daten, keine Prüfung), Online (Geozonen werden geladen und aktuell gehalten; Karte und
          Zusatzdaten nur bei Netz) oder Offline (zusätzlich Karte, Luftbild, Hindernisse und große Zusatzpakete auf dem Gerät).
          Karten und Luftbilder stammen von den amtlichen Vermessungsämtern – wo es keine frei
          speicherbare amtliche Karte gibt, werden Geozonen und Hindernisse gespeichert und die Karte online angezeigt.
          {freeMB != null ? ` Freier Speicher: ${formatMB(freeMB)}.` : ""}
        </ThemedText>
        <View style={[styles.row, styles.intro, { justifyContent: "space-between", flexWrap: "wrap" }]}>
          <ThemedText style={[styles.small, { color: theme.text, fontWeight: "700" }]} testID="countries-total-size">
            {sizes ? `Gespeichert gesamt: ${formatMB(bytesToMB(sizes.totalBytes))}` : "Gespeicherte Daten werden ermittelt …"}
          </ThemedText>
          <Pressable
            onPress={cleanupDisabled}
            disabled={cleanupBusy}
            style={[styles.btn, { backgroundColor: "rgba(255,59,48,0.12)", opacity: cleanupBusy ? 0.5 : 1 }]}
            testID="cleanup-disabled-countries"
          >
            {cleanupBusy ? <ActivityIndicator size="small" color="#FF3B30" /> : <Feather name="trash-2" size={16} color="#FF3B30" />}
            <ThemedText style={[styles.btnText, { color: "#FF3B30" }]}>Alle deaktivierten Länder bereinigen</ThemedText>
          </Pressable>
        </View>
        <Pressable
          onPress={() => navigation.navigate("DataSources")}
          hitSlop={6}
          style={[styles.row, styles.intro, { gap: 6 }]}
          testID="offline-maps-sources-link"
        >
          <Feather name="info" size={14} color={theme.primary} />
          <ThemedText style={[styles.small, { color: theme.primary }]}>Quellen & Lizenzen der Karten und Geozonen</ThemedText>
        </Pressable>

        {countries.map((country) => {
          const c = configs[country.iso];
          if (!c) return null;
          const st = state[country.iso];
          const usage = usageOf(country.iso);
          const isSaved = saved.has(country.iso) && usage === "offline";
          const open = expanded === country.iso;
          const est = estimateSize(c);
          const sync = syncState[country.iso];
          const size = sizes?.byIso[country.iso];
          // Fortschritt: Download aus den Einstellungen und automatische Synchronisation
          const packs = Object.values({ ...(st?.packs ?? {}), ...(st?.running ? {} : Object.fromEntries(Object.entries(sync?.packs ?? {}).filter(([k]) => !k.endsWith(":obstacles")).map(([k, p]) => [k, { key: k, kind: (k.split(":")[1] as any) ?? "geo", percentage: p.percentage, bytes: 0, state: p.state, error: p.error } as PackProgress]))) });
          const syncing = !!sync?.running && !st?.running;
          // Länder ohne Grundkarte haben evtl. nur Hindernisse (keine Pakete)
          const allDone =
            (packs.length > 0 || c.obstacles) &&
            packs.every((p) => p.state === "complete" || p.percentage >= 100) &&
            (!c.obstacles || (!!st?.obstacles && st.obstacles.done >= st.obstacles.total));
          return (
            <Card key={country.iso} style={[styles.card, { marginTop: Spacing.sm }]}>
              <Pressable onPress={() => setExpanded(open ? null : country.iso)} style={styles.countryHead}>
                <Feather
                  name={isSaved ? (allDone ? "check-circle" : "download-cloud") : "circle"}
                  size={20}
                  color={isSaved ? (allDone ? "#1B8A2A" : theme.primary) : theme.textTertiary}
                />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <ThemedText style={styles.rowLabel} accessible={false}>{countryFlags(country.iso)}</ThemedText>
                    <ThemedText style={styles.rowLabel}>{country.label}</ThemedText>
                  </View>
                  <ThemedText style={[styles.small, { color: theme.textSecondary }]} testID={`country-status-${country.iso}`}>
                    {usage === "off"
                      ? size?.importBytes
                        ? `Aus · Import bleibt erhalten (Land deaktiviert) · ${formatMB(bytesToMB(size.importBytes))}`
                        : "Aus"
                      : usage === "online"
                        ? sync?.running
                          ? "Online – Geozonen werden geladen …"
                          : size && size.totalBytes > 0
                            ? `Online – Geozonen gespeichert · ${formatMB(bytesToMB(size.totalBytes))}`
                            : sync?.result?.status === "pending-wifi"
                              ? "Online – Geozonen warten auf WLAN"
                              : "Online – Geozonen werden geladen"
                        : `${st?.running ? "Wird geladen …" : syncing ? "Wird automatisch aktualisiert …" : sync?.result?.status === "pending-wifi" && !allDone ? "Wartet auf WLAN" : isSaved ? (allDone ? "Offline verfügbar" : "Teilweise gespeichert") : `ca. ${formatMB(est.totalMB)}`}` +
                          (size && size.totalBytes > 0 ? ` · gespeichert ${formatMB(bytesToMB(size.totalBytes))}` : "")}
                  </ThemedText>
                </View>
                <Feather name={open ? "chevron-up" : "chevron-down"} size={20} color={theme.textTertiary} />
              </Pressable>

              <View style={[styles.seg, { marginTop: Spacing.sm }]} testID={`usage-${country.iso}`}>
                {COUNTRY_USAGE_VALUES.map((u) => (
                  <Pressable
                    key={u}
                    testID={`usage-${country.iso}-${u}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: usage === u }}
                    onPress={() => changeUsage(country.iso, u)}
                    style={[styles.segBtn, { backgroundColor: usage === u ? (u === "off" ? theme.textSecondary : theme.primary) : theme.backgroundSecondary }]}
                  >
                    <ThemedText style={[styles.segText, { color: usage === u ? "#FFFFFF" : theme.text }]}>{COUNTRY_USAGE_LABELS[u]}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText style={[styles.small, { color: theme.textSecondary, marginTop: 4 }]} testID={`usage-sizes-${country.iso}`}>
                {formatUsageSizes(estimateUsageSizes(c))}
              </ThemedText>

              {open ? (
                <View style={{ marginTop: Spacing.md, gap: Spacing.md }}>
                  <ThemedText style={[styles.small, { color: theme.textSecondary }]} testID={`usage-hint-${country.iso}`}>
                    {USAGE_HINT[usage]}
                    {usage !== "off" && country.iso === "CZ" && !hasTiledGeozones("CZ")
                      ? " Tschechien: Bis das Geozonen-Paket der ŘLP (ca. 36 MB) geladen ist, keine automatische Prüfung (Hinweis „manuell prüfen“)."
                      : ""}
                  </ThemedText>
                  {usage === "off" && size?.importBytes ? (
                    <ThemedText style={[styles.small, { color: theme.textSecondary }]} testID={`import-kept-${country.iso}`}>
                      Import bleibt erhalten (Land deaktiviert) · {formatMB(bytesToMB(size.importBytes))}. Er gilt wieder, sobald das Land aktiviert wird.
                    </ThemedText>
                  ) : null}
                  {usage === "offline" && country.note ? (
                    <View style={[styles.noteBox, { backgroundColor: theme.backgroundSecondary }]}>
                      <Feather name="info" size={16} color={theme.textSecondary} />
                      <ThemedText style={[styles.small, { flex: 1, color: theme.textSecondary }]}>{country.note}</ThemedText>
                    </View>
                  ) : null}
                  {usage === "offline" ? (
                  <>
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
                    sub={
                      country.geozoneKind === "tiles"
                        ? `ab Zoom 11 · ca. ${formatMB(est.geoMB)}`
                        : country.geozoneKind === "vector"
                          ? resolveGeozoneSourceIso(country.iso) !== country.iso // Alias (LI → CH)
                            ? `im Schweizer BAZL-Datensatz enthalten (wird mit geladen) · ca. ${formatMB(est.geoMB)}`
                            : `alle Zonen des Landes (Behördendaten) · ca. ${formatMB(est.geoMB)}`
                          : country.geozoneKind === "tilestore"
                            ? `${country.iso === "ES" ? "Luftfahrt- und urbane Zonen (ENAIRE)" : "alle Zonen des Landes"} als Vektordaten, gekachelt · ca. ${formatMB(est.geoMB - est.wohnMB - est.esInfraMB - est.esEnpMB)}` +
                              ` (Download ca. ${formatMB(TILE_STORE_DOWNLOAD_MB[country.iso] ?? 0)})`
                            : country.geozoneKind === "import"
                              ? "kein automatischer Abruf möglich – nur per Datei-Import (unten)"
                              : "für dieses Land keine Geozonen-Daten"
                    }
                    value={c.geozones}
                    onChange={(v) => update(country.iso, { geozones: v })}
                    disabled={!country.hasGeozones || country.geozoneKind === "import"}
                  />
                  </>
                  ) : null}
                  {usage !== "off" && (country.geozoneKind === "vector" || country.geozoneKind === "import") ? (
                    <View style={{ gap: Spacing.sm }}>
                      {IMPORT_HINTS[country.iso] ? (
                        <Pressable
                          disabled={!IMPORT_HINTS[country.iso].url}
                          onPress={() => IMPORT_HINTS[country.iso].url && openLink(IMPORT_HINTS[country.iso].url!, IMPORT_HINTS[country.iso].linkLabel ?? "Quelle").catch(() => {})}
                          style={[styles.noteBox, { backgroundColor: theme.backgroundSecondary }]}
                        >
                          <Feather name="alert-triangle" size={16} color={theme.textSecondary} />
                          <ThemedText style={[styles.small, { flex: 1, color: theme.textSecondary }]}>{IMPORT_HINTS[country.iso].text}</ThemedText>
                        </Pressable>
                      ) : null}
                      {importInfo[country.iso] ? (
                        <ThemedText style={[styles.small, { color: theme.textSecondary }]} testID={`geozone-import-info-${country.iso}`}>
                          Geozonen importiert am {formatDateTimeDe(importInfo[country.iso]!.importedAt)} aus {importInfo[country.iso]!.fileName}
                          {` · ${importInfo[country.iso]!.count} Zonen (${importInfo[country.iso]!.source})`}
                          {country.geozoneKind === "vector" ? " · eine erfolgreiche Online-Aktualisierung ersetzt den Import" : ""}
                        </ThemedText>
                      ) : null}
                      <View style={styles.buttons}>
                        <Pressable
                          onPress={() => importFile(country.iso)}
                          disabled={importBusy != null}
                          style={[styles.btn, { backgroundColor: theme.backgroundSecondary, opacity: importBusy != null ? 0.5 : 1 }]}
                          testID={`geozone-import-${country.iso}`}
                        >
                          {importBusy === country.iso ? <ActivityIndicator size="small" color={theme.primary} /> : <Feather name="upload" size={16} color={theme.primary} />}
                          <ThemedText style={[styles.btnText, { color: theme.text }]}>Geozonen-Datei importieren</ThemedText>
                        </Pressable>
                        {importInfo[country.iso] ? (
                          <Pressable onPress={() => removeImport(country.iso)} style={[styles.btn, { backgroundColor: "rgba(255,59,48,0.12)" }]}>
                            <Feather name="x-circle" size={16} color="#FF3B30" />
                            <ThemedText style={[styles.btnText, { color: "#FF3B30" }]}>Import entfernen</ThemedText>
                          </Pressable>
                        ) : null}
                      </View>
                      <ThemedText style={[styles.small, { color: theme.textTertiary }]}>
                        ED-269, ED-318 oder GeoJSON (.json, .geojson oder .zip).
                      </ThemedText>
                      {importMsg[country.iso] ? <ThemedText style={styles.small}>{importMsg[country.iso]}</ThemedText> : null}
                    </View>
                  ) : null}
                  {usage === "offline" ? (
                  <>
                  {country.iso === "DE" && country.geozoneKind === "tilestore" ? (
                    <Row
                      label="Wohngebiete (Wohngrundstücke) offline speichern"
                      sub={`Wohngrundstücke aller Gemeinden (§ 21h LuftVO) · zusätzlich ca. ${formatMB(est.wohnMB || 175)} (Download ca. ${formatMB(TILE_STORE_DOWNLOAD_MB.DE_WOHN)}). Ohne diese Daten werden Wohngebiete offline nicht erkannt.`}
                      value={c.wohngebiete !== false}
                      onChange={(v) => update(country.iso, { wohngebiete: v })}
                      disabled={!c.geozones}
                    />
                  ) : null}
                  {country.iso === "ES" && country.geozoneKind === "tilestore" ? (
                    <>
                      <Row
                        label="Infrastruktur-Zonen offline speichern"
                        sub={`ENAIRE-Infrastruktur (Bahn, Energie, Industrie …, 14 163 Zonen) · zusätzlich ca. ${formatMB(est.esInfraMB || TILE_STORE_ES_PART_MB.infra)} (Download ca. ${formatMB(TILE_STORE_DOWNLOAD_MB.ES_INFRA)}). Ohne diesen Teil werden diese Zonen offline nicht geprüft (online live).`}
                        value={c.esInfra !== false}
                        onChange={(v) => update(country.iso, { esInfra: v })}
                        disabled={!c.geozones}
                      />
                      <Row
                        label="Naturschutzgebiete offline speichern"
                        sub={`ENAIRE-Naturschutz (ENP, 3 135 Gebiete, sehr detailliert) · zusätzlich ca. ${formatMB(est.esEnpMB || TILE_STORE_ES_PART_MB.enp)} (Download ca. ${formatMB(TILE_STORE_DOWNLOAD_MB.ES_ENP)}, nur im WLAN empfohlen). Ohne diesen Teil werden Naturschutzgebiete offline nicht geprüft (online live).`}
                        value={c.esEnp !== false}
                        onChange={(v) => update(country.iso, { esEnp: v })}
                        disabled={!c.geozones}
                      />
                      <ThemedText style={[styles.small, { color: theme.textTertiary }]}>
                        NOTAM für UAS werden nicht gespeichert, sondern online live geladen (offline: letzter Stand mit Alter).
                      </ThemedText>
                    </>
                  ) : null}
                  {country.geozoneAttribution && c.geozones ? (
                    <Pressable
                      disabled={!country.geozoneAttribution.url}
                      onPress={() => country.geozoneAttribution?.url && openLink(country.geozoneAttribution.url, "Lizenz / Quelle").catch(() => {})}
                    >
                      <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
                        Quelle Geozonen: {country.geozoneAttribution.label}
                        {country.geozoneAttribution.url ? " ↗" : ""}
                        {largePacksMobile
                          ? " · zum AIRAC-Stichtag (spätestens alle 28 Tage) automatisch aktualisiert"
                          : " · zum AIRAC-Stichtag (spätestens alle 28 Tage) im WLAN automatisch aktualisiert"}
                      </ThemedText>
                    </Pressable>
                  ) : null}
                  {c.geozones && country.geozoneKind === "tiles" ? (
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

                  {(isSaved || syncing) && (packs.length > 0 || st?.obstacles) ? (
                    <View style={[styles.progressBox, { backgroundColor: theme.backgroundSecondary }]}>
                      {packs.map((p) => (
                        <ThemedText key={p.key} style={styles.small}>
                          {p.key.endsWith(":geo:wohn")
                            ? "Wohngebiete"
                            : p.key.endsWith(":geo:infra")
                              ? "Infrastruktur"
                              : p.key.endsWith(":geo:enp")
                                ? "Naturschutz"
                                : KIND_LABEL[p.kind] ?? p.kind}
                          {p.key.includes(":sat:") ? ` (${p.key.split(":")[2].replace(/^de-dop-/, "").toUpperCase()})` : ""}:{" "}
                          {p.state === "error"
                            ? `Fehler – ${p.error ?? "erneut versuchen"}`
                            : p.error && p.state === "inactive"
                              ? p.error
                            : p.key.endsWith(":geo:vector")
                              ? p.percentage >= 100 ? "gespeichert" : "wird geladen …"
                              : `${Math.floor(p.percentage)} % · ${formatMB(p.bytes / 1024 / 1024)}`}
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
                    {syncing ? (
                      <View style={[styles.btn, { backgroundColor: theme.backgroundSecondary }]}>
                        <ActivityIndicator size="small" color={theme.primary} />
                        <ThemedText style={[styles.btnText, { color: theme.text }]}>Automatische Aktualisierung …</ThemedText>
                      </View>
                    ) : st?.running ? (
                      <Pressable onPress={() => pause(country.iso)} style={[styles.btn, { backgroundColor: theme.backgroundSecondary }]}>
                        <ActivityIndicator size="small" color={theme.primary} />
                        <ThemedText style={[styles.btnText, { color: theme.text }]}>Pausieren</ThemedText>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => start(country.iso)} style={[styles.btn, { backgroundColor: theme.primary }]} testID={`download-${country.iso}`}>
                        <Feather name="download" size={16} color="#FFFFFF" />
                        <ThemedText style={[styles.btnText, { color: "#FFFFFF" }]}>{isSaved ? "Aktualisieren / fortsetzen" : "Speichern"}</ThemedText>
                      </Pressable>
                    )}
                  </View>
                  {sync?.result?.message && !st?.running ? (
                    <ThemedText style={[styles.small, { color: theme.textSecondary }]} testID={`sync-result-${country.iso}`}>
                      Automatische Aktualisierung: {sync.result.message}
                    </ThemedText>
                  ) : null}
                  </>
                  ) : null}
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
  noteBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: Spacing.md, borderRadius: 10 },
  buttons: { flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap" },
  btn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  btnText: { fontWeight: "700" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: Spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendLine: { width: 22, height: 4, borderRadius: 2 },
});
