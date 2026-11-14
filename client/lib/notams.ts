import { getCached, setCache, makeCacheKey } from "@/lib/dataCache";
import { getFirForPosition } from "@/lib/firDetection";
import { isOfflineNow } from "@/lib/network";
import { getOfflinePackNotams } from "@/lib/offlineStore";
import { detectCountryFromCoordinates } from "../../shared/countryDetection";

async function offlineNotamsFor(lat: number, lon: number): Promise<NotamData[] | null> {
  const iso = detectCountryFromCoordinates(lat, lon);
  if (!iso) return null;
  const stored = await getOfflinePackNotams(iso);
  if (stored && stored.length) return stored as NotamData[];
  return null;
}

const AUTOROUTER_URL = "https://api.autorouter.aero/v1.0/notam";
const GARMIN_SCALE = 90 / (1 << 30);

export interface NotamData {
  id: number;
  series: string;
  number: number;
  year?: number;
  type?: string;
  itema: string[];
  itemd?: string | null;
  iteme: string;
  itemf?: string | null;
  itemg?: string | null;
  code23?: string;
  code45?: string;
  startvalidity: number;
  endvalidity: number;
  estimation?: string | null;
  fir?: string;
  lat?: number;
  lon?: number;
  lower?: number;
  upper?: number;
  radius?: number;
  scope?: string;
  purpose?: string;
  traffic?: string;
  nof?: string;
  referrednumber?: number;
  referredseries?: string;
  referredyear?: number;
}

export interface NotamResponse {
  total: number;
  rows: NotamData[];
}

const DRONE_RELEVANT_KEYWORDS = [
  "DRONE", "UAS", "UAV", "RPAS", "UNMANNED",
  "ED-R", "ED-D", "ED-P",
  "TRA ", "PJE",
  "OBST", "OBSTACLE", "CRANE", "KRAN",
  "CTR", "RMZ", "TMZ",
  "SFC", "GND",
  "CLSD", "PROHIBITED", "RESTRICTED",
  "BALLOON", "BALLON", "PARACHU",
  "LASER", "FIREWORK", "FEUERWERK",
  "SHOOTING", "MILITARY", "MIL ",
  "BLASTING", "DEMOLITION",
];

export function garminToDeg(garmin: number): number {
  return garmin * GARMIN_SCALE;
}

function isGarminCoord(val: number): boolean {
  return Math.abs(val) > 1000000;
}

export function getNotamCountryLabel(notam: NotamData): string {
  const fir = (notam.fir || "").toUpperCase().trim();
  const locations = (notam.itema || []).map((l: string) => l.toUpperCase().trim());
  const firstLoc = locations[0] || "";

  if (fir.startsWith("LS") || fir === "LSAS") return "CH";
  if (locations.some((l: string) => l.startsWith("LS"))) return "CH";

  if (fir === "ELLX") return "LU";
  if (locations.some((l: string) => l.startsWith("EL"))) return "LU";

  if (fir === "EHAA" || fir.startsWith("EH")) return "NL";
  if (locations.some((l: string) => l.startsWith("EH"))) return "NL";

  if (fir.startsWith("LF")) return "FR";
  if (locations.some((l: string) => l.startsWith("LF"))) return "FR";

  if (fir === "EBBU" || fir.startsWith("EB")) return "BE";
  if (locations.some((l: string) => l.startsWith("EB"))) return "BE";

  if (fir === "LOVV" || fir.startsWith("LO")) return "AT";
  if (locations.some((l: string) => l.startsWith("LO"))) return "AT";

  if (fir.startsWith("ED") || firstLoc.startsWith("ED")) return "DE";

  return "DE";
}

const COUNTRY_LABELS: Record<string, string> = {
  DE: "Deutschland",
  CH: "Schweiz",
  LU: "Luxemburg",
  NL: "Niederlande",
  FR: "Frankreich",
  BE: "Belgien",
  AT: "Österreich",
};

export function getCountryLabel(iso: string): string {
  return COUNTRY_LABELS[iso] || iso;
}

function getNearbyAirportCodes(lat: number, lon: number): string[] {
  const airports: { icao: string; lat: number; lon: number }[] = [
    { icao: "EDDF", lat: 50.0333, lon: 8.5706 },
    { icao: "EDDM", lat: 48.3538, lon: 11.7861 },
    { icao: "EDDB", lat: 52.3667, lon: 13.5033 },
    { icao: "EDDH", lat: 53.6304, lon: 9.9882 },
    { icao: "EDDK", lat: 50.8659, lon: 7.1427 },
    { icao: "EDDS", lat: 48.6899, lon: 9.2220 },
    { icao: "EDDL", lat: 51.2895, lon: 6.7668 },
    { icao: "EDDN", lat: 49.4987, lon: 11.0669 },
    { icao: "EDDP", lat: 51.4324, lon: 12.2416 },
    { icao: "EDDW", lat: 53.0475, lon: 8.7867 },
    { icao: "EDDC", lat: 51.1328, lon: 13.7672 },
    { icao: "EDDV", lat: 52.4611, lon: 9.6850 },
    { icao: "EDDE", lat: 50.9798, lon: 10.9581 },
    { icao: "EDDR", lat: 49.2146, lon: 7.1095 },
    { icao: "EDFH", lat: 49.9487, lon: 7.2639 },
    { icao: "EDFM", lat: 49.4731, lon: 8.5143 },
    { icao: "EDFE", lat: 50.0560, lon: 8.6403 },
    { icao: "EDLW", lat: 51.5183, lon: 7.6122 },
    { icao: "EDLP", lat: 51.6141, lon: 8.6163 },
    { icao: "EDMA", lat: 48.4254, lon: 10.9317 },
    { icao: "EDMO", lat: 48.0811, lon: 11.2831 },
    { icao: "EDNY", lat: 47.6713, lon: 9.5115 },
    { icao: "EDQM", lat: 49.9847, lon: 11.1197 },
    { icao: "EDRY", lat: 49.2088, lon: 7.4003 },
    { icao: "EDTL", lat: 48.0693, lon: 7.8322 },
    { icao: "EDVE", lat: 52.3189, lon: 10.5561 },
    { icao: "EDVK", lat: 51.4083, lon: 9.3836 },
    { icao: "LSZH", lat: 47.4647, lon: 8.5492 },
    { icao: "LSGG", lat: 46.2381, lon: 6.1089 },
    { icao: "LSZB", lat: 46.9114, lon: 7.4972 },
    { icao: "LSZA", lat: 46.0040, lon: 8.9106 },
    { icao: "LFSB", lat: 47.5896, lon: 7.5299 },
    { icao: "LSZR", lat: 47.4853, lon: 9.5608 },
    { icao: "LSZS", lat: 46.5341, lon: 9.8841 },
    { icao: "LSMD", lat: 46.8431, lon: 6.9228 },
    { icao: "LSME", lat: 47.0924, lon: 8.3049 },
    { icao: "ELLX", lat: 49.6233, lon: 6.2044 },
    { icao: "LFAT", lat: 50.5173, lon: 1.6206 },
    { icao: "LFQQ", lat: 50.5619, lon: 3.0894 },
    { icao: "LFOB", lat: 49.4544, lon: 2.1128 },
    { icao: "LFPG", lat: 49.0097, lon: 2.5479 },
    { icao: "LFPO", lat: 48.7233, lon: 2.3794 },
    { icao: "LFST", lat: 48.5383, lon: 7.6282 },
    { icao: "LFRS", lat: 47.1532, lon: -1.6111 },
    { icao: "LFRN", lat: 48.0695, lon: -1.7348 },
    { icao: "LFLL", lat: 45.7256, lon: 5.0811 },
    { icao: "LFBD", lat: 44.8283, lon: -0.7156 },
    { icao: "LFBO", lat: 43.6294, lon: 1.3638 },
    { icao: "LFML", lat: 43.4393, lon: 5.2214 },
    { icao: "LFMN", lat: 43.6584, lon: 7.2159 },
    { icao: "EHAM", lat: 52.3086, lon: 4.7639 },
    { icao: "EHRD", lat: 51.9569, lon: 4.4372 },
    { icao: "EHEH", lat: 51.4501, lon: 5.3745 },
    { icao: "EHTW", lat: 52.2758, lon: 6.8742 },
    { icao: "EHGG", lat: 53.1197, lon: 6.5794 },
    { icao: "EHBK", lat: 50.9117, lon: 5.7706 },
    { icao: "EHLW", lat: 53.2286, lon: 5.7606 },
    { icao: "EBBR", lat: 50.9014, lon: 4.4844 },
    { icao: "EBCI", lat: 50.4592, lon: 4.4538 },
    { icao: "EBLG", lat: 50.6374, lon: 5.4432 },
    { icao: "EBOS", lat: 51.1989, lon: 2.8622 },
    { icao: "EBAW", lat: 51.1894, lon: 4.4603 },
    { icao: "EBKT", lat: 50.8172, lon: 3.2044 },
    { icao: "LOWW", lat: 48.1103, lon: 16.5697 },
    { icao: "LOWG", lat: 46.9911, lon: 15.4396 },
    { icao: "LOWL", lat: 48.2332, lon: 14.1875 },
    { icao: "LOWS", lat: 47.7933, lon: 13.0043 },
    { icao: "LOWI", lat: 47.2602, lon: 11.3439 },
    { icao: "LOWK", lat: 46.6425, lon: 14.3377 },
  ];

  const degToRad = (d: number) => (d * Math.PI) / 180;
  const dist = (
    a: { lat: number; lon: number },
    b: { lat: number; lon: number }
  ) => {
    const R = 6371;
    const dLat = degToRad(b.lat - a.lat);
    const dLon = degToRad(b.lon - a.lon);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(degToRad(a.lat)) *
        Math.cos(degToRad(b.lat)) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };

  return airports
    .map((a) => ({ ...a, dist: dist({ lat, lon }, a) }))
    .filter((a) => a.dist < 80)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5)
    .map((a) => a.icao);
}

export async function fetchNotams(
  lat: number,
  lon: number,
  customIcaos?: string[],
  plannedDateUnix?: number
): Promise<{
  notams: NotamData[];
  total: number;
  queriedCodes: string[];
  error?: string;
}> {
  try {
    if (isOfflineNow()) {
      const offline = await offlineNotamsFor(lat, lon);
      if (offline) {
        return { notams: offline, total: offline.length, queriedCodes: [], error: "Offline (gespeichert)" };
      }
    }
    const fir = getFirForPosition(lat, lon);
    const nearbyAirports = getNearbyAirportCodes(lat, lon);
    const codes =
      customIcaos && customIcaos.length > 0
        ? customIcaos
        : [fir, ...nearbyAirports];

    const uniqueCodes = [...new Set(codes)];
    const itemas = JSON.stringify(uniqueCodes);

    const now = Math.floor(Date.now() / 1000);
    const referenceTime = plannedDateUnix != null ? plannedDateUnix : now;
    const endWindow = Math.max(referenceTime + 86400, now + 86400 * 7);
    const url = `${AUTOROUTER_URL}?itemas=${encodeURIComponent(itemas)}&offset=0&limit=100&startvalidity=0&endvalidity=${endWindow}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return {
        notams: [],
        total: 0,
        queriedCodes: uniqueCodes,
        error: `HTTP ${response.status}`,
      };
    }

    const data: NotamResponse = await response.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];

    for (const row of rows) {
      if (row.lat != null && isGarminCoord(row.lat)) {
        row.lat = garminToDeg(row.lat);
      }
      if (row.lon != null && isGarminCoord(row.lon)) {
        row.lon = garminToDeg(row.lon);
      }
    }

    const activeNotams = rows
      .filter((n) => n.startvalidity <= referenceTime && n.endvalidity > referenceTime)
      .sort((a, b) => {
        const sevA = severityOrder(getNotamSeverity(a));
        const sevB = severityOrder(getNotamSeverity(b));
        if (sevA !== sevB) return sevA - sevB;
        return b.startvalidity - a.startvalidity;
      });

    const result = {
      notams: activeNotams,
      total: data.total,
      queriedCodes: uniqueCodes,
    };
    const ck = makeCacheKey("notams", lat, lon);
    setCache(ck, result).catch(() => {});
    return result;
  } catch (err: any) {
    const offline = await offlineNotamsFor(lat, lon);
    if (offline) {
      return { notams: offline, total: offline.length, queriedCodes: [], error: "Offline (gespeichert)" };
    }
    const ck = makeCacheKey("notams", lat, lon);
    const cached = await getCached<{ notams: NotamData[]; total: number; queriedCodes: string[] }>(ck);
    if (cached) {
      return { ...cached.data, error: err.name === "AbortError" ? "Zeitüberschreitung (Cache)" : (err.message || "Fehler (Cache)") };
    }
    if (err.name === "AbortError") {
      return {
        notams: [],
        total: 0,
        queriedCodes: [],
        error: "Zeitüberschreitung",
      };
    }
    return {
      notams: [],
      total: 0,
      queriedCodes: [],
      error: err.message || "Unbekannter Fehler",
    };
  }
}

function severityOrder(s: "high" | "medium" | "low"): number {
  if (s === "high") return 0;
  if (s === "medium") return 1;
  return 2;
}

export function formatNotamDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNotamDateShort(epoch: number): string {
  const d = new Date(epoch * 1000);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${day}.${mon}. ${h}:${m}`;
}

export function getNotamSeverity(
  notam: NotamData
): "high" | "medium" | "low" {
  const code23 = (notam.code23 || "").toUpperCase();
  const code45 = (notam.code45 || "").toUpperCase();
  const text = (notam.iteme || "").toUpperCase();

  if (code23 === "RA" || code23 === "RR") return "high";
  if (code23 === "RT") return "high";
  if (code23 === "AP" || code23 === "SP") return "high";
  if (code45 === "CC" || code45 === "AH") return "high";

  if (text.includes("ED-P") || text.includes("PROHIBITED")) return "high";
  if (text.includes("ED-R") || text.includes("RESTRICTED")) return "high";
  if (text.includes("ED-D") || text.includes("DANGER AREA")) return "high";
  if (
    text.includes("DRONE") ||
    text.includes("UAS ") ||
    text.includes("UAV") ||
    text.includes("RPAS") ||
    text.includes("UNMANNED")
  )
    return "high";

  if (code23 === "FA" || code23 === "AD") return "medium";
  if (code23 === "OB") return "medium";
  if (text.includes("TRA ") || text.includes("PJE") || text.includes("PARACHU"))
    return "medium";
  if (text.includes("CTR") || text.includes("RMZ") || text.includes("TMZ"))
    return "medium";
  if (
    text.includes("OBST") ||
    text.includes("OBSTACLE") ||
    text.includes("CRANE") ||
    text.includes("KRAN")
  )
    return "medium";
  if (text.includes("BALLOON") || text.includes("BALLON")) return "medium";
  if (
    text.includes("LASER") ||
    text.includes("FIREWORK") ||
    text.includes("FEUERWERK")
  )
    return "medium";

  return "low";
}

export function getNotamTypeLabel(notam: NotamData): string {
  const code23 = (notam.code23 || "").toUpperCase();
  const text = (notam.iteme || "").toUpperCase();

  if (text.includes("ED-R")) return "Flugbeschränkung (ED-R)";
  if (text.includes("ED-D")) return "Gefahrengebiet (ED-D)";
  if (text.includes("ED-P")) return "Sperrgebiet (ED-P)";
  if (text.includes("TRA ")) return "Zeitw. reserv. Luftraum";

  if (code23 === "RA" || code23 === "RR") return "Luftraumbeschränkung";
  if (code23 === "RT") return "Temporäre Beschränkung";
  if (code23 === "AP" || code23 === "SP") return "Sperrgebiet";

  if (text.includes("PJE") || text.includes("PARACHU"))
    return "Fallschirmsprung (PJE)";
  if (
    text.includes("DRONE") ||
    text.includes("UAS ") ||
    text.includes("UAV") ||
    text.includes("UNMANNED")
  )
    return "UAS/Drohne";
  if (text.includes("CTR")) return "Kontrollzone (CTR)";
  if (text.includes("RMZ")) return "Funkpflicht (RMZ)";
  if (text.includes("TMZ")) return "Transponderpflicht (TMZ)";

  if (code23 === "OB") return "Hindernis (OBST)";
  if (
    text.includes("OBST") ||
    text.includes("OBSTACLE") ||
    text.includes("CRANE") ||
    text.includes("KRAN")
  )
    return "Hindernis (OBST)";
  if (text.includes("BALLOON") || text.includes("BALLON"))
    return "Ballonaufstieg";
  if (text.includes("LASER")) return "Laser";
  if (text.includes("FIREWORK") || text.includes("FEUERWERK"))
    return "Feuerwerk";

  if (code23 === "FA" || code23 === "AD") return "Flugplatz (AD)";
  if (code23 === "NA") return "Navigation (NAV)";
  if (code23 === "AE") return "Ausrüstung";
  if (code23 === "AH") return "Hubschrauber";

  if (
    text.includes("WIP") ||
    text.includes("WORK IN PROGRESS") ||
    text.includes("BAUARBEITEN")
  )
    return "Bauarbeiten (WIP)";
  if (text.includes("CLSD") || text.includes("CLOSED"))
    return "Geschlossen (CLSD)";
  if (text.includes("U/S") || text.includes("INOP"))
    return "Außer Betrieb (U/S)";

  return "Allgemein";
}

export function isDroneRelevant(notam: NotamData): boolean {
  const text = (notam.iteme || "").toUpperCase();
  const severity = getNotamSeverity(notam);
  if (severity === "high") return true;

  for (const kw of DRONE_RELEVANT_KEYWORDS) {
    if (text.includes(kw)) return true;
  }

  if (notam.upper != null && notam.upper <= 5) return true;

  if (notam.itemg != null) {
    const g = notam.itemg.toUpperCase();
    if (g.includes("SFC") || g.includes("GND") || g.includes("AGL")) {
      const altMatch = g.match(/(\d+)\s*(FT|M)/);
      if (altMatch) {
        const val = parseInt(altMatch[1], 10);
        const unit = altMatch[2];
        const meters = unit === "FT" ? val * 0.3048 : val;
        if (meters <= 150) return true;
      }
    }
  }

  return false;
}

export function formatFlightLevel(fl: number | undefined | null): string | null {
  if (fl == null) return null;
  if (fl === 0) return "GND/SFC";
  if (fl === 999) return "UNL";
  return `FL${String(fl).padStart(3, "0")}`;
}

export function formatAltitude(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s === "SFC" || s === "GND") return "Boden (SFC/GND)";
  if (s.startsWith("FL"))
    return `Flugfläche ${s.replace("FL", "").trim()}`;
  if (s.includes("FT")) {
    const match = s.match(/(\d+)\s*FT/);
    if (match) {
      const ft = parseInt(match[1], 10);
      const m = Math.round(ft * 0.3048);
      let base = "";
      if (s.includes("AGL")) base = " AGL";
      else if (s.includes("MSL") || s.includes("AMSL")) base = " MSL";
      return `${ft} ft (${m} m)${base}`;
    }
  }
  return s;
}

function flToQLineDigits(fl: number | undefined | null): string {
  if (fl == null || fl === 0) return "000";
  if (fl === 999) return "999";
  return String(fl).padStart(3, "0");
}

export function formatNotamQLine(notam: NotamData): string {
  const code = [notam.code23 || "??", notam.code45 || "??"].join("");
  const parts = [
    notam.fir || "????",
    code,
    (notam.traffic || "IV").trim(),
    (notam.purpose || "NBO").trim(),
    (notam.scope || "A").trim(),
    flToQLineDigits(notam.lower),
    flToQLineDigits(notam.upper),
  ];

  let coordStr = "";
  if (notam.lat != null && notam.lon != null) {
    const latDeg = Math.abs(notam.lat);
    const lonDeg = Math.abs(notam.lon);
    const latDir = notam.lat >= 0 ? "N" : "S";
    const lonDir = notam.lon >= 0 ? "E" : "W";
    const latStr = String(Math.round(latDeg * 100))
      .padStart(4, "0");
    const lonStr = String(Math.round(lonDeg * 100))
      .padStart(5, "0");
    coordStr = `${latStr}${latDir}${lonStr}${lonDir}`;
    if (notam.radius != null && notam.radius > 0) {
      coordStr += String(notam.radius).padStart(3, "0");
    }
  }

  return coordStr
    ? `Q) ${parts.join("/")}/${coordStr}`
    : `Q) ${parts.join("/")}`;
}

export function getTrafficLabel(traffic: string | undefined): string {
  if (!traffic) return "";
  const t = traffic.trim().toUpperCase();
  if (t === "IV" || t === "VI") return "IFR + VFR";
  if (t === "I") return "nur IFR";
  if (t === "V") return "nur VFR";
  return t;
}

export function getScopeLabel(scope: string | undefined): string {
  if (!scope) return "";
  const s = scope.trim().toUpperCase();
  const labels: string[] = [];
  if (s.includes("A")) labels.push("Flugplatz");
  if (s.includes("E")) labels.push("Strecke");
  if (s.includes("W")) labels.push("Navigationswarnung");
  return labels.length > 0 ? labels.join(", ") : s;
}

export function getNotamId(notam: NotamData): string {
  const yr = notam.year
    ? `/${String(notam.year).slice(-2)}`
    : "";
  return `${notam.series}${String(notam.number).padStart(4, "0")}${yr}`;
}
