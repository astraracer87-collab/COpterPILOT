import { openLink } from "@/lib/webBrowser";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, StyleSheet, ScrollView, TextInput, Pressable, Alert, Switch, Platform, Linking, ActivityIndicator } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { DocumentField } from "@/components/DocumentField";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  PilotProfile,
  LicenseDetails,
  CountrySpecificPilot,
  DEFAULT_COUNTRY_SPECIFIC,
  getPilotProfile,
  savePilotProfile,
  isLicenseComplete,
  enforceLicenseHierarchy,
  BUNDESLAENDER,
  Bundesland,
  GeoAllgemeinerlaubnis,
  PARAGRAPH_21H_RULES,
  BUNDESLAND_AV_INFO,
  isErlaubnisExpired,
  LICENSE_COUNTRIES,
  LicenseCountryCode,
} from "@/lib/storage";
import {
  COUNTRY_SPECIFIC_INFO,
  CountrySpecificKey,
} from "@/lib/countrySpecificInfo";
import { getStateAuthority } from "../../shared/stateAuthorities";
import {
  LICENSE_INFO,
  LicenseInfoKey,
} from "@/lib/licenseInfo";
import { useAuth } from "@/lib/auth";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";
import { InfoDialog } from "@/components/InfoDialog";

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

export default function PilotProfileScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const { status } = useAuth();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const prevStatus = useRef<typeof status>(status);
  // Sequenz-Guard: nur das Ergebnis der zuletzt gestarteten Ladeoperation darf
  // setProfile aufrufen — verhindert, dass eine langsamere ältere Anfrage
  // (z.B. das leere DEFAULT aus der Auth-Auflösung) eine neuere überschreibt.
  const loadSeq = useRef(0);
  const loadProfile = useCallback((force?: boolean) => {
    const seq = ++loadSeq.current;
    getPilotProfile(force ? { force: true } : undefined).then((p) => {
      if (seq === loadSeq.current) setProfile(p);
    });
  }, []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAddBundesland, setShowAddBundesland] = useState(false);
  const [show21hRules, setShow21hRules] = useState(false);
  const [showA1A3Country, setShowA1A3Country] = useState(false);
  const [showA2Country, setShowA2Country] = useState(false);
  const [showSTSCountry, setShowSTSCountry] = useState(false);
  const [countryInfoKey, setCountryInfoKey] = useState<CountrySpecificKey | null>(null);
  const [licenseInfoKey, setLicenseInfoKey] = useState<LicenseInfoKey | null>(null);

  // Auth-bewusstes Laden: Während die Session noch geprüft wird ("loading")
  // NICHT laden — sonst landet das leere DEFAULT-Profil im State (und Cache)
  // und der Bildschirm wirkt nach dem Öffnen leer. Sobald die Auth steht,
  // laden wir; beim Wechsel loading/anonymous → authenticated holen wir die
  // Daten frisch vom Server (force), damit nichts Veraltetes hängen bleibt.
  // Deckt Mount UND spätere Status-Wechsel ab (Session-Check wird beim Start
  // oft erst nach dem Mount fertig).
  useEffect(() => {
    if (status === "loading") {
      setProfile(null);
      return;
    }
    const becameAuthenticated =
      status === "authenticated" && prevStatus.current !== "authenticated";
    prevStatus.current = status;
    // Beim Login-Übergang den Sync-Hinweis zeigen, statt das alte (leere)
    // anonyme Profil stehen zu lassen, während frisch vom Server geladen wird.
    if (becameAuthenticated) setProfile(null);
    loadProfile(becameAuthenticated);
  }, [status, loadProfile]);

  // Beim erneuten Fokussieren (z.B. Rückkehr aus einem Unterscreen) die Daten
  // auffrischen — aber nur wenn die Auth bereits steht, sonst zeigt der Screen
  // weiter den Sync-Hinweis.
  useFocusEffect(
    useCallback(() => {
      if (status === "loading") return;
      loadProfile();
    }, [status, loadProfile])
  );

  const update = (partial: Partial<PilotProfile>) => {
    if (!profile) return;
    setProfile({ ...profile, ...partial });
    setDirty(true);
  };

  const setErlaubnisse = (list: GeoAllgemeinerlaubnis[]) => {
    if (!profile) return;
    setProfile({ ...profile, allgemeinverfuegung: list });
    setDirty(true);
  };

  const addErlaubnis = (bl: Bundesland) => {
    if (!profile) return;
    if (profile.allgemeinverfuegung.some((e) => e.bundesland === bl)) return;
    setErlaubnisse([...profile.allgemeinverfuegung, { bundesland: bl, document: null }]);
    setShowAddBundesland(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const removeErlaubnis = (bl: Bundesland) => {
    if (!profile) return;
    setErlaubnisse(profile.allgemeinverfuegung.filter((e) => e.bundesland !== bl));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  const updateErlaubnis = (bl: Bundesland, partial: Partial<GeoAllgemeinerlaubnis>) => {
    if (!profile) return;
    setErlaubnisse(
      profile.allgemeinverfuegung.map((e) => (e.bundesland === bl ? { ...e, ...partial } : e)),
    );
  };

  const updateCountrySpecific = (partial: Partial<CountrySpecificPilot>) => {
    if (!profile) return;
    setProfile({
      ...profile,
      countrySpecific: { ...(profile.countrySpecific || DEFAULT_COUNTRY_SPECIFIC), ...partial },
    });
    setDirty(true);
  };

  // "David Meier" → { firstName: "David", lastName: "Meier" }.
  // Mehrteilige Nachnamen (z.B. "von der Heide") landen vollständig im
  // Nachnamen. So müssen Vor-/Nachname nicht in jeder Lizenz erneut erfasst
  // werden — sie werden zentral aus "Name des Piloten" abgeleitet.
  const splitName = (full: string): { firstName: string; lastName: string } => {
    const trimmed = (full ?? "").trim();
    if (!trimmed) return { firstName: "", lastName: "" };
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: "" };
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  };

  const updateName = (name: string) => {
    if (!profile) return;
    const { firstName, lastName } = splitName(name);
    setProfile({
      ...profile,
      name,
      licenseA1A3Details: { ...profile.licenseA1A3Details, firstName, lastName },
      licenseA2Details: { ...profile.licenseA2Details, firstName, lastName },
      licenseSTSDetails: { ...profile.licenseSTSDetails, firstName, lastName },
    });
    setDirty(true);
  };

  const updateLicenseA1A3Details = (partial: Partial<LicenseDetails>) => {
    if (!profile) return;
    setProfile({
      ...profile,
      licenseA1A3Details: { ...profile.licenseA1A3Details, ...partial },
    });
    setDirty(true);
  };

  const updateLicenseA2Details = (partial: Partial<LicenseDetails>) => {
    if (!profile) return;
    setProfile({
      ...profile,
      licenseA2Details: { ...profile.licenseA2Details, ...partial },
    });
    setDirty(true);
  };

  const updateLicenseSTSDetails = (partial: Partial<LicenseDetails>) => {
    if (!profile) return;
    setProfile({
      ...profile,
      licenseSTSDetails: { ...profile.licenseSTSDetails, ...partial },
    });
    setDirty(true);
  };

  // Aufbauende Hierarchie: A2 setzt A1/A3 voraus, STS setzt A2 voraus.
  // Beim Ausschalten der Grundlage werden abhängige Lizenzen automatisch
  // deaktiviert (siehe enforceLicenseHierarchy in storage.ts).
  const toggleA1A3 = (v: boolean) => {
    if (!profile) return;
    setProfile(enforceLicenseHierarchy({ ...profile, licenseA1A3: v }));
    setDirty(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleA2 = (v: boolean) => {
    if (!profile || !profile.licenseA1A3) return;
    setProfile(enforceLicenseHierarchy({ ...profile, licenseA2: v }));
    setDirty(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleSTS = (v: boolean) => {
    if (!profile || !profile.licenseA2) return;
    setProfile(enforceLicenseHierarchy({ ...profile, licenseSTS: v }));
    setDirty(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const hasCompleteLicense =
    (profile?.licenseA1A3 && profile?.licenseA1A3Details && isLicenseComplete(profile.licenseA1A3Details)) ||
    (profile?.licenseA2 && profile?.licenseA2Details && isLicenseComplete(profile.licenseA2Details)) ||
    (profile?.licenseSTS && profile?.licenseSTSDetails && isLicenseComplete(profile.licenseSTSDetails));

  // Synchronisiert Lizenz-Namen mit "Name des Piloten" vor jedem Persistieren.
  // Backward-Compat: Wenn profile.name leer ist, aber in einer Lizenz bereits
  // ein Name aus früheren Versionen gespeichert wurde, wird dieser nicht
  // überschrieben (und einmalig in profile.name hochgezogen).
  const buildSyncedProfile = (p: PilotProfile): PilotProfile => {
    const legacyName =
      p.licenseA1A3Details?.firstName || p.licenseA1A3Details?.lastName
        ? `${p.licenseA1A3Details.firstName} ${p.licenseA1A3Details.lastName}`.trim()
        : p.licenseA2Details?.firstName || p.licenseA2Details?.lastName
          ? `${p.licenseA2Details.firstName} ${p.licenseA2Details.lastName}`.trim()
          : "";
    const effectiveName = (p.name || "").trim() || legacyName;
    const { firstName, lastName } = splitName(effectiveName);
    return {
      ...p,
      name: effectiveName,
      licenseA1A3Details: { ...p.licenseA1A3Details, firstName, lastName },
      licenseA2Details: { ...p.licenseA2Details, firstName, lastName },
      licenseSTSDetails: { ...p.licenseSTSDetails, firstName, lastName },
    };
  };

  const handleSave = async () => {
    if (!profile || saving) return;
    setSaving(true);
    try {
      const synced = enforceLicenseHierarchy(buildSyncedProfile(profile));
      setProfile(synced);
      await savePilotProfile(synced);
      setDirty(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Gespeichert", "Dein Pilotenprofil wurde gespeichert.");
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Fehler beim Speichern",
        err instanceof Error ? err.message : "Unbekannter Fehler"
      );
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    return (
      <ThemedView style={styles.container}>
        <View
          style={[
            styles.loadingWrap,
            { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + Spacing.xl },
          ]}
          testID="loading-pilot-profile"
        >
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
            {status === "anonymous"
              ? "Pilotenprofil wird geladen …"
              : "Profil wird synchronisiert …"}
          </ThemedText>
          {status !== "anonymous" ? (
            <ThemedText style={[styles.loadingHint, { color: theme.textTertiary }]}>
              Deine Daten werden vom Server geladen.
            </ThemedText>
          ) : null}
        </View>
      </ThemedView>
    );
  }

  const hasA2 = profile.licenseA2;
  const erlaubnisse = profile.allgemeinverfuegung;
  const availableBundeslaender = BUNDESLAENDER.filter(
    (bl) => !erlaubnisse.some((e) => e.bundesland === bl),
  );

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat bottomOffset={24}
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + 110 },
        ]}
      >
        <Card style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Persönliche Daten</ThemedText>

          <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            Name des Piloten
          </ThemedText>
          <TextInput disableFullscreenUI
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
            value={profile.name}
            onChangeText={updateName}
            placeholder="Vor- und Nachname"
            placeholderTextColor={theme.textTertiary}
          />

          <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            Fernpiloten-Zeugnisnummer (eID)
          </ThemedText>
          <TextInput disableFullscreenUI
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
            value={profile.pilotId}
            onChangeText={(t) => update({ pilotId: t })}
            placeholder="z.B. DEU-RP-..."
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="characters"
          />

          <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            Betreiber-Nummer (UAS-Betreiber)
          </ThemedText>
          <TextInput disableFullscreenUI
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
            value={profile.operatorId}
            onChangeText={(t) => update({ operatorId: t })}
            placeholder="z.B. DEUxxxxxxxxxxxx"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="characters"
          />
        </Card>

        <Card style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Pflichtangaben</ThemedText>

          <Pressable
            style={styles.toggleRow}
            onPress={() => { update({ insuranceActive: !profile.insuranceActive }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <View style={styles.toggleInfo}>
              <ThemedText style={styles.toggleLabel}>Haftpflichtversicherung aktiv</ThemedText>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                EU-Pflicht für alle Drohnenflüge
              </ThemedText>
            </View>
            <Switch
              value={profile.insuranceActive}
              onValueChange={(v) => { update({ insuranceActive: v }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              trackColor={{ false: theme.backgroundSecondary, true: theme.primary + "60" }}
              thumbColor={profile.insuranceActive ? theme.primary : theme.textTertiary}
            />
          </Pressable>

          <DocumentField
            testID="pilot-insurance-doc"
            label="Versicherungsbestätigung"
            hint="PDF oder Foto der gültigen Police — bei einer Polizei-Kontrolle direkt griffbereit."
            document={profile.insuranceDocument}
            onChange={(doc) => update({ insuranceDocument: doc })}
          />

          {profile.insuranceActive ? (
            <>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <Pressable
                style={styles.toggleRow}
                onPress={() => {
                  update({ insuranceVerbandsregelDE: !profile.insuranceVerbandsregelDE });
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                testID="toggle-insurance-verbandsregel-de"
              >
                <View style={styles.toggleInfo}>
                  <ThemedText style={styles.toggleLabel}>
                    DMFV-/DMO-Verbandsversicherung (nur Deutschland)
                  </ThemedText>
                  <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                    Aktivieren, wenn die Haftpflicht über DMFV oder DMO läuft. Dahinter
                    steht die LBA-Verbandsbetriebserlaubnis nach Art. 16 EU-VO 2019/947:
                    FPV-Flüge bis 30 m AGL sind dann OHNE Spotter zulässig. Über 30 m
                    (max. 120 m) gilt weiterhin Spotter-Pflicht.
                  </ThemedText>
                </View>
                <Switch
                  value={profile.insuranceVerbandsregelDE === true}
                  onValueChange={(v) => {
                    update({ insuranceVerbandsregelDE: v });
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  trackColor={{ false: theme.backgroundSecondary, true: theme.primary + "60" }}
                  thumbColor={profile.insuranceVerbandsregelDE ? theme.primary : theme.textTertiary}
                />
              </Pressable>
            </>
          ) : null}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <Pressable
            style={styles.toggleRow}
            onPress={() => { update({ operatorRegistered: !profile.operatorRegistered }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <View style={styles.toggleInfo}>
              <ThemedText style={styles.toggleLabel}>Betreiber beim LBA registriert</ThemedText>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                UAS-Betreiber-Registrierung (e-ID)
              </ThemedText>
            </View>
            <Switch
              value={profile.operatorRegistered}
              onValueChange={(v) => { update({ operatorRegistered: v }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              trackColor={{ false: theme.backgroundSecondary, true: theme.primary + "60" }}
              thumbColor={profile.operatorRegistered ? theme.primary : theme.textTertiary}
            />
          </Pressable>
        </Card>

        <Card style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Lizenzen / Kompetenznachweise</ThemedText>

          {/* Die Identifizierungsnummer (eID) wird oben unter "Personalien"
              gepflegt und gilt für A1/A3, A2 und STS gleichermaßen — pro
              Lizenz fragen wir hier nur Ausstellungsland + Gültigkeitsdatum ab. */}
          <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary, marginBottom: Spacing.md }]}>
            Die Fernpiloten-Zeugnisnummer (eID) aus den Personalien gilt für A1/A3, A2 und STS — pro Lizenz unterscheidet sich nur das Datum.
          </ThemedText>

          {/* A1/A3 — Grundlage */}
          <Pressable
            style={styles.toggleRow}
            onPress={() => toggleA1A3(!profile.licenseA1A3)}
          >
            <View style={styles.toggleInfo}>
              <View style={styles.toggleLabelRow}>
                <ThemedText style={styles.toggleLabel}>EU-Kompetenznachweis A1/A3</ThemedText>
                <Pressable
                  onPress={() => setLicenseInfoKey("A1A3")}
                  hitSlop={10}
                  testID="button-license-info-A1A3"
                  accessibilityLabel="Mehr Infos zu EU-Kompetenznachweis A1/A3"
                  style={styles.infoIconBtn}
                >
                  <Feather name="info" size={18} color={theme.primary} />
                </Pressable>
              </View>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                Online-Prüfung beim LBA — Grundlage für A2 und STS
              </ThemedText>
            </View>
            <Switch
              value={profile.licenseA1A3}
              onValueChange={toggleA1A3}
              trackColor={{ false: theme.backgroundSecondary, true: theme.primary + "60" }}
              thumbColor={profile.licenseA1A3 ? theme.primary : theme.textTertiary}
            />
          </Pressable>

          {profile.licenseA1A3 ? (
            <View style={styles.licenseDetails}>
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Ausstellungsland</ThemedText>
              <Pressable
                style={[styles.countryPicker, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                onPress={() => { setShowA1A3Country(!showA1A3Country); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <ThemedText style={styles.countryPickerText}>
                  {LICENSE_COUNTRIES.find((c) => c.code === (profile.licenseA1A3Details?.country || "DE"))?.label || "Deutschland"}
                </ThemedText>
                <Feather name={showA1A3Country ? "chevron-up" : "chevron-down"} size={16} color={theme.textTertiary} />
              </Pressable>
              {showA1A3Country ? (
                <View style={[styles.countryList, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
                  <ScrollView nestedScrollEnabled style={styles.countryScroll}>
                    {LICENSE_COUNTRIES.map((c) => {
                      const selected = (profile.licenseA1A3Details?.country || "DE") === c.code;
                      return (
                        <Pressable
                          key={c.code}
                          style={[styles.countryItem, selected ? { backgroundColor: theme.primary + "18" } : null]}
                          onPress={() => {
                            updateLicenseA1A3Details({ country: c.code as LicenseCountryCode });
                            setShowA1A3Country(false);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }}
                        >
                          <ThemedText style={[styles.countryItemText, selected ? { color: theme.primary, fontWeight: "700" } : null]}>
                            {c.label}
                          </ThemedText>
                          {selected ? <Feather name="check" size={16} color={theme.primary} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Gültigkeitsdatum</ThemedText>
              <TextInput disableFullscreenUI
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseA1A3Details?.expirationDate || ""}
                onChangeText={(t) => updateLicenseA1A3Details({ expirationDate: t })}
                placeholder="TT.MM.JJJJ"
                placeholderTextColor={theme.textTertiary}
              />
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>QR-Code Link (physische Karte)</ThemedText>
              <TextInput disableFullscreenUI
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseA1A3Details?.qrCodeUrl || ""}
                onChangeText={(t) => updateLicenseA1A3Details({ qrCodeUrl: t })}
                placeholder="https://…  (QR-Code der Original-Karte scannen)"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                testID="input-qr-url-A1A3"
              />
              <ThemedText style={[styles.fieldHint, { color: theme.textTertiary }]}>
                Scanne den QR-Code auf deinem physischen Kompetenznachweis und füge den Link hier ein — die digitale Lizenzkarte zeigt dann denselben Verifikations-QR wie das Original.
              </ThemedText>
            </View>
          ) : null}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {/* A2 — setzt A1/A3 voraus */}
          <Pressable
            style={[styles.toggleRow, !profile.licenseA1A3 ? styles.toggleDisabled : null]}
            onPress={() => toggleA2(!profile.licenseA2)}
            disabled={!profile.licenseA1A3}
          >
            <View style={styles.toggleInfo}>
              <View style={styles.toggleLabelRow}>
                <ThemedText style={[styles.toggleLabel, !profile.licenseA1A3 ? { color: theme.textTertiary } : null]}>
                  Fernpiloten-Zeugnis A2
                </ThemedText>
                <Pressable
                  onPress={() => setLicenseInfoKey("A2")}
                  hitSlop={10}
                  testID="button-license-info-A2"
                  accessibilityLabel="Mehr Infos zu Fernpiloten-Zeugnis A2"
                  style={styles.infoIconBtn}
                >
                  <Feather name="info" size={18} color={theme.primary} />
                </Pressable>
              </View>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                {!profile.licenseA1A3
                  ? "A1/A3 zuerst aktivieren"
                  : "Praktische Prüfung bei anerkannter Stelle"}
              </ThemedText>
            </View>
            <Switch
              value={profile.licenseA2}
              onValueChange={toggleA2}
              disabled={!profile.licenseA1A3}
              trackColor={{ false: theme.backgroundSecondary, true: theme.primary + "60" }}
              thumbColor={profile.licenseA2 ? theme.primary : theme.textTertiary}
            />
          </Pressable>

          {profile.licenseA2 ? (
            <View style={styles.licenseDetails}>
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Ausstellungsland</ThemedText>
              <Pressable
                style={[styles.countryPicker, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                onPress={() => { setShowA2Country(!showA2Country); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <ThemedText style={styles.countryPickerText}>
                  {LICENSE_COUNTRIES.find((c) => c.code === (profile.licenseA2Details?.country || "DE"))?.label || "Deutschland"}
                </ThemedText>
                <Feather name={showA2Country ? "chevron-up" : "chevron-down"} size={16} color={theme.textTertiary} />
              </Pressable>
              {showA2Country ? (
                <View style={[styles.countryList, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
                  <ScrollView nestedScrollEnabled style={styles.countryScroll}>
                    {LICENSE_COUNTRIES.map((c) => {
                      const selected = (profile.licenseA2Details?.country || "DE") === c.code;
                      return (
                        <Pressable
                          key={c.code}
                          style={[styles.countryItem, selected ? { backgroundColor: theme.primary + "18" } : null]}
                          onPress={() => {
                            updateLicenseA2Details({ country: c.code as LicenseCountryCode });
                            setShowA2Country(false);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }}
                        >
                          <ThemedText style={[styles.countryItemText, selected ? { color: theme.primary, fontWeight: "700" } : null]}>
                            {c.label}
                          </ThemedText>
                          {selected ? <Feather name="check" size={16} color={theme.primary} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Gültigkeitsdatum</ThemedText>
              <TextInput disableFullscreenUI
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseA2Details?.expirationDate || ""}
                onChangeText={(t) => updateLicenseA2Details({ expirationDate: t })}
                placeholder="TT.MM.JJJJ"
                placeholderTextColor={theme.textTertiary}
              />
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>QR-Code Link (physische Karte)</ThemedText>
              <TextInput disableFullscreenUI
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseA2Details?.qrCodeUrl || ""}
                onChangeText={(t) => updateLicenseA2Details({ qrCodeUrl: t })}
                placeholder="https://…  (QR-Code der Original-Karte scannen)"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                testID="input-qr-url-A2"
              />
              <ThemedText style={[styles.fieldHint, { color: theme.textTertiary }]}>
                Scanne den QR-Code auf deinem physischen Fernpiloten-Zeugnis und füge den Link hier ein — die digitale Lizenzkarte zeigt dann denselben Verifikations-QR wie das Original.
              </ThemedText>
            </View>
          ) : null}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {/* STS — setzt A2 (und damit A1/A3) voraus */}
          <Pressable
            style={[styles.toggleRow, !profile.licenseA2 ? styles.toggleDisabled : null]}
            onPress={() => toggleSTS(!profile.licenseSTS)}
            disabled={!profile.licenseA2}
          >
            <View style={styles.toggleInfo}>
              <View style={styles.toggleLabelRow}>
                <ThemedText style={[styles.toggleLabel, !profile.licenseA2 ? { color: theme.textTertiary } : null]}>
                  STS-Betriebsgenehmigung
                </ThemedText>
                <Pressable
                  onPress={() => setLicenseInfoKey("STS")}
                  hitSlop={10}
                  testID="button-license-info-STS"
                  accessibilityLabel="Mehr Infos zu STS-Betriebsgenehmigung"
                  style={styles.infoIconBtn}
                >
                  <Feather name="info" size={18} color={theme.primary} />
                </Pressable>
              </View>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                {!profile.licenseA2
                  ? "A2 zuerst aktivieren"
                  : "Standardszenarien (STS-01, STS-02)"}
              </ThemedText>
            </View>
            <Switch
              value={profile.licenseSTS}
              onValueChange={toggleSTS}
              disabled={!profile.licenseA2}
              trackColor={{ false: theme.backgroundSecondary, true: theme.primary + "60" }}
              thumbColor={profile.licenseSTS ? theme.primary : theme.textTertiary}
            />
          </Pressable>

          {profile.licenseSTS ? (
            <View style={styles.licenseDetails}>
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Ausstellungsland</ThemedText>
              <Pressable
                style={[styles.countryPicker, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                onPress={() => { setShowSTSCountry(!showSTSCountry); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <ThemedText style={styles.countryPickerText}>
                  {LICENSE_COUNTRIES.find((c) => c.code === (profile.licenseSTSDetails?.country || "DE"))?.label || "Deutschland"}
                </ThemedText>
                <Feather name={showSTSCountry ? "chevron-up" : "chevron-down"} size={16} color={theme.textTertiary} />
              </Pressable>
              {showSTSCountry ? (
                <View style={[styles.countryList, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
                  <ScrollView nestedScrollEnabled style={styles.countryScroll}>
                    {LICENSE_COUNTRIES.map((c) => {
                      const selected = (profile.licenseSTSDetails?.country || "DE") === c.code;
                      return (
                        <Pressable
                          key={c.code}
                          style={[styles.countryItem, selected ? { backgroundColor: theme.primary + "18" } : null]}
                          onPress={() => {
                            updateLicenseSTSDetails({ country: c.code as LicenseCountryCode });
                            setShowSTSCountry(false);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }}
                        >
                          <ThemedText style={[styles.countryItemText, selected ? { color: theme.primary, fontWeight: "700" } : null]}>
                            {c.label}
                          </ThemedText>
                          {selected ? <Feather name="check" size={16} color={theme.primary} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Gültigkeitsdatum</ThemedText>
              <TextInput disableFullscreenUI
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseSTSDetails?.expirationDate || ""}
                onChangeText={(t) => updateLicenseSTSDetails({ expirationDate: t })}
                placeholder="TT.MM.JJJJ"
                placeholderTextColor={theme.textTertiary}
              />
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>QR-Code Link (physische Karte)</ThemedText>
              <TextInput disableFullscreenUI
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseSTSDetails?.qrCodeUrl || ""}
                onChangeText={(t) => updateLicenseSTSDetails({ qrCodeUrl: t })}
                placeholder="https://…  (QR-Code der Original-Karte scannen)"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                testID="input-qr-url-STS"
              />
              <ThemedText style={[styles.fieldHint, { color: theme.textTertiary }]}>
                Scanne den QR-Code auf deiner physischen STS-Betriebsgenehmigung und füge den Link hier ein — die digitale Lizenzkarte zeigt dann denselben Verifikations-QR wie das Original.
              </ThemedText>
            </View>
          ) : null}

          {hasCompleteLicense ? (
            <>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <Pressable
                style={[styles.licenseButton, { backgroundColor: theme.primary + "10" }]}
                onPress={async () => {
                  if (dirty && profile) {
                    const synced = buildSyncedProfile(profile);
                    setProfile(synced);
                    await savePilotProfile(synced);
                    setDirty(false);
                  }
                  navigation.navigate("PilotLicenseCard");
                }}
              >
                <Feather name="credit-card" size={20} color={theme.primary} />
                <ThemedText style={[styles.licenseButtonText, { color: theme.primary }]}>
                  Führerschein anzeigen
                </ThemedText>
                <Feather name="chevron-right" size={18} color={theme.primary} />
              </Pressable>
            </>
          ) : null}
        </Card>

        <Card style={styles.section}>
          <View style={styles.avHeader}>
            <View style={styles.toggleInfo}>
              <ThemedText style={styles.sectionTitle}>Geografische Allgemeinerlaubnis</ThemedText>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                § 21h LuftVO — pro Bundesland einzeln bei der Landesluftfahrtbehörde beantragt. Setzt das A2-Fernpilotenzeugnis voraus.
              </ThemedText>
            </View>
          </View>

          {!hasA2 ? (
            <View style={[styles.avLockedBox, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
              <Feather name="lock" size={18} color={theme.textTertiary} />
              <View style={{ flex: 1, gap: Spacing.xs }}>
                <ThemedText style={[styles.avLockedText, { color: theme.textSecondary }]}>
                  Eine geografische Allgemeinerlaubnis ist nur mit gültigem A2-Fernpilotenzeugnis möglich. Aktiviere zuerst die Lizenz A2 oben.
                </ThemedText>
                <Pressable
                  onPress={() => openLink("https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/").catch(() => {})}
                  testID="link-dipul-locked"
                  style={({ pressed }) => [styles.avLinkRow, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Feather name="external-link" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                    Infos &amp; Antrag bei dipul.de
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              {erlaubnisse.length === 0 ? (
                <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary, marginBottom: Spacing.sm }]}>
                  Noch keine Erlaubnis hinterlegt. Füge das Bundesland hinzu, für das dir eine geografische Allgemeinerlaubnis erteilt wurde.
                </ThemedText>
              ) : null}

              {erlaubnisse.map((e) => {
                const expired = isErlaubnisExpired(e);
                const avInfo = BUNDESLAND_AV_INFO[e.bundesland];
                return (
                  <View
                    key={e.bundesland}
                    style={[
                      styles.erlaubnisCard,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        borderColor: expired ? "#FF3B30" : theme.border,
                      },
                    ]}
                  >
                    <View style={styles.erlaubnisHeader}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                        <Feather name="map-pin" size={16} color={theme.primary} />
                        <ThemedText style={styles.erlaubnisTitle}>{e.bundesland}</ThemedText>
                        {expired ? (
                          <View style={[styles.expiredBadge, { backgroundColor: "#FF3B30" }]}>
                            <ThemedText style={styles.expiredBadgeText}>Abgelaufen</ThemedText>
                          </View>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => removeErlaubnis(e.bundesland)}
                        testID={`button-remove-erlaubnis-${e.bundesland}`}
                        style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
                      >
                        <Feather name="trash-2" size={18} color="#FF3B30" />
                      </Pressable>
                    </View>

                    <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                      Ablaufdatum
                    </ThemedText>
                    <TextInput disableFullscreenUI
                      style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: expired ? "#FF3B30" : theme.border }]}
                      value={e.expirationDate || ""}
                      onChangeText={(t) => updateErlaubnis(e.bundesland, { expirationDate: t })}
                      placeholder="TT.MM.JJJJ"
                      placeholderTextColor={theme.textTertiary}
                      testID={`input-erlaubnis-date-${e.bundesland}`}
                    />

                    <DocumentField
                      label="Bescheid (PDF)"
                      hint="Lade den Erlaubnis-Bescheid der Behörde hoch."
                      document={e.document}
                      onChange={(doc) => updateErlaubnis(e.bundesland, { document: doc })}
                      testID={`document-erlaubnis-${e.bundesland}`}
                    />

                    <View style={[styles.erlaubnis21hNote, { backgroundColor: theme.background, borderColor: theme.border }]}>
                      <Feather name="shield" size={13} color={theme.primary} />
                      <ThemedText style={[styles.erlaubnis21hNoteText, { color: theme.textSecondary }]}>
                        Es gelten die bundesweit einheitlichen § 21h-Auflagen (unten aufgeklappt) für die erfassten Geozonen-Typen.
                      </ThemedText>
                    </View>

                    {avInfo ? (
                      <View style={styles.erlaubnisLinks}>
                        <Pressable
                          onPress={() => openLink(avInfo.antragUrl).catch(() => {})}
                          testID={`link-antrag-${e.bundesland}`}
                          style={({ pressed }) => [styles.avLinkRow, { opacity: pressed ? 0.6 : 1 }]}
                        >
                          <Feather name="external-link" size={14} color={theme.primary} />
                          <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                            Antrag stellen (dipul.de)
                          </ThemedText>
                        </Pressable>
                        {avInfo.infoUrl ? (
                          <Pressable
                            onPress={() => openLink(avInfo.infoUrl as string).catch(() => {})}
                            testID={`link-info-${e.bundesland}`}
                            style={({ pressed }) => [styles.avLinkRow, { opacity: pressed ? 0.6 : 1 }]}
                          >
                            <Feather name="info" size={14} color={theme.primary} />
                            <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                              Infos der Landesluftfahrtbehörde
                            </ThemedText>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}

                    {(() => {
                      const sa = getStateAuthority(e.bundesland);
                      if (!sa) return null;
                      const office = sa.authorities[0];
                      const permit = sa.general?.available ? sa.general : sa.individual;
                      return (
                        <View style={[styles.erlaubnis21hNote, { backgroundColor: theme.background, borderColor: theme.border, flexDirection: "column", alignItems: "stretch", gap: 3 }]}>
                          {office ? (
                            <ThemedText style={[styles.erlaubnis21hNoteText, { color: theme.text, fontWeight: "600" }]}>
                              {office.name}
                            </ThemedText>
                          ) : null}
                          {permit?.feeText ? (
                            <ThemedText style={[styles.erlaubnis21hNoteText, { color: theme.textSecondary }]}>Gebühr: {permit.feeText}</ThemedText>
                          ) : null}
                          {permit?.processingText ? (
                            <ThemedText style={[styles.erlaubnis21hNoteText, { color: theme.textSecondary }]}>Bearbeitung: {permit.processingText}</ThemedText>
                          ) : null}
                          {sa.general?.validityText ? (
                            <ThemedText style={[styles.erlaubnis21hNoteText, { color: theme.textSecondary }]}>Gültigkeit: {sa.general.validityText}</ThemedText>
                          ) : null}
                          {office?.email ? (
                            <Pressable onPress={() => openLink(`mailto:${office.email}`).catch(() => {})} testID={`link-authority-mail-${e.bundesland}`} style={({ pressed }) => [styles.avLinkRow, { opacity: pressed ? 0.6 : 1 }]}>
                              <Feather name="mail" size={14} color={theme.primary} />
                              <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{office.email}</ThemedText>
                            </Pressable>
                          ) : null}
                          {office?.phone ? (
                            <Pressable onPress={() => openLink(`tel:${office.phone!.replace(/[^+\d]/g, "")}`).catch(() => {})} testID={`link-authority-phone-${e.bundesland}`} style={({ pressed }) => [styles.avLinkRow, { opacity: pressed ? 0.6 : 1 }]}>
                              <Feather name="phone" size={14} color={theme.primary} />
                              <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{office.phone}</ThemedText>
                            </Pressable>
                          ) : null}
                          {permit?.formUrl ? (
                            <Pressable onPress={() => openLink(permit.formUrl as string).catch(() => {})} testID={`link-authority-form-${e.bundesland}`} style={({ pressed }) => [styles.avLinkRow, { opacity: pressed ? 0.6 : 1 }]}>
                              <Feather name="file-text" size={14} color={theme.primary} />
                              <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>Antragsformular (PDF)</ThemedText>
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })()}
                  </View>
                );
              })}

              {availableBundeslaender.length > 0 ? (
                <>
                  <Pressable
                    style={[styles.addBundeslandBtn, { borderColor: theme.primary + "55" }]}
                    onPress={() => { setShowAddBundesland(!showAddBundesland); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    testID="button-add-bundesland"
                  >
                    <Feather name={showAddBundesland ? "x" : "plus"} size={16} color={theme.primary} />
                    <ThemedText style={[styles.addBundeslandText, { color: theme.primary }]}>
                      {showAddBundesland ? "Abbrechen" : "Bundesland hinzufügen"}
                    </ThemedText>
                  </Pressable>

                  {showAddBundesland ? (
                    <View style={styles.selectionGrid}>
                      {availableBundeslaender.map((bl) => (
                        <Pressable
                          key={bl}
                          style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
                          onPress={() => addErlaubnis(bl)}
                          testID={`chip-add-bundesland-${bl}`}
                        >
                          <Feather name="plus" size={14} color={theme.primary} />
                          <ThemedText style={[styles.chipText, { color: theme.text }]}>{bl}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <Pressable
                style={styles.expandRow}
                onPress={() => { setShow21hRules(!show21hRules); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                testID="button-toggle-21h-rules"
              >
                <View style={styles.expandRowLeft}>
                  <Feather name="info" size={18} color={theme.primary} />
                  <ThemedText style={styles.expandLabel}>
                    Erfasste Geozonen &amp; Auflagen (§ 21h)
                  </ThemedText>
                </View>
                <Feather name={show21hRules ? "chevron-up" : "chevron-down"} size={18} color={theme.textTertiary} />
              </Pressable>

              {show21hRules ? (
                <View style={{ marginTop: Spacing.xs }}>
                  <View style={[styles.erlaubnis21hNote, { backgroundColor: theme.background, borderColor: theme.border, marginBottom: Spacing.sm }]}>
                    <Feather name="award" size={13} color={theme.primary} />
                    <ThemedText style={[styles.erlaubnis21hNoteText, { color: theme.textSecondary }]}>
                      Voraussetzung: gültiges A2-Fernpilotenzeugnis und Mindestalter 16 Jahre. Betrieb nur in der offenen Kategorie (A1-A3) bis max. 120 m über Grund.
                    </ThemedText>
                  </View>
                  {PARAGRAPH_21H_RULES.map((rule) => (
                    <View key={rule.id} style={[styles.ruleRow, { borderColor: theme.border }]}>
                      <View style={styles.ruleHeader}>
                        <ThemedText style={[styles.ruleLabel, { color: theme.text }]}>{rule.label}</ThemedText>
                        <ThemedText style={[styles.ruleParagraph, { color: theme.textTertiary }]}>{rule.paragraph}</ThemedText>
                      </View>
                      <ThemedText style={[styles.ruleTatbestand, { color: theme.textTertiary }]}>{rule.tatbestand}</ThemedText>
                      <ThemedText style={[styles.ruleAuflagenLabel, { color: theme.statusGo || "#34C759" }]}>Mit AV erlaubt - Auflagen:</ThemedText>
                      {rule.auflagen.map((auflage, ai) => (
                        <View key={ai} style={styles.ruleBulletRow}>
                          <ThemedText style={[styles.ruleBullet, { color: theme.textSecondary }]}>{"\u2022"}</ThemedText>
                          <ThemedText style={[styles.ruleAuflagen, { color: theme.textSecondary }]}>{auflage}</ThemedText>
                        </View>
                      ))}
                    </View>
                  ))}
                  <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary, marginTop: Spacing.xs }]}>
                    Hinweis: Natur- und Vogelschutzgebiete, Nationalparks sowie FFH-Gebiete sind nicht von der geografischen Allgemeinerlaubnis erfasst und benötigen eine separate Genehmigung.
                  </ThemedText>
                </View>
              ) : null}
            </>
          )}
        </Card>

        <Card style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <ThemedText style={styles.sectionTitle}>Länderspezifisch</ThemedText>
              <ThemedText style={[styles.toggleSubtext, { color: theme.textSecondary }]}>
                Registrierungen und Nachweise für Flüge im Ausland
              </ThemedText>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {([
            { key: "insuranceCH1Mio" as const, label: "CH: Versicherung 1 Mio. CHF", desc: "Haftpflicht mit mind. 1 Mio. CHF für die Schweiz" },
            { key: "insuranceATSzr" as const, label: "AT: Versicherung 750.000 SZR", desc: "Versicherungsnachweis für Österreich" },
            { key: "caaUK" as const, label: "UK: CAA Registrierung", desc: "Operator ID + Flyer ID bei der CAA UK" },
          ]).map((field) => (
            <View key={field.key} style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <View style={styles.toggleLabelRow}>
                  <ThemedText style={styles.toggleLabel}>{field.label}</ThemedText>
                  <Pressable
                    onPress={() => setCountryInfoKey(field.key)}
                    hitSlop={10}
                    testID={`button-country-info-${field.key}`}
                    accessibilityLabel={`Mehr Infos zu ${field.label}`}
                    style={styles.infoIconBtn}
                  >
                    <Feather name="info" size={18} color={theme.primary} />
                  </Pressable>
                </View>
                <ThemedText style={[styles.toggleSubtext, { color: theme.textSecondary }]}>
                  {field.desc}
                </ThemedText>
              </View>
              <Switch
                value={(profile.countrySpecific || DEFAULT_COUNTRY_SPECIFIC)[field.key]}
                onValueChange={(v) => updateCountrySpecific({ [field.key]: v })}
                trackColor={{ false: theme.backgroundSecondary, true: theme.primary }}
                ios_backgroundColor={theme.backgroundSecondary}
              />
            </View>
          ))}
        </Card>
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.footer, { bottom: tabBarHeight, paddingBottom: Spacing.md, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title={saving ? "Wird gespeichert …" : "Profil speichern"}
          onPress={handleSave}
          disabled={!dirty || saving}
          loading={saving}
          testID="button-save-pilot-profile"
        />
      </View>

      <CountryInfoModal
        info={countryInfoKey ? COUNTRY_SPECIFIC_INFO[countryInfoKey] : null}
        onClose={() => setCountryInfoKey(null)}
      />

      <CountryInfoModal
        info={licenseInfoKey ? LICENSE_INFO[licenseInfoKey] : null}
        onClose={() => setLicenseInfoKey(null)}
      />
    </ThemedView>
  );
}

type InfoModalEntry = {
  flag: string;
  title: string;
  whatIsIt: string;
  howToGet: string;
  links: { label: string; url: string }[];
};

function CountryInfoModal({
  info,
  onClose,
}: {
  info: InfoModalEntry | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  return (
    <InfoDialog
      visible={!!info}
      onClose={onClose}
      title={info ? `${info.flag} ${info.title}` : ""}
      okLabel="Schließen"
      testID="country-info-dialog"
      closeTestID="button-country-info-close"
      okTestID="button-country-info-dismiss"
      sections={info ? [
        { title: "Was ist das?", body: info.whatIsIt },
        { title: "Woher bekomme ich das?", body: info.howToGet },
      ] : []}
    >
      {info && info.links.length > 0 ? (
        <ThemedText style={styles.modalH3}>Links</ThemedText>
      ) : null}
      {info?.links.map((link) => (
        <Pressable
          key={link.url}
          onPress={() => openLink(link.url).catch(() => {})}
          testID={`button-country-info-link-${link.url}`}
          style={({ pressed }) => [
            styles.linkBtn,
            {
              backgroundColor: theme.primary + (pressed ? "30" : "15"),
              borderColor: theme.primary + "40",
            },
          ]}
        >
          <Feather name="external-link" size={16} color={theme.primary} />
          <ThemedText style={[styles.linkBtnText, { color: theme.primary }]} numberOfLines={2}>
            {link.label}
          </ThemedText>
        </Pressable>
      ))}
    </InfoDialog>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
  },
  loadingHint: {
    ...Typography.caption,
    textAlign: "center",
  },
  section: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h4,
    marginBottom: Spacing.sm,
  },
  fieldLabel: {
    ...Typography.caption,
    marginTop: Spacing.md,
    marginBottom: 4,
  },
  fieldHint: {
    ...Typography.caption,
    marginTop: 6,
    lineHeight: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
  },
  toggleDisabled: {
    opacity: 0.45,
  },
  toggleInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  toggleLabel: {
    ...Typography.body,
    fontWeight: "600",
  },
  toggleLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  infoIconBtn: {
    padding: 2,
  },
  modalH3: {
    ...Typography.body,
    fontWeight: "800",
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  linkBtnText: {
    flex: 1,
    fontWeight: "600",
  },
  toggleDesc: {
    ...Typography.caption,
    marginTop: 2,
  },
  toggleSubtext: {
    ...Typography.caption,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginVertical: Spacing.xs,
  },
  avHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  expandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
  },
  expandRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  expandLabel: {
    ...Typography.body,
    fontWeight: "500",
  },
  selectionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: Spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  avLockedBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.md,
  },
  avLockedText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  avLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  avLinkText: {
    fontSize: 13,
    fontWeight: "600",
  },
  erlaubnis21hNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  erlaubnis21hNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  erlaubnisLinks: {
    marginTop: Spacing.xs,
  },
  erlaubnisCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  erlaubnisHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  erlaubnisTitle: {
    ...Typography.body,
    fontWeight: "700",
  },
  expiredBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  expiredBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  iconBtn: {
    padding: 6,
  },
  addBundeslandBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: Spacing.xs,
  },
  addBundeslandText: {
    fontWeight: "600",
  },
  ruleRow: {
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ruleHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: Spacing.sm,
    marginBottom: 3,
  },
  ruleLabel: {
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  ruleParagraph: {
    fontSize: 11,
    fontWeight: "500",
  },
  ruleTatbestand: {
    fontSize: 12,
    lineHeight: 17,
    fontStyle: "italic",
    marginBottom: 5,
  },
  ruleAuflagenLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },
  ruleBulletRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 2,
  },
  ruleBullet: {
    fontSize: 12,
    lineHeight: 17,
  },
  ruleAuflagen: {
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
  countryPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  countryPickerText: {
    ...Typography.body,
  },
  countryList: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.xs,
    overflow: "hidden",
  },
  countryScroll: {
    maxHeight: 200,
  },
  countryItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  countryItemText: {
    ...Typography.body,
  },
  licenseDetails: {
    paddingLeft: Spacing.sm,
    paddingTop: Spacing.xs,
    borderLeftWidth: 2,
    borderLeftColor: "rgba(10,77,140,0.2)",
    marginLeft: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  licenseRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  licenseField: {
    flex: 1,
  },
  licenseButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.sm,
  },
  licenseButtonText: {
    ...Typography.body,
    fontWeight: "600",
    flex: 1,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(128,128,128,0.2)",
  },
});
