package de.copterpilot.fcctool

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Typeface
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private val usb by lazy { getSystemService(UsbManager::class.java) }
    private var pendingUsb: ((UsbDevice) -> Unit)? = null

    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var statusBadge: TextView
    private lateinit var connText: TextView
    private lateinit var keepText: TextView
    private lateinit var advancedPanel: LinearLayout
    private var sdVariant = SdCard.Variant.HAM

    private val usbPermission = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val dev = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            else @Suppress("DEPRECATION") i.getParcelableExtra(UsbManager.EXTRA_DEVICE)
            val ok = i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
            val action = pendingUsb; pendingUsb = null
            if (dev != null && ok && action != null) action(dev) else Log.add("USB-Zugriff nicht erlaubt")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        val f = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(usbPermission, f, RECEIVER_NOT_EXPORTED)
        else registerReceiver(usbPermission, f)
        if (!prefs().getBoolean("disclaimer_ok", false)) showDisclaimer()
    }

    override fun onResume() {
        super.onResume()
        logView.text = Log.all()
        Log.listener = { line -> runOnUiThread { logView.append("\n$line"); scrollDown() } }
        refreshStatus()
    }

    override fun onPause() { Log.listener = null; super.onPause() }

    override fun onDestroy() { unregisterReceiver(usbPermission); io.shutdownNow(); super.onDestroy() }

    // ---------------------------------------------------------------- Oberfläche

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Ui.BG)
            val p = Ui.dpi(this@MainActivity, 14f); setPadding(p, p, p, p)
        }

        // Linke Spalte: Status + Hauptaktionen + Brille
        val left = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        left.addView(headerBar())
        left.addView(statusCard(), Ui.lp(topDp = Ui.dpi(this, 12f)))
        left.addView(actionCard(), Ui.lp(topDp = Ui.dpi(this, 12f)))
        left.addView(gogglesCard(), Ui.lp(topDp = Ui.dpi(this, 12f)))
        left.addView(advancedToggle(), Ui.lp(topDp = Ui.dpi(this, 12f)))
        root.addView(ScrollView(this).apply {
            isFillViewport = true; addView(left)
        }, LinearLayout.LayoutParams(0, MATCH_PARENT, 1.05f))

        // Rechte Spalte: Protokoll (immer sichtbar im Querformat)
        root.addView(logCard(), LinearLayout.LayoutParams(0, MATCH_PARENT, 1f).apply {
            leftMargin = Ui.dpi(this@MainActivity, 12f)
        })
        return root
    }

    private fun headerBar() = Ui.row(this).apply {
        addView(TextView(this@MainActivity).apply {
            text = "FCC Tool"; setTextColor(Ui.TEXT); textSize = 22f; typeface = Typeface.DEFAULT_BOLD
        })
        addView(TextView(this@MainActivity).apply {
            text = "  ·  DJI RC Pro 2"; setTextColor(Ui.TEXT2); textSize = 14f
        })
    }

    private fun statusCard() = Ui.card(this).apply {
        addView(Ui.title(this@MainActivity, "STATUS"))
        val top = Ui.row(this@MainActivity)
        statusBadge = Ui.badge(this@MainActivity)
        top.addView(statusBadge)
        connText = Ui.label(this@MainActivity, "", Ui.TEXT2, 13f)
        top.addView(connText, Ui.lp(0, WRAP_CONTENT, 1f).apply { leftMargin = Ui.dpi(this@MainActivity, 12f) })
        addView(top)
        keepText = Ui.label(this@MainActivity, "", Ui.TEXT2, 13f)
        addView(keepText, Ui.lp(topDp = Ui.dpi(this@MainActivity, 10f)))
    }

    private fun actionCard() = Ui.card(this).apply {
        addView(Ui.title(this@MainActivity, "DROHNE AN DIESER FERNSTEUERUNG (z. B. AIR 3S)"))
        addView(Ui.bigButton(this@MainActivity, "FCC aktivieren", Ui.GREEN) { applyFcc() })
        addView(Ui.bigButton(this@MainActivity, "FCC dauerhaft halten", Ui.BLUE) { toggleKeepalive() },
            Ui.lp(topDp = Ui.dpi(this@MainActivity, 10f)))
        addView(Ui.bigButton(this@MainActivity, "CE wiederherstellen", Ui.AMBER) { restoreCe() },
            Ui.lp(topDp = Ui.dpi(this@MainActivity, 10f)))
    }

    private fun gogglesCard() = Ui.card(this).apply {
        addView(Ui.title(this@MainActivity, "BRILLE ÜBER SD-KARTE (AVATA 2 USW.)"))
        addView(Ui.label(this@MainActivity,
            "SD-Karte der Brille in die Fernsteuerung stecken, Variante wählen, Datei schreiben, " +
            "Karte zurück in die Brille, Brille einschalten.", Ui.TEXT2, 12f))
        val variantBtn = Ui.smallButton(this@MainActivity, "") {}
        fun setVar() { variantBtn.text = "Variante: ${sdVariant.label}" }
        variantBtn.setOnClickListener { chooseVariant { setVar() } }
        setVar()
        addView(variantBtn, Ui.lp(topDp = Ui.dpi(this@MainActivity, 10f)))
        addView(Ui.bigButton(this@MainActivity, "SD-Karte wählen und Datei schreiben", Ui.BLUE) { pickSdCard() },
            Ui.lp(topDp = Ui.dpi(this@MainActivity, 10f)))
    }

    private fun advancedToggle(): View {
        advancedPanel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        advancedPanel.addView(Ui.smallButton(this, "Port suchen + Version abfragen") {
            bg { Engine.detectPort(this)?.let { Log.add("Verwende Port $it"); runOnUiThread { refreshStatus() } } }
        })
        advancedPanel.addView(Ui.smallButton(this, "Teilnehmer suchen (nur lesen)") {
            bg { Engine.tcpLink(this)?.let { Engine.scan(it, 0x82) } }
        }, Ui.lp(topDp = Ui.dpi(this, 8f)))
        advancedPanel.addView(Ui.smallButton(this, "USB-Geräte anzeigen") { listUsb() },
            Ui.lp(topDp = Ui.dpi(this, 8f)))
        advancedPanel.addView(Ui.smallButton(this, "USB: Teilnehmer suchen (Brille per Kabel)") {
            withDjiUsb { dev -> bg { usbScan(dev) } }
        }, Ui.lp(topDp = Ui.dpi(this, 8f)))

        val card = Ui.card(this)
        val head = Ui.row(this)
        val titleTv = Ui.label(this, "ERWEITERT  ▸", Ui.TEXT2, 12f, bold = true).apply { letterSpacing = 0.08f }
        head.addView(titleTv, Ui.lp(0, WRAP_CONTENT, 1f))
        head.setOnClickListener {
            val show = advancedPanel.visibility == View.GONE
            advancedPanel.visibility = if (show) View.VISIBLE else View.GONE
            titleTv.text = if (show) "ERWEITERT  ▾" else "ERWEITERT  ▸"
        }
        card.addView(head)
        card.addView(advancedPanel, Ui.lp(topDp = Ui.dpi(this, 10f)))
        return card
    }

    private fun logCard() = Ui.card(this).apply {
        val head = Ui.row(this@MainActivity)
        head.addView(Ui.title(this@MainActivity, "PROTOKOLL"), Ui.lp(0, WRAP_CONTENT, 1f))
        head.addView(Ui.smallButton(this@MainActivity, "Leeren") { Log.clear(); logView.text = "" })
        addView(head)
        logView = TextView(this@MainActivity).apply {
            setTextColor(Ui.TEXT); typeface = Typeface.MONOSPACE; textSize = 11f
            setTextIsSelectable(true)
        }
        logScroll = ScrollView(this@MainActivity).apply {
            addView(HorizontalScrollView(this@MainActivity).apply { addView(logView) })
        }
        addView(logScroll, Ui.lp(MATCH_PARENT, 0, 1f, topDp = Ui.dpi(this@MainActivity, 8f)))
    }

    private fun scrollDown() = logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }

    private fun refreshStatus() {
        val keep = KeepaliveService.isEnabled(this)
        val mode = Engine.lastMode(this)
        when {
            keep || mode == "FCC" -> Ui.setBadge(statusBadge, "FCC", Ui.GREEN)
            mode == "CE" -> Ui.setBadge(statusBadge, "CE", Ui.BLUE)
            else -> Ui.setBadge(statusBadge, "unbekannt", Ui.TEXT2)
        }
        val port = Engine.savedPort(this)
        connText.text = if (port != 0) "Port $port gemerkt" else "Noch kein Port gesucht"
        keepText.text = if (keep) "„FCC halten“ ist AN – erneuert alle 2 s, auch nach Neustart"
            else "„FCC halten“ ist aus"
    }

    // ---------------------------------------------------------------- Aktionen

    private fun applyFcc() = confirm("FCC-Profil jetzt an die Drohne senden?") {
        bg {
            Engine.tcpLink(this)?.let {
                Engine.runProfile(it, Profile.load(this, "fcc")); Engine.setMode(this, "FCC")
                runOnUiThread { refreshStatus() }
            }
        }
    }

    private fun restoreCe() = bg {
        if (KeepaliveService.isEnabled(this)) runOnUiThread { KeepaliveService.stop(this) }
        Engine.tcpLink(this)?.let {
            Engine.runProfile(it, Profile.load(this, "ce_restore")); Engine.setMode(this, "CE")
        }
        runOnUiThread { refreshStatus() }
    }

    private fun toggleKeepalive() {
        if (KeepaliveService.isEnabled(this)) { KeepaliveService.stop(this); refreshStatus() }
        else confirm("FCC dauerhaft halten? Die App sendet dann alle 2 Sekunden und startet nach dem Einschalten der Fernsteuerung automatisch.") {
            KeepaliveService.setEnabled(this, true); KeepaliveService.start(this); refreshStatus()
        }
    }

    // ---------------------------------------------------------------- Brille / SD

    private fun chooseVariant(after: () -> Unit) {
        val items = SdCard.Variant.entries.map { it.label }.toTypedArray()
        AlertDialog.Builder(this).setTitle("Welche Brille?")
            .setItems(items) { _, i -> sdVariant = SdCard.Variant.entries[i]; after() }
            .show()
    }

    private fun pickSdCard() {
        AlertDialog.Builder(this)
            .setTitle("SD-Karte wählen")
            .setMessage("Gleich den Speicher der Brillen-SD-Karte auswählen (oben ggf. auf das Menü tippen und die SD-Karte wählen), dann „${if (Build.VERSION.SDK_INT>=29) "DIESEN ORDNER VERWENDEN" else "AUSWÄHLEN"}“.")
            .setPositiveButton("Weiter") { _, _ ->
                try {
                    startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), REQ_SD)
                } catch (e: Exception) { Log.add("Kein Dateiauswahl-Dienst gefunden: ${e.message}") }
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_SD && resultCode == RESULT_OK) {
            val uri: Uri = data?.data ?: return
            bg {
                val r = SdCard.writeInto(this, uri, sdVariant)
                runOnUiThread {
                    AlertDialog.Builder(this)
                        .setTitle(if (r.ok) "SD-Karte beschrieben" else "Nicht geschrieben")
                        .setMessage(r.message + if (r.ok) "\n\nJetzt die Karte zurück in die Brille stecken und die Brille einschalten." else "")
                        .setPositiveButton("OK", null).show()
                }
            }
        }
    }

    // ---------------------------------------------------------------- USB

    private fun listUsb() {
        val list = usb.deviceList.values
        if (list.isEmpty()) Log.add("Keine USB-Geräte angeschlossen")
        list.forEach { Log.add("USB: " + UsbLink.describe(it)) }
    }

    private fun withDjiUsb(action: (UsbDevice) -> Unit) {
        val dev = usb.deviceList.values.firstOrNull { it.vendorId == UsbLink.DJI_VENDOR_ID }
            ?: usb.deviceList.values.firstOrNull()
        if (dev == null) { Log.add("Kein USB-Gerät gefunden (Brille per USB-C anschließen)"); return }
        if (dev.vendorId != UsbLink.DJI_VENDOR_ID) Log.add("Hinweis: kein DJI-Gerät (0x2ca3), versuche ${UsbLink.describe(dev)}")
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
            try { Engine.scan(link, 0x2A); Engine.scan(link, 0x82) } finally { link.close() }
        }
    }

    // ---------------------------------------------------------------- Dialoge

    private fun bg(task: () -> Unit) = io.execute {
        try { task() } catch (e: Exception) { Log.add("Fehler: ${e.javaClass.simpleName}: ${e.message}") }
    }

    private fun confirm(msg: String, ok: () -> Unit) {
        AlertDialog.Builder(this).setMessage(msg)
            .setPositiveButton("Ja") { _, _ -> ok() }.setNegativeButton("Abbrechen", null).show()
    }

    private fun prefs() = getSharedPreferences("fcc", 0)

    private fun showDisclaimer() {
        AlertDialog.Builder(this)
            .setTitle("Wichtiger Hinweis")
            .setMessage(
                "Diese App stellt die Funkregion von CE auf FCC um. In Deutschland und der EU ist der Betrieb " +
                "mit FCC-Sendeleistung nicht zulässig (Funkrecht / BNetzA); Versicherungsschutz und DJI Care Refresh " +
                "können entfallen.\n\nNutzung auf eigene Verantwortung, nur zu Test- und Forschungszwecken bzw. dort, " +
                "wo FCC-Betrieb erlaubt ist."
            )
            .setCancelable(false)
            .setPositiveButton("Verstanden") { _, _ -> prefs().edit().putBoolean("disclaimer_ok", true).apply() }
            .setNegativeButton("Beenden") { _, _ -> finish() }
            .show()
    }

    companion object {
        private const val ACTION_USB_PERMISSION = "de.copterpilot.fcctool.USB_PERMISSION"
        private const val REQ_SD = 101
    }
}
