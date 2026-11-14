/**
 * Sichert das iOS-Schwarzbild-Verhalten des DocumentPreviewModal ab (Task #377),
 * das auf einem echten Gerät ein WKWebView-Timing-Problem ist und in Expo-Web
 * NICHT reproduzierbar ist. Diese Komponententests laufen unter jest-expo
 * (Plattform ios) und prüfen die drei kritischen Eigenschaften ohne Gerät:
 *
 *  1. WebView/Image werden erst gemountet, NACHDEM das Modal vollständig
 *     sichtbar ist (onShow) UND die Datei materialisiert wurde. Wird die
 *     WebView während der Slide-Animation gemountet, bleibt das PDF schwarz.
 *  2. Selbstheilung: ohne onLoadEnd innerhalb des Timeouts erfolgt GENAU EIN
 *     Remount (Key-Wechsel), danach ein sauberer Fehler-Fallback. onLoadEnd
 *     innerhalb des Timeouts verhindert jeden Remount.
 *  3. Ein Re-Render mit einem NEUEN Dokument-Objekt gleichen Inhalts (die
 *     Aufrufer erzeugen das DocumentRef bei jedem Tippen neu) löscht die
 *     aktive Cache-Datei NICHT — der Materialisierungs-Effekt hängt am
 *     stabilen Inhalts-Schlüssel, nicht an der Objektreferenz.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import type { DocumentRef } from "@/lib/documents";
import { DocumentPreviewModal } from "../DocumentPreviewModal";

// --- Mocks -----------------------------------------------------------------

// documents-Lib: materializeDocument liefert den (gemockten) Cache-Pfad, den
// die Komponente in fileUri schreibt und beim Cleanup wieder löscht.
const mockDocuments = {
  materialize: jest.fn<Promise<string>, [DocumentRef]>(),
  view: jest.fn(),
  webUrl: jest.fn(),
};
jest.mock("@/lib/documents", () => ({
  __esModule: true,
  materializeDocument: (doc: any) => mockDocuments.materialize(doc),
  viewDocument: (doc: any) => mockDocuments.view(doc),
  getWebPreviewUrl: (doc: any) => mockDocuments.webUrl(doc),
  formatDocumentSize: (n: number) => `${n} B`,
}));

// expo-file-system: nur cacheDirectory + deleteAsync werden direkt genutzt.
const mockDeleteAsync = jest.fn(() => Promise.resolve());
jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  cacheDirectory: "file:///cache/",
  deleteAsync: (...args: any[]) => mockDeleteAsync(...args),
  EncodingType: { Base64: "base64" },
}));

// WebView-Platzhalter: zählt Mounts (= Render-Kontexte) und merkt sich die
// jeweils letzten Props (source/onLoadEnd/onError), damit die Tests das
// Lade-/Fehler-Verhalten steuern können. Ein Key-Wechsel führt zu Unmount +
// neuem Mount -> mountCount steigt (mounted zählt aktuell montierte Instanzen);
// so sind "genau ein Remount" UND "ist gerade gemountet" messbar.
const mockWebView = { mountCount: 0, mounted: 0, latestProps: null as any };
jest.mock("react-native-webview", () => {
  const ReactLib = require("react");
  const { View } = require("react-native");
  const WebView = (props: any) => {
    ReactLib.useEffect(() => {
      mockWebView.mountCount += 1;
      mockWebView.mounted += 1;
      return () => {
        mockWebView.mounted -= 1;
      };
    }, []);
    mockWebView.latestProps = props;
    return ReactLib.createElement(View, null);
  };
  WebView.displayName = "WebView";
  return { __esModule: true, WebView };
});

jest.mock("@expo/vector-icons", () => {
  const ReactLib = require("react");
  const { View } = require("react-native");
  return { Feather: (props: any) => ReactLib.createElement(View, props) };
});

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/hooks/useTheme", () => ({
  __esModule: true,
  useTheme: () => ({
    isDark: false,
    theme: {
      primary: "#0a84ff",
      text: "#000000",
      textSecondary: "#333333",
      textTertiary: "#666666",
      border: "#cccccc",
      background: "#ffffff",
      statusCaution: "#ffaa00",
    },
  }),
}));

// --- Helfer ----------------------------------------------------------------

const PDF_DOC: DocumentRef = {
  fileName: "av-police.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  uploadedAt: "2026-01-01T00:00:00.000Z",
  objectPath: "/objects/uploads/av-1.pdf",
};

const IMAGE_DOC: DocumentRef = {
  fileName: "lizenz.png",
  mimeType: "image/png",
  sizeBytes: 1024,
  uploadedAt: "2026-01-01T00:00:00.000Z",
  objectPath: "/objects/uploads/lic-1.png",
};

/** Erzeugt aus demselben Inhalt ein NEUES Objekt (wie die Aufrufer beim Tippen). */
function clone(doc: DocumentRef): DocumentRef {
  return { ...doc };
}

const LOAD_TIMEOUT_MS = 6000;

// Alle in einem Test erzeugten Bäume werden in afterEach abgeräumt, damit keine
// späten State-Updates/Promises nach dem Teardown der Jest-Umgebung feuern.
const openTrees: ReactTestRenderer[] = [];
function mount(element: React.ReactElement): ReactTestRenderer {
  const tree = renderer.create(element);
  openTrees.push(tree);
  return tree;
}

async function flush() {
  // Materialisierung (await materializeDocument) abarbeiten lassen.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Anzahl aktuell gemounteter (gemockter) WebView-Instanzen. */
function webViewCount(): number {
  return mockWebView.mounted;
}

/** Ruft den onShow-Handler des Modals auf (in react-test-renderer feuert er nicht von selbst). */
function triggerOnShow(tree: ReactTestRenderer) {
  const modal = tree.root.findByProps({ animationType: "slide" });
  act(() => {
    modal.props.onShow?.();
  });
}

function allText(tree: ReactTestRenderer): string {
  return tree.root
    .findAll((node) => typeof node.type === "string" && node.type === "Text")
    .map((n) =>
      n
        .findAll((c) => typeof c.children?.[0] === "string", { deep: true })
        .map((c) => c.children.join(""))
        .join(""),
    )
    .join(" ");
}

beforeEach(() => {
  jest.useRealTimers();
  mockWebView.mountCount = 0;
  mockWebView.mounted = 0;
  mockWebView.latestProps = null;
  mockDeleteAsync.mockClear();
  mockDocuments.materialize.mockReset();
  mockDocuments.materialize.mockResolvedValue("file:///cache/preflight-doc-1-av-police.pdf");
  mockDocuments.view.mockReset();
  mockDocuments.webUrl.mockReset();
});

afterEach(() => {
  // Bäume abräumen (Effekt-Cleanups, Timer-Clears) BEVOR auf echte Timer
  // umgestellt wird — sonst feuern hängende Timeouts nach dem Teardown.
  act(() => {
    for (const tree of openTrees) {
      try {
        tree.unmount();
      } catch {
        // bereits abgeräumt
      }
    }
  });
  openTrees.length = 0;
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("DocumentPreviewModal — verzögertes Mounten (iOS-Schwarzbild)", () => {
  it("mountet die PDF-WebView NICHT, solange das Modal noch nicht onShow gemeldet hat", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />,
      );
    });
    // Datei materialisiert, aber onShow fehlt -> noch keine WebView.
    await flush();
    expect(mockDocuments.materialize).toHaveBeenCalledTimes(1);
    expect(webViewCount()).toBe(0);
    expect(mockWebView.mountCount).toBe(0);

    // Nach onShow wird die WebView gemountet.
    triggerOnShow(tree);
    expect(webViewCount()).toBe(1);
    expect(mockWebView.mountCount).toBe(1);
  });

  it("mountet die WebView erst, wenn die Datei materialisiert ist (onShow allein reicht nicht)", async () => {
    // Materialisierung künstlich verzögern, damit onShow vor fileUri eintrifft.
    let resolveMat!: (uri: string) => void;
    mockDocuments.materialize.mockReturnValue(
      new Promise<string>((res) => {
        resolveMat = res;
      }),
    );

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />,
      );
    });
    triggerOnShow(tree);
    // onShow ist da, fileUri noch nicht -> keine WebView.
    expect(webViewCount()).toBe(0);

    await act(async () => {
      resolveMat("file:///cache/preflight-doc-1-av-police.pdf");
      await Promise.resolve();
    });
    expect(webViewCount()).toBe(1);
  });

  it("mountet das Bild (Image) ebenfalls erst nach onShow + materialisierter Datei", async () => {
    mockDocuments.materialize.mockResolvedValue("file:///cache/preflight-doc-1-lizenz.png");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={IMAGE_DOC} />,
      );
    });
    await flush();
    const imagesBefore = tree.root.findAllByType("Image");
    expect(imagesBefore).toHaveLength(0);

    triggerOnShow(tree);
    const imagesAfter = tree.root.findAllByType("Image");
    expect(imagesAfter).toHaveLength(1);
    expect(imagesAfter[0].props.source).toEqual({
      uri: "file:///cache/preflight-doc-1-lizenz.png",
    });
  });
});

describe("DocumentPreviewModal — Selbstheilung (Timeout -> Remount -> Fehler)", () => {
  it("remountet die WebView genau einmal, wenn onLoadEnd ausbleibt, dann Fehler-Fallback", async () => {
    jest.useFakeTimers();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />,
      );
    });
    // Materialisierung (Promise) unter Fake-Timern abarbeiten.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    triggerOnShow(tree);
    expect(mockWebView.mountCount).toBe(1);

    // Erster Timeout ohne onLoadEnd -> Key-Wechsel -> genau ein Remount.
    act(() => {
      jest.advanceTimersByTime(LOAD_TIMEOUT_MS + 1);
    });
    expect(mockWebView.mountCount).toBe(2);
    expect(webViewCount()).toBe(1);

    // Zweiter Timeout ohne onLoadEnd -> Fehler-Fallback (kein weiterer Remount).
    act(() => {
      jest.advanceTimersByTime(LOAD_TIMEOUT_MS + 1);
    });
    expect(mockWebView.mountCount).toBe(2);
    expect(webViewCount()).toBe(0);
    expect(allText(tree)).toContain("PDF-Vorschau konnte nicht geladen werden");
  });

  it("verhindert jeden Remount, wenn onLoadEnd innerhalb des Timeouts feuert", async () => {
    jest.useFakeTimers();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    triggerOnShow(tree);
    expect(mockWebView.mountCount).toBe(1);

    // Erfolgreicher Load vor Ablauf des Timeouts.
    act(() => {
      mockWebView.latestProps.onLoadEnd?.();
    });
    act(() => {
      jest.advanceTimersByTime(LOAD_TIMEOUT_MS * 3);
    });
    // Kein Remount, kein Fehler.
    expect(mockWebView.mountCount).toBe(1);
    expect(webViewCount()).toBe(1);
    expect(allText(tree)).not.toContain("konnte nicht geladen werden");
  });

  it("geht bei onError sofort in den Fehler-Fallback (ohne auf den Timeout zu warten)", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />,
      );
    });
    await flush();
    triggerOnShow(tree);
    expect(webViewCount()).toBe(1);

    act(() => {
      mockWebView.latestProps.onError?.();
    });
    expect(webViewCount()).toBe(0);
    expect(allText(tree)).toContain("PDF-Vorschau fehlgeschlagen");
  });
});

describe("DocumentPreviewModal — stabiler documentKey (Cache-Datei bleibt)", () => {
  it("löscht bei Re-Render mit neuem Objekt gleichen Inhalts die aktive Cache-Datei NICHT", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />,
      );
    });
    await flush();
    triggerOnShow(tree);
    expect(mockDocuments.materialize).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    // Re-Render mit NEUEM Objekt, identischem Inhalt -> Effekt darf NICHT
    // erneut laufen, also auch keine Materialisierung und kein Löschen.
    await act(async () => {
      tree.update(
        <DocumentPreviewModal visible onClose={() => {}} document={clone(PDF_DOC)} />,
      );
      await Promise.resolve();
    });
    expect(mockDocuments.materialize).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsync).not.toHaveBeenCalled();
    expect(webViewCount()).toBe(1);
  });

  it("materialisiert neu und löscht die alte Datei, wenn sich der Dokument-INHALT ändert", async () => {
    mockDocuments.materialize.mockResolvedValueOnce("file:///cache/doc-a.pdf");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />,
      );
    });
    await flush();
    triggerOnShow(tree);
    expect(mockDocuments.materialize).toHaveBeenCalledTimes(1);

    const OTHER_DOC: DocumentRef = { ...PDF_DOC, objectPath: "/objects/uploads/av-2.pdf" };
    mockDocuments.materialize.mockResolvedValueOnce("file:///cache/doc-b.pdf");
    await act(async () => {
      tree.update(
        <DocumentPreviewModal visible onClose={() => {}} document={OTHER_DOC} />,
      );
      await Promise.resolve();
    });
    // Neuer Inhalt -> erneute Materialisierung UND Aufräumen der alten Datei.
    expect(mockDocuments.materialize).toHaveBeenCalledTimes(2);
    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///cache/doc-a.pdf", {
      idempotent: true,
    });
  });

  it("löscht die Cache-Datei beim Schließen (visible -> false)", async () => {
    mockDocuments.materialize.mockResolvedValue("file:///cache/doc-close.pdf");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />,
      );
    });
    await flush();
    triggerOnShow(tree);
    expect(mockDeleteAsync).not.toHaveBeenCalled();

    await act(async () => {
      tree.update(
        <DocumentPreviewModal visible={false} onClose={() => {}} document={PDF_DOC} />,
      );
      await Promise.resolve();
    });
    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///cache/doc-close.pdf", {
      idempotent: true,
    });
  });
});
