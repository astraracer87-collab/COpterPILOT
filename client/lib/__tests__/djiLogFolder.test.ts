// DJI-Protokoll-Ordner (SAF): lesbare Pfade aus Tree-/Document-URIs und
// Zugriffsprüfung (ok / verloren / Anzahl / neu gegenüber dem Logbuch).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI,
  DJI_FLY_FLIGHTRECORD_DOC_URI,
  DJI_LOG_FOLDER_STORAGE_KEY,
  checkDjiLogFolderAccessWith,
  folderLabelFromUri,
  isAndroidDataFolder,
  suggestDjiFlyFolderUri,
} from "../djiLogFolderCore";

const TREE = "content://com.android.externalstorage.documents/tree/";

describe("folderLabelFromUri", () => {
  it("primary:Android/data/... Tree-URI → lesbarer Pfad", () => {
    const uri = `${TREE}primary%3AAndroid%2Fdata%2Fdji.go.v5%2Ffiles%2FFlightRecord`;
    assert.equal(folderLabelFromUri(uri), "Android/data/dji.go.v5/files/FlightRecord");
    assert.equal(isAndroidDataFolder(uri), true);
  });

  it("primary:Download/... Tree-URI → lesbarer Pfad", () => {
    const uri = `${TREE}primary%3ADownload%2FFlightRecords`;
    assert.equal(folderLabelFromUri(uri), "Download/FlightRecords");
    assert.equal(isAndroidDataFolder(uri), false);
  });

  it("Tree+Document-URI nutzt den Document-Teil", () => {
    const uri = `${TREE}primary%3ADownload/document/primary%3ADownload%2FFlightRecords`;
    assert.equal(folderLabelFromUri(uri), "Download/FlightRecords");
  });

  it("Wurzel des internen Speichers und SD-Karte", () => {
    assert.equal(folderLabelFromUri(`${TREE}primary%3A`), "Interner Speicher");
    assert.equal(folderLabelFromUri(`${TREE}1A2B-3C4D%3ADJI%2FLogs`), "SD-Karte 1A2B-3C4D/DJI/Logs");
  });

  it("Start-URIs für den Ordnerdialog", () => {
    assert.equal(
      DJI_FLY_FLIGHTRECORD_DOC_URI,
      "content://com.android.externalstorage.documents/document/primary%3AAndroid%2Fdata%2Fdji.go.v5%2Ffiles%2FFlightRecord",
    );
    assert.equal(
      DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI,
      "content://com.android.externalstorage.documents/document/primary%3ADownload%2FFlightRecords",
    );
    assert.equal(suggestDjiFlyFolderUri(), DJI_FLY_FLIGHTRECORD_DOC_URI);
    assert.equal(suggestDjiFlyFolderUri("download"), DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI);
    assert.equal(folderLabelFromUri(DJI_FLY_FLIGHTRECORD_DOC_URI), "Android/data/dji.go.v5/files/FlightRecord");
  });

  it("Speicher-Schlüssel bleibt der bisherige (Logbuch-Ordner bleibt erhalten)", () => {
    assert.equal(DJI_LOG_FOLDER_STORAGE_KEY, "@copterpilot/djiFlightRecordFolderUri");
  });
});

describe("checkDjiLogFolderAccessWith", () => {
  const folder = `${TREE}primary%3ADownload%2FFlightRecords`;
  const child = (name: string) =>
    `${folder}/document/primary%3ADownload%2FFlightRecords%2F${encodeURIComponent(name)}`;

  it("ok: zählt .txt-Protokolle und neue gegenüber importierten", async () => {
    const res = await checkDjiLogFolderAccessWith(folder, {
      readDirectory: async (uri) => {
        assert.equal(uri, folder);
        return [
          child("DJIFlightRecord_2026-05-01_[10-00-00].txt"),
          child("DJIFlightRecord_2026-05-02_[11-00-00].txt"),
          child("DJIFlightRecord_2026-05-03_[12-00-00].txt"),
          child("FLY046.DAT"),
          child("notes.jpg"),
        ];
      },
      knownLogNames: async () => ["djiflightrecord_2026-05-01_[10-00-00].TXT"],
    });
    assert.deepEqual(res, { ok: true, count: 3, newCount: 2 });
  });

  it("verloren: Ordner nicht lesbar (Freigabe entzogen)", async () => {
    const res = await checkDjiLogFolderAccessWith(folder, {
      readDirectory: async () => {
        throw new Error("Permission Denial");
      },
      knownLogNames: async () => [],
    });
    assert.equal(res.ok, false);
    assert.equal(res.count, 0);
    assert.equal(res.newCount, 0);
    assert.match(res.error ?? "", /Permission/);
  });

  it("leerer Ordner und unlesbares Logbuch", async () => {
    assert.deepEqual(
      await checkDjiLogFolderAccessWith(folder, { readDirectory: async () => [], knownLogNames: async () => [] }),
      { ok: true, count: 0, newCount: 0 },
    );
    const res = await checkDjiLogFolderAccessWith(folder, {
      readDirectory: async () => [child("DJIFlightRecord_a.txt")],
      knownLogNames: async () => {
        throw new Error("kaputt");
      },
    });
    assert.deepEqual(res, { ok: true, count: 1, newCount: 1 });
  });

  it("alle bereits importiert → 0 neu", async () => {
    const res = await checkDjiLogFolderAccessWith(folder, {
      readDirectory: async () => [child("DJIFlightRecord_a.txt"), child("DJIFlightRecord_b.txt")],
      knownLogNames: async () => new Set(["djiflightrecord_a.txt", "djiflightrecord_b.txt"]),
    });
    assert.deepEqual(res, { ok: true, count: 2, newCount: 0 });
  });
});
