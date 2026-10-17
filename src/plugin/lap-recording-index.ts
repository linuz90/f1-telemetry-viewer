import { basename, dirname } from "node:path";
import {
  buildRecordingPairing,
  openLapArchive,
  openLapRecording,
  recordingPairKey,
  summarizeLapRecording,
  type LapArchive,
} from "../utils/lapRecording/reader.ts";
import {
  LAP_RECORDING_EXTENSION,
  type LapRecordingManifest,
  type LapRecordingSummary,
  type RecordingPairing,
} from "../utils/lapRecording/types.ts";
import {
  collectCandidateStats,
  discoverTelemetryFiles,
  openIndexedFile,
  type CandidateStat,
} from "./session-summary-index-files.ts";
import {
  cacheSignaturesEqual,
  type FileSignature,
} from "./session-summary-index-storage.ts";

/**
 * In-memory index of Pits n' Giggles lap recordings (`*.pngt`).
 *
 * Deliberately separate from the session summary index: recordings stay
 * reachable even when `deduplicateSessions` hides their session (the only
 * complete qualifying laps in the first beta corpus sit in hidden restart
 * runs), and neither `SessionSummary` nor its cache version changes. A cold
 * scan of 51 recordings takes about 0.5 s, so nothing is persisted yet.
 */
const OPEN_ARCHIVE_LIMIT = 4;

export interface LapRecordingIndex {
  list(): Promise<LapRecordingSummary[]>;
  manifest(slug: string): Promise<LapRecordingManifest | undefined>;
  lapBytes(
    slug: string,
    driverIndex: number,
    lapNumber: number,
  ): Promise<Uint8Array | undefined>;
}

interface IndexedRecording {
  relativePath: string;
  signature: FileSignature;
  pairingPath?: string;
  pairingSignature?: FileSignature;
  manifest: LapRecordingManifest;
  summary: LapRecordingSummary;
}

interface PairingEntry {
  signature: FileSignature;
  pairing?: RecordingPairing;
}

export function createLapRecordingIndex(options: {
  telemetryDir: string;
  logger?: Pick<Console, "info" | "warn">;
}): LapRecordingIndex {
  const telemetryRoot = options.telemetryDir;
  const logger = options.logger ?? console;
  let recordings = new Map<string, IndexedRecording>();
  let bySlug = new Map<string, IndexedRecording>();
  const pairings = new Map<string, PairingEntry>();
  const failed = new Map<string, FileSignature>();
  let refreshPromise: Promise<void> | undefined;
  let scannedOnce = false;
  // A comparison reads laps from up to four recordings; keep a few archives
  // open (lap reads only, no manifest scan) and share in-flight opens.
  const openArchives = new Map<string, Promise<LapArchive | undefined>>();

  async function readIndexed(
    relativePath: string,
    extension: string,
  ): Promise<Buffer | undefined> {
    const file = await openIndexedFile(telemetryRoot, relativePath, extension);
    if (!file) return undefined;
    try {
      return await file.handle.readFile();
    } finally {
      await file.handle.close().catch(() => undefined);
    }
  }

  async function loadPairing(
    candidate: CandidateStat | undefined,
  ): Promise<RecordingPairing | undefined> {
    if (!candidate?.signature) return undefined;
    const cached = pairings.get(candidate.relativePath);
    if (cached && cacheSignaturesEqual(cached.signature, candidate.signature)) {
      return cached.pairing;
    }
    let pairing: RecordingPairing | undefined;
    try {
      const raw = await readIndexed(candidate.relativePath, ".json");
      if (raw) {
        pairing = buildRecordingPairing(
          candidate.relativePath,
          JSON.parse(raw.toString("utf8")),
        );
      }
    } catch {
      logger.warn(
        `Unable to read the session paired with a lap recording: ${candidate.relativePath}`,
      );
    }
    pairings.set(candidate.relativePath, {
      signature: candidate.signature,
      pairing,
    });
    return pairing;
  }

  async function performRefresh(): Promise<void> {
    const startedAt = performance.now();
    const discovered = await discoverTelemetryFiles(telemetryRoot, [
      LAP_RECORDING_EXTENSION,
      ".json",
    ]);
    const recordingPaths = discovered.filter((path) =>
      path.endsWith(LAP_RECORDING_EXTENSION),
    );
    const sessionPaths = recordingPaths.length
      ? discovered.filter((path) => path.endsWith(".json"))
      : [];
    const onInspectError = (relativePath: string) =>
      logger.warn(`Unable to inspect telemetry file: ${relativePath}`);

    // Pair by normalized base name, preferring the JSON in a `race-info`
    // folder beside the recording's `telemetry` folder when names repeat.
    const sessionsByKey = new Map<string, string[]>();
    for (const sessionPath of sessionPaths) {
      const key = recordingPairKey(basename(sessionPath));
      sessionsByKey.set(key, [...(sessionsByKey.get(key) ?? []), sessionPath]);
    }
    const pairedSessionPaths = new Map<string, string>();
    for (const recordingPath of recordingPaths) {
      const candidates =
        sessionsByKey.get(recordingPairKey(basename(recordingPath))) ?? [];
      const dayFolder = dirname(dirname(recordingPath));
      const match =
        candidates.find((path) => dirname(dirname(path)) === dayFolder) ??
        candidates[0];
      if (match) pairedSessionPaths.set(recordingPath, match);
    }

    const [recordingStats, sessionStats] = await Promise.all([
      collectCandidateStats(
        telemetryRoot,
        recordingPaths,
        onInspectError,
        LAP_RECORDING_EXTENSION,
      ),
      collectCandidateStats(
        telemetryRoot,
        [...new Set(pairedSessionPaths.values())],
        onInspectError,
        ".json",
      ),
    ]);
    const sessionStatByPath = new Map(
      sessionStats.map((stat) => [stat.relativePath, stat]),
    );

    const next = new Map<string, IndexedRecording>();
    let parsed = 0;
    for (const stat of recordingStats) {
      if (stat.state !== "regular" || !stat.signature) continue;
      const pairingPath = pairedSessionPaths.get(stat.relativePath);
      const pairingStat = pairingPath
        ? sessionStatByPath.get(pairingPath)
        : undefined;
      const previous = recordings.get(stat.relativePath);
      if (
        previous &&
        cacheSignaturesEqual(previous.signature, stat.signature) &&
        previous.pairingPath === pairingPath &&
        (!pairingStat?.signature ||
          (previous.pairingSignature &&
            cacheSignaturesEqual(
              previous.pairingSignature,
              pairingStat.signature,
            )))
      ) {
        next.set(stat.relativePath, previous);
        continue;
      }
      const failedSignature = failed.get(stat.relativePath);
      if (
        failedSignature &&
        cacheSignaturesEqual(failedSignature, stat.signature)
      ) {
        continue;
      }

      try {
        const raw = await readIndexed(
          stat.relativePath,
          LAP_RECORDING_EXTENSION,
        );
        if (!raw) continue;
        const pairing = await loadPairing(pairingStat);
        const { manifest } = await openLapRecording(raw, {
          fileName: basename(stat.relativePath),
          pairing,
        });
        parsed += 1;
        failed.delete(stat.relativePath);
        next.set(stat.relativePath, {
          relativePath: stat.relativePath,
          signature: stat.signature,
          pairingPath,
          pairingSignature: pairingStat?.signature,
          manifest,
          summary: summarizeLapRecording(manifest),
        });
      } catch (error) {
        // A recording still being written fails here; its signature changes
        // once the exporter finishes, which retries it on the next refresh.
        failed.set(stat.relativePath, stat.signature);
        logger.warn(
          `Unable to read lap recording ${stat.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Forget files that are gone so a long-running server does not grow.
    const pairedPaths = new Set(pairedSessionPaths.values());
    for (const path of pairings.keys()) {
      if (!pairedPaths.has(path)) pairings.delete(path);
    }
    const presentRecordings = new Set(recordingPaths);
    for (const path of failed.keys()) {
      if (!presentRecordings.has(path)) failed.delete(path);
    }

    recordings = next;
    bySlug = new Map();
    for (const recording of [...next.values()].sort((a, b) =>
      a.relativePath < b.relativePath ? -1 : 1,
    )) {
      if (!bySlug.has(recording.manifest.slug)) {
        bySlug.set(recording.manifest.slug, recording);
      }
    }
    if (parsed > 0) {
      logger.info(
        `Lap recording index refresh: recordings=${next.size} parsed=${parsed} durationMs=${(performance.now() - startedAt).toFixed(1)}`,
      );
    }
  }

  function refresh(): Promise<void> {
    refreshPromise ??= performRefresh()
      .then(() => {
        scannedOnce = true;
      })
      .catch((error: unknown) => {
        // A folder moved mid-walk should not fail every request: keep
        // serving the last good scan, as the session index does.
        if (!scannedOnce) throw error;
        logger.warn(
          `Lap recording refresh failed; serving the previous scan: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        refreshPromise = undefined;
      });
    return refreshPromise;
  }

  async function findRecording(
    slug: string,
  ): Promise<IndexedRecording | undefined> {
    if (!bySlug.has(slug)) await refresh();
    return bySlug.get(slug);
  }

  return {
    async list() {
      await refresh();
      return [...bySlug.values()]
        .map((recording) => recording.summary)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },
    async manifest(slug) {
      return (await findRecording(slug))?.manifest;
    },
    async lapBytes(slug, driverIndex, lapNumber) {
      const recording = await findRecording(slug);
      if (!recording) return undefined;
      const key = `${recording.relativePath}|${recording.signature.size}|${recording.signature.mtimeNs}`;
      let archive = openArchives.get(key);
      if (archive) {
        openArchives.delete(key);
      } else {
        archive = readIndexed(recording.relativePath, LAP_RECORDING_EXTENSION)
          .then((raw) => (raw ? openLapArchive(raw) : undefined))
          .catch((error: unknown) => {
            logger.warn(
              `Unable to open lap recording ${recording.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
            );
            return undefined;
          });
      }
      openArchives.set(key, archive);
      while (openArchives.size > OPEN_ARCHIVE_LIMIT) {
        openArchives.delete(openArchives.keys().next().value!);
      }
      const opened = await archive;
      if (!opened) openArchives.delete(key);
      return opened?.readLapBytes(driverIndex, lapNumber);
    },
  };
}

export interface LapRecordingResponse {
  status: number;
  contentType: string;
  body: string | Uint8Array;
  cacheControl: string;
}

const LAP_RECORDINGS_PREFIX = "/api/lap-recordings";

export function isLapRecordingPath(pathname: string): boolean {
  return (
    pathname === LAP_RECORDINGS_PREFIX ||
    pathname.startsWith(`${LAP_RECORDINGS_PREFIX}/`)
  );
}

function jsonResponse(status: number, value: unknown): LapRecordingResponse {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
    cacheControl: "private, no-cache",
  };
}

/**
 * Shared request handler for the dev middleware and the self-hosting server.
 *   GET /api/lap-recordings                       one summary row per recording
 *   GET /api/lap-recordings/<slug>                manifest with every lap
 *   GET /api/lap-recordings/<slug>/<driver>/<lap> raw `.npz` bytes of one lap
 */
export async function resolveLapRecordingRequest(
  pathname: string,
  index: LapRecordingIndex,
): Promise<LapRecordingResponse> {
  const rest = pathname
    .slice(LAP_RECORDINGS_PREFIX.length)
    .replace(/^\/+|\/+$/g, "");
  if (rest === "") return jsonResponse(200, await index.list());

  const parts = rest.split("/");
  const slug = parts[0];
  if (!/^[a-z0-9-]+$/.test(slug) || parts.length > 3 || parts.length === 2) {
    return jsonResponse(404, { error: "Lap recording not found" });
  }
  if (parts.length === 1) {
    const manifest = await index.manifest(slug);
    return manifest
      ? jsonResponse(200, manifest)
      : jsonResponse(404, { error: "Lap recording not found" });
  }

  if (!/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) {
    return jsonResponse(404, { error: "Lap not found" });
  }
  const driverIndex = Number(parts[1]);
  const lapNumber = Number(parts[2]);
  const bytes = await index.lapBytes(slug, driverIndex, lapNumber);
  if (!bytes) return jsonResponse(404, { error: "Lap not found" });
  return {
    status: 200,
    contentType: "application/octet-stream",
    body: bytes,
    // TanStack keeps laps for the whole visit; no-cache keeps a rewritten
    // recording from ever serving a stale lap after a reload.
    cacheControl: "private, no-cache",
  };
}
