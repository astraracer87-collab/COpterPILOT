package de.copterpilot.fcctool

import android.content.Context
import org.json.JSONObject

/** Befehlsfolge aus assets/profiles/<name>.json (Format kompatibel zu FreeFCC). */
data class Profile(
    val name: String,
    val sender: Int,
    val cmdType: Int,
    val rounds: Int,
    val interFrameMs: Long,
    val interRoundMs: Long,
    val readWindowMs: Int,
    val frames: List<Step>,
) {
    data class Step(val cmdSet: Int, val cmdId: Int, val dst: Int, val payload: ByteArray, val note: String)

    companion object {
        fun load(ctx: Context, file: String): Profile {
            val o = JSONObject(ctx.assets.open("profiles/$file.json").bufferedReader().use { it.readText() })
            val arr = o.getJSONArray("frames")
            val steps = (0 until arr.length()).map {
                val f = arr.getJSONObject(it)
                Step(f.getInt("s"), f.getInt("i"), f.getInt("d"), f.optString("p", "").hexToBytes(), f.optString("note"))
            }
            return Profile(
                name = o.getString("name"),
                sender = o.optInt("sender", 0x82),
                cmdType = o.optInt("cmd_type", 0x20),
                rounds = o.optInt("rounds", 1),
                interFrameMs = o.optLong("inter_frame_delay_ms", 30),
                interRoundMs = o.optLong("inter_round_delay_ms", 100),
                readWindowMs = o.optInt("read_window_ms", 50),
                frames = steps,
            )
        }
    }
}
