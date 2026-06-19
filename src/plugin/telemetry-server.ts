import type { Plugin } from "vite";
import fs from "fs";
import path from "path";
import type { TelemetrySession } from "../types/telemetry.ts";
import { deduplicateSessions } from "../utils/deduplicateSessions.ts";
import { buildSessionSummary } from "../utils/sessionSummary.ts";

/** Recursively find all .json files under a directory */
function findJsonFiles(dir: string, base: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(full, base));
    } else if (entry.name.endsWith(".json")) {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

/**
 * Vite plugin that serves telemetry JSON files from a local directory.
 * - GET /api/sessions — list all sessions with metadata
 * - GET /api/sessions/[relativePath] — return raw JSON for a session
 */
export function telemetryServer(telemetryDir?: string): Plugin {
  // Maps slug → relativePath for session lookup
  const slugMap = new Map<string, string>();

  return {
    name: "telemetry-server",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/sessions")) return next();

        if (!telemetryDir) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "TELEMETRY_DIR not set in .env" }));
          return;
        }

        // GET /api/sessions — list all sessions
        if (req.url === "/api/sessions" || req.url === "/api/sessions/") {
          slugMap.clear();
          const files = findJsonFiles(telemetryDir, telemetryDir);
          const sessions = files
            .map((relativePath) => {
              try {
                const raw = fs.readFileSync(
                  path.join(telemetryDir, relativePath),
                  "utf-8",
                );
                const json = JSON.parse(raw) as TelemetrySession;
                return buildSessionSummary(
                  relativePath,
                  json,
                  Buffer.byteLength(raw),
                );
              } catch {
                // If we can't parse, include the session with 0
                return buildSessionSummary(relativePath);
              }
            })
            .filter((built) => built.valid)
            .map((built) => built.summary);

          // Remove duplicate auto-save / manual-save pairs
          const deduplicated = deduplicateSessions(sessions);

          // Sort by date descending
          deduplicated.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
          );

          // Populate slug map only for surviving sessions
          for (const s of deduplicated) {
            slugMap.set(s.slug, s.relativePath);
          }

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(deduplicated));
          return;
        }

        // GET /api/sessions/[slug] — return session JSON
        const slug = req.url.replace("/api/sessions/", "");
        const sessionPath = slugMap.get(slug);

        if (!sessionPath) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        const fullPath = path.join(telemetryDir, sessionPath);

        // Prevent path traversal
        if (!fullPath.startsWith(telemetryDir)) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "Forbidden" }));
          return;
        }

        if (!fs.existsSync(fullPath)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        res.setHeader("Content-Type", "application/json");
        fs.createReadStream(fullPath).pipe(res);
      });
    },
  };
}
