package de.copterpilot.fcctool

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var keepBtn: Button
    private val usb by lazy { getSystemService(UsbManager::class.java) }
    private var pendingUsb: ((UsbDevice) -> Unit)? = null

    private val usbPermission = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val dev = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            else @Suppress("DEPRECATION") i.getParcelableExtra(UsbManager.EXTRA_DEVICE)
            val ok = i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
            val action = pendingUsb
            pendingUsb = null
            if (dev != null && ok && action != null) action(dev) else Log.add("USB-Zugriff nicht erlaubt")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(usbPermission, filter, RECEIVER_NOT_EXPORTED)
        else registerReceiver(usbPermission, filter)
        if (!getSharedPreferences("fcc", 0).getBoolean("disclaimer_ok", false)) showDisclaimer()
    }

    override fun onResume() {
        super.onResume()
        logView.text = Log.all()
        Log.listener = { line -> runOnUiThread { logView.append("\n" + line); scrollDown() } }
        updateKeepBtn()
    }

    override fun onPause() {
        Log.listener = null
        super.onPause()
    }

    override fun onDestroy() {
        unregisterReceiver(usbPermission)
        io.shutdownNow()
        super.onDestroy()
    }

    // ---- Oberfläche (Querformat der Fernsteuerung: Knöpfe links, Protokoll rechts) ----

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.rgb(18, 18, 22))
            setPadding(16, 16, 16, 16)
        }
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun header(t: String) = buttons.addView(TextView(this).apply {
            text = t; setTextColor(Color.rgb(120, 180, 255)); textSize = 13f; setPadding(4, 18, 4, 4)
        })
        fun btn(t: String, action: () -> Unit) = Button(this).apply {
            text = t; isAllCaps = false; setOnClickListener { action() }
        }.also { buttons.addView(it) }

        header("Drohne an dieser Fernsteuerung (z. B. Air 3S)")
        btn("Port suchen + Version abfragen") { bg { Engine.detectPort(this)?.let { Log.add("Verwende Port $it") } } }
        btn("Teilnehmer suchen (nur lesen)") { bg { Engine.tcpLink(this)?.let { Engine.scan(it, 0x82) } } }
        btn("FCC einmal anwenden") { confirm("FCC-Profil jetzt senden?") { bg { Engine.tcpLink(this)?.let { Engine.runProfile(it, Profile.load(this, "fcc")) } } } }
        keepBtn = btn("") { toggleKeepalive() }
        btn("CE wiederherstellen") { bg {
            if (KeepaliveService.isEnabled(this)) runOnUiThread { KeepaliveService.stop(this); updateKeepBtn() }
            Engine.tcpLink(this)?.let { Engine.runProfile(it, Profile.load(this, "ce_restore")) }
        } }

        header("USB-Gerät (Brille / Drohne per Kabel)")
        btn("USB-Geräte anzeigen") { listUsb() }
        btn("USB: Teilnehmer suchen (nur lesen)") { withDjiUsb { dev -> bg { usbScan(dev) } } }

        header("Protokoll")
        btn("Protokoll leeren") { Log.clear(); logView.text = "" }

        root.addView(ScrollView(this).apply { addView(buttons) }, LinearLayout.LayoutParams(0, -1, 1f))

        logView = TextView(this).apply {
            setTextColor(Color.rgb(210, 210, 210)); typeface = Typeface.MONOSPACE; textSize = 11f
            setTextIsSelectable(true); setPadding(16, 0, 16, 0)
        }
        logScroll = ScrollView(this).apply { addView(HorizontalScrollView(this@MainActivity).apply { addView(logView) }) }
        root.addView(logScroll, LinearLayout.LayoutParams(0, -1, 2f))
        return root
    }

    private fun scrollDown() = logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }

    private fun bg(task: () -> Unit) {
        io.execute { try { task() } catch (e: Exception) { Log.add("Fehler: ${e.javaClass.simpleName}: ${e.message}") } }
    }

    private fun confirm(msg: String, ok: () -> Unit) {
        AlertDialog.Builder(this).setMessage(msg).setPositiveButton("Ja") { _, _ -> ok() }.setNegativeButton("Abbrechen", null).show()
    }

    private fun updateKeepBtn() {
        keepBtn.text = if (KeepaliveService.isEnabled(this)) "FCC halten: AN (antippen = aus)" else "FCC halten (Keepalive, auch nach Neustart)"
    }

    private fun toggleKeepalive() {
        if (KeepaliveService.isEnabled(this)) { KeepaliveService.stop(this); updateKeepBtn() }
        else confirm("FCC dauerhaft halten? Die App sendet dann alle 2 Sekunden und startet nach dem Einschalten der Fernsteuerung automatisch.") {
            KeepaliveService.setEnabled(this, true); KeepaliveService.start(this); updateKeepBtn()
        }
    }

    private fun showDisclaimer() {
        AlertDialog.Builder(this)
            .setTitle("Wichtiger Hinweis")
            .setMessage(
                "Diese App stellt die Funkregion von CE auf FCC um. In Deutschland und der EU ist der Betrieb " +
                "mit FCC-Sendeleistung nicht zulässig (Funkrecht / BNetzA); Versicherungsschutz und DJI Care Refresh " +
                "können entfallen.\n\nNutzung auf eigene Verantwortung, nur zu Test- und Forschungszwecken bzw. dort, " +
                "wo FCC-Betrieb erlaubt ist. Die Einstellung lässt sich mit „CE wiederherstellen“ oder einem Neustart " +
                "ohne Keepalive zurücksetzen."
            )
            .setCancelable(false)
            .setPositiveButton("Verstanden") { _, _ -> getSharedPreferences("fcc", 0).edit().putBoolean("disclaimer_ok", true).apply() }
            .setNegativeButton("Beenden") { _, _ -> finish() }
            .show()
    }

    // ---- USB ----

    private fun listUsb() {
        val list = usb.deviceList.values
        if (list.isEmpty()) Log.add("Keine USB-Geräte angeschlossen")
        list.forEach { Log.add("USB: " + UsbLink.describe(it)) }
    }

    private fun withDjiUsb(action: (UsbDevice) -> Unit) {
        val dev = usb.deviceList.values.firstOrNull { it.vendorId == UsbLink.DJI_VENDOR_ID }
            ?: usb.deviceList.values.firstOrNull()
        if (dev == null) { Log.add("Kein USB-Gerät gefunden (Brille per USB-C anschließen)"); return }
        if (dev.vendorId != UsbLink.DJI_VENDOR_ID) Log.add("Hinweis: kein DJI-Gerät (0x2ca3) gefunden, versuche ${UsbLink.describe(dev)}")
        if (usb.hasPermission(dev)) { action(dev); return }
        pendingUsb = action
        val pi = PendingIntent.getBroadcast(this, 0, Intent(ACTION_USB_PERMISSION).setPackage(packageName), PendingIntent.FLAG_MUTABLE)
        usb.requestPermission(dev, pi)
    }

    private fun usbScan(dev: UsbDevice) {
        Log.add("USB: " + UsbLink.describe(dev))
        val cands = UsbLink.candidates(dev)
        if (cands.isEmpty()) { Log.add("Keine Schnittstelle mit Bulk-Endpunkten gefunden"); return }
        for (intf in cands) {
            val link = try { UsbLink.open(usb, dev, intf) } catch (e: Exception) { Log.add("✗ Schnittstelle ${intf.id}: ${e.message}"); continue }
            try {
                Engine.scan(link, 0x2A) // Absender PC#1, wie dji-firmware-tools
                Engine.scan(link, 0x82) // Absender MOBILE_APP#4, wie DJI Fly / FreeFCC
            } finally { link.close() }
        }
    }

    companion object {
        private const val ACTION_USB_PERMISSION = "de.copterpilot.fcctool.USB_PERMISSION"
    }
}
