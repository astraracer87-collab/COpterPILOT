import { crc8, crc16, buildFrame, FrameParser, hexToBytes, toHex } from "@/lib/fcc/duml";

describe("DUML", () => {
  test("CRC-8 passt zu bekannten DUML-Köpfen", () => {
    expect(crc8(new Uint8Array([0x55, 0x0d, 0x04]))).toBe(0x33);
    expect(crc8(new Uint8Array([0x55, 0x0e, 0x04]))).toBe(0x66);
    expect(crc8(new Uint8Array([0x55, 0x1a, 0x04]))).toBe(0xb1);
  });

  test("Rahmen bauen und wieder parsen", () => {
    const f = buildFrame(0x82, 0x06, 0x20, 0x06, 0x72, hexToBytes("00000000000100"), 0x1234);
    expect(f.length).toBe(20);
    expect(f[0]).toBe(0x55);
    expect(f[1]).toBe(20);
    expect(f[2]).toBe(0x04);
    // CRC-16 am Ende stimmig
    const got = f[18] | (f[19] << 8);
    expect(crc16(f, 18)).toBe(got);

    const p = new FrameParser();
    const half = Math.floor(f.length / 2);
    // Müll davor + Rahmen in zwei Teilen
    const first = new Uint8Array([0x00, 0x55, 0x13, ...f.subarray(0, half)]);
    expect(p.feed(first).length).toBe(0);
    const frames = p.feed(f.subarray(half));
    expect(frames.length).toBe(1);
    const r = frames[0];
    expect(r.sender).toBe(0x82);
    expect(r.receiver).toBe(0x06);
    expect(r.seq).toBe(0x1234);
    expect(r.cmdSet).toBe(0x06);
    expect(r.cmdId).toBe(0x72);
    expect(toHex(r.payload)).toBe("00000000000100");
  });

  test("kaputter Rahmen wird verworfen", () => {
    const f = buildFrame(0x2a, 0x00, 0x40, 0x00, 0x01);
    f[f.length - 1] = (f[f.length - 1] + 1) & 0xff;
    expect(new FrameParser().feed(f).length).toBe(0);
  });
});
