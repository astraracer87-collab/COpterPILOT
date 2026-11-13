import * as net from "net";

export interface OgnAircraft {
  id: string;
  lat: number;
  lon: number;
  altFt: number;
  course: number | null;
  speedKts: number | null;
  vsFpm: number | null;
  type: "flarm" | "icao" | "ogn" | "fanet" | "unknown";
  acType: number;
  model: string;
  lastSeen: number;
}

const aircraftStore = new Map<string, OgnAircraft>();
const STALE_MS = 120_000;
const RECONNECT_DELAY_MS = 15_000;
const KEEPALIVE_INTERVAL_MS = 60_000;

let socket: net.Socket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let connected = false;

const OGN_HOST = "aprs.glidernet.org";
const OGN_PORT = 10152;
const LOGIN_LINE = "user DRONEPRE pass -1 vers DronePreFlight 1.0 filter r/51.16/10.45/500\r\n";

function parseAprsPosition(raw: string): OgnAircraft | null {
  if (raw.startsWith("#")) return null;
  if (!raw.includes(">OG") && !raw.includes(">APRS")) return null;

  const srcMatch = raw.match(/^([A-Z]{3})([0-9A-F]{6})>/);
  if (!srcMatch) return null;

  const prefix = srcMatch[1];
  const devId = srcMatch[2];
  const id = `${prefix}${devId}`;

  let type: OgnAircraft["type"] = "unknown";
  if (prefix === "FLR") type = "flarm";
  else if (prefix === "ICA") type = "icao";
  else if (prefix === "OGN") type = "ogn";
  else if (prefix === "FNT") type = "fanet";
  else if (prefix === "RND") type = "unknown";

  const posMatch = raw.match(/(\d{2})(\d{2}\.\d+)([NS])[^\d](\d{3})(\d{2}\.\d+)([EW])/);
  if (!posMatch) return null;

  let lat = parseInt(posMatch[1]) + parseFloat(posMatch[2]) / 60;
  if (posMatch[3] === "S") lat = -lat;
  let lon = parseInt(posMatch[4]) + parseFloat(posMatch[5]) / 60;
  if (posMatch[6] === "W") lon = -lon;

  const enhMatch = raw.match(/!W(\d)(\d)!/);
  if (enhMatch) {
    lat += parseInt(enhMatch[1]) * 0.001 / 60;
    lon += parseInt(enhMatch[2]) * 0.001 / 60;
  }

  const altMatch = raw.match(/A=(\d+)/);
  const altFt = altMatch ? parseInt(altMatch[1]) : 0;

  const csMatch = raw.match(/[EW].\d*(\d{3})\/(\d{3})/);
  const course = csMatch ? parseInt(csMatch[1]) : null;
  const speedKts = csMatch ? parseInt(csMatch[2]) : null;

  const vsMatch = raw.match(/([-+]?\d+)fpm/);
  const vsFpm = vsMatch ? parseInt(vsMatch[1]) : null;

  const idFieldMatch = raw.match(/id(\w{2})(\w{6})/);
  const model = idFieldMatch ? idFieldMatch[2] : "";
  let acType = 0;
  if (idFieldMatch) {
    const typeByte = parseInt(idFieldMatch[1], 16);
    acType = (typeByte >> 4) & 0x0F;
  }

  const adsbCatMatch = raw.match(/\b([AB])(\d):/);
  if (adsbCatMatch) {
    const catLetter = adsbCatMatch[1];
    const catNum = parseInt(adsbCatMatch[2]);
    if (catLetter === "A") {
      if (catNum === 1) acType = 8;
      else if (catNum === 7) acType = 3;
    } else if (catLetter === "B") {
      if (catNum === 1 || catNum === 3) acType = 7;
      if (catNum === 2) acType = 11;
      if (catNum === 4) acType = 4;
      if (catNum === 6) acType = 13;
    }
  }

  return { id, lat, lon, altFt, course, speedKts, vsFpm, type, acType, model, lastSeen: Date.now() };
}

function pruneStale() {
  const cutoff = Date.now() - STALE_MS;
  for (const [id, ac] of aircraftStore) {
    if (ac.lastSeen < cutoff) aircraftStore.delete(id);
  }
}

function connectAprs() {
  if (socket) {
    try { socket.destroy(); } catch {}
    socket = null;
  }

  socket = new net.Socket();
  socket.setEncoding("utf-8");
  socket.setKeepAlive(true, 30000);

  let buffer = "";

  socket.on("connect", () => {
    connected = true;
    console.log("[OGN] Connected to APRS-IS");
    socket!.write(LOGIN_LINE);

    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(() => {
      if (socket && connected) {
        try { socket.write("#keepalive\r\n"); } catch {}
      }
    }, KEEPALIVE_INTERVAL_MS);
  });

  socket.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const ac = parseAprsPosition(trimmed);
      if (ac) aircraftStore.set(ac.id, ac);
    }
  });

  socket.on("error", (err) => {
    console.log("[OGN] Socket error:", err.message);
    connected = false;
  });

  socket.on("close", () => {
    connected = false;
    console.log("[OGN] Connection closed, reconnecting in", RECONNECT_DELAY_MS / 1000, "s");
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectAprs, RECONNECT_DELAY_MS);
  });

  socket.connect(OGN_PORT, OGN_HOST);
}

let started = false;

export function startOgnClient() {
  if (started) return;
  started = true;
  console.log("[OGN] Starting APRS-IS client...");
  connectAprs();
  setInterval(pruneStale, 30_000);
}

export function getNearbyOgn(lat: number, lon: number, radiusKm: number): OgnAircraft[] {
  pruneStale();
  const result: OgnAircraft[] = [];
  const degPerKm = 1 / 111.32;
  const dLat = radiusKm * degPerKm;
  const dLon = radiusKm * degPerKm / Math.cos((lat * Math.PI) / 180);
  const minLat = lat - dLat;
  const maxLat = lat + dLat;
  const minLon = lon - dLon;
  const maxLon = lon + dLon;

  for (const ac of aircraftStore.values()) {
    if (ac.lat >= minLat && ac.lat <= maxLat && ac.lon >= minLon && ac.lon <= maxLon) {
      const dlat = (ac.lat - lat) * 111.32;
      const dlon = (ac.lon - lon) * 111.32 * Math.cos((lat * Math.PI) / 180);
      const dist = Math.sqrt(dlat * dlat + dlon * dlon);
      if (dist <= radiusKm) result.push(ac);
    }
  }
  return result;
}

export function getOgnStatus(): { connected: boolean; total: number } {
  return { connected, total: aircraftStore.size };
}
