import type { Express, Request, Response } from "express";
import { queryGeozones, queryNotams, getCacheStatus, runDailySync } from "./dataSync";
import { requireAdmin } from "./auth";
import * as fs from "fs";
import * as path from "path";

const LFA_FILE = path.resolve(process.cwd(), "server/data/lfa-de.json");
let lfaCache: { mtimeMs: number; payload: unknown } | null = null;
function loadLfa(): unknown {
  const stat = fs.statSync(LFA_FILE); // wirft ENOENT — vom Caller gefangen
  if (!lfaCache || lfaCache.mtimeMs !== stat.mtimeMs) {
    const txt = fs.readFileSync(LFA_FILE, "utf8");
    lfaCache = { mtimeMs: stat.mtimeMs, payload: JSON.parse(txt) };
  }
  return lfaCache.payload;
}

const DFS_WEATHER_URL = "https://utm-service.dfs.de/api/weather/v1/weather";
const KP_API_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
const KP_FORECAST_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
const AUTOROUTER_URL = "https://api.autorouter.aero/v1.0/notam";
const NOMINATIM = "https://nominatim.openstreetmap.org";
type Cache<T> = Map<string, { ts: number; data: T }>;
const cacheBox = <T,>(): Cache<T> => new Map();

const kpCache: Cache<unknown> = cacheBox();
const kpForecastCache: Cache<unknown> = cacheBox();

const TTL_KP = 5 * 60 * 1000;

async function jsonFetch(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await fetch(url, init);
  let data: unknown = null;
  const text = await r.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: r.ok, status: r.status, data };
}

function num(v: unknown): number {
  const n = parseFloat(String(v));
  return isNaN(n) ? NaN : n;
}

function getCached<T>(c: Cache<T>, key: string, ttl: number): T | null {
  const entry = c.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttl) return null;
  return entry.data;
}
function setCached<T>(c: Cache<T>, key: string, data: T) {
  c.set(key, { ts: Date.now(), data });
}

export function registerProxyRoutes(app: Express) {
  // BrightSky DWD weather (current + 24h)
  app.get("/api/proxy/brightsky", async (req: Request, res: Response) => {
    const lat = num(req.query.lat);
    const lon = num(req.query.lon);
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "lat/lon required" });
    const start = new Date(`${date}T00:00:00Z`);
    const end = new Date(start.getTime() + 48 * 60 * 60 * 1000);
    const lastDate = end.toISOString().slice(0, 10);
    const url =
      `https://api.brightsky.dev/weather?lat=${lat}&lon=${lon}` +
      `&date=${date}T00:00:00&last_date=${lastDate}T00:00:00&tz=Europe/Berlin`;
    try {
      const r = await jsonFetch(url);
      res.status(r.status).json(r.data);
    } catch (e: unknown) {
      res.status(502).json({ error: "BrightSky upstream error", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  // DFS Dipul weather (wind at altitude 80m/100m, etc.)
  app.get("/api/proxy/dipul-weather", async (req: Request, res: Response) => {
    const lat = num(req.query.lat);
    const lon = num(req.query.lon);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "lat/lon required" });

    const now = new Date();
    now.setMinutes(0, 0, 0);
    const timestamps = [now.toISOString()];
    for (let i = 1; i < 6; i++) {
      timestamps.push(new Date(now.getTime() + i * 3600000).toISOString());
    }

    const HEIGHTS = [10, 50, 80, 100, 150, 200];
    const body = {
      positions: [
        {
          latitude: lat,
          longitude: lon,
          forecasts: timestamps,
          qnh: { unit: "Pa" },
          temperature: { unit: "C", heights: [{ reference: "AGL", unit: "m", value: 2 }] },
          wind: { unit: "m/s", heights: HEIGHTS.map((v) => ({ reference: "AGL", unit: "m", value: v })) },
          rainPrecipitation: { unit: "mm" },
          totalCloudCover: { unit: "%" },
        },
      ],
    };
    try {
      const r = await jsonFetch(DFS_WEATHER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      res.status(r.status).json(r.data);
    } catch (e: unknown) {
      res.status(502).json({ error: "Dipul upstream error", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  // KP-Index current
  app.get("/api/proxy/kpindex", async (_req: Request, res: Response) => {
    const cached = getCached(kpCache, "current", TTL_KP);
    if (cached) return res.json(cached);
    try {
      const r = await jsonFetch(KP_API_URL);
      if (r.ok) setCached(kpCache, "current", r.data);
      res.status(r.status).json(r.data);
    } catch (e: unknown) {
      res.status(502).json({ error: "KP upstream error", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  // KP-Index forecast
  app.get("/api/proxy/kpindex/forecast", async (_req: Request, res: Response) => {
    const cached = getCached(kpForecastCache, "fc", TTL_KP);
    if (cached) return res.json(cached);
    try {
      const r = await jsonFetch(KP_FORECAST_URL);
      if (r.ok) setCached(kpForecastCache, "fc", r.data);
      res.status(r.status).json(r.data);
    } catch (e: unknown) {
      res.status(502).json({ error: "KP forecast upstream error", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  // ---------- Cached datasets (täglicher Server-Sync) ----------
  app.get("/api/cached/status", async (_req: Request, res: Response) => {
    try {
      res.json({ datasets: await getCacheStatus() });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/cached/geozones", async (req: Request, res: Response) => {
    const country = req.query.country ? String(req.query.country).toLowerCase() : undefined;
    const bboxStr = req.query.bbox ? String(req.query.bbox) : "";
    let bbox: [number, number, number, number] | undefined;
    if (bboxStr) {
      const parts = bboxStr.split(",").map(num);
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        bbox = parts as [number, number, number, number];
      }
    }
    try {
      const data = await queryGeozones({ country, bbox });
      res.json({ countries: data });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/cached/notams", async (req: Request, res: Response) => {
    const country = req.query.country ? String(req.query.country).toLowerCase() : undefined;
    const bboxStr = req.query.bbox ? String(req.query.bbox) : "";
    let bbox: [number, number, number, number] | undefined;
    if (bboxStr) {
      const parts = bboxStr.split(",").map(num);
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        bbox = parts as [number, number, number, number];
      }
    } else if (req.query.lat && req.query.lon) {
      const lat = num(req.query.lat);
      const lon = num(req.query.lon);
      const radius = num(req.query.radius || "100"); // km
      if (!isNaN(lat) && !isNaN(lon)) {
        const dLat = radius / 111;
        const dLon = radius / (111 * Math.cos((lat * Math.PI) / 180));
        bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
      }
    }
    try {
      const data = await queryNotams({ country, bbox });
      res.json(data);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // LFA — Tieffluggebiete 250 ft (Bundeswehr-Tiefflug DE), aus DFS NfL geparst
  app.get("/api/lfa", (_req: Request, res: Response) => {
    try {
      res.json(loadLfa());
    } catch (e) {
      console.error("[lfa] failed to load lfa-de.json:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/cached/refresh", requireAdmin, async (_req: Request, res: Response) => {
    runDailySync().catch((e) => console.error("[dataSync] Manueller Sync Fehler:", e));
    res.json({ started: true });
  });

  // NOTAMs via Autorouter
  app.get("/api/proxy/notams", async (req: Request, res: Response) => {
    const lat = num(req.query.lat);
    const lon = num(req.query.lon);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "lat/lon required" });
    const codes = String(req.query.codes || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const itemas = JSON.stringify(codes.length > 0 ? codes : [getFirForPosition(lat, lon), ...nearbyAirportIcaos(lat, lon, 80)]);
    const now = Math.floor(Date.now() / 1000);
    const url = `${AUTOROUTER_URL}?itemas=${encodeURIComponent(itemas)}&offset=0&limit=100&startvalidity=0&endvalidity=${now + 86400 * 14}`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const headers: Record<string, string> = { Accept: "application/json" };
      if (process.env.AUTOROUTER_TOKEN) {
        headers.Authorization = `Bearer ${process.env.AUTOROUTER_TOKEN}`;
      }
      const r = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(t);
      const text = await r.text();
      const data = text ? JSON.parse(text) : { rows: [], total: 0 };
      // Normalize Garmin coords if needed (>1e6 means raw garmin)
      if (Array.isArray(data.rows)) {
        const SCALE = 90 / (1 << 30);
        for (const row of data.rows) {
          if (row.lat != null && Math.abs(row.lat) > 1e6) row.lat = row.lat * SCALE;
          if (row.lon != null && Math.abs(row.lon) > 1e6) row.lon = row.lon * SCALE;
        }
      }
      res.status(r.status).json({ ...data, queriedCodes: JSON.parse(itemas) });
    } catch (e: unknown) {
      res.status(502).json({ error: "NOTAM upstream error", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  // Geocoding (Nominatim)
  app.get("/api/proxy/geocode/search", async (req: Request, res: Response) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q required" });
    const url = `${NOMINATIM}/search?format=json&limit=8&addressdetails=1&accept-language=de&q=${encodeURIComponent(q)}`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "COpter-Pilot-Web/1.0" } });
      const data = await r.json();
      res.status(r.status).json(data);
    } catch (e: unknown) {
      res.status(502).json({ error: "Geocode error", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/proxy/geocode/reverse", async (req: Request, res: Response) => {
    const lat = num(req.query.lat);
    const lon = num(req.query.lon);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: "lat/lon required" });
    const url = `${NOMINATIM}/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=de&zoom=14`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "COpter-Pilot-Web/1.0" } });
      const data = await r.json();
      res.status(r.status).json(data);
    } catch (e: unknown) {
      res.status(502).json({ error: "Reverse geocode error", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  // WMS GetFeatureInfo proxy (avoids CORS for arbitrary providers)
  app.get("/api/proxy/wms-info", async (req: Request, res: Response) => {
    const baseUrl = String(req.query.baseUrl || "");
    const layer = String(req.query.layer || "");
    const bbox = String(req.query.bbox || "");
    const width = String(req.query.width || "256");
    const height = String(req.query.height || "256");
    const x = String(req.query.x || "128");
    const y = String(req.query.y || "128");
    const crs = String(req.query.crs || "EPSG:3857");
    if (!baseUrl || !layer || !bbox) return res.status(400).json({ error: "baseUrl/layer/bbox required" });

    // Allow only known WMS hosts to prevent SSRF
    const allowedHosts = ["uas-betrieb.de", "wms.geo.admin.ch", "wms.geoportail.lu", "service.pdok.nl"];
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      return res.status(400).json({ error: "invalid baseUrl" });
    }
    if (!allowedHosts.includes(parsed.hostname)) {
      return res.status(403).json({ error: "host not allowed" });
    }

    const params = new URLSearchParams({
      SERVICE: "WMS",
      VERSION: "1.3.0",
      REQUEST: "GetFeatureInfo",
      LAYERS: layer,
      QUERY_LAYERS: layer,
      CRS: crs,
      BBOX: bbox,
      WIDTH: width,
      HEIGHT: height,
      I: x,
      J: y,
      INFO_FORMAT: "text/html",
      FEATURE_COUNT: "5",
    });
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
    try {
      const r = await fetch(url, { headers: { Accept: "text/html,application/json" } });
      const text = await r.text();
      res.status(r.status).type(r.headers.get("content-type") || "text/html").send(text);
    } catch (e: unknown) {
      res.status(502).json({ error: "WMS upstream error", detail: e instanceof Error ? e.message : String(e) });
    }
  });

}

function getFirForPosition(lat: number, lon: number): string {
  if (lat >= 45.8 && lat <= 47.9 && lon >= 5.9 && lon <= 10.5) return "LSAS";
  if (lat >= 49.45 && lat <= 50.18 && lon >= 5.73 && lon <= 6.53) return "ELLX";
  if (lat >= 50.75 && lat <= 53.47 && lon >= 3.36 && lon <= 7.21) return "EHAA";
  if (lat < 48.0) return "EDMM";
  if (lat < 49.5 && lon > 10.0) return "EDMM";
  if (lat < 49.0 && lon > 11.5) return "EDMM";
  if (lat >= 52.0) return "EDWW";
  if (lat >= 51.0 && lon > 10.5) return "EDWW";
  if (lat >= 51.5 && lon > 9.0) return "EDWW";
  return "EDGG";
}

function nearbyAirportIcaos(lat: number, lon: number, radiusKm: number): string[] {
  const airports = [
    ["EDDF", 50.0333, 8.5706], ["EDDM", 48.3538, 11.7861], ["EDDB", 52.3667, 13.5033],
    ["EDDH", 53.6304, 9.9882], ["EDDK", 50.8659, 7.1427], ["EDDS", 48.6899, 9.222],
    ["EDDL", 51.2895, 6.7668], ["EDDN", 49.4987, 11.0669], ["EDDP", 51.4324, 12.2416],
    ["EDDW", 53.0475, 8.7867], ["EDDC", 51.1328, 13.7672], ["EDDV", 52.4611, 9.685],
    ["EDDE", 50.9798, 10.9581], ["EDDR", 49.2146, 7.1095], ["EDFH", 49.9487, 7.2639],
    ["EDLW", 51.5183, 7.6122], ["EDLP", 51.6141, 8.6163], ["EDNY", 47.6713, 9.5115],
    ["LSZH", 47.4647, 8.5492], ["LSGG", 46.2381, 6.1089], ["LSZB", 46.9114, 7.4972],
    ["LSZA", 46.004, 8.9106], ["ELLX", 49.6233, 6.2044], ["EHAM", 52.3086, 4.7639],
    ["EHRD", 51.9569, 4.4372], ["EHEH", 51.4501, 5.3745],
  ] as [string, number, number][];
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dist = (a: [number, number], b: [number, number]) => {
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  return airports
    .map((a) => ({ icao: a[0], d: dist([lat, lon], [a[1], a[2]]) }))
    .filter((a) => a.d <= radiusKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map((a) => a.icao);
}
