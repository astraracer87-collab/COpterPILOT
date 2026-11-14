import { apiJson, apiFetch, ApiError } from "./api-client";
import { getApiUrl } from "./query-client";
import type {
  DroneProfile,
  DroneHistoryEntry,
  DroneFoundReport,
  FlightSession,
  LogbookEntry,
  PilotProfile,
  Settings,
} from "./storage";

export { getApiUrl, ApiError };

// ─────────────────────────── Drohnen ───────────────────────────

export async function apiGetDrones(opts?: { includeArchived?: boolean; onlyArchived?: boolean }): Promise<DroneProfile[]> {
  const qs = opts?.onlyArchived ? "?onlyArchived=1" : opts?.includeArchived ? "?includeArchived=1" : "";
  const data = await apiJson<any[]>(`/api/drones${qs}`);
  return (data || []).map(normalizeDrone);
}

export async function apiGetDrone(id: string): Promise<DroneProfile | null> {
  const res = await apiFetch(`/api/drones/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `Failed to fetch drone (${res.status})`);
  return normalizeDrone(await res.json());
}

export async function apiCreateDrone(drone: Partial<DroneProfile>): Promise<DroneProfile> {
  const data = await apiJson<any>("/api/drones", { method: "POST", body: drone });
  return normalizeDrone(data);
}

export async function apiUpdateDrone(id: string, updates: Partial<DroneProfile>): Promise<DroneProfile> {
  const data = await apiJson<any>(`/api/drones/${encodeURIComponent(id)}`, { method: "PUT", body: updates });
  return normalizeDrone(data);
}

export async function apiDeleteDrone(id: string): Promise<void> {
  const res = await apiFetch(`/api/drones/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, `Failed to delete drone (${res.status})`);
}

function normalizeDrone(d: any): DroneProfile {
  const now = new Date().toISOString();
  return { ...d, createdAt: d?.createdAt || now, updatedAt: d?.updatedAt || now };
}

// ─────────────────────────── Flight Sessions ───────────────────────────

export async function apiGetSessions(opts?: { trashed?: boolean }): Promise<FlightSession[]> {
  const qs = opts?.trashed ? "?trashed=1" : "";
  const data = await apiJson<any[]>(`/api/sessions${qs}`);
  return (data || []).map(normalizeSession);
}

export async function apiGetSession(id: string): Promise<FlightSession | null> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `Failed to fetch session (${res.status})`);
  return normalizeSession(await res.json());
}

export async function apiCreateSession(session: Partial<FlightSession>): Promise<FlightSession> {
  const data = await apiJson<any>("/api/sessions", { method: "POST", body: session });
  return normalizeSession(data);
}

export async function apiUpdateSession(id: string, updates: Partial<FlightSession>): Promise<FlightSession> {
  const data = await apiJson<any>(`/api/sessions/${encodeURIComponent(id)}`, { method: "PUT", body: updates });
  return normalizeSession(data);
}

export async function apiDeleteSession(id: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, `Failed to delete session (${res.status})`);
}

function normalizeSession(s: any): FlightSession {
  const now = new Date().toISOString();
  return { ...s, createdAt: s?.createdAt || now, updatedAt: s?.updatedAt || now };
}

// ─────────────────────────── Logbuch ───────────────────────────

export async function apiGetLogbook(): Promise<LogbookEntry[]> {
  const data = await apiJson<any[]>("/api/logbook");
  return (data || []).map(normalizeLogbook);
}

export async function apiGetLogbookEntry(id: string): Promise<LogbookEntry | null> {
  const res = await apiFetch(`/api/logbook/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `Failed to fetch logbook entry (${res.status})`);
  return normalizeLogbook(await res.json());
}

export async function apiCreateLogbookEntry(entry: Partial<LogbookEntry>): Promise<LogbookEntry> {
  const data = await apiJson<any>("/api/logbook", { method: "POST", body: entry });
  return normalizeLogbook(data);
}

export async function apiUpdateLogbookEntry(id: string, updates: Partial<LogbookEntry>): Promise<LogbookEntry> {
  const data = await apiJson<any>(`/api/logbook/${encodeURIComponent(id)}`, { method: "PUT", body: updates });
  return normalizeLogbook(data);
}

export async function apiDeleteLogbookEntry(id: string): Promise<void> {
  const res = await apiFetch(`/api/logbook/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, `Failed to delete logbook entry (${res.status})`);
}

function normalizeLogbook(e: any): LogbookEntry {
  return { ...e, createdAt: e?.createdAt || new Date().toISOString() };
}

export interface ShareState {
  shareEnabled: boolean;
  shareToken: string | null;
}

export async function apiEnableLogbookShare(id: string): Promise<ShareState> {
  return apiJson<ShareState>(`/api/logbook/${encodeURIComponent(id)}/share`, { method: "POST" });
}

export async function apiDisableLogbookShare(id: string): Promise<ShareState> {
  return apiJson<ShareState>(`/api/logbook/${encodeURIComponent(id)}/share`, { method: "DELETE" });
}

export async function apiRegenerateLogbookShare(id: string): Promise<ShareState> {
  return apiJson<ShareState>(`/api/logbook/${encodeURIComponent(id)}/share/regenerate`, { method: "POST" });
}

// ─────────────────────────── Settings & Profil ───────────────────────────

export async function apiGetSettings(): Promise<Settings | null> {
  const data = await apiJson<any>("/api/settings");
  if (!data) return null;
  return {
    windUnit: data.windUnit ?? "m/s",
    tempUnit: data.tempUnit ?? "C",
    limits: data.limits,
    preferGermany: data.preferGermany ?? true,
    preferredCountryIso: data.preferredCountryIso ?? "DE",
    proximityAlarm: data.proximityAlarm,
    geozoneSettings: data.geozoneSettings ?? undefined,
    favoriteCountries: Array.isArray(data.favoriteCountries) ? data.favoriteCountries : undefined,
    officialMapCrossCheck: data.officialMapCrossCheck ?? undefined,
    attachPilotDocsToExports: data.attachPilotDocsToExports ?? undefined,
    wildlifeRescueMode: data.wildlifeRescueMode ?? false,
  } as Settings;
}

export async function apiGetGeozoneSettings(countryIso: string): Promise<Record<string, boolean> | null> {
  const data = await apiJson<any>("/api/settings");
  const map = data?.geozoneSettings;
  if (map && typeof map === "object" && map[countryIso]) return map[countryIso];
  return null;
}

export async function apiSaveGeozoneSettings(countryIso: string, settings: Record<string, boolean>): Promise<void> {
  await apiJson<any>("/api/settings", {
    method: "POST",
    body: { geozoneSettings: { [countryIso]: settings } },
  });
}

export async function apiSaveSettings(settings: Settings): Promise<Settings> {
  await apiJson<any>("/api/settings", { method: "POST", body: settings });
  return settings;
}

export async function apiGetProfile(): Promise<PilotProfile | null> {
  const data = await apiJson<any>("/api/profile");
  return data || null;
}

export async function apiSaveProfile(profile: PilotProfile): Promise<PilotProfile> {
  const data = await apiJson<any>("/api/profile", { method: "POST", body: profile });
  return (data || profile) as PilotProfile;
}

// ─────────────────────────── Drone History ───────────────────────────

export async function apiGetDroneHistory(droneId: string): Promise<DroneHistoryEntry[]> {
  const data = await apiJson<any[]>(`/api/drones/${encodeURIComponent(droneId)}/history`);
  return data || [];
}

export async function apiAddDroneHistory(droneId: string, entry: Partial<DroneHistoryEntry>): Promise<DroneHistoryEntry> {
  const data = await apiJson<any>(`/api/drones/${encodeURIComponent(droneId)}/history`, {
    method: "POST",
    body: entry,
  });
  return data as DroneHistoryEntry;
}

export async function apiDeleteDroneHistory(droneId: string, entryId: string): Promise<void> {
  const res = await apiFetch(`/api/drones/${encodeURIComponent(droneId)}/history/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, `Failed to delete history (${res.status})`);
}

// ─────────────────────────── Lost & Found ───────────────────────────

export async function apiEnableFound(droneId: string): Promise<DroneProfile> {
  const data = await apiJson<any>(`/api/drones/${encodeURIComponent(droneId)}/found/enable`, { method: "POST" });
  return normalizeDrone(data);
}

export async function apiDisableFound(droneId: string): Promise<DroneProfile> {
  const data = await apiJson<any>(`/api/drones/${encodeURIComponent(droneId)}/found/disable`, { method: "POST" });
  return normalizeDrone(data);
}

export async function apiRegenerateFoundToken(droneId: string): Promise<DroneProfile> {
  const data = await apiJson<any>(`/api/drones/${encodeURIComponent(droneId)}/found/regenerate`, { method: "POST" });
  return normalizeDrone(data);
}

export async function apiSetFoundConfig(
  droneId: string,
  cfg: {
    foundDisplayName?: string | null;
    foundContactEmail?: string | null;
    foundContactPhone?: string | null;
    foundCustomMessage?: string | null;
  },
): Promise<DroneProfile> {
  const data = await apiJson<any>(`/api/drones/${encodeURIComponent(droneId)}/found/config`, {
    method: "PUT",
    body: cfg,
  });
  return normalizeDrone(data);
}

export async function apiGetFoundReports(droneId: string): Promise<DroneFoundReport[]> {
  const data = await apiJson<any[]>(`/api/drones/${encodeURIComponent(droneId)}/found/reports`);
  return (data || []) as DroneFoundReport[];
}

export async function apiGetAllFoundReports(opts?: { unreadOnly?: boolean; limit?: number }): Promise<DroneFoundReport[]> {
  const qs = new URLSearchParams();
  if (opts?.unreadOnly) qs.set("unread", "1");
  if (opts?.limit) qs.set("limit", String(opts.limit));
  const q = qs.toString();
  const data = await apiJson<any[]>(`/api/found/reports${q ? `?${q}` : ""}`);
  return (data || []) as DroneFoundReport[];
}

export async function apiMarkFoundReportRead(droneId: string, reportId: string): Promise<void> {
  await apiJson<any>(
    `/api/drones/${encodeURIComponent(droneId)}/found/reports/${encodeURIComponent(reportId)}/read`,
    { method: "POST" },
  );
}

export async function apiDeleteFoundReport(droneId: string, reportId: string): Promise<void> {
  const res = await apiFetch(
    `/api/drones/${encodeURIComponent(droneId)}/found/reports/${encodeURIComponent(reportId)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, `Failed to delete report (${res.status})`);
}
