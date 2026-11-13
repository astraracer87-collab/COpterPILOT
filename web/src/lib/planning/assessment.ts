import type {
  AssessmentReason,
  RestrictionStatus,
  WeatherLimits,
  WeatherSnapshot,
} from "./types";
import type { ForecastHour } from "./weather";

export type AssessmentWarning = {
  message: string;
  severity: "caution" | "warning";
};

export type AssessmentResult = {
  status: "go" | "caution" | "nogo";
  warnings: AssessmentWarning[];
  reasons: AssessmentReason[];
};

function dewPoint(t: number, rh: number): number {
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * t) / (b + t) + Math.log(Math.max(1, rh) / 100);
  return (b * alpha) / (a - alpha);
}

export function assessPlanning(
  weather: WeatherSnapshot,
  limits: WeatherLimits,
  opts: {
    hasRestrictions: boolean;
    restrictionStatus: RestrictionStatus;
    maxAltitude: number;
    upcomingHours: ForecastHour[];
  },
): AssessmentResult {
  const warnings: AssessmentWarning[] = [];
  const reasons: AssessmentReason[] = [];
  let severe = false;

  // Restrictions
  if (opts.hasRestrictions) {
    if (opts.restrictionStatus === "approved") {
      reasons.push({ type: "go", message: "Einschränkungen vorhanden — Genehmigung liegt vor" });
    } else if (opts.restrictionStatus === "limited") {
      warnings.push({ message: "Flug mit Einschränkungen — bitte Auflagen beachten", severity: "caution" });
      reasons.push({ type: "caution", message: "Flug mit Einschränkungen" });
    } else {
      warnings.push({ message: "Geozonen-Einschränkungen am Standort — keine Genehmigung", severity: "warning" });
      reasons.push({ type: "nogo", message: "Geozonen-Einschränkung ohne Genehmigung" });
      severe = true;
    }
  }

  // Wind
  if (weather.windSpeed > limits.maxWind) {
    warnings.push({
      message: `Wind ${weather.windSpeed.toFixed(1)} m/s überschreitet Drohnen-Limit (${limits.maxWind} m/s)`,
      severity: "warning",
    });
    reasons.push({ type: "caution", message: "Windgeschwindigkeit über Limit" });
    severe = true;
  } else if (weather.windSpeed > limits.maxWind * 0.8) {
    warnings.push({
      message: `Wind ${weather.windSpeed.toFixed(1)} m/s nahe am Limit (${limits.maxWind} m/s)`,
      severity: "caution",
    });
    reasons.push({ type: "caution", message: "Windgeschwindigkeit nahe am Limit" });
  }

  // Gusts
  if (weather.windGust && weather.windGust > limits.maxGusts) {
    warnings.push({
      message: `Böen ${weather.windGust.toFixed(1)} m/s überschreiten Limit (${limits.maxGusts} m/s)`,
      severity: "warning",
    });
    reasons.push({ type: "caution", message: "Böen über Limit" });
    severe = true;
  } else if (weather.windGust && weather.windGust > limits.maxGusts * 0.8) {
    warnings.push({ message: `Böen ${weather.windGust.toFixed(1)} m/s nahe am Limit`, severity: "caution" });
  }

  // Rain
  if (weather.rain > limits.maxRain) {
    warnings.push({ message: `Niederschlag ${weather.rain.toFixed(2)} mm/h über Limit`, severity: "warning" });
    reasons.push({ type: "caution", message: "Niederschlag über Limit" });
    severe = true;
  } else if (weather.rain > 0) {
    warnings.push({ message: `Leichter Niederschlag (${weather.rain.toFixed(2)} mm/h)`, severity: "caution" });
  }

  // Temperature
  if (weather.temperature < limits.minTemp) {
    warnings.push({
      message: `Temperatur ${weather.temperature.toFixed(1)}°C unter Minimum (${limits.minTemp}°C)`,
      severity: "warning",
    });
    reasons.push({ type: "caution", message: "Temperatur zu niedrig" });
    severe = true;
  } else if (weather.temperature < limits.minTemp + 5) {
    warnings.push({
      message: `Temperatur ${weather.temperature.toFixed(1)}°C nahe Minimum (${limits.minTemp}°C)`,
      severity: "caution",
    });
  }

  // Icing risk
  const dp = dewPoint(weather.temperature, weather.humidity);
  if (weather.temperature < 5 && weather.temperature - dp < 3) {
    warnings.push({
      message: `Vereisungsgefahr: ${weather.temperature.toFixed(1)}°C nahe Taupunkt ${dp.toFixed(1)}°C`,
      severity: "warning",
    });
    reasons.push({ type: "caution", message: "Vereisungsgefahr" });
    severe = true;
  }

  // Altitude
  if (opts.maxAltitude > 120) {
    warnings.push({
      message: `Geplante Flughöhe ${opts.maxAltitude} m überschreitet 120-m-Grenze (Genehmigung erforderlich)`,
      severity: "caution",
    });
    reasons.push({ type: "caution", message: "Flughöhe über 120 m" });
  }

  // Upcoming worsening
  const willWorsen = opts.upcomingHours.some(
    (f) =>
      f.windSpeed > limits.maxWind ||
      f.windGust > limits.maxGusts ||
      f.rain > limits.maxRain,
  );
  if (willWorsen) {
    warnings.push({ message: "Wetterverschlechterung in den nächsten Stunden erwartet", severity: "caution" });
    reasons.push({ type: "caution", message: "Wetterverschlechterung erwartet" });
  }

  if (reasons.length === 0) {
    reasons.push({ type: "go", message: "Alle Bedingungen innerhalb der Limits" });
  }

  let status: "go" | "caution" | "nogo" = "go";
  if (reasons.some((r) => r.type === "nogo")) status = "nogo";
  else if (warnings.length > 0 || severe) status = "caution";

  return { status, warnings, reasons };
}

export const STATUS_LABELS: Record<"go" | "caution" | "nogo", string> = {
  go: "GO",
  caution: "CAUTION",
  nogo: "NO-GO",
};

export const STATUS_COLORS: Record<"go" | "caution" | "nogo", string> = {
  go: "bg-emerald-500",
  caution: "bg-amber-500",
  nogo: "bg-red-600",
};
