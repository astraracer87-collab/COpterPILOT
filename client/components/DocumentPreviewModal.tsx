import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Modal, Pressable, Image, Platform, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import * as FileSystem from "expo-file-system/legacy";
import { ThemedText } from "./ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { DocumentRef, viewDocument, formatDocumentSize, materializeDocument, getWebPreviewUrl } from "@/lib/documents";

interface Props {
  visible: boolean;
  onClose: () => void;
  document: DocumentRef | null;
}

/**
 * Liefert einen stabilen Schlüssel für ein Dokument. Wichtig: Das Vorschau-
 * Objekt (`document`) wird beim Antippen jedes Mal NEU erzeugt (z.B.
 * `drone.alphaTangoDocument!`). Würden wir den Materialisierungs-Effekt an die
 * Objektreferenz koppeln, liefe er bei jedem Re-Render erneut und löschte über
 * sein Cleanup die gerade geladene Cache-Datei -> Schwarzbild. Der Schlüssel
 * leitet sich daher aus dem INHALT ab, nicht aus der Referenz.
 */
function documentKey(doc: DocumentRef | null): string | null {
  if (!doc) return null;
  if (doc.objectPath) return `obj:${doc.objectPath}`;
  if (doc.dataBase64) return `b64:${doc.fileName}:${doc.uploadedAt}:${doc.sizeBytes}`;
  return `f:${doc.fileName}:${doc.uploadedAt}:${doc.sizeBytes}`;
}

/** Maximale Wartezeit auf das Laden, bevor die Selbstheilung greift (ms). */
const LOAD_TIMEOUT_MS = 6000;

/**
 * In-App-Vorschau für hochgeladene Dokumente (PDF/Bild).
 *
 * Wichtig: Das base64-Feld kann mehrere MB groß sein. Eine direkte
 * `data:`-URI an die WebView (iOS) oder Image (Android) führt bei
 * großen PDFs reproduzierbar zu Abstürzen ("Out of memory" /
 * WebKit-Renderer-Crash). Deshalb materialisieren wir das Dokument
 * beim Öffnen einmalig in den Cache und laden es per `file://`-URI.
 *
 * iOS-Schwarzbild: WKWebView rendert ein lokales PDF schwarz/leer, wenn die
 * WebView WÄHREND der Slide-Animation des Vollbild-Modals gemountet wird
 * (onError feuert dabei nicht). Deshalb mounten wir die WebView erst, wenn das
 * Modal vollständig sichtbar ist (`onShow`) UND die Datei materialisiert wurde.
 * Zusätzlich erkennt eine Timeout-Prüfung einen hängenden/leeren Load und lädt
 * einmalig neu, bevor sie sauber in den Fehler-Fallback übergeht.
 */
export function DocumentPreviewModal({ visible, onClose, document }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // true erst nachdem die Modal-Slide-Animation abgeschlossen ist (onShow).
  const [modalShown, setModalShown] = useState(false);
  // Zähler für die Selbstheilung: ein Inkrement = ein frischer WebView-Remount.
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Signalisiert dem laufenden Timeout, dass der Load abgeschlossen ist.
  const loadSettledRef = useRef<(() => void) | null>(null);

  const isPdf = document?.mimeType === "application/pdf";
  const isImage = document?.mimeType.startsWith("image/") ?? false;
  const docKey = documentKey(document);

  // Materialisierung — an den INHALTS-Schlüssel gekoppelt, nicht an die
  // Objektreferenz, damit ein Re-Render die aktive Cache-Datei nicht löscht.
  useEffect(() => {
    let cancelled = false;
    let writtenPath: string | null = null;
    let blobUrl: string | null = null;

    async function materialize() {
      if (!visible || !document) {
        setFileUri(null);
        setError(null);
        return;
      }
      if (Platform.OS === "web") {
        try {
          setError(null);
          setFileUri(null);
          const url = await getWebPreviewUrl(document);
          if (url.startsWith("blob:")) blobUrl = url;
          if (!cancelled) setFileUri(url);
        } catch (e: any) {
          if (!cancelled) setError(e?.message || "Vorschau konnte nicht geladen werden.");
        }
        return;
      }
      try {
        setError(null);
        setFileUri(null);
        const path = await materializeDocument(document);
        writtenPath = path;
        if (!cancelled) setFileUri(path);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Vorschau konnte nicht geladen werden.");
      }
    }
    materialize();

    return () => {
      cancelled = true;
      // Cache-Datei erst beim tatsächlichen Wechsel/Schließen aufräumen. Da der
      // Effekt nur noch bei echtem Inhaltswechsel oder beim Schließen läuft
      // (stabiler docKey), wird nie die gerade angezeigte Datei entfernt.
      if (writtenPath) {
        FileSystem.deleteAsync(writtenPath, { idempotent: true }).catch(() => {});
      }
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, docKey]);

  // Selbstheilungs- und Mount-Zustand zurücksetzen, sobald eine neue Datei
  // bereitsteht — jeder neue fileUri startet mit einem frischen Versuch.
  useEffect(() => {
    setLoadAttempt(0);
  }, [fileUri]);

  // Beim Schließen des Modals den Sichtbarkeits-Status zurücksetzen, damit beim
  // nächsten Öffnen wieder zuverlässig auf onShow gewartet wird.
  useEffect(() => {
    if (!visible) setModalShown(false);
  }, [visible]);

  // Selbstheilung für iOS-PDFs: WKWebView meldet bei leerem/hängendem Load kein
  // onError. Bleibt der Load aus, einmalig per Remount neu laden; danach sauber
  // in den Fehler-Fallback übergehen.
  const shouldRenderPdf = modalShown && !!fileUri && !error && isPdf;
  useEffect(() => {
    if (!shouldRenderPdf || Platform.OS === "web") return;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      if (loadAttempt === 0) {
        setLoadAttempt(1);
      } else {
        setError("PDF-Vorschau konnte nicht geladen werden. Bitte 'Mit System-App öffnen' nutzen.");
      }
    }, LOAD_TIMEOUT_MS);
    loadSettledRef.current = () => {
      settled = true;
      clearTimeout(timer);
    };
    return () => {
      clearTimeout(timer);
      loadSettledRef.current = null;
    };
  }, [shouldRenderPdf, loadAttempt]);

  const handleShare = async () => {
    if (!document) return;
    try {
      await viewDocument(document);
    } catch (e: any) {
      Alert.alert("Fehler", e?.message || "Teilen fehlgeschlagen.");
    }
  };

  if (!document) return null;

  const renderBody = () => {
    if (error) {
      return (
        <View style={styles.fallback}>
          <Feather name="alert-circle" size={48} color={theme.statusCaution} />
          <ThemedText style={[styles.fallbackText, { color: theme.textSecondary }]}>
            {error}
          </ThemedText>
          <Pressable onPress={handleShare} style={[styles.shareBtn, { backgroundColor: theme.primary }]}>
            <ThemedText style={{ color: "#fff", fontWeight: "600" }}>Mit System-App öffnen</ThemedText>
          </Pressable>
        </View>
      );
    }
    // Auf Web gibt es keine Slide-Animation/onShow — dort sofort rendern.
    const ready = Platform.OS === "web" ? !!fileUri : modalShown && !!fileUri;
    if (!ready) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      );
    }
    if (isPdf) {
      // Web: react-native-webview rendert auf Expo-Web NUR einen Dummy
      // ("does not support this platform") — KEIN echtes PDF. Deshalb mounten
      // wir auf Web ein natives DOM-<iframe> (react-native-web rendert über
      // ReactDOM, daher rendert ein String-Tag ein echtes iframe). Der Schlüssel
      // hängt an fileUri, damit ein Inhaltswechsel einen frischen Frame erzwingt;
      // die Blob-URL wird erst im Cleanup widerrufen, also bleibt sie für die
      // Lebensdauer des iframes gültig.
      if (Platform.OS === "web") {
        return React.createElement("iframe", {
          key: fileUri!,
          title: document.fileName,
          src: fileUri!,
          style: {
            flex: 1,
            width: "100%",
            height: "100%",
            border: "none",
            backgroundColor: "#fff",
          },
        });
      }
      return (
        <WebView
          setSupportMultipleWindows={false}
          // Pro Datei UND pro Heilungs-Versuch ein frischer Render-Kontext, damit
          // kein alter Schwarz-Zustand der WKWebView zurückbleibt.
          key={`${fileUri}#${loadAttempt}`}
          originWhitelist={["*"]}
          source={{ uri: fileUri! }}
          // WKWebView (iOS) rendert lokale PDFs nur zuverlässig, wenn die
          // Lese-Berechtigung auf das ENTHALTENDE VERZEICHNIS zeigt. Ohne
          // diesen TOP-LEVEL-Prop setzt react-native-webview den Scope auf
          // die Datei selbst -> PDF bleibt schwarz (onError feuert dabei
          // nicht, weil der Load formal "erfolgreich" leer ist).
          allowingReadAccessToURL={
            Platform.OS === "ios"
              ? fileUri!.includes("/")
                ? fileUri!.substring(0, fileUri!.lastIndexOf("/") + 1)
                : FileSystem.cacheDirectory ?? undefined
              : undefined
          }
          style={{ flex: 1, backgroundColor: "#000" }}
          startInLoadingState
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          onLoadEnd={() => {
            loadSettledRef.current?.();
          }}
          onError={() => setError("PDF-Vorschau fehlgeschlagen. Bitte 'Mit System-App öffnen' nutzen.")}
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          )}
        />
      );
    }
    if (isImage) {
      return (
        <View style={styles.imageWrap}>
          <Image source={{ uri: fileUri! }} style={styles.image} resizeMode="contain" />
        </View>
      );
    }
    return (
      <View style={styles.fallback}>
        <Feather name="file" size={48} color={theme.textTertiary} />
        <ThemedText style={[styles.fallbackText, { color: theme.textSecondary }]}>
          Vorschau für diesen Dateityp nicht verfügbar. Tippe oben rechts auf "Teilen" zum Öffnen.
        </ThemedText>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setModalShown(true)}
      presentationStyle="fullScreen"
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + Spacing.sm, borderBottomColor: theme.border }]}>
          <Pressable onPress={onClose} style={styles.headerBtn} hitSlop={12} testID="button-close-preview">
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <ThemedText numberOfLines={1} style={styles.headerTitle}>{document.fileName}</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: theme.textTertiary }]}>
              {formatDocumentSize(document.sizeBytes)} · {isPdf ? "PDF" : isImage ? "Bild" : document.mimeType}
            </ThemedText>
          </View>
          <Pressable onPress={handleShare} style={styles.headerBtn} hitSlop={12}>
            <Feather name="share" size={22} color={theme.primary} />
          </Pressable>
        </View>

        <View style={styles.body}>{renderBody()}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { padding: 4 },
  headerTitleWrap: { flex: 1, paddingHorizontal: Spacing.sm },
  headerTitle: { fontSize: 15, fontWeight: "600" },
  headerMeta: { fontSize: 11, marginTop: 2 },
  body: { flex: 1, backgroundColor: "#000" },
  loading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" },
  imageWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#000" },
  image: { width: "100%", height: "100%" },
  fallback: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  fallbackText: { fontSize: 14, textAlign: "center", marginTop: Spacing.md },
  shareBtn: { marginTop: Spacing.xl, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, borderRadius: 8 },
});
