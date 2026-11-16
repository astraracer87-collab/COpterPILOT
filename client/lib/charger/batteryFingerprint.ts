/**
 * Akku-Erkennung ohne Seriennummer (reine Logik).
 *
 * Das MA331 überträgt keine Akku-Seriennummer (docs/isdt-ma331-protokoll.md,
 * Abschnitt 9). Fingerabdruck = Produktionsdatum + Zyklenzahl, die nur steigt.
 *
 * Je Akku der App gibt es höchstens EINE Verknüpfung (BatteryLink) mit dem
 * zuletzt gesehenen Zyklenstand. Zuordnung eines gesehenen Akkus:
 *   - gleiches Datum, Zyklen ≥ letzter Stand und ≤ letzter Stand + MAX_JUMP
 *     → bei genau einem Kandidaten: Treffer;
 *   - mehrere solche Kandidaten → nachfragen (mehrdeutig);
 *   - kein naher Kandidat, aber genau ein Akku mit diesem Datum und nicht
 *     gesunkenen Zyklen (z. B. woanders geladen) → Treffer;
 *   - sonst (Datum unbekannt oder Zyklen gesunken) → nachfragen (unbekannt).
 * Akkus, die gerade in einem anderen Schacht stecken, sind ausgeschlossen.
 */
import type { BatteryRef } from "./chargeSession";

export const MAX_CYCLE_JUMP = 2;

export interface BatteryFingerprint {
  /** JJJJ-MM-TT */
  productionDate: string;
  cycles: number;
}

export interface BatteryLink {
  /** Schlüssel des App-Akkus (batteryKey) */
  key: string;
  droneId?: string;
  batteryId: string;
  label: string;
  productionDate: string;
  lastCycles: number;
  lastSeenAt: number;
  /** Optional: DJI-Akku-Seriennummer (aus Fluglogs), sobald bekannt */
  djiSerial?: string;
}

export type MatchResult =
  | { kind: "match"; link: BatteryLink }
  | { kind: "ask"; reason: "ambiguous" | "unknown"; candidates: BatteryLink[] };

/** Stabiler Schlüssel eines App-Akkus; ohne Drohne „-/<id>“ */
export function batteryKey(ref: {
  droneId?: string;
  batteryId: string;
}): string {
  return `${ref.droneId ?? "-"}/${ref.batteryId}`;
}

export function matchFingerprint(
  links: BatteryLink[],
  fp: BatteryFingerprint,
  opts: { exclude?: Set<string>; maxJump?: number } = {},
): MatchResult {
  const maxJump = opts.maxJump ?? MAX_CYCLE_JUMP;
  const sameDate = links.filter(
    (l) => l.productionDate === fp.productionDate && !opts.exclude?.has(l.key),
  );
  const mono = sameDate.filter((l) => fp.cycles >= l.lastCycles);
  const close = mono.filter((l) => fp.cycles - l.lastCycles <= maxJump);
  const byDistance = (a: BatteryLink, b: BatteryLink) =>
    fp.cycles - a.lastCycles - (fp.cycles - b.lastCycles);
  if (close.length === 1) return { kind: "match", link: close[0] };
  if (close.length > 1)
    return {
      kind: "ask",
      reason: "ambiguous",
      candidates: close.slice().sort(byDistance),
    };
  if (mono.length === 1 && sameDate.length === 1)
    return { kind: "match", link: mono[0] };
  if (mono.length >= 1)
    return {
      kind: "ask",
      reason: "ambiguous",
      candidates: mono.slice().sort(byDistance),
    };
  return { kind: "ask", reason: "unknown", candidates: [] };
}

/** Zyklenstand nach einem Treffer fortschreiben (nie rückwärts). */
export function touchLink(
  links: BatteryLink[],
  key: string,
  fp: BatteryFingerprint,
  now: number,
): BatteryLink[] {
  return links.map((l) =>
    l.key === key
      ? { ...l, lastCycles: Math.max(l.lastCycles, fp.cycles), lastSeenAt: now }
      : l,
  );
}

/**
 * Nutzer hat „Welcher Akku ist das?“ beantwortet: Verknüpfung dieses Akkus
 * anlegen oder ersetzen (je Akku genau eine).
 */
export function linkBattery(
  links: BatteryLink[],
  ref: BatteryRef,
  fp: BatteryFingerprint,
  now: number,
): BatteryLink[] {
  const key = batteryKey(ref);
  const prev = links.find((l) => l.key === key);
  const next: BatteryLink = {
    key,
    droneId: ref.droneId,
    batteryId: ref.batteryId,
    label: ref.label,
    productionDate: fp.productionDate,
    lastCycles: fp.cycles,
    lastSeenAt: now,
    ...(prev?.djiSerial ? { djiSerial: prev.djiSerial } : {}),
  };
  return [...links.filter((l) => l.key !== key), next];
}

export function refFromLink(l: BatteryLink): BatteryRef {
  return { droneId: l.droneId, batteryId: l.batteryId, label: l.label };
}
