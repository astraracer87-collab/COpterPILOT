package de.copterpilot.fcctool

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

/** Ein Weg, DUML-Rahmen zu senden und die Antworten innerhalb eines Zeitfensters einzusammeln. */
interface Link {
    val label: String
    fun exchange(frame: ByteArray, readWindowMs: Int): List<Duml.Frame>
    fun close() {}
}

/**
 * Lokaler DUML-Dienst auf der Fernsteuerung (Android, 127.0.0.1).
 * Wie FreeFCC: pro Rahmen eine Verbindung öffnen, schreiben, kurz lesen, schließen.
 */
class TcpLink(val port: Int) : Link {
    override val label = "TCP 127.0.0.1:$port"

    override fun exchange(frame: ByteArray, readWindowMs: Int): List<Duml.Frame> {
        Socket().use { s ->
            s.connect(InetSocketAddress("127.0.0.1", port), 500)
            s.tcpNoDelay = true
            s.getOutputStream().apply { write(frame); flush() }
            return readFor(readWindowMs) { buf, timeout ->
                s.soTimeout = timeout
                try { s.getInputStream().read(buf) } catch (_: SocketTimeoutException) { 0 }
            }
        }
    }

    companion object {
        /** RC Pro 2 / RC Plus nutzen laut FreeFCC 8901–8904, RC 2 nutzt 40009. */
        val CANDIDATE_PORTS = listOf(8901, 8902, 8903, 8904, 40009)

        fun canConnect(port: Int): Boolean = try {
            Socket().use { it.connect(InetSocketAddress("127.0.0.1", port), 300) }; true
        } catch (_: IOException) { false }
    }
}

/**
 * USB-Verbindung, bei der die Fernsteuerung USB-Host ist (z. B. DJI-Brille oder Drohne per USB-C-Kabel).
 * Öffnet eine Schnittstelle mit Bulk-IN/OUT, setzt bei CDC 115200 8N1 und sendet die Rahmen roh.
 */
class UsbLink(
    private val conn: UsbDeviceConnection,
    private val intf: UsbInterface,
    private val epIn: UsbEndpoint,
    private val epOut: UsbEndpoint,
    device: UsbDevice,
) : Link {
    override val label = "USB %04x:%04x Schnittstelle %d (Klasse 0x%02x)".format(
        device.vendorId, device.productId, intf.id, intf.interfaceClass
    )

    override fun exchange(frame: ByteArray, readWindowMs: Int): List<Duml.Frame> {
        val n = conn.bulkTransfer(epOut, frame, frame.size, 1000)
        if (n < 0) throw IOException("USB-Schreiben fehlgeschlagen")
        return readFor(readWindowMs) { buf, timeout ->
            conn.bulkTransfer(epIn, buf, buf.size, timeout).coerceAtLeast(0)
        }
    }

    override fun close() {
        conn.releaseInterface(intf)
        conn.close()
    }

    companion object {
        const val DJI_VENDOR_ID = 0x2CA3

        /** Schnittstellen mit Bulk-IN+OUT, ohne ADB (0xFF/0x42/0x01). */
        fun candidates(device: UsbDevice): List<UsbInterface> =
            (0 until device.interfaceCount).map { device.getInterface(it) }.filter { i ->
                val adb = i.interfaceClass == 0xFF && i.interfaceSubclass == 0x42 && i.interfaceProtocol == 1
                !adb && bulk(i, UsbConstants.USB_DIR_IN) != null && bulk(i, UsbConstants.USB_DIR_OUT) != null
            }

        fun describe(device: UsbDevice): String = buildString {
            append("%04x:%04x %s %s".format(device.vendorId, device.productId,
                device.manufacturerName ?: "", device.productName ?: ""))
            for (k in 0 until device.interfaceCount) {
                val i = device.getInterface(k)
                append("\n   Schnittstelle %d: Klasse 0x%02x/0x%02x/0x%02x, %d Endpunkte".format(
                    i.id, i.interfaceClass, i.interfaceSubclass, i.interfaceProtocol, i.endpointCount))
            }
        }

        fun open(mgr: UsbManager, device: UsbDevice, intf: UsbInterface): UsbLink {
            val conn = mgr.openDevice(device) ?: throw IOException("USB-Gerät lässt sich nicht öffnen")
            if (!conn.claimInterface(intf, true)) { conn.close(); throw IOException("Schnittstelle belegt") }
            if (intf.interfaceClass == UsbConstants.USB_CLASS_CDC_DATA) {
                // Zugehörige CDC-Steuer-Schnittstelle ist meist die davor.
                val ctl = (intf.id - 1).coerceAtLeast(0)
                val lineCoding = byteArrayOf(0x00, 0xC2.toByte(), 0x01, 0x00, 0x00, 0x00, 0x08) // 115200 8N1
                conn.controlTransfer(0x21, 0x20, 0, ctl, lineCoding, lineCoding.size, 500)
                conn.controlTransfer(0x21, 0x22, 0x03, ctl, null, 0, 500)
            }
            return UsbLink(conn, intf, bulk(intf, UsbConstants.USB_DIR_IN)!!, bulk(intf, UsbConstants.USB_DIR_OUT)!!, device)
        }

        private fun bulk(i: UsbInterface, dir: Int): UsbEndpoint? =
            (0 until i.endpointCount).map { i.getEndpoint(it) }
                .firstOrNull { it.type == UsbConstants.USB_ENDPOINT_XFER_BULK && it.direction == dir }
    }
}

private inline fun readFor(windowMs: Int, read: (ByteArray, Int) -> Int): List<Duml.Frame> {
    val parser = Duml.Parser()
    val out = ArrayList<Duml.Frame>()
    val buf = ByteArray(4096)
    val end = System.currentTimeMillis() + windowMs
    while (true) {
        val left = (end - System.currentTimeMillis()).toInt()
        if (left <= 0) break
        val n = read(buf, left.coerceAtLeast(1))
        if (n < 0) break
        if (n > 0) out += parser.feed(buf, n)
    }
    return out
}
