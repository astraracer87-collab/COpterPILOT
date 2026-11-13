import { db } from "./db";
import { cachedDataset } from "../shared/schema";
import { eq } from "drizzle-orm";

const AUTOROUTER_URL = "https://api.autorouter.aero/v1.0/notam";

const FIRS_BY_COUNTRY: Record<string, string[]> = {
  de: ["EDGG", "EDMM", "EDWW"],
  ch: ["LSAS"],
  lu: ["ELLX"],
  nl: ["EHAA"],
};

const MAJOR_AIRPORTS: Record<string, string[]> = {
  de: [
    "EDDF","EDDM","EDDB","EDDH","EDDK","EDDS","EDDL","EDDN","EDDP","EDDW",
    "EDDC","EDDV","EDDE","EDDR","EDFH","EDLW","EDLP","EDNY",
  ],
  ch: ["LSZH","LSGG","LSZB","LSZA"],
  lu: ["ELLX"],
  nl: ["EHAM","EHRD","EHEH"],
};

type GeoFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
  bbox?: [number, number, number, number];
};

function computeBbox(geometry: { type: string; coordinates: unknown }): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number, y = c[1] as number;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    } else c.forEach(visit);
  };
  visit(geometry.coordinates);
  if (!isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

async function persist(
  source: string,
  kind: string,
  country: string | null,
  features: unknown[],
  metadata: Record<string, unknown>,
) {
  const json = JSON.stringify(features);
  await db
    .insert(cachedDataset)
    .values({
      source,
      kind,
      country,
      features: features as unknown as object,
      metadata,
      bytes: Buffer.byteLength(json, "utf8"),
      itemCount: features.length,
      status: "ok",
      lastError: null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: cachedDataset.source,
      set: {
        kind,
        country,
        features: features as unknown as object,
        metadata,
        bytes: Buffer.byteLength(json, "utf8"),
        itemCount: features.length,
        status: "ok",
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

async function persistError(source: string, kind: string, country: string | null, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  await db
    .insert(cachedDataset)
    .values({
      source, kind, country,
      features: [] as unknown as object,
      metadata: {},
      bytes: 0, itemCount: 0,
      status: "error", lastError: msg,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: cachedDataset.source,
      set: { status: "error", lastError: msg, updatedAt: new Date() },
    });
  console.warn(`[dataSync] ${source} failed: ${msg}`);
}

// ---------- Geozones ----------

// Generic GeoJSON / WFS fetcher. Each country's source URL is configurable via
// environment variables so we don't hard-code endpoints that need credentials
// or that change. The URL must return a GeoJSON FeatureCollection in EPSG:4326.
//   GEOZONES_DE_URL, GEOZONES_CH_URL, GEOZONES_LU_URL, GEOZONES_NL_URL
async function fetchGeozonesFromEnv(country: string, envVar: string): Promise<GeoFeature[]> {
  const url = process.env[envVar];
  if (!url) {
    throw new Error(
      `Vector-Quelle nicht konfiguriert (${envVar} fehlt). Bis dahin werden die WMS-Kacheln direkt vom Anbieter geladen.`,
    );
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { features?: GeoFeature[] };
    const feats = j.features ?? [];
    for (const f of feats) {
      if (!f.bbox) {
        const bb = computeBbox(f.geometry);
        if (bb) f.bbox = bb;
      }
      f.properties = { ...f.properties, _country: country };
    }
    return feats;
  } finally {
    clearTimeout(t);
  }
}

// ---------- NOTAMs ----------

async function fetchNotamsForCodes(codes: string[]): Promise<unknown[]> {
  const itemas = JSON.stringify(codes);
  const now = Math.floor(Date.now() / 1000);
  const url =
    `${AUTOROUTER_URL}?itemas=${encodeURIComponent(itemas)}` +
    `&offset=0&limit=500&startvalidity=0&endvalidity=${now + 86400 * 14}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.AUTOROUTER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.AUTOROUTER_TOKEN}`;
  }
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 ? " (AUTOROUTER_TOKEN fehlt/ungültig)" : ""}`);
    const j = (await r.json()) as { rows?: Array<Record<string, unknown>> };
    const rows = j.rows ?? [];
    const SCALE = 90 / (1 << 30);
    for (const row of rows) {
      const lat = row.lat as number | undefined;
      const lon = row.lon as number | undefined;
      if (lat != null && Math.abs(lat) > 1e6) row.lat = lat * SCALE;
      if (lon != null && Math.abs(lon) > 1e6) row.lon = lon * SCALE;
    }
    return rows;
  } finally {
    clearTimeout(t);
  }
}

async function syncNotamsForCountry(country: string): Promise<void> {
  const source = `notams-${country}`;
  try {
    const codes = [...(FIRS_BY_COUNTRY[country] ?? []), ...(MAJOR_AIRPORTS[country] ?? [])];
    if (!codes.length) throw new Error(`Keine ICAO-Codes für ${country}`);
    const rows = await fetchNotamsForCodes(codes);
    await persist(source, "notams", country, rows, { codes, fetchedAt: new Date().toISOString() });
    console.log(`[dataSync] ${source}: ${rows.length} NOTAMs gespeichert`);
  } catch (e) {
    await persistError(source, "notams", country, e);
  }
}

async function syncGeozonesForCountry(country: string): Promise<void> {
  const source = `geozones-${country}`;
  try {
    const envByCountry: Record<string, string> = {
      de: "GEOZONES_DE_URL",
      ch: "GEOZONES_CH_URL",
      lu: "GEOZONES_LU_URL",
      nl: "GEOZONES_NL_URL",
    };
    const envVar = envByCountry[country];
    if (!envVar) throw new Error(`Unbekanntes Land: ${country}`);
    const features = await fetchGeozonesFromEnv(country, envVar);
    await persist(source, "geozones", country, features, {
      fetchedAt: new Date().toISOString(),
    });
    console.log(`[dataSync] ${source}: ${features.length} Features gespeichert`);
  } catch (e) {
    await persistError(source, "geozones", country, e);
  }
}

export async function runDailySync(): Promise<void> {
  console.log("[dataSync] Tagesabgleich gestartet");
  const start = Date.now();
  await Promise.all([
    syncNotamsForCountry("de"),
    syncNotamsForCountry("ch"),
    syncNotamsForCountry("lu"),
    syncNotamsForCountry("nl"),
    syncGeozonesForCountry("de"),
    syncGeozonesForCountry("ch"),
    syncGeozonesForCountry("lu"),
    syncGeozonesForCountry("nl"),
  ]);
  console.log(`[dataSync] Tagesabgleich fertig in ${Math.round((Date.now() - start) / 1000)}s`);
}

let cronStarted = false;

export function startDailySyncCron(): void {
  if (cronStarted) return;
  cronStarted = true;
  // Boot-Sync: nur wenn nichts existiert oder älter als 12h
  void (async () => {
    try {
      const rows = await db.select().from(cachedDataset);
      const stale =
        rows.length === 0 ||
        rows.some((r) => Date.now() - new Date(r.updatedAt).getTime() > 12 * 3600 * 1000);
      if (stale) {
        await runDailySync();
      } else {
        console.log("[dataSync] Cache ist frisch, kein Boot-Sync");
      }
    } catch (e) {
      console.warn("[dataSync] Boot-Sync übersprungen:", e instanceof Error ? e.message : e);
    }
  })();

  setInterval(
    () => {
      runDailySync().catch((e) =>
        console.error("[dataSync] Tagesabgleich Fehler:", e instanceof Error ? e.message : e),
      );
    },
    24 * 3600 * 1000,
  );
}

// ---------- Query helpers ----------

function bboxIntersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

export type CachedQuery = {
  country?: string;
  bbox?: [number, number, number, number]; // lonW, latS, lonE, latN
};

export async function getCachedDataset(source: string): Promise<{
  source: string;
  updatedAt: Date;
  itemCount: number;
  features: unknown[];
  status: string;
  lastError: string | null;
} | null> {
  const [row] = await db.select().from(cachedDataset).where(eq(cachedDataset.source, source));
  if (!row) return null;
  return {
    source: row.source,
    updatedAt: row.updatedAt,
    itemCount: row.itemCount,
    features: (row.features as unknown[]) ?? [],
    status: row.status,
    lastError: row.lastError,
  };
}

export async function queryGeozones(q: CachedQuery): Promise<{
  country: string;
  updatedAt: Date | null;
  status: string;
  features: GeoFeature[];
}[]> {
  const countries = q.country ? [q.country] : ["de", "ch", "lu", "nl"];
  const out: {
    country: string;
    updatedAt: Date | null;
    status: string;
    features: GeoFeature[];
  }[] = [];
  for (const c of countries) {
    const ds = await getCachedDataset(`geozones-${c}`);
    if (!ds) {
      out.push({ country: c, updatedAt: null, status: "missing", features: [] });
      continue;
    }
    let feats = ds.features as GeoFeature[];
    if (q.bbox) {
      const bb = q.bbox;
      feats = feats.filter((f) => f.bbox && bboxIntersects(f.bbox, bb));
    }
    out.push({ country: c, updatedAt: ds.updatedAt, status: ds.status, features: feats });
  }
  return out;
}

export async function queryNotams(q: CachedQuery): Promise<{
  rows: Array<Record<string, unknown>>;
  updatedAt: Date | null;
  countries: string[];
}> {
  const countries = q.country ? [q.country] : ["de", "ch", "lu", "nl"];
  let updatedAt: Date | null = null;
  const all: Array<Record<string, unknown>> = [];
  for (const c of countries) {
    const ds = await getCachedDataset(`notams-${c}`);
    if (!ds) continue;
    if (!updatedAt || ds.updatedAt > updatedAt) updatedAt = ds.updatedAt;
    let rows = ds.features as Array<Record<string, unknown>>;
    if (q.bbox) {
      const [w, s, e, n] = q.bbox;
      const midLat = (s + n) / 2;
      const cosLat = Math.max(0.1, Math.cos((midLat * Math.PI) / 180));
      rows = rows.filter((r) => {
        const lat = r.lat as number | undefined;
        const lon = r.lon as number | undefined;
        const radius = (r.radius as number | undefined) ?? 0;
        if (lat == null || lon == null) return true; // keep FIR-wide NOTAMs
        const dLat = radius / 111;
        const dLon = radius / (111 * cosLat);
        return lon >= w - dLon && lon <= e + dLon && lat >= s - dLat && lat <= n + dLat;
      });
    }
    all.push(...rows);
  }
  return { rows: all, updatedAt, countries };
}

export async function getCacheStatus(): Promise<
  Array<{ source: string; kind: string; country: string | null; updatedAt: Date; itemCount: number; bytes: number; status: string; lastError: string | null }>
> {
  const rows = await db.select().from(cachedDataset);
  return rows.map((r) => ({
    source: r.source,
    kind: r.kind,
    country: r.country,
    updatedAt: r.updatedAt,
    itemCount: r.itemCount,
    bytes: r.bytes,
    status: r.status,
    lastError: r.lastError,
  }));
}
