import { Engine } from "@/lib/fcc/engine";
import { PROFILES } from "@/lib/fcc/profiles";
import { Keepalive } from "@/lib/fcc/keepalive";
import { FccLog } from "@/lib/fcc/log";
import { writeFile, removeFile, GoggleVariant } from "@/lib/fcc/sdcard";

export interface WizSecondary {
  label: string;
  big?: boolean;
  run: (advance: () => void) => void;
}

export interface WizStep {
  title: string;
  desc: string;
  primary: string;
  run: (advance: () => void) => void;
  secondary?: WizSecondary;
}

export interface WizardCtx {
  setMode: (m: "FCC" | "CE") => void;
  setGoggleVariant: (v: GoggleVariant) => void;
  getGoggleVariant: () => GoggleVariant;
  refreshKeepalive: () => void;
  pickAndWriteSd: () => Promise<boolean>;
  pickAndRemoveSd: () => Promise<boolean>;
}

const confirmStep = (title: string, desc: string, primary: string): WizStep => ({
  title,
  desc,
  primary,
  run: (advance) => advance(),
});

export function droneFccWizard(ctx: WizardCtx): WizStep[] {
  return [
    confirmStep(
      "Fluggerät einschalten und verbinden",
      "Schalte das Fluggerät ein und warte, bis es in DJI Fly mit dieser Fernsteuerung verbunden ist.",
      "Ist verbunden – weiter",
    ),
    {
      title: "FCC aktivieren",
      desc: "Die App sucht die Verbindung und sendet die FCC-Befehle an das Fluggerät.",
      primary: "FCC jetzt aktivieren",
      run: async (advance) => {
        const port = await Engine.port();
        if (port == null) {
          FccLog.err("Nicht möglich – keine Verbindung. Fluggerät eingeschaltet und verbunden?");
        } else {
          const o = await Engine.runProfile(port, PROFILES.fcc);
          Engine.lastMode = "FCC";
          ctx.setMode("FCC");
          if (o.errors === 0 && o.sent === o.total)
            FccLog.ok(`FCC gesendet (${o.sent}/${o.total} Befehle). Kontrolle: DJI Fly → Übertragung.`);
          else FccLog.warn(`Gesendet mit ${o.errors} Fehlern (${o.sent}/${o.total}). Ggf. erneut versuchen.`);
        }
        advance();
      },
    },
    {
      title: "FCC dauerhaft halten (optional)",
      desc:
        "DJI Fly kann die Region nach kurzer Zeit auf CE zurücksetzen. „Halten“ sendet FCC alle 2 Sekunden neu – auch im Hintergrund, während DJI Fly vorne läuft.",
      primary: "FCC dauerhaft halten",
      run: async (advance) => {
        await Keepalive.start();
        ctx.refreshKeepalive();
        advance();
      },
      secondary: { label: "Überspringen", run: (advance) => advance() },
    },
    confirmStep(
      "In DJI Fly prüfen",
      "Öffne in DJI Fly die Übertragungsansicht. Im FCC-Modus reicht die Reichweitenanzeige über 1 km hinaus. Hat sich nichts geändert: Fernsteuerung aus- und wieder einschalten und FCC erneut aktivieren.",
      "Fertig",
    ),
  ];
}

export function droneCeWizard(ctx: WizardCtx): WizStep[] {
  return [
    {
      title: "FCC halten ausschalten",
      desc: "Zuerst wird das dauerhafte Halten beendet, damit FCC nicht sofort wieder gesetzt wird.",
      primary: "Weiter",
      run: async (advance) => {
        await Keepalive.stop();
        ctx.refreshKeepalive();
        advance();
      },
    },
    {
      title: "CE-Befehl senden",
      desc: "Die App setzt die Funkregion per Befehl auf CE zurück.",
      primary: "CE jetzt senden",
      run: async (advance) => {
        const port = await Engine.port();
        if (port == null) FccLog.err("Keine Verbindung – Fluggerät eingeschaltet und verbunden?");
        else {
          const o = await Engine.runProfile(port, PROFILES.ceRestore);
          Engine.lastMode = "CE";
          ctx.setMode("CE");
          FccLog.ok(`CE gesendet (${o.sent}/${o.total}). Zum Sichern das Fluggerät neu starten, dann in DJI Fly prüfen.`);
        }
        advance();
      },
    },
    confirmStep(
      "Fluggerät neu starten",
      "Am zuverlässigsten greift CE nach einem Neustart: Fluggerät aus und wieder ein (zeigt es weiter FCC, zusätzlich die Fernsteuerung). Danach in DJI Fly prüfen, dass die Reichweite wieder dem CE-Wert entspricht.",
      "Fertig",
    ),
  ];
}

export function goggleFccWizard(ctx: WizardCtx): WizStep[] {
  return [
    {
      title: "Goggle-Modell wählen",
      desc: "Wähle dein Goggle-Modell – danach wird die passende FCC-Datei geschrieben.",
      primary: "Goggles 2 / 3 / N3 / Integra",
      run: (advance) => {
        ctx.setGoggleVariant("ham");
        FccLog.ok("Goggle-Modell: Goggles 2 / 3 / N3 / Integra");
        advance();
      },
      secondary: {
        label: "Goggles V1 / V2",
        big: true,
        run: (advance) => {
          ctx.setGoggleVariant("naco");
          FccLog.ok("Goggle-Modell: Goggles V1 / V2");
          advance();
        },
      },
    },
    confirmStep(
      "SD-Karte der Goggle in die Fernsteuerung stecken",
      "Schalte die Goggle aus, nimm ihre microSD-Karte heraus und stecke sie in die Fernsteuerung.",
      "SD-Karte ist eingelegt – weiter",
    ),
    {
      title: "FCC-Datei schreiben",
      desc: "Die App schreibt die passende FCC-Datei auf die Karte. Gleich die SD-Karte als Speicherort auswählen.",
      primary: "Datei schreiben",
      run: async (advance) => {
        const ok = await ctx.pickAndWriteSd();
        if (ok) advance();
      },
    },
    confirmStep(
      "SD-Karte zurück in die Goggle",
      "Nimm die Karte aus der Fernsteuerung und stecke sie wieder in die Goggle.",
      "Erledigt – weiter",
    ),
    confirmStep(
      "Einschaltreihenfolge",
      "1. Goggle einschalten (Karte steckt drin).\n2. Danach das Fluggerät einschalten.\n3. In DJI Fly die Übertragungsansicht prüfen – im FCC-Modus reicht die Reichweite über 1 km.\n\nWirkt es nicht, ist die Datei-Methode bei diesem Goggle-Modell evtl. nicht (mehr) wirksam.",
      "Fertig",
    ),
  ];
}

export function goggleCeWizard(ctx: WizardCtx): WizStep[] {
  return [
    confirmStep(
      "SD-Karte der Goggle in die Fernsteuerung stecken",
      "Schalte die Goggle aus, nimm ihre microSD-Karte heraus und stecke sie in die Fernsteuerung.",
      "SD-Karte ist eingelegt – weiter",
    ),
    {
      title: "FCC-Datei entfernen",
      desc: "Die App löscht die FCC-Datei wieder von der Karte. Gleich die SD-Karte als Speicherort auswählen.",
      primary: "Datei entfernen",
      run: async (advance) => {
        const ok = await ctx.pickAndRemoveSd();
        if (ok) advance();
      },
    },
    confirmStep(
      "SD-Karte zurück in die Goggle",
      "Nimm die Karte aus der Fernsteuerung und stecke sie wieder in die Goggle.",
      "Erledigt – weiter",
    ),
    confirmStep(
      "Einschalten und prüfen",
      "Goggle einschalten (Karte steckt drin), danach das Fluggerät. In DJI Fly prüfen, dass die Reichweite wieder dem CE-Wert entspricht.",
      "Fertig",
    ),
  ];
}
