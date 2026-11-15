// Teil A: Geozonen zweigleisig (stale-while-revalidate) – lokaler Bestand
// zuerst, Hintergrund-Aktualisierung ersetzt ihn, Ereignis bei neuen Daten,
// Urteilswechsel-Hinweis; dauerhafte vs. temporäre Schwellen; WLAN-Regel für
// große Pakete; AIRAC-/Trefferzahl-Versionsprüfung.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  __setRevalidateEnvForTests,
  ed269RefreshThresholdMs,
  getPendingWifiUpdates,
  isRelevantGeozoneChange,
  onGeozoneDataChanged,
  revalidateGeozoneSources,
  type RevalidateEnv,
} from "../geozoneSources/revalidate";
import { __resetEd269StoreForTests, importEd269Dataset } from "../geozoneDirect/ed269Store";
import { queryEd269CachedFeaturesWithStatusFrom, storedCoverageStatus } from "../geozoneCoverage";
import {
  __setTileStoreEnvForTests,
  getDeTempFeatures,
  getDeTempStatus,
  loadTileStoreMeta,
  tileStoreVersionCheck,
} from "../geozoneTiles/tileStore";
import { AIRAC_CYCLE_MS, airacCycleStart, isBeforeCurrentAirac } from "../geozoneTiles/tileStoreCore";
import { getSourceDataStatus } from "../geozoneSources/registry";
import { createNodeTileFs } from "./helpers/nodeTileFs";
import {
  isLargeGeozoneDataset,
  isSourceDataStale,
  isTemporaryDataStale,
  temporarySourceOf,
  TEMPORARY_ZONES_STALE_NOTE,
} from "../../../shared/geozoneSourceMeta";
import { isTemporaryGeozone, isTemporaryGeozoneProps } from "../../../shared/geozoneTemporary";
import {
  aggregate,
  coverageChecks,
  INITIAL_VERDICT_WATCH,
  verdictChangeMessage,
  verdictWatchReducer,
  type VerdictWatchState,
} from "../../../shared/checks";
import { evaluateZones } from "../flightChecks";
import { __setLargePacksOnMobileForTests } from "../geozoneSources/largePackSetting";

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

// ---------------------------------------------------------------------------
// Dauerhaft vs. temporär
// ---------------------------------------------------------------------------

describe("Teil A: dauerhafte vs. temporäre Zonen – Schwellen", () => {
  const now = Date.UTC(2026, 10, 15, 12);

  it("Registry: dauerhafte Zonen Warnung erst nach 28 Tagen, temporäre nach 24 h", () => {
    assert.equal(isSourceDataStale("AT", now - 2 * DAY, now), false);
    assert.equal(isSourceDataStale("AT", now - 29 * DAY, now), true);
    assert.equal(isTemporaryDataStale("AT", now - 23 * H, now), false);
    assert.equal(isTemporaryDataStale("AT", now - 25 * H, now), true);
    // FR-Karte, CZ-Paket, MT-/GR-Import, HU: keine temporären Zonen
    for (const iso of ["FR", "CZ", "MT", "GR", "HU"]) assert.equal(isTemporaryDataStale(iso, 0, now), false, iso);
    // RO lädt seit 2026-11 online inkl. NOTAM-UAV (temporär im Bestand)
    assert.equal(temporarySourceOf("RO"), "dataset");
    assert.equal(temporarySourceOf("DE"), "separate");
    assert.equal(temporarySourceOf("AT"), "dataset");
    assert.equal(temporarySourceOf("IT"), "dataset");
    assert.equal(temporarySourceOf("FR"), "none");
    assert.deepEqual(["DE", "FR", "CZ", "NL", "AT"].map(isLargeGeozoneDataset), [true, true, true, true, false]);
  });

  it("Abdeckung: < 24 h ok; temporäre > 24 h → partial „Temporäre Beschränkungen nicht aktuell“ → unbekannt (CAUTION); > 28 Tage → stale", () => {
    assert.deepEqual(storedCoverageStatus("AT", now - 5 * H, now - 5 * H, now), { status: "ok" });
    const partial = storedCoverageStatus("AT", now - 30 * H, now - 30 * H, now);
    assert.equal(partial.status, "partial");
    assert.match(partial.note!, new RegExp(`^${TEMPORARY_ZONES_STALE_NOTE}`));
    const checks = coverageChecks({ context: "planning", sources: [{ iso: "AT", status: "partial", fetchedAt: now - 30 * H, note: partial.note }], countryLabel: () => "Österreich", now });
    assert.equal(checks[0].severity, "unknown");
    assert.match(checks[0].title, /unvollständig: Temporäre Beschränkungen nicht aktuell/);
    assert.equal(aggregate(checks).verdict, "caution");
    assert.equal(storedCoverageStatus("AT", now - 29 * DAY, now - 29 * DAY, now).status, "stale");
    // Bestand ohne temporäre Zonen (Import, FR-Paket): nur 28-Tage-Regel
    assert.deepEqual(storedCoverageStatus("AT", now - 30 * H, undefined, now), { status: "ok" });
    assert.deepEqual(storedCoverageStatus("FR", now - 3 * DAY, now - 3 * DAY, now), { status: "ok" });
    // DE: temporäre Beschränkungen nie geladen → partial
    assert.equal(storedCoverageStatus("DE", now - 3 * DAY, null, now).status, "partial");
  });

  it("Regel „temporär“ je Zone: NOTAM-Flags, Temporär-Ebene, Fenster < 30 Tage", () => {
    assert.equal(isTemporaryGeozoneProps({ isNotam: true }, "EE"), true);
    assert.equal(isTemporaryGeozoneProps({ _live: true }, "BE"), true); // notamFromLiveFlag
    assert.equal(isTemporaryGeozoneProps({ _live: true }, "DK"), false);
    assert.equal(isTemporaryGeozoneProps({ validStartTs: now, validEndTs: now + 3 * DAY }, "DK"), true);
    assert.equal(isTemporaryGeozoneProps({ validStartTs: now, validEndTs: now + 90 * DAY }, "DK"), false);
    assert.equal(isTemporaryGeozoneProps({ permanent: "YES" }, "AT"), false);
    assert.equal(isTemporaryGeozone({ layerLabel: "Temporäre Beschränkungen" }), true);
    assert.equal(isTemporaryGeozone({ layerLabel: "Kontrollzonen" }), false);
    assert.equal(isTemporaryGeozone({ notamEligible: true }), true);
    assert.equal(isTemporaryGeozone({ validStartTs: now, validEndTs: now + DAY }), true);
  });

  it("Neuladen je Zweck: Prüfung (temporäre ≤ 10 min) vs. Karte (6 h); großer Feed (NL) nur 6 h", () => {
    assert.equal(ed269RefreshThresholdMs("AT", "check"), 10 * MIN);
    assert.equal(ed269RefreshThresholdMs("AT", "map"), 6 * H);
    assert.equal(ed269RefreshThresholdMs("NL", "check"), 6 * H);
    assert.equal(ed269RefreshThresholdMs("AT", "manual"), 0);
  });
});

// ---------------------------------------------------------------------------
// Orchestrierung mit gemockter Umgebung (Netz/Zeit)
// ---------------------------------------------------------------------------

describe("Teil A: Hintergrund-Aktualisierung (revalidateGeozoneSources)", () => {
  let now = Date.UTC(2026, 10, 15, 12);
  let storedAt: Record<string, number | null> = {};
  let refreshed: string[] = [];
  let downloads: string[] = [];
  let tempRefresh: boolean[] = [];
  let offline = false;
  let wifi = false;
  let mobileAllowed = false;
  let refreshOk = true;
  let due: Record<string, boolean> = {};
  let packs = new Set<string>();

  const env = (): Partial<RevalidateEnv> => ({
    now: () => now,
    isOffline: () => offline,
    isWifi: async () => wifi,
    largePacksOnMobile: async () => mobileAllowed,
    ed269StoredAt: async (iso) => storedAt[iso] ?? null,
    ed269Refresh: async (iso) => { refreshed.push(iso); if (refreshOk) storedAt[iso] = now; return refreshOk; },
    tilesHas: (iso) => packs.has(iso),
    tilesVersionCheck: async (iso) => ({ due: !!due[iso], reason: due[iso] ? "airac" : null }),
    tilesDownload: async (iso) => { downloads.push(iso); return true; },
    deTempRefresh: async (force) => { tempRefresh.push(force); },
  });

  beforeEach(() => {
    now = Date.UTC(2026, 10, 15, 12);
    storedAt = {};
    refreshed = [];
    downloads = [];
    tempRefresh = [];
    offline = false;
    wifi = false;
    mobileAllowed = false;
    refreshOk = true;
    due = {};
    packs = new Set();
    __setRevalidateEnvForTests(env());
  });
  afterEach(() => __setRevalidateEnvForTests(null));

  it("kleines ED-269-Land: Karte erst nach 6 h, Prüfung nach 10 min neu laden; offline nie", async () => {
    storedAt.AT = now - 15 * MIN;
    assert.deepEqual(await revalidateGeozoneSources(["AT"], "map"), [{ iso: "AT", action: "fresh" }]);
    assert.deepEqual(refreshed, []);
    assert.equal((await revalidateGeozoneSources(["AT"], "check"))[0].action, "refreshed");
    assert.deepEqual(refreshed, ["AT"]);
    now += 7 * H;
    assert.equal((await revalidateGeozoneSources(["AT"], "map"))[0].action, "refreshed");
    offline = true;
    now += 7 * H;
    assert.equal((await revalidateGeozoneSources(["AT"], "check"))[0].action, "offline");
    assert.equal(refreshed.length, 2);
  });

  it("Land ohne Bestand: Datensatz wird geladen; LI → CH; Fehlschlag wird gedrosselt", async () => {
    const r = await revalidateGeozoneSources(["LI", "CH"], "map");
    assert.deepEqual(r, [{ iso: "CH", action: "refreshed" }]);
    refreshOk = false;
    assert.equal((await revalidateGeozoneSources(["DK"], "check"))[0].action, "refresh-failed");
    assert.equal((await revalidateGeozoneSources(["DK"], "check"))[0].action, "throttled");
    now += 3 * MIN;
    assert.equal((await revalidateGeozoneSources(["DK"], "check"))[0].action, "refresh-failed");
    // „Jetzt aktualisieren“ ignoriert die Drossel
    assert.equal((await revalidateGeozoneSources(["DK"], "manual"))[0].action, "refresh-failed");
  });

  it("großer Feed (NL): vorhandenen Bestand nur im WLAN bzw. mit Erlaubnis für mobile Daten erneuern", async () => {
    storedAt.NL = now - 7 * H;
    assert.equal((await revalidateGeozoneSources(["NL"], "map"))[0].action, "pending-wifi");
    assert.deepEqual(refreshed, []);
    assert.deepEqual(getPendingWifiUpdates(), ["NL"]);
    wifi = true;
    assert.equal((await revalidateGeozoneSources(["NL"], "map"))[0].action, "refreshed");
    assert.deepEqual(getPendingWifiUpdates(), []);
    wifi = false;
    storedAt.NL = now - 7 * H;
    mobileAllowed = true;
    assert.equal((await revalidateGeozoneSources(["NL"], "map"))[0].action, "refreshed");
  });

  it("Kachelpaket (DE/FR/CZ): erst günstige Versionsprüfung, Download nur im WLAN (außer erlaubt)", async () => {
    packs = new Set(["DE", "FR"]);
    due = { DE: true, FR: false };
    const r1 = await revalidateGeozoneSources(["DE", "FR", "CZ"], "check");
    assert.deepEqual(r1.map((x) => x.action), ["pending-wifi", "pack-current", "no-store"]);
    assert.deepEqual(downloads, []);
    assert.deepEqual(tempRefresh, [false]); // temporäre DE-Zonen online frisch (Cache ≤ 10 min)
    wifi = true;
    const r2 = await revalidateGeozoneSources(["DE"], "map");
    assert.equal(r2[0].action, "pack-updated");
    assert.deepEqual(downloads, ["DE"]);
    // Versionsprüfung höchstens alle 30 min (ohne wartendes Update)
    due = {};
    assert.equal((await revalidateGeozoneSources(["FR"], "map"))[0].action, "pack-current");
    // mobile Daten erlaubt → auch ohne WLAN
    wifi = false;
    mobileAllowed = true;
    due = { FR: true };
    assert.equal((await revalidateGeozoneSources(["FR"], "manual"))[0].action, "pack-updated");
    assert.deepEqual(tempRefresh, [false]);
  });

  it("Ereignis-Relevanz: Land im Umkreis bzw. Kachelspeicher allgemein", () => {
    assert.equal(isRelevantGeozoneChange({ iso: "AT", kind: "ed269" }, ["DE", "AT"]), true);
    assert.equal(isRelevantGeozoneChange({ iso: "DK", kind: "ed269" }, ["DE", "AT"]), false);
    assert.equal(isRelevantGeozoneChange({ iso: "CH", kind: "ed269" }, ["LI"]), true);
    assert.equal(isRelevantGeozoneChange({ iso: null, kind: "tiles" }, ["AT", "DE"]), true);
    assert.equal(isRelevantGeozoneChange({ iso: null, kind: "tiles" }, ["AT"]), false);
  });
});

// ---------------------------------------------------------------------------
// Stale-while-revalidate mit echtem Gerätecache (Netz gemockt)
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const zoneFeature = (name: string, restriction: string, props: Record<string, any> = {}) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[16.3, 48.15], [16.45, 48.15], [16.45, 48.25], [16.3, 48.25], [16.3, 48.15]]] },
  properties: { restriction, name, ...props },
});

describe("Teil A: lokaler Bestand zuerst, Hintergrund-Aktualisierung ersetzt, Urteilswechsel-Hinweis", () => {
  beforeEach(() => __resetEd269StoreForTests());
  afterEach(() => {
    globalThis.fetch = realFetch;
    __resetEd269StoreForTests();
    __setRevalidateEnvForTests(null);
  });

  it("Antwort sofort aus dem Bestand; neuer Bestand (neue temporäre Flugverbotszone) kommt per Ereignis; Urteil GO → NO-GO wird gemeldet", async () => {
    const now = Date.now();
    // 1. Alter Bestand (7 h): nur eine Info-Zone
    await importEd269Dataset("AT", [zoneFeature("Wien-Info", "NO_RESTRICTION") as any], { source: "test", importedAt: now - 7 * H, fileName: "at.json" });

    // 2. Netz antwortet erst, wenn wir es freigeben
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      await gate;
      const start = new Date(now - H).toISOString();
      const end = new Date(now + 5 * H).toISOString();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          type: "FeatureCollection",
          features: [
            zoneFeature("Wien-Info", "NO_RESTRICTION"),
            zoneFeature("Staatsbesuch", "PROHIBITED", { applicability: [{ permanent: "NO", startDateTime: start, endDateTime: end }] }),
          ],
        }),
      } as any;
    }) as any;

    const events: string[] = [];
    const unsub = onGeozoneDataChanged((e) => events.push(`${e.kind}:${e.iso}`));

    // Erste Antwort: sofort aus dem Bestand (Download läuft im Hintergrund, älter als 6 h)
    const first = await queryEd269CachedFeaturesWithStatusFrom("", 48.2, 16.37, 10, "AT");
    assert.deepEqual(first.zones.map((z) => z.name), ["Wien-Info"]);
    assert.equal(first.fetchedAt, now - 7 * H);
    assert.equal(fetches, 1, "Hintergrund-Download gestartet");
    assert.deepEqual(events, []);

    const evalVerdict = (zones: any[]) =>
      aggregate(evaluateZones({ context: "planning", timeContext: { kind: "now", now: new Date(now) } as any, zones, isCoveredByAV: () => false }).checks).verdict;
    let watch: VerdictWatchState = INITIAL_VERDICT_WATCH;
    watch = verdictWatchReducer(watch, { type: "evaluated", verdict: evalVerdict(first.zones), version: 0 });
    assert.equal(watch.settled?.verdict, "go");

    // Hintergrund-Download fertig → Ereignis
    const changed = new Promise<void>((resolve) => {
      const u = onGeozoneDataChanged(() => { u(); resolve(); });
    });
    release();
    await changed;
    assert.deepEqual(events, ["ed269:AT"]);
    unsub();
    watch = verdictWatchReducer(watch, { type: "data-changed", version: 1 });
    // Zwischen-Auswertung mit altem Stand ändert nichts
    watch = verdictWatchReducer(watch, { type: "evaluated", verdict: "go", version: 0 });
    assert.equal(watch.change, null);

    // Neu auswerten: neuer Bestand ersetzt den alten
    const second = await queryEd269CachedFeaturesWithStatusFrom("", 48.2, 16.37, 10, "AT");
    assert.deepEqual(second.zones.map((z) => z.name).sort(), ["Staatsbesuch", "Wien-Info"]);
    assert.ok((second.fetchedAt ?? 0) >= now);
    assert.equal(second.status, "ok");
    const v2 = evalVerdict(second.zones);
    assert.equal(v2, "nogo");
    watch = verdictWatchReducer(watch, { type: "evaluated", verdict: v2, version: 1 });
    assert.deepEqual(watch.change, { from: "go", to: "nogo" });
    assert.match(verdictChangeMessage(watch.change!), /^Neue Geozonen-Daten – Prüfergebnis hat sich geändert \(vorher GO, jetzt NO-GO\)/);
    // Schließen
    assert.equal(verdictWatchReducer(watch, { type: "dismiss" }).change, null);
  });

  it("Hinweis auch bei Wechsel zu GO (nie still) und kein Hinweis ohne Änderung", () => {
    let w = verdictWatchReducer(INITIAL_VERDICT_WATCH, { type: "evaluated", verdict: "caution", version: 0 });
    w = verdictWatchReducer(w, { type: "data-changed", version: 1 });
    w = verdictWatchReducer(w, { type: "evaluated", verdict: "go", version: 1 });
    assert.deepEqual(w.change, { from: "caution", to: "go" });
    assert.match(verdictChangeMessage(w.change!), /erst nach erneuter Prüfung/);
    let same = verdictWatchReducer(INITIAL_VERDICT_WATCH, { type: "evaluated", verdict: "caution", version: 0 });
    same = verdictWatchReducer(same, { type: "data-changed", version: 1 });
    same = verdictWatchReducer(same, { type: "evaluated", verdict: "caution", version: 1 });
    assert.equal(same.change, null);
    // Ohne erstes Urteil (noch geladen) kein Hinweis
    const early = verdictWatchReducer(INITIAL_VERDICT_WATCH, { type: "data-changed", version: 1 });
    assert.equal(verdictWatchReducer(early, { type: "evaluated", verdict: "nogo", version: 1 }).change, null);
  });
});

// ---------------------------------------------------------------------------
// Kachelspeicher: AIRAC, FR-Trefferzahl, temporäre DE-Zonen mit Stand
// ---------------------------------------------------------------------------

describe("Teil A: Kachelspeicher – günstige Versionsprüfung und temporäre DE-Zonen", () => {
  let dir = "";
  let offline = false;
  let frMatched = 100;
  let tempFails = false;
  const fakeFetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("geopf")) return { ok: true, status: 200, json: async () => ({ numberMatched: frMatched, features: [] }) } as any;
    if (u.includes("temporaere_betriebseinschraenkungen")) {
      if (tempFails) throw new Error("offline");
      return { ok: true, status: 200, json: async () => ({ features: [{ type: "Feature", id: "temporaere_betriebseinschraenkungen.1", geometry: null, properties: { start_time: "2026-11-01T00:00:00Z" } }] }) } as any;
    }
    throw new Error(`unerwartete URL ${u}`);
  }) as typeof fetch;

  const writeMeta = (iso: string, createdAt: number, source?: Record<string, unknown>) => {
    const d = path.join(dir, iso.toLowerCase(), "base");
    nodeFs.mkdirSync(d, { recursive: true });
    nodeFs.writeFileSync(path.join(d, "meta.json"), JSON.stringify({ iso, part: "base", complete: true, createdAt, count: 90, dataBytes: 1, rawBytes: 1, source }));
  };

  beforeEach(() => {
    dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "reval-"));
    offline = false;
    frMatched = 100;
    tempFails = false;
    __setTileStoreEnvForTests({ fs: createNodeTileFs(dir, fakeFetch), isOffline: () => offline, isWifi: async () => false, fetch: fakeFetch, retryDelaysMs: [1, 1, 1] });
    __setLargePacksOnMobileForTests(false);
  });
  afterEach(() => {
    __setTileStoreEnvForTests(null);
    __setLargePacksOnMobileForTests(null);
    nodeFs.rmSync(dir, { recursive: true, force: true });
  });

  it("AIRAC-Zyklus: bekannte Stichtage; Paket vor dem aktuellen Zyklus → fällig", async () => {
    assert.equal(airacCycleStart(Date.UTC(2024, 1, 22, 0, 0, 1)), Date.UTC(2024, 1, 22)); // AIRAC 2402
    assert.equal(airacCycleStart(Date.UTC(2024, 1, 21, 23)), Date.UTC(2024, 0, 25));
    const now = Date.now();
    const start = airacCycleStart(now);
    assert.ok(start <= now && now < start + AIRAC_CYCLE_MS);
    assert.equal(isBeforeCurrentAirac(start - MIN, now), true);
    assert.equal(isBeforeCurrentAirac(start + MIN, now), false);

    writeMeta("DE", start - MIN);
    await loadTileStoreMeta(true);
    assert.deepEqual(await tileStoreVersionCheck("DE", now), { due: true, reason: "airac" });
    writeMeta("DE", Math.min(now, start + MIN));
    await loadTileStoreMeta(true);
    assert.deepEqual(await tileStoreVersionCheck("DE", now), { due: false, reason: null });
  });

  it("FR: Trefferzahl des WFS weicht ab → neue Fassung; gleich → aktuell; offline → keine Netzprüfung", async () => {
    const now = Date.now();
    writeMeta("FR", Math.min(now, airacCycleStart(now) + MIN), { service: "geopf-wfs", matched: 100 });
    await loadTileStoreMeta(true);
    assert.deepEqual(await tileStoreVersionCheck("FR", now), { due: false, reason: null });
    frMatched = 101;
    assert.deepEqual(await tileStoreVersionCheck("FR", now), { due: true, reason: "fr-count" });
    offline = true;
    assert.deepEqual(await tileStoreVersionCheck("FR", now), { due: false, reason: null });
  });

  it("temporäre DE-Zonen: Stand des Live-Abrufs; offline der gespeicherte Stand; Registry meldet Alter", async () => {
    const now = Date.now();
    writeMeta("DE", now - 2 * DAY);
    await loadTileStoreMeta(true);
    assert.equal(getDeTempStatus().fetchedAt, null);
    assert.equal(getSourceDataStatus("DE").temporaryStale, true);
    await getDeTempFeatures({ force: true });
    const at = getDeTempStatus().fetchedAt!;
    assert.ok(at >= now);
    const st = getSourceDataStatus("DE");
    assert.equal(st.temporaryFetchedAt, at);
    assert.equal(st.temporaryStale, false);
    // Neuer Prozess-Zustand, offline: Stand aus temp.json
    __setTileStoreEnvForTests({ fs: createNodeTileFs(dir, fakeFetch), isOffline: () => true, isWifi: async () => false, fetch: fakeFetch, retryDelaysMs: [1, 1, 1] });
    const feats = await getDeTempFeatures();
    assert.equal(feats.length, 1);
    assert.equal(getDeTempStatus().fetchedAt, at);
  });
});
