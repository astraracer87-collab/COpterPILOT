// „Meine Daten“ → App-Speicher: echte Größe statt „ca. 0 B“.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatBytes,
  measureDocumentDirectory,
  measureKeyValueStore,
  utf8Length,
} from "../storageUsage";

describe("utf8Length", () => {
  it("zählt Umlaute und Emojis als UTF-8-Bytes", () => {
    assert.equal(utf8Length("abc"), 3);
    assert.equal(utf8Length("ä"), 2);
    assert.equal(utf8Length("€"), 3);
    assert.equal(utf8Length("🇩🇪"), 8);
  });
});

describe("formatBytes", () => {
  it("formatiert deutsch mit Komma", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(5.5 * 1024 * 1024), "5,5 MB");
    assert.equal(formatBytes(3 * 1024 * 1024 * 1024), "3,00 GB");
  });
});

describe("measureKeyValueStore", () => {
  it("summiert Schlüssel und Werte; ein nicht lesbarer Wert verdirbt die Summe nicht", async () => {
    const data: Record<string, string> = { a: "x".repeat(1000), b: "ü".repeat(10) };
    const store = {
      getAllKeys: async () => ["a", "b", "huge"],
      getItem: async (k: string) => {
        if (k === "huge") throw new Error("Row too big to fit into CursorWindow");
        return data[k] ?? null;
      },
    };
    const usage = await measureKeyValueStore(store);
    assert.equal(usage.keys, 3);
    assert.equal(usage.unreadable, 1);
    // Schlüssel (1+1+4) + Werte (1000 + 20)
    assert.equal(usage.bytes, 6 + 1000 + 20);
  });
});

describe("measureDocumentDirectory", () => {
  it("teilt nach bekannten Ordnern auf und fasst den Rest zusammen", async () => {
    const sizes: Record<string, number> = {
      "file:///doc/tiles": 50 * 1024 * 1024,
      "file:///doc/geozone-tiles": 8 * 1024 * 1024,
      "file:///doc/obstacles": 1024,
      "file:///doc/irgendwas.json": 300,
    };
    const fs = {
      readDirectoryAsync: async () => ["tiles", "geozone-tiles", "obstacles", "irgendwas.json"],
      getInfoAsync: async (uri: string) => ({ exists: uri in sizes, size: sizes[uri] }),
    };
    const usage = await measureDocumentDirectory(fs, "file:///doc/");
    assert.equal(usage.bytes, 50 * 1024 * 1024 + 8 * 1024 * 1024 + 1024 + 300);
    assert.deepEqual(
      usage.parts.map((p) => p.label),
      ["Offline-Karten", "Geozonen (offline)", "Hindernisse", "Sonstige Dateien"],
    );
  });

  it("ohne documentDirectory oder bei Fehlern 0", async () => {
    const failing = {
      readDirectoryAsync: async () => {
        throw new Error("nope");
      },
      getInfoAsync: async () => ({ exists: false }),
    };
    assert.deepEqual(await measureDocumentDirectory(failing, null), { bytes: 0, parts: [] });
    assert.deepEqual(await measureDocumentDirectory(failing, "file:///doc/"), { bytes: 0, parts: [] });
  });
});
