// Manuelles Messskript (kein Test): lädt einen Bestand live mit dem echten
// Kachelspeicher-Code in einen lokalen Ordner und gibt Größen/Zeiten aus.
//   NODE_USE_ENV_PROXY=1 npx -y tsx --tsconfig tsconfig.json client/lib/__tests__/helpers/liveTileStore.ts <ISO> <dir> [wohn]
import { createNodeTileFs } from "./nodeTileFs";
import {
  __setTileStoreEnvForTests,
  downloadTileStore,
  getTilePartMeta,
  queryTiledGeozones,
  queryTiledGeozonesAtPoint,
} from "../../geozoneTiles/tileStore";
import { bboxAround } from "../../geozoneTiles/tileStoreCore";

async function main() {
  const [iso, dir, wohn] = process.argv.slice(2);
  __setTileStoreEnvForTests({ fs: createNodeTileFs(dir), isOffline: () => false, isWifi: async () => true });
  const t0 = Date.now();
  let last = 0;
  const res = await downloadTileStore(iso, {
    wohn: wohn === "wohn",
    onProgress: (p) => {
      if (Date.now() - last > 10000 || p.state !== "active") {
        last = Date.now();
        console.log(`${p.part} ${p.done}/${p.total} ${(p.bytes / 1e6).toFixed(1)} MB ${p.state} ${p.error ?? ""} t=${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    },
  });
  console.log(JSON.stringify(res));
  for (const part of ["base", "wohn"] as const) {
    const m = getTilePartMeta(iso, part);
    if (m) console.log(part, "count", m.count, "stored MB", (m.dataBytes / 1e6).toFixed(1), m.source);
  }
  const probes: Record<string, [number, number]> = { DE: [48.137, 11.575], FR: [48.8566, 2.3522], CZ: [50.0755, 14.4378] };
  const [lat, lon] = probes[iso];
  let t = Date.now();
  const pt = await queryTiledGeozonesAtPoint(iso, lat, lon);
  console.log("point zones", pt?.length, `${Date.now() - t} ms`, pt?.slice(0, 6).map((z) => `${z.layerLabel}: ${z.name}`));
  t = Date.now();
  const area = await queryTiledGeozones(iso, bboxAround(lat, lon, 10), { limit: 1200 });
  console.log("area 10km zones", area?.length, `${Date.now() - t} ms`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
