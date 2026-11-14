import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiJson } from "./api-client";

/**
 * EASA "Easy Access Rules for UAS" — konsolidiertes EU-Drohnenregelwerk.
 *
 * Die Daten kommen vom Backend (`GET /api/easa-rules`, statisches JSON aus
 * server/data/easaUasRules.json). Sie werden NICHT in das Expo-Bundle gebündelt
 * (große statische Importe brechen den Metro-Publish), sondern bei Bedarf
 * geladen und in AsyncStorage offline zwischengespeichert.
 *
 * Der amtliche Regeltext ist englisch (EASA-Originaldokument); nur die
 * Rahmen-/Bedienoberfläche ist deutsch.
 */

export type EasaNodeKind = "topic" | "heading";
export type EasaNodeType = "IR" | "DR" | "AMC" | "GM" | "EAR" | "OTHER";

export interface EasaNode {
  id: string;
  kind: EasaNodeKind;
  title: string;
  type?: EasaNodeType;
  source?: string;
  applicabilityDate?: string;
  code?: string;
  depth: number;
  parentId: string | null;
  body?: string[];
}

export interface EasaRulesDoc {
  title: string;
  revision: string;
  source: string;
  sourceUrl: string;
  generatedAt: string;
  nodes: EasaNode[];
}

const CACHE_KEY = "@easa/rules_v1";

function isValidDoc(doc: unknown): doc is EasaRulesDoc {
  return (
    !!doc &&
    typeof doc === "object" &&
    Array.isArray((doc as EasaRulesDoc).nodes) &&
    (doc as EasaRulesDoc).nodes.length > 0
  );
}

/**
 * Lädt das Regelwerk vom Backend und legt es offline ab. Schlägt der Abruf
 * fehl (z. B. offline), wird die zuletzt gespeicherte Version zurückgegeben.
 */
export async function loadEasaRules(): Promise<EasaRulesDoc> {
  try {
    const doc = await apiJson<EasaRulesDoc>("/api/easa-rules");
    if (isValidDoc(doc)) {
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(doc)).catch(() => {});
      return doc;
    }
    throw new Error("Ungültige EASA-Daten vom Server.");
  } catch (err) {
    const cached = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (isValidDoc(parsed)) return parsed;
      } catch {
        // beschädigter Cache -> Originalfehler werfen
      }
    }
    throw err;
  }
}

/** Direkte Kinder eines Knotens (oder Wurzelknoten bei parentId = null). */
export function childrenOf(nodes: EasaNode[], parentId: string | null): EasaNode[] {
  return nodes.filter((n) => (n.parentId ?? null) === parentId && n.title.trim().length > 0);
}

/** Volltextsuche über Titel, Code und Fließtext der Themen. */
export function searchTopics(nodes: EasaNode[], query: string): EasaNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes.filter((n) => {
    if (n.kind !== "topic") return false;
    if (n.title.toLowerCase().includes(q)) return true;
    if (n.code && n.code.toLowerCase().includes(q)) return true;
    if (n.body && n.body.some((p) => p.toLowerCase().includes(q))) return true;
    return false;
  });
}

const TYPE_LABELS: Record<EasaNodeType, string> = {
  IR: "Durchführungsverordnung",
  DR: "Delegierte Verordnung",
  AMC: "Annehmbare Nachweisverfahren (AMC)",
  GM: "Anleitungsmaterial (GM)",
  EAR: "Easy Access Rules",
  OTHER: "Sonstiges",
};

export function typeLabel(type?: EasaNodeType): string | null {
  if (!type) return null;
  return TYPE_LABELS[type] ?? null;
}

const TYPE_COLORS: Record<EasaNodeType, string> = {
  IR: "#0A4D8C",
  DR: "#2D6A8C",
  AMC: "#8C5A0A",
  GM: "#2D8659",
  EAR: "#6B4E9E",
  OTHER: "#5A6472",
};

export function typeColor(type?: EasaNodeType): string {
  if (!type) return TYPE_COLORS.OTHER;
  return TYPE_COLORS[type] ?? TYPE_COLORS.OTHER;
}
