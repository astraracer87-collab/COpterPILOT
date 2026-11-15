// Standalone-Helfer für die länderübergreifende Geozonen-Abdeckung (welche
// Länder ein Pin/Viewport berührt) und den ED-269-Abruf (Gerätecache, siehe
// geozoneDirect/).
//
// Bewusst frei von React-Native-Imports (kein AsyncStorage/expo-constants),
// damit die reine Logik unter dem tsx-Testrunner (web/run-tests.sh) ohne den
// nativen Modulgraphen geprüft werden kann – analog zu geozoneTileUrl.ts
// (expo-file-system wird im Gerätecache nur lazy geladen).
// geozones.ts re-exportiert dünne Wrapper, die die
// COUNTRY_GEOZONE_CONFIGS-Schlüssel injizieren, sodass die öffentliche API
// (und alle Aufrufer) unverändert bleibt.
import { detectCountryFromCoordinates } from "./countryMaps";
import { parseEd269ToGeozoneInfo } from "./ed269";
import type { GeozoneFeatureInfo } from "./geozones";
import { getEd269Dataset } from "./geozoneDirect/ed269Store";
import { isSourceDataStale, resolveGeozoneSourceIso } from "../../shared/geozoneSourceMeta";
import { queryEd269Features } from "./geozoneDirect/ed269Query";

// Sowohl die Radius- (getCountriesInRadius) als auch die Viewport-Abdeckung
// (getViewportCountries) bestimmen die berührten Länder polygon-autoritativ über
// detectCountryFromCoordinates. So nutzen Punkt-Erkennung und Abdeckung dieselbe
// (Polygon-)Quelle und können nicht auseinanderdriften. Grobe Länder-Bounding-
// Boxen werden hier bewusst NICHT mehr für die Abdeckung verwendet, da sie an
// Grenzen weit ins Nachbarland reichen (z. B. die FR-Box über die belgische
// Grenze) und so fremde Zonen/Texte in die Flugbereichsliste mischen würden.

// Aliase aus der Quellen-Registry: Liechtenstein hat keinen eigenen
// Geozonen-Datensatz, seine Zonen stehen im Schweizer BAZL-Datensatz (CH). Ein
// als „LI“ erkannter Punkt zählt daher für die Abdeckung als CH, damit Karte
// und Zonencheck die BAZL-Zonen laden.
function datasetIso(iso: string | null): string | null {
  return iso ? resolveGeozoneSourceIso(iso) : iso;
}

// Fragt den ED-269-Bestand (AT/BE/DK) für die per bbox abgesteckte Umgebung ab
// und normalisiert ihn zu GeozoneFeatureInfo. Früher ein Aufruf des Server-
// Endpoints `/api/cached/geozones`; das Backend existiert nicht mehr. Jetzt
// lädt die App die Upstream-Feeds selbst, speichert sie auf dem Gerät
// (geozoneDirect/ed269Store.ts, auch offline nutzbar) und filtert lokal mit
// derselben Semantik (geozoneDirect/ed269Query.ts). Liefert [] bei nicht
// unterstütztem Land oder Fehlschlag, ohne zu werfen.
export async function queryEd269CachedFeaturesFrom(
  // Veraltet und ignoriert (früher die Backend-Basis-URL). Bleibt für die
  // Signatur-Stabilität der Aufrufer erhalten.
  _baseUrl: string,
  lat: number,
  lon: number,
  radiusKm: number,
  iso: string,
  limit?: number,
  // Bei `true` wird KEINE bbox gesetzt -> gesamter Landesbestand. Nur für
  // kleine Datensätze (z. B. Belgien) bzw. Offline-Pakete sinnvoll.
  fullCountry?: boolean,
  // Nur Zonen mit einer Gültigkeitsdauer < N Tagen (temporäre NOTAM-artige
  // Zonen).
  maxValidityDays?: number,
  // Download erzwingen (z. B. beim Laden eines Offline-Pakets).
  forceRefresh?: boolean,
): Promise<GeozoneFeatureInfo[]> {
  const r = await queryEd269CachedFeaturesWithStatusFrom(
    _baseUrl, lat, lon, radiusKm, iso, limit, fullCountry, maxValidityDays, forceRefresh,
  );
  return r.zones;
}

// ---------------------------------------------------------------------------
// Abdeckungs-Information (Review-Fix 4): "keine Zonen" darf nicht mit "keine
// Daten" verwechselt werden. Ein fehlender Datensatz, ein Abruffehler oder ein
// Land ohne automatische Prüfung ergibt KEIN grünes Ergebnis, sondern eine
// Abdeckungslücke, die der Pilot manuell prüfen muss.
// ---------------------------------------------------------------------------

/** Status einer einzelnen Länder-Quelle. "ok"/"stale" gelten als abgedeckt. */
// "partial": Land nur teilweise geprüft (z. B. DE-Offline-Paket ohne Wohngrundstücke).
export type GeozoneSourceStatus = "ok" | "stale" | "partial" | "missing" | "error" | "unsupported";

export interface GeozoneSourceCoverage {
  iso: string;
  status: GeozoneSourceStatus;
  /** Zeitpunkt des Datenbestands (ms), sofern bekannt. */
  fetchedAt?: number;
  /** Optionaler Hinweis (deutsch), z. B. "Offline-Paket fehlt". */
  note?: string;
}

export type GeozoneCoverage = "complete" | "partial" | "unavailable";

export interface GeozoneAreaResult {
  zones: GeozoneFeatureInfo[];
  coverage: GeozoneCoverage;
  sources: GeozoneSourceCoverage[];
}

export interface Ed269StatusResult {
  zones: GeozoneFeatureInfo[];
  status: GeozoneSourceStatus;
  fetchedAt?: number;
  note?: string;
}

/** Quelle liefert verwertbare Daten (auch veraltete gelten als vorhanden). */
export function isSourceCovered(status: GeozoneSourceStatus): boolean {
  return status === "ok" || status === "stale";
}

/** Fasst die Quellen zu einer Gesamt-Abdeckung zusammen. Keine Quelle = unavailable. */
export function summarizeGeozoneCoverage(sources: GeozoneSourceCoverage[]): GeozoneCoverage {
  if (sources.length === 0) return "unavailable";
  const covered = sources.filter((s) => isSourceCovered(s.status)).length;
  if (covered === sources.length) return "complete";
  const someData = covered > 0 || sources.some((s) => s.status === "partial");
  return someData ? "partial" : "unavailable";
}

/** Quellen ohne verwertbare Daten (missing/error/unsupported). */
export function uncoveredGeozoneSources(sources: GeozoneSourceCoverage[]): GeozoneSourceCoverage[] {
  return sources.filter((s) => !isSourceCovered(s.status));
}

/** Schlechterer von zwei Status (für Länder mit mehreren Teilquellen). */
export function worseSourceStatus(a: GeozoneSourceStatus, b: GeozoneSourceStatus): GeozoneSourceStatus {
  const rank: Record<GeozoneSourceStatus, number> = { ok: 0, stale: 1, partial: 2, missing: 3, unsupported: 3, error: 4 };
  return rank[b] > rank[a] ? b : a;
}

// Warntexte (deutsch) liegen in der Prüfkette (shared/checks/builders.ts),
// damit Liste, Dialog und CheckResult denselben Text verwenden.
export { geozoneCoverageWarning, sourceCoverageWarning } from "../../shared/checks/builders";

// Wie queryEd269CachedFeaturesFrom, liefert aber zusätzlich den Status der
// Quelle: kein Datensatz -> "missing", Ausnahme -> "error", älter als das
// Aktualisierungsintervall -> "stale", sonst "ok". Wirft nie.
export async function queryEd269CachedFeaturesWithStatusFrom(
  _baseUrl: string,
  lat: number,
  lon: number,
  radiusKm: number,
  iso: string,
  limit?: number,
  fullCountry?: boolean,
  maxValidityDays?: number,
  forceRefresh?: boolean,
): Promise<Ed269StatusResult> {
  try {
    const ds = await getEd269Dataset(iso, { forceRefresh });
    if (!ds) return { zones: [], status: "missing", note: "kein Datenbestand auf dem Gerät" };
    const fetchedAt = ds.fetchedAt > 0 ? ds.fetchedAt : undefined;
    // Altersschwelle laut Registry-Policy (staleWarnAfterMs)
    const status: GeozoneSourceStatus = isSourceDataStale(iso, ds.fetchedAt) ? "stale" : "ok";
    let bbox: [number, number, number, number] | undefined;
    if (!fullCountry) {
      const kmToDegLat = 1 / 111.32;
      const kmToDegLon = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
      const dLat = radiusKm * kmToDegLat;
      const dLon = radiusKm * kmToDegLon;
      bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
    }
    const feats = queryEd269Features(ds.features, iso, {
      bbox,
      limit: !fullCountry && limit != null && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined,
      maxValidityDays:
        maxValidityDays != null && Number.isFinite(maxValidityDays) && maxValidityDays > 0
          ? maxValidityDays
          : undefined,
    });
    return { zones: parseEd269ToGeozoneInfo(feats, iso), status, fetchedAt };
  } catch (e: any) {
    console.warn("[Geozones] ED-269 query error:", e?.message || e);
    return { zones: [], status: "error", note: String(e?.message || e) };
  }
}

// Liefert alle unterstützten Länder, die der durch (lat, lon, radiusKm)
// aufgespannte Kreis-Bereich tatsächlich berührt. Die Länderauswahl ist – wie
// getViewportCountries – polygon-autoritativ (detectCountryFromCoordinates auf
// Zentrum + Raster-/Randproben innerhalb des Radius), NICHT über grobe Länder-
// Bounding-Boxen. Die groben Boxen überlappen an Grenzen weit ins Nachbarland
// (z. B. reicht die FR-Box über die belgische Grenze) und würden für einen
// eindeutig belgischen Punkt fälschlich FR mitzählen. `primaryIso` (falls
// unterstützt) wird NUR nach vorne sortiert, wenn der Radius es tatsächlich
// berührt – es wird niemals erzwungen aufgenommen.
export function getCountriesInRadius(
  supportedIsos: string[],
  lat: number,
  lon: number,
  radiusKm: number,
  primaryIso?: string,
): string[] {
  const supported = new Set(supportedIsos.map((s) => s.toUpperCase()));
  const isSupported = (iso: string | null): iso is string => !!iso && supported.has(iso.toUpperCase());

  const found: string[] = [];
  const add = (raw: string | null) => {
    const iso = datasetIso(raw);
    if (isSupported(iso)) {
      const up = iso.toUpperCase();
      if (!found.includes(up)) found.push(up);
    }
  };

  // Zentrum (polygon-autoritativ) zuerst. Das primäre Land (z. B. das in den
  // Einstellungen bevorzugte Land) wird NICHT mehr erzwungen aufgenommen, sondern
  // nur einsortiert (siehe unten), wenn der Radius es tatsächlich berührt. Sonst
  // mischt ein im falschen Land gewähltes Vorzugsland fremde Zonen/Texte (z. B.
  // FR DGAC/AlphaTango) in einen Flug in Belgien.
  add(detectCountryFromCoordinates(lat, lon));

  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const dLat = radiusKm * kmToDegLat;
  const dLon = radiusKm * kmToDegLon;

  // Raster über den Kreis abtasten (auf den Kreis beschnitten), damit ein Land,
  // das einen nennenswerten Teil des Radius einnimmt, erfasst wird, ohne dass
  // bloße Box-Überlappung ein Nachbarland fälschlich einschließt.
  const fracs = [-1, -0.5, 0, 0.5, 1];
  for (const fLat of fracs) {
    for (const fLon of fracs) {
      if (fLat * fLat + fLon * fLon > 1.0001) continue; // außerhalb des Kreises
      add(detectCountryFromCoordinates(lat + fLat * dLat, lon + fLon * dLon));
    }
  }

  // Zusätzliche Randproben in 8 Richtungen am Kreisrand, damit dünne Grenz-
  // bänder (zwischen den Rasterpunkten) erfasst werden.
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  for (const deg of angles) {
    const r = (deg * Math.PI) / 180;
    add(detectCountryFromCoordinates(lat + dLat * Math.sin(r), lon + dLon * Math.cos(r)));
  }

  // Primäres Land nur nach vorne sortieren, wenn der Radius es tatsächlich
  // berührt (also bereits erkannt wurde) – niemals erzwungen aufnehmen.
  if (primaryIso) {
    const up = primaryIso.toUpperCase();
    const idx = found.indexOf(up);
    if (idx > 0) {
      found.splice(idx, 1);
      found.unshift(up);
    }
  }

  return found;
}

// Ermittelt die Länder, die ein Karten-Viewport (Mitte + optionale Ausdehnung)
// abdeckt. Die erkannte Mitte ist das primäre Overlay; mit bekannter Ausdehnung
// wird ein Raster abgetastet, ohne Ausdehnung dienen Nachbar-Proben < borderKm.
export function getViewportCountries(
  supportedIsos: string[],
  lat: number,
  lon: number,
  latDelta: number = 0,
  lonDelta: number = 0,
  borderKm: number = 20,
  maxCountries: number = 4,
): string[] {
  const supported = new Set(supportedIsos);
  const isSupported = (iso: string | null): iso is string => !!iso && supported.has(iso);

  const found: string[] = [];
  const add = (raw: string | null) => {
    const iso = datasetIso(raw);
    if (isSupported(iso) && !found.includes(iso)) found.push(iso);
  };

  // Mittelland zuerst (primäres Overlay, oberste Render-Ebene).
  add(detectCountryFromCoordinates(lat, lon));

  const hasExtent = latDelta > 0 && lonDelta > 0;
  if (hasExtent) {
    // Raster über den sichtbaren Bereich abtasten. Reicht, um jedes Land zu
    // erfassen, das einen nennenswerten Teil des Viewports einnimmt (z. B. die
    // andere Grenzseite), ohne winzige Sliver mitzuladen.
    const halfLat = latDelta / 2;
    const halfLon = lonDelta / 2;
    const fracs = [-1, -0.5, 0, 0.5, 1];
    outer: for (const fLat of fracs) {
      for (const fLon of fracs) {
        add(detectCountryFromCoordinates(lat + fLat * halfLat, lon + fLon * halfLon));
        if (found.length >= maxCountries) break outer;
      }
    }
    return found.slice(0, maxCountries);
  }

  // Fallback ohne bekannte Ausdehnung: Mitte + ggf. ein Nachbar < borderKm.
  // Liegt die Mitte außerhalb unterstützter Länder, wird der nächstgelegene
  // unterstützte Nachbar zum primären Overlay (off-shore-Verhalten).
  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const dLat = borderKm * kmToDegLat;
  const dLon = borderKm * kmToDegLon;
  const probes: Array<[number, number]> = [
    [lat + dLat, lon],
    [lat - dLat, lon],
    [lat, lon + dLon],
    [lat, lon - dLon],
    [lat + dLat * 0.7, lon + dLon * 0.7],
    [lat + dLat * 0.7, lon - dLon * 0.7],
    [lat - dLat * 0.7, lon + dLon * 0.7],
    [lat - dLat * 0.7, lon - dLon * 0.7],
  ];
  for (const [pLat, pLon] of probes) {
    if (found.length >= 2) break;
    add(detectCountryFromCoordinates(pLat, pLon));
  }
  return found;
}
