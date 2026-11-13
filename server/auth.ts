import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import bcrypt from "bcryptjs";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { db } from "./db";
import { users, registerUserSchema, loginUserSchema, type User } from "../shared/schema";
import { eq } from "drizzle-orm";
import { fromZodError } from "zod-validation-error";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string | null;
      isAdmin?: boolean;
    }
  }
}

const PgStore = connectPgSimple(session);

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET environment variable must be set to a strong value (>= 32 chars) in production"
    );
  }
  // Dev only: derive a stable fallback from REPL_ID + DATABASE_URL
  return `dev-${process.env.REPL_ID || "local"}-${process.env.DATABASE_URL?.slice(-16) || "fallback"}-cp-session`;
}

export function setupSession(app: Express) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  app.set("trust proxy", 1);
  app.use(
    session({
      store: new PgStore({
        pool,
        tableName: "sessions",
        createTableIfMissing: false,
      }),
      secret: getSessionSecret(),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_TTL_MS,
      },
    })
  );

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email.toLowerCase().trim()));
          if (!user || !user.passwordHash) {
            return done(null, false, { message: "E-Mail oder Passwort falsch" });
          }
          const ok = await bcrypt.compare(password, user.passwordHash);
          if (!ok) {
            return done(null, false, { message: "E-Mail oder Passwort falsch" });
          }
          return done(null, { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin });
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );

  passport.serializeUser((user: Express.User, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      if (!user) return done(null, false);
      done(null, { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin });
    } catch (err) {
      done(err as Error);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return next();
  }
  return res.status(401).json({ error: "Nicht angemeldet" });
}

export function getUserId(req: Request): string {
  if (!req.user) {
    throw new Error("getUserId called without authenticated user");
  }
  return req.user.id;
}

function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
  };
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: "Nicht angemeldet" });
  }
  try {
    const userId = (req.user as { id: string }).id;
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (!u || !u.isAdmin) {
      return res.status(403).json({ error: "Admin-Rechte erforderlich" });
    }
    next();
  } catch (err) {
    console.error("requireAdmin error:", err);
    res.status(500).json({ error: "Berechtigungsprüfung fehlgeschlagen" });
  }
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = registerUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).toString() });
      }
      const { email, password, name } = parsed.data;
      const normalizedEmail = email.toLowerCase().trim();

      const [existing] = await db.select().from(users).where(eq(users.email, normalizedEmail));
      if (existing) {
        return res.status(409).json({ error: "Diese E-Mail-Adresse ist bereits registriert" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const [created] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          passwordHash,
          name: name || null,
          authProvider: "local",
        })
        .returning();

      req.login({ id: created.id, email: created.email, name: created.name }, (err) => {
        if (err) return next(err);
        res.status(201).json({ user: publicUser(created) });
      });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ error: "Registrierung fehlgeschlagen" });
    }
  });

  app.post("/api/auth/login", (req: Request, res: Response, next: NextFunction) => {
    const parsed = loginUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "E-Mail und Passwort erforderlich" });
    }
    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: { message?: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ error: info?.message || "Anmeldung fehlgeschlagen" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.json({ user });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req: Request, res: Response, next: NextFunction) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy((destroyErr) => {
        if (destroyErr) return next(destroyErr);
        res.clearCookie("connect.sid");
        res.json({ success: true });
      });
    });
  });

  app.get("/api/auth/user", (req: Request, res: Response) => {
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      return res.json({ user: req.user });
    }
    res.status(401).json({ error: "Nicht angemeldet" });
  });
}
