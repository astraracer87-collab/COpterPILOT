/**
 * Zentraler, RN-freier Inhalt für den "Wildtierretter-Modus".
 *
 * Ehrenamtliche Wildtierretter (z. B. Rehkitzrettung) fliegen unter besonderen
 * Allgemeinverfügungen: die LBA/BMDV-Verfügung des Bundes gilt bundesweit für
 * alle, die hessischen Verfügungen (RP Gießen und RP Darmstadt) ergänzen
 * zusätzlich die Naturschutzgebiete. Dieser Modus ist REIN INFORMATIV — die
 * Freigabe trifft weiterhin der Pilot selbst; es werden keine Geozonen
 * automatisch als abgedeckt umklassifiziert.
 *
 * Diese Datei ist bewusst frei von Server-/RN-Imports, damit Dialog (mobil +
 * web) sowie Planungs-/Pre-Check-Hinweis DIESELBE Quelle nutzen (kein
 * Text-Drift).
 */

export interface WildlifeRescueOrdinance {
  /** Stabiler Schlüssel für React-Listen/Tests. */
  id: string;
  /** Erlassende Behörde. */
  authority: string;
  /** Titel der Verfügung. */
  title: string;
  /** Geltungsbereich (Wo/für wen gilt sie?). */
  scope: string;
  /** Wichtigste Auflagen/Bedingungen als Stichpunkte. */
  conditions: string[];
  /** Anzeige-Text des Quell-Links. */
  sourceLabel: string;
  /** URL zur amtlichen Quelle. */
  sourceUrl: string;
}

export const WILDLIFE_RESCUE_MODE_TITLE = "Wildtierretter-Modus";

export const WILDLIFE_RESCUE_MODE_SUBTITLE =
  "Für den ehrenamtlichen Einsatz in der Wildtierrettung (z. B. Rehkitzrettung).";

/** Frage beim Einschalten des Modus. */
export const WILDLIFE_RESCUE_CONFIRM_QUESTION =
  "Bist du ehrenamtlich tätig in der Wildtierrettung?";

/** Bestätigungstext nach "Ja". Enthält bewusst den 🫡-Emoji (ausdrückliche
 *  Nutzer-Vorgabe für genau diese Meldung, abweichend von der generellen
 *  "keine Emojis"-Regel). */
export const WILDLIFE_RESCUE_THANK_YOU =
  "Vielen Dank für deinen ehrenamtlichen Einsatz 🫡 Es werden die Allgemeinerlaubnisse des Land Hessen und des LBA dafür angewendet.";

/** Einleitung für die "Mehr Infos"-Zusammenfassung. */
export const WILDLIFE_RESCUE_INFO_INTRO =
  "Für den ehrenamtlichen Einsatz in der Wildtierrettung gelten besondere Allgemeinverfügungen. Die folgende Übersicht fasst die wichtigsten Punkte zusammen. Sie ersetzt nicht das Lesen der amtlichen Verfügung — bitte prüfe die Original-Dokumente und führe sie beim Flug mit.";

/** Deutlicher Hinweis in Planung (Restrictions-Schritt) und Pre-Check. */
export const WILDLIFE_RESCUE_PLANNING_HINT =
  "Wildtierretter-Modus aktiv: Für deinen ehrenamtlichen Einsatz gelten die Allgemeinverfügungen zur Wildtierrettung (LBA/BMDV bundesweit sowie RP Gießen und RP Darmstadt für hessische Naturschutzgebiete). Beachte deren Geltungsbereich und Auflagen.";

/** Klarstellung, dass der Modus nichts automatisch freigibt. */
export const WILDLIFE_RESCUE_DISCLAIMER =
  "Rein informativ: Die automatische Geozonen- und § 21h-Prüfung bleibt unverändert. Es werden keine Geozonen automatisch als abgedeckt eingestuft — die Flugfreigabe triffst du weiterhin selbst.";

export const WILDLIFE_RESCUE_ORDINANCES: WildlifeRescueOrdinance[] = [
  {
    id: "lba-bund",
    authority: "Luftfahrt-Bundesamt (LBA) / BMDV — Bund",
    title:
      "Allgemeinverfügung zum Betrieb von unbemannten Luftfahrtsystemen zum Zweck der Wildtierrettung",
    scope:
      "Gilt bundesweit für den ehrenamtlichen Betrieb von Drohnen zum Zweck der Wildtierrettung (insbesondere Rehkitzrettung) in bestimmten geografischen Gebieten nach § 21h LuftVO, soweit die Verfügung reicht.",
    conditions: [
      "Nur zum Zweck der Wildtierrettung, nicht für andere Flüge.",
      "Einhaltung der in der Verfügung genannten Flughöhen- und Betriebsgrenzen.",
      "Betrieb in direkter Sichtweite (VLOS); Wahrung des Sicherheitsabstands zu Personen.",
      "Mitführen bzw. Bereithalten der Allgemeinverfügung während des Einsatzes.",
      "Beachtung sonstiger luftrechtlicher Vorgaben (z. B. Kontrollzonen, NOTAMs).",
    ],
    sourceLabel: "Luftfahrt-Bundesamt (lba.de)",
    sourceUrl:
      "https://www.lba.de/DE/Drohnen/UAS_Betriebsverbote_Erlaubnisse/UAS_Betriebsverbote_Erlaubnisse_node.html",
  },
  {
    id: "hessen-rp-giessen",
    authority: "Regierungspräsidium Gießen (Hessen)",
    title:
      "Allgemeinverfügung zum Befliegen von Naturschutzgebieten zum Zweck der Wildtierrettung",
    scope:
      "Ergänzt die Bundes-Verfügung im Zuständigkeitsbereich des RP Gießen und erlaubt das Befliegen ausgewiesener Naturschutzgebiete zum Zweck der Wildtierrettung.",
    conditions: [
      "Nur zum Zweck der Wildtierrettung in den betroffenen Schutzgebieten.",
      "Einhaltung der naturschutzrechtlichen Auflagen (Zeitfenster, Höhe, Störungsminimierung).",
      "Keine gezielte Störung von Tieren über den Rettungszweck hinaus.",
      "Beachtung der in der Verfügung genannten Melde-/Dokumentationspflichten.",
    ],
    sourceLabel: "RP Gießen (rp-giessen.hessen.de)",
    sourceUrl: "https://rp-giessen.hessen.de/",
  },
  {
    id: "hessen-rp-darmstadt",
    authority: "Regierungspräsidium Darmstadt (Hessen)",
    title:
      "Allgemeinverfügung zum Befliegen von Naturschutzgebieten zum Zweck der Wildtierrettung",
    scope:
      "Ergänzt die Bundes-Verfügung im Zuständigkeitsbereich des RP Darmstadt und erlaubt das Befliegen ausgewiesener Naturschutzgebiete zum Zweck der Wildtierrettung.",
    conditions: [
      "Nur zum Zweck der Wildtierrettung in den betroffenen Schutzgebieten.",
      "Einhaltung der naturschutzrechtlichen Auflagen (Zeitfenster, Höhe, Störungsminimierung).",
      "Keine gezielte Störung von Tieren über den Rettungszweck hinaus.",
      "Beachtung der in der Verfügung genannten Melde-/Dokumentationspflichten.",
    ],
    sourceLabel: "RP Darmstadt (rp-darmstadt.hessen.de)",
    sourceUrl: "https://rp-darmstadt.hessen.de/",
  },
];

/**
 * IDs aller aktuell geltenden Wildtierrettungs-Verfügungen. Wird beim Anlegen
 * eines Logbucheintrags als Snapshot eingefroren, damit ein späteres PDF genau
 * die zum Flugzeitpunkt anwendbaren Verfügungen belegen kann — auch wenn sich
 * die Verfügungsliste später ändert.
 */
export function activeWildlifeRescueOrdinanceIds(): string[] {
  return WILDLIFE_RESCUE_ORDINANCES.map((ord) => ord.id);
}

/**
 * Rendert die für den Wildtierretter-Modus geltenden Allgemeinverfügungen als
 * HTML-Abschnitt für den PDF-Export (mobil + web). Einzige Quelle, damit der
 * Text auf beiden Oberflächen identisch bleibt. `esc` ist die
 * oberflächenspezifische HTML-Escaping-Funktion.
 *
 * `ordinanceIds` (optional) filtert auf die zum Flugzeitpunkt eingefrorenen
 * Verfügungen (audit-fest). Ohne Angabe (bzw. leer) werden alle aktuellen
 * Verfügungen gerendert (Rückwärtskompatibilität für Altdaten ohne Snapshot).
 */
export function buildWildlifeRescueOrdinancesHtml(
  esc: (value: string) => string,
  ordinanceIds?: string[] | null,
): string {
  const ordinances =
    ordinanceIds && ordinanceIds.length > 0
      ? WILDLIFE_RESCUE_ORDINANCES.filter((ord) =>
          ordinanceIds.includes(ord.id),
        )
      : WILDLIFE_RESCUE_ORDINANCES;
  const blocks = ordinances.map(
    (ord) => `
    <h3>${esc(ord.title)}</h3>
    <table>
      <tr><td class="label">Behörde</td><td>${esc(ord.authority)}</td></tr>
      <tr><td class="label">Geltungsbereich</td><td>${esc(ord.scope)}</td></tr>
    </table>
    <p style="margin:6px 0 2px 0;font-weight:600;">Wichtigste Auflagen</p>
    <ul style="margin-top:2px;">${ord.conditions
      .map((c) => `<li>${esc(c)}</li>`)
      .join("")}</ul>
    <p style="font-size:11px;color:#555;">Quelle: <a href="${esc(
      ord.sourceUrl,
    )}">${esc(ord.sourceLabel)}</a></p>`,
  ).join("");
  return `
    <h2>Allgemeinverfügungen zur Wildtierrettung</h2>
    <p style="color:#555;font-size:12px;margin-top:-4px;">${esc(
      WILDLIFE_RESCUE_INFO_INTRO,
    )}</p>
    ${blocks}
    <p style="color:#555;font-size:11px;">${esc(WILDLIFE_RESCUE_DISCLAIMER)}</p>`;
}
