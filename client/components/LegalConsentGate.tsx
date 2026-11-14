import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import LegalDocumentView from "@/components/LegalDocumentView";
import { TERMS } from "../../shared/terms";
import { PRIVACY_POLICY } from "../../shared/privacyPolicy";
import type { LegalDocument } from "../../shared/legal";
import { LEGAL_CONSENT_VERSION } from "../../shared/legalConsent";

type DocKey = "agb" | "datenschutz";

/**
 * Aktiver Zustimmungs-Schritt zu AGB + Datenschutz. Wird im AuthGate NACH dem
 * Login, aber VOR dem Disclaimer gezeigt, solange die akzeptierte Version nicht
 * der aktuellen `LEGAL_CONSENT_VERSION` entspricht (Re-Consent bei Versionsbump).
 *
 * Der Nutzer MUSS jedes Dokument öffnen und bis zum Ende scrollen, bevor er es
 * bestätigen kann. Die Dokumente werden nacheinander freigeschaltet (erst AGB,
 * dann Datenschutz). Es gibt keine direkt antippbare Checkbox mehr – Zustimmung
 * ist nur über den Volltext im Modal möglich.
 *
 * Liegt außerhalb des NavigationContainers, daher werden die Volltexte über ein
 * Modal mit dem generischen `LegalDocumentView` gelesen (keine Navigation).
 */
export default function LegalConsentGate({
  onAccept,
}: {
  onAccept: (version: string) => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [agbAccepted, setAgbAccepted] = useState(false);
  const [datenschutzAccepted, setDatenschutzAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openKey, setOpenKey] = useState<DocKey | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const viewportHRef = useRef(0);
  const contentHRef = useRef(0);

  const bothAccepted = agbAccepted && datenschutzAccepted;
  const openDoc: LegalDocument | null =
    openKey === "agb" ? TERMS : openKey === "datenschutz" ? PRIVACY_POLICY : null;

  const openReader = useCallback((key: DocKey) => {
    setReachedEnd(false);
    viewportHRef.current = 0;
    contentHRef.current = 0;
    setOpenKey(key);
  }, []);

  const closeReader = useCallback(() => setOpenKey(null), []);

  // "Bis zum Ende gescrollt" robust erkennen: bei langem Inhalt über onScroll,
  // bei kurzem (nicht scrollbarem) Inhalt sofort, sobald Inhalts- und
  // Viewporthöhe bekannt sind und der Inhalt komplett sichtbar ist. Beide Maße
  // liegen in Refs, damit jeder Handler synchron den jeweils aktuellen Wert des
  // anderen sieht (State-Updates wären asynchron und könnten 0 lesen).
  const markEndIfFits = useCallback(() => {
    const view = viewportHRef.current;
    const content = contentHRef.current;
    if (view > 0 && content > 0 && content <= view + 4) {
      setReachedEnd(true);
    }
  }, []);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      if (
        layoutMeasurement.height + contentOffset.y >=
        contentSize.height - 24
      ) {
        setReachedEnd(true);
      }
    },
    [],
  );

  const confirmRead = useCallback(() => {
    if (!reachedEnd || !openKey) return;
    if (openKey === "agb") setAgbAccepted(true);
    else setDatenschutzAccepted(true);
    setOpenKey(null);
  }, [reachedEnd, openKey]);

  const handleAccept = useCallback(async () => {
    if (!bothAccepted || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAccept(LEGAL_CONSENT_VERSION);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Die Zustimmung konnte nicht gespeichert werden.",
      );
      setSubmitting(false);
    }
  }, [bothAccepted, submitting, onAccept]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.iconRow}>
        <Feather name="check-circle" size={36} color="#7FB2E5" />
      </View>
      <Text style={styles.title}>Zustimmung erforderlich</Text>
      <Text style={styles.subtitle}>
        Bitte öffne die folgenden Dokumente und scrolle jeweils bis zum Ende, um
        ihnen zuzustimmen. Die Dokumente werden nacheinander freigeschaltet.
      </Text>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <ConsentRow
          step={1}
          accepted={agbAccepted}
          locked={false}
          onOpen={() => openReader("agb")}
          label="Allgemeine Geschäftsbedingungen (AGB)"
          openLabel="AGB öffnen und lesen"
          testID="consent-agb"
        />
        <ConsentRow
          step={2}
          accepted={datenschutzAccepted}
          locked={!agbAccepted}
          onOpen={() => openReader("datenschutz")}
          label="Datenschutzerklärung"
          openLabel="Datenschutzerklärung öffnen und lesen"
          lockedHint="Bitte zuerst den AGB zustimmen."
          testID="consent-datenschutz"
        />
      </ScrollView>

      {error ? (
        <Text style={styles.error} testID="text-consent-error">
          {error}
        </Text>
      ) : null}

      <Pressable
        onPress={handleAccept}
        disabled={!bothAccepted || submitting}
        style={({ pressed }) => [
          styles.acceptBtn,
          (!bothAccepted || submitting) && styles.acceptBtnDisabled,
          pressed && styles.btnPressed,
        ]}
        testID="button-consent-accept"
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Feather name="check" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={styles.acceptText}>Zustimmen und fortfahren</Text>
          </>
        )}
      </Pressable>

      <Modal
        visible={openDoc != null}
        animationType="slide"
        onRequestClose={closeReader}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <Pressable
              onPress={closeReader}
              style={styles.modalClose}
              testID="button-consent-doc-close"
            >
              <Feather name="x" size={24} color="#7FB2E5" />
              <Text style={styles.modalCloseText}>Schließen</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.modalScrollView}
            contentContainerStyle={[styles.modalScroll, { paddingBottom: 32 }]}
            scrollEventThrottle={16}
            onScroll={handleScroll}
            onLayout={(e) => {
              viewportHRef.current = e.nativeEvent.layout.height;
              markEndIfFits();
            }}
            onContentSizeChange={(_w, h) => {
              contentHRef.current = h;
              markEndIfFits();
            }}
            testID="scroll-consent-doc"
          >
            {openDoc ? <LegalDocumentView document={openDoc} /> : null}
          </ScrollView>
          <View style={[styles.modalFooter, { paddingBottom: insets.bottom + 12 }]}>
            {!reachedEnd ? (
              <View style={styles.scrollHintRow}>
                <Feather name="chevrons-down" size={16} color="#7FB2E5" />
                <Text style={styles.scrollHintText}>
                  Bitte bis zum Ende scrollen, um zuzustimmen.
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={confirmRead}
              disabled={!reachedEnd}
              style={({ pressed }) => [
                styles.confirmBtn,
                !reachedEnd && styles.confirmBtnDisabled,
                pressed && reachedEnd && styles.btnPressed,
              ]}
              testID="button-consent-doc-confirm"
            >
              <Feather name="check" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.confirmText}>Gelesen – ich stimme zu</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ConsentRow({
  step,
  accepted,
  locked,
  onOpen,
  label,
  openLabel,
  lockedHint,
  testID,
}: {
  step: number;
  accepted: boolean;
  locked: boolean;
  onOpen: () => void;
  label: string;
  openLabel: string;
  lockedHint?: string;
  testID: string;
}) {
  return (
    <View style={[styles.row, locked && styles.rowLocked]}>
      <View style={styles.checkRow}>
        <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
          {accepted ? (
            <Feather name="check" size={14} color="#FFFFFF" />
          ) : (
            <Text style={styles.stepNum}>{step}</Text>
          )}
        </View>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>

      {accepted ? (
        <View style={styles.acceptedRow}>
          <Feather name="check-circle" size={16} color="#37C26B" />
          <Text style={styles.acceptedText} testID={`${testID}-accepted`}>
            Gelesen und akzeptiert
          </Text>
          <Pressable
            onPress={onOpen}
            style={styles.reopenBtn}
            testID={`${testID}-reopen`}
          >
            <Text style={styles.reopenText}>Erneut lesen</Text>
          </Pressable>
        </View>
      ) : locked ? (
        <View style={styles.lockedRow}>
          <Feather name="lock" size={14} color="rgba(200, 210, 230, 0.6)" />
          <Text style={styles.lockedText}>
            {lockedHint ?? "Noch nicht freigeschaltet."}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => [styles.openBtn, pressed && styles.btnPressed]}
          testID={`${testID}-open`}
        >
          <Feather name="file-text" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.openBtnText}>{openLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0E1A",
    paddingHorizontal: 24,
  },
  iconRow: {
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(200, 210, 230, 0.9)",
    textAlign: "center",
    marginBottom: 20,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 12,
    gap: 16,
  },
  row: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(127, 178, 229, 0.2)",
    padding: 16,
    gap: 14,
  },
  rowLocked: {
    opacity: 0.55,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "rgba(127, 178, 229, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: "#1B8A2A",
    borderColor: "#1B8A2A",
  },
  stepNum: {
    fontSize: 13,
    fontWeight: "700",
    color: "#7FB2E5",
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
    color: "rgba(230, 236, 245, 0.95)",
  },
  openBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A4D8C",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  openBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  lockedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  lockedText: {
    flex: 1,
    fontSize: 13,
    color: "rgba(200, 210, 230, 0.7)",
  },
  acceptedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  acceptedText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#37C26B",
  },
  reopenBtn: {
    marginLeft: "auto",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  reopenText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#7FB2E5",
  },
  error: {
    fontSize: 13,
    color: "#FF8A80",
    textAlign: "center",
    marginBottom: 8,
  },
  acceptBtn: {
    flexDirection: "row",
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: "#1B8A2A",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  acceptBtnDisabled: {
    opacity: 0.45,
  },
  acceptText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  btnPressed: {
    opacity: 0.7,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#0A0E1A",
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.12)",
  },
  modalClose: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#7FB2E5",
  },
  modalScrollView: {
    flex: 1,
  },
  modalScroll: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "#0A0E1A",
    gap: 10,
  },
  scrollHintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  scrollHintText: {
    fontSize: 13,
    color: "rgba(200, 210, 230, 0.85)",
  },
  confirmBtn: {
    flexDirection: "row",
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: "#1B8A2A",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
