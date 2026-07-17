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

import { createServer, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSessionSummaryIndex,
  type OpenedSessionFile,
  type SessionSummaryIndex,
} from "./src/plugin/session-summary-index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// HTTP server
// ---------------------------------------------------------------------------

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

/**
 * Delay response headers until the file is open so a final delete/read race can
 * still produce an HTTP error instead of an unhandled stream exception.
 */
function streamFile(
  res: ServerResponse,
  filePath: string,
  contentType: string,
): void {
  const stream = createReadStream(filePath);

  stream.on("error", (error) => {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    const statusCode = isMissingFileError(error) ? 404 : 500;
    res.writeHead(statusCode, { "Content-Type": "text/plain" });
    res.end(statusCode === 404 ? "Not found" : "Failed to read file");
  });

  stream.once("open", () => {
    if (res.destroyed || res.writableEnded) {
      stream.destroy();
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    stream.pipe(res);
  });

  res.once("close", () => {
    if (!stream.destroyed) stream.destroy();
  });
}

function streamOpenedSession(
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
    res.writeHead(200, { "Content-Type": "application/json" });
    stream.pipe(res);
    res.once("close", () => {
      if (!stream.destroyed) stream.destroy();
    });
  } catch {
    void sessionFile.handle.close();
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Failed to read file");
    } else {
      res.destroy();
    }
  }
}

function writeIndexError(res: ServerResponse): void {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Failed to load telemetry sessions" }));
}

async function handleSessionApi(
  pathname: string,
  sessionIndex: SessionSummaryIndex,
  res: ServerResponse,
): Promise<void> {
  try {
    if (pathname === "/api/sessions" || pathname === "/api/sessions/") {
      const snapshot = await sessionIndex.refresh();
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, { "Content-Type": "application/json" });
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
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    streamOpenedSession(res, sessionFile);
  } catch (error) {
    console.error("Failed to refresh telemetry session index:", error);
    writeIndexError(res);
  }
}

export interface ProductionServerOptions {
  telemetryDir: string;
  distDir: string;
  sessionIndex?: SessionSummaryIndex;
}

/** Creates the standalone server without listening, so its API can be tested. */
export function createProductionServer({
  telemetryDir,
  distDir,
  sessionIndex,
}: ProductionServerOptions): Server {
  const effectiveSessionIndex =
    sessionIndex ??
    createSessionSummaryIndex({
      telemetryDir,
      cacheExclusionRoots: [distDir],
    });

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (
      url.pathname === "/api/sessions" ||
      url.pathname.startsWith("/api/sessions/")
    ) {
      void handleSessionApi(url.pathname, effectiveSessionIndex, res);
      return;
    }

    let filePath = join(
      distDir,
      url.pathname === "/" ? "index.html" : url.pathname,
    );

    // SPA fallback keeps client-side routes working on direct navigation.
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      filePath = join(distDir, "index.html");
    }

    const ext = extname(filePath);
    streamFile(res, filePath, MIME[ext] || "application/octet-stream");
  });
}

function startProductionServer(): void {
  const port = parseInt(process.env.PORT || "3080", 10);
  const telemetryDir = process.env.TELEMETRY_DIR;
  if (!telemetryDir) {
    console.error(
      "Error: TELEMETRY_DIR environment variable is required.\n" +
        "Set it to the directory containing your telemetry JSON files.\n\n" +
        "  TELEMETRY_DIR=/path/to/telemetry pnpm start\n",
    );
    process.exit(1);
  }

  const serverDir = dirname(fileURLToPath(import.meta.url));
  const distDir = resolve(process.env.DIST_DIR || join(serverDir, "dist"));
  if (!existsSync(distDir)) {
    console.error(
      `Error: dist directory not found at ${distDir}\n` +
        "Run 'pnpm build' first to generate the production build.\n",
    );
    process.exit(1);
  }

  const server = createProductionServer({ telemetryDir, distDir });
  server.listen(port, () => {
    console.log(`F1 Telemetry Viewer running on http://localhost:${port}`);
    console.log(`Telemetry dir: ${telemetryDir}`);
    console.log(`Serving build: ${distDir}`);
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  startProductionServer();
}
