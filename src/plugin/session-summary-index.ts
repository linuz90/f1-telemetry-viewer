import { createHash } from "node:crypto";
import { lstat, open, readFile, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import type { SessionSummary, TelemetrySession } from "../types/telemetry.ts";
import { deduplicateSessions } from "../utils/deduplicateSessions.ts";
import {
  buildSessionSummary,
  SESSION_SUMMARY_CACHE_VERSION,
  type BuiltSessionSummary,
} from "../utils/sessionSummary.ts";
import {
  absolutePathFor,
  collectCandidateStats,
  discoverJsonFiles,
  isPathInsideOrEqual,
  isSafeRelativePath,
  openIndexedFile,
  pathResolvesInsideAny,
} from "./session-summary-index-files.ts";
import {
  signatureFromStats,
  signaturesEqual,
  validatePersistedIndex,
  writePersistedIndex,
  type FileSignature,
  type PersistedSessionEntry,
} from "./session-summary-index-storage.ts";

export const SESSION_INDEX_FORMAT_VERSION = 1;

const CORRUPT_FILE_SETTLE_MS = 5_000;
const ROOT_HASH_LENGTH = 16;

interface PendingParseFailure {
  signature: FileSignature;
  firstSeenAt: number;
}

interface FinalizedIndex {
  sessions: readonly SessionSummary[];
  serializedSessions: string;
  slugMap: Map<string, string>;
}

export type SessionIndexCacheState = "loaded" | "miss" | "rejected" | "memory";

export interface SessionIndexRefreshStats {
  discovered: number;
  reused: number;
  filesRead: number;
  parsed: number;
  invalid: number;
  malformed: number;
  unstable: number;
  ioFailures: number;
  deleted: number;
  rawBytesRead: number;
  durationMs: number;
  cacheState: SessionIndexCacheState;
  entriesChanged: boolean;
  persisted: boolean;
  fallback: boolean;
}

export interface SessionIndexSnapshot {
  sessions: readonly SessionSummary[];
  serializedSessions: string;
  stats: SessionIndexRefreshStats;
}

export interface OpenedSessionFile {
  path: string;
  handle: FileHandle;
}

export interface SessionSummaryIndex {
  refresh(): Promise<SessionIndexSnapshot>;
  openSession(slug: string): Promise<OpenedSessionFile | undefined>;
}

export interface SessionSummaryIndexOptions {
  telemetryDir: string;
  indexFile?: string;
  cacheExclusionRoots?: readonly string[];
  logger?: Pick<Console, "info" | "warn" | "error">;
  testHooks?: {
    afterReadBeforeRestat?: (relativePath: string) => Promise<void>;
    afterResolveBeforeOpen?: (relativePath: string) => Promise<void>;
  };
}

interface RefreshCounters {
  discovered: number;
  reused: number;
  filesRead: number;
  parsed: number;
  invalid: number;
  malformed: number;
  unstable: number;
  ioFailures: number;
  deleted: number;
  rawBytesRead: number;
}

function emptyCounters(): RefreshCounters {
  return {
    discovered: 0,
    reused: 0,
    filesRead: 0,
    parsed: 0,
    invalid: 0,
    malformed: 0,
    unstable: 0,
    ioFailures: 0,
    deleted: 0,
    rawBytesRead: 0,
  };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dateOrderValue(date: string): number {
  const value = new Date(date).getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finalizeEntries(
  entries: ReadonlyMap<string, PersistedSessionEntry>,
  logger: Pick<Console, "warn">,
): FinalizedIndex {
  const rawSessions = [...entries.values()]
    .filter(
      (
        entry,
      ): entry is PersistedSessionEntry & { built: BuiltSessionSummary } =>
        entry.built?.valid === true,
    )
    .map((entry) => {
      // duplicateCount belongs to the current corpus-wide dedupe pass, never to
      // a persisted per-file summary.
      const summary = { ...entry.built.summary };
      delete summary.duplicateCount;
      return summary;
    })
    .sort((a, b) => {
      const dateDifference = dateOrderValue(a.date) - dateOrderValue(b.date);
      return dateDifference || compareStrings(a.relativePath, b.relativePath);
    });

  const deduplicated = deduplicateSessions(rawSessions).sort((a, b) => {
    const dateDifference = dateOrderValue(b.date) - dateOrderValue(a.date);
    return dateDifference || compareStrings(a.relativePath, b.relativePath);
  });

  const sessions: SessionSummary[] = [];
  const slugMap = new Map<string, string>();
  for (const session of deduplicated) {
    const collidingPath = slugMap.get(session.slug);
    if (collidingPath) {
      logger.warn(
        `Ignoring duplicate session slug for ${session.relativePath}; already mapped to ${collidingPath}`,
      );
      continue;
    }
    slugMap.set(session.slug, session.relativePath);
    sessions.push(session);
  }

  return {
    sessions,
    slugMap,
    serializedSessions: JSON.stringify(sessions),
  };
}

export function createSessionSummaryIndex(
  options: SessionSummaryIndexOptions,
): SessionSummaryIndex {
  const telemetryRoot = resolve(options.telemetryDir);
  const rootHash = createHash("sha256")
    .update(telemetryRoot)
    .digest("hex")
    .slice(0, ROOT_HASH_LENGTH);
  const indexFile = resolve(
    options.indexFile ??
      resolve(
        process.cwd(),
        ".cache/f1-telemetry-viewer",
        `session-index-${rootHash}.json`,
      ),
  );
  const logger = options.logger ?? console;
  const cacheExclusionRoots = [
    telemetryRoot,
    ...(options.cacheExclusionRoots ?? []).map((root) => resolve(root)),
  ];

  let entries = new Map<string, PersistedSessionEntry>();
  const pendingParseFailures = new Map<string, PendingParseFailure>();
  let finalized: FinalizedIndex | undefined;
  let cacheLoadAttempted = false;
  let persistenceDirty = false;
  let persistenceDisabled = false;
  let persistenceWarningEmitted = false;
  let refreshPromise: Promise<SessionIndexSnapshot> | undefined;
  let cacheSafetyChecked = false;
  let cacheLocationUnsafe = cacheExclusionRoots.some((root) =>
    isPathInsideOrEqual(root, indexFile),
  );

  async function isCacheLocationUnsafe(): Promise<boolean> {
    if (cacheSafetyChecked) return cacheLocationUnsafe;
    cacheSafetyChecked = true;

    if (!cacheLocationUnsafe) {
      try {
        cacheLocationUnsafe = await pathResolvesInsideAny(
          indexFile,
          cacheExclusionRoots,
        );
      } catch {
        // If containment cannot be proven, do not risk writing beside source
        // telemetry or publicly served build output.
        cacheLocationUnsafe = true;
      }
    }

    if (cacheLocationUnsafe) {
      persistenceDisabled = true;
      persistenceWarningEmitted = true;
      logger.warn(
        "Session summary cache overlaps protected data; continuing in memory",
      );
    }
    return cacheLocationUnsafe;
  }

  async function loadPersistedEntries(): Promise<SessionIndexCacheState> {
    if (cacheLoadAttempted) return "memory";
    cacheLoadAttempted = true;

    if (await isCacheLocationUnsafe()) return "rejected";

    try {
      const raw = await readFile(indexFile, "utf8");
      const loaded = validatePersistedIndex(JSON.parse(raw), {
        rootHash,
        formatVersion: SESSION_INDEX_FORMAT_VERSION,
        summaryVersion: SESSION_SUMMARY_CACHE_VERSION,
        isSafeRelativePath,
      });
      if (!loaded) {
        persistenceDirty = true;
        logger.warn(
          "Ignoring an incompatible or invalid session summary index",
        );
        return "rejected";
      }

      entries = loaded;
      finalized = finalizeEntries(entries, logger);
      return "loaded";
    } catch (error: unknown) {
      persistenceDirty = true;
      if (
        isRecord(error) &&
        typeof error.code === "string" &&
        error.code === "ENOENT"
      ) {
        return "miss";
      }
      logger.warn("Unable to read the session summary index; rebuilding it");
      return "rejected";
    }
  }

  async function persistEntries(): Promise<boolean> {
    try {
      await writePersistedIndex({
        indexFile,
        formatVersion: SESSION_INDEX_FORMAT_VERSION,
        summaryVersion: SESSION_SUMMARY_CACHE_VERSION,
        rootHash,
        entries,
      });
      persistenceDirty = false;
      return true;
    } catch {
      // A read-only/ephemeral cache should degrade to memory-only operation,
      // not retry the same failing filesystem work on every list refresh.
      persistenceDisabled = true;
      if (!persistenceWarningEmitted) {
        persistenceWarningEmitted = true;
        logger.warn(
          "Unable to persist the session summary index; continuing in memory",
        );
      }
      return false;
    }
  }

  async function readStableCandidate(
    relativePath: string,
    expectedSignature: FileSignature,
    counters: RefreshCounters,
  ): Promise<Buffer | undefined> {
    const absolutePath = absolutePathFor(telemetryRoot, relativePath);
    if (!absolutePath) return undefined;

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(absolutePath, "r");
      const before = await handle.stat({ bigint: true });
      if (
        !before.isFile() ||
        !signaturesEqual(signatureFromStats(before), expectedSignature)
      ) {
        counters.unstable += 1;
        return undefined;
      }

      const raw = await handle.readFile();
      counters.filesRead += 1;
      counters.rawBytesRead += raw.byteLength;
      await options.testHooks?.afterReadBeforeRestat?.(relativePath);
      const after = await handle.stat({ bigint: true });
      const currentPathStats = await lstat(absolutePath, { bigint: true });
      if (
        !after.isFile() ||
        !signaturesEqual(signatureFromStats(after), expectedSignature) ||
        currentPathStats.isSymbolicLink() ||
        !currentPathStats.isFile() ||
        !signaturesEqual(
          signatureFromStats(currentPathStats),
          expectedSignature,
        )
      ) {
        counters.unstable += 1;
        return undefined;
      }
      return raw;
    } catch {
      counters.ioFailures += 1;
      logger.warn(`Unable to read telemetry file: ${relativePath}`);
      return undefined;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async function performRefresh(): Promise<SessionIndexSnapshot> {
    const startedAt = performance.now();
    const counters = emptyCounters();
    const cacheState = await loadPersistedEntries();

    let discovered: string[];
    try {
      discovered = await discoverJsonFiles(telemetryRoot);
    } catch {
      if (!finalized) throw new Error("Unable to scan the telemetry directory");
      const stats: SessionIndexRefreshStats = {
        ...counters,
        durationMs: performance.now() - startedAt,
        cacheState,
        entriesChanged: false,
        persisted: false,
        fallback: true,
      };
      logger.warn(
        "Unable to complete the telemetry scan; serving the last session index",
      );
      return {
        sessions: finalized.sessions,
        serializedSessions: finalized.serializedSessions,
        stats,
      };
    }

    counters.discovered = discovered.length;
    const candidateStats = await collectCandidateStats(
      telemetryRoot,
      discovered,
      (relativePath) =>
        logger.warn(`Unable to inspect telemetry file: ${relativePath}`),
    );
    const seenPaths = new Set<string>();
    const nextEntries = new Map(entries);
    let entriesChanged = false;

    for (const candidate of candidateStats) {
      const { relativePath } = candidate;
      if (candidate.state === "error") {
        seenPaths.add(relativePath);
        counters.ioFailures += 1;
        continue;
      }
      if (candidate.state !== "regular" || !candidate.signature) continue;

      seenPaths.add(relativePath);
      const signature = candidate.signature;
      const previous = entries.get(relativePath);
      if (previous && signaturesEqual(previous.signature, signature)) {
        counters.reused += 1;
        pendingParseFailures.delete(relativePath);
        continue;
      }

      const pendingFailure = pendingParseFailures.get(relativePath);
      if (
        pendingFailure &&
        signaturesEqual(pendingFailure.signature, signature)
      ) {
        if (Date.now() - pendingFailure.firstSeenAt < CORRUPT_FILE_SETTLE_MS) {
          counters.reused += 1;
          counters.malformed += 1;
          continue;
        }

        pendingParseFailures.delete(relativePath);
        nextEntries.set(relativePath, { signature });
        counters.malformed += 1;
        entriesChanged = true;
        persistenceDirty = true;
        continue;
      }
      pendingParseFailures.delete(relativePath);

      const raw = await readStableCandidate(relativePath, signature, counters);
      if (!raw) continue;

      counters.parsed += 1;
      try {
        const session = JSON.parse(raw.toString("utf8")) as TelemetrySession;
        const built = buildSessionSummary(
          relativePath,
          session,
          Number(BigInt(signature.size)),
        );
        if (!built.valid) counters.invalid += 1;
        nextEntries.set(relativePath, { signature, built });
        entriesChanged = true;
        persistenceDirty = true;
      } catch {
        counters.malformed += 1;
        logger.warn(`Unable to parse telemetry file: ${relativePath}`);
        if (previous?.built) {
          pendingParseFailures.set(relativePath, {
            signature,
            firstSeenAt: Date.now(),
          });
        } else {
          nextEntries.set(relativePath, { signature });
          entriesChanged = true;
          persistenceDirty = true;
        }
      }
    }

    for (const relativePath of entries.keys()) {
      if (seenPaths.has(relativePath)) continue;
      nextEntries.delete(relativePath);
      pendingParseFailures.delete(relativePath);
      counters.deleted += 1;
      entriesChanged = true;
      persistenceDirty = true;
    }

    entries = nextEntries;
    if (!finalized || entriesChanged) {
      finalized = finalizeEntries(entries, logger);
    }

    let persisted = false;
    if (persistenceDirty && !persistenceDisabled) {
      persisted = await persistEntries();
    }

    const stats: SessionIndexRefreshStats = {
      ...counters,
      durationMs: performance.now() - startedAt,
      cacheState,
      entriesChanged,
      persisted,
      fallback: false,
    };

    if (
      cacheState !== "memory" ||
      entriesChanged ||
      counters.parsed > 0 ||
      counters.deleted > 0 ||
      counters.ioFailures > 0 ||
      counters.unstable > 0
    ) {
      logger.info(
        `Session index refresh: discovered=${stats.discovered} reused=${stats.reused} parsed=${stats.parsed} invalid=${stats.invalid} malformed=${stats.malformed} deleted=${stats.deleted} bytes=${stats.rawBytesRead} durationMs=${stats.durationMs.toFixed(1)}`,
      );
    }

    return {
      sessions: finalized.sessions,
      serializedSessions: finalized.serializedSessions,
      stats,
    };
  }

  function refresh(): Promise<SessionIndexSnapshot> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = undefined;
    });
    return refreshPromise;
  }

  async function openMappedSession(
    relativePath: string,
  ): Promise<OpenedSessionFile | undefined> {
    await options.testHooks?.afterResolveBeforeOpen?.(relativePath);
    return openIndexedFile(telemetryRoot, relativePath);
  }

  async function openSession(
    slug: string,
  ): Promise<OpenedSessionFile | undefined> {
    let refreshed = false;
    let relativePath = finalized?.slugMap.get(slug);
    if (!finalized || !relativePath) {
      await refresh();
      refreshed = true;
      relativePath = finalized?.slugMap.get(slug);
    }
    if (!relativePath) return undefined;

    const openedFile = await openMappedSession(relativePath);
    if (openedFile) return openedFile;
    if (refreshed) return undefined;

    await refresh();
    relativePath = finalized?.slugMap.get(slug);
    return relativePath ? openMappedSession(relativePath) : undefined;
  }

  return { refresh, openSession };
}
