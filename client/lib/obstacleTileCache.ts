// Kachel-Speicher der Luftfahrthindernisse (OSM/Overpass, Zoom-10-Kacheln).
//
// Ziel (Product Owner): Hindernisse erscheinen beim Verschieben der Karte
// sofort, ohne dauernd „Lädt: Hindernisse …“.
//  - Speicher → Gerät → Internet; was auf dem Gerät liegt, wird SOFORT
//    geliefert – auch wenn es älter als die Aktualisierungsfrist ist (dann im
//    Hintergrund still neu geladen: stale-while-revalidate).
//  - Für einen Kartenausschnitt zuerst alle gespeicherten Kacheln liefern,
//    danach nur die fehlenden aus dem Internet.
//  - Fehlgeschlagene Kacheln mit wachsender Pause erneut versuchen (statt alle
//    2 min erneut Overpass zu belasten).
//  - Vorab-Laden der Umgebung einer Position (nacheinander, niedrige Priorität).
//  - Begrenzter Arbeitsspeicher (LRU).
//
// RN-frei (unter tsx testbar): Speicher, Netz, Länderfilter und Uhr sind injiziert.

export const OBSTACLE_TILE_ZOOM = 10;

export type ObstacleTileData = { t: number; fc: GeoJSON.FeatureCollection };

export interface ObstacleTileStorage {
  read(key: string): Promise<ObstacleTileData | null>;
  write(key: string, data: ObstacleTileData): Promise<void>;
}

export interface ObstacleTileCacheOptions {
  storage: ObstacleTileStorage;
  /** Kachel aus dem Internet laden (wirft bei Fehler). */
  fetchTile: (x: number, y: number, ctx: { track: boolean }) => Promise<GeoJSON.FeatureCollection>;
  /** Darf die Kachel geladen/geliefert werden (aktive Länder)? */
  isAllowed?: (x: number, y: number) => boolean | Promise<boolean>;
  now?: () => number;
  /** Ab diesem Alter wird im Hintergrund aktualisiert (Daten bleiben sichtbar). */
  maxAgeMs?: number;
  /** Kacheln im Arbeitsspeicher (LRU). */
  memoryLimit?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface ObstacleGetOptions {
  /** immer neu laden (Offline-Paket) */
  force?: boolean;
  /** false = nur Speicher/Gerät */
  allowNetwork?: boolean;
  /** eigene Download-Anzeige (Standard: nein) */
  track?: boolean;
  /** veraltete Kacheln nicht im Hintergrund aktualisieren */
  noRevalidate?: boolean;
}

export const tileKeyOf = (x: number, y: number): string => `${OBSTACLE_TILE_ZOOM}_${x}_${y}`;

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function tileBounds(x: number, y: number, z: number): { s: number; w: number; n: number; e: number } {
  const n2 = 2 ** z;
  const lon = (xx: number) => (xx / n2) * 360 - 180;
  const lat = (yy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n2))) * 180) / Math.PI;
  return { w: lon(x), e: lon(x + 1), n: lat(y), s: lat(y + 1) };
}

export function tilesForBounds(
  w: number,
  s: number,
  e: number,
  n: number,
  z = OBSTACLE_TILE_ZOOM,
): { x: number; y: number }[] {
  const x0 = lonToTileX(w, z);
  const x1 = lonToTileX(e, z);
  const y0 = latToTileY(n, z);
  const y1 = latToTileY(s, z);
  const out: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ x, y });
  return out;
}

/** Kacheln um eine Position (Mitte zuerst, dann Ring für Ring). */
export function tilesAround(lat: number, lon: number, radiusTiles = 1, z = OBSTACLE_TILE_ZOOM): { x: number; y: number }[] {
  const cx = lonToTileX(lon, z);
  const cy = latToTileY(lat, z);
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r <= radiusTiles; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        out.push({ x: cx + dx, y: cy + dy });
      }
    }
  }
  return out;
}

export interface ObstacleBoundsOptions {
  /** Zwischenstand (alle bisher bekannten Kacheln zusammengeführt). */
  onPartial?: (fc: GeoJSON.FeatureCollection) => void;
  /** Jede gelieferte Kachel einzeln (für inkrementelles Senden an die Karte). */
  onTile?: (key: string, data: ObstacleTileData) => void;
  maxTiles?: number;
  /** false = nur Speicher/Gerät */
  allowNetwork?: boolean;
}

export function createObstacleTileCache(opts: ObstacleTileCacheOptions) {
  const now = opts.now ?? (() => Date.now());
  const maxAgeMs = opts.maxAgeMs ?? 30 * 24 * 3600 * 1000;
  const memoryLimit = Math.max(4, opts.memoryLimit ?? 48);
  const retryBase = opts.retryBaseMs ?? 2 * 60 * 1000;
  const retryMax = opts.retryMaxMs ?? 60 * 60 * 1000;
  const memory = new Map<string, ObstacleTileData>();
  /** Kacheln, die auf dem Gerät sicher fehlen (spart wiederholtes Nachsehen). */
  const knownMissing = new Set<string>();
  const inflight = new Map<string, Promise<ObstacleTileData | null>>();
  const failures = new Map<string, { at: number; n: number }>();
  const loadingListeners = new Set<(active: number) => void>();
  let networkActive = 0;
  const stats = { memoryHits: 0, diskHits: 0, networkLoads: 0, revalidations: 0 };

  function remember(key: string, data: ObstacleTileData): void {
    memory.delete(key);
    memory.set(key, data);
    knownMissing.delete(key);
    while (memory.size > memoryLimit) {
      const oldest = memory.keys().next().value as string | undefined;
      if (oldest == null) break;
      memory.delete(oldest);
    }
  }

  function emitLoading(): void {
    for (const l of loadingListeners) {
      try {
        l(networkActive);
      } catch {}
    }
  }

  async function allowed(x: number, y: number): Promise<boolean> {
    if (!opts.isAllowed) return true;
    try {
      return !!(await opts.isAllowed(x, y));
    } catch {
      return true;
    }
  }

  /** Nur Arbeitsspeicher (synchron). */
  function peek(x: number, y: number): ObstacleTileData | null {
    const key = tileKeyOf(x, y);
    const hit = memory.get(key);
    if (!hit) return null;
    memory.delete(key);
    memory.set(key, hit);
    return hit;
  }

  async function readCached(key: string): Promise<ObstacleTileData | null> {
    const hit = memory.get(key);
    if (hit) {
      memory.delete(key);
      memory.set(key, hit);
      stats.memoryHits++;
      return hit;
    }
    if (knownMissing.has(key)) return null;
    let data: ObstacleTileData | null = null;
    try {
      data = await opts.storage.read(key);
    } catch {
      data = null;
    }
    if (data && data.fc && Array.isArray(data.fc.features)) {
      stats.diskHits++;
      remember(key, data);
      return data;
    }
    knownMissing.add(key);
    return null;
  }

  function backoffActive(key: string): boolean {
    const f = failures.get(key);
    if (!f) return false;
    const wait = Math.min(retryMax, retryBase * 2 ** Math.max(0, f.n - 1));
    return now() - f.at < wait;
  }

  function fetchNetwork(x: number, y: number, key: string, track: boolean): Promise<ObstacleTileData | null> {
    const running = inflight.get(key);
    if (running) return running;
    const p = (async () => {
      networkActive++;
      emitLoading();
      try {
        const fc = await opts.fetchTile(x, y, { track });
        const data: ObstacleTileData = { t: now(), fc };
        stats.networkLoads++;
        failures.delete(key);
        remember(key, data);
        try {
          await opts.storage.write(key, data);
        } catch {}
        return data;
      } catch {
        const prev = failures.get(key);
        failures.set(key, { at: now(), n: (prev?.n ?? 0) + 1 });
        return memory.get(key) ?? null;
      } finally {
        inflight.delete(key);
        networkActive--;
        emitLoading();
      }
    })();
    inflight.set(key, p);
    return p;
  }

  async function get(x: number, y: number, o: ObstacleGetOptions = {}): Promise<ObstacleTileData | null> {
    if (!(await allowed(x, y))) return null;
    const key = tileKeyOf(x, y);
    const cached = await readCached(key);
    if (cached && !o.force) {
      const stale = now() - cached.t >= maxAgeMs;
      if (stale && o.allowNetwork !== false && !o.noRevalidate && !backoffActive(key)) {
        stats.revalidations++;
        void fetchNetwork(x, y, key, false);
      }
      return cached;
    }
    if (o.allowNetwork === false) return cached;
    if (!o.force && backoffActive(key)) return cached;
    return fetchNetwork(x, y, key, !!o.track);
  }

  function mergeOf(parts: (ObstacleTileData | null)[]): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    for (const p of parts) if (p) for (const f of p.fc.features) features.push(f);
    return { type: "FeatureCollection", features };
  }

  /**
   * Alle Hindernisse eines Ausschnitts: zuerst sofort alles Gespeicherte
   * (ein onPartial), danach nur die fehlenden Kacheln aus dem Internet.
   */
  async function loadForBounds(w: number, s: number, e: number, n: number, o: ObstacleBoundsOptions = {}): Promise<GeoJSON.FeatureCollection> {
    const tiles = tilesForBounds(w, s, e, n);
    if (tiles.length > (o.maxTiles ?? 30)) return { type: "FeatureCollection", features: [] };
    const parts: (ObstacleTileData | null)[] = tiles.map(() => null);
    // Phase 1: Speicher/Gerät
    await Promise.all(
      tiles.map(async (t, i) => {
        const d = await get(t.x, t.y, { allowNetwork: false });
        if (d) {
          parts[i] = d;
          o.onTile?.(tileKeyOf(t.x, t.y), d);
        }
      }),
    );
    // veraltete gespeicherte Kacheln still im Hintergrund aktualisieren
    if (o.allowNetwork !== false) {
      for (let i = 0; i < tiles.length; i++) {
        const d = parts[i];
        if (d && now() - d.t >= maxAgeMs) void get(tiles[i].x, tiles[i].y);
      }
    }
    if (parts.some(Boolean)) o.onPartial?.(mergeOf(parts));
    if (o.allowNetwork === false) return mergeOf(parts);
    // Phase 2: nur fehlende Kacheln aus dem Internet
    const missing = tiles.map((t, i) => ({ t, i })).filter(({ i }) => !parts[i]);
    if (missing.length === 0) return mergeOf(parts);
    await Promise.all(
      missing.map(async ({ t, i }) => {
        const d = await get(t.x, t.y);
        if (d) {
          parts[i] = d;
          o.onTile?.(tileKeyOf(t.x, t.y), d);
          o.onPartial?.(mergeOf(parts));
        }
      }),
    );
    return mergeOf(parts);
  }

  let prefetchChain: Promise<unknown> = Promise.resolve();
  /**
   * Umgebung einer Position vorab laden (fehlende bzw. veraltete Kacheln,
   * nacheinander – belegt höchstens eine Overpass-Verbindung). Liefert die
   * Zahl der aus dem Internet geladenen Kacheln.
   */
  function prefetchAround(lat: number, lon: number, radiusTiles = 1): Promise<number> {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve(0);
    const tiles = tilesAround(lat, lon, radiusTiles);
    const run = async () => {
      let loaded = 0;
      for (const t of tiles) {
        if (!(await allowed(t.x, t.y))) continue;
        const key = tileKeyOf(t.x, t.y);
        const cached = await readCached(key);
        if (cached && now() - cached.t < maxAgeMs) continue;
        if (backoffActive(key)) continue;
        const d = await fetchNetwork(t.x, t.y, key, false);
        if (d && d !== cached) loaded++;
      }
      return loaded;
    };
    const p = prefetchChain.then(run, run);
    prefetchChain = p.catch(() => 0);
    return p;
  }

  function forget(x: number, y: number): void {
    const key = tileKeyOf(x, y);
    memory.delete(key);
    knownMissing.delete(key);
    failures.delete(key);
  }

  function subscribeLoading(l: (active: number) => void): () => void {
    loadingListeners.add(l);
    return () => {
      loadingListeners.delete(l);
    };
  }

  return {
    get,
    peek,
    loadForBounds,
    prefetchAround,
    forget,
    subscribeLoading,
    networkActive: () => networkActive,
    stats: () => ({ ...stats, memoryTiles: memory.size }),
  };
}

export type ObstacleTileCache = ReturnType<typeof createObstacleTileCache>;
