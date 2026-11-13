import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupSession } from "./auth";
import { startDailySyncCron } from "./dataSync";
import * as fs from "fs";
import * as path from "path";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    const origin = req.header("origin");

    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "8mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "8mb" }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 120) {
        logLine = logLine.slice(0, 119) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function setupExpoLandingPage(app: express.Application) {
  // Bedienungsfreundliche Landing-Page mit QR-Code, damit Pilot:innen die App
  // mit einem Scan in Expo Go laden können (Aufruf z. B. /expo oder /install).
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );

  app.get(["/expo", "/install", "/app"], (req: Request, res: Response) => {
    if (!fs.existsSync(templatePath)) {
      return res.status(404).send("Landing page template missing");
    }
    // Priorität: tatsächlicher Host der eingehenden Anfrage. Damit zeigt der
    // QR-Code / Deep-Link IMMER auf dieselbe Domain, von der die Landing-Seite
    // ausgeliefert wird (dev vs. prod). Sonst landet ein über die Prod-Seite
    // gescannter Code auf der Dev-Domain — die schläft → 404 in Expo Go.
    const host =
      req.header("x-forwarded-host") ||
      req.header("host") ||
      process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ||
      process.env.REPLIT_DEV_DOMAIN ||
      "localhost:5000";

    const html = fs
      .readFileSync(templatePath, "utf-8")
      .replace(/APP_NAME_PLACEHOLDER/g, "COpter Pilot")
      .replace(/EXPS_URL_PLACEHOLDER/g, host);

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });
}

function setupMobileExpoSupport(app: express.Application) {
  // Mobile clients hitting / or /manifest with expo-platform header → serve manifest
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    if (req.path !== "/" && req.path !== "/manifest") return next();

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    next();
  });

  // Static mobile assets
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  // Download endpoint for the packaged app source
  app.get("/download/copterpilot-app.tar.gz", (_req: Request, res: Response) => {
    const file = path.resolve(process.cwd(), "exports", "copterpilot-app.tar.gz");
    if (!fs.existsSync(file)) {
      res.status(404).send("Paket nicht gefunden");
      return;
    }
    res.download(file, "copterpilot-app.tar.gz");
  });
}

async function setupWebApp(app: express.Application, server: import("node:http").Server) {
  const isProd = process.env.NODE_ENV === "production";
  const webRoot = path.resolve(process.cwd(), "web");
  const distDir = path.resolve(webRoot, "dist");

  if (isProd) {
    if (!fs.existsSync(distDir)) {
      // The Replit deploy build chain (`expo:static:build && server:build`)
      // doesn't run `vite build` for the web app, so on a fresh deploy
      // web/dist won't exist. Build it on first boot so deployment succeeds
      // without touching the protected build pipeline.
      log("[web] dist missing — building web app with Vite (one-time on boot)…");
      try {
        const { build } = await import("vite");
        await build({
          configFile: path.resolve(webRoot, "vite.config.ts"),
          root: webRoot,
          logLevel: "info",
        });
        log("[web] vite build complete");
      } catch (err) {
        throw new Error(
          `[web] failed to build production bundle at ${distDir}: ${(err as Error).message}`
        );
      }
      if (!fs.existsSync(distDir)) {
        throw new Error(
          `[web] production build still missing at ${distDir} after on-demand vite build`
        );
      }
    }
    log("[web] serving production build from web/dist");
    app.use(express.static(distDir));
    app.get("*", (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distDir, "index.html"));
    });
    return;
  }

  log("[web] starting Vite dev middleware");
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configFile: path.resolve(webRoot, "vite.config.ts"),
    root: webRoot,
    server: {
      middlewareMode: true,
      // HMR rides the same Express HTTP server (port 5000). Forcing the
      // client port avoids the "ws://localhost:5173 refused" failure that
      // breaks Vite's full-reload signal when deps re-optimize.
      hmr: {
        server,
        clientPort: parseInt(process.env.PORT || "5000", 10),
      },
      allowedHosts: true,
    },
    appType: "spa",
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();
    // Force no-store on dev entry HTML and the main bootstrap module so that
    // mobile Safari (and other aggressive caches) cannot serve a stale copy
    // whose embedded `?v=hash` dep imports point at outdated optimized chunks.
    // In SPA mode any path without a file extension resolves to index.html.
    // Treat all such paths plus main.tsx as "entry" so caches never freeze them.
    const lastSegment = req.path.split("/").pop() || "";
    const hasExtension = lastSegment.includes(".");
    // Anything Vite transforms on the fly (entry HTML, SPA routes, source modules
    // under /src, /@vite, /@fs, plus raw .ts/.tsx/.jsx/.js files) embeds the
    // current ?v=hash for optimized deps. If the browser revives any of these
    // from cache via 304, the embedded hashes go stale → 504 white page.
    // Only the actual /node_modules/.vite/deps/*.js chunks may keep Vite's
    // default no-cache caching since the ?v=hash IS their unique identifier.
    const isOptimizedDep = req.path.startsWith("/node_modules/.vite/deps/");
    const isTransformedSource =
      !isOptimizedDep &&
      (req.path.startsWith("/src/") ||
        req.path.startsWith("/@vite/") ||
        req.path.startsWith("/@fs/") ||
        req.path.startsWith("/@id/") ||
        req.path.startsWith("/@react-refresh") ||
        /\.(tsx|ts|jsx|mjs|cjs|js)$/.test(req.path));
    const isEntry =
      !hasExtension || req.path.endsWith(".html") || isTransformedSource;
    if (isEntry) {
      const NO_STORE = "no-store, no-cache, must-revalidate, proxy-revalidate";
      // Strip conditional-request headers BEFORE Vite's middleware runs.
      // Otherwise Vite (or any inner middleware) can short-circuit with a
      // 304 Not Modified based on the *request* conditionals, before our
      // outgoing header overrides ever apply — reviving a stale cached copy
      // that embeds dead `?v=hash` dep imports and re-triggering 504s.
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];
      // Patch setHeader so anything Vite writes is overridden
      const origSetHeader = res.setHeader.bind(res);
      res.setHeader = function (name: string, value: number | string | readonly string[]) {
        if (typeof name === "string") {
          const lower = name.toLowerCase();
          if (lower === "cache-control") {
            return origSetHeader("Cache-Control", NO_STORE);
          }
          if (lower === "etag" || lower === "last-modified") {
            return res; // swallow — would let stale 304s revive a broken page
          }
        }
        return origSetHeader(name, value);
      } as typeof res.setHeader;
      // Patch writeHead so headers passed in writeHead(status, headers) are also overridden
      const origWriteHead = res.writeHead.bind(res) as (...args: unknown[]) => Response;
      res.writeHead = function (...args: unknown[]) {
        const headers = args[args.length - 1];
        if (headers && typeof headers === "object" && !Array.isArray(headers)) {
          const h = headers as Record<string, string | number | string[]>;
          for (const key of Object.keys(h)) {
            const lower = key.toLowerCase();
            if (lower === "cache-control" || lower === "etag" || lower === "last-modified") {
              delete h[key];
            }
          }
          h["Cache-Control"] = NO_STORE;
          h["Pragma"] = "no-cache";
          h["Expires"] = "0";
        }
        return origWriteHead(...args);
      } as typeof res.writeHead;
      origSetHeader("Cache-Control", NO_STORE);
      origSetHeader("Pragma", "no-cache");
      origSetHeader("Expires", "0");
      // Strip ETag so a stale 304 cannot revive a broken cached entry document.
      res.removeHeader("ETag");
      // On the entry HTML, also tell the browser to purge any pre-existing
      // cached copies of the SPA (stale main.tsx referencing dead ?v=hash deps).
      // This only fires on the navigation document, so the cost is negligible.
      if (req.path === "/" || req.path.endsWith(".html")) {
        origSetHeader("Clear-Site-Data", '"cache"');
      }
    }
    next();
  });

  app.use(vite.middlewares);
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    res.status(status).json({ message });

    console.error(err);
  });
}

(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupSession(app);
  setupRequestLogging(app);

  setupExpoLandingPage(app);
  setupMobileExpoSupport(app);

  const server = await registerRoutes(app);

  await setupWebApp(app, server);

  setupErrorHandler(app);

  startDailySyncCron();

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);
    },
  );
})();
