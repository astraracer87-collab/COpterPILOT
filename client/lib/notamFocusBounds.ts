// Begrenzungsrahmen einer NOTAM-Fläche, damit die Karte beim Fokussieren die ganze Fläche zeigt.
// Rein, ohne React-Native-Importe (unter tsx testbar).

export interface FocusOverlayGeometry {
  groups?: [number, number][][][];
  center?: [number, number];
  radiusM?: number;
}

export interface LatLonBox { minLat: number; maxLat: number; minLon: number; maxLon: number }

function validPoint(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function overlayBounds(o: FocusOverlayGeometry): LatLonBox | null {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const add = (lat: number, lon: number) => {
    if (!validPoint(lat, lon)) return;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  };
  for (const group of o.groups ?? []) for (const [lat, lon] of group[0] ?? []) add(lat, lon);
  if (!Number.isFinite(minLat) && o.center && validPoint(o.center[0], o.center[1])) {
    const r = o.radiusM ?? 5000;
    const dLat = r / 111_320;
    const dLon = r / (111_320 * Math.max(0.01, Math.cos((o.center[0] * Math.PI) / 180)));
    add(o.center[0] - dLat, o.center[1] - dLon);
    add(o.center[0] + dLat, o.center[1] + dLon);
  }
  return Number.isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;
}
