import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  StatusBar,
  Modal,
  useWindowDimensions,
  ImageBackground,
  Text,
  ActivityIndicator,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import {
  PilotProfile,
  getPilotProfile,
  isLicenseComplete,
  LICENSE_COUNTRIES,
} from "@/lib/storage";

import a1a3Template from "../assets/images/license-a1a3-de-template.png";
import a2Template from "../assets/images/license-a2-template.png";
import stsTemplate from "../assets/images/license-sts-de-template.png";

// Pixel-Maße der Vorlagen (Originalbilder), bestimmen das Seitenverhältnis.
const A1A3_RATIO = 1491 / 1055; // ≈ 1.414 — neue EASA/LBA A1/A3-Vorlage (DE)
const A2_RATIO = 3509 / 2480; // ≈ 1.415 — neue EASA/LBA A2-Vorlage IMG_7518
const STS_RATIO = 1492 / 1054; // ≈ 1.416 — neue EASA/LBA STS-Vorlage (DE)
const GENERIC_RATIO = A1A3_RATIO; // generische EASA-EU-Karte nutzt das Querformat

/**
 * Welche Darstellung bekommt ein Ausstellungsland?
 *   "de-image"     → echte LBA/EASA-Bildvorlage (nur Deutschland)
 *   "easa-generic" → nativ gezeichnete, harmonisierte EU-Karte (alle EASA-Länder)
 *   "none"         → keine Vorlage hinterlegt → EmptyCountryCard
 *
 * Die A1/A3- und A2-Kompetenznachweise sind EU-weit nach VO 2019/947
 * harmonisiert; sämtliche Länder in LICENSE_COUNTRIES (EU + EWR + CH, die
 * die EU-Drohnenregeln übernommen haben) nutzen dasselbe Formular, nur die
 * ausstellende Behörde unterscheidet sich. Deshalb können wir für alle eine
 * generische EASA-Karte rendern statt einer leeren Platzhalterseite.
 */
type TemplateMode = "de-image" | "easa-generic" | "none";

const EASA_COUNTRY_CODES = new Set<string>(
  LICENSE_COUNTRIES.map((c) => c.code),
);

function getTemplateMode(country: string): TemplateMode {
  if (country === "DE") return "de-image";
  if (EASA_COUNTRY_CODES.has(country)) return "easa-generic";
  return "none";
}

function getCountryLabel(country: string): string {
  return LICENSE_COUNTRIES.find((c) => c.code === country)?.label || country;
}

/**
 * Ausstellende nationale Luftfahrt-/Drohnenbehörde je EASA-Land.
 *   abbr  → Kürzel, das als Behörden-Marke (statt des neutralen EU-Badges)
 *           auf der Karte erscheint
 *   name  → vollständiger Behördenname für die Fußzeile der Karte
 *   color → Marken-/Akzentfarbe der Behörde für die Chip-Darstellung
 *
 * Bewusst KEINE eingebetteten Original-Logos (Marken-/Urheberrecht) — wir
 * zeigen eine klar als App-Darstellung erkennbare Behörden-Marke. Länder ohne
 * Eintrag fallen auf das neutrale EU-Badge zurück.
 */
interface IssuingAuthority {
  abbr: string;
  name: string;
  color: string;
}

const ISSUING_AUTHORITIES: Record<string, IssuingAuthority> = {
  DE: { abbr: "LBA", name: "Luftfahrt-Bundesamt (LBA)", color: "#000000" },
  AT: { abbr: "Austro Control", name: "Austro Control GmbH", color: "#E2001A" },
  CH: { abbr: "BAZL", name: "Bundesamt f\u00FCr Zivilluftfahrt (BAZL/FOCA)", color: "#DA291C" },
  LI: { abbr: "BAZL", name: "Bundesamt f\u00FCr Zivilluftfahrt (BAZL/FOCA)", color: "#DA291C" },
  LU: { abbr: "DAC", name: "Direction de l'aviation civile (DAC)", color: "#00A1DE" },
  NL: { abbr: "ILT", name: "Inspectie Leefomgeving en Transport (ILT)", color: "#154273" },
  BE: { abbr: "BCAA", name: "Belgian Civil Aviation Authority (DGLV/BCAA)", color: "#1A3A6B" },
  FR: { abbr: "DGAC", name: "Direction g\u00E9n\u00E9rale de l'aviation civile (DGAC)", color: "#000091" },
  PL: { abbr: "ULC", name: "Urz\u0105d Lotnictwa Cywilnego (ULC)", color: "#DC143C" },
  CZ: { abbr: "\u00DACL", name: "\u00DA\u0159ad pro civiln\u00ED letectv\u00ED (\u00DACL)", color: "#11457E" },
  DK: { abbr: "TS", name: "Trafikstyrelsen", color: "#C8102E" },
  IT: { abbr: "ENAC", name: "Ente Nazionale per l'Aviazione Civile (ENAC)", color: "#003366" },
  ES: { abbr: "AESA", name: "Agencia Estatal de Seguridad A\u00E9rea (AESA)", color: "#C60B1E" },
  SE: { abbr: "TS", name: "Transportstyrelsen", color: "#006AA7" },
  PT: { abbr: "ANAC", name: "Autoridade Nacional da Avia\u00E7\u00E3o Civil (ANAC)", color: "#006600" },
  IE: { abbr: "IAA", name: "Irish Aviation Authority (IAA)", color: "#169B62" },
  GR: { abbr: "HCAA", name: "Hellenic Civil Aviation Authority (HCAA)", color: "#0D5EAF" },
  FI: { abbr: "Traficom", name: "Liikenne- ja viestint\u00E4virasto Traficom", color: "#003580" },
  NO: { abbr: "Luftfartstilsynet", name: "Luftfartstilsynet", color: "#BA0C2F" },
  IS: { abbr: "ICETRA", name: "Samg\u00F6ngustofa (ICETRA)", color: "#02529C" },
  HR: { abbr: "CCAA", name: "Hrvatska agencija za civilno zrakoplovstvo (CCAA)", color: "#FF0000" },
  BG: { abbr: "GD CAA", name: "\u0413\u043B\u0430\u0432\u043D\u0430 \u0434\u0438\u0440\u0435\u043A\u0446\u0438\u044F \u201E\u0413\u0440\u0430\u0436\u0434\u0430\u043D\u0441\u043A\u0430 \u0432\u044A\u0437\u0434\u0443\u0448\u043E\u043F\u043B\u0430\u0432\u0430\u0442\u0435\u043B\u043D\u0430 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F\u201C (GD CAA)", color: "#00966E" },
  RO: { abbr: "AACR", name: "Autoritatea Aeronautic\u0103 Civil\u0103 Rom\u00E2n\u0103 (AACR)", color: "#002B7F" },
  HU: { abbr: "L\u00E9g\u00FCgyi Hivatal", name: "K\u00F6zleked\u00E9si Hat\u00F3s\u00E1g \u2013 L\u00E9g\u00FCgyi Hivatal", color: "#CD2A3E" },
  SK: { abbr: "Dopravn\u00FD \u00FArad", name: "Dopravn\u00FD \u00FArad (Transport Authority SR)", color: "#0B4EA2" },
  SI: { abbr: "CAA", name: "Javna agencija za civilno letalstvo (CAA Slovenia)", color: "#005DA4" },
  LT: { abbr: "LTSA", name: "Lietuvos transporto saugos administracija (LTSA)", color: "#006A44" },
  LV: { abbr: "CAA", name: "Civil\u0101s avi\u0101cijas a\u0123ent\u016Bra (CAA Latvia)", color: "#9E3039" },
  EE: { abbr: "Transpordiamet", name: "Transpordiamet (Estonian Transport Administration)", color: "#0072CE" },
  CY: { abbr: "DCA", name: "Department of Civil Aviation (DCA Cyprus)", color: "#D57800" },
  MT: { abbr: "CAD", name: "Civil Aviation Directorate (Transport Malta)", color: "#CF142B" },
};

function getAuthority(country: string): IssuingAuthority | null {
  return ISSUING_AUTHORITIES[country] || null;
}

const TIER_TITLES: Record<
  LicenseTier,
  { de: string; en: string; badge: string }
> = {
  A1A3: {
    de: "Nachweis über den Abschluss eines Online-Lehrgangs",
    en: "Proof of completion of the online training",
    badge: "A1/A3",
  },
  A2: {
    de: "Fernpiloten-Zeugnis",
    en: "Remote pilot certificate of competency",
    badge: "A2",
  },
  STS: {
    de: "STS-Betriebsgenehmigung",
    en: "Standard Scenario Authorisation",
    badge: "STS",
  },
};

/**
 * Hierarchie der Drohnenlizenzen (höchste zuerst):
 *   STS > A2 > A1/A3
 * Es wird immer nur die HÖCHSTE vorhandene Lizenz als Karte angezeigt,
 * weil die höhere die niedrigeren mit abdeckt (A2 inkl. A1/A3,
 * STS-Betriebsgenehmigung deckt die Open-Kategorie ab).
 */
type LicenseTier = "STS" | "A2" | "A1A3";

interface LicenseFieldLayout {
  firstNameX: number;
  lastNameX: number;
  nameY: number;
  idX: number;
  dateX: number;
  idY: number;
  nameFontPct: number;
  idFontPct: number;
  qrX: number;
  qrY: number;
  qrSize: number;
}

interface LicenseCardProps {
  tier: LicenseTier;
  profile: PilotProfile;
  cardWidth: number;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return dateStr;
}

function getDetails(tier: LicenseTier, profile: PilotProfile) {
  if (tier === "A2") return profile.licenseA2Details;
  if (tier === "A1A3") return profile.licenseA1A3Details;
  return profile.licenseSTSDetails || profile.licenseA2Details || profile.licenseA1A3Details;
}

function getCountry(tier: LicenseTier, profile: PilotProfile): string {
  if (tier === "A2") return profile.licenseA2Details?.country || "DE";
  if (tier === "A1A3") return profile.licenseA1A3Details?.country || "DE";
  return profile.licenseSTSDetails?.country || "DE";
}

/**
 * Pixel-genau auf den Hintergrund-Vorlagen gemessene Overlay-Positionen.
 * Werte sind Prozentanteile (0..1) der Kartengröße, damit alles bei jeder
 * Display-Breite (Inline-Vorschau und Fullscreen) skaliert.
 */
const LAYOUTS: Record<LicenseTier, LicenseFieldLayout> = {
  A1A3: {
    // Neue EASA/LBA A1/A3-Vorlage (DE) 1491×1055 (Ratio ≈ 1.414).
    // Labels stehen unten: Vorname/Nachname-Zeile ≈ y 0.76, ID-/Datumszeile
    // ≈ y 0.84. Werte werden direkt unter die jeweiligen Labels gesetzt.
    // QR-Code in der freien weißen Fläche rechts (unter dem A1/A3-Badge).
    firstNameX: 0.036,
    lastNameX: 0.505,
    nameY: 0.760,
    idX: 0.036,
    dateX: 0.505,
    idY: 0.842,
    nameFontPct: 0.026,
    idFontPct: 0.026,
    qrX: 0.840,
    qrY: 0.780,
    qrSize: 0.120,
  },
  A2: {
    // Neue EASA/LBA A2-Vorlage (DE) 3509×2480 (Ratio ≈ 1.415), gleiches
    // Layout wie die A1/A3-Vorlage. Labels:
    //   Vorname/Nachname-Zeile   ≈ y 0.755 (label) → Wert ≈ y 0.78
    //   Ident.nr./Ablaufdatum    ≈ y 0.83 (label)  → Wert ≈ y 0.862
    // Vorname/Ident.nr. starten bei x ≈ 0.036, Nachname/Datum bei x ≈ 0.473.
    // QR-Code in der freien Fläche rechts unten (unter dem A2-Badge).
    firstNameX: 0.036,
    lastNameX: 0.505,
    nameY: 0.760,
    idX: 0.036,
    dateX: 0.505,
    idY: 0.842,
    nameFontPct: 0.026,
    idFontPct: 0.026,
    qrX: 0.840,
    qrY: 0.780,
    qrSize: 0.120,
  },
  // Neue EASA/LBA STS-Vorlage (DE) 1492×1054 (Ratio ≈ 1.416), gleiches Layout
  // wie A1/A3 + A2. Labels unten: Vorname/Nachname ≈ y 0.76, Ident.nr./Datum
  // ≈ y 0.84 — Werte direkt darunter. Drei Badges (A1/A3, A2, STS) stehen
  // gestapelt rechts (x ≈ 0.84), daher sitzt der QR-Code in der freien weißen
  // Fläche links daneben (rechts neben der Drohne, über dem Titel).
  STS: {
    firstNameX: 0.036,
    lastNameX: 0.505,
    nameY: 0.760,
    idX: 0.036,
    dateX: 0.505,
    idY: 0.842,
    nameFontPct: 0.026,
    idFontPct: 0.026,
    qrX: 0.660,
    qrY: 0.395,
    qrSize: 0.120,
  },
};

function getRatio(tier: LicenseTier): number {
  if (tier === "A2") return A2_RATIO;
  if (tier === "A1A3") return A1A3_RATIO;
  return STS_RATIO;
}

/**
 * Erzeugt den QR-Inhalt der Karte. Hat der Pilot den QR-Code seiner
 * physischen Lizenz eingescannt / einkopiert, rendern wir genau diesen Inhalt
 * — so zeigt die digitale Karte auf dieselbe Verifikationsseite wie das
 * Original. Sonst fällt sie auf unsere JSON-Repräsentation zurück.
 */
function buildQrData(
  tier: LicenseTier,
  profile: PilotProfile,
  details: { firstName: string; lastName: string; identificationNumber: string; expirationDate: string; qrCodeUrl?: string },
): string {
  const scannedQr = (details.qrCodeUrl || "").trim();
  if (scannedQr.length > 0) return scannedQr;
  return JSON.stringify({
    type:
      tier === "STS"
        ? "STS Operational Authorization"
        : tier === "A2"
          ? "A2 Remote Pilot Certificate"
          : "A1/A3 Proof of Completion",
    firstName: details.firstName,
    lastName: details.lastName,
    identificationNumber: profile.pilotId || details.identificationNumber,
    expirationDate: details.expirationDate,
    issuer: "EASA",
  });
}

function LicenseCard({ tier, profile, cardWidth }: LicenseCardProps) {
  const details = getDetails(tier, profile);
  const ratio = getRatio(tier);
  const cardHeight = cardWidth / ratio;
  const template =
    tier === "A2" ? a2Template : tier === "A1A3" ? a1a3Template : stsTemplate;

  const layout = LAYOUTS[tier];

  if (!details) return null;

  const qrData = buildQrData(tier, profile, details);

  const content = (
    <>
      {/* Vorname */}
      <Text
        numberOfLines={1}
        style={[
          cardStyles.value,
          {
            left: layout.firstNameX * cardWidth,
            top: layout.nameY * cardHeight,
            fontSize: layout.nameFontPct * cardWidth,
            width: (layout.lastNameX - layout.firstNameX - 0.01) * cardWidth,
          },
        ]}
      >
        {details.firstName}
      </Text>
      {/* Nachname */}
      <Text
        numberOfLines={1}
        style={[
          cardStyles.value,
          {
            left: layout.lastNameX * cardWidth,
            top: layout.nameY * cardHeight,
            fontSize: layout.nameFontPct * cardWidth,
            width: (layout.qrX - layout.lastNameX - 0.01) * cardWidth,
          },
        ]}
      >
        {details.lastName}
      </Text>
      {/* Identifizierungsnummer */}
      <Text
        numberOfLines={1}
        style={[
          cardStyles.value,
          {
            left: layout.idX * cardWidth,
            top: layout.idY * cardHeight,
            fontSize: layout.idFontPct * cardWidth,
            width: (layout.dateX - layout.idX - 0.01) * cardWidth,
          },
        ]}
      >
        {profile.pilotId || details.identificationNumber}
      </Text>
      {/* Gültigkeits-/Ablaufdatum */}
      <Text
        numberOfLines={1}
        style={[
          cardStyles.value,
          {
            left: layout.dateX * cardWidth,
            top: layout.idY * cardHeight,
            fontSize: layout.idFontPct * cardWidth,
            width: (layout.qrX - layout.dateX - 0.01) * cardWidth,
          },
        ]}
      >
        {formatDate(details.expirationDate)}
      </Text>
      {/* QR-Code */}
      <View
        style={[
          cardStyles.qrContainer,
          {
            left: layout.qrX * cardWidth,
            top: layout.qrY * cardHeight,
            padding: cardWidth * 0.006,
          },
        ]}
      >
        <QRCode value={qrData} size={layout.qrSize * cardWidth} />
      </View>
    </>
  );

  return (
    <View style={[cardStyles.card, { width: cardWidth, height: cardHeight }]}>
      {template ? (
        <ImageBackground
          source={template}
          style={{ width: cardWidth, height: cardHeight }}
          resizeMode="cover"
        >
          {content}
        </ImageBackground>
      ) : (
        // Defensiver Fallback: alle drei Tiers (A1/A3, A2, STS) haben eine
        // Bildvorlage, daher wird dieser Zweig im Normalfall nicht erreicht.
        <View
          style={[
            cardStyles.placeholderCard,
            { width: cardWidth, height: cardHeight },
          ]}
        >
          <Text style={cardStyles.placeholderText}>
            Vorlage nicht verfügbar
          </Text>
          {content}
        </View>
      )}
    </View>
  );
}

/**
 * Nativ gezeichnete, harmonisierte EASA-EU-Kompetenzkarte für alle
 * Ausstellungsländer außer Deutschland. Bildet das EU-weit nach VO 2019/947
 * vereinheitlichte Formular nach (EASA-Wortmarke, EU-Flagge mit Länderkürzel,
 * Kategorie-Badge, zweisprachiger Titel, Pilotendaten + QR). Bewusst KEINE
 * nachgebaute Behörden-Signatur — es ist klar die App-Darstellung, nicht ein
 * gefälschtes Originaldokument.
 */
function GenericEasaLicenseCard({
  tier,
  profile,
  cardWidth,
  country,
}: {
  tier: LicenseTier;
  profile: PilotProfile;
  cardWidth: number;
  country: string;
}) {
  const details = getDetails(tier, profile);
  if (!details) return null;

  const cardHeight = cardWidth / GENERIC_RATIO;
  const titles = TIER_TITLES[tier];
  const countryLabel = getCountryLabel(country);
  const authority = getAuthority(country);
  const qrData = buildQrData(tier, profile, details);

  const p = cardWidth * 0.045; // Innenabstand
  const fontXS = cardWidth * 0.018;
  const fontSM = cardWidth * 0.024;
  const fontMD = cardWidth * 0.03;
  const fontLG = cardWidth * 0.04;
  const qrSize = cardWidth * 0.16;

  const field = (label: string, value: string, testID: string) => (
    <View style={{ flex: 1 }}>
      <Text style={[genericStyles.fieldLabel, { fontSize: fontXS }]}>{label}</Text>
      <Text
        numberOfLines={1}
        style={[genericStyles.fieldValue, { fontSize: fontMD }]}
        testID={testID}
      >
        {value || "—"}
      </Text>
    </View>
  );

  return (
    <View
      style={[
        cardStyles.card,
        genericStyles.card,
        { width: cardWidth, height: cardHeight, padding: p },
      ]}
    >
      {/* Kopfzeile: EASA-Wortmarke + Kategorie-Badge */}
      <View style={genericStyles.headerRow}>
        <View style={genericStyles.brandRow}>
          <Text style={[genericStyles.easaMark, { fontSize: fontLG }]}>EASA</Text>
          {authority ? (
            <View
              style={[
                genericStyles.authorityChip,
                { backgroundColor: authority.color },
              ]}
              testID={`authority-mark-${country}`}
            >
              <Text style={[genericStyles.authorityChipText, { fontSize: fontXS }]}>
                {authority.abbr}
              </Text>
            </View>
          ) : (
            <Text style={[genericStyles.euFlag, { fontSize: fontXS }]}>
              {"\u2605 EU \u2605"}
            </Text>
          )}
        </View>
        <View style={genericStyles.badge}>
          <Text style={[genericStyles.badgeText, { fontSize: fontSM }]}>
            {titles.badge}
          </Text>
        </View>
      </View>

      {/* Titel zweisprachig */}
      <View style={genericStyles.titleBlock}>
        <Feather
          name="award"
          size={cardWidth * 0.07}
          color="#0A4D8C"
          style={{ marginBottom: p * 0.4 }}
        />
        <Text style={[genericStyles.titleDe, { fontSize: fontMD }]} numberOfLines={2}>
          {titles.de}
        </Text>
        <Text style={[genericStyles.titleEn, { fontSize: fontXS }]} numberOfLines={1}>
          {titles.en.toUpperCase()}
        </Text>
      </View>

      {/* Datenzeilen + QR */}
      <View style={genericStyles.bottomRow}>
        <View style={{ flex: 1, gap: p * 0.6 }}>
          <View style={genericStyles.fieldRow}>
            {field("Vorname (First name)", details.firstName, `text-generic-firstname-${tier}`)}
            {field("Nachname (Last name)", details.lastName, `text-generic-lastname-${tier}`)}
          </View>
          <View style={genericStyles.fieldRow}>
            {field(
              "Identifizierungsnummer (Identification number)",
              profile.pilotId || details.identificationNumber,
              `text-generic-id-${tier}`,
            )}
            {field(
              "Ablaufdatum (Expiry)",
              formatDate(details.expirationDate),
              `text-generic-expiry-${tier}`,
            )}
          </View>
          <Text
            style={[genericStyles.issuer, { fontSize: fontXS }]}
            numberOfLines={2}
            testID={`text-authority-${tier}`}
          >
            {authority
              ? `Ausgestellt durch ${authority.name} \u2013 ${countryLabel}`
              : `Ausstellungsland: ${countryLabel}`}
          </Text>
        </View>
        <View style={[genericStyles.qrBox, { padding: cardWidth * 0.008 }]}>
          <QRCode value={qrData} size={qrSize} />
        </View>
      </View>
    </View>
  );
}

const genericStyles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    justifyContent: "space-between",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  easaMark: {
    fontWeight: "800",
    color: "#0A4D8C",
    letterSpacing: 1,
  },
  euFlag: {
    fontWeight: "700",
    color: "#FFFFFF",
    backgroundColor: "#003399",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  authorityChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    maxWidth: 160,
  },
  authorityChipText: {
    color: "#FFFFFF",
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  badge: {
    backgroundColor: "#0A4D8C",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: "#FFFFFF",
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  titleBlock: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  titleDe: {
    fontWeight: "700",
    color: "#1A202C",
    textAlign: "center",
  },
  titleEn: {
    fontWeight: "600",
    color: "#64748B",
    textAlign: "center",
    letterSpacing: 1,
    marginTop: 2,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
  },
  fieldRow: {
    flexDirection: "row",
    gap: 12,
  },
  fieldLabel: {
    color: "#64748B",
    fontWeight: "600",
  },
  fieldValue: {
    color: "#1A202C",
    fontWeight: "700",
  },
  issuer: {
    color: "#64748B",
    fontWeight: "600",
    marginTop: 2,
  },
  qrBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 6,
  },
});

/**
 * Wird gezeigt, wenn die ausgewählte Lizenz aus einem anderen Land als
 * Deutschland stammt. Aktuell hinterlegen wir nur DE-Vorlagen, daher
 * bewusst eine leere Seite mit Kurzhinweis statt einer falschen Karte.
 */
function EmptyCountryCard({
  cardWidth,
  ratio,
  countryLabel,
}: {
  cardWidth: number;
  ratio: number;
  countryLabel: string;
}) {
  const { theme } = useTheme();
  const cardHeight = cardWidth / ratio;
  return (
    <View
      style={[
        cardStyles.card,
        cardStyles.placeholderCard,
        {
          width: cardWidth,
          height: cardHeight,
          backgroundColor: theme.backgroundSecondary,
        },
      ]}
    >
      <Feather name="globe" size={36} color={theme.textTertiary} />
      <Text style={[cardStyles.placeholderText, { color: theme.textSecondary }]}>
        Keine Vorlage für {countryLabel} hinterlegt
      </Text>
      <Text style={[cardStyles.placeholderHint, { color: theme.textTertiary }]}>
        Aktuell wird nur die offizielle deutsche LBA-/EASA-Karte angezeigt.
      </Text>
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
  placeholderCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  placeholderText: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  placeholderHint: {
    fontSize: 13,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  value: {
    position: "absolute",
    color: "#1A202C",
    fontWeight: "700",
  },
  qrContainer: {
    position: "absolute",
    backgroundColor: "#FFFFFF",
  },
});

function FullscreenCardModal({
  visible,
  onClose,
  tier,
  profile,
}: {
  visible: boolean;
  onClose: () => void;
  tier: LicenseTier;
  profile: PilotProfile;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const country = getCountry(tier, profile);
  const mode = getTemplateMode(country);
  const ratio = mode === "easa-generic" ? GENERIC_RATIO : getRatio(tier);

  const isLandscape = width > height;
  const availableWidth = width - insets.left - insets.right - Spacing.lg * 2;
  const availableHeight = height - insets.top - insets.bottom - 80;
  const maxCardWidth = Math.min(availableWidth, availableHeight * ratio);
  const cardWidth = isLandscape
    ? Math.min(availableWidth, availableHeight * ratio)
    : maxCardWidth;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={fullscreenStyles.backdrop}>
        <StatusBar hidden />
        <Pressable style={fullscreenStyles.closeButton} onPress={onClose}>
          <Feather name="x" size={28} color="#FFFFFF" />
        </Pressable>
        <View style={fullscreenStyles.cardWrapper}>
          {mode === "de-image" ? (
            <LicenseCard tier={tier} profile={profile} cardWidth={cardWidth} />
          ) : mode === "easa-generic" ? (
            <GenericEasaLicenseCard
              tier={tier}
              profile={profile}
              cardWidth={cardWidth}
              country={country}
            />
          ) : (
            <EmptyCountryCard
              cardWidth={cardWidth}
              ratio={ratio}
              countryLabel={getCountryLabel(country)}
            />
          )}
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

/**
 * Listet alle vom Piloten vollständig ausgefüllten Lizenzen — höchste zuerst.
 * Frühere Version zeigte nur die Top-Lizenz; auf Userwunsch werden jetzt
 * alle (bis zu 3) Karten zum Vorzeigen angeboten, weil Behörden im
 * Zweifelsfall jede einzelne sehen wollen.
 */
function getAvailableTiers(profile: PilotProfile): Array<{
  tier: LicenseTier;
  label: string;
}> {
  const list: Array<{ tier: LicenseTier; label: string }> = [];
  if (profile.licenseSTS && isLicenseComplete(profile.licenseSTSDetails)) {
    list.push({ tier: "STS", label: "STS-Betriebsgenehmigung" });
  }
  if (profile.licenseA2 && isLicenseComplete(profile.licenseA2Details)) {
    list.push({ tier: "A2", label: "Fernpiloten-Zeugnis A2" });
  }
  if (profile.licenseA1A3 && isLicenseComplete(profile.licenseA1A3Details)) {
    list.push({ tier: "A1A3", label: "EU-Kompetenznachweis A1/A3" });
  }
  return list;
}

export default function PilotLicenseCardScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [fullscreenCard, setFullscreenCard] = useState<LicenseTier | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPilotProfile().then(setProfile);
    }, [])
  );

  if (!profile) {
    return (
      <ThemedView style={styles.container}>
        <View
          style={[
            styles.loadingWrap,
            { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
          ]}
          testID="loading-license-card"
        >
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
            Lizenzkarten werden geladen …
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  const isLandscape = screenWidth > screenHeight;
  // Querformat: zwei Karten nebeneinander, Hochformat: untereinander volle Breite.
  const horizontalPadding = Spacing.lg * 2;
  const cardWidth = isLandscape
    ? Math.floor((screenWidth - horizontalPadding - Spacing.lg) / 2)
    : screenWidth - horizontalPadding;

  const tiers = getAvailableTiers(profile);

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
        {tiers.length > 0 ? (
          <>
            <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
              {tiers.length === 1
                ? "Eine vollständig ausgefüllte Lizenz."
                : `${tiers.length} vollständig ausgefüllte Lizenzen — alle zum Vorzeigen verfügbar.`}
              {"\n"}Tipp: Gerät ins Querformat drehen für die größere Darstellung.
            </ThemedText>
            <View style={isLandscape ? styles.cardGrid : undefined}>
              {tiers.map((item) => {
                const country = getCountry(item.tier, profile);
                const mode = getTemplateMode(country);
                const ratio =
                  mode === "easa-generic" ? GENERIC_RATIO : getRatio(item.tier);
                return (
                  <View
                    key={item.tier}
                    style={[
                      styles.cardSection,
                      isLandscape ? { width: cardWidth } : undefined,
                    ]}
                  >
                    <View style={styles.cardHeader}>
                      <ThemedText style={styles.cardLabel}>{item.label}</ThemedText>
                      {mode !== "none" ? (
                        <Pressable
                          onPress={() => setFullscreenCard(item.tier)}
                          style={[styles.showButton, { backgroundColor: theme.primary + "10" }]}
                          testID={`button-show-license-${item.tier}`}
                        >
                          <Feather name="maximize-2" size={16} color={theme.primary} />
                          <ThemedText style={[styles.showButtonText, { color: theme.primary }]}>
                            Vorzeigen
                          </ThemedText>
                        </Pressable>
                      ) : null}
                    </View>
                    {mode === "de-image" ? (
                      <LicenseCard tier={item.tier} profile={profile} cardWidth={cardWidth} />
                    ) : mode === "easa-generic" ? (
                      <GenericEasaLicenseCard
                        tier={item.tier}
                        profile={profile}
                        cardWidth={cardWidth}
                        country={country}
                      />
                    ) : (
                      <EmptyCountryCard
                        cardWidth={cardWidth}
                        ratio={ratio}
                        countryLabel={getCountryLabel(country)}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.emptyContainer}>
            <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
              Keine vollständig ausgefüllte Lizenz vorhanden. Bitte ergänze die Lizenzdetails im Pilotenprofil.
            </ThemedText>
          </View>
        )}
      </ScrollView>

      {fullscreenCard != null ? (
        <FullscreenCardModal
          visible={true}
          onClose={() => setFullscreenCard(null)}
          tier={fullscreenCard}
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
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
  },
  cardSection: {
    marginBottom: Spacing.xl,
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.lg,
  },
  intro: {
    ...Typography.caption,
    marginBottom: Spacing.lg,
    lineHeight: 18,
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
