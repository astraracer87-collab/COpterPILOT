// React-Hook: Länder mit vollständigem Offline-Kachelspeicher (DE/FR/CZ).
// Aktualisiert sich, wenn ein Download fertig wird oder ein Bestand gelöscht wird.
import { useEffect, useState } from "react";
import { loadTileStoreMeta, onTileStoreChange, tiledGeozoneIsos } from "./tileStore";

export function useTiledGeozoneIsos(): Set<string> {
  const [isos, setIsos] = useState<Set<string>>(() => new Set(tiledGeozoneIsos()));
  useEffect(() => {
    const update = () =>
      setIsos((prev) => {
        const next = tiledGeozoneIsos();
        return next.length === prev.size && next.every((i) => prev.has(i)) ? prev : new Set(next);
      });
    const off = onTileStoreChange(update);
    loadTileStoreMeta().then(update).catch(() => {});
    return off;
  }, []);
  return isos;
}
