package de.copterpilot.fcctool

import android.content.Context

object Engine {
    /** Nur ein Vorgang gleichzeitig auf der Funkverbindung (Knopf und Keepalive). */
    val lock = Any()

    private const val PREFS = "fcc"
    private const val KEY_PORT = "port"
    private const val KEY_MODE = "last_mode"

    fun savedPort(ctx: Context): Int = ctx.getSharedPreferences(PREFS, 0).getInt(KEY_PORT, 0)
    fun savePort(ctx: Context, port: Int) = ctx.getSharedPreferences(PREFS, 0).edit().putInt(KEY_PORT, port).apply()

    /** Zuletzt gesetzter Modus laut dieser App: "FCC", "CE" oder "" (unbekannt). */
    fun lastMode(ctx: Context): String = ctx.getSharedPreferences(PREFS, 0).getString(KEY_MODE, "") ?: ""
    fun setMode(ctx: Context, mode: String) = ctx.getSharedPreferences(PREFS, 0).edit().putString(KEY_MODE, mode).apply()

    data class Outcome(val sent: Int, val total: Int, val errors: Int, val responses: Int) {
        val allSent get() = errors == 0 && sent == total && total > 0
    }

    /**
     * Sucht den lokalen DUML-Port. Zuerst einer, der auf die Versionsabfrage antwortet,
     * sonst der erste erreichbare (8901–8904 vor 40009). Läuft automatisch vor jedem
     * Vorgang, der Nutzer muss das nicht von Hand anstoßen.
     */
    fun detectPort(ctx: Context, quiet: Boolean = false): Int? = synchronized(lock) {
        if (!quiet) Log.step("Suche Verbindung zur Fernsteuerung …")
        var firstOpen: Int? = null
        for (port in TcpLink.CANDIDATE_PORTS) {
            if (!TcpLink.canConnect(port)) { Log.detail("Port $port: geschlossen"); continue }
            if (firstOpen == null) firstOpen = port
            val answers = try {
                TcpLink(port).exchange(Duml.build(0x82, 0x00, 0x40, 0x00, 0x01), 400)
            } catch (e: Exception) { Log.detail("Port $port: ${e.message}"); emptyList() }
            Log.detail("Port $port: offen, ${answers.size} Antwort(en)")
            answers.forEach { Log.detail("   $it") }
            if (answers.isNotEmpty()) { savePort(ctx, port); if (!quiet) Log.ok("Verbunden (Port $port)"); return port }
        }
        if (firstOpen != null) { savePort(ctx, firstOpen); if (!quiet) Log.ok("Verbunden (Port $firstOpen)") }
        else if (!quiet) Log.err("Keine Verbindung. Ist das Fluggerät an und mit dieser Fernsteuerung verbunden?")
        firstOpen
    }

    /** Liefert eine TCP-Verbindung über den gemerkten bzw. frisch gesuchten Port. */
    fun tcpLink(ctx: Context, quiet: Boolean = false): TcpLink? {
        val saved = savedPort(ctx).takeIf { it != 0 && TcpLink.canConnect(it) }
        val p = saved ?: detectPort(ctx, quiet)
        return p?.let { TcpLink(it) }
    }

    /** Sendet ein Profil und meldet, wie viele Befehle fehlerfrei rausgingen. */
    fun runProfile(link: Link, p: Profile): Outcome = synchronized(lock) {
        var sent = 0; var errors = 0; var responses = 0
        val total = p.frames.size * p.rounds
        for (round in 1..p.rounds) {
            for (step in p.frames) {
                val frame = Duml.build(p.sender, step.dst, p.cmdType, step.cmdSet, step.cmdId, step.payload)
                try {
                    val r = link.exchange(frame, p.readWindowMs)
                    sent++; responses += r.size
                    Log.detail("→ ${step.note}: ${r.size} Antwort(en)")
                    r.forEach { Log.detail("   $it") }
                } catch (e: Exception) {
                    errors++
                    Log.detail("✗ ${step.note}: ${e.message}")
                }
                if (p.interFrameMs > 0) Thread.sleep(p.interFrameMs)
            }
            if (round < p.rounds && p.interRoundMs > 0) Thread.sleep(p.interRoundMs)
        }
        Outcome(sent, total, errors, responses)
    }

    /**
     * Nur lesender Test: Versionsabfrage an alle 32 Gerätetypen (Index 0 und 1).
     * Zeigt, welche Teilnehmer über diese Verbindung erreichbar sind.
     */
    fun scan(link: Link, sender: Int) = synchronized(lock) {
        Log.step("Teilnehmersuche über ${link.label} (Absender ${Duml.dev(sender)})")
        val seen = LinkedHashSet<Int>()
        for (idx in 0..1) for (type in 0..31) {
            val dst = type or (idx shl 5)
            val r = try { link.exchange(Duml.build(sender, dst, 0x40, 0x00, 0x01), 150) }
            catch (e: Exception) { Log.detail("✗ ${Duml.dev(dst)}: ${e.message}"); emptyList() }
            for (f in r) { Log.detail("   $f"); if (f.isResponse) seen += f.sender }
        }
        if (seen.isEmpty()) Log.warn("Keine Teilnehmer geantwortet")
        else Log.ok("Antwortende Teilnehmer: " + seen.joinToString { Duml.dev(it) })
    }
}
