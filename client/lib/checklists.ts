import { Feather } from "@expo/vector-icons";

export interface CheckItem {
  id: string;
  label: string;
  required: boolean;
  tip?: string;
  excludeForClasses?: string[];
}

export interface CheckSection {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  items: CheckItem[];
}

export const PREFLIGHT_CHECKLIST: CheckSection[] = [
  {
    title: "Mission / Plan",
    icon: "map",
    items: [
      { 
        id: "location", 
        label: "Start-/Landeplatz bestätigt", 
        required: true,
        tip: "Überprüfe den gewählten Platz vor Ort: eben, hindernisfrei, mindestens 3m Radius."
      },
      { 
        id: "rth", 
        label: "RTH-Höhe korrekt gesetzt", 
        required: true,
        tip: "Return-to-Home Höhe sollte höher als alle Hindernisse im Fluggebiet sein."
      },
      { 
        id: "failsafe", 
        label: "Failsafe in App geprüft", 
        required: true,
        tip: "Prüfe das Verhalten bei Signalverlust: RTH, Hovern oder Landen?"
      },
    ],
  },
  {
    title: "Drohne / Technik",
    icon: "cpu",
    items: [
      { 
        id: "props", 
        label: "Propeller fest und unbeschädigt", 
        required: true,
        tip: "Prüfe alle Propeller auf Risse, Kerben und Verbiegungen."
      },
      { 
        id: "gps", 
        label: "GNSS-Fix stabil (10+ Sats)", 
        required: true,
        tip: "Warte auf mindestens 10+ Satelliten für stabilen Fix."
      },
      { 
        id: "gimbal", 
        label: "Gimbal / Kamera geprüft", 
        required: false,
        tip: "Entferne Gimbalschutz vor dem Start. Prüfe ob sich Gimbal frei bewegt."
      },
      { 
        id: "motors", 
        label: "Motoren auf Fremdkörper prüfen", 
        required: true,
        tip: "Prüfe visuell auf Gras, Haare oder Schmutz in den Motorgehäusen."
      },
    ],
  },
  {
    title: "Umgebung / Safety",
    icon: "shield",
    items: [
      { 
        id: "weather_now", 
        label: "Aktuelle Wetterbedingungen ok", 
        required: true,
        tip: "Vergleiche die Vorhersage mit den aktuellen Bedingungen vor Ort."
      },
      { 
        id: "people", 
        label: "Keine unbeteiligten Personen im Fluggebiet", 
        required: true,
        tip: "Halte in Open Category Abstand zu Unbeteiligten.",
        excludeForClasses: ["C0"],
      },
      { 
        id: "obstacles", 
        label: "Hindernisse vor Ort identifiziert", 
        required: true,
        tip: "Achte auf: Stromleitungen, Bäume, Masten, Kräne, Vögel."
      },
      { 
        id: "light", 
        label: "Sichtbedingungen geeignet", 
        required: false,
        tip: "Für VLOS brauchst du die Drohne klar sehen."
      },
    ],
  },
];

export const HOVER_CHECK_ITEMS: CheckItem[] = [
  { id: "stable_hover", label: "Drohne schwebt stabil auf 2-3m", required: true },
  { id: "hover_stable", label: "Drohne schwebt stabil", required: true },
  { id: "control_response", label: "Steuerung reagiert korrekt", required: true },
  { id: "controls_responsive", label: "Steuerung reagiert korrekt", required: true },
  { id: "compass_ok", label: "Keine Kompasswarnung", required: true },
  { id: "gps_stable", label: "GPS-Position stabil", required: true },
  { id: "camera_ok", label: "Kamerabild ok", required: false },
  { id: "camera_working", label: "Kamera/Gimbal funktioniert", required: false },
  { id: "no_vibrations", label: "Keine ungewöhnlichen Vibrationen", required: true },
  { id: "battery_ok", label: "Akkustand plausibel", required: true },
  { id: "rth_confirmed", label: "RTH-Punkt korrekt gesetzt", required: true },
  { id: "airspace_clear", label: "Luftraum frei", required: true },
  { id: "ready_for_mission", label: "Bereit für den Flug", required: true },
];

export const POSTLANDING_CHECK_ITEMS: CheckItem[] = [
  { id: "safe_landing", label: "Sichere Landung durchgeführt", required: true },
  { id: "motors_stopped", label: "Motoren gestoppt", required: true },
  { id: "props_check", label: "Propeller auf Beschädigungen prüfen", required: true },
  { id: "battery_check", label: "Akku-Zustand prüfen", required: true },
  { id: "body_check", label: "Drohnengehäuse prüfen", required: false },
];

export const DEBRIEFING_ITEMS: CheckItem[] = [
  { id: "flight_objectives", label: "Flugziele erreicht", required: true },
  { id: "no_incidents", label: "Keine Zwischenfälle", required: true },
  { id: "equipment_ok", label: "Equipment in Ordnung", required: true },
  { id: "notes_added", label: "Notizen/Beobachtungen festgehalten", required: false },
];

export const PLANNING_CHECKLIST: CheckSection[] = [
  {
    title: "Recht",
    icon: "file-text",
    items: [
      { id: "license", label: "Lizenz gültig", required: true },
    ],
  },
  {
    title: "Flugplanung",
    icon: "map",
    items: [
      { id: "route", label: "Flugroute / -gebiet geplant", required: true },
      { id: "airspace", label: "Luftraum und Hindernisse ok", required: true },
      { id: "notams", label: "NOTAMs geprüft", required: true },
      { id: "weather", label: "Wetter geprüft", required: true },
    ],
  },
  {
    title: "Vorbereitung",
    icon: "package",
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
  { id: "spotter_confirmed", label: "Spotter organisiert und bestätigt", required: true },
  { id: "spotter_briefed", label: "Spotter über Fluggebiet und Notfallprozeduren informiert", required: true },
];

/**
 * Zusätzliche FPV-Punkte, die in ChecklistScreen / PlanningChecklistScreen
 * dynamisch eingeblendet werden (klassischer Spotter-Modus + DMFV/DMO
 * Verbandsbetriebserlaubnis nach Art. 16 EU-VO 2019/947). Hier nur zentral
 * registriert, damit `getCheckItemLabel(id)` (PDF-Export, Logbuch, History)
 * die deutschen Labels statt humanisierter IDs auflösen kann.
 */
export const FPV_DYNAMIC_ITEMS: CheckItem[] = [
  // Klassischer FPV-Modus (Pre-Flight)
  { id: "spotter_present", label: "Spotter ist vor Ort und bereit", required: true },
  { id: "spotter_communication", label: "Kommunikation mit Spotter getestet", required: true },
  { id: "goggles_ready", label: "FPV-Brille/Bildschirm betriebsbereit", required: true },
  // DMFV/DMO Verbandsbetriebserlaubnis nach Art. 16 EU-VO (max. 30 m, ohne Spotter)
  { id: "verband_height_limited_30m", label: "Flughöhe in App/Drohne auf max. 30 m AGL begrenzt", required: true },
  { id: "verband_member_card_ready", label: "Verbandsausweis (DMFV/DMO) griffbereit", required: true },
  { id: "verband_height_planning_30m", label: "Flughöhe in der Planung auf max. 30 m AGL festgelegt", required: true },
  { id: "verband_member_card_planned", label: "Verbandsausweis (DMFV/DMO) wird mitgeführt", required: true },
];

export function getAllPreflightItems(): CheckItem[] {
  return PREFLIGHT_CHECKLIST.flatMap(section => section.items);
}

export function getPreflightItemsForClass(droneClass?: string): CheckItem[] {
  return getAllPreflightItems().filter(item => {
    if (!item.excludeForClasses) return true;
    if (!droneClass) return true;
    return !item.excludeForClasses.includes(droneClass);
  });
}

export function getAllPlanningItems(): CheckItem[] {
  return PLANNING_CHECKLIST.flatMap(section => section.items);
}

export function getCheckItemLabel(id: string): string | undefined {
  const allItems = [
    ...getAllPlanningItems(),
    ...FPV_PLANNING_ITEMS,
    ...FPV_DYNAMIC_ITEMS,
    ...getAllPreflightItems(),
    ...HOVER_CHECK_ITEMS,
    ...POSTLANDING_CHECK_ITEMS,
    ...DEBRIEFING_ITEMS,
    { id: "confirm", label: "Regeln geprüft und bestätigt" },
  ];
  return allItems.find(item => item.id === id)?.label;
}
