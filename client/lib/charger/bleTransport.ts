/**
 * BLE-Transport zum ISDT MA331 (nur lesen).
 *
 * Ablauf (docs/isdt-ma331-protokoll.md, Abschnitt 2 und 5):
 *   1. Scan mit Herstellerdaten-Filter (Company 0xABBA, `AF FA`), Modell-ID
 *      `01400000` = MA331. `81400000` (Bootloader) wird NICHT verbunden.
 *   2. Verbinden, Dienste lesen, Notifications auf AF01, dann AF02, MTU 240.
 *      Alles zusammen höchstens 6 s.
 *   3. Kopplung auf AF02: `18 <App-ID 16 B> 00 <Modus>`. Modus 0 beim ersten
 *      Mal (Bestätigung am Gerät, bis 30 s), danach 1 (bis 8 s). Antwort
 *      `19 00` = gekoppelt. Die App-ID ist pro Ladegerät (MAC) zufällig.
 *   4. `E0` → `E1` Hardware-Info, einmal `12 C6` → `31 C7` Einstellungen
 *      (nur lesen), dann alle 1 s `12 C2` → `31 C3` Status. Immer nur EINE
 *      Anfrage unterwegs; jede Notification gibt das Senden wieder frei.
 *      10 s ohne Antwort → neu verbinden.
 *   5. Trennung/Fehler → neu verbinden mit Backoff (1, 2, 4, 8, 15, 30 s).
 *
 * Dieses Modul ist RN-frei: das BLE-Modul, der Kopplungs-Speicher, Zeit und
 * Zufall kommen über `TransportDeps` (bleManagerAdapter.ts verdrahtet
 * react-native-ble-manager). So ist die Logik mit tsx testbar.
 *
 * Fehler aus dem BLE-Stack werden NIE geworfen, sondern führen zu einem
 * Neuverbinden; Listener-Fehler werden geschluckt.
 */
import {
  appIdFromBytes,
  buildBindRequest,
  classifyFrame,
  extractIsdtPayload,
  isAllowedRequest,
  ISDT_CHAR_BIND_UUID,
  ISDT_CHAR_DATA_UUID,
  ISDT_REQUESTED_MTU,
  ISDT_SCAN_FILTER,
  ISDT_SERVICE_UUID,
  parseBindResponse,
  parseHardwareInfo,
  parseIsdtManufacturerPayload,
  parseSettings,
  parseStatus,
  REQ_HARDWARE_INFO,
  REQ_SETTINGS_READ,
  REQ_STATUS,
  toHex,
  type BindMode,
  type IsdtHardwareInfo,
  type IsdtModelKind,
  type IsdtSettings,
  type IsdtStatus,
} from "./ma331Protocol";

// ── Schnittstelle zum BLE-Modul ────────────────────────────────────────────
export interface BleAdvertising {
  manufacturerData?: Record<string, { bytes?: number[] } | undefined>;
  manufacturerRawData?: { bytes?: number[] };
  rawData?: { bytes?: number[] };
  localName?: string;
}

export interface BleDiscovered {
  id: string;
  rssi: number;
  name?: string;
  advertising: BleAdvertising;
}

export interface BleScanOptions {
  seconds: number;
  /** Herstellerdaten-Filter (Android ScanFilter); fehlt er, filtert nur JS */
  manufacturerFilter?: typeof ISDT_SCAN_FILTER;
}

export type Unsubscribe = () => void;

export interface BleLike {
  /** Initialisieren (idempotent) */
  start(): Promise<void>;
  /** "on" | "off" | … */
  checkState(): Promise<string>;
  scan(opts: BleScanOptions): Promise<void>;
  stopScan(): Promise<void>;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  retrieveServices(id: string): Promise<unknown>;
  startNotification(
    id: string,
    service: string,
    characteristic: string,
  ): Promise<void>;
  requestMTU(id: string, mtu: number): Promise<number>;
  requestConnectionPriorityHigh?(id: string): Promise<unknown>;
  writeWithoutResponse(
    id: string,
    service: string,
    characteristic: string,
    data: number[],
    maxByteSize: number,
  ): Promise<void>;
  onDiscover(cb: (p: BleDiscovered) => void): Unsubscribe;
  onDisconnect(
    cb: (e: { peripheral: string; status?: number }) => void,
  ): Unsubscribe;
  onValue(
    cb: (e: {
      peripheral: string;
      characteristic: string;
      value: number[];
    }) => void,
  ): Unsubscribe;
}

export interface PairingRecord {
  mac: string;
  /** 32 Hex-Zeichen */
  appId: string;
  modelId: string;
  /** false → Kopplung mit Modus 0 (Erstkopplung), true → Modus 1 */
  boundOnce: boolean;
  name?: string;
}

export interface PairingStore {
  get(mac: string): Promise<PairingRecord | null>;
  set(rec: PairingRecord): Promise<void>;
  /** Zuletzt erfolgreich verbundenes Ladegerät */
  getLastDevice(): Promise<string | null>;
  setLastDevice(mac: string): Promise<void>;
}

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface TransportDeps {
  ble: BleLike;
  pairing: PairingStore;
  randomBytes(n: number): number[];
  now(): number;
  timers?: TimerApi;
  log?(msg: string): void;
  /** Abfrage-Takt (Standard 1000 ms) */
  pollIntervalMs?: number;
}

// ── Zustand ────────────────────────────────────────────────────────────────
export type TransportState =
  | "idle"
  | "bluetooth-off"
  | "scanning"
  | "connecting"
  | "pairing"
  | "waiting-confirm"
  | "connected"
  | "reconnecting"
  | "stopped";

export type TransportHint =
  | "polying"
  | "not-found"
  | "bootloader"
  | "bluetooth-off"
  | "confirm-on-device"
  | "repair"
  | "mtu-low"
  | null;

export const HINT_TEXT: Record<Exclude<TransportHint, null>, string> = {
  polying:
    "Verbindung fehlgeschlagen. Polying-App schließen – das Ladegerät erlaubt nur eine Bluetooth-Verbindung. Danach verbindet sich COpter Pilot automatisch neu.",
  "not-found":
    "Kein MA331 gefunden. Ist das Ladegerät eingeschaltet und in der Nähe? Polying-App schließen – solange Polying verbunden ist, ist das Ladegerät für andere Apps unsichtbar.",
  bootloader:
    "Das Ladegerät ist im Update-Modus (Bootloader). Bitte das Firmware-Update zuerst mit der Polying-App abschließen; COpter Pilot verbindet sich im Update-Modus nicht.",
  "bluetooth-off": "Bluetooth ist ausgeschaltet. Bitte Bluetooth einschalten.",
  "confirm-on-device":
    "Erstes Koppeln: Bitte die Kopplung am Ladegerät bestätigen (Taste drücken bzw. Hinweis auf dem Display folgen).",
  repair: "Kopplung abgelaufen – neu koppeln. Bitte am Ladegerät bestätigen.",
  "mtu-low":
    "Bluetooth-Paketgröße zu klein (MTU). Statusdaten kommen evtl. unvollständig an.",
};

export interface DiscoveredCharger {
  id: string;
  name: string;
  rssi: number;
  modelId: string;
  kind: IsdtModelKind | null;
  bootloader: boolean;
  seenAt: number;
}

export interface TransportSnapshot {
  state: TransportState;
  deviceId: string | null;
  deviceName: string | null;
  modelKind: IsdtModelKind | null;
  hardware: IsdtHardwareInfo | null;
  settings: IsdtSettings | null;
  mtu: number | null;
  hint: TransportHint;
  lastError: string | null;
  /** Fehlversuche in Folge (0 = verbunden bzw. erster Versuch) */
  failures: number;
  connectedAt: number | null;
  lastStatusAt: number | null;
  nextRetryAt: number | null;
  discovered: DiscoveredCharger[];
}

export interface RawFrame {
  t: number;
  dir: "tx" | "rx";
  ch: "af01" | "af02" | "?";
  hex: string;
}

export type TransportEvent =
  | { type: "state"; snapshot: TransportSnapshot }
  | { type: "status"; status: IsdtStatus; at: number }
  | { type: "parse-error"; error: string; hex: string; at: number }
  | { type: "connection-lost"; at: number; reason: string };

export interface ChargerTransport {
  start(): void;
  stop(): Promise<void>;
  /** Sofort neu versuchen (z. B. nach „Polying geschlossen“) */
  retryNow(): void;
  snapshot(): TransportSnapshot;
  rawFrames(): RawFrame[];
  subscribe(l: (e: TransportEvent) => void): Unsubscribe;
}

export const CONNECT_TIMEOUT_MS = 6000;
export const BIND_TIMEOUT_MS = 8000;
export const FIRST_BIND_TIMEOUT_MS = 30000;
export const BIND_RETRY_MS = 1000;
export const RESPONSE_TIMEOUT_MS = 10000;
export const SCAN_SECONDS = 10;
/** Unbekanntes Gerät: so lange sammeln, dann das stärkste nehmen */
export const SCAN_PICK_DELAY_MS = 3000;
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
export const RAW_FRAME_LIMIT = 200;
/** Status-Antwort 90 B + 3 B ATT-Kopf */
export const MIN_USEFUL_MTU = 93;

export function backoffMs(failures: number): number {
  if (failures <= 0) return RECONNECT_BACKOFF_MS[0];
  return RECONNECT_BACKOFF_MS[
    Math.min(failures - 1, RECONNECT_BACKOFF_MS.length - 1)
  ];
}

function charKey(uuid: string): "af01" | "af02" | "?" {
  const u = (uuid || "").toLowerCase();
  if (u === "af01" || u.startsWith("0000af01")) return "af01";
  if (u === "af02" || u.startsWith("0000af02")) return "af02";
  return "?";
}

const errText = (e: unknown) =>
  typeof e === "string" ? e : ((e as Error)?.message ?? String(e));

class TimeoutError extends Error {}

export function createChargerTransport(deps: TransportDeps): ChargerTransport {
  const timers: TimerApi = deps.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const pollMs = deps.pollIntervalMs ?? 1000;
  const ble = deps.ble;
  const listeners = new Set<(e: TransportEvent) => void>();
  const raw: RawFrame[] = [];

  let running = false;
  let gen = 0;
  let snap: TransportSnapshot = {
    state: "idle",
    deviceId: null,
    deviceName: null,
    modelKind: null,
    hardware: null,
    settings: null,
    mtu: null,
    hint: null,
    lastError: null,
    failures: 0,
    connectedAt: null,
    lastStatusAt: null,
    nextRetryAt: null,
    discovered: [],
  };
  let subs: Unsubscribe[] = [];
  let scheduled: unknown[] = [];
  let pairing: PairingRecord | null = null;
  let bindMode: BindMode = 0;
  let bound = false;
  let inFlightSince: number | null = null;
  let settingsTries = 0;
  let scanAttempt = 0;
  let initialized = false;

  function emit(e: TransportEvent) {
    for (const l of listeners) {
      try {
        l(e);
      } catch (err) {
        deps.log?.(`[charger] listener: ${errText(err)}`);
      }
    }
  }
  function set(p: Partial<TransportSnapshot>) {
    snap = { ...snap, ...p };
    emit({ type: "state", snapshot: snap });
  }
  function later(fn: () => void, ms: number): unknown {
    const h = timers.setTimeout(() => {
      scheduled = scheduled.filter((x) => x !== h);
      try {
        fn();
      } catch (e) {
        deps.log?.(`[charger] timer: ${errText(e)}`);
      }
    }, ms);
    scheduled.push(h);
    return h;
  }
  function cancel(h: unknown) {
    if (h == null) return;
    timers.clearTimeout(h);
    scheduled = scheduled.filter((x) => x !== h);
  }
  function cancelAll() {
    for (const h of scheduled) timers.clearTimeout(h);
    scheduled = [];
  }
  function unsubscribeAll() {
    for (const u of subs) {
      try {
        u();
      } catch {
        /* egal */
      }
    }
    subs = [];
  }
  function pushRaw(
    dir: "tx" | "rx",
    ch: RawFrame["ch"],
    bytes: ArrayLike<number>,
  ) {
    raw.push({ t: deps.now(), dir, ch, hex: toHex(bytes) });
    if (raw.length > RAW_FRAME_LIMIT)
      raw.splice(0, raw.length - RAW_FRAME_LIMIT);
  }

  function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const h = later(
        () => reject(new TimeoutError(`${what}: Zeitüberschreitung`)),
        ms,
      );
      p.then(
        (v) => {
          cancel(h);
          resolve(v);
        },
        (e) => {
          cancel(h);
          reject(e);
        },
      );
    });
  }

  async function write(ch: "af01" | "af02", frame: number[]): Promise<void> {
    if (!isAllowedRequest(frame)) {
      // Nur lesen: alles andere verlässt die App nie
      deps.log?.(`[charger] blockiert: ${toHex(frame)}`);
      return;
    }
    const id = snap.deviceId;
    if (!id) return;
    pushRaw("tx", ch, frame);
    const max = Math.max(20, (snap.mtu ?? 23) - 3);
    await ble.writeWithoutResponse(
      id,
      ISDT_SERVICE_UUID,
      ch === "af01" ? ISDT_CHAR_DATA_UUID : ISDT_CHAR_BIND_UUID,
      frame,
      max,
    );
  }

  // ── Fehler / Neuverbinden ────────────────────────────────────────────────
  function fail(myGen: number, reason: string, hint: TransportHint) {
    if (myGen !== gen || !running) return;
    const wasConnected = snap.state === "connected";
    gen++;
    cancelAll();
    const id = snap.deviceId;
    if (id) void ble.disconnect(id).catch(() => {});
    bound = false;
    inFlightSince = null;
    const failures = snap.failures + 1;
    const wait = backoffMs(failures);
    deps.log?.(`[charger] ${reason} → neu in ${wait} ms`);
    if (wasConnected) emit({ type: "connection-lost", at: deps.now(), reason });
    set({
      state: "reconnecting",
      failures,
      lastError: reason,
      hint: hint ?? snap.hint,
      connectedAt: null,
      nextRetryAt: deps.now() + wait,
    });
    const g = gen;
    later(() => {
      if (g === gen && running) void cycle();
    }, wait);
  }

  // ── Zyklus: Scan → Verbinden → Koppeln → Abfragen ───────────────────────
  async function cycle(): Promise<void> {
    const myGen = ++gen;
    try {
      if (!initialized) {
        await ble.start();
        initialized = true;
      }
      const state = await ble.checkState().catch(() => "unknown");
      if (myGen !== gen) return;
      if (state === "off" || state === "turning_off") {
        set({
          state: "bluetooth-off",
          hint: "bluetooth-off",
          nextRetryAt: deps.now() + 3000,
        });
        later(() => {
          if (myGen === gen && running) void cycle();
        }, 3000);
        return;
      }
      const target = await scanForCharger(myGen);
      if (myGen !== gen) return;
      if (!target) {
        fail(
          myGen,
          "Ladegerät nicht gefunden",
          snap.discovered.some((d) => d.bootloader)
            ? "bootloader"
            : "not-found",
        );
        return;
      }
      await connectAndPair(myGen, target);
    } catch (e) {
      fail(myGen, errText(e), null);
    }
  }

  function scanForCharger(myGen: number): Promise<DiscoveredCharger | null> {
    return new Promise((resolve) => {
      let done = false;
      let known: string | null = null;
      const found = new Map<string, DiscoveredCharger>();
      let pickTimer: unknown = null;
      const finish = (d: DiscoveredCharger | null) => {
        if (done) return;
        done = true;
        cancel(pickTimer);
        cancel(endTimer);
        unsubDiscover();
        void ble.stopScan().catch(() => {});
        resolve(myGen === gen ? d : null);
      };
      const best = () => {
        const list = [...found.values()].filter((d) => !d.bootloader && d.kind);
        list.sort(
          (a, b) =>
            (a.kind === "MA331" ? 0 : 1) - (b.kind === "MA331" ? 0 : 1) ||
            b.rssi - a.rssi,
        );
        return list[0] ?? null;
      };
      const unsubDiscover = ble.onDiscover((p) => {
        if (done) return;
        const adv = parseIsdtManufacturerPayload(
          extractIsdtPayload(p.advertising),
        );
        if (!adv) return;
        const d: DiscoveredCharger = {
          id: p.id,
          name:
            adv.userName ||
            p.name ||
            p.advertising?.localName ||
            adv.model.name,
          rssi: p.rssi,
          modelId: adv.modelId,
          kind: adv.model.kind,
          bootloader: adv.model.bootloader,
          seenAt: deps.now(),
        };
        found.set(p.id, d);
        set({
          discovered: [...found.values()],
          hint: d.bootloader && found.size === 1 ? "bootloader" : snap.hint,
        });
        if (d.bootloader || !d.kind) return;
        if (known && p.id === known) finish(d);
        else if (!known && !pickTimer)
          pickTimer = later(() => finish(best()), SCAN_PICK_DELAY_MS);
      });
      const endTimer = later(
        () => finish(known ? null : best()),
        SCAN_SECONDS * 1000 + 500,
      );
      set({ state: "scanning", discovered: [], nextRetryAt: null });
      void (async () => {
        known = await deps.pairing.getLastDevice().catch(() => null);
        if (done) return;
        // Gefundenes bekanntes Gerät, bevor der Speicher antwortete?
        if (known && found.has(known) && !found.get(known)!.bootloader) {
          finish(found.get(known)!);
          return;
        }
        // Abwechselnd mit und ohne Hardware-Filter (manche Android-Stacks
        // liefern mit Herstellerdaten-Filter nichts)
        const useFilter = scanAttempt++ % 2 === 0;
        try {
          await ble.scan({
            seconds: SCAN_SECONDS,
            manufacturerFilter: useFilter ? ISDT_SCAN_FILTER : undefined,
          });
        } catch (e) {
          deps.log?.(`[charger] scan: ${errText(e)}`);
          finish(null);
        }
      })();
    });
  }

  async function connectAndPair(
    myGen: number,
    target: DiscoveredCharger,
  ): Promise<void> {
    const id = target.id;
    set({
      state: "connecting",
      deviceId: id,
      deviceName: target.name,
      modelKind: target.kind,
      mtu: null,
      hardware: null,
      settings: null,
    });
    unsubscribeAll();
    subs.push(
      ble.onDisconnect((e) => {
        if (e.peripheral !== id || myGen !== gen) return;
        fail(
          myGen,
          `Verbindung getrennt${e.status != null ? ` (Status ${e.status})` : ""}`,
          snap.state === "connected" ? null : "polying",
        );
      }),
      ble.onValue((e) => {
        if (e.peripheral !== id || myGen !== gen) return;
        onFrame(myGen, charKey(e.characteristic), e.value ?? []);
      }),
    );
    let mtu: number;
    try {
      mtu = await withTimeout(
        (async () => {
          await ble.connect(id);
          if (myGen !== gen) throw new Error("abgebrochen");
          await ble.requestConnectionPriorityHigh?.(id).catch(() => {});
          await ble.retrieveServices(id);
          await ble.startNotification(
            id,
            ISDT_SERVICE_UUID,
            ISDT_CHAR_DATA_UUID,
          );
          await ble.startNotification(
            id,
            ISDT_SERVICE_UUID,
            ISDT_CHAR_BIND_UUID,
          );
          return ble.requestMTU(id, ISDT_REQUESTED_MTU);
        })(),
        CONNECT_TIMEOUT_MS,
        "Verbinden",
      );
    } catch (e) {
      // Typisch, wenn Polying die Verbindung hält (Status 133, Timeout)
      fail(myGen, `Verbinden fehlgeschlagen: ${errText(e)}`, "polying");
      return;
    }
    if (myGen !== gen) return;
    set({ mtu, hint: mtu < MIN_USEFUL_MTU ? "mtu-low" : null });

    // Kopplung
    let rec = await deps.pairing.get(id).catch(() => null);
    if (!rec) {
      rec = {
        mac: id,
        appId: appIdFromBytes(deps.randomBytes(16)),
        modelId: target.modelId,
        boundOnce: false,
        name: target.name,
      };
      await deps.pairing.set(rec).catch(() => {});
    }
    if (myGen !== gen) return;
    pairing = rec;
    bindMode = rec.boundOnce ? 1 : 0;
    bound = false;
    const timeout = bindMode === 0 ? FIRST_BIND_TIMEOUT_MS : BIND_TIMEOUT_MS;
    set({
      state: bindMode === 0 ? "waiting-confirm" : "pairing",
      hint: bindMode === 0 ? "confirm-on-device" : snap.hint,
    });
    const sendBind = async () => {
      if (myGen !== gen || bound) return;
      try {
        await write("af02", buildBindRequest(rec!.appId, bindMode));
      } catch (e) {
        fail(myGen, `Koppeln: ${errText(e)}`, null);
        return;
      }
      later(() => void sendBind(), BIND_RETRY_MS);
    };
    later(() => {
      if (myGen !== gen || bound) return;
      void onBindTimeout(myGen);
    }, timeout);
    await sendBind();
  }

  async function onBindTimeout(myGen: number) {
    if (bindMode === 1 && pairing) {
      // Gerät kennt unsere ID nicht mehr → nächstes Mal Erstkopplung
      pairing = { ...pairing, boundOnce: false };
      await deps.pairing.set(pairing).catch(() => {});
      fail(myGen, "Kopplung nicht bestätigt", "repair");
    } else {
      fail(myGen, "Kopplung am Ladegerät nicht bestätigt", "confirm-on-device");
    }
  }

  function onFrame(myGen: number, ch: RawFrame["ch"], value: number[]) {
    pushRaw("rx", ch, value);
    // Jede Notification gibt das Senden wieder frei
    inFlightSince = null;
    const kind = classifyFrame(value);
    const now = deps.now();
    switch (kind) {
      case "bind": {
        const r = parseBindResponse(value);
        if (!r || bound) return;
        if (r.kind === "bound") {
          bound = true;
          void onBound(myGen);
        }
        return;
      }
      case "expired": {
        if (pairing) {
          pairing = { ...pairing, boundOnce: false };
          void deps.pairing.set(pairing).catch(() => {});
        }
        fail(myGen, "Kopplung abgelaufen", "repair");
        return;
      }
      case "hwinfo": {
        const hw = parseHardwareInfo(value);
        if (hw) set({ hardware: hw });
        return;
      }
      case "settings": {
        const s = parseSettings(value);
        if (s) set({ settings: s });
        return;
      }
      case "status": {
        const r = parseStatus(value, snap.modelKind ?? "MA331");
        if (r.ok) {
          snap = { ...snap, lastStatusAt: now };
          emit({ type: "status", status: r.status, at: now });
        } else
          emit({
            type: "parse-error",
            error: r.error,
            hex: toHex(value),
            at: now,
          });
        return;
      }
      default:
        return;
    }
  }

  async function onBound(myGen: number) {
    if (myGen !== gen || !pairing) return;
    if (!pairing.boundOnce) {
      pairing = { ...pairing, boundOnce: true };
      await deps.pairing.set(pairing).catch(() => {});
    }
    await deps.pairing.setLastDevice(pairing.mac).catch(() => {});
    if (myGen !== gen) return;
    set({
      state: "connected",
      failures: 0,
      hint: snap.mtu != null && snap.mtu < MIN_USEFUL_MTU ? "mtu-low" : null,
      lastError: null,
      connectedAt: deps.now(),
      nextRetryAt: null,
    });
    settingsTries = 0;
    try {
      await write("af02", [...REQ_HARDWARE_INFO]);
      inFlightSince = deps.now();
    } catch (e) {
      fail(myGen, `Hardware-Info: ${errText(e)}`, null);
      return;
    }
    schedulePoll(myGen);
  }

  function schedulePoll(myGen: number) {
    later(() => void pollTick(myGen), pollMs);
  }

  async function pollTick(myGen: number) {
    if (myGen !== gen || !running) return;
    const now = deps.now();
    if (inFlightSince != null) {
      if (now - inFlightSince >= RESPONSE_TIMEOUT_MS) {
        fail(myGen, "Keine Antwort vom Ladegerät", null);
        return;
      }
      schedulePoll(myGen);
      return;
    }
    const frame =
      snap.settings == null && settingsTries < 3
        ? (settingsTries++, [...REQ_SETTINGS_READ])
        : [...REQ_STATUS];
    inFlightSince = now;
    try {
      await write("af01", frame);
    } catch (e) {
      fail(myGen, `Senden: ${errText(e)}`, null);
      return;
    }
    schedulePoll(myGen);
  }

  return {
    start() {
      if (running) return;
      running = true;
      set({ state: "scanning", failures: 0, hint: null, lastError: null });
      void cycle();
    },
    async stop() {
      if (!running && snap.state === "stopped") return;
      running = false;
      gen++;
      cancelAll();
      unsubscribeAll();
      const id = snap.deviceId;
      const wasConnected = snap.state === "connected";
      await ble.stopScan().catch(() => {});
      if (id) await ble.disconnect(id).catch(() => {});
      bound = false;
      inFlightSince = null;
      if (wasConnected)
        emit({ type: "connection-lost", at: deps.now(), reason: "beendet" });
      set({ state: "stopped", connectedAt: null, nextRetryAt: null });
    },
    retryNow() {
      if (!running) return;
      if (snap.state === "connected") return;
      gen++;
      cancelAll();
      void cycle();
    },
    snapshot: () => snap,
    rawFrames: () => raw.slice(),
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** Rohdaten für die Zwischenablage (letzte n Frames, neueste zuletzt) */
export function formatRawFrames(frames: RawFrame[], n = 60): string {
  const tail = frames.slice(-n);
  return tail
    .map((f) => {
      const d = new Date(f.t);
      const ts = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
      return `${ts} ${f.dir === "tx" ? "→" : "←"} ${f.ch} ${f.hex}`;
    })
    .join("\n");
}
