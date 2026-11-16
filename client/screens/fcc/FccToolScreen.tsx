import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, Image, StyleSheet, Alert } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import FccLogPanel from "@/screens/fcc/FccLogPanel";
import { FccLog } from "@/lib/fcc/log";
import { Engine } from "@/lib/fcc/engine";
import { Keepalive } from "@/lib/fcc/keepalive";
import { writeFile, removeFile, GoggleVariant } from "@/lib/fcc/sdcard";
import {
  WizStep,
  WizardCtx,
  droneFccWizard,
  droneCeWizard,
  goggleFccWizard,
  goggleCeWizard,
} from "@/screens/fcc/wizards";

const rcImage = require("../../assets/images/fcc_rc.png");
const goggleImage = require("../../assets/images/fcc_goggle.png");

let disclaimerAccepted = false;

type ViewState =
  | { kind: "home" }
  | { kind: "droneMenu" }
  | { kind: "goggleMenu" }
  | { kind: "wizard"; heading: string; steps: WizStep[]; current: number };

export default function FccToolScreen() {
  const { theme } = useTheme();
  const [view, setView] = useState<ViewState>({ kind: "home" });
  const [mode, setMode] = useState<"" | "FCC" | "CE">(Engine.lastMode);
  const [keepaliveOn, setKeepaliveOn] = useState(false);
  const goggleVariant = useRef<GoggleVariant>("ham");

  const refreshKeepalive = () => setKeepaliveOn(Keepalive.isRunning());

  useEffect(() => {
    refreshKeepalive();
    if (!disclaimerAccepted) {
      Alert.alert(
        "Wichtiger Hinweis",
        "Dieses Werkzeug stellt die Funkregion von CE auf FCC um. In Deutschland und der EU ist der Betrieb mit FCC-Sendeleistung nicht zulässig (Funkrecht / BNetzA); Versicherungsschutz und DJI Care Refresh können entfallen.\n\nNutzung auf eigene Verantwortung, nur zu Test- und Forschungszwecken bzw. dort, wo FCC-Betrieb erlaubt ist.",
        [{ text: "Verstanden", onPress: () => (disclaimerAccepted = true) }],
      );
    }
  }, []);

  const ctx: WizardCtx = {
    setMode: (m) => setMode(m),
    setGoggleVariant: (v) => (goggleVariant.current = v),
    getGoggleVariant: () => goggleVariant.current,
    refreshKeepalive,
    pickAndWriteSd: async () => {
      const r = await writeFile(goggleVariant.current);
      Alert.alert(r.ok ? "Erledigt" : "Fehlgeschlagen", r.message + (r.ok ? "\n\nJetzt die Karte zurück in die Goggle stecken." : ""));
      return r.ok;
    },
    pickAndRemoveSd: async () => {
      const r = await removeFile();
      Alert.alert(r.ok ? "Erledigt" : "Fehlgeschlagen", r.message + (r.ok ? "\n\nJetzt die Karte zurück in die Goggle stecken." : ""));
      return r.ok;
    },
  };

  const startWizard = (heading: string, steps: WizStep[]) => {
    FccLog.step(`Ablauf gestartet: ${heading}`);
    if (steps.length > 0) FccLog.step(`Schritt 1: ${steps[0].title}`);
    setView({ kind: "wizard", heading, steps, current: 0 });
  };

  const advance = () => {
    setView((v) => {
      if (v.kind !== "wizard") return v;
      const next = v.current + 1;
      if (next < v.steps.length) FccLog.step(`Schritt ${next + 1}: ${v.steps[next].title}`);
      else FccLog.ok(`Ablauf abgeschlossen: ${v.heading}`);
      return { ...v, current: next };
    });
    refreshKeepalive();
  };

  // ---------- Statusanzeige ----------
  const statusColor = keepaliveOn || mode === "FCC" ? theme.statusGo : mode === "CE" ? theme.primary : theme.textTertiary;
  const statusText = keepaliveOn ? "FCC aktiv (hält)" : mode === "FCC" ? "FCC aktiv" : mode === "CE" ? "CE" : "bereit";

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.hTitle, { color: theme.text }]}>FCC-Tool</Text>
        <View style={{ flex: 1 }} />
        <View style={[styles.pill, { borderColor: statusColor, backgroundColor: theme.backgroundDefault }]}>
          <Text style={{ color: statusColor, fontWeight: "700", fontSize: 13 }}>{statusText}</Text>
        </View>
      </View>

      <View style={styles.main}>
        <View style={styles.left}>
          {view.kind === "home" && <HomeView theme={theme} onDrone={() => setView({ kind: "droneMenu" })} onGoggle={() => setView({ kind: "goggleMenu" })} />}
          {view.kind === "droneMenu" && (
            <ActionMenu
              theme={theme}
              heading="Fluggerät an dieser Fernsteuerung"
              sub="z. B. Air 3S – direkt über die Fernsteuerung."
              image={rcImage}
              ceLabel="CE wiederherstellen"
              onBack={() => setView({ kind: "home" })}
              onFcc={() => startWizard("Fluggerät an dieser Fernsteuerung", droneFccWizard(ctx))}
              onCe={() => startWizard("CE wiederherstellen", droneCeWizard(ctx))}
            />
          )}
          {view.kind === "goggleMenu" && (
            <ActionMenu
              theme={theme}
              heading="Fluggerät an Goggle"
              sub="z. B. Avata 2 – über eine Datei auf der SD-Karte der Goggle."
              image={goggleImage}
              ceLabel="FCC rückgängig (Datei entfernen)"
              onBack={() => setView({ kind: "home" })}
              onFcc={() => startWizard("Fluggerät an Goggle", goggleFccWizard(ctx))}
              onCe={() => startWizard("FCC rückgängig (Goggle)", goggleCeWizard(ctx))}
            />
          )}
          {view.kind === "wizard" && (
            <WizardView theme={theme} state={view} onBack={() => setView({ kind: "home" })} onHome={() => setView({ kind: "home" })} advance={advance} />
          )}
        </View>
        <View style={styles.log}>
          <FccLogPanel />
        </View>
      </View>
    </View>
  );
}

type Theme = ReturnType<typeof useTheme>["theme"];

function ModeButton({ theme, title, subtitle, accent, image, onPress }: { theme: Theme; title: string; subtitle?: string; accent: string; image?: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.modeBtn, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
      {image && <Image source={image} resizeMode="contain" style={styles.modeImg} />}
      <Text style={[styles.modeTitle, { color: accent }]}>{title}</Text>
      {subtitle ? <Text style={[styles.modeSub, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
    </Pressable>
  );
}

function HomeView({ theme, onDrone, onGoggle }: { theme: Theme; onDrone: () => void; onGoggle: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      <ModeButton theme={theme} title="Fluggerät an dieser Fernsteuerung" accent={theme.statusGo} image={rcImage} onPress={onDrone} />
      <View style={{ height: 12 }} />
      <ModeButton theme={theme} title="Fluggerät an Goggle" accent={theme.primary} image={goggleImage} onPress={onGoggle} />
    </View>
  );
}

function BackRow({ theme, title, onBack, right }: { theme: Theme; title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
      <Pressable onPress={onBack} style={[styles.smallBtn, { backgroundColor: theme.backgroundTertiary, borderColor: theme.border }]}>
        <Text style={{ color: theme.text, fontSize: 13 }}>‹ Zurück</Text>
      </Pressable>
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700", marginLeft: 10, flex: 1 }} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

function ActionMenu({ theme, heading, sub, image, ceLabel, onBack, onFcc, onCe }: { theme: Theme; heading: string; sub: string; image: number; ceLabel: string; onBack: () => void; onFcc: () => void; onCe: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      <BackRow theme={theme} title={heading} onBack={onBack} />
      <Text style={{ color: theme.textSecondary, fontSize: 13, marginBottom: 8 }}>{sub}</Text>
      <Image source={image} resizeMode="contain" style={{ height: 96, alignSelf: "center", marginBottom: 10 }} />
      <ModeButton theme={theme} title="FCC aktivieren" subtitle="Reichweite erhöhen (FCC)" accent={theme.statusGo} onPress={onFcc} />
      <View style={{ height: 12 }} />
      <ModeButton theme={theme} title={ceLabel} subtitle="Zurück in den Auslieferungszustand (CE)" accent={theme.statusCaution} onPress={onCe} />
    </View>
  );
}

function WizardView({ theme, state, onBack, onHome, advance }: { theme: Theme; state: Extract<ViewState, { kind: "wizard" }>; onBack: () => void; onHome: () => void; advance: () => void }) {
  const { heading, steps, current } = state;
  const done = current >= steps.length;
  const step = done ? null : steps[current];
  return (
    <View style={{ flex: 1 }}>
      <BackRow theme={theme} title={heading} onBack={onBack} right={<Text style={{ color: theme.textSecondary, fontSize: 12 }}>{`Schritt ${Math.min(current + 1, steps.length)}/${steps.length}`}</Text>} />
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
        {steps.map((_, i) => (
          <React.Fragment key={i}>
            <Text style={{ color: i < current ? theme.statusGo : i === current ? theme.primary : theme.textTertiary, fontWeight: "700", fontSize: 16 }}>
              {i < current ? "✓" : i === current ? "●" : "○"}
            </Text>
            {i < steps.length - 1 && <Text style={{ color: theme.border }}> ─ </Text>}
          </React.Fragment>
        ))}
      </View>
      <ScrollView style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
        {step ? (
          <>
            <Text style={{ color: theme.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1 }}>SCHRITT {current + 1}</Text>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginTop: 4 }}>{step.title}</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 20 }}>{step.desc}</Text>
            <BigButton theme={theme} label={step.primary} bg={theme.primary} onPress={() => step.run(advance)} />
            {step.secondary ? (
              <BigButton
                theme={theme}
                label={step.secondary.label}
                bg={step.secondary.big ? theme.backgroundTertiary : undefined}
                outline={!step.secondary.big}
                onPress={() => step.secondary!.run(advance)}
              />
            ) : null}
          </>
        ) : (
          <BigButton theme={theme} label="Fertig" bg={theme.statusGo} onPress={onHome} />
        )}
      </ScrollView>
    </View>
  );
}

function BigButton({ theme, label, bg, outline, onPress }: { theme: Theme; label: string; bg?: string; outline?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        marginTop: 12,
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 16,
        alignItems: "center",
        backgroundColor: outline ? "transparent" : bg ?? theme.primary,
        borderWidth: outline ? 1 : 0,
        borderColor: theme.border,
      }}
    >
      <Text style={{ color: outline ? theme.text : theme.buttonText, fontSize: 16, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  hTitle: { fontSize: 20, fontWeight: "700" },
  pill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  main: { flex: 1, flexDirection: "row" },
  left: { flex: 1.1 },
  log: { flex: 1, marginLeft: 12 },
  modeBtn: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 16, alignItems: "center", justifyContent: "center" },
  modeImg: { height: 84, width: "100%", marginBottom: 8 },
  modeTitle: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  modeSub: { fontSize: 13, textAlign: "center", marginTop: 4 },
  card: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 4 },
  smallBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
});
