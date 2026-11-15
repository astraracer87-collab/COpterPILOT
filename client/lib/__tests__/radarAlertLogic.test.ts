// Gemeinsame Warnlogik des Radars (client/lib/radarAlertLogic.ts):
// Schwellen TA/RA/TTC/AGL, Sperrzeiten, Eskalation, Entwarnung, Gebiets-
// Markierungen und Hintergrund-Meldungen nur für Neues.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALARM_COOLDOWN_MS,
  APPROACH_COOLDOWN_MS,
  applyTrigger,
  checkApproachingAircraft,
  checkProximityAlerts,
  computeRadarAreaFlags,
  createAreaAlertState,
  decideAreaAlerts,
  decideProximityAlarm,
  filterDismissedThreats,
  proximityNotificationText,
  type ProximityDecisionState,
} from "../radarAlertLogic";
import { SETTINGS, USER, ac } from "./helpers/radarFixtures";

describe("Schwellen (TA/RA/TTC/AGL)", () => {
  it("RA-Radius → critical, TA-Radius → warning, außerhalb nichts", () => {
    const res = checkProximityAlerts([ac("a", 0.5), ac("b", 2), ac("c", 4)], USER.lat, USER.lon, SETTINGS, 0);
    assert.deepEqual(
      res.map((r) => [r.aircraft.icao24, r.level]),
      [
        ["a", "critical"],
        ["b", "warning"],
      ],
    );
  });

  it("TTC: schneller Anflug außerhalb des TA-Radius (≤ 1,5 × TA) → warning", () => {
    // 4 km, 200 m/s direkt auf den Piloten zu (Kurs 180°) → TTC 20 s ≤ 40 s
    const res = checkProximityAlerts([ac("fast", 4, { velocity: 200, trueTrack: 180 })], USER.lat, USER.lon, SETTINGS, 0);
    assert.equal(res[0]?.level, "warning");
    assert.ok(res[0]!.ttcSec! < 25);
  });

  it("über der AGL-Grenze (maxAltitudeM) wird nicht gewarnt", () => {
    const res = checkProximityAlerts([ac("high", 0.5, { baroAltitude: 900, geoAltitude: 900 })], USER.lat, USER.lon, SETTINGS, 100);
    assert.equal(res.length, 0);
  });

  it("Anflug: Kurs auf den Piloten im Erfassungsradius", () => {
    const res = checkApproachingAircraft([ac("app", 4.5, { trueTrack: 180, velocity: 50 }), ac("away", 4.5, { trueTrack: 0 })], USER.lat, USER.lon, SETTINGS, 0);
    assert.deepEqual(res.map((r) => r.aircraft.icao24), ["app"]);
  });

  it("TCAS aus → keine Treffer", () => {
    assert.equal(checkProximityAlerts([ac("a", 0.2)], USER.lat, USER.lon, { ...SETTINGS, enabled: false }, 0).length, 0);
  });
});

describe("Entscheidung und Sperrzeiten", () => {
  const alertsFor = (list: AircraftState[]) => checkProximityAlerts(list, USER.lat, USER.lon, SETTINGS, 0);
  const approachFor = (list: AircraftState[]) => checkApproachingAircraft(list, USER.lat, USER.lon, SETTINGS, 0);

  it("TA auslösen, danach nur aktualisieren; Eskalation auf RA sofort", () => {
    const st: ProximityDecisionState = { currentLevel: "none", lastAlarmTime: 0 };
    let d = decideProximityAlarm(st, alertsFor([ac("b", 2)]), [], 10_000);
    assert.equal(d.action, "trigger");
    assert.equal(d.action === "trigger" && d.level, "warning");
    applyTrigger(st, d, 10_000);
    d = decideProximityAlarm(st, alertsFor([ac("b", 2)]), [], 11_000);
    assert.equal(d.action, "update");
    d = decideProximityAlarm(st, alertsFor([ac("b", 0.5)]), [], 11_500);
    assert.equal(d.action === "trigger" && d.level, "critical");
    applyTrigger(st, d, 11_500);
    d = decideProximityAlarm(st, alertsFor([ac("b", 2)]), [], 12_000);
    assert.ok(d.action === "update" && d.downgrade);
  });

  it("Sperrzeit 3 s nach einem Alarm (auch nach Entwarnung)", () => {
    const st: ProximityDecisionState = { currentLevel: "none", lastAlarmTime: 10_000 };
    assert.equal(decideProximityAlarm(st, alertsFor([ac("b", 2)]), [], 10_000 + ALARM_COOLDOWN_MS).action, "none");
    assert.equal(decideProximityAlarm(st, alertsFor([ac("b", 2)]), [], 10_001 + ALARM_COOLDOWN_MS).action, "trigger");
  });

  it("reiner Anflug: dreifache Sperrzeit (9 s)", () => {
    const st: ProximityDecisionState = { currentLevel: "none", lastAlarmTime: 10_000 };
    const app = approachFor([ac("app", 4.5, { trueTrack: 180, velocity: 50 })]);
    assert.equal(decideProximityAlarm(st, [], app, 10_000 + APPROACH_COOLDOWN_MS).action, "none");
    const d = decideProximityAlarm(st, [], app, 10_001 + APPROACH_COOLDOWN_MS);
    assert.ok(d.action === "trigger" && d.reason === "approach" && d.level === "warning");
  });

  it("keine Bedrohung → Entwarnung; weggedrückt → kein Alarm", () => {
    const st: ProximityDecisionState = { currentLevel: "warning", lastAlarmTime: 0 };
    assert.equal(decideProximityAlarm(st, [], [], 50_000).action, "clear");
    assert.equal(decideProximityAlarm({ currentLevel: "none", lastAlarmTime: 0 }, alertsFor([ac("b", 2)]), [], 50_000, true).action, "none");
  });

  it("weggedrückte Flugzeuge bleiben unterdrückt, bis sie keine Bedrohung mehr sind", () => {
    const dismissed = new Set(["b"]);
    let r = filterDismissedThreats(alertsFor([ac("b", 2), ac("c", 2.5)]), [], dismissed);
    assert.deepEqual(r.alerts.map((a) => a.aircraft.icao24), ["c"]);
    r = filterDismissedThreats(alertsFor([ac("c", 2.5)]), [], dismissed);
    assert.equal(dismissed.size, 0);
  });

  it("Meldungstext deutsch mit Rufzeichen, Abstand und Höhe", () => {
    const d = decideProximityAlarm({ currentLevel: "none", lastAlarmTime: 0 }, alertsFor([ac("dlh1", 0.5)]), [], 10_000);
    assert.equal(d.action, "trigger");
    if (d.action !== "trigger") return;
    const t = proximityNotificationText(d);
    assert.equal(t.title, "RA – Luftfahrzeug sehr nah!");
    assert.match(t.body, /^DLH1 · 0,5 km · 300 m relativ$/);
  });
});

describe("Gebiet: Markierungen und Hintergrund-Meldungen", () => {
  const base = { forecast: null, kpValue: null, notamUnknown: false, highNotamCount: 0, tempRestrictionCount: 0, activeDipulCount: 0, geozoneCount: 0 };

  it("gleiche Schwellen wie bisher im Radar (Wind, Kp, NOTAM, Zonen)", () => {
    const f = { windSpeed: 11, rain: 0, snow: 0, temperature: 10, cloudCover: 0 };
    assert.equal(computeRadarAreaFlags({ ...base, forecast: f }).weatherStatus, "critical");
    assert.equal(computeRadarAreaFlags({ ...base, forecast: { ...f, windSpeed: 8 } }).weatherStatus, "caution");
    assert.equal(computeRadarAreaFlags({ ...base, forecast: { ...f, windSpeed: 3 }, kpValue: 6 }).wetter, true);
    assert.equal(computeRadarAreaFlags(base).weatherStatus, "unknown");
    assert.equal(computeRadarAreaFlags({ ...base, notamUnknown: true }).notam, true);
    assert.equal(computeRadarAreaFlags({ ...base, activeDipulCount: 1 }).notam, true);
    assert.equal(computeRadarAreaFlags({ ...base, geozoneCount: 2 }).geozone, true);
    assert.equal(computeRadarAreaFlags(base).notam, false);
  });

  it("Meldung nur für neue Zonen/NOTAM; wieder auftauchend → erneut", () => {
    const st = createAreaAlertState();
    const snap = (zones: string[], notams: string[], notamUnknown = false) => ({
      flags: computeRadarAreaFlags({ ...base, geozoneCount: zones.length, highNotamCount: notams.length, notamUnknown }),
      zones: zones.map((k) => ({ key: k, label: `Zone ${k}` })),
      notams: notams.map((k) => ({ key: k, label: `NOTAM ${k}` })),
      notamUnknown,
    });
    let n = decideAreaAlerts(st, snap(["z1"], ["n1"]));
    assert.deepEqual(n.map((x) => [x.kind, x.title, x.body]), [
      ["zone", "Geozone im Warnradius", "Zone z1"],
      ["notam", "NOTAM / Beschränkung aktiv", "NOTAM n1"],
    ]);
    assert.equal(decideAreaAlerts(st, snap(["z1"], ["n1"])).length, 0);
    n = decideAreaAlerts(st, snap(["z1", "z2", "z3", "z4", "z5"], ["n1"]));
    assert.deepEqual(n.map((x) => x.body), ["Zone z2, Zone z3, Zone z4 und 1 weitere"]);
    decideAreaAlerts(st, snap([], []));
    assert.equal(decideAreaAlerts(st, snap(["z1"], [])).length, 1);
    // NOTAM-Abfrage fehlgeschlagen: einmal je Ausfall
    assert.equal(decideAreaAlerts(st, snap(["z1"], [], true))[0]?.title, "NOTAM-Status unbekannt");
    assert.equal(decideAreaAlerts(st, snap(["z1"], [], true)).length, 0);
  });
});
