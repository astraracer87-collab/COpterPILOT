// Teil A: Einstellung „Große Pakete auch über mobile Daten laden“
// (Einstellungen → Offline-Karten). Standard: aus – große Bestände
// (Kachelspeicher DE/FR/CZ, sehr große Vektor-Feeds wie NL) werden nur im WLAN
// neu geladen.
//
// RN-frei: AsyncStorage wird lazy geladen (unter tsx bleibt der Wert im Speicher).

const KEY = "geozone_large_packs_mobile_v1";
let cached: boolean | null = null;

type Storage = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };

function storage(): Storage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage");
    return (mod?.default ?? mod) as Storage;
  } catch {
    return null;
  }
}

/** Gespeicherten Wert lesen (einmal, danach aus dem Speicher). */
export async function loadLargePacksOnMobile(): Promise<boolean> {
  if (cached != null) return cached;
  try {
    const raw = await storage()?.getItem(KEY);
    cached = raw === "1";
  } catch {
    cached = false;
  }
  return cached;
}

export function largePacksOnMobileSync(): boolean {
  return cached === true;
}

export async function setLargePacksOnMobile(value: boolean): Promise<void> {
  cached = value;
  try {
    await storage()?.setItem(KEY, value ? "1" : "0");
  } catch {}
}

/** Darf ein großes Paket jetzt geladen werden? WLAN oder ausdrücklich erlaubt. */
export function mayDownloadLargePack(onWifi: boolean, mobileAllowed: boolean): boolean {
  return onWifi || mobileAllowed;
}

/** Nur für Tests. */
export function __setLargePacksOnMobileForTests(value: boolean | null): void {
  cached = value;
}
