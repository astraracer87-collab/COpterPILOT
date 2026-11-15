// Node-fs-Adapter für den Geozonen-Kachelspeicher (Tests und Messskripte).
import * as nodeFs from "node:fs";
import * as path from "node:path";
import type { TileFs } from "../../geozoneTiles/tileStore";

export function createNodeTileFs(rootDir: string, fetchImpl: typeof fetch = globalThis.fetch): TileFs {
  const root = rootDir.endsWith("/") ? rootDir : `${rootDir}/`;
  const strip = (p: string) => p.replace(/\/$/, "");
  return {
    root: () => root,
    async exists(p) {
      return nodeFs.existsSync(strip(p));
    },
    async readText(p) {
      return nodeFs.existsSync(p) ? nodeFs.readFileSync(p, "utf8") : null;
    },
    async writeText(p, text) {
      nodeFs.mkdirSync(path.dirname(p), { recursive: true });
      nodeFs.writeFileSync(`${p}.tmp`, text);
      nodeFs.renameSync(`${p}.tmp`, p);
    },
    async appendBytes(p, bytes) {
      nodeFs.mkdirSync(path.dirname(p), { recursive: true });
      nodeFs.appendFileSync(p, bytes);
    },
    async size(p) {
      return nodeFs.existsSync(p) ? nodeFs.statSync(p).size : 0;
    },
    async readRanges(p, ranges) {
      const fd = nodeFs.openSync(p, "r");
      try {
        return ranges.map(([off, len]) => {
          const buf = Buffer.alloc(len);
          nodeFs.readSync(fd, buf, 0, len, off);
          return new Uint8Array(buf.buffer, buf.byteOffset, len);
        });
      } finally {
        nodeFs.closeSync(fd);
      }
    },
    async readBytes(p) {
      return new Uint8Array(nodeFs.readFileSync(p));
    },
    async download(url, p) {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      nodeFs.mkdirSync(path.dirname(p), { recursive: true });
      nodeFs.writeFileSync(p, buf);
      return buf.length;
    },
    async remove(p) {
      nodeFs.rmSync(strip(p), { recursive: true, force: true });
    },
    async move(from, to) {
      nodeFs.mkdirSync(path.dirname(strip(to)), { recursive: true });
      nodeFs.renameSync(strip(from), strip(to));
    },
    async mkdirp(p) {
      nodeFs.mkdirSync(strip(p), { recursive: true });
    },
  };
}
