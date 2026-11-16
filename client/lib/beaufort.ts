export const WIND_WARN_FRACTION = 0.8;

export interface BeaufortLevel {
  bft: number;
  /** Untergrenze in m/s (WMO), inklusive. */
  minMs: number;
  name: string;
  sign: string;
}

export const BEAUFORT_SCALE: BeaufortLevel[] = [
  { bft: 0, minMs: 0, name: "Windstille", sign: "Rauch steigt senkrecht auf" },
  { bft: 1, minMs: 0.3, name: "Leiser Zug", sign: "Rauch treibt leicht ab" },
  { bft: 2, minMs: 1.6, name: "Leichte Brise", sign: "Blätter rascheln, Wind im Gesicht spürbar" },
  { bft: 3, minMs: 3.4, name: "Schwache Brise", sign: "Dünne Zweige bewegen sich, Fahnen strecken sich" },
  { bft: 4, minMs: 5.5, name: "Mäßige Brise", sign: "Staub und Papier wirbeln auf, kleine Äste bewegen sich" },
  { bft: 5, minMs: 8.0, name: "Frische Brise", sign: "Kleine Bäume schwanken, Schaumkronen auf Seen" },
  { bft: 6, minMs: 10.8, name: "Starker Wind", sign: "Große Äste bewegen sich, Schirm kaum zu halten" },
  { bft: 7, minMs: 13.9, name: "Steifer Wind", sign: "Ganze Bäume bewegen sich, Gehen wird schwer" },
  { bft: 8, minMs: 17.2, name: "Stürmischer Wind", sign: "Zweige brechen ab" },
  { bft: 9, minMs: 20.8, name: "Sturm", sign: "Äste brechen, Dachziegel lösen sich" },
  { bft: 10, minMs: 24.5, name: "Schwerer Sturm", sign: "Bäume werden entwurzelt" },
  { bft: 11, minMs: 28.5, name: "Orkanartiger Sturm", sign: "Schwere Sturmschäden" },
  { bft: 12, minMs: 32.7, name: "Orkan", sign: "Verwüstungen" },
];

export function beaufortLevel(ms: number): BeaufortLevel {
  const v = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  let level = BEAUFORT_SCALE[0];
  for (const l of BEAUFORT_SCALE) {
    if (v >= l.minMs) level = l;
  }
  return level;
}

export type DroneWindVerdict = "ok" | "caution" | "over";

export function droneWindVerdict(ms: number, limitMs: number): DroneWindVerdict {
  if (!(limitMs > 0)) return "ok";
  if (ms > limitMs) return "over";
  if (ms > limitMs * WIND_WARN_FRACTION) return "caution";
  return "ok";
}

export function droneWindVerdictText(v: DroneWindVerdict): string {
  switch (v) {
    case "over":
      return "über dem Limit deiner Drohne";
    case "caution":
      return "nahe am Limit deiner Drohne";
    default:
      return "für deine Drohne unkritisch";
  }
}

export function warnThresholdMs(limitMs: number): number {
  return limitMs * WIND_WARN_FRACTION;
}
