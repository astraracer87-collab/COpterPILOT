import { WeatherData } from "@/lib/weather";
import { getKpAssessment } from "@/lib/kpindex";
import { WeatherLimits, AssessmentReason } from "@/lib/storage";
import type { AirportMetarObservation } from "@/lib/aviationWeather";
import { calculateSolarTimes, isTimeDuringDaylight, isTimeDuringCivilTwilight } from "@/lib/solar";
import { detectCountryFromCoordinates } from "@/lib/countryMaps";
import { getNightFlightRule } from "@/lib/countryInfo";
import type { LimitExceedance } from "@/lib/droneRecommendation";
import type { RestrictionVerdict } from "../../shared/restrictionPolicy";
import { RESTRICTION_NOGO_TEXT, RESTRICTION_NOGO_TIP } from "../../shared/checks/builders";

export { RESTRICTION_NOGO_TEXT };

export interface ExpertTip {
  title: string;
  description: string;
  practiceCheck?: string;
}

export interface AssessmentWarning {
  message: string;
  severity: "caution" | "warning";
  expertTip?: ExpertTip;
  /**
   * Gesetzt, wenn der Grund ein konkretes Drohnen-Limit überschreitet
   * (Wind, Böen, Temperatur). Ermöglicht eine Drohnen-Empfehlung auf den
   * Ergebnisschirmen (siehe lib/droneRecommendation.ts).
   */
  exceedance?: LimitExceedance;
  /** Erheblicher Befund (setzt requiresConfirmation). Für die Prüfkette. */
  severe?: boolean;
  /** Befund führt zum NO-GO (Nacht-Verbot, Gewitter, Flugverbotszone). */
  nogo?: boolean;
}

export interface AssessmentResult {
  status: "go" | "caution" | "nogo";
  warnings: AssessmentWarning[];
  reasons: AssessmentReason[];
  requiresConfirmation: boolean;
}

export interface AssessmentContext {
  plannedDateTime?: Date;
  latitude?: number;
  longitude?: number;
  /** Höchstes Policy-Urteil der Einschränkungs-Stufe (shared/restrictionPolicy):
   * "nogo" = aktive, erreichbare Flugverbotszone (PROHIBITED) ohne
   * dokumentierte Begründung → NO-GO. */
  restrictionVerdict?: RestrictionVerdict;
}

/** Land für die Nachtflug-Regel: immer aus dem Standort (Koordinaten), nur
 * wenn dort kein Land erkannt wird, aus dem übergebenen Rückfall (Review I6:
 * Planung und Urteil verwenden dasselbe Land). */
export function nightFlightCountry(lat: number, lon: number, fallbackIso?: string | null): string | null {
  return detectCountryFromCoordinates(lat, lon) ?? (fallbackIso ? fallbackIso.toUpperCase() : null);
}

export interface NightAssessment {
  warnings: AssessmentWarning[];
  reasons: AssessmentReason[];
  isNoGo: boolean;
  requiresConfirmation: boolean;
}

/**
 * Nachtflug-Check (länderspezifisch).
 * Definition: "Nacht" beginnt mit Ende der buergerlichen Daemmerung
 * (Sonne -6 deg unter Horizont). Zwischen Sonnenuntergang und Daemmerungsende
 * -> Karenz/Daemmerung (caution, kein NO-GO).
 */
export function assessNightFlight(
  planTime: Date | undefined | null,
  lat: number | undefined | null,
  lon: number | undefined | null,
  fallbackIso?: string | null,
): NightAssessment {
  const warnings: AssessmentWarning[] = [];
  const reasons: AssessmentReason[] = [];
  let isNoGo = false;
  let severe = false;
  if (planTime && lat != null && lon != null && Number.isFinite(planTime.getTime())) {
    const solar = calculateSolarTimes(lat, lon, planTime);
    const isDay = isTimeDuringDaylight(planTime, solar);
    const isCivilTwilight = isTimeDuringCivilTwilight(planTime, solar);
    const isLegalNight = !isDay && !isCivilTwilight;
    if (!isDay) {
      const iso = nightFlightCountry(lat, lon, fallbackIso);
      const rule = getNightFlightRule(iso);
      const phase = isLegalNight ? "Nacht" : "Dämmerung";
      if (isLegalNight && (rule.status === "forbidden" || rule.status === "permit_required")) {
        warnings.push({
          message: `Nacht-Flug am geplanten Standort: ${rule.shortText}`,
          severity: "warning",
          expertTip: {
            title: rule.shortText,
            description: rule.detail,
            practiceCheck: "Flug auf Tageszeit verschieben (vor Sonnenuntergang bzw. nach Sonnenaufgang) oder die erforderliche Sonderfreigabe einholen. Definition: \"Nacht\" beginnt mit Ende der buergerlichen Daemmerung (Sonne -6 deg).",
          },
          severe: true,
          nogo: true,
        });
        reasons.push({ type: "caution", message: rule.shortText });
        severe = true;
        isNoGo = true;
      } else if (rule.status === "forbidden" || rule.status === "permit_required") {
        // Daemmerung in eigentlich verbotenem Land -> CAUTION (Karenz)
        warnings.push({
          message: `${phase}-Flug geplant — am Rand der Tageszeit (Karenz)`,
          severity: "caution",
          expertTip: {
            title: "Dämmerung als Karenzzone",
            description: `${rule.detail} Aktuell liegt die geplante Zeit innerhalb der bürgerlichen Dämmerung (Sonne zwischen 0° und -6°) — der Flug wird hier noch nicht als formaler Nachtflug gewertet, du solltest aber zügig handeln und vor Ende der Dämmerung gelandet sein.`,
            practiceCheck: "Lande spätestens am Ende der bürgerlichen Dämmerung. Bei Unsicherheit Flug auf Tageszeit verschieben.",
          },
        });
        reasons.push({ type: "caution", message: `${phase} — Karenzzone` });
      } else if (rule.status === "allowed_with_lights") {
        warnings.push({
          message: `${phase}-Flug geplant — ${rule.shortText}`,
          severity: "caution",
          expertTip: {
            title: rule.shortText,
            description: rule.detail,
            practiceCheck: "Grünes Blinklicht an der Drohne anbringen und vor dem Start auf einwandfreie Funktion prüfen.",
          },
        });
        reasons.push({ type: "caution", message: rule.shortText });
      } else {
        warnings.push({
          message: `${phase}-Flug geplant — ${rule.shortText}`,
          severity: "caution",
        });
        reasons.push({ type: "caution", message: rule.shortText });
      }
    }
  }
  return { warnings, reasons, isNoGo, requiresConfirmation: severe };
}

function calculateDewPoint(temperature: number, humidity: number): number {
  const a = 17.27;
  const b = 237.7;
  const alpha = ((a * temperature) / (b + temperature)) + Math.log(humidity / 100);
  return (b * alpha) / (a - alpha);
}

export function assessIcingRisk(
  temperature: number,
  humidity: number
): { level: "none" | "warning" | "high"; message?: string; expertTip?: ExpertTip } {
  const dewPoint = calculateDewPoint(temperature, humidity);
  const tempDewDiff = temperature - dewPoint;

  if (temperature < 5 && tempDewDiff < 3) {
    return {
      level: "high",
      message: `Akute Vereisungsgefahr: Temperatur ${temperature.toFixed(1)}°C, Taupunkt ${dewPoint.toFixed(1)}°C`,
      expertTip: {
        title: "Vereisungs-Prävention",
        description: "Behandle die Propellerkanten hauchdünn mit Silikonspray oder säurefreiem Öl. Dies wirkt wasserabweisend und verhindert, dass gefrierende Luftfeuchtigkeit haften bleibt.",
        practiceCheck: "Lande nach 2 Min. kurz und fühle die Propellerkanten. Sind sie rau/weißlich? Sofortiger Flugabbruch!",
      },
    };
  }

  if (temperature < 0 && humidity > 70) {
    return {
      level: "high",
      message: `Vereisungsgefahr: Temperatur ${temperature.toFixed(1)}°C unter dem Gefrierpunkt bei hoher Luftfeuchtigkeit`,
      expertTip: {
        title: "Propeller-Check",
        description: "Bei Minusgraden und hoher Luftfeuchtigkeit kann sich Eis an den Rotorkanten bilden.",
        practiceCheck: "Prüfe die Propeller vor und während des Fluges auf Eisansatz.",
      },
    };
  }

  if (temperature <= 5 && humidity >= 80) {
    return {
      level: "warning",
      message: `Vereisungsrisiko möglich: Temperatur ${temperature.toFixed(1)}°C, Luftfeuchtigkeit ${humidity.toFixed(0)}%`,
    };
  }

  if (temperature <= 5 && tempDewDiff <= 3) {
    return {
      level: "warning",
      message: `Erhöhtes Vereisungsrisiko: Temperatur nahe am Taupunkt (${dewPoint.toFixed(1)}°C)`,
    };
  }

  return { level: "none" };
}

export function assessWindShear(
  windGround: number,
  windAltitude: number,
  droneMaxWind: number
): { hasShear: boolean; message?: string; expertTip?: ExpertTip } {
  if (windAltitude > windGround * 2 || windAltitude > droneMaxWind) {
    return {
      hasShear: true,
      message: `Windscherung erkannt: Boden ${windGround.toFixed(1)} m/s, Höhe ${windAltitude.toFixed(1)} m/s`,
      expertTip: {
        title: "Windscherung & Rückflug-Sicherheit",
        description: "Bodenwind täuscht! In der Höhe herrscht möglicherweise Sturmgefahr.",
        practiceCheck: "Steige langsam auf 10-20m. Reagiert die Drohne träge? Prüfe ob die Drohne gegen den Wind zurückkommt. Nutze notfalls den Sportmodus. Wenn die Drohne kaum noch Fahrt über Grund macht → Sofort Landung einleiten!",
      },
    };
  }
  return { hasShear: false };
}

export function assessWeather(
  weather: WeatherData,
  limits: WeatherLimits,
  hasRestrictions: boolean,
  restrictionStatus?: "approved" | "limited",
  kpIndex?: number,
  maxAltitude?: number,
  context?: AssessmentContext,
  airportMetar?: AirportMetarObservation | null
): AssessmentResult {
  const warnings: AssessmentWarning[] = [];
  const reasons: AssessmentReason[] = [];
  let hasSevereWarning = false;
  let isNoGo = false;

  // Erheblichen bzw. NO-GO-Befund am zuletzt hinzugefügten Warnhinweis
  // markieren (Prüfkette: CheckResult.requiresConfirmation / nogo).
  const markSevere = () => {
    hasSevereWarning = true;
    const w = warnings[warnings.length - 1];
    if (w) w.severe = true;
  };
  const markNoGo = () => {
    isNoGo = true;
    const w = warnings[warnings.length - 1];
    if (w) w.nogo = true;
  };

  // Nachtflug-Check (länderspezifisch), siehe assessNightFlight.
  const night = assessNightFlight(context?.plannedDateTime, context?.latitude, context?.longitude);
  warnings.push(...night.warnings);
  reasons.push(...night.reasons);
  if (night.requiresConfirmation) hasSevereWarning = true;
  if (night.isNoGo) isNoGo = true;

  const current = weather.forecasts[0];
  const upcomingForecasts = weather.forecasts.slice(0, 9);

  // Policy-Urteil der Einschränkungs-Stufe: Flugverbot (PROHIBITED) ohne
  // dokumentierte Begründung ist ein NO-GO – unabhängig von einer allgemeinen
  // "Genehmigung liegt vor"-Angabe (ein Verbot ist nicht durch AV/Genehmigung
  // abdeckbar, nur mit Begründung überschreibbar).
  if (context?.restrictionVerdict === "nogo") {
    warnings.push({
      message: RESTRICTION_NOGO_TEXT,
      severity: "warning",
      expertTip: RESTRICTION_NOGO_TIP,
    });
    reasons.push({ type: "nogo", message: RESTRICTION_NOGO_TEXT });
    markSevere();
    markNoGo();
  }

  if (hasRestrictions) {
    if (restrictionStatus === "approved") {
      reasons.push({
        type: "go",
        message: "Einschränkungen vorhanden - Genehmigung liegt vor",
      });
    } else if (restrictionStatus === "limited") {
      warnings.push({
        message: "Flug mit Einschränkungen - bitte Auflagen beachten",
        severity: "caution",
        expertTip: {
          title: "Flug mit Einschränkungen",
          description: "Am Standort gelten Geozonen-Auflagen (z. B. Höhenbegrenzung, Zeitfenster oder Genehmigungspflicht). Der Flug ist möglich, aber an Bedingungen geknüpft.",
          practiceCheck: "Prüfe die konkreten Auflagen der betroffenen Geozone und halte Genehmigungen/Aktenzeichen bereit. Notiere sie im Schritt „Einschränkungen“ für die Dokumentation.",
        },
      });
      reasons.push({
        type: "caution",
        message: "Flug mit Einschränkungen - bitte Auflagen beachten",
      });
    } else {
      warnings.push({
        message: "Geozonen-Einschränkungen am Standort festgestellt",
        severity: "caution",
        expertTip: {
          title: "Geozonen-Einschränkungen",
          description: "Am Standort wurden Geozonen erkannt, deren Status noch nicht abschließend geklärt ist. Ein Flug kann je nach Zone genehmigungspflichtig oder verboten sein.",
          practiceCheck: "Kläre vor dem Flug den genauen Status der Geozone (dipul/Karte) und hole bei Bedarf die nötige Freigabe ein.",
        },
      });
      reasons.push({
        type: "caution",
        message: "Geozonen-Einschränkungen am Standort festgestellt",
      });
    }
  }

  const icingRisk = assessIcingRisk(current.temperature, current.humidity);
  if (icingRisk.level === "high") {
    warnings.push({
      message: icingRisk.message!,
      severity: "warning",
      expertTip: icingRisk.expertTip,
    });
    reasons.push({
      type: "caution",
      message: icingRisk.message!,
    });
    markSevere();
  } else if (icingRisk.level === "warning") {
    warnings.push({
      message: icingRisk.message!,
      severity: "caution",
      expertTip: {
        title: "Vereisungsrisiko",
        description: "Bei niedrigen Temperaturen und hoher Luftfeuchtigkeit kann sich Eis an den Propellerkanten bilden. Das stört den Auftrieb und kann zum Kontrollverlust führen.",
        practiceCheck: "Behandle die Propellerkanten dünn mit Silikonspray. Lande nach 1–2 Minuten kurz und prüfe die Rotorblätter auf raue/weißliche Stellen.",
      },
    });
    reasons.push({
      type: "caution",
      message: icingRisk.message!,
    });
  }

  if (kpIndex != null && kpIndex >= 3) {
    const kpAssessment = getKpAssessment(kpIndex);
    const possibleDisruption = kpIndex >= 5;
    warnings.push({
      message: possibleDisruption
        ? `Kp ${kpIndex.toFixed(1)}: GNSS-/Kompassstörungen können auftreten, müssen aber nicht`
        : `Erhöhte geomagnetische Aktivität (Kp ${kpIndex.toFixed(1)})`,
      severity: kpIndex >= 6 ? "warning" : "caution",
      expertTip: {
        title: possibleDisruption ? "Mögliche GNSS-/Kompassstörungen" : "Erhöhte geomagnetische Aktivität",
        description: kpAssessment.description,
        practiceCheck: "Prüfe vor dem Start die GNSS- und Kompassanzeigen direkt in der Drohnen-App. Der Kp-Index ist global und bestätigt keine Störung am konkreten Standort.",
      },
    });
    reasons.push({
      type: "caution",
      message: `Geomagnetische Aktivität (Kp ${kpIndex.toFixed(1)})`,
    });
  }

  if (current.windSpeed > limits.maxWind) {
    const windTip: ExpertTip = {
      title: "Wind-Check",
      description: "Die Windgeschwindigkeit übersteigt die Spezifikationen deiner Drohne.",
      practiceCheck: "Teste erst auf niedriger Höhe ob die Drohne stabil gegen den Wind fliegen kann. Behalte genug Akku für den Rückflug gegen den Wind!",
    };
    warnings.push({
      message: `Windgeschwindigkeit ${current.windSpeed.toFixed(1)} m/s überschreitet Drohnen-Limit von ${limits.maxWind} m/s`,
      severity: "warning",
      expertTip: windTip,
      exceedance: { kind: "wind", value: current.windSpeed, limit: limits.maxWind },
    });
    reasons.push({
      type: "caution",
      message: `Windgeschwindigkeit ${current.windSpeed.toFixed(1)} m/s überschreitet Limit`,
    });
    markSevere();
  } else if (current.windSpeed > limits.maxWind * 0.8) {
    warnings.push({
      message: `Windgeschwindigkeit ${current.windSpeed.toFixed(1)} m/s nahe am Limit von ${limits.maxWind} m/s`,
      severity: "caution",
      expertTip: {
        title: "Wind nahe am Limit",
        description: `Der Bodenwind liegt mit ${current.windSpeed.toFixed(1)} m/s knapp unter dem Windlimit deiner Drohne (${limits.maxWind} m/s). In Böen oder in der Höhe kann er das Limit bereits überschreiten.`,
        practiceCheck: "Teste auf niedriger Höhe, ob die Drohne stabil gegen den Wind steht. Plane genug Akkureserve für den Rückflug gegen den Wind ein.",
      },
    });
    reasons.push({
      type: "caution",
      message: `Windgeschwindigkeit nahe am Limit`,
    });
  }

  if (current.windGust && current.windGust > limits.maxGusts) {
    const gustTip: ExpertTip = {
      title: "Böen-Warnung",
      description: "Starke Böen können die Drohne plötzlich versetzen und die Kontrolle erschweren.",
      practiceCheck: "Fliege mit erhöhtem Sicherheitsabstand zu Hindernissen und halte die Drohne immer im Blick. Bei instabilem Flugverhalten sofort landen!",
    };
    warnings.push({
      message: `Böen ${current.windGust.toFixed(1)} m/s überschreiten Drohnen-Limit von ${limits.maxGusts} m/s`,
      severity: "warning",
      expertTip: gustTip,
      exceedance: { kind: "gusts", value: current.windGust, limit: limits.maxGusts },
    });
    reasons.push({
      type: "caution",
      message: `Böen ${current.windGust.toFixed(1)} m/s überschreiten Limit`,
    });
    markSevere();
  } else if (current.windGust && current.windGust > limits.maxGusts * 0.8) {
    warnings.push({
      message: `Böen ${current.windGust.toFixed(1)} m/s nahe am Limit von ${limits.maxGusts} m/s`,
      severity: "caution",
      expertTip: {
        title: "Böen nahe am Limit",
        description: `Die Böen liegen mit ${current.windGust.toFixed(1)} m/s knapp unter dem Böenlimit deiner Drohne (${limits.maxGusts} m/s). Böen treffen die Drohne stoßartig und können sie kurzzeitig versetzen.`,
        practiceCheck: "Halte größeren Sicherheitsabstand zu Hindernissen und Menschen. Bei ruckartigem Flugverhalten Höhe reduzieren oder landen.",
      },
    });
    reasons.push({
      type: "caution",
      message: `Böen nahe am Limit`,
    });
  }

  if (current.rain > limits.maxRain) {
    const rainTip: ExpertTip = {
      title: "Niederschlag",
      description: "Regen kann die Elektronik und Kameras beschädigen. Die meisten Consumer-Drohnen sind nicht wasserdicht.",
      practiceCheck: "Prüfe ob deine Drohne für Regen zugelassen ist. Im Zweifel den Flug verschieben.",
    };
    warnings.push({
      message: `Niederschlag ${current.rain.toFixed(2)} mm/h überschreitet Limit von ${limits.maxRain} mm/h`,
      severity: "warning",
      expertTip: rainTip,
    });
    reasons.push({
      type: "caution",
      message: `Niederschlag überschreitet Limit`,
    });
    markSevere();
  } else if (current.rain > 0) {
    warnings.push({
      message: `Leichter Niederschlag (${current.rain.toFixed(2)} mm/h)`,
      severity: "caution",
      expertTip: {
        title: "Leichter Niederschlag",
        description: "Auch leichter Regen kann in Motoren, Kamera und Elektronik eindringen. Die meisten Consumer-Drohnen sind nicht wasserdicht.",
        practiceCheck: "Halte die Drohne trocken, prüfe nach der Landung Gimbal und Sensoren auf Feuchtigkeit. Bei zunehmendem Regen Flug abbrechen.",
      },
    });
    reasons.push({
      type: "caution",
      message: `Leichter Niederschlag`,
    });
  }

  if (current.temperature < limits.minTemp) {
    const tempTip: ExpertTip = {
      title: "Kälte-Warnung",
      description: "Bei niedrigen Temperaturen sinkt die Akkuleistung drastisch. Weniger Flugzeit und plötzlicher Spannungsabfall möglich.",
      practiceCheck: "Wärme die Akkus vor dem Flug auf. Plane kürzere Flüge ein und behalte die Akkuspannung genau im Blick.",
    };
    warnings.push({
      message: `Temperatur ${current.temperature.toFixed(1)}°C unterschreitet Minimum von ${limits.minTemp}°C`,
      severity: "warning",
      expertTip: tempTip,
      exceedance: { kind: "temp", value: current.temperature, limit: limits.minTemp },
    });
    reasons.push({
      type: "caution",
      message: `Temperatur zu niedrig für optimale Akkuleistung`,
    });
    markSevere();
  } else if (current.temperature < limits.minTemp + 5) {
    warnings.push({
      message: `Temperatur ${current.temperature.toFixed(1)}°C nahe am Minimum von ${limits.minTemp}°C`,
      severity: "caution",
      expertTip: {
        title: "Temperatur nahe am Minimum",
        description: `Mit ${current.temperature.toFixed(1)}°C liegst du nur knapp über dem Temperatur-Minimum deiner Drohne (${limits.minTemp}°C). Kälte senkt die Akkuleistung und damit Flugzeit und Reserve.`,
        practiceCheck: "Wärme die Akkus vor dem Flug auf und plane kürzere Flüge. Beobachte die Akkuspannung genauer als üblich.",
      },
    });
    reasons.push({
      type: "caution",
      message: `Temperatur nahe am Minimum`,
    });
  }

  if (limits.maxTemp != null && current.temperature > limits.maxTemp) {
    const heatTip: ExpertTip = {
      title: "Hitze-Warnung",
      description: "Bei hohen Temperaturen drohen Überhitzung von Motoren und Akku, Leistungsabfall und im Extremfall Notabschaltung.",
      practiceCheck: "Halte Drohne und Akkus vor dem Start im Schatten. Plane kürzere Flüge und beobachte die Akku-Temperatur genau.",
    };
    warnings.push({
      message: `Temperatur ${current.temperature.toFixed(1)}°C überschreitet Maximum von ${limits.maxTemp}°C`,
      severity: "warning",
      expertTip: heatTip,
      exceedance: { kind: "tempMax", value: current.temperature, limit: limits.maxTemp },
    });
    reasons.push({
      type: "caution",
      message: `Temperatur zu hoch für sicheren Betrieb`,
    });
    markSevere();
  } else if (limits.maxTemp != null && current.temperature > limits.maxTemp - 5) {
    warnings.push({
      message: `Temperatur ${current.temperature.toFixed(1)}°C nahe am Maximum von ${limits.maxTemp}°C`,
      severity: "caution",
      expertTip: {
        title: "Temperatur nahe am Maximum",
        description: `Mit ${current.temperature.toFixed(1)}°C liegst du nur knapp unter dem Temperatur-Maximum deiner Drohne (${limits.maxTemp}°C). Hitze belastet Motoren und Akku.`,
        practiceCheck: "Halte Drohne und Akkus im Schatten und plane kürzere Flüge. Beobachte die Akku-Temperatur genauer als üblich.",
      },
    });
    reasons.push({
      type: "caution",
      message: `Temperatur nahe am Maximum`,
    });
  }

  if (current.cloudCeiling && current.cloudCeiling < limits.minCloudCeiling) {
    const cloudTip: ExpertTip = {
      title: "Wolkenuntergrenze (VLOS)",
      description: `Wolkenuntergrenze bei ${current.cloudCeiling}m. Sichtflug (VLOS) gefährdet.`,
      practiceCheck: `Fliege heute maximal auf ${Math.max(0, current.cloudCeiling - 20)}m, um nicht in die Wolken zu geraten.`,
    };
    warnings.push({
      message: `Wolkenuntergrenze ${current.cloudCeiling}m unter Minimum von ${limits.minCloudCeiling}m`,
      severity: "warning",
      expertTip: cloudTip,
    });
    reasons.push({
      type: "caution",
      message: `Wolkenuntergrenze zu niedrig für VLOS`,
    });
    markSevere();
  }

  if (current.visibility && current.visibility < limits.minVisibility) {
    const visTip: ExpertTip = {
      title: "Eingeschränkte Sicht",
      description: `Aktuelle Sichtweite nur ${current.visibility}m. Sichtflug (VLOS) kaum möglich.`,
      practiceCheck: "Halte die Drohne in unmittelbarer Nähe. Fliege nicht weiter als du sehen kannst!",
    };
    warnings.push({
      message: `Sichtweite ${current.visibility}m unter Minimum von ${limits.minVisibility}m`,
      severity: "warning",
      expertTip: visTip,
    });
    reasons.push({
      type: "caution",
      message: `Sichtweite zu gering für VLOS`,
    });
    markSevere();
  }

  if (airportMetar) {
    const a = airportMetar;
    const distTxt = a.distanceKm < 1 ? "<1 km" : `${a.distanceKm.toFixed(0)} km`;
    const where = `Flugplatz ${a.name} (${a.icao}, ${distTxt})`;
    const obsTxt = "Diese Werte stammen aus einer offiziellen Flugplatz-Beobachtung (METAR) in der Nähe deines Startorts und können von der Punktvorhersage abweichen.";

    if (a.hasThunderstorm) {
      warnings.push({
        message: `${where}: Gewitter gemeldet (METAR)${a.phenomenaText ? ` — ${a.phenomenaText}` : ""}`,
        severity: "warning",
        expertTip: {
          title: "Gewitter in der Umgebung",
          description: `${obsTxt} Gewitter bedeuten extreme Böen, Abwinde, Hagel und Blitzschlaggefahr — ein sicherer Drohnenbetrieb ist nicht möglich.`,
          practiceCheck: "Nicht starten. Warte mindestens 30 Minuten nach dem letzten Donner und bis die Gewitterzelle sicher abgezogen ist.",
        },
      });
      reasons.push({ type: "caution", message: `Gewitter am ${where}` });
      markSevere();
      markNoGo();
    }

    if (a.windGustMs != null && a.windGustMs > limits.maxGusts) {
      warnings.push({
        message: `${where}: gemeldete Böen ${a.windGustMs.toFixed(1)} m/s überschreiten Drohnen-Limit (${limits.maxGusts} m/s)`,
        severity: "warning",
        expertTip: {
          title: "Böen am Flugplatz",
          description: `${obsTxt} Die gemessenen Böen liegen über dem Limit deiner Drohne.`,
          practiceCheck: "Fliege mit erhöhtem Sicherheitsabstand und behalte genug Akku für den Rückflug. Bei instabilem Flugverhalten sofort landen.",
        },
        exceedance: { kind: "gusts", value: a.windGustMs, limit: limits.maxGusts },
      });
      reasons.push({ type: "caution", message: `Böen am ${where} über Limit` });
      markSevere();
    } else if (a.windGustMs != null && a.windGustMs > limits.maxGusts * 0.8) {
      warnings.push({
        message: `${where}: gemeldete Böen ${a.windGustMs.toFixed(1)} m/s nahe am Limit (${limits.maxGusts} m/s)`,
        severity: "caution",
      });
      reasons.push({ type: "caution", message: `Böen am ${where} nahe am Limit` });
    }

    if (a.windSpeedMs != null && a.windSpeedMs > limits.maxWind) {
      warnings.push({
        message: `${where}: gemeldeter Wind ${a.windSpeedMs.toFixed(1)} m/s überschreitet Drohnen-Limit (${limits.maxWind} m/s)`,
        severity: "warning",
        expertTip: {
          title: "Wind am Flugplatz",
          description: `${obsTxt} Der gemessene Bodenwind liegt über dem Limit deiner Drohne.`,
          practiceCheck: "Teste erst auf niedriger Höhe, ob die Drohne stabil gegen den Wind fliegt. Behalte genug Akku für den Rückflug gegen den Wind.",
        },
        exceedance: { kind: "wind", value: a.windSpeedMs, limit: limits.maxWind },
      });
      reasons.push({ type: "caution", message: `Wind am ${where} über Limit` });
      markSevere();
    } else if (a.windSpeedMs != null && a.windSpeedMs > limits.maxWind * 0.8) {
      warnings.push({
        message: `${where}: gemeldeter Wind ${a.windSpeedMs.toFixed(1)} m/s nahe am Limit (${limits.maxWind} m/s)`,
        severity: "caution",
      });
      reasons.push({ type: "caution", message: `Wind am ${where} nahe am Limit` });
    }

    if (a.visibilityM != null && a.visibilityM < limits.minVisibility) {
      warnings.push({
        message: `${where}: gemeldete Sicht ${a.visibilityM} m unter Minimum (${limits.minVisibility} m)`,
        severity: "warning",
        expertTip: {
          title: "Eingeschränkte Sicht am Flugplatz",
          description: `${obsTxt} Bei der gemeldeten Sichtweite ist ein sicherer Sichtflug (VLOS) kaum möglich.`,
          practiceCheck: "Halte die Drohne in unmittelbarer Nähe. Fliege nicht weiter, als du sie eindeutig sehen kannst.",
        },
      });
      reasons.push({ type: "caution", message: `Sicht am ${where} zu gering` });
      markSevere();
    }

    if (a.ceilingFt != null) {
      const ceilingM = Math.round(a.ceilingFt * 0.3048);
      if (ceilingM < limits.minCloudCeiling) {
        warnings.push({
          message: `${where}: gemeldete Wolkenuntergrenze ${ceilingM} m (${a.ceilingFt} ft) unter Minimum (${limits.minCloudCeiling} m)`,
          severity: "warning",
          expertTip: {
            title: "Niedrige Wolken am Flugplatz",
            description: `${obsTxt} Die gemeldete Hauptwolkenuntergrenze liegt unter deinem Minimum — VLOS ist gefährdet.`,
            practiceCheck: `Reduziere die Flughöhe deutlich (max. ca. ${Math.max(0, ceilingM - 20)} m) oder warte auf bessere Sichtverhältnisse.`,
          },
        });
        reasons.push({ type: "caution", message: `Wolkenuntergrenze am ${where} zu niedrig` });
        markSevere();
      }
    }

    if (a.hasFreezing) {
      warnings.push({
        message: `${where}: gefrierender Niederschlag gemeldet${a.phenomenaText ? ` (${a.phenomenaText})` : ""}`,
        severity: "caution",
        expertTip: {
          title: "Gefrierender Niederschlag",
          description: `${obsTxt} Gefrierender Niederschlag führt zu schnellem Eisansatz an Propellern und Rumpf.`,
          practiceCheck: "Flug verschieben. Eisansatz an den Rotorblättern kann innerhalb von Sekunden zum Kontrollverlust führen.",
        },
      });
      reasons.push({ type: "caution", message: `Gefrierender Niederschlag am ${where}` });
    }
  }

  if (maxAltitude != null && maxAltitude > 0) {
    const altHeights = [50, 100, 150, 200, 250];
    const relevantHeights = altHeights.filter(h => h <= maxAltitude + 50);

    const currentForecasts = weather.forecasts[0];
    if (currentForecasts) {
      const windAtAlt = (currentForecasts as any).windAtAltitude;
      if (windAtAlt && Array.isArray(windAtAlt)) {
        const groundWind = windAtAlt.find((w: any) => w.height === 10) || { speed: currentForecasts.windSpeed };

        let worstWindHeight = 0;
        let worstWindSpeed = 0;
        let worstGustHeight = 0;
        let worstGustValue = 0;
        for (const h of relevantHeights) {
          const w = windAtAlt.find((entry: any) => entry.height === h);
          if (w) {
            if (w.speed > worstWindSpeed) {
              worstWindSpeed = w.speed;
              worstWindHeight = h;
            }
            const gust = w.gust || 0;
            if (gust > worstGustValue) {
              worstGustValue = gust;
              worstGustHeight = h;
            }
          }
        }

        if (worstWindHeight > 0 && worstWindSpeed > limits.maxWind) {
          warnings.push({
            message: `Wind auf ${worstWindHeight}m Höhe: ${worstWindSpeed.toFixed(1)} m/s überschreitet Drohnen-Limit (${limits.maxWind} m/s)`,
            severity: "warning",
            expertTip: {
              title: "Wind in Flughöhe",
              description: `Auf ${worstWindHeight}m ist der Wind mit ${worstWindSpeed.toFixed(1)} m/s am stärksten (geplante Flughöhe: ${maxAltitude}m). Die Drohne benötigt mehr Energie und kann instabil werden.`,
              practiceCheck: "Starte erst auf niedriger Höhe und steige langsam auf. Wenn die Drohne ab einer bestimmten Höhe instabil wird, fliege nicht höher. Behalte genug Akku für den Rückflug.",
            },
            exceedance: { kind: "wind", value: worstWindSpeed, limit: limits.maxWind, height: worstWindHeight },
          });
          reasons.push({ type: "caution", message: `Starker Wind auf ${worstWindHeight}m Flughöhe` });
          markSevere();
        } else if (worstWindHeight > 0 && worstWindSpeed > limits.maxWind * 0.75) {
          warnings.push({
            message: `Wind auf ${worstWindHeight}m Höhe: ${worstWindSpeed.toFixed(1)} m/s nahe am Drohnen-Limit (${limits.maxWind} m/s)`,
            severity: "caution",
          });
          reasons.push({ type: "caution", message: `Wind auf ${worstWindHeight}m nahe am Limit` });
        }

        if (worstGustHeight > 0 && worstGustValue > limits.maxGusts) {
          warnings.push({
            message: `Böen auf ${worstGustHeight}m Höhe: ${worstGustValue.toFixed(1)} m/s überschreiten Drohnen-Limit (${limits.maxGusts} m/s)`,
            severity: "warning",
            expertTip: {
              title: "Böen in Flughöhe",
              description: `Auf ${worstGustHeight}m sind Böen mit ${worstGustValue.toFixed(1)} m/s am stärksten im Höhenprofil bis ${maxAltitude}m.`,
              practiceCheck: "Fliege mit erhöhtem Sicherheitsabstand zu Hindernissen. Bei instabilem Flugverhalten sofort die Höhe reduzieren!",
            },
            exceedance: { kind: "gusts", value: worstGustValue, limit: limits.maxGusts, height: worstGustHeight },
          });
          reasons.push({ type: "caution", message: `Starke Böen auf ${worstGustHeight}m Flughöhe` });
          markSevere();
        }

        const topHeight = relevantHeights.length > 0 ? relevantHeights[relevantHeights.length - 1] : altHeights[0];
        const topWind = windAtAlt.find((w: any) => w.height === topHeight);
        if (topWind && groundWind && topWind.speed > groundWind.speed * 1.5 && topWind.speed > 5) {
          const shearTip: ExpertTip = {
            title: "Windscherung",
            description: `Der Wind nimmt von ${groundWind.speed.toFixed(1)} m/s am Boden auf ${topWind.speed.toFixed(1)} m/s auf ${topHeight}m deutlich zu. Windscherung kann zu plötzlichem Kontrollverlust führen.`,
            practiceCheck: "Steige langsam auf und beobachte das Flugverhalten genau. Bei starken Turbulenzen sofort die Höhe reduzieren.",
          };
          warnings.push({
            message: `Windscherung: ${groundWind.speed.toFixed(1)} m/s (Boden) → ${topWind.speed.toFixed(1)} m/s (${topHeight}m)`,
            severity: "caution",
            expertTip: shearTip,
            exceedance: topWind.speed > limits.maxWind
              ? { kind: "wind", value: topWind.speed, limit: limits.maxWind, height: topHeight }
              : undefined,
          });
        }
      }

      const tempAtAlt = (currentForecasts as any).temperatureAtAltitude;
      if (tempAtAlt && Array.isArray(tempAtAlt)) {
        let worstTempHeight = 0;
        let worstTempValue = Infinity;
        for (const h of relevantHeights) {
          const t = tempAtAlt.find((entry: any) => entry.height === h);
          if (t && t.value < worstTempValue) {
            worstTempValue = t.value;
            worstTempHeight = h;
          }
        }
        if (worstTempHeight > 0 && worstTempValue < limits.minTemp) {
          warnings.push({
            message: `Temperatur auf ${worstTempHeight}m Höhe: ${worstTempValue.toFixed(1)}°C unter Minimum (${limits.minTemp}°C)`,
            severity: "warning",
            expertTip: {
              title: "Kälte in Flughöhe",
              description: `Auf ${worstTempHeight}m ist es ${worstTempValue.toFixed(1)}°C — deutlich kälter als am Boden. Akku-Leistung sinkt schneller.`,
              practiceCheck: "Wärme die Akkus vor dem Flug auf und plane kürzere Flugzeiten ein. Beobachte die Akkuspannung genauer als üblich.",
            },
            exceedance: { kind: "temp", value: worstTempValue, limit: limits.minTemp, height: worstTempHeight },
          });
          reasons.push({ type: "caution", message: `Zu kalt auf ${worstTempHeight}m Flughöhe` });
          markSevere();
        }
      }
    }

    if (maxAltitude > 120) {
      warnings.push({
        message: `Geplante Flughöhe ${maxAltitude}m überschreitet 120m-Grenze (Genehmigung erforderlich)`,
        severity: "caution",
        expertTip: {
          title: "Höhenbegrenzung",
          description: "Gemäß EU-Drohnenverordnung (SERA.3145) ist ohne Genehmigung eine maximale Flughöhe von 120m AGL erlaubt.",
          practiceCheck: "Stelle sicher, dass du eine gültige Genehmigung für die geplante Flughöhe hast, oder fliege in einer dafür zugelassenen Geozone.",
        },
      });
    }

    if (current.cloudCeiling && maxAltitude >= current.cloudCeiling - 30) {
      warnings.push({
        message: `Wolkenuntergrenze bei ${current.cloudCeiling}m — Flughöhe ${maxAltitude}m gefährdet VLOS`,
        severity: "warning",
        expertTip: {
          title: "Wolken in Flughöhe",
          description: `Die Wolkenuntergrenze liegt bei ca. ${current.cloudCeiling}m. Bei deiner geplanten Flughöhe von ${maxAltitude}m könntest du die Drohne aus den Augen verlieren.`,
          practiceCheck: `Reduziere die Flughöhe auf max. ${Math.max(0, current.cloudCeiling - 50)}m oder warte auf bessere Sichtverhältnisse.`,
        },
      });
      markSevere();
    }
  }

  const worsenReasons: string[] = [];
  let maxWindAhead = 0;
  let maxGustAhead = 0;
  let maxRainAhead = 0;
  upcomingForecasts.forEach((f) => {
    if (f.windSpeed > maxWindAhead) maxWindAhead = f.windSpeed;
    if (f.windGust && f.windGust > maxGustAhead) maxGustAhead = f.windGust;
    if (f.rain > maxRainAhead) maxRainAhead = f.rain;
  });
  if (maxWindAhead > limits.maxWind) {
    worsenReasons.push(`Wind bis ${maxWindAhead.toFixed(1)} m/s (Limit ${limits.maxWind} m/s)`);
  }
  if (maxGustAhead > limits.maxGusts) {
    worsenReasons.push(`Böen bis ${maxGustAhead.toFixed(1)} m/s (Limit ${limits.maxGusts} m/s)`);
  }
  if (maxRainAhead > limits.maxRain) {
    worsenReasons.push(`Regen bis ${maxRainAhead.toFixed(1)} mm/h (Limit ${limits.maxRain} mm/h)`);
  }

  if (worsenReasons.length > 0) {
    const detail = worsenReasons.join(", ");
    warnings.push({
      message: `Wetterverschlechterung in den nächsten 2 Stunden: ${detail}`,
      severity: "caution",
      expertTip: {
        title: "Wetterverschlechterung erwartet",
        description: `Die Vorhersage zeigt eine Verschlechterung innerhalb der nächsten 2 Stunden: ${detail}. Was beim Start noch passt, kann während des Fluges das Limit überschreiten.`,
        practiceCheck: "Plane kürzere Flüge, behalte die Zeit im Blick und lande rechtzeitig, bevor sich die Bedingungen verschlechtern.",
      },
    });
    reasons.push({
      type: "caution",
      message: `Wetterverschlechterung: ${detail}`,
    });
  }

  const upcomingIcing = upcomingForecasts.some((f) => {
    const risk = assessIcingRisk(f.temperature, f.humidity);
    return risk.level === "high";
  });

  if (upcomingIcing) {
    warnings.push({
      message: "Vereisungsgefahr in den nächsten 2 Stunden möglich",
      severity: "caution",
      expertTip: {
        title: "Vereisungsgefahr erwartet",
        description: "Die Vorhersage deutet auf Bedingungen hin, unter denen sich innerhalb der nächsten 2 Stunden Eis an den Propellern bilden kann (niedrige Temperatur, hohe Feuchtigkeit).",
        practiceCheck: "Behalte Temperatur und Taupunkt im Blick, halte Flüge kurz und prüfe die Propeller nach kurzen Testflügen auf Eisansatz.",
      },
    });
    reasons.push({
      type: "caution",
      message: "Vereisungsgefahr erwartet",
    });
  }

  if (reasons.length === 0) {
    reasons.push({
      type: "go",
      message: "Alle Wetterbedingungen innerhalb der Limits",
    });
  }

  const status: "go" | "caution" | "nogo" = isNoGo
    ? "nogo"
    : warnings.length > 0
      ? "caution"
      : "go";

  return {
    status,
    warnings,
    reasons,
    requiresConfirmation: hasSevereWarning,
  };
}
