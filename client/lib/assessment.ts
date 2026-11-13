import { WeatherData } from "@/lib/weather";
import { WeatherLimits, AssessmentReason } from "@/lib/storage";

export interface ExpertTip {
  title: string;
  description: string;
  practiceCheck?: string;
}

export interface AssessmentWarning {
  message: string;
  severity: "caution" | "warning";
  expertTip?: ExpertTip;
}

export interface AssessmentResult {
  status: "go" | "caution";
  warnings: AssessmentWarning[];
  reasons: AssessmentReason[];
  requiresConfirmation: boolean;
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
  maxAltitude?: number
): AssessmentResult {
  const warnings: AssessmentWarning[] = [];
  const reasons: AssessmentReason[] = [];
  let hasSevereWarning = false;

  const current = weather.forecasts[0];
  const upcomingForecasts = weather.forecasts.slice(0, 9);

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
      });
      reasons.push({
        type: "caution",
        message: "Flug mit Einschränkungen - bitte Auflagen beachten",
      });
    } else {
      warnings.push({
        message: "Geozonen-Einschränkungen am Standort festgestellt",
        severity: "caution",
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
    hasSevereWarning = true;
  } else if (icingRisk.level === "warning") {
    warnings.push({
      message: icingRisk.message!,
      severity: "caution",
    });
    reasons.push({
      type: "caution",
      message: icingRisk.message!,
    });
  }

  if (kpIndex != null && kpIndex >= 6) {
    const kpTip: ExpertTip = {
      title: "Geomagnetischer Sturm",
      description: "Bei hoher geomagnetischer Aktivität (Kp >= 6) können GPS-Signale und der Kompass der Drohne erheblich gestört sein.",
      practiceCheck: "Überprüfe die GPS-Signalstärke und Satellitenanzahl vor dem Start. Fliege nur in Sichtweite und vermeide autonome Flugmodi (Waypoints, RTH über große Distanz).",
    };
    warnings.push({
      message: `Geomagnetischer Sturm (Kp ${kpIndex.toFixed(1)}) - GPS/Kompass stark beeinträchtigt`,
      severity: "warning",
      expertTip: kpTip,
    });
    reasons.push({
      type: "caution",
      message: `Geomagnetischer Sturm (Kp ${kpIndex.toFixed(1)}) - GPS-Genauigkeit reduziert`,
    });
    hasSevereWarning = true;
  } else if (kpIndex != null && kpIndex >= 4) {
    warnings.push({
      message: `Erhöhte geomagnetische Aktivität (Kp ${kpIndex.toFixed(1)}) - GPS-Genauigkeit kann beeinträchtigt sein`,
      severity: "caution",
    });
    reasons.push({
      type: "caution",
      message: `Erhöhte geomagnetische Aktivität (Kp ${kpIndex.toFixed(1)})`,
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
    });
    reasons.push({
      type: "caution",
      message: `Windgeschwindigkeit ${current.windSpeed.toFixed(1)} m/s überschreitet Limit`,
    });
    hasSevereWarning = true;
  } else if (current.windSpeed > limits.maxWind * 0.8) {
    warnings.push({
      message: `Windgeschwindigkeit ${current.windSpeed.toFixed(1)} m/s nahe am Limit von ${limits.maxWind} m/s`,
      severity: "caution",
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
    });
    reasons.push({
      type: "caution",
      message: `Böen ${current.windGust.toFixed(1)} m/s überschreiten Limit`,
    });
    hasSevereWarning = true;
  } else if (current.windGust && current.windGust > limits.maxGusts * 0.8) {
    warnings.push({
      message: `Böen ${current.windGust.toFixed(1)} m/s nahe am Limit von ${limits.maxGusts} m/s`,
      severity: "caution",
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
    hasSevereWarning = true;
  } else if (current.rain > 0) {
    warnings.push({
      message: `Leichter Niederschlag (${current.rain.toFixed(2)} mm/h)`,
      severity: "caution",
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
    });
    reasons.push({
      type: "caution",
      message: `Temperatur zu niedrig für optimale Akkuleistung`,
    });
    hasSevereWarning = true;
  } else if (current.temperature < limits.minTemp + 5) {
    warnings.push({
      message: `Temperatur ${current.temperature.toFixed(1)}°C nahe am Minimum von ${limits.minTemp}°C`,
      severity: "caution",
    });
    reasons.push({
      type: "caution",
      message: `Temperatur nahe am Minimum`,
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
    hasSevereWarning = true;
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
    hasSevereWarning = true;
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
          });
          reasons.push({ type: "caution", message: `Starker Wind auf ${worstWindHeight}m Flughöhe` });
          hasSevereWarning = true;
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
          });
          reasons.push({ type: "caution", message: `Starke Böen auf ${worstGustHeight}m Flughöhe` });
          hasSevereWarning = true;
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
          });
          reasons.push({ type: "caution", message: `Zu kalt auf ${worstTempHeight}m Flughöhe` });
          hasSevereWarning = true;
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
      hasSevereWarning = true;
    }
  }

  const willWorsen = upcomingForecasts.some((f) => {
    return (
      f.windSpeed > limits.maxWind ||
      (f.windGust && f.windGust > limits.maxGusts) ||
      f.rain > limits.maxRain
    );
  });

  if (willWorsen) {
    warnings.push({
      message: "Wetterverschlechterung in den nächsten 2 Stunden erwartet",
      severity: "caution",
    });
    reasons.push({
      type: "caution",
      message: "Wetterverschlechterung erwartet",
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

  const status: "go" | "caution" = warnings.length > 0 ? "caution" : "go";

  return {
    status,
    warnings,
    reasons,
    requiresConfirmation: hasSevereWarning,
  };
}
