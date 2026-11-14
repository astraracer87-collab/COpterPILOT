// Cinematische Kamera- und Tuning-Einstellungen pro Drohnenmodell sowie eine
// allgemeine Anleitung mit Flugmanövern für Einsteiger.
//
// Quelle der Inhalte: Flying Filmmaker (flyingfilmmakerpro.com).
// Technische Werte (ISO, Verschlusszeit, Bildrate, Grad/s …) wurden bewusst
// beibehalten, erklärende Texte sind ins Deutsche übersetzt. Ohne Emojis.

export interface CinematicGroup {
  title: string;
  items: string[];
}

export interface DroneCinematicSettings {
  model: string; // muss zu DronePreset.model passen
  displayName: string;
  source: string;
  sourceUrl: string;
  groups: CinematicGroup[];
}

export interface DroneMoveSection {
  label?: string;
  steps: string[];
}

export interface DroneMove {
  title: string;
  sections: DroneMoveSection[];
}

export interface DroneMovesGuide {
  title: string;
  source: string;
  sourceUrl: string;
  moves: DroneMove[];
}

const SOURCE = "Flying Filmmaker";
const SOURCE_URL = "https://flyingfilmmakerpro.com";

const EXPOSURE_STD: string[] = [
  "Pro-Modus",
  "ISO und Verschlusszeit manuell",
  "ISO: so niedrig wie möglich, ISO 100 ist ideal. Bei wenig Licht ist die Qualität bis ISO 800 noch brauchbar, bis ISO 400 gut.",
  "Verschlusszeit: idealerweise ND-Filter und 180-Grad-Regel verwenden — Verschlusszeit = 2x Bildrate (24 FPS = 1/50, 30 FPS = 1/60, 60 FPS = 1/120).",
];

const WB_5700: string[] = [
  "Weißabgleich manuell",
  "Sonnig 5600K, Bewölkt 6300K+, Sonnenauf-/untergang 5700K",
];

const COLOR_DLOGM: string[] = [
  "Normal: ordentliche Qualität, 10-bit, gut für schnelle Aufnahmen, weniger Spielraum beim Color Grading.",
  "HLG (Hybrid Log Gamma): guter Grading-Spielraum, etwas leichter zu graden als D-LOG M; Bug, der Kontrast und Helligkeit mitten in der Aufnahme anpasst.",
  "D-LOG M: bester Grading-Spielraum, keine Kontrast-Glitches, schwerer zu graden.",
  "Empfehlung: D-LOG M oder HLG",
];

export const DRONE_CINEMATIC_SETTINGS: DroneCinematicSettings[] = [
  {
    model: "Air 3S",
    displayName: "DJI Air 3S",
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    groups: [
      { title: "Belichtung", items: EXPOSURE_STD },
      { title: "Weißabgleich", items: WB_5700 },
      {
        title: "Auflösung & Bildrate",
        items: [
          "Auflösung: 4K",
          "Bildrate: 30 FPS normal, 60 FPS für Zeitlupe",
          "Zeitlupe: 60 FPS für 1/2 Geschwindigkeit, 4K 120 FPS für 1/4 Geschwindigkeit",
          "1080p 240 FPS hat sehr schlechte Qualität",
        ],
      },
      { title: "Farbprofil", items: COLOR_DLOGM },
      { title: "Gain & Expo - Cine-Modus", items: ["Alle Einstellungen auf Standard"] },
      {
        title: "Gain & Expo - Normal-Modus",
        items: [
          "Max. Horizontal-, Steig- und Sinkgeschwindigkeit: Max",
          "Max. Winkelgeschwindigkeit: 75 Grad/s",
          "Yaw-Smoothness: 15",
          "Bremsen: 100",
          "Expo: Hoch/Runter 0.25, Yaw 0.15, Pitch/Roll 0.2",
          "Max. Gimbal-Neigegeschwindigkeit: 15 Grad/s",
          "Neige-Smoothness: 10",
        ],
      },
      {
        title: "Gain & Expo - Sport-Modus",
        items: [
          "Max. Horizontal-, Steig- und Sinkgeschwindigkeit: Max",
          "Max. Winkelgeschwindigkeit: 120 Grad/s",
          "Yaw-Smoothness: 12",
          "Bremsen: 100",
          "Expo: Hoch/Runter 0.3, Yaw 0.15, Pitch/Roll 0.25",
          "Max. Gimbal-Neigegeschwindigkeit: 20 Grad/s",
          "Neige-Smoothness: 15",
        ],
      },
      {
        title: "Zoom",
        items: [
          "1x- oder 3x-Kamera; andere Einstellungen haben schlechte Qualität.",
          "Auf der DJI RC2 die C2-Taste zum Wechseln zwischen den Kameras belegen.",
        ],
      },
      {
        title: "Weitere Kameraeinstellungen",
        items: ["Histogramm: An", "Center-Marker und Drittel-Raster: An"],
      },
    ],
  },
  {
    model: "Mini 5 Pro",
    displayName: "DJI Mini 5 Pro",
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    groups: [
      { title: "Belichtung", items: EXPOSURE_STD },
      {
        title: "Weißabgleich",
        items: [
          "Weißabgleich manuell",
          "Sonnig 5600K, Bewölkt 6300K+, Sonnenauf-/untergang 5800K",
        ],
      },
      {
        title: "Auflösung & Bildrate",
        items: [
          "Auflösung: 4K",
          "Bildrate: 30 FPS normal, 60 FPS für Zeitlupe",
          "Zeitlupe: 60 FPS für 1/2 Geschwindigkeit, 4K 120 FPS für 1/4 Geschwindigkeit",
          "1080p 240 FPS hat sehr schlechte Qualität",
        ],
      },
      { title: "Farbprofil", items: COLOR_DLOGM },
      {
        title: "Zoom",
        items: [
          "1x oder 2x Crop; andere Einstellungen haben schlechte Qualität.",
          "Auf der DJI RC2 die C2-Taste zum Wechseln zwischen den Kameras belegen.",
        ],
      },
      { title: "Gain & Expo - Cine-Modus", items: ["Alle Einstellungen auf Standard"] },
      {
        title: "Gain & Expo - Normal-Modus",
        items: [
          "Max. Horizontal-, Steig- und Sinkgeschwindigkeit: Max",
          "Max. Winkelgeschwindigkeit: 75 Grad/s",
          "Yaw-Smoothness: 15",
          "Bremsen: 100",
          "Expo: Hoch/Runter 0.25, Yaw 0.15, Pitch/Roll 0.2",
          "Max. Gimbal-Neigegeschwindigkeit: 15 Grad/s",
          "Neige-Smoothness: 13",
          "Max. Gimbal-Rollgeschwindigkeit: 5 Grad/s",
          "Roll-Smoothness: 10",
        ],
      },
      {
        title: "Gain & Expo - Sport-Modus",
        items: [
          "Max. Horizontal-, Steig- und Sinkgeschwindigkeit: Max",
          "Max. Winkelgeschwindigkeit: 120 Grad/s",
          "Yaw-Smoothness: 15",
          "Bremsen: 100",
          "Expo: Hoch/Runter 0.3, Yaw 0.15, Pitch/Roll 0.25",
          "Max. Gimbal-Neigegeschwindigkeit: 20 Grad/s",
          "Neige-Smoothness: 15",
          "Max. Gimbal-Rollgeschwindigkeit: 10 Grad/s",
          "Roll-Smoothness: 13",
        ],
      },
      {
        title: "Weitere Kameraeinstellungen",
        items: [
          "Histogramm: An",
          "Center-Marker und Drittel-Raster: An",
          "Schärfe: -1 oder 0",
          "Rauschreduzierung: -1 oder 0",
        ],
      },
    ],
  },
  {
    model: "Neo",
    displayName: "DJI Neo",
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    groups: [
      {
        title: "Nur Drohne / Steuerung per Smartphone",
        items: [
          "Auflösung: 4K",
          "Bildrate: 30 FPS",
          "Encoding: H.265 (oder H.264, falls der Computer H.265 nicht verarbeiten kann)",
        ],
      },
      {
        title: "Fernsteuerung - Belichtung",
        items: [
          "Pro-Modus",
          "ISO und Verschlusszeit manuell",
          "ISO: so niedrig wie möglich, ISO 100 ist ideal.",
          "Verschlusszeit: idealerweise ND-Filter und 180-Grad-Regel — Verschlusszeit = 2x Bildrate (30 FPS = 1/60).",
        ],
      },
      { title: "Fernsteuerung - Weißabgleich", items: WB_5700 },
      {
        title: "Fernsteuerung - Auflösung & Bildrate",
        items: ["Auflösung: 4K", "Bildrate: 30 FPS"],
      },
      { title: "Fernsteuerung - Gain & Expo - Cine-Modus", items: ["Alle Einstellungen auf Standard"] },
      {
        title: "Fernsteuerung - Gain & Expo - Normal-Modus",
        items: [
          "Max. Horizontal-, Steig- und Sinkgeschwindigkeit: Max",
          "Max. Winkelgeschwindigkeit: 75 Grad/s",
          "Bremsen: 100",
          "Expo: Hoch/Runter 0.25, Yaw 0.15, Pitch/Roll 0.2",
          "Max. Gimbal-Neigegeschwindigkeit: 15 Grad/s",
          "Neige-Smoothness: 10",
        ],
      },
      {
        title: "Fernsteuerung - Gain & Expo - Sport-Modus",
        items: [
          "Max. Horizontal-, Steig- und Sinkgeschwindigkeit: Max",
          "Max. Winkelgeschwindigkeit: 120 Grad/s",
          "Bremsen: 100",
          "Expo: Hoch/Runter 0.3, Yaw 0.15, Pitch/Roll 0.25",
          "Max. Gimbal-Neigegeschwindigkeit: 20 Grad/s",
          "Neige-Smoothness: 15",
        ],
      },
      {
        title: "Fernsteuerung - Weitere Kameraeinstellungen",
        items: [
          "Histogramm: An",
          "Center-Marker und Drittel-Raster: An",
          "Schärfe: -2",
          "Rauschreduzierung: -1",
        ],
      },
      {
        title: "FPV-Brille - Belichtung",
        items: [
          "MANUELL-Modus",
          "ISO und Verschlusszeit manuell",
          "ISO: so niedrig wie möglich, ISO 100 ist ideal. Auto-ISO verwenden, wenn zwischen hellen und dunklen Bereichen geflogen wird.",
          "Verschlusszeit (smooth/cinematic): idealerweise ND-Filter und 180-Grad-Regel — Verschlusszeit = 2x Bildrate (30 FPS = 1/60).",
          "Verschlusszeit (aggressiv/Freestyle): ohne ND-Filter, Verschlusszeit zur Belichtungskorrektur erhöhen.",
        ],
      },
      { title: "FPV-Brille - Weißabgleich", items: WB_5700 },
      {
        title: "FPV-Brille - Auflösung & Bildrate",
        items: [
          "Auflösung: 4K",
          "Bildrate: 30 FPS für cinematische Aufnahmen, 60 FPS für den flüssigsten Brillen-Feed bei niedrigerer Auflösung.",
          "Seitenverhältnis: 16:9 für die meisten Zwecke. 4:3 bietet mehr Reframing-Spielraum, hat aber schwächere Drohnen-Stabilisierung.",
        ],
      },
      {
        title: "FPV-Brille - Stabilisierung",
        items: [
          "EIS RockSteady: gute Stabilisierung direkt aus der Drohne. Für die meisten Zwecke empfohlen.",
          "EIS HorizonBalancing: versucht den Horizont gerade zu halten, beschneidet das Bild aber stark. Nicht empfohlen.",
        ],
      },
      {
        title: "FPV-Brille - Weitere Kameraeinstellungen",
        items: ["Schärfe: -2", "Rauschreduzierung: -1"],
      },
    ],
  },
  {
    model: "Mavic 4 Pro",
    displayName: "DJI Mavic 4 Pro",
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    groups: [
      {
        title: "Belichtung",
        items: [
          "Pro-Modus",
          "ISO und Verschlusszeit manuell",
          "ISO: so niedrig wie möglich, ISO 100 ideal in Normal, HLG und D-LOG M; 400 als Basis-ISO ideal in D-LOG.",
          "Verschlusszeit: idealerweise ND-Filter und 180-Grad-Regel — Verschlusszeit = 2x Bildrate (24 FPS = 1/50, 30 FPS = 1/60, 60 FPS = 1/120).",
          "Blende: zur Helligkeitsregelung der Weitwinkelkamera. F11 für Sonnensterne bei Aufnahmen gegen die Sonne.",
        ],
      },
      { title: "Weißabgleich", items: WB_5700 },
      {
        title: "Auflösung & Bildrate",
        items: [
          "Auflösung: 6K Hauptkamera, 4K Telekameras",
          "Bildrate: 30 FPS normal, 60 FPS für Zeitlupe",
          "Zeitlupe: 60 FPS für 1/2 Geschwindigkeit, 4K 120 FPS für 1/4 Geschwindigkeit",
          "Vertikalaufnahme: Kamera für den vollen Sensor in 6K/4K drehen.",
        ],
      },
      {
        title: "Farbprofil",
        items: [
          "Normal: ordentliche Qualität, 10-bit, gut für schnelle Aufnahmen, weniger Spielraum beim Color Grading.",
          "HLG (Hybrid Log Gamma): mittlerer Grading-Spielraum, für HDR-Auslieferung gedacht; Bug, der Kontrast und Helligkeit mitten in der Aufnahme anpasst.",
          "D-LOG M: guter Grading-Spielraum, nicht so gut wie D-LOG.",
          "D-LOG: bester Grading-Spielraum und Dynamikumfang, flacher als D-LOG M, braucht mehr Grading, lässt sich aber sehr gut graden.",
          "Empfehlung: D-LOG",
        ],
      },
      { title: "Gain & Expo - Cine-Modus", items: ["Alle Einstellungen auf Standard"] },
      {
        title: "Gain & Expo - Normal-Modus",
        items: [
          "Max. Horizontal-, Steig- und Sinkgeschwindigkeit: Max",
          "Max. Winkelgeschwindigkeit: 75 Grad/s",
          "Yaw-Smoothness: 15",
          "Bremsen: 100",
          "Expo: Hoch/Runter 0.25, Yaw 0.15, Pitch/Roll 0.2",
          "Max. Gimbal-Neigegeschwindigkeit: 15 Grad/s",
          "Neige-Smoothness: 10",
        ],
      },
      {
        title: "Gain & Expo - Sport-Modus",
        items: [
          "Max. Horizontal-, Steig- und Sinkgeschwindigkeit: Max",
          "Max. Winkelgeschwindigkeit: 120 Grad/s",
          "Yaw-Smoothness: 12",
          "Bremsen: 100",
          "Expo: Hoch/Runter 0.3, Yaw 0.15, Pitch/Roll 0.25",
          "Max. Gimbal-Neigegeschwindigkeit: 20 Grad/s",
          "Neige-Smoothness: 15",
        ],
      },
      {
        title: "Zoom",
        items: [
          "1x-, 2.5x- oder 6x-Kamera; Zwischeneinstellungen haben deutlich schlechtere Qualität.",
          "Auf der DJI RC2 die C2-Taste zum Wechseln zwischen den Kameras belegen.",
        ],
      },
      {
        title: "Weitere Kameraeinstellungen",
        items: ["Histogramm: An", "Center-Marker und Drittel-Raster: An"],
      },
    ],
  },
  {
    model: "Avata 2",
    displayName: "DJI Avata 2",
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    groups: [
      {
        title: "Belichtung",
        items: [
          "MANUELL-Modus",
          "ISO und Verschlusszeit manuell",
          "ISO: so niedrig wie möglich, ISO 100 ist ideal. Auto-ISO verwenden, wenn zwischen hellen und dunklen Bereichen geflogen wird.",
          "Verschlusszeit (smooth/cinematic): idealerweise ND-Filter und 180-Grad-Regel — Verschlusszeit = 2x Bildrate (60 FPS Echtzeit = 1/60, 60 FPS Zeitlupe = 1/120).",
          "Verschlusszeit (aggressiv/Freestyle): ohne ND-Filter, Verschlusszeit zur Belichtungskorrektur erhöhen.",
        ],
      },
      { title: "Weißabgleich", items: WB_5700 },
      {
        title: "Auflösung & Bildrate",
        items: [
          "Auflösung: 4K",
          "Bildrate: 60 FPS (30 FPS macht den Brillen-Feed ruckelig)",
          "Zeitlupe: 4K 100 FPS für Zeitlupe schneller Action",
          "Seitenverhältnis: 4:3 bietet die meiste Reframing-Flexibilität (16:9 horizontal oder 9:16 vertikal). 16:9 füllt die Brille mehr, verliert aber oben und unten Bildanteil.",
        ],
      },
      {
        title: "Farbprofil",
        items: [
          "Normal: OK direkt aus der Kamera, deutlich weniger Dynamikumfang, sehr wenig Grading-Spielraum.",
          "D-LOG M: deutlich besserer Dynamikumfang, guter Grading-Spielraum, leicht zu graden.",
        ],
      },
      {
        title: "Sichtfeld (FOV) & Stabilisierung",
        items: [
          "FOV: Wide oder UltraWide. Normal ist zu eng; UltraWide funktioniert NICHT mit GyroFlow und hat mehr Verzeichnung.",
          "EIS RockSteady: gute Stabilisierung direkt aus der Drohne. Für die meisten Zwecke ok.",
          "EIS Aus: stabilisiert das Video nicht, zeichnet aber Gyro-Daten für die Post-Stabilisierung mit GyroFlow auf. Glattere Ergebnisse als RockSteady. WARNUNG: zeichnet Gyro-Daten nur auf, wenn das FOV auf WIDE steht.",
          "Empfehlung: RockSteady für den Alltag, Aus + GyroFlow für die glattesten Ergebnisse.",
        ],
      },
      { title: "Gain & Expo", items: ["Standardeinstellungen"] },
      {
        title: "Weitere Kameraeinstellungen",
        items: ["Schärfe: -1", "Rauschreduzierung: -1", "Center-Marker: An"],
      },
    ],
  },
];

export const DRONE_MOVES_GUIDE: DroneMovesGuide = {
  title: "10 cinematische Flugmanöver für Einsteiger",
  source: SOURCE,
  sourceUrl: SOURCE_URL,
  moves: [
    {
      title: "1. Steigender Orbit",
      sections: [
        {
          label: "Mit Spotlight",
          steps: [
            "Rahmen um das Motiv ziehen, um es auszuwählen.",
            "Bei statischem Motiv kurz links oder rechts fliegen, um das visuelle Tracking in einen GPS-Punkt umzuwandeln.",
            "Rechten Stick links/rechts drücken für den Orbit, linken Stick nach oben zum Steigen.",
          ],
        },
        {
          label: "Manuell",
          steps: [
            "Rechten Stick in eine Richtung und linken Stick in die Gegenrichtung drücken, um einen Orbit zu erzeugen. Dann den linken Stick nach oben drücken, um beim Umkreisen zu steigen.",
            "Den Gimbal nach unten neigen, um das Motiv mittig im Bild zu halten.",
          ],
        },
      ],
    },
    {
      title: "2. Rocket Shot (Raketenaufstieg)",
      sections: [
        {
          steps: [
            "Drohne direkt über dem Motiv positionieren, Gimbal gerade nach unten gerichtet. Linken Stick nach oben drücken zum Steigen.",
            "Für einen Extra-Effekt die Drohne beim Steigen langsam nach links oder rechts drehen.",
          ],
        },
      ],
    },
    {
      title: "3. Push-In mit Tilt-Down",
      sections: [
        {
          label: "Mit Spotlight",
          steps: [
            "Rahmen um das Motiv ziehen.",
            "Rechten Stick nach vorne drücken, um vorwärtszufliegen, während Spotlight das Motiv zentriert hält.",
          ],
        },
        {
          label: "Manuell",
          steps: [
            "Rechten Stick nach vorne drücken und gleichzeitig den Gimbal nach unten neigen, um das Motiv im Bild zu halten.",
          ],
        },
      ],
    },
    {
      title: "4. Up and Away (Hoch und weg)",
      sections: [
        {
          steps: [
            "Drohne vor und über dem Motiv positionieren, Kamera auf das Motiv gerichtet.",
            "Linken Stick nach oben drücken und rechten Stick zurückziehen, um hoch und rückwärts vom Motiv weg zu fliegen.",
          ],
        },
        {
          label: "Mit Spotlight",
          steps: [
            "Rahmen um das Motiv ziehen, damit es beim Hoch- und Rückwärtsflug automatisch zentriert bleibt.",
          ],
        },
      ],
    },
    {
      title: "5. Follow Shot (Verfolgung)",
      sections: [
        {
          label: "Mit ActiveShots",
          steps: [
            "Rahmen um das Motiv ziehen, um es auszuwählen.",
            "ActiveShots/ActiveTrack antippen, um dem Motiv automatisch zu folgen.",
            "Am Positions-Auswahlkreis ziehen, um das Motiv während ActiveShots zu umkreisen.",
          ],
        },
        {
          label: "Manuell",
          steps: [
            "Drohne hinter dem Motiv positionieren. Rechten Stick nach vorne drücken, um vorwärtszufliegen und dem Motiv zu folgen.",
          ],
        },
      ],
    },
    {
      title: "6. Push-In mit Drehung",
      sections: [
        {
          steps: [
            "Drohne vorwärts fliegen und dabei langsam mit dem linken Stick nach links oder rechts drehen.",
          ],
        },
      ],
    },
    {
      title: "7. Rise-Up Reveal (Enthüllung durch Aufsteigen)",
      sections: [
        {
          steps: [
            "Nah am Boden starten, Gimbal auf den Horizont gerichtet. Linken Stick nach oben drücken, um hinter dem Vordergrund aufzusteigen und die Landschaft zu enthüllen.",
          ],
        },
      ],
    },
    {
      title: "8. Vorwärts & Rückwärts",
      sections: [
        {
          steps: [
            "Rechten Stick nach vorne drücken zum Vorwärtsflug oder zurückziehen zum Rückwärtsflug. Beim Rückwärtsflug hinter der Drohne auf Hindernisse achten.",
          ],
        },
      ],
    },
    {
      title: "9. Der Orbit",
      sections: [
        {
          label: "Mit Spotlight/POI",
          steps: [
            "Rahmen um das Motiv ziehen.",
            "POI antippen.",
            "Den Schieberegler für Richtung und Geschwindigkeit des Orbits einstellen und auf Los tippen.",
          ],
        },
        {
          label: "Manuell",
          steps: [
            "Rechten Stick links/rechts drücken, um seitwärts zu fliegen.",
            "Dann den linken Stick in die Gegenrichtung drücken, um zu drehen und das Motiv im Bild zu halten.",
          ],
        },
      ],
    },
    {
      title: "10. Flyover Reveal (Überflug-Enthüllung)",
      sections: [
        {
          steps: [
            "Drohne vorwärts über eine Baumreihe, einen Bergkamm, ein Gebäude o.ä. fliegen, um zu enthüllen, was dahinter liegt.",
          ],
        },
      ],
    },
  ],
};

function normalizeModel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_/()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Findet die cinematischen Einstellungen zu einem Modell bzw. Drohnennamen.
 * Matcht exakt auf das Modell ("Air 3S"), auf "DJI <Modell>" oder auf einen
 * Namen, der mit dem Modell endet. Verhindert so Falschtreffer wie Neo 2 -> Neo.
 */
export function getCinematicSettingsForModel(
  model?: string | null,
  droneName?: string | null,
): DroneCinematicSettings | null {
  const candidates = [model, droneName]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .map(normalizeModel);
  if (candidates.length === 0) return null;

  for (const cs of DRONE_CINEMATIC_SETTINGS) {
    const key = normalizeModel(cs.model);
    const match = candidates.some(
      (c) => c === key || c === `dji ${key}` || c.endsWith(` ${key}`),
    );
    if (match) return cs;
  }
  return null;
}

export function hasCinematicSettingsForModel(
  model?: string | null,
  droneName?: string | null,
): boolean {
  return getCinematicSettingsForModel(model, droneName) !== null;
}
