// Zentrale Download-Anzeige (client/lib/downloadActivity.ts): begin/progress/
// end, mehrere Aufgaben, Verzögerung für kurze Aufgaben, Text; Anbindung der
// Abrufpfade (ED-269-Download, Kachelspeicher) – jeder Download ist erfasst.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  __resetDownloadActivityForTests,
  beginDownload,
  DOWNLOAD_DISPLAY_DELAY_MS,
  downloadFraction,
  endDownload,
  formatDownloadActivity,
  getActiveDownloads,
  getVisibleDownloads,
  progressDownload,
  subscribeDownloadActivity,
  trackDownload,
} from "../downloadActivity";
import { __resetCountryUsageForTests, __setCountryUsageForTests } from "../countryUsage";
import { __resetEd269StoreForTests, __setEd269FsForTests, refreshEd269Dataset } from "../geozoneDirect/ed269Store";
import { obstacleTileInActiveCountry } from "../obstacleCountryFilter";

let now = 1_000_000;

describe("Download-Anzeige: Erfassung", () => {
  beforeEach(() => {
    now = 1_000_000;
    __resetDownloadActivityForTests(() => now);
  });
  afterEach(() => __resetDownloadActivityForTests(null));

  it("begin/progress/end mit Prozent und deutschem Text", () => {
    let events = 0;
    const off = subscribeDownloadActivity(() => events++);
    const id = beginDownload({ id: "tiles:DE:base", iso: "DE", labelDe: "Geozonen", kind: "geozones", totalItems: 20 });
    assert.equal(getActiveDownloads().length, 1);
    progressDownload(id, { doneItems: 9 });
    now += DOWNLOAD_DISPLAY_DELAY_MS;
    const vis = getVisibleDownloads();
    assert.equal(vis.length, 1);
    assert.equal(downloadFraction(vis[0]), 0.45);
    assert.equal(formatDownloadActivity(vis), "Lädt: Deutschland – Geozonen 45 %");
    endDownload(id);
    assert.equal(getActiveDownloads().length, 0);
    assert.equal(formatDownloadActivity(getVisibleDownloads()), null);
    assert.ok(events >= 3);
    off();
  });

  it("kurze Aufgaben (< 1 s) werden erfasst, aber nicht angezeigt", () => {
    const id = beginDownload({ id: "ed269:at", iso: "AT", labelDe: "Geozonen", kind: "geozones" });
    now += DOWNLOAD_DISPLAY_DELAY_MS - 1;
    assert.equal(getActiveDownloads().length, 1, "erfasst");
    assert.equal(getVisibleDownloads().length, 0, "noch nicht sichtbar");
    endDownload(id);
    now += 5000;
    assert.equal(getVisibleDownloads().length, 0);
  });

  it("mehrere Aufgaben: „Lädt 3 Aufgaben …“; unbekannter Fortschritt „…“", () => {
    beginDownload({ id: "a", iso: "AT", labelDe: "Geozonen", kind: "geozones" });
    beginDownload({ id: "b", iso: "CZ", labelDe: "Geozonen", kind: "geozones", totalBytes: 100 });
    beginDownload({ id: "c", labelDe: "Hindernisse", kind: "obstacles" });
    now += 2000;
    assert.equal(formatDownloadActivity(getVisibleDownloads()), "Lädt 3 Aufgaben …");
    endDownload("b");
    endDownload("c");
    assert.equal(formatDownloadActivity(getVisibleDownloads()), "Lädt: Österreich – Geozonen …");
  });

  it("Schweiz und Liechtenstein erscheinen gemeinsam", () => {
    beginDownload({ id: "ed269:ch", iso: "LI", labelDe: "Geozonen", kind: "geozones" });
    now += 2000;
    assert.equal(formatDownloadActivity(getVisibleDownloads()), "Lädt: Schweiz / Liechtenstein – Geozonen …");
  });

  it("gleiche id zweimal: ein Eintrag, erst das letzte end() beendet ihn; trackDownload endet auch bei Fehler", async () => {
    beginDownload({ id: "x", labelDe: "Geozonen", kind: "geozones" });
    beginDownload({ id: "x", labelDe: "Geozonen", kind: "geozones" });
    assert.equal(getActiveDownloads().length, 1);
    endDownload("x");
    assert.equal(getActiveDownloads().length, 1);
    endDownload("x");
    assert.equal(getActiveDownloads().length, 0);
    await assert.rejects(trackDownload({ id: "y", labelDe: "Import", kind: "import" }, async () => {
      assert.equal(getActiveDownloads().length, 1);
      throw new Error("kaputt");
    }));
    assert.equal(getActiveDownloads().length, 0);
  });

  it("benachrichtigt nach Ablauf der Verzögerung (Anzeige erscheint ohne weitere Meldung)", async () => {
    __resetDownloadActivityForTests(null);
    let events = 0;
    const off = subscribeDownloadActivity(() => events++);
    const id = beginDownload({ id: "lang", labelDe: "Geozonen", kind: "geozones" });
    const before = events;
    await new Promise((r) => setTimeout(r, DOWNLOAD_DISPLAY_DELAY_MS + 50));
    assert.ok(events > before, "Ereignis nach 1 s");
    assert.equal(getVisibleDownloads().length, 1);
    endDownload(id);
    off();
  });
});

describe("Download-Anzeige: Abrufpfade melden sich an", () => {
  const realFetch = globalThis.fetch;
  let tmp = "";
  beforeEach(() => {
    __resetDownloadActivityForTests(null);
    tmp = nodeFs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
    __setEd269FsForTests(null);
    __resetEd269StoreForTests();
    __setCountryUsageForTests({ AT: "online" });
  });
  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    __setEd269FsForTests(undefined);
    __resetEd269StoreForTests();
    __resetCountryUsageForTests(undefined);
    __resetDownloadActivityForTests(null);
    nodeFs.rmSync(tmp, { recursive: true, force: true });
  });

  it("ED-269-Download (auch Revalidierung) erscheint als „Österreich – Geozonen“ und endet danach", async () => {
    const seen: string[] = [];
    (globalThis as any).fetch = async () => {
      for (const t of getActiveDownloads()) seen.push(`${t.iso}:${t.labelDe}`);
      throw new Error("Netz im Test");
    };
    await refreshEd269Dataset("AT");
    assert.ok(seen.includes("AT:Geozonen"), `erfasst: ${seen.join(",")}`);
    assert.equal(getActiveDownloads().length, 0);
  });
});

describe("Hindernisse nur in aktiven Ländern (Kachelfilter)", () => {
  // Erkennung: westlich von 10° = DE, östlich = AT, nördlich 60° = kein Land
  const detect = (lat: number, lon: number) => (lat > 60 ? null : lon < 10 ? "DE" : "AT");
  const box = (w: number, e: number, s = 47, n = 47.3) => ({ w, e, s, n });

  it("Mitte im aktiven Land → laden; Mitte im deaktivierten Land → nicht laden", () => {
    const deps = { detect, isEnabled: (iso: string) => iso === "AT" };
    assert.equal(obstacleTileInActiveCountry(box(10.2, 10.6), deps), true);
    assert.equal(obstacleTileInActiveCountry(box(9.0, 9.4), deps), false);
  });

  it("Grenzkachel: zählt, wenn eine Ecke im aktiven Land liegt", () => {
    const deps = { detect, isEnabled: (iso: string) => iso === "AT" };
    // Mitte 9,85° (DE, aus), östliche Ecken 10,1° (AT, aktiv)
    assert.equal(obstacleTileInActiveCountry(box(9.6, 10.1), deps), true);
    // beide Länder aus → nicht laden
    assert.equal(obstacleTileInActiveCountry(box(9.6, 10.1), { detect, isEnabled: () => false }), false);
  });

  it("kein bekanntes Land (offenes Meer) → laden (keine Einstellung schaltet es ab)", () => {
    assert.equal(obstacleTileInActiveCountry(box(9, 9.4, 61, 61.2), { detect, isEnabled: () => false }), true);
  });
});
