import { fetchWithTimeout } from "./fetchWithTimeout";

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
  const response = await fetchWithTimeout(KP_API_URL);

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

export function getKpAssessment(kp: number): { level: KpIndexData["level"]; color: string; description: string } {
  if (kp < 3) {
    return {
      level: "ruhig",
      color: "#34C759",
      description: "Ruhige geomagnetische Aktivität. Der Kp-Index allein garantiert jedoch keinen störungsfreien GNSS- oder Kompass-Empfang.",
    };
  }
  if (kp < 5) {
    return {
      level: "leicht_unruhig",
      color: "#FFD60A",
      description: "Erhöhte geomagnetische Aktivität. Mögliche Auswirkungen auf GNSS und Kompass sind nicht sicher und hängen auch von Standort und Gerät ab.",
    };
  }
  if (kp < 6) {
    return {
      level: "unruhig",
      color: "#FF9500",
      description: "Bei Kp 5 können GNSS- und Kompassstörungen auftreten, müssen am Standort aber nicht. Prüfe vor dem Flug die tatsächliche Signalqualität.",
    };
  }
  if (kp < 8) {
    return {
      level: "Sturm",
      color: "#FF3B30",
      description: "Ab Kp 6 sind GNSS- und Kompassstörungen möglich, aber nicht sicher. Die tatsächliche Auswirkung hängt von Standort und Gerät ab; prüfe die Signalqualität vor dem Flug.",
    };
  }
  return {
    level: "starker_Sturm",
    color: "#FF3B30",
    description: "Bei Kp 8 oder höher sind stärkere GNSS- und Kompassstörungen möglich, aber nicht sicher. Prüfe vor dem Flug die tatsächliche Signalqualität direkt an der Drohne.",
  };
}

export function getKpLabel(kp: number): string {
  if (kp < 3) return "Ruhig";
  if (kp < 5) return "Erhöht";
  if (kp < 6) return "Stark erhöht";
  if (kp < 8) return "Sturm";
  return "Starker Sturm";
}

export function getKpRiskLabel(kp: number): string {
  if (kp < 3) return "Ruhig";
  if (kp < 5) return "Erhöht";
  return "Störungen möglich";
}

export interface KpTimeEntry {
  timestamp: string;
  value: number;
}

export async function fetchKpTimeline(): Promise<KpTimeEntry[]> {
  const response = await fetchWithTimeout(KP_FORECAST_API_URL);
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

export function getKpForHour(
  timeline: KpTimeEntry[],
  targetDate: Date,
  maxDistanceMs = Infinity,
): number | null {
  if (timeline.length === 0) return null;
  let best: KpTimeEntry | null = null;
  let bestDiff = Infinity;
  const targetMs = targetDate.getTime();
  if (!Number.isFinite(targetMs)) return null;
  for (const entry of timeline) {
    const entryMs = new Date(entry.timestamp).getTime();
    if (isNaN(entryMs)) continue;
    const diff = Math.abs(entryMs - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  return best && bestDiff <= maxDistanceMs ? best.value : null;
}
