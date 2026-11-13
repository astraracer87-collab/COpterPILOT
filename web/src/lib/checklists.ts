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

export const PREFLIGHT_CHECKLIST: CheckSection[] = [
  {
    title: "Mission / Plan",
    items: [
      { id: "location", label: "Start-/Landeplatz bestätigt", required: true, tip: "Eben, hindernisfrei, mind. 3 m Radius." },
      { id: "rth", label: "RTH-Höhe korrekt gesetzt", required: true, tip: "Höher als alle Hindernisse im Fluggebiet." },
      { id: "failsafe", label: "Failsafe in App geprüft", required: true, tip: "Verhalten bei Signalverlust kennen (RTH/Hover/Land)." },
    ],
  },
  {
    title: "Drohne / Technik",
    items: [
      { id: "props", label: "Propeller fest und unbeschädigt", required: true, tip: "Auf Risse, Kerben, Verbiegungen prüfen." },
      { id: "gps", label: "GNSS-Fix stabil (10+ Sats)", required: true },
      { id: "gimbal", label: "Gimbal / Kamera geprüft", required: false, tip: "Schutzkappe entfernen, Bewegung prüfen." },
      { id: "motors", label: "Motoren auf Fremdkörper prüfen", required: true },
    ],
  },
  {
    title: "Umgebung / Safety",
    items: [
      { id: "weather_now", label: "Aktuelle Wetterbedingungen ok", required: true, tip: "Vergleiche Vorhersage mit aktuellen Werten vor Ort." },
      { id: "people", label: "Keine unbeteiligten Personen im Fluggebiet", required: true },
      { id: "obstacles", label: "Hindernisse vor Ort identifiziert", required: true, tip: "Stromleitungen, Bäume, Masten, Vögel." },
      { id: "light", label: "Sichtbedingungen geeignet (VLOS)", required: false },
    ],
  },
];

export const HOVER_CHECK_ITEMS: CheckItem[] = [
  { id: "hover_stable", label: "Drohne schwebt stabil auf 2-3 m", required: true },
  { id: "controls_responsive", label: "Steuerung reagiert korrekt", required: true, tip: "Pitch, Roll, Yaw, Throttle kurz testen." },
  { id: "compass_ok", label: "Keine Kompasswarnung", required: true },
  { id: "gps_stable", label: "GPS-Position stabil", required: true },
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
  { id: "props_check", label: "Propeller auf Beschädigung prüfen", required: true },
  { id: "battery_check", label: "Akku-Zustand prüfen", required: true },
  { id: "body_check", label: "Drohnengehäuse prüfen", required: false },
];
