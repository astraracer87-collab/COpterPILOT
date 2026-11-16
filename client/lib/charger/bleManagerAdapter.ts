/**
 * Verdrahtung von react-native-ble-manager (TurboModule, New Architecture)
 * auf die schmale `BleLike`-Schnittstelle des Transports.
 *
 * Das native Modul wird erst bei Bedarf geladen (Tests, Web, alte APK ohne
 * Modul → `null`). Fehler werden als abgelehnte Promises weitergegeben; der
 * Transport fängt sie ab.
 */
import { Platform } from "react-native";
import type { BleLike, Unsubscribe } from "./bleTransport";

type BleManagerModule = typeof import("react-native-ble-manager").default;

let cached: BleManagerModule | null | undefined;

function manager(): BleManagerModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== "android") return (cached = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-ble-manager");
    cached = (mod?.default ?? mod) as BleManagerModule;
    if (!cached || typeof cached.scan !== "function") cached = null;
  } catch {
    cached = null;
  }
  return cached;
}

/** BLE-Modul in dieser APK vorhanden? */
export function isBleAvailable(): boolean {
  return manager() != null;
}

const sub =
  (s: { remove(): void } | undefined | null): Unsubscribe =>
  () => {
    try {
      s?.remove();
    } catch {
      /* egal */
    }
  };

/** BleLike auf Basis von react-native-ble-manager; null ohne natives Modul. */
export function createBleManagerAdapter(): BleLike | null {
  const m = manager();
  if (!m) return null;
  return {
    start: () => m.start({ showAlert: false }),
    checkState: async () => String(await m.checkState()),
    scan: (o) =>
      m.scan({
        serviceUUIDs: [],
        seconds: o.seconds,
        allowDuplicates: false,
        scanMode: 2, // LowLatency
        ...(o.manufacturerFilter
          ? { manufacturerData: o.manufacturerFilter }
          : {}),
      }),
    stopScan: () => m.stopScan(),
    connect: (id) => m.connect(id),
    disconnect: (id) => m.disconnect(id, true),
    retrieveServices: (id) => m.retrieveServices(id),
    startNotification: (id, s, c) => m.startNotification(id, s, c),
    requestMTU: (id, mtu) => m.requestMTU(id, mtu),
    requestConnectionPriorityHigh: (id) => m.requestConnectionPriority(id, 1),
    writeWithoutResponse: (id, s, c, data, max) =>
      m.writeWithoutResponse(id, s, c, data, max),
    onDiscover: (cb) =>
      sub(
        m.onDiscoverPeripheral((p) =>
          cb({
            id: p.id,
            rssi: p.rssi,
            name: p.name,
            advertising: p.advertising ?? {},
          }),
        ),
      ),
    onDisconnect: (cb) =>
      sub(
        m.onDisconnectPeripheral((e) =>
          cb({ peripheral: e.peripheral, status: e.status }),
        ),
      ),
    onValue: (cb) =>
      sub(
        m.onDidUpdateValueForCharacteristic((e) =>
          cb({
            peripheral: e.peripheral,
            characteristic: e.characteristic,
            value: e.value,
          }),
        ),
      ),
  };
}

/** Android: Bluetooth einschalten lassen (Systemdialog). */
export async function requestEnableBluetooth(): Promise<boolean> {
  const m = manager();
  if (!m) return false;
  try {
    await m.enableBluetooth();
    return true;
  } catch {
    return false;
  }
}
