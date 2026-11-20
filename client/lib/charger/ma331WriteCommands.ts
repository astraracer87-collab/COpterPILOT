/**
 * Schreibende Befehle des ISDT MA331 (Quelle: docs/isdt-ma331-protokoll.md, 3.1/3.4).
 *
 * Nur `12 C4` (Einstellungen) wird verwendet, und zwar ausschließlich so:
 *   1. aktuelle Einstellungen lesen (`12 C6` → `31 C7`),
 *   2. nur das vom Nutzer geänderte Feld ersetzen, alle anderen Bytes
 *      unverändert zurückschreiben,
 *   3. Antwort `31 C5 rr` auswerten (rr = 0 → abgelehnt) und danach neu lesen.
 * Umbenennen (`12 C0`) bleibt gesperrt.
 */
import type { IsdtSettings } from "./ma331Protocol";

const byte = (v: number) => Number.isInteger(v) && v >= 0 && v <= 0xff;

/** `12 C4 d0..d6` – Einstellungen schreiben (Ladeziel, Entladen, Ton, Lampe, Stumm, Display, Modus) */
export function buildSettingsWrite(s: IsdtSettings): number[] {
  const b = (v: boolean) => (v ? 1 : 0);
  if (!Number.isInteger(s.chargeTarget) || s.chargeTarget < 0 || s.chargeTarget > 3) throw new Error("Ladeziel 0–3");
  if (!byte(s.mode)) throw new Error("Modus ungültig");
  if (s.mute && s.screenAutoOff) throw new Error("Stumm und Display-aus schließen sich aus");
  return [0x12, 0xc4, s.chargeTarget, b(s.dischargeToZero), b(s.alarm), b(s.lamp), b(s.mute), b(s.screenAutoOff), s.mode];
}

/** Prüft einen `12 C4`-Frame auf genau das Format von buildSettingsWrite. */
export function isAllowedSettingsWrite(f: ArrayLike<number>): boolean {
  if (!f || f.length !== 9 || (f[0] & 0xff) !== 0x12 || (f[1] & 0xff) !== 0xc4) return false;
  if (f[2] < 0 || f[2] > 3) return false;
  for (let i = 3; i <= 7; i++) if (f[i] !== 0 && f[i] !== 1) return false;
  if (f[6] === 1 && f[7] === 1) return false;
  return byte(f[8]);
}

/** Antwort `31 C5 rr`: true = übernommen, false = abgelehnt, null = keine passende Antwort */
export function parseSettingsAck(f: ArrayLike<number>): boolean | null {
  if (!f || f.length < 3 || (f[0] & 0xff) !== 0x31 || (f[1] & 0xff) !== 0xc5) return null;
  return (f[2] & 0xff) !== 0;
}

/** Änderung auf die gelesenen Einstellungen anwenden; Stumm/Display-aus gegenseitig ausschließen. */
export function applySettingsPatch(cur: IsdtSettings, patch: Partial<IsdtSettings>): IsdtSettings {
  const next = { ...cur, ...patch };
  if (patch.mute) next.screenAutoOff = false;
  if (patch.screenAutoOff) next.mute = false;
  return next;
}
