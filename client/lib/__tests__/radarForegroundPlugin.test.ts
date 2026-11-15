// Config-Plugin plugins/withRadarForegroundService.js: Berechtigungen und
// Dienst-Eintrag (Android 14: foregroundServiceType) im AndroidManifest.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const plugin = require(path.resolve(process.cwd(), "plugins/withRadarForegroundService.js"));

function manifest(extra: Record<string, unknown> = {}) {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      "uses-permission": [{ $: { "android:name": "android.permission.INTERNET" } }, { $: { "android:name": "android.permission.WAKE_LOCK" } }],
      application: [{ $: { "android:name": ".MainApplication" }, activity: [], ...extra }],
    },
  };
}

describe("withRadarForegroundService", () => {
  it("ergänzt Berechtigungen (ohne Doppelte) und den Dienst mit Typ location|dataSync", () => {
    const out = plugin.applyRadarForegroundService(manifest());
    const perms = out.manifest["uses-permission"].map((p: { $: Record<string, string> }) => p.$["android:name"]);
    for (const p of [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.WAKE_LOCK",
      "android.permission.VIBRATE",
    ]) {
      assert.equal(perms.filter((x: string) => x === p).length, 1, p);
    }
    assert.ok(!perms.includes("android.permission.ACCESS_BACKGROUND_LOCATION"));
    const svc = out.manifest.application[0].service;
    assert.deepEqual(svc, [
      {
        $: {
          "android:name": "com.asterinet.react.bgactions.RNBackgroundActionsTask",
          "android:foregroundServiceType": "location|dataSync",
          "android:exported": "false",
        },
      },
    ]);
  });

  it("ist idempotent und ergänzt einen vorhandenen Dienst-Eintrag", () => {
    const m = manifest({ service: [{ $: { "android:name": "com.asterinet.react.bgactions.RNBackgroundActionsTask" } }] });
    const once = plugin.applyRadarForegroundService(m);
    const twice = plugin.applyRadarForegroundService(JSON.parse(JSON.stringify(once)));
    assert.deepEqual(twice, once);
    assert.equal(once.manifest.application[0].service.length, 1);
    assert.equal(once.manifest.application[0].service[0].$["android:foregroundServiceType"], "location|dataSync");
  });

  it("ist in app.json eingetragen", () => {
    const app = require(path.resolve(process.cwd(), "app.json"));
    assert.ok(app.expo.plugins.includes("./plugins/withRadarForegroundService"));
  });
});
