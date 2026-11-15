// Prüfkette (B4) – Client-Teil: Wetter-/Nacht-Builder (kapseln
// client/lib/assessment.ts mit identischen Schwellen), Zonen-Auswahl je
// Zeitkontext und EINE Bewertungsfunktion `evaluateFlight` für Planung
// (PlanningResult) und Pre-Check (ResultsScreen).
//
// Dokumentierter Unterschied der beiden Flüsse ist allein der Zeitbezug:
//  - Planung: Nacht und Zonenaktivität zur GEPLANTEN Zeit (Kontext "planned"),
//  - Pre-Check: Nacht JETZT (Start vor Ort), Zonen aktiv JETZT ODER zur
//    geplanten Zeit (Kontext "precheck").
// Gleiche Eingaben ergeben sonst dasselbe Urteil (siehe flightChecks.test.ts).
//
// Frei von React-Native-Importen (unter tsx testbar).

import type { WeatherData } from "@/lib/weather";
import type { WeatherLimits } from "@/lib/storage";
import type { AirportMetarObservation } from "@/lib/aviationWeather";
import { assessNightFlight, assessWeather, type AssessmentWarning } from "@/lib/assessment";
import { classifyPlanningZones, type PlanningZoneClassification } from "@/lib/restrictionPlanning";
import { isZoneActiveInContext, type ZoneTimeContext } from "../../shared/ed269Restriction";
import { flightWindowSampleTimes } from "../../shared/flightWindow";
import { computeSunElevation } from "../../shared/solar";
import { maxRestrictionVerdict, type RestrictionVerdict, type RestrictionZoneLike } from "../../shared/restrictionPolicy";
import { partitionByReachability, type ReachabilityOptions, type ZoneAltitudeInput } from "../../shared/geozoneAltitudeFilter";
import {
  assessOfflineData,
  formatStandTimeDe,
  offlineForecastLabel,
  offlineStandLabel,
} from "../../shared/offlineDataPolicy";
import {
  aggregate,
  checksFor,
  geozoneChecks,
  offlineDataCheck,
  offlineExpiredCheck,
  legacyGeozoneChecks,
  notamChecks,
  officialMapCrossCheckChecks,
  type CheckAggregate,
  type CheckCategory,
  type CheckContext,
  type CheckOverride,
  type CheckResult,
  type LegacyRestrictionInput,
  type RestrictionStatusInput,
} from "../../shared/checks";

// ---------------------------------------------------------------------------
// Wetter / Nacht
// ---------------------------------------------------------------------------

export const WEATHER_UNKNOWN_TEXT = "Keine Wetterdaten für den geplanten Zeitpunkt – Wetter vor dem Start prüfen";
export const WEATHER_OK_TEXT = "Alle Wetterbedingungen innerhalb der Limits";

/** Übersetzt einen Warnhinweis aus assessWeather in einen CheckResult. */
export function warningToCheck(
  w: AssessmentWarning,
  category: CheckCategory,
  id: string,
  context: CheckContext,
): CheckResult {
  return {
    id,
    category,
    severity: w.nogo ? "nogo" : "caution",
    title: w.message,
    detail: w.expertTip?.description ?? "",
    requiresConfirmation: w.severe === true || undefined,
    emphasis: w.severity,
    tip: w.expertTip,
    exceedance: w.exceedance,
    context,
  };
}

export interface NightCheckInput {
  context: CheckContext;
  /** Planung: geplanter Zeitpunkt; Pre-Check: jetzt. */
  at: Date | null | undefined;
  /** Optional: Ende des geplanten Flugfensters (bei Über-Mitternacht-Flügen
   *  am Folgetag). Dann zählt der dunkelste Zeitpunkt im Fenster. */
  until?: Date | null;
  latitude: number;
  longitude: number;
  /** Nur Rückfall, wenn am Standort kein Land erkannt wird. */
  countryIso?: string | null;
}

/**
 * Prüfzeitpunkt der Nachtprüfung: ohne Fensterende `at`, sonst der Zeitpunkt
 * mit der tiefsten Sonne im Fenster [at, until] (10-min-Raster inkl. Ende) –
 * so wird ein Fenster, das z. B. bei Tageslicht beginnt und in die Nacht
 * reicht, als Nachtflug erkannt.
 */
export function nightCheckReferenceTime(
  at: Date | null | undefined,
  until: Date | null | undefined,
  latitude: number,
  longitude: number,
): Date | undefined {
  if (!at || !Number.isFinite(at.getTime())) return undefined;
  if (!until || !Number.isFinite(until.getTime()) || until.getTime() <= at.getTime()) return at;
  let best = at;
  let bestElev = computeSunElevation(latitude, longitude, at);
  for (const t of flightWindowSampleTimes(at, until, 10)) {
    const e = computeSunElevation(latitude, longitude, t);
    if (e < bestElev) {
      bestElev = e;
      best = t;
    }
  }
  return best;
}

/** Nachtflug-Befunde (assessNightFlight, Land aus dem Standort). */
export function nightChecks(input: NightCheckInput): CheckResult[] {
  const ref = nightCheckReferenceTime(input.at, input.until, input.latitude, input.longitude);
  const night = assessNightFlight(ref, input.latitude, input.longitude, input.countryIso);
  return night.warnings.map((w, i) => warningToCheck(w, "night", `night:${i}`, input.context));
}

export interface WeatherCheckInput {
  context: CheckContext;
  /** `weather.offline` (Teil A): Vorhersage aus dem Offline-Speicher. */
  weather: WeatherData | null | undefined;
  limits: WeatherLimits;
  kpIndex?: number;
  /** Teil A: Kp aus dem Offline-Speicher – Abrufzeit (ms). */
  kpOfflineFetchedAt?: number | null;
  maxAltitude?: number;
  /** `offline`/`greyOnly` (Teil A): METAR aus dem Offline-Speicher bzw. älter als 2 h. */
  airportMetar?: AirportMetarObservation | null;
  /** Prüfzeitpunkt (ms) für das Alter der Offline-Daten; Standard: jetzt. */
  now?: number;
}

export const WEATHER_WIND_AGED_TEXT_PREFIX = "Wind-/Böendaten älter als 6 h";

/**
 * Teil A: Offline-Daten im Urteil.
 *  - Wetter < 24 h: CAUTION „Wetter – Offline-Daten (Stand …) – vor dem Start
 *    online neu prüfen“; ab 6 h zusätzlich deutlicher Wind-/Böen-Befund (rot,
 *    Bestätigung); ≥ 24 h: wie ohne Wetter (unbekannt) mit „Gerät online
 *    bringen, um das Wetter zu prüfen“.
 *  - Kp < 24 h: CAUTION; ≥ 24 h: unbekannt (Wert wird nicht verwendet).
 *  - METAR < 2 h: CAUTION und wird bewertet; älter: nur Info (grau), nicht bewertet.
 * Befunde, die die Offline-Daten selbst auslösen (Limits), bleiben unverändert streng.
 */
function offlineWeatherAssessment(input: WeatherCheckInput, now: number) {
  const wOff = input.weather?.offline?.cached ? input.weather.offline : null;
  const wState = wOff ? assessOfflineData("weather", wOff.fetchedAt, now) : null;
  const kpAt = input.kpOfflineFetchedAt ?? null;
  const kpState = kpAt != null ? assessOfflineData("kp", kpAt, now) : null;
  const metar = input.airportMetar ?? null;
  const mOff = metar?.offline?.cached ? metar.offline : null;
  const metarGrey = !!metar && (metar.greyOnly === true || (mOff ? !assessOfflineData("metar", mOff.fetchedAt, now).useInVerdict : false));
  return { wOff, wState, kpAt, kpState, metar, mOff, metarGrey };
}

const NEUTRAL_WEATHER = (lat: number, lon: number): WeatherData => ({
  latitude: lat,
  longitude: lon,
  calculationTime: new Date().toISOString(),
  forecasts: [{
    timestamp: new Date().toISOString(),
    temperature: 15, humidity: 50, windSpeed: 0, windGust: 0, windDirection: 0,
    windAtAltitude: [], temperatureAtAltitude: [{ height: 2, value: 15 }],
    humidityAtAltitude: [{ height: 2, value: 50 }], cloudCoverAtAltitude: [],
    rain: 0, snow: 0, cloudCover: 0, pressure: 1013,
  }] as any,
});

/**
 * Wetter-/Wind-/Kp-/METAR-Befunde: assessWeather OHNE Einschränkungs- und
 * Nacht-Anteil (die liefern geozone-/night-Befunde) – Schwellen unverändert.
 * Ohne Wetterdaten: Befund "unknown" (bisher: höchstens CAUTION) plus die
 * wetterunabhängigen Hinweise (z. B. Flughöhe > 120 m).
 */
export function weatherChecks(input: WeatherCheckInput, latitude = 0, longitude = 0): CheckResult[] {
  const { context } = input;
  const now = input.now ?? Date.now();
  const off = offlineWeatherAssessment(input, now);
  const weatherExpired = off.wState?.state === "expired";
  const hasWeather = !weatherExpired && !!input.weather && Array.isArray(input.weather.forecasts) && input.weather.forecasts.length > 0;
  const data = hasWeather ? input.weather! : NEUTRAL_WEATHER(latitude, longitude);
  const kpUsable = off.kpState ? off.kpState.useInVerdict : true;
  const metarForVerdict = off.metarGrey ? null : input.airportMetar;
  const res = assessWeather(
    data,
    input.limits,
    false,
    undefined,
    hasWeather && kpUsable ? input.kpIndex : undefined,
    input.maxAltitude,
    undefined,
    hasWeather ? metarForVerdict : null,
  );
  const out: CheckResult[] = res.warnings.map((w, i) => warningToCheck(w, "weather", `weather:${i}`, context));
  if (!hasWeather) {
    out.unshift(
      weatherExpired
        ? { ...offlineExpiredCheck({ kind: "weather", context, fetchedAt: off.wOff?.fetchedAt, now }), id: "weather:unavailable" }
        : {
            id: "weather:unavailable",
            category: "weather",
            severity: "unknown",
            title: WEATHER_UNKNOWN_TEXT,
            detail: "Ohne Vorhersage kann das Wetter nicht bewertet werden.",
            emphasis: "caution",
            context,
          },
    );
  } else {
    if (off.wOff) {
      out.push(offlineDataCheck({ kind: "weather", fetchedAt: off.wOff.fetchedAt, context, now, detail: `${offlineForecastLabel(off.wOff.fetchedAt, now)} – Gerät offline bzw. Wetterdienst nicht erreichbar.` }));
      if (off.wState?.state === "aged") {
        out.push({
          id: "weather:offline-wind-aged",
          category: "weather",
          severity: "caution",
          title: `${WEATHER_WIND_AGED_TEXT_PREFIX} (Stand ${formatStandTimeDe(off.wOff.fetchedAt, now)}) – Wind und Böen vor dem Start vor Ort bzw. online prüfen`,
          detail: "Wind und Böen ändern sich schnell; die gespeicherte Vorhersage ist dafür zu alt.",
          emphasis: "warning",
          requiresConfirmation: true,
          dataAge: { fetchedAt: new Date(off.wOff.fetchedAt).toISOString(), stale: true, ageMs: Math.max(0, now - off.wOff.fetchedAt) },
          context,
        });
      }
    }
    if (off.kpAt != null && input.kpIndex != null) {
      out.push(kpUsable
        ? offlineDataCheck({ kind: "kp", fetchedAt: off.kpAt, context, now })
        : offlineExpiredCheck({ kind: "kp", context, fetchedAt: off.kpAt, now }));
    }
    if (input.airportMetar && off.metarGrey) {
      const at = off.mOff?.fetchedAt ?? now;
      out.push({
        id: "weather:metar-grey",
        category: "weather",
        severity: "info",
        title: `METAR ${input.airportMetar.icao} älter als 2 h (${offlineStandLabel(at, now)}) – nur zur Information, nicht bewertet`,
        detail: "",
        context,
      });
    } else if (input.airportMetar && off.mOff) {
      out.push(offlineDataCheck({ kind: "metar", fetchedAt: off.mOff.fetchedAt, context, now }));
    }
    if (out.length === 0) {
      out.push({ id: "weather:ok", category: "weather", severity: "info", title: WEATHER_OK_TEXT, detail: "", context });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zonen je Zeitkontext
// ---------------------------------------------------------------------------

export type ZoneLike = RestrictionZoneLike & ZoneAltitudeInput & {
  informationalOnly?: boolean;
  validStartTs?: number | null;
  validEndTs?: number | null;
};

export interface ZoneEvaluationInput<T extends ZoneLike> {
  context: CheckContext;
  timeContext: ZoneTimeContext;
  zones: T[];
  tempZones?: T[];
  isCoveredByAV: (z: T) => boolean;
  isExempted?: (z: T) => boolean;
  overrideOf?: (z: T) => CheckOverride | null | undefined;
  /** Höhenfilter (isZoneReachable mit Gelände). null = kein Filter. */
  reachability?: ReachabilityOptions | null;
  /** Weitere Beschränkungen ohne Zonenliste (aktive DIPUL-Temporäre,
   * Tiefflug, Energie-Infrastruktur …). */
  extraRestrictions?: boolean;
  restrictionStatus?: RestrictionStatusInput;
  /** Alternativ: Status aus der Klassifizierung ableiten (Pre-Check). */
  deriveStatus?: (c: {
    zoneClass: PlanningZoneClassification<T>;
    tempClass: PlanningZoneClassification<T>;
    hasZoneRestrictions: boolean;
  }) => RestrictionStatusInput;
}

export interface ZoneEvaluation<T extends ZoneLike> {
  activeZones: T[];
  inactiveZones: T[];
  hiddenAbove: T[];
  zoneClass: PlanningZoneClassification<T>;
  tempClass: PlanningZoneClassification<T>;
  restrictionVerdict: RestrictionVerdict;
  hasZoneRestrictions: boolean;
  restrictionStatus: RestrictionStatusInput;
  checks: CheckResult[];
}

/**
 * Zonen zur Kontextzeit (zoneActivityAt), optional erreichbar (Höhe/Gelände),
 * über die Policy klassifiziert (AV-Abdeckung, Ausnahmen, Overrides) und als
 * Geozonen-Befunde.
 */
export function evaluateZones<T extends ZoneLike>(input: ZoneEvaluationInput<T>): ZoneEvaluation<T> {
  const active = input.zones.filter((z) => isZoneActiveInContext(z as any, input.timeContext));
  const inactiveZones = input.zones.filter((z) => !active.includes(z));
  let activeZones = active;
  let hiddenAbove: T[] = [];
  if (input.reachability) {
    const part = partitionByReachability(active, input.reachability);
    activeZones = part.visible;
    hiddenAbove = part.hiddenAbove;
  }
  const zoneClass = classifyPlanningZones(activeZones.filter((z) => !z.informationalOnly), {
    isCoveredByAV: input.isCoveredByAV,
    isExempted: input.isExempted,
    overrideReason: (z) => input.overrideOf?.(z)?.reason,
  });
  const tempActive = (input.tempZones ?? []).filter((z) => isZoneActiveInContext(z as any, input.timeContext));
  const tempClass = classifyPlanningZones(tempActive, {
    isCoveredByAV: () => false,
    overrideReason: (z) => input.overrideOf?.(z)?.reason,
  });
  const restrictionVerdict = maxRestrictionVerdict([zoneClass.verdict, tempClass.verdict]);
  // Wie bisher in Planung UND Pre-Check: jede temporäre Beschränkung im
  // Umkreis zählt als Einschränkung (unabhängig vom Zeitpunkt).
  const hasZoneRestrictions =
    zoneClass.coveredZones.length > 0 ||
    zoneClass.uncoveredZones.length > 0 ||
    (input.tempZones?.length ?? 0) > 0 ||
    input.extraRestrictions === true;
  const restrictionStatus = input.deriveStatus
    ? input.deriveStatus({ zoneClass, tempClass, hasZoneRestrictions })
    : input.restrictionStatus;
  const checks = geozoneChecks({
    context: input.context,
    classes: [zoneClass, tempClass],
    overrideOf: input.overrideOf,
    hasRestrictions: hasZoneRestrictions,
    restrictionStatus,
  });
  return { activeZones, inactiveZones, hiddenAbove, zoneClass, tempClass, restrictionVerdict, hasZoneRestrictions, restrictionStatus, checks };
}

// ---------------------------------------------------------------------------
// Gesamtbewertung
// ---------------------------------------------------------------------------

/** In der Session gespeicherte (stufenweise erhobene) Kategorien. Wetter,
 * Nacht und Gegenprüfung werden bei jeder Bewertung neu gebildet. */
export const STORED_CHECK_CATEGORIES: readonly CheckCategory[] = ["geozone", "coverage", "notam", "compliance"];

export interface StoredCheckSource extends LegacyRestrictionInput {
  checkResults?: CheckResult[] | null;
  notamStatusUnknown?: boolean;
}

/**
 * Gespeicherte Befunde eines Kontexts; fehlen Geozonen-/NOTAM-Befunde (Altdaten,
 * Route ohne Session), werden sie aus den bisherigen Feldern abgeleitet.
 */
export function storedChecksFor(src: StoredCheckSource | null | undefined, context: CheckContext): CheckResult[] {
  const stored = checksFor(src?.checkResults, context, STORED_CHECK_CATEGORIES);
  const out = [...stored];
  if (!stored.some((r) => r.category === "geozone")) {
    out.push(...legacyGeozoneChecks(src ?? {}, context));
  }
  if (!stored.some((r) => r.category === "notam") && src?.notamStatusUnknown) {
    out.push(...notamChecks({ context, failed: true, count: null }));
  }
  return out;
}

export interface FlightEvaluationInput {
  context: CheckContext;
  /** Zeitpunkt für die Nachtprüfung (Planung: geplant, Pre-Check: jetzt). */
  at: Date | null | undefined;
  /** Optional: Ende des geplanten Flugfensters (Ende <= Start = Folgetag). */
  until?: Date | null;
  latitude: number;
  longitude: number;
  countryIso?: string | null;
  weather: WeatherData | null | undefined;
  limits: WeatherLimits;
  kpIndex?: number;
  /** Teil A: Kp aus dem Offline-Speicher – Abrufzeit (ms). */
  kpOfflineFetchedAt?: number | null;
  maxAltitude?: number;
  airportMetar?: AirportMetarObservation | null;
  /** Prüfzeitpunkt (ms) für das Alter von Offline-Daten; Standard: jetzt. */
  now?: number;
  /** Gespeicherte Befunde (storedChecksFor). */
  stored: CheckResult[];
  officialMapCrossCheck?: { blocking: boolean; note?: string } | null;
}

export interface FlightEvaluation extends CheckAggregate {
  results: CheckResult[];
}

/** EINE Bewertung für Planung und Pre-Check. */
export function evaluateFlight(input: FlightEvaluationInput): FlightEvaluation {
  const stored = input.stored.filter((r) => STORED_CHECK_CATEGORIES.includes(r.category));
  const results: CheckResult[] = [
    ...stored,
    ...officialMapCrossCheckChecks(input.officialMapCrossCheck, input.context),
    ...nightChecks({
      context: input.context,
      at: input.at,
      until: input.until,
      latitude: input.latitude,
      longitude: input.longitude,
      countryIso: input.countryIso,
    }),
    ...weatherChecks(
      {
        context: input.context,
        weather: input.weather,
        limits: input.limits,
        kpIndex: input.kpIndex,
        kpOfflineFetchedAt: input.kpOfflineFetchedAt,
        maxAltitude: input.maxAltitude,
        airportMetar: input.airportMetar,
        now: input.now,
      },
      input.latitude,
      input.longitude,
    ),
  ];
  return { results, ...aggregate(results) };
}
