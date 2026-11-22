import React, { useEffect, useMemo, useState } from "react";
import { Image, View, StyleSheet } from "react-native";
import Svg, { Polyline, Circle } from "react-native-svg";
import { sourcesForView, FALLBACK_MAP, type LngLatBox } from "@/lib/mapSources";
import { getOfflineTileConfig, previewTileUris } from "@/lib/offlineMaps";

/**
 * Leichte Karten-Vorschau für Listen (Logbuch): ein paar Kartenkacheln
 * (Offline-Cache, sonst online) als Bilder plus die Flugroute als SVG darüber.
 * Kein natives Karten-Objekt, nichts wird gespeichert – wird bei Bedarf sofort
 * aus der ausgedünnten Route berechnet.
 */

type Pt = { lat: number; lon: number };

/** Gültiger GPS-Punkt (DJI-Logs enthalten vor dem GPS-Fix oft 0/0). */
const okPt = (p: Pt) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(Math.abs(p.lat) < 0.01 && Math.abs(p.lon) < 0.01);

let cfgPromise: Promise<{ root: string; levels: Record<string, number> } | null> | null = null;
function tileConfig() {
  if (!cfgPromise) cfgPromise = getOfflineTileConfig().catch(() => null);
  return cfgPromise;
}

function project(lat: number, lon: number, z: number, ts: number) {
  const n = ts * Math.pow(2, z);
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
}

function Tile({ local, remote, left, top, size }: { local?: string; remote: string; left: number; top: number; size: number }) {
  const [uri, setUri] = useState(local ?? remote);
  return (
    <Image
      source={{ uri }}
      style={{ position: "absolute", left, top, width: size, height: size }}
      onError={() => {
        if (uri !== remote) setUri(remote);
      }}
    />
  );
}

export default function StaticRouteMap({
  segments,
  point,
  width,
  height,
  dark = false,
  borderColor,
}: {
  segments: Pt[][];
  /** Fallback ohne Route: nur der Ort */
  point?: Pt | null;
  width: number;
  height: number;
  dark?: boolean;
  borderColor?: string;
}) {
  const [cfg, setCfg] = useState<{ root: string; levels: Record<string, number> } | null>(null);
  useEffect(() => {
    let alive = true;
    tileConfig().then((c) => alive && setCfg(c));
    return () => {
      alive = false;
    };
  }, []);

  const layout = useMemo(() => {
    const pts = segments.flat().filter(okPt);
    const all = pts.length > 0 ? pts : point && Number.isFinite(point.lat) ? [point] : [];
    if (all.length === 0 || width <= 0 || height <= 0) return null;
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
    for (const p of all) {
      s = Math.min(s, p.lat); n = Math.max(n, p.lat);
      w = Math.min(w, p.lon); e = Math.max(e, p.lon);
    }
    const box: LngLatBox = [w, s, e, n];
    const src = sourcesForView(box, "map")[0];
    const template = src?.tiles ?? FALLBACK_MAP.tiles;
    const ts = 256;
    // Kacheln gibt es nur bis zur maxzoom-Stufe der Quelle; kurze Flüge werden
    // darüber hinaus vergrößert („Overzoom“: Kacheln skaliert), damit die Route
    // nicht als einzelner Punkt erscheint.
    const tileMaxZ = Math.min(18, src?.maxzoom ?? FALLBACK_MAP.maxzoom);
    const fitMaxZ = 20;
    const pad = 18;
    let z = all.length === 1 ? Math.min(16, tileMaxZ) : 3;
    if (all.length > 1) {
      for (let zz = fitMaxZ; zz >= 3; zz--) {
        const a = project(n, w, zz, ts);
        const b = project(s, e, zz, ts);
        if (b.x - a.x <= width - 2 * pad && b.y - a.y <= height - 2 * pad) {
          z = zz;
          break;
        }
      }
    }
    const tileZ = Math.min(z, tileMaxZ);
    const scale = Math.pow(2, z - tileZ);
    const tileSize = ts * scale;
    const a = project(n, w, z, ts);
    const b = project(s, e, z, ts);
    const ox = (a.x + b.x) / 2 - width / 2;
    const oy = (a.y + b.y) / 2 - height / 2;
    const tiles: { key: string; local?: string; remote: string; left: number; top: number; size: number }[] = [];
    const max = Math.pow(2, tileZ);
    for (let tx = Math.floor(ox / tileSize); tx <= Math.floor((ox + width) / tileSize); tx++) {
      for (let ty = Math.floor(oy / tileSize); ty <= Math.floor((oy + height) / tileSize); ty++) {
        if (ty < 0 || ty >= max) continue;
        const wx = ((tx % max) + max) % max;
        const u = previewTileUris(template, tileZ, wx, ty, cfg);
        tiles.push({ key: `${tileZ}/${tx}/${ty}`, ...u, left: tx * tileSize - ox, top: ty * tileSize - oy, size: tileSize });
      }
    }
    const lines = segments
      .map((seg) =>
        seg
          .filter(okPt)
          .map((p) => {
            const q = project(p.lat, p.lon, z, ts);
            return `${(q.x - ox).toFixed(1)},${(q.y - oy).toFixed(1)}`;
          })
          .join(" "),
      )
      .filter((l) => l.includes(" "));
    const first = pts[0] ? project(pts[0].lat, pts[0].lon, z, ts) : project(all[0].lat, all[0].lon, z, ts);
    const lastP = pts[pts.length - 1];
    const last = lastP ? project(lastP.lat, lastP.lon, z, ts) : null;
    return {
      tiles,
      lines,
      start: { x: first.x - ox, y: first.y - oy },
      end: last ? { x: last.x - ox, y: last.y - oy } : null,
    };
  }, [segments, point, width, height, cfg]);

  return (
    <View style={[styles.box, { width, height, borderColor: borderColor ?? "rgba(0,0,0,0.15)" }]}>
      {layout?.tiles.map((t) => (
        <Tile key={t.key} local={t.local} remote={t.remote} left={t.left} top={t.top} size={t.size} />
      ))}
      {dark ? <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,16,30,0.35)" }]} /> : null}
      {layout ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          {layout.lines.map((l, i) => (
            <React.Fragment key={i}>
              <Polyline points={l} fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
              <Polyline points={l} fill="none" stroke="#0A84FF" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
            </React.Fragment>
          ))}
          <Circle cx={layout.start.x} cy={layout.start.y} r={5} fill="#34C759" stroke="#FFFFFF" strokeWidth={1.5} />
          {layout.end && layout.lines.length > 0 ? (
            <Circle cx={layout.end.x} cy={layout.end.y} r={5} fill="#FF3B30" stroke="#FFFFFF" strokeWidth={1.5} />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "#D8DEE6",
  },
});
