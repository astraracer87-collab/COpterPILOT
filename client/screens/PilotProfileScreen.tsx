import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, ScrollView, TextInput, Pressable, Alert, Switch, Platform } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
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
  BUNDESLAENDER,
  Bundesland,
  AV_GEOZONE_TYPES,
  LICENSE_COUNTRIES,
  LicenseCountryCode,
} from "@/lib/storage";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

export default function PilotProfileScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showBundeslaender, setShowBundeslaender] = useState(false);
  const [showGeozoneTypes, setShowGeozoneTypes] = useState(false);
  const [showA1A3Country, setShowA1A3Country] = useState(false);
  const [showA2Country, setShowA2Country] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getPilotProfile().then(setProfile);
    }, [])
  );

  const update = (partial: Partial<PilotProfile>) => {
    if (!profile) return;
    setProfile({ ...profile, ...partial });
    setDirty(true);
  };

  const updateAV = (partial: Partial<PilotProfile["allgemeinverfuegung"]>) => {
    if (!profile) return;
    setProfile({
      ...profile,
      allgemeinverfuegung: { ...profile.allgemeinverfuegung, ...partial },
    });
    setDirty(true);
  };

  const updateCountrySpecific = (partial: Partial<CountrySpecificPilot>) => {
    if (!profile) return;
    setProfile({
      ...profile,
      countrySpecific: { ...(profile.countrySpecific || DEFAULT_COUNTRY_SPECIFIC), ...partial },
    });
    setDirty(true);
  };

  const toggleBundesland = (bl: Bundesland) => {
    if (!profile) return;
    const current = profile.allgemeinverfuegung.bundeslaender;
    const next = current.includes(bl)
      ? current.filter((b) => b !== bl)
      : [...current, bl];
    updateAV({ bundeslaender: next });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleGeozoneType = (id: string) => {
    if (!profile) return;
    const current = profile.allgemeinverfuegung.geozoneTypes;
    const next = current.includes(id)
      ? current.filter((g) => g !== id)
      : [...current, id];
    updateAV({ geozoneTypes: next });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const hasCompleteLicense =
    (profile?.licenseA1A3 && profile?.licenseA1A3Details && isLicenseComplete(profile.licenseA1A3Details)) ||
    (profile?.licenseA2 && profile?.licenseA2Details && isLicenseComplete(profile.licenseA2Details));

  const handleSave = async () => {
    if (!profile) return;
    await savePilotProfile(profile);
    setDirty(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Gespeichert", "Dein Pilotenprofil wurde gespeichert.");
  };

  if (!profile) return null;

  const avEnabled = profile.allgemeinverfuegung.enabled;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + 80 },
        ]}
      >
        <Card style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Persönliche Daten</ThemedText>

          <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            Name des Piloten
          </ThemedText>
          <TextInput
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
            value={profile.name}
            onChangeText={(t) => update({ name: t })}
            placeholder="Vor- und Nachname"
            placeholderTextColor={theme.textTertiary}
          />

          <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>
            Fernpiloten-Zeugnisnummer (eID)
          </ThemedText>
          <TextInput
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
          <TextInput
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

          <Pressable
            style={styles.toggleRow}
            onPress={() => { update({ licenseA1A3: !profile.licenseA1A3 }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <View style={styles.toggleInfo}>
              <ThemedText style={styles.toggleLabel}>EU-Kompetenznachweis A1/A3</ThemedText>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                Online-Prüfung beim LBA
              </ThemedText>
            </View>
            <Switch
              value={profile.licenseA1A3}
              onValueChange={(v) => { update({ licenseA1A3: v }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
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
              <View style={styles.licenseRow}>
                <View style={styles.licenseField}>
                  <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Vorname</ThemedText>
                  <TextInput
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                    value={profile.licenseA1A3Details?.firstName || ""}
                    onChangeText={(t) => updateLicenseA1A3Details({ firstName: t })}
                    placeholder="Vorname"
                    placeholderTextColor={theme.textTertiary}
                  />
                </View>
                <View style={styles.licenseField}>
                  <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Nachname</ThemedText>
                  <TextInput
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                    value={profile.licenseA1A3Details?.lastName || ""}
                    onChangeText={(t) => updateLicenseA1A3Details({ lastName: t })}
                    placeholder="Nachname"
                    placeholderTextColor={theme.textTertiary}
                  />
                </View>
              </View>
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Identifizierungsnummer</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseA1A3Details?.identificationNumber || ""}
                onChangeText={(t) => updateLicenseA1A3Details({ identificationNumber: t })}
                placeholder="z.B. DEU-RP-123456789ABC"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="characters"
              />
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Gültigkeitsdatum</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseA1A3Details?.expirationDate || ""}
                onChangeText={(t) => updateLicenseA1A3Details({ expirationDate: t })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textTertiary}
              />
            </View>
          ) : null}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <Pressable
            style={styles.toggleRow}
            onPress={() => { update({ licenseA2: !profile.licenseA2 }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <View style={styles.toggleInfo}>
              <ThemedText style={styles.toggleLabel}>Fernpiloten-Zeugnis A2</ThemedText>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                Praktische Prüfung bei anerkannter Stelle
              </ThemedText>
            </View>
            <Switch
              value={profile.licenseA2}
              onValueChange={(v) => { update({ licenseA2: v }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
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
              <View style={styles.licenseRow}>
                <View style={styles.licenseField}>
                  <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Vorname</ThemedText>
                  <TextInput
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                    value={profile.licenseA2Details?.firstName || ""}
                    onChangeText={(t) => updateLicenseA2Details({ firstName: t })}
                    placeholder="Vorname"
                    placeholderTextColor={theme.textTertiary}
                  />
                </View>
                <View style={styles.licenseField}>
                  <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Nachname</ThemedText>
                  <TextInput
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                    value={profile.licenseA2Details?.lastName || ""}
                    onChangeText={(t) => updateLicenseA2Details({ lastName: t })}
                    placeholder="Nachname"
                    placeholderTextColor={theme.textTertiary}
                  />
                </View>
              </View>
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Identifizierungsnummer</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseA2Details?.identificationNumber || ""}
                onChangeText={(t) => updateLicenseA2Details({ identificationNumber: t })}
                placeholder="z.B. DEU-RP-123456789ABC"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="characters"
              />
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Gültigkeitsdatum</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.licenseA2Details?.expirationDate || ""}
                onChangeText={(t) => updateLicenseA2Details({ expirationDate: t })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textTertiary}
              />
            </View>
          ) : null}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <Pressable
            style={styles.toggleRow}
            onPress={() => { update({ licenseSTS: !profile.licenseSTS }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <View style={styles.toggleInfo}>
              <ThemedText style={styles.toggleLabel}>STS-Betriebsgenehmigung</ThemedText>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                Standardszenarien (STS-01, STS-02)
              </ThemedText>
            </View>
            <Switch
              value={profile.licenseSTS}
              onValueChange={(v) => { update({ licenseSTS: v }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              trackColor={{ false: theme.backgroundSecondary, true: theme.primary + "60" }}
              thumbColor={profile.licenseSTS ? theme.primary : theme.textTertiary}
            />
          </Pressable>

          {hasCompleteLicense ? (
            <>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <Pressable
                style={[styles.licenseButton, { backgroundColor: theme.primary + "10" }]}
                onPress={async () => {
                  if (dirty && profile) {
                    await savePilotProfile(profile);
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
              <ThemedText style={styles.sectionTitle}>Allgemeinverfügung</ThemedText>
              <ThemedText style={[styles.toggleDesc, { color: theme.textTertiary }]}>
                Genehmigung für bestimmte Geozonen-Typen in ausgewählten Bundesländern
              </ThemedText>
            </View>
            <Switch
              value={avEnabled}
              onValueChange={(v) => { updateAV({ enabled: v }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              trackColor={{ false: theme.backgroundSecondary, true: theme.primary + "60" }}
              thumbColor={avEnabled ? theme.primary : theme.textTertiary}
            />
          </View>

          {avEnabled ? (
            <>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <Pressable
                style={styles.expandRow}
                onPress={() => { setShowBundeslaender(!showBundeslaender); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <View style={styles.expandRowLeft}>
                  <Feather name="map" size={18} color={theme.primary} />
                  <ThemedText style={styles.expandLabel}>
                    Bundesländer ({profile.allgemeinverfuegung.bundeslaender.length} ausgewählt)
                  </ThemedText>
                </View>
                <Feather name={showBundeslaender ? "chevron-up" : "chevron-down"} size={18} color={theme.textTertiary} />
              </Pressable>

              {showBundeslaender ? (
                <View style={styles.selectionGrid}>
                  {BUNDESLAENDER.map((bl) => {
                    const selected = profile.allgemeinverfuegung.bundeslaender.includes(bl);
                    return (
                      <Pressable
                        key={bl}
                        style={[
                          styles.chip,
                          { borderColor: selected ? theme.primary : theme.border },
                          selected ? { backgroundColor: theme.primary + "18" } : { backgroundColor: theme.backgroundSecondary },
                        ]}
                        onPress={() => toggleBundesland(bl)}
                      >
                        {selected ? (
                          <Feather name="check" size={14} color={theme.primary} />
                        ) : null}
                        <ThemedText
                          style={[
                            styles.chipText,
                            { color: selected ? theme.primary : theme.text },
                          ]}
                        >
                          {bl}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <Pressable
                style={styles.expandRow}
                onPress={() => { setShowGeozoneTypes(!showGeozoneTypes); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <View style={styles.expandRowLeft}>
                  <Feather name="layers" size={18} color={theme.primary} />
                  <ThemedText style={styles.expandLabel}>
                    Geozonen-Typen ({profile.allgemeinverfuegung.geozoneTypes.length} ausgewählt)
                  </ThemedText>
                </View>
                <Feather name={showGeozoneTypes ? "chevron-up" : "chevron-down"} size={18} color={theme.textTertiary} />
              </Pressable>

              {showGeozoneTypes ? (
                <View style={styles.selectionGrid}>
                  {AV_GEOZONE_TYPES.map((gz) => {
                    const selected = profile.allgemeinverfuegung.geozoneTypes.includes(gz.id);
                    return (
                      <Pressable
                        key={gz.id}
                        style={[
                          styles.chip,
                          { borderColor: selected ? theme.primary : theme.border },
                          selected ? { backgroundColor: theme.primary + "18" } : { backgroundColor: theme.backgroundSecondary },
                        ]}
                        onPress={() => toggleGeozoneType(gz.id)}
                      >
                        {selected ? (
                          <Feather name="check" size={14} color={theme.primary} />
                        ) : null}
                        <ThemedText
                          style={[
                            styles.chipText,
                            { color: selected ? theme.primary : theme.text },
                          ]}
                        >
                          {gz.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                Anmerkungen zur Allgemeinverfügung
              </ThemedText>
              <TextInput
                style={[styles.input, styles.multilineInput, { color: theme.text, backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
                value={profile.allgemeinverfuegung.notes || ""}
                onChangeText={(t) => updateAV({ notes: t })}
                placeholder="z.B. Aktenzeichen, Gültigkeitsdatum..."
                placeholderTextColor={theme.textTertiary}
                multiline
                numberOfLines={3}
              />
            </>
          ) : null}
        </Card>

        <Card style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <ThemedText style={styles.sectionTitle}>Länderspezifisch</ThemedText>
              <ThemedText style={[styles.toggleSubtext, { color: theme.textSecondary }]}>
                Registrierungen und Nachweise fur Fluge im Ausland
              </ThemedText>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {([
            { key: "insuranceCH1Mio" as const, label: "CH: Versicherung 1 Mio. CHF", desc: "Haftpflicht mit mind. 1 Mio. CHF fur die Schweiz" },
            { key: "insuranceATSzr" as const, label: "AT: Versicherung 750.000 SZR", desc: "Versicherungsnachweis fur Osterreich" },
            { key: "alphaTangoFR" as const, label: "FR: AlphaTango registriert", desc: "Registrierung auf AlphaTango fur Frankreich" },
            { key: "dFlightIT" as const, label: "IT: D-Flight QR-Code", desc: "D-Flight QR-Code fur Italien" },
            { key: "caaUK" as const, label: "UK: CAA Registrierung", desc: "Operator ID + Flyer ID bei der CAA UK" },
          ]).map((field) => (
            <View key={field.key} style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <ThemedText style={styles.toggleLabel}>{field.label}</ThemedText>
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
      </ScrollView>

      <View style={[styles.footer, { bottom: tabBarHeight, paddingBottom: Spacing.md, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Profil speichern"
          onPress={handleSave}
          disabled={!dirty}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
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
  toggleInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  toggleLabel: {
    ...Typography.body,
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
