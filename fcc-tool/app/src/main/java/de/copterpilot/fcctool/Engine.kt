package de.copterpilot.fcctool

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Protokoll für Bildschirm und Dienst. */
object Log {
    private val lines = ArrayDeque<String>()
    private val fmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.GERMANY)
    @Volatile var listener: ((String) -> Unit)? = null

    @Synchronized fun add(msg: String) {
        val line = "${fmt.format(Date())}  $msg"
        lines.addLast(line)
        while (lines.size > 2000) lines.removeFirst()
        listener?.invoke(line)
    }

    @Synchronized fun all(): String = lines.joinToString("\n")
    @Synchronized fun clear() = lines.clear()
}

object Engine {
    /** Nur ein Vorgang gleichzeitig auf der Funkverbindung (Knopf und Keepalive). */
    val lock = Any()

    private const val PREFS = "fcc"
    private const val KEY_PORT = "port"

    fun savedPort(ctx: Context): Int = ctx.getSharedPreferences(PREFS, 0).getInt(KEY_PORT, 0)
    fun savePort(ctx: Context, port: Int) = ctx.getSharedPreferences(PREFS, 0).edit().putInt(KEY_PORT, port).apply()

    /**
     * Sucht den lokalen DUML-Port: zuerst einer, der auf die Versionsabfrage antwortet,
     * sonst der erste erreichbare (8901–8904 vor 40009, wie FreeFCC).
     */
    fun detectPort(ctx: Context): Int? = synchronized(lock) {
        var firstOpen: Int? = null
        for (port in TcpLink.CANDIDATE_PORTS) {
            if (!TcpLink.canConnect(port)) { Log.add("Port $port: geschlossen"); continue }
            if (firstOpen == null) firstOpen = port
            val answers = try {
                TcpLink(port).exchange(Duml.build(0x82, 0x00, 0x40, 0x00, 0x01), 400)
            } catch (e: Exception) { Log.add("Port $port: Fehler ${e.message}"); emptyList() }
            Log.add("Port $port: offen, ${answers.size} Antwort(en)")
            answers.forEach { Log.add("   $it") }
            if (answers.isNotEmpty()) { savePort(ctx, port); return port }
        }
        firstOpen?.also { savePort(ctx, it) }
    }

    fun tcpLink(ctx: Context): TcpLink? {
        val p = savedPort(ctx).takeIf { it != 0 } ?: detectPort(ctx)
        if (p == null) Log.add("Kein lokaler DUML-Port gefunden. Läuft die App auf der Fernsteuerung, Drohne eingeschaltet und verbunden?")
        return p?.let { TcpLink(it) }
    }

    /** Sendet ein Profil; gibt die Zahl der Antworten zurück. */
    fun runProfile(link: Link, p: Profile, verbose: Boolean = true): Int = synchronized(lock) {
        if (verbose) Log.add("▶ ${p.name} über ${link.label} (${p.frames.size} Rahmen × ${p.rounds})")
        var answers = 0
        for (round in 1..p.rounds) {
            for (step in p.frames) {
                val frame = Duml.build(p.sender, step.dst, p.cmdType, step.cmdSet, step.cmdId, step.payload)
                try {
                    val r = link.exchange(frame, p.readWindowMs)
                    answers += r.size
                    if (verbose) {
                        Log.add("→ ${step.note.ifEmpty { "set ${step.cmdSet} id ${step.cmdId}" }}: ${r.size} Antwort(en)")
                        r.forEach { Log.add("   $it") }
                    }
                } catch (e: Exception) {
                    Log.add("✗ ${step.note}: ${e.message}")
                }
                if (p.interFrameMs > 0) Thread.sleep(p.interFrameMs)
            }
            if (round < p.rounds && p.interRoundMs > 0) Thread.sleep(p.interRoundMs)
        }
        if (verbose) Log.add("■ ${p.name} fertig, $answers Antwort(en) insgesamt")
        answers
    }

    /**
     * Nur lesender Test: Versionsabfrage (GENERAL 0x00/0x01) an alle 32 Gerätetypen,
     * Index 0 und 1. Zeigt, welche Teilnehmer über diese Verbindung erreichbar sind.
     */
    fun scan(link: Link, sender: Int) = synchronized(lock) {
        Log.add("▶ Teilnehmersuche über ${link.label}, Absender ${Duml.dev(sender)}")
        val seen = LinkedHashSet<Int>()
        for (idx in 0..1) for (type in 0..31) {
            val dst = type or (idx shl 5)
            val r = try { link.exchange(Duml.build(sender, dst, 0x40, 0x00, 0x01), 150) }
            catch (e: Exception) { Log.add("✗ ${Duml.dev(dst)}: ${e.message}"); emptyList() }
            for (f in r) {
                Log.add("   $f")
                if (f.isResponse) seen += f.sender
            }
        }
        Log.add("■ Antwortende Teilnehmer: " +
            if (seen.isEmpty()) "keine" else seen.joinToString { Duml.dev(it) })
    }
}
