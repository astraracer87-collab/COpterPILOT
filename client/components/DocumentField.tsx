import React, { useState } from "react";
import { View, StyleSheet, Pressable, Alert, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { DocumentRef, pickDocument, formatDocumentSize, viewDocument } from "@/lib/documents";
import { DocumentPreviewModal } from "./DocumentPreviewModal";
import { useAuth } from "@/lib/auth";
import { promptFeatureUpgrade } from "./FeatureGate";

interface Props {
  label: string;
  hint?: string;
  document: DocumentRef | null | undefined;
  onChange: (doc: DocumentRef | null) => void;
  testID?: string;
}

/**
 * Wiederverwendbares UI-Element für das Hochladen, Ansehen und Löschen
 * eines einzelnen Dokuments (PDF/Bild). Wird im Pilotenprofil für die
 * Versicherungsbestätigung und in der Drohnen-Setup für die
 * AlphaTango-Registrierung verwendet.
 */
export function DocumentField({ label, hint, document, onChange, testID }: Props) {
  const { theme } = useTheme();
  const { entitlement } = useAuth();
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const handlePick = async () => {
    if (busy) return;
    if (!promptFeatureUpgrade(entitlement, "document_management")) return;
    setBusy(true);
    try {
      
      const doc = await pickDocument();
      if (doc) onChange(doc);
    } catch (e: any) {
      Alert.alert("Fehler", e?.message || "Datei konnte nicht gelesen werden.");
    } finally {
      setBusy(false);
    }
  };

  const handleView = () => {
    if (!document || busy) return;
    setPreviewOpen(true);
  };

  const handleShare = async () => {
    if (!document || busy) return;
    try {
      
      await viewDocument(document);
    } catch (e: any) {
      Alert.alert("Fehler", e?.message || "Teilen/Herunterladen fehlgeschlagen.");
    }
  };

  const handleDelete = () => {
    if (!document) return;
    Alert.alert(
      "Dokument entfernen?",
      `"${document.fileName}" wird unwiderruflich aus dem Profil gelöscht.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Entfernen",
          style: "destructive",
          onPress: () => {
            
            onChange(null);
          },
        },
      ],
    );
  };

  return (
    <View testID={testID} style={styles.container}>
      <ThemedText style={[styles.label, { color: theme.textSecondary }]}>{label}</ThemedText>
      {hint ? (
        <ThemedText style={[styles.hint, { color: theme.textTertiary }]}>{hint}</ThemedText>
      ) : null}

      {document ? (
        <View style={[styles.fileRow, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
          <Feather
            name={document.mimeType === "application/pdf" ? "file-text" : "image"}
            size={20}
            color={theme.primary}
            style={{ marginRight: Spacing.sm }}
          />
          <View style={{ flex: 1 }}>
            <ThemedText numberOfLines={1} style={styles.fileName}>{document.fileName}</ThemedText>
            <ThemedText style={[styles.fileMeta, { color: theme.textTertiary }]}>
              {formatDocumentSize(document.sizeBytes)} · {new Date(document.uploadedAt).toLocaleDateString("de-DE")}
            </ThemedText>
          </View>
          <Pressable
            onPress={handleView}
            testID={testID ? `${testID}-view` : undefined}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="eye" size={18} color={theme.primary} />
          </Pressable>
          <Pressable
            onPress={handleShare}
            testID={testID ? `${testID}-share` : undefined}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="share" size={18} color={theme.primary} />
          </Pressable>
          <Pressable
            onPress={handlePick}
            testID={testID ? `${testID}-replace` : undefined}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            {busy ? <ActivityIndicator size="small" color={theme.primary} /> : <Feather name="refresh-cw" size={18} color={theme.primary} />}
          </Pressable>
          <Pressable
            onPress={handleDelete}
            testID={testID ? `${testID}-delete` : undefined}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="trash-2" size={18} color="#d33" />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={handlePick}
          testID={testID ? `${testID}-upload` : undefined}
          style={({ pressed }) => [
            styles.uploadRow,
            {
              backgroundColor: theme.backgroundSecondary,
              borderColor: theme.primary + "55",
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Feather name="upload" size={18} color={theme.primary} />
          )}
          <ThemedText style={{ color: theme.primary, fontWeight: "600", marginLeft: Spacing.sm }}>
            PDF / Foto hochladen
          </ThemedText>
        </Pressable>
      )}

      <DocumentPreviewModal
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        document={document ?? null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: Spacing.md },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  hint: { fontSize: 12, marginBottom: Spacing.xs },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileName: { fontSize: 14, fontWeight: "600" },
  fileMeta: { fontSize: 11, marginTop: 2 },
  iconBtn: { padding: 8, marginLeft: 2 },
  uploadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
  },
});
