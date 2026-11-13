export type CheckItem = {
  id: string;
  label: string;
  required: boolean;
  tip?: string;
};

export type CheckSection = {
  title: string;
  items: CheckItem[];
};

export const PLANNING_CHECKLIST: CheckSection[] = [
  {
    title: "Recht",
    items: [
      { id: "license", label: "Lizenz gültig", required: true, tip: "EU-Kompetenznachweis A1/A3 bzw. A2-Fernpilotenzeugnis vorhanden und gültig." },
    ],
  },
  {
    title: "Flugplanung",
    items: [
      { id: "route", label: "Flugroute / -gebiet geplant", required: true, tip: "Start-/Landeplatz, geplante Route und Notlandeflächen festgelegt." },
      { id: "airspace", label: "Luftraum und Hindernisse ok", required: true, tip: "Geozonen, CTR/EDR, Hindernisse (Masten, Leitungen) geprüft." },
      { id: "notams", label: "NOTAMs geprüft", required: true, tip: "Aktuelle NOTAMs für die Region eingesehen." },
      { id: "weather", label: "Wetter geprüft", required: true, tip: "Vorhersage für den Flugzeitraum innerhalb der Drohnen-Limits." },
    ],
  },
  {
    title: "Vorbereitung",
    items: [
      { id: "drone_ready", label: "Drohne ist flugfähig / gewartet", required: true },
      { id: "firmware", label: "Software und Firmware aktualisiert", required: true },
      { id: "batteries", label: "Batterien aufgeladen", required: true },
      { id: "controller", label: "Fernbedienung / Bodenstation geladen", required: true },
      { id: "equipment", label: "Ausrüstung vorbereitet / gepackt", required: false },
      { id: "sdcard", label: "Speicherkarten vorbereitet", required: false },
    ],
  },
];

export const FPV_PLANNING_ITEMS: CheckItem[] = [
  { id: "spotter_confirmed", label: "Spotter organisiert und bestätigt", required: true, tip: "Im FPV-Modus ist eine zweite Person als Beobachter (VLOS) gesetzlich vorgeschrieben." },
  { id: "spotter_briefed", label: "Spotter über Fluggebiet und Notfallprozeduren informiert", required: true },
];

export function getAllPlanningItems(): CheckItem[] {
  return PLANNING_CHECKLIST.flatMap((s) => s.items);
}
