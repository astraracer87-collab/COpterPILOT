import { openLink } from "@/lib/webBrowser";
import React from "react";
import { View, Text, Pressable, Linking, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { CtrAirport, getCtrHeightStepLines, getCtrCategoryLabel, getCtrGeometryHint } from "@/lib/ctrData";

interface CtrInfoCardProps {
  ctr: CtrAirport;
  onClose: () => void;
  bottomInset?: number;
}

export default function CtrInfoCard({ ctr, onClose, bottomInset = 0 }: CtrInfoCardProps) {
  return (
    <View
      style={[styles.overlay, bottomInset > 0 ? { paddingBottom: 16 + bottomInset } : null]}
      pointerEvents="box-none"
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>CTR {ctr.name} ({ctr.icao})</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={16} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
        <Text style={styles.sub}>{getCtrCategoryLabel(ctr.category)}</Text>
        {ctr.towerFrequency ? (
          <Text style={styles.freq}>TWR {ctr.towerFrequency} MHz</Text>
        ) : null}
        {ctr.avInfo ? (
          <View style={styles.steps}>
            {getCtrHeightStepLines(ctr.avInfo).map((line, i) => (
              <Text key={i} style={styles.stepLine}>{line}</Text>
            ))}
          </View>
        ) : null}
        {getCtrGeometryHint(ctr.avInfo) ? (
          <Text style={styles.hint}>{getCtrGeometryHint(ctr.avInfo)}</Text>
        ) : null}
        <Pressable
          onPress={() => { openLink(`tel:${ctr.towerPhone.replace(/\s/g, "")}`).catch(() => {}); }}
          style={styles.callBtn}
          testID={`ctr-info-call-${ctr.icao}`}
        >
          <Feather name="phone" size={15} color="#FFFFFF" />
          <Text style={styles.callText}>{ctr.towerPhone}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 16,
    zIndex: 300,
  } as any,
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  } as any,
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 220,
    maxWidth: 300,
    backgroundColor: "rgba(20,30,48,0.96)",
    borderWidth: 1.5,
    borderColor: "rgba(255,149,0,0.55)",
    ...(Platform.OS === "ios" ? { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8 } : { elevation: 8 }),
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    gap: 8,
    marginBottom: 2,
  } as any,
  title: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    flex: 1,
  },
  sub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 6,
  },
  freq: {
    color: "#4A90D9",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  steps: {
    gap: 3,
    marginBottom: 6,
  } as any,
  stepLine: {
    color: "#C8D0E0",
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 15,
  },
  hint: {
    color: "rgba(255,180,100,0.85)",
    fontSize: 10,
    fontWeight: "500",
    lineHeight: 14,
    marginBottom: 8,
  },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "#FF3B30",
  } as any,
  callText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
});
