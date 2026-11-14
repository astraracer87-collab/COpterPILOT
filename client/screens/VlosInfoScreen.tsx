import React, { useMemo } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Svg, { Circle, Line, Polygon, Text as SvgText } from "react-native-svg";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { computeVlosM, formatMeters, type AlosKind } from "@/lib/vlos";

interface Example {
  label: string;
  cd: number;
  kind: AlosKind;
  groundVisibilityM: number;
  note?: string;
}

const EXAMPLES: Example[] = [
  { label: "DJI Mini 4 Pro (Multicopter)", cd: 0.305, kind: "multirotor", groundVisibilityM: 5000 },
  { label: "DJI Mavic 3 (Multicopter)", cd: 0.38, kind: "multirotor", groundVisibilityM: 5000 },
  { label: "Großer Multicopter", cd: 1.0, kind: "multirotor", groundVisibilityM: 5000 },
  {
    label: "Multicopter bei schlechter Sicht",
    cd: 1.5,
    kind: "multirotor",
    groundVisibilityM: 1500,
    note: "Bodensicht nur 1,5 km — hier begrenzt die DLOS.",
  },
  { label: "Flächenflieger", cd: 2.0, kind: "fixed_wing", groundVisibilityM: 5000 },
];

export default function VlosInfoScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const examples = useMemo(
    () =>
      EXAMPLES.map((ex) => ({
        ...ex,
        result: computeVlosM(ex.cd, { kind: ex.kind, groundVisibilityM: ex.groundVisibilityM }),
      })),
    [],
  );

  const goColor = theme.statusGo;
  const noGoColor = theme.statusNoGo;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing["3xl"] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText style={styles.intro}>
          In der offenen Kategorie ist der Betrieb ausschließlich in direkter Sicht
          (VLOS — Visual Line of Sight) erlaubt. Die maximale Entfernung zwischen dir
          und der Drohne ist die VLOS-Grenze. Alles darüber hinaus gilt als BVLOS und
          ist in der offenen Kategorie nicht zulässig.
        </ThemedText>

        <Card style={styles.diagramCard}>
          <Svg width="100%" height={210} viewBox="0 0 320 210">
            <Circle cx={160} cy={105} r={96} fill={noGoColor} opacity={0.08} />
            <Circle
              cx={160}
              cy={105}
              r={96}
              fill="none"
              stroke={noGoColor}
              strokeWidth={1.5}
              strokeDasharray="6 5"
              opacity={0.6}
            />
            <Circle cx={160} cy={105} r={70} fill={goColor} opacity={0.16} />
            <Circle cx={160} cy={105} r={70} fill="none" stroke={goColor} strokeWidth={2} />
            <Line x1={160} y1={105} x2={229} y2={105} stroke={goColor} strokeWidth={2} />
            <Polygon points="229,105 221,101 221,109" fill={goColor} />
            <Circle cx={160} cy={105} r={5.5} fill={theme.primary} />
            <SvgText x={160} y={90} fill={theme.text} fontSize={11} fontWeight="700" textAnchor="middle">
              Pilot
            </SvgText>
            <SvgText x={194} y={99} fill={goColor} fontSize={10} fontWeight="700" textAnchor="middle">
              VLOS-Grenze
            </SvgText>
            <SvgText x={160} y={162} fill={goColor} fontSize={11} fontWeight="700" textAnchor="middle">
              VLOS — erlaubt
            </SvgText>
            <SvgText x={160} y={30} fill={noGoColor} fontSize={11} fontWeight="700" textAnchor="middle">
              BVLOS — nicht erlaubt
            </SvgText>
          </Svg>
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>SO WIRD GERECHNET</ThemedText>

        <Card style={styles.formulaCard}>
          <View style={styles.formulaRow}>
            <ThemedText style={[styles.formulaName, { color: theme.text }]}>ALOS</ThemedText>
            <ThemedText style={[styles.formulaDesc, { color: theme.textSecondary }]}>
              Attitude Line of Sight — bis hierher erkennst du Lage und Flugrichtung
              der Drohne sicher. Sie hängt von der charakteristischen Dimension (CD)
              ab, also der größten Ausdehnung der Drohne.
            </ThemedText>
          </View>
          <View style={[styles.formulaBox, { backgroundColor: theme.backgroundSecondary }]}>
            <ThemedText style={[styles.formulaMath, { color: theme.text }]}>
              Multicopter: ALOS = 327 · CD + 20 m
            </ThemedText>
            <ThemedText style={[styles.formulaMath, { color: theme.text }]}>
              Flächenflieger: ALOS = 490 · CD + 30 m
            </ThemedText>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View style={styles.formulaRow}>
            <ThemedText style={[styles.formulaName, { color: theme.text }]}>DLOS</ThemedText>
            <ThemedText style={[styles.formulaDesc, { color: theme.textSecondary }]}>
              Detection Line of Sight — bis hierher erkennst du andere Luftfahrzeuge
              früh genug, um auszuweichen. Sie hängt von der Bodensicht (GV) ab.
            </ThemedText>
          </View>
          <View style={[styles.formulaBox, { backgroundColor: theme.backgroundSecondary }]}>
            <ThemedText style={[styles.formulaMath, { color: theme.text }]}>DLOS = 0,3 · GV</ThemedText>
            <ThemedText style={[styles.formulaMath, { color: theme.textSecondary }]}>
              max. GV = 5 km  ⟶  DLOS max. = 1500 m
            </ThemedText>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View style={styles.formulaRow}>
            <ThemedText style={[styles.formulaName, { color: theme.primary }]}>VLOS</ThemedText>
            <ThemedText style={[styles.formulaDesc, { color: theme.textSecondary }]}>
              Die VLOS-Grenze ist der kleinere der beiden Werte — es zählt immer die
              zuerst erreichte Grenze.
            </ThemedText>
          </View>
          <View style={[styles.formulaBox, { backgroundColor: theme.primary + "14" }]}>
            <ThemedText style={[styles.formulaMath, { color: theme.primary, fontWeight: "700" }]}>
              VLOS-Grenze = min(ALOS, DLOS)
            </ThemedText>
          </View>
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>RECHENBEISPIELE</ThemedText>

        {examples.map((ex, i) => {
          const limitedByAlos = ex.result.limitedBy === "alos";
          return (
            <Card key={i} style={styles.exampleCard} testID={`vlos-example-${i}`}>
              <ThemedText style={[styles.exampleLabel, { color: theme.text }]}>{ex.label}</ThemedText>
              <ThemedText style={[styles.exampleMeta, { color: theme.textTertiary }]}>
                CD = {ex.cd.toFixed(2)} m · Bodensicht = {formatMeters(ex.groundVisibilityM)}
              </ThemedText>

              <View style={styles.exampleRow}>
                <View style={styles.exampleCell}>
                  <ThemedText style={[styles.cellLabel, { color: theme.textSecondary }]}>ALOS</ThemedText>
                  <ThemedText
                    style={[styles.cellValue, { color: limitedByAlos ? theme.primary : theme.text }]}
                  >
                    {formatMeters(ex.result.alosM)}
                  </ThemedText>
                </View>
                <View style={styles.exampleCell}>
                  <ThemedText style={[styles.cellLabel, { color: theme.textSecondary }]}>DLOS</ThemedText>
                  <ThemedText
                    style={[styles.cellValue, { color: !limitedByAlos ? theme.primary : theme.text }]}
                  >
                    {formatMeters(ex.result.dlosM)}
                  </ThemedText>
                </View>
                <View style={[styles.exampleCell, styles.exampleCellVlos, { borderLeftColor: theme.border }]}>
                  <ThemedText style={[styles.cellLabel, { color: theme.textSecondary }]}>VLOS-Grenze</ThemedText>
                  <ThemedText style={[styles.cellValue, styles.cellValueVlos, { color: goColor }]}>
                    {formatMeters(ex.result.vlosM)}
                  </ThemedText>
                </View>
              </View>

              <ThemedText style={[styles.exampleNote, { color: theme.textSecondary }]}>
                {ex.note ? `${ex.note} ` : ""}
                Begrenzt durch {limitedByAlos ? "ALOS" : "DLOS"}.
              </ThemedText>
            </Card>
          );
        })}

        <Card style={[styles.hintCard, { borderLeftColor: theme.primary }]}>
          <View style={styles.hintHeader}>
            <Feather name="info" size={16} color={theme.primary} />
            <ThemedText style={[styles.hintTitle, { color: theme.primary }]}>Gut zu wissen</ThemedText>
          </View>
          <ThemedText style={[styles.hintText, { color: theme.textSecondary }]}>
            Die in den Drohnen-Presets hinterlegten CD-Werte sind bewusst ohne
            drehende Propeller gerechnet (nur Frame/Tragarme; bei Cinewhoops zählt
            der äußere Schutzkäfig). Die berechneten Sichtweiten fallen dadurch etwas
            konservativer aus als mit dem LBA-Wert „inkl. Propeller". Verschlechtert
            sich die Bodensicht, sinkt die DLOS — dann kann die VLOS-Grenze kleiner
            werden als bei guter Sicht.
          </ThemedText>
        </Card>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  intro: { fontSize: 14, lineHeight: 21, marginBottom: Spacing.lg },
  diagramCard: { paddingVertical: Spacing.md, marginBottom: Spacing.lg, alignItems: "center" },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },
  formulaCard: { padding: Spacing.md, marginBottom: Spacing.lg },
  formulaRow: { marginBottom: Spacing.sm },
  formulaName: { fontSize: 15, fontWeight: "800", marginBottom: 4 },
  formulaDesc: { fontSize: 13, lineHeight: 19 },
  formulaBox: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 4 },
  formulaMath: { fontSize: 13, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.md },
  exampleCard: { padding: Spacing.md, marginBottom: Spacing.sm },
  exampleLabel: { fontSize: 14, fontWeight: "700" },
  exampleMeta: { fontSize: 11, marginTop: 2, marginBottom: Spacing.sm },
  exampleRow: { flexDirection: "row", alignItems: "stretch" },
  exampleCell: { flex: 1, alignItems: "center" },
  exampleCellVlos: { borderLeftWidth: StyleSheet.hairlineWidth },
  cellLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  cellValue: { fontSize: 15, fontWeight: "700", marginTop: 3 },
  cellValueVlos: { fontSize: 17, fontWeight: "800" },
  exampleNote: { fontSize: 12, lineHeight: 17, marginTop: Spacing.sm },
  hintCard: { padding: Spacing.md, borderLeftWidth: 3, marginTop: Spacing.sm },
  hintHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  hintTitle: { fontSize: 14, fontWeight: "700" },
  hintText: { fontSize: 13, lineHeight: 19 },
});
