// Automatischer Import neuer DJI-Flugprotokolle aus dem freigegebenen Ordner.
// Läuft beim App-Start und wenn die App wieder in den Vordergrund kommt
// (höchstens alle 5 min). Android erlaubt für SAF-Ordner keine echte
// Hintergrund-Überwachung.
import { analyzeDjiLogFiles, assignDjiLog, listDjiLogsInFolder, removeDuplicateDjiLogEntries } from "./djiLog";
import { groupDjiAnalyses } from "./djiLogCore";
import {
  getDjiLogAutoImport,
  getDjiLogFolder,
  isFolderImportSupported,
  knownDjiLogNames,
  refreshDjiLogNewHint,
  setDjiLogAutoImported,
} from "./djiLogFolder";
import { computeMatches } from "./djiLogMatch";
import { getLogbook } from "./storage";

const MIN_INTERVAL_MS = 5 * 60 * 1000;
let running: Promise<DjiAutoImportResult | null> | null = null;
let lastRunAt = 0;
/** In dieser Sitzung nicht auswertbar (z. B. ohne DJI-Schlüssel) – nicht ständig neu versuchen */
const failedNames = new Set<string>();

export interface DjiAutoImportResult {
  attached: number;
  created: number;
  failed: number;
}

export function runDjiLogAutoImport(opts: { force?: boolean } = {}): Promise<DjiAutoImportResult | null> {
  if (running) return running;
  if (!opts.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return Promise.resolve(null);
  running = doImport()
    .catch(() => null)
    .finally(() => {
      lastRunAt = Date.now();
      running = null;
    });
  return running;
}

async function doImport(): Promise<DjiAutoImportResult | null> {
  // früher doppelt importierte Flüge aufräumen
  await removeDuplicateDjiLogEntries().catch(() => 0);
  if (!isFolderImportSupported() || !(await getDjiLogAutoImport())) return null;
  const uri = await getDjiLogFolder();
  if (!uri) return null;
  const known = await knownDjiLogNames();
  const todo = (await listDjiLogsInFolder(uri)).filter((f) => {
    const n = f.name.toLowerCase();
    return !known.has(n) && !failedNames.has(n);
  });
  if (todo.length === 0) {
    await refreshDjiLogNewHint().catch(() => null);
    return { attached: 0, created: 0, failed: 0 };
  }
  const analysis = await analyzeDjiLogFiles(todo);
  for (const e of analysis.errors) failedNames.add(e.fileName.toLowerCase());
  const result: DjiAutoImportResult = { attached: 0, created: 0, failed: analysis.errors.length };
  if (analysis.results.length > 0) {
    let entries = await getLogbook();
    for (const group of groupDjiAnalyses(analysis.results, { maxKm: 2, maxHours: 3 })) {
      try {
        // Nur eine eindeutige, starke Übereinstimmung (gleiche Drohne, ≤ 1 h, ≤ 500 m) anhängen
        const strong = computeMatches(group, entries).filter((m) => m.isStrong);
        let entryId = strong.length === 1 ? strong[0].entry.id : null;
        const [first, ...rest] = group.items;
        if (entryId) {
          await assignDjiLog({ meta: first.meta, target: "existing", entryId });
          result.attached += 1;
        } else {
          entryId = (await assignDjiLog({ meta: first.meta, target: "new" })).id;
          result.created += 1;
        }
        for (const item of rest) {
          await assignDjiLog({ meta: item.meta, target: "existing", entryId });
          result.attached += 1;
        }
        entries = await getLogbook();
      } catch {
        result.failed += group.items.length;
      }
    }
  }
  const total = result.attached + result.created;
  if (total > 0) setDjiLogAutoImported(total);
  await refreshDjiLogNewHint().catch(() => null);
  return result;
}
