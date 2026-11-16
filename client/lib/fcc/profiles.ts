import fccJson from "@/lib/fcc/profiles/fcc.json";
import keepaliveJson from "@/lib/fcc/profiles/fcc_keepalive.json";
import ceRestoreJson from "@/lib/fcc/profiles/ce_restore.json";
import deviceInfoJson from "@/lib/fcc/profiles/device_info.json";
import { hexToBytes } from "@/lib/fcc/duml";

export interface ProfileStep {
  cmdSet: number;
  cmdId: number;
  dst: number;
  payload: Uint8Array;
  note: string;
}

export interface Profile {
  name: string;
  sender: number;
  cmdType: number;
  rounds: number;
  interFrameMs: number;
  interRoundMs: number;
  readWindowMs: number;
  frames: ProfileStep[];
}

interface RawProfile {
  name: string;
  sender?: number;
  cmd_type?: number;
  rounds?: number;
  inter_frame_delay_ms?: number;
  inter_round_delay_ms?: number;
  read_window_ms?: number;
  frames: Array<{ s: number; i: number; d: number; p?: string; note?: string }>;
}

function parse(raw: RawProfile): Profile {
  return {
    name: raw.name,
    sender: raw.sender ?? 0x82,
    cmdType: raw.cmd_type ?? 0x20,
    rounds: raw.rounds ?? 1,
    interFrameMs: raw.inter_frame_delay_ms ?? 30,
    interRoundMs: raw.inter_round_delay_ms ?? 100,
    readWindowMs: raw.read_window_ms ?? 50,
    frames: raw.frames.map((f) => ({
      cmdSet: f.s,
      cmdId: f.i,
      dst: f.d,
      payload: hexToBytes(f.p ?? ""),
      note: f.note ?? "",
    })),
  };
}

export const PROFILES = {
  fcc: parse(fccJson as RawProfile),
  keepalive: parse(keepaliveJson as RawProfile),
  ceRestore: parse(ceRestoreJson as RawProfile),
  deviceInfo: parse(deviceInfoJson as RawProfile),
};

export type ProfileName = keyof typeof PROFILES;
