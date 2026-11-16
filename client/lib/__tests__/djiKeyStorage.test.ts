// DJI-API-Schlüssel nur im SecureStore, Keychain-Cache je Log (offline erneut
// auswerten), Ablauf mit Cache/Abruf und Auslagerung der DJI-Logs aus dem
// AsyncStorage-Wert des Logbuchs.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DJI_API_KEY_STORE_KEY,
  __setDjiSecureStoreForTests,
  clearDjiApiKey,
  getDjiApiKey,
  hasDjiApiKey,
  maskDjiApiKey,
  verifyAndSaveDjiApiKey,
  type SecureKv,
} from "../djiApiKeyStore";
import {
  DJI_KEYCHAIN_DIR,
  __clearKeychainMemoryForTests,
  getCachedKeychains,
  removeCachedKeychains,
  setCachedKeychains,
} from "../djiKeychainCache";
import type { SimpleFs } from "../fileStoreFs";
import {
  analyzeDjiLogSource,
  type DjiAnalyzerDeps,
  type DjiWorkerLike,
} from "../djiLogAnalyzer";
import { DjiWorkerError } from "../djiLogWorkerClient";
import {
  DJI_ROW_COLUMNS,
  type DjiInspectInfo,
  type DjiKeychains,
  type DjiParseSummary,
} from "../djiLogWorkerProtocol";
import { djiKeychainErrorMessage, DjiKeychainError } from "../djiKeychainApi";
import {
  BLOB_REF_PREFIX,
  externalizeBlobs,
  hasInlineBlobs,
  hydrateBlobs,
  collectBlobGarbage,
  type BlobSpec,
} from "../userBlobs";

function memKv(): SecureKv & { data: Map<string, string>; sets: number } {
  const data = new Map<string, string>();
  const kv = {
    data,
    sets: 0,
    async getItemAsync(k: string) {
      return data.get(k) ?? null;
    },
    async setItemAsync(k: string, v: string) {
      kv.sets++;
      data.set(k, v);
    },
    async deleteItemAsync(k: string) {
      data.delete(k);
    },
  };
  return kv;
}

function memFs(
  root = "file:///docs/",
): SimpleFs & { files: Map<string, { text: string; mtimeMs: number }> } {
  const files = new Map<string, { text: string; mtimeMs: number }>();
  return {
    root,
    files,
    async readText(p) {
      return files.get(p)?.text ?? null;
    },
    async writeText(p, text) {
      files.set(p, { text, mtimeMs: 0 });
    },
    async move(from, to) {
      const f = files.get(from);
      if (!f) throw new Error("missing");
      files.delete(from);
      files.set(to, f);
    },
    async remove(p) {
      const dir = p.endsWith("/") ? p : `${p}/`;
      for (const k of [...files.keys()])
        if (k === p || k.startsWith(dir)) files.delete(k);
    },
    async list(dir) {
      const out = new Set<string>();
      for (const k of files.keys())
        if (k.startsWith(dir)) out.add(k.slice(dir.length).split("/")[0]);
      return [...out];
    },
    async mkdirp() {},
    async info(p) {
      const f = files.get(p);
      return f
        ? { exists: true, size: f.text.length, mtimeMs: f.mtimeMs }
        : { exists: false };
    },
  };
}

const okFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ result: { code: 1, msg: "keychainsArray is empty" } }),
});

describe("DJI-API-Schlüssel – nur SecureStore", () => {
  let kv: ReturnType<typeof memKv>;
  beforeEach(() => {
    kv = memKv();
    __setDjiSecureStoreForTests(kv);
  });
  afterEach(() => __setDjiSecureStoreForTests(null));

  it("Prüfen & speichern legt den Schlüssel im SecureStore ab", async () => {
    const r = await verifyAndSaveDjiApiKey("  abcdEFGH1234  ", {
      fetchImpl: okFetch,
    });
    assert.deepEqual(r, { ok: true, verified: true });
    assert.equal(kv.data.get(DJI_API_KEY_STORE_KEY), "abcdEFGH1234");
    assert.equal(await getDjiApiKey(), "abcdEFGH1234");
    assert.equal(await hasDjiApiKey(), true);
  });

  it("abgelehnter Schlüssel wird nicht gespeichert", async () => {
    const r = await verifyAndSaveDjiApiKey("abcdEFGH1234", {
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        json: async () => ({}),
      }),
    });
    assert.equal(r.ok, false);
    assert.equal(kv.sets, 0);
    assert.equal(await getDjiApiKey(), null);
  });

  it("Entfernen löscht ihn aus dem SecureStore", async () => {
    await verifyAndSaveDjiApiKey("abcdEFGH1234", { fetchImpl: okFetch });
    await clearDjiApiKey();
    assert.equal(kv.data.size, 0);
    assert.equal(await getDjiApiKey(), null);
  });

  it("Anzeige nur maskiert", () => {
    assert.equal(maskDjiApiKey("abcdEFGH1234"), "••••••••1234");
    assert.equal(maskDjiApiKey(""), "");
  });

  it("Quelltext: kein AsyncStorage und keine Konsolen-Ausgabe in der Schlüssel-Verarbeitung", () => {
    const files = [
      "../djiApiKeyStore.ts",
      "../djiKeychainApi.ts",
      "../../components/DjiApiKeyCard.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), "utf8");
      assert.ok(
        !/@react-native-async-storage|AsyncStorage\.|localStorage/.test(src),
        `${f} darf AsyncStorage nicht verwenden`,
      );
      assert.ok(
        !/console\.(log|warn|error|info|debug)/.test(src),
        `${f} darf nichts protokollieren`,
      );
    }
    const store = readFileSync(join(__dirname, "../djiApiKeyStore.ts"), "utf8");
    assert.ok(store.includes('require("expo-secure-store")'));
  });
});

describe("Keychain-Cache je Log", () => {
  beforeEach(() => __clearKeychainMemoryForTests());
  const KC: DjiKeychains = [
    [
      {
        featurePoint: "FR_Standardization_Feature_Base_1",
        aesKey: "a2V5",
        aesIv: "aXY=",
      },
    ],
  ];

  it("speichert als Datei unter dji-keychains/ und liest nach Neustart wieder", async () => {
    const fs = memFs();
    await setCachedKeychains("v14-398567-abc-SN-2024:01", KC, fs);
    const names = [...fs.files.keys()].filter((k) =>
      k.startsWith(`file:///docs/${DJI_KEYCHAIN_DIR}`),
    );
    assert.equal(names.length, 1);
    assert.ok(!names[0].includes(":01"), "Dateiname kodiert");
    __clearKeychainMemoryForTests(); // „App-Neustart“
    assert.deepEqual(
      await getCachedKeychains("v14-398567-abc-SN-2024:01", fs),
      KC,
    );
    await removeCachedKeychains("v14-398567-abc-SN-2024:01", fs);
    __clearKeychainMemoryForTests();
    assert.equal(
      await getCachedKeychains("v14-398567-abc-SN-2024:01", fs),
      null,
    );
  });

  it("kaputte Datei → kein Treffer", async () => {
    const fs = memFs();
    await setCachedKeychains("fp", KC, fs);
    for (const k of fs.files.keys())
      fs.files.set(k, { text: "{kaputt", mtimeMs: 0 });
    __clearKeychainMemoryForTests();
    assert.equal(await getCachedKeychains("fp", fs), null);
  });
});

// ---------------------------------------------------------------------------
// Ablauf mit Schlüsseln (Stub-Worker, damit Erfolg simuliert werden kann)
// ---------------------------------------------------------------------------

const INFO: DjiInspectInfo = {
  version: 14,
  byteLength: 10,
  fingerprint: "fp-1",
  details: {
    startTime: "2025-05-01T10:00:00Z",
    latitude: 50,
    longitude: 8,
    totalTime: 300,
    maxHeight: 80,
    productType: "Mini4Pro",
    batterySn: "BAT1234",
  },
  keychainsRequired: true,
  keychainsRequest: {
    version: 4,
    department: 3,
    keychainsArray: [
      [
        {
          featurePoint: "FR_Standardization_Feature_Base_1",
          aesCiphertext: "QUJD",
        },
      ],
    ],
  },
};

const SUMMARY: DjiParseSummary = {
  version: 14,
  columns: [...DJI_ROW_COLUMNS],
  details: INFO.details,
  stats: {
    frameCount: 2,
    durationSec: 300,
    maxHeightM: 80,
    distanceM: 1200,
    batteryStartPercent: 98,
    batteryEndPercent: 30,
    batteryMinPercent: 30,
  },
  battery: { batterySn: "BAT1234", cycleCount: 12 },
  messages: [],
  rowStride: 1,
};

function stubWorker(
  parseImpl: (kc: DjiKeychains | null | undefined) => Promise<void>,
): DjiWorkerLike & {
  parses: (DjiKeychains | null | undefined)[];
  released: string[];
} {
  const w = {
    parses: [] as (DjiKeychains | null | undefined)[],
    released: [] as string[],
    async upload(
      _j: string,
      _n: string,
      read: (i: number) => Promise<string | null>,
    ) {
      let i = 0;
      while (await read(i)) i++;
      return i;
    },
    async inspect() {
      return INFO;
    },
    async parse(_j: string, kc?: DjiKeychains | null) {
      w.parses.push(kc);
      await parseImpl(kc);
      const row = new Array(DJI_ROW_COLUMNS.length).fill(null);
      row[0] = 1;
      row[2] = 50;
      row[3] = 8;
      return { summary: SUMMARY, rows: [row, [...row]] };
    },
    release(j: string) {
      w.released.push(j);
    },
  };
  return w;
}

const src = () => ({
  fileName: "DJIFlightRecord_x.txt",
  sizeBytes: 10,
  readChunk: async (i: number) => (i === 0 ? "AAAAAAAAAAAAAA==" : null),
});

function memCache() {
  const m = new Map<string, DjiKeychains>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: DjiKeychains) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
  };
}

describe("Analyse-Ablauf v13+ mit Schlüssel-Cache", () => {
  const KC: DjiKeychains = [
    [
      {
        featurePoint: "FR_Standardization_Feature_Base_1",
        aesKey: "a2V5",
        aesIv: "aXY=",
      },
    ],
  ];

  it("1. Mal: Abruf bei DJI und Cache; 2. Mal: offline aus dem Cache", async () => {
    const cache = memCache();
    let fetches = 0;
    const deps = (worker: DjiWorkerLike): DjiAnalyzerDeps => ({
      worker,
      getApiKey: async () => "abcdEFGH1234",
      fetchKeychains: async (key, req) => {
        fetches++;
        assert.equal(key, "abcdEFGH1234");
        assert.deepEqual(req, INFO.keychainsRequest);
        return KC;
      },
      cache,
    });
    const w1 = stubWorker(async () => {});
    const r1 = await analyzeDjiLogSource(src(), deps(w1));
    assert.equal(r1.meta.status, "parsed");
    assert.equal(r1.meta.keychainSource, "api");
    assert.equal(r1.meta.batteryCycleCount, 12);
    assert.deepEqual(w1.parses, [KC]);
    assert.equal(w1.released.length, 1);
    assert.deepEqual(cache.m.get("fp-1"), KC);

    const w2 = stubWorker(async () => {});
    const offline = {
      ...deps(w2),
      fetchKeychains: async () => {
        throw new DjiKeychainError("offline");
      },
    };
    const r2 = await analyzeDjiLogSource(src(), offline);
    assert.equal(r2.meta.status, "parsed");
    assert.equal(r2.meta.keychainSource, "cache");
    assert.equal(fetches, 1);
  });

  it("veraltete Schlüssel im Cache → verworfen, einmal neu abgerufen", async () => {
    const cache = memCache();
    cache.m.set("fp-1", [
      [
        {
          featurePoint: "FR_Standardization_Feature_Base_1",
          aesKey: "alt",
          aesIv: "alt",
        },
      ],
    ]);
    let first = true;
    const w = stubWorker(async () => {
      if (first) {
        first = false;
        throw new DjiWorkerError("decrypt_failed", "x");
      }
    });
    const r = await analyzeDjiLogSource(src(), {
      worker: w,
      getApiKey: async () => "abcdEFGH1234",
      fetchKeychains: async () => KC,
      cache,
    });
    assert.equal(r.meta.status, "parsed");
    assert.equal(r.meta.keychainSource, "api");
    assert.equal(w.parses.length, 2);
    assert.deepEqual(cache.m.get("fp-1"), KC);
  });

  it("Kontingent erschöpft → undecryptable mit deutscher Meldung, Basis-Kennzahlen", async () => {
    const w = stubWorker(async () => {});
    const r = await analyzeDjiLogSource(src(), {
      worker: w,
      getApiKey: async () => "abcdEFGH1234",
      fetchKeychains: async () => {
        throw new DjiKeychainError("quota");
      },
      cache: memCache(),
    });
    assert.equal(r.meta.status, "undecryptable");
    assert.equal(r.meta.message, djiKeychainErrorMessage("quota"));
    assert.equal(r.meta.durationSec, 300);
    assert.equal(r.meta.batterySn, "BAT1234");
    assert.equal(w.parses.length, 0);
    assert.equal(w.released.length, 1);
  });

  it("Worker-Fehler werden zu deutschen Meldungen", async () => {
    const w = stubWorker(async () => {});
    w.inspect = async () => {
      throw new DjiWorkerError("not_a_log", "bad magic");
    };
    await assert.rejects(
      analyzeDjiLogSource(src(), {
        worker: w,
        getApiKey: async () => null,
        fetchKeychains: async () => KC,
        cache: memCache(),
      }),
      /Keine gültige DJI-Flugprotokoll-Datei/,
    );
    assert.equal(w.released.length, 1);
  });

  it("zu große Datei wird abgelehnt, bevor gelesen wird", async () => {
    const w = stubWorker(async () => {});
    await assert.rejects(
      analyzeDjiLogSource(
        { ...src(), sizeBytes: 500 * 1024 * 1024 },
        {
          worker: w,
          getApiKey: async () => null,
          fetchKeychains: async () => KC,
          cache: memCache(),
        },
      ),
      /zu groß/,
    );
  });
});

describe("Logbuch: DJI-Logs als JSON-Datei statt im AsyncStorage-Wert", () => {
  const SPEC: BlobSpec = {
    ns: "logbook",
    fields: [["mapSnapshotBase64"]],
    jsonFields: [["djiLogs"], ["gpsTrack"]],
  };
  const bigLogs = [
    {
      status: "parsed",
      fileName: "a.txt",
      objectPath: "local-dji:a",
      records: Array.from({ length: 400 }, (_, i) => ({
        t: i,
        lat: 50 + i / 1e5,
        lon: 8,
        heightM: 20,
      })),
    },
  ];

  it("große djiLogs werden ausgelagert und beim Lesen wieder zu Objekten", async () => {
    const fs = memFs();
    const items = [
      { id: "e1", djiLogs: bigLogs, gpsTrack: [{ lat: 1, lon: 2 }] },
    ];
    assert.equal(hasInlineBlobs(SPEC, items), true);
    const stored = await externalizeBlobs(SPEC, items, fs);
    assert.ok(
      typeof stored[0].djiLogs === "string" &&
        (stored[0].djiLogs as unknown as string).startsWith(BLOB_REF_PREFIX),
    );
    // kleiner Track bleibt inline
    assert.deepEqual(stored[0].gpsTrack, [{ lat: 1, lon: 2 }]);
    assert.ok(
      JSON.stringify(stored).length < 1000,
      "AsyncStorage-Wert bleibt klein",
    );
    assert.equal(hasInlineBlobs(SPEC, stored), false);
    const back = await hydrateBlobs(SPEC, stored, fs);
    assert.deepEqual(back, items);
    // erneutes Speichern ohne Änderung schreibt nichts neu
    const before = fs.files.size;
    await externalizeBlobs(SPEC, stored, fs);
    assert.equal(fs.files.size, before);
    // GC behält referenzierte JSON-Dateien
    fs.files.forEach((f) => (f.mtimeMs = 0));
    assert.equal(
      await collectBlobGarbage(SPEC, stored, { fs, now: 10 * 3600 * 1000 }),
      0,
    );
  });

  it("alte Datensätze mit Inline-djiLogs laden unverändert", async () => {
    const fs = memFs();
    const old = [
      {
        id: "e2",
        djiLog: { status: "parsed", fileName: "b.txt", objectPath: "x" },
      },
    ];
    assert.deepEqual(await hydrateBlobs(SPEC, old, fs), old);
  });
});
