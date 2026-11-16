// DJI-Flugprotokolle auf dem Gerät: Nachrichtenprotokoll App ↔ Worker-WebView
// und Ende-zu-Ende-Auswertung echter, frei lizenzierter Protokolle (siehe
// fixtures-dji/LICENSE.md). Der Worker läuft hier exakt wie in der WebView –
// Parser-WebAssembly (MVP-kompatibel umgebaut) + Worker-Skript in einem
// vm-Kontext, Nachrichten als injiziertes JS bzw. JSON-Strings.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createWorkerVm } from "./helpers/djiWorkerVm";
import { DjiWorkerClient, DjiWorkerError } from "../djiLogWorkerClient";
import {
  DJI_CHUNK_BYTES,
  DJI_ROW_COLUMNS,
  base64ByteLength,
  chunkCount,
  decodeWorkerResponse,
  encodeWorkerRequest,
  rowToObject,
} from "../djiLogWorkerProtocol";
import { buildDjiWorkerHtml } from "../djiLogWorkerScript";
import {
  DJI_LOG_PARSER_JS,
  DJI_LOG_PARSER_VERSION,
} from "../djiLogParserBundle";
import {
  analyzeDjiLogSource,
  type DjiAnalyzerDeps,
  type DjiLogSource,
} from "../djiLogAnalyzer";
import { djiKeychainErrorMessage } from "../djiKeychainApi";

const FIX = join(__dirname, "fixtures-dji");
const V11 = "DJIFlightRecord_2018-06-19_v11_mavic-air.txt";
const V9 = "DJIFlightRecord_2017-10-10_v9_short.txt";
const V14 = "DJIFlightRecord_2024-09-01_v14_encrypted.txt";

function connect(overrides = {}) {
  const vmw = createWorkerVm(overrides);
  const client = new DjiWorkerClient((m) => vmw.send(m));
  vmw.onMessage = (raw) => client.handleRaw(raw);
  return { vmw, client };
}

function source(
  name: string,
  chunkBytes = DJI_CHUNK_BYTES,
): DjiLogSource & { reads: number } {
  const buf = readFileSync(join(FIX, name));
  const src = {
    fileName: name,
    sizeBytes: buf.length,
    reads: 0,
    async readChunk(i: number) {
      src.reads++;
      const part = buf.subarray(i * chunkBytes, (i + 1) * chunkBytes);
      return part.length ? part.toString("base64") : null;
    },
  };
  return src;
}

function deps(
  client: DjiWorkerClient,
  extra: Partial<DjiAnalyzerDeps> = {},
): DjiAnalyzerDeps {
  return {
    worker: client,
    getApiKey: async () => null,
    fetchKeychains: async () => {
      throw new Error("darf nicht aufgerufen werden");
    },
    cache: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
    now: () => new Date("2026-11-16T10:00:00Z"),
    ...extra,
  };
}

describe("DJI-Worker – Protokoll", () => {
  it("encodeWorkerRequest erzeugt ausführbares JS mit maskierten Zeilentrennern", () => {
    const js = encodeWorkerRequest({
      type: "begin",
      jobId: "a",
      fileName: "x" + String.fromCharCode(0x2028) + "y",
    });
    assert.match(js, /^window\.__djiWorker&&window\.__djiWorker\.receive\(/);
    assert.ok(js.endsWith(");true;"));
    assert.ok(!js.includes(String.fromCharCode(0x2028)));
    assert.ok(js.includes("\\u2028"));
  });

  it("decodeWorkerResponse verwirft Unsinn", () => {
    assert.equal(decodeWorkerResponse("kein json"), null);
    assert.equal(decodeWorkerResponse(42), null);
    assert.equal(decodeWorkerResponse('{"x":1}'), null);
    assert.deepEqual(decodeWorkerResponse('{"type":"done","jobId":"j"}'), {
      type: "done",
      jobId: "j",
    });
  });

  it("Stückzahl/Base64-Längen stimmen", () => {
    assert.equal(DJI_CHUNK_BYTES % 3, 0);
    assert.equal(chunkCount(0), 1);
    assert.equal(chunkCount(DJI_CHUNK_BYTES), 1);
    assert.equal(chunkCount(DJI_CHUNK_BYTES + 1), 2);
    assert.equal(base64ByteLength(Buffer.from("abcd").toString("base64")), 4);
    assert.equal(base64ByteLength(Buffer.from("abcde").toString("base64")), 5);
  });

  it("Worker-HTML bettet Parser und Worker ohne vorzeitiges </script> ein", () => {
    const html = buildDjiWorkerHtml(DJI_LOG_PARSER_JS, DJI_LOG_PARSER_VERSION);
    assert.equal((html.match(/<\/script>/g) || []).length, 2);
    assert.ok(html.includes("window.__djiLogParser"));
    assert.ok(html.includes("window.__djiWorker"));
  });

  it("Parser-Bündel nutzt nur MVP-WebAssembly (keine Feature-Sektion) und instanziiert asynchron", () => {
    assert.ok(!DJI_LOG_PARSER_JS.includes("new WebAssembly.Module("));
    // nur ASCII, sonst legt Hermes den 0,7-MB-String als UTF-16 ab
    assert.ok(!/[^\x00-\x7f]/.test(DJI_LOG_PARSER_JS));
    assert.ok(
      DJI_LOG_PARSER_JS.includes("WebAssembly.instantiate(bytes, imports)"),
    );
    assert.ok(!/^export /m.test(DJI_LOG_PARSER_JS));
    const b64 = DJI_LOG_PARSER_JS.match(
      /__toBinary\("([A-Za-z0-9+/=]+)"\)/,
    )![1];
    const wasm = Buffer.from(b64, "base64");
    assert.equal(wasm.subarray(0, 4).toString("latin1"), "\0asm");
    assert.ok(
      !wasm.includes(Buffer.from("target_features")),
      "target_features-Sektion entfernt",
    );
    assert.ok(WebAssembly.validate(wasm));
  });

  it("ready → Stücke werden einzeln quittiert (Flusskontrolle)", async () => {
    const { vmw, client } = connect();
    await client.whenReady();
    assert.equal(client.parserVersion, DJI_LOG_PARSER_VERSION);
    const src = source(V11, 64 * 1024 + 2); // krumme Stückgröße
    const n = await client.upload("j1", V11, (i) => src.readChunk(i));
    assert.equal(n, Math.ceil(src.sizeBytes! / (64 * 1024 + 2)));
    const acks = vmw.outbox
      .map((r) => JSON.parse(r))
      .filter((m) => m.type === "ack" && m.jobId === "j1");
    assert.deepEqual(
      acks.map((a) => a.index),
      [-1, ...Array.from({ length: n }, (_, i) => i)],
    );
    const info = await client.inspect("j1");
    assert.equal(info.version, 11);
    assert.equal(info.byteLength, src.sizeBytes);
    assert.equal(info.keychainsRequired, false);
    client.release("j1");
  });

  it("Nicht-DJI-Datei → Fehlercode not_a_log", async () => {
    const { client } = connect();
    await client.upload("bad", "x.txt", async (i) =>
      i === 0
        ? Buffer.from("hallo welt, kein dji log ".repeat(20)).toString("base64")
        : null,
    );
    await assert.rejects(
      client.inspect("bad"),
      (e: unknown) => e instanceof DjiWorkerError && e.code === "not_a_log",
    );
  });

  it("unbekannter Auftrag → unknown_job", async () => {
    const { client } = connect();
    await client.whenReady();
    await assert.rejects(
      client.inspect("gibtsnicht"),
      (e: unknown) => e instanceof DjiWorkerError && e.code === "unknown_job",
    );
  });

  it("reset() beendet wartende Aufträge (WebView abgestürzt)", async () => {
    const client = new DjiWorkerClient(() => {});
    client.handle({ type: "ready", protocol: 1 });
    const p = client.inspect("x");
    client.reset("weg");
    await assert.rejects(
      p,
      (e: unknown) => e instanceof DjiWorkerError && e.code === "closed",
    );
  });

  it("Zeitlimit greift, wenn die WebView nicht antwortet", async () => {
    // eigener (nicht unref'ter) Zeitgeber, sonst endet die Ereignisschleife vorher
    const client = new DjiWorkerClient(() => {}, {
      inspectTimeoutMs: 20,
      setTimeoutImpl: (fn, ms) => setTimeout(fn, ms),
    });
    client.handle({ type: "ready", protocol: 1 });
    await assert.rejects(
      client.inspect("x"),
      (e: unknown) => e instanceof DjiWorkerError && e.code === "timeout",
    );
  });

  it("fatal beim Laden → whenReady schlägt mit deutscher Meldung fehl", async () => {
    const client = new DjiWorkerClient(() => {});
    const p = client.whenReady();
    client.handle({ type: "fatal", message: "CompileError" });
    await assert.rejects(p, /WebView/);
  });

  it("Zeilen werden in Stücken gestreamt und vollständig zusammengesetzt", async () => {
    const { vmw, client } = connect({ rowsPerMessage: 500, maxRows: 2000 });
    const src = source(V11);
    await client.upload("s", V11, (i) => src.readChunk(i));
    const progress: number[] = [];
    const out = await client.parse("s", null, (got) => progress.push(got));
    const rowMsgs = vmw.outbox
      .map((r) => JSON.parse(r))
      .filter((m) => m.type === "rows");
    assert.ok(rowMsgs.length >= 3, "mehrere rows-Nachrichten");
    assert.ok(rowMsgs.every((m) => m.rows.length <= 500));
    assert.ok(out.rows.length <= 2001);
    assert.equal(
      out.rows.length,
      rowMsgs.reduce((s, m) => s + m.rows.length, 0),
    );
    assert.equal(
      out.summary.rowStride,
      Math.ceil(out.summary.stats.frameCount / 2000),
    );
    assert.deepEqual(out.summary.columns, [...DJI_ROW_COLUMNS]);
    assert.equal(progress[progress.length - 1], out.rows.length);
    client.release("s");
  });
});

describe("DJI-Worker – Ende-zu-Ende (echte Protokolle)", () => {
  it("v11 Mavic Air (unverschlüsselt) → DjiAnalyzeResult wie vom Server", async () => {
    const { client } = connect();
    const src = source(V11);
    const res = await analyzeDjiLogSource(src, deps(client));
    const m = res.meta;
    assert.equal(m.status, "parsed");
    assert.equal(m.version, 11);
    assert.equal(m.fileName, V11);
    assert.equal(m.sizeBytes, 555776);
    assert.match(m.objectPath, /^local-dji:v11-555776-/);
    assert.equal(m.droneName, "DJI Mavic Air");
    assert.equal(m.aircraftName, "dronefo...-Mavic Air");
    assert.equal(m.aircraftSn, "0K1DF313BD4PR1");
    assert.equal(m.batterySn, "0K4AEBQA3400DT");
    assert.equal(m.batteryCycleCount, 2);
    assert.equal(m.batteryHealthPercent, 100);
    assert.equal(m.durationSec, 305.3);
    assert.equal(m.maxAltitudeM, 28.5);
    assert.equal(m.batteryStartPercent, 95);
    assert.equal(m.batteryEndPercent, 68);
    assert.equal(m.batteryMinPercent, 68);
    assert.ok(m.minCellV! > 3.5 && m.minCellV! < 4.2, `minCellV ${m.minCellV}`);
    assert.equal(m.minCellEstimated, false);
    assert.ok(
      m.totalDistanceM! > 300 && m.totalDistanceM! < 700,
      `Strecke ${m.totalDistanceM}`,
    );
    assert.equal(m.startTs, Date.parse("2018-06-19T18:50:34.869Z"));
    // Track: Punkte mit Zeitstempel, ausgedünnt
    assert.ok(res.track.length > 100 && res.track.length <= 1200);
    assert.equal(res.track, m.track);
    assert.ok(
      res.track.every(
        (p) =>
          Math.abs(p.lat - 39.96) < 0.01 && Math.abs(p.lon + 106.216) < 0.01,
      ),
    );
    assert.ok(typeof res.track[0].ts === "number");
    // Detailzeilen für Tabelle/Wiedergabe/Knüppel
    assert.ok(m.records!.length > 100 && m.records!.length <= 900);
    const mid = m.records![Math.floor(m.records!.length / 2)];
    assert.ok(typeof mid.lat === "number" && typeof mid.heightM === "number");
    assert.ok(Array.isArray(mid.cells) && mid.cells!.length === 3);
    assert.equal(typeof mid.mode, "string");
    // Meldungen
    assert.ok(
      m.messages!.some(
        (x) =>
          x.text === "Flight mode changed to AutoTakeoff." && x.kind === "tip",
      ),
    );
    assert.equal(m.trackPointCount, res.track.length);
  });

  it("v9 (Stick-Rohwerte 1024 → 0, keine Akku-Zellen) → gültige Datensätze", async () => {
    const { client } = connect();
    const res = await analyzeDjiLogSource(source(V9), deps(client));
    assert.equal(res.meta.status, "parsed");
    assert.equal(res.meta.version, 9);
    assert.equal(res.meta.droneName, "DJI Matrice 600 Pro");
    assert.equal(res.meta.batterySn, "M61AE7601101J0");
    const r = res.meta.records![0];
    assert.equal(r.throttle, 0);
    assert.equal(r.aileron, 0);
  });

  it("v14 verschlüsselt: Kopf lesbar, keychainsRequest im DJI-Format", async () => {
    const { client } = connect();
    const src = source(V14);
    await client.upload("e", V14, (i) => src.readChunk(i));
    const info = await client.inspect("e");
    assert.equal(info.version, 14);
    assert.equal(info.keychainsRequired, true);
    assert.equal(info.details.aircraftSn, "1581F6Z9C23CP003");
    assert.equal(info.details.batterySn, "7BVPLBVDA104J3");
    assert.equal(info.details.productType, "Mini4Pro");
    const req = info.keychainsRequest!;
    assert.equal(typeof req.version, "number");
    assert.equal(typeof req.department, "number");
    assert.ok(req.keychainsArray.length >= 1);
    for (const group of req.keychainsArray) {
      for (const k of group) {
        assert.equal(typeof k.featurePoint, "string");
        assert.match(k.aesCiphertext, /^[A-Za-z0-9+/]+=*$/);
      }
    }
    await assert.rejects(
      client.parse("e", null),
      (e: unknown) =>
        e instanceof DjiWorkerError && e.code === "keychain_required",
    );
    // falsche Schlüssel → keine Daten → decrypt_failed statt leerer Auswertung
    const fake = req.keychainsArray.map((g) =>
      g.map((k) => ({
        featurePoint: k.featurePoint,
        aesKey: Buffer.alloc(32).toString("base64"),
        aesIv: Buffer.alloc(16).toString("base64"),
      })),
    );
    await assert.rejects(
      client.parse("e", fake),
      (e: unknown) =>
        e instanceof DjiWorkerError && e.code === "decrypt_failed",
    );
    client.release("e");
  });

  it("v14 ohne API-Schlüssel → status undecryptable mit Basis-Kennzahlen und deutscher Meldung", async () => {
    const { client } = connect();
    const res = await analyzeDjiLogSource(source(V14), deps(client));
    const m = res.meta;
    assert.equal(m.status, "undecryptable");
    assert.equal(m.message, djiKeychainErrorMessage("no_key"));
    assert.equal(m.droneName, "DJI Mini 4 Pro");
    assert.equal(m.durationSec, 108);
    assert.equal(m.maxAltitudeM, 55);
    assert.equal(m.batterySn, "7BVPLBVDA104J3");
    assert.equal(res.track.length, 1);
    assert.equal(res.track[0].ts, Date.parse("2024-09-01T12:55:49.477Z"));
  });

  it("rowToObject benennt die Spalten", () => {
    const o = rowToObject([
      1.5,
      null,
      50,
      8,
      ...new Array(DJI_ROW_COLUMNS.length - 4).fill(null),
    ]);
    assert.deepEqual(o, { t: 1.5, lat: 50, lon: 8 });
  });
});
