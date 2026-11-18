// Hält den Prozess während Offline-Downloads per gemeinsamem Vordergrunddienst
// wach, damit der Länder-Download auch im Hintergrund weiterläuft.
import { foregroundServiceHost } from "@/lib/foregroundServiceHostNative";

const CLIENT_ID = "offline-download";
let holders = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function acquireDownloadKeepAlive(label: string): Promise<void> {
  holders += 1;
  try {
    await foregroundServiceHost.acquire(
      CLIENT_ID,
      async () => {
        while (holders > 0) await sleep(2000);
      },
      {
        title: "Offline-Daten werden geladen",
        description: `${label}: Download läuft weiter, auch wenn die App im Hintergrund ist.`,
        shortLabel: "Offline-Download läuft",
        linkingURI: "copterpilot://offline-maps",
        foregroundServiceType: "dataSync",
      },
      0,
    );
  } catch {
    // Ohne Dienst lädt es trotzdem weiter, solange die App vorne ist
  }
}

export async function releaseDownloadKeepAlive(): Promise<void> {
  holders = Math.max(0, holders - 1);
  if (holders === 0) await foregroundServiceHost.release(CLIENT_ID).catch(() => {});
}
