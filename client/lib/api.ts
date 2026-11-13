import { getApiUrl } from "./query-client";
import type { DroneProfile, FlightSession, LogbookEntry, Settings } from "./storage";

export { getApiUrl };

const API_TIMEOUT = 10000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function getFullUrl(path: string): string {
  const base = getApiUrl();
  return new URL(path, base).toString();
}

export async function apiGetDrones(): Promise<DroneProfile[]> {
  const response = await fetchWithTimeout(getFullUrl("/api/drones"));
  if (!response.ok) throw new Error("Failed to fetch drones");
  const data = await response.json();
  return data.map((d: any) => ({
    ...d,
    createdAt: d.createdAt || new Date().toISOString(),
    updatedAt: d.updatedAt || new Date().toISOString(),
  }));
}

export async function apiGetDrone(id: string): Promise<DroneProfile | null> {
  const response = await fetchWithTimeout(getFullUrl(`/api/drones/${id}`));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Failed to fetch drone");
  const data = await response.json();
  return {
    ...data,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
}

export async function apiCreateDrone(drone: Omit<DroneProfile, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<DroneProfile> {
  const response = await fetchWithTimeout(getFullUrl("/api/drones"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(drone),
  });
  if (!response.ok) throw new Error("Failed to create drone");
  return response.json();
}

export async function apiUpdateDrone(id: string, updates: Partial<DroneProfile>): Promise<DroneProfile> {
  const response = await fetchWithTimeout(getFullUrl(`/api/drones/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error("Failed to update drone");
  return response.json();
}

export async function apiDeleteDrone(id: string): Promise<void> {
  const response = await fetchWithTimeout(getFullUrl(`/api/drones/${id}`), {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete drone");
}

export async function apiGetSessions(): Promise<FlightSession[]> {
  const response = await fetchWithTimeout(getFullUrl("/api/sessions"));
  if (!response.ok) throw new Error("Failed to fetch sessions");
  const data = await response.json();
  return data.map((s: any) => ({
    ...s,
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: s.updatedAt || new Date().toISOString(),
  }));
}

export async function apiGetSession(id: string): Promise<FlightSession | null> {
  const response = await fetchWithTimeout(getFullUrl(`/api/sessions/${id}`));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Failed to fetch session");
  const data = await response.json();
  return {
    ...data,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
}

export async function apiCreateSession(session: Omit<FlightSession, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<FlightSession> {
  const response = await fetchWithTimeout(getFullUrl("/api/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  });
  if (!response.ok) throw new Error("Failed to create session");
  return response.json();
}

export async function apiUpdateSession(id: string, updates: Partial<FlightSession>): Promise<FlightSession> {
  const response = await fetchWithTimeout(getFullUrl(`/api/sessions/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error("Failed to update session");
  return response.json();
}

export async function apiDeleteSession(id: string): Promise<void> {
  const response = await fetchWithTimeout(getFullUrl(`/api/sessions/${id}`), {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete session");
}

export async function apiGetLogbook(): Promise<LogbookEntry[]> {
  const response = await fetchWithTimeout(getFullUrl("/api/logbook"));
  if (!response.ok) throw new Error("Failed to fetch logbook");
  const data = await response.json();
  return data.map((e: any) => ({
    ...e,
    createdAt: e.createdAt || new Date().toISOString(),
  }));
}

export async function apiGetLogbookEntry(id: string): Promise<LogbookEntry | null> {
  const response = await fetchWithTimeout(getFullUrl(`/api/logbook/${id}`));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Failed to fetch logbook entry");
  return response.json();
}

export async function apiCreateLogbookEntry(entry: Omit<LogbookEntry, "id" | "createdAt"> & { id?: string }): Promise<LogbookEntry> {
  const response = await fetchWithTimeout(getFullUrl("/api/logbook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!response.ok) throw new Error("Failed to create logbook entry");
  return response.json();
}

export async function apiUpdateLogbookEntry(id: string, updates: Partial<LogbookEntry>): Promise<LogbookEntry> {
  const response = await fetchWithTimeout(getFullUrl(`/api/logbook/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error("Failed to update logbook entry");
  return response.json();
}

export async function apiDeleteLogbookEntry(id: string): Promise<void> {
  const response = await fetchWithTimeout(getFullUrl(`/api/logbook/${id}`), {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete logbook entry");
}

export async function apiGetSettings(): Promise<Settings | null> {
  const response = await fetchWithTimeout(getFullUrl("/api/settings"));
  if (!response.ok) throw new Error("Failed to fetch settings");
  return response.json();
}

export async function apiSaveSettings(settings: Settings): Promise<Settings> {
  const response = await fetchWithTimeout(getFullUrl("/api/settings"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error("Failed to save settings");
  return response.json();
}

export async function apiSyncDrones(drones: DroneProfile[]): Promise<{ synced: number }> {
  const response = await fetchWithTimeout(getFullUrl("/api/sync/drones"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(drones),
  });
  if (!response.ok) throw new Error("Failed to sync drones");
  return response.json();
}

export async function apiSyncSessions(sessions: FlightSession[]): Promise<{ synced: number }> {
  const response = await fetchWithTimeout(getFullUrl("/api/sync/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessions),
  });
  if (!response.ok) throw new Error("Failed to sync sessions");
  return response.json();
}

export async function apiSyncLogbook(entries: LogbookEntry[]): Promise<{ synced: number }> {
  const response = await fetchWithTimeout(getFullUrl("/api/sync/logbook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entries),
  });
  if (!response.ok) throw new Error("Failed to sync logbook");
  return response.json();
}
