/**
 * Drohnen-Empfehlung für limit-basierte NO-GO-/Hinweis-Gründe.
 *
 * Reine, React-Native-freie Logik (nur Typen importiert), damit sie unter dem
 * tsx-Test-Runner ausführbar bleibt. Die Funktion prüft den gespeicherten
 * Drohnen-Bestand des Piloten gegen einen überschrittenen Grenzwert (Wind, Böen
 * oder Temperatur) und liefert entweder die am besten passende eigene Drohne
 * oder einen generischen Bedarfs-Hinweis.
 */

export type LimitKind = "wind" | "gusts" | "temp" | "tempMax";

export interface LimitExceedance {
  /** Welche Grenze wurde überschritten. */
  kind: LimitKind;
  /** Beobachteter Wert (m/s bei Wind/Böen, °C bei Temperatur). */
  value: number;
  /** Limit der aktuell geplanten Drohne, das überschritten wurde. */
  limit: number;
  /** Optionale Höhe in Metern, falls der Wert aus dem Höhenprofil stammt. */
  height?: number;
}

/** Minimaler Drohnen-Typ, der für die Empfehlung benötigt wird. */
export interface RecommendDroneLike {
  id: string;
  name: string;
  limits: {
    maxWind: number;
    maxGusts: number;
    minTemp: number;
    maxTemp?: number;
  };
}

export interface DroneRecommendation {
  /** true = eine passende Drohne aus dem Bestand gefunden. */
  hasMatch: boolean;
  droneId?: string;
  droneName?: string;
  /** Fertig formatierter, deutscher Empfehlungstext (ohne Emojis). */
  message: string;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function limitForKind(drone: RecommendDroneLike, kind: LimitKind): number {
  switch (kind) {
    case "wind":
      return drone.limits.maxWind;
    case "gusts":
      return drone.limits.maxGusts;
    case "temp":
      return drone.limits.minTemp;
    case "tempMax":
      return drone.limits.maxTemp ?? Infinity;
  }
}

function satisfies(drone: RecommendDroneLike, exceedance: LimitExceedance): boolean {
  if (exceedance.kind === "temp") {
    // Niedrigeres Temperatur-Minimum = verträgt mehr Kälte.
    return drone.limits.minTemp <= exceedance.value;
  }
  if (exceedance.kind === "tempMax") {
    // Höheres Temperatur-Maximum = verträgt mehr Hitze. Drohnen ohne
    // hinterlegtes Maximum können nicht garantiert werden -> nicht passend.
    return drone.limits.maxTemp != null && drone.limits.maxTemp >= exceedance.value;
  }
  return limitForKind(drone, exceedance.kind) >= exceedance.value;
}

/**
 * Bestimmt für einen überschrittenen Grenzwert die am besten passende eigene
 * Drohne. Gibt es keine, wird ein generischer Bedarfs-Hinweis zurückgegeben.
 *
 * @param exceedance    Der überschrittene Grenzwert (aus der Bewertung).
 * @param drones        Bestand des Piloten (aktive Drohnen).
 * @param currentDroneId Die aktuell geplante Drohne (wird ausgeschlossen).
 */
export function recommendDroneForExceedance(
  exceedance: LimitExceedance,
  drones: RecommendDroneLike[],
  currentDroneId?: string,
): DroneRecommendation {
  const heightTxt = exceedance.height ? ` auf ${exceedance.height} m Höhe` : "";

  const candidates = drones.filter(
    (d) => d.id !== currentDroneId && satisfies(d, exceedance),
  );

  if (candidates.length > 0) {
    // "Am besten passend": bei Wind/Böen die Drohne mit dem höchsten Limit
    // (meiste Reserve), bei Temperatur die mit dem niedrigsten Minimum.
    const best = candidates.reduce((a, b) => {
      if (exceedance.kind === "temp") {
        return b.limits.minTemp < a.limits.minTemp ? b : a;
      }
      return limitForKind(b, exceedance.kind) > limitForKind(a, exceedance.kind) ? b : a;
    });
    const bestLimit = limitForKind(best, exceedance.kind);

    let message: string;
    if (exceedance.kind === "wind") {
      message = `Mit deiner ${best.name} (Windlimit ${fmt(bestLimit)} m/s) wäre der Wind${heightTxt} von ${fmt(exceedance.value)} m/s im Limit.`;
    } else if (exceedance.kind === "gusts") {
      message = `Mit deiner ${best.name} (Böenlimit ${fmt(bestLimit)} m/s) wären die Böen${heightTxt} von ${fmt(exceedance.value)} m/s im Limit.`;
    } else if (exceedance.kind === "tempMax") {
      message = `Mit deiner ${best.name} (Temperatur-Maximum ${fmt(bestLimit)} °C) wäre die Temperatur${heightTxt} von ${fmt(exceedance.value)} °C im Limit.`;
    } else {
      message = `Mit deiner ${best.name} (Temperatur-Minimum ${fmt(bestLimit)} °C) wäre die Temperatur${heightTxt} von ${fmt(exceedance.value)} °C im Limit.`;
    }

    return { hasMatch: true, droneId: best.id, droneName: best.name, message };
  }

  let message: string;
  if (exceedance.kind === "wind") {
    message = `Keine deiner Drohnen ist für ${fmt(exceedance.value)} m/s Wind${heightTxt} ausgelegt. Du bräuchtest eine Drohne mit höherem Windlimit (mind. ${Math.ceil(exceedance.value)} m/s).`;
  } else if (exceedance.kind === "gusts") {
    message = `Keine deiner Drohnen ist für Böen von ${fmt(exceedance.value)} m/s${heightTxt} ausgelegt. Du bräuchtest eine Drohne mit höherem Böenlimit (mind. ${Math.ceil(exceedance.value)} m/s).`;
  } else if (exceedance.kind === "tempMax") {
    message = `Keine deiner Drohnen ist für ${fmt(exceedance.value)} °C${heightTxt} ausgelegt. Du bräuchtest eine Drohne mit höherem Temperatur-Maximum (mind. ${Math.ceil(exceedance.value)} °C).`;
  } else {
    message = `Keine deiner Drohnen ist für ${fmt(exceedance.value)} °C${heightTxt} ausgelegt. Du bräuchtest eine Drohne mit niedrigerem Temperatur-Minimum (höchstens ${Math.floor(exceedance.value)} °C).`;
  }

  return { hasMatch: false, message };
}
