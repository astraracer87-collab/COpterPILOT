import { QueryClient, QueryFunction } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Die RC-Version läuft ohne eigenen Server. Die wenigen Datensammlungen, die
 * früher über die REST-API des Replit-Servers liefen (eigene Glossar-Einträge,
 * eigene Links), werden hier lokal in AsyncStorage gespeichert. Die
 * Schnittstelle (apiRequest / queryKey = Pfad) bleibt gleich, damit die
 * Screens unverändert bleiben.
 */

const LOCAL_COLLECTIONS: Record<string, { key: string; validate: (d: any) => string | null; normalize: (d: any) => any }> = {
  "/api/user-glossary": {
    key: "@local/user-glossary",
    validate: (d) => {
      if (!d?.term || !String(d.term).trim()) return "Begriff erforderlich";
      if (!d?.definition || !String(d.definition).trim()) return "Definition erforderlich";
      return null;
    },
    normalize: (d) => ({ term: String(d.term).trim(), definition: String(d.definition).trim() }),
  },
  "/api/user-resources": {
    key: "@local/user-resources",
    validate: (d) => {
      if (!d?.title || !String(d.title).trim()) return "Titel erforderlich";
      if (!d?.url || !/^https?:\/\/\S+$/i.test(String(d.url).trim())) return "Ungültige URL";
      return null;
    },
    normalize: (d) => ({
      title: String(d.title).trim(),
      url: String(d.url).trim(),
      description: d.description ? String(d.description) : "",
      category: d.category ? String(d.category) : "",
      icon: d.icon ?? null,
    }),
  },
};

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readCollection(key: string): Promise<any[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCollection(key: string, rows: any[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(rows));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function resolveRoute(route: string): { base: string; id?: string } | null {
  const path = route.split("?")[0].replace(/\/+$/, "");
  for (const base of Object.keys(LOCAL_COLLECTIONS)) {
    if (path === base) return { base };
    if (path.startsWith(base + "/")) return { base, id: decodeURIComponent(path.slice(base.length + 1)) };
  }
  return null;
}

async function handleLocal(method: string, route: string, data?: any): Promise<Response> {
  const match = resolveRoute(route);
  if (!match) return jsonResponse({ error: `Nicht verfügbar ohne Server: ${route}` }, 404);
  const col = LOCAL_COLLECTIONS[match.base];
  const rows = await readCollection(col.key);
  const now = new Date().toISOString();
  const m = method.toUpperCase();

  if (m === "GET") {
    if (match.id) {
      const row = rows.find((r) => r.id === match.id);
      return row ? jsonResponse(row) : jsonResponse({ error: "Eintrag nicht gefunden" }, 404);
    }
    return jsonResponse([...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
  }
  if (m === "POST" && !match.id) {
    const err = col.validate(data);
    if (err) return jsonResponse({ error: err }, 400);
    const row = { id: newId(), ...col.normalize(data), createdAt: now, updatedAt: now };
    await writeCollection(col.key, [row, ...rows]);
    return jsonResponse(row, 201);
  }
  if (m === "PUT" && match.id) {
    const err = col.validate(data);
    if (err) return jsonResponse({ error: err }, 400);
    const idx = rows.findIndex((r) => r.id === match.id);
    if (idx < 0) return jsonResponse({ error: "Eintrag nicht gefunden" }, 404);
    rows[idx] = { ...rows[idx], ...col.normalize(data), updatedAt: now };
    await writeCollection(col.key, rows);
    return jsonResponse(rows[idx]);
  }
  if (m === "DELETE" && match.id) {
    const next = rows.filter((r) => r.id !== match.id);
    if (next.length === rows.length) return jsonResponse({ error: "Eintrag nicht gefunden" }, 404);
    await writeCollection(col.key, next);
    return jsonResponse({ success: true });
  }
  return jsonResponse({ error: "Methode nicht unterstützt" }, 405);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await handleLocal(method, route, data);
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await handleLocal("GET", queryKey.join("/") as string);
    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }
    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
