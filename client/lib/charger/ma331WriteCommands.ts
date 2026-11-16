/**
 * SCHREIBENDE Befehle des ISDT MA331 – vorbereitet, aber in v1 NICHT verdrahtet.
 *
 * Nichts in der App importiert dieses Modul. Der Transport
 * (bleTransport.ts) sendet nur Frames, die `isAllowedRequest` aus
 * ma331Protocol.ts erlaubt – und das sind ausschließlich lesende Anfragen.
 * Wer diese Befehle später freischaltet, muss bewusst
 *   1. eine eigene, bestätigte Sende-Methode im Transport anlegen,
 *   2. die Antwort `31 C5 rr` / `31 C1 rr` auswerten
 *      (laut Polying: rr = 0 → abgelehnt, rr ≠ 0 → übernommen) und
 *   3. vorher die aktuellen Einstellungen lesen (`12 C6`) und nur das
 *      geänderte Feld ersetzen.
 *
 * Quelle: docs/isdt-ma331-protokoll.md, Abschnitt 3.1 und 3.4.
 */
import type { IsdtSettings } from "./ma331Protocol";

export const WRITE_COMMANDS_ENABLED = false as const;

/** `12 C4 d0..d6` – Einstellungen schreiben (Ladeziel, Entladen, Ton, Lampe, Stumm, Display, Modus) */
export function buildSettingsWrite(s: IsdtSettings): number[] {
  const b = (v: boolean) => (v ? 1 : 0);
  if (s.chargeTarget < 0 || s.chargeTarget > 3) throw new Error("Ladeziel 0–3");
  if (s.mode < 0 || s.mode > 3) throw new Error("Modus 0–3");
  if (s.mute && s.screenAutoOff)
    throw new Error("Stumm und Display-aus schließen sich aus");
  return [
    0x12,
    0xc4,
    s.chargeTarget,
    b(s.dischargeToZero),
    b(s.alarm),
    b(s.lamp),
    b(s.mute),
    b(s.screenAutoOff),
    s.mode,
  ];
}

/** `12 C0` + 14 Byte ASCII (mit Leerzeichen aufgefüllt) – Ladegerät umbenennen */
export function buildRename(name: string): number[] {
  const ascii = name
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, 14)
    .padEnd(14, " ");
  return [0x12, 0xc0, ...Array.from(ascii, (c) => c.charCodeAt(0))];
}

/** Antwort `31 C5 rr` bzw. `31 C1 rr`: true = übernommen, false = abgelehnt, null = keine passende Antwort */
export function parseWriteAck(
  f: ArrayLike<number>,
  cmd: "settings" | "rename",
): boolean | null {
  const expect = cmd === "settings" ? 0xc5 : 0xc1;
  if (!f || f.length < 3 || (f[0] & 0xff) !== 0x31 || (f[1] & 0xff) !== expect)
    return null;
  return (f[2] & 0xff) !== 0;
}
