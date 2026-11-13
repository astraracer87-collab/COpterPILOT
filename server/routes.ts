import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { db } from "./db";
import {
  drones,
  flightSessions,
  logbookEntries,
  userSettings,
  pilotProfiles,
  droneHistoryEntries,
  userGlossaryEntries,
  userResourceLinks,
  userGlossaryEntrySchema,
  userResourceLinkSchema,
  userGlossaryImportSchema,
  userResourceLinksImportSchema,
} from "../shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { getNearbyOgn, getOgnStatus, startOgnClient } from "./ogn";
import { requireAuth, getUserId, registerAuthRoutes, requireAdmin } from "./auth";
import { users } from "../shared/schema";
import { registerProxyRoutes } from "./proxy";
import { fetchNearbyTraffic } from "./traffic";

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth routes (no auth required)
  registerAuthRoutes(app);

  // Public OGN endpoint (used by radar / live traffic — no per-user data)
  app.get("/api/ogn/nearby", (req: Request, res: Response) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radius = parseFloat(req.query.radius as string) || 25;
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: "lat and lon required" });
    }
    const aircraft = getNearbyOgn(lat, lon, radius);
    res.json({ aircraft, status: getOgnStatus() });
  });

  // Public aggregated traffic endpoint (OpenSky + adsb.fi/one/lol/airplanes.live + OGN)
  app.get("/api/traffic/nearby", async (req: Request, res: Response) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radius = Math.max(1, Math.min(100, parseFloat(req.query.radius as string) || 25));
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: "lat and lon required" });
    }
    try {
      const data = await fetchNearbyTraffic(lat, lon, radius);
      res.set("Cache-Control", "no-store");
      res.json(data);
    } catch (e) {
      console.error("[traffic] aggregator failed:", e);
      res.status(502).json({ error: "Traffic aggregator failed" });
    }
  });

  // Public proxy routes for external APIs (CORS-safe, no per-user data)
  registerProxyRoutes(app);

  // All routes below require authentication
  app.use("/api", (req, res, next) => {
    if (
      req.path.startsWith("/auth/") ||
      req.path === "/ogn/nearby" ||
      req.path === "/traffic/nearby" ||
      req.path.startsWith("/proxy/")
    ) {
      return next();
    }
    return requireAuth(req, res, next);
  });

  // Drones API — scoped to current user
  app.get("/api/drones", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const allDrones = await db
        .select()
        .from(drones)
        .where(eq(drones.userId, userId))
        .orderBy(desc(drones.createdAt));
      res.json(allDrones);
    } catch (error) {
      console.error("Error fetching drones:", error);
      res.status(500).json({ error: "Failed to fetch drones" });
    }
  });

  app.get("/api/drones/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [drone] = await db
        .select()
        .from(drones)
        .where(and(eq(drones.id, req.params.id), eq(drones.userId, userId)));
      if (!drone) return res.status(404).json({ error: "Drone not found" });
      res.json(drone);
    } catch (error) {
      console.error("Error fetching drone:", error);
      res.status(500).json({ error: "Failed to fetch drone" });
    }
  });

  app.post("/api/drones", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [newDrone] = await db
        .insert(drones)
        .values({ ...req.body, userId })
        .returning();
      res.status(201).json(newDrone);
    } catch (error) {
      console.error("Error creating drone:", error);
      res.status(500).json({ error: "Failed to create drone" });
    }
  });

  app.put("/api/drones/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { userId: _, ...body } = req.body;
      const [updated] = await db
        .update(drones)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(drones.id, req.params.id), eq(drones.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Drone not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating drone:", error);
      res.status(500).json({ error: "Failed to update drone" });
    }
  });

  app.delete("/api/drones/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [deleted] = await db
        .delete(drones)
        .where(and(eq(drones.id, req.params.id), eq(drones.userId, userId)))
        .returning();
      if (!deleted) return res.status(404).json({ error: "Drone not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting drone:", error);
      res.status(500).json({ error: "Failed to delete drone" });
    }
  });

  // Flight Sessions API
  app.get("/api/sessions", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const allSessions = await db
        .select()
        .from(flightSessions)
        .where(eq(flightSessions.userId, userId))
        .orderBy(desc(flightSessions.createdAt));
      res.json(allSessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  app.get("/api/sessions/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [s] = await db
        .select()
        .from(flightSessions)
        .where(and(eq(flightSessions.id, req.params.id), eq(flightSessions.userId, userId)));
      if (!s) return res.status(404).json({ error: "Session not found" });
      res.json(s);
    } catch (error) {
      console.error("Error fetching session:", error);
      res.status(500).json({ error: "Failed to fetch session" });
    }
  });

  app.post("/api/sessions", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [newSession] = await db
        .insert(flightSessions)
        .values({ ...req.body, userId })
        .returning();
      res.status(201).json(newSession);
    } catch (error) {
      console.error("Error creating session:", error);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.put("/api/sessions/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { userId: _, ...body } = req.body;
      const [updated] = await db
        .update(flightSessions)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(flightSessions.id, req.params.id), eq(flightSessions.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Session not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating session:", error);
      res.status(500).json({ error: "Failed to update session" });
    }
  });

  app.delete("/api/sessions/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [deleted] = await db
        .delete(flightSessions)
        .where(and(eq(flightSessions.id, req.params.id), eq(flightSessions.userId, userId)))
        .returning();
      if (!deleted) return res.status(404).json({ error: "Session not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting session:", error);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  // Logbook API
  app.get("/api/logbook", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const entries = await db
        .select()
        .from(logbookEntries)
        .where(eq(logbookEntries.userId, userId))
        .orderBy(desc(logbookEntries.createdAt));
      res.json(entries);
    } catch (error) {
      console.error("Error fetching logbook:", error);
      res.status(500).json({ error: "Failed to fetch logbook" });
    }
  });

  app.get("/api/logbook/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [entry] = await db
        .select()
        .from(logbookEntries)
        .where(and(eq(logbookEntries.id, req.params.id), eq(logbookEntries.userId, userId)));
      if (!entry) return res.status(404).json({ error: "Logbook entry not found" });
      res.json(entry);
    } catch (error) {
      console.error("Error fetching logbook entry:", error);
      res.status(500).json({ error: "Failed to fetch logbook entry" });
    }
  });

  app.post("/api/logbook", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [newEntry] = await db
        .insert(logbookEntries)
        .values({ ...req.body, userId })
        .returning();
      res.status(201).json(newEntry);
    } catch (error) {
      console.error("Error creating logbook entry:", error);
      res.status(500).json({ error: "Failed to create logbook entry" });
    }
  });

  app.put("/api/logbook/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { userId: _, ...body } = req.body;
      const [updated] = await db
        .update(logbookEntries)
        .set(body)
        .where(and(eq(logbookEntries.id, req.params.id), eq(logbookEntries.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Logbook entry not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating logbook entry:", error);
      res.status(500).json({ error: "Failed to update logbook entry" });
    }
  });

  app.delete("/api/logbook/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [deleted] = await db
        .delete(logbookEntries)
        .where(and(eq(logbookEntries.id, req.params.id), eq(logbookEntries.userId, userId)))
        .returning();
      if (!deleted) return res.status(404).json({ error: "Logbook entry not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting logbook entry:", error);
      res.status(500).json({ error: "Failed to delete logbook entry" });
    }
  });

  // User Settings — one row per user
  app.get("/api/settings", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [settings] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
      res.json(settings || null);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { userId: _, ...body } = req.body;
      const [existing] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
      if (existing) {
        const [updated] = await db
          .update(userSettings)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(userSettings.id, existing.id))
          .returning();
        res.json(updated);
      } else {
        const [created] = await db
          .insert(userSettings)
          .values({ ...body, userId })
          .returning();
        res.status(201).json(created);
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // Pilot Profile API
  app.get("/api/profile", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [profile] = await db
        .select()
        .from(pilotProfiles)
        .where(eq(pilotProfiles.userId, userId))
        .limit(1);
      res.json(profile || null);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  app.post("/api/profile", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { userId: _, id: __, ...body } = req.body;
      const [existing] = await db
        .select()
        .from(pilotProfiles)
        .where(eq(pilotProfiles.userId, userId))
        .limit(1);
      if (existing) {
        const [updated] = await db
          .update(pilotProfiles)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(pilotProfiles.id, existing.id))
          .returning();
        res.json(updated);
      } else {
        const [created] = await db
          .insert(pilotProfiles)
          .values({ ...body, userId })
          .returning();
        res.status(201).json(created);
      }
    } catch (error) {
      console.error("Error saving profile:", error);
      res.status(500).json({ error: "Failed to save profile" });
    }
  });

  // Drone History API
  app.get("/api/drones/:droneId/history", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const entries = await db
        .select()
        .from(droneHistoryEntries)
        .where(and(eq(droneHistoryEntries.userId, userId), eq(droneHistoryEntries.droneId, req.params.droneId)))
        .orderBy(desc(droneHistoryEntries.date));
      res.json(entries);
    } catch (error) {
      console.error("Error fetching drone history:", error);
      res.status(500).json({ error: "Failed to fetch drone history" });
    }
  });

  app.post("/api/drones/:droneId/history", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { eventType, description, date } = req.body;
      const [entry] = await db
        .insert(droneHistoryEntries)
        .values({
          userId,
          droneId: req.params.droneId,
          eventType,
          description,
          date: date || new Date().toISOString(),
        })
        .returning();
      res.status(201).json(entry);
    } catch (error) {
      console.error("Error creating drone history:", error);
      res.status(500).json({ error: "Failed to create drone history" });
    }
  });

  app.delete("/api/drones/:droneId/history/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [deleted] = await db
        .delete(droneHistoryEntries)
        .where(and(
          eq(droneHistoryEntries.id, req.params.id),
          eq(droneHistoryEntries.userId, userId),
          eq(droneHistoryEntries.droneId, req.params.droneId),
        ))
        .returning();
      if (!deleted) return res.status(404).json({ error: "Entry not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting drone history:", error);
      res.status(500).json({ error: "Failed to delete drone history" });
    }
  });

  // ----- User Glossary -----
  app.get("/api/user-glossary", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const rows = await db
        .select()
        .from(userGlossaryEntries)
        .where(eq(userGlossaryEntries.userId, userId))
        .orderBy(desc(userGlossaryEntries.createdAt));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching user glossary:", error);
      res.status(500).json({ error: "Failed to fetch user glossary" });
    }
  });

  app.post("/api/user-glossary", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const parsed = userGlossaryEntrySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Ungültige Daten" });
      const [created] = await db
        .insert(userGlossaryEntries)
        .values({ userId, term: parsed.data.term.trim(), definition: parsed.data.definition.trim() })
        .returning();
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating user glossary entry:", error);
      res.status(500).json({ error: "Failed to create entry" });
    }
  });

  app.put("/api/user-glossary/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const parsed = userGlossaryEntrySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Ungültige Daten" });
      const [updated] = await db
        .update(userGlossaryEntries)
        .set({ term: parsed.data.term.trim(), definition: parsed.data.definition.trim(), updatedAt: new Date() })
        .where(and(eq(userGlossaryEntries.id, req.params.id), eq(userGlossaryEntries.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Eintrag nicht gefunden" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating user glossary entry:", error);
      res.status(500).json({ error: "Failed to update entry" });
    }
  });

  app.delete("/api/user-glossary/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [deleted] = await db
        .delete(userGlossaryEntries)
        .where(and(eq(userGlossaryEntries.id, req.params.id), eq(userGlossaryEntries.userId, userId)))
        .returning();
      if (!deleted) return res.status(404).json({ error: "Eintrag nicht gefunden" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user glossary entry:", error);
      res.status(500).json({ error: "Failed to delete entry" });
    }
  });

  app.get("/api/user-glossary/export", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const entries = await db
        .select()
        .from(userGlossaryEntries)
        .where(eq(userGlossaryEntries.userId, userId))
        .orderBy(userGlossaryEntries.term);
      const payload = {
        type: "drohnenflug.user-glossary",
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: entries.map((e) => ({ term: e.term, definition: e.definition })),
      };
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="glossar-${stamp}.json"`);
      res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
      console.error("Error exporting user glossary:", error);
      res.status(500).json({ error: "Export fehlgeschlagen" });
    }
  });

  app.post("/api/user-glossary/import", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const body = req.body;
      const candidate = Array.isArray(body) ? { entries: body } : body;
      const parsed = userGlossaryImportSchema.safeParse(candidate);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || "Datei ungültig" });
      }
      const existing = await db
        .select()
        .from(userGlossaryEntries)
        .where(eq(userGlossaryEntries.userId, userId));
      const existingTerms = new Set(existing.map((e) => e.term.trim().toLowerCase()));
      let imported = 0;
      let skipped = 0;
      for (const entry of parsed.data.entries) {
        const term = entry.term.trim();
        const definition = entry.definition.trim();
        const key = term.toLowerCase();
        if (existingTerms.has(key)) {
          skipped++;
          continue;
        }
        await db.insert(userGlossaryEntries).values({ userId, term, definition });
        existingTerms.add(key);
        imported++;
      }
      res.json({ imported, skipped, total: parsed.data.entries.length });
    } catch (error) {
      console.error("Error importing user glossary:", error);
      res.status(500).json({ error: "Import fehlgeschlagen" });
    }
  });

  // ----- User Resource Links -----
  app.get("/api/user-resources", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const rows = await db
        .select()
        .from(userResourceLinks)
        .where(eq(userResourceLinks.userId, userId))
        .orderBy(desc(userResourceLinks.createdAt));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching user resources:", error);
      res.status(500).json({ error: "Failed to fetch user resources" });
    }
  });

  app.post("/api/user-resources", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const parsed = userResourceLinkSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Ungültige Daten" });
      const [created] = await db
        .insert(userResourceLinks)
        .values({
          userId,
          title: parsed.data.title.trim(),
          url: parsed.data.url.trim(),
          description: (parsed.data.description ?? "").trim(),
          category: (parsed.data.category ?? "").trim(),
          icon: (parsed.data.icon ?? null),
        })
        .returning();
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating user resource:", error);
      res.status(500).json({ error: "Failed to create resource" });
    }
  });

  app.put("/api/user-resources/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const parsed = userResourceLinkSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Ungültige Daten" });
      const [updated] = await db
        .update(userResourceLinks)
        .set({
          title: parsed.data.title.trim(),
          url: parsed.data.url.trim(),
          description: (parsed.data.description ?? "").trim(),
          category: (parsed.data.category ?? "").trim(),
          icon: (parsed.data.icon ?? null),
          updatedAt: new Date(),
        })
        .where(and(eq(userResourceLinks.id, req.params.id), eq(userResourceLinks.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Eintrag nicht gefunden" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating user resource:", error);
      res.status(500).json({ error: "Failed to update resource" });
    }
  });

  app.delete("/api/user-resources/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const [deleted] = await db
        .delete(userResourceLinks)
        .where(and(eq(userResourceLinks.id, req.params.id), eq(userResourceLinks.userId, userId)))
        .returning();
      if (!deleted) return res.status(404).json({ error: "Eintrag nicht gefunden" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user resource:", error);
      res.status(500).json({ error: "Failed to delete resource" });
    }
  });

  app.get("/api/user-resources/export", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const entries = await db
        .select()
        .from(userResourceLinks)
        .where(eq(userResourceLinks.userId, userId))
        .orderBy(desc(userResourceLinks.createdAt));
      const payload = {
        type: "drohnenflug.user-resources",
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: entries.map((e) => ({
          title: e.title,
          url: e.url,
          description: e.description,
          category: e.category,
          icon: e.icon,
        })),
      };
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ressourcen-${stamp}.json"`);
      res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
      console.error("Error exporting user resources:", error);
      res.status(500).json({ error: "Export fehlgeschlagen" });
    }
  });

  app.post("/api/user-resources/import", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const body = req.body;
      const candidate = Array.isArray(body) ? { entries: body } : body;
      const parsed = userResourceLinksImportSchema.safeParse(candidate);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || "Datei ungültig" });
      }
      const existing = await db
        .select()
        .from(userResourceLinks)
        .where(eq(userResourceLinks.userId, userId));
      const existingUrls = new Set(existing.map((e) => e.url.trim().toLowerCase()));
      let imported = 0;
      let skipped = 0;
      for (const entry of parsed.data.entries) {
        const title = entry.title.trim();
        const url = entry.url.trim();
        const description = (entry.description ?? "").trim();
        const category = (entry.category ?? "").trim();
        const icon = (entry.icon ?? null);
        const key = url.toLowerCase();
        if (existingUrls.has(key)) {
          skipped++;
          continue;
        }
        await db.insert(userResourceLinks).values({ userId, title, url, description, category, icon });
        existingUrls.add(key);
        imported++;
      }
      res.json({ imported, skipped, total: parsed.data.entries.length });
    } catch (error) {
      console.error("Error importing user resources:", error);
      res.status(500).json({ error: "Import fehlgeschlagen" });
    }
  });

  // ===== Admin API (full read-only access to every user's data) =====
  app.get("/api/admin/users", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const all = await db.select().from(users).orderBy(desc(users.createdAt));
      const summary = await Promise.all(
        all.map(async (u) => {
          const [d, s, l, g, r] = await Promise.all([
            db.select().from(drones).where(eq(drones.userId, u.id)),
            db.select().from(flightSessions).where(eq(flightSessions.userId, u.id)),
            db.select().from(logbookEntries).where(eq(logbookEntries.userId, u.id)),
            db.select().from(userGlossaryEntries).where(eq(userGlossaryEntries.userId, u.id)),
            db.select().from(userResourceLinks).where(eq(userResourceLinks.userId, u.id)),
          ]);
          return {
            id: u.id,
            email: u.email,
            name: u.name,
            isAdmin: u.isAdmin,
            authProvider: u.authProvider,
            createdAt: u.createdAt,
            counts: {
              drones: d.length,
              sessions: s.length,
              logbook: l.length,
              glossary: g.length,
              resources: r.length,
            },
          };
        })
      );
      res.json({ users: summary });
    } catch (err) {
      console.error("[admin] users list failed:", err);
      res.status(500).json({ error: "Konnte Nutzerliste nicht laden" });
    }
  });

  app.get("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const [u] = await db.select().from(users).where(eq(users.id, id));
      if (!u) return res.status(404).json({ error: "Nutzer nicht gefunden" });
      const [d, s, l, g, r, p, st, hist] = await Promise.all([
        db.select().from(drones).where(eq(drones.userId, id)).orderBy(desc(drones.createdAt)),
        db.select().from(flightSessions).where(eq(flightSessions.userId, id)).orderBy(desc(flightSessions.createdAt)),
        db.select().from(logbookEntries).where(eq(logbookEntries.userId, id)).orderBy(desc(logbookEntries.flightDate)),
        db.select().from(userGlossaryEntries).where(eq(userGlossaryEntries.userId, id)).orderBy(desc(userGlossaryEntries.createdAt)),
        db.select().from(userResourceLinks).where(eq(userResourceLinks.userId, id)).orderBy(desc(userResourceLinks.createdAt)),
        db.select().from(pilotProfiles).where(eq(pilotProfiles.userId, id)),
        db.select().from(userSettings).where(eq(userSettings.userId, id)),
        db.select().from(droneHistoryEntries).where(eq(droneHistoryEntries.userId, id)).orderBy(desc(droneHistoryEntries.createdAt)),
      ]);
      res.json({
        user: {
          id: u.id,
          email: u.email,
          name: u.name,
          isAdmin: u.isAdmin,
          authProvider: u.authProvider,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        },
        profile: p[0] || null,
        settings: st[0] || null,
        drones: d,
        sessions: s,
        logbook: l,
        glossary: g,
        resources: r,
        droneHistory: hist,
      });
    } catch (err) {
      console.error("[admin] user detail failed:", err);
      res.status(500).json({ error: "Konnte Nutzerdetails nicht laden" });
    }
  });

  startOgnClient();

  const httpServer = createServer(app);
  return httpServer;
}
