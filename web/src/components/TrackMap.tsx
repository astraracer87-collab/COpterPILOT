import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface TrackPoint {
  lat: number;
  lon: number;
  alt?: number;
  ts?: number;
}

export interface TrackMapProps {
  track: TrackPoint[];
  fallbackLat?: number | null;
  fallbackLon?: number | null;
  height?: number | string;
}

export default function TrackMap({ track, fallbackLat, fallbackLon, height = 280 }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const center: [number, number] =
      track.length > 0
        ? [track[0].lat, track[0].lon]
        : fallbackLat != null && fallbackLon != null
          ? [fallbackLat, fallbackLon]
          : [51.16, 10.45];

    const map = L.map(containerRef.current, {
      center,
      zoom: 14,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    if (track.length >= 2) {
      const latlngs: L.LatLngTuple[] = track.map((p) => [p.lat, p.lon]);
      const line = L.polyline(latlngs, { color: "#0a4d8c", weight: 4, opacity: 0.85 }).addTo(map);

      const startIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#16a34a;border:2px solid white;box-shadow:0 0 0 2px rgba(22,163,74,0.3)"></div>`,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const endIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#dc2626;border:2px solid white;box-shadow:0 0 0 2px rgba(220,38,38,0.3)"></div>`,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker(latlngs[0], { icon: startIcon }).addTo(map).bindPopup("Start");
      L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map).bindPopup("Landung");

      map.fitBounds(line.getBounds(), { padding: [24, 24] });
    } else if (fallbackLat != null && fallbackLon != null) {
      const meIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#0a4d8c;border:2px solid white;box-shadow:0 0 0 2px rgba(10,77,140,0.3)"></div>`,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker([fallbackLat, fallbackLon], { icon: meIcon }).addTo(map);
    }

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height }}
      className="rounded-md overflow-hidden border border-slate-200 bg-slate-100"
    />
  );
}
