// Akustischer TCAS-Alarm: welcher Ton zu welchem Alarm gehört
// (decideAlarmTone, radarAlertLogic.ts) und dass Vorder-/Hintergrund die
// Richtung („nähert sich“ / „entfernt sich“) an den Ton weitergeben.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALARM_TONE_REPEAT_CRITICAL_MS,
  ALARM_TONE_REPEAT_WARNING_MS,
  alertsApproaching,
  checkApproachingAircraft,
  checkProximityAlerts,
  decideAlarmTone,
  decideProximityAlarm,
  VIBRATE_CRITICAL,
  VIBRATE_SOFT,
  VIBRATE_WARNING,
  type ProximityDecisionState,
} from "../radarAlertLogic";
import { createRadarMonitor, type RadarMonitorDeps } from "../radarMonitor";
import type { AircraftState } from "../opensky";
import type { ProximityAlarmSettings } from "../storage";
import { SETTINGS, USER, ac } from "./helpers/radarFixtures";

// Flugzeuge nördlich des Piloten: Kurs 180° = fliegt auf ihn zu, 0° = weg
const toward = (id: string, km: number) =>
  ac(id, km, { trueTrack: 180, velocity: 30 });
const away = (id: string, km: number) =>
  ac(id, km, { trueTrack: 0, velocity: 30 });

function withLevel(
  level: "ta" | "ra",
  patch: Partial<ProximityAlarmSettings["ta"]>,
): ProximityAlarmSettings {
  return { ...SETTINGS, [level]: { ...SETTINGS[level], ...patch } };
}

describe("decideAlarmTone", () => {
  it("RA: lauter Ton, alle 3 s, Vibration, Ansage – auch wenn es sich entfernt", () => {
    for (const approaching of [true, false]) {
      assert.deepEqual(decideAlarmTone("critical", approaching, SETTINGS), {
        tone: "critical",
        repeatMs: ALARM_TONE_REPEAT_CRITICAL_MS,
        vibrate: VIBRATE_CRITICAL,
        speak: true,
      });
    }
  });

  it("TA nähert sich: lauter Doppelton, alle 6 s, Vibration, Ansage", () => {
    assert.deepEqual(decideAlarmTone("warning", true, SETTINGS), {
      tone: "warning",
      repeatMs: ALARM_TONE_REPEAT_WARNING_MS,
      vibrate: VIBRATE_WARNING,
      speak: true,
    });
  });

  it("TA entfernt sich: ein leiser Einzelton, keine Wiederholung, keine Ansage", () => {
    assert.deepEqual(decideAlarmTone("warning", false, SETTINGS), {
      tone: "soft",
      repeatMs: null,
      vibrate: VIBRATE_SOFT,
      speak: false,
    });
  });

  it("ohne Einstellungen (Standard) ist der Ton an", () => {
    assert.equal(decideAlarmTone("warning", true).tone, "warning");
    assert.equal(decideAlarmTone("critical", true, null).tone, "critical");
    assert.equal(
      decideAlarmTone("warning", true, {} as ProximityAlarmSettings).tone,
      "warning",
    );
  });

  it("„Akustisch“ aus → stumm, Vibration bleibt; „Vibration“ aus → nur Ton", () => {
    const taMuted = decideAlarmTone(
      "warning",
      true,
      withLevel("ta", { audio: false }),
    );
    assert.equal(taMuted.tone, null);
    assert.equal(taMuted.repeatMs, null);
    assert.equal(taMuted.speak, false);
    assert.deepEqual(taMuted.vibrate, VIBRATE_WARNING);
    // TA-Einstellung betrifft RA nicht
    assert.equal(
      decideAlarmTone("critical", true, withLevel("ta", { audio: false })).tone,
      "critical",
    );
    const raNoHaptic = decideAlarmTone(
      "critical",
      true,
      withLevel("ra", { haptic: false }),
    );
    assert.equal(raNoHaptic.tone, "critical");
    assert.equal(raNoHaptic.vibrate, null);
    const raMuted = decideAlarmTone(
      "critical",
      true,
      withLevel("ra", { audio: false, haptic: false }),
    );
    assert.deepEqual(raMuted, {
      tone: null,
      repeatMs: null,
      vibrate: null,
      speak: false,
    });
  });
});

describe("Richtung im Alarm-Entscheid", () => {
  const st = (): ProximityDecisionState => ({
    currentLevel: "none",
    lastAlarmTime: 0,
  });
  const alerts = (list: AircraftState[]) =>
    checkProximityAlerts(list, USER.lat, USER.lon, SETTINGS, 0);
  const appr = (list: AircraftState[]) =>
    checkApproachingAircraft(list, USER.lat, USER.lon, SETTINGS, 0);

  it("TA, Flugobjekt entfernt sich → approaching false (leiser Ton)", () => {
    const list = [away("cfg5an", 1.6)];
    const d = decideProximityAlarm(st(), alerts(list), appr(list), 10_000);
    assert.equal(d.action, "trigger");
    assert.ok(
      d.action === "trigger" &&
        d.level === "warning" &&
        d.approaching === false,
    );
    assert.equal(decideAlarmTone("warning", false, SETTINGS).tone, "soft");
  });

  it("TA, Flugobjekt nähert sich → approaching true (lauter Ton)", () => {
    const list = [toward("dlh1", 2)];
    const d = decideProximityAlarm(st(), alerts(list), appr(list), 10_000);
    assert.ok(
      d.action === "trigger" && d.level === "warning" && d.approaching === true,
    );
  });

  it("Kurs unbekannt → wie „nähert sich“ (im Zweifel laut)", () => {
    assert.equal(alertsApproaching(alerts([ac("x", 2)])), true);
    const d = decideProximityAlarm(st(), alerts([ac("x", 2)]), [], 10_000);
    assert.ok(d.action === "trigger" && d.approaching === true);
  });

  it("ein Flugzeug entfernt sich, ein anderes nähert sich → laut", () => {
    assert.equal(
      alertsApproaching(alerts([away("a", 1.5), toward("b", 2.5)])),
      true,
    );
  });

  it("reiner Anflug (noch kein TA) → approaching true", () => {
    const list = [toward("far", 4.5)];
    const d = decideProximityAlarm(st(), [], appr(list), 100_000);
    assert.ok(
      d.action === "trigger" &&
        d.reason === "approach" &&
        d.approaching === true,
    );
  });

  it("laufender TA: update meldet Richtungswechsel", () => {
    const s: ProximityDecisionState = {
      currentLevel: "warning",
      lastAlarmTime: 10_000,
    };
    const d1 = decideProximityAlarm(s, alerts([away("a", 2)]), [], 12_000);
    assert.ok(d1.action === "update" && d1.approaching === false);
    const d2 = decideProximityAlarm(s, alerts([toward("a", 2)]), [], 14_000);
    assert.ok(d2.action === "update" && d2.approaching === true);
  });
});

describe("Hintergrund-Überwachung gibt die Richtung an den Ton weiter", () => {
  function deps(
    list: { v: AircraftState[] },
    calls: unknown[][],
  ): RadarMonitorDeps {
    let t = 1_000_000;
    return {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      isAppActive: () => false,
      loadBackgroundEnabled: async () => true,
      hasLocationPermission: async () => false,
      loadAlarmSettings: async () => SETTINGS,
      fetchAircraft: async () => list.v,
      notify: async () => {},
      triggerSound: (...a) =>
        calls.push(["trigger", ...a.filter((_, i) => i !== 1)]),
      updateSound: (...a) => calls.push(["update", ...a]),
      stopSound: () => calls.push(["stop"]),
      watchPosition: async () => () => {},
      service: { start: async () => {}, stop: async () => {} },
    };
  }

  it("entfernt sich → triggerSound(approaching=false); dreht → updateSound(true)", async () => {
    const list = { v: [away("cfg5an", 1.6)] };
    const calls: unknown[][] = [];
    const m = createRadarMonitor(deps(list, calls));
    await m.start({
      latitude: USER.lat,
      longitude: USER.lon,
      followGps: false,
      radiusKm: 10,
      raRadiusKm: 1,
      countryIso: "DE",
      pilotElevationMSL: 0,
    });
    await m.tick();
    assert.equal(calls[0]![0], "trigger");
    assert.equal(calls[0]![1], "warning");
    assert.equal(calls[0]![3], false);
    list.v = [toward("cfg5an", 1.5)];
    await m.tick();
    assert.equal(calls[1]![0], "update");
    assert.equal(calls[1]![2], true);
    await m.stop("screen");
  });
});
