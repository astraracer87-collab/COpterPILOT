// Hintergrund-Überwachung (client/lib/radarMonitor.ts) mit nachgebautem
// Vordergrunddienst: Start/Stopp, Einstellung, Diensttyp, GPS, 4-h-Ende,
// Vordergrund vs. Hintergrund, gleiche Alarme wie der Radar-Screen.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createRadarMonitor,
  isBackgroundMonitorActive,
  RADAR_TRAFFIC_NOTIFICATION_ID,
  radarNotificationId,
  RADAR_MONITOR_MAX_RUNTIME_MS,
  RADAR_MONITOR_STOP_URL,
  RADAR_MONITOR_TITLE,
  RADAR_POLL_INTERVAL_MS,
  type RadarMonitorDeps,
  type RadarMonitorParams,
  type RadarNotification,
  type RadarServiceStartOptions,
} from "../radarMonitor";
import {
  applyTrigger,
  checkApproachingAircraft,
  checkProximityAlerts,
  computeRadarAreaFlags,
  createAlertAckState,
  decideProximityAlarm,
  type ProximityDecisionState,
  type RadarAreaSnapshot,
} from "../radarAlertLogic";
import type { AircraftState } from "../opensky";
import { SETTINGS, USER, ac } from "./helpers/radarFixtures";

interface Harness {
  deps: RadarMonitorDeps;
  clock: { t: number };
  appActive: { v: boolean };
  notifications: RadarNotification[];
  sounds: string[];
  serviceStarts: RadarServiceStartOptions[];
  serviceStops: number;
  tasks: Array<() => Promise<void>>;
  fetches: Array<[number, number]>;
  aircraft: { list: AircraftState[] };
  area: { snap: RadarAreaSnapshot | null; fetched: number };
  cancelled: string[];
  gps: { cb: ((lat: number, lon: number) => void) | null; unwatched: number };
  bgEnabled: { v: boolean };
  locPerm: { v: boolean };
  sleeps: number;
}

function harness(): Harness {
  const h: Harness = {
    clock: { t: 1_000_000 },
    appActive: { v: true },
    notifications: [],
    sounds: [],
    serviceStarts: [],
    serviceStops: 0,
    tasks: [],
    fetches: [],
    aircraft: { list: [] },
    area: { snap: null, fetched: 0 },
    cancelled: [],
    gps: { cb: null, unwatched: 0 },
    bgEnabled: { v: true },
    locPerm: { v: true },
    sleeps: 0,
    deps: null as unknown as RadarMonitorDeps,
  };
  h.deps = {
    now: () => h.clock.t,
    // Simulierte Zeit: jeder Schlaf rückt die Uhr vor
    sleep: async (ms) => {
      h.sleeps++;
      h.clock.t += ms;
    },
    isAppActive: () => h.appActive.v,
    loadBackgroundEnabled: async () => h.bgEnabled.v,
    hasLocationPermission: async () => h.locPerm.v,
    loadAlarmSettings: async () => SETTINGS,
    fetchAircraft: async (lat, lon) => {
      h.fetches.push([lat, lon]);
      return h.aircraft.list;
    },
    notify: async (n) => {
      h.notifications.push(n);
    },
    cancelNotification: async (id) => {
      h.cancelled.push(id);
    },
    acks: createAlertAckState(),
    triggerSound: (level) => h.sounds.push(level),
    stopSound: () => h.sounds.push("stop"),
    watchPosition: async (cb) => {
      h.gps.cb = cb;
      return () => {
        h.gps.unwatched++;
      };
    },
    service: {
      start: async (task, opts) => {
        h.serviceStarts.push(opts);
        h.tasks.push(task);
      },
      stop: async () => {
        h.serviceStops++;
      },
    },
  };
  return h;
}

const PARAMS: RadarMonitorParams = {
  latitude: USER.lat,
  longitude: USER.lon,
  followGps: true,
  radiusKm: 10,
  raRadiusKm: 1,
  countryIso: "DE",
  pilotElevationMSL: 0,
};

describe("Start/Stopp des Vordergrunddienstes", () => {
  it("startet mit Daueranzeige, Typ „location“ und Stopp-Link; stoppt beim Verlassen", async () => {
    const h = harness();
    const m = createRadarMonitor(h.deps);
    assert.equal(await m.start(PARAMS), true);
    assert.equal(h.serviceStarts.length, 1);
    assert.equal(h.serviceStarts[0]!.title, RADAR_MONITOR_TITLE);
    assert.equal(h.serviceStarts[0]!.title, "COpter Pilot – Luftraumüberwachung aktiv");
    assert.equal(h.serviceStarts[0]!.foregroundServiceType, "location");
    assert.equal(h.serviceStarts[0]!.linkingURI, RADAR_MONITOR_STOP_URL);
    assert.equal(m.status().running, true);
    assert.equal(isBackgroundMonitorActive(), true);
    // zweiter Start = nur Aktualisierung, kein zweiter Dienst
    assert.equal(await m.start({ ...PARAMS, radiusKm: 20 }), true);
    assert.equal(h.serviceStarts.length, 1);
    await m.stop("screen");
    assert.equal(h.serviceStops, 1);
    assert.equal(m.status().running, false);
    assert.equal(m.status().lastStopReason, "screen");
    assert.equal(isBackgroundMonitorActive(), false);
  });

  it("Einstellung „Im Hintergrund weiter überwachen“ aus → kein Dienst", async () => {
    const h = harness();
    h.bgEnabled.v = false;
    const m = createRadarMonitor(h.deps);
    assert.equal(await m.start(PARAMS), false);
    assert.equal(h.serviceStarts.length, 0);
  });

  it("ohne Standort-Berechtigung bzw. manueller Standort → Typ „dataSync“, kein GPS", async () => {
    const h = harness();
    h.locPerm.v = false;
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    assert.equal(h.serviceStarts[0]!.foregroundServiceType, "dataSync");
    const h2 = harness();
    const m2 = createRadarMonitor(h2.deps);
    await m2.start({ ...PARAMS, followGps: false });
    assert.equal(h2.serviceStarts[0]!.foregroundServiceType, "dataSync");
  });

  it("Stopp während des Starts → kein verwaister Dienst", async () => {
    const h = harness();
    let release!: () => void;
    h.deps.hasLocationPermission = () => new Promise((r) => (release = () => r(true)));
    const m = createRadarMonitor(h.deps);
    const p = m.start(PARAMS);
    await new Promise((r) => setImmediate(r));
    await m.stop("screen");
    release();
    assert.equal(await p, false);
    assert.equal(h.serviceStarts.length, 0);
    assert.equal(m.status().running, false);
  });

  it("Dienst-Start schlägt fehl → nicht laufend, Grund „error“", async () => {
    const h = harness();
    h.deps.service.start = async () => {
      throw new Error("ForegroundServiceStartNotAllowedException");
    };
    const m = createRadarMonitor(h.deps);
    assert.equal(await m.start(PARAMS), false);
    assert.equal(m.status().lastStopReason, "error");
    assert.equal(isBackgroundMonitorActive(), false);
  });
});

describe("Schleife im Dienst", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("Vordergrund: keine Abfrage (Radar-Screen prüft); Hintergrund: alle 2 s", async () => {
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    let n = 0;
    h.deps.sleep = async (ms) => {
      h.clock.t += ms;
      n++;
      if (n === 3) h.appActive.v = false; // App geht in den Hintergrund (DJI Fly)
      if (n === 8) await m.stop("user");
    };
    await h.tasks[0]!();
    assert.equal(h.fetches.length, 5);
    assert.equal(h.serviceStops, 1);
    assert.equal(m.status().lastStopReason, "user");
    assert.equal(h.gps.unwatched, 1);
  });

  it("GPS-Position wird im Dienst fortgeschrieben", async () => {
    const m = createRadarMonitor(h.deps);
    h.appActive.v = false;
    await m.start(PARAMS);
    let n = 0;
    h.deps.sleep = async (ms) => {
      h.clock.t += ms;
      n++;
      if (n === 1) h.gps.cb!(51, 9);
      // Screen meldet seinen (alten) Einzel-Fix → GPS des Dienstes gewinnt
      if (n === 1) m.update({ latitude: USER.lat, longitude: USER.lon });
      if (n === 2) await m.stop();
    };
    await h.tasks[0]!();
    assert.deepEqual(h.fetches, [
      [USER.lat, USER.lon],
      [51, 9],
    ]);
  });

  it("nach 4 h automatisch beendet, mit Hinweis", async () => {
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    h.clock.t += RADAR_MONITOR_MAX_RUNTIME_MS - RADAR_POLL_INTERVAL_MS;
    await h.tasks[0]!();
    assert.equal(m.status().running, false);
    assert.equal(m.status().lastStopReason, "timeout");
    assert.equal(h.serviceStops, 1);
    assert.deepEqual(h.notifications.at(-1), {
      kind: "stopped",
      title: "Luftraumüberwachung beendet",
      body: "Nach 4 Stunden automatisch beendet. Radar öffnen, um erneut zu überwachen.",
    });
  });
});

describe("Alarme im Hintergrund = Alarme im Vordergrund", () => {
  // Verkehrslage je Abfrage (2-s-Takt): kommt näher, RA, entfernt sich, kommt wieder
  const SCRIPT: AircraftState[][] = [
    [],
    [ac("x", 2.5)],
    [ac("x", 2)],
    [ac("x", 0.8)],
    [ac("x", 0.8)],
    [ac("x", 2)],
    [],
    [ac("x", 2)], // erneut TA (letzter Alarm > 3 s her)
    [ac("x", 2)],
    [],
    [ac("x", 4.5, { trueTrack: 180, velocity: 30 })], // nur Anflug: 6 s < 9 s Sperrzeit → still
    [],
    [ac("x", 4.5, { trueTrack: 180, velocity: 30 })], // 10 s > 9 s → Anflug-Warnung
  ];

  /** Vordergrund wie useProximityAlarm: gleiche Entscheidung, gleiche Zustandsfortschreibung */
  function foregroundTriggers(): Array<[number, string]> {
    const st: ProximityDecisionState = { currentLevel: "none", lastAlarmTime: 0 };
    const out: Array<[number, string]> = [];
    let t = 1_000_000;
    for (let i = 0; i < SCRIPT.length; i++) {
      t += RADAR_POLL_INTERVAL_MS;
      const alerts = checkProximityAlerts(SCRIPT[i]!, USER.lat, USER.lon, SETTINGS, 0);
      const approaching = checkApproachingAircraft(SCRIPT[i]!, USER.lat, USER.lon, SETTINGS, 0);
      const d = decideProximityAlarm(st, alerts, approaching, t);
      if (d.action === "trigger") {
        applyTrigger(st, d, t);
        out.push([i, d.level]);
      } else if (d.action === "update" && d.downgrade) st.currentLevel = "warning";
      else if (d.action === "clear") st.currentLevel = "none";
    }
    return out;
  }

  it("gleiche Auslösungen (Zeitpunkt und Stufe), Benachrichtigung + Sprachalarm", async () => {
    const h = harness();
    h.appActive.v = false;
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    const bg: Array<[number, string]> = [];
    for (let i = 0; i < SCRIPT.length; i++) {
      h.clock.t += RADAR_POLL_INTERVAL_MS;
      h.aircraft.list = SCRIPT[i]!;
      const before = h.notifications.length;
      await m.tick();
      for (const n of h.notifications.slice(before)) {
        if (n.kind === "traffic-critical") bg.push([i, "critical"]);
        if (n.kind === "traffic-warning") bg.push([i, "warning"]);
      }
    }
    const fg = foregroundTriggers();
    assert.deepEqual(bg, fg);
    assert.deepEqual(fg.map(([, l]) => l), ["warning", "critical", "warning", "warning"]);
    assert.ok(h.sounds.includes("critical") && h.sounds.includes("stop"));
    const ra = h.notifications.find((n) => n.kind === "traffic-critical")!;
    assert.equal(ra.title, "RA – Luftfahrzeug sehr nah!");
    assert.equal(h.notifications.filter((n) => n.kind === "traffic-warning").at(-1)!.title, "Luftfahrzeug im Anflug");
  });

  it("Geozonen und NOTAM-Status „unbekannt“ erzeugen im Hintergrund KEINE Benachrichtigung", async () => {
    const h = harness();
    h.appActive.v = false;
    // Auch wenn (alte Verdrahtung) eine Gebietsabfrage vorhanden wäre: sie wird nicht benutzt
    (h.deps as unknown as { fetchArea: () => Promise<RadarAreaSnapshot | null> }).fetchArea = async () => {
      h.area.fetched++;
      return h.area.snap;
    };
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    const flags = computeRadarAreaFlags({ forecast: null, kpValue: null, notamUnknown: true, highNotamCount: 0, tempRestrictionCount: 0, activeDipulCount: 0, geozoneCount: 6 });
    h.area.snap = {
      flags,
      zones: ["KOELN/BONN", "Koeln 1", "Koeln 2", "Koeln 3", "Koeln 4", "Koeln 5"].map((label, i) => ({ key: `z${i}`, label })),
      notams: [],
      notamUnknown: true,
    };
    // Salve von Durchläufen über 10 Minuten (alle 2 s), ohne Verkehr
    for (let i = 0; i < 300; i++) {
      h.clock.t += RADAR_POLL_INTERVAL_MS;
      await m.tick();
    }
    assert.equal(h.notifications.length, 0);
    assert.equal(h.area.fetched, 0);
    await m.stop();
  });

  it("Verkehr ohne Einblendung: höchstens EINE Benachrichtigung mit fester ID, bei Entwarnung entfernt", async () => {
    const h = harness();
    h.appActive.v = false;
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    const seq: AircraftState[][] = [[ac("muk6978", 2)], [ac("muk6978", 2)], [ac("muk6978", 0.8)], [ac("muk6978", 0.8)], [ac("muk6978", 0.8)], []];
    for (const list of seq) {
      h.clock.t += RADAR_POLL_INTERVAL_MS;
      h.aircraft.list = list;
      await m.tick();
    }
    // TA, dann Eskalation RA: zwei Meldungen, beide mit derselben festen ID (ersetzt, nicht gestapelt)
    assert.deepEqual(h.notifications.map((n) => n.kind), ["traffic-warning", "traffic-critical"]);
    assert.deepEqual(new Set(h.notifications.map((n) => radarNotificationId(n.kind))), new Set([RADAR_TRAFFIC_NOTIFICATION_ID]));
    // Entwarnung entfernt sie
    assert.deepEqual(h.cancelled, [RADAR_TRAFFIC_NOTIFICATION_ID]);
    await m.stop();
  });
});
