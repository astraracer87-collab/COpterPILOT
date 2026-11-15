// Config-Plugin plugins/withRcKeyEvents.js: MainActivity (.kt/.java) erhält
// dispatchKeyEvent/dispatchGenericMotionEvent/onGenericMotionEvent, MainApplication registriert
// RcKeysPackage, RcKeysModule.kt wird neben die MainActivity geschrieben.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const plugin = require(path.resolve(process.cwd(), "plugins/withRcKeyEvents.js"));

const KT_ACTIVITY = `package com.copterpilot.rc
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          super.invokeDefaultOnBackPressed()
          return
      }
      super.invokeDefaultOnBackPressed()
  }
}
`;

const JAVA_ACTIVITY = `package com.copterpilot.rc;

import android.os.Bundle;
import com.facebook.react.ReactActivity;

public class MainActivity extends ReactActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(null);
  }

  @Override
  protected String getMainComponentName() {
    return "main";
  }
}
`;

const KT_APPLICATION = `package com.copterpilot.rc

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }
}
`;

const KT_APPLICATION_OLD = `package com.copterpilot.rc

class MainApplication : Application(), ReactApplication {
  override fun getPackages(): List<ReactPackage> {
    val packages = PackageList(this).packages
    return packages
  }
}
`;

const JAVA_APPLICATION = `package com.copterpilot.rc;

public class MainApplication extends Application implements ReactApplication {
  @Override
  protected List<ReactPackage> getPackages() {
    @SuppressWarnings("UnnecessaryLocalVariable")
    List<ReactPackage> packages = new PackageList(this).getPackages();
    return packages;
  }
}
`;

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("withRcKeyEvents – MainActivity", () => {
  it("Kotlin: Overrides und Imports, Klasse bleibt geschlossen", () => {
    const out: string = plugin.applyRcKeysToMainActivity(KT_ACTIVITY, "kt");
    assert.ok(out.includes("override fun dispatchKeyEvent(event: KeyEvent): Boolean {"));
    assert.ok(out.includes('if (RcKeysModule.handleKeyEvent(event, "activity")) return true\n'));
    assert.ok(out.includes("return super.dispatchKeyEvent(event)"));
    assert.ok(out.includes("override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {"));
    assert.ok(out.includes("return super.dispatchGenericMotionEvent(event)"));
    assert.ok(out.includes("override fun onGenericMotionEvent(event: MotionEvent): Boolean {"));
    assert.ok(out.includes('if (RcKeysModule.handleMotionEvent(event, "activity-fallback")) return true\n'));
    assert.ok(out.includes("return super.onGenericMotionEvent(event)"));
    assert.equal(count(out, "import android.view.KeyEvent\n"), 1);
    assert.equal(count(out, "import android.view.MotionEvent\n"), 1);
    assert.ok(!out.includes("import android.view.KeyEvent;"));
    // Block steht vor der letzten schließenden Klammer
    assert.ok(out.trimEnd().endsWith("// @generated end rc-key-events\n}"));
    assert.equal(count(out, "{"), count(out, "}"));
    // vorhandener Code bleibt erhalten
    assert.ok(out.includes("override fun invokeDefaultOnBackPressed()"));
  });

  it("Kotlin: idempotent (zweiter Lauf ändert nichts)", () => {
    const once: string = plugin.applyRcKeysToMainActivity(KT_ACTIVITY, "kt");
    const twice: string = plugin.applyRcKeysToMainActivity(once, "kt");
    assert.equal(twice, once);
    assert.equal(count(twice, "fun dispatchKeyEvent"), 1);
  });

  it("Java: Overrides mit @Override und Semikolon-Imports, idempotent", () => {
    const out: string = plugin.applyRcKeysToMainActivity(JAVA_ACTIVITY, "java");
    assert.ok(out.includes("public boolean dispatchKeyEvent(KeyEvent event) {"));
    assert.ok(out.includes('if (RcKeysModule.handleKeyEvent(event, "activity")) return true;'));
    assert.ok(out.includes("public boolean onGenericMotionEvent(MotionEvent event) {"));
    assert.ok(out.includes('if (RcKeysModule.handleMotionEvent(event, "activity-fallback")) return true;'));
    assert.ok(out.includes("return super.dispatchKeyEvent(event);"));
    assert.ok(out.includes("public boolean dispatchGenericMotionEvent(MotionEvent event) {"));
    assert.ok(out.includes("import android.view.KeyEvent;"));
    assert.ok(out.includes("import android.view.MotionEvent;"));
    assert.equal(count(out, "{"), count(out, "}"));
    assert.equal(plugin.applyRcKeysToMainActivity(out, "java"), out);
  });

  it("vorhandene fremde dispatchKeyEvent-Überschreibung → Fehler statt Doppelung", () => {
    const fallback = KT_ACTIVITY.replace(
      "  override fun getMainComponentName",
      "  override fun onGenericMotionEvent(event: MotionEvent): Boolean = false\n\n  override fun getMainComponentName",
    );
    assert.throws(() => plugin.applyRcKeysToMainActivity(fallback, "kt"), /onGenericMotionEvent/);
    const src = KT_ACTIVITY.replace(
      "  override fun getMainComponentName",
      "  override fun dispatchKeyEvent(event: KeyEvent): Boolean = super.dispatchKeyEvent(event)\n\n  override fun getMainComponentName",
    );
    assert.throws(() => plugin.applyRcKeysToMainActivity(src, "kt"), /dispatchKeyEvent/);
  });
});

describe("withRcKeyEvents – MainApplication", () => {
  it("Kotlin (Expo 57, packages.apply): RcKeysPackage einmal registriert", () => {
    const out: string = plugin.applyRcKeysToMainApplication(KT_APPLICATION, "kt");
    assert.match(out, /PackageList\(this\)\.packages\.apply \{\n\s+add\(RcKeysPackage\(\)\)/);
    assert.equal(plugin.applyRcKeysToMainApplication(out, "kt"), out);
    assert.equal(count(out, "RcKeysPackage()"), 1);
  });

  it("Kotlin (val packages = …) und Java", () => {
    const kt: string = plugin.applyRcKeysToMainApplication(KT_APPLICATION_OLD, "kt");
    assert.match(kt, /val packages = PackageList\(this\)\.packages\n\s+packages\.add\(RcKeysPackage\(\)\)/);
    const java: string = plugin.applyRcKeysToMainApplication(JAVA_APPLICATION, "java");
    assert.match(java, /getPackages\(\);\n\s+packages\.add\(new RcKeysPackage\(\)\);/);
    assert.equal(plugin.applyRcKeysToMainApplication(java, "java"), java);
  });

  it("ohne PackageList → Fehler", () => {
    assert.throws(() => plugin.applyRcKeysToMainApplication("class MainApplication {}", "kt"), /PackageList/);
  });
});

describe("withRcKeyEvents – RcKeysModule.kt", () => {
  it("Quelltext: Paket, Modulname, Ereignisse, Aufnahme-Modus, nie BACK abfangen", () => {
    const src: string = plugin.buildRcKeysModuleSource("com.copterpilot.rc");
    assert.ok(src.includes("package com.copterpilot.rc\n"));
    assert.ok(src.includes('const val NAME = "RcKeys"'));
    assert.ok(src.includes('emit("rcKey", m)'));
    assert.ok(src.includes('emit("rcMotion"'));
    assert.ok(src.includes("fun setCaptureMode(enabled: Boolean)"));
    assert.ok(src.includes("fun getDeviceInfo(promise: Promise)"));
    assert.ok(src.includes("@JvmStatic\n    fun handleKeyEvent(event: KeyEvent, via: String): Boolean"));
    assert.ok(src.includes("@JvmStatic\n    fun handleMotionEvent(event: MotionEvent, via: String): Boolean"));
    // Test-Modus: zusätzliche Meldewege, Geräte-Änderungen, alle Achsen des Geräts
    assert.ok(src.includes("class RcWindowCallback(val base: Window.Callback) : Window.Callback by base"));
    assert.ok(src.includes('RcKeysModule.handleMotionEvent(event, "window")'));
    assert.ok(src.includes("setOnGenericMotionListener(viewMotionListener)"));
    assert.ok(src.includes("if (cb is RcWindowCallback) w.callback = cb.base"));
    assert.ok(src.includes("registerInputDeviceListener"));
    assert.ok(src.includes('emit("rcDevice", m)'));
    assert.ok(src.includes("for (r in dev.motionRanges) add(r.axis)"));
    assert.ok(src.includes("listeningEnabled && !isTouch(event)"));
    assert.ok(src.includes('File("/proc/bus/input/devices")'));
    assert.ok(src.includes("class RcKeysPackage : BaseReactPackage()"));
    const never = src.slice(src.indexOf("NEVER_CONSUME = setOf("), src.indexOf("CAPTURE = setOf("));
    for (const k of ["KEYCODE_BACK", "KEYCODE_HOME", "KEYCODE_POWER", "KEYCODE_VOLUME_UP", "KEYCODE_VOLUME_DOWN"]) {
      assert.ok(never.includes(`KeyEvent.${k},`), k);
    }
    assert.equal(count(src, "{"), count(src, "}"));
    assert.equal(count(src, "("), count(src, ")"));
    assert.ok(!src.includes("${"), "keine unaufgelösten Platzhalter");
  });

  it("writeRcKeysModule schreibt neben die MainActivity (Paket aus deren Quelltext)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rckeys-"));
    try {
      const act = path.join(dir, "MainActivity.kt");
      fs.writeFileSync(act, KT_ACTIVITY);
      const file: string = plugin.writeRcKeysModule(act, KT_ACTIVITY);
      assert.equal(file, path.join(dir, "RcKeysModule.kt"));
      assert.ok(fs.readFileSync(file, "utf8").startsWith("// @generated by plugins/withRcKeyEvents.js"));
      assert.ok(fs.readFileSync(file, "utf8").includes("package com.copterpilot.rc\n"));
      // Java-MainActivity: Paketzeile mit Semikolon
      plugin.writeRcKeysModule(act, JAVA_ACTIVITY);
      assert.ok(fs.readFileSync(file, "utf8").includes("package com.copterpilot.rc\n"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
