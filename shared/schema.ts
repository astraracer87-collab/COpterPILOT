import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, real, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const droneClassEnum = ["C0", "C1", "C2", "C3", "C4", "C5", "C6", "legacy"] as const;
export const droneTypeEnum = ["selfie", "standard", "fpv_only", "hybrid_fpv"] as const;
export const openCategoryEnum = ["A1", "A2", "A3"] as const;
export const sessionPhaseEnum = ["planning", "preflight", "hover", "postlanding", "debriefing", "completed"] as const;
export const assessmentStatusEnum = ["go", "caution", "nogo"] as const;

export const weatherLimitsSchema = z.object({
  maxWind: z.number(),
  maxGusts: z.number(),
  maxRain: z.number(),
  minTemp: z.number(),
  minCloudCeiling: z.number(),
  minVisibility: z.number(),
});

export const droneComplianceSchema = z.object({
  operatorRegistered: z.boolean(),
  eIdLabeledOnDrone: z.boolean(),
  insuranceActive: z.boolean(),
  competencyA1A3: z.boolean(),
  certificateA2: z.boolean(),
  remoteIdConfigured: z.boolean(),
  spotterConfirmed: z.boolean().optional(),
});

export const gpsTrackPointSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  alt: z.number().optional(),
  ts: z.number().optional(),
});
export const gpsTrackSchema = z.array(gpsTrackPointSchema);

export const weatherSnapshotSchema = z.object({
  temperature: z.number(),
  windSpeed: z.number(),
  windGust: z.number().optional(),
  rain: z.number(),
  cloudCover: z.number(),
  humidity: z.number(),
  kpIndex: z.number().optional(),
});

export const assessmentReasonSchema = z.object({
  type: z.enum(assessmentStatusEnum),
  message: z.string(),
});

export const planningDataSchema = z.object({
  plannedDate: z.string(),
  plannedTime: z.string(),
  flightPurpose: z.string().optional(),
  maxAltitude: z.number().optional(),
  maxDistance: z.number().optional(),
  estimatedDuration: z.number().optional(),
  durationMinutes: z.number().optional(),
  routeDescription: z.string().optional(),
  forecastWeather: weatherSnapshotSchema.optional(),
  checklistCompleted: z.array(z.string()),
  checklistPresented: z.array(z.string()).optional(),
  isFpvFlight: z.boolean().optional(),
  notamCount: z.number().optional(),
  notamCheckedAt: z.string().optional(),
});

export const preflightDataSchema = z.object({
  actualWeather: weatherSnapshotSchema.optional(),
  checklistCompleted: z.array(z.string()),
  checklistPresented: z.array(z.string()).optional(),
  equipmentNotes: z.string().optional(),
  completedAt: z.string().optional(),
});

export const hoverCheckDataSchema = z.object({
  checklistCompleted: z.array(z.string()).optional(),
  controlsOk: z.boolean().optional(),
  signalOk: z.boolean().optional(),
  hoverStable: z.boolean().optional(),
  takeoffTime: z.string().optional(),
  landingTime: z.string().optional(),
  skippedFlightCheck: z.boolean().optional(),
});

export const postLandingDataSchema = z.object({
  checklistCompleted: z.array(z.string()),
  uasPoweredOff: z.boolean(),
  controllerPoweredOff: z.boolean(),
  damageChecked: z.boolean(),
});

export const debriefingDataSchema = z.object({
  flightDurationMinutes: z.number().optional(),
  takeoffTime: z.string().optional(),
  landingTime: z.string().optional(),
  incidentOccurred: z.boolean(),
  incidentDescription: z.string().optional(),
  maintenanceRequired: z.boolean(),
  maintenanceNotes: z.string().optional(),
  generalNotes: z.string().optional(),
  batteryUsedPercent: z.number().optional(),
  checklistCompleted: z.array(z.string()).optional(),
});

// Users table — central account for the web app
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  name: text("name"),
  authProvider: text("auth_provider").notNull().default("local"),
  providerId: text("provider_id"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Session storage table for connect-pg-simple
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (t) => ({
    expireIdx: index("IDX_session_expire").on(t.expire),
  })
);

export const drones = pgTable("drones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  name: text("name").notNull(),
  manufacturer: text("manufacturer"),
  model: text("model"),
  classMark: text("class_mark").notNull(),
  mtomGrams: integer("mtom_grams").notNull(),
  hasCameraOrSensor: boolean("has_camera_or_sensor").notNull().default(true),
  droneType: text("drone_type").notNull().default("standard"),
  openCategory: text("open_category").notNull(),
  compliance: jsonb("compliance").notNull().$type<z.infer<typeof droneComplianceSchema>>(),
  limits: jsonb("limits").notNull().$type<z.infer<typeof weatherLimitsSchema>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const flightSessions = pgTable("flight_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  droneId: varchar("drone_id").notNull(),
  currentPhase: text("current_phase").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  locationName: text("location_name"),
  countryIso: text("country_iso"),
  mapUrl: text("map_url"),
  hasRestrictions: boolean("has_restrictions").notNull().default(false),
  restrictionNotes: text("restriction_notes"),
  status: text("status").notNull(),
  reasons: jsonb("reasons").$type<z.infer<typeof assessmentReasonSchema>[]>(),
  planning: jsonb("planning").$type<z.infer<typeof planningDataSchema>>(),
  preflight: jsonb("preflight").$type<z.infer<typeof preflightDataSchema>>(),
  hoverCheck: jsonb("hover_check").$type<z.infer<typeof hoverCheckDataSchema>>(),
  postLanding: jsonb("post_landing").$type<z.infer<typeof postLandingDataSchema>>(),
  debriefing: jsonb("debriefing").$type<z.infer<typeof debriefingDataSchema>>(),
  trafficLog: jsonb("traffic_log"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const logbookEntries = pgTable("logbook_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  sessionId: varchar("session_id").notNull(),
  droneId: varchar("drone_id").notNull(),
  droneName: text("drone_name").notNull(),
  droneClass: text("drone_class").notNull(),
  flightDate: text("flight_date").notNull(),
  locationName: text("location_name"),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  takeoffTime: text("takeoff_time"),
  landingTime: text("landing_time"),
  flightDurationMinutes: integer("flight_duration_minutes"),
  maxAltitude: integer("max_altitude"),
  weatherConditions: jsonb("weather_conditions").$type<z.infer<typeof weatherSnapshotSchema>>(),
  incidentOccurred: boolean("incident_occurred").notNull().default(false),
  incidentDescription: text("incident_description"),
  maintenanceRequired: boolean("maintenance_required").notNull().default(false),
  maintenanceNotes: text("maintenance_notes"),
  notes: text("notes"),
  planning: jsonb("planning").$type<z.infer<typeof planningDataSchema>>(),
  preflight: jsonb("preflight").$type<z.infer<typeof preflightDataSchema>>(),
  hoverCheck: jsonb("hover_check").$type<z.infer<typeof hoverCheckDataSchema>>(),
  postLanding: jsonb("post_landing").$type<z.infer<typeof postLandingDataSchema>>(),
  debriefing: jsonb("debriefing").$type<z.infer<typeof debriefingDataSchema>>(),
  hasRestrictions: boolean("has_restrictions"),
  restrictionNotes: text("restriction_notes"),
  status: text("status"),
  trafficLog: jsonb("traffic_log"),
  gpsTrack: jsonb("gps_track").$type<z.infer<typeof gpsTrackSchema>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const licenseDetailsSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  identificationNumber: z.string(),
  expirationDate: z.string(),
  country: z.string().optional(),
});

export type LicenseDetailsInput = z.infer<typeof licenseDetailsSchema>;

export const pilotProfiles = pgTable("pilot_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  name: text("name").notNull().default(""),
  pilotId: text("pilot_id").notNull().default(""),
  operatorId: text("operator_id").notNull().default(""),
  licenseA1A3: boolean("license_a1a3").notNull().default(false),
  licenseA2: boolean("license_a2").notNull().default(false),
  licenseSTS: boolean("license_sts").notNull().default(false),
  licenseA1A3Details: jsonb("license_a1a3_details").$type<LicenseDetailsInput>(),
  licenseA2Details: jsonb("license_a2_details").$type<LicenseDetailsInput>(),
  photoUrl: text("photo_url"),
  insuranceActive: boolean("insurance_active").notNull().default(false),
  operatorRegistered: boolean("operator_registered").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const droneHistoryEntries = pgTable("drone_history_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  droneId: varchar("drone_id").notNull(),
  eventType: text("event_type").notNull(),
  description: text("description").notNull(),
  date: text("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userGlossaryEntries = pgTable("user_glossary_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  term: text("term").notNull(),
  definition: text("definition").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const userResourceLinks = pgTable("user_resource_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default(""),
  icon: text("icon"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const userGlossaryEntrySchema = z.object({
  term: z.string().min(1, "Begriff erforderlich").max(200),
  definition: z.string().min(1, "Definition erforderlich").max(5000),
});

export const userResourceLinkSchema = z.object({
  title: z.string().min(1, "Titel erforderlich").max(200),
  url: z.string().url("Ungültige URL").max(2000),
  description: z.string().max(1000).optional().default(""),
  category: z.string().max(100).optional().default(""),
  icon: z.string().max(100).optional(),
});

export const userGlossaryImportSchema = z.object({
  entries: z.array(userGlossaryEntrySchema).max(2000),
});

export const userResourceLinksImportSchema = z.object({
  entries: z.array(userResourceLinkSchema).max(2000),
});

export type UserGlossaryEntry = typeof userGlossaryEntries.$inferSelect;
export type UserResourceLink = typeof userResourceLinks.$inferSelect;
export type UserGlossaryEntryInput = z.infer<typeof userGlossaryEntrySchema>;
export type UserResourceLinkInput = z.infer<typeof userResourceLinkSchema>;

export const userSettings = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").unique(),
  windUnit: text("wind_unit").notNull().default("m/s"),
  tempUnit: text("temp_unit").notNull().default("C"),
  limits: jsonb("limits").notNull().$type<z.infer<typeof weatherLimitsSchema>>(),
  preferGermany: boolean("prefer_germany").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const registerUserSchema = z.object({
  email: z.string().email("Bitte eine gültige E-Mail-Adresse angeben"),
  password: z.string().min(8, "Mindestens 8 Zeichen"),
  name: z.string().min(1, "Name erforderlich").optional(),
});

export const loginUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const insertDroneSchema = createInsertSchema(drones, {
  compliance: droneComplianceSchema,
  limits: weatherLimitsSchema,
}).omit({ createdAt: true, updatedAt: true, userId: true });

export const selectDroneSchema = createSelectSchema(drones);

export const insertFlightSessionSchema = createInsertSchema(flightSessions, {
  reasons: z.array(assessmentReasonSchema).optional(),
  planning: planningDataSchema.optional(),
  preflight: preflightDataSchema.optional(),
  hoverCheck: hoverCheckDataSchema.optional(),
  postLanding: postLandingDataSchema.optional(),
  debriefing: debriefingDataSchema.optional(),
}).omit({ createdAt: true, updatedAt: true, userId: true });

export const selectFlightSessionSchema = createSelectSchema(flightSessions);

export const insertLogbookEntrySchema = createInsertSchema(logbookEntries, {
  weatherConditions: weatherSnapshotSchema.optional(),
  planning: planningDataSchema.optional(),
  preflight: preflightDataSchema.optional(),
  hoverCheck: hoverCheckDataSchema.optional(),
  postLanding: postLandingDataSchema.optional(),
  debriefing: debriefingDataSchema.optional(),
  gpsTrack: gpsTrackSchema.optional(),
}).omit({ createdAt: true, userId: true });

export const selectLogbookEntrySchema = createSelectSchema(logbookEntries);

// Centralized server-side cache for slow / heavy upstream datasets
// (geozones from Dipul/BAZL/LU/PDOK and NOTAMs from Autorouter).
// Refreshed once per day by a background job, served to clients via /api/cached/*.
export const cachedDataset = pgTable("cached_dataset", {
  source: text("source").primaryKey(),
  kind: text("kind").notNull(),
  country: text("country"),
  features: jsonb("features").notNull(),
  metadata: jsonb("metadata"),
  bytes: integer("bytes").notNull().default(0),
  itemCount: integer("item_count").notNull().default(0),
  status: text("status").notNull().default("ok"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CachedDataset = typeof cachedDataset.$inferSelect;

export const insertUserSettingsSchema = createInsertSchema(userSettings, {
  limits: weatherLimitsSchema,
}).omit({ updatedAt: true, userId: true });

export const selectUserSettingsSchema = createSelectSchema(userSettings);

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type RegisterUser = z.infer<typeof registerUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type Drone = typeof drones.$inferSelect;
export type InsertDrone = z.infer<typeof insertDroneSchema>;
export type FlightSession = typeof flightSessions.$inferSelect;
export type InsertFlightSession = z.infer<typeof insertFlightSessionSchema>;
export type LogbookEntry = typeof logbookEntries.$inferSelect;
export type InsertLogbookEntry = z.infer<typeof insertLogbookEntrySchema>;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
