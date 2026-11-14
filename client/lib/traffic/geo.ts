// Geometrie-Hilfsfunktionen für die Verkehrs-Aggregation.

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function quickDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/** Grobe Peilung (flache Näherung) — nur für Trail-/Fuzzy-Heuristiken. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;
  const angle = Math.atan2(dLon * Math.cos((lat2 * Math.PI) / 180), dLat) * (180 / Math.PI);
  return (angle + 360) % 360;
}

/** Exakte Großkreis-Anfangspeilung vom Piloten zum Luftfahrzeug. */
export function bearingFromTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const lat1r = (lat1 * Math.PI) / 180;
  const lat2r = (lat2 * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}
