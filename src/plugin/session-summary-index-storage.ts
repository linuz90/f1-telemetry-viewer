import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { toSlug } from "../utils/parseFilename.ts";
import type { BuiltSessionSummary } from "../utils/sessionSummary.ts";

export interface FileSignature {
  size: string;
  mtimeNs: string;
  ctimeNs: string;
  dev: string;
  ino: string;
}

export interface PersistedSessionEntry {
  signature: FileSignature;
  built?: BuiltSessionSummary;
}

interface PersistedSessionIndex {
  formatVersion: number;
  summaryVersion: number;
  rootHash: string;
  entries: [relativePath: string, entry: PersistedSessionEntry][];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^-?\d+$/.test(value);
}

function isFileSignature(value: unknown): value is FileSignature {
  if (!isRecord(value)) return false;
  return (
    isDecimalString(value.size) &&
    isDecimalString(value.mtimeNs) &&
    isDecimalString(value.ctimeNs) &&
    isDecimalString(value.dev) &&
    isDecimalString(value.ino)
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return (
    value === undefined || (typeof value === "number" && Number.isFinite(value))
  );
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isBuiltSessionSummary(
  value: unknown,
  relativePath: string,
): value is BuiltSessionSummary {
  if (!isRecord(value) || typeof value.valid !== "boolean") return false;
  const summary = value.summary;
  if (!isRecord(summary)) return false;

  return (
    summary.relativePath === relativePath &&
    summary.slug === toSlug(relativePath) &&
    typeof summary.sessionType === "string" &&
    typeof summary.track === "string" &&
    typeof summary.date === "string" &&
    typeof summary.validLapCount === "number" &&
    Number.isFinite(summary.validLapCount) &&
    typeof summary.fileSize === "number" &&
    Number.isFinite(summary.fileSize) &&
    !Object.hasOwn(summary, "duplicateCount") &&
    isOptionalString(summary.sessionUid) &&
    isOptionalString(summary.formula) &&
    isOptionalFiniteNumber(summary.gameYear) &&
    isOptionalFiniteNumber(summary.packetFormat) &&
    isOptionalFiniteNumber(summary.bestLapTimeMs) &&
    isOptionalBoolean(summary.isOnline) &&
    isOptionalBoolean(summary.isAutoSave)
  );
}

interface ValidatePersistedIndexOptions {
  rootHash: string;
  formatVersion: number;
  summaryVersion: number;
  isSafeRelativePath: (relativePath: string) => boolean;
}

export function validatePersistedIndex(
  value: unknown,
  options: ValidatePersistedIndexOptions,
): Map<string, PersistedSessionEntry> | undefined {
  if (
    !isRecord(value) ||
    value.formatVersion !== options.formatVersion ||
    value.summaryVersion !== options.summaryVersion ||
    value.rootHash !== options.rootHash ||
    !Array.isArray(value.entries)
  ) {
    return undefined;
  }

  const entries = new Map<string, PersistedSessionEntry>();
  for (const tuple of value.entries) {
    if (!Array.isArray(tuple) || tuple.length !== 2) return undefined;
    const [relativePath, rawEntry] = tuple;
    if (
      typeof relativePath !== "string" ||
      !options.isSafeRelativePath(relativePath) ||
      entries.has(relativePath) ||
      !isRecord(rawEntry) ||
      !isFileSignature(rawEntry.signature)
    ) {
      return undefined;
    }

    if (
      Object.hasOwn(rawEntry, "built") &&
      !isBuiltSessionSummary(rawEntry.built, relativePath)
    ) {
      return undefined;
    }

    entries.set(relativePath, {
      signature: rawEntry.signature,
      ...(rawEntry.built
        ? { built: rawEntry.built as BuiltSessionSummary }
        : {}),
    });
  }

  return entries;
}

export function signatureFromStats(stats: BigIntStats): FileSignature {
  return {
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString(),
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
  };
}

export function signaturesEqual(
  left: FileSignature,
  right: FileSignature,
): boolean {
  return (
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

interface WritePersistedIndexOptions {
  indexFile: string;
  formatVersion: number;
  summaryVersion: number;
  rootHash: string;
  entries: ReadonlyMap<string, PersistedSessionEntry>;
}

export async function writePersistedIndex(
  options: WritePersistedIndexOptions,
): Promise<void> {
  const payload: PersistedSessionIndex = {
    formatVersion: options.formatVersion,
    summaryVersion: options.summaryVersion,
    rootHash: options.rootHash,
    entries: [...options.entries.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  };
  const cacheDirectory = dirname(options.indexFile);
  const tempFile = resolve(
    cacheDirectory,
    `.${basename(options.indexFile)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(cacheDirectory, 0o700);
    const handle = await open(tempFile, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(payload), "utf8");
    } finally {
      await handle.close();
    }
    await rename(tempFile, options.indexFile);
    // Rename preserves the private temp-file mode; chmod also repairs an old
    // cache file on platforms that support POSIX modes.
    await chmod(options.indexFile, 0o600).catch(() => undefined);
  } catch (error) {
    await unlink(tempFile).catch(() => undefined);
    throw error;
  }
}
