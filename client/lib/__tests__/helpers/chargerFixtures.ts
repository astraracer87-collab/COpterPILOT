// Testdaten für das ISDT MA331 (eigene, synthetische Frames – kein Mitschnitt).
import type { IsdtSlot, IsdtStatus } from "../../charger/ma331Protocol";

/** Spec, Abschnitt 4 (synthetisch, 90 Byte) */
export const SPEC_STATUS_HEX =
  "31 c3 00 00 00 00 00 00 02 c8 00 c2 01 00 00 00 00 00 02 39 22 00 2e 09 1f 20 00 1c 02 2f 00 18 05 0d 48 0f 4b 0f 46 0f 49 0f 03 64 00 00 91 10 1c 00 00 00 00 70 00 17 0b 02 fe 10 fc 10 ff 10 fd 10 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00";

export interface SlotSpec {
  state: number;
  soc?: number;
  mah?: number;
  temp?: number;
  a?: number;
  w?: number;
  cycles?: number;
  date?: [number, number, number];
  cells?: number[];
  minutes?: number;
}

export function slot(index: number, s: SlotSpec): IsdtSlot {
  const cells =
    s.cells ?? (s.state === 0 ? [0, 0, 0, 0] : [3900, 3905, 3902, 3901]);
  const [y, m, d] = s.date ?? (s.state === 0 ? [2000, 0, 0] : [2024, 5, 13]);
  return {
    index,
    state: s.state,
    hasData: s.state !== 0 && s.state !== 6,
    socPercent: s.soc ?? 50,
    timeMinutes: s.minutes ?? 0,
    remainingMah: s.mah ?? 2000,
    temperatureC: s.temp ?? 30,
    currentA: s.a ?? 3,
    powerW: s.w ?? 50,
    cycleCount: s.cycles ?? 47,
    productionDate: { year: y, month: m, day: d },
    cellMillivolts: cells,
    packVoltageV: cells.reduce((a, c) => a + c, 0) / 1000,
    rawHex: "",
  };
}

export function status(...slots: SlotSpec[]): IsdtStatus {
  const all = [0, 1, 2].map((i) => slot(i, slots[i] ?? { state: 0 }));
  return {
    model: "MA331",
    mode: 0,
    usb: [0, 1, 2].map((index) => ({
      index,
      state: 0,
      voltageV: 0,
      powerW: 0,
    })),
    slots: all,
    extraHex: "",
    frameLength: 90,
  };
}

/** MA331-Status als Bytes (90 Byte) */
export function encodeStatus(...slots: SlotSpec[]): number[] {
  const f = new Array(90).fill(0);
  f[0] = 0x31;
  f[1] = 0xc3;
  const w16 = (o: number, v: number) => {
    f[o] = v & 0xff;
    f[o + 1] = (v >> 8) & 0xff;
  };
  slots.forEach((s, i) => {
    const sl = slot(i, s);
    const b = 18 + 24 * i;
    f[b] = sl.state;
    f[b + 1] = sl.socPercent;
    w16(b + 2, sl.timeMinutes);
    w16(b + 4, sl.remainingMah);
    f[b + 6] = sl.temperatureC;
    w16(b + 7, Math.round(sl.currentA * 10));
    w16(b + 9, Math.round(sl.powerW * 10));
    w16(b + 11, sl.cycleCount);
    f[b + 13] = sl.productionDate.year - 2000;
    f[b + 14] = sl.productionDate.month;
    f[b + 15] = sl.productionDate.day;
    sl.cellMillivolts.forEach((c, k) => w16(b + 16 + 2 * k, c));
  });
  return f;
}
