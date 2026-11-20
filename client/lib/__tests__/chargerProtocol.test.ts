// ISDT MA331 – Protokoll (client/lib/charger/ma331Protocol.ts): Beispiel-Frames
// aus docs/isdt-ma331-protokoll.md, Kopplung, Hardware-Info, Einstellungen,
// Advertisement, MC234/AC341, defensive Längenprüfung, nur-lesen-Sperre.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildBindRequest,
  cellDeltaMv,
  classifyFrame,
  extractIsdtPayload,
  findIsdtPayloadInRawAdvertising,
  fromHex,
  isAllowedRequest,
  isBindingExpiredResponse,
  appIdFromBytes,
  modelInfo,
  parseBindResponse,
  parseHardwareInfo,
  parseIsdtManufacturerPayload,
  parseSettings,
  parseStatus,
  productionDateKey,
  REQ_HARDWARE_INFO,
  REQ_SETTINGS_READ,
  REQ_STATUS,
  slotStateLabel,
  toHex,
  hubModeLabel,
} from "../charger/ma331Protocol";
import { SPEC_STATUS_HEX, encodeStatus } from "./helpers/chargerFixtures";
import {
  applySettingsPatch,
  buildSettingsWrite,
  isAllowedSettingsWrite,
  parseSettingsAck,
} from "../charger/ma331WriteCommands";

describe("MA331 Status 31 C3 (Beispiel aus der Spec)", () => {
  const frame = fromHex(SPEC_STATUS_HEX);

  it("hat 90 Byte und wird als Status erkannt", () => {
    assert.equal(frame.length, 90);
    assert.equal(classifyFrame(frame), "status");
  });

  it("dekodiert Modus, USB und alle drei Schächte", () => {
    const r = parseStatus(frame, "MA331");
    assert.ok(r.ok);
    const s = r.status;
    assert.equal(s.mode, 0);
    assert.equal(hubModeLabel(s.mode), "Laden");
    assert.deepEqual(
      s.usb.map((u) => [u.state, u.voltageV, u.powerW]),
      [
        [0, 0, 0],
        [2, 20, 45],
        [0, 0, 0],
      ],
    );
    const [a, b, c] = s.slots;
    assert.equal(a.state, 2);
    assert.equal(slotStateLabel(a.state), "Lädt");
    assert.equal(a.socPercent, 57);
    assert.equal(a.timeMinutes, 34);
    assert.equal(a.remainingMah, 2350);
    assert.equal(a.temperatureC, 31);
    assert.equal(a.currentA, 3.2);
    assert.equal(a.powerW, 54);
    assert.equal(a.cycleCount, 47);
    assert.deepEqual(a.productionDate, { year: 2024, month: 5, day: 13 });
    assert.equal(productionDateKey(a.productionDate), "2024-05-13");
    assert.deepEqual(a.cellMillivolts, [3912, 3915, 3910, 3913]);
    assert.equal(a.packVoltageV, 15.65);
    assert.deepEqual(cellDeltaMv(a.cellMillivolts), {
      min: 3910,
      max: 3915,
      delta: 5,
    });
    assert.ok(a.hasData);

    assert.equal(b.state, 3);
    assert.equal(b.socPercent, 100);
    assert.equal(b.remainingMah, 4241);
    assert.equal(b.cycleCount, 112);
    assert.deepEqual(b.productionDate, { year: 2023, month: 11, day: 2 });
    assert.deepEqual(b.cellMillivolts, [4350, 4348, 4351, 4349]);

    assert.equal(c.state, 0);
    assert.equal(c.hasData, false);
    assert.equal(productionDateKey(c.productionDate), null);
    assert.equal(s.extraHex, "");
  });

  it("zu kurze Frames werden abgelehnt, längere toleriert (Rest roh behalten)", () => {
    const short = parseStatus(frame.slice(0, 60), "MA331");
    assert.equal(short.ok, false);
    const long = parseStatus([...frame, 0xaa, 0xbb], "MA331");
    assert.ok(long.ok);
    assert.equal(long.status.extraHex, "aa bb");
    assert.equal(long.status.frameLength, 92);
    assert.equal(parseStatus([0x31, 0xc7, 1], "MA331").ok, false);
    assert.equal(parseStatus([], "MA331").ok, false);
  });

  it("Test-Encoder erzeugt dieselben Werte (Rundlauf)", () => {
    const r = parseStatus(
      encodeStatus({
        state: 2,
        soc: 57,
        mah: 2350,
        temp: 31,
        a: 3.2,
        w: 54,
        cycles: 47,
        cells: [3912, 3915, 3910, 3913],
      }),
      "MA331",
    );
    assert.ok(r.ok);
    const spec = parseStatus(frame, "MA331");
    assert.ok(spec.ok);
    assert.deepEqual(
      { ...r.status.slots[0], rawHex: "", timeMinutes: 34 },
      { ...spec.status.slots[0], rawHex: "" },
    );
  });

  it("unbekannte Status-Werte heißen „Status N“", () => {
    assert.equal(slotStateLabel(9), "Status 9");
    assert.equal(slotStateLabel(7), "Zu heiß");
    assert.equal(slotStateLabel(8), "Zu kalt");
    assert.equal(slotStateLabel(6), "Fehler");
  });
});

describe("Kopplung, Hardware-Info, Einstellungen", () => {
  it("Bind-Frame wie im Beispiel der Spec", () => {
    assert.equal(
      toHex(buildBindRequest("3f2a9c1e5b7d40a89e1c6d2f8b4a7c10", 0)),
      "18 3f 2a 9c 1e 5b 7d 40 a8 9e 1c 6d 2f 8b 4a 7c 10 00 00",
    );
    assert.equal(
      buildBindRequest("3f2a9c1e-5b7d-40a8-9e1c-6d2f8b4a7c10", 1)[18],
      1,
    );
    assert.throws(() => buildBindRequest("abc", 0));
  });

  it("App-ID aus Zufallsbytes: 32 Hex, UUIDv4-Kennzeichnung", () => {
    const id = appIdFromBytes(Array.from({ length: 16 }, (_, i) => i * 17));
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.equal(id[12], "4");
  });

  it("Bind-Antwort und „abgelaufen“", () => {
    assert.deepEqual(parseBindResponse([0x19, 0x00]), { kind: "bound" });
    assert.deepEqual(parseBindResponse([0x19, 0x01]), {
      kind: "rejected",
      code: 1,
    });
    assert.equal(parseBindResponse([0x31, 0xc3]), null);
    assert.equal(isBindingExpiredResponse([0x31, 0xff]), true);
    assert.equal(classifyFrame([0x31, 0xff]), "expired");
  });

  it("Hardware-Info E1 (mit/ohne 31-Präfix, mit MCU-Versionen)", () => {
    const hw = parseHardwareInfo([
      0xe1, 1, 0, 1, 5, 1, 2, 3, 4, 5, 6, 7, 8, 2, 0, 3, 1,
    ]);
    assert.ok(hw);
    assert.equal(hw.firmwareLabel, "1.0.1.5");
    assert.equal(hw.deviceIdHex, "0102030405060708");
    assert.deepEqual(hw.mcuFw, [3, 1]);
    assert.equal(
      parseHardwareInfo([0x31, 0xe1, 1, 0, 1, 5])?.firmwareLabel,
      "1.0.1.5",
    );
    assert.equal(parseHardwareInfo([0xe1, 1])?.firmwareLabel, undefined);
    assert.equal(classifyFrame([0xe1, 1, 2, 3, 4]), "hwinfo");
  });

  it("Einstellungen lesen 31 C7", () => {
    const s = parseSettings([0x31, 0xc7, 1, 0, 1, 0, 0, 1, 0]);
    assert.deepEqual(s, {
      chargeTarget: 1,
      dischargeToZero: false,
      alarm: true,
      lamp: false,
      mute: false,
      screenAutoOff: true,
      mode: 0,
    });
    assert.equal(parseSettings([0x31, 0xc7, 1]), null);
  });
});

describe("nur lesen", () => {
  it("erlaubt nur Status, Einstellungen-lesen, Hardware-Info und Bind", () => {
    assert.ok(isAllowedRequest(REQ_STATUS));
    assert.ok(isAllowedRequest(REQ_SETTINGS_READ));
    assert.ok(isAllowedRequest(REQ_HARDWARE_INFO));
    assert.ok(
      isAllowedRequest(buildBindRequest("3f2a9c1e5b7d40a89e1c6d2f8b4a7c10", 1)),
    );
    // Schreiben/Umbenennen sind gesperrt
    assert.equal(isAllowedRequest([0x12, 0xc4, 1, 0, 0, 0, 0, 0, 0]), false);
    assert.equal(isAllowedRequest([0x12, 0xc4]), false);
    assert.equal(isAllowedRequest([0x12, 0xc0, 0x41]), false);
    assert.equal(isAllowedRequest([0x13, 0xea, 0]), false);
    assert.equal(isAllowedRequest([]), false);
  });

  it("Einstellungen schreiben: nur exakt geprüfte 12-C4-Frames, Umbenennen bleibt gesperrt", () => {
    const cur = {
      chargeTarget: 1,
      dischargeToZero: false,
      alarm: true,
      lamp: false,
      mute: false,
      screenAutoOff: true,
      mode: 4,
    };
    const w = buildSettingsWrite(cur);
    assert.equal(toHex(w), "12 c4 01 00 01 00 00 01 04");
    assert.equal(isAllowedRequest(w), false);
    assert.equal(isAllowedSettingsWrite(w), true);
    assert.equal(isAllowedSettingsWrite([0x12, 0xc4, 4, 0, 0, 0, 0, 0, 0]), false);
    assert.equal(isAllowedSettingsWrite([0x12, 0xc4, 1, 0, 0, 0, 1, 1, 0]), false);
    assert.equal(isAllowedSettingsWrite([0x12, 0xc0, 0x41]), false);
    assert.throws(() => buildSettingsWrite({ ...cur, mute: true, screenAutoOff: true }));
    // nur das geänderte Feld, Stumm schaltet Display-aus ab
    const next = applySettingsPatch(cur, { mute: true });
    assert.equal(next.mute, true);
    assert.equal(next.screenAutoOff, false);
    assert.equal(next.mode, 4);
    assert.equal(applySettingsPatch(cur, { chargeTarget: 0 }).alarm, true);
    assert.equal(parseSettingsAck([0x31, 0xc5, 1]), true);
    assert.equal(parseSettingsAck([0x31, 0xc5, 0]), false);
    assert.equal(parseSettingsAck([0x31, 0xc1, 0]), null);
    assert.equal(classifyFrame([0x31, 0xc5, 1]), "settings-ack");
  });
});

describe("Erkennung im Advertisement", () => {
  const payload = [
    0xaf,
    0xfa,
    0x01,
    0x40,
    0x00,
    0x00,
    ...Array.from("MA331 Werk    ", (c) => c.charCodeAt(0)),
  ];

  it("MA331 über Herstellerdaten (Schlüssel = Company-ID hex)", () => {
    const p = extractIsdtPayload({
      manufacturerData: { abba: { bytes: payload } },
    });
    const a = parseIsdtManufacturerPayload(p);
    assert.ok(a);
    assert.equal(a.modelId, "01400000");
    assert.equal(a.model.kind, "MA331");
    assert.equal(a.model.bootloader, false);
    assert.equal(a.userName, "MA331 Werk");
  });

  it("Name endet am ersten Null-Byte (Restinhalt dahinter ignoriert)", () => {
    const name = [..."0000MA331"].map((c) => c.charCodeAt(0));
    const a = parseIsdtManufacturerPayload([
      0xaf, 0xfa, 0x01, 0x40, 0x00, 0x00,
      ...name, 0x00, 0x44, 0x6d, 0x37, 0x3b,
    ]);
    assert.equal(a?.userName, "0000MA331");
    assert.equal(hubModeLabel(4), "unbekannt (4)");
  });

  it("Bootloader 81400000 wird erkannt (nicht verbinden)", () => {
    const a = parseIsdtManufacturerPayload([
      0xaf, 0xfa, 0x81, 0x40, 0x00, 0x00,
    ]);
    assert.equal(a?.model.bootloader, true);
    assert.equal(a?.model.name, "MA331");
    assert.equal(modelInfo("01400300").kind, "MC234");
    assert.equal(modelInfo("01400500").kind, "AC341");
    assert.equal(modelInfo("01400100").kind, null);
  });

  it("aus rohen AD-Strukturen und manufacturerRawData", () => {
    const raw = [
      0x02,
      0x01,
      0x06,
      0x03,
      0x03,
      0x00,
      0xaf,
      payload.length + 3,
      0xff,
      0xba,
      0xab,
      ...payload,
    ];
    assert.deepEqual(findIsdtPayloadInRawAdvertising(raw), payload);
    assert.deepEqual(extractIsdtPayload({ rawData: { bytes: raw } }), payload);
    assert.deepEqual(
      extractIsdtPayload({
        manufacturerRawData: { bytes: [0xba, 0xab, ...payload] },
      }),
      payload,
    );
    assert.equal(parseIsdtManufacturerPayload([0x01, 0x02, 3, 4, 5, 6]), null);
    assert.equal(
      extractIsdtPayload({ manufacturerData: { "004c": { bytes: [1, 2] } } }),
      null,
    );
    // abgeschnittene AD-Struktur: kein Absturz
    assert.equal(findIsdtPayloadInRawAdvertising([0x1f, 0xff, 0xba]), null);
  });
});

describe("Verwandte Geräte (MC234 / AC341)", () => {
  const slotHead = [
    2, 50, 10, 0, 0x10, 0x08, 30, 20, 0, 0x2c, 0x01, 5, 0, 24, 1, 2,
  ];
  it("MC234: kein Modus-Byte, 1 USB, 2 Schächte à 20 Byte, 2 Zellen", () => {
    const f = [
      0x31,
      0xc3,
      1,
      0x32,
      0,
      0x64,
      0,
      ...slotHead,
      0x68,
      0x10,
      0x6a,
      0x10,
      ...new Array(20).fill(0),
    ];
    const r = parseStatus(f, "MC234");
    assert.ok(r.ok);
    assert.equal(r.status.mode, null);
    assert.equal(r.status.usb.length, 1);
    assert.equal(r.status.usb[0].voltageV, 5);
    assert.equal(r.status.slots.length, 2);
    assert.equal(r.status.slots[0].remainingMah, 0x0810);
    assert.deepEqual(r.status.slots[0].cellMillivolts, [4200, 4202]);
    assert.equal(r.status.slots[1].state, 0);
  });

  it("AC341: selbstbeschreibend, Zellenzahl je Schacht", () => {
    const f = [
      0x31,
      0xc3,
      1,
      0,
      0,
      0,
      0,
      0,
      2,
      ...slotHead,
      3,
      0x10,
      0x0f,
      0x11,
      0x0f,
      0x12,
      0x0f,
      ...slotHead,
      0,
    ];
    const r = parseStatus(f, "AC341");
    assert.ok(r.ok);
    assert.equal(r.status.slots.length, 2);
    assert.deepEqual(r.status.slots[0].cellMillivolts, [3856, 3857, 3858]);
    assert.deepEqual(r.status.slots[1].cellMillivolts, []);
    // unvollständig → Fehler statt Absturz
    assert.equal(parseStatus(f.slice(0, 20), "AC341").ok, false);
  });
});
