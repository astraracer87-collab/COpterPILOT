package de.copterpilot.fcctool

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class DumlTest {
    @Test
    fun headerCrcMatchesKnownPrefixes() {
        // Bekannte Kopfzeilen aus DUML-Mitschnitten: 55 0D 04 33 (13 Byte), 55 0E 04 66 (14 Byte)
        assertEquals(0x33, Duml.crc8(byteArrayOf(0x55, 0x0D, 0x04)))
        assertEquals(0x66, Duml.crc8(byteArrayOf(0x55, 0x0E, 0x04)))
    }

    @Test
    fun buildAndParseRoundTrip() {
        val f = Duml.build(0x82, 0x06, 0x20, 0x06, 0x72, "00000000000100".hexToBytes(), sequence = 0x1234)
        assertEquals(20, f.size)
        assertEquals(0x55, f[0].toInt() and 0xFF)
        assertEquals(20, f[1].toInt())
        assertEquals(0x04, f[2].toInt())

        val p = Duml.Parser()
        // Müll davor und Rahmen in zwei Teilen
        val half = f.size / 2
        assertEquals(0, p.feed(byteArrayOf(0x00, 0x55, 0x13) + f.copyOfRange(0, half)).size)
        val frames = p.feed(f.copyOfRange(half, f.size))
        assertEquals(1, frames.size)
        val r = frames[0]
        assertEquals(0x82, r.sender)
        assertEquals(0x06, r.receiver)
        assertEquals(0x1234, r.seq)
        assertEquals(0x06, r.cmdSet)
        assertEquals(0x72, r.cmdId)
        assertArrayEquals("00000000000100".hexToBytes(), r.payload)
    }

    @Test
    fun corruptedFrameIsRejected() {
        val f = Duml.build(0x2A, 0x00, 0x40, 0x00, 0x01)
        f[f.size - 1] = (f[f.size - 1] + 1).toByte()
        assertEquals(0, Duml.Parser().feed(f).size)
    }
}
