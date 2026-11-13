import React, { useState, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, Dimensions, StatusBar, Modal, useWindowDimensions } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import Svg, { Rect, Text as SvgText, G, Circle, Path, Line } from "react-native-svg";
import QRCode from "react-native-qrcode-svg";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import {
  PilotProfile,
  getPilotProfile,
  isLicenseComplete,
} from "@/lib/storage";

const CARD_ASPECT_RATIO = 1.586;

function EASALogo({ size = 60 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.7} viewBox="0 0 120 84">
      <G>
        <Path d="M5 10 L25 5 L45 8 L35 20 L15 18 Z" fill="#003399" opacity={0.8} />
        <Path d="M8 15 L28 10 L48 13 L38 25 L18 23 Z" fill="#003399" opacity={0.6} />
        <SvgText x="0" y="45" fontSize="22" fontWeight="bold" fill="#003399">EASA</SvgText>
        <SvgText x="0" y="58" fontSize="6" fill="#666">European Union Aviation</SvgText>
        <SvgText x="0" y="66" fontSize="6" fill="#666">Safety Agency</SvgText>
      </G>
    </Svg>
  );
}

function LBALogo({ size = 50 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.6} viewBox="0 0 80 48">
      <G>
        <Path d="M10 15 Q40 0 70 15" stroke="#C53030" strokeWidth="2.5" fill="none" />
        <Path d="M15 20 Q40 8 65 20" stroke="#C53030" strokeWidth="1.5" fill="none" />
        <SvgText x="8" y="38" fontSize="20" fontWeight="bold" fill="#C53030" fontStyle="italic">LBA</SvgText>
      </G>
    </Svg>
  );
}

function EUFlag({ size = 50 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.7} viewBox="0 0 80 56">
      <Rect x="0" y="0" width="80" height="56" fill="#003399" rx="4" />
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 30 - 90) * (Math.PI / 180);
        const cx = 40 + 18 * Math.cos(angle);
        const cy = 24 + 18 * Math.sin(angle);
        return (
          <G key={i}>
            <Path
              d={`M${cx} ${cy - 4} L${cx + 1.5} ${cy - 1.2} L${cx + 4} ${cy - 1.2} L${cx + 2} ${cy + 0.8} L${cx + 2.8} ${cy + 3.6} L${cx} ${cy + 2} L${cx - 2.8} ${cy + 3.6} L${cx - 2} ${cy + 0.8} L${cx - 4} ${cy - 1.2} L${cx - 1.5} ${cy - 1.2} Z`}
              fill="#FFD700"
            />
          </G>
        );
      })}
      <SvgText x="36" y="30" fontSize="14" fontWeight="bold" fill="#FFFFFF">D</SvgText>
    </Svg>
  );
}

function DroneGraphic({ size = 100 }: { size?: number }) {
  const s = size;
  return (
    <Svg width={s} height={s * 0.7} viewBox="0 0 140 100">
      <G>
        <Line x1="30" y1="35" x2="70" y2="50" stroke="#4A5568" strokeWidth="3" />
        <Line x1="110" y1="35" x2="70" y2="50" stroke="#4A5568" strokeWidth="3" />
        <Line x1="30" y1="65" x2="70" y2="50" stroke="#4A5568" strokeWidth="3" />
        <Line x1="110" y1="65" x2="70" y2="50" stroke="#4A5568" strokeWidth="3" />
        <Circle cx="70" cy="50" r="12" fill="#2B6CB0" />
        <Circle cx="70" cy="50" r="6" fill="#3182CE" />
        <Circle cx="70" cy="50" r="3" fill="#63B3ED" />
        <G>
          <Path d="M20 35 Q30 25 40 35 Q30 30 20 35" fill="#2D3748" />
          <Circle cx="30" cy="35" r="4" fill="#4A5568" />
        </G>
        <G>
          <Path d="M100 35 Q110 25 120 35 Q110 30 100 35" fill="#2D3748" />
          <Circle cx="110" cy="35" r="4" fill="#4A5568" />
        </G>
        <G>
          <Path d="M20 65 Q30 55 40 65 Q30 60 20 65" fill="#2D3748" />
          <Circle cx="30" cy="65" r="4" fill="#4A5568" />
        </G>
        <G>
          <Path d="M100 65 Q110 55 120 65 Q110 60 100 65" fill="#2D3748" />
          <Circle cx="110" cy="65" r="4" fill="#4A5568" />
        </G>
      </G>
    </Svg>
  );
}

function CategoryBadge({ label, color = "#C53030" }: { label: string; color?: string }) {
  return (
    <View style={[badgeStyles.container, { backgroundColor: color }]}>
      <ThemedText style={badgeStyles.label}>{label}</ThemedText>
      <ThemedText style={badgeStyles.sub}>OPEN SUB</ThemedText>
      <ThemedText style={badgeStyles.sub}>CATEGORY</ThemedText>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
    minWidth: 60,
    marginBottom: 6,
  },
  label: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  sub: {
    color: "#FFFFFF",
    fontSize: 7,
    fontWeight: "500",
    letterSpacing: 0.5,
  },
});

interface LicenseCardProps {
  type: "A1A3" | "A2";
  profile: PilotProfile;
  cardWidth: number;
}

function LicenseCard({ type, profile, cardWidth }: LicenseCardProps) {
  const details = type === "A1A3" ? profile.licenseA1A3Details : profile.licenseA2Details;
  const cardHeight = cardWidth / CARD_ASPECT_RATIO;

  const isA2 = type === "A2";
  const titleDE = isA2
    ? "Fernpiloten-Zeugnis"
    : "Nachweis \u00FCber den Abschluss eines Online-Lehrgangs";
  const titleEN = isA2
    ? "REMOTE PILOT CERTIFICATE OF COMPETENCY"
    : "PROOF OF COMPLETION OF THE ONLINE TRAINING";

  const qrData = JSON.stringify({
    type: isA2 ? "A2 Remote Pilot Certificate" : "A1/A3 Proof of Completion",
    firstName: details.firstName,
    lastName: details.lastName,
    identificationNumber: details.identificationNumber,
    expirationDate: details.expirationDate,
    issuer: "LBA / EASA",
  });

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
    return dateStr;
  };

  return (
    <View style={[cardStyles.card, { width: cardWidth, height: cardHeight }]}>
      <View style={cardStyles.topRow}>
        <EASALogo size={cardWidth * 0.18} />
        <LBALogo size={cardWidth * 0.15} />
      </View>

      <View style={cardStyles.middleRow}>
        <EUFlag size={cardWidth * 0.13} />
        <DroneGraphic size={cardWidth * 0.28} />
        <View style={cardStyles.badgeColumn}>
          <CategoryBadge label="A1/A3" color="#C53030" />
          {isA2 ? <CategoryBadge label="A2" color="#C53030" /> : null}
        </View>
      </View>

      <View style={cardStyles.titleSection}>
        <ThemedText style={[cardStyles.titleDE, { fontSize: cardWidth * 0.035 }]}>
          {titleDE}
        </ThemedText>
        <ThemedText style={[cardStyles.titleEN, { fontSize: cardWidth * 0.02 }]}>
          {titleEN}
        </ThemedText>
      </View>

      <View style={[cardStyles.separator, { marginHorizontal: cardWidth * 0.04 }]} />

      <View style={[cardStyles.dataSection, { paddingHorizontal: cardWidth * 0.04 }]}>
        <View style={cardStyles.dataRow}>
          <View style={cardStyles.dataField}>
            <View style={cardStyles.labelRow}>
              <View style={cardStyles.labelDot} />
              <ThemedText style={[cardStyles.fieldLabel, { fontSize: cardWidth * 0.018 }]}>
                Name (First name)
              </ThemedText>
            </View>
            <ThemedText style={[cardStyles.fieldValue, { fontSize: cardWidth * 0.032 }]}>
              {details.firstName}
            </ThemedText>
          </View>
          <View style={cardStyles.dataField}>
            <ThemedText style={[cardStyles.fieldLabel, { fontSize: cardWidth * 0.018 }]}>
              Nachname (Last name)
            </ThemedText>
            <ThemedText style={[cardStyles.fieldValue, { fontSize: cardWidth * 0.032 }]}>
              {details.lastName}
            </ThemedText>
          </View>
        </View>
        <View style={cardStyles.dataRow}>
          <View style={cardStyles.dataField}>
            <ThemedText style={[cardStyles.fieldLabel, { fontSize: cardWidth * 0.018 }]}>
              Identifizierungsnummer (Identification number)
            </ThemedText>
            <ThemedText style={[cardStyles.fieldValue, { fontSize: cardWidth * 0.032 }]}>
              {details.identificationNumber}
            </ThemedText>
          </View>
          <View style={cardStyles.dataField}>
            <ThemedText style={[cardStyles.fieldLabel, { fontSize: cardWidth * 0.018 }]}>
              {`G\u00FCltig bis (Expiration date)`}
            </ThemedText>
            <ThemedText style={[cardStyles.fieldValue, { fontSize: cardWidth * 0.032 }]}>
              {formatDate(details.expirationDate)}
            </ThemedText>
          </View>
        </View>
      </View>

      <View style={[cardStyles.qrContainer, { bottom: cardHeight * 0.06, right: cardWidth * 0.04 }]}>
        <QRCode value={qrData} size={cardWidth * 0.12} />
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  middleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: 4,
  },
  badgeColumn: {
    alignItems: "flex-end",
  },
  titleSection: {
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: 4,
  },
  titleDE: {
    fontWeight: "700",
    color: "#1A202C",
    textAlign: "center",
  },
  titleEN: {
    fontWeight: "500",
    color: "#4A5568",
    textAlign: "center",
    letterSpacing: 1,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginVertical: 8,
  },
  dataSection: {
    flex: 1,
  },
  dataRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  dataField: {
    flex: 1,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  labelDot: {
    width: 8,
    height: 8,
    backgroundColor: "#C53030",
    borderRadius: 1,
  },
  fieldLabel: {
    color: "#718096",
    fontWeight: "400",
  },
  fieldValue: {
    color: "#1A202C",
    fontWeight: "700",
    marginTop: 1,
  },
  qrContainer: {
    position: "absolute",
  },
});

function FullscreenCardModal({
  visible,
  onClose,
  type,
  profile,
}: {
  visible: boolean;
  onClose: () => void;
  type: "A1A3" | "A2";
  profile: PilotProfile;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isLandscape = width > height;
  const availableWidth = width - insets.left - insets.right - Spacing.lg * 2;
  const availableHeight = height - insets.top - insets.bottom - 80;
  const maxCardWidth = Math.min(availableWidth, availableHeight * CARD_ASPECT_RATIO);
  const cardWidth = isLandscape
    ? Math.min(availableWidth, availableHeight * CARD_ASPECT_RATIO)
    : maxCardWidth;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[fullscreenStyles.backdrop]}>
        <StatusBar hidden />
        <Pressable style={fullscreenStyles.closeButton} onPress={onClose}>
          <Feather name="x" size={28} color="#FFFFFF" />
        </Pressable>
        <View style={fullscreenStyles.cardWrapper}>
          <LicenseCard type={type} profile={profile} cardWidth={cardWidth} />
        </View>
      </View>
    </Modal>
  );
}

const fullscreenStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  cardWrapper: {
    justifyContent: "center",
    alignItems: "center",
  },
});

export default function PilotLicenseCardScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [fullscreenCard, setFullscreenCard] = useState<"A1A3" | "A2" | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPilotProfile().then(setProfile);
    }, [])
  );

  if (!profile) return null;

  const screenWidth = Dimensions.get("window").width;
  const cardWidth = screenWidth - Spacing.lg * 2;

  const hasA1A3 = profile.licenseA1A3 && isLicenseComplete(profile.licenseA1A3Details);
  const hasA2 = profile.licenseA2 && isLicenseComplete(profile.licenseA2Details);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
      >
        {hasA1A3 ? (
          <View style={styles.cardSection}>
            <View style={styles.cardHeader}>
              <ThemedText style={styles.cardLabel}>EU-Kompetenznachweis A1/A3</ThemedText>
              <Pressable
                onPress={() => setFullscreenCard("A1A3")}
                style={[styles.showButton, { backgroundColor: theme.primary + "10" }]}
              >
                <Feather name="maximize-2" size={16} color={theme.primary} />
                <ThemedText style={[styles.showButtonText, { color: theme.primary }]}>
                  Vorzeigen
                </ThemedText>
              </Pressable>
            </View>
            <LicenseCard type="A1A3" profile={profile} cardWidth={cardWidth} />
          </View>
        ) : null}

        {hasA2 ? (
          <View style={styles.cardSection}>
            <View style={styles.cardHeader}>
              <ThemedText style={styles.cardLabel}>Fernpiloten-Zeugnis A2</ThemedText>
              <Pressable
                onPress={() => setFullscreenCard("A2")}
                style={[styles.showButton, { backgroundColor: theme.primary + "10" }]}
              >
                <Feather name="maximize-2" size={16} color={theme.primary} />
                <ThemedText style={[styles.showButtonText, { color: theme.primary }]}>
                  Vorzeigen
                </ThemedText>
              </Pressable>
            </View>
            <LicenseCard type="A2" profile={profile} cardWidth={cardWidth} />
          </View>
        ) : null}

        {!hasA1A3 && !hasA2 ? (
          <View style={styles.emptyContainer}>
            <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
              Keine vollständig ausgefüllte Lizenz vorhanden. Bitte ergänze die Lizenzdetails im Pilotenprofil.
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>

      {fullscreenCard != null ? (
        <FullscreenCardModal
          visible={true}
          onClose={() => setFullscreenCard(null)}
          type={fullscreenCard}
          profile={profile}
        />
      ) : null}
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
  cardSection: {
    marginBottom: Spacing.xl,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  cardLabel: {
    ...Typography.h4,
  },
  showButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 8,
  },
  showButtonText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: Spacing["3xl"],
  },
  emptyText: {
    ...Typography.body,
    textAlign: "center",
  },
});
