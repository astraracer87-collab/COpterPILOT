import TcpSocket from "react-native-tcp-socket";
import { buildFrame, FrameParser, describeFrame, deviceName, Frame } from "@/lib/fcc/duml";
import { Profile } from "@/lib/fcc/profiles";
import { FccLog } from "@/lib/fcc/log";

/** RC Pro 2 / RC Plus nutzen 8901–8904, RC 2 nutzt 40009. */
export const CANDIDATE_PORTS = [8901, 8902, 8903, 8904, 40009];
const HOST = "127.0.0.1";

export interface Outcome {
  sent: number;
  total: number;
  errors: number;
  responses: number;
}

function toUint8(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") {
    // react-native-tcp-socket liefert bei Buffer-Fallback evtl. latin1-String
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xff;
    return out;
  }
  // Buffer-ähnlich
  const anyData = data as { length?: number; [k: number]: number };
  if (anyData && typeof anyData.length === "number") {
    const out = new Uint8Array(anyData.length);
    for (let i = 0; i < anyData.length; i++) out[i] = anyData[i] & 0xff;
    return out;
  }
  return new Uint8Array(0);
}

/**
 * Öffnet eine Verbindung, schreibt einen Rahmen, sammelt Antworten im Zeitfenster, schließt.
 * Wie die eigenständige App: pro Rahmen eine kurze Verbindung.
 */
function exchange(port: number, frame: Uint8Array, readWindowMs: number): Promise<Frame[]> {
  return new Promise((resolve) => {
    const parser = new FrameParser();
    const out: Frame[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connectTimer = setTimeout(finish, 1500);
    const client = TcpSocket.createConnection({ host: HOST, port }, () => {
      clearTimeout(connectTimer);
      try {
        client.write(frame);
      } catch {
        finish();
      }
      timer = setTimeout(finish, readWindowMs);
    });

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      if (timer) clearTimeout(timer);
      try {
        client.destroy();
      } catch {
        /* ignore */
      }
      resolve(out);
    }

    client.on("data", (d: unknown) => {
      for (const f of parser.feed(toUint8(d))) out.push(f);
    });
    client.on("error", () => finish());
    client.on("close", () => finish());
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const end = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      try {
        client.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    const t = setTimeout(() => end(false), 800);
    const client = TcpSocket.createConnection({ host: HOST, port }, () => end(true));
    client.on("error", () => end(false));
  });
}

async function sleep(ms: number) {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

export const Engine = {
  savedPort: 0 as number,
  lastMode: "" as "" | "FCC" | "CE",

  /** Sucht den lokalen DUML-Port (einer, der auf die Versionsabfrage antwortet, sonst der erste offene). */
  async detectPort(quiet = false): Promise<number | null> {
    if (!quiet) FccLog.step("Suche Verbindung zur Fernsteuerung …");
    let firstOpen: number | null = null;
    for (const port of CANDIDATE_PORTS) {
      if (!(await canConnect(port))) {
        FccLog.detail(`Port ${port}: geschlossen`);
        continue;
      }
      if (firstOpen === null) firstOpen = port;
      let answers: Frame[] = [];
      try {
        answers = await exchange(port, buildFrame(0x82, 0x00, 0x40, 0x00, 0x01), 400);
      } catch (e) {
        FccLog.detail(`Port ${port}: ${String(e)}`);
      }
      FccLog.detail(`Port ${port}: offen, ${answers.length} Antwort(en)`);
      answers.forEach((f) => FccLog.detail(`   ${describeFrame(f)}`));
      if (answers.length > 0) {
        Engine.savedPort = port;
        if (!quiet) FccLog.ok(`Verbunden (Port ${port})`);
        return port;
      }
    }
    if (firstOpen !== null) {
      Engine.savedPort = firstOpen;
      if (!quiet) FccLog.ok(`Verbunden (Port ${firstOpen})`);
    } else if (!quiet) {
      FccLog.err("Keine Verbindung. Ist das Fluggerät an und mit dieser Fernsteuerung verbunden?");
    }
    return firstOpen;
  },

  async port(quiet = false): Promise<number | null> {
    if (Engine.savedPort && (await canConnect(Engine.savedPort))) return Engine.savedPort;
    return Engine.detectPort(quiet);
  },

  /** Sendet ein Profil; meldet, wie viele Befehle fehlerfrei rausgingen. */
  async runProfile(port: number, p: Profile): Promise<Outcome> {
    let sent = 0;
    let errors = 0;
    let responses = 0;
    const total = p.frames.length * p.rounds;
    for (let round = 1; round <= p.rounds; round++) {
      for (const step of p.frames) {
        const frame = buildFrame(p.sender, step.dst, p.cmdType, step.cmdSet, step.cmdId, step.payload);
        try {
          const r = await exchange(port, frame, p.readWindowMs);
          sent++;
          responses += r.length;
          FccLog.detail(`→ ${step.note}: ${r.length} Antwort(en)`);
          r.forEach((f) => FccLog.detail(`   ${describeFrame(f)}`));
        } catch (e) {
          errors++;
          FccLog.detail(`✗ ${step.note}: ${String(e)}`);
        }
        await sleep(p.interFrameMs);
      }
      if (round < p.rounds) await sleep(p.interRoundMs);
    }
    return { sent, total, errors, responses };
  },

  /** Nur lesender Test: Versionsabfrage an alle 32 Gerätetypen (Index 0 und 1). */
  async scan(port: number, sender: number): Promise<void> {
    FccLog.step(`Teilnehmersuche (Absender ${deviceName(sender)})`);
    const seen = new Set<number>();
    for (let idx = 0; idx <= 1; idx++) {
      for (let type = 0; type <= 31; type++) {
        const dst = type | (idx << 5);
        let r: Frame[] = [];
        try {
          r = await exchange(port, buildFrame(sender, dst, 0x40, 0x00, 0x01), 150);
        } catch {
          /* ignore */
        }
        for (const f of r) {
          FccLog.detail(`   ${describeFrame(f)}`);
          if (f.isResponse) seen.add(f.sender);
        }
      }
    }
    if (seen.size === 0) FccLog.warn("Keine Teilnehmer geantwortet");
    else FccLog.ok("Antwortende Teilnehmer: " + Array.from(seen).map(deviceName).join(", "));
  },
};
