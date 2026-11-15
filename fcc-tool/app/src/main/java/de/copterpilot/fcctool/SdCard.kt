package de.copterpilot.fcctool

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract

/**
 * Schreibt die FCC-Datei auf die microSD-Karte der DJI-Brille.
 *
 * Ablauf für den Nutzer: SD-Karte der Brille in die Fernsteuerung stecken, hier die
 * Karte auswählen, Datei schreiben lassen, Karte zurück in die Brille, Brille einschalten.
 *
 * Die Dateien stammen aus der öffentlich beschriebenen „ham file“-Methode:
 *  - Goggles 2 / 3 / N3 / Integra: leere Datei namens `ham_cfg_support` (ohne Endung)
 *  - Goggles V1 / V2:              Textdatei `naco_pwr.txt` mit Inhalt `pwr_2`
 */
object SdCard {
    enum class Variant(val label: String, val fileName: String, val content: ByteArray) {
        HAM("Goggles 2 / 3 / N3 / Integra (ham_cfg_support)", "ham_cfg_support", ByteArray(0)),
        NACO("Goggles V1 / V2 (naco_pwr.txt)", "naco_pwr.txt", "pwr_2".toByteArray()),
    }

    data class Result(val ok: Boolean, val writtenName: String?, val message: String)

    /**
     * Legt die Datei im über SAF gewählten Ordner (treeUri) an. Eine vorhandene
     * gleichnamige Datei wird vorher gelöscht, damit kein „(1)“ angehängt wird.
     */
    fun writeInto(ctx: Context, treeUri: Uri, variant: Variant): Result {
        val resolver = ctx.contentResolver
        return try {
            val parent = DocumentsContract.buildDocumentUriUsingTree(
                treeUri, DocumentsContract.getTreeDocumentId(treeUri)
            )

            deleteExisting(ctx, treeUri, parent, variant.fileName)

            // Generischer MIME-Typ, damit der Anbieter den Namen möglichst unverändert lässt.
            val created = DocumentsContract.createDocument(
                resolver, parent, "application/octet-stream", variant.fileName
            ) ?: return Result(false, null, "Datei konnte nicht angelegt werden. Ist die Karte schreibgeschützt?")

            resolver.openOutputStream(created, "wt")?.use { it.write(variant.content) }
                ?: return Result(false, null, "Datei ließ sich nicht öffnen")

            val actual = queryName(ctx, created) ?: variant.fileName
            Log.ok("SD-Karte: Datei „$actual“ geschrieben (${variant.content.size} Byte)")
            if (actual != variant.fileName) {
                Result(true, actual,
                    "Geschrieben, aber als „$actual“ statt „${variant.fileName}“. " +
                    "Bitte auf der Karte in „${variant.fileName}“ umbenennen (ohne Endung).")
            } else {
                Result(true, actual, "Datei „$actual“ auf die Karte geschrieben.")
            }
        } catch (e: Exception) {
            Log.err("SD-Karte: Fehler ${e.message}")
            Result(false, null, "Fehler: ${e.message}")
        }
    }

    /** Entfernt die FCC-Dateien wieder von der Karte (Rückgängig = zurück auf CE). */
    fun removeFrom(ctx: Context, treeUri: Uri): Result {
        return try {
            val parent = DocumentsContract.buildDocumentUriUsingTree(
                treeUri, DocumentsContract.getTreeDocumentId(treeUri)
            )
            val bases = Variant.entries.map { it.fileName }  // ham_cfg_support, naco_pwr.txt
            val removed = ArrayList<String>()
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                treeUri, DocumentsContract.getDocumentId(parent)
            )
            ctx.contentResolver.query(
                childrenUri,
                arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                null, null, null
            )?.use { c ->
                while (c.moveToNext()) {
                    val nm = c.getString(1)
                    // auch angehängte Endungen wie .bin mit abdecken
                    if (bases.any { nm == it || nm.startsWith("ham_cfg_support") || nm.startsWith("naco_pwr") }) {
                        val doc = DocumentsContract.buildDocumentUriUsingTree(treeUri, c.getString(0))
                        try { DocumentsContract.deleteDocument(ctx.contentResolver, doc); removed += nm } catch (_: Exception) {}
                    }
                }
            }
            if (removed.isEmpty()) {
                Log.warn("SD-Karte: keine FCC-Datei gefunden")
                Result(true, null, "Es war keine FCC-Datei auf der Karte. Nichts zu entfernen.")
            } else {
                Log.ok("SD-Karte: entfernt ${removed.joinToString()}")
                Result(true, removed.first(), "Entfernt: ${removed.joinToString()}.")
            }
        } catch (e: Exception) {
            Log.err("SD-Karte: Fehler ${e.message}")
            Result(false, null, "Fehler: ${e.message}")
        }
    }

    private fun deleteExisting(ctx: Context, treeUri: Uri, parent: Uri, name: String) {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri, DocumentsContract.getDocumentId(parent)
        )
        ctx.contentResolver.query(
            childrenUri,
            arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME),
            null, null, null
        )?.use { c ->
            while (c.moveToNext()) {
                if (c.getString(1) == name) {
                    val doc = DocumentsContract.buildDocumentUriUsingTree(treeUri, c.getString(0))
                    try { DocumentsContract.deleteDocument(ctx.contentResolver, doc) } catch (_: Exception) {}
                }
            }
        }
    }

    private fun queryName(ctx: Context, uri: Uri): String? =
        ctx.contentResolver.query(
            uri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null
        )?.use { if (it.moveToFirst()) it.getString(0) else null }
}
