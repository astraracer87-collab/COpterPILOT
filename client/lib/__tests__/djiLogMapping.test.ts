// Abbildung Worker-Ausgabe → DjiLogMeta/DjiAnalyzeResult/LogbookEntry und
// Akku-Verknüpfung (Seriennummern) samt Akku-Statistik.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DJI_MAX_STORED_RECORDS,
  DJI_MAX_TRACK_POINTS,
  buildParsedMeta,
  buildUndecryptableMeta,
  downsample,
  logbookEntryFromDjiLog,
  prettyDroneName,
  rowToRecord,
  rowsToTrack,
  toAnalyzeResult,
} from "../djiLogMapping";
import {
  DJI_ROW_COLUMNS,
  type DjiParseSummary,
  type DjiRow,
} from "../djiLogWorkerProtocol";
import {
  computeBatteryStats,
  entryUsesBattery,
  findDroneForLog,
  formatTrend,
  linkBatteryForLog,
  normalizeSerial,
  type LinkDrone,
  type LinkEntry,
} from "../djiBatteryLink";
import {
  groupDjiAnalyses,
  isLikelyTestStart,
  type DjiLogMeta,
} from "../djiLogCore";

function row(
  o: Partial<Record<(typeof DJI_ROW_COLUMNS)[number], unknown>>,
): DjiRow {
  return DJI_ROW_COLUMNS.map((c) => (c in o ? (o[c] as DjiRow[number]) : null));
}

const T0 = Date.parse("2025-06-01T08:00:00Z");

function flightRows(n: number): DjiRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      t: i / 10,
      ts: T0 + i * 100,
      lat: 50 + i * 1e-6,
      lon: 8 + i * 1e-6,
      heightM: Math.min(60, i / 10),
      hSpeedMs: 5,
      vSpeedMs: 0.5,
      distM: i,
      sats: 18,
      battPct: 100 - Math.floor(i / 100),
      battV: 16.2,
      aileron: 0.25,
      elevator: -1,
      throttle: 0,
      rudder: null,
      pitch: -5,
      roll: 2,
      yaw: 90,
      mode: "GPSAtti",
      cells: [4.05, 4.04, 4.06, 4.05],
      tempC: 35,
    }),
  );
}

const SUMMARY: DjiParseSummary = {
  version: 13,
  columns: [...DJI_ROW_COLUMNS],
  details: {
    startTime: "2025-06-01T08:00:00.000Z",
    productType: "Mavic3Pro",
    aircraftName: "Meine Mavic",
    aircraftSn: "1581F5BKD999",
    batterySn: "4ERPL1234567",
    totalTime: 610,
    maxHeight: 61,
    totalDistance: 3,
  },
  stats: {
    frameCount: 6100,
    durationSec: 609.94,
    maxHeightM: 60.04,
    distanceM: 2345,
    maxDistFromHomeM: 812,
    batteryStartPercent: 100,
    batteryEndPercent: 40,
    batteryMinPercent: 39,
    minCellV: 3.512,
    minCellEstimated: false,
    maxTempC: 47.5,
    startTs: T0,
    endTs: T0 + 610_000,
    homeLat: 50,
    homeLon: 8,
  },
  battery: {
    batterySn: "4ERPL1234567",
    aircraftSn: "1581F5BKD999",
    cycleCount: 57,
    healthPercent: 93,
  },
  messages: [
    { t: 0, text: "Startbereit", kind: "tip" },
    { t: 300.25, text: "Akku schwach", kind: "warn" },
    { t: 400, text: "Kritisch niedriger Akkustand", kind: "serious" },
  ],
  rowStride: 2,
};

const FILE = {
  fileName: "DJIFlightRecord_2025-06-01_[10-00-00].txt",
  objectPath: "local-dji:fp",
  sizeBytes: 4_200_000,
};

describe("Mapping Worker → DjiLogMeta", () => {
  it("Kennzahlen, Seriennummern, Akku- und Zellwerte", () => {
    const rows = flightRows(3050);
    const m = buildParsedMeta(FILE, SUMMARY, rows, {
      parsedAt: "2026-11-16T10:00:00.000Z",
      keychainSource: "api",
    });
    assert.equal(m.status, "parsed");
    assert.equal(m.fileName, FILE.fileName);
    assert.equal(m.objectPath, "local-dji:fp");
    assert.equal(m.sizeBytes, 4_200_000);
    assert.equal(m.parsedAt, "2026-11-16T10:00:00.000Z");
    assert.equal(m.version, 13);
    assert.equal(m.droneName, "DJI Mavic 3 Pro");
    assert.equal(m.aircraftName, "Meine Mavic");
    assert.equal(m.maxAltitudeM, 60);
    assert.equal(m.durationSec, 609.9);
    assert.equal(m.totalDistanceM, 2345);
    assert.equal(m.batteryStartPercent, 100);
    assert.equal(m.batteryEndPercent, 40);
    assert.equal(m.batteryMinPercent, 39);
    assert.equal(m.aircraftSn, "1581F5BKD999");
    assert.equal(m.batterySn, "4ERPL1234567");
    assert.equal(m.batteryCycleCount, 57);
    assert.equal(m.batteryHealthPercent, 93);
    assert.equal(m.minCellV, 3.512);
    assert.equal(m.minCellEstimated, false);
    assert.equal(m.maxBatteryTempC, 47.5);
    assert.equal(m.maxDistanceFromHomeM, 812);
    assert.equal(m.startTs, T0);
    assert.equal(m.keychainSource, "api");
    assert.deepEqual(m.messages, [
      { t: 0, text: "Startbereit", kind: "tip" },
      { t: 300.25, text: "Akku schwach", kind: "warn" },
      { t: 400, text: "Kritisch niedriger Akkustand", kind: "serious" },
    ]);
    // nichts Undefiniertes im gespeicherten Objekt
    assert.ok(Object.values(m).every((v) => v !== undefined));
  });

  it("Track und Detailzeilen werden begrenzt, erster/letzter Punkt bleiben", () => {
    const rows = flightRows(4000);
    const m = buildParsedMeta(FILE, SUMMARY, rows);
    assert.equal(m.records!.length, DJI_MAX_STORED_RECORDS);
    assert.equal(m.track!.length, DJI_MAX_TRACK_POINTS);
    assert.equal(m.trackPointCount, DJI_MAX_TRACK_POINTS);
    assert.equal(m.track![0].ts, T0);
    assert.equal(m.track![m.track!.length - 1].ts, T0 + 3999 * 100);
    assert.equal(m.records![0].t, 0);
    assert.equal(m.records![m.records!.length - 1].t, 399.9);
    const r = toAnalyzeResult(m);
    assert.equal(r.track, m.track);
    assert.equal(r.meta, m);
  });

  it("rowToRecord: Felder wie in der Detailtabelle, Knüppel -1..1, fehlende Werte weggelassen", () => {
    const rec = rowToRecord(flightRows(1)[0]);
    assert.deepEqual(rec, {
      t: 0,
      mode: "GPSAtti",
      sats: 18,
      heightM: 0,
      hSpeedMs: 5,
      vSpeedMs: 0.5,
      distM: 0,
      battPct: 100,
      battV: 16.2,
      cells: [4.05, 4.04, 4.06, 4.05],
      aileron: 0.25,
      elevator: -1,
      throttle: 0,
      pitch: -5,
      roll: 2,
      yaw: 90,
      lat: 50,
      lon: 8,
    });
    assert.ok(!("rudder" in rec) && !("vpsM" in rec) && !("altM" in rec));
  });

  it("rowsToTrack überspringt Zeilen ohne GPS", () => {
    const t = rowsToTrack([
      row({ t: 0 }),
      row({ t: 1, lat: 1, lon: 2, heightM: 3, ts: 5 }),
    ]);
    assert.deepEqual(t, [{ lat: 1, lon: 2, alt: 3, ts: 5 }]);
  });

  it("keine verwertbaren Frames → status error mit Meldung", () => {
    const m = buildParsedMeta(
      FILE,
      { ...SUMMARY, stats: { frameCount: 3, empty: true } },
      [],
    );
    assert.equal(m.status, "error");
    assert.match(m.message!, /keine verwertbaren/);
  });

  it("Strecke: Details-Wert nur als Rückfall", () => {
    const m = buildParsedMeta(
      FILE,
      {
        ...SUMMARY,
        stats: { ...SUMMARY.stats, distanceM: 0 },
        details: { ...SUMMARY.details, totalDistance: 812.4 },
      },
      [],
    );
    assert.equal(m.totalDistanceM, 812);
  });

  it("verschlüsselt ohne Schlüssel → undecryptable mit Basiswerten", () => {
    const m = buildUndecryptableMeta(
      FILE,
      { version: 14, details: SUMMARY.details },
      "Meldung",
      { parsedAt: "x" },
    );
    assert.equal(m.status, "undecryptable");
    assert.equal(m.message, "Meldung");
    assert.equal(m.durationSec, 610);
    assert.equal(m.maxAltitudeM, 61);
    assert.equal(m.batterySn, "4ERPL1234567");
    assert.equal(m.records, undefined);
    assert.equal(isLikelyTestStart(m), false);
  });

  it("prettyDroneName", () => {
    assert.equal(
      prettyDroneName({ productType: "Mini4Pro" }),
      "DJI Mini 4 Pro",
    );
    assert.equal(
      prettyDroneName({ productType: "MavicAir2S" }),
      "DJI Mavic Air 2S",
    );
    assert.equal(
      prettyDroneName({ productType: "Phantom4ProV2" }),
      "DJI Phantom 4 Pro V2",
    );
    assert.equal(
      prettyDroneName({ productType: "Matrice300RTK" }),
      "DJI Matrice 300 RTK",
    );
    assert.equal(
      prettyDroneName({
        productType: "Unbekannt (93)",
        aircraftName: "Mini 4K",
      }),
      "Mini 4K",
    );
    assert.equal(prettyDroneName({ productType: "None" }), undefined);
  });

  it("downsample", () => {
    assert.deepEqual(downsample([1, 2, 3], 5), [1, 2, 3]);
    assert.deepEqual(
      downsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3),
      [0, 5, 10],
    );
  });

  it("Gruppierung (Akku-Tausch) funktioniert mit den neuen Ergebnissen", () => {
    const a = toAnalyzeResult(
      buildParsedMeta({ ...FILE, objectPath: "a" }, SUMMARY, flightRows(20)),
    );
    const b = toAnalyzeResult(
      buildParsedMeta(
        { ...FILE, objectPath: "b" },
        { ...SUMMARY, stats: { ...SUMMARY.stats, startTs: T0 + 20 * 60_000 } },
        flightRows(20).map((r) => {
          const c = [...r];
          c[1] = (c[1] as number) + 20 * 60_000;
          return c;
        }),
      ),
    );
    const groups = groupDjiAnalyses([a, b]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 2);
    assert.equal(groups[0].droneName, "DJI Mavic 3 Pro");
  });
});

describe("Mapping → neuer Logbuch-Eintrag", () => {
  it("füllt Datum, Zeiten, Ort, Dauer, Höhe und hängt das Log an", () => {
    const meta = buildParsedMeta(FILE, SUMMARY, flightRows(50));
    const e = logbookEntryFromDjiLog(meta, {
      id: "d1",
      name: "Mavic",
      classMark: "C2",
    });
    assert.equal(e.droneId, "d1");
    assert.equal(e.droneName, "Mavic");
    assert.equal(e.droneClass, "C2");
    assert.match(e.flightDate, /^2025-06-0[12]$/);
    assert.equal(e.takeoffTime, new Date(T0).toISOString());
    assert.equal(e.landingTime, new Date(T0 + 610_000).toISOString());
    assert.equal(e.latitude, 50);
    assert.equal(e.longitude, 8);
    assert.equal(e.flightDurationMinutes, 10);
    assert.equal(e.maxAltitude, 60);
    assert.equal(e.incidentOccurred, false);
    assert.deepEqual(e.djiLogs, [meta]);
    assert.equal(e.sessionId, "dji-log:local-dji:fp");
  });

  it("ohne erkannte Drohne: Name aus dem Log, Klasse Bestand", () => {
    const meta = buildParsedMeta(FILE, SUMMARY, flightRows(5));
    const e = logbookEntryFromDjiLog(meta, null);
    assert.equal(e.droneId, "");
    assert.equal(e.droneName, "DJI Mavic 3 Pro");
    assert.equal(e.droneClass, "legacy");
  });
});

describe("Akku-Verknüpfung über Seriennummern", () => {
  const drones: LinkDrone[] = [
    {
      id: "d1",
      name: "Mavic Arbeit",
      model: "Mavic 3 Pro",
      serialNumber: "1581f5-bkd999",
      batteries: [
        {
          id: "b1",
          name: "Akku 1",
          serialNumber: "4ERPL1234567",
          createdAt: "2025-01-01",
        },
      ],
    },
    { id: "d2", name: "Mini", model: "Mini 4 Pro", serialNumber: "" },
    {
      id: "d3",
      name: "Alte Mavic",
      model: "Mavic 3 Pro",
      serialNumber: "OTHER0001",
      archivedAt: "2024-01-01",
    },
  ];

  it("normalizeSerial", () => {
    assert.equal(normalizeSerial(" 1581f5-bkd 999 "), "1581F5BKD999");
  });

  it("Drohne über Fluggeräte-Seriennummer, sonst eindeutigen Modellnamen", () => {
    assert.equal(
      findDroneForLog(drones, { aircraftSn: "1581F5BKD999", droneName: "egal" })
        ?.id,
      "d1",
    );
    assert.equal(
      findDroneForLog(drones, { droneName: "DJI Mini 4 Pro" })?.id,
      "d2",
    );
    // zwei Kandidaten mit gleichem Modell, aber d3 archiviert → eindeutig d1
    assert.equal(
      findDroneForLog(drones, { droneName: "DJI Mavic 3 Pro" })?.id,
      "d1",
    );
    // fremde Seriennummer bei hinterlegter Seriennummer → keine Zuordnung über den Namen
    assert.equal(
      findDroneForLog([drones[0]], {
        aircraftSn: "XYZ98765",
        droneName: "DJI Mavic 3 Pro",
      }),
      null,
    );
    assert.equal(findDroneForLog(drones, { droneName: "DJI Avata 2" }), null);
  });

  it("bekannter Akku: Verweis, Zyklen übernommen, zuletzt gesehen", () => {
    const r = linkBatteryForLog(
      drones[0],
      { batterySn: "4erpl-1234567", batteryCycleCount: 57, startTs: T0 },
      { now: "2026-11-16T00:00:00Z" },
    );
    assert.equal(r.batteryId, "b1");
    assert.equal(r.batteryLabel, "Akku 1");
    assert.equal(r.createdBattery, false);
    const b = r.updatedDrone!.batteries![0];
    assert.equal(b.cycleCount, 57);
    assert.equal(b.lastSeenAt, new Date(T0).toISOString());
    assert.equal(r.updatedDrone!.batteries!.length, 1);
    // älteres Log setzt Zyklen nicht zurück
    const r2 = linkBatteryForLog(r.updatedDrone!, {
      batterySn: "4ERPL1234567",
      batteryCycleCount: 40,
      startTs: T0 - 1e9,
    });
    assert.equal(r2.updatedDrone, null);
    assert.equal(r2.batteryId, "b1");
  });

  it("unbekannter Akku einer erkannten Drohne wird angelegt; leere Drohnen-S/N ergänzt", () => {
    const r = linkBatteryForLog(
      drones[1],
      {
        batterySn: "7BVPLBVDA104J3",
        aircraftSn: "1581F6Z9C23CP003",
        batteryCycleCount: 3,
      },
      { newId: () => "new-b", now: "2026-11-16T00:00:00Z" },
    );
    assert.equal(r.createdBattery, true);
    assert.equal(r.batteryId, "new-b");
    assert.equal(r.batteryLabel, "Akku …04J3");
    const d = r.updatedDrone!;
    assert.equal(d.serialNumber, "1581F6Z9C23CP003");
    assert.deepEqual(d.batteries, [
      {
        id: "new-b",
        name: "Akku …04J3",
        serialNumber: "7BVPLBVDA104J3",
        createdAt: "2026-11-16T00:00:00Z",
        source: "dji-log",
        cycleCount: 3,
        lastSeenAt: "2026-11-16T00:00:00Z",
      },
    ]);
    // Original unverändert (rein)
    assert.equal(drones[1].batteries, undefined);
  });

  it("ohne Akku-Seriennummer kein Akku", () => {
    const r = linkBatteryForLog(drones[0], {});
    assert.equal(r.batteryId, undefined);
    assert.equal(r.updatedDrone, null);
  });
});

describe("Akku-Statistik (Flüge pro Akku)", () => {
  const drones: LinkDrone[] = [
    {
      id: "d1",
      name: "Mavic",
      batteries: [
        {
          id: "b1",
          name: "Akku 1",
          serialNumber: "SN-AAAA1111",
          createdAt: "x",
          cycleCount: 50,
        },
        {
          id: "b2",
          name: "Akku 2",
          serialNumber: "SN-BBBB2222",
          createdAt: "x",
        },
      ],
    },
  ];
  const log = (o: Partial<DjiLogMeta>): DjiLogMeta => ({
    status: "parsed",
    fileName: "f",
    objectPath: Math.random().toString(),
    ...o,
  });
  const entries: LinkEntry[] = [
    // Flug mit Akku-Tausch: b1 (über batteryId) + b2 (nur Seriennummer)
    {
      id: "e1",
      droneId: "d1",
      flightDate: "2025-06-01",
      djiLogs: [
        log({
          batteryId: "b1",
          batterySn: "SN-AAAA1111",
          startTs: T0,
          minCellV: 3.6,
          maxBatteryTempC: 40,
          batteryCycleCount: 55,
        }),
        log({
          batterySn: "snbbbb2222",
          startTs: T0 + 30 * 60_000,
          minCellV: 3.4,
          maxBatteryTempC: 45,
        }),
      ],
    },
    {
      id: "e2",
      droneId: "d1",
      flightDate: "2025-06-10",
      djiLogs: [
        log({
          batteryId: "b1",
          startTs: T0 + 9 * 86_400_000,
          minCellV: 3.5,
          maxBatteryTempC: 52,
        }),
      ],
    },
    // manuelle Auswahl im Pre-Check
    {
      id: "e3",
      droneId: "d1",
      flightDate: "2025-07-01",
      preflight: { batteryUsage: [{ batteryId: "b2" }] },
    },
    // Akku einer unbekannten Drohne (nur im Log)
    {
      id: "e4",
      droneId: "",
      flightDate: "2025-05-01",
      djiLogs: [
        log({
          batterySn: "7BVPLBVDA104J3",
          droneName: "DJI Mini 4 Pro",
          startTs: T0 - 86_400_000,
          minCellV: 3.7,
          minCellEstimated: true,
        }),
      ],
    },
    // Legacy-Einzelfeld
    {
      id: "e5",
      droneId: "d1",
      flightDate: "2025-08-01",
      djiLog: log({ batterySn: "SN-AAAA1111", startTs: T0 + 60 * 86_400_000 }),
    },
  ];

  it("Flüge, letzte Nutzung, Zyklen, Verläufe", () => {
    const stats = computeBatteryStats(drones, entries);
    const b1 = stats.find((s) => s.batteryId === "b1")!;
    const b2 = stats.find((s) => s.batteryId === "b2")!;
    const ext = stats.find((s) => s.key === "sn:7BVPLBVDA104J3")!;
    assert.equal(b1.flightCount, 3);
    assert.equal(b1.cycleCount, 55);
    assert.equal(b1.lastUsedAt, new Date(T0 + 60 * 86_400_000).toISOString());
    assert.deepEqual(
      b1.trend.map((p) => p.minCellV),
      [3.6, 3.5],
    );
    assert.deepEqual(
      b1.trend.map((p) => p.maxTempC),
      [40, 52],
    );
    assert.equal(b1.lowestCellV, 3.5);
    assert.equal(b1.highestTempC, 52);
    assert.equal(b2.flightCount, 2); // e1 (Log über S/N) + e3 (manuell)
    assert.equal(b2.cycleCount, undefined);
    assert.equal(b2.lowestCellV, 3.4);
    assert.equal(ext.flightCount, 1);
    assert.equal(ext.name, "Akku …04J3");
    assert.equal(ext.droneName, "DJI Mini 4 Pro");
    assert.equal(
      ext.lowestCellV,
      undefined,
      "geschätzte Zellspannung zählt nicht",
    );
    // sortiert nach letzter Nutzung
    assert.equal(stats[0].batteryId, "b1");
  });

  it("entryUsesBattery", () => {
    assert.equal(
      entryUsesBattery(entries[0], { id: "b2", serialNumber: "SN-BBBB2222" }),
      true,
    );
    assert.equal(
      entryUsesBattery(entries[1], { id: "b2", serialNumber: "SN-BBBB2222" }),
      false,
    );
    assert.equal(entryUsesBattery(entries[2], { id: "b2" }), true);
  });

  it("formatTrend", () => {
    assert.equal(formatTrend([3.61, undefined, 3.55], 2, "V"), "3,61 → 3,55 V");
    assert.equal(formatTrend([], 0, "°C"), "—");
  });
});
