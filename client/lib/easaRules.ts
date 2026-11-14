import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * EASA "Easy Access Rules for UAS" — konsolidiertes EU-Drohnenregelwerk.
 *
 * Die Daten liegen gebündelt in client/data/easaUasRules.json (früher vom
 * Backend ausgeliefert). Das JSON wird erst bei Bedarf per require() geladen,
 * damit es den App-Start nicht verzögert – funktioniert vollständig offline.
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

function isValidDoc(doc: unknown): doc is EasaRulesDoc {
  return (
    !!doc &&
    typeof doc === "object" &&
    Array.isArray((doc as EasaRulesDoc).nodes) &&
    (doc as EasaRulesDoc).nodes.length > 0
  );
}

let cachedDoc: EasaRulesDoc | null = null;

/** Lädt das gebündelte Regelwerk (lazy, einmalig). */
export async function loadEasaRules(): Promise<EasaRulesDoc> {
  if (cachedDoc) return cachedDoc;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw: unknown = require("@/data/easaUasRules.json");
  const doc = (raw && typeof raw === "object" && "default" in (raw as object)
    ? (raw as { default: unknown }).default
    : raw) as unknown;
  if (!isValidDoc(doc)) throw new Error("EASA-Regelwerk konnte nicht geladen werden.");
  cachedDoc = doc;
  // Alten AsyncStorage-Cache (aus der Server-Zeit, ~1,4 MB) aufräumen.
  AsyncStorage.removeItem("@easa/rules_v1").catch(() => {});
  return doc;
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
