package de.copterpilot.fcctool

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Hält den FCC-Modus: einmal das volle Profil, danach alle 2 s die kurze
 * Keepalive-Folge (DJI Fly setzt die Region sonst wieder auf CE zurück;
 * nach dem Ausschalten ist die Einstellung ohnehin weg).
 */
class KeepaliveService : Service() {
    @Volatile private var running = false
    private var worker: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startAsForeground()
        if (!running) {
            running = true
            setEnabled(this, true)
            worker = Thread({ loop() }, "fcc-keepalive").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        Log.add("Keepalive gestoppt")
        super.onDestroy()
    }

    private fun loop() {
        val full = Profile.load(this, "fcc")
        val keep = Profile.load(this, "fcc_keepalive")
        Log.add("Keepalive gestartet")
        var appliedFull = false
        var count = 0
        while (running) {
            try {
                val link = Engine.tcpLink(this)
                if (link != null) {
                    if (!appliedFull) {
                        Engine.runProfile(link, full)
                        Engine.setMode(this, "FCC")
                        appliedFull = true
                    } else {
                        val n = Engine.runProfile(link, keep, verbose = false)
                        if (++count % 30 == 0) Log.add("Keepalive läuft (${count}×, letzte Runde $n Antworten)")
                    }
                }
                Thread.sleep(if (link == null) 10_000 else 2_000)
            } catch (_: InterruptedException) {
                break
            } catch (e: Exception) {
                Log.add("Keepalive-Fehler: ${e.message}")
                try { Thread.sleep(5_000) } catch (_: InterruptedException) { break }
            }
        }
    }

    private fun startAsForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "FCC Keepalive", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL)
            .setContentTitle("FCC-Modus aktiv")
            .setContentText("Wird alle 2 Sekunden erneuert")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(1, n)
        }
    }

    companion object {
        private const val CHANNEL = "keepalive"
        private const val KEY = "keepalive_enabled"

        fun isEnabled(ctx: Context) = ctx.getSharedPreferences("fcc", 0).getBoolean(KEY, false)
        fun setEnabled(ctx: Context, on: Boolean) = ctx.getSharedPreferences("fcc", 0).edit().putBoolean(KEY, on).apply()

        fun start(ctx: Context) = ctx.startForegroundService(Intent(ctx, KeepaliveService::class.java))
        fun stop(ctx: Context) {
            setEnabled(ctx, false)
            ctx.stopService(Intent(ctx, KeepaliveService::class.java))
        }
    }
}

/** Startet den Keepalive nach dem Einschalten wieder, wenn er vorher aktiv war. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && KeepaliveService.isEnabled(context)) {
            KeepaliveService.start(context)
        }
    }
}
