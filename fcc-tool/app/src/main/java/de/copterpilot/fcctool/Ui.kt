package de.copterpilot.fcctool

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Farben und Bausteine im Cockpit-Stil (passend zu COpter Pilot), dunkle Variante. */
object Ui {
    val BG = Color.rgb(13, 17, 23)
    val SURFACE = Color.rgb(22, 27, 34)
    val SURFACE2 = Color.rgb(30, 36, 44)
    val BORDER = Color.rgb(48, 54, 61)
    val TEXT = Color.rgb(230, 237, 243)
    val TEXT2 = Color.rgb(139, 148, 158)
    val BLUE = Color.rgb(31, 111, 181)      // Aviation Blue, etwas heller fürs Dunkle
    val GREEN = Color.rgb(45, 160, 105)     // Go
    val AMBER = Color.rgb(217, 119, 6)      // Caution
    val RED = Color.rgb(197, 60, 50)        // No-Go

    private fun dp(ctx: Context, v: Float) =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics).toInt()

    fun card(ctx: Context): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = GradientDrawable().apply {
            setColor(SURFACE); cornerRadius = dp(ctx, 14f).toFloat()
            setStroke(dp(ctx, 1f), BORDER)
        }
        val p = dp(ctx, 14f)
        setPadding(p, p, p, p)
    }

    fun title(ctx: Context, t: String) = TextView(ctx).apply {
        text = t; setTextColor(TEXT2); textSize = 12f
        letterSpacing = 0.08f; typeface = Typeface.DEFAULT_BOLD
        setPadding(0, 0, 0, dp(ctx, 8f))
    }

    fun label(ctx: Context, t: String, color: Int = TEXT, size: Float = 14f, bold: Boolean = false) = TextView(ctx).apply {
        text = t; setTextColor(color); textSize = size
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    /** Großer Hauptknopf mit Farbe und abgerundeter Fläche. */
    fun bigButton(ctx: Context, text: String, color: Int, onClick: () -> Unit) = Button(ctx).apply {
        this.text = text; isAllCaps = false; textSize = 16f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Color.WHITE)
        val bg = GradientDrawable().apply { setColor(color); cornerRadius = dp(ctx, 12f).toFloat() }
        background = RippleDrawable(ColorStateList.valueOf(Color.argb(60, 255, 255, 255)), bg, null)
        setPadding(dp(ctx, 16f), dp(ctx, 18f), dp(ctx, 16f), dp(ctx, 18f))
        stateListAnimator = null
        setOnClickListener { onClick() }
    }

    /** Kleinerer, dezenter Knopf (Umriss). */
    fun smallButton(ctx: Context, text: String, onClick: () -> Unit) = Button(ctx).apply {
        this.text = text; isAllCaps = false; textSize = 13f
        setTextColor(TEXT)
        val bg = GradientDrawable().apply {
            setColor(SURFACE2); cornerRadius = dp(ctx, 10f).toFloat(); setStroke(dp(ctx, 1f), BORDER)
        }
        background = RippleDrawable(ColorStateList.valueOf(Color.argb(40, 255, 255, 255)), bg, null)
        setPadding(dp(ctx, 12f), dp(ctx, 10f), dp(ctx, 12f), dp(ctx, 10f))
        stateListAnimator = null
        setOnClickListener { onClick() }
    }

    /** Statusabzeichen mit farbigem Hintergrund (10 %) und farbigem Text. */
    fun badge(ctx: Context): TextView = TextView(ctx).apply {
        textSize = 15f; typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setPadding(dp(ctx, 14f), dp(ctx, 8f), dp(ctx, 14f), dp(ctx, 8f))
    }

    fun setBadge(badge: TextView, text: String, color: Int) {
        val ctx = badge.context
        badge.text = text
        badge.setTextColor(color)
        badge.background = GradientDrawable().apply {
            setColor(Color.argb(38, Color.red(color), Color.green(color), Color.blue(color)))
            cornerRadius = dp(ctx, 8f).toFloat()
            setStroke(dp(ctx, 1f), Color.argb(120, Color.red(color), Color.green(color), Color.blue(color)))
        }
    }

    fun row(ctx: Context) = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }

    fun space(ctx: Context, h: Float) = View(ctx).apply {
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, h))
    }

    fun lp(w: Int = MATCH_PARENT, h: Int = WRAP_CONTENT, weight: Float = 0f, topDp: Int = 0) =
        LinearLayout.LayoutParams(w, h, weight).apply { if (topDp > 0) topMargin = topDp }

    fun dpi(ctx: Context, v: Float) = dp(ctx, v)
}
