package de.copterpilot.fcctool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ServerSocket
import kotlin.concurrent.thread

class TcpLinkTest {
    /** Nachgebauter DUML-Dienst: beantwortet jede Anfrage mit einer Antwort (Bit 7 im Befehlstyp). */
    @Test
    fun exchangeReceivesResponse() {
        ServerSocket(0).use { server ->
            thread {
                server.accept().use { s ->
                    val req = Duml.Parser().feed(ByteArray(64).let { b -> b.copyOf(s.getInputStream().read(b)) }).single()
                    val resp = Duml.build(req.receiver, req.sender, 0x80, req.cmdSet, req.cmdId,
                        byteArrayOf(0) + "RC-TEST".toByteArray(), req.seq)
                    s.getOutputStream().write(resp)
                }
            }
            val r = TcpLink(server.localPort).exchange(Duml.build(0x82, 0x00, 0x40, 0x00, 0x01), 500)
            assertEquals(1, r.size)
            assertTrue(r[0].isResponse)
            assertEquals(0x82, r[0].receiver)
            assertTrue(r[0].toString().contains("RC-TEST"))
        }
    }
}
