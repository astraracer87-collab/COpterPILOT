/**
 * Sichert den WEB-Browser-Pfad des DocumentPreviewModal ab (Task #387). Während
 * der native Pfad (iOS/Android) `materializeDocument` -> `file://` -> WebView mit
 * onShow-Gate und Selbstheilung nutzt, läuft auf Web (`Platform.OS === "web"`)
 * ein eigener Zweig: `getWebPreviewUrl` liefert eine `data:`- (base64) bzw.
 * `blob:`-URL (Object Storage), die Vorschau erscheint OHNE auf onShow zu warten
 * (kein modalShown-Gate), und die Blob-URL wird beim Schließen/echten
 * Inhaltswechsel per `URL.revokeObjectURL` GENAU EINMAL widerrufen. Genau dort
 * kann ein Blob-Leak oder eine zu früh widerrufene URL zu einer leeren Vorschau
 * führen — diese Tests fixieren das Verhalten ohne Browser.
 *
 *  1. Web: Vorschau (echtes DOM-iframe für PDF bzw. Image) erscheint, sobald
 *     fileUri da ist — ohne onShow (auf Web feuert das Modal kein onShow / es
 *     gibt keine Slide-Animation). Auf Web wird KEINE react-native-webview
 *     gemountet (die ist dort nur ein "not supported"-Dummy); PDFs rendern in
 *     einem nativen <iframe> mit der data:/blob:-URL als src.
 *  2. Cleanup: `URL.revokeObjectURL` wird beim Schließen UND beim echten
 *     Inhaltswechsel genau einmal mit der zuvor erzeugten Blob-URL aufgerufen,
 *     aber NICHT bei einem Re-Render mit neuem Objekt gleichen Inhalts (stabiler
 *     documentKey). base64-`data:`-URLs werden nicht widerrufen.
 *  3. Fehlerfall: wirft `getWebPreviewUrl`, erscheint der Fehler-Fallback.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Platform } from "react-native";
import type { DocumentRef } from "@/lib/documents";

// --- Plattform auf Web umstellen (jest-expo defaultet auf ios) --------------
// Muss VOR dem Import der Komponente passieren, damit Modul-Top-Level-Checks
// (falls vorhanden) den Web-Zweig sehen. Die Komponente liest Platform.OS aber
// ausschließlich zur Laufzeit, daher reicht die Mutation hier ebenfalls.
const originalOS = Platform.OS;
Object.defineProperty(Platform, "OS", { configurable: true, get: () => "web" });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DocumentPreviewModal } = require("../DocumentPreviewModal");

// --- Mocks -----------------------------------------------------------------

const mockDocuments = {
  materialize: jest.fn<Promise<string>, [DocumentRef]>(),
  view: jest.fn(),
  webUrl: jest.fn<Promise<string>, [DocumentRef]>(),
};
jest.mock("@/lib/documents", () => ({
  __esModule: true,
  materializeDocument: (doc: any) => mockDocuments.materialize(doc),
  viewDocument: (doc: any) => mockDocuments.view(doc),
  getWebPreviewUrl: (doc: any) => mockDocuments.webUrl(doc),
  formatDocumentSize: (n: number) => `${n} B`,
}));

const mockDeleteAsync = jest.fn(() => Promise.resolve());
jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  cacheDirectory: "file:///cache/",
  deleteAsync: (...args: any[]) => mockDeleteAsync(...args),
  EncodingType: { Base64: "base64" },
}));

// Auf Web rendert react-native-webview intern ein iframe; im Test genügt ein
// Platzhalter, der Mounts zählt und die letzten Props (source) merkt.
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

// Object-Storage-Referenz -> getWebPreviewUrl liefert eine Blob-URL.
const PDF_DOC: DocumentRef = {
  fileName: "av-police.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  uploadedAt: "2026-01-01T00:00:00.000Z",
  objectPath: "/objects/uploads/av-1.pdf",
};

// base64-Referenz -> getWebPreviewUrl liefert eine data:-URL (kein revoke).
const BASE64_PDF_DOC: DocumentRef = {
  fileName: "legacy.pdf",
  mimeType: "application/pdf",
  sizeBytes: 512,
  uploadedAt: "2026-01-01T00:00:00.000Z",
  dataBase64: "JVBERi0=",
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

const openTrees: ReactTestRenderer[] = [];
function mount(element: React.ReactElement): ReactTestRenderer {
  const tree = renderer.create(element);
  openTrees.push(tree);
  return tree;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function webViewCount(): number {
  return mockWebView.mounted;
}

// Auf Web rendert die PDF-Vorschau ein echtes DOM-<iframe> (react-native-web
// über ReactDOM), NICHT die react-native-webview (die auf Web nur ein
// "not supported"-Dummy ist). Wir zählen daher die iframe-Host-Knoten.
function iframeNodes(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => n.type === "iframe");
}
function iframeCount(tree: ReactTestRenderer): number {
  return iframeNodes(tree).length;
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

const mockRevoke = jest.fn();
const mockCreate = jest.fn();

beforeAll(() => {
  // @ts-expect-error – node URL hat diese Browser-Methoden nicht.
  global.URL.revokeObjectURL = mockRevoke;
  // @ts-expect-error
  global.URL.createObjectURL = mockCreate;
});

afterAll(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
});

beforeEach(() => {
  jest.useRealTimers();
  mockWebView.mountCount = 0;
  mockWebView.mounted = 0;
  mockWebView.latestProps = null;
  mockDeleteAsync.mockClear();
  mockRevoke.mockClear();
  mockCreate.mockClear();
  mockDocuments.materialize.mockReset();
  mockDocuments.view.mockReset();
  mockDocuments.webUrl.mockReset();
});

afterEach(() => {
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

describe("DocumentPreviewModal (Web) — Vorschau ohne onShow-Gate", () => {
  it("mountet die PDF-Vorschau (echtes iframe), sobald die Web-URL da ist — ohne onShow", async () => {
    mockDocuments.webUrl.mockResolvedValue("blob:web-pdf-1");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(<DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />);
    });
    await flush();

    // Web-Pfad: getWebPreviewUrl statt materializeDocument; kein onShow nötig.
    expect(mockDocuments.webUrl).toHaveBeenCalledTimes(1);
    expect(mockDocuments.materialize).not.toHaveBeenCalled();
    // Auf Web KEINE react-native-webview, sondern ein echtes DOM-iframe mit
    // der Blob-URL als src (sonst zeigt der WebView-Dummy nur "not supported").
    expect(webViewCount()).toBe(0);
    expect(iframeCount(tree)).toBe(1);
    expect(iframeNodes(tree)[0].props.src).toBe("blob:web-pdf-1");
  });

  it("zeigt das Bild (Image) auf Web ebenfalls ohne onShow", async () => {
    mockDocuments.webUrl.mockResolvedValue("blob:web-img-1");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(<DocumentPreviewModal visible onClose={() => {}} document={IMAGE_DOC} />);
    });
    await flush();

    const images = tree.root.findAllByType("Image");
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual({ uri: "blob:web-img-1" });
  });

  it("zeigt vor dem Auflösen der Web-URL den Ladezustand und keine Vorschau", async () => {
    let resolveUrl!: (u: string) => void;
    mockDocuments.webUrl.mockReturnValue(
      new Promise<string>((res) => {
        resolveUrl = res;
      }),
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(<DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />);
    });
    // URL noch nicht aufgelöst -> kein iframe.
    expect(iframeCount(tree)).toBe(0);
    expect(tree.root.findAllByType("ActivityIndicator").length).toBeGreaterThan(0);

    await act(async () => {
      resolveUrl("blob:web-pdf-late");
      await Promise.resolve();
    });
    expect(iframeCount(tree)).toBe(1);
  });
});

describe("DocumentPreviewModal (Web) — Blob-URL-Aufräumen", () => {
  it("widerruft die Blob-URL beim Schließen GENAU einmal", async () => {
    mockDocuments.webUrl.mockResolvedValue("blob:web-close");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(<DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />);
    });
    await flush();
    expect(mockRevoke).not.toHaveBeenCalled();

    await act(async () => {
      tree.update(
        <DocumentPreviewModal visible={false} onClose={() => {}} document={PDF_DOC} />,
      );
      await Promise.resolve();
    });
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith("blob:web-close");
  });

  it("widerruft die ALTE Blob-URL beim echten Inhaltswechsel genau einmal", async () => {
    mockDocuments.webUrl.mockResolvedValueOnce("blob:web-a");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(<DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />);
    });
    await flush();
    expect(mockDocuments.webUrl).toHaveBeenCalledTimes(1);

    const OTHER_DOC: DocumentRef = { ...PDF_DOC, objectPath: "/objects/uploads/av-2.pdf" };
    mockDocuments.webUrl.mockResolvedValueOnce("blob:web-b");
    await act(async () => {
      tree.update(<DocumentPreviewModal visible onClose={() => {}} document={OTHER_DOC} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Neuer Inhalt -> neue Web-URL UND Widerruf der alten Blob-URL (einmal).
    expect(mockDocuments.webUrl).toHaveBeenCalledTimes(2);
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith("blob:web-a");
  });

  it("widerruft NICHTS bei Re-Render mit neuem Objekt gleichen Inhalts (stabiler documentKey)", async () => {
    mockDocuments.webUrl.mockResolvedValue("blob:web-stable");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(<DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />);
    });
    await flush();
    expect(mockDocuments.webUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.update(<DocumentPreviewModal visible onClose={() => {}} document={clone(PDF_DOC)} />);
      await Promise.resolve();
    });
    // Inhalt identisch -> Effekt läuft nicht erneut -> kein neuer fetch, kein revoke.
    expect(mockDocuments.webUrl).toHaveBeenCalledTimes(1);
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(iframeCount(tree)).toBe(1);
  });

  it("widerruft eine data:-URL (base64) NICHT", async () => {
    mockDocuments.webUrl.mockResolvedValue("data:application/pdf;base64,JVBERi0=");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(
        <DocumentPreviewModal visible onClose={() => {}} document={BASE64_PDF_DOC} />,
      );
    });
    await flush();
    expect(iframeCount(tree)).toBe(1);

    await act(async () => {
      tree.update(
        <DocumentPreviewModal visible={false} onClose={() => {}} document={BASE64_PDF_DOC} />,
      );
      await Promise.resolve();
    });
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});

describe("DocumentPreviewModal (Web) — Fehlerfall", () => {
  it("zeigt den Fehler-Fallback, wenn getWebPreviewUrl wirft", async () => {
    mockDocuments.webUrl.mockRejectedValue(new Error("Web-Vorschau kaputt"));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = mount(<DocumentPreviewModal visible onClose={() => {}} document={PDF_DOC} />);
    });
    await flush();

    expect(iframeCount(tree)).toBe(0);
    expect(allText(tree)).toContain("Web-Vorschau kaputt");
    expect(allText(tree)).toContain("Mit System-App öffnen");
  });
});
