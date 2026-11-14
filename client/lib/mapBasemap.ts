import type { MapStyleOption } from "./geozones";

// Android uses Google Maps custom styling. On iOS, MapKit's muted standard
// style is the closest supported desaturated basemap; vector/tile overlays are
// separate MapView children and therefore keep their original colors.
const ANDROID_GRAYSCALE_STYLE = [
  { elementType: "geometry", stylers: [{ saturation: -100 }] },
  { elementType: "labels.icon", stylers: [{ saturation: -100 }] },
  { elementType: "labels.text.fill", stylers: [{ saturation: -100 }] },
  { elementType: "labels.text.stroke", stylers: [{ saturation: -100 }] },
];

export function nativeMapBasemapProps(style: MapStyleOption, platform: string) {
  const isIOS = platform === "ios";
  const isSatellite = style === "satellite";
  const isGrayscale = style === "grayscale";

  return {
    mapType: (isSatellite
      ? (isIOS ? "hybridFlyover" : "hybrid")
      : isGrayscale && isIOS
        ? "mutedStandard"
        : "standard") as any,
    customMapStyle: isGrayscale && !isIOS ? ANDROID_GRAYSCALE_STYLE : undefined,
  };
}

export const GRAYSCALE_BASEMAP_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";