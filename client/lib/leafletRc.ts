/**
 * RC-Erweiterung für die Leaflet-Karten (MapPicker, TrafficMapView):
 *
 * 1. Amtliche Karten/Luftbilder je Land (mapSources.ts). Welches Land bzw.
 *    Bundesland zu einer Kachel gehört, rechnet die App (genaue Grenzpolygone)
 *    und schickt ein Raster (Zoomstufe 10) an die Karte. Grenzkacheln und
 *    Gebiete ohne amtliche Quelle zeigen die Ersatzkarte (CARTO / Esri bzw.
 *    Google mit eigenem Schlüssel).
 * 2. Offline: Jede Kachelebene schaut zuerst in den Kachelspeicher auf dem
 *    Gerät (offlineMaps.ts), erst danach ins Internet.
 * 3. Hindernisse (obstacles.ts) mit Symbolen und Farben aus dem KMZ-Tool.
 *
 * Die Karte muss nach dem Anlegen `window.__rcMap = map` setzen; die
 * Basisebene wird über `window.__rc.makeBase(style, defaultUrl, options)` erzeugt.
 */
import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { WebView } from "react-native-webview";
import { COUNTRY_MAP_PROVIDERS, FALLBACK_MAP, FALLBACK_SATELLITE } from "@/lib/mapSources";
import { detectCountryFromCoordinates } from "../../shared/countryDetection";
import { detectBundeslandFromCoordinates } from "@/lib/countryMaps";
import { getObstaclesEnabled, loadObstaclesForBounds, onObstaclesEnabledChange } from "@/lib/obstacles";
import { ensureGoogleTiles, onGoogleTilesChange } from "@/lib/googleTiles";
import { getOfflineTileConfig, onOfflineTilesChange } from "@/lib/offlineMaps";

export const GRID_ZOOM = 10;
const OBSTACLE_MIN_ZOOM = 11;

// Zeichenfunktion der Hindernis-Symbole aus dem KMZ-Tool (index.html, obsIcon)
const OBSTACLE_ICON_JS_SRC = `
function obsIcon(c, t, x, y, k, tt) {
  k = k || 1; var R = 13 * k;
  if (t === 'tower' && tt === 'communication') t = 'mast';
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 4 * k; c.shadowOffsetY = 1 * k;
  var bg = t === 'wind' ? '#f6c453' : t === 'pmast' ? '#8e24aa' : '#ffffff', ring = t === 'wind' ? '#fff' : t === 'pmast' ? '#fff' : '#37474f';
  c.beginPath(); c.arc(x, y, R, 0, 7); c.fillStyle = bg; c.fill(); c.shadowColor = 'transparent';
  c.lineWidth = 2.2 * k; c.strokeStyle = ring; c.stroke();
  if (t === 'wind') { c.beginPath(); c.arc(x, y, R + 1.6 * k, 0, 7); c.lineWidth = 1 * k; c.strokeStyle = 'rgba(120,80,0,.55)'; c.stroke(); }
  var ink = t === 'wind' ? '#5b3d00' : t === 'pmast' ? '#fff' : '#263238';
  c.strokeStyle = ink; c.fillStyle = ink;
  if (t === 'wind') {
    var hx = x + 0.5 * k, hy = y - 2.5 * k;
    c.lineWidth = 2 * k; c.beginPath(); c.moveTo(hx - 1 * k, y + 9 * k); c.lineTo(hx, hy); c.lineTo(hx + 1 * k, y + 9 * k); c.stroke();
    for (var i = 0; i < 3; i++) { var a = -Math.PI / 2 + 0.35 + i * 2 * Math.PI / 3, L2 = 8.5 * k, ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
      c.beginPath(); c.moveTo(hx, hy); c.quadraticCurveTo(hx + ca * L2 * .5 + px * 3 * k, hy + sa * L2 * .5 + py * 3 * k, hx + ca * L2, hy + sa * L2);
      c.quadraticCurveTo(hx + ca * L2 * .55 - px * 0.6 * k, hy + sa * L2 * .55 - py * 0.6 * k, hx, hy); c.fill(); }
    c.beginPath(); c.arc(hx, hy, 1.8 * k, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1 * k; c.stroke();
  } else if (t === 'pmast') {
    c.lineWidth = 1.6 * k; c.beginPath();
    c.moveTo(x - 5 * k, y + 8 * k); c.lineTo(x, y - 8 * k); c.lineTo(x + 5 * k, y + 8 * k);
    c.moveTo(x - 7 * k, y - 3 * k); c.lineTo(x + 7 * k, y - 3 * k); c.moveTo(x - 5 * k, y + 1 * k); c.lineTo(x + 5 * k, y + 1 * k);
    c.moveTo(x - 3.5 * k, y + 4 * k); c.lineTo(x + 2 * k, y - 1 * k); c.stroke();
  } else if (t === 'chimney') {
    c.fillRect(x - 3 * k, y - 4 * k, 6 * k, 12 * k);
    c.lineWidth = 1.6 * k; c.beginPath(); c.moveTo(x, y - 6 * k); c.quadraticCurveTo(x - 3 * k, y - 8 * k, x, y - 10 * k); c.quadraticCurveTo(x + 3 * k, y - 11 * k, x + 1 * k, y - 13 * k); c.stroke();
  } else if (t === 'tower') {
    c.beginPath(); c.moveTo(x - 4 * k, y + 9 * k); c.lineTo(x - 1.6 * k, y - 2 * k); c.lineTo(x + 1.6 * k, y - 2 * k); c.lineTo(x + 4 * k, y + 9 * k); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(x, y - 3.5 * k, 4.6 * k, 2.4 * k, 0, 0, 7); c.fill();
    c.lineWidth = 1.6 * k; c.beginPath(); c.moveTo(x, y - 5 * k); c.lineTo(x, y - 11 * k); c.stroke();
    if (tt === 'fernmelde') { c.lineWidth = 1.2 * k; [3, 5.2].forEach(function(r){ c.beginPath(); c.arc(x, y - 10.5 * k, r * k, -Math.PI * .25, Math.PI * .25); c.stroke(); c.beginPath(); c.arc(x, y - 10.5 * k, r * k, Math.PI * .75, Math.PI * 1.25); c.stroke(); }); }
  } else {
    c.lineWidth = 1.8 * k; c.beginPath();
    c.moveTo(x - 4 * k, y + 8 * k); c.lineTo(x, y - 3 * k); c.lineTo(x + 4 * k, y + 8 * k); c.moveTo(x - 2.2 * k, y + 3.5 * k); c.lineTo(x + 2.2 * k, y + 3.5 * k); c.stroke();
    c.beginPath(); c.arc(x, y - 4 * k, 1.8 * k, 0, 7); c.fill();
    c.lineWidth = 1.5 * k;
    [4.5, 7.5].forEach(function(r){ c.beginPath(); c.arc(x, y - 4 * k, r * k, -Math.PI * .22, Math.PI * .22); c.stroke(); c.beginPath(); c.arc(x, y - 4 * k, r * k, Math.PI * .78, Math.PI * 1.22); c.stroke(); });
  }
  c.restore();
}
`;

const OBSTACLE_ICON_JS = OBSTACLE_ICON_JS_SRC;

// ---------------------------------------------------------------------------
// JavaScript für die WebView
// ---------------------------------------------------------------------------

export const RC_LEAFLET_JS = String.raw`
(function(){
  if (!window.L) return;
  var rc = window.__rc = { cfg: { root: "", offline: {}, map: [], sat: [], fbMap: "", fbSat: "", grid: {} }, obs: null };
  var EMPTY = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

  function hash(s){ var h = 0x811c9dc5; for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ("0000000" + h.toString(16)).slice(-8); }
  rc.hash = hash;
  function bbox3857(x, y, z){ var R = 20037508.342789244, size = 2 * R / Math.pow(2, z), minx = -R + x * size, maxy = R - y * size; return [minx, maxy - size, minx + size, maxy].join(","); }
  var SUB = ["a", "b", "c"];
  function fill(t, x, y, z){
    return t.replace(/\{bbox-epsg-3857\}/g, bbox3857(x, y, z)).replace(/\{bbox\}/g, bbox3857(x, y, z)).replace(/\{z\}/g, z).replace(/\{x\}/g, x).replace(/\{y\}/g, y)
      .replace(/\{s\}/g, SUB[Math.abs(x + y) % 3]).replace(/\{r\}/g, "").replace(/\{width\}/g, "256").replace(/\{height\}/g, "256");
  }

  // ---- Alle Kachelebenen: erst Gerät, dann Internet ----
  var P = L.TileLayer.prototype;
  P.rcTemplate = function(c, z){ return this._url; };
  P.createTile = function(coords, done){
    var tile = document.createElement("img");
    L.DomEvent.on(tile, "load", L.Util.bind(this._tileOnLoad, this, done, tile));
    tile.alt = ""; tile.setAttribute("role", "presentation");
    var z = this._getZoomForUrl();
    var tpl = this.rcTemplate(coords, z);
    var onErr = L.Util.bind(this._tileOnError, this, done, tile);
    if (!tpl){ tile.src = EMPTY; return tile; }
    var online = fill(tpl, coords.x, coords.y, z);
    var h = hash(tpl), cfg = rc.cfg;
    if (cfg.root && cfg.offline[h] && z <= cfg.offline[h]){
      tile.onerror = function(){ tile.onerror = null; L.DomEvent.on(tile, "error", onErr); tile.src = online; };
      tile.src = cfg.root + h + "/" + z + "/" + coords.x + "/" + coords.y;
    } else {
      L.DomEvent.on(tile, "error", onErr);
      tile.src = online;
    }
    return tile;
  };

  // ---- Basis: amtliche Quelle je Land/Bundesland, sonst Ersatzkarte ----
  function gridKey(x, y, z){
    if (z < ${GRID_ZOOM}) return null;
    var d = Math.pow(2, z - ${GRID_ZOOM});
    return Math.floor(x / d) + "_" + Math.floor(y / d);
  }
  function pick(list, cell, z){
    if (!cell || cell === "?") return null;
    var parts = cell.split("|"), iso = parts[0], region = parts[1] || "";
    for (var i = 0; i < list.length; i++){
      var p = list[i];
      if (p.iso !== iso) continue;
      if (p.region && p.region !== region) continue;
      if (z < (p.minzoom || 0) || z > (p.maxzoom || 19)) continue;
      return p.tiles;
    }
    return null;
  }
  var RcBase = L.TileLayer.extend({
    initialize: function(kind, fallback, options){
      this._kind = kind; this._fallback = fallback;
      L.TileLayer.prototype.initialize.call(this, fallback, options);
    },
    rcTemplate: function(c, z){
      var cfg = rc.cfg, list = this._kind === "sat" ? cfg.sat : cfg.map;
      var k = gridKey(c.x, c.y, z);
      var t = k ? pick(list, cfg.grid[k], z) : null;
      if (t) return t;
      if (this._kind === "sat") return cfg.fbSat || this._fallback;
      return cfg.fbMap || this._fallback;
    }
  });
  var bases = [];
  rc.makeBase = function(style, fallbackUrl, options){
    var kind = (style === "satellite" || style === "hybrid") ? "sat" : "map";
    var layer = new RcBase(kind, fallbackUrl, options || {});
    bases.push(layer);
    layer.on("remove", function(){ var i = bases.indexOf(layer); if (i >= 0) bases.splice(i, 1); });
    return layer;
  };
  function redrawBases(){ for (var i = 0; i < bases.length; i++){ try { bases[i].redraw(); } catch (e) {} } }

  rc.configure = function(cfg){
    var gridChanged = JSON.stringify(cfg.grid || {}) !== JSON.stringify(rc.cfg.grid || {});
    var srcChanged = JSON.stringify([cfg.map, cfg.sat, cfg.fbMap, cfg.fbSat, cfg.offline]) !== JSON.stringify([rc.cfg.map, rc.cfg.sat, rc.cfg.fbMap, rc.cfg.fbSat, rc.cfg.offline]);
    for (var k in cfg) if (cfg.hasOwnProperty(k)) rc.cfg[k] = cfg[k];
    if (gridChanged || srcChanged) redrawBases();
  };
  rc.setGrid = function(grid){
    var changed = false;
    for (var k in grid) if (grid.hasOwnProperty(k) && rc.cfg.grid[k] !== grid[k]) { rc.cfg.grid[k] = grid[k]; changed = true; }
    if (changed) redrawBases();
  };

  // ---- Hindernisse (Stil wie KMZ-Tool) ----
  ${OBSTACLE_ICON_JS}
  var iconCache = {};
  function obsIconUrl(t){
    if (iconCache[t]) return iconCache[t];
    var r = window.devicePixelRatio || 2, c = document.createElement("canvas");
    c.width = 34 * r; c.height = 34 * r;
    var tt = t === "tower_fernmelde" ? "fernmelde" : null, tk = t === "tower_fernmelde" ? "tower" : t;
    obsIcon(c.getContext("2d"), tk, 17 * r, 17 * r, r, tt);
    return (iconCache[t] = c.toDataURL("image/png"));
  }
  function lineStyle(c){
    if (c === "hoes") return { color: "#6a1b9a", weight: 4 };
    if (c === "hs") return { color: "#8e24aa", weight: 3 };
    if (c === "ms") return { color: "#ef6c00", weight: 2.2 };
    if (c === "ns") return { color: "#6d7a86", weight: 1.5, dashArray: "6 4" };
    if (c === "unk_line") return { color: "#8e24aa", weight: 2.5, dashArray: "10 4" };
    return { color: "#6d7a86", weight: 1.5, dashArray: "6 4" };
  }
  var obsGroup = null, obsData = null, obsRenderer = null;
  function renderObstacles(){
    var map = window.__rcMap;
    if (!map) return;
    if (!obsGroup){ obsGroup = L.layerGroup().addTo(map); obsRenderer = L.canvas({ padding: 0.3 }); map.on("zoomend moveend", renderObstacles); }
    obsGroup.clearLayers();
    var z = map.getZoom();
    if (!obsData || z < ${OBSTACLE_MIN_ZOOM}) return;
    var b = map.getBounds().pad(0.2);
    var feats = obsData.features || [];
    for (var i = 0; i < feats.length; i++){
      var f = feats[i], p = f.properties || {}, g = f.geometry;
      if (!g) continue;
      if (g.type === "LineString"){
        if (p.k === "rail" && z < 12) continue;
        var ll = [], inView = false;
        for (var j = 0; j < g.coordinates.length; j++){ var q = [g.coordinates[j][1], g.coordinates[j][0]]; ll.push(q); if (!inView && b.contains(q)) inView = true; }
        if (!inView) continue;
        if (p.k === "rail"){
          L.polyline(ll, { renderer: obsRenderer, color: "#2b2f36", weight: 4.5, interactive: false }).addTo(obsGroup);
          L.polyline(ll, { renderer: obsRenderer, color: "#ffffff", weight: 2.2, dashArray: "9 9", interactive: false }).addTo(obsGroup);
        } else {
          var st = lineStyle(p.c); st.renderer = obsRenderer; st.interactive = false; st.lineCap = "round"; st.lineJoin = "round"; st.opacity = 0.95;
          L.polyline(ll, st).addTo(obsGroup);
        }
        continue;
      }
      if (g.type !== "Point") continue;
      var pt = [g.coordinates[1], g.coordinates[0]];
      if (!b.contains(pt)) continue;
      var h = p.h || 0;
      if (p.k === "pmast" && z < 14) continue;
      if (p.k !== "wind" && !h && z < 14) continue;
      L.marker(pt, { icon: L.icon({ iconUrl: obsIconUrl(p.k), iconSize: [34, 34], iconAnchor: [17, 17] }), interactive: false, keyboard: false, zIndexOffset: -500 }).addTo(obsGroup);
      if (h && z >= 13){
        L.marker(pt, { icon: L.divIcon({ className: "rc-obs-h", html: "<span>" + h + " m</span>", iconSize: [60, 16], iconAnchor: [30, -12] }), interactive: false, keyboard: false, zIndexOffset: -400 }).addTo(obsGroup);
      }
    }
  }
  rc.setObstacles = function(fc){ obsData = fc; renderObstacles(); };

  var css = document.createElement("style");
  css.textContent = ".rc-obs-h{text-align:center}.rc-obs-h span{display:inline-block;font:700 11px Roboto,system-ui,sans-serif;color:#222;background:rgba(255,255,255,.92);padding:0 4px;border-radius:3px;white-space:nowrap}";
  document.head.appendChild(css);
})();
`;



// ---------------------------------------------------------------------------
// React-Native-Seite
// ---------------------------------------------------------------------------

type View = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

function lonToX(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToY(lat: number, z: number) {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
function xToLon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}
function yToLat(y: number, z: number) {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
}

const cellCache = new Map<string, string>();

/** Land (und in DE das Bundesland) einer Zoom-10-Kachel; "?" an Grenzen */
function cellValue(x: number, y: number): string {
  const key = `${x}_${y}`;
  const hit = cellCache.get(key);
  if (hit) return hit;
  const pts: [number, number][] = [];
  for (const fx of [0.05, 0.5, 0.95]) for (const fy of [0.05, 0.5, 0.95]) pts.push([yToLat(y + fy, GRID_ZOOM), xToLon(x + fx, GRID_ZOOM)]);
  let val: string | null = null;
  for (const [lat, lon] of pts) {
    const iso = detectCountryFromCoordinates(lat, lon) ?? "";
    const region = iso === "DE" ? detectBundeslandFromCoordinates(lat, lon) ?? "" : "";
    const v = `${iso}|${region}`;
    if (val === null) val = v;
    else if (val !== v) {
      // Grenze: Land einheitlich? Dann ohne Bundesland, sonst Ersatzkarte
      const isoA: string = (val as string).split("|")[0];
      val = isoA === iso && iso ? `${iso}|` : "?";
      if (val === "?") break;
    }
  }
  const out = val && !val.startsWith("|") ? val : "?";
  cellCache.set(key, out);
  return out;
}

export function gridForView(v: View): Record<string, string> {
  const pad = 0.5;
  const w = v.longitude - v.longitudeDelta * (0.5 + pad);
  const e = v.longitude + v.longitudeDelta * (0.5 + pad);
  const n = v.latitude + v.latitudeDelta * (0.5 + pad);
  const s = v.latitude - v.latitudeDelta * (0.5 + pad);
  const x0 = lonToX(w, GRID_ZOOM);
  const x1 = lonToX(e, GRID_ZOOM);
  const y0 = latToY(n, GRID_ZOOM);
  const y1 = latToY(s, GRID_ZOOM);
  const out: Record<string, string> = {};
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return out; // zu weit herausgezoomt: Ersatzkarte
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out[`${x}_${y}`] = cellValue(x, y);
  return out;
}

function providerLists() {
  const map: any[] = [];
  const sat: any[] = [];
  for (const p of COUNTRY_MAP_PROVIDERS) {
    if (p.map) map.push({ iso: p.iso, tiles: p.map.tiles, maxzoom: p.map.maxzoom, minzoom: p.map.minzoom ?? 0 });
    for (const s of p.satellite ?? []) sat.push({ iso: p.iso, region: s.region ?? "", tiles: s.tiles, maxzoom: s.maxzoom, minzoom: s.minzoom ?? 0 });
  }
  return { map, sat };
}

/**
 * Verbindet eine Leaflet-WebView mit Länderkarten, Offline-Kacheln und Hindernissen.
 * `view` = aktuell sichtbarer Ausschnitt, `zoom` = Leaflet-Zoom.
 */
export function useRcLeaflet(webRef: RefObject<WebView | null>, ready: boolean, view: View | null, zoom: number | null) {
  const run = (js: string) => {
    try {
      webRef.current?.injectJavaScript(`try{${js}}catch(e){};true;`);
    } catch {}
  };
  const lists = useMemo(providerLists, []);
  const cfgRef = useRef<{ google: string | null; offline: Record<string, number>; root: string }>({ google: null, offline: {}, root: "" });

  // Grundkonfiguration + Google-Schlüssel + Offline-Kacheln
  useEffect(() => {
    if (!ready) return;
    const push = () => {
      const c = cfgRef.current;
      run(
        `window.__rc.configure(${JSON.stringify({
          map: lists.map,
          sat: lists.sat,
          fbMap: FALLBACK_MAP.tiles,
          fbSat: c.google ?? FALLBACK_SATELLITE.tiles,
          root: c.root,
          offline: c.offline,
        })})`,
      );
    };
    const offG = onGoogleTilesChange((s) => {
      cfgRef.current.google = s.template;
      push();
    });
    ensureGoogleTiles().catch(() => {});
    const offO = onOfflineTilesChange(() => {
      getOfflineTileConfig()
        .then((c) => {
          cfgRef.current.root = c.root;
          cfgRef.current.offline = c.levels;
          push();
        })
        .catch(() => {});
    });
    push();
    return () => {
      offG();
      offO();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lists]);

  // Länder-Raster für den sichtbaren Ausschnitt
  const viewKey = view ? `${view.latitude.toFixed(3)},${view.longitude.toFixed(3)},${view.latitudeDelta.toFixed(3)}` : "";
  useEffect(() => {
    if (!ready || !view) return;
    const t = setTimeout(() => run(`window.__rc.setGrid(${JSON.stringify(gridForView(view))})`), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, viewKey]);

  // Hindernisse
  const enabledRef = useRef(true);
  const reqRef = useRef(0);
  useEffect(() => {
    getObstaclesEnabled().then((v) => {
      enabledRef.current = v;
    });
    return onObstaclesEnabledChange((v) => {
      enabledRef.current = v;
      if (!v) run(`window.__rc.setObstacles(null)`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const zoomOk = (zoom ?? 0) >= OBSTACLE_MIN_ZOOM;
  useEffect(() => {
    if (!ready || !view || !zoomOk || !enabledRef.current) return;
    const id = ++reqRef.current;
    const t = setTimeout(() => {
      const w = view.longitude - view.longitudeDelta * 0.6;
      const e = view.longitude + view.longitudeDelta * 0.6;
      const s = view.latitude - view.latitudeDelta * 0.6;
      const n = view.latitude + view.latitudeDelta * 0.6;
      const send = (fc: GeoJSON.FeatureCollection) => {
        if (id === reqRef.current) run(`window.__rc.setObstacles(${JSON.stringify(fc)})`);
      };
      loadObstaclesForBounds(w, s, e, n, send).then(send).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, viewKey, zoomOk]);
}

/** WebView-Eigenschaften, damit die Karte gespeicherte Kacheln lesen darf. */
export const RC_WEBVIEW_FILE_PROPS = {
  allowFileAccess: true,
  allowFileAccessFromFileURLs: true,
  allowUniversalAccessFromFileURLs: true,
} as const;
