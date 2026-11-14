import assert from "node:assert/strict";
import { test } from "node:test";
import { GRAYSCALE_BASEMAP_TILE_URL, nativeMapBasemapProps } from "../mapBasemap";

test("grayscale basemaps desaturate the native map background without changing overlay props", () => {
  const ios = nativeMapBasemapProps("grayscale", "ios");
  assert.equal(ios.mapType, "mutedStandard");
  assert.equal(ios.customMapStyle, undefined);

  const android = nativeMapBasemapProps("grayscale", "android");
  assert.equal(android.mapType, "standard");
  assert.ok(android.customMapStyle?.some((entry: any) =>
    entry.stylers?.some((styler: any) => styler.saturation === -100),
  ));
  assert.match(GRAYSCALE_BASEMAP_TILE_URL, /World_Light_Gray_Base/);
});

test("satellite selection remains unchanged on both native platforms", () => {
  assert.equal(nativeMapBasemapProps("satellite", "ios").mapType, "hybridFlyover");
  assert.equal(nativeMapBasemapProps("satellite", "android").mapType, "hybrid");
});