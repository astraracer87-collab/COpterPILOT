/**
 * Einstellungen „DJI-Flugprotokolle – Speicherort“: Zugriffsprüfung über das
 * (gemockte) Storage Access Framework und die Karte in ihren Zuständen
 * (kein Ordner / Zugriff OK / Zugriff verloren / DJI-Fly-Ordner verweigert).
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

const mockReadDirectory = jest.fn<Promise<string[]>, [string]>();
const mockRequestPermissions = jest.fn<Promise<{ granted: boolean; directoryUri?: string }>, [string]>();
jest.mock("expo-file-system/legacy", () => ({
  StorageAccessFramework: {
    readDirectoryAsync: (uri: string) => mockReadDirectory(uri),
    requestDirectoryPermissionsAsync: (uri: string) => mockRequestPermissions(uri),
  },
}));

const mockLogbook: { djiLogs: { fileName: string; status: string }[] }[] = [];
jest.mock("@/lib/storage", () => ({
  getLogbook: jest.fn(async () => mockLogbook),
  getLogbookLite: jest.fn(async () => mockLogbook),
  getEntryDjiLogs: (e: { djiLogs?: unknown[] }) => e.djiLogs ?? [],
}));

import { DjiLogFolderCard, djiLogFolderStatusText } from "../DjiLogFolderCard";
import {
  DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI,
  DJI_FLY_FLIGHTRECORD_DOC_URI,
  DJI_LOG_FOLDER_STORAGE_KEY,
  checkDjiLogFolderAccess,
  getDjiLogFolder,
  getDjiLogNewHint,
  refreshDjiLogNewHint,
  setDjiLogAutoCheck,
} from "@/lib/djiLogFolder";

const TREE = "content://com.android.externalstorage.documents/tree/";
const DJI_FLY_TREE = `${TREE}primary%3AAndroid%2Fdata%2Fdji.go.v5%2Ffiles%2FFlightRecord`;
const DOWNLOAD_TREE = `${TREE}primary%3ADownload%2FFlightRecords`;
const child = (tree: string, name: string) => `${tree}/document/x%2F${encodeURIComponent(name)}`;

function textOf(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === "string") return void out.push(n);
    if (Array.isArray(n)) return void n.forEach(walk);
    walk(n.children);
  };
  walk(tree.toJSON());
  return out.join(" ");
}

/** Anzahl gerenderter (Host-)Elemente mit dieser testID. */
const countId = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID).length;

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => {});
}

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<DjiLogFolderCard />);
  });
  await flush();
  return tree;
}

const press = async (tree: ReactTestRenderer, testID: string) => {
  await act(async () => {
    tree.root.findByProps({ testID }).props.onPress();
  });
  await flush();
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, "OS", "android");
  await AsyncStorage.clear();
  mockLogbook.length = 0;
  mockReadDirectory.mockResolvedValue([]);
  mockRequestPermissions.mockResolvedValue({ granted: false });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("checkDjiLogFolderAccess (gemocktes SAF)", () => {
  it("ok: Anzahl .txt und neue gegenüber bereits importierten Logs", async () => {
    mockReadDirectory.mockResolvedValue([
      child(DOWNLOAD_TREE, "DJIFlightRecord_2026-05-01_[10-00-00].txt"),
      child(DOWNLOAD_TREE, "DJIFlightRecord_2026-05-02_[11-00-00].txt"),
      child(DOWNLOAD_TREE, "FLY001.DAT"),
    ]);
    mockLogbook.push({
      djiLogs: [
        { fileName: "DJIFlightRecord_2026-05-01_[10-00-00].txt", status: "parsed" },
        // nicht ausgewertet → gilt nicht als importiert
        { fileName: "DJIFlightRecord_2026-05-02_[11-00-00].txt", status: "error" },
      ],
    });
    const res = await checkDjiLogFolderAccess(DOWNLOAD_TREE);
    expect(mockReadDirectory).toHaveBeenCalledWith(DOWNLOAD_TREE);
    expect(res).toEqual({ ok: true, count: 2, newCount: 1 });
  });

  it("verloren: readDirectoryAsync wirft", async () => {
    mockReadDirectory.mockRejectedValue(new Error("Permission Denial"));
    const res = await checkDjiLogFolderAccess(DJI_FLY_TREE);
    expect(res.ok).toBe(false);
    expect(res.count).toBe(0);
  });

  it("stille Prüfung beim Start nur, wenn eingeschaltet", async () => {
    await AsyncStorage.setItem(DJI_LOG_FOLDER_STORAGE_KEY, DOWNLOAD_TREE);
    mockReadDirectory.mockResolvedValue([child(DOWNLOAD_TREE, "DJIFlightRecord_a.txt")]);
    expect(await refreshDjiLogNewHint()).toBeNull();
    expect(mockReadDirectory).not.toHaveBeenCalled();
    await setDjiLogAutoCheck(true);
    expect(await refreshDjiLogNewHint()).toBe(1);
    expect(getDjiLogNewHint()).toBe(1);
    await setDjiLogAutoCheck(false);
    expect(getDjiLogNewHint()).toBeNull();
  });
});

describe("DjiLogFolderCard", () => {
  it("kein Ordner: Hinweis, kein Import-/Entfernen-Knopf; Freigabe wird gemerkt", async () => {
    const tree = await render();
    expect(textOf(tree)).toContain("Kein Ordner freigegeben");
    expect(countId(tree, "button-dji-folder-import")).toBe(0);
    expect(countId(tree, "button-dji-folder-remove")).toBe(0);
    expect(tree.root.findByProps({ testID: "switch-dji-folder-autocheck" }).props.value).toBe(false);

    mockRequestPermissions.mockResolvedValue({ granted: true, directoryUri: DOWNLOAD_TREE });
    mockReadDirectory.mockResolvedValue([child(DOWNLOAD_TREE, "DJIFlightRecord_a.txt")]);
    await press(tree, "button-dji-folder-choose");
    expect(mockRequestPermissions).toHaveBeenCalledWith(DJI_FLY_FLIGHTRECORD_DOC_URI);
    expect(await getDjiLogFolder()).toBe(DOWNLOAD_TREE); // gleicher Schlüssel wie im Logbuch
    const txt = textOf(tree);
    expect(txt).toContain("Download/FlightRecords");
    expect(txt).toContain("Zugriff OK");
  });

  it("Zugriff OK: Pfad, Anzahl, neue; Import öffnet das Logbuch mit Ordner", async () => {
    await AsyncStorage.setItem(DJI_LOG_FOLDER_STORAGE_KEY, DJI_FLY_TREE);
    mockReadDirectory.mockResolvedValue([
      child(DJI_FLY_TREE, "DJIFlightRecord_a.txt"),
      child(DJI_FLY_TREE, "DJIFlightRecord_b.txt"),
      child(DJI_FLY_TREE, "DJIFlightRecord_c.txt"),
    ]);
    mockLogbook.push({ djiLogs: [{ fileName: "DJIFlightRecord_a.txt", status: "parsed" }] });
    const tree = await render();
    expect(tree.root.findByProps({ testID: "text-dji-folder-path" }).props.children).toBe(
      "Android/data/dji.go.v5/files/FlightRecord",
    );
    const status = tree.root.findByProps({ testID: "text-dji-folder-status" }).props.children;
    expect(status).toBe("Zugriff OK · 3 Protokolle (.txt) · 2 noch nicht importiert");
    expect(countId(tree, "box-dji-folder-blocked")).toBe(0);

    await press(tree, "button-dji-folder-import");
    expect(mockNavigate).toHaveBeenCalledWith(
      "HistoryTab",
      expect.objectContaining({ screen: "DjiBulkImport", params: { autoImportAt: expect.any(Number) } }),
    );

    await press(tree, "button-dji-folder-remove");
    expect(await getDjiLogFolder()).toBeNull();
    expect(textOf(tree)).toContain("Kein Ordner freigegeben");
  });

  it("Zugriff verloren: Warnung, PC/USB-Ausweg und Download/FlightRecords-Vorschlag", async () => {
    await AsyncStorage.setItem(DJI_LOG_FOLDER_STORAGE_KEY, DJI_FLY_TREE);
    mockReadDirectory.mockRejectedValue(new Error("Permission Denial"));
    const tree = await render();
    expect(tree.root.findByProps({ testID: "text-dji-folder-status" }).props.children).toContain("Zugriff verloren");
    expect(tree.root.findByProps({ testID: "button-dji-folder-import" }).props.disabled).toBe(true);
    const txt = textOf(tree);
    expect(txt).toContain("USB-C");
    expect(txt).toContain("Download/FlightRecords");

    mockRequestPermissions.mockResolvedValue({ granted: true, directoryUri: DOWNLOAD_TREE });
    mockReadDirectory.mockResolvedValue([]);
    await press(tree, "button-dji-folder-download");
    expect(mockRequestPermissions).toHaveBeenCalledWith(DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI);
    expect(await getDjiLogFolder()).toBe(DOWNLOAD_TREE);
    expect(tree.root.findByProps({ testID: "text-dji-folder-status" }).props.children).toBe(
      "Zugriff OK · keine Flugprotokolle (.txt) gefunden",
    );
  });

  it("„DJI-Fly-Ordner vorschlagen“: verweigert → Erklärung und Rückfall Download/FlightRecords", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const tree = await render();
    mockRequestPermissions.mockResolvedValueOnce({ granted: false });
    await press(tree, "button-dji-folder-suggest");
    expect(mockRequestPermissions).toHaveBeenCalledWith(DJI_FLY_FLIGHTRECORD_DOC_URI);
    expect(countId(tree, "box-dji-folder-blocked")).toBe(1);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const fallback = buttons.find((b) => b.text.includes("Download/FlightRecords"))!;
    mockRequestPermissions.mockResolvedValueOnce({ granted: true, directoryUri: DOWNLOAD_TREE });
    await act(async () => fallback.onPress!());
    await flush();
    expect(mockRequestPermissions).toHaveBeenLastCalledWith(DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI);
    expect(await getDjiLogFolder()).toBe(DOWNLOAD_TREE);
    expect(countId(tree, "box-dji-folder-blocked")).toBe(0);
  });

  it("Schalter „automatisch prüfen“ wird gespeichert", async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: "switch-dji-folder-autocheck" }).props.onValueChange(true);
    });
    await flush();
    expect(tree.root.findByProps({ testID: "switch-dji-folder-autocheck" }).props.value).toBe(true);
    const fresh = await render();
    expect(fresh.root.findByProps({ testID: "switch-dji-folder-autocheck" }).props.value).toBe(true);
  });

  it("nicht Android: nur Hinweis", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const tree = await render();
    expect(countId(tree, "text-dji-folder-unsupported")).toBe(1);
    expect(countId(tree, "button-dji-folder-choose")).toBe(0);
  });

  it("Statustext", () => {
    expect(djiLogFolderStatusText({ ok: true, count: 1, newCount: 1 })).toBe(
      "Zugriff OK · 1 Protokoll (.txt) · 1 noch nicht importiert",
    );
    expect(djiLogFolderStatusText({ ok: false, count: 0, newCount: 0 })).toContain("verloren");
  });
});
