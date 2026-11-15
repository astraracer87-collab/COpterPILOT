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
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private val usb by lazy { getSystemService(UsbManager::class.java) }
    private var pendingUsb: ((UsbDevice) -> Unit)? = null
    private var sdAction: ((Uri) -> Unit)? = null
    private var sdVariant = SdCard.Variant.HAM

    private lateinit var body: LinearLayout   // Inhaltsbereich unter der Kopfzeile (vertikal)
    private lateinit var logContainer: LinearLayout
    private lateinit var logScroll: ScrollView
    private lateinit var statusPill: TextView
    private val logCardView by lazy { buildLogCard() }

    private val usbPermission = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val dev = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            else @Suppress("DEPRECATION") i.getParcelableExtra(UsbManager.EXTRA_DEVICE)
            val ok = i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
            val action = pendingUsb; pendingUsb = null
            if (dev != null && ok && action != null) action(dev) else Log.err("USB-Zugriff nicht erlaubt")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            setContentView(buildFrame())
            showHome()
        } catch (e: Throwable) {
            setContentView(errorView(e))
            return
        }
        val f = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(usbPermission, f, RECEIVER_NOT_EXPORTED)
        else registerReceiver(usbPermission, f)
        if (!prefs().getBoolean("disclaimer_ok", false)) showDisclaimer()
    }

    private fun errorView(e: Throwable): View {
        val tv = TextView(this).apply {
            setBackgroundColor(Ui.BG); setTextColor(Ui.RED); textSize = 12f
            typeface = Typeface.MONOSPACE; setPadding(24, 24, 24, 24)
            text = "FEHLER beim Aufbau:\n\n" + android.util.Log.getStackTraceString(e)
        }
        return ScrollView(this).apply { addView(tv) }
    }

    override fun onResume() {
        super.onResume()
        rebuildLog()
        Log.listener = { e -> runOnUiThread { appendLogLine(e) } }
        refreshStatus()
    }

    override fun onPause() { Log.listener = null; super.onPause() }
    override fun onDestroy() { unregisterReceiver(usbPermission); io.shutdownNow(); super.onDestroy() }

    // ------------------------------------------------------------- Grundgerüst

    private fun buildFrame(): View {
        val d = { v: Float -> Ui.dpi(this, v) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.BG); setPadding(d(14f), d(12f), d(14f), d(14f))
        }

        // Kopfzeile: Titel links (nimmt den Platz), Status rechts
        val header = Ui.row(this)
        val titleWrap = Ui.row(this)
        titleWrap.addView(TextView(this).apply {
            text = "FCC Tool"; setTextColor(Ui.TEXT); textSize = 20f; typeface = Typeface.DEFAULT_BOLD
        })
        titleWrap.addView(TextView(this).apply {
            text = "  ·  DJI RC Pro 2"; setTextColor(Ui.TEXT2); textSize = 13f
        })
        header.addView(titleWrap, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        statusPill = Ui.badge(this)
        header.addView(statusPill)
        root.addView(header, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

        body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(body, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f).apply { topMargin = d(12f) })
        return root
    }

    private fun detachLog() { (logCardView.parent as? android.view.ViewGroup)?.removeView(logCardView) }

    /** Standard-Bildschirm: Inhalt links (scrollbar), Protokoll rechts über die volle Höhe. */
    private fun showStandard(col: View) {
        detachLog()
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(ScrollView(this).apply {
            isFillViewport = true
            addView(col, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }, LinearLayout.LayoutParams(0, MATCH_PARENT, 1.1f))
        row.addView(logCardView, LinearLayout.LayoutParams(0, MATCH_PARENT, 1f).apply { leftMargin = Ui.dpi(this@MainActivity, 12f) })
        body.removeAllViews()
        body.addView(row, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
    }

    private fun buildLogCard(): View {
        val card = Ui.card(this)
        card.minimumHeight = Ui.dpi(this, 320f)
        val head = Ui.row(this)
        val titleTv = Ui.title(this, "PROTOKOLL")
        head.addView(titleTv, Ui.lp(0, WRAP_CONTENT, 1f))
        head.addView(Ui.smallButton(this, "Leeren") { Log.clear(); rebuildLog() })
        card.addView(head)
        logContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        logScroll = ScrollView(this).apply { addView(logContainer); isClickable = true }
        card.addView(logScroll, Ui.lp(MATCH_PARENT, 0, 1f, topDp = Ui.dpi(this, 8f)))
        // Dreimal aufs Protokoll tippen schaltet die ausführliche Ansicht um.
        onTripleTap(logScroll) { toggleVerbose() }
        onTripleTap(titleTv) { toggleVerbose() }
        return card
    }

    private fun toggleVerbose() {
        Log.verbose = !Log.verbose
        if (Log.verbose) Log.step("Ausführliches Protokoll AN – zeigt die rohen DUML-Antwortrahmen")
        else Log.info("Ausführliches Protokoll aus")
    }

    /** Erkennt drei Tipps auf dieselbe Ansicht innerhalb kurzer Zeit (ohne Scrollen zu stören). */
    private fun onTripleTap(view: View, action: () -> Unit) {
        val taps = ArrayDeque<Long>()
        view.setOnClickListener {
            val now = System.currentTimeMillis()
            taps.addLast(now)
            while (taps.isNotEmpty() && now - taps.first() > 900) taps.removeFirst()
            if (taps.size >= 3) { taps.clear(); action() }
        }
    }

    private fun rebuildLog() {
        logContainer.removeAllViews()
        val entries = Log.all()
        if (entries.isEmpty()) logContainer.addView(logHint())
        else entries.forEach { logContainer.addView(Ui.logLine(this, it)) }
        scrollLog()
    }

    private fun appendLogLine(e: Log.Entry) {
        logContainer.findViewWithTag<View>("hint")?.let { logContainer.removeView(it) }
        logContainer.addView(Ui.logLine(this, e))
        scrollLog()
    }

    private fun logHint() = Ui.label(this,
        "Noch keine Einträge.\nDer Ablauf links schreibt hier jeden Schritt mit.\nDreimal tippen → ausführliche Ansicht.",
        Ui.TEXT2, 12.5f).apply { tag = "hint" }

    private fun scrollLog() = logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }

    private fun refreshStatus() {
        val keep = KeepaliveService.isEnabled(this)
        when {
            keep || Engine.lastMode(this) == "FCC" -> Ui.setBadge(statusPill, "FCC aktiv", Ui.GREEN)
            Engine.lastMode(this) == "CE" -> Ui.setBadge(statusPill, "CE", Ui.BLUE)
            else -> Ui.setBadge(statusPill, "bereit", Ui.TEXT2)
        }
    }

    private fun showLeft(view: View) = showStandard(view)

    // ------------------------------------------------------------- Startbildschirm

    private fun showHome() {
        detachLog()
        // Knöpfe links (inkl. „Erweitert“ unten), Protokoll rechts – flache Verschachtelung.
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        buttons.addView(Ui.tallModeButton(this,
            "Fluggerät an dieser Fernsteuerung",
            "z. B. Air 3S an der RC Pro 2 – direkt über die Fernsteuerung",
            Ui.GREEN, R.drawable.rc_controller) { showDroneMenu() }, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        buttons.addView(Ui.tallModeButton(this,
            "Fluggerät an Goggle",
            "z. B. Avata 2 – über eine Datei auf der SD-Karte der Goggle",
            Ui.BLUE, R.drawable.fpv_goggle) { showGoggleMenu() },
            LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f).apply { topMargin = Ui.dpi(this@MainActivity, 12f) })
        buttons.addView(Ui.smallButton(this, "Erweitert") { showAdvanced() },
            LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = Ui.dpi(this@MainActivity, 12f) })

        val mid = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        mid.addView(buttons, LinearLayout.LayoutParams(0, MATCH_PARENT, 1.1f))
        mid.addView(logCardView, LinearLayout.LayoutParams(0, MATCH_PARENT, 1f).apply { leftMargin = Ui.dpi(this@MainActivity, 12f) })

        body.removeAllViews()
        body.addView(mid, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        refreshStatus()
    }

    /** Nach der Zielwahl: FCC aktivieren oder zurück auf CE – je Ziel. */
    private fun showActionMenu(heading: String, sub: String, imageRes: Int, onFcc: () -> Unit, ceLabel: String, onCe: () -> Unit) {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(Ui.row(this).apply {
            addView(Ui.smallButton(this@MainActivity, "‹ Zurück") { showHome() })
            addView(Ui.label(this@MainActivity, "   $heading", Ui.TEXT, 16f, bold = true))
        })
        col.addView(Ui.label(this, sub, Ui.TEXT2, 13f), Ui.lp(topDp = Ui.dpi(this, 8f)))
        col.addView(Ui.modeButton(this, "FCC aktivieren", "Reichweite erhöhen (FCC)", Ui.GREEN, imageRes) { onFcc() },
            Ui.lp(topDp = Ui.dpi(this, 12f)))
        col.addView(Ui.modeButton(this, ceLabel, "Zurück in den Auslieferungszustand (CE)", Ui.AMBER) { onCe() },
            Ui.lp(topDp = Ui.dpi(this, 12f)))
        showLeft(col)
        refreshStatus()
    }

    private fun showDroneMenu() = showActionMenu(
        "Fluggerät an dieser Fernsteuerung",
        "z. B. Air 3S – direkt über die Fernsteuerung.", R.drawable.rc_controller,
        onFcc = { showDroneWizard() },
        ceLabel = "CE wiederherstellen", onCe = { showDroneCeWizard() })

    private fun showGoggleMenu() = showActionMenu(
        "Fluggerät an Goggle",
        "z. B. Avata 2 – über eine Datei auf der SD-Karte der Goggle.", R.drawable.fpv_goggle,
        onFcc = { showGoggleWizard() },
        ceLabel = "FCC rückgängig (Datei entfernen)", onCe = { showGoggleCeWizard() })

    // ------------------------------------------------------------- Schritt-Assistent

    private class WizStep(
        val title: String,
        val desc: String,
        val primary: String,
        val run: (advance: () -> Unit) -> Unit,
        val secondary: Pair<String, (advance: () -> Unit) -> Unit>? = null,
    )

    private fun showWizard(heading: String, steps: List<WizStep>) {
        val host = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        var current = 0

        fun draw() {
            host.removeAllViews()
            val top = Ui.row(this)
            top.addView(Ui.smallButton(this, "‹ Zurück") { showHome() })
            top.addView(Ui.label(this, "   $heading", Ui.TEXT, 16f, bold = true), Ui.lp(0, WRAP_CONTENT, 1f))
            top.addView(Ui.label(this, "Schritt ${(current + 1).coerceAtMost(steps.size)}/${steps.size}", Ui.TEXT2, 12f))
            host.addView(top)

            steps.forEachIndexed { i, s ->
                when {
                    i < current -> host.addView(doneRow(s.title), Ui.lp(topDp = Ui.dpi(this, 8f)))
                    i == current -> host.addView(activeCard(i + 1, s) { current++; draw(); refreshStatus() },
                        Ui.lp(topDp = Ui.dpi(this, 8f)))
                    else -> host.addView(upcomingRow(i + 1, s.title), Ui.lp(topDp = Ui.dpi(this, 6f)))
                }
            }
            if (current >= steps.size) host.addView(Ui.bigButton(this, "Fertig", Ui.GREEN) { showHome() },
                Ui.lp(topDp = Ui.dpi(this, 10f)))
        }
        draw()
        showLeft(host)
    }

    private fun doneRow(title: String) = Ui.row(this).apply {
        addView(Ui.label(this@MainActivity, "✓", Ui.GREEN, 15f, bold = true))
        addView(Ui.label(this@MainActivity, "  $title", Ui.TEXT2, 13f))
    }

    private fun upcomingRow(n: Int, title: String) = Ui.row(this).apply {
        alpha = 0.5f
        addView(Ui.label(this@MainActivity, "$n", Ui.TEXT2, 13f, bold = true))
        addView(Ui.label(this@MainActivity, "  $title", Ui.TEXT2, 13f))
    }

    private fun activeCard(n: Int, s: WizStep, advance: () -> Unit): View {
        val card = Ui.card(this)
        card.addView(Ui.label(this, "SCHRITT $n", Ui.logColor(Log.Level.STEP), 12f, bold = true).apply { letterSpacing = 0.08f })
        card.addView(Ui.label(this, s.title, Ui.TEXT, 17f, bold = true), Ui.lp(topDp = Ui.dpi(this, 4f)))
        card.addView(Ui.label(this, s.desc, Ui.TEXT2, 13f), Ui.lp(topDp = Ui.dpi(this, 6f)))
        card.addView(Ui.bigButton(this, s.primary, Ui.BLUE) { s.run(advance) }, Ui.lp(topDp = Ui.dpi(this, 12f)))
        s.secondary?.let { (label, act) ->
            card.addView(Ui.smallButton(this, label) { act(advance) }, Ui.lp(topDp = Ui.dpi(this, 8f)))
        }
        return card
    }

    // ------------------------------------------------------------- Ablauf: Drohne

    private fun showDroneWizard() {
        val steps = ArrayList<WizStep>()
        steps += WizStep("Fluggerät einschalten und verbinden",
            "Schalte das Fluggerät ein und warte, bis es in DJI Fly mit dieser Fernsteuerung verbunden ist.",
            "Ist verbunden – weiter", { adv -> adv() })
        steps += WizStep("FCC aktivieren",
            "Die App sucht die Verbindung und sendet die FCC-Befehle an das Fluggerät.",
            "FCC jetzt aktivieren", { adv ->
                bg {
                    Log.step("FCC wird aktiviert")
                    val link = Engine.tcpLink(this)
                    if (link == null) Log.err("Nicht möglich – keine Verbindung. Fluggerät eingeschaltet und verbunden?")
                    else {
                        val o = Engine.runProfile(link, Profile.load(this, "fcc"))
                        Engine.setMode(this, "FCC")
                        if (o.allSent) Log.ok("FCC gesendet (${o.sent}/${o.total} Befehle). Kontrolle: DJI Fly → Übertragung.")
                        else Log.warn("Gesendet mit ${o.errors} Fehlern (${o.sent}/${o.total}). Ggf. erneut versuchen.")
                        runOnUiThread { adv() }
                    }
                }
            })
        steps += WizStep("FCC dauerhaft halten (optional)",
            "DJI Fly kann die Region nach kurzer Zeit auf CE zurücksetzen. „Halten“ sendet FCC alle 2 Sekunden neu und startet nach dem Einschalten der Fernsteuerung automatisch wieder.",
            "FCC dauerhaft halten", { adv ->
                KeepaliveService.setEnabled(this, true); KeepaliveService.start(this); adv()
            }, "Überspringen" to { adv: () -> Unit -> adv() })
        steps += WizStep("In DJI Fly prüfen",
            "Öffne in DJI Fly die Übertragungsansicht. Im FCC-Modus reicht die Reichweitenanzeige über 1 km hinaus. " +
            "Hat sich nichts geändert: Fernsteuerung aus- und wieder einschalten und FCC erneut aktivieren.",
            "Fertig", { adv -> adv() })
        showWizard("Fluggerät an dieser Fernsteuerung", steps)
    }

    // ------------------------------------------------------------- Ablauf: Goggle

    private fun showGoggleWizard() {
        val steps = ArrayList<WizStep>()
        steps += WizStep("Goggle-Modell wählen",
            "Je nach Goggle wird eine andere Datei geschrieben. Aktuell: ${sdVariant.label}.",
            "Weiter", { adv -> adv() },
            "Modell ändern" to { _: () -> Unit -> chooseVariant { showGoggleWizard() } })
        steps += WizStep("SD-Karte in die Fernsteuerung",
            "Schalte die Goggle aus, nimm ihre microSD-Karte heraus und stecke sie in die Fernsteuerung.",
            "SD-Karte ist eingelegt – weiter", { adv -> adv() })
        steps += WizStep("FCC-Datei schreiben",
            "Die App schreibt die Datei „${sdVariant.fileName}“ auf die Karte. Gleich die SD-Karte als Speicherort auswählen.",
            "Datei schreiben", { adv ->
                sdAction = { uri ->
                    bg {
                        val r = SdCard.writeInto(this, uri, sdVariant)
                        runOnUiThread { sdResultDialog(r, "Jetzt die Karte zurück in die Goggle stecken.", r.ok, adv) }
                    }
                }
                pickSdCard()
            })
        steps += WizStep("SD-Karte zurück in die Goggle",
            "Nimm die Karte aus der Fernsteuerung und stecke sie wieder in die Goggle.",
            "Erledigt – weiter", { adv -> adv() })
        steps += WizStep("Einschaltreihenfolge",
            "1. Goggle einschalten (Karte steckt drin).\n2. Danach das Fluggerät einschalten.\n3. In DJI Fly die Übertragungsansicht prüfen – im FCC-Modus reicht die Reichweite über 1 km.\n\nWirkt es nicht, ist die Datei-Methode bei diesem Goggle-Modell evtl. nicht (mehr) wirksam.",
            "Fertig", { adv -> adv() })
        showWizard("Fluggerät an Goggle", steps)
    }

    // ------------------------------------------------------------- Ablauf: CE zurück

    private fun showGoggleCeWizard() {
        val steps = ArrayList<WizStep>()
        steps += WizStep("SD-Karte in die Fernsteuerung",
            "Schalte die Goggle aus, nimm ihre microSD-Karte heraus und stecke sie in die Fernsteuerung.",
            "SD-Karte ist eingelegt – weiter", { adv -> adv() })
        steps += WizStep("FCC-Datei entfernen",
            "Die App löscht die FCC-Datei wieder von der Karte. Gleich die SD-Karte als Speicherort auswählen.",
            "Datei entfernen", { adv ->
                sdAction = { uri ->
                    bg {
                        val r = SdCard.removeFrom(this, uri)
                        runOnUiThread { sdResultDialog(r, "Jetzt die Karte zurück in die Goggle stecken.", r.ok, adv) }
                    }
                }
                pickSdCard()
            })
        steps += WizStep("SD-Karte zurück in die Goggle",
            "Nimm die Karte aus der Fernsteuerung und stecke sie wieder in die Goggle.",
            "Erledigt – weiter", { adv -> adv() })
        steps += WizStep("Einschalten und prüfen",
            "Goggle einschalten (Karte steckt drin), danach das Fluggerät. In DJI Fly prüfen, dass die Reichweite wieder dem CE-Wert entspricht.",
            "Fertig", { adv -> adv() })
        showWizard("FCC rückgängig (Goggle)", steps)
    }

    private fun showDroneCeWizard() {
        val steps = ArrayList<WizStep>()
        steps += WizStep("FCC halten ausschalten",
            "Zuerst wird das dauerhafte Halten beendet, damit FCC nicht sofort wieder gesetzt wird.",
            "Weiter", { adv -> if (KeepaliveService.isEnabled(this)) KeepaliveService.stop(this); refreshStatus(); adv() })
        steps += WizStep("CE-Befehl senden",
            "Die App setzt die Funkregion per Befehl auf CE zurück.",
            "CE jetzt senden", { adv ->
                bg {
                    Log.step("CE wird gesendet")
                    val link = Engine.tcpLink(this)
                    if (link == null) Log.err("Keine Verbindung – Fluggerät eingeschaltet und verbunden?")
                    else {
                        val o = Engine.runProfile(link, Profile.load(this, "ce_restore"))
                        Engine.setMode(this, "CE")
                        Log.ok("CE gesendet (${o.sent}/${o.total}). Zum Sichern das Fluggerät neu starten, dann in DJI Fly prüfen.")
                    }
                    runOnUiThread { adv() }
                }
            })
        steps += WizStep("Fluggerät neu starten",
            "Am zuverlässigsten greift CE nach einem Neustart: Schalte das Fluggerät aus und wieder ein " +
            "(wenn es weiter FCC zeigt, zusätzlich die Fernsteuerung). Danach in DJI Fly prüfen, dass die Reichweite wieder dem CE-Wert entspricht.",
            "Fertig", { adv -> adv() })
        showWizard("CE wiederherstellen", steps)
    }

    // ------------------------------------------------------------- Erweitert

    private fun showAdvanced() {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(Ui.row(this).apply {
            addView(Ui.smallButton(this@MainActivity, "‹ Zurück") { showHome() })
            addView(Ui.label(this@MainActivity, "   Erweitert", Ui.TEXT, 16f, bold = true))
        })
        val card = Ui.card(this)
        val verboseBtn = Ui.smallButton(this, "") {}
        fun setV() { verboseBtn.text = if (Log.verbose) "Ausführliches Protokoll: AN" else "Ausführliches Protokoll: aus" }
        verboseBtn.setOnClickListener { Log.verbose = !Log.verbose; setV() }; setV()
        card.addView(verboseBtn)
        card.addView(Ui.smallButton(this, "Verbindung suchen + Version abfragen") {
            bg { Engine.detectPort(this); runOnUiThread { refreshStatus() } }
        }, Ui.lp(topDp = Ui.dpi(this, 8f)))
        card.addView(Ui.smallButton(this, "Teilnehmer suchen (nur lesen)") {
            bg { Engine.tcpLink(this)?.let { Engine.scan(it, 0x82) } }
        }, Ui.lp(topDp = Ui.dpi(this, 8f)))
        card.addView(Ui.smallButton(this, "USB-Geräte anzeigen") { listUsb() }, Ui.lp(topDp = Ui.dpi(this, 8f)))
        card.addView(Ui.smallButton(this, "USB: Teilnehmer suchen (Goggle per Kabel)") {
            withDjiUsb { dev -> bg { usbScan(dev) } }
        }, Ui.lp(topDp = Ui.dpi(this, 8f)))
        col.addView(card, Ui.lp(topDp = Ui.dpi(this, 8f)))
        showLeft(col)
    }

    // ------------------------------------------------------------- SD-Karte / Dialoge

    private fun chooseVariant(after: () -> Unit) {
        val items = SdCard.Variant.entries.map { it.label }.toTypedArray()
        AlertDialog.Builder(this).setTitle("Welches Goggle-Modell?")
            .setItems(items) { _, i -> sdVariant = SdCard.Variant.entries[i]; after() }.show()
    }

    private fun pickSdCard() {
        try { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), REQ_SD) }
        catch (e: Exception) { Log.err("Kein Dateiauswahl-Dienst gefunden: ${e.message}") }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_SD) return
        val act = sdAction; sdAction = null
        if (resultCode != RESULT_OK) { Log.info("SD-Auswahl abgebrochen"); return }
        val uri: Uri = data?.data ?: return
        act?.invoke(uri)
    }

    private fun sdResultDialog(r: SdCard.Result, onOk: String, advance: Boolean, adv: () -> Unit) {
        AlertDialog.Builder(this)
            .setTitle(if (r.ok) "Erledigt" else "Fehlgeschlagen")
            .setMessage(r.message + if (r.ok) "\n\n$onOk" else "")
            .setPositiveButton("OK") { _, _ -> if (advance) adv() }.show()
    }

    // ------------------------------------------------------------- USB

    private fun listUsb() {
        val list = usb.deviceList.values
        if (list.isEmpty()) Log.warn("Keine USB-Geräte angeschlossen")
        list.forEach { Log.info("USB: " + UsbLink.describe(it)) }
    }

    private fun withDjiUsb(action: (UsbDevice) -> Unit) {
        val dev = usb.deviceList.values.firstOrNull { it.vendorId == UsbLink.DJI_VENDOR_ID }
            ?: usb.deviceList.values.firstOrNull()
        if (dev == null) { Log.warn("Kein USB-Gerät gefunden (Goggle per USB-C anschließen)"); return }
        if (dev.vendorId != UsbLink.DJI_VENDOR_ID) Log.info("Hinweis: kein DJI-Gerät (0x2ca3), versuche ${UsbLink.describe(dev)}")
        if (usb.hasPermission(dev)) { action(dev); return }
        pendingUsb = action
        val pi = PendingIntent.getBroadcast(this, 0, Intent(ACTION_USB_PERMISSION).setPackage(packageName), PendingIntent.FLAG_MUTABLE)
        usb.requestPermission(dev, pi)
    }

    private fun usbScan(dev: UsbDevice) {
        Log.info("USB: " + UsbLink.describe(dev))
        val cands = UsbLink.candidates(dev)
        if (cands.isEmpty()) { Log.warn("Keine Schnittstelle mit Bulk-Endpunkten gefunden"); return }
        for (intf in cands) {
            val link = try { UsbLink.open(usb, dev, intf) } catch (e: Exception) { Log.err("Schnittstelle ${intf.id}: ${e.message}"); continue }
            try { Engine.scan(link, 0x2A); Engine.scan(link, 0x82) } finally { link.close() }
        }
    }

    private fun bg(task: () -> Unit) = io.execute {
        try { task() } catch (e: Exception) { Log.err("Fehler: ${e.javaClass.simpleName}: ${e.message}") }
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
            .setNegativeButton("Beenden") { _, _ -> finish() }.show()
    }

    companion object {
        private const val ACTION_USB_PERMISSION = "de.copterpilot.fcctool.USB_PERMISSION"
        private const val REQ_SD = 101
    }
}
