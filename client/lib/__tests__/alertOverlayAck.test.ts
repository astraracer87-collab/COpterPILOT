// Einblendung über anderen Apps + Quittieren (radarAlertLogic: filterAcknowledged
// / acknowledgeThreats / threatOverlayContent, radarMonitor: Einblendung statt
// Benachrichtigung, Quittieren per Ereignis und per Merker) und das
// Config-Plugin plugins/withAlertOverlay.js.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as path from "node:path";

import {
  acknowledgeThreats,
  checkApproachingAircraft,
  checkProximityAlerts,
  compassPoint,
  createAlertAckState,
  filterAcknowledged,
  threatOverlayContent,
  type AlertOverlayContent,
} from "../radarAlertLogic";
import {
  createRadarMonitor,
  RADAR_POLL_INTERVAL_MS,
  RADAR_TRAFFIC_NOTIFICATION_ID,
  type RadarMonitorDeps,
  type RadarNotification,
} from "../radarMonitor";
import type { AircraftState } from "../opensky";
import { SETTINGS, USER, ac } from "./helpers/radarFixtures";

const require = createRequire(import.meta.url);
const plugin = require(path.resolve(process.cwd(), "plugins/withAlertOverlay.js"));

function threats(list: AircraftState[]) {
  return {
    alerts: checkProximityAlerts(list, USER.lat, USER.lon, SETTINGS, 0),
    approaching: checkApproachingAircraft(list, USER.lat, USER.lon, SETTINGS, 0),
  };
}

describe("Quittieren (reine Logik)", () => {
  it("gleicher Konflikt bleibt still, neues Luftfahrzeug nicht", () => {
    const st = createAlertAckState();
    const t = threats([ac("a", 2)]);
    acknowledgeThreats(st, t.alerts, t.approaching);
    const same = threats([ac("a", 2)]);
    let r = filterAcknowledged(st, same.alerts, same.approaching);
    assert.equal(r.alerts.length, 0);
    const both = threats([ac("a", 2), ac("b", 2.5)]);
    r = filterAcknowledged(st, both.alerts, both.approaching);
    assert.deepEqual(r.alerts.map((a) => a.aircraft.icao24), ["b"]);
  });

  it("Eskalation TA → RA warnt erneut, Herabstufung bleibt still", () => {
    const st = createAlertAckState();
    const ta = threats([ac("a", 2)]);
    acknowledgeThreats(st, ta.alerts, ta.approaching);
    const ra = threats([ac("a", 0.8)]);
    let r = filterAcknowledged(st, ra.alerts, ra.approaching);
    assert.deepEqual(r.alerts.map((a) => a.level), ["critical"]);
    acknowledgeThreats(st, r.alerts, r.approaching);
    const back = threats([ac("a", 2)]);
    r = filterAcknowledged(st, back.alerts, back.approaching);
    assert.equal(r.alerts.length, 0);
  });

  it("Anflug quittiert → TA ist eine Eskalation", () => {
    const st = createAlertAckState();
    const appr = threats([ac("a", 4.5, { trueTrack: 180, velocity: 30 })]);
    assert.equal(appr.alerts.length, 0);
    assert.equal(appr.approaching.length, 1);
    acknowledgeThreats(st, appr.alerts, appr.approaching);
    assert.equal(filterAcknowledged(st, appr.alerts, appr.approaching).approaching.length, 0);
    const ta = threats([ac("a", 2, { trueTrack: 180, velocity: 30 })]);
    assert.equal(filterAcknowledged(st, ta.alerts, ta.approaching).alerts.length, 1);
  });

  it("Reset bei Entwarnung: verschwundenes Luftfahrzeug warnt beim nächsten Mal wieder", () => {
    const st = createAlertAckState();
    const t = threats([ac("a", 2)]);
    acknowledgeThreats(st, t.alerts, t.approaching);
    filterAcknowledged(st, [], []);
    assert.equal(st.acked.size, 0);
    const again = threats([ac("a", 2)]);
    assert.equal(filterAcknowledged(st, again.alerts, again.approaching).alerts.length, 1);
  });

  it("Inhalt der Einblendung: Titel, Kennung, Entfernung, Höhe, Richtung, Farbe", () => {
    const ra = threats([ac("muk6978", 0.8)]);
    const c = threatOverlayContent(ra.alerts, ra.approaching, USER.lat, USER.lon)!;
    assert.equal(c.level, "ra");
    assert.equal(c.title, "RA – Flugobjekt sehr nah!");
    assert.equal(c.text, "MUK6978 · 0,8 km · +300 m relativ · aus N (000°)");
    assert.ok(Math.abs(c.bearingDeg!) < 0.5 || Math.abs(c.bearingDeg! - 360) < 0.5);
    const ta = threats([ac("x", 2)]);
    const t = threatOverlayContent(ta.alerts, ta.approaching, USER.lat, USER.lon)!;
    assert.equal(t.level, "ta");
    assert.equal(t.title, "TRAFFIC – Flugobjekt nähert sich");
    assert.equal(threatOverlayContent([], [], USER.lat, USER.lon), null);
    assert.equal(compassPoint(44), "NO");
    assert.equal(compassPoint(-90), "W");
  });
});

interface OverlayHarness {
  deps: RadarMonitorDeps;
  clock: { t: number };
  list: { v: AircraftState[] };
  allowed: { v: boolean };
  showFails: { v: boolean };
  dismissedFlag: { v: boolean };
  calls: string[];
  shown: AlertOverlayContent[];
  notifications: RadarNotification[];
}

function overlayHarness(): OverlayHarness {
  const h: OverlayHarness = {
    clock: { t: 1_000_000 },
    list: { v: [] },
    allowed: { v: true },
    showFails: { v: false },
    dismissedFlag: { v: false },
    calls: [],
    shown: [],
    notifications: [],
    deps: null as unknown as RadarMonitorDeps,
  };
  h.deps = {
    now: () => h.clock.t,
    sleep: async (ms) => {
      h.clock.t += ms;
    },
    isAppActive: () => false,
    loadBackgroundEnabled: async () => true,
    hasLocationPermission: async () => false,
    loadAlarmSettings: async () => SETTINGS,
    fetchAircraft: async () => h.list.v,
    notify: async (n) => {
      h.notifications.push(n);
    },
    cancelNotification: async (id) => {
      h.calls.push(`cancel:${id}`);
    },
    triggerSound: (level) => h.calls.push(`sound:${level}`),
    updateSound: () => {},
    stopSound: () => h.calls.push("stop"),
    watchPosition: async () => () => {},
    service: { start: async () => {}, stop: async () => {} },
    acks: createAlertAckState(),
    overlay: {
      canShow: async () => h.allowed.v,
      show: async (c) => {
        if (h.showFails.v) throw new Error("BadTokenException");
        h.calls.push(`show:${c.level}`);
        h.shown.push(c);
        return true;
      },
      update: async (c) => {
        h.calls.push(`update:${c.level}`);
        return true;
      },
      hide: () => {
        h.calls.push("hide");
      },
      takeDismissed: async () => {
        const v = h.dismissedFlag.v;
        h.dismissedFlag.v = false;
        return v;
      },
    },
  };
  return h;
}

const PARAMS = { latitude: USER.lat, longitude: USER.lon, followGps: false, radiusKm: 10, raRadiusKm: 1, countryIso: "DE", pilotElevationMSL: 0 };

async function step(h: OverlayHarness, m: ReturnType<typeof createRadarMonitor>, list: AircraftState[]) {
  h.clock.t += RADAR_POLL_INTERVAL_MS;
  h.list.v = list;
  await m.tick();
}

describe("Hintergrund-Überwachung mit Einblendung", () => {
  it("Einblendung statt Benachrichtigung; Aktualisierung ohne Neuaufbau; grün bei Entwarnung", async () => {
    const h = overlayHarness();
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    await step(h, m, [ac("a", 2)]);
    await step(h, m, [ac("a", 1.8)]);
    await step(h, m, []);
    assert.deepEqual(h.calls, ["sound:warning", "show:ta", "update:ta", "stop", "update:clear"]);
    assert.equal(h.notifications.length, 0);
    assert.equal(h.shown[0]!.title, "TRAFFIC – Flugobjekt nähert sich");
    await m.stop();
  });

  it("Quittieren (Ereignis): Ton und Einblendung weg, gleicher Konflikt still, Eskalation und neues Luftfahrzeug warnen", async () => {
    const h = overlayHarness();
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    await step(h, m, [ac("a", 2)]);
    m.acknowledge();
    assert.deepEqual(h.calls.slice(-2), ["stop", "hide"]);
    h.calls.length = 0;
    await step(h, m, [ac("a", 2)]);
    await step(h, m, [ac("a", 1.9)]);
    assert.deepEqual(h.calls, [], "gleicher Konflikt bleibt still (auch keine grüne Entwarnung)");
    await step(h, m, [ac("a", 0.8)]);
    assert.deepEqual(h.calls, ["sound:critical", "show:ra"], "TA → RA warnt erneut");
    m.acknowledge();
    h.calls.length = 0;
    await step(h, m, [ac("a", 0.8), ac("b", 2.5)]);
    assert.deepEqual(h.calls, ["sound:warning", "show:ta"], "neues Luftfahrzeug warnt");
    await m.stop();
  });

  it("Quittieren per Merker (Rückfall ohne Ereignis) wirkt beim nächsten Durchlauf", async () => {
    const h = overlayHarness();
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    await step(h, m, [ac("a", 2)]);
    h.dismissedFlag.v = true;
    h.calls.length = 0;
    await step(h, m, [ac("a", 2)]);
    assert.deepEqual(h.calls, ["stop", "hide"]);
    await m.stop();
  });

  it("Reset bei Entwarnung: dasselbe Luftfahrzeug warnt nach Verschwinden erneut", async () => {
    const h = overlayHarness();
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    await step(h, m, [ac("a", 2)]);
    m.acknowledge();
    await step(h, m, []);
    h.calls.length = 0;
    await step(h, m, [ac("a", 2)]);
    assert.deepEqual(h.calls, ["sound:warning", "show:ta"]);
    await m.stop();
  });

  it("ohne Berechtigung bzw. bei Fehler der Einblendung: Ton + EINE Benachrichtigung mit fester ID", async () => {
    for (const mode of ["denied", "throws"] as const) {
      const h = overlayHarness();
      if (mode === "denied") h.allowed.v = false;
      else h.showFails.v = true;
      const m = createRadarMonitor(h.deps);
      await m.start(PARAMS);
      await step(h, m, [ac("a", 2)]);
      await step(h, m, [ac("a", 2)]);
      await step(h, m, []);
      assert.deepEqual(h.notifications.map((n) => n.kind), ["traffic-warning"], mode);
      assert.ok(h.calls.includes("sound:warning"));
      assert.ok(h.calls.includes(`cancel:${RADAR_TRAFFIC_NOTIFICATION_ID}`));
      assert.ok(!h.calls.some((c) => c.startsWith("show:")));
      await m.stop();
    }
  });

  it("App kommt in den Vordergrund → Einblendung weg (dort zeigt das Radar sein Banner)", async () => {
    const h = overlayHarness();
    let active = false;
    h.deps.isAppActive = () => active;
    const tasks: Array<() => Promise<void>> = [];
    h.deps.service.start = async (task) => {
      tasks.push(task);
    };
    const m = createRadarMonitor(h.deps);
    await m.start(PARAMS);
    h.list.v = [ac("a", 2)];
    let n = 0;
    h.deps.sleep = async (ms) => {
      h.clock.t += ms;
      n++;
      if (n === 1) active = true; // Pilot wechselt zurück in COpter Pilot
      if (n === 3) await m.stop();
    };
    // Dienst-Schleife: 1. Durchlauf im Hintergrund (Einblendung), dann Vordergrund
    await tasks[0]!();
    assert.deepEqual(h.calls.filter((c) => c === "show:ta" || c === "hide"), ["show:ta", "hide"]);
  });
});

describe("Config-Plugin withAlertOverlay", () => {
  const manifest = () => ({
    manifest: {
      $: {},
      "uses-permission": [{ $: { "android:name": "android.permission.INTERNET" } }],
      application: [{ $: {} }],
    },
  });

  it("SYSTEM_ALERT_WINDOW genau einmal (idempotent)", () => {
    const m = plugin.applyAlertOverlayManifest(plugin.applyAlertOverlayManifest(manifest()));
    const perms = m.manifest["uses-permission"].map((p: { $: Record<string, string> }) => p.$["android:name"]);
    assert.equal(perms.filter((p: string) => p === "android.permission.SYSTEM_ALERT_WINDOW").length, 1);
    assert.ok(perms.includes("android.permission.INTERNET"));
  });

  it("MainApplication.kt/.java: AlertOverlayPackage genau einmal", () => {
    const kt = `package com.copterpilot.rc
class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(RcKeysPackage()) // @generated rc-key-events
        },
    )
  }
}
`;
    const once = plugin.applyAlertOverlayToMainApplication(kt, "kt");
    const twice = plugin.applyAlertOverlayToMainApplication(once, "kt");
    assert.equal(once, twice);
    assert.equal((twice.match(/add\(AlertOverlayPackage\(\)\)/g) ?? []).length, 1);
    const java = `package com.copterpilot.rc;
public class MainApplication extends Application implements ReactApplication {
  protected List<ReactPackage> getPackages() {
    List<ReactPackage> packages = new PackageList(this).getPackages();
    return packages;
  }
}
`;
    const j = plugin.applyAlertOverlayToMainApplication(plugin.applyAlertOverlayToMainApplication(java, "java"), "java");
    assert.equal((j.match(/packages\.add\(new AlertOverlayPackage\(\)\);/g) ?? []).length, 1);
  });

  it("Kotlin-Modul: Overlay-Typ, nicht fokussierbar, Main-Thread, Ereignis + Merker, Fehler abgefangen", () => {
    const src: string = plugin.buildAlertOverlayModuleSource("com.copterpilot.rc");
    assert.match(src, /^\/\/ @generated by plugins\/withAlertOverlay\.js/);
    assert.match(src, /package com\.copterpilot\.rc\n/);
    assert.match(src, /TYPE_APPLICATION_OVERLAY/);
    assert.match(src, /FLAG_NOT_FOCUSABLE/);
    assert.match(src, /FLAG_NOT_TOUCH_MODAL/);
    assert.match(src, /Settings\.canDrawOverlays/);
    assert.match(src, /ACTION_MANAGE_OVERLAY_PERMISSION/);
    assert.match(src, /const val EVENT = "alertOverlayDismissed"/);
    assert.match(src, /dismissedFlag\.set\(true\)/);
    assert.match(src, /fun consumeDismissed\(promise: Promise\)/);
    assert.match(src, /main\.post \{ promise\.resolve\(showOnMain\(o, allowAdd = true\)\) \}/);
    assert.match(src, /"Quittieren"/);
    assert.match(src, /class AlertOverlayPackage : BaseReactPackage\(\)/);
    assert.match(src, /IMPORTANCE_MIN/);
    // Kein unmaskiertes JS-Template übrig
    assert.doesNotMatch(src, /\\\$\{/);
  });
});
