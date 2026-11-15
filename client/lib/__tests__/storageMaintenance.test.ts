// AsyncStorage-Entlastung (Gerätefehler „Session konnte nicht erstellt werden“):
// Datei-Cache (fileCache.ts, atomar), Migration der Cache-Schlüssel aus
// AsyncStorage (Nutzerdaten bleiben unangetastet), Retry nach Cache-Purge bei
// vollem Speicher, ausgelagerte Karten-Snapshots (userBlobs.ts).
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  __setSimpleFsForTests,
  decodeFileKey,
  encodeFileKey,
  type SimpleFs,
} from "../fileStoreFs";
import {
  __resetFileCacheForTests,
  fileCacheGet,
  fileCacheKeys,
  fileCacheRemove,
  fileCacheSet,
  fileCacheStorage,
  pruneFileCache,
  purgeFileCache,
} from "../fileCache";
import {
  isMovedCacheKey,
  isStorageFullError,
  isUserDataKey,
  migrateCachesToFiles,
  purgeAsyncStorageCaches,
  setItemResilient,
  StorageFullError,
  type KvStore,
} from "../storageMaintenance";
import {
  BLOB_MIN_LENGTH,
  BLOB_REF_PREFIX,
  collectBlobGarbage,
  externalizeBlobs,
  hasInlineBlobs,
  hydrateBlobs,
  hydrateBlobsOne,
  readAllUserBlobs,
  type BlobSpec,
} from "../userBlobs";

// ---------------------------------------------------------------------------
// In-Memory-Dateisystem (ersetzt expo-file-system über fileStoreFs)
// ---------------------------------------------------------------------------
interface MemFs extends SimpleFs {
  files: Map<string, { text: string; mtimeMs: number }>;
  failMove: boolean;
  clock: number;
}

function createMemFs(root = "file:///docs/"): MemFs {
  const files = new Map<string, { text: string; mtimeMs: number }>();
  const fs: MemFs = {
    root,
    files,
    failMove: false,
    clock: 1_000_000,
    async readText(p) {
      return files.get(p)?.text ?? null;
    },
    async writeText(p, text) {
      files.set(p, { text, mtimeMs: fs.clock });
    },
    async move(from, to) {
      if (fs.failMove) throw new Error("move failed");
      const f = files.get(from);
      if (!f) throw new Error("missing " + from);
      files.delete(from);
      files.set(to, f);
    },
    async remove(p) {
      const dir = p.endsWith("/") ? p : `${p}/`;
      for (const k of [...files.keys()])
        if (k === p || k.startsWith(dir)) files.delete(k);
    },
    async list(dir) {
      const d = dir.endsWith("/") ? dir : `${dir}/`;
      const names = new Set<string>();
      for (const k of files.keys()) {
        if (!k.startsWith(d)) continue;
        names.add(k.slice(d.length).split("/")[0]);
      }
      return [...names];
    },
    async mkdirp() {},
    async info(p) {
      const f = files.get(p);
      return f
        ? { exists: true, size: f.text.length, mtimeMs: f.mtimeMs }
        : { exists: false };
    },
  };
  return fs;
}

/** AsyncStorage-Attrappe; `tooBig` simuliert CursorWindow-Lesefehler. */
function createKv(
  initial: Record<string, string>,
  opts: { tooBig?: string[] } = {},
) {
  const data = new Map(Object.entries(initial));
  const removed: string[] = [];
  const kv: KvStore & { data: Map<string, string>; removed: string[] } = {
    data,
    removed,
    async getAllKeys() {
      return [...data.keys()];
    },
    async getItem(k) {
      if (opts.tooBig?.includes(k))
        throw new Error("Row too big to fit into CursorWindow");
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      data.set(k, v);
    },
    async removeItem(k) {
      removed.push(k);
      data.delete(k);
    },
  };
  return kv;
}

const USER_KEYS: Record<string, string> = {
  "@preflight/flight_sessions": JSON.stringify([{ id: "s1" }]),
  "@preflight/logbook": JSON.stringify([{ id: "l1" }]),
  "@preflight/drones": "[]",
  "@preflight/pilot_profile": "{}",
  "@preflight/settings": "{}",
  "@preflight/user_glossary": "[]",
  "@preflight/geozone_layers_FR": "{}",
  "@copterpilot/offline_countries": "[]",
  "@setupGuide/state_local": "completed",
};

let mem: MemFs;
beforeEach(() => {
  mem = createMemFs();
  __setSimpleFsForTests(mem);
  __resetFileCacheForTests();
});
afterEach(() => {
  __setSimpleFsForTests(undefined);
  __resetFileCacheForTests();
});

// ---------------------------------------------------------------------------
describe("fileCache", () => {
  it("Schlüssel-Kodierung ist dateisicher und umkehrbar", () => {
    for (const k of [
      "dipul_wfs_layer_v1:temporaere_betriebseinschraenkungen",
      "odc1:weather:52.5_13.4",
      "dc_dipul_nearby_-0.1_8",
      "a/b\\c~d ä",
    ]) {
      const enc = encodeFileKey(k);
      assert.match(enc, /^[A-Za-z0-9._~-]+$/);
      assert.equal(decodeFileKey(enc), k);
    }
  });

  it("Round-Trip: set → get → keys → remove", async () => {
    await fileCacheSet("dc_dipul_all", '{"a":1}');
    await fileCacheSet("odc1:weather:x", "w");
    assert.equal(await fileCacheGet("dc_dipul_all"), '{"a":1}');
    assert.deepEqual((await fileCacheKeys()).sort(), [
      "dc_dipul_all",
      "odc1:weather:x",
    ]);
    assert.deepEqual(await fileCacheKeys("dc_"), ["dc_dipul_all"]);
    await fileCacheRemove("dc_dipul_all");
    assert.equal(await fileCacheGet("dc_dipul_all"), null);
    // AsyncStorage-förmige Sicht
    await fileCacheStorage.setItem("k", "v");
    assert.equal(await fileCacheStorage.getItem("k"), "v");
    // Dateien liegen unter documentDirectory/kv-cache/, keine .tmp-Reste
    const paths = [...mem.files.keys()];
    assert.ok(
      paths.every(
        (p) => p.startsWith("file:///docs/kv-cache/") && p.endsWith(".json"),
      ),
      paths.join(),
    );
  });

  it("schreibt atomar: scheitert das Verschieben, bleibt der alte Wert erhalten", async () => {
    await fileCacheSet("dc_x", "alt");
    mem.failMove = true;
    await assert.rejects(fileCacheSet("dc_x", "neu"));
    mem.failMove = false;
    assert.equal(await fileCacheGet("dc_x"), "alt");
    assert.ok(
      ![...mem.files.keys()].some((p) => p.endsWith(".tmp")),
      "keine tmp-Datei übrig",
    );
  });

  it("parallele Schreibvorgänge desselben Schlüssels: der letzte gewinnt", async () => {
    await Promise.all([
      fileCacheSet("k", "1"),
      fileCacheSet("k", "2"),
      fileCacheSet("k", "3"),
    ]);
    assert.equal(await fileCacheGet("k"), "3");
  });

  it("prune nach Alter und purge leeren nur den Cache-Ordner", async () => {
    await mem.writeText(
      "file:///docs/user-blobs/sessions/s1.mapSnapshotBase64.b64",
      "BILD",
    );
    mem.clock = 0;
    await fileCacheSet("dc_old", "o");
    mem.clock = 10_000;
    await fileCacheSet("dc_new", "n");
    assert.equal(await pruneFileCache("dc_", 5_000, 12_000), 1);
    assert.deepEqual(await fileCacheKeys(), ["dc_new"]);
    await purgeFileCache();
    assert.deepEqual(await fileCacheKeys(), []);
    assert.equal(
      await mem.readText(
        "file:///docs/user-blobs/sessions/s1.mapSnapshotBase64.b64",
      ),
      "BILD",
    );
  });

  it("ohne Dateisystem (Web): In-Memory-Rückfall", async () => {
    __setSimpleFsForTests(null);
    await fileCacheSet("a", "1");
    assert.equal(await fileCacheGet("a"), "1");
    assert.deepEqual(await fileCacheKeys(), ["a"]);
  });
});

// ---------------------------------------------------------------------------
describe("Migration der Cache-Schlüssel aus AsyncStorage", () => {
  it("klassifiziert Cache- und Nutzerdaten-Schlüssel", () => {
    for (const k of Object.keys(USER_KEYS)) {
      assert.equal(isUserDataKey(k), true, k);
      assert.equal(isMovedCacheKey(k), false, k);
    }
    for (const k of [
      "dipul_wfs_layer_v1:temporaere_betriebseinschraenkungen",
      "dc_dipul_all",
      "dc_dipul_nearby_52.5_13.4",
      "odc1:notams:x",
      "odc1_index",
    ]) {
      assert.equal(isMovedCacheKey(k), true, k);
      assert.equal(isUserDataKey(k), false, k);
    }
    // Server-Spiegel sind keine (lokalen) Nutzerdaten
    assert.equal(isUserDataKey("@preflight/snap/flight_sessions_v1"), false);
  });

  it("verschiebt Caches in Dateien, verwirft unlesbare, lässt Nutzerdaten unangetastet", async () => {
    const kv = createKv(
      {
        ...USER_KEYS,
        "dipul_wfs_layer_v1:temporaere_betriebseinschraenkungen": '[{"f":1}]',
        dc_dipul_all: '{"data":1,"ts":1}',
        "odc1:weather:a": '{"data":2,"fetchedAt":1}',
        odc1_index: "{}",
        "dipul_wfs_layer_v1:edr": "riesig",
        "@easa/rules_v1": "alt",
        "@preflight/snap/logbook_v1": "{}",
      },
      { tooBig: ["dipul_wfs_layer_v1:edr"] },
    );
    const r = await migrateCachesToFiles(kv, fileCacheStorage);

    assert.deepEqual(
      r.moved.sort(),
      [
        "dc_dipul_all",
        "dipul_wfs_layer_v1:temporaere_betriebseinschraenkungen",
        "odc1:weather:a",
        "odc1_index",
      ].sort(),
    );
    assert.deepEqual(r.dropped.sort(), [
      "@easa/rules_v1",
      "dipul_wfs_layer_v1:edr",
    ]);
    assert.equal(
      await fileCacheGet(
        "dipul_wfs_layer_v1:temporaere_betriebseinschraenkungen",
      ),
      '[{"f":1}]',
    );
    assert.equal(await fileCacheGet("dc_dipul_all"), '{"data":1,"ts":1}');
    assert.equal(await fileCacheGet("dipul_wfs_layer_v1:edr"), null);

    // Nutzerdaten: weder gelesen-und-entfernt noch verändert
    for (const [k, v] of Object.entries(USER_KEYS))
      assert.equal(kv.data.get(k), v, k);
    assert.ok(!kv.removed.some((k) => isUserDataKey(k)), kv.removed.join());
    // Server-Spiegel bleiben bei der Migration stehen (nur Purge entfernt sie)
    assert.ok(kv.data.has("@preflight/snap/logbook_v1"));
    // nichts Cache-artiges mehr in AsyncStorage
    assert.deepEqual([...kv.data.keys()].filter(isMovedCacheKey), []);
  });

  it("überschreibt keinen neueren Datei-Eintrag und ist idempotent", async () => {
    await fileCacheSet("dc_dipul_all", "neu");
    const kv = createKv({ ...USER_KEYS, dc_dipul_all: "alt" });
    await migrateCachesToFiles(kv, fileCacheStorage);
    assert.equal(await fileCacheGet("dc_dipul_all"), "neu");
    assert.equal(kv.data.has("dc_dipul_all"), false);
    const again = await migrateCachesToFiles(kv, fileCacheStorage);
    assert.deepEqual(again, { moved: [], dropped: [] });
    assert.equal(kv.data.size, Object.keys(USER_KEYS).length);
  });
});

// ---------------------------------------------------------------------------
describe("Nutzerdaten schreiben: Retry nach Cache-Purge", () => {
  it("erkennt „Speicher voll“-Fehler", () => {
    assert.equal(
      isStorageFullError(
        new Error("database or disk is full (code 13 SQLITE_FULL)"),
      ),
      true,
    );
    assert.equal(isStorageFullError(new Error("SQLITE_FULL")), true);
    assert.equal(
      isStorageFullError(new Error("ENOSPC: no space left on device")),
      true,
    );
    assert.equal(isStorageFullError(new Error("QuotaExceededError")), true);
    assert.equal(
      isStorageFullError(new Error("Network request failed")),
      false,
    );
  });

  it("voll → Caches leeren → einmal erneut schreiben (erfolgreich), Nutzerdaten bleiben", async () => {
    const kv = createKv({
      ...USER_KEYS,
      "dipul_wfs_layer_v1:x": "big",
      "@preflight/snap/logbook_v1": "{}",
      "@easa/rules_v1": "x",
    });
    let calls = 0;
    const realSet = kv.setItem.bind(kv);
    kv.setItem = async (k, v) => {
      calls++;
      // voll, solange noch Caches drin liegen
      if (kv.data.has("dipul_wfs_layer_v1:x"))
        throw new Error("database or disk is full (code 13 SQLITE_FULL)");
      await realSet(k, v);
    };
    let purged = 0;
    await setItemResilient(
      kv,
      "@preflight/flight_sessions",
      '[{"id":"s1"},{"id":"s2"}]',
      async () => {
        purged++;
        await purgeAsyncStorageCaches(kv);
      },
    );
    assert.equal(purged, 1);
    assert.equal(calls, 2);
    assert.equal(
      kv.data.get("@preflight/flight_sessions"),
      '[{"id":"s1"},{"id":"s2"}]',
    );
    assert.equal(kv.data.has("dipul_wfs_layer_v1:x"), false);
    assert.equal(kv.data.has("@preflight/snap/logbook_v1"), false);
    for (const k of Object.keys(USER_KEYS)) assert.ok(kv.data.has(k), k);
    assert.ok(!kv.removed.some((k) => isUserDataKey(k)), kv.removed.join());
  });

  it("bleibt es voll: verständlicher Fehler, nur ein Retry", async () => {
    const kv = createKv({});
    let calls = 0;
    kv.setItem = async () => {
      calls++;
      throw new Error("database or disk is full");
    };
    await assert.rejects(
      setItemResilient(kv, "@preflight/flight_sessions", "[]", async () => {}),
      (e: unknown) => {
        assert.ok(e instanceof StorageFullError);
        assert.match((e as Error).message, /Gerätespeicher voll/);
        return true;
      },
    );
    assert.equal(calls, 2);
  });

  it("andere Fehler: kein Purge, Fehler unverändert", async () => {
    const kv = createKv({});
    kv.setItem = async () => {
      throw new Error("boom");
    };
    let purged = 0;
    await assert.rejects(
      setItemResilient(kv, "k", "v", async () => {
        purged++;
      }),
      /boom/,
    );
    assert.equal(purged, 0);
  });
});

// ---------------------------------------------------------------------------
describe("userBlobs: Karten-Snapshots aus flight_sessions auslagern", () => {
  const SPEC: BlobSpec = {
    ns: "sessions",
    fields: [["mapSnapshotBase64"], ["trafficLog", "mapSnapshotBase64"]],
  };
  const big = (c: string) => c.repeat(BLOB_MIN_LENGTH + 10);

  it("lagert große Felder aus, lässt Eingabe unverändert und lädt sie wieder", async () => {
    const sessions = [
      {
        id: "s1",
        mapSnapshotBase64: big("A"),
        trafficLog: { startTime: 1, mapSnapshotBase64: big("T") },
      },
      { id: "s2", mapSnapshotBase64: "klein" },
      { id: "s3" },
    ];
    const stored = await externalizeBlobs(SPEC, sessions);
    // Eingabe nicht verändert
    assert.equal(sessions[0].mapSnapshotBase64, big("A"));
    assert.ok(String(stored[0].mapSnapshotBase64).startsWith(BLOB_REF_PREFIX));
    assert.ok(
      String(stored[0].trafficLog?.mapSnapshotBase64).startsWith(
        BLOB_REF_PREFIX,
      ),
    );
    assert.equal(stored[0].trafficLog?.startTime, 1);
    assert.equal(stored[1].mapSnapshotBase64, "klein");
    assert.ok(
      JSON.stringify(stored).length < 1000,
      "gespeicherter Wert bleibt klein",
    );
    assert.equal(hasInlineBlobs(SPEC, stored), false);
    assert.equal(hasInlineBlobs(SPEC, sessions), true);

    const back = await hydrateBlobs(SPEC, stored);
    assert.deepEqual(back, sessions);

    // Bereits ausgelagert → kein erneutes Schreiben nötig, Verweis bleibt
    const again = await externalizeBlobs(SPEC, stored);
    assert.deepEqual(again, stored);

    // Export enthält die Dateien
    const all = await readAllUserBlobs();
    assert.equal(Object.keys(all).length, 2);
  });

  it("alte Sessions ohne Verweise (Altbestand) bleiben lesbar", async () => {
    const legacy = {
      id: "old",
      mapSnapshotBase64: big("L"),
      planning: { plannedDate: "2026-01-01" },
    };
    assert.deepEqual(await hydrateBlobsOne(SPEC, legacy), legacy);
  });

  it("fehlende Datei → Feld entfällt statt kaputtem Verweis", async () => {
    const stored = await externalizeBlobs(SPEC, [
      { id: "s1", mapSnapshotBase64: big("A") },
    ]);
    await mem.remove("file:///docs/user-blobs/");
    const back = await hydrateBlobsOne(SPEC, stored[0]);
    assert.equal("mapSnapshotBase64" in back, false);
  });

  it("Schreibfehler → Wert bleibt inline (kein Datenverlust)", async () => {
    mem.failMove = true;
    const stored = await externalizeBlobs(SPEC, [
      { id: "s1", mapSnapshotBase64: big("A") },
    ]);
    assert.equal(stored[0].mapSnapshotBase64, big("A"));
  });

  it("Verweis auf fremde Datei (Session → Logbuch kopiert) wird als eigene Kopie abgelegt", async () => {
    const [session] = await externalizeBlobs(SPEC, [
      { id: "s1", mapSnapshotBase64: big("A") },
    ]);
    const LOG: BlobSpec = { ns: "logbook", fields: [["mapSnapshotBase64"]] };
    const [entry] = await externalizeBlobs(LOG, [
      { id: "l1", mapSnapshotBase64: session.mapSnapshotBase64 },
    ]);
    assert.match(String(entry.mapSnapshotBase64), /^blobref:v1:logbook\//);
    // Session-Datei weg (GC) → Logbuch-Bild bleibt
    await mem.remove("file:///docs/user-blobs/sessions/");
    assert.equal(
      (await hydrateBlobsOne(LOG, entry)).mapSnapshotBase64,
      big("A"),
    );
  });

  it("GC entfernt nur unreferenzierte und ausreichend alte Dateien", async () => {
    mem.clock = 0;
    const stored = await externalizeBlobs(SPEC, [
      { id: "keep", mapSnapshotBase64: big("K") },
      { id: "gone", mapSnapshotBase64: big("G") },
    ]);
    mem.clock = 100;
    await externalizeBlobs(SPEC, [
      { id: "fresh", mapSnapshotBase64: big("F") },
    ]);
    // nur "keep" ist noch gespeichert
    const removed = await collectBlobGarbage(SPEC, [stored[0]], {
      minAgeMs: 50,
      now: 120,
    });
    assert.equal(removed, 1);
    const left = Object.keys(await readAllUserBlobs()).sort();
    assert.deepEqual(left, [
      "sessions/fresh.mapSnapshotBase64.b64",
      "sessions/keep.mapSnapshotBase64.b64",
    ]);
  });
});
