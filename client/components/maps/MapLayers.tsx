/**
 * Ebenen, die jede Karte automatisch bekommt:
 * - amtliche Karten/Luftbilder des sichtbaren Landes (mapSources.ts)
 * - Hindernisse aus OpenStreetMap (obstacles.ts) mit den Symbolen des KMZ-Tools
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSONSource, Images, Layer, RasterSource } from "@maplibre/maplibre-react-native";
import { LABEL_FONT, sourcesForView, type LngLatBox, type RasterDef } from "@/lib/mapSources";
import {
  getObstaclesEnabled,
  loadObstaclesForBounds,
  onObstaclesEnabledChange,
} from "@/lib/obstacles";

/** Reihenfolge der Länder-Ebenen (unten → oben). Länder, deren Kacheln außerhalb
 *  des Landes durchsichtig sind (DE), liegen oben. */
const BASE_ORDER = ["ch-", "nl-", "fr-", "at-", "de-"];
export const BASE_ANCHORS = BASE_ORDER.map((_, i) => `cp-base-${i}`);

function anchorFor(def: RasterDef): string {
  const i = BASE_ORDER.findIndex((p) => def.id.startsWith(p));
  return BASE_ANCHORS[i < 0 ? 0 : i];
}

export function CountryBaseLayers({ view, satellite }: { view: LngLatBox | null; satellite: boolean }) {
  const defs = useMemo(() => (view ? sourcesForView(view, satellite ? "satellite" : "map") : []), [view, satellite]);
  return (
    <>
      {defs.map((d) => (
        <RasterSource
          key={d.id}
          id={`cpb-${d.id}`}
          tiles={[d.tiles]}
          tileSize={d.tileSize}
          minzoom={d.minzoom}
          maxzoom={d.maxzoom}
          attribution={d.attribution}
        >
          <Layer
            type="raster"
            id={`cpb-${d.id}-layer`}
            beforeId={anchorFor(d)}
            minzoom={d.minzoom}
            paint={{ "raster-fade-duration": 0 }}
          />
        </RasterSource>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Hindernisse
// ---------------------------------------------------------------------------

const OBSTACLE_ICONS = {
  "obs-wind": require("../../../assets/obstacles/wind.png"),
  "obs-pmast": require("../../../assets/obstacles/pmast.png"),
  "obs-chimney": require("../../../assets/obstacles/chimney.png"),
  "obs-tower": require("../../../assets/obstacles/tower.png"),
  "obs-tower_fernmelde": require("../../../assets/obstacles/tower_fernmelde.png"),
  "obs-mast": require("../../../assets/obstacles/mast.png"),
};

/** Ab dieser Zoomstufe werden Hindernisse geladen und gezeigt (wie KMZ-Tool) */
export const OBSTACLE_MIN_ZOOM = 11;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Farben/Breiten wie lineClass() im KMZ-Tool
const LINE_COLOR: any = [
  "match", ["get", "c"],
  "hoes", "#6a1b9a",
  "hs", "#8e24aa",
  "ms", "#ef6c00",
  "unk_line", "#8e24aa",
  "#6d7a86",
];
const LINE_WIDTH: any = [
  "match", ["get", "c"],
  "hoes", 4,
  "hs", 3,
  "ms", 2.2,
  "unk_line", 2.5,
  1.5,
];

export function ObstacleLayer({ view, zoom }: { view: LngLatBox | null; zoom: number }) {
  const [enabled, setEnabled] = useState(true);
  const [data, setData] = useState<GeoJSON.FeatureCollection>(EMPTY);
  const reqId = useRef(0);

  useEffect(() => {
    getObstaclesEnabled().then(setEnabled);
    return onObstaclesEnabledChange(setEnabled);
  }, []);

  // Laden, wenn der Ausschnitt sich ändert (leicht verzögert)
  const viewKey = view ? view.map((v) => v.toFixed(3)).join(",") : "";
  useEffect(() => {
    if (!enabled || !view || zoom < OBSTACLE_MIN_ZOOM) return;
    const id = ++reqId.current;
    const timer = setTimeout(() => {
      // etwas Rand, damit beim Verschieben nichts aufblitzt
      const padX = (view[2] - view[0]) * 0.25;
      const padY = (view[3] - view[1]) * 0.25;
      loadObstaclesForBounds(view[0] - padX, view[1] - padY, view[2] + padX, view[3] + padY)
        .then((fc) => {
          if (id === reqId.current) setData(fc);
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, viewKey, zoom >= OBSTACLE_MIN_ZOOM]);

  if (!enabled) return null;

  return (
    <>
      <Images images={OBSTACLE_ICONS} />
      <GeoJSONSource id="cp-obstacles" data={data}>
        {/* Bahn: klassische Signatur schwarz-weiß (ab Zoom 12) */}
        <Layer
          type="line"
          id="cp-obs-rail-base"
          minzoom={12}
          filter={["==", ["get", "k"], "rail"]}
          paint={{ "line-color": "#2b2f36", "line-width": 4.5 }}
        />
        <Layer
          type="line"
          id="cp-obs-rail-dash"
          minzoom={12}
          filter={["==", ["get", "k"], "rail"]}
          paint={{ "line-color": "#ffffff", "line-width": 2.2, "line-dasharray": [4, 4] }}
        />
        {/* Freileitungen: durchgezogen bzw. gestrichelt je nach Klasse */}
        <Layer
          type="line"
          id="cp-obs-line"
          minzoom={OBSTACLE_MIN_ZOOM}
          filter={["all", ["==", ["get", "k"], "line"], ["in", ["get", "c"], ["literal", ["hoes", "hs", "ms"]]]]}
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": LINE_COLOR, "line-width": LINE_WIDTH }}
        />
        <Layer
          type="line"
          id="cp-obs-line-dash"
          minzoom={OBSTACLE_MIN_ZOOM}
          filter={["all", ["==", ["get", "k"], "line"], ["!", ["in", ["get", "c"], ["literal", ["hoes", "hs", "ms"]]]]]}
          layout={{ "line-join": "round" }}
          paint={{ "line-color": LINE_COLOR, "line-width": LINE_WIDTH, "line-dasharray": [3, 2] }}
        />
        {/* Symbole: Windräder ab 11, Bauwerke mit Höhe ab 11, ohne Höhe und Strommasten ab 14 */}
        <Layer
          type="symbol"
          id="cp-obs-icons"
          minzoom={OBSTACLE_MIN_ZOOM}
          filter={[
            "all",
            ["!", ["in", ["get", "k"], ["literal", ["line", "rail"]]]],
            [
              "any",
              ["==", ["get", "k"], "wind"],
              ["all", ["!=", ["get", "k"], "pmast"], [">", ["get", "h"], 0]],
              [">=", ["zoom"], 14],
            ],
          ]}
          layout={{
            "icon-image": ["concat", "obs-", ["get", "k"]],
            "icon-size": 1,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "symbol-sort-key": ["-", 0, ["get", "h"]],
          }}
        />
        {/* Höhe unter dem Symbol (ab Zoom 13), wie „↑ 200 m hoch" im KMZ-Tool */}
        <Layer
          type="symbol"
          id="cp-obs-height"
          minzoom={13}
          filter={["all", [">", ["get", "h"], 0], ["!", ["in", ["get", "k"], ["literal", ["line", "rail"]]]]]}
          layout={{
            "text-field": ["get", "label"],
            "text-font": LABEL_FONT,
            "text-size": 11,
            "text-offset": [0, 1.7],
            "text-anchor": "top",
            "text-allow-overlap": false,
          }}
          paint={{
            "text-color": "#222222",
            "text-halo-color": "rgba(255,255,255,0.95)",
            "text-halo-width": 2,
          }}
        />
      </GeoJSONSource>
    </>
  );
}
