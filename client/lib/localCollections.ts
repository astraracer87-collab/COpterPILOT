import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Lokale Ersatz-"API" für die früher serverseitigen Nutzer-Sammlungen
 * (eigene Glossar-Einträge und eigene Ressourcen-Links). Die Daten liegen in
 * AsyncStorage; query-client.ts leitet die bekannten Routen hierher um, sodass
 * die Screens (react-query + apiRequest) unverändert bleiben.
 */

type CollectionDef = {
  storageKey: string;
  fields: readonly string[];
};

export const LOCAL_COLLECTIONS: Record<string, CollectionDef> = {
  "/api/user-glossary": {
    storageKey: "@preflight/user_glossary",
    fields: ["term", "definition"],
  },
  "/api/user-resources": {
    storageKey: "@preflight/user_resources",
    fields: ["title", "url", "description", "category", "icon"],
  },
};

type Item = { id: string; createdAt?: string; updatedAt?: string } & Record<string, unknown>;

export class LocalRouteError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`${status}: ${message}`);
    this.name = "LocalRouteError";
  }
}

function matchRoute(route: string): { base: string; def: CollectionDef; id: string | null } | null {
  const path = route.split("?")[0].replace(/\/+$/, "");
  for (const base of Object.keys(LOCAL_COLLECTIONS)) {
    if (path === base) return { base, def: LOCAL_COLLECTIONS[base], id: null };
    if (path.startsWith(`${base}/`)) {
      const id = decodeURIComponent(path.slice(base.length + 1));
      if (id && !id.includes("/")) return { base, def: LOCAL_COLLECTIONS[base], id };
    }
  }
  return null;
}

export function isLocalCollectionRoute(route: string): boolean {
  return matchRoute(route) !== null;
}

async function readAll(def: CollectionDef): Promise<Item[]> {
  try {
    const raw = await AsyncStorage.getItem(def.storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Item[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(def: CollectionDef, items: Item[]): Promise<void> {
  await AsyncStorage.setItem(def.storageKey, JSON.stringify(items));
}

function pickFields(def: CollectionDef, data: unknown): Record<string, string> {
  const src = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const f of def.fields) {
    if (src[f] !== undefined && src[f] !== null) out[f] = String(src[f]);
  }
  return out;
}

function newId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Anzahl der Einträge einer lokalen Sammlung (für "Meine Daten"). */
export async function countLocalCollection(route: keyof typeof LOCAL_COLLECTIONS | string): Promise<number> {
  const def = LOCAL_COLLECTIONS[route];
  if (!def) return 0;
  return (await readAll(def)).length;
}

/**
 * Führt eine REST-artige Anfrage gegen eine lokale Sammlung aus.
 * GET (Liste/Einzeln), POST (anlegen), PUT/PATCH /:id (ändern), DELETE /:id.
 */
export async function handleLocalCollection(
  method: string,
  route: string,
  data?: unknown,
): Promise<unknown> {
  const m = matchRoute(route);
  if (!m) throw new LocalRouteError(404, "Unbekannte lokale Route");
  const { def, id } = m;
  const verb = method.toUpperCase();
  const items = await readAll(def);

  if (verb === "GET") {
    if (!id) return items;
    const found = items.find((i) => i.id === id);
    if (!found) throw new LocalRouteError(404, "Eintrag nicht gefunden");
    return found;
  }

  if (verb === "POST" && !id) {
    const now = new Date().toISOString();
    const item: Item = { id: newId(), ...pickFields(def, data), createdAt: now, updatedAt: now };
    items.push(item);
    await writeAll(def, items);
    return item;
  }

  if ((verb === "PUT" || verb === "PATCH") && id) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) throw new LocalRouteError(404, "Eintrag nicht gefunden");
    const updated: Item = {
      ...items[idx],
      ...pickFields(def, data),
      id,
      updatedAt: new Date().toISOString(),
    };
    items[idx] = updated;
    await writeAll(def, items);
    return updated;
  }

  if (verb === "DELETE" && id) {
    const next = items.filter((i) => i.id !== id);
    await writeAll(def, next);
    return { success: true };
  }

  throw new LocalRouteError(405, "Methode nicht unterstützt");
}
