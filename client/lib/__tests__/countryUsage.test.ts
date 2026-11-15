// Länder-Nutzung (Aus/Online/Offline, client/lib/countryUsage.ts +
// countryUsageData.ts): Speicherung, Standard, Migration, „Aus“ ohne Abruf und
// mit gelöschten Daten (geteilte Daten und Importe bleiben), „Online“ mit
// gespeicherten, aktuell gehaltenen Basis-Geozonen, „Offline“ mit allen
// Paketen, automatische Aktualisierung beim Start, LI folgt CH, Abdeckung
// „deaktiviert“ → CAUTION mit Aktion.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  __resetCountryUsageForTests,
  __setCountryUsageForTests,
  COUNTRY_USAGE_STORAGE_KEY,
  defaultCountryUsage,
  getCountryUsage,
  isCountryEnabled,
  isGeozoneSourceEnabled,
  loadCountryUsage,
  markCountryPromptDone,
  needsCountryPrompt,
  setCountryUsage,
  USAGE_COUNTRIES,
  usageCountryLabel,
  countryDisabledWarning,
} from "../countryUsage";
import { geozoneCountryName } from "../../../shared/countryEntitlements";
import {
  __setCountryDataEnvForTests,
  applyCountryUsage,
  cleanupDisabledCountries,
  getOfflineSyncState,
  liveResultKeyBelongsTo,
  probeStoredDataIsos,
  startCountryUsage,
  stopCountryUsage,
  syncOfflineCountries,
  type CountryDataEnv,
} from "../countryUsageData";
import {
  __resetEd269StoreForTests,
  __setEd269FsForTests,
  getEd269Dataset,
  importEd269Dataset,
  refreshEd269Dataset,
} from "../geozoneDirect/ed269Store";
import { queryEd269CachedFeaturesWithStatusFrom } from "../geozoneCoverage";
import { __setRevalidateEnvForTests, revalidateGeozoneSources } from "../geozoneSources/revalidate";
import { aggregate, coverageChecks, ENABLE_COUNTRY_ACTION_LABEL } from "../../../shared/checks";
import { __setOfflineCacheStorageForTests, listOfflineResultKeys, putOfflineResult, removeOfflineResults } from "../offlineResultCache";

const H = 60 * 60 * 1000;

function memStorage(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    data,
    async getItem(k: string) {
      return k in data ? data[k] : null;
    },
    async setItem(k: string, v: string) {
      data[k] = v;
    },
    async removeItem(k: string) {
      delete data[k];
    },
  };
}

/** expo-file-system/legacy-Ersatz auf einem echten Temp-Verzeichnis. */
function nodeFsModule(root: string) {
  const p = (u: string) => u;
  return {
    documentDirectory: root.endsWith("/") ? root : `${root}/`,
    async getInfoAsync(u: string) {
      try {
        const st = nodeFs.statSync(p(u));
        return { exists: true, size: st.size, modificationTime: st.mtimeMs / 1000 };
      } catch {
        return { exists: false };
      }
    },
    async makeDirectoryAsync(u: string) {
      nodeFs.mkdirSync(p(u), { recursive: true });
    },
    async readAsStringAsync(u: string) {
      return nodeFs.readFileSync(p(u), "utf8");
    },
    async writeAsStringAsync(u: string, d: string) {
      nodeFs.writeFileSync(p(u), d);
    },
    async moveAsync({ from, to }: { from: string; to: string }) {
      nodeFs.renameSync(p(from), p(to));
    },
    async deleteAsync(u: string) {
      nodeFs.rmSync(p(u), { force: true, recursive: true });
    },
    async readDirectoryAsync(u: string) {
      return nodeFs.readdirSync(p(u));
    },
  };
}

const POLY = {
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[14.4, 35.9], [14.45, 35.9], [14.45, 35.95], [14.4, 35.95], [14.4, 35.9]]] },
  properties: { name: "Testzone", restriction: "PROHIBITED", lowerMeters: 0, upperMeters: 120 },
};

describe("Länder-Nutzung: Speicherung, Standard, Migration", () => {
  beforeEach(() => __resetCountryUsageForTests(memStorage()));
  afterEach(() => __resetCountryUsageForTests(undefined));

  it("Neuinstallation: DE offline, alle anderen aus, Vorschlag offen; gespeichert", async () => {
    const st = memStorage();
    __resetCountryUsageForTests(st);
    await loadCountryUsage(async () => []);
    assert.equal(getCountryUsage("DE"), "offline");
    for (const { iso } of USAGE_COUNTRIES) if (iso !== "DE") assert.equal(getCountryUsage(iso), "off", iso);
    assert.equal(needsCountryPrompt(), true);
    const saved = JSON.parse(st.data[COUNTRY_USAGE_STORAGE_KEY]);
    assert.equal(saved.usage.DE, "offline");
    assert.equal(saved.usage.AT, "off");
    await markCountryPromptDone();
    assert.equal(needsCountryPrompt(), false);
  });

  it("Migration: Länder mit gespeicherten Daten starten als offline", async () => {
    await loadCountryUsage(async () => ["AT", "NO", "CH"]);
    assert.deepEqual(
      ["DE", "AT", "NO", "CH", "LI", "FR"].map((i) => getCountryUsage(i)),
      ["offline", "offline", "offline", "offline", "offline", "off"],
    );
  });

  it("Migration erkennt Pakete, ED-269-Bestände, Kachelspeicher und Importe (Datensatz-ISO → App-Land)", async () => {
    __setCountryDataEnvForTests({ storedDataIsos: async () => ["AT", "mt", "XX", "CZ", "LI"] });
    try {
      assert.deepEqual((await probeStoredDataIsos()).sort(), ["AT", "CH", "CZ", "MT"], "LI-Daten zählen für die Schweiz");
    } finally {
      __setCountryDataEnvForTests(null);
    }
  });

  it("gespeicherte Einstellung wird beim nächsten Start gelesen (keine erneute Migration)", async () => {
    const st = memStorage();
    __resetCountryUsageForTests(st);
    await loadCountryUsage(async () => []);
    await setCountryUsage("AT", "online");
    await setCountryUsage("DE", "off");
    __resetCountryUsageForTests(st);
    let probed = false;
    await loadCountryUsage(async () => {
      probed = true;
      return ["FR"];
    });
    assert.equal(probed, false);
    assert.equal(getCountryUsage("AT"), "online");
    assert.equal(getCountryUsage("DE"), "off");
    assert.equal(getCountryUsage("FR"), "off");
  });

  it("nicht geladen → jedes Land gilt als aktiviert (kein stilles Abschalten)", () => {
    __resetCountryUsageForTests(memStorage());
    assert.equal(isCountryEnabled("AT"), true);
    assert.equal(isGeozoneSourceEnabled("AT"), true);
  });

  it("Liechtenstein folgt immer der Schweiz: keine eigene Einstellung, gemeinsamer Name", async () => {
    assert.ok(!USAGE_COUNTRIES.some((c) => c.iso === "LI"), "kein eigener Eintrag für LI");
    assert.equal(USAGE_COUNTRIES.find((c) => c.iso === "CH")?.label, "Schweiz / Liechtenstein");
    assert.equal(usageCountryLabel("LI"), "Schweiz / Liechtenstein");
    assert.equal(usageCountryLabel("CH"), "Schweiz / Liechtenstein");
    // Hinweis „deaktiviert“ (Karte/Planung/GPS in LI bei CH aus) und Datenstand-Zeilen
    assert.equal(countryDisabledWarning(usageCountryLabel("LI")), "Geozonen für Schweiz / Liechtenstein sind deaktiviert – Land aktivieren oder manuell prüfen.");
    assert.equal(geozoneCountryName("LI"), "Schweiz / Liechtenstein");
    assert.equal(geozoneCountryName("CH"), "Schweiz / Liechtenstein");
    assert.equal(geozoneCountryName("AT"), "Österreich");
    for (const u of ["off", "online", "offline"] as const) {
      __setCountryUsageForTests({ CH: u });
      assert.equal(getCountryUsage("LI"), u);
      assert.equal(isCountryEnabled("LI"), u !== "off");
      assert.equal(isGeozoneSourceEnabled("LI"), u !== "off");
      assert.equal(isGeozoneSourceEnabled("CH"), u !== "off");
    }
    // Einstellen über LI setzt die Schweiz (eine Einstellung, keine doppelten Daten)
    __resetCountryUsageForTests(memStorage());
    await loadCountryUsage(async () => []);
    await setCountryUsage("LI", "online");
    assert.equal(getCountryUsage("CH"), "online");
    assert.equal(defaultCountryUsage(["li"]).CH, "offline");
    assert.equal(defaultCountryUsage(["li"]).LI, undefined);
  });

  it("frühere eigene LI-Einstellung: die stärkere Stufe gilt für Schweiz / Liechtenstein", async () => {
    const st = memStorage({
      [COUNTRY_USAGE_STORAGE_KEY]: JSON.stringify({ v: 1, usage: { DE: "offline", CH: "off", LI: "online" }, prompted: true }),
    });
    __resetCountryUsageForTests(st);
    await loadCountryUsage(async () => []);
    assert.equal(getCountryUsage("CH"), "online");
    assert.equal(getCountryUsage("LI"), "online");
  });
});

describe("Länder-Nutzung „Aus“: kein Abruf", () => {
  const realFetch = globalThis.fetch;
  let calls: string[] = [];
  beforeEach(() => {
    calls = [];
    (globalThis as any).fetch = async (u: any) => {
      calls.push(String(u));
      throw new Error("Netz im Test");
    };
    __resetEd269StoreForTests();
    __setRevalidateEnvForTests({ isOffline: () => false, ed269StoredAt: async () => null });
  });
  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    __setRevalidateEnvForTests(null);
    __resetCountryUsageForTests(undefined);
    __resetEd269StoreForTests();
  });

  it("ED-269-Bestand, Abdeckung, Hintergrund-Aktualisierung: kein fetch, Status „disabled“", async () => {
    __setCountryUsageForTests({ AT: "off", NO: "off" });
    assert.equal(await getEd269Dataset("AT"), null);
    assert.equal(await refreshEd269Dataset("NO"), false);
    const r = await queryEd269CachedFeaturesWithStatusFrom("", 48.2, 16.37, 1, "AT");
    assert.equal(r.status, "disabled");
    assert.deepEqual(r.zones, []);
    const [rv] = await revalidateGeozoneSources(["AT"], "check");
    assert.equal(rv.action, "disabled");
    assert.deepEqual(calls, [], "kein Netzabruf für deaktivierte Länder");
  });

  it("Gegenprobe: „Online“ ruft ab", async () => {
    __setCountryUsageForTests({ AT: "online" });
    await getEd269Dataset("AT");
    assert.ok(calls.length > 0);
  });
});

describe("Länder-Nutzung: Daten löschen (geteilte Daten und Importe bleiben)", () => {
  let log: string[] = [];
  let tmp = "";
  const env = (): Partial<CountryDataEnv> => ({
    deletePacks: async (iso) => void log.push(`packs:${iso}`),
    deleteOfflineExtras: async (iso) => void log.push(`extras:${iso}`),
    deleteLegacyPack: async (iso) => void log.push(`legacy:${iso}`),
    deleteTileStore: async (iso) => void log.push(`tiles:${iso}`),
    deleteLiveResults: async (iso) => void log.push(`live:${iso}`),
    syncCountry: async (iso, _allowLarge, _onProgress, mode) => {
      log.push(`sync:${iso}:${mode}`);
      return { iso, status: "current" };
    },
    isOffline: () => false,
  });
  beforeEach(() => {
    log = [];
    tmp = nodeFs.mkdtempSync(path.join(os.tmpdir(), "cu-"));
    __setEd269FsForTests(nodeFsModule(tmp) as any);
    __resetEd269StoreForTests();
    __resetCountryUsageForTests(memStorage());
    __setCountryUsageForTests({ DE: "offline", AT: "offline", CH: "offline", MT: "offline", NO: "online" });
    __setCountryDataEnvForTests(env());
  });
  afterEach(() => {
    __setCountryDataEnvForTests(null);
    __setEd269FsForTests(undefined);
    __resetEd269StoreForTests();
    __resetCountryUsageForTests(undefined);
    nodeFs.rmSync(tmp, { recursive: true, force: true });
  });

  const datasetFile = (iso: string) => path.join(tmp, "geozones-direct", `ed269-${iso}.json`);
  const writeDownloaded = (iso: string, fetchedAt = Date.now()) => {
    nodeFs.mkdirSync(path.join(tmp, "geozones-direct"), { recursive: true });
    nodeFs.writeFileSync(datasetFile(iso), JSON.stringify({ iso, fetchedAt, version: 1, features: [POLY] }));
  };

  it("„Aus“: Pakete, Bestand, Live-Ergebnisse gelöscht", async () => {
    writeDownloaded("at");
    const r = await applyCountryUsage("AT", "off");
    assert.equal(getCountryUsage("AT"), "off");
    assert.deepEqual(log, ["packs:AT", "legacy:AT", "live:AT"]);
    assert.equal(nodeFs.existsSync(datasetFile("at")), false, "heruntergeladener Bestand gelöscht");
    assert.equal(r?.keptImport, false);
  });

  it("„Aus“ für DE: Kachelspeicher gelöscht", async () => {
    await applyCountryUsage("DE", "off");
    assert.ok(log.includes("tiles:DE"));
  });

  it("Schweiz / Liechtenstein aus (auch über LI): BAZL-Bestand und alte LI-Pakete gelöscht – keine doppelten Daten", async () => {
    writeDownloaded("ch");
    const r = await applyCountryUsage("LI", "off");
    assert.equal(r?.iso, "CH");
    assert.equal(getCountryUsage("CH"), "off");
    assert.equal(nodeFs.existsSync(datasetFile("ch")), false);
    assert.ok(log.includes("packs:CH") && log.includes("packs:LI"));
  });

  it("Import bleibt bei „Aus“ und „bereinigen“ erhalten, wird nicht genutzt und gilt nach dem Einschalten wieder (ohne Neu-Import)", async () => {
    await importEd269Dataset("MT", [POLY as any], { source: "Test", importedAt: Date.now(), fileName: "malta.geojson" });
    assert.equal(nodeFs.existsSync(datasetFile("mt")), true);
    const r = await applyCountryUsage("MT", "off");
    assert.equal(r?.keptImport, true);
    assert.equal(nodeFs.existsSync(datasetFile("mt")), true, "Import-Datei bleibt");
    // nicht genutzt, solange aus
    assert.equal(await getEd269Dataset("MT"), null);
    assert.equal((await queryEd269CachedFeaturesWithStatusFrom("", 35.92, 14.42, 2, "MT")).status, "disabled");
    // „Alle deaktivierten Länder bereinigen“
    const cleaned = await cleanupDisabledCountries();
    assert.ok(cleaned.some((c) => c.iso === "MT" && c.keptImport));
    assert.equal(nodeFs.existsSync(datasetFile("mt")), true, "Import-Datei bleibt auch beim Bereinigen");
    // wieder einschalten: sofort genutzt (auch nach Neustart des Speichers)
    __resetEd269StoreForTests();
    await applyCountryUsage("MT", "online");
    const ds = await getEd269Dataset("MT");
    assert.ok(ds?.imported, "Import wird wieder genutzt");
    assert.equal(ds?.features.length, 1);
    const q = await queryEd269CachedFeaturesWithStatusFrom("", 35.92, 14.42, 5, "MT");
    assert.notEqual(q.status, "disabled");
    assert.equal(q.zones.length, 1);
  });

  it("„Online“ (von offline): nur Offline-Zusätze gelöscht, Geozonen-Bestand bleibt und wird als Basis aktuell gehalten", async () => {
    writeDownloaded("at");
    await applyCountryUsage("AT", "online");
    assert.deepEqual(log, ["extras:AT"], "weder Bestand noch Kachelspeicher gelöscht");
    assert.equal(nodeFs.existsSync(datasetFile("at")), true);
    log = [];
    await syncOfflineCountries("periodic");
    assert.ok(log.includes("sync:AT:base"), "Online-Land: Basis-Geozonen werden synchronisiert");
    assert.ok(log.includes("sync:NO:base"));
    assert.ok(log.includes("sync:DE:full"));
  });

  it("„Online“ hat keine 24-h-Grenze mehr: alter Bestand bleibt beim Start erhalten", async () => {
    __setCountryUsageForTests({ AT: "online", DE: "offline" });
    writeDownloaded("at", Date.now() - 30 * H);
    const old = (Date.now() - 30 * H) / 1000;
    nodeFs.utimesSync(datasetFile("at"), old, old);
    __resetEd269StoreForTests();
    await syncOfflineCountries("start");
    assert.equal(nodeFs.existsSync(datasetFile("at")), true);
    assert.ok(log.includes("sync:AT:base"));
  });

  it("aus → online lädt sofort die Basis-Geozonen", async () => {
    __setCountryUsageForTests({ FR: "off", DE: "offline" });
    await applyCountryUsage("FR", "online");
    for (let i = 0; i < 50 && !log.includes("sync:FR:base"); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(log.includes("sync:FR:base"));
    assert.ok(!log.some((l) => l.startsWith("extras:") || l.startsWith("packs:")));
  });
});

describe("Länder-Nutzung „Offline“: automatische Aktualisierung", () => {
  let synced: { iso: string; allowLarge: boolean; mode?: string }[] = [];
  let offline = false;
  let wifi = true;
  let mobile = false;
  beforeEach(() => {
    synced = [];
    offline = false;
    wifi = true;
    mobile = false;
    __resetCountryUsageForTests(memStorage());
    __setCountryUsageForTests({ DE: "offline", NO: "offline", AT: "online", FR: "off" });
    __setCountryDataEnvForTests({
      isOffline: () => offline,
      isWifi: async () => wifi,
      largePacksOnMobile: async () => mobile,
      datasetInfo: async () => null,
      syncCountry: async (iso, allowLarge, onProgress, mode) => {
        synced.push({ iso, allowLarge, mode });
        onProgress({ key: `${iso}:geo:vector`, percentage: 100, state: "complete" });
        return { iso, status: "updated" };
      },
    });
  });
  afterEach(() => {
    stopCountryUsage();
    __setCountryDataEnvForTests(null);
    __resetCountryUsageForTests(undefined);
  });

  it("App-Start: alle aktiven Länder werden geprüft (Offline vollständig, Online Basis-Geozonen; große Pakete im WLAN erlaubt), Fortschritt sichtbar", async () => {
    startCountryUsage(0);
    for (let i = 0; i < 50 && synced.length < 3; i++) await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(synced.map((s) => `${s.iso}:${s.mode}`).sort(), ["AT:base", "DE:full", "NO:full"]);
    assert.ok(synced.every((s) => s.allowLarge));
    const st = getOfflineSyncState();
    assert.equal(st.DE?.result?.status, "updated");
    assert.equal(st.DE?.packs["DE:geo:vector"]?.state, "complete");
    assert.equal(st.DE?.running, false);
  });

  it("mobile Daten ohne Erlaubnis: große Pakete nicht erlaubt; mit Erlaubnis erlaubt", async () => {
    wifi = false;
    await syncOfflineCountries("periodic");
    assert.ok(synced.every((s) => !s.allowLarge));
    synced = [];
    mobile = true;
    await syncOfflineCountries("periodic");
    assert.ok(synced.length === 3 && synced.every((s) => s.allowLarge));
  });

  it("Gerät offline: keine Synchronisation", async () => {
    offline = true;
    const r = await syncOfflineCountries("start");
    assert.deepEqual(synced, []);
    assert.ok(r.every((x) => x.status === "skipped"));
  });

  it("Umschalten auf „Offline“ startet die Synchronisation dieses Landes", async () => {
    await applyCountryUsage("FR", "offline");
    for (let i = 0; i < 50 && synced.length < 1; i++) await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(synced.map((s) => s.iso), ["FR"]);
  });
});

describe("Abdeckung „deaktiviert“ → CAUTION mit Aktion", () => {
  it("Befund unbekannt (≥ CAUTION), deutscher Text, Aktion „Land aktivieren (online)“, Bestätigung", () => {
    const checks = coverageChecks({
      context: "planning",
      sources: [
        { iso: "DE", status: "ok" },
        { iso: "AT", status: "disabled" },
      ],
      countryLabel: (iso) => (iso === "AT" ? "Österreich" : "Deutschland"),
    });
    const at = checks.find((c) => c.id === "coverage:AT:disabled");
    assert.ok(at);
    assert.equal(at!.severity, "unknown");
    assert.equal(at!.title, "Geozonen für Österreich sind deaktiviert – Land aktivieren oder manuell prüfen.");
    assert.deepEqual(at!.action, { kind: "enable-country", iso: "AT", label: ENABLE_COUNTRY_ACTION_LABEL });
    assert.equal(at!.requiresConfirmation, true);
    const agg = aggregate(checks);
    assert.equal(agg.verdict, "caution");
    assert.equal(agg.requiresConfirmation, true);
  });

  it("manuell geklärt (Standort-Schritt) → kein Befund", () => {
    const checks = coverageChecks({ context: "planning", sources: [{ iso: "AT", status: "disabled" }], resolvedIsos: ["AT"] });
    assert.equal(checks.length, 0);
  });
});

describe("Live-Ergebnisse je Land löschen", () => {
  afterEach(() => __setOfflineCacheStorageForTests(undefined));
  it("Schlüssel mit Länder-Präfix und ältere DE-Schlüssel (Koordinaten)", async () => {
    __setOfflineCacheStorageForTests(memStorage());
    await putOfflineResult("geozones-live", "ES_40.40_-3.70_10", []);
    await putOfflineResult("geozones-live", "DE_48.15_11.55_10", []);
    await putOfflineResult("geozones-live", "48.15_11.55_10", []);
    const detect = (lat: number) => (lat > 45 ? "DE" : "ES");
    assert.equal(liveResultKeyBelongsTo("48.15_11.55_10", "DE", detect), true);
    assert.equal(liveResultKeyBelongsTo("ES_40.40_-3.70_10", "DE", detect), false);
    const n = await removeOfflineResults("geozones-live", (k) => liveResultKeyBelongsTo(k, "DE", detect));
    assert.equal(n, 2);
    assert.deepEqual(await listOfflineResultKeys("geozones-live"), ["ES_40.40_-3.70_10"]);
  });
});
