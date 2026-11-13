import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AircraftState } from "../lib/opensky";
import { categoryLabel, altitudeDisplay, speedDisplay } from "../lib/opensky";
import { LAYER_GROUPS } from "../lib/geozoneLayers";

function colorForAlert(level: "none" | "warn" | "critical"): string {
  if (level === "critical") return "#dc2626";
  if (level === "warn") return "#f59e0b";
  return "#0a4d8c";
}

function aircraftIconHtml(heading: number, color: string): string {
  return `
<div style="transform: rotate(${heading}deg); width: 22px; height: 22px;">
  <svg viewBox="-10 -10 20 20" width="22" height="22" style="display:block">
    <polygon points="0,-8 6,7 0,3 -6,7" fill="${color}" stroke="white" stroke-width="1" />
  </svg>
</div>`;
}

const BASE_STORAGE_KEY = "copterpilot.web.radar.map.baseLayer";
const OVERLAY_STORAGE_KEY = "copterpilot.web.radar.map.overlays";

function loadBaseLayer(): string {
  try {
    return localStorage.getItem(BASE_STORAGE_KEY) || "Karte";
  } catch {
    return "Karte";
  }
}

function defaultOverlayState(): Record<string, boolean> {
  const init: Record<string, boolean> = {};
  for (const g of LAYER_GROUPS) {
    if (g.country !== "DE") continue;
    for (const l of g.layers) if (l.defaultEnabled) init[l.id] = true;
  }
  return init;
}

function loadOverlayState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OVERLAY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const cleaned: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "boolean") cleaned[k] = v;
        }
        return cleaned;
      }
    }
  } catch {}
  return defaultOverlayState();
}

function saveOverlayState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export interface TrafficMapProps {
  latitude: number;
  longitude: number;
  aircraft: AircraftState[];
  warnRadiusKm: number;
  criticalRadiusKm: number;
  height?: number | string;
  alertIcaos?: Set<string>;
  criticalIcaos?: Set<string>;
  /** Callback wenn der Pilot auf die Karte klickt, um den Standort zu verschieben. */
  onMapClick?: (lat: number, lon: number) => void;
}

export default function TrafficMap(props: TrafficMapProps) {
  const {
    latitude,
    longitude,
    aircraft,
    warnRadiusKm,
    criticalRadiusKm,
    height = 360,
    alertIcaos,
    criticalIcaos,
    onMapClick,
  } = props;
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const meRef = useRef<L.Marker | null>(null);
  const warnRef = useRef<L.Circle | null>(null);
  const critRef = useRef<L.Circle | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom: 11,
      zoomControl: true,
      attributionControl: true,
    });

    // Base layers: street, terrain (topo), satellite
    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution:
        'Karte: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), Daten: &copy; OSM-Mitwirkende, SRTM',
    });
    const sat = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri",
      },
    );
    const baseLayers: Record<string, L.TileLayer> = {
      Karte: osm,
      Geländekarte: topo,
      Satellit: sat,
    };
    const initialBaseName = loadBaseLayer();
    const initialBase = baseLayers[initialBaseName] || osm;
    initialBase.addTo(map);

    // Geozone WMS overlays
    const overlayState = loadOverlayState();
    const overlays: Record<string, L.Layer> = {};
    const overlayIdByName: Record<string, string> = {};
    for (const group of LAYER_GROUPS) {
      for (const l of group.layers) {
        const wms = L.tileLayer.wms(l.baseUrl, {
          layers: l.layer,
          format: l.format || "image/png",
          version: l.version || "1.3.0",
          styles: l.styles || "",
          transparent: true,
          opacity: 0.55,
          attribution: l.label,
        });
        const displayName = `${group.country} · ${l.label}`;
        overlays[displayName] = wms;
        overlayIdByName[displayName] = l.id;
        if (overlayState[l.id]) wms.addTo(map);
      }
    }

    L.control.layers(baseLayers, overlays, { position: "topright", collapsed: true }).addTo(map);

    map.on("baselayerchange", (e: L.LayersControlEvent) => {
      try {
        localStorage.setItem(BASE_STORAGE_KEY, e.name);
      } catch {}
    });
    const persistOverlays = () => {
      const next: Record<string, boolean> = {};
      for (const [name, id] of Object.entries(overlayIdByName)) {
        next[id] = map.hasLayer(overlays[name]);
      }
      saveOverlayState(next);
    };
    map.on("overlayadd", persistOverlays);
    map.on("overlayremove", persistOverlays);

    const meIcon = L.divIcon({
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#0a4d8c;border:2px solid white;box-shadow:0 0 0 2px rgba(10,77,140,0.3)"></div>`,
      className: "",
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    meRef.current = L.marker([latitude, longitude], { icon: meIcon, interactive: false }).addTo(map);
    warnRef.current = L.circle([latitude, longitude], {
      radius: warnRadiusKm * 1000,
      color: "#f59e0b",
      weight: 1,
      fillColor: "#f59e0b",
      fillOpacity: 0.05,
      dashArray: "4 3",
      interactive: false,
    }).addTo(map);
    critRef.current = L.circle([latitude, longitude], {
      radius: criticalRadiusKm * 1000,
      color: "#dc2626",
      weight: 1,
      fillColor: "#dc2626",
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      const cb = onMapClickRef.current;
      if (cb) cb(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    // Ensure proper sizing once layout settles
    setTimeout(() => map.invalidateSize(), 50);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([latitude, longitude], map.getZoom() || 11, { animate: false });
    meRef.current?.setLatLng([latitude, longitude]);
    warnRef.current?.setLatLng([latitude, longitude]);
    critRef.current?.setLatLng([latitude, longitude]);
  }, [latitude, longitude]);

  useEffect(() => {
    warnRef.current?.setRadius(warnRadiusKm * 1000);
    critRef.current?.setRadius(criticalRadiusKm * 1000);
  }, [warnRadiusKm, criticalRadiusKm]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const ac of aircraft) {
      seen.add(ac.icao24);
      const isCrit = criticalIcaos?.has(ac.icao24) ?? false;
      const isWarn = !isCrit && (alertIcaos?.has(ac.icao24) ?? false);
      const level = isCrit ? "critical" : isWarn ? "warn" : "none";
      const color = colorForAlert(level);
      const heading = ac.trueTrack ?? 0;
      const icon = L.divIcon({
        html: aircraftIconHtml(heading, color),
        className: "",
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const popup = `
<div style="font-size:12px">
  <div style="font-weight:600">${ac.callsign || ac.icao24}</div>
  <div style="color:#64748b">${categoryLabel(ac.category)}</div>
  <div>Höhe: ${altitudeDisplay(ac)}</div>
  <div>Geschw.: ${speedDisplay(ac)}</div>
  <div>Quellen: ${ac.sources.join(", ")}</div>
</div>`;
      const existing = markersRef.current.get(ac.icao24);
      if (existing) {
        existing.setLatLng([ac.latitude, ac.longitude]);
        existing.setIcon(icon);
        existing.setPopupContent(popup);
      } else {
        const m = L.marker([ac.latitude, ac.longitude], { icon }).addTo(map);
        m.bindPopup(popup);
        markersRef.current.set(ac.icao24, m);
      }
    }
    for (const [k, m] of markersRef.current) {
      if (!seen.has(k)) {
        map.removeLayer(m);
        markersRef.current.delete(k);
      }
    }
  }, [aircraft, alertIcaos, criticalIcaos]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height }}
      className="rounded-md overflow-hidden border border-slate-200 bg-slate-100"
    />
  );
}
