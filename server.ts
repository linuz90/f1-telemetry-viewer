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

import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  brotliCompressSync,
  constants as zlibConstants,
  createBrotliCompress,
  createGzip,
  gzipSync,
} from "node:zlib";
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

type ContentEncoding = "br" | "gzip";

const BROTLI_OPTIONS = {
  params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
};
const GZIP_OPTIONS = { level: 6 };

function selectContentEncoding(
  header: string | string[] | undefined,
): ContentEncoding | undefined {
  if (!header) return undefined;
  const qualities = new Map<string, number>();
  for (const value of (Array.isArray(header) ? header.join(",") : header).split(
    ",",
  )) {
    const [rawName, ...parameters] = value.trim().toLowerCase().split(";");
    if (!rawName) continue;
    let quality = 1;
    for (const parameter of parameters) {
      const [name, rawQuality] = parameter.trim().split("=");
      if (name !== "q") continue;
      const parsed = Number(rawQuality);
      quality = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
    }
    qualities.set(rawName, quality);
  }

  const wildcard = qualities.get("*") ?? 0;
  const brotliQuality = qualities.get("br") ?? wildcard;
  const gzipQuality = qualities.get("gzip") ?? wildcard;
  if (brotliQuality <= 0 && gzipQuality <= 0) return undefined;
  return brotliQuality >= gzipQuality ? "br" : "gzip";
}

function isCompressible(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/javascript" ||
    contentType === "application/json" ||
    contentType === "image/svg+xml"
  );
}

function createEncodingStream(encoding: ContentEncoding) {
  return encoding === "br"
    ? createBrotliCompress(BROTLI_OPTIONS)
    : createGzip(GZIP_OPTIONS);
}

function matchesEtag(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  if (!header) return false;
  return (Array.isArray(header) ? header.join(",") : header)
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag || value === `W/${etag}`);
}

interface CachedSessionListResponse {
  serializedSessions: string;
  etag: string;
  br?: Buffer;
  gzip?: Buffer;
}

/** Reuse ETags and encoded bodies until the serialized index changes. */
function createSessionListResponder() {
  let cached: CachedSessionListResponse | undefined;

  return (
    req: IncomingMessage,
    res: ServerResponse,
    serializedSessions: string,
  ): void => {
    if (!cached || cached.serializedSessions !== serializedSessions) {
      cached = {
        serializedSessions,
        etag: `"${createHash("sha256").update(serializedSessions).digest("base64url")}"`,
      };
    }

    const baseHeaders = {
      "Cache-Control": "private, no-cache",
      "Content-Type": "application/json",
      ETag: cached.etag,
      Vary: "Accept-Encoding",
    };
    if (matchesEtag(req.headers["if-none-match"], cached.etag)) {
      res.writeHead(304, baseHeaders);
      res.end();
      return;
    }

    const encoding = selectContentEncoding(req.headers["accept-encoding"]);
    let body: string | Buffer = serializedSessions;
    if (encoding === "br") {
      body = cached.br ??= brotliCompressSync(
        serializedSessions,
        BROTLI_OPTIONS,
      );
    } else if (encoding === "gzip") {
      body = cached.gzip ??= gzipSync(serializedSessions, GZIP_OPTIONS);
    }

    res.writeHead(200, {
      ...baseHeaders,
      ...(encoding ? { "Content-Encoding": encoding } : {}),
      "Content-Length": Buffer.isBuffer(body)
        ? body.byteLength
        : Buffer.byteLength(body),
    });
    res.end(body);
  };
}

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
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  contentType: string,
  cacheControl: string,
): void {
  const stream = createReadStream(filePath);
  const encoding = isCompressible(contentType)
    ? selectContentEncoding(req.headers["accept-encoding"])
    : undefined;
  const encoder = encoding ? createEncodingStream(encoding) : undefined;

  const fail = (error: Error) => {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    const statusCode = isMissingFileError(error) ? 404 : 500;
    res.writeHead(statusCode, { "Content-Type": "text/plain" });
    res.end(statusCode === 404 ? "Not found" : "Failed to read file");
  };

  stream.on("error", fail);
  encoder?.on("error", fail);

  stream.once("open", () => {
    if (res.destroyed || res.writableEnded) {
      stream.destroy();
      encoder?.destroy();
      return;
    }
    res.writeHead(200, {
      "Cache-Control": cacheControl,
      "Content-Type": contentType,
      ...(isCompressible(contentType) ? { Vary: "Accept-Encoding" } : {}),
      ...(encoding ? { "Content-Encoding": encoding } : {}),
    });
    if (encoder) stream.pipe(encoder).pipe(res);
    else stream.pipe(res);
  });

  res.once("close", () => {
    if (!stream.destroyed) stream.destroy();
    if (encoder && !encoder.destroyed) encoder.destroy();
  });
}

function streamOpenedSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessionFile: OpenedSessionFile,
): void {
  if (res.destroyed || res.writableEnded) {
    void sessionFile.handle.close();
    return;
  }

  try {
    const stream = sessionFile.handle.createReadStream({ autoClose: true });
    const encoding = selectContentEncoding(req.headers["accept-encoding"]);
    const encoder = encoding ? createEncodingStream(encoding) : undefined;
    stream.on("error", (error) => {
      if (res.destroyed || res.writableEnded) return;
      res.destroy(error);
    });
    encoder?.on("error", (error) => {
      if (res.destroyed || res.writableEnded) return;
      res.destroy(error);
    });
    res.writeHead(200, {
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Type": "application/json",
      Vary: "Accept-Encoding",
      ...(encoding ? { "Content-Encoding": encoding } : {}),
    });
    if (encoder) stream.pipe(encoder).pipe(res);
    else stream.pipe(res);
    res.once("close", () => {
      if (!stream.destroyed) stream.destroy();
      if (encoder && !encoder.destroyed) encoder.destroy();
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
  req: IncomingMessage,
  pathname: string,
  sessionIndex: SessionSummaryIndex,
  res: ServerResponse,
  writeSessionList: ReturnType<typeof createSessionListResponder>,
): Promise<void> {
  try {
    if (pathname === "/api/sessions" || pathname === "/api/sessions/") {
      const snapshot = await sessionIndex.refresh();
      if (res.destroyed || res.writableEnded) return;
      writeSessionList(req, res, snapshot.serializedSessions);
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

    streamOpenedSession(req, res, sessionFile);
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
  const writeSessionList = createSessionListResponder();
  const indexPath = join(distDir, "index.html");

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (
      url.pathname === "/api/sessions" ||
      url.pathname.startsWith("/api/sessions/")
    ) {
      void handleSessionApi(
        req,
        url.pathname,
        effectiveSessionIndex,
        res,
        writeSessionList,
      );
      return;
    }

    let filePath = join(
      distDir,
      url.pathname === "/" ? "index.html" : url.pathname,
    );

    // SPA fallback keeps client-side routes working on direct navigation.
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      filePath = indexPath;
    }

    const ext = extname(filePath);
    const cacheControl =
      filePath === indexPath
        ? "no-cache"
        : url.pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600";
    streamFile(
      req,
      res,
      filePath,
      MIME[ext] || "application/octet-stream",
      cacheControl,
    );
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
