/**
 * RN-freier, reiner Resolver für die flugzeitgenaue Zuordnung von
 * Pilotendokumenten (Allgemeinverfügung / A2-Fernpilotenzeugnis /
 * Versicherungsnachweis).
 *
 * Hintergrund (Task #613, Nutzer-Entscheidung): Statt pro Flug eine
 * unveränderliche Kopie zu speichern, bleiben ALLE alten Dokumentfassungen im
 * Pilotenprofil erhalten (siehe pilotProfiles.documentArchive). Beim
 * Anzeigen/Exportieren eines (auch alten) Flugprotokolls wird hier die Fassung
 * rekonstruiert, die zum Flugzeitpunkt aktuell/gültig war.
 *
 * Bewusst OHNE Abhängigkeit zu Geometrie/Polygonen: Das Bundesland wird beim
 * Anlegen des Logbucheintrags ermittelt und mitgegeben — dieser Resolver
 * bekommt es als Parameter. So ist er server-, web- und mobil-tauglich und
 * unter `tsx` testbar.
 */
import type { ArchivedDocument, DocumentRefJson, LicenseDetailsInput } from "./schema";

/** Minimal-Sicht auf das Pilotenprofil, die der Resolver braucht. */
export interface PilotProfileForResolve {
  insuranceDocument?: DocumentRefJson | null;
  insuranceExpirationDate?: string | null;
  licenseA2?: boolean | null;
  licenseA2Details?: LicenseDetailsInput | null;
  allgemeinverfuegung?:
    | Array<{ bundesland: string; expirationDate?: string; document?: unknown }>
    | null;
  documentArchive?: ArchivedDocument[] | null;
}

export type ResolvedDocumentSource = "current" | "archive";

/** Eine zum Flugzeitpunkt aufgelöste Dokumentfassung. */
export interface ResolvedPilotDocument {
  type: "av" | "a2" | "insurance";
  /** Anzeige-Bezeichnung in Deutsch. */
  label: string;
  /** Nur bei AV: das Bundesland. */
  bundesland?: string;
  /** Ablaufdatum dieser Fassung (TT.MM.JJJJ / ISO), falls bekannt. */
  expirationDate?: string;
  /** Datei-Referenz; bei A2 (nur Metadaten) null/undefined. */
  document?: DocumentRefJson | null;
  /** Nur bei A2: Lizenz-Metadaten. */
  licenseDetails?: LicenseDetailsInput;
  /** Stammt die Fassung aus dem aktuellen Profil oder aus dem Archiv? */
  source: ResolvedDocumentSource;
  /**
   * True, wenn das Gültigkeitsfenster [activeFrom, archivedAt) dieser Fassung
   * das Flugdatum echt enthielt. False = bestmögliche Annäherung (z.B. Flug
   * liegt vor dem ersten bekannten Upload).
   */
  matchedExactly: boolean;
}

export interface ResolveOptions {
  /** Flugdatum (ISO `YYYY-MM-DD` oder deutsch `TT.MM.JJJJ`). */
  flightDateISO?: string | null;
  /** Erkanntes Bundesland des Flugs (für die AV-Zuordnung). */
  bundesland?: string | null;
}

const LABELS: Record<ResolvedPilotDocument["type"], string> = {
  av: "Allgemeinverfügung",
  a2: "A2-Fernpilotenzeugnis",
  insurance: "Versicherungsnachweis",
};

/** Parst ISO- (mit/ohne Zeit) und deutsche Datumsformate zu Epoch-ms. */
export function parseDateMs(raw?: string | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const direct = new Date(s);
    if (!isNaN(direct.getTime())) return direct.getTime();
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback.getTime();
}

interface Version {
  activeFrom: number | null;
  archivedAt: number | null; // null = aktuelle (live) Fassung
  source: ResolvedDocumentSource;
  expirationDate?: string;
  document?: DocumentRefJson | null;
  licenseDetails?: LicenseDetailsInput;
}

/**
 * Wählt aus mehreren Fassungen einer Dokument-Linie die zum Flugdatum passende:
 * die Fassung, deren Fenster [activeFrom, archivedAt) das Flugdatum enthält
 * (bei Überlappung die zuletzt aktiv gewordene). Findet sich keine, wird als
 * bestmögliche Annäherung die aktuelle Fassung bzw. die älteste bekannte
 * gewählt (matched=false).
 */
function pickVersion(
  versions: Version[],
  flightMs: number | null,
): { v: Version; matched: boolean } | null {
  if (versions.length === 0) return null;
  if (flightMs != null) {
    const within = versions.filter(
      (v) =>
        (v.activeFrom == null || v.activeFrom <= flightMs) &&
        (v.archivedAt == null || flightMs < v.archivedAt),
    );
    if (within.length > 0) {
      within.sort((a, b) => (a.activeFrom ?? -Infinity) - (b.activeFrom ?? -Infinity));
      return { v: within[within.length - 1], matched: true };
    }
  }
  const current = versions.find((v) => v.archivedAt == null);
  if (current) return { v: current, matched: flightMs == null };
  const sorted = [...versions].sort(
    (a, b) => (a.activeFrom ?? Infinity) - (b.activeFrom ?? Infinity),
  );
  return { v: sorted[0], matched: false };
}

function norm(s?: string | null): string {
  return (s || "").trim().toLowerCase();
}

/**
 * Liefert die zum Flugzeitpunkt gültigen Pilotendokumente (AV für das erkannte
 * Bundesland, A2-Lizenz, Versicherung). Reihenfolge: AV, A2, Versicherung.
 */
export function resolveFlightTimeDocuments(
  profile: PilotProfileForResolve | null | undefined,
  opts: ResolveOptions,
): ResolvedPilotDocument[] {
  if (!profile) return [];
  const flightMs = parseDateMs(opts.flightDateISO);
  const archive = Array.isArray(profile.documentArchive) ? profile.documentArchive : [];
  const out: ResolvedPilotDocument[] = [];

  // --- Allgemeinverfügung (pro Bundesland) ---
  const requested = norm(opts.bundesland);
  const avCurrent = Array.isArray(profile.allgemeinverfuegung)
    ? profile.allgemeinverfuegung
    : [];
  const avArchive = archive.filter((a) => a.type === "av");

  // Menge der relevanten Bundesländer: bei bekanntem Flug-Bundesland nur dieses,
  // sonst alle, für die aktuell eine AV hinterlegt ist.
  const bundeslandSet = new Set<string>();
  if (requested) {
    for (const e of avCurrent) if (norm(e.bundesland) === requested) bundeslandSet.add(e.bundesland);
    for (const a of avArchive) if (norm(a.bundesland) === requested) bundeslandSet.add(a.bundesland || "");
    // Auch wenn (noch) keine AV hinterlegt ist, kein Eintrag erzwingen.
  } else {
    for (const e of avCurrent) bundeslandSet.add(e.bundesland);
  }

  for (const bl of bundeslandSet) {
    if (!bl) continue;
    const versions: Version[] = [];
    for (const e of avCurrent) {
      if (norm(e.bundesland) !== norm(bl)) continue;
      const doc = (e.document ?? null) as DocumentRefJson | null;
      versions.push({
        activeFrom: doc ? parseDateMs(doc.uploadedAt) : null,
        archivedAt: null,
        source: "current",
        expirationDate: e.expirationDate,
        document: doc,
      });
    }
    for (const a of avArchive) {
      if (norm(a.bundesland) !== norm(bl)) continue;
      versions.push({
        activeFrom: parseDateMs(a.activeFrom),
        archivedAt: parseDateMs(a.archivedAt),
        source: "archive",
        expirationDate: a.expirationDate,
        document: a.document ?? null,
      });
    }
    const picked = pickVersion(versions, flightMs);
    if (!picked) continue;
    out.push({
      type: "av",
      label: `${LABELS.av} ${bl}`.trim(),
      bundesland: bl,
      expirationDate: picked.v.expirationDate,
      document: picked.v.document ?? null,
      source: picked.v.source,
      matchedExactly: picked.matched,
    });
  }

  // --- A2-Fernpilotenzeugnis (nur Metadaten, kein Datei-Upload) ---
  {
    const versions: Version[] = [];
    if (profile.licenseA2 && profile.licenseA2Details) {
      versions.push({
        activeFrom: null,
        archivedAt: null,
        source: "current",
        expirationDate: profile.licenseA2Details.expirationDate,
        licenseDetails: profile.licenseA2Details,
      });
    }
    for (const a of archive.filter((x) => x.type === "a2")) {
      versions.push({
        activeFrom: parseDateMs(a.activeFrom),
        archivedAt: parseDateMs(a.archivedAt),
        source: "archive",
        expirationDate: a.expirationDate ?? a.licenseDetails?.expirationDate,
        licenseDetails: a.licenseDetails,
      });
    }
    const picked = pickVersion(versions, flightMs);
    if (picked && picked.v.licenseDetails) {
      out.push({
        type: "a2",
        label: LABELS.a2,
        expirationDate: picked.v.expirationDate,
        licenseDetails: picked.v.licenseDetails,
        source: picked.v.source,
        matchedExactly: picked.matched,
      });
    }
  }

  // --- Versicherungsnachweis ---
  {
    const versions: Version[] = [];
    if (profile.insuranceDocument) {
      versions.push({
        activeFrom: parseDateMs(profile.insuranceDocument.uploadedAt),
        archivedAt: null,
        source: "current",
        expirationDate: profile.insuranceExpirationDate ?? undefined,
        document: profile.insuranceDocument,
      });
    }
    for (const a of archive.filter((x) => x.type === "insurance")) {
      versions.push({
        activeFrom: parseDateMs(a.activeFrom),
        archivedAt: parseDateMs(a.archivedAt),
        source: "archive",
        expirationDate: a.expirationDate,
        document: a.document ?? null,
      });
    }
    const picked = pickVersion(versions, flightMs);
    if (picked && picked.v.document) {
      out.push({
        type: "insurance",
        label: LABELS.insurance,
        expirationDate: picked.v.expirationDate,
        document: picked.v.document,
        source: picked.v.source,
        matchedExactly: picked.matched,
      });
    }
  }

  return out;
}
