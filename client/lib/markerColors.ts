export function getMarkerPinColor(alt: number | null | undefined): string {
  if (alt == null) return "orange";
  if (alt < 150) return "red";
  if (alt < 500) return "orange";
  return "#42A5F5";
}
