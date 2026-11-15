package de.copterpilot.fcctool

/** Protokoll mit Stufen, ohne Zeitstempel. Die Oberfläche färbt die Zeilen je Stufe. */
object Log {
    enum class Level { STEP, OK, WARN, ERR, INFO, DETAIL }

    data class Entry(val level: Level, val text: String)

    private val entries = ArrayDeque<Entry>()
    /** Nur wenn true werden DETAIL-Zeilen (Rohdaten der Rahmen) gespeichert. */
    @Volatile var verbose = false
    @Volatile var listener: ((Entry) -> Unit)? = null

    @Synchronized private fun add(level: Level, text: String) {
        if (level == Level.DETAIL && !verbose) return
        val e = Entry(level, text)
        entries.addLast(e)
        while (entries.size > 1500) entries.removeFirst()
        listener?.invoke(e)
    }

    fun step(t: String) = add(Level.STEP, t)
    fun ok(t: String) = add(Level.OK, t)
    fun warn(t: String) = add(Level.WARN, t)
    fun err(t: String) = add(Level.ERR, t)
    fun info(t: String) = add(Level.INFO, t)
    fun detail(t: String) = add(Level.DETAIL, t)

    @Synchronized fun all(): List<Entry> = entries.toList()
    @Synchronized fun clear() = entries.clear()
}
