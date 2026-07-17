import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  createSessionSummaryIndex,
  type OpenedSessionFile,
  type SessionSummaryIndex,
} from "./session-summary-index.ts";

function writeJsonError(
  res: ServerResponse,
  statusCode: number,
  message: string,
): void {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

/** Stream the already-validated handle so later path swaps cannot redirect it. */
function streamSession(
  res: ServerResponse,
  sessionFile: OpenedSessionFile,
): void {
  if (res.destroyed || res.writableEnded) {
    void sessionFile.handle.close();
    return;
  }

  try {
    const stream = sessionFile.handle.createReadStream({ autoClose: true });
    stream.on("error", (error) => {
      if (res.destroyed || res.writableEnded) return;
      res.destroy(error);
    });
    res.setHeader("Content-Type", "application/json");
    stream.pipe(res);
    res.once("close", () => {
      if (!stream.destroyed) stream.destroy();
    });
  } catch {
    void sessionFile.handle.close();
    writeJsonError(res, 500, "Failed to read session");
  }
}

async function handleTelemetryRequest(
  pathname: string,
  sessionIndex: SessionSummaryIndex,
  res: ServerResponse,
): Promise<void> {
  try {
    if (pathname === "/api/sessions" || pathname === "/api/sessions/") {
      const snapshot = await sessionIndex.refresh();
      if (res.destroyed || res.writableEnded) return;
      res.setHeader("Content-Type", "application/json");
      res.end(snapshot.serializedSessions);
      return;
    }

    const slug = pathname.slice("/api/sessions/".length);
    const sessionFile = await sessionIndex.openSession(slug);
    if (res.destroyed || res.writableEnded) {
      await sessionFile?.handle.close();
      return;
    }
    if (!sessionFile) {
      writeJsonError(res, 404, "Session not found");
      return;
    }

    streamSession(res, sessionFile);
  } catch (error) {
    console.error("Failed to refresh telemetry session index:", error);
    writeJsonError(res, 500, "Failed to load telemetry sessions");
  }
}

/**
 * Vite plugin that serves telemetry JSON files from a local directory.
 * - GET /api/sessions — list all sessions with metadata
 * - GET /api/sessions/[slug] — return raw JSON for a session
 *
 * `base` is the configured Vite base path (e.g. "/save-viewer/"). The dev
 * server does not strip it before handing requests to middleware, so
 * built asset requests to `${base}api/sessions` would otherwise fall
 * through to `next()` and 404 whenever `base` isn't "/".
 */
export function telemetryServer(telemetryDir?: string, base = "/"): Plugin {
  // Pits n' Giggles loads this plugin during its production frontend build
  // without a telemetry directory. Do not initialize filesystem state then.
  const sessionIndex = telemetryDir
    ? createSessionSummaryIndex({ telemetryDir })
    : undefined;
  const basePrefix = base.endsWith("/") ? base.slice(0, -1) : base;

  return {
    name: "telemetry-server",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url ?? "";
        const strippedUrl =
          basePrefix && rawUrl.startsWith(basePrefix)
            ? rawUrl.slice(basePrefix.length)
            : rawUrl;
        const pathname = strippedUrl.split("?", 1)[0] ?? strippedUrl;

        if (
          pathname !== "/api/sessions" &&
          !pathname.startsWith("/api/sessions/")
        ) {
          return next();
        }

        if (!sessionIndex) {
          writeJsonError(res, 500, "TELEMETRY_DIR not set in .env");
          return;
        }

        // Connect does not observe returned promises, so the handler owns all
        // async errors and always completes the response itself.
        void handleTelemetryRequest(pathname, sessionIndex, res);
      });
    },
  };
}
