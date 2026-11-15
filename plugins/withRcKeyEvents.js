/**
 * Expo-Config-Plugin: Tasten und Rädchen der Fernsteuerung (DJI RC Pro 2 u. a.)
 * an JS melden – Schritt 1: nur Erfassung/Auswertung (Tasten-Test in den
 * Einstellungen), noch keine Funktionsbelegung.
 *
 *  - Schreibt android/app/src/main/java/<package>/RcKeysModule.kt (kleines
 *    natives Modul „RcKeys“ + RcKeysPackage) neben die MainActivity.
 *  - MainActivity (.kt oder .java): überschreibt dispatchKeyEvent und
 *    dispatchGenericMotionEvent; jedes Ereignis geht an
 *    RcKeysModule.handleKeyEvent/handleMotionEvent, die es (nur solange JS
 *    zuhört) per RCTDeviceEventEmitter als „rcKey“ bzw. „rcMotion“ meldet.
 *    Standard: NICHT abfangen (super), die normale Bedienung bleibt. Nur im
 *    „Aufnahme-Modus“ (setCaptureMode(true), Tasten-Test-Bildschirm) werden
 *    Steuerkreuz/5D-Knopf, Enter, Bild-auf/-ab, SYSTEM_NAVIGATION_*,
 *    F-Tasten und Gamepad-Knöpfe abgefangen. Zurück, Home, Ein/Aus,
 *    Lautstärke, App-Wechsel usw. werden nie abgefangen.
 *  - MainApplication (.kt oder .java): RcKeysPackage registrieren.
 *
 * Idempotent: der eingefügte Block ist markiert und wird bei erneutem Lauf
 * ersetzt, nicht verdoppelt.
 */
const fs = require("fs");
const path = require("path");
const { withMainActivity, withMainApplication, withDangerousMod, AndroidConfig } = require("expo/config-plugins");

const TAG = "rc-key-events";
const BEGIN = `// @generated begin ${TAG} - plugins/withRcKeyEvents.js`;
const END = `// @generated end ${TAG}`;

function stripGeneratedBlock(src) {
  const re = new RegExp(`\\n?[ \\t]*${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}[ \\t]*\\n?`, "g");
  return src.replace(re, "\n");
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addImports(src, imports, language) {
  const semi = language === "java" ? ";" : "";
  const missing = imports.filter((imp) => !new RegExp(`^import\\s+${escapeRe(imp)}\\s*;?\\s*$`, "m").test(src));
  if (!missing.length) return src;
  const lines = missing.map((imp) => `import ${imp}${semi}`).join("\n");
  const importRe = /^import\s+[^\n]+$/gm;
  let last = null;
  let m;
  while ((m = importRe.exec(src))) last = m;
  if (last) {
    const at = last.index + last[0].length;
    return src.slice(0, at) + "\n" + lines + src.slice(at);
  }
  const pkg = /^package\s+[^\n]+$/m.exec(src);
  if (!pkg) throw new Error("withRcKeyEvents: keine package-Zeile in der MainActivity gefunden");
  const at = pkg.index + pkg[0].length;
  return src.slice(0, at) + "\n\n" + lines + src.slice(at);
}

function activityBlock(language) {
  if (language === "java") {
    return [
      `  ${BEGIN}`,
      "  /** Tasten/Rädchen der Fernsteuerung an JS melden (Tasten-Test); abgefangen nur im Aufnahme-Modus. */",
      "  @Override",
      "  public boolean dispatchKeyEvent(KeyEvent event) {",
      "    if (RcKeysModule.handleKeyEvent(event)) return true;",
      "    return super.dispatchKeyEvent(event);",
      "  }",
      "",
      "  @Override",
      "  public boolean dispatchGenericMotionEvent(MotionEvent event) {",
      "    if (RcKeysModule.handleMotionEvent(event)) return true;",
      "    return super.dispatchGenericMotionEvent(event);",
      "  }",
      `  ${END}`,
    ].join("\n");
  }
  return [
    `  ${BEGIN}`,
    "  /** Tasten/Rädchen der Fernsteuerung an JS melden (Tasten-Test); abgefangen nur im Aufnahme-Modus. */",
    "  override fun dispatchKeyEvent(event: KeyEvent): Boolean {",
    "    if (RcKeysModule.handleKeyEvent(event)) return true",
    "    return super.dispatchKeyEvent(event)",
    "  }",
    "",
    "  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {",
    "    if (RcKeysModule.handleMotionEvent(event)) return true",
    "    return super.dispatchGenericMotionEvent(event)",
    "  }",
    `  ${END}`,
  ].join("\n");
}

/** Reine Funktion (testbar): MainActivity-Quelltext (.kt/.java) erweitern. */
function applyRcKeysToMainActivity(src, language) {
  const lang = language === "java" ? "java" : "kt";
  let out = stripGeneratedBlock(src);
  if (/\bdispatchKeyEvent\s*\(/.test(out) || /\bdispatchGenericMotionEvent\s*\(/.test(out)) {
    throw new Error(
      "withRcKeyEvents: MainActivity überschreibt dispatchKeyEvent/dispatchGenericMotionEvent bereits – bitte zusammenführen",
    );
  }
  out = addImports(out, ["android.view.KeyEvent", "android.view.MotionEvent"], lang);
  const close = out.lastIndexOf("}");
  if (close < 0) throw new Error("withRcKeyEvents: Klassenende der MainActivity nicht gefunden");
  const before = out.slice(0, close).replace(/\s*$/, "");
  return before + "\n\n" + activityBlock(lang) + "\n" + out.slice(close);
}

/** Reine Funktion (testbar): RcKeysPackage in MainApplication registrieren. */
function applyRcKeysToMainApplication(src, language) {
  if (/RcKeysPackage\(\)/.test(src)) return src;
  const marker = `// @generated ${TAG}`;
  if (language === "java") {
    const m = /^([ \t]*)List<ReactPackage>\s+(\w+)\s*=\s*new\s+PackageList\(this\)\.getPackages\(\);[^\n]*$/m.exec(src);
    if (!m) throw new Error("withRcKeyEvents: PackageList in MainApplication.java nicht gefunden");
    const at = m.index + m[0].length;
    return src.slice(0, at) + `\n${m[1]}${m[2]}.add(new RcKeysPackage()); ${marker}` + src.slice(at);
  }
  const apply = /^([ \t]*).*PackageList\(this\)\.packages\.apply\s*\{[^\n]*$/m.exec(src);
  if (apply) {
    const at = apply.index + apply[0].length;
    return src.slice(0, at) + `\n${apply[1]}  add(RcKeysPackage()) ${marker}` + src.slice(at);
  }
  const val = /^([ \t]*)(?:val|var)\s+(\w+)\s*=\s*PackageList\(this\)\.packages[^\n]*$/m.exec(src);
  if (val) {
    const at = val.index + val[0].length;
    return src.slice(0, at) + `\n${val[1]}${val[2]}.add(RcKeysPackage()) ${marker}` + src.slice(at);
  }
  throw new Error("withRcKeyEvents: PackageList in MainApplication.kt nicht gefunden");
}

function packageOf(src) {
  const m = /^package\s+([\w.]+)\s*;?\s*$/m.exec(src);
  if (!m) throw new Error("withRcKeyEvents: package der MainActivity nicht gefunden");
  return m[1];
}

/** Kotlin-Quelltext des nativen Moduls (RcKeysModule + RcKeysPackage). */
function buildRcKeysModuleSource(pkg) {
  return `// @generated by plugins/withRcKeyEvents.js – nicht von Hand ändern (wird bei expo prebuild neu geschrieben)
package ${pkg}

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import java.lang.ref.WeakReference

/**
 * Meldet Tasten ("rcKey") und Achsen-Bewegungen ("rcMotion") der Fernsteuerung an JS.
 * Aufruf aus MainActivity.dispatchKeyEvent/dispatchGenericMotionEvent.
 */
class RcKeysModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    contextRef = WeakReference(reactContext)
  }

  override fun invalidate() {
    if (contextRef?.get() === reactContext) {
      contextRef = null
      captureEnabled = false
      listeningEnabled = false
    }
    super.invalidate()
  }

  /** Aufnahme-Modus: Steuerkreuz/Enter/Bild-Tasten usw. abfangen (nur Tasten-Test). */
  @ReactMethod
  fun setCaptureMode(enabled: Boolean) {
    captureEnabled = enabled
  }

  /** Ereignisse nur senden, solange JS zuhört (sonst kein Aufwand im normalen Betrieb). */
  @ReactMethod
  fun setListening(enabled: Boolean) {
    contextRef = WeakReference(reactContext)
    listeningEnabled = enabled
    if (!enabled) lastMotionKey = null
  }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Double) {}

  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    try {
      val map = Arguments.createMap()
      map.putString("model", Build.MODEL)
      map.putString("manufacturer", Build.MANUFACTURER)
      map.putString("brand", Build.BRAND)
      map.putString("product", Build.PRODUCT)
      map.putString("device", Build.DEVICE)
      map.putString("hardware", Build.HARDWARE)
      map.putString("board", Build.BOARD)
      map.putString("display", Build.DISPLAY)
      map.putString("release", Build.VERSION.RELEASE)
      map.putInt("sdkInt", Build.VERSION.SDK_INT)
      map.putBoolean("captureMode", captureEnabled)
      val devices = Arguments.createArray()
      for (id in InputDevice.getDeviceIds()) {
        val d = InputDevice.getDevice(id) ?: continue
        val dm = Arguments.createMap()
        dm.putInt("id", d.id)
        dm.putString("name", d.name)
        dm.putString("descriptor", d.descriptor)
        dm.putInt("sources", d.sources)
        dm.putArray("sourceNames", sourceNames(d.sources))
        dm.putInt("vendorId", d.vendorId)
        dm.putInt("productId", d.productId)
        dm.putString("keyboardType", keyboardTypeName(d.keyboardType))
        dm.putBoolean("isVirtual", d.isVirtual)
        if (Build.VERSION.SDK_INT >= 29) dm.putBoolean("isExternal", d.isExternal)
        dm.putInt("controllerNumber", d.controllerNumber)
        val axes = Arguments.createArray()
        val seen = HashSet<Int>()
        for (r in d.motionRanges) {
          if (seen.add(r.axis)) axes.pushString(MotionEvent.axisToString(r.axis))
        }
        dm.putArray("axes", axes)
        devices.pushMap(dm)
      }
      map.putArray("inputDevices", devices)
      promise.resolve(map)
    } catch (t: Throwable) {
      promise.reject("E_RC_DEVICE_INFO", t.message, t)
    }
  }

  companion object {
    const val NAME = "RcKeys"
    private const val MOTION_MIN_INTERVAL_MS = 33L

    @Volatile private var captureEnabled: Boolean = false
    @Volatile private var listeningEnabled: Boolean = false
    private var contextRef: WeakReference<ReactApplicationContext>? = null

    private val handler by lazy { Handler(Looper.getMainLooper()) }
    private var lastMotionKey: String? = null
    private var lastMotionAt = 0L
    private var pendingMotion: WritableMap? = null
    private val flushMotion = Runnable {
      val p = pendingMotion
      pendingMotion = null
      if (p != null) {
        lastMotionAt = SystemClock.uptimeMillis()
        emit("rcMotion", p)
      }
    }

    /** Nie abfangen: System- und Zurück-Tasten behalten ihr normales Verhalten. */
    private val NEVER_CONSUME = setOf(
      KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_HOME, KeyEvent.KEYCODE_POWER,
      KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_VOLUME_MUTE,
      KeyEvent.KEYCODE_MUTE, KeyEvent.KEYCODE_APP_SWITCH, KeyEvent.KEYCODE_SLEEP,
      KeyEvent.KEYCODE_WAKEUP, KeyEvent.KEYCODE_CAMERA, KeyEvent.KEYCODE_FOCUS,
      KeyEvent.KEYCODE_ASSIST, KeyEvent.KEYCODE_VOICE_ASSIST, KeyEvent.KEYCODE_MENU,
      KeyEvent.KEYCODE_SEARCH, KeyEvent.KEYCODE_NOTIFICATION, KeyEvent.KEYCODE_ALL_APPS,
      KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_HEADSETHOOK, KeyEvent.KEYCODE_ESCAPE,
      KeyEvent.KEYCODE_BUTTON_B, // Fallback des Systems: Zurück
      KeyEvent.KEYCODE_BUTTON_MODE, // Fallback des Systems: App-Wechsel
    )

    /** Im Aufnahme-Modus abfangen: Navigation (5D-Knopf), Enter, Bild-Tasten. */
    private val CAPTURE = setOf(
      KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_LEFT,
      KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_CENTER,
      KeyEvent.KEYCODE_DPAD_UP_LEFT, KeyEvent.KEYCODE_DPAD_UP_RIGHT,
      KeyEvent.KEYCODE_DPAD_DOWN_LEFT, KeyEvent.KEYCODE_DPAD_DOWN_RIGHT,
      KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_SPACE,
      KeyEvent.KEYCODE_TAB, KeyEvent.KEYCODE_PAGE_UP, KeyEvent.KEYCODE_PAGE_DOWN,
      KeyEvent.KEYCODE_MOVE_HOME, KeyEvent.KEYCODE_MOVE_END,
      KeyEvent.KEYCODE_SYSTEM_NAVIGATION_UP, KeyEvent.KEYCODE_SYSTEM_NAVIGATION_DOWN,
      KeyEvent.KEYCODE_SYSTEM_NAVIGATION_LEFT, KeyEvent.KEYCODE_SYSTEM_NAVIGATION_RIGHT,
      KeyEvent.KEYCODE_UNKNOWN,
    )

    private val AXES = intArrayOf(
      MotionEvent.AXIS_HAT_X, MotionEvent.AXIS_HAT_Y,
      MotionEvent.AXIS_X, MotionEvent.AXIS_Y, MotionEvent.AXIS_Z, MotionEvent.AXIS_RX,
      MotionEvent.AXIS_RY, MotionEvent.AXIS_RZ,
      MotionEvent.AXIS_VSCROLL, MotionEvent.AXIS_HSCROLL, MotionEvent.AXIS_SCROLL,
      MotionEvent.AXIS_LTRIGGER, MotionEvent.AXIS_RTRIGGER, MotionEvent.AXIS_BRAKE,
      MotionEvent.AXIS_GAS, MotionEvent.AXIS_THROTTLE, MotionEvent.AXIS_RUDDER, MotionEvent.AXIS_WHEEL,
      MotionEvent.AXIS_GENERIC_1, MotionEvent.AXIS_GENERIC_2, MotionEvent.AXIS_GENERIC_3,
      MotionEvent.AXIS_GENERIC_4, MotionEvent.AXIS_GENERIC_5, MotionEvent.AXIS_GENERIC_6,
      MotionEvent.AXIS_GENERIC_7, MotionEvent.AXIS_GENERIC_8, MotionEvent.AXIS_GENERIC_9,
      MotionEvent.AXIS_GENERIC_10, MotionEvent.AXIS_GENERIC_11, MotionEvent.AXIS_GENERIC_12,
      MotionEvent.AXIS_GENERIC_13, MotionEvent.AXIS_GENERIC_14, MotionEvent.AXIS_GENERIC_15,
      MotionEvent.AXIS_GENERIC_16,
    )

    private val SOURCES = listOf(
      InputDevice.SOURCE_KEYBOARD to "KEYBOARD",
      InputDevice.SOURCE_DPAD to "DPAD",
      InputDevice.SOURCE_GAMEPAD to "GAMEPAD",
      InputDevice.SOURCE_TOUCHSCREEN to "TOUCHSCREEN",
      InputDevice.SOURCE_MOUSE to "MOUSE",
      InputDevice.SOURCE_STYLUS to "STYLUS",
      InputDevice.SOURCE_BLUETOOTH_STYLUS to "BLUETOOTH_STYLUS",
      InputDevice.SOURCE_TRACKBALL to "TRACKBALL",
      InputDevice.SOURCE_MOUSE_RELATIVE to "MOUSE_RELATIVE",
      InputDevice.SOURCE_TOUCHPAD to "TOUCHPAD",
      InputDevice.SOURCE_TOUCH_NAVIGATION to "TOUCH_NAVIGATION",
      InputDevice.SOURCE_ROTARY_ENCODER to "ROTARY_ENCODER",
      InputDevice.SOURCE_JOYSTICK to "JOYSTICK",
      InputDevice.SOURCE_HDMI to "HDMI",
    )

    private val deviceNames = HashMap<Int, String>()

    @JvmStatic
    fun sourceNames(sources: Int): WritableArray {
      val arr = Arguments.createArray()
      for ((flag, name) in SOURCES) if ((sources and flag) == flag) arr.pushString(name)
      return arr
    }

    private fun keyboardTypeName(t: Int): String = when (t) {
      InputDevice.KEYBOARD_TYPE_ALPHABETIC -> "alphabetic"
      InputDevice.KEYBOARD_TYPE_NON_ALPHABETIC -> "non_alphabetic"
      else -> "none"
    }

    private fun deviceName(id: Int): String {
      deviceNames[id]?.let { return it }
      val found: String? = try { InputDevice.getDevice(id)?.name } catch (ignored: Throwable) { null }
      val name = found ?: (if (id == KeyCharacterMap.VIRTUAL_KEYBOARD) "virtual" else "?")
      deviceNames[id] = name
      return name
    }

    private fun emit(event: String, payload: WritableMap) {
      val ctx = contextRef?.get() ?: return
      try {
        if (ctx.hasActiveReactInstance()) ctx.emitDeviceEvent(event, payload)
      } catch (ignored: Throwable) {
      }
    }

    /** true = Taste abfangen (nur im Aufnahme-Modus, nie System-/Zurück-Tasten). */
    @JvmStatic
    fun shouldConsumeKey(keyCode: Int, deviceId: Int): Boolean {
      if (!captureEnabled) return false
      if (deviceId == KeyCharacterMap.VIRTUAL_KEYBOARD) return false
      if (NEVER_CONSUME.contains(keyCode)) return false
      return CAPTURE.contains(keyCode) ||
        KeyEvent.isGamepadButton(keyCode) ||
        keyCode in KeyEvent.KEYCODE_F1..KeyEvent.KEYCODE_F12
    }

    @JvmStatic
    fun handleKeyEvent(event: KeyEvent): Boolean {
      val consume = shouldConsumeKey(event.keyCode, event.deviceId)
      if (listeningEnabled) {
        try {
          val m = Arguments.createMap()
          m.putString("type", "key")
          m.putString(
            "action",
            when (event.action) {
              KeyEvent.ACTION_DOWN -> "down"
              KeyEvent.ACTION_UP -> "up"
              else -> "multiple"
            },
          )
          m.putInt("keyCode", event.keyCode)
          m.putString("keyName", KeyEvent.keyCodeToString(event.keyCode))
          m.putInt("scanCode", event.scanCode)
          m.putInt("repeatCount", event.repeatCount)
          m.putInt("metaState", event.metaState)
          m.putInt("flags", event.flags)
          m.putInt("source", event.source)
          m.putArray("sourceNames", sourceNames(event.source))
          m.putInt("deviceId", event.deviceId)
          m.putString("deviceName", deviceName(event.deviceId))
          val dev = try { event.device } catch (ignored: Throwable) { null }
          if (dev != null) {
            m.putString("deviceDescriptor", dev.descriptor)
            m.putInt("deviceSources", dev.sources)
            m.putBoolean("isJoystick", (dev.sources and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK)
            m.putBoolean("isVirtual", dev.isVirtual)
          }
          m.putBoolean("isGamepad", KeyEvent.isGamepadButton(event.keyCode))
          m.putBoolean("isSystem", event.isSystem)
          m.putBoolean("consumed", consume)
          m.putDouble("eventTime", event.eventTime.toDouble())
          m.putDouble("timestamp", System.currentTimeMillis().toDouble())
          emit("rcKey", m)
        } catch (ignored: Throwable) {
        }
      }
      return consume
    }

    private fun isCaptureSource(ev: MotionEvent): Boolean =
      ev.isFromSource(InputDevice.SOURCE_JOYSTICK) ||
        ev.isFromSource(InputDevice.SOURCE_GAMEPAD) ||
        ev.isFromSource(InputDevice.SOURCE_ROTARY_ENCODER) ||
        ev.isFromSource(InputDevice.SOURCE_TRACKBALL)

    @JvmStatic
    fun handleMotionEvent(event: MotionEvent): Boolean {
      val stick = isCaptureSource(event)
      val mouse = event.isFromSource(InputDevice.SOURCE_MOUSE) || event.isFromSource(InputDevice.SOURCE_TOUCHPAD)
      val action = event.actionMasked
      if (listeningEnabled && (stick || mouse)) {
        try {
          // Maus/Touchpad: nur Rad und Knöpfe (keine Zeiger-Bewegung)
          val relevant = if (mouse && !stick) {
            action == MotionEvent.ACTION_SCROLL || action == MotionEvent.ACTION_BUTTON_PRESS || action == MotionEvent.ACTION_BUTTON_RELEASE
          } else {
            true
          }
          if (relevant) reportMotion(event, stick)
        } catch (ignored: Throwable) {
        }
      }
      return captureEnabled && stick
    }

    private fun reportMotion(event: MotionEvent, stick: Boolean) {
      val axes = Arguments.createMap()
      val key = StringBuilder()
      var any = false
      for (a in AXES) {
        if (!stick && (a == MotionEvent.AXIS_X || a == MotionEvent.AXIS_Y)) continue
        val v = event.getAxisValue(a)
        if (v != 0f && !v.isNaN()) {
          val name = MotionEvent.axisToString(a).removePrefix("AXIS_")
          axes.putDouble(name, Math.round(v * 1000f) / 1000.0)
          key.append(name).append('=').append(Math.round(v * 100f)).append(';')
          any = true
        }
      }
      key.append("b=").append(event.buttonState).append(";s=").append(event.source).append(";d=").append(event.deviceId)
      val k = key.toString()
      if (k == lastMotionKey) return
      lastMotionKey = k
      val m = Arguments.createMap()
      m.putString("type", "motion")
      m.putString("action", MotionEvent.actionToString(event.actionMasked))
      m.putInt("source", event.source)
      m.putArray("sourceNames", sourceNames(event.source))
      m.putInt("deviceId", event.deviceId)
      m.putString("deviceName", deviceName(event.deviceId))
      m.putInt("buttonState", event.buttonState)
      m.putMap("axes", axes)
      m.putBoolean("centered", !any)
      m.putBoolean("consumed", captureEnabled && stick)
      m.putDouble("eventTime", event.eventTime.toDouble())
      m.putDouble("timestamp", System.currentTimeMillis().toDouble())
      val now = SystemClock.uptimeMillis()
      val wait = lastMotionAt + MOTION_MIN_INTERVAL_MS - now
      if (wait <= 0) {
        handler.removeCallbacks(flushMotion)
        pendingMotion = null
        lastMotionAt = now
        emit("rcMotion", m)
      } else {
        // höchstens ~30/s: neuesten Stand nachreichen (z. B. Rückkehr in die Mitte)
        val first = pendingMotion == null
        pendingMotion = m
        if (first) handler.postDelayed(flushMotion, wait)
      }
    }
  }
}

class RcKeysPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == RcKeysModule.NAME) RcKeysModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      RcKeysModule.NAME to ReactModuleInfo(
        RcKeysModule.NAME,
        RcKeysModule::class.java.name,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        false, // isTurboModule (Legacy-Interop)
      ),
    )
  }
}
`;
}

/** Schreibt RcKeysModule.kt neben die MainActivity; gibt den Pfad zurück. */
function writeRcKeysModule(mainActivityPath, mainActivitySource) {
  const pkg = packageOf(mainActivitySource);
  const file = path.join(path.dirname(mainActivityPath), "RcKeysModule.kt");
  fs.writeFileSync(file, buildRcKeysModuleSource(pkg));
  return file;
}

module.exports = function withRcKeyEvents(config) {
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const act = await AndroidConfig.Paths.getMainActivityAsync(cfg.modRequest.projectRoot);
      writeRcKeysModule(act.path, act.contents);
      return cfg;
    },
  ]);
  config = withMainActivity(config, (cfg) => {
    cfg.modResults.contents = applyRcKeysToMainActivity(cfg.modResults.contents, cfg.modResults.language);
    return cfg;
  });
  config = withMainApplication(config, (cfg) => {
    cfg.modResults.contents = applyRcKeysToMainApplication(cfg.modResults.contents, cfg.modResults.language);
    return cfg;
  });
  return config;
};
module.exports.applyRcKeysToMainActivity = applyRcKeysToMainActivity;
module.exports.applyRcKeysToMainApplication = applyRcKeysToMainApplication;
module.exports.buildRcKeysModuleSource = buildRcKeysModuleSource;
module.exports.writeRcKeysModule = writeRcKeysModule;
module.exports.RC_KEYS_MARKER_BEGIN = BEGIN;
