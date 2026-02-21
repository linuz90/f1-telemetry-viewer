#!/usr/bin/env npx tsx
/**
 * Production server for F1 Telemetry Viewer.
 *
 * Serves the Vite build (dist/) and exposes an API to browse telemetry
 * sessions stored as JSON files on disk.  Imports the same parsing
 * utilities used by the Vite dev plugin, so session metadata never
 * drifts out of sync with the frontend.
 *
 * Configuration (environment variables):
 *   PORT          – HTTP port (default: 3080)
 *   TELEMETRY_DIR – Path to the directory containing telemetry JSON files (required)
 *   DIST_DIR      – Path to the Vite build output (default: ./dist next to this file)
 *
 * Usage:
 *   # Build the frontend first
 *   pnpm build
 *
 *   # Start the server
 *   TELEMETRY_DIR=/path/to/telemetry pnpm start
 *
 * Works on macOS, Linux, and Windows.
 */

import { createServer } from "node:http";
import {
  readFileSync,
  readdirSync,
  existsSync,
  createReadStream,
  statSync,
} from "node:fs";
import { join, relative, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFilename, toSlug } from "./src/utils/parseFilename.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3080", 10);
const TELEMETRY_DIR = process.env.TELEMETRY_DIR;

if (!TELEMETRY_DIR) {
  console.error(
    "Error: TELEMETRY_DIR environment variable is required.\n" +
      "Set it to the directory containing your telemetry JSON files.\n\n" +
      "  TELEMETRY_DIR=/path/to/telemetry pnpm start\n",
  );
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(process.env.DIST_DIR || join(__dirname, "dist"));

if (!existsSync(DIST_DIR)) {
  console.error(
    `Error: dist directory not found at ${DIST_DIR}\n` +
      "Run 'pnpm build' first to generate the production build.\n",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively find all .json files under a directory. */
function findJsonFiles(dir: string, base: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findJsonFiles(full, base));
    else if (entry.name.endsWith(".json")) results.push(relative(base, full));
  }
  return results;
}

/** Common MIME types for static file serving. */
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".webp": "image/webp",
};

// ---------------------------------------------------------------------------
// Session list builder
// ---------------------------------------------------------------------------

/**
 * Maps URL-safe slugs to their relative file paths inside TELEMETRY_DIR.
 * Populated (and refreshed) every time the session list is built.
 */
const slugMap = new Map<string, string>();

/**
 * Scans TELEMETRY_DIR for telemetry JSON files, parses their filenames,
 * extracts summary metadata (lap count, best lap, AI difficulty, etc.),
 * and returns a sorted array of session objects for the frontend.
 *
 * This mirrors the logic in src/plugin/telemetry-server.ts so the API
 * response is identical in development and production.
 */
function buildSessionList() {
  slugMap.clear();
  const files = findJsonFiles(TELEMETRY_DIR, TELEMETRY_DIR);

  const sessions = files
    .map((relativePath) => {
      const parsed = parseFilename(relativePath);
      const slug = toSlug(relativePath);

      let validLapCount = 0;
      let lapIndicators: ("valid" | "invalid" | "best")[] | undefined;
      let bestLapTime: string | undefined;
      let bestLapTimeMs: number | undefined;
      let aiDifficulty: number | undefined;
      let isSpectator = false;

      try {
        const raw = readFileSync(join(TELEMETRY_DIR, relativePath), "utf-8");
        const json = JSON.parse(raw);

        // Determine online/offline and AI difficulty
        const sessionInfo = json["session-info"];
        const isOnline = sessionInfo?.["network-game"] === 1;
        aiDifficulty = isOnline ? 0 : (sessionInfo?.["ai-difficulty"] ?? 0);

        // Find the player driver, or fall back to the driver with the most laps (spectator mode)
        let focusDriver = json["classification-data"]?.find(
          (d: { "is-player": boolean }) => d["is-player"],
        );

        if (!focusDriver) {
          isSpectator = true;
          const drivers = json["classification-data"] ?? [];
          let maxLaps = 0;
          for (const d of drivers) {
            const count = (
              d["session-history"]?.["lap-history-data"] ?? []
            ).filter(
              (l: { "lap-time-in-ms": number }) => l["lap-time-in-ms"] > 0,
            ).length;
            if (count > maxLaps) {
              maxLaps = count;
              focusDriver = d;
            }
          }
        }

        if (focusDriver) {
          const laps =
            focusDriver["session-history"]?.["lap-history-data"] ?? [];
          validLapCount = laps.filter(
            (l: { "lap-time-in-ms": number }) => l["lap-time-in-ms"] > 0,
          ).length;

          // For qualifying sessions, build per-lap validity indicators
          const isQuali =
            parsed.sessionType === "Short Qualifying" ||
            parsed.sessionType === "One Shot Qualifying";

          if (isQuali) {
            const bestLapNum =
              focusDriver["session-history"]?.["best-lap-time-lap-num"] ?? -1;
            lapIndicators = laps
              .filter(
                (l: { "lap-time-in-ms": number }) => l["lap-time-in-ms"] > 0,
              )
              .map(
                (l: { "lap-valid-bit-flags": number }, i: number) => {
                  const lapNum = i + 1;
                  if (lapNum === bestLapNum) return "best" as const;
                  return l["lap-valid-bit-flags"] === 15
                    ? ("valid" as const)
                    : ("invalid" as const);
                },
              );

            // Extract best valid lap time for the session list
            if (bestLapNum > 0) {
              const bestLap = laps[bestLapNum - 1] as
                | { "lap-time-str": string; "lap-time-in-ms": number }
                | undefined;
              if (bestLap?.["lap-time-str"]) {
                bestLapTime = bestLap["lap-time-str"];
                bestLapTimeMs = bestLap["lap-time-in-ms"];
              }
            }
          }
        }
      } catch {
        // If we can't parse the file, include the session with 0 valid laps (filtered below)
      }

      slugMap.set(slug, relativePath);
      return {
        relativePath,
        slug,
        ...parsed,
        validLapCount,
        lapIndicators,
        bestLapTime,
        bestLapTimeMs,
        aiDifficulty,
        isSpectator,
      };
    })
    .filter((s) => s.validLapCount > 0);

  // Most recent sessions first
  sessions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return sessions;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // --- API: list all sessions ---
  if (url.pathname === "/api/sessions" || url.pathname === "/api/sessions/") {
    const sessions = buildSessionList();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sessions));
    return;
  }

  // --- API: get a single session by slug ---
  if (url.pathname.startsWith("/api/sessions/")) {
    const slug = url.pathname.replace("/api/sessions/", "");

    // Lazy rebuild if the slug isn't in the map yet (e.g. first request)
    if (!slugMap.has(slug)) buildSessionList();

    const sessionPath = slugMap.get(slug);
    if (!sessionPath) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const fullPath = join(TELEMETRY_DIR, sessionPath);

    // Path traversal protection
    if (!fullPath.startsWith(resolve(TELEMETRY_DIR)) || !existsSync(fullPath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    createReadStream(fullPath).pipe(res);
    return;
  }

  // --- Static files from dist/ ---
  let filePath = join(
    DIST_DIR,
    url.pathname === "/" ? "index.html" : url.pathname,
  );

  // SPA fallback: if the file doesn't exist, serve index.html
  // so client-side routing works for deep links like /sessions/race-baku-...
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(DIST_DIR, "index.html");
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`F1 Telemetry Viewer running on http://localhost:${PORT}`);
  console.log(`Telemetry dir: ${TELEMETRY_DIR}`);
  console.log(`Serving build: ${DIST_DIR}`);
});
