import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import {
  getSetupGuideStatus,
  setSetupGuideStatus,
  setupGuideController,
  shouldOfferSetupGuide,
  isValidSetupGuideStatus,
  fetchSetupGuideState,
  persistServerSetupGuideStatus,
} from "@/lib/setupGuide";
import {
  saveDrone,
  getPilotProfile,
  savePilotProfile,
  hasLocalUserData,
  type DroneProfile,
  type PilotProfile,
} from "@/lib/storage";
import {
  ALL_PRESETS,
  searchPresets,
  getPresetLimits,
  getDefaultCategoryForPreset,
  type DronePreset,
} from "@/lib/dronePresets";
import { queryClient } from "@/lib/query-client";

type Step = "choice" | "drones" | "pilot" | "licenses" | "done";

const DEFAULT_LIMITS = {
  maxWind: 10,
  maxGusts: 12,
  maxRain: 0.5,
  minTemp: 0,
  maxTemp: 40,
  minCloudCeiling: 50,
  minVisibility: 5000,
};

const EMPTY_COMPLIANCE = {
  operatorRegistered: false,
  eIdLabeledOnDrone: false,
  insuranceActive: false,
  competencyA1A3: false,
  certificateA2: false,
  remoteIdConfigured: false,
};

type NewDrone = Omit<DroneProfile, "id" | "createdAt" | "updatedAt">;

function buildDroneFromPreset(p: DronePreset): NewDrone {
  return {
    name: `${p.manufacturer} ${p.model}`.trim(),
    manufacturer: p.manufacturer,
    model: p.model,
    classMark: p.classMark,
    mtomGrams: p.mtomGrams,
    charDimensionM: p.charDimensionM && p.charDimensionM > 0 ? p.charDimensionM : undefined,
    hasCameraOrSensor: p.hasCameraOrSensor,
    droneType: p.droneType,
    openCategory: getDefaultCategoryForPreset(p),
    hasRemoteId: p.hasRemoteId,
    altitudeLocked120m: p.altitudeLocked120m,
    compliance: { ...EMPTY_COMPLIANCE },
    limits: getPresetLimits(p),
  };
}

export function SetupGuideOverlay() {
  const keyboardInset = useKeyboardInset();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, status } = useAuth();
  const userId = user?.id ?? null;

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>("choice");
  const autoCheckedRef = useRef<string | null>(null);

  // Beim Abmelden / Kontowechsel zurücksetzen: Ein offenes Overlay schließen und
  // die Auto-Prüfung freigeben, damit die nächste Anmeldung (auch ein zweites
  // Konto auf demselben Gerät) den Status frisch aus dem Speicher auswertet und
  // kein verwaister Assistent von Nutzer A für Nutzer B stehen bleibt.
  useEffect(() => {
    if (status === "authenticated" && userId) return;
    autoCheckedRef.current = null;
    setVisible(false);
  }, [status, userId]);

  // Auto-Trigger beim ersten Login dieses Kontos: Status pro User-ID prüfen und
  // nur dann anbieten, wenn er für genau dieses Konto noch nie gesetzt wurde.
  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    if (autoCheckedRef.current === userId) return;
    autoCheckedRef.current = userId;
    let cancelled = false;
    (async () => {
      const localStatus = await getSetupGuideStatus(userId);
      // Konto-gebundener Status direkt aus dem Auth-Payload (sofort verfügbar);
      // der Server-Abruf liefert ihn zusätzlich frisch plus die Heuristik, ob
      // das Konto bereits Daten hat. Offline schlägt der Abruf fehl -> lokale
      // Entscheidung als Fallback.
      let serverStatus = isValidSetupGuideStatus(user?.setupGuideStatus)
        ? user!.setupGuideStatus
        : null;
      let serverHasContent = false;
      let stateFetchOk = false;
      try {
        const state = await fetchSetupGuideState();
        serverStatus = state.status ?? serverStatus;
        serverHasContent = state.hasContent;
        stateFetchOk = true;
      } catch {
        // Best-effort: ohne Server-Antwort entscheidet der lokale Status.
      }
      // Inhaltsprüfung gegen lokale Daten absichern: Direkt nach dem Login kann
      // der lokal→Server-Abgleich noch laufen, sodass der Server das Konto kurz
      // als leer meldet. Lokal vorhandene Daten (Drohnen, Profil, Sessions, …)
      // zählen daher ebenfalls als „Konto hat bereits Daten", damit ein
      // Bestandskonto nie fälschlich als Erstnutzer eingestuft wird.
      let localHasContent = false;
      try {
        localHasContent = await hasLocalUserData();
      } catch {
        // Best-effort: lokale Prüfung darf die Entscheidung nicht blockieren.
      }
      const hasContent = serverHasContent || localHasContent;
      // Der Inhaltsstatus gilt nur dann als zuverlässig aufgelöst, wenn der
      // Server-Abruf erfolgreich war. Schlägt er fehl, können wir nicht
      // bestätigen, dass das Konto wirklich leer ist -> im Zweifel NICHT anbieten
      // (sonst würden Bestandsnutzer bei einem vorübergehenden Fehler erneut in
      // die Einrichtung geschickt; Parität zum Web).
      if (
        !cancelled &&
        shouldOfferSetupGuide({
          serverStatus,
          localStatus,
          hasContent,
          contentResolved: stateFetchOk,
        })
      ) {
        setStep("choice");
        setVisible(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, userId, user?.setupGuideStatus]);

  // Re-Launch aus den Einstellungen.
  useEffect(() => {
    const unsubscribe = setupGuideController.subscribe(() => {
      setStep("choice");
      setVisible(true);
    });
    return unsubscribe;
  }, []);

  const finish = useCallback(
    async (result: "completed" | "skipped") => {
      // Lokal (Best-Effort, Offline) UND konto-gebunden auf dem Server ablegen,
      // damit der Assistent geräteunabhängig nicht erneut angeboten wird.
      await setSetupGuideStatus(result, userId);
      void persistServerSetupGuideStatus(result);
      setVisible(false);
    },
    [userId],
  );

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => finish("skipped")}
    >
      <View style={[styles.root, { backgroundColor: theme.backgroundRoot, paddingTop: insets.top, paddingBottom: keyboardInset }]}>
        <View style={styles.header}>
          <ThemedText style={styles.headerTitle}>Einrichtung</ThemedText>
          <Pressable
            onPress={() => finish(step === "done" ? "completed" : "skipped")}
            hitSlop={12}
            testID="setup-guide-close"
          >
            <Feather name="x" size={24} color={theme.textSecondary} />
          </Pressable>
        </View>

        {step === "choice" ? (
          <ChoiceStep
            theme={theme}
            onStart={() => setStep("drones")}
            onSkip={() => finish("skipped")}
          />
        ) : null}
        {step === "drones" ? (
          <DronesStep theme={theme} onNext={() => setStep("pilot")} />
        ) : null}
        {step === "pilot" ? (
          <PilotStep theme={theme} onNext={() => setStep("licenses")} />
        ) : null}
        {step === "licenses" ? (
          <LicensesStep theme={theme} onNext={() => setStep("done")} />
        ) : null}
        {step === "done" ? (
          <DoneStep theme={theme} onClose={() => finish("completed")} />
        ) : null}
      </View>
    </Modal>
  );
}

type ThemeT = ReturnType<typeof useTheme>["theme"];

function StepHeader({ theme, index, title, subtitle }: { theme: ThemeT; index: number; title: string; subtitle: string }) {
  return (
    <View style={styles.stepHeader}>
      <ThemedText style={[styles.stepCounter, { color: theme.primary }]}>
        {`Schritt ${index} von 3`}
      </ThemedText>
      <ThemedText style={styles.stepTitle}>{title}</ThemedText>
      <ThemedText style={[styles.stepSubtitle, { color: theme.textSecondary }]}>{subtitle}</ThemedText>
    </View>
  );
}

function PrimaryButton({ theme, title, onPress, loading, testID }: { theme: ThemeT; title: string; onPress: () => void; loading?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={[styles.primaryBtn, { backgroundColor: theme.primary, opacity: loading ? 0.6 : 1 }]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <ThemedText style={styles.primaryBtnText}>{title}</ThemedText>
      )}
    </Pressable>
  );
}

function SkipLink({ theme, title, onPress, testID }: { theme: ThemeT; title: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} style={styles.skipLink} testID={testID}>
      <ThemedText style={[styles.skipLinkText, { color: theme.textSecondary }]}>{title}</ThemedText>
    </Pressable>
  );
}

function ChoiceStep({ theme, onStart, onSkip }: { theme: ThemeT; onStart: () => void; onSkip: () => void }) {
  return (
    <View style={styles.choiceContainer}>
      <View style={[styles.choiceIcon, { backgroundColor: theme.primary + "22" }]}>
        <Feather name="compass" size={40} color={theme.primary} />
      </View>
      <ThemedText style={styles.choiceTitle}>Willkommen an Bord</ThemedText>
      <ThemedText style={[styles.choiceText, { color: theme.textSecondary }]}>
        Richte deine Drohnen, dein Pilotenprofil und deine Lizenzen in wenigen Schritten ein.
        Du kannst jeden Schritt überspringen und später in den Einstellungen fortsetzen.
      </ThemedText>
      <View style={styles.choiceActions}>
        <PrimaryButton theme={theme} title="Geführtes Setup starten" onPress={onStart} testID="setup-guide-start" />
        <SkipLink theme={theme} title="Später / Überspringen" onPress={onSkip} testID="setup-guide-skip-all" />
      </View>
    </View>
  );
}

function describeDroneSaveError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/subscription|abo|402|payment/i.test(msg)) {
    return "Drohnen lassen sich erst mit aktivem Abo dauerhaft speichern. Du kannst diesen Schritt überspringen und später fortsetzen.";
  }
  return "Drohne konnte nicht gespeichert werden. Bitte versuche es später erneut oder überspringe diesen Schritt.";
}

function DronesStep({ theme, onNext }: { theme: ThemeT; onNext: () => void }) {
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mManufacturer, setMManufacturer] = useState("");
  const [mModel, setMModel] = useState("");
  const [mClass, setMClass] = useState("C0");
  const [mMtom, setMMtom] = useState("249");

  const results = useMemo(() => {
    const list = query.trim() ? searchPresets(query.trim()) : ALL_PRESETS;
    return list.slice(0, 20);
  }, [query]);

  const addPreset = useCallback(async (p: DronePreset) => {
    const label = `${p.manufacturer} ${p.model}`.trim();
    setSavingName(label);
    setErrorMsg(null);
    try {
      await saveDrone(buildDroneFromPreset(p));
      setAdded((prev) => [...prev, label]);
      queryClient.invalidateQueries();
    } catch (e) {
      setErrorMsg(describeDroneSaveError(e));
    } finally {
      setSavingName(null);
    }
  }, []);

  const addManual = useCallback(async () => {
    const name = mName.trim() || `${mManufacturer} ${mModel}`.trim();
    if (!name) return;
    setSavingName(name);
    setErrorMsg(null);
    try {
      const drone: NewDrone = {
        name,
        manufacturer: mManufacturer.trim() || undefined,
        model: mModel.trim() || undefined,
        classMark: (mClass.trim() || "C0") as DroneProfile["classMark"],
        mtomGrams: parseInt(mMtom, 10) || 0,
        hasCameraOrSensor: true,
        droneType: "standard" as DroneProfile["droneType"],
        openCategory: "A3" as DroneProfile["openCategory"],
        hasRemoteId: false,
        altitudeLocked120m: false,
        compliance: { ...EMPTY_COMPLIANCE },
        limits: { ...DEFAULT_LIMITS },
      };
      await saveDrone(drone);
      setAdded((prev) => [...prev, name]);
      queryClient.invalidateQueries();
      setManualOpen(false);
      setMName("");
      setMManufacturer("");
      setMModel("");
      setMClass("C0");
      setMMtom("249");
    } catch (e) {
      setErrorMsg(describeDroneSaveError(e));
    } finally {
      setSavingName(null);
    }
  }, [mName, mManufacturer, mModel, mClass, mMtom]);

  return (
    <View style={styles.stepBody}>
      <StepHeader
        theme={theme}
        index={1}
        title="Drohnen"
        subtitle="Wähle deine Drohnen aus der Liste oder lege sie manuell an. Du kannst mehrere hinzufügen."
      />
      <KeyboardAwareScrollViewCompat bottomOffset={24}
        contentContainerStyle={styles.stepScroll}
        keyboardShouldPersistTaps="handled"
      >
        {added.length > 0 ? (
          <View style={[styles.addedBox, { backgroundColor: theme.statusGoBackground }]}>
            <Feather name="check-circle" size={16} color={theme.statusGo} />
            <ThemedText style={[styles.addedText, { color: theme.statusGo }]}>
              {`${added.length} ${added.length === 1 ? "Drohne" : "Drohnen"} hinzugefügt: ${added.join(", ")}`}
            </ThemedText>
          </View>
        ) : null}

        {errorMsg ? (
          <View style={[styles.addedBox, { backgroundColor: theme.statusNoGoBackground }]}>
            <Feather name="alert-circle" size={16} color={theme.statusNoGo} />
            <ThemedText style={[styles.addedText, { color: theme.statusNoGo }]} testID="setup-drone-error">
              {errorMsg}
            </ThemedText>
          </View>
        ) : null}

        <View style={[styles.searchRow, { borderColor: theme.border }]}>
          <Feather name="search" size={18} color={theme.textTertiary} />
          <TextInput disableFullscreenUI
            value={query}
            onChangeText={setQuery}
            placeholder="Drohne suchen (z. B. Mavic)"
            placeholderTextColor={theme.textTertiary}
            style={[styles.searchInput, { color: theme.text }]}
            autoCapitalize="none"
            testID="setup-drone-search"
          />
        </View>

        {results.map((p) => {
          const label = `${p.manufacturer} ${p.model}`.trim();
          const isSaving = savingName === label;
          return (
            <Pressable
              key={`${p.manufacturer}-${p.model}-${p.year}`}
              onPress={() => addPreset(p)}
              disabled={isSaving}
              style={[styles.presetRow, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}
              testID={`setup-drone-preset-${label}`}
            >
              <MaterialCommunityIcons name="quadcopter" size={22} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.presetName}>{label}</ThemedText>
                <ThemedText style={[styles.presetMeta, { color: theme.textSecondary }]}>
                  {`${p.classMark} · ${p.mtomGrams} g`}
                </ThemedText>
              </View>
              {isSaving ? (
                <ActivityIndicator color={theme.primary} size="small" />
              ) : (
                <Feather name="plus-circle" size={22} color={theme.primary} />
              )}
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => setManualOpen((v) => !v)}
          style={styles.manualToggle}
          testID="setup-drone-manual-toggle"
        >
          <Feather name={manualOpen ? "chevron-down" : "chevron-right"} size={18} color={theme.primary} />
          <ThemedText style={[styles.manualToggleText, { color: theme.primary }]}>Manuell hinzufügen</ThemedText>
        </Pressable>

        {manualOpen ? (
          <View style={[styles.manualForm, { borderColor: theme.border }]}>
            <ManualField theme={theme} label="Name" value={mName} onChange={setMName} placeholder="Eigene Drohne" />
            <ManualField theme={theme} label="Hersteller" value={mManufacturer} onChange={setMManufacturer} placeholder="z. B. DJI" />
            <ManualField theme={theme} label="Modell" value={mModel} onChange={setMModel} placeholder="z. B. Mini 4 Pro" />
            <View style={styles.manualRow}>
              <View style={{ flex: 1 }}>
                <ManualField theme={theme} label="Klasse" value={mClass} onChange={setMClass} placeholder="C0" />
              </View>
              <View style={{ flex: 1 }}>
                <ManualField theme={theme} label="MTOM (g)" value={mMtom} onChange={setMMtom} placeholder="249" keyboardType="numeric" />
              </View>
            </View>
            <PrimaryButton
              theme={theme}
              title="Drohne hinzufügen"
              onPress={addManual}
              loading={savingName !== null}
              testID="setup-drone-manual-add"
            />
          </View>
        ) : null}
      </KeyboardAwareScrollViewCompat>

      <View style={styles.footer}>
        <PrimaryButton theme={theme} title="Weiter" onPress={onNext} testID="setup-drones-next" />
        <SkipLink theme={theme} title="Schritt überspringen" onPress={onNext} testID="setup-drones-skip" />
      </View>
    </View>
  );
}

function PilotStep({ theme, onNext }: { theme: ThemeT; onNext: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const profileRef = useRef<PilotProfile | null>(null);
  const [name, setName] = useState("");
  const [pilotId, setPilotId] = useState("");
  const [operatorId, setOperatorId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getPilotProfile();
      if (cancelled) return;
      profileRef.current = p;
      setName(p.name || "");
      setPilotId(p.pilotId || "");
      setOperatorId(p.operatorId || "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveAndNext = useCallback(async () => {
    if (!profileRef.current) return onNext();
    setSaving(true);
    try {
      await savePilotProfile({
        ...profileRef.current,
        name: name.trim(),
        pilotId: pilotId.trim(),
        operatorId: operatorId.trim(),
      });
      queryClient.invalidateQueries();
    } finally {
      setSaving(false);
      onNext();
    }
  }, [name, pilotId, operatorId, onNext]);

  return (
    <View style={styles.stepBody}>
      <StepHeader
        theme={theme}
        index={2}
        title="Pilotendaten"
        subtitle="Diese Angaben erscheinen in deinen Flugprotokollen. Alle Felder sind optional."
      />
      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <KeyboardAwareScrollViewCompat bottomOffset={24} contentContainerStyle={styles.stepScroll} keyboardShouldPersistTaps="handled">
          <ManualField theme={theme} label="Name" value={name} onChange={setName} placeholder="Max Mustermann" />
          <ManualField theme={theme} label="eID / Fernpiloten-Nr." value={pilotId} onChange={setPilotId} placeholder="z. B. FRA-..." />
          <ManualField theme={theme} label="Betreiber-Nr. (Operator-ID)" value={operatorId} onChange={setOperatorId} placeholder="z. B. DEUop..." />
        </KeyboardAwareScrollViewCompat>
      )}
      <View style={styles.footer}>
        <PrimaryButton theme={theme} title="Weiter" onPress={saveAndNext} loading={saving} testID="setup-pilot-next" />
        <SkipLink theme={theme} title="Schritt überspringen" onPress={onNext} testID="setup-pilot-skip" />
      </View>
    </View>
  );
}

function LicensesStep({ theme, onNext }: { theme: ThemeT; onNext: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const profileRef = useRef<PilotProfile | null>(null);
  const [a1a3, setA1a3] = useState(false);
  const [a2, setA2] = useState(false);
  const [sts, setSts] = useState(false);
  const [insurance, setInsurance] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getPilotProfile();
      if (cancelled) return;
      profileRef.current = p;
      setA1a3(!!p.licenseA1A3);
      setA2(!!p.licenseA2);
      setSts(!!p.licenseSTS);
      setInsurance(!!p.insuranceActive);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveAndNext = useCallback(async () => {
    if (!profileRef.current) return onNext();
    setSaving(true);
    try {
      await savePilotProfile({
        ...profileRef.current,
        licenseA1A3: a1a3,
        licenseA2: a2,
        licenseSTS: sts,
        insuranceActive: insurance,
      });
      queryClient.invalidateQueries();
    } finally {
      setSaving(false);
      onNext();
    }
  }, [a1a3, a2, sts, insurance, onNext]);

  return (
    <View style={styles.stepBody}>
      <StepHeader
        theme={theme}
        index={3}
        title="Lizenzen & Versicherung"
        subtitle="Markiere, welche Nachweise du besitzt. Details kannst du später im Pilotenprofil ergänzen."
      />
      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <KeyboardAwareScrollViewCompat bottomOffset={24} contentContainerStyle={styles.stepScroll} keyboardShouldPersistTaps="handled">
          <ToggleRow theme={theme} label="EU-Kompetenznachweis A1/A3" value={a1a3} onToggle={() => setA1a3((v) => !v)} testID="setup-license-a1a3" />
          <ToggleRow theme={theme} label="Fernpiloten-Zeugnis A2" value={a2} onToggle={() => setA2((v) => !v)} testID="setup-license-a2" />
          <ToggleRow theme={theme} label="STS / Spezielle Kategorie" value={sts} onToggle={() => setSts((v) => !v)} testID="setup-license-sts" />
          <ToggleRow theme={theme} label="Haftpflichtversicherung aktiv" value={insurance} onToggle={() => setInsurance((v) => !v)} testID="setup-license-insurance" />
        </KeyboardAwareScrollViewCompat>
      )}
      <View style={styles.footer}>
        <PrimaryButton theme={theme} title="Abschließen" onPress={saveAndNext} loading={saving} testID="setup-licenses-next" />
        <SkipLink theme={theme} title="Schritt überspringen" onPress={onNext} testID="setup-licenses-skip" />
      </View>
    </View>
  );
}

function DoneStep({ theme, onClose }: { theme: ThemeT; onClose: () => void }) {
  return (
    <View style={styles.choiceContainer}>
      <View style={[styles.choiceIcon, { backgroundColor: theme.statusGoBackground }]}>
        <Feather name="check" size={40} color={theme.statusGo} />
      </View>
      <ThemedText style={styles.choiceTitle}>Alles bereit</ThemedText>
      <ThemedText style={[styles.choiceText, { color: theme.textSecondary }]}>
        Deine Einrichtung ist abgeschlossen. Du kannst alle Angaben jederzeit in den Einstellungen
        anpassen oder den Assistenten dort erneut starten.
      </ThemedText>
      <View style={styles.choiceActions}>
        <PrimaryButton theme={theme} title="Fertig" onPress={onClose} testID="setup-guide-done" />
      </View>
    </View>
  );
}

function ManualField({
  theme,
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
}: {
  theme: ThemeT;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
}) {
  return (
    <View style={styles.field}>
      <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
      <TextInput disableFullscreenUI
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        keyboardType={keyboardType || "default"}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
      />
    </View>
  );
}

function ToggleRow({ theme, label, value, onToggle, testID }: { theme: ThemeT; label: string; value: boolean; onToggle: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.toggleRow, { backgroundColor: theme.backgroundDefault, borderColor: value ? theme.primary : theme.border }]}
      testID={testID}
    >
      <ThemedText style={styles.toggleLabel}>{label}</ThemedText>
      <Feather
        name={value ? "check-square" : "square"}
        size={22}
        color={value ? theme.primary : theme.textTertiary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  headerTitle: { ...Typography.h3, fontWeight: "700" },
  choiceContainer: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  choiceIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  choiceTitle: { ...Typography.h1, fontWeight: "700", textAlign: "center" },
  choiceText: { ...Typography.body, textAlign: "center", lineHeight: 22 },
  choiceActions: { width: "100%", marginTop: Spacing.xl, gap: Spacing.sm },
  stepBody: { flex: 1 },
  stepHeader: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, gap: 4 },
  stepCounter: { ...Typography.small, fontWeight: "700", letterSpacing: 0.5 },
  stepTitle: { ...Typography.h1, fontWeight: "700" },
  stepSubtitle: { ...Typography.small, lineHeight: 20 },
  stepScroll: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  addedBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  addedText: { ...Typography.small, flex: 1, fontWeight: "600" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === "ios" ? Spacing.sm : 2,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: Spacing.sm },
  presetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  presetName: { ...Typography.body, fontWeight: "600" },
  presetMeta: { ...Typography.small },
  manualToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
  manualToggleText: { ...Typography.body, fontWeight: "600" },
  manualForm: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  manualRow: { flexDirection: "row", gap: Spacing.md },
  field: { gap: 6 },
  fieldLabel: { ...Typography.small, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === "ios" ? Spacing.md : Spacing.sm,
    fontSize: 16,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
  },
  toggleLabel: { ...Typography.body, flex: 1 },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  primaryBtn: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryBtnText: { ...Typography.body, fontWeight: "700", color: "#FFFFFF" },
  skipLink: { paddingVertical: Spacing.md, alignItems: "center" },
  skipLinkText: { ...Typography.small, fontWeight: "600" },
});
