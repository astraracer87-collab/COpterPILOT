/**
 * Zentraler Feature-Katalog für das Abo-Modell.
 *
 * Jeder Eintrag beschreibt eine schaltbare App-Funktion. Die `key`-Werte werden
 * in den Stripe-Produkt-Metadaten unter `features` referenziert (kommagetrennt
 * oder als JSON-Array). Server-seitige Berechtigungsprüfungen vergleichen die
 * aus dem aktiven Abo (bzw. manuellen Override) abgeleiteten Feature-Keys gegen
 * diese kanonische Liste.
 *
 * Diese Datei ist die EINZIGE Quelle der Wahrheit für verfügbare Features und
 * wird von Server (Berechtigungslogik) und perspektivisch von Web/Mobile (UI)
 * gemeinsam genutzt.
 */

export interface FeatureDefinition {
  /** Stabiler technischer Schlüssel (in Stripe-Metadaten referenziert). */
  key: string;
  /** Deutscher Anzeigename. */
  name: string;
  /** Deutsche Kurzbeschreibung der Funktion. */
  description: string;
}

export const FEATURE_CATALOG: readonly FeatureDefinition[] = [
  {
    key: "flight_planning",
    name: "Flugplanung",
    description:
      "Planung von Flügen mit Drohne, Ort (Radius + Geozonen-Erkennung), Datum/Zeit und Wetter-Forecast.",
  },
  {
    key: "geozone_maps",
    name: "Geozonen-Karten",
    description:
      "Interaktive Karten mit offiziellen Geozonen-Overlays, Layer-Auswahl und Map-Style-Wechsel sowie CTR-/ED-R-Zonen.",
  },
  {
    key: "weather",
    name: "Wetter & Höhenprofile",
    description:
      "Detaillierte Wetterdaten inklusive Höhenprofile, 24h-Forecast, KP-Index und Zweitquellen.",
  },
  {
    key: "notams",
    name: "NOTAMs",
    description:
      "Aktive und kommende Luftraum-Beschränkungen (NOTAMs) deutschlandweit sowie Naturschutzgebiete.",
  },
  {
    key: "live_traffic",
    name: "Live-Flugverkehr",
    description:
      "Echtzeit-Flugverkehr aus mehreren Quellen mit Proximity-Alarm (TCAS-artig) und automatischer Traffic-Aufzeichnung.",
  },
  {
    key: "nd_filter",
    name: "ND-Filter-Empfehlung",
    description:
      "Empfehlung passender ND-/Graufilter für cineastische Drohnenaufnahmen abhängig von Lichtverhältnissen und Drohnenmodell.",
  },
  {
    key: "compliance",
    name: "Compliance & Länderdaten",
    description:
      "EU-UAS-Klassifizierung, länderspezifische Vorgaben (DE/FR/IT/CH/AT/ES/LU/NL/UK) und Pilotenprofil-Verwaltung.",
  },
  {
    key: "edr",
    name: "ED-R-Gebiete",
    description:
      "Erkennung von ED-R-Gebieten mit Proximity-Klassifizierung, AV-Bedingungen und Behörden-Kontakten.",
  },
  {
    key: "drone_management",
    name: "Drohnen-Management & Wartung",
    description:
      "Verwaltung von Drohnen-Presets und -Profilen inklusive Remote-ID, Höhenbeschränkung und Wartungs-Tracking.",
  },
  {
    key: "document_management",
    name: "Dokumentenverwaltung",
    description:
      "Hochladen und Verwalten von Genehmigungs- und Nachweis-Dokumenten (z. B. AV-Bescheide, Versicherung, Registrierungen).",
  },
  {
    key: "dji_log",
    name: "Fluglog (DJI)",
    description:
      "Auswertung von DJI-Controller-Logs, Zuordnung zu Logbucheinträgen und Anreicherung von Flugdaten.",
  },
  {
    key: "pdf_export",
    name: "PDF-Export",
    description:
      "Export von Logbuch- und Flugprotokoll-PDFs mit Karten-Overlay, Geozonen-Tabellen, Wetter-Vergleich und Traffic-Log.",
  },
  {
    key: "logbook",
    name: "Logbuch",
    description:
      "Digitales Flugbuch mit Einträgen, Debriefing und Verlauf aller durchgeführten Flüge.",
  },
  {
    key: "glossary_links",
    name: "Glossar & Links",
    description:
      "Glossar der dipul-Begriffe und kuratierte Sammlung relevanter Behörden- und Informationslinks.",
  },
  {
    key: "web_platform",
    name: "Zugang zur Web-Plattform",
    description:
      "Nutzung der Pre-Flight-Check-Plattform im Browser (Web-App) zusätzlich zur mobilen App.",
  },
] as const;

export type FeatureKey = (typeof FEATURE_CATALOG)[number]["key"];

export const FEATURE_KEYS: FeatureKey[] = FEATURE_CATALOG.map((f) => f.key);

const FEATURE_KEY_SET = new Set<string>(FEATURE_KEYS);

/** Prüft, ob ein Schlüssel ein bekannter Feature-Key ist. */
export function isKnownFeatureKey(key: string): key is FeatureKey {
  return FEATURE_KEY_SET.has(key);
}

/** Liefert die Definition zu einem Feature-Key (oder undefined). */
export function getFeatureDefinition(key: string): FeatureDefinition | undefined {
  return FEATURE_CATALOG.find((f) => f.key === key);
}

/**
 * Parst den Feature-Wert aus Stripe-Produkt-Metadaten.
 * Akzeptiert JSON-Array (`["a","b"]`) oder kommagetrennte Liste (`a, b`).
 * Unbekannte Keys werden herausgefiltert.
 */
export function parseFeaturesFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): FeatureKey[] {
  if (!metadata) return [];
  const raw = metadata["features"];
  if (raw == null) return [];

  let candidates: string[] = [];

  if (Array.isArray(raw)) {
    candidates = raw.map((v) => String(v).trim());
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          candidates = parsed.map((v) => String(v).trim());
        }
      } catch {
        candidates = trimmed.split(",").map((s) => s.trim());
      }
    } else {
      candidates = trimmed.split(",").map((s) => s.trim());
    }
  }

  const seen = new Set<string>();
  const result: FeatureKey[] = [];
  for (const c of candidates) {
    if (c && isKnownFeatureKey(c) && !seen.has(c)) {
      seen.add(c);
      result.push(c);
    }
  }
  return result;
}
