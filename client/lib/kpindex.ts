export interface KpIndexData {
  value: number;
  timestamp: string;
  level: "ruhig" | "leicht_unruhig" | "unruhig" | "Sturm" | "starker_Sturm";
  color: string;
  description: string;
}

const KP_API_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
const KP_FORECAST_API_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";

export async function fetchKpIndex(): Promise<KpIndexData> {
  const response = await fetch(KP_API_URL);

  if (!response.ok) {
    throw new Error(`KP-Index API Fehler: ${response.status}`);
  }

  const data: any[] = await response.json();
  if (!data || data.length === 0) {
    throw new Error("Keine KP-Index Daten verfügbar");
  }

  const latest = data[data.length - 1];
  const kpValue = typeof latest === "object" && latest !== null
    ? parseFloat(latest.Kp ?? latest.kp ?? latest[1])
    : Array.isArray(latest) ? parseFloat(latest[1]) : NaN;
  const timestamp = typeof latest === "object" && latest !== null
    ? (latest.time_tag || latest[0] || "")
    : Array.isArray(latest) ? latest[0] : "";

  if (isNaN(kpValue)) {
    throw new Error("Keine KP-Index Daten verfügbar");
  }

  return {
    value: kpValue,
    timestamp,
    ...getKpAssessment(kpValue),
  };
}

function getKpAssessment(kp: number): { level: KpIndexData["level"]; color: string; description: string } {
  if (kp < 3) {
    return {
      level: "ruhig",
      color: "#34C759",
      description: "Ruhige geomagnetische Bedingungen. Keine Auswirkungen auf GPS/Kompass erwartet.",
    };
  }
  if (kp < 4) {
    return {
      level: "leicht_unruhig",
      color: "#FFD60A",
      description: "Leicht unruhige Bedingungen. GPS/Kompass können minimal beeinträchtigt sein.",
    };
  }
  if (kp < 6) {
    return {
      level: "unruhig",
      color: "#FF9500",
      description: "Unruhige geomagnetische Bedingungen. GPS-Genauigkeit und Kompass können beeinträchtigt sein.",
    };
  }
  if (kp < 8) {
    return {
      level: "Sturm",
      color: "#FF3B30",
      description: "Geomagnetischer Sturm! GPS und Kompass stark beeinträchtigt. Flug nicht empfohlen.",
    };
  }
  return {
    level: "starker_Sturm",
    color: "#AF52DE",
    description: "Starker geomagnetischer Sturm! GPS-Ausfall möglich. Drohnenflug vermeiden!",
  };
}

export function getKpLabel(kp: number): string {
  if (kp < 3) return "Ruhig";
  if (kp < 4) return "Leicht unruhig";
  if (kp < 6) return "Unruhig";
  if (kp < 8) return "Sturm";
  return "Starker Sturm";
}

export interface KpTimeEntry {
  timestamp: string;
  value: number;
}

export async function fetchKpTimeline(): Promise<KpTimeEntry[]> {
  const response = await fetch(KP_FORECAST_API_URL);
  if (!response.ok) throw new Error(`KP-Forecast API Fehler: ${response.status}`);
  const data: any[] = await response.json();
  const results: KpTimeEntry[] = [];
  for (const row of data) {
    let ts: string;
    let val: number;
    if (typeof row === "object" && row !== null && !Array.isArray(row)) {
      ts = row.time_tag || "";
      val = parseFloat(row.kp ?? row.Kp);
    } else if (Array.isArray(row)) {
      if (row[0] === "time_tag" || row[0] === "model_prediction_time") continue;
      ts = row[0];
      val = parseFloat(row[1]);
    } else {
      continue;
    }
    if (!ts || isNaN(val)) continue;
    if (!ts.endsWith("Z")) ts = ts.replace(" ", "T") + "Z";
    results.push({ timestamp: ts, value: val });
  }
  return results;
}

export function getKpForHour(timeline: KpTimeEntry[], targetDate: Date): number | null {
  if (timeline.length === 0) return null;
  let best: KpTimeEntry | null = null;
  let bestDiff = Infinity;
  const targetMs = targetDate.getTime();
  for (const entry of timeline) {
    const entryMs = new Date(entry.timestamp).getTime();
    if (isNaN(entryMs)) continue;
    const diff = Math.abs(entryMs - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  return best?.value ?? null;
}
