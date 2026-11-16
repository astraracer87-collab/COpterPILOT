/**
 * Akkus der App für das Ladegerät: alle Akkus aller Drohnen (storage.ts,
 * unverändert genutzt über getDrones/updateDrone) plus Akkus ohne Drohne,
 * die nur in den Ladegerät-Verknüpfungen stehen (chargerStore links.json).
 */
import * as Crypto from "expo-crypto";
import {
  getDrone,
  getDrones,
  getSelectedDroneId,
  updateDrone,
  type DroneBattery,
} from "@/lib/storage";
import { getBatteryLinks } from "@/lib/chargerStore";
import { batteryKey, type BatteryLink } from "./batteryFingerprint";
import type { BatteryRef } from "./chargeSession";

export interface AppBattery {
  key: string;
  droneId?: string;
  droneName?: string;
  batteryId: string;
  label: string;
  serialNumber?: string;
  link: BatteryLink | null;
}

export async function listAllBatteries(): Promise<AppBattery[]> {
  const [drones, links] = await Promise.all([
    getDrones().catch(() => []),
    getBatteryLinks(),
  ]);
  const byKey = new Map(links.map((l) => [l.key, l]));
  const out: AppBattery[] = [];
  for (const d of drones) {
    for (const b of d.batteries ?? []) {
      const key = batteryKey({ droneId: d.id, batteryId: b.id });
      out.push({
        key,
        droneId: d.id,
        droneName: d.name,
        batteryId: b.id,
        label: b.name || "Akku",
        serialNumber: b.serialNumber || undefined,
        link: byKey.get(key) ?? null,
      });
    }
  }
  const known = new Set(out.map((b) => b.key));
  for (const l of links) {
    if (known.has(l.key)) continue;
    out.push({
      key: l.key,
      droneId: l.droneId,
      droneName: l.droneId ? "(Drohne gelöscht)" : undefined,
      batteryId: l.batteryId,
      label: l.label,
      link: l,
    });
  }
  return out;
}

export function refOf(b: AppBattery): BatteryRef {
  return {
    droneId: b.droneId,
    batteryId: b.batteryId,
    label: b.droneName ? `${b.label} (${b.droneName})` : b.label,
  };
}

function newId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `bat-${Date.now().toString(36)}`;
  }
}

/**
 * „Neuer Akku“: in der Akku-Liste der gewählten (sonst ersten) Drohne anlegen.
 * Ohne Drohne bleibt er ein Ladegerät-Akku (nur in den Verknüpfungen).
 */
export async function createBatteryForCharger(
  name: string,
  droneId?: string | null,
): Promise<BatteryRef> {
  const label = name.trim() || "Akku";
  let target = droneId ?? (await getSelectedDroneId().catch(() => null));
  let drone = target ? await getDrone(target).catch(() => null) : null;
  if (!drone) {
    const drones = await getDrones().catch(() => []);
    drone = drones[0] ?? null;
    target = drone?.id ?? null;
  }
  const id = newId();
  if (drone && target) {
    const b: DroneBattery = {
      id,
      name: label,
      serialNumber: "",
      createdAt: new Date().toISOString(),
    };
    await updateDrone(target, { batteries: [...(drone.batteries ?? []), b] });
    return {
      droneId: target,
      batteryId: id,
      label: `${label} (${drone.name})`,
    };
  }
  return { batteryId: id, label };
}
