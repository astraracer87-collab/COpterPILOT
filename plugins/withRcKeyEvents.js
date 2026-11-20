/**
 * Expo-Config-Plugin: Tasten und Rädchen der Fernsteuerung (DJI RC Pro 2 u. a.)
 * an JS melden – Schritt 1: nur Erfassung/Auswertung (Tasten-Test in den
 * Einstellungen), noch keine Funktionsbelegung.
 *
 *  - Schreibt android/app/src/main/java/<package>/RcKeysModule.kt (kleines
 *    natives Modul „RcKeys“ + RcKeysPackage) neben die MainActivity.
 *  - MainActivity (.kt oder .java): überschreibt dispatchKeyEvent,
 *    dispatchGenericMotionEvent und onGenericMotionEvent; jedes Ereignis geht
 *    an RcKeysModule.handleKeyEvent/handleMotionEvent.
 *  - Test-Modus (setListening(true), nur solange der Tasten-Test zuhört):
 *    zusätzlich Hülle um Window.Callback und OnGenericMotionListener an
 *    DecorView/Inhalt/RN-Wurzel (Ereignisse unabhängig vom Fokus), Meldung
 *    jeder Taste jedes Geräts und jeder Bewegung jeder Quelle außer
 *    Touchscreen/Stift mit ALLEN Achsen des Geräts (auch 0) als „rcKey“ /
 *    „rcMotion“, Geräte-Änderungen als „rcDevice“. Bewegungen: nur bei
 *    Änderung, je Gerät höchstens ~30/s (neuester Stand wird nachgereicht).
 *    Jedes Ereignis wird nur einmal gemeldet („via“ = erster Meldeweg).
 *  - Standard: NICHT abfangen (super), die normale Bedienung bleibt. Nur im
 *    „Aufnahme-Modus“ (setCaptureMode(true), Tasten-Test-Bildschirm) werden
 *    Steuerkreuz/5D-Knopf, Enter, Bild-auf/-ab, SYSTEM_NAVIGATION_*,
 *    F-Tasten, Gamepad-Knöpfe und Joystick-/Rad-Bewegungen abgefangen.
 *    Zurück, Home, Ein/Aus, Lautstärke, App-Wechsel usw. werden nie
 *    abgefangen.
 *  - getDeviceInfo: Build-Angaben, Eingabegeräte mit Achsenbereichen und als
 *    Diagnose, ob /dev/input bzw. /proc/bus/input/devices lesbar sind
 *    (Achsen-Abfrage ohne Ereignis gibt es in Android nicht).
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
      '    if (RcKeysModule.handleKeyEvent(event, "activity")) return true;',
      "    return super.dispatchKeyEvent(event);",
      "  }",
      "",
      "  @Override",
      "  public boolean dispatchGenericMotionEvent(MotionEvent event) {",
      '    if (RcKeysModule.handleMotionEvent(event, "activity")) return true;',
      "    return super.dispatchGenericMotionEvent(event);",
      "  }",
      "",
      "  @Override",
      "  public boolean onGenericMotionEvent(MotionEvent event) {",
      '    if (RcKeysModule.handleMotionEvent(event, "activity-fallback")) return true;',
      "    return super.onGenericMotionEvent(event);",
      "  }",
      `  ${END}`,
    ].join("\n");
  }
  return [
    `  ${BEGIN}`,
    "  /** Tasten/Rädchen der Fernsteuerung an JS melden (Tasten-Test); abgefangen nur im Aufnahme-Modus. */",
    "  override fun dispatchKeyEvent(event: KeyEvent): Boolean {",
    '    if (RcKeysModule.handleKeyEvent(event, "activity")) return true',
    "    return super.dispatchKeyEvent(event)",
    "  }",
    "",
    "  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {",
    '    if (RcKeysModule.handleMotionEvent(event, "activity")) return true',
    "    return super.dispatchGenericMotionEvent(event)",
    "  }",
    "",
    "  override fun onGenericMotionEvent(event: MotionEvent): Boolean {",
    '    if (RcKeysModule.handleMotionEvent(event, "activity-fallback")) return true',
    "    return super.onGenericMotionEvent(event)",
    "  }",
    "",
    "  // Trackball-Bewegungen (manche Steuerknüppel/Steuerkreuze) kommen nicht über dispatchGenericMotionEvent",
    "  override fun dispatchTrackballEvent(event: MotionEvent): Boolean {",
    '    if (RcKeysModule.handleMotionEvent(event, "activity-trackball")) return true',
    "    return super.dispatchTrackballEvent(event)",
    "  }",
    `  ${END}`,
  ].join("\n");
}

/** Reine Funktion (testbar): MainActivity-Quelltext (.kt/.java) erweitern. */
function applyRcKeysToMainActivity(src, language) {
  const lang = language === "java" ? "java" : "kt";
  let out = stripGeneratedBlock(src);
  if (/\b(?:dispatchKeyEvent|dispatchGenericMotionEvent|onGenericMotionEvent)\s*\(/.test(out)) {
    throw new Error(
      "withRcKeyEvents: MainActivity überschreibt dispatchKeyEvent/dispatchGenericMotionEvent/onGenericMotionEvent bereits – bitte zusammenführen",
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

/** Kotlin-Quelltext des nativen Moduls (RcKeysModule, RcWindowCallback, RcKeysPackage). */
function buildRcKeysModuleSource(pkg) {
  return `// @generated by plugins/withRcKeyEvents.js – nicht von Hand ändern (wird bei expo prebuild neu geschrieben)
package ${pkg}

import android.app.Activity
import android.content.Context
import android.hardware.input.InputManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import java.io.File
import java.lang.ref.WeakReference

/**
 * Meldet Tasten ("rcKey"), Achsen-Bewegungen ("rcMotion") und Geräte-Änderungen
 * ("rcDevice") der Fernsteuerung an JS – nur solange JS zuhört (Tasten-Test).
 *
 * Meldewege (jedes Ereignis wird nur einmal gemeldet, "via" = erster Weg):
 *  - "activity": MainActivity.dispatchKeyEvent/dispatchGenericMotionEvent
 *  - "window": Hülle um Window.Callback (nur während des Tests eingesetzt)
 *  - "view": OnGenericMotionListener an DecorView/Inhalt/RN-Wurzel (Test)
 *  - "activity-fallback": MainActivity.onGenericMotionEvent
 */
class RcKeysModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), LifecycleEventListener {
  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    contextRef = WeakReference(reactContext)
    reactContext.addLifecycleEventListener(this)
  }

  override fun invalidate() {
    reactContext.removeLifecycleEventListener(this)
    if (contextRef?.get() === reactContext) {
      captureEnabled = false
      stopListening(reactContext)
      contextRef = null
    }
    super.invalidate()
  }

  override fun onHostResume() {
    // neue Activity/neues Fenster während des Tests: Haken erneut setzen
    if (listeningEnabled) handler.post { reactContext.currentActivity?.let { installHooks(it) } }
  }

  override fun onHostPause() {}

  override fun onHostDestroy() {}

  /** Aufnahme-Modus: Steuerkreuz/Enter/Bild-Tasten usw. abfangen (nur Tasten-Test). */
  @ReactMethod
  fun setCaptureMode(enabled: Boolean) {
    captureEnabled = enabled
  }

  /** Test-Modus: Ereignisse senden, zusätzliche Meldewege einsetzen (sonst kein Aufwand). */
  @ReactMethod
  fun setListening(enabled: Boolean) {
    contextRef = WeakReference(reactContext)
    if (enabled) startListening(reactContext) else stopListening(reactContext)
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
        val ranges = Arguments.createArray()
        val seen = HashSet<Int>()
        for (r in d.motionRanges) {
          if (seen.add(r.axis)) axes.pushString(MotionEvent.axisToString(r.axis))
          val rm = Arguments.createMap()
          rm.putString("axis", MotionEvent.axisToString(r.axis).removePrefix("AXIS_"))
          rm.putInt("source", r.source)
          rm.putDouble("min", r.min.toDouble())
          rm.putDouble("max", r.max.toDouble())
          rm.putDouble("flat", r.flat.toDouble())
          rm.putDouble("fuzz", r.fuzz.toDouble())
          rm.putDouble("resolution", r.resolution.toDouble())
          ranges.pushMap(rm)
        }
        dm.putArray("axes", axes)
        dm.putArray("ranges", ranges)
        devices.pushMap(dm)
      }
      map.putArray("inputDevices", devices)
      // Diagnose: direkter Zugriff auf die Kernel-Eingabegeräte (normale Apps: verweigert)
      val nodes = try { File("/dev/input").listFiles() } catch (ignored: Throwable) { null }
      if (nodes == null) {
        map.putNull("devInput")
      } else {
        val arr = Arguments.createArray()
        for (f in nodes.sortedBy { it.name }) {
          val nm = Arguments.createMap()
          nm.putString("name", f.name)
          nm.putBoolean("readable", try { f.canRead() } catch (ignored: Throwable) { false })
          arr.pushMap(nm)
        }
        map.putArray("devInput", arr)
      }
      val proc = try { File("/proc/bus/input/devices").readText().take(16000) } catch (ignored: Throwable) { null }
      if (proc == null) map.putNull("procInputDevices") else map.putString("procInputDevices", proc)
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
    private var hookedActivity: WeakReference<Activity>? = null
    private var deviceListener: InputManager.InputDeviceListener? = null

    private val handler by lazy { Handler(Looper.getMainLooper()) }

    private class MotionState {
      var lastKey: String? = null
      var lastAt = 0L
      var pending: WritableMap? = null
      val flush = Runnable {
        val p = pending
        pending = null
        if (p != null) {
          lastAt = SystemClock.uptimeMillis()
          emit("rcMotion", p)
        }
      }
    }

    private val motionStates = HashMap<Int, MotionState>()

    // Jedes Ereignis nur einmal melden, auch wenn es mehrere Meldewege passiert.
    private var lastKeyRef: WeakReference<KeyEvent>? = null
    private var lastKeyTime = -1L
    private var lastKeyAction = -1
    private var lastKeyRepeat = -1
    private var lastKeyResult = false
    private var lastMotionRef: WeakReference<MotionEvent>? = null
    private var lastMotionTime = -1L
    private var lastMotionAction = -1
    private var lastMotionResult = false

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

    /** Zusätzlich zu den Achsen des Geräts: diese Achsen melden, wenn ≠ 0. */
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

    private val viewMotionListener = View.OnGenericMotionListener { _, ev -> handleMotionEvent(ev, "view") }

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

    private fun startListening(ctx: ReactApplicationContext) {
      listeningEnabled = true
      handler.post {
        motionStates.clear()
        try {
          ctx.currentActivity?.let { installHooks(it) }
        } catch (ignored: Throwable) {
        }
        registerDeviceListener(ctx)
      }
    }

    private fun stopListening(ctx: ReactApplicationContext) {
      listeningEnabled = false
      handler.post {
        if (listeningEnabled) return@post
        try {
          hookedActivity?.get()?.let { uninstallHooks(it) }
        } catch (ignored: Throwable) {
        }
        hookedActivity = null
        unregisterDeviceListener(ctx)
        for (s in motionStates.values) handler.removeCallbacks(s.flush)
        motionStates.clear()
      }
    }

    /** Zusätzliche Meldewege (nur während des Tests): Window.Callback-Hülle und View-Listener. */
    private fun installHooks(activity: Activity) {
      val w = activity.window ?: return
      val cb = w.callback
      if (cb != null && cb !is RcWindowCallback) w.callback = RcWindowCallback(cb)
      w.decorView.setOnGenericMotionListener(viewMotionListener)
      val content = activity.findViewById<ViewGroup>(android.R.id.content)
      content?.setOnGenericMotionListener(viewMotionListener)
      if (content != null && content.childCount > 0) content.getChildAt(0).setOnGenericMotionListener(viewMotionListener)
      hookedActivity = WeakReference(activity)
    }

    private fun uninstallHooks(activity: Activity) {
      val w = activity.window ?: return
      val cb = w.callback
      if (cb is RcWindowCallback) w.callback = cb.base
      w.decorView.setOnGenericMotionListener(null)
      val content = activity.findViewById<ViewGroup>(android.R.id.content)
      content?.setOnGenericMotionListener(null)
      if (content != null && content.childCount > 0) content.getChildAt(0).setOnGenericMotionListener(null)
    }

    private fun registerDeviceListener(ctx: Context) {
      if (deviceListener != null) return
      val im = ctx.getSystemService(Context.INPUT_SERVICE) as? InputManager ?: return
      val l = object : InputManager.InputDeviceListener {
        override fun onInputDeviceAdded(deviceId: Int) = emitDevice("added", deviceId)
        override fun onInputDeviceRemoved(deviceId: Int) = emitDevice("removed", deviceId)
        override fun onInputDeviceChanged(deviceId: Int) = emitDevice("changed", deviceId)
      }
      im.registerInputDeviceListener(l, handler)
      deviceListener = l
    }

    private fun unregisterDeviceListener(ctx: Context) {
      val l = deviceListener ?: return
      deviceListener = null
      try {
        (ctx.getSystemService(Context.INPUT_SERVICE) as? InputManager)?.unregisterInputDeviceListener(l)
      } catch (ignored: Throwable) {
      }
    }

    private fun emitDevice(change: String, deviceId: Int) {
      if (!listeningEnabled) return
      try {
        val old = deviceNames.remove(deviceId)
        val dev = try { InputDevice.getDevice(deviceId) } catch (ignored: Throwable) { null }
        val m = Arguments.createMap()
        m.putString("type", "device")
        m.putString("change", change)
        m.putInt("deviceId", deviceId)
        m.putString("deviceName", dev?.name ?: old ?: "?")
        m.putInt("sources", dev?.sources ?: 0)
        m.putArray("sourceNames", sourceNames(dev?.sources ?: 0))
        m.putDouble("timestamp", System.currentTimeMillis().toDouble())
        emit("rcDevice", m)
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
    fun handleKeyEvent(event: KeyEvent): Boolean = handleKeyEvent(event, "activity")

    /** Jede Taste jedes Geräts melden (ohne Filter); Rückgabe: abfangen? */
    @JvmStatic
    fun handleKeyEvent(event: KeyEvent, via: String): Boolean {
      if (lastKeyRef?.get() === event && lastKeyTime == event.eventTime &&
        lastKeyAction == event.action && lastKeyRepeat == event.repeatCount
      ) {
        return lastKeyResult
      }
      val consume = shouldConsumeKey(event.keyCode, event.deviceId)
      lastKeyRef = WeakReference(event)
      lastKeyTime = event.eventTime
      lastKeyAction = event.action
      lastKeyRepeat = event.repeatCount
      lastKeyResult = consume
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
          m.putString("via", via)
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

    private fun isTouch(ev: MotionEvent): Boolean =
      ev.isFromSource(InputDevice.SOURCE_TOUCHSCREEN) ||
        ev.isFromSource(InputDevice.SOURCE_STYLUS) ||
        ev.isFromSource(InputDevice.SOURCE_BLUETOOTH_STYLUS)

    @JvmStatic
    fun handleMotionEvent(event: MotionEvent): Boolean = handleMotionEvent(event, "activity")

    /**
     * Bewegung melden (Test: jede Quelle außer Touchscreen/Stift, mit allen Achsen
     * des Geräts inkl. 0); Rückgabe: abfangen? (nur Aufnahme-Modus, Joystick/Rad)
     */
    @JvmStatic
    fun handleMotionEvent(event: MotionEvent, via: String): Boolean {
      if (lastMotionRef?.get() === event && lastMotionTime == event.eventTime && lastMotionAction == event.action) {
        return lastMotionResult
      }
      val stick = isCaptureSource(event)
      val consume = captureEnabled && stick
      lastMotionRef = WeakReference(event)
      lastMotionTime = event.eventTime
      lastMotionAction = event.action
      lastMotionResult = consume
      if (listeningEnabled && !isTouch(event)) {
        val action = event.actionMasked
        val hover = action == MotionEvent.ACTION_HOVER_MOVE ||
          action == MotionEvent.ACTION_HOVER_ENTER || action == MotionEvent.ACTION_HOVER_EXIT
        if (stick || !hover) {
          try {
            reportMotion(event, via, consume)
          } catch (ignored: Throwable) {
          }
        }
      }
      return consume
    }

    private fun reportMotion(event: MotionEvent, via: String, consume: Boolean) {
      val axes = Arguments.createMap()
      val key = StringBuilder(MotionEvent.actionToString(event.actionMasked)).append(';')
      val pointer = (event.source and InputDevice.SOURCE_CLASS_POINTER) != 0
      val seen = HashSet<Int>()
      var any = false
      fun add(a: Int) {
        if (!seen.add(a)) return
        val v = event.getAxisValue(a)
        if (v.isNaN()) return
        val name = MotionEvent.axisToString(a).removePrefix("AXIS_")
        axes.putDouble(name, Math.round(v * 1000f) / 1000.0)
        key.append(name).append('=').append(Math.round(v * 1000f)).append(';')
        if (v != 0f && !(pointer && (a == MotionEvent.AXIS_X || a == MotionEvent.AXIS_Y))) any = true
      }
      val dev = try { event.device } catch (ignored: Throwable) { null }
      if (dev != null) for (r in dev.motionRanges) add(r.axis)
      for (a in AXES) if (event.getAxisValue(a) != 0f) add(a)
      key.append("b=").append(event.buttonState).append(";s=").append(event.source)
      val st = motionStates.getOrPut(event.deviceId) { MotionState() }
      val k = key.toString()
      if (k == st.lastKey) return
      st.lastKey = k
      val m = Arguments.createMap()
      m.putString("type", "motion")
      m.putString("action", MotionEvent.actionToString(event.actionMasked))
      m.putInt("source", event.source)
      m.putArray("sourceNames", sourceNames(event.source))
      m.putInt("deviceId", event.deviceId)
      m.putString("deviceName", deviceName(event.deviceId))
      m.putInt("buttonState", event.buttonState)
      m.putInt("historySize", event.historySize)
      m.putMap("axes", axes)
      m.putBoolean("centered", !any)
      m.putBoolean("consumed", consume)
      m.putString("via", via)
      m.putDouble("eventTime", event.eventTime.toDouble())
      m.putDouble("timestamp", System.currentTimeMillis().toDouble())
      val now = SystemClock.uptimeMillis()
      val wait = st.lastAt + MOTION_MIN_INTERVAL_MS - now
      if (wait <= 0) {
        handler.removeCallbacks(st.flush)
        st.pending = null
        st.lastAt = now
        emit("rcMotion", m)
      } else {
        // höchstens ~30/s je Gerät: neuesten Stand nachreichen (z. B. Rückkehr in die Mitte)
        val first = st.pending == null
        st.pending = m
        if (first) handler.postDelayed(st.flush, wait)
      }
    }
  }
}

/** Hülle um Window.Callback: sieht Tasten/Bewegungen vor der Activity, unabhängig vom Fokus. */
class RcWindowCallback(val base: Window.Callback) : Window.Callback by base {
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (RcKeysModule.handleKeyEvent(event, "window")) return true
    return base.dispatchKeyEvent(event)
  }

  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
    if (RcKeysModule.handleMotionEvent(event, "window")) return true
    return base.dispatchGenericMotionEvent(event)
  }

  override fun dispatchTrackballEvent(event: MotionEvent): Boolean {
    if (RcKeysModule.handleMotionEvent(event, "window-trackball")) return true
    return base.dispatchTrackballEvent(event)
  }

  /** Nur melden (Touchscreen wird ausgefiltert), nie abfangen: z. B. Touchpad-/Zeiger-Quellen */
  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (!event.isFromSource(InputDevice.SOURCE_TOUCHSCREEN)) RcKeysModule.handleMotionEvent(event, "window-touch")
    return base.dispatchTouchEvent(event)
  }

  override fun dispatchKeyShortcutEvent(event: KeyEvent): Boolean {
    if (RcKeysModule.handleKeyEvent(event, "window-shortcut")) return true
    return base.dispatchKeyShortcutEvent(event)
  }

  override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>?, menu: Menu?, deviceId: Int) {
    if (Build.VERSION.SDK_INT >= 24) base.onProvideKeyboardShortcuts(data, menu, deviceId)
  }

  override fun onPointerCaptureChanged(hasCapture: Boolean) {
    if (Build.VERSION.SDK_INT >= 26) base.onPointerCaptureChanged(hasCapture)
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
