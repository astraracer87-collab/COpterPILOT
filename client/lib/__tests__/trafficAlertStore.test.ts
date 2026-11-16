// Radar-Tab: gemeinsamer Verkehrs-Warnzustand (client/lib/trafficAlertStore.ts)
// – Anzahl Luftfahrzeuge in TA/RA, stärkste Stufe, Farbe/Badge-Text, Quellen
// Vordergrund (Radar-Screen) und Hintergrund (radarMonitor).
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  __resetTrafficAlertStoreForTests,
  clearTrafficAlerts,
  getTrafficAlertState,
  publishTrafficAlerts,
  radarTabBadge,
  RA_COLOR,
  subscribeTrafficAlertState,
  summarizeTrafficAlerts,
  TA_COLOR,
} from "../trafficAlertStore";
import { acknowledgeThreats, checkProximityAlerts, createAlertAckState } from "../radarAlertLogic";
import { createRadarMonitor, RADAR_POLL_INTERVAL_MS, type RadarMonitorDeps } from "../radarMonitor";
import type { AircraftState } from "../opensky";
import { SETTINGS, USER, ac } from "./helpers/radarFixtures";

const alerts = (list: AircraftState[]) => checkProximityAlerts(list, USER.lat, USER.lon, SETTINGS, 0);

beforeEach(() => __resetTrafficAlertStoreForTests());

describe("Anzahl und Farbe", () => {
  it("0 Luftfahrzeuge → kein Badge", () => {
    const s = summarizeTrafficAlerts(alerts([ac("far", 4)]));
    assert.deepEqual(s, { level: "none", count: 0, acknowledged: 0 });
    assert.deepEqual(radarTabBadge(s), { visible: false, text: "", color: null, dimmed: false, pulseMs: null });
  });

  it("nur TA → orange, Zahl, langsamer Puls", () => {
    const s = summarizeTrafficAlerts(alerts([ac("a", 2), ac("b", 2.5)]));
    assert.deepEqual(s, { level: "warning", count: 2, acknowledged: 0 });
    const b = radarTabBadge(s);
    assert.equal(b.text, "2");
    assert.equal(b.color, TA_COLOR);
    assert.ok(b.pulseMs! >= 1000);
  });

  it("TA + RA → rot, Zahl aller Luftfahrzeuge, schnelles Blinken", () => {
    const s = summarizeTrafficAlerts(alerts([ac("a", 2), ac("b", 0.5), ac("c", 2.8)]));
    assert.deepEqual(s, { level: "critical", count: 3, acknowledged: 0 });
    const b = radarTabBadge(s);
    assert.equal(b.text, "3");
    assert.equal(b.color, RA_COLOR);
    assert.ok(b.pulseMs! < 400);
    assert.equal(radarTabBadge({ level: "critical", count: 120, acknowledged: 0 }).text, "99+");
  });

  it("quittierte Luftfahrzeuge zählen weiter; alle quittiert → gedimmt, ruhig", () => {
    const acks = createAlertAckState();
    const list = alerts([ac("a", 2)]);
    acknowledgeThreats(acks, list, []);
    const s = summarizeTrafficAlerts(list, acks);
    assert.deepEqual(s, { level: "warning", count: 1, acknowledged: 1 });
    const b = radarTabBadge(s);
    assert.equal(b.text, "1");
    assert.equal(b.dimmed, true);
    assert.equal(b.pulseMs, null);
  });
});

describe("Quellen Vorder-/Hintergrund", () => {
  it("Maximum beider; eine leer gemeldete Quelle zählt nicht mehr", () => {
    const seen: number[] = [];
    subscribeTrafficAlertState((s) => seen.push(s.count));
    publishTrafficAlerts("foreground", { level: "warning", count: 1, acknowledged: 0 });
    publishTrafficAlerts("background", { level: "critical", count: 2, acknowledged: 0 });
    assert.deepEqual(getTrafficAlertState(), { level: "critical", count: 2, acknowledged: 0 });
    clearTrafficAlerts("background");
    assert.deepEqual(getTrafficAlertState(), { level: "warning", count: 1, acknowledged: 0 });
    clearTrafficAlerts("foreground");
    assert.deepEqual(seen, [0, 1, 2, 1, 0]);
  });

  it("Hintergrund-Überwachung meldet die Anzahl je Durchlauf und leert beim Stopp", async () => {
    let list: AircraftState[] = [];
    let t = 1_000_000;
    const deps: RadarMonitorDeps = {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      isAppActive: () => false,
      loadBackgroundEnabled: async () => true,
      hasLocationPermission: async () => false,
      loadAlarmSettings: async () => SETTINGS,
      fetchAircraft: async () => list,
      notify: async () => {},
      triggerSound: () => {},
      stopSound: () => {},
      watchPosition: async () => () => {},
      service: { start: async () => {}, stop: async () => {} },
      acks: createAlertAckState(),
    };
    const m = createRadarMonitor(deps);
    await m.start({ latitude: USER.lat, longitude: USER.lon, followGps: false, radiusKm: 10, raRadiusKm: 1, countryIso: "DE", pilotElevationMSL: 0 });
    list = [ac("a", 2), ac("b", 0.5)];
    t += RADAR_POLL_INTERVAL_MS;
    await m.tick();
    assert.deepEqual(getTrafficAlertState(), { level: "critical", count: 2, acknowledged: 0 });
    m.acknowledge();
    t += RADAR_POLL_INTERVAL_MS;
    await m.tick();
    assert.deepEqual(getTrafficAlertState(), { level: "critical", count: 2, acknowledged: 2 });
    await m.stop();
    assert.deepEqual(getTrafficAlertState(), { level: "none", count: 0, acknowledged: 0 });
  });
});
