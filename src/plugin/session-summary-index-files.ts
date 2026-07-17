import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import {
  signatureFromStats,
  signaturesEqual,
  type FileSignature,
} from "./session-summary-index-storage.ts";

const METADATA_CONCURRENCY = 32;

export interface CandidateStat {
  relativePath: string;
  signature?: FileSignature;
  state: "regular" | "missing" | "not-regular" | "error";
}

export interface OpenedSessionFile {
  path: string;
  handle: FileHandle;
}

/** Normalize Node's platform-specific relative paths before summary parsing. */
export function normalizeSessionRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

export function isSafeRelativePath(relativePath: string): boolean {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    !relativePath.endsWith(".json")
  ) {
    return false;
  }

  const segments = relativePath.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.startsWith("."),
  );
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot.length > 0 &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

export function isPathInsideOrEqual(root: string, candidate: string): boolean {
  return (
    resolve(root) === resolve(candidate) ||
    isWithin(resolve(root), resolve(candidate))
  );
}

async function resolveThroughExistingAncestor(
  targetPath: string,
): Promise<string> {
  let currentPath = resolve(targetPath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return resolve(await realpath(currentPath), ...missingSegments);
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;

      const parentPath = dirname(currentPath);
      if (parentPath === currentPath) return resolve(targetPath);
      missingSegments.unshift(basename(currentPath));
      currentPath = parentPath;
    }
  }
}

/** Resolve existing symlinked ancestors before checking cache containment. */
export async function pathResolvesInsideAny(
  candidatePath: string,
  roots: readonly string[],
): Promise<boolean> {
  const resolvedCandidate = await resolveThroughExistingAncestor(candidatePath);
  for (const root of roots) {
    const resolvedRoot = await resolveThroughExistingAncestor(root);
    if (isPathInsideOrEqual(resolvedRoot, resolvedCandidate)) return true;
  }
  return false;
}

export function absolutePathFor(
  telemetryRoot: string,
  relativePath: string,
): string | undefined {
  if (!isSafeRelativePath(relativePath)) return undefined;
  const absolutePath = resolve(telemetryRoot, ...relativePath.split("/"));
  return isWithin(telemetryRoot, absolutePath) ? absolutePath : undefined;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
  return results;
}

export async function discoverJsonFiles(
  telemetryRoot: string,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const relativePath = normalizeSessionRelativePath(
          relative(telemetryRoot, fullPath),
        );
        if (isSafeRelativePath(relativePath)) files.push(relativePath);
      }
    }
  }

  await walk(telemetryRoot);
  files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return files;
}

export async function collectCandidateStats(
  telemetryRoot: string,
  relativePaths: readonly string[],
  onInspectError: (relativePath: string) => void,
): Promise<CandidateStat[]> {
  return mapWithConcurrency(
    relativePaths,
    METADATA_CONCURRENCY,
    async (relativePath): Promise<CandidateStat> => {
      const absolutePath = absolutePathFor(telemetryRoot, relativePath);
      if (!absolutePath) return { relativePath, state: "not-regular" };
      try {
        const stats = await lstat(absolutePath, { bigint: true });
        if (stats.isSymbolicLink() || !stats.isFile()) {
          return { relativePath, state: "not-regular" };
        }
        return {
          relativePath,
          signature: signatureFromStats(stats),
          state: "regular",
        };
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error != null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return { relativePath, state: "missing" };
        }
        onInspectError(relativePath);
        return { relativePath, state: "error" };
      }
    },
  );
}

export async function openIndexedFile(
  telemetryRoot: string,
  relativePath: string,
): Promise<OpenedSessionFile | undefined> {
  const absolutePath = absolutePathFor(telemetryRoot, relativePath);
  if (!absolutePath) return undefined;

  let handle: FileHandle | undefined;
  try {
    const flags =
      process.platform === "win32"
        ? constants.O_RDONLY
        : constants.O_RDONLY | constants.O_NOFOLLOW;
    handle = await open(absolutePath, flags);
    const [openedStats, currentPathStats] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(absolutePath, { bigint: true }),
    ]);
    if (
      !openedStats.isFile() ||
      currentPathStats.isSymbolicLink() ||
      !currentPathStats.isFile() ||
      !signaturesEqual(
        signatureFromStats(openedStats),
        signatureFromStats(currentPathStats),
      )
    ) {
      await handle.close();
      return undefined;
    }

    // Parent directories can be replaced by symlinks even when the leaf was
    // opened with O_NOFOLLOW. Verify where the opened path resolves and keep
    // streaming this same handle so later swaps cannot redirect the response.
    const [realRoot, realCandidate] = await Promise.all([
      realpath(telemetryRoot),
      realpath(absolutePath),
    ]);
    if (!isWithin(realRoot, realCandidate)) {
      await handle.close();
      return undefined;
    }
    return { path: absolutePath, handle };
  } catch {
    await handle?.close().catch(() => undefined);
    return undefined;
  }
}
