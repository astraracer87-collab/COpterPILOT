package de.copterpilot.fcctool

import java.util.concurrent.atomic.AtomicInteger

/**
 * DJI-DUML-Rahmen (öffentlich dokumentiert im Projekt dji-firmware-tools).
 *
 * Aufbau:
 *  [0]     0x55
 *  [1..2]  Länge (10 Bit, Gesamtlänge inkl. Kopf und CRC) | Version 1 (<<10)
 *  [3]     CRC-8 über Byte 0..2 (Startwert 0x77, Polynom 0x31 gespiegelt = 0x8C)
 *  [4]     Absender  (Bit 0..4 Gerätetyp, Bit 5..7 Index)
 *  [5]     Empfänger (wie Absender)
 *  [6..7]  Sequenznummer, little-endian
 *  [8]     Befehlstyp (Bit 7 Antwort, Bit 5..6 ACK-Art, Bit 0..2 Verschlüsselung)
 *  [9]     cmdSet
 *  [10]    cmdId
 *  [11..]  Nutzdaten
 *  [n-2..] CRC-16 über alles davor (Startwert 0x3692, Polynom 0x1021 gespiegelt = 0x8408), little-endian
 */
object Duml {
    private val seq = AtomicInteger(0x95)

    fun crc8(data: ByteArray, len: Int = data.size): Int {
        var crc = 0x77
        for (i in 0 until len) {
            crc = crc xor (data[i].toInt() and 0xFF)
            repeat(8) { crc = if (crc and 1 != 0) (crc ushr 1) xor 0x8C else crc ushr 1 }
        }
        return crc and 0xFF
    }

    fun crc16(data: ByteArray, len: Int = data.size): Int {
        var crc = 0x3692
        for (i in 0 until len) {
            crc = crc xor (data[i].toInt() and 0xFF)
            repeat(8) { crc = if (crc and 1 != 0) (crc ushr 1) xor 0x8408 else crc ushr 1 }
        }
        return crc and 0xFFFF
    }

    fun nextSeq(): Int = seq.getAndIncrement() and 0xFFFF

    fun build(
        sender: Int,
        receiver: Int,
        cmdType: Int,
        cmdSet: Int,
        cmdId: Int,
        payload: ByteArray = ByteArray(0),
        sequence: Int = nextSeq(),
    ): ByteArray {
        val len = 13 + payload.size
        require(len < 0x400) { "Nutzdaten zu lang" }
        val f = ByteArray(len)
        f[0] = 0x55
        f[1] = (len and 0xFF).toByte()
        f[2] = (((len shr 8) and 0x03) or 0x04).toByte()
        f[3] = crc8(f, 3).toByte()
        f[4] = sender.toByte()
        f[5] = receiver.toByte()
        f[6] = (sequence and 0xFF).toByte()
        f[7] = ((sequence shr 8) and 0xFF).toByte()
        f[8] = cmdType.toByte()
        f[9] = cmdSet.toByte()
        f[10] = cmdId.toByte()
        payload.copyInto(f, 11)
        val c = crc16(f, len - 2)
        f[len - 2] = (c and 0xFF).toByte()
        f[len - 1] = ((c shr 8) and 0xFF).toByte()
        return f
    }

    data class Frame(val raw: ByteArray) {
        val sender get() = raw[4].toInt() and 0xFF
        val receiver get() = raw[5].toInt() and 0xFF
        val seq get() = (raw[6].toInt() and 0xFF) or ((raw[7].toInt() and 0xFF) shl 8)
        val cmdType get() = raw[8].toInt() and 0xFF
        val cmdSet get() = raw[9].toInt() and 0xFF
        val cmdId get() = raw[10].toInt() and 0xFF
        val payload: ByteArray get() = raw.copyOfRange(11, raw.size - 2)
        val isResponse get() = cmdType and 0x80 != 0

        override fun toString(): String {
            val p = payload
            val ascii = p.map { val c = it.toInt() and 0xFF; if (c in 0x20..0x7E) c.toChar() else '.' }
                .joinToString("")
            return "${if (isResponse) "ANTWORT" else "ANFRAGE"} von ${dev(sender)} an ${dev(receiver)} " +
                "seq=$seq set=0x%02X id=0x%02X typ=0x%02X  daten=%s  \"%s\"".format(
                    cmdSet, cmdId, cmdType, p.toHex(), ascii.trimEnd('.')
                )
        }

        override fun equals(other: Any?) = other is Frame && raw.contentEquals(other.raw)
        override fun hashCode() = raw.contentHashCode()
    }

    /** Sucht gültige Rahmen in einem Bytestrom; unvollständige Reste bleiben im Puffer. */
    class Parser {
        private var buf = ByteArray(0)

        fun feed(data: ByteArray, n: Int = data.size): List<Frame> {
            buf += data.copyOf(n)
            val out = ArrayList<Frame>()
            var i = 0
            while (i + 4 <= buf.size) {
                if (buf[i] != 0x55.toByte()) { i++; continue }
                val hdr = buf.copyOfRange(i, i + 3)
                if (crc8(hdr) != (buf[i + 3].toInt() and 0xFF)) { i++; continue }
                val len = ((buf[i + 1].toInt() and 0xFF) or ((buf[i + 2].toInt() and 0x03) shl 8))
                if (len < 13) { i++; continue }
                if (i + len > buf.size) break
                val raw = buf.copyOfRange(i, i + len)
                val c = crc16(raw, len - 2)
                val got = (raw[len - 2].toInt() and 0xFF) or ((raw[len - 1].toInt() and 0xFF) shl 8)
                if (c == got) { out += Frame(raw); i += len } else i++
            }
            buf = buf.copyOfRange(i, buf.size)
            return out
        }
    }

    private val DEVICE_NAMES = arrayOf(
        "ANY", "CAMERA", "MOBILE_APP", "FLYCONTROLLER", "GIMBAL", "CENTER_BOARD", "REMOTE_RADIO",
        "WIFI", "LB_DM3XX_SKY", "LB_MCU_SKY", "PC", "BATTERY", "ESC", "DM368_GROUND", "OFDM_GROUND",
        "LB_68013_SKY", "SER_68013_GROUND", "MVO", "SVO", "LB_FPGA_SKY", "FPGA_GROUND", "FPGA_SIM",
        "STATION", "XU", "WTF", "IMU", "GPS", "WIFI_GROUND", "SIG_CVT", "PMU", "UNKNOWN30", "WM330_OR_WM220",
    )

    fun dev(b: Int): String = "%s#%d(0x%02X)".format(DEVICE_NAMES[b and 0x1F], (b shr 5) and 7, b and 0xFF)
}

fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xFF) }

fun String.hexToBytes(): ByteArray {
    val s = filter { !it.isWhitespace() }
    require(s.length % 2 == 0) { "ungerade Hex-Länge" }
    return ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}
