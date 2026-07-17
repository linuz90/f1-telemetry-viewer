import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  createSessionSummaryIndex,
  type SessionIndexRefreshStats,
} from "../src/plugin/session-summary-index.ts";
import {
  discoverJsonFiles,
  pathResolvesInsideAny,
} from "../src/plugin/session-summary-index-files.ts";

const DEFAULT_SCRATCH_ROOT = "/tmp/f1-telemetry-session-index-bench/";
const VISIBLE_FILE_COUNT = 1_260;
const RACE_FILE_COUNT = 503;
const QUALIFYING_FILE_COUNT = VISIBLE_FILE_COUNT - RACE_FILE_COUNT;
const HIDDEN_FILE_BYTES = Math.round(6.9 * 1024 * 1024);
const WARM_RUNS = 20;
const FILE_INTERVAL_MS = 61_000;
const GENERATION_CONCURRENCY = 16;

interface BenchmarkOptions {
  scratchRoot: string;
  sourceDir?: string;
}

interface RefreshMeasurement {
  durationMs: number;
  sessionCount: number;
  serializedBytes: number;
  stats: SessionIndexRefreshStats;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    maxRssKilobytes: number;
  };
}

interface GeneratedCorpus {
  visibleBytes: number;
  racePaths: string[];
  qualifyingPaths: string[];
}

function isWithinDirectory(parent: string, candidate: string): boolean {
  const relativePath = path.relative(parent, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

async function assertScratchOutsideSourceData(
  scratchRoot: string,
  sourceDir?: string,
) {
  const resolvedScratchRoot = await realpath(scratchRoot);
  const protectedDirectories = [process.env.TELEMETRY_DIR, sourceDir].filter(
    (directory): directory is string => Boolean(directory),
  );

  for (const directory of protectedDirectories) {
    const resolvedDirectory = await realpath(path.resolve(directory)).catch(
      () => path.resolve(directory),
    );
    if (isWithinDirectory(resolvedDirectory, resolvedScratchRoot)) {
      throw new Error("Scratch root must be outside telemetry source data");
    }
  }
}

function assertScratchLexicallyOutsideSourceData(
  scratchRoot: string,
  sourceDir?: string,
): void {
  const resolvedScratchRoot = path.resolve(scratchRoot);
  const protectedDirectories = [process.env.TELEMETRY_DIR, sourceDir].filter(
    (directory): directory is string => Boolean(directory),
  );

  for (const directory of protectedDirectories) {
    if (isWithinDirectory(path.resolve(directory), resolvedScratchRoot)) {
      throw new Error("Scratch root must be outside telemetry source data");
    }
  }
}

async function assertScratchResolvesOutsideSourceData(
  scratchRoot: string,
  sourceDir?: string,
): Promise<void> {
  const protectedDirectories = [process.env.TELEMETRY_DIR, sourceDir].filter(
    (directory): directory is string => Boolean(directory),
  );
  if (
    await pathResolvesInsideAny(
      scratchRoot,
      protectedDirectories.map((directory) => path.resolve(directory)),
    )
  ) {
    throw new Error("Scratch root must be outside telemetry source data");
  }
}

function parseOptions(argv: string[]): BenchmarkOptions {
  let scratchRoot = DEFAULT_SCRATCH_ROOT;
  let sourceDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--scratch-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing scratch root");
      scratchRoot = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--scratch-root=")) {
      scratchRoot = argument.slice("--scratch-root=".length);
      if (!scratchRoot) throw new Error("Missing scratch root");
      continue;
    }
    if (argument === "--source-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing source directory");
      sourceDir = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--source-dir=")) {
      sourceDir = argument.slice("--source-dir=".length);
      if (!sourceDir) throw new Error("Missing source directory");
      continue;
    }
    throw new Error("Unknown benchmark option");
  }

  return {
    scratchRoot: path.resolve(scratchRoot),
    ...(sourceDir ? { sourceDir: path.resolve(sourceDir) } : {}),
  };
}

function formatTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join("_");
}

function corpusRelativePath(index: number, kind: "race" | "qualifying") {
  const timestamp = formatTimestamp(
    Date.UTC(2026, 0, 1) + index * FILE_INTERVAL_MS,
  );
  const filename =
    kind === "race"
      ? `Race_Spa_Manual_${timestamp}.json`
      : `Short_Qualifying_Zandvoort_Manual_${timestamp}.json`;
  return path.join(
    `batch-${String(Math.floor(index / 100)).padStart(2, "0")}`,
    filename,
  );
}

async function runBounded(
  count: number,
  worker: (index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let failure: unknown;

  const workers = Array.from(
    { length: Math.min(count, GENERATION_CONCURRENCY) },
    async () => {
      while (failure === undefined) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= count) return;
        try {
          await worker(index);
        } catch (error) {
          failure = error;
        }
      }
    },
  );

  await Promise.all(workers);
  if (failure !== undefined) throw failure;
}

async function writeHiddenPngCache(telemetryDir: string): Promise<void> {
  const prefix = '{"padding":"';
  const suffix = '"}';
  const paddingBytes =
    HIDDEN_FILE_BYTES - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  assert(paddingBytes > 0);
  await writeFile(
    path.join(telemetryDir, ".png_session_cache.json"),
    `${prefix}${"x".repeat(paddingBytes)}${suffix}`,
  );
}

async function generateCorpus(
  telemetryDir: string,
  fixtures: readonly string[],
): Promise<GeneratedCorpus> {
  const racePaths = Array.from({ length: RACE_FILE_COUNT }, (_, index) =>
    corpusRelativePath(index, "race"),
  );
  const qualifyingPaths = Array.from(
    { length: QUALIFYING_FILE_COUNT },
    (_, offset) => corpusRelativePath(RACE_FILE_COUNT + offset, "qualifying"),
  );
  const allPaths = [...racePaths, ...qualifyingPaths];

  for (
    let batch = 0;
    batch <= Math.floor(VISIBLE_FILE_COUNT / 100);
    batch += 1
  ) {
    await mkdir(
      path.join(telemetryDir, `batch-${String(batch).padStart(2, "0")}`),
      { recursive: true },
    );
  }

  await runBounded(allPaths.length, async (index) => {
    const fixture = fixtures[index];
    assert(fixture);
    await copyFile(fixture, path.join(telemetryDir, allPaths[index]));
  });
  await writeHiddenPngCache(telemetryDir);

  const uniqueFixtures = [...new Set(fixtures)];
  const fixtureSizes = new Map<string, number>(
    await Promise.all(
      uniqueFixtures.map(
        async (fixture) => [fixture, (await stat(fixture)).size] as const,
      ),
    ),
  );
  return {
    visibleBytes: fixtures.reduce(
      (total, fixture) => total + (fixtureSizes.get(fixture) ?? 0),
      0,
    ),
    racePaths,
    qualifyingPaths,
  };
}

const silentLogger = {
  info: (...args: unknown[]) => void args,
  warn: (...args: unknown[]) => void args,
  error: (...args: unknown[]) => void args,
};

async function measureRefresh(
  index: ReturnType<typeof createSessionSummaryIndex>,
): Promise<{ measurement: RefreshMeasurement; serializedSessions: string }> {
  const startedAt = performance.now();
  const snapshot = await index.refresh();
  const durationMs = performance.now() - startedAt;
  const memory = process.memoryUsage();

  return {
    measurement: {
      durationMs,
      sessionCount: snapshot.sessions.length,
      serializedBytes: Buffer.byteLength(snapshot.serializedSessions),
      stats: snapshot.stats,
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        maxRssKilobytes: process.resourceUsage().maxRSS,
      },
    },
    serializedSessions: snapshot.serializedSessions,
  };
}

function percentile(values: number[], quantile: number): number {
  assert(values.length > 0);
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function aggregateWarmRuns(measurements: RefreshMeasurement[]) {
  const durations = measurements.map((measurement) => measurement.durationMs);
  return {
    runs: measurements.length,
    durationMs: {
      min: Math.min(...durations),
      median: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: Math.max(...durations),
    },
    counters: {
      discovered: measurements.reduce(
        (total, measurement) => total + measurement.stats.discovered,
        0,
      ),
      reused: measurements.reduce(
        (total, measurement) => total + measurement.stats.reused,
        0,
      ),
      filesRead: measurements.reduce(
        (total, measurement) => total + measurement.stats.filesRead,
        0,
      ),
      parsed: measurements.reduce(
        (total, measurement) => total + measurement.stats.parsed,
        0,
      ),
      rawBytesRead: measurements.reduce(
        (total, measurement) => total + measurement.stats.rawBytesRead,
        0,
      ),
      persisted: measurements.filter(
        (measurement) => measurement.stats.persisted,
      ).length,
    },
    finalMemory: measurements.at(-1)?.memory,
  };
}

async function replaceWithSameSizeChange(target: string): Promise<void> {
  const [contents, targetStats] = await Promise.all([
    readFile(target),
    stat(target),
  ]);
  const digitOffset = contents.findIndex((byte) => byte >= 48 && byte <= 57);
  assert(digitOffset >= 0, "Telemetry fixture has no safe mutation marker");
  contents[digitOffset] =
    contents[digitOffset] === 57 ? 56 : contents[digitOffset] + 1;
  JSON.parse(contents.toString("utf8"));

  const temporaryPath = path.join(
    path.dirname(target),
    `.benchmark-replacement-${process.pid}.tmp`,
  );
  await writeFile(temporaryPath, contents);
  await utimes(temporaryPath, targetStats.atime, targetStats.mtime);
  await rename(temporaryPath, target);
}

function assertIncrementalRead(
  measurement: RefreshMeasurement,
  expectedParsed: number,
  expectedFilesRead: number,
): void {
  assert.equal(measurement.stats.parsed, expectedParsed);
  assert.equal(measurement.stats.filesRead, expectedFilesRead);
}

async function runBenchmark(options: BenchmarkOptions) {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const defaultRaceFixture = path.join(
    repositoryRoot,
    "public/demo/race-spa-2026-01-26-22-14-52.json",
  );
  const defaultQualifyingFixture = path.join(
    repositoryRoot,
    "public/demo/short-qualifying-zandvoort-2026-02-07-11-33-48.json",
  );

  // Reject obvious overlaps before mkdir has any chance to mutate source data;
  // the realpath check below catches overlaps through symlinked ancestors.
  assertScratchLexicallyOutsideSourceData(
    options.scratchRoot,
    options.sourceDir,
  );
  await assertScratchResolvesOutsideSourceData(
    options.scratchRoot,
    options.sourceDir,
  );
  await mkdir(options.scratchRoot, { recursive: true });
  await assertScratchOutsideSourceData(options.scratchRoot, options.sourceDir);
  const sourceFixtures = options.sourceDir
    ? (await discoverJsonFiles(options.sourceDir)).map((relativePath) =>
        path.join(options.sourceDir!, relativePath),
      )
    : undefined;
  if (sourceFixtures && sourceFixtures.length === 0) {
    throw new Error("Source directory contains no visible telemetry JSON");
  }
  const fixtures = Array.from({ length: VISIBLE_FILE_COUNT }, (_, index) =>
    sourceFixtures
      ? sourceFixtures[index % sourceFixtures.length]
      : index < RACE_FILE_COUNT
        ? defaultRaceFixture
        : defaultQualifyingFixture,
  );
  const runDirectory = await mkdtemp(
    path.join(options.scratchRoot, "session-index-run-"),
  );
  const telemetryDir = path.join(runDirectory, "telemetry");
  const indexFile = path.join(runDirectory, "session-index.json");

  let report: Record<string, unknown> | undefined;
  let cleanupCompleted = false;

  try {
    await mkdir(telemetryDir);
    const corpus = await generateCorpus(telemetryDir, fixtures);
    const index = createSessionSummaryIndex({
      telemetryDir,
      indexFile,
      logger: silentLogger,
    });

    const cold = await measureRefresh(index);
    assert.equal(cold.measurement.stats.discovered, VISIBLE_FILE_COUNT);
    assertIncrementalRead(
      cold.measurement,
      VISIBLE_FILE_COUNT,
      VISIBLE_FILE_COUNT,
    );
    assert.equal(cold.measurement.stats.rawBytesRead, corpus.visibleBytes);

    const persistedBeforeWarm = await stat(indexFile, { bigint: true });
    const warmRuns: RefreshMeasurement[] = [];
    for (let run = 0; run < WARM_RUNS; run += 1) {
      const warm = await measureRefresh(index);
      assert.equal(warm.serializedSessions, cold.serializedSessions);
      assertIncrementalRead(warm.measurement, 0, 0);
      assert.equal(warm.measurement.stats.rawBytesRead, 0);
      assert.equal(warm.measurement.stats.persisted, false);
      warmRuns.push(warm.measurement);
    }
    const persistedAfterWarm = await stat(indexFile, { bigint: true });
    assert.equal(persistedAfterWarm.mtimeNs, persistedBeforeWarm.mtimeNs);

    const restartedIndex = createSessionSummaryIndex({
      telemetryDir,
      indexFile,
      logger: silentLogger,
    });
    const restart = await measureRefresh(restartedIndex);
    assert.equal(restart.serializedSessions, cold.serializedSessions);
    assertIncrementalRead(restart.measurement, 0, 0);
    assert.equal(restart.measurement.stats.rawBytesRead, 0);
    assert.equal(restart.measurement.stats.cacheState, "loaded");

    const addedRelativePath = corpusRelativePath(
      VISIBLE_FILE_COUNT,
      "qualifying",
    );
    const addedPath = path.join(telemetryDir, addedRelativePath);
    const addedFixture = fixtures.at(-1)!;
    await copyFile(addedFixture, addedPath);
    const added = await measureRefresh(index);
    assertIncrementalRead(added.measurement, 1, 1);
    assert.equal(
      added.measurement.stats.rawBytesRead,
      (await stat(addedFixture)).size,
    );

    const replacedPath = path.join(telemetryDir, corpus.racePaths[0]);
    await replaceWithSameSizeChange(replacedPath);
    const replaced = await measureRefresh(index);
    assertIncrementalRead(replaced.measurement, 1, 1);
    assert.equal(
      replaced.measurement.stats.rawBytesRead,
      (await stat(fixtures[0])).size,
    );

    await rm(path.join(telemetryDir, corpus.qualifyingPaths.at(-1)!));
    const deleted = await measureRefresh(index);
    assertIncrementalRead(deleted.measurement, 0, 0);
    assert.equal(deleted.measurement.stats.deleted, 1);
    report = {
      corpus: {
        visibleFiles: VISIBLE_FILE_COUNT,
        visibleBytes: corpus.visibleBytes,
        hiddenBytes: HIDDEN_FILE_BYTES,
        sourceFiles: new Set(fixtures).size,
      },
      cold: cold.measurement,
      warm: aggregateWarmRuns(warmRuns),
      restart: restart.measurement,
      mutations: {
        add: added.measurement,
        sameSizeAtomicReplace: replaced.measurement,
        delete: deleted.measurement,
      },
    };
  } finally {
    // The only recursive removal is the exact child returned by mkdtemp.
    assert.equal(path.dirname(runDirectory), options.scratchRoot);
    assert(path.basename(runDirectory).startsWith("session-index-run-"));
    await rm(runDirectory, { recursive: true, force: true });
    cleanupCompleted = true;
  }

  assert(report);
  process.stdout.write(`${JSON.stringify({ ...report, cleanupCompleted })}\n`);
}

async function main(): Promise<void> {
  await runBenchmark(parseOptions(process.argv.slice(2)));
}

main().catch(() => {
  process.stderr.write("Session-index benchmark failed\n");
  process.exitCode = 1;
});
