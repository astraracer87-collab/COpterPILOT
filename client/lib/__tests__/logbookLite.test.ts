// Leichte Logbuch-Liste (keine Blob-Dateien), strikte Hydrierung für
// Read-Modify-Write und die sichere Pflege importierter DJI-Flüge
// (Doppelte, Akku-Tausch-Serien).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { DjiLogMeta, LogbookEntry } from "../storage";
import {
  computeTrackPreview,
  djiLogTimeRange,
  entryPreviewTracks,
  hasUserEnteredData,
  isLiteDjiLog,
  markLiteDjiLog,
  mergedKeeperPatch,
  planDjiLogMerges,
  groupDjiLogsByDistance,
  sameDjiLog,
  summarizeDjiLog,
  toLiteLogbookEntry,
  withDerivedLogbookFields,
  TRACK_PREVIEW_MAX_POINTS,
} from "../logbookLite";
import { logbookEntryFromDjiLog } from "../djiLogMapping";
import { BLOB_REF_PREFIX, BlobReadError, hydrateBlobFields, type BlobSpec } from "../userBlobs";
import type { SimpleFs } from "../fileStoreFs";

const MIN = 60_000;
const T0 = Date.UTC(2026, 5, 1, 8, 0, 0);

function track(n: number, lat0 = 48, lon0 = 11): { lat: number; lon: number; ts: number }[] {
  return Array.from({ length: n }, (_, i) => ({ lat: lat0 + i * 1e-4, lon: lon0 + i * 1e-4, ts: T0 + i * 1000 }));
}

function log(name: string, startMin: number, durMin: number, extra: Partial<DjiLogMeta> = {}): DjiLogMeta {
  return {
    status: "parsed",
    fileName: name,
    objectPath: `local-dji:${name}`,
    startTs: T0 + startMin * MIN,
    endTs: T0 + (startMin + durMin) * MIN,
    durationSec: durMin * 60,
    aircraftSn: "SN-A",
    droneName: "DJI Mini 4 Pro",
    maxAltitudeM: 80,
    track: track(200),
    records: [{ t: 0 }, { t: 1 }],
    messages: [{ text: "hi", kind: "info" } as never],
    ...extra,
  };
}

/** Eintrag wie vom DJI-Import (logbookEntryFromDjiLog) angelegt. */
function imported(id: string, meta: DjiLogMeta, patch: Partial<LogbookEntry> = {}): LogbookEntry {
  return {
    ...logbookEntryFromDjiLog(meta, { id: "d1", name: "Mini", classMark: "C0" as never }),
    id,
    createdAt: new Date(T0).toISOString(),
    ...patch,
  } as LogbookEntry;
}

const logsOf = (e: LogbookEntry) => (e.djiLogs && e.djiLogs.length ? e.djiLogs : e.djiLog ? [e.djiLog] : []);

describe("logbookLite: Zusammenfassung + Vorschau", () => {
  it("summarizeDjiLog entfernt track/records/messages, behält Metadaten", () => {
    const s = summarizeDjiLog(log("a.txt", 0, 10));
    assert.equal(s.track, undefined);
    assert.equal(s.records, undefined);
    assert.equal(s.messages, undefined);
    assert.equal(s.fileName, "a.txt");
    assert.equal(s.aircraftSn, "SN-A");
    assert.equal(typeof s.startTs, "number");
  });

  it("Vorschau-Route hat höchstens 60 Punkte (alle Segmente zusammen)", () => {
    const p = computeTrackPreview(undefined, [log("a", 0, 5), log("b", 10, 5)])!;
    assert.equal(p.length, 2);
    const total = p.reduce((s, x) => s + x.length, 0);
    assert.ok(total <= TRACK_PREVIEW_MAX_POINTS, `total ${total}`);
    assert.ok(p.every((seg) => seg.length >= 2));
    // GPS-Track hat Vorrang
    const g = computeTrackPreview(track(500), [log("a", 0, 5)])!;
    assert.equal(g.length, 1);
    assert.ok(g[0].length <= TRACK_PREVIEW_MAX_POINTS);
  });

  it("withDerivedLogbookFields: berechnet bei Inline-Daten, behält bei Datei-Verweisen", () => {
    const e = imported("e1", log("a.txt", 0, 10));
    const d = withDerivedLogbookFields(e);
    assert.equal(d.djiLogsSummary?.length, 1);
    assert.equal(d.djiLogsSummary?.[0].track, undefined);
    assert.ok(d.trackPreview && d.trackPreview.length === 1);
    // ausgelagert: vorhandene Werte bleiben (Datei wird nicht gelesen)
    const ref = { ...d, djiLogs: `${BLOB_REF_PREFIX}logbook/e1.djiLogs.b64` as never };
    const d2 = withDerivedLogbookFields(ref);
    assert.deepEqual(d2.djiLogsSummary, d.djiLogsSummary);
    assert.deepEqual(d2.trackPreview, d.trackPreview);
    // Logs entfernt → Zusammenfassung/Vorschau entfallen
    const d3 = withDerivedLogbookFields({ ...d, djiLogs: undefined });
    assert.equal(d3.djiLogsSummary, undefined);
    assert.equal(d3.trackPreview, undefined);
  });

  it("toLiteLogbookEntry: keine blobref-Strings, DJI-Logs als markierte Zusammenfassung", () => {
    const base = withDerivedLogbookFields(imported("e1", log("a.txt", 0, 10)));
    const raw: LogbookEntry = {
      ...base,
      djiLogs: `${BLOB_REF_PREFIX}logbook/e1.djiLogs.b64` as never,
      gpsTrack: `${BLOB_REF_PREFIX}logbook/e1.gpsTrack.b64` as never,
      routeMapSnapshotBase64: `${BLOB_REF_PREFIX}logbook/e1.routeMapSnapshotBase64.b64`,
      mapSnapshotBase64: "c21hbGw=", // kleines Inline-Bild bleibt
      trafficLog: { mapSnapshotBase64: `${BLOB_REF_PREFIX}x` } as never,
    };
    const { entry, needsDjiHydration } = toLiteLogbookEntry(raw);
    assert.equal(needsDjiHydration, false);
    const text = JSON.stringify(entry);
    assert.ok(!text.includes(BLOB_REF_PREFIX), text);
    assert.equal(entry.mapSnapshotBase64, "c21hbGw=");
    assert.equal(entry.gpsTrack, undefined);
    assert.equal(entry.djiLogs?.length, 1);
    assert.equal(entry.djiLogs?.[0].fileName, "a.txt");
    assert.equal(entry.djiLogs?.[0].track, undefined);
    assert.ok(isLiteDjiLog(entry.djiLogs?.[0]));
    assert.ok(isLiteDjiLog({ ...entry.djiLogs![0] }), "Markierung übersteht Spread");
    assert.equal(entry.djiLogsSummary, undefined);
    assert.equal(entryPreviewTracks(entry).length, 1);
    // weggelassene Snapshots/GPS-Track zählen weiter als Nutzerdaten
    assert.equal(hasUserEnteredData(entry), true);
    assert.equal(hasUserEnteredData({ ...entry }), true);
  });

  it("toLiteLogbookEntry: reiner Import bleibt ohne Nutzerdaten", () => {
    const raw = { ...withDerivedLogbookFields(imported("e1", log("a.txt", 0, 10))), djiLogs: `${BLOB_REF_PREFIX}logbook/e1.djiLogs.b64` as never };
    assert.equal(hasUserEnteredData(toLiteLogbookEntry(raw).entry), false);
  });

  it("toLiteLogbookEntry: Altbestand ohne Zusammenfassung → nur DJI-Logs nachladen", () => {
    const raw = { ...imported("e1", log("a.txt", 0, 10)), djiLogs: `${BLOB_REF_PREFIX}logbook/e1.djiLogs.b64` as never };
    const { entry, needsDjiHydration } = toLiteLogbookEntry(raw);
    assert.equal(needsDjiHydration, true);
    assert.equal(entry.djiLogs, undefined);
  });
});

describe("userBlobs.hydrateBlobFields", () => {
  const spec: BlobSpec = { ns: "logbook", fields: [["mapSnapshotBase64"]], jsonFields: [["djiLogs"], ["djiLog"]] };
  function memFs(files: Record<string, string>): SimpleFs {
    return {
      root: "file:///docs/",
      async readText(p) {
        return files[p] ?? null;
      },
      async writeText(p, t) {
        files[p] = t;
      },
      async move() {},
      async remove() {},
      async list() {
        return [];
      },
      async mkdirp() {},
      async info() {
        return { exists: false };
      },
    };
  }

  it("liest nur die angegebenen Felder", async () => {
    const reads: string[] = [];
    const fs = memFs({ "file:///docs/user-blobs/logbook/e1.djiLogs.b64": JSON.stringify([{ fileName: "a" }]) });
    const orig = fs.readText;
    fs.readText = async (p) => {
      reads.push(p);
      return orig(p);
    };
    const item = {
      id: "e1",
      djiLogs: `${BLOB_REF_PREFIX}logbook/e1.djiLogs.b64`,
      mapSnapshotBase64: `${BLOB_REF_PREFIX}logbook/e1.mapSnapshotBase64.b64`,
    };
    const h = await hydrateBlobFields(spec, item, [["djiLogs"]], { fs });
    assert.deepEqual(h.djiLogs, [{ fileName: "a" }]);
    assert.equal(h.mapSnapshotBase64, item.mapSnapshotBase64);
    assert.equal(reads.length, 1);
  });

  it("strict: nicht lesbare Datei wirft statt das Feld zu leeren", async () => {
    const fs = memFs({});
    const item = { id: "e1", djiLogs: `${BLOB_REF_PREFIX}logbook/e1.djiLogs.b64` };
    await assert.rejects(hydrateBlobFields(spec, item, [["djiLogs"]], { strict: true, fs }), BlobReadError);
    const lax = await hydrateBlobFields(spec, item, [["djiLogs"]], { fs });
    assert.equal(lax.djiLogs, undefined);
  });
});

describe("hasUserEnteredData", () => {
  it("frischer Import (inkl. Auto-Felder, Akku-Verknüpfung) ist unbedenklich", () => {
    const e = withDerivedLogbookFields(
      imported("e1", log("a.txt", 0, 10, { batteryId: "b1", batteryLabel: "Akku 1" }), {
        locationName: "Musterfeld",
        status: "go",
        bundesland: "BY",
        shareEnabled: false,
        shareToken: null,
      }),
    );
    assert.equal(hasUserEnteredData(e), false);
  });

  for (const [label, patch] of [
    ["eigene Notiz", { notes: "Wind böig" }],
    ["Vorfall", { incidentOccurred: true }],
    ["Vorfallbeschreibung", { incidentDescription: "x" }],
    ["Wartung", { maintenanceRequired: true }],
    ["Debriefing", { debriefing: { incidentOccurred: false, maintenanceRequired: false } }],
    ["GPS-Track", { gpsTrack: track(5) }],
    ["Pre-Check", { preflight: { completedAt: "x" } }],
    ["Freigabe aktiv", { shareEnabled: true }],
  ] as [string, Partial<LogbookEntry>][]) {
    it(`blockiert: ${label}`, () => {
      assert.equal(hasUserEnteredData(imported("e1", log("a.txt", 0, 10), patch)), true);
    });
  }

  for (const [label, patch] of [
    ["Snapshot (Datei)", { routeMapSnapshotBase64: `${BLOB_REF_PREFIX}x` }],
    ["Satelliten-Snapshot", { mapSatelliteSnapshotBase64: "abc" }],
  ] as [string, Partial<LogbookEntry>][]) {
    it(`blockiert NICHT (automatisch erzeugt): ${label}`, () => {
      assert.equal(hasUserEnteredData(imported("e1", log("a.txt", 0, 10), patch)), false);
    });
  }

  it("kein DJI-Import-Eintrag → zählt als Nutzerdaten", () => {
    assert.equal(hasUserEnteredData(imported("e1", log("a.txt", 0, 10), { sessionId: "sess-1" })), true);
  });
});

describe("sameDjiLog", () => {
  const a = { fileName: "a.txt", startTs: T0, aircraftSn: "SN1" };
  it("gleicher Dateiname", () => assert.ok(sameDjiLog(a, { fileName: "A.TXT", startTs: 0, aircraftSn: "X" })));
  it("gleicher Start + gleiche Seriennummer", () => assert.ok(sameDjiLog(a, { fileName: "b.txt", startTs: T0 + 1500, aircraftSn: "sn1" })));
  it("Seriennummer nur auf einer Seite → nicht gleich", () =>
    assert.equal(sameDjiLog(a, { fileName: "b.txt", startTs: T0, aircraftSn: undefined }), false));
  it("verschiedene Seriennummern → nicht gleich", () =>
    assert.equal(sameDjiLog(a, { fileName: "b.txt", startTs: T0, aircraftSn: "SN2" }), false));
  it("beide ohne Seriennummer, gleicher Start → gleich", () =>
    assert.ok(sameDjiLog({ fileName: "a", startTs: T0 }, { fileName: "b", startTs: T0 + 100 })));
});

describe("planDjiLogMerges", () => {
  it("Logs > 1 km auseinander werden nicht zusammengeführt", () => {
    const e1 = imported("e1", log("a.txt", 0, 15));
    const e2 = imported("e2", log("b.txt", 20, 10, { track: track(20, 50.6, 8.2) })); // ~250 km entfernt
    assert.deepEqual(planDjiLogMerges([e1, e2], logsOf), []);
  });

  it("Logs am selben Ort (≤ 1 km) werden zusammengeführt", () => {
    const e1 = imported("e1", log("a.txt", 0, 15, { track: track(20) }));
    const e2 = imported("e2", log("b.txt", 20, 10, { track: track(20, 48.003, 11.003) })); // ~400 m
    assert.deepEqual(planDjiLogMerges([e1, e2], logsOf), [{ keeperId: "e1", extraIds: ["e2"] }]);
  });

  it("groupDjiLogsByDistance trennt weit entfernte Logs", () => {
    const groups = groupDjiLogsByDistance([
      log("a.txt", 0, 10, { track: track(20) }),
      log("b.txt", 15, 10, { track: track(20, 48.001, 11.001) }),
      log("c.txt", 30, 10, { track: track(20, 50.6, 8.2) }),
    ]);
    assert.deepEqual(groups.map((g) => g.map((l) => l.fileName)), [["a.txt", "b.txt"], ["c.txt"]]);
  });

  it("summarizeDjiLog behält Start-/Endposition für die Entfernungsprüfung", () => {
    const s = summarizeDjiLog(log("a.txt", 0, 10, { track: track(20, 50.6, 8.2) }));
    assert.equal(s.startLat, 50.6);
    assert.equal(s.track, undefined);
    assert.equal(groupDjiLogsByDistance([s, log("b.txt", 15, 10, { track: track(5) })]).length, 2);
  });

  it("Akku-Tausch (Lücke ≤ 20 min) wird zusammengeführt, früheste bleibt", () => {
    const e1 = imported("e1", log("a.txt", 0, 15));
    const e2 = imported("e2", log("b.txt", 25, 15)); // 10 min Lücke
    const e3 = imported("e3", log("c.txt", 55, 10)); // 15 min Lücke zu e2
    assert.deepEqual(planDjiLogMerges([e3, e1, e2], logsOf), [{ keeperId: "e1", extraIds: ["e2", "e3"] }]);
  });

  it("Lücke > 20 min → getrennt (auch innerhalb von 3 h)", () => {
    const e1 = imported("e1", log("a.txt", 0, 15));
    const e2 = imported("e2", log("b.txt", 40, 15)); // 25 min Lücke
    assert.deepEqual(planDjiLogMerges([e1, e2], logsOf), []);
  });

  it("Ende fehlt → Start + Dauer", () => {
    const l1 = log("a.txt", 0, 15, { endTs: undefined });
    assert.equal(djiLogTimeRange(l1)!.end, T0 + 15 * MIN);
    const e2 = imported("e2", log("b.txt", 30, 5));
    assert.equal(planDjiLogMerges([imported("e1", l1), e2], logsOf).length, 1);
  });

  it("anderes Fluggerät → getrennt", () => {
    const e1 = imported("e1", log("a.txt", 0, 15));
    const e2 = imported("e2", log("b.txt", 20, 15, { aircraftSn: "SN-B" }));
    assert.deepEqual(planDjiLogMerges([e1, e2], logsOf), []);
  });

  it("Eintrag mit Nutzerdaten wird nie aufgelöst – er bleibt Ziel", () => {
    const e1 = imported("e1", log("a.txt", 0, 15));
    const e2 = imported("e2", log("b.txt", 20, 15), { notes: "Eigene Notiz" });
    assert.deepEqual(planDjiLogMerges([e1, e2], logsOf), [{ keeperId: "e2", extraIds: ["e1"] }]);
  });

  it("zwei Einträge mit Nutzerdaten werden nicht verschmolzen", () => {
    const e1 = imported("e1", log("a.txt", 0, 15), { incidentOccurred: true });
    const e2 = imported("e2", log("b.txt", 20, 15), { notes: "Eigene Notiz" });
    assert.deepEqual(planDjiLogMerges([e1, e2], logsOf), []);
  });

  it("Logs ohne Startzeit oder Nicht-Import-Einträge bleiben außen vor", () => {
    const e1 = imported("e1", log("a.txt", 0, 15, { startTs: undefined }));
    const e2 = imported("e2", log("b.txt", 20, 15));
    const e3 = imported("e3", log("c.txt", 40, 15), { sessionId: "sess" });
    assert.deepEqual(planDjiLogMerges([e1, e2, e3], logsOf), []);
  });

  it("funktioniert mit leichten Einträgen (nur Zusammenfassung)", () => {
    const lite = [imported("e1", log("a.txt", 0, 15)), imported("e2", log("b.txt", 20, 15))].map(
      (e) => ({ ...e, djiLogs: e.djiLogs!.map((l) => markLiteDjiLog(summarizeDjiLog(l))) }),
    );
    assert.equal(planDjiLogMerges(lite, logsOf).length, 1);
  });
});

describe("mergedKeeperPatch", () => {
  it("Dauer = Summe, Start/Landung aus den Logs, Import-Notiz ergänzt", () => {
    const l1 = log("a.txt", 0, 15);
    const l2 = log("b.txt", 25, 10, { maxAltitudeM: 110.4 });
    const keeper = imported("e1", l1);
    const extra = imported("e2", l2);
    const p = mergedKeeperPatch(keeper, [extra], [l1, l2]);
    assert.equal(p.flightDurationMinutes, 25);
    assert.equal(p.takeoffTime, new Date(T0).toISOString());
    assert.equal(p.landingTime, new Date(T0 + 35 * MIN).toISOString());
    assert.equal(p.maxAltitude, 110);
    assert.equal(p.djiLogs?.length, 2);
    assert.ok("djiLog" in p && p.djiLog === undefined);
    assert.equal(p.notes, "Aus DJI-Flugprotokollen importiert (a.txt, b.txt).");
    assert.equal(hasUserEnteredData({ ...keeper, ...p } as LogbookEntry), false, "Notiz gilt weiter als automatisch");
  });

  it("eigene Notiz des Ziel-Eintrags bleibt unverändert", () => {
    const l1 = log("a.txt", 0, 15);
    const keeper = imported("e1", l1, { notes: "Meine Notiz" });
    assert.equal(mergedKeeperPatch(keeper, [], [l1]).notes, undefined);
  });
});
