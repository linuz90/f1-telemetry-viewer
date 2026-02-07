import type { Plugin } from "vite";
import fs from "fs";
import path from "path";
import { parseFilename, toSlug } from "../utils/parseFilename.ts";

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
              const parsed = parseFilename(relativePath);
              const slug = toSlug(relativePath);

              // Count valid laps to filter out empty sessions
              let validLapCount = 0;
              let lapIndicators: ("valid" | "invalid" | "best")[] | undefined;
              let bestLapTime: string | undefined;
              let bestLapTimeMs: number | undefined;
              let aiDifficulty: number | undefined;
              let isSpectator = false;
              try {
                const raw = fs.readFileSync(
                  path.join(telemetryDir, relativePath),
                  "utf-8",
                );
                const json = JSON.parse(raw);
                const sessionInfo = json["session-info"];
                const isOnline = sessionInfo?.["network-game"] === 1;
                aiDifficulty = isOnline ? 0 : (sessionInfo?.["ai-difficulty"] ?? 0);
                let focusDriver = json["classification-data"]?.find(
                  (d: { "is-player": boolean }) => d["is-player"],
                );

                // Spectator fallback: no player → pick driver with most valid laps
                if (!focusDriver) {
                  isSpectator = true;
                  const drivers = json["classification-data"] ?? [];
                  let maxLaps = 0;
                  for (const d of drivers) {
                    const count = (d["session-history"]?.["lap-history-data"] ?? [])
                      .filter((l: { "lap-time-in-ms": number }) => l["lap-time-in-ms"] > 0).length;
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
                    (l: { "lap-time-in-ms": number; "lap-valid-bit-flags": number }) =>
                      l["lap-time-in-ms"] > 0,
                  ).length;

                  // For qualifying sessions, build per-lap indicators
                  const isQuali =
                    parsed.sessionType === "Short Qualifying" ||
                    parsed.sessionType === "One Shot Qualifying";
                  if (isQuali) {
                    const bestLapNum =
                      focusDriver["session-history"]?.["best-lap-time-lap-num"] ?? -1;
                    lapIndicators = laps
                      .filter(
                        (l: { "lap-time-in-ms": number }) =>
                          l["lap-time-in-ms"] > 0,
                      )
                      .map(
                        (
                          l: { "lap-valid-bit-flags": number },
                          i: number,
                        ) => {
                          const lapNum = i + 1;
                          if (lapNum === bestLapNum) return "best";
                          return l["lap-valid-bit-flags"] === 15
                            ? "valid"
                            : "invalid";
                        },
                      );

                    // Extract best valid lap time for sidebar display
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
                // If we can't parse, include the session with 0
              }

              slugMap.set(slug, relativePath);
              return { relativePath, slug, ...parsed, validLapCount, lapIndicators, bestLapTime, bestLapTimeMs, aiDifficulty, isSpectator };
            })
            .filter((s) => s.validLapCount > 0);

          // Sort by date descending
          sessions.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
          );

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(sessions));
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
